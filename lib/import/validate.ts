/**
 * Import validation.
 *
 * Rows are checked against the canonical field types before anything is
 * accepted. Rejections are reported with a reason and an example, because
 * "12,402 rows rejected" with no explanation is the fastest way to lose a
 * customer's trust in the numbers that follow.
 */

import { z } from 'zod';
import type { ImportKind } from '@/lib/domain/types';
import { IMPORT_SCHEMAS } from './schema';

export interface ValidationIssue {
  field: string;
  rule: string;
  count: number;
  examples: string[];
}

export interface ValidationResult {
  totalRows: number;
  acceptedRows: number;
  rejectedRows: number;
  issues: ValidationIssue[];
  /** Distinct values seen for key dimensions, useful before committing. */
  distinct: { field: string; count: number; samples: string[] }[];
}

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})/;
const US_DATE = /^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})$/;

/**
 * A guard the value must pass before the permissive Date parser is trusted.
 *
 * This exists because JavaScript's Date parser invents dates from nonsense:
 * `new Date('bad-1')` returns 2001-01-01 and `new Date('bad-7')` returns
 * 2001-07-01. Without this guard, garbage in a date column is silently
 * accepted and the usage lands in the wrong year — which quietly removes it
 * from the analysis window and understates demand with no trace.
 *
 * Requires a four-digit year AND either a month name or a digit-separator-digit
 * sequence.
 */
const LOOKS_LIKE_DATE =
  /(?=.*\b\d{4}\b)(?:.*\d\s*[/\-.]\s*\d|.*\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b)/i;

/** Dates outside this range indicate a parsing accident, not real usage. */
const MIN_YEAR = 1990;
const MAX_YEAR = 2100;

function withinPlausibleRange(iso: string): string | null {
  const year = Number(iso.slice(0, 4));
  if (!Number.isFinite(year) || year < MIN_YEAR || year > MAX_YEAR) return null;
  return iso;
}

/** Parse the date formats that appear in real license-manager exports. */
export function parseDateValue(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null;

  if (raw instanceof Date) {
    if (Number.isNaN(raw.getTime())) return null;
    return withinPlausibleRange(raw.toISOString().slice(0, 10));
  }

  const value = String(raw).trim();
  if (value.length === 0) return null;

  const iso = ISO_DATE.exec(value);
  if (iso !== null) {
    const month = Number(iso[2]);
    const day = Number(iso[3]);
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    return withinPlausibleRange(value.slice(0, 10));
  }

  const us = US_DATE.exec(value);
  if (us !== null) {
    const month = Number(us[1]);
    const day = Number(us[2]);
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    return withinPlausibleRange(
      `${us[3]}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
    );
  }

  if (!LOOKS_LIKE_DATE.test(value)) return null;

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return withinPlausibleRange(parsed.toISOString().slice(0, 10));
}

export function parseNumberValue(raw: unknown): number | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;

  // Strip currency symbols, thousands separators and stray whitespace.
  const cleaned = String(raw).trim().replace(/[$£€,\s]/g, '');
  if (cleaned.length === 0) return null;
  const value = Number(cleaned);
  return Number.isFinite(value) ? value : null;
}

export function parseHourValue(raw: unknown): number | null {
  const value = parseNumberValue(raw);
  if (value === null) return null;
  const hour = Math.trunc(value);
  return hour >= 0 && hour <= 23 ? hour : null;
}

export type SourceRow = Record<string, unknown>;

/**
 * Validate parsed rows against a confirmed mapping.
 *
 * @param mapping sourceColumn → canonical field key
 */
export function validateRows(
  rows: readonly SourceRow[],
  mapping: Record<string, string>,
  kind: ImportKind,
): ValidationResult {
  const schema = IMPORT_SCHEMAS[kind];
  const fieldByKey = new Map(schema.fields.map((field) => [field.key, field]));

  // Invert: canonical field → source column.
  const columnFor = new Map<string, string>();
  for (const [column, field] of Object.entries(mapping)) {
    if (field.length > 0) columnFor.set(field, column);
  }

  const issueMap = new Map<string, ValidationIssue>();
  const addIssue = (field: string, rule: string, example: string) => {
    const key = `${field}:${rule}`;
    const existing = issueMap.get(key);
    if (existing === undefined) {
      issueMap.set(key, { field, rule, count: 1, examples: [example].filter((e) => e.length > 0) });
    } else {
      existing.count += 1;
      if (existing.examples.length < 3 && example.length > 0 && !existing.examples.includes(example)) {
        existing.examples.push(example);
      }
    }
  };

  const distinctValues = new Map<string, Set<string>>();
  const trackDistinct = (field: string, value: string) => {
    if (field !== 'featureCode' && field !== 'username' && field !== 'vendor' && field !== 'product') return;
    let set = distinctValues.get(field);
    if (set === undefined) {
      set = new Set<string>();
      distinctValues.set(field, set);
    }
    if (set.size < 5000) set.add(value);
  };

  let accepted = 0;

  for (const row of rows) {
    let rowValid = true;

    for (const field of schema.fields) {
      const column = columnFor.get(field.key);
      if (column === undefined) {
        if (field.required) {
          addIssue(field.key, 'Required field is not mapped', '');
          rowValid = false;
        }
        continue;
      }

      const raw = row[column];
      const isBlank = raw === null || raw === undefined || String(raw).trim().length === 0;

      if (isBlank) {
        if (field.required) {
          addIssue(field.key, 'Required value is empty', '');
          rowValid = false;
        }
        continue;
      }

      switch (field.type) {
        case 'date': {
          if (parseDateValue(raw) === null) {
            addIssue(field.key, 'Value is not a recognizable date', String(raw).slice(0, 40));
            rowValid = false;
          }
          break;
        }
        case 'number': {
          if (parseNumberValue(raw) === null) {
            addIssue(field.key, 'Value is not numeric', String(raw).slice(0, 40));
            rowValid = false;
          }
          break;
        }
        case 'hour': {
          if (parseHourValue(raw) === null) {
            addIssue(field.key, 'Hour must be a whole number from 0 to 23', String(raw).slice(0, 40));
            rowValid = false;
          }
          break;
        }
        case 'string': {
          trackDistinct(field.key, String(raw).trim());
          break;
        }
      }
    }

    if (rowValid) accepted += 1;
  }

  // A missing required mapping fails every row; report it once, not N times.
  const issues = [...issueMap.values()].sort((a, b) => b.count - a.count);

  return {
    totalRows: rows.length,
    acceptedRows: accepted,
    rejectedRows: rows.length - accepted,
    issues,
    distinct: [...distinctValues.entries()].map(([field, values]) => ({
      field: fieldByKey.get(field)?.label ?? field,
      count: values.size,
      samples: [...values].slice(0, 6),
    })),
  };
}

export const uploadConstraintsSchema = z.object({
  kind: z.enum(['usage', 'employees', 'contracts', 'assignments', 'denials']),
});
