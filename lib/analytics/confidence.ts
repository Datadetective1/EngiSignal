/**
 * Confidence scoring.
 *
 * A recommendation is only as trustworthy as the data underneath it. EngiSignal
 * computes confidence from measurable data conditions and always shows the
 * reasons — a "Low confidence" badge with no explanation is worse than useless.
 *
 * Scoring starts at 100 and deducts for each deficiency. The deductions are
 * deliberately visible constants rather than tuned weights, so the scale can be
 * explained to a customer in a single conversation.
 */

import type {
  ConfidenceLevel,
  ConfidenceReason,
  ConfidenceResult,
} from '@/lib/domain/types';
import { clamp, round } from './stats';

export const CONFIDENCE_THRESHOLDS = { high: 80, medium: 55 } as const;

export interface ConfidenceInput {
  /** Days with observed usage data in the analysis window. */
  observedDays: number;
  /** Calendar days in the analysis window. */
  windowDays: number;
  /** Whether a contract unit price is available for this feature. */
  hasPrice: boolean;
  /** Share of usage rows resolved to an employee record, 0–1. Null if unknown. */
  employeeMappingRate: number | null;
  /** Share of raw feature strings mapped to a canonical feature, 0–1. */
  featureMappingRate: number | null;
  /** Whether denial data is present for this feature's environment. */
  hasDenialData: boolean;
  /** Whether a headcount forecast is available for the organization. */
  hasForecastInput: boolean;
}

interface Deduction {
  points: number;
  reason: ConfidenceReason;
}

export function computeConfidence(input: ConfidenceInput): ConfidenceResult {
  const reasons: ConfidenceReason[] = [];
  const deductions: Deduction[] = [];

  // ── Observation period ────────────────────────────────────────────────────
  const coverage = input.windowDays > 0 ? input.observedDays / input.windowDays : 0;
  const months = round(input.observedDays / 30.44, 1);

  if (input.observedDays >= 300) {
    reasons.push({
      label: 'Observation period',
      detail: `${months} months of usage history`,
      impact: 'positive',
    });
  } else if (input.observedDays >= 150) {
    deductions.push({
      points: 10,
      reason: {
        label: 'Observation period',
        detail: `${months} months of history — under a full annual demand cycle`,
        impact: 'neutral',
      },
    });
  } else if (input.observedDays >= 60) {
    deductions.push({
      points: 22,
      reason: {
        label: 'Observation period',
        detail: `Only ${months} months of history — seasonal demand cannot be observed`,
        impact: 'negative',
      },
    });
  } else {
    deductions.push({
      points: 38,
      reason: {
        label: 'Observation period',
        detail: `Only ${input.observedDays} days of usage data`,
        impact: 'negative',
      },
    });
  }

  // ── Data gaps ─────────────────────────────────────────────────────────────
  const missingDays = Math.max(0, input.windowDays - input.observedDays);
  if (coverage >= 0.95) {
    reasons.push({ label: 'Data completeness', detail: 'No material gaps in the period', impact: 'positive' });
  } else if (coverage >= 0.8) {
    deductions.push({
      points: 8,
      reason: {
        label: 'Data completeness',
        detail: `${missingDays} days missing from the period`,
        impact: 'neutral',
      },
    });
  } else {
    deductions.push({
      points: 20,
      reason: {
        label: 'Data completeness',
        detail: `${missingDays} days missing — ${round(coverage * 100, 0)}% coverage`,
        impact: 'negative',
      },
    });
  }

  // ── Pricing ───────────────────────────────────────────────────────────────
  if (input.hasPrice) {
    reasons.push({ label: 'Pricing', detail: 'Contract unit price available', impact: 'positive' });
  } else {
    deductions.push({
      points: 18,
      reason: {
        label: 'Pricing',
        detail: 'No unit price — financial impact cannot be calculated',
        impact: 'negative',
      },
    });
  }

  // ── Identity resolution ───────────────────────────────────────────────────
  if (input.employeeMappingRate !== null) {
    const pct = round(input.employeeMappingRate * 100, 0);
    if (input.employeeMappingRate >= 0.95) {
      reasons.push({ label: 'Employee mapping', detail: `${pct}% of users resolved`, impact: 'positive' });
    } else if (input.employeeMappingRate >= 0.85) {
      deductions.push({
        points: 7,
        reason: { label: 'Employee mapping', detail: `${pct}% of users resolved`, impact: 'neutral' },
      });
    } else {
      deductions.push({
        points: 16,
        reason: {
          label: 'Employee mapping',
          detail: `Only ${pct}% of users resolved — organizational attribution is incomplete`,
          impact: 'negative',
        },
      });
    }
  }

  // ── Feature normalization ─────────────────────────────────────────────────
  if (input.featureMappingRate !== null) {
    const pct = round(input.featureMappingRate * 100, 0);
    if (input.featureMappingRate >= 0.98) {
      reasons.push({ label: 'Feature mapping', detail: `${pct}% of license features mapped`, impact: 'positive' });
    } else if (input.featureMappingRate >= 0.9) {
      deductions.push({
        points: 6,
        reason: { label: 'Feature mapping', detail: `${pct}% of features mapped`, impact: 'neutral' },
      });
    } else {
      deductions.push({
        points: 14,
        reason: {
          label: 'Feature mapping',
          detail: `Only ${pct}% of features mapped — demand may be understated`,
          impact: 'negative',
        },
      });
    }
  }

  // ── Denial visibility ─────────────────────────────────────────────────────
  if (input.hasDenialData) {
    reasons.push({ label: 'Denials', detail: 'Denial data available for this environment', impact: 'positive' });
  } else {
    deductions.push({
      points: 6,
      reason: {
        label: 'Denials',
        detail: 'No denial data — unmet demand cannot be observed',
        impact: 'neutral',
      },
    });
  }

  // ── Forecast inputs ───────────────────────────────────────────────────────
  if (input.hasForecastInput) {
    reasons.push({ label: 'Forecast inputs', detail: 'Headcount forecast available', impact: 'positive' });
  } else {
    deductions.push({
      points: 5,
      reason: {
        label: 'Forecast inputs',
        detail: 'No headcount forecast — growth assumption is manual',
        impact: 'neutral',
      },
    });
  }

  const totalDeduction = deductions.reduce((acc, d) => acc + d.points, 0);
  const score = clamp(round(100 - totalDeduction, 0), 0, 100);

  for (const d of deductions) reasons.push(d.reason);

  return {
    level: levelFromScore(score),
    score,
    reasons,
    // The raw measurements, kept so the explanation can quote them back in the
    // customer's own units instead of restating the badge.
    evidence: {
      observedDays: input.observedDays,
      windowDays: input.windowDays,
      hasPrice: input.hasPrice,
      hasDenialData: input.hasDenialData,
      employeeMappingRate: input.employeeMappingRate,
      featureMappingRate: input.featureMappingRate,
    },
  };
}

export function levelFromScore(score: number): ConfidenceLevel {
  if (score >= CONFIDENCE_THRESHOLDS.high) return 'High';
  if (score >= CONFIDENCE_THRESHOLDS.medium) return 'Medium';
  return 'Low';
}

/** Numeric weight used when ranking Signals. */
export function confidenceWeight(level: ConfidenceLevel): number {
  switch (level) {
    case 'High':
      return 1;
    case 'Medium':
      return 0.75;
    case 'Low':
      return 0.5;
  }
}

/** Aggregate several feature-level confidences into one portfolio confidence. */
export function aggregateConfidence(results: readonly ConfidenceResult[]): ConfidenceResult {
  if (results.length === 0) {
    return {
      level: 'Low',
      score: 0,
      reasons: [{ label: 'No data', detail: 'No analyzed features', impact: 'negative' }],
      evidence: null,
    };
  }

  const score = round(results.reduce((acc, r) => acc + r.score, 0) / results.length, 0);
  const low = results.filter((r) => r.level === 'Low').length;
  const high = results.filter((r) => r.level === 'High').length;

  const reasons: ConfidenceReason[] = [
    {
      label: 'Portfolio coverage',
      detail: `${high} of ${results.length} analyzed features at high confidence`,
      impact: high / results.length >= 0.6 ? 'positive' : 'neutral',
    },
  ];

  if (low > 0) {
    reasons.push({
      label: 'Low-confidence features',
      detail: `${low} feature${low === 1 ? '' : 's'} require data improvement before relying on the recommendation`,
      impact: 'negative',
    });
  }

  // An aggregate spans many windows, so there is no single one to report.
  return { level: levelFromScore(score), score, reasons, evidence: null };
}
