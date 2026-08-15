/**
 * Data-quality reporting.
 *
 * Answers the question a buyer actually asks: "how much of this can you
 * actually see?" Coverage is measured on the canonical records themselves, and
 * every gap is attributed either to the source's limits or to this particular
 * file — the two mean very different things when a recommendation is
 * challenged.
 */

import { FIELDS_BY_DATASET } from '../adapters/fields';
import type { CanonicalFieldKey, IngestionAdapter } from '../adapters/types';
import type {
  CanonicalDataset,
  CanonicalRecord,
  FieldCoverage,
  QualityReport,
} from './types';

/** Fields a source cannot produce, given its capabilities. */
export function unsupportedFields(adapter: IngestionAdapter): Set<CanonicalFieldKey> {
  const unsupported = new Set<CanonicalFieldKey>();
  const { capabilities } = adapter;

  if (!capabilities.checkoutCheckin) {
    unsupported.add('checkoutAt');
    unsupported.add('checkinAt');
  }
  if (!capabilities.denials) {
    unsupported.add('denied');
    unsupported.add('denialCount');
  }
  if (!capabilities.tokens) unsupported.add('tokens');
  if (!capabilities.concurrency) {
    unsupported.add('concurrent');
    unsupported.add('peak');
  }

  return unsupported;
}

function valueOf(record: CanonicalRecord, key: string): unknown {
  return (record as unknown as Record<string, unknown>)[key];
}

export function buildQualityReport({
  dataset,
  adapter,
  records,
  detectionConfidence,
  mappedFields,
  acceptedRows,
  totalRows,
}: {
  dataset: CanonicalDataset;
  adapter: IngestionAdapter;
  records: readonly CanonicalRecord[];
  detectionConfidence: number;
  mappedFields: ReadonlySet<CanonicalFieldKey>;
  acceptedRows: number;
  totalRows: number;
}): QualityReport {
  const unsupported = unsupportedFields(adapter);
  const total = records.length;

  const coverage: FieldCoverage[] = FIELDS_BY_DATASET[dataset].map((spec) => {
    const populated = records.reduce((count, record) => {
      const value = valueOf(record, spec.key);
      return value === null || value === undefined ? count : count + 1;
    }, 0);

    const supported = !unsupported.has(spec.key);
    let note: string | null = null;

    if (!supported) {
      note = `${adapter.name} exports do not carry this field.`;
    } else if (!mappedFields.has(spec.key)) {
      note = 'No column in this file was mapped to this field.';
    } else if (total > 0 && populated === 0) {
      note = 'A column was mapped but every value was empty.';
    }

    return {
      field: spec.key,
      label: spec.label,
      populated,
      total,
      coveragePct: total === 0 ? 0 : Math.round((populated / total) * 100),
      supportedBySource: supported,
      note,
    };
  });

  const notes: string[] = [...adapter.capabilities.notes];

  if (adapter.capabilities.resolution === 'interval') {
    notes.push(
      'Observations are interval snapshots, so demand spikes shorter than the sampling period are not visible and peak demand may be understated.',
    );
  }
  if (adapter.capabilities.resolution === 'unknown') {
    notes.push(
      'Granularity could not be determined from the file, so peak-demand analysis should be reviewed before it is relied on.',
    );
  }

  const requiredCoverage = coverage.filter((entry) =>
    FIELDS_BY_DATASET[dataset].some((spec) => spec.key === entry.field && spec.required),
  );
  const acceptanceRate = totalRows === 0 ? 0 : acceptedRows / totalRows;
  const requiredComplete =
    requiredCoverage.length === 0
      ? 1
      : requiredCoverage.reduce((total_, entry) => total_ + entry.coveragePct / 100, 0) /
        requiredCoverage.length;

  // Confidence blends three things a reviewer would weigh themselves: did we
  // recognize the source, did the rows survive validation, and are the fields
  // the analysis depends on actually present.
  const confidence = Math.round(
    Math.max(0, Math.min(100, detectionConfidence * 0.3 + acceptanceRate * 100 * 0.4 + requiredComplete * 100 * 0.3)),
  );

  return {
    confidence,
    coverage,
    unsupportedFields: [...unsupported].map(
      (key) => FIELDS_BY_DATASET[dataset].find((spec) => spec.key === key)?.label ?? key,
    ),
    notes,
  };
}
