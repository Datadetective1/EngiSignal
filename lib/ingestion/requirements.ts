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

  if (dataset === 'contracts') {
    // Identity only. A commercial line is identified by whichever of feature,
    // product or SKU the document happens to use — procurement writes "Ansys
    // Mechanical Enterprise" where the license server says "ansys_mech_ent",
    // and a renewal schedule that names only the SKU is still a real document.
    //
    // Whether the row carries anything worth storing is a question about its
    // VALUES, not its columns, so it is enforced in the normalizer where the
    // values are visible. Requiring a price here would reject renewal-date-only
    // schedules, which are exactly the files that unlock renewal exposure.
    if (mapped.has('product') || mapped.has('sku')) return [];
    return ['feature'];
  }

  return ['user'];
}
