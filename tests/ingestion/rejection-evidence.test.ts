import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('server-only', () => ({}));

import { __resetMemoryStore, memoryIngestionStore } from '@/lib/ingestion/store/memory-store';
import { ingestFile } from '@/lib/ingestion';

/**
 * ── "WHAT DID YOU REJECT, AND WHY?" ─────────────────────────────────────────
 *
 * Before committing, a customer sees every rejected row with the rule that
 * caught it and an example value. Afterwards that evidence was unreachable:
 * no route read it, and `ingestion_rejections` had been written by nothing
 * since the bulk-insert path was retired. A tenant looking at "4,458 rejected"
 * in production had zero stored rows explaining any of them.
 *
 * Two things must survive a commit, and they are different:
 *
 *   - the per-rule TOTALS, which are complete — every rejected row is counted;
 *   - a SAMPLE of individual rows, which is capped, because 1,093 identical
 *     "not a recognizable date" rows teach nothing the first fifty do not.
 *
 * Conflating them is how a customer ends up counting rows on a page and
 * concluding the rest were silently forgotten.
 */

const csv = [
  'date,user,feature,concurrent',
  '2026-07-01,j.reyes,ANSYS_MECH_ENT,3',
  '2026-07-02,m.chen,ANSYS_CFD,2',
  'not-a-date,j.reyes,ANSYS_MECH_ENT,2',
  '2026-07-03,a.patel,,1',
  '2026-07-04,a.patel,NX_DESIGN,-5',
].join('\n');

const commit = async () => {
  const encoded = new TextEncoder().encode(csv);
  const parsed = await ingestFile(encoded.buffer as ArrayBuffer, {
    dataset: 'usage',
    organizationId: 'org-1',
    importId: 'imp-1',
    fileName: 'usage.csv',
  });

  const summary = await memoryIngestionStore.commitImport({
    organizationId: 'org-1',
    importId: 'imp-1',
    fileName: 'usage.csv',
    fileBytes: csv.length,
    dataset: 'usage',
    detectionEvidence: parsed.detection.evidence,
    detectionConfidence: parsed.detection.confidence,
    detectionFellBack: parsed.detection.fellBack,
    sourceSheets: parsed.sheetNames,
    mappingUsed: { date: 'date', user: 'user', feature: 'feature', concurrent: 'concurrent' },
    result: parsed.result,
  });

  return { parsed, summary };
};

beforeEach(() => {
  __resetMemoryStore();
});

describe('the evidence an import leaves behind', () => {
  it('rejected the rows a customer would expect it to', async () => {
    const { parsed } = await commit();
    // A bad date, an empty feature and a negative concurrency.
    expect(parsed.result.rejectedRows).toBe(3);
    expect(parsed.result.acceptedRows).toBe(2);
  });

  it('can be reopened after the import is committed', async () => {
    await commit();
    const detail = await memoryIngestionStore.getImport('org-1', 'imp-1');
    expect(detail).not.toBeNull();
  });

  it('answers how many were accepted and how many rejected', async () => {
    await commit();
    const detail = await memoryIngestionStore.getImport('org-1', 'imp-1');
    expect(detail!.acceptedRows).toBe(2);
    expect(detail!.rejectedRows).toBe(3);
  });

  it('answers why, with a reason for every rejected row', async () => {
    await commit();
    const detail = await memoryIngestionStore.getImport('org-1', 'imp-1');

    // The totals are complete: they account for every rejected row.
    const counted = detail!.rejectionSummary.reduce((total, entry) => total + entry.count, 0);
    expect(counted).toBe(detail!.rejectedRows);
    expect(detail!.rejectionSummary.every((entry) => entry.message.length > 0)).toBe(true);
  });

  it('keeps example values, so a customer can recognise the pattern', async () => {
    await commit();
    const detail = await memoryIngestionStore.getImport('org-1', 'imp-1');

    const examples = detail!.rejectionSummary.flatMap((entry) => entry.examples);
    expect(examples.join(' ')).toContain('not-a-date');
  });

  it('keeps the individual rows, with the row number from the customer file', async () => {
    await commit();
    const detail = await memoryIngestionStore.getImport('org-1', 'imp-1');

    expect(detail!.rejections.length).toBeGreaterThan(0);
    expect(detail!.rejections.every((row) => Number.isFinite(row.sourceRow))).toBe(true);
    expect(detail!.rejections.every((row) => row.message.length > 0)).toBe(true);
  });

  it('keeps the mapping that was applied, which is usually the real cause', async () => {
    await commit();
    const detail = await memoryIngestionStore.getImport('org-1', 'imp-1');
    expect(detail!.mappingUsed).toMatchObject({ feature: 'feature' });
  });

  it('refuses to hand an import to another tenant', async () => {
    await commit();
    // The id alone must never be enough.
    await expect(memoryIngestionStore.getImport('org-2', 'imp-1')).resolves.toBeNull();
  });
});
