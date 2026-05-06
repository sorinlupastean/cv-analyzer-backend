const REPLACEMENT_CHAR = /\uFFFD/g;
const ROMANIAN_DIACRITICS =
  /[\u0103\u00e2\u00ee\u0219\u021b\u0102\u00c2\u00ce\u0218\u021a]/gu;
const MOJIBAKE_MARKERS =
  /[\u00c3\u00c2\u00c4\u00c5\u00c6\u00c7\u00c8\u00c9\u00ca\u00cb\u00cc\u00cd\u00ce\u00cf\u00d0\u00d1\u00d2\u00d3\u00d4\u00d5\u00d6\u00d7\u00d8\u00d9\u00da\u00db\u00dc\u00dd\u00de\u00df]/u;

function decodeLatin1ToUtf8(value: string): string {
  try {
    return Buffer.from(value, 'latin1').toString('utf8');
  } catch {
    return value;
  }
}

function scoreText(value: string): number {
  const replacementCount = value.match(REPLACEMENT_CHAR)?.length ?? 0;
  const diacriticCount = value.match(ROMANIAN_DIACRITICS)?.length ?? 0;
  const mojibakeCount = value.match(MOJIBAKE_MARKERS)?.length ?? 0;

  return diacriticCount * 4 - replacementCount * 10 - mojibakeCount * 2;
}

export function normalizeUnicodeText(input: string | null | undefined): string {
  const original = String(input ?? '')
    .replace(/\r\n?/g, '\n')
    .normalize('NFC')
    .trim();

  if (!original) return '';

  const candidates = new Set<string>([
    original,
    decodeLatin1ToUtf8(original),
    decodeLatin1ToUtf8(decodeLatin1ToUtf8(original)),
  ]);

  let best = original;
  let bestScore = scoreText(best);

  for (const candidate of candidates) {
    const normalized = candidate.normalize('NFC').trim();
    const candidateScore = scoreText(normalized);

    if (candidateScore > bestScore) {
      best = normalized;
      bestScore = candidateScore;
    }
  }

  return best;
}

export function normalizeUploadedFilename(
  filename: string | null | undefined,
): string {
  const normalized = normalizeUnicodeText(filename);
  return normalized || String(filename ?? '');
}
