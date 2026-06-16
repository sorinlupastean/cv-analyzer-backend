import base64
import io
import math
import os
import sys
from typing import Optional, Tuple

import fitz  # PyMuPDF
from PIL import Image


def _to_data_url(png_bytes: bytes) -> str:
    return "data:image/png;base64," + base64.b64encode(png_bytes).decode("ascii")


def _fit_to_detection_size(img: Image.Image) -> Image.Image:
    # Work on a manageable size while preserving the page layout.
    max_width = 1400
    if img.width <= max_width:
        return img

    scale = max_width / float(img.width)
    return img.resize((max_width, int(img.height * scale)), Image.Resampling.LANCZOS)


def _find_candidate_crop(img: Image.Image) -> Optional[Tuple[int, int, int, int]]:
    # Search the upper-right part of the page where CV portraits are usually placed.
    search_x0 = int(img.width * 0.5)
    search_y0 = 0
    search_x1 = img.width
    search_y1 = int(img.height * 0.32)
    region = img.crop((search_x0, search_y0, search_x1, search_y1))

    if region.width < 120 or region.height < 120:
        return None

    # Downsample for a light connected-component pass.
    sample = region.resize(
        (max(1, region.width // 3), max(1, region.height // 3)),
        Image.Resampling.LANCZOS,
    ).convert("RGB")
    px = sample.load()

    mask = [[0] * sample.width for _ in range(sample.height)]
    for y in range(sample.height):
        for x in range(sample.width):
            r, g, b = px[x, y]
            darkness = (255 - r) + (255 - g) + (255 - b)
            if darkness > 30:
                mask[y][x] = 1

    visited = [[False] * sample.width for _ in range(sample.height)]
    best_box = None
    best_score = -1.0

    for y in range(sample.height):
        for x in range(sample.width):
            if not mask[y][x] or visited[y][x]:
                continue

            queue = [(x, y)]
            visited[y][x] = True
            minx = maxx = x
            miny = maxy = y
            area = 0

            while queue:
                cx, cy = queue.pop()
                area += 1
                minx = min(minx, cx)
                maxx = max(maxx, cx)
                miny = min(miny, cy)
                maxy = max(maxy, cy)

                for nx, ny in (
                    (cx + 1, cy),
                    (cx - 1, cy),
                    (cx, cy + 1),
                    (cx, cy - 1),
                ):
                    if (
                        0 <= nx < sample.width
                        and 0 <= ny < sample.height
                        and mask[ny][nx]
                        and not visited[ny][nx]
                    ):
                        visited[ny][nx] = True
                        queue.append((nx, ny))

            box_w = maxx - minx + 1
            box_h = maxy - miny + 1
            if box_w < 12 or box_h < 12:
                continue

            ratio = box_w / float(max(box_h, 1))
            if ratio < 0.55 or ratio > 1.8:
                continue

            # Reject tiny text fragments and giant blocks of text.
            if area < 120 or area > 20000:
                continue

            center_x = (minx + maxx) / 2.0
            center_y = (miny + maxy) / 2.0
            right_bias = center_x / max(sample.width, 1)
            top_bias = 1.0 - (center_y / max(sample.height, 1))
            compactness = 1.0 - min(abs(math.log(max(ratio, 0.01))), 1.0)
            score = area * (1.0 + compactness * 0.6 + right_bias * 0.2 + top_bias * 0.2)

            if score > best_score:
                best_score = score
                best_box = (minx, miny, maxx, maxy)

    if best_box is None:
        return None

    left, top, right, bottom = best_box
    scale = region.width / float(sample.width)
    left = int(left * scale)
    top = int(top * scale)
    right = int((right + 1) * scale)
    bottom = int((bottom + 1) * scale)

    pad_x = max(8, int((right - left) * 0.14))
    pad_y = max(8, int((bottom - top) * 0.14))

    crop_left = max(0, left - pad_x)
    crop_top = max(0, top - pad_y)
    crop_right = min(region.width, right + pad_x)
    crop_bottom = min(region.height, bottom + pad_y)

    # Convert back to the original image coordinates if we resized above.
    return (
        search_x0 + crop_left,
        search_y0 + crop_top,
        search_x0 + crop_right,
        search_y0 + crop_bottom,
    )


def extract_candidate_photo(pdf_path: str) -> Optional[str]:
    doc = fitz.open(pdf_path)
    try:
        if doc.page_count < 1:
            return None

        page = doc.load_page(0)
        pix = page.get_pixmap(matrix=fitz.Matrix(2.5, 2.5), alpha=False)
        image = Image.frombytes("RGB", (pix.width, pix.height), pix.samples)
        image = _fit_to_detection_size(image)

        crop_box = _find_candidate_crop(image)
        if not crop_box:
            return None

        cropped = image.crop(crop_box).convert("RGB")
        # Reject obviously blank crops.
        sample = cropped.resize((32, 32), Image.Resampling.BILINEAR).convert("RGB")
        sample_px = sample.load()
        pixels = [
            sample_px[x, y]
            for y in range(sample.height)
            for x in range(sample.width)
        ]
        if not pixels:
            return None

        non_white = 0
        for r, g, b in pixels:
            if (255 - r) + (255 - g) + (255 - b) > 35:
                non_white += 1
        if non_white / float(len(pixels)) < 0.05:
            return None

        out = io.BytesIO()
        cropped.save(out, format="PNG", optimize=True)
        return _to_data_url(out.getvalue())
    finally:
        doc.close()


def main() -> int:
    if len(sys.argv) < 2:
        print("null")
        return 0

    pdf_path = sys.argv[1]
    if not os.path.exists(pdf_path):
        print("null")
        return 0

    try:
        data_url = extract_candidate_photo(pdf_path)
        print(data_url if data_url else "null")
        return 0
    except Exception:
        print("null")
        return 0


if __name__ == "__main__":
    raise SystemExit(main())
