/**
 * Value coercion.
 *
 * Every parser here fails closed: an input it cannot interpret returns null and
 * the row is rejected with a reason, rather than being coerced into something
 * plausible. Silent coercion is how usage lands in the wrong year and quietly
 * disappears from an analysis window.
 */

import type { LicenseModel } from './canonical/types';

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})/;
const US_DATE = /^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})$/;
const DMY_DATE = /^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})$/;

/**
 * Guard before trusting the permissive Date parser.
 *
 * JavaScript invents dates from nonsense: `new Date('bad-1')` yields
 * 2001-01-01. Requires a four-digit year plus either a month name or a
 * digit-separator-digit sequence.
 */
const LOOKS_LIKE_DATE =
  /(?=.*\b\d{4}\b)(?:.*\d\s*[/\-.]\s*\d|.*\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b)/i;

const MIN_YEAR = 1990;
const MAX_YEAR = 2100;

function withinRange(iso: string): string | null {
  const year = Number(iso.slice(0, 4));
  if (!Number.isFinite(year) || year < MIN_YEAR || year > MAX_YEAR) return null;
  return iso;
}

/**
 * Parse a date to an ISO calendar date.
 *
 * @param dayFirst interpret ambiguous numeric dates as DD/MM/YYYY. European
 *   exports are common and 03/04/2026 is genuinely ambiguous, so the caller
 *   decides rather than this function guessing.
 */
export function parseDate(raw: unknown, { dayFirst = false }: { dayFirst?: boolean } = {}): string | null {
  if (raw === null || raw === undefined) return null;

  if (raw instanceof Date) {
    if (Number.isNaN(raw.getTime())) return null;
    return withinRange(toIsoDate(raw));
  }

  const value = String(raw).trim();
  if (value.length === 0) return null;

  const iso = ISO_DATE.exec(value);
  if (iso !== null) {
    const month = Number(iso[2]);
    const day = Number(iso[3]);
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    return withinRange(value.slice(0, 10));
  }

  const numeric = (dayFirst ? DMY_DATE : US_DATE).exec(value);
  if (numeric !== null) {
    const first = Number(numeric[1]);
    const second = Number(numeric[2]);
    const month = dayFirst ? second : first;
    const day = dayFirst ? first : second;
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    return withinRange(
      `${numeric[3]}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
    );
  }

  if (!LOOKS_LIKE_DATE.test(value)) return null;

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return withinRange(toIsoDate(parsed));
}

/** Date portion in UTC, avoiding a local-timezone shift across midnight. */
function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Parse a full timestamp, preserving the time component when present. */
export function parseTimestamp(raw: unknown, options: { dayFirst?: boolean } = {}): string | null {
  if (raw === null || raw === undefined) return null;

  if (raw instanceof Date) {
    if (Number.isNaN(raw.getTime())) return null;
    return withinRange(toIsoDate(raw)) === null ? null : raw.toISOString();
  }

  const value = String(raw).trim();
  if (value.length === 0) return null;

  // Only trust the full parser once the date half has been validated.
  const datePart = parseDate(value, options);
  if (datePart === null) return null;

  const withTime = /\d{1,2}:\d{2}/.test(value);
  if (!withTime) return `${datePart}T00:00:00.000Z`;

  const time = /(\d{1,2}):(\d{2})(?::(\d{2}))?/.exec(value);
  if (time === null) return `${datePart}T00:00:00.000Z`;

  const hour = Number(time[1]);
  const minute = Number(time[2]);
  const second = Number(time[3] ?? '0');
  if (hour > 23 || minute > 59 || second > 59) return `${datePart}T00:00:00.000Z`;

  // Built from the parsed parts rather than handed to `new Date()`. A naive
  // timestamp such as "2026-03-02 08:04:11" carries no zone, and letting the
  // runtime apply the server's local offset would shift every observation by
  // hours — silently moving demand into the wrong hour bucket, and across
  // midnight into the wrong day.
  const pad = (unit: number) => String(unit).padStart(2, '0');
  const naive = `${datePart}T${pad(hour)}:${pad(minute)}:${pad(second)}.000Z`;

  // An explicit zone in the source is authoritative, so honour it.
  if (/(?:Z|[+-]\d{2}:?\d{2})$/.test(value)) {
    const zoned = new Date(value.includes('T') ? value : value.replace(' ', 'T'));
    if (!Number.isNaN(zoned.getTime())) return zoned.toISOString();
  }

  return naive;
}

export function parseNumber(raw: unknown): number | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
  if (typeof raw === 'boolean') return null;

  const cleaned = String(raw).trim().replace(/[$£€,\s]/g, '');
  if (cleaned.length === 0) return null;
  const value = Number(cleaned);
  return Number.isFinite(value) ? value : null;
}

export function parseHour(raw: unknown): number | null {
  if (raw === null || raw === undefined) return null;

  // "14:00" and "14:00:00" are hour columns in several exports.
  const text = String(raw).trim();
  const clock = /^(\d{1,2}):(\d{2})/.exec(text);
  if (clock !== null) {
    const hour = Number(clock[1]);
    return hour >= 0 && hour <= 23 ? hour : null;
  }

  const value = parseNumber(raw);
  if (value === null) return null;
  if (!Number.isInteger(value)) return null;
  return value >= 0 && value <= 23 ? value : null;
}

const TRUTHY = ['true', 'yes', 'y', '1', 'denied', 'denial', 'rejected', 'refused', 'fail', 'failed'];
const FALSY = ['false', 'no', 'n', '0', 'granted', 'ok', 'success', 'issued', 'allowed'];

export function parseBoolean(raw: unknown): boolean | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === 'boolean') return raw;

  const value = String(raw).trim().toLowerCase();
  if (value.length === 0) return null;
  if (TRUTHY.includes(value)) return true;
  if (FALSY.includes(value)) return false;
  return null;
}

export function parseText(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null;
  const value = String(raw).trim();
  return value.length === 0 ? null : value;
}

/** Generic license-model interpretation; adapters may override. */
export function parseLicenseModel(raw: unknown): LicenseModel {
  const value = parseText(raw)?.toLowerCase();
  if (value === undefined || value === null) return 'unknown';
  if (value.includes('token') || value.includes('credit')) return 'token';
  if (value.includes('node') && value.includes('lock')) return 'node_locked';
  if (value.includes('named') || value.includes('user-based') || value.includes('per user')) {
    return 'named_user';
  }
  if (value.includes('concurrent') || value.includes('floating') || value.includes('network')) {
    return 'concurrent';
  }
  return 'unknown';
}
