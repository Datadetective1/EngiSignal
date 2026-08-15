import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildDetectionContext, detectSource, MIN_CONFIDENCE } from '@/lib/ingestion/detect';
import { parseDelimited } from '@/lib/ingestion/parse';

const FIXTURES = path.resolve(__dirname, '../fixtures/ingestion');

function detectFixture(fileName: string) {
  const text = readFileSync(path.join(FIXTURES, fileName), 'utf8');
  const parsed = parseDelimited(text);
  const sheet = parsed.sheets[0]!;
  return detectSource(
    buildDetectionContext({
      headers: sheet.headers,
      rows: sheet.rows,
      sheetNames: parsed.sheetNames,
      fileName,
    }),
  );
}

describe('source detection', () => {
  it('identifies FlexNet from vendor daemon and checkout terminology', () => {
    const result = detectFixture('flexnet-usage.csv');
    expect(result.source).toBe('flexnet');
    expect(result.confidence).toBeGreaterThanOrEqual(MIN_CONFIDENCE);
    expect(result.fellBack).toBe(false);
    expect(result.evidence.join(' ')).toContain('Vendor daemon');
  });

  it('identifies RLM from the ISV column', () => {
    const result = detectFixture('rlm-usage.csv');
    expect(result.source).toBe('rlm');
    expect(result.evidence.join(' ')).toContain('ISV');
  });

  it('identifies DSLS from token and license-name columns', () => {
    const result = detectFixture('dsls-usage.csv');
    expect(result.source).toBe('dsls');
  });

  it('identifies Sentinel from sublicense and client-user columns', () => {
    const result = detectFixture('sentinel-usage.csv');
    expect(result.source).toBe('sentinel');
    expect(result.evidence.join(' ')).toContain('Sublicense');
  });

  it('falls back to generic when nothing scores high enough', () => {
    const result = detectFixture('generic-usage.csv');
    expect(result.source).toBe('generic');
    expect(result.fellBack).toBe(true);
  });

  it('does not depend on one exact column layout', () => {
    // Different headers, different date format, different vendor — still FlexNet.
    const original = detectFixture('flexnet-usage.csv');
    const variant = detectFixture('flexnet-variant.csv');
    expect(original.source).toBe('flexnet');
    expect(variant.source).toBe('flexnet');

    const rlmVariant = detectFixture('rlm-variant.tsv');
    expect(rlmVariant.source).toBe('rlm');
  });

  it('reports evidence for every conclusion it reaches', () => {
    for (const fixture of ['flexnet-usage.csv', 'rlm-usage.csv', 'dsls-usage.csv', 'sentinel-usage.csv']) {
      const result = detectFixture(fixture);
      expect(result.evidence.length).toBeGreaterThan(0);
    }
  });

  it('ranks every candidate so a reviewer can see the runners-up', () => {
    const result = detectFixture('flexnet-usage.csv');
    expect(result.candidates.length).toBe(4);
    expect(result.candidates[0]!.confidence).toBeGreaterThanOrEqual(result.candidates[1]!.confidence);
  });

  it('never reports full certainty, because detection is heuristic', () => {
    const result = detectFixture('flexnet-usage.csv');
    expect(result.confidence).toBeLessThanOrEqual(99);
  });
});
