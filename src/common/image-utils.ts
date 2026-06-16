import { deflateSync } from 'zlib';

type PdfImage = {
  width: number;
  height: number;
  kind: number;
  data: Uint8Array | Uint8ClampedArray;
};

type ImageDimensions = {
  width: number;
  height: number;
};

const PNG_SIGNATURE = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);

  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }

  return table;
})();

export function buildDataUrl(
  contentType: string,
  bytes: Uint8Array | Buffer,
): string {
  return `data:${contentType};base64,${Buffer.from(bytes).toString('base64')}`;
}

export function parseImageDimensions(
  bytes: Uint8Array | Buffer,
): ImageDimensions | null {
  const buffer = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);

  if (buffer.length >= 24 && buffer.subarray(0, 8).equals(PNG_SIGNATURE)) {
    return {
      width: buffer.readUInt32BE(16),
      height: buffer.readUInt32BE(20),
    };
  }

  if (buffer.length >= 10 && buffer[0] === 0xff && buffer[1] === 0xd8) {
    let offset = 2;

    while (offset + 9 < buffer.length) {
      if (buffer[offset] !== 0xff) {
        offset += 1;
        continue;
      }

      let marker = buffer[offset + 1];
      while (marker === 0xff) {
        offset += 1;
        marker = buffer[offset + 1];
      }

      if (
        marker === 0xc0 ||
        marker === 0xc1 ||
        marker === 0xc2 ||
        marker === 0xc3 ||
        marker === 0xc5 ||
        marker === 0xc6 ||
        marker === 0xc7 ||
        marker === 0xc9 ||
        marker === 0xca ||
        marker === 0xcb ||
        marker === 0xcd ||
        marker === 0xce ||
        marker === 0xcf
      ) {
        const height = buffer.readUInt16BE(offset + 5);
        const width = buffer.readUInt16BE(offset + 7);
        return { width, height };
      }

      const segmentLength = buffer.readUInt16BE(offset + 2);
      if (!Number.isFinite(segmentLength) || segmentLength < 2) {
        break;
      }

      offset += 2 + segmentLength;
    }
  }

  return null;
}

export function pdfImageToPngDataUrl(image: PdfImage): string | null {
  if (!image || !Number.isFinite(image.width) || !Number.isFinite(image.height)) {
    return null;
  }

  const width = Math.max(1, Math.floor(image.width));
  const height = Math.max(1, Math.floor(image.height));
  const rowStride = width * 4;
  const raw = Buffer.alloc((rowStride + 1) * height);
  const data = Buffer.from(image.data);

  for (let y = 0; y < height; y++) {
    const rowStart = y * (rowStride + 1);
    raw[rowStart] = 0;

    if (image.kind === 3) {
      data.copy(raw, rowStart + 1, y * rowStride, y * rowStride + rowStride);
      continue;
    }

    if (image.kind === 2) {
      for (let x = 0; x < width; x++) {
        const src = y * width * 3 + x * 3;
        const dst = rowStart + 1 + x * 4;
        raw[dst] = data[src];
        raw[dst + 1] = data[src + 1];
        raw[dst + 2] = data[src + 2];
        raw[dst + 3] = 255;
      }
      continue;
    }

    return null;
  }

  const compressed = deflateSync(raw);

  const png = Buffer.concat([
    PNG_SIGNATURE,
    buildPngChunk('IHDR', buildPngIhdr(width, height)),
    buildPngChunk('IDAT', compressed),
    buildPngChunk('IEND', Buffer.alloc(0)),
  ]);

  return `data:image/png;base64,${png.toString('base64')}`;
}

function buildPngIhdr(width: number, height: number): Buffer {
  const chunk = Buffer.alloc(13);
  chunk.writeUInt32BE(width, 0);
  chunk.writeUInt32BE(height, 4);
  chunk[8] = 8;
  chunk[9] = 6;
  chunk[10] = 0;
  chunk[11] = 0;
  chunk[12] = 0;
  return chunk;
}

function buildPngChunk(type: string, data: Buffer): Buffer {
  const typeBuffer = Buffer.from(type, 'ascii');
  const lengthBuffer = Buffer.alloc(4);
  lengthBuffer.writeUInt32BE(data.length, 0);
  const crcBuffer = Buffer.alloc(4);
  crcBuffer.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);
  return Buffer.concat([lengthBuffer, typeBuffer, data, crcBuffer]);
}

function crc32(buffer: Buffer): number {
  let crc = 0xffffffff;

  for (let i = 0; i < buffer.length; i++) {
    crc = CRC_TABLE[(crc ^ buffer[i]) & 0xff] ^ (crc >>> 8);
  }

  return (crc ^ 0xffffffff) >>> 0;
}
