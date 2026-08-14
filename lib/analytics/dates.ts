/**
 * Date utilities for EngiSignal analytics.
 *
 * All arithmetic is UTC-based on ISO `YYYY-MM-DD` strings. The analytics engine
 * never reads the system clock — "today" is always an injected parameter — so
 * that a given dataset produces identical results on every machine and in every
 * timezone, forever. This is what makes recommendations reproducible.
 */

import type { AnalysisWindow, PeriodKey } from '@/lib/domain/types';

const MS_PER_DAY = 86_400_000;

/** Days since the Unix epoch for an ISO date. */
export function toEpochDay(iso: string): number {
  const [y, m, d] = iso.split('-').map(Number);
  return Math.floor(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1) / MS_PER_DAY);
}

/** ISO date for a count of days since the Unix epoch. */
export function fromEpochDay(day: number): string {
  const date = new Date(day * MS_PER_DAY);
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function addDays(iso: string, days: number): string {
  return fromEpochDay(toEpochDay(iso) + days);
}

/** Signed day count from `from` to `to`. Positive when `to` is later. */
export function diffDays(from: string, to: string): number {
  return toEpochDay(to) - toEpochDay(from);
}

/** Every ISO date from `start` to `end`, inclusive. */
export function enumerateDates(start: string, end: string): string[] {
  const out: string[] = [];
  const last = toEpochDay(end);
  for (let d = toEpochDay(start); d <= last; d++) out.push(fromEpochDay(d));
  return out;
}

/** 0 = Sunday … 6 = Saturday. */
export function dayOfWeek(iso: string): number {
  return new Date(toEpochDay(iso) * MS_PER_DAY).getUTCDay();
}

export function isWeekend(iso: string): boolean {
  const dow = dayOfWeek(iso);
  return dow === 0 || dow === 6;
}

export const PERIOD_DAYS: Record<Exclude<PeriodKey, 'custom'>, number> = {
  '3m': 90,
  '6m': 182,
  '12m': 365,
  '24m': 730,
};

export const PERIOD_LABELS: Record<PeriodKey, string> = {
  '3m': '3 months',
  '6m': '6 months',
  '12m': '12 months',
  '24m': '24 months',
  custom: 'Custom period',
};

/**
 * Build an analysis window ending on (and including) `asOf`.
 *
 * `asOf` is always supplied by the caller — see the module note on determinism.
 */
export function buildWindow(asOf: string, key: PeriodKey, customDays?: number): AnalysisWindow {
  const days = key === 'custom' ? Math.max(1, customDays ?? 365) : PERIOD_DAYS[key];
  return {
    start: addDays(asOf, -(days - 1)),
    end: asOf,
    key,
    days,
  };
}

export function isWithinWindow(iso: string, window: AnalysisWindow): boolean {
  return iso >= window.start && iso <= window.end;
}

/** Format an ISO date as e.g. "14 Mar 2026". */
export function formatDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${d} ${months[(m ?? 1) - 1]} ${y}`;
}

/** Format an ISO date as e.g. "Mar 2026". */
export function formatMonth(iso: string): string {
  const [y, m] = iso.split('-').map(Number);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${months[(m ?? 1) - 1]} ${y}`;
}
