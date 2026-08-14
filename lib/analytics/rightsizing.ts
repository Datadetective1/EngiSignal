/**
 * Right-sizing — the recommendation at the centre of EngiSignal.
 *
 *   recommended = CEILING( Pxx(daily peaks) × growthFactor × safetyFactor )
 *
 * The default is the P95 model with no growth and a 10% safety buffer. It is
 * presented as *a* defensible default, never as the only valid method: the
 * strategy registry below exists so alternative methodologies can be added
 * without touching any caller.
 *
 * Denials are not an input. See COMPETITIVE_RESEARCH.md, Finding 1.
 */

import type {
  AnalysisWindow,
  PeriodKey,
  RightSizingAssumptions,
  RightSizingResult,
} from '@/lib/domain/types';
import { ceilPrecise, percentile, round } from './stats';

export const DEFAULT_PERCENTILE = 0.95;
export const DEFAULT_GROWTH_FACTOR = 1.0;
export const DEFAULT_SAFETY_FACTOR = 1.1;

export interface RightSizingInput {
  /** Observed daily peak concurrent demand over the analysis window. */
  dailyPeaks: readonly number[];
  /** Entitled quantity from the current contract position. */
  entitled: number;
  /** Percentile as a ratio in [0, 1]. Defaults to P95. */
  percentile?: number;
  /** Expected demand growth multiplier, e.g. 1.05 for +5%. */
  growthFactor?: number;
  /** Protective buffer multiplier, e.g. 1.10 for +10%. */
  safetyFactor?: number;
  periodKey?: PeriodKey;
}

export interface RightSizingMethod {
  id: string;
  label: string;
  description: string;
  compute(input: RightSizingInput): RightSizingResult;
}

function normalizeAssumptions(input: RightSizingInput): RightSizingAssumptions {
  return {
    percentile: input.percentile ?? DEFAULT_PERCENTILE,
    growthFactor: input.growthFactor ?? DEFAULT_GROWTH_FACTOR,
    safetyFactor: input.safetyFactor ?? DEFAULT_SAFETY_FACTOR,
    periodKey: input.periodKey ?? '12m',
  };
}

/**
 * The default percentile-based right-sizing model.
 *
 * Reads as: "size the pool for the demand level we exceed only 5% of days,
 * adjusted for expected growth, plus a protective buffer."
 */
export const percentileModel: RightSizingMethod = {
  id: 'percentile-growth-safety',
  label: 'Percentile demand with growth and safety buffer',
  description:
    'Sizes capacity to a chosen percentile of observed daily peak demand, scaled by expected growth and a protective safety buffer.',

  compute(input: RightSizingInput): RightSizingResult {
    const assumptions = normalizeAssumptions(input);
    const basis = percentile(input.dailyPeaks, assumptions.percentile);
    const rawRecommended = basis * assumptions.growthFactor * assumptions.safetyFactor;
    const recommended = ceilPrecise(rawRecommended);
    const entitled = input.entitled;

    return {
      basis: round(basis, 2),
      assumptions,
      rawRecommended: round(rawRecommended, 4),
      recommended,
      entitled,
      quantityDelta: recommended - entitled,
      surplus: Math.max(0, entitled - recommended),
      shortfall: Math.max(0, recommended - entitled),
      methodology: describeMethodology(assumptions),
    };
  },
};

/**
 * Maximum-observed-demand model.
 *
 * Registered as an explicit alternative so that risk-averse organizations —
 * those where a denied license halts a certification run — can size to observed
 * maximum rather than a percentile.
 */
export const maximumModel: RightSizingMethod = {
  id: 'maximum-observed',
  label: 'Maximum observed demand with safety buffer',
  description:
    'Sizes capacity to the highest daily peak observed in the period, scaled by growth and safety. Appropriate where a denial carries severe operational cost.',

  compute(input: RightSizingInput): RightSizingResult {
    const assumptions = { ...normalizeAssumptions(input), percentile: 1 };
    const basis = percentile(input.dailyPeaks, 1);
    const rawRecommended = basis * assumptions.growthFactor * assumptions.safetyFactor;
    const recommended = ceilPrecise(rawRecommended);

    return {
      basis: round(basis, 2),
      assumptions,
      rawRecommended: round(rawRecommended, 4),
      recommended,
      entitled: input.entitled,
      quantityDelta: recommended - input.entitled,
      surplus: Math.max(0, input.entitled - recommended),
      shortfall: Math.max(0, recommended - input.entitled),
      methodology:
        `Maximum observed daily peak × ${formatFactor(assumptions.growthFactor)} growth × ` +
        `${formatFactor(assumptions.safetyFactor)} safety, rounded up.`,
    };
  },
};

export const RIGHT_SIZING_METHODS: Record<string, RightSizingMethod> = {
  [percentileModel.id]: percentileModel,
  [maximumModel.id]: maximumModel,
};

export const DEFAULT_METHOD_ID = percentileModel.id;

export function computeRightSizing(input: RightSizingInput, methodId = DEFAULT_METHOD_ID): RightSizingResult {
  const method = RIGHT_SIZING_METHODS[methodId] ?? percentileModel;
  return method.compute(input);
}

function formatFactor(factor: number): string {
  return factor.toFixed(2);
}

function percentileLabel(p: number): string {
  if (p >= 1) return 'Maximum';
  return `P${round(p * 100, 1)}`;
}

/** One-sentence description of exactly how a recommendation was produced. */
export function describeMethodology(assumptions: RightSizingAssumptions): string {
  const growthPct = round((assumptions.growthFactor - 1) * 100, 1);
  const safetyPct = round((assumptions.safetyFactor - 1) * 100, 1);
  const growthText = growthPct === 0 ? 'no assumed growth' : `${growthPct > 0 ? '+' : ''}${growthPct}% growth`;
  return (
    `${percentileLabel(assumptions.percentile)} of daily peak demand, ` +
    `adjusted for ${growthText} and a ${safetyPct}% safety buffer, rounded up to a whole license.`
  );
}

export { percentileLabel };

/** Convert a headcount growth ratio (0.05) into a growth factor (1.05). */
export function growthFactorFromRate(rate: number): number {
  return 1 + rate;
}

/**
 * Sensitivity of the recommendation to each assumption.
 * Powers the Scenario Lab's "what moves this number" affordance.
 */
export function sensitivity(
  input: RightSizingInput,
  window?: AnalysisWindow,
): { label: string; recommended: number; delta: number }[] {
  const base = computeRightSizing(input);
  const variants: { label: string; overrides: Partial<RightSizingInput> }[] = [
    { label: 'P90 instead of P95', overrides: { percentile: 0.9 } },
    { label: 'P99 instead of P95', overrides: { percentile: 0.99 } },
    { label: 'No safety buffer', overrides: { safetyFactor: 1 } },
    { label: '20% safety buffer', overrides: { safetyFactor: 1.2 } },
    { label: '+10% headcount growth', overrides: { growthFactor: 1.1 } },
  ];

  void window;

  return variants.map((variant) => {
    const result = computeRightSizing({ ...input, ...variant.overrides });
    return {
      label: variant.label,
      recommended: result.recommended,
      delta: result.recommended - base.recommended,
    };
  });
}
