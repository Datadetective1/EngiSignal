/**
 * Source detection.
 *
 * Scores a parsed file against every signature and reports the winner with its
 * evidence. Two guards keep the answer honest:
 *
 *  1. A minimum confidence. Below it the file is treated as Generic and the
 *     customer maps it themselves, which is a better outcome than confidently
 *     applying FlexNet vocabulary to a Sentinel export.
 *  2. An ambiguity penalty. When two sources score close together the evidence
 *     genuinely is ambiguous, and the reported confidence drops to say so.
 */

import type { SourceSystem } from '../canonical/types';
import { normalizeHeader } from '../adapters/resolve';
import { SIGNATURES, type DetectionContext } from './signatures';

export interface DetectionCandidate {
  source: SourceSystem;
  name: string;
  confidence: number;
  evidence: string[];
}

export interface DetectionResult {
  source: SourceSystem;
  name: string;
  /** 0–100. */
  confidence: number;
  evidence: string[];
  /** True when detection fell back rather than identified a product. */
  fellBack: boolean;
  /** Every candidate considered, best first. */
  candidates: DetectionCandidate[];
}

/** Below this, we do not claim to have recognized a product. */
export const MIN_CONFIDENCE = 55;

/** Values sampled for terminology evidence. Bounded so detection stays cheap. */
const SAMPLE_ROWS = 25;

export function buildDetectionContext({
  headers,
  rows,
  sheetNames,
  fileName,
}: {
  headers: readonly string[];
  rows: readonly Record<string, unknown>[];
  sheetNames: readonly string[];
  fileName: string;
}): DetectionContext {
  const sampleValues: string[] = [];
  for (const row of rows.slice(0, SAMPLE_ROWS)) {
    for (const value of Object.values(row)) {
      if (value === null || value === undefined) continue;
      const text = String(value).trim().toLowerCase();
      if (text.length > 0 && text.length <= 200) sampleValues.push(text);
    }
  }

  return {
    headers: [...headers],
    normalizedHeaders: headers.map(normalizeHeader),
    sheetNames: [...sheetNames],
    sampleValues,
    fileName,
  };
}

/**
 * Identify the license-management system that produced a file.
 *
 * Detection never has side effects and never mutates the file — it only reads
 * headers, sheet names and a bounded sample of values.
 */
export function detectSource(context: DetectionContext): DetectionResult {
  const candidates: DetectionCandidate[] = SIGNATURES.map((signature) => {
    const fired = signature.rules.filter((rule) => rule.test(context));
    const weight = fired.reduce((total, rule) => total + rule.weight, 0);
    const confidence = Math.min(99, Math.round((weight / signature.saturation) * 100));
    return {
      source: signature.source,
      name: signature.name,
      confidence,
      evidence: fired.map((rule) => rule.evidence),
    };
  }).sort((a, b) => b.confidence - a.confidence || a.source.localeCompare(b.source));

  const best = candidates[0];
  const runnerUp = candidates[1];

  const generic: DetectionResult = {
    source: 'generic',
    name: 'Generic tabular export',
    confidence: 0,
    evidence: ['No license-manager signature scored high enough to be conclusive'],
    fellBack: true,
    candidates,
  };

  if (best === undefined || best.confidence < MIN_CONFIDENCE) return generic;

  // Ambiguity: when the runner-up is within 15 points the evidence does not
  // separate them cleanly, so report lower confidence rather than a false
  // certainty. If that drops it below the floor, fall back.
  let confidence = best.confidence;
  const evidence = [...best.evidence];

  if (runnerUp !== undefined && best.confidence - runnerUp.confidence < 15) {
    confidence = Math.max(0, best.confidence - 20);
    evidence.push(
      `Evidence also partially matches ${runnerUp.name}, so confidence is reduced`,
    );
    if (confidence < MIN_CONFIDENCE) {
      return { ...generic, evidence: [...generic.evidence, ...evidence], candidates };
    }
  }

  return {
    source: best.source,
    name: best.name,
    confidence,
    evidence,
    fellBack: false,
    candidates,
  };
}
