/**
 * Header normalization for the identity-resolution screens.
 *
 * SCOPE NOTE — this file used to contain a second field-mapping engine. File
 * ingestion now has exactly one implementation, in lib/ingestion/*, and the
 * duplicate was removed rather than left to drift: two mapping engines mean two
 * different answers to "which column is the user", and only one of them would
 * be the one that produced the numbers in a renewal briefing.
 *
 * What remains is the header comparison used by the unmatched-users screen.
 */

/** Normalize a header for comparison: lower-case, strip punctuation. */
export function normalizeHeader(header: string): string {
  return header
    .toLowerCase()
    .replace(/[\s\-.]+/g, '_')
    .replace(/[^a-z0-9_]/g, '')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
}
