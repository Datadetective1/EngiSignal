/**
 * Entitlement versus contract reconciliation.
 *
 * Two sources answer different questions and are routinely both right:
 *
 *   ENTITLEMENTS say what the LICENCE SERVER is configured to serve.
 *   CONTRACTS say what was BOUGHT, for how much, and until when.
 *
 * Phase 2A resolved their disagreements silently — entitlement wins for
 * utilization, because demand was measured against what the server would
 * actually issue. That choice is still correct for the arithmetic, and still
 * wrong as a complete answer: the difference between the two numbers is one of
 * the most valuable findings a licence review produces, and collapsing it
 * throws it away.
 *
 * ── WHY A DISCREPANCY IS NEVER LABELLED WASTE ────────────────────────────────
 *
 * A contract for 400 against a server issuing 350 could be:
 *
 *   shelfware              50 seats bought and never deployed
 *   staged deployment      a rollout partway through
 *   shared pools           capacity served from a server this export missed
 *   temporary licences     an evaluation grant not in the contract
 *   co-termed purchases    an amendment the extract predates
 *   incomplete exports     one of the two files simply does not cover it all
 *   contract amendments    a true-up or return already agreed
 *   a bad mapping          the two lines are not the same product at all
 *
 * Only the first is waste. The others are ordinary, and several mean the DATA
 * is wrong rather than the estate. Calling any of them waste and attaching a
 * dollar figure would send someone to a vendor with a claim their own records
 * disprove — so this module classifies, quantifies and explains, and leaves
 * the conclusion to a human who can check.
 */

import type { ContractItem, PortfolioRow } from '@/lib/domain/types';
import { round } from './stats';

export type ReconciliationState =
  | 'agree'
  | 'contract_exceeds_entitlement'
  | 'entitlement_exceeds_contract'
  | 'contract_only'
  | 'entitlement_only'
  | 'unresolved_identity';

export interface QuantitySource {
  quantity: number | null;
  /** Where the number came from, in the customer's terms. */
  provenance: string;
}

export interface ReconciliationRow {
  featureId: string;
  featureName: string;
  productName: string;
  vendorName: string;
  state: ReconciliationState;
  entitlement: QuantitySource;
  contract: QuantitySource;
  /** contract − entitlement. Null when either side is missing. */
  difference: number | null;
  /** Demand context, null when no usage was imported. */
  p95: number | null;
  recommended: number | null;
  renewalDate: string | null;
  annualCost: number | null;
  unitPrice: number | null;
  /** Value of the difference at contract unit price. NOT a claim of waste. */
  differenceValue: number | null;
  /** Plain-language explanation of what the state means. */
  interpretation: string;
  /** Causes a reviewer should rule out, most likely first. */
  possibleCauses: string[];
}

export interface ReconciliationSummary {
  rows: ReconciliationRow[];
  agreeing: number;
  disagreeing: number;
  contractOnly: number;
  entitlementOnly: number;
  unresolved: number;
  /** Absolute value at stake across all disagreements, priced lines only. */
  valueAtStake: number;
  /** Disagreeing lines that could not be priced. */
  unpricedDisagreements: number;
}

const CAUSES: Record<ReconciliationState, string[]> = {
  agree: [],
  contract_exceeds_entitlement: [
    'Shelfware — seats purchased but never deployed to a licence server',
    'Staged deployment still in progress',
    'A licence server whose export was not included',
    'A contract amendment or true-up the entitlement export predates',
  ],
  entitlement_exceeds_contract: [
    'A temporary or evaluation grant not reflected in the contract',
    'A contract amendment not included in the procurement export',
    'Capacity served from a shared or borrowed pool',
    'Over-deployment beyond what was purchased — a compliance exposure',
  ],
  contract_only: [
    'The feature is purchased but not yet deployed',
    'The licence-server export does not cover this product',
    'The contract line names a product differently from the licence server',
  ],
  entitlement_only: [
    'The procurement export does not cover this product',
    'The licence is perpetual and carries no current contract line',
    'The contract line names the product differently',
  ],
  unresolved_identity: [
    'The contract line has not been matched to an observed feature',
    'Two similarly named products may or may not be the same thing',
  ],
};

const INTERPRETATIONS: Record<ReconciliationState, string> = {
  agree: 'Purchased quantity matches what the licence server is configured to serve.',
  contract_exceeds_entitlement:
    'More was purchased than the licence server is configured to serve. This is where shelfware appears, but it is not the only explanation.',
  entitlement_exceeds_contract:
    'The licence server serves more than the contract records as purchased. Worth resolving before a vendor audit does it for you.',
  contract_only: 'A purchased line with no matching entitlement in the licence-server export.',
  entitlement_only: 'A served entitlement with no matching contract line in the procurement export.',
  unresolved_identity:
    'This position could not be tied to an observed feature, so its two quantities cannot be compared at all.',
};

export interface ReconciliationInput {
  portfolio: readonly PortfolioRow[];
  /** Entitlement quantity per feature, as reported by the licence server. */
  entitlementByFeature: ReadonlyMap<string, number>;
  /** Purchased quantity per feature, as reported by procurement. */
  contractByFeature: ReadonlyMap<string, number>;
  /** Feature ids whose contract line could not be matched to observed usage. */
  unresolvedFeatureIds?: ReadonlySet<string>;
  contractItems?: readonly ContractItem[];
}

function classify(
  entitlement: number | null,
  contract: number | null,
  unresolved: boolean,
): ReconciliationState {
  if (unresolved) return 'unresolved_identity';
  if (entitlement === null && contract === null) return 'agree';
  if (entitlement === null) return 'contract_only';
  if (contract === null) return 'entitlement_only';
  if (entitlement === contract) return 'agree';
  return contract > entitlement ? 'contract_exceeds_entitlement' : 'entitlement_exceeds_contract';
}

export function reconcile(input: ReconciliationInput): ReconciliationSummary {
  const unresolvedIds = input.unresolvedFeatureIds ?? new Set<string>();
  const rows: ReconciliationRow[] = [];

  for (const row of input.portfolio) {
    const entitlement = input.entitlementByFeature.get(row.featureId) ?? null;
    const contract = input.contractByFeature.get(row.featureId) ?? null;
    const state = classify(entitlement, contract, unresolvedIds.has(row.featureId));

    const difference = entitlement === null || contract === null ? null : contract - entitlement;

    rows.push({
      featureId: row.featureId,
      featureName: row.featureName,
      productName: row.productName,
      vendorName: row.vendorName,
      state,
      entitlement: {
        quantity: entitlement,
        provenance:
          entitlement === null
            ? 'Not supplied by any licence-server export'
            : 'Reported by the licence-server entitlement export',
      },
      contract: {
        quantity: contract,
        provenance:
          contract === null
            ? 'Not supplied by any procurement export'
            : 'Reported by the contract or purchase-order export',
      },
      difference,
      // Demand context only where it was measured. `usageEvidence` guarantees
      // metrics is null when nothing was observed, so these stay null rather
      // than reporting a zero nobody measured.
      p95: row.metrics?.p95 ?? null,
      recommended: row.rightSizing?.recommended ?? null,
      renewalDate: row.renewalDate,
      annualCost: row.financial.currentAnnualCost,
      unitPrice: row.unitPrice,
      differenceValue:
        difference === null || row.unitPrice === null
          ? null
          : round(Math.abs(difference) * row.unitPrice, 2),
      interpretation: INTERPRETATIONS[state],
      possibleCauses: CAUSES[state],
    });
  }

  const disagreeingStates: ReconciliationState[] = [
    'contract_exceeds_entitlement',
    'entitlement_exceeds_contract',
  ];

  let valueAtStake = 0;
  let unpricedDisagreements = 0;
  for (const row of rows) {
    if (!disagreeingStates.includes(row.state)) continue;
    if (row.differenceValue === null) unpricedDisagreements += 1;
    else valueAtStake += row.differenceValue;
  }

  return {
    rows,
    agreeing: rows.filter((row) => row.state === 'agree').length,
    disagreeing: rows.filter((row) => disagreeingStates.includes(row.state)).length,
    contractOnly: rows.filter((row) => row.state === 'contract_only').length,
    entitlementOnly: rows.filter((row) => row.state === 'entitlement_only').length,
    unresolved: rows.filter((row) => row.state === 'unresolved_identity').length,
    valueAtStake: round(valueAtStake, 2),
    unpricedDisagreements,
  };
}

/** Short label for a state, for badges and table cells. */
export const RECONCILIATION_LABELS: Record<ReconciliationState, string> = {
  agree: 'Agree',
  contract_exceeds_entitlement: 'Contract > entitlement',
  entitlement_exceeds_contract: 'Entitlement > contract',
  contract_only: 'Contract only',
  entitlement_only: 'Entitlement only',
  unresolved_identity: 'Unresolved identity',
};
