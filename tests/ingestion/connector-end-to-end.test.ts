import { readFileSync } from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { ingestParsedFile } from '@/lib/ingestion';
import { parseDelimited } from '@/lib/ingestion/parse';
import { __resetMemoryStore, memoryIngestionStore as store } from '@/lib/ingestion/store/memory-store';
import { buildDatasetFromCanonical } from '@/lib/ingestion/dataset';
import { buildPortfolio } from '@/lib/analytics/portfolio';
import { reconcile } from '@/lib/analytics/reconciliation';
import { DEFAULT_ANALYSIS_OPTIONS } from '@/lib/domain/dataset';
import { CONNECTOR_READINESS, connectorReadiness, readyFileConnectors } from '@/lib/connectors';
import { CONNECTOR_SAMPLES } from '@/lib/connectors/samples';
import type { Organization } from '@/lib/domain/types';

/**
 * ── THE GATE FOR CALLING A CONNECTOR "READY" ────────────────────────────────
 *
 * Settings reports a status for every connector, and the rule is that no
 * connector may be labelled Ready unless a realistic native export has been
 * carried the whole distance:
 *
 *   native file → parse → source detection → column mapping → normalization
 *               → persistence → analysis → reconciliation
 *
 * That is what this file does, per connector, and `readiness reflects reality`
 * at the bottom asserts the registry does not claim more than these tests
 * prove. Marking a connector Ready without a passing case here fails the suite,
 * which is the only reason the label means anything.
 */

const FIXTURES = path.resolve(__dirname, '../fixtures/ingestion');
const AS_OF = '2026-03-04';

const ORG: Organization = {
  id: 'org-connector',
  name: 'Connector Proof',
  slug: 'connector-proof',
  industry: 'Engineering',
  technicalHeadcount: 50,
  headcountGrowthRate: null,
  currency: 'USD',
  isDemo: false,
  createdAt: '2026-01-01T00:00:00.000Z',
};

function analyze(fileName: string, dataset: 'usage' | 'entitlements' = 'usage') {
  const text = readFileSync(path.join(FIXTURES, fileName), 'utf8');
  return ingestParsedFile(parseDelimited(text), {
    dataset,
    organizationId: ORG.id,
    importId: `import-${fileName}`,
    fileName,
    importedAt: '2026-03-04T00:00:00.000Z',
  });
}

async function commit(fileName: string, dataset: 'usage' | 'entitlements' = 'usage') {
  const analysis = analyze(fileName, dataset);
  const mappingUsed: Record<string, string> = {};
  for (const mapping of analysis.mappings) {
    if (mapping.field !== null) mappingUsed[mapping.sourceColumn] = mapping.field;
  }
  const summary = await store.commitImport({
    organizationId: ORG.id,
    importId: `import-${fileName}`,
    fileName,
    fileBytes: 2048,
    dataset,
    detectionEvidence: analysis.detection.evidence,
    detectionConfidence: analysis.detection.confidence,
    detectionFellBack: analysis.detection.fellBack,
    sourceSheets: analysis.sheetNames,
    mappingUsed,
    result: analysis.result,
  });
  return { analysis, summary };
}

beforeEach(() => {
  __resetMemoryStore();
});

/**
 * One connector, carried the whole distance.
 *
 * `expectedSource` is asserted rather than assumed: a fixture that silently
 * detected as `generic` would still produce numbers, and the connector would be
 * "working" while doing none of the vendor-specific mapping it claims.
 */
async function carryThrough(usageFile: string, expectedSource: string) {
  const { analysis, summary } = await commit(usageFile);

  // 1. Parsed and detected as the connector under test.
  expect(analysis.detection.source).toBe(expectedSource);
  // 2. Mapped without leaving a required field unresolved.
  expect(analysis.missingRequired).toEqual([]);
  // 3. Normalized with nothing rejected.
  expect(analysis.result.acceptedRows).toBe(analysis.result.totalRows);
  expect(analysis.result.rejectedRows).toBe(0);
  // 4. Persisted, and the store agrees about the count.
  expect(summary.acceptedRows).toBe(analysis.result.acceptedRows);
  expect(summary.usageRecords).toBe(analysis.result.usage.length);

  // 5. Read back out of the store and analysed.
  const usage = await store.listUsage(ORG.id);
  expect(usage.length).toBe(analysis.result.acceptedRows);

  const dataset = buildDatasetFromCanonical({
    organization: ORG,
    usage,
    entitlements: [],
    people: [],
    contracts: [],
    asOf: AS_OF,
  });
  const portfolio = buildPortfolio({ ...dataset, asOf: AS_OF }, DEFAULT_ANALYSIS_OPTIONS);
  expect(portfolio.length).toBeGreaterThan(0);

  // 6. Reconciled. Entitlement-only is the correct state with no contract file,
  //    and getting a state at all is what proves the feature identity survived
  //    every hop from the native file to here.
  const summaryOut = reconcile({
    portfolio,
    entitlementByFeature: new Map(portfolio.map((row) => [row.featureId, row.entitled])),
    contractByFeature: new Map(),
  });
  expect(summaryOut.rows.length).toBe(portfolio.length);
  expect(summaryOut.rows.every((row) => row.state === 'entitlement_only')).toBe(true);

  return { analysis, usage, portfolio };
}

describe('FlexNet / FLEXlm', () => {
  it('carries a native export from file to reconciliation', async () => {
    const { usage } = await carryThrough('flexnet-usage.csv', 'flexnet');
    expect(usage.some((row) => row.concurrent !== null)).toBe(true);
  });

  it('captures the client workstation, which used to be discarded', async () => {
    const { usage } = await carryThrough('flexnet-borrow-usage.csv', 'flexnet');
    // HOST is the client machine. It was previously dropped precisely to keep
    // it away from `licenseServer`; it now lands in its own field.
    expect(usage.map((row) => row.hostname)).toContain('ws-4412');
    expect(usage.every((row) => row.licenseServer === 'lic-prod-01')).toBe(true);
  });

  it('keeps two feature versions distinguishable', async () => {
    const { usage } = await carryThrough('flexnet-borrow-usage.csv', 'flexnet');
    const versions = new Set(usage.map((row) => row.version));
    expect(versions.has('2026.1')).toBe(true);
    expect(versions.has('2025.2')).toBe(true);
  });

  it('records which checkouts were borrowed', async () => {
    const { usage } = await carryThrough('flexnet-borrow-usage.csv', 'flexnet');
    expect(usage.filter((row) => row.borrowed === true)).toHaveLength(2);
    expect(usage.filter((row) => row.borrowed === false)).toHaveLength(5);
    // Not one null: this file HAS a borrow column, so every row has an answer.
    expect(usage.filter((row) => row.borrowed === null)).toHaveLength(0);
  });

  it('reads the denial column as a denial and not as a borrow', async () => {
    const { usage } = await carryThrough('flexnet-borrow-usage.csv', 'flexnet');
    // The FlexNet coercer maps "denied"/"granted". Applying it to `borrowed`
    // would have turned every granted row into borrowed=false by accident and
    // every denied row into borrowed=true.
    expect(usage.filter((row) => row.denied === true)).toHaveLength(1);
    const denialRow = usage.find((row) => row.denied === true)!;
    expect(denialRow.borrowed).toBe(false);
  });
});

describe('Reprise License Manager (RLM)', () => {
  it('carries a native export from file to reconciliation', async () => {
    const { usage, analysis } = await carryThrough('rlm-usage.csv', 'rlm');
    // RLM identifies the publisher by ISV daemon name, not a vendor column.
    expect(usage.some((row) => row.vendor === 'altair')).toBe(true);
    expect(analysis.result.warnings.some((w) => w.code === 'low_detection_confidence')).toBe(false);
  });

  it('keeps pooled licences in their own pool', async () => {
    const { usage } = await carryThrough('rlm-usage.csv', 'rlm');
    expect(usage.some((row) => row.pool !== null)).toBe(true);
  });
});

describe('Dassault Systèmes DSLS', () => {
  it('carries a native export from file to reconciliation', async () => {
    const { usage } = await carryThrough('dsls-usage.csv', 'dsls');
    expect(usage.some((row) => row.tokens !== null)).toBe(true);
  });

  it('preserves token weight rather than folding it into quantity', async () => {
    const { usage } = await carryThrough('dsls-usage.csv', 'dsls');
    const withTokens = usage.filter((row) => row.tokens !== null);
    expect(withTokens.length).toBeGreaterThan(0);
    // A token-weighted checkout must not be reported as one seat.
    expect(withTokens.every((row) => row.tokens! > 0)).toBe(true);
  });
});

describe('Sentinel RMS', () => {
  it('carries a native export from file to reconciliation', async () => {
    const { usage } = await carryThrough('sentinel-usage.csv', 'sentinel');
    expect(usage.some((row) => row.peak !== null)).toBe(true);
  });

  it('captures the feature version and client host it used to discard', async () => {
    const { usage } = await carryThrough('sentinel-usage.csv', 'sentinel');
    expect(usage.some((row) => row.version === '2026.1')).toBe(true);
    expect(usage.map((row) => row.hostname)).toContain('ws-3301');
  });

  it('leaves borrowing unknown rather than reporting none', async () => {
    const { usage } = await carryThrough('sentinel-usage.csv', 'sentinel');
    // This snapshot export carries no commuter column. Null is the honest
    // answer; false would assert that nothing was borrowed.
    expect(usage.every((row) => row.borrowed === null)).toBe(true);
  });
});

describe('unknown fields stay unknown', () => {
  it('never invents a zero for a column the file does not have', async () => {
    const { usage } = await carryThrough('rlm-usage.csv', 'rlm');
    // The RLM fixture has no hostname, version or token column at all.
    expect(usage.every((row) => row.hostname === null)).toBe(true);
    expect(usage.every((row) => row.version === null)).toBe(true);
    expect(usage.every((row) => row.tokens === null)).toBe(true);
    // And specifically not zero, which would read as a measured quantity.
    expect(usage.every((row) => row.tokens !== 0)).toBe(true);
  });
});

describe('the downloadable sample files', () => {
  /**
   * A sample export that does not import is worse than no sample at all: the
   * customer concludes the product is broken using the product's own file.
   */
  it('each sample is detected as its own source and imports cleanly', () => {
    const expected: Record<string, string> = {
      flexnet: 'flexnet',
      rlm: 'rlm',
      dsls: 'dsls',
      sentinel: 'sentinel',
    };

    for (const [id, sample] of Object.entries(CONNECTOR_SAMPLES)) {
      const analysis = ingestParsedFile(parseDelimited(sample.csv), {
        dataset: 'usage',
        organizationId: ORG.id,
        importId: `sample-${id}`,
        fileName: sample.fileName,
        importedAt: '2026-03-04T00:00:00.000Z',
      });

      expect(analysis.detection.source, `${id} sample detection`).toBe(expected[id]);
      expect(analysis.missingRequired, `${id} sample required fields`).toEqual([]);
      expect(analysis.result.rejectedRows, `${id} sample rejections`).toBe(0);
      expect(analysis.result.usage.length, `${id} sample rows`).toBeGreaterThan(0);
    }
  });

  it('covers every connector whose file import is Ready', () => {
    // A Ready connector with no sample to hand somebody is a support ticket.
    for (const entry of readyFileConnectors()) {
      expect(CONNECTOR_SAMPLES[entry.id], `no sample export for Ready connector ${entry.id}`).toBeDefined();
    }
  });
});

describe('readiness reflects reality', () => {
  it('claims Ready only for connectors proven end to end above', () => {
    const proven = new Set(['flexnet', 'rlm', 'dsls', 'sentinel']);
    for (const entry of CONNECTOR_READINESS) {
      if (entry.fileIngestion === 'ready') {
        expect(
          proven.has(entry.id),
          `Connector "${entry.id}" is labelled Ready but has no end-to-end proof in this file.`,
        ).toBe(true);
      }
    }
  });

  it('never reports a live connection as available', () => {
    // No connector polls a licence server in this release. Saying otherwise
    // would be the single most damaging claim on the Settings page.
    for (const entry of CONNECTOR_READINESS) {
      expect(entry.liveCollection).toBe('planned');
    }
  });

  it('resolves a status for every connector in the registry', () => {
    for (const entry of CONNECTOR_READINESS) {
      expect(connectorReadiness(entry.id)).toBeDefined();
    }
  });
});
