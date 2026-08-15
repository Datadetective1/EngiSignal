/**
 * Deterministic cost derivation.
 *
 * Turns whatever commercial columns a spreadsheet happened to carry into a unit
 * price and an annual value, recording HOW each was obtained so any figure in a
 * renewal position can be defended line by line.
 *
 * There is no arithmetic here that a customer could not reproduce in their own
 * spreadsheet in one step, and no rule that fills a gap with an assumption.
 *
 * ── THE RULE THAT IS DELIBERATELY ABSENT ─────────────────────────────────────
 *
 * A multi-year total is never divided by its term to produce an annual figure.
 *
 * It is tempting: a $900,000 line against a three-year contract "obviously"
 * annualizes to $300,000. But a Total column on a purchasing document may be a
 * one-year price, a three-year prepayment, a co-termed true-up, a ramped deal
 * whose years are not equal, or a figure that already includes support the
 * renewal will not. Straight-lining it produces a confident annual number the
 * customer never agreed to, and a negotiation position built on it collapses
 * the moment the vendor produces the actual schedule.
 *
 * So a total covering a term longer than a year is flagged `multiYearTotal`,
 * carried as `totalCost`, and left out of annual reporting. The customer is
 * told the line is unpriced for annual purposes and why. That is a worse-looking
 * report and a better one.
 */

import type { CostBasis } from './canonical/types';

export interface CostInputs {
  quantity: number | null;
  unitPrice: number | null;
  totalCost: number | null;
  annualCost: number | null;
  contractStartDate: string | null;
  contractEndDate: string | null;
}

export interface DerivedCost {
  unitPrice: number | null;
  unitPriceBasis: CostBasis;
  annualCost: number | null;
  annualCostBasis: CostBasis;
  /** True when totalCost spans more than one year, so it is not annualized. */
  multiYearTotal: boolean;
  /** Human-readable derivations, one per computed figure. */
  derivations: string[];
}

/** Days beyond which a term is treated as multi-year, allowing for leap years. */
const MULTI_YEAR_DAYS = 400;

/**
 * Term length in whole days, or null when the dates cannot bound it.
 *
 * Exported because the renewal surface shows the term alongside the money, and
 * a second implementation of "how long is this contract" would eventually
 * disagree with this one.
 */
export function termDays(startDate: string | null, endDate: string | null): number | null {
  if (startDate === null || endDate === null) return null;
  const start = Date.parse(startDate);
  const end = Date.parse(endDate);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  const days = Math.round((end - start) / 86_400_000);
  return days >= 0 ? days : null;
}

/** Round money to cents without accumulating binary drift. */
function money(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Derive unit price and annual cost from what the file supplied.
 *
 * Precedence is "what the customer stated" over "what we can compute", always.
 * An explicitly supplied annual cost wins over a quantity × unit price product
 * even when the two disagree — the disagreement is the customer's to explain,
 * and silently preferring our own arithmetic would hide it.
 */
export function deriveCost(input: CostInputs): DerivedCost {
  const { quantity, unitPrice, totalCost, annualCost } = input;
  const derivations: string[] = [];

  const days = termDays(input.contractStartDate, input.contractEndDate);
  const multiYearTotal = days !== null && days > MULTI_YEAR_DAYS && totalCost !== null;

  // ── Unit price ─────────────────────────────────────────────────────────────
  let resolvedUnitPrice: number | null = null;
  let unitPriceBasis: CostBasis = 'none';

  if (unitPrice !== null) {
    resolvedUnitPrice = money(unitPrice);
    unitPriceBasis = 'supplied_unit_price';
    derivations.push(`Unit price ${resolvedUnitPrice} supplied directly.`);
  } else if (annualCost !== null && quantity !== null && quantity > 0) {
    // Annual is preferred over total as the numerator: it is already the
    // per-year figure the renewal position needs, with no term assumption.
    resolvedUnitPrice = money(annualCost / quantity);
    unitPriceBasis = 'total_over_quantity';
    derivations.push(
      `Unit price ${resolvedUnitPrice} derived from annual cost ${annualCost} ÷ quantity ${quantity}.`,
    );
  } else if (totalCost !== null && quantity !== null && quantity > 0 && !multiYearTotal) {
    resolvedUnitPrice = money(totalCost / quantity);
    unitPriceBasis = 'total_over_quantity';
    derivations.push(
      `Unit price ${resolvedUnitPrice} derived from total cost ${totalCost} ÷ quantity ${quantity}.`,
    );
  } else if (totalCost !== null && multiYearTotal) {
    derivations.push(
      `Total cost ${totalCost} covers a term of ${days} days, so it is not treated as an annual figure and no unit price is derived from it.`,
    );
  } else if (totalCost !== null && (quantity === null || quantity <= 0)) {
    derivations.push('Total cost supplied but quantity is missing, so no unit price can be derived.');
  }

  // ── Annual cost ────────────────────────────────────────────────────────────
  let resolvedAnnual: number | null = null;
  let annualCostBasis: CostBasis = 'none';

  if (annualCost !== null) {
    resolvedAnnual = money(annualCost);
    annualCostBasis = 'supplied_annual_cost';
    derivations.push(`Annual cost ${resolvedAnnual} supplied directly.`);
  } else if (unitPrice !== null && quantity !== null && quantity > 0) {
    resolvedAnnual = money(unitPrice * quantity);
    annualCostBasis = 'quantity_x_unit';
    derivations.push(
      `Annual cost ${resolvedAnnual} derived from quantity ${quantity} × unit price ${unitPrice}.`,
    );
  } else if (totalCost !== null && !multiYearTotal) {
    // A total on a term of a year or less IS the annual figure. Terms shorter
    // than a year are not scaled up either: a six-month bridge deal does not
    // imply twice the money over twelve months.
    resolvedAnnual = money(totalCost);
    annualCostBasis = 'supplied_total_cost';
    derivations.push(
      days === null
        ? `Annual cost ${resolvedAnnual} taken from total cost, no contract term stated.`
        : `Annual cost ${resolvedAnnual} taken from total cost over a ${days}-day term.`,
    );
  } else if (multiYearTotal) {
    derivations.push(
      'Multi-year total is not annualized. Supply an annual cost or a unit price to price this line for renewal.',
    );
  }

  return {
    unitPrice: resolvedUnitPrice,
    unitPriceBasis,
    annualCost: resolvedAnnual,
    annualCostBasis,
    multiYearTotal,
    derivations,
  };
}

/** Plain-language explanation of a basis, for the review and evidence surfaces. */
export function describeCostBasis(basis: CostBasis): string {
  switch (basis) {
    case 'supplied_unit_price':
      return 'Supplied as a unit price';
    case 'supplied_annual_cost':
      return 'Supplied as an annual cost';
    case 'supplied_total_cost':
      return 'Taken from the line total';
    case 'quantity_x_unit':
      return 'Quantity × unit price';
    case 'total_over_quantity':
      return 'Total ÷ quantity';
    case 'none':
      return 'Not determinable from the supplied columns';
  }
}
