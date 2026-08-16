/**
 * ── SAYING WHAT A CONFIDENCE BADGE ACTUALLY MEANS ────────────────────────────
 *
 * Phase 2C correctly reported LOW confidence for a feature whose export covered
 * 130 of 365 days. Correct, and useless to the person holding it: "Low" does
 * not tell a software asset manager whether the recommendation is unusable,
 * whether it will improve, or what it already assumes.
 *
 * The most important line here is the last one. A partial observation window
 * has an obvious wrong reading — that the unobserved days had no demand — and
 * that reading always understates what a customer needs to buy. EngiSignal
 * computes from the observed period only, and says so, because a reader who
 * assumes the gap means zero will walk into a renewal under-provisioned.
 */

import type { ConfidenceLevel, ConfidenceResult } from '@/lib/domain/types';
import { round } from './stats';

export interface ConfidenceExplanation {
  level: ConfidenceLevel;
  score: number;
  /** "130 of 365 days contain observed usage", or null when not applicable. */
  observedHistory: string | null;
  /** Why the level is what it is. Ordered by how much each cost. */
  why: string[];
  /** Concrete evidence that would raise it. Empty when nothing would. */
  improve: string[];
  /** Readings EngiSignal has deliberately NOT taken. Never empty. */
  notAssuming: string[];
  /** One sentence for a caller that has room for only one. */
  summary: string;
}

const GUIDANCE: Record<ConfidenceLevel, string> = {
  High: 'Suitable for a renewal decision, alongside your own commercial judgement.',
  Medium: 'Usable for planning. Confirm the gaps below before treating it as final.',
  Low: 'Import the missing evidence before using this as a final renewal position.',
};

export function explainConfidence(result: ConfidenceResult): ConfidenceExplanation {
  const evidence = result.evidence;

  const why = result.reasons
    .filter((reason) => reason.impact !== 'positive')
    .map((reason) => `${reason.label}: ${reason.detail}`);

  // A High-confidence result has no negatives to list, so state the positives
  // rather than showing an empty section that reads like a rendering bug.
  if (why.length === 0) {
    why.push(
      ...result.reasons
        .filter((reason) => reason.impact === 'positive')
        .map((reason) => `${reason.label}: ${reason.detail}`),
    );
  }

  const improve: string[] = [];
  const notAssuming: string[] = [];

  let observedHistory: string | null = null;

  if (evidence !== null && evidence.windowDays > 0) {
    const { observedDays, windowDays } = evidence;
    const missing = Math.max(0, windowDays - observedDays);
    const pct = round((observedDays / windowDays) * 100, 0);

    observedHistory = `${observedDays.toLocaleString('en-US')} of the requested ${windowDays.toLocaleString('en-US')} days contain observed usage (${pct}%).`;

    if (missing > 0) {
      improve.push(
        `Import usage covering the remaining ${missing.toLocaleString('en-US')} days. A full annual cycle is what makes a seasonal peak visible.`,
      );
      // THE line. Everything else here is context for it.
      notAssuming.push(
        `EngiSignal has NOT assumed the ${missing.toLocaleString('en-US')} unobserved days had zero demand. The recommendation is calculated only from the period you supplied — treating the gap as idle would understate what you need to buy.`,
      );
    } else {
      notAssuming.push(
        'The observation window is complete, so no demand has been inferred for unobserved days.',
      );
    }

    if (!evidence.hasPrice) {
      improve.push('Import a contract or price list so the quantity change can be valued.');
      notAssuming.push(
        'No unit price was supplied, so no benchmark or list price has been substituted. The quantity is reported without a monetary figure rather than with an invented one.',
      );
    }

    if (!evidence.hasDenialData) {
      improve.push(
        'Export denial or "licence denied" records if your licence manager keeps them. They are the only direct evidence of demand that went unserved.',
      );
      notAssuming.push(
        'Without denial data, EngiSignal has NOT assumed that demand never exceeded capacity. Peak observed usage is a floor on true demand, not a ceiling.',
      );
    }

    if (evidence.employeeMappingRate !== null && evidence.employeeMappingRate < 0.95) {
      improve.push(
        `Resolve the unmatched usernames — ${round((1 - evidence.employeeMappingRate) * 100, 0)}% of usage cannot currently be attributed to a person.`,
      );
    }
  }

  notAssuming.push(
    'Nothing on this page is estimated, benchmarked or modelled. Every figure traces to a row in a file you supplied.',
  );

  return {
    level: result.level,
    score: result.score,
    observedHistory,
    why,
    improve,
    notAssuming,
    summary: `${result.level} confidence (${result.score}/100). ${GUIDANCE[result.level]}`,
  };
}
