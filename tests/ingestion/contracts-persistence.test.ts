import { readFileSync } from 'node:fs';
import path from 'node:path';
import ExcelJS from 'exceljs';
import { beforeEach, describe, expect, it } from 'vitest';
import { ingestFile, ingestParsedFile } from '@/lib/ingestion';
import { parseDelimited, parseIngestionFile } from '@/lib/ingestion/parse';
import { __resetMemoryStore, memoryIngestionStore as store } from '@/lib/ingestion/store/memory-store';
import { fingerprintImport } from '@/lib/ingestion/fingerprint';
import { DuplicateImportError } from '@/lib/ingestion/store/types';

const FIXTURES = path.resolve(__dirname, '../fixtures/ingestion');

const ORG_A = 'org-alpha';
const ORG_B = 'org-beta';

function analyze(fileName: string, organizationId: string, importId: string) {
  const text = readFileSync(path.join(FIXTURES, fileName), 'utf8');
  const parsed = parseDelimited(text);
  return ingestParsedFile(parsed, {
    dataset: 'contracts',
    organizationId,
    importId,
    fileName,
    importedAt: '2026-08-15T00:00:00.000Z',
  });
}

async function commit(fileName: string, organizationId: string, importId: string) {
  const analysis = analyze(fileName, organizationId, importId);
  const mappingUsed: Record<string, string> = {};
  for (const mapping of analysis.mappings) {
    if (mapping.field !== null) mappingUsed[mapping.sourceColumn] = mapping.field;
  }

  return store.commitImport({
    organizationId,
    importId,
    fileName,
    fileBytes: 4096,
    dataset: 'contracts',
    detectionEvidence: analysis.detection.evidence,
    sourceSheets: analysis.sheetNames,
    mappingUsed,
    result: analysis.result,
    detectionConfidence: analysis.detection.confidence,
    detectionFellBack: analysis.detection.fellBack,
    contentFingerprint: `fp-${organizationId}-${importId}`,
  });
}

beforeEach(() => {
  __resetMemoryStore();
});

describe('commercial persistence', () => {
  it('stores commercial lines and reads them back', async () => {
    const summary = await commit('contracts-messy.csv', ORG_A, 'import-c1');
    expect(summary.contractRecords).toBeGreaterThan(0);

    const stored = await store.listContracts(ORG_A);
    expect(stored).toHaveLength(summary.contractRecords);
    expect(stored.every((record) => record.provenance.organizationId === ORG_A)).toBe(true);
  });

  it('keeps every line traceable to its spreadsheet row', async () => {
    await commit('contracts-messy.csv', ORG_A, 'import-c1');
    const stored = await store.listContracts(ORG_A);

    for (const record of stored) {
      // Row 1 is the header, so a data row is never below 2.
      expect(record.provenance.sourceRow).toBeGreaterThanOrEqual(2);
      expect(record.provenance.sourceFile).toBe('contracts-messy.csv');
      expect(record.provenance.importId).toBe('import-c1');
    }
  });

  it('stores the derivation alongside the figure it produced', async () => {
    await commit('contracts-messy.csv', ORG_A, 'import-c1');
    const stored = await store.listContracts(ORG_A);

    const stated = stored.find((r) => r.feature === 'ansys_mech_ent')!;
    expect(stated.unitPriceBasis).toBe('supplied_unit_price');

    const derived = stored.find((r) => r.feature === 'catia_v5')!;
    expect(derived.unitPrice).toBe(12_000);
    expect(derived.unitPriceBasis).toBe('total_over_quantity');
  });

  it('removes only the lines the deleted import created', async () => {
    await commit('contracts-messy.csv', ORG_A, 'import-c1');
    await commit('contracts-renewal-only.tsv', ORG_A, 'import-c2');

    const before = await store.listContracts(ORG_A);
    const fromSecond = before.filter((r) => r.provenance.importId === 'import-c2').length;
    expect(fromSecond).toBe(3);

    expect(await store.deleteImport(ORG_A, 'import-c2')).toBe(true);

    const after = await store.listContracts(ORG_A);
    expect(after).toHaveLength(before.length - fromSecond);
    expect(after.every((r) => r.provenance.importId === 'import-c1')).toBe(true);
  });

  it('counts commercial coverage without inventing prices', async () => {
    await commit('contracts-renewal-only.tsv', ORG_A, 'import-c2');
    const coverage = await store.getCoverage(ORG_A);

    expect(coverage.contractRecords).toBe(3);
    expect(coverage.datedContractRecords).toBe(3);
    // A renewal schedule with no money in it prices nothing.
    expect(coverage.pricedContractRecords).toBe(0);
    expect(coverage.currencies).toEqual([]);
  });

  it('refuses a second import of identical content', async () => {
    await commit('contracts-messy.csv', ORG_A, 'import-c1');

    const analysis = analyze('contracts-messy.csv', ORG_A, 'import-c3');
    await expect(
      store.commitImport({
        organizationId: ORG_A,
        importId: 'import-c3',
        fileName: 'contracts-messy.csv',
        fileBytes: 4096,
        dataset: 'contracts',
        detectionEvidence: [],
        sourceSheets: [],
        mappingUsed: {},
        result: analysis.result,
        detectionConfidence: 0,
        detectionFellBack: true,
        contentFingerprint: `fp-${ORG_A}-import-c1`,
      }),
    ).rejects.toBeInstanceOf(DuplicateImportError);
  });

  it('fingerprints content rather than filename', async () => {
    const bytes = readFileSync(path.join(FIXTURES, 'contracts-messy.csv'));
    const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;

    const a = await fingerprintImport(buffer, 'contracts', { Publisher: 'vendor' });
    const b = await fingerprintImport(buffer, 'contracts', { Publisher: 'vendor' });
    const corrected = await fingerprintImport(buffer, 'contracts', { Publisher: 'supplier' });

    expect(a).toBe(b);
    // A corrected mapping is a legitimately different import, not a duplicate.
    expect(corrected).not.toBe(a);
  });
});

describe('commercial tenant isolation', () => {
  it('does not leak commercial lines across tenants', async () => {
    await commit('contracts-messy.csv', ORG_A, 'import-a');
    await commit('contracts-renewal-only.tsv', ORG_B, 'import-b');

    const alpha = await store.listContracts(ORG_A);
    const beta = await store.listContracts(ORG_B);

    expect(alpha.every((r) => r.provenance.organizationId === ORG_A)).toBe(true);
    expect(beta.every((r) => r.provenance.organizationId === ORG_B)).toBe(true);
    expect(beta).toHaveLength(3);
    // Money is exactly the thing a competitor would want to see.
    expect(alpha.some((r) => r.provenance.importId === 'import-b')).toBe(false);
  });

  it('cannot delete another tenantized import', async () => {
    await commit('contracts-messy.csv', ORG_A, 'import-a');

    expect(await store.deleteImport(ORG_B, 'import-a')).toBe(false);
    expect(await store.listContracts(ORG_A)).not.toHaveLength(0);
  });

  it('cannot read another tenant import by id', async () => {
    await commit('contracts-messy.csv', ORG_A, 'import-a');
    expect(await store.getImport(ORG_B, 'import-a')).toBeNull();
  });

  it('refuses records stamped with a different organization', async () => {
    const analysis = analyze('contracts-messy.csv', ORG_A, 'import-a');

    await expect(
      store.commitImport({
        organizationId: ORG_B,
        importId: 'import-cross',
        fileName: 'contracts-messy.csv',
        fileBytes: 4096,
        dataset: 'contracts',
        detectionEvidence: [],
        sourceSheets: [],
        mappingUsed: {},
        // Provenance names ORG_A while the commit claims ORG_B. A mismatch is a
        // bug, not a routing hint, so it is refused rather than rewritten.
        result: analysis.result,
        detectionConfidence: 0,
        detectionFellBack: true,
      }),
    ).rejects.toThrow(/another organization/i);
  });
});

describe('commercial workbook parsing', () => {
  async function workbook(sheets: { name: string; rows: unknown[][] }[]): Promise<ArrayBuffer> {
    const wb = new ExcelJS.Workbook();
    for (const sheet of sheets) {
      const ws = wb.addWorksheet(sheet.name);
      for (const row of sheet.rows) ws.addRow(row);
    }
    return (await wb.xlsx.writeBuffer()) as ArrayBuffer;
  }

  const header = ['Publisher', 'SKU Description', 'Qty', 'Unit Price', 'Currency', 'Renewal Date'];

  it('reads commercial lines from every sheet of a workbook', async () => {
    const buffer = await workbook([
      { name: 'FY26', rows: [header, ['Ansys', 'ansys_mech_ent', 400, 5000, 'USD', '2026-11-15']] },
      { name: 'FY27', rows: [header, ['MathWorks', 'matlab', 250, 900, 'USD', '2027-02-01']] },
    ]);

    const analysis = await ingestFile(buffer, {
      dataset: 'contracts',
      organizationId: ORG_A,
      importId: 'import-xlsx',
      fileName: 'renewals.xlsx',
    });

    expect(analysis.sheetNames).toEqual(['FY26', 'FY27']);
    expect(analysis.result.contracts).toHaveLength(2);
    expect(analysis.result.contracts.map((c) => c.provenance.sourceSheet).sort()).toEqual([
      'FY26',
      'FY27',
    ]);
    expect(analysis.result.contracts.find((c) => c.feature === 'ansys_mech_ent')!.unitPrice).toBe(5000);
  });

  it('reads a macro-enabled workbook the same way', async () => {
    const buffer = await workbook([
      { name: 'Schedule', rows: [header, ['Siemens', 'nx_cad', 60, 8200, 'USD', '2026-12-20']] },
    ]);

    const parsed = await parseIngestionFile(buffer, 'renewals.xlsm');
    expect(parsed.format).toBe('xlsx');

    const analysis = await ingestParsedFile(parsed, {
      dataset: 'contracts',
      organizationId: ORG_A,
      importId: 'import-xlsm',
      fileName: 'renewals.xlsm',
    });
    expect(analysis.result.contracts).toHaveLength(1);
    expect(analysis.result.contracts[0]!.annualCost).toBe(492_000);
  });

  it('reads a tab-separated renewal schedule', async () => {
    const analysis = analyze('contracts-renewal-only.tsv', ORG_A, 'import-tsv');
    expect(analysis.result.contracts).toHaveLength(3);
    expect(analysis.result.rejectedRows).toBe(0);
  });
});
