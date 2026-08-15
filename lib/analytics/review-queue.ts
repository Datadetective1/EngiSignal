/**
 * The unmatched-position review queue.
 *
 * Phase 2A left contract lines that could not be tied to observed usage in a
 * defensible but frustrating state: priced, counted toward spend, and
 * impossible to compare against demand. Each one is a position the customer is
 * paying for and cannot yet make a decision about, and resolving them is the
 * single highest-leverage action available — which is why they need a screen
 * rather than a queue entry.
 *
 * WHAT THIS MODULE WILL NOT DO
 *
 * Similarity is computed here, and used ONLY to order suggestions for a human.
 * Nothing in this file merges anything. The distinction is the whole point: a
 * suggestion a person confirms is evidence, and the same suggestion applied
 * automatically is a guess wearing evidence's clothes.
 */

import type { PortfolioRow } from '@/lib/domain/types';
import type { ContractReviewItem } from '@/lib/ingestion/contract-match';
import { round } from './stats';

export interface MatchCandidate {
  featureId: string;
  featureKey: string;
  featureName: string;
  vendorName: string | null;
  /** 0–100. Ordering only — never a threshold for automatic action. */
  score: number;
  /** Why this was suggested, in words a reviewer can check. */
  rationale: string;
  /** Demand context for the candidate, so a reviewer sees what merging joins. */
  p95: number | null;
  observedDays: number | null;
}

export interface ReviewPosition {
  rawValue: string;
  vendor: string | null;
  sku: string | null;
  quantity: number | null;
  unitPrice: number | null;
  annualCost: number | null;
  currency: string | null;
  renewalDate: string | null;
  occurrences: number;
  /** Annual value that cannot currently be compared with demand. */
  valueExcludedFromComparison: number | null;
  candidates: MatchCandidate[];
  status: 'unresolved' | 'confirmed' | 'rejected' | 'separate';
}

export interface ReviewQueue {
  positions: ReviewPosition[];
  /** Total annual value sitting outside demand comparison. */
  totalExcludedValue: number;
  /** Positions with no price, so their exclusion cannot be valued. */
  unpricedPositions: number;
}

/** Tokens worth comparing: short and structural words carry no signal. */
const STOPWORDS = new Set([
  'the', 'and', 'for', 'license', 'licence', 'licenses', 'licences',
  'software', 'suite', 'edition', 'version', 'std', 'inc', 'ltd',
]);

function tokens(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= 3 && !STOPWORDS.has(token));
}

/**
 * Similarity between a contract line and an observed feature, 0–100.
 *
 * Deliberately simple and explainable: shared meaningful tokens over the union
 * of them. A reviewer can look at the rationale and check it by eye, which
 * matters more than a cleverer metric they would have to trust. Anything opaque
 * here would invite exactly the automatic merging this design refuses.
 */
export function similarity(rawValue: string, candidateName: string): { score: number; shared: string[] } {
  const left = new Set(tokens(rawValue));
  const right = new Set(tokens(candidateName));
  if (left.size === 0 || right.size === 0) return { score: 0, shared: [] };

  const shared = [...left].filter((token) => right.has(token));
  const union = new Set([...left, ...right]);
  return { score: round((shared.length / union.size) * 100, 1), shared };
}

export interface BuildReviewQueueInput {
  /** Unmatched commercial lines produced by the matcher. */
  review: readonly ContractReviewItem[];
  /** Observed features, for suggesting candidates. */
  portfolio: readonly PortfolioRow[];
  /** Decisions already recorded, keyed by normalized raw value. */
  decisions?: ReadonlyMap<string, 'confirmed' | 'rejected' | 'separate'>;
  /** Suggestions below this score are not worth a reviewer's attention. */
  minScore?: number;
}

const DEFAULT_MIN_SCORE = 15;
const MAX_CANDIDATES = 5;

export function buildReviewQueue(input: BuildReviewQueueInput): ReviewQueue {
  const decisions = input.decisions ?? new Map();
  const minScore = input.minScore ?? DEFAULT_MIN_SCORE;

  const positions: ReviewPosition[] = input.review.map((item) => {
    const candidates: MatchCandidate[] = input.portfolio
      .map((row) => {
        // Compare against both the feature code and the product name: a
        // contract says "Ansys Mechanical Enterprise" where the licence server
        // says "MECH_ENT", and the product name is often the bridge.
        const byCode = similarity(item.rawValue, row.featureName);
        const byProduct = similarity(item.rawValue, row.productName);
        const best = byCode.score >= byProduct.score ? byCode : byProduct;
        const against = byCode.score >= byProduct.score ? 'feature name' : 'product name';

        const vendorMatches =
          item.vendor !== null &&
          row.vendorName.trim().toLowerCase() === item.vendor.trim().toLowerCase();

        // Vendor agreement is corroboration, not a match on its own. It lifts
        // an already-plausible candidate rather than creating one.
        const score = best.score === 0 ? 0 : Math.min(100, best.score + (vendorMatches ? 15 : 0));

        return {
          featureId: row.featureId,
          featureKey: row.featureCode,
          featureName: row.featureName,
          vendorName: row.vendorName,
          score,
          rationale:
            best.shared.length > 0
              ? `Shares ${best.shared.map((token) => `"${token}"`).join(', ')} with the ${against}${vendorMatches ? ', and the vendor matches' : ''}.`
              : vendorMatches
                ? 'Same vendor, but no words in common.'
                : 'No shared terms.',
          p95: row.metrics?.p95 ?? null,
          observedDays: row.metrics?.observedDays ?? null,
        } satisfies MatchCandidate;
      })
      .filter((candidate) => candidate.score >= minScore)
      .sort((a, b) => b.score - a.score)
      .slice(0, MAX_CANDIDATES);

    const decision = decisions.get(item.rawValue.trim().toLowerCase());

    return {
      rawValue: item.rawValue,
      vendor: item.vendor,
      sku: item.sku,
      quantity: null,
      unitPrice: null,
      annualCost: item.annualCost,
      currency: item.currency,
      renewalDate: null,
      occurrences: item.occurrences,
      valueExcludedFromComparison: item.annualCost,
      candidates,
      status: decision ?? 'unresolved',
    };
  });

  let totalExcludedValue = 0;
  let unpricedPositions = 0;
  for (const position of positions) {
    if (position.status !== 'unresolved') continue;
    if (position.valueExcludedFromComparison === null) unpricedPositions += 1;
    else totalExcludedValue += position.valueExcludedFromComparison;
  }

  return {
    positions,
    totalExcludedValue: round(totalExcludedValue, 2),
    unpricedPositions,
  };
}

/**
 * What confirming a suggestion would do, stated before it is done.
 *
 * A merge is easy to describe and hard to reverse mentally once the numbers
 * have moved, so the consequence is shown while the reviewer can still decline.
 */
export function describeConfirmationEffect(
  position: ReviewPosition,
  candidate: MatchCandidate,
): string[] {
  const effects: string[] = [
    `"${position.rawValue}" will be treated as the same product as ${candidate.featureName}.`,
  ];

  if (position.annualCost !== null) {
    effects.push(
      `${position.currency ?? ''}${position.annualCost.toLocaleString('en-US')} of annual cost will attach to ${candidate.featureName} and enter demand comparison.`.trim(),
    );
  } else {
    effects.push(
      `This line carries no price, so it will add renewal and quantity context to ${candidate.featureName} but no cost.`,
    );
  }

  if (candidate.observedDays !== null && candidate.p95 !== null) {
    effects.push(
      `${candidate.featureName} has ${candidate.observedDays} days of observed demand with a P95 of ${candidate.p95}, which will become the basis for right-sizing this position.`,
    );
  } else {
    effects.push(
      `${candidate.featureName} has no observed demand, so the merged position will still not support a right-sizing recommendation.`,
    );
  }

  effects.push('This can be undone, and it applies only to your organization.');
  return effects;
}
