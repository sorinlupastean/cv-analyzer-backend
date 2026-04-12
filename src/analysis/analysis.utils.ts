// src/modules/analysis/analysis.utils.ts

import { Recommendation } from './analysis.types';

export function uniqueStrings(values: unknown[], max = 999): string[] {
  const cleaned = values
    .map((v) => String(v ?? '').trim())
    .filter((v) => v.length > 0);

  return Array.from(new Set(cleaned)).slice(0, max);
}

export function clampInt(n: unknown, min: number, max: number): number {
  const value = Number(n);
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, Math.round(value)));
}

export function safeLower(s: unknown): string {
  return String(s ?? '')
    .toLowerCase()
    .trim();
}

export function includesAny(text: string, needles: string[]): boolean {
  const t = safeLower(text);
  return needles.some((n) => t.includes(safeLower(n)));
}

export function daysBetween(dateIso: string, now = new Date()): number {
  const d = new Date(dateIso);
  if (Number.isNaN(d.getTime())) return 99999;
  const diff = now.getTime() - d.getTime();
  return Math.floor(diff / (1000 * 60 * 60 * 24));
}

export function normalizeRecommendation(rec: unknown): Recommendation {
  const x = String(rec ?? '')
    .toUpperCase()
    .trim();
  if (x === 'INVITA' || x === 'REVIZUIRE' || x === 'RESPINGE') return x;
  return 'REVIZUIRE';
}

export function scoreToRecommendation(score: number): Recommendation {
  if (score >= 75) return 'INVITA';
  if (score >= 45) return 'REVIZUIRE';
  return 'RESPINGE';
}

export function mergeUnique(...arrays: string[][]): string[] {
  return uniqueStrings(arrays.flat(), 999);
}

export function truncate(s: string, max: number): string {
  const x = String(s ?? '').trim();
  return x.length <= max ? x : x.slice(0, max);
}
