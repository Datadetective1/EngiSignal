import { beforeEach, describe, expect, it } from 'vitest';
import { fingerprintImport } from '@/lib/ingestion/fingerprint';
import { __resetMemoryStore, memoryIngestionStore as store } from '@/lib/ingestion/store/memory-store';
import { DuplicateImportError } from '@/lib/ingestion/store/types';
import { ingestParsedFile } from '@/lib/ingestion';
import { parseDelimited } from '@/lib/ingestion/parse';

/**
 * Idempotency.
 *
 * Two commits of one file double every observation. Demand appears to double,
 * P95 rises with it, and the recommended quantity follows — silently, because
 * both imports are individually valid and nothing looks broken.
 */

const CSV = [
  'DATE,TIME,FEATURE,VENDOR_DAEMON,USER,SERVER_HOST,LICENSES_ISSUED,LICENSES_IN_USE',
  '2026-03-02,09:00,MECH_ENT,ansyslmd,jh,lic-01,400,214',
  '2026-03-03,09:00,MECH_ENT,ansyslmd,rk,lic-01,400,238',
].join('\n');

function bytesOf(text: string): ArrayBuffer {
  const encoded = new TextEncoder().encode(text);
  return encoded.buffer.slice(encoded.byteOffset, encoded.byteOffset + encoded.byteLength) as ArrayBuffer;
}

async function commit(text: string, importId: string, mappingTweak?: Record<string, string>) {
  const parsed = parseDelimited(text);
  const analysis = ingestParsedFile(parsed, {
    dataset: 'usage',
    organizationId: 'org-alpha',
    importId,
    fileName: 'usage-export.csv',
  });

  const mappingUsed: Record<string, string> = { ...mappingTweak };
  for (const mapping of analysis.mappings) {
    if (mapping.field !== null && mappingUsed[mapping.sourceColumn] === undefined) {
      mappingUsed[mapping.sourceColumn] = mapping.field;
    }
  }

  return store.commitImport({
    organizationId: 'org-alpha',
    importId,
    fileName: 'usage-export.csv',
    fileBytes: text.length,
    dataset: 'usage',
    detectionEvidence: [],
    detectionConfidence: 99,
    detectionFellBack: false,
    sourceSheets: [],
    mappingUsed,
    result: analysis.result,
    contentFingerprint: await fingerprintImport(bytesOf(text), 'usage', mappingUsed),
  });
}

beforeEach(() => {
  __resetMemoryStore();
});

describe('fingerprint', () => {
  it('is stable for identical content, dataset and mapping', async () => {
    const a = await fingerprintImport(bytesOf(CSV), 'usage', { DATE: 'date', FEATURE: 'feature' });
    const b = await fingerprintImport(bytesOf(CSV), 'usage', { FEATURE: 'feature', DATE: 'date' });
    // Key order must not matter.
    expect(a).toBe(b);
  });

  it('changes when the content changes', async () => {
    const a = await fingerprintImport(bytesOf(CSV), 'usage', {});
    const b = await fingerprintImport(bytesOf(`${CSV}\n2026-03-04,09:00,MECH_ENT,ansyslmd,zz,lic-01,400,240`), 'usage', {});
    expect(a).not.toBe(b);
  });

  it('changes when the mapping changes', async () => {
    // Re-importing the same file with a corrected mapping is legitimate and
    // must not be mistaken for a duplicate.
    const a = await fingerprintImport(bytesOf(CSV), 'usage', { HOST: '' });
    const b = await fingerprintImport(bytesOf(CSV), 'usage', { HOST: 'licenseServer' });
    expect(a).not.toBe(b);
  });

  it('changes when the dataset changes', async () => {
    const a = await fingerprintImport(bytesOf(CSV), 'usage', {});
    const b = await fingerprintImport(bytesOf(CSV), 'entitlements', {});
    expect(a).not.toBe(b);
  });
});

describe('duplicate protection', () => {
  it('refuses a second commit of the same file and mapping', async () => {
    await commit(CSV, 'import-1');
    await expect(commit(CSV, 'import-2')).rejects.toBeInstanceOf(DuplicateImportError);
  });

  it('does not double-count when a duplicate is attempted', async () => {
    await commit(CSV, 'import-1');
    await commit(CSV, 'import-2').catch(() => undefined);

    // Still exactly one import and one set of observations.
    expect(await store.listImports('org-alpha')).toHaveLength(1);
    expect(await store.listUsage('org-alpha')).toHaveLength(2);
  });

  it('names the import that already holds the content', async () => {
    await commit(CSV, 'import-1');
    try {
      await commit(CSV, 'import-2');
      throw new Error('expected a duplicate error');
    } catch (error) {
      expect(error).toBeInstanceOf(DuplicateImportError);
      expect((error as DuplicateImportError).existingImportId).toBe('import-1');
    }
  });

  it('allows the same file under a corrected mapping', async () => {
    await commit(CSV, 'import-1');
    // A reviewer fixed a column; the records differ, so this is a new import.
    const second = await commit(CSV, 'import-2', { USER: 'employeeCode' });
    expect(second.id).toBe('import-2');
    expect(await store.listImports('org-alpha')).toHaveLength(2);
  });

  it('allows genuinely new data with the same file name', async () => {
    await commit(CSV, 'import-1');
    const nextWeek = `${CSV}\n2026-03-04,09:00,MECH_ENT,ansyslmd,zz,lic-01,400,251`;
    const second = await commit(nextWeek, 'import-2');
    expect(second.id).toBe('import-2');
    expect(await store.listUsage('org-alpha')).toHaveLength(5);
  });

  it('still treats a re-commit of the same import id as a retry, not a duplicate', async () => {
    await commit(CSV, 'import-1');
    await commit(CSV, 'import-1');
    expect(await store.listImports('org-alpha')).toHaveLength(1);
    expect(await store.listUsage('org-alpha')).toHaveLength(2);
  });

  it('does not block another tenant importing the same file', async () => {
    await commit(CSV, 'import-1');

    const parsed = parseDelimited(CSV);
    const analysis = ingestParsedFile(parsed, {
      dataset: 'usage',
      organizationId: 'org-beta',
      importId: 'b-1',
      fileName: 'usage-export.csv',
    });
    const mappingUsed: Record<string, string> = {};
    for (const mapping of analysis.mappings) {
      if (mapping.field !== null) mappingUsed[mapping.sourceColumn] = mapping.field;
    }

    const beta = await store.commitImport({
      organizationId: 'org-beta',
      importId: 'b-1',
      fileName: 'usage-export.csv',
      fileBytes: CSV.length,
      dataset: 'usage',
      detectionEvidence: [],
      detectionConfidence: 99,
      detectionFellBack: false,
      sourceSheets: [],
      mappingUsed,
      result: analysis.result,
      contentFingerprint: await fingerprintImport(bytesOf(CSV), 'usage', mappingUsed),
    });

    expect(beta.id).toBe('b-1');
    expect(await store.listUsage('org-beta')).toHaveLength(2);
    expect(await store.listUsage('org-alpha')).toHaveLength(2);
  });
});
