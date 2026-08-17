/**
 * ── IDENTIFIERS THAT SURVIVE A URL ───────────────────────────────────────────
 *
 * Canonical identities in this product are derived, not assigned: a feature is
 * `feature:<normalized key>` and a contract is `contract:<org>:<normalized key>`.
 * The key is derived from a string the CUSTOMER put in an export file, so its
 * character set is theirs, not ours.
 *
 * Two facts about the App Router make that dangerous, and Phase 2D found both
 * in production at once:
 *
 *   1. A PAGE receives its dynamic segment STILL PERCENT-ENCODED. A route
 *      handler receives the same segment decoded. Every detail page compared
 *      the encoded segment against the decoded identity, so
 *      `feature%3Aansys_mech_ent` never equalled `feature:ansys_mech_ent`, the
 *      lookup missed, and the page answered 404 — for every feature, every
 *      contract and every negotiation brief in the product.
 *
 *   2. A character that is structural in a URL does not survive a path segment
 *      raw. A feature exported as "CATIA/V5" produces the key `catia/v5`, and
 *      the link `/app/portfolio/feature:catia/v5` is a different route with an
 *      extra segment. No amount of decoding recovers that one; it has to be
 *      encoded before it is ever put in an href.
 *
 * So identities are encoded on the way OUT and decoded on the way IN, in one
 * place, and every link is built through these helpers rather than by string
 * interpolation at the call site. A 404 on a real, listed, priced contract is
 * indistinguishable to a customer from "EngiSignal lost my data".
 */

/** Encode a derived identity for use as a single URL path segment. */
export function encodeRouteId(id: string): string {
  return encodeURIComponent(id);
}

/**
 * Read a derived identity back out of a page's dynamic segment.
 *
 * Tolerant by design. A malformed escape sequence — which a hand-typed or
 * truncated URL can easily produce — makes `decodeURIComponent` throw, and an
 * exception here would turn a mistyped address into a 500. The raw segment is
 * returned instead, which then simply fails to match and yields an honest 404.
 */
export function decodeRouteId(param: string): string {
  try {
    return decodeURIComponent(param);
  } catch {
    return param;
  }
}

export function featureHref(featureId: string): string {
  return `/app/portfolio/${encodeRouteId(featureId)}`;
}

export function renewalHref(contractId: string): string {
  return `/app/renewals/${encodeRouteId(contractId)}`;
}

export function renewalBriefHref(contractId: string): string {
  return `/app/renewals/${encodeRouteId(contractId)}/brief`;
}
