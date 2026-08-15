/**
 * Field-mapping suggestion.
 *
 * Scores each source column against each canonical field and proposes the best
 * assignment. Suggestions are always shown for confirmation and never applied
 * silently — a wrong mapping produces wrong purchasing recommendations, so the
 * human stays in the loop.
 */

import type { ImportKind } from '@/lib/domain/types';
import { IMPORT_SCHEMAS, type CanonicalField } from './schema';

/** Normalize a header for comparison: lower-case, strip punctuation. */
export function normalizeHeader(header: string): string {
  return header
    .toLowerCase()
    .replace(/[\s\-.]+/g, '_')
    .replace(/[^a-z0-9_]/g, '')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
}

export interface MappingSuggestion {
  sourceColumn: string;
  field: string | null;
  confidence: 'exact' | 'strong' | 'possible' | 'none';
  score: number;
}

/**
 * Score one header against one canonical field.
 * 100 = exact synonym or key match; 0 = unrelated.
 */
export function scoreHeader(header: string, field: CanonicalField): number {
  const normalized = normalizeHeader(header);
  if (normalized.length === 0) return 0;

  if (normalized === normalizeHeader(field.key)) return 100;

  for (const synonym of field.synonyms) {
    const normalizedSynonym = normalizeHeader(synonym);
    if (normalized === normalizedSynonym) return 100;
  }

  // Whole-token containment, e.g. "max_concurrent_licenses" contains
  // "max_concurrent". Longer matches score higher so the most specific
  // synonym wins.
  let best = 0;
  for (const synonym of field.synonyms) {
    const normalizedSynonym = normalizeHeader(synonym);
    if (normalizedSynonym.length < 3) continue;
    if (normalized.includes(normalizedSynonym)) {
      best = Math.max(best, 60 + Math.min(25, normalizedSynonym.length * 2));
    } else if (normalizedSynonym.includes(normalized) && normalized.length >= 4) {
      best = Math.max(best, 55);
    }
  }

  if (best === 0) {
    // Token overlap as a last resort.
    const headerTokens = new Set(normalized.split('_').filter((t) => t.length >= 3));
    for (const synonym of field.synonyms) {
      const synonymTokens = normalizeHeader(synonym).split('_').filter((t) => t.length >= 3);
      const overlap = synonymTokens.filter((token) => headerTokens.has(token)).length;
      if (overlap > 0 && synonymTokens.length > 0) {
        best = Math.max(best, 30 + (overlap / synonymTokens.length) * 15);
      }
    }
  }

  return best;
}

function confidenceFor(score: number): MappingSuggestion['confidence'] {
  if (score >= 100) return 'exact';
  if (score >= 70) return 'strong';
  if (score >= 35) return 'possible';
  return 'none';
}

/**
 * Propose a mapping for every source column.
 *
 * Assignment is greedy on score, and each canonical field is used at most once —
 * two columns cannot both map to "User", because that would silently discard one.
 */
export function suggestMapping(headers: readonly string[], kind: ImportKind): MappingSuggestion[] {
  const fields = IMPORT_SCHEMAS[kind].fields;

  const candidates: { header: string; field: string; score: number }[] = [];
  for (const header of headers) {
    for (const field of fields) {
      const score = scoreHeader(header, field);
      if (score > 0) candidates.push({ header, field: field.key, score });
    }
  }

  candidates.sort((a, b) => b.score - a.score || a.header.localeCompare(b.header));

  const assignedField = new Set<string>();
  const assignedHeader = new Map<string, { field: string; score: number }>();

  for (const candidate of candidates) {
    if (candidate.score < 35) continue;
    if (assignedField.has(candidate.field)) continue;
    if (assignedHeader.has(candidate.header)) continue;
    assignedField.add(candidate.field);
    assignedHeader.set(candidate.header, { field: candidate.field, score: candidate.score });
  }

  return headers.map((header) => {
    const assignment = assignedHeader.get(header);
    return {
      sourceColumn: header,
      field: assignment?.field ?? null,
      confidence: confidenceFor(assignment?.score ?? 0),
      score: Math.round(assignment?.score ?? 0),
    };
  });
}

/** Canonical fields still unmapped, split by whether they are required. */
export function missingFields(
  mapping: Record<string, string>,
  kind: ImportKind,
): { required: CanonicalField[]; optional: CanonicalField[] } {
  const mapped = new Set(Object.values(mapping).filter((value) => value.length > 0));
  const fields = IMPORT_SCHEMAS[kind].fields.filter((field) => !mapped.has(field.key));
  return {
    required: fields.filter((field) => field.required),
    optional: fields.filter((field) => !field.required),
  };
}

/** Turn a suggestion list into the persisted `sourceColumn → field` shape. */
export function toMappingRecord(suggestions: readonly MappingSuggestion[]): Record<string, string> {
  const record: Record<string, string> = {};
  for (const suggestion of suggestions) {
    if (suggestion.field !== null) record[suggestion.sourceColumn] = suggestion.field;
  }
  return record;
}
