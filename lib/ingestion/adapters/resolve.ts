/**
 * Column resolution.
 *
 * Turns "whatever columns this file has" into "which canonical field each one
 * feeds", with a confidence and a sample value for every decision. The output
 * is designed to be shown to a human before anything is committed: a silent
 * wrong mapping produces a wrong purchasing recommendation, which is the most
 * expensive failure this product can have.
 *
 * Matching is deliberately not exact-string only. Real exports carry
 * `FEATURE_NAME`, `Feature Name`, `feature-name`, `LIC_FEATURE` and
 * `primary_feature_name` for the same concept.
 */

import type { CanonicalDataset } from '../canonical/types';
import { BASE_ALIASES, FIELDS_BY_DATASET } from './fields';
import type { AliasTable, CanonicalFieldKey, IngestionAdapter } from './types';

/** Lower-case, collapse punctuation to underscores, drop the rest. */
export function normalizeHeader(header: string): string {
  return header
    .toLowerCase()
    .replace(/[\s\-./\\]+/g, '_')
    .replace(/[^a-z0-9_]/g, '')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
}

export type MappingConfidence = 'exact' | 'strong' | 'possible' | 'none';

export interface ColumnMapping {
  sourceColumn: string;
  field: CanonicalFieldKey | null;
  confidence: MappingConfidence;
  score: number;
  /** First non-empty value in the column, for the review table. */
  sampleValue: string | null;
  /** Which alias produced the match, so a reviewer can see the reasoning. */
  matchedAlias: string | null;
}

const EXACT = 100;
const MIN_ASSIGNABLE = 35;

/**
 * Words that carry no discriminating meaning on their own.
 *
 * Used only by the token-overlap fallback. Exact and containment matching are
 * unaffected, so `license_feature` still matches `feature` and `usage_hours`
 * still matches `hours`.
 */
const STRUCTURAL_TOKENS = new Set([
  'license',
  'licenses',
  'lic',
  'name',
  'code',
  'value',
  'data',
  'info',
  'type',
  'key',
  'num',
  'number',
]);

function meaningfulTokens(normalized: string): string[] {
  return normalized
    .split('_')
    .filter((token) => token.length >= 3 && !STRUCTURAL_TOKENS.has(token));
}

/**
 * Score one header against one field's aliases.
 *
 * Exact alias or key match wins outright. Otherwise the longest whole-token
 * containment wins, so `max_concurrent_licenses` prefers `max_concurrent` over
 * the shorter, vaguer `max`.
 */
export function scoreHeader(
  header: string,
  field: CanonicalFieldKey,
  aliases: readonly string[],
): { score: number; alias: string | null } {
  const normalized = normalizeHeader(header);
  if (normalized.length === 0) return { score: 0, alias: null };

  if (normalized === normalizeHeader(field)) return { score: EXACT, alias: field };

  for (const alias of aliases) {
    if (normalized === normalizeHeader(alias)) return { score: EXACT, alias };
  }

  let best = 0;
  let bestAlias: string | null = null;

  for (const alias of aliases) {
    const normalizedAlias = normalizeHeader(alias);
    if (normalizedAlias.length < 3) continue;

    if (normalized.includes(normalizedAlias)) {
      // Longer alias matches are more specific, so they score higher.
      const score = 60 + Math.min(25, normalizedAlias.length * 2);
      if (score > best) {
        best = score;
        bestAlias = alias;
      }
    } else if (normalizedAlias.includes(normalized) && normalized.length >= 4) {
      if (best < 55) {
        best = 55;
        bestAlias = alias;
      }
    }
  }

  if (best === 0) {
    // Token overlap, last resort: "user_login_name" ↔ "login_name".
    //
    // Structural words are excluded. They appear in most field vocabularies, so
    // an overlap consisting only of them carries no meaning: without this,
    // "license_type" matched "license_hours" on the word "license" alone and a
    // license-model column was mapped to session duration, which rejected every
    // row in the file as non-numeric.
    const headerTokens = new Set(meaningfulTokens(normalized));
    for (const alias of aliases) {
      const aliasTokens = meaningfulTokens(normalizeHeader(alias));
      if (aliasTokens.length === 0) continue;
      const overlap = aliasTokens.filter((token) => headerTokens.has(token)).length;
      if (overlap > 0) {
        const score = 30 + (overlap / aliasTokens.length) * 15;
        if (score > best) {
          best = score;
          bestAlias = alias;
        }
      }
    }
  }

  return { score: best, alias: bestAlias };
}

function confidenceFor(score: number): MappingConfidence {
  if (score >= EXACT) return 'exact';
  if (score >= 70) return 'strong';
  if (score >= MIN_ASSIGNABLE) return 'possible';
  return 'none';
}

/** Adapter aliases layered over the shared base table. */
export function aliasesFor(adapter: IngestionAdapter, dataset: CanonicalDataset): AliasTable {
  const base = BASE_ALIASES[dataset];
  const specific = adapter.aliases[dataset] ?? {};
  const merged: AliasTable = {};

  const keys = new Set<CanonicalFieldKey>([
    ...(Object.keys(base) as CanonicalFieldKey[]),
    ...(Object.keys(specific) as CanonicalFieldKey[]),
  ]);

  for (const key of keys) {
    // Adapter aliases first: a source-specific spelling should win ties.
    merged[key] = [...(specific[key] ?? []), ...(base[key] ?? [])];
  }

  return merged;
}

/**
 * Resolve every source column to at most one canonical field.
 *
 * Assignment is greedy on score and one-to-one in both directions: two columns
 * cannot both feed `user`, because one of them would be discarded without the
 * customer ever being told.
 */
export function resolveColumns({
  headers,
  adapter,
  dataset,
  rows,
  overrides,
}: {
  headers: readonly string[];
  adapter: IngestionAdapter;
  dataset: CanonicalDataset;
  rows?: readonly Record<string, unknown>[];
  /** sourceColumn → canonical field, or '' to explicitly unmap. */
  overrides?: Record<string, string>;
}): ColumnMapping[] {
  const aliases = aliasesFor(adapter, dataset);
  const fields = FIELDS_BY_DATASET[dataset].map((spec) => spec.key);

  const candidates: { header: string; field: CanonicalFieldKey; score: number; alias: string | null }[] = [];
  for (const header of headers) {
    for (const field of fields) {
      const { score, alias } = scoreHeader(header, field, aliases[field] ?? []);
      if (score > 0) candidates.push({ header, field, score, alias });
    }
  }

  candidates.sort((a, b) => b.score - a.score || a.header.localeCompare(b.header));

  const takenField = new Set<CanonicalFieldKey>();
  const takenHeader = new Map<
    string,
    { field: CanonicalFieldKey | null; score: number; alias: string | null }
  >();

  // Explicit overrides are honoured before anything is inferred. An empty
  // string means the reviewer deliberately unmapped the column, which must
  // stick rather than being re-inferred on the next pass.
  if (overrides !== undefined) {
    for (const [header, field] of Object.entries(overrides)) {
      if (!headers.includes(header)) continue;
      if (field.length === 0) {
        takenHeader.set(header, { field: null, score: 0, alias: null });
        continue;
      }
      if (!fields.includes(field as CanonicalFieldKey)) continue;
      takenField.add(field as CanonicalFieldKey);
      takenHeader.set(header, { field: field as CanonicalFieldKey, score: EXACT, alias: 'manual' });
    }
  }

  for (const candidate of candidates) {
    if (candidate.score < MIN_ASSIGNABLE) continue;
    if (takenField.has(candidate.field)) continue;
    if (takenHeader.has(candidate.header)) continue;
    takenField.add(candidate.field);
    takenHeader.set(candidate.header, {
      field: candidate.field,
      score: candidate.score,
      alias: candidate.alias,
    });
  }

  const sampleFor = (header: string): string | null => {
    if (rows === undefined) return null;
    for (const row of rows.slice(0, 50)) {
      const value = row[header];
      if (value === null || value === undefined) continue;
      const text = String(value).trim();
      if (text.length > 0) return text.slice(0, 60);
    }
    return null;
  };

  return headers.map((header) => {
    const assignment = takenHeader.get(header);
    const field = assignment?.field ?? null;
    const isManual = assignment?.alias === 'manual';
    return {
      sourceColumn: header,
      field,
      confidence: field === null ? 'none' : isManual ? 'exact' : confidenceFor(assignment?.score ?? 0),
      score: Math.round(assignment?.score ?? 0),
      sampleValue: sampleFor(header),
      matchedAlias: assignment?.alias ?? null,
    };
  });
}

/** Canonical field → source column, for the normalization step. */
export function toFieldIndex(mappings: readonly ColumnMapping[]): Map<CanonicalFieldKey, string> {
  const index = new Map<CanonicalFieldKey, string>();
  for (const mapping of mappings) {
    if (mapping.field !== null && !index.has(mapping.field)) {
      index.set(mapping.field, mapping.sourceColumn);
    }
  }
  return index;
}

/** Required canonical fields that no column feeds. */
export function missingRequiredFields(
  mappings: readonly ColumnMapping[],
  dataset: CanonicalDataset,
): string[] {
  const mapped = new Set(mappings.map((mapping) => mapping.field).filter((field) => field !== null));
  return FIELDS_BY_DATASET[dataset]
    .filter((spec) => spec.required && !mapped.has(spec.key))
    .map((spec) => spec.label);
}
