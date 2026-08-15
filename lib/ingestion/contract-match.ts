/**
 * Linking commercial lines to the features they pay for.
 *
 * This is the join that turns "we own 400 of these" and "we use 275 of these"
 * and "each one costs $5,000" into a single defensible sentence. It is also the
 * place where a plausible-looking mistake does the most damage, so the matching
 * is deliberately narrow.
 *
 * ── WHY NOTHING FUZZY ────────────────────────────────────────────────────────
 *
 * A similarity score would happily merge these:
 *
 *   ansys_mechanical_pro        $4,000/seat     120 seats
 *   ansys_mechanical_premium    $9,500/seat      40 seats
 *
 * They share a long prefix and differ by one word. Merged, the blended price is
 * wrong for both, the entitlement is wrong for both, and the resulting
 * recommendation — surrender 80 licences — would be presented with full
 * confidence. The customer would take that into a negotiation and be shown, by
 * their vendor, that it is nonsense. One such failure costs more trust than
 * fuzzy matching could ever earn back in convenience.
 *
 * So a link is made on one of exactly three grounds:
 *
 *   1. SKU equality. The strongest key there is: a vendor part number names one
 *      orderable thing and nothing else.
 *   2. Identical normalized names — the same rule usage and entitlements
 *      already use, which only collapses case and separators.
 *   3. A customer-confirmed alias. A human said these are the same thing.
 *
 * Everything else becomes a REVIEW ITEM naming both sides and what would settle
 * it. An unlinked line is not discarded: it still counts toward spend and
 * renewal exposure, it simply cannot be compared against demand. Reporting
 * "$180,000 of contracts we could not match to usage" is honest and actionable.
 * Guessing is neither.
 */

import type { CanonicalContractRecord } from './canonical/types';
import type { FeatureIdentity } from './identity';
import { normalizeFeatureKey } from './identity';

export type MatchBasis = 'sku' | 'normalized_name' | 'confirmed_alias' | 'unmatched';

export interface ContractLink {
  contract: CanonicalContractRecord;
  /** Resolved feature key, or null when nothing matched safely. */
  featureKey: string | null;
  featureId: string | null;
  /**
   * The key this line's MONEY is grouped under. Never null.
   *
   * Distinct from `featureKey` on purpose. A line that could not be tied to
   * observed demand still cost real money and still renews on a real date, so
   * it must reach the spend and renewal totals — dropping it would understate
   * the portfolio by exactly the amount nobody has reconciled yet, which is the
   * amount most worth seeing. What it does NOT get is a comparison against
   * demand, because there is no demand to compare it to.
   */
  positionKey: string;
  basis: MatchBasis;
  /** Plain-language justification, shown on the evidence surface. */
  evidence: string;
}

export interface ContractReviewItem {
  /** The commercial line that could not be placed. */
  rawValue: string;
  vendor: string | null;
  sku: string | null;
  /** Annual value at stake, when the line is priced. */
  annualCost: number | null;
  currency: string | null;
  /** Feature keys that look related but were NOT merged. Suggestions only. */
  candidates: string[];
  reason: string;
  /** What would resolve it. */
  resolution: string;
  occurrences: number;
}

export interface MatchResult {
  links: ContractLink[];
  review: ContractReviewItem[];
}

/**
 * Vendor for matching purposes.
 *
 * A schedule that names only a "Supplier" column is naming the vendor as far as
 * this join is concerned — reading it is not invention, and both raw values
 * remain stored. Resellers do appear here, which is why vendor is used only to
 * disambiguate candidates and never on its own to make a match.
 */
export function matchVendor(record: CanonicalContractRecord): string | null {
  return record.vendor ?? record.supplier;
}

/** SKUs compare case- and separator-insensitively; they are still exact keys. */
function skuKey(sku: string): string {
  return sku.trim().toLowerCase().replace(/[\s\-_./]+/g, '');
}

/**
 * Names that share a meaningful stem, offered as review candidates only.
 *
 * Used exclusively to write a helpful review item — never to link. The
 * distinction matters: a suggestion a human confirms is evidence, and the same
 * suggestion applied automatically is a guess.
 */
function relatedCandidates(key: string, featureKeys: readonly string[]): string[] {
  const tokens = key.split('_').filter((token) => token.length >= 4);
  if (tokens.length === 0) return [];

  return featureKeys
    .filter((candidate) => {
      if (candidate === key) return false;
      const candidateTokens = new Set(candidate.split('_'));
      return tokens.some((token) => candidateTokens.has(token));
    })
    .slice(0, 5);
}

export function linkContracts({
  contracts,
  features,
  aliases = new Map<string, string>(),
}: {
  contracts: readonly CanonicalContractRecord[];
  features: readonly FeatureIdentity[];
  /** Customer-confirmed raw value → canonical feature key. */
  aliases?: ReadonlyMap<string, string>;
}): MatchResult {
  const byKey = new Map(features.map((feature) => [feature.key, feature]));
  const featureKeys = features.map((feature) => feature.key);

  // SKU index. A feature is reachable by SKU only when a contract line already
  // established the SKU→feature pairing by ALSO matching on name, so this never
  // manufactures a link on its own — it propagates a link already justified.
  const skuToKey = new Map<string, string>();
  for (const record of contracts) {
    if (record.sku === null) continue;
    const nameKey = normalizeFeatureKey(record.feature);
    if (byKey.has(nameKey)) skuToKey.set(skuKey(record.sku), nameKey);
  }

  const links: ContractLink[] = [];
  const reviewByKey = new Map<string, ContractReviewItem>();

  for (const record of contracts) {
    const rawLower = record.feature.trim().toLowerCase();
    const nameKey = normalizeFeatureKey(record.feature);

    // 1. Confirmed alias — a human already answered this question.
    const aliased = aliases.get(rawLower);
    if (aliased !== undefined && byKey.has(aliased)) {
      links.push({
        contract: record,
        featureKey: aliased,
        featureId: byKey.get(aliased)!.featureId,
        positionKey: aliased,
        basis: 'confirmed_alias',
        evidence: `"${record.feature}" was confirmed as an alias of ${aliased}.`,
      });
      continue;
    }

    // 2. Identical normalized name.
    if (byKey.has(nameKey)) {
      links.push({
        contract: record,
        featureKey: nameKey,
        featureId: byKey.get(nameKey)!.featureId,
        positionKey: nameKey,
        basis: 'normalized_name',
        evidence: `Contract line "${record.feature}" matches observed feature ${nameKey} exactly once case and separators are normalized.`,
      });
      continue;
    }

    // 3. SKU already tied to a feature by a name match on another line.
    if (record.sku !== null) {
      const viaSku = skuToKey.get(skuKey(record.sku));
      if (viaSku !== undefined && byKey.has(viaSku)) {
        links.push({
          contract: record,
          featureKey: viaSku,
          featureId: byKey.get(viaSku)!.featureId,
          positionKey: viaSku,
          basis: 'sku',
          evidence: `SKU ${record.sku} identifies the same orderable item as feature ${viaSku}, established by another line naming both.`,
        });
        continue;
      }
    }

    // Nothing safe. The line still counts toward spend and renewal exposure;
    // it just cannot be compared against demand until someone confirms it.
    links.push({
      contract: record,
      featureKey: null,
      featureId: null,
      positionKey: nameKey,
      basis: 'unmatched',
      evidence: `No observed feature matches "${record.feature}" exactly, and EngiSignal does not merge names that merely look similar.`,
    });

    const candidates = relatedCandidates(nameKey, featureKeys);
    const existing = reviewByKey.get(nameKey);
    if (existing !== undefined) {
      existing.occurrences += 1;
      if (existing.annualCost !== null && record.annualCost !== null) {
        existing.annualCost += record.annualCost;
      }
      continue;
    }

    reviewByKey.set(nameKey, {
      rawValue: record.feature,
      vendor: matchVendor(record),
      sku: record.sku,
      annualCost: record.annualCost,
      currency: record.currency,
      candidates,
      reason:
        candidates.length > 0
          ? 'This contract line does not exactly match any feature seen in usage, though similarly named features exist.'
          : 'This contract line does not match any feature seen in usage.',
      resolution:
        candidates.length > 0
          ? `Confirm whether "${record.feature}" is the same product as ${candidates.slice(0, 2).join(' or ')}, or import usage that names it.`
          : `Import usage or entitlement data that names "${record.feature}", or confirm which observed feature it corresponds to.`,
      occurrences: 1,
    });
  }

  return { links, review: [...reviewByKey.values()] };
}

/**
 * One priced position per feature, merged across the lines that pay for it.
 *
 * A feature bought on three purchase orders has three lines. Quantities add:
 * they are separate licences and the customer owns all of them. Unit price is a
 * QUANTITY-WEIGHTED average, not a plain one — averaging $4,000 across 10 seats
 * with $6,000 across 990 seats as "$5,000" would misprice the position by
 * hundreds of thousands. Where quantities are unknown the lines cannot be
 * weighted, so the position is left unpriced rather than averaged badly.
 */
export interface MergedPosition {
  featureKey: string;
  quantity: number;
  /** Quantity-weighted annual unit price, or null when not determinable. */
  unitPrice: number | null;
  annualCost: number | null;
  currency: string | null;
  /** Earliest renewal across the contributing lines — the date that binds. */
  renewalDate: string | null;
  contractNumbers: string[];
  purchaseOrders: string[];
  lineCount: number;
  /** True when any contributing line was a multi-year total left unannualized. */
  hasUnannualizedTotal: boolean;
  /** Distinct currencies seen. More than one means the figures are not summable. */
  currencies: string[];
}

export function mergePositions(links: readonly ContractLink[]): Map<string, MergedPosition> {
  const positions = new Map<string, MergedPosition>();
  /** Per position: Σ(unitPrice × quantity) and Σquantity, for weighting. */
  const weighted = new Map<string, { value: number; quantity: number }>();
  /** Distinct supplied unit prices, for the unweightable single-price case. */
  const suppliedPrices = new Map<string, Set<number>>();

  for (const link of links) {
    const record = link.contract;
    const key = link.positionKey;

    const existing = positions.get(key);
    const position: MergedPosition =
      existing ??
      {
        featureKey: key,
        quantity: 0,
        unitPrice: null,
        annualCost: null,
        currency: record.currency,
        renewalDate: null,
        contractNumbers: [],
        purchaseOrders: [],
        lineCount: 0,
        hasUnannualizedTotal: false,
        currencies: [],
      };
    positions.set(key, position);

    position.lineCount += 1;
    position.quantity += record.quantity ?? 0;
    if (record.multiYearTotal && record.annualCost === null) position.hasUnannualizedTotal = true;

    if (record.unitPrice !== null) {
      const prices = suppliedPrices.get(key) ?? new Set<number>();
      suppliedPrices.set(key, prices);
      prices.add(record.unitPrice);

      if (record.quantity !== null && record.quantity > 0) {
        const running = weighted.get(key) ?? { value: 0, quantity: 0 };
        weighted.set(key, {
          value: running.value + record.unitPrice * record.quantity,
          quantity: running.quantity + record.quantity,
        });
      }
    }

    if (record.annualCost !== null) {
      position.annualCost = (position.annualCost ?? 0) + record.annualCost;
    }
    if (record.currency !== null && !position.currencies.includes(record.currency)) {
      position.currencies.push(record.currency);
    }
    if (record.contractNumber !== null && !position.contractNumbers.includes(record.contractNumber)) {
      position.contractNumbers.push(record.contractNumber);
    }
    if (record.purchaseOrder !== null && !position.purchaseOrders.includes(record.purchaseOrder)) {
      position.purchaseOrders.push(record.purchaseOrder);
    }
    // The earliest renewal is the one that forces a decision; a later date on
    // another line does not buy time on this one.
    if (
      record.renewalDate !== null &&
      (position.renewalDate === null || record.renewalDate < position.renewalDate)
    ) {
      position.renewalDate = record.renewalDate;
    }
  }

  // Unit price, in order of how well the evidence supports it.
  //
  // An earlier version derived it ONLY from the merged annual cost, which
  // quietly discarded a price the customer had stated outright whenever the
  // line carried no quantity to annualize it with — the position went unpriced
  // while the file plainly said $5,000 a seat.
  for (const [key, position] of positions) {
    position.currency = position.currencies.length === 1 ? position.currencies[0]! : null;

    // 1. From the merged annual total. Best: consistent with the money shown
    //    beside it, and already reflects every contributing line.
    if (position.annualCost !== null && position.quantity > 0) {
      position.unitPrice = Math.round((position.annualCost / position.quantity) * 100) / 100;
      continue;
    }

    // 2. Quantity-weighted average of the stated prices.
    const running = weighted.get(key);
    if (running !== undefined && running.quantity > 0) {
      position.unitPrice = Math.round((running.value / running.quantity) * 100) / 100;
      continue;
    }

    // 3. A single stated price with no quantity anywhere. Usable as a rate even
    //    though it cannot produce an annual total. Two different prices with no
    //    quantities stay unpriced: they cannot be weighted, and picking one or
    //    averaging them unweighted would both be guesses.
    const prices = suppliedPrices.get(key);
    if (prices !== undefined && prices.size === 1) {
      position.unitPrice = [...prices][0]!;
    }
  }

  return positions;
}
