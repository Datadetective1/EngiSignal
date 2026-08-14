/**
 * Decisions are derived from Signals, not stored alongside them.
 *
 * Only status and ownership are persisted. Everything else — impact, urgency,
 * confidence, recommended action — is recomputed from current analytics on
 * every read, so a decision can never quietly drift away from the evidence
 * that justified it. A stale recommendation with a fresh-looking status is
 * exactly the failure this design prevents.
 */

import type { DecisionItem, DecisionStatus, DecisionType, Signal, SignalKind } from '@/lib/domain/types';

const TYPE_FOR_KIND: Record<SignalKind, DecisionType> = {
  renewal: 'renewal',
  cost: 'cost',
  capacity: 'capacity',
  usage: 'forecast',
  forecast: 'forecast',
  reclaim: 'reclaim',
  data: 'data_quality',
};

const ACTION_FOR_KIND: Record<SignalKind, string> = {
  renewal: 'Agree the renewal position and take it into negotiation.',
  cost: 'Reduce entitled quantity to the recommended level at renewal.',
  capacity: 'Review capacity exposure and decide whether to increase quantity.',
  usage: 'Confirm whether the demand shift is structural before the next renewal.',
  forecast: 'Plan capacity for forecast demand ahead of the renewal date.',
  reclaim: 'Run a reclaim campaign with the responsible managers.',
  data: 'Resolve the data condition to raise recommendation confidence.',
};

export interface DecisionOverride {
  status: DecisionStatus;
  owner: string | null;
}

export function buildDecisions(
  organizationId: string,
  signals: readonly Signal[],
  overrides: ReadonlyMap<string, DecisionOverride>,
): DecisionItem[] {
  return signals.map((signal) => {
    const override = overrides.get(signal.id);
    return {
      id: signal.id,
      organizationId,
      type: TYPE_FOR_KIND[signal.kind],
      title: signal.title,
      description: signal.subtitle,
      impact: signal.financialImpact,
      urgencyDays: signal.urgencyDays,
      confidence: signal.confidence,
      risk: signal.risk,
      owner: override?.owner ?? null,
      recommendedAction: ACTION_FOR_KIND[signal.kind],
      status: override?.status ?? 'open',
      href: signal.href,
    };
  });
}

export const DECISION_TYPE_LABELS: Record<DecisionType, string> = {
  renewal: 'Renewal',
  cost: 'Cost',
  capacity: 'Capacity',
  reclaim: 'Reclaim',
  forecast: 'Forecast',
  contract: 'Contract',
  data_quality: 'Data Quality',
};

export const DECISION_STATUS_LABELS: Record<DecisionStatus, string> = {
  open: 'Open',
  in_review: 'In review',
  approved: 'Approved',
  rejected: 'Rejected',
  complete: 'Complete',
};
