/**
 * Import fingerprinting.
 *
 * Answers one question: "have these exact records already been committed?"
 *
 * WHY CONTENT AND NOT FILE NAME
 *
 * Customers reuse names — `usage-export.csv` every Monday. Keying on the name
 * would refuse next week's genuinely new data. Keying on content refuses only
 * an actual repeat.
 *
 * WHY THE MAPPING IS PART OF IT
 *
 * Re-importing the same file with a corrected mapping is a legitimate, useful
 * action: the customer noticed a column was wrong and fixed it. That produces
 * different canonical records, so it must not be treated as a duplicate.
 *
 * WHY THIS MATTERS
 *
 * Two commits of one file double every observation. Demand appears to double,
 * P95 rises with it, and the recommended quantity follows — silently, because
 * each import is individually valid and nothing looks broken.
 */

/** Web Crypto is available in both the Node and Edge runtimes Next.js uses. */
async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const view = new Uint8Array(bytes);
  const digest = await crypto.subtle.digest('SHA-256', view);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Fingerprint the committed content.
 *
 * @param fileBytes raw uploaded bytes, before any parsing
 * @param dataset which canonical dataset it was committed as
 * @param mapping the confirmed sourceColumn → field assignment
 */
export async function fingerprintImport(
  fileBytes: ArrayBuffer,
  dataset: string,
  mapping: Record<string, string>,
): Promise<string> {
  const fileHash = await sha256Hex(new Uint8Array(fileBytes));

  // Sorted so key order in the mapping object cannot change the fingerprint.
  const mappingCanonical = Object.entries(mapping)
    .filter(([, field]) => field.length > 0)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([column, field]) => `${column}=${field}`)
    .join('&');

  const composite = new TextEncoder().encode(`${fileHash}|${dataset}|${mappingCanonical}`);
  return sha256Hex(composite);
}

/** Recognizes the unique-violation raised by the fingerprint index. */
export function isDuplicateImportError(error: { code?: string; message?: string }): boolean {
  if (error.code === '23505') return true;
  const message = (error.message ?? '').toLowerCase();
  return message.includes('imports_content_fingerprint_key');
}
