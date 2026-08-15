/**
 * What a dataset actually requires, given what the file carries.
 *
 * ONE definition, used by both the normalizer and the pre-import gate. They
 * disagreed once: normalization accepted a Sentinel export by taking the date
 * from its sample-time column, while the gate still reported Date as missing
 * and refused the import. The file was importable and the product said it was
 * not, which is the worst kind of wrong — a correct file rejected for a reason
 * that is not true.
 *
 * The substitutions below are readings of data the source already supplied,
 * never inventions:
 *
 *  - `date` may come from a timestamp column. Same instant, both parsed as UTC.
 *  - `feature` may come from the product column. Files that name only the
 *    product carry the feature identity there.
 *
 * Both are surfaced as warnings at analysis time so the customer sees the
 * substitution rather than discovering it later.
 */

import type { CanonicalDataset } from './canonical/types';
import type { CanonicalFieldKey } from './adapters/types';

export function effectiveRequiredFields(
  dataset: CanonicalDataset,
  mapped: ReadonlySet<CanonicalFieldKey>,
): CanonicalFieldKey[] {
  const featureRequired = !mapped.has('product');

  if (dataset === 'usage') {
    const hasTimestamp = mapped.has('observedAt') || mapped.has('checkoutAt');
    const keys: CanonicalFieldKey[] = [];
    if (!hasTimestamp || mapped.has('date')) keys.push('date');
    if (featureRequired) keys.push('feature');
    return keys;
  }

  if (dataset === 'entitlements') {
    return featureRequired ? ['feature', 'entitledQuantity'] : ['entitledQuantity'];
  }

  return ['user'];
}
