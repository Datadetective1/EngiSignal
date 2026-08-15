'use client';

import { useRef, useState } from 'react';
import { Badge, Button, Card, CardHeader, TableShell, Td, Th } from '@/components/ui/primitives';
import { cn } from '@/lib/utils';

/**
 * The customer import workflow.
 *
 * UPLOAD → DETECT → MAP → VALIDATE → PREVIEW → IMPORT → VERIFY.
 *
 * Two principles govern the whole screen:
 *
 *  1. Nothing is applied silently. A mapping that guesses wrong produces
 *     confidently wrong purchasing recommendations, so every proposal is shown
 *     with its confidence and a sample value, and can be overridden.
 *  2. Nothing is claimed that the data does not support. The preview reports
 *     what the file can and cannot answer, and the verify step lists the
 *     analyses that are genuinely unlocked — not the full product catalogue.
 */

// ── Wire types ───────────────────────────────────────────────────────────────

interface ColumnMapping {
  sourceColumn: string;
  field: string | null;
  confidence: 'exact' | 'strong' | 'possible' | 'none';
  score: number;
  sampleValue: string | null;
  matchedAlias: string | null;
}

interface FieldSpec {
  key: string;
  label: string;
  type: string;
  required: boolean;
  description: string;
}

interface Detection {
  source: string;
  name: string;
  confidence: number;
  evidence: string[];
  fellBack: boolean;
}

interface RejectionSummary {
  rule: string;
  field: string | null;
  count: number;
  message: string;
  examples: string[];
}

interface Rejection {
  sourceRow: number;
  sourceSheet: string | null;
  rule: string;
  field: string | null;
  value: string | null;
  message: string;
}

interface FieldCoverage {
  field: string;
  label: string;
  populated: number;
  total: number;
  coveragePct: number;
  supportedBySource: boolean;
  note: string | null;
}

interface Capabilities {
  usageTrends: boolean;
  dailyDemand: boolean;
  percentileDemand: boolean;
  capacityUtilization: boolean;
  financialOpportunity: boolean;
  organizationalBreakdown: boolean;
  denialAnalysis: boolean;
  missing: { capability: string; needs: string }[];
}

interface AnalyzeResponse {
  importId: string;
  fileName: string;
  fileBytes: number;
  dataset: string;
  detection: Detection;
  sheetNames: string[];
  mappings: ColumnMapping[];
  fields: FieldSpec[];
  missingRequired: string[];
  preview: Record<string, unknown>[];
  normalizedPreview: Record<string, unknown>[];
  summary: { totalRows: number; acceptedRows: number; rejectedRows: number; duplicateRows: number };
  rejectionSummary: RejectionSummary[];
  rejections: Rejection[];
  warnings: { code: string; message: string; detail: string | null }[];
  quality: { confidence: number; coverage: FieldCoverage[]; unsupportedFields: string[]; notes: string[] };
  coverage: {
    usageRecords: number;
    entitlementRecords: number;
    peopleRecords: number;
    distinctFeatures: number;
    distinctUsers: number;
    firstDate: string | null;
    lastDate: string | null;
    historyDays: number;
    hasConcurrency: boolean;
    hasDenials: boolean;
  };
  capabilities: Capabilities;
}

interface CommitResponse {
  import: {
    id: string;
    fileName: string;
    sourceSystem: string;
    usageRecords: number;
    entitlementRecords: number;
    peopleRecords: number;
    acceptedRows: number;
    rejectedRows: number;
  };
  detection: Detection;
}

// ── Static config ────────────────────────────────────────────────────────────

const DATASETS = [
  { key: 'usage', label: 'Usage', hint: 'License-manager usage export' },
  { key: 'entitlements', label: 'Entitlements', hint: 'What is owned, per feature' },
  { key: 'people', label: 'People', hint: 'Directory or HR roster' },
] as const;

/**
 * Sources a customer can declare.
 *
 * The wording is deliberate: these import an EXPORT from the tool. EngiSignal
 * does not connect to FlexNet, RLM, DSLS or Sentinel, and this screen must
 * never read as if it does.
 */
const SOURCES = [
  { key: '', label: 'Auto-detect' },
  { key: 'flexnet', label: 'FlexNet export' },
  { key: 'rlm', label: 'RLM export' },
  { key: 'dsls', label: 'DSLS export' },
  { key: 'sentinel', label: 'Sentinel export' },
  { key: 'generic', label: 'Generic export' },
] as const;

const CONFIDENCE_TONE = {
  exact: 'positive',
  strong: 'accent',
  possible: 'warning',
  none: 'neutral',
} as const;

const CONFIDENCE_LABEL = {
  exact: 'Exact',
  strong: 'Strong',
  possible: 'Possible',
  none: 'Not mapped',
} as const;

type Stage = 'upload' | 'review' | 'done';

export function IngestionWorkflow() {
  const [dataset, setDataset] = useState<string>('usage');
  const [forceSource, setForceSource] = useState<string>('');
  const [dayFirst, setDayFirst] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [analysis, setAnalysis] = useState<AnalyzeResponse | null>(null);
  const [committed, setCommitted] = useState<CommitResponse | null>(null);
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  const [showRejections, setShowRejections] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const stage: Stage = committed !== null ? 'done' : analysis !== null ? 'review' : 'upload';

  const post = async (endpoint: string, mappingOverrides?: Record<string, string>) => {
    if (file === null) {
      setError('Choose a file first.');
      return null;
    }
    setBusy(true);
    setError(null);

    try {
      const form = new FormData();
      form.append('file', file);
      form.append('dataset', dataset);
      if (forceSource.length > 0) form.append('forceSource', forceSource);
      if (dayFirst) form.append('dayFirst', 'true');
      if (mappingOverrides !== undefined) {
        form.append('mappingOverrides', JSON.stringify(mappingOverrides));
      }

      const response = await fetch(endpoint, { method: 'POST', body: form });
      const payload = await response.json();

      if (!response.ok) {
        setError(typeof payload.error === 'string' ? payload.error : 'The file could not be processed.');
        return null;
      }
      return payload;
    } catch {
      setError('The upload failed. Check the file and try again.');
      return null;
    } finally {
      setBusy(false);
    }
  };

  const analyze = async (mappingOverrides?: Record<string, string>) => {
    const payload = (await post('/api/ingestion/analyze', mappingOverrides)) as AnalyzeResponse | null;
    if (payload !== null) {
      setAnalysis(payload);
      if (mappingOverrides === undefined) setOverrides({});
    }
  };

  const commit = async () => {
    const payload = (await post('/api/ingestion/commit', overrides)) as CommitResponse | null;
    if (payload !== null) setCommitted(payload);
  };

  const reset = () => {
    setFile(null);
    setAnalysis(null);
    setCommitted(null);
    setOverrides({});
    setError(null);
    setShowRejections(false);
    if (inputRef.current !== null) inputRef.current.value = '';
  };

  const changeMapping = (sourceColumn: string, field: string) => {
    const next = { ...overrides, [sourceColumn]: field };
    setOverrides(next);
    void analyze(next);
  };

  return (
    <div className="space-y-5">
      <StageRail stage={stage} />

      {error !== null && (
        <p
          role="alert"
          className="rounded-lg border border-danger/40 bg-danger-soft px-4 py-3 text-[13px] text-danger"
        >
          {error}
        </p>
      )}

      {stage !== 'done' && (
        <UploadCard
          dataset={dataset}
          setDataset={setDataset}
          forceSource={forceSource}
          setForceSource={setForceSource}
          dayFirst={dayFirst}
          setDayFirst={setDayFirst}
          file={file}
          setFile={setFile}
          inputRef={inputRef}
          busy={busy}
          onAnalyze={() => void analyze()}
          locked={analysis !== null}
          onReset={reset}
        />
      )}

      {analysis !== null && stage === 'review' && (
        <>
          <DetectionCard detection={analysis.detection} sheetNames={analysis.sheetNames} />
          <MappingCard
            mappings={analysis.mappings}
            fields={analysis.fields}
            missingRequired={analysis.missingRequired}
            onChange={changeMapping}
            busy={busy}
          />
          <ValidationCard
            summary={analysis.summary}
            warnings={analysis.warnings}
            rejectionSummary={analysis.rejectionSummary}
            rejections={analysis.rejections}
            showRejections={showRejections}
            toggleRejections={() => setShowRejections((open) => !open)}
          />
          <PreviewCard
            rows={analysis.normalizedPreview}
            dataset={analysis.dataset}
            quality={analysis.quality}
            coverage={analysis.coverage}
          />
          <ImportCard
            accepted={analysis.summary.acceptedRows}
            blocked={analysis.missingRequired.length > 0 || analysis.summary.acceptedRows === 0}
            busy={busy}
            onCommit={() => void commit()}
          />
        </>
      )}

      {committed !== null && analysis !== null && (
        <VerifyCard
          committed={committed}
          coverage={analysis.coverage}
          capabilities={analysis.capabilities}
          onReset={reset}
        />
      )}
    </div>
  );
}

// ── Stage rail ───────────────────────────────────────────────────────────────

const STAGES = ['Upload', 'Detect', 'Map', 'Validate', 'Preview', 'Import', 'Verify'] as const;

function StageRail({ stage }: { stage: Stage }) {
  const reached = stage === 'upload' ? 1 : stage === 'review' ? 5 : 7;

  return (
    <ol className="es-scroll flex gap-1.5 overflow-x-auto pb-1" aria-label="Import progress">
      {STAGES.map((label, index) => {
        const done = index < reached;
        return (
          <li key={label} className="flex shrink-0 items-center gap-1.5">
            <span
              className={cn(
                'rounded-md border px-2.5 py-1 text-[11.5px] font-medium',
                done
                  ? 'border-accent/40 bg-accent-soft text-accent'
                  : 'border-border bg-surface text-fg-subtle',
              )}
            >
              {label}
            </span>
            {index < STAGES.length - 1 && (
              <span className="text-[11px] text-fg-subtle" aria-hidden="true">
                →
              </span>
            )}
          </li>
        );
      })}
    </ol>
  );
}

// ── Upload ───────────────────────────────────────────────────────────────────

function UploadCard({
  dataset,
  setDataset,
  forceSource,
  setForceSource,
  dayFirst,
  setDayFirst,
  file,
  setFile,
  inputRef,
  busy,
  onAnalyze,
  locked,
  onReset,
}: {
  dataset: string;
  setDataset: (value: string) => void;
  forceSource: string;
  setForceSource: (value: string) => void;
  dayFirst: boolean;
  setDayFirst: (value: boolean) => void;
  file: File | null;
  setFile: (value: File | null) => void;
  inputRef: React.RefObject<HTMLInputElement | null>;
  busy: boolean;
  onAnalyze: () => void;
  locked: boolean;
  onReset: () => void;
}) {
  return (
    <Card>
      <CardHeader
        title="Import engineering software data"
        description="Upload an export from your license manager. EngiSignal reads it as it is — there is no template to conform to."
      />

      <div className="space-y-5 px-5 py-5">
        <fieldset>
          <legend className="mb-2 text-[12px] font-medium text-fg">What is in this file</legend>
          <div className="flex flex-wrap gap-2">
            {DATASETS.map((option) => (
              <button
                key={option.key}
                type="button"
                onClick={() => setDataset(option.key)}
                aria-pressed={dataset === option.key}
                className={cn(
                  'rounded-md border px-3 py-2 text-left transition-colors',
                  dataset === option.key
                    ? 'border-accent/50 bg-accent-soft'
                    : 'border-border bg-surface hover:bg-surface-2',
                )}
              >
                <span className="block text-[13px] font-medium text-fg">{option.label}</span>
                <span className="block text-[11.5px] text-fg-muted">{option.hint}</span>
              </button>
            ))}
          </div>
        </fieldset>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="source" className="mb-1.5 block text-[12px] font-medium text-fg">
              Source
            </label>
            <select
              id="source"
              value={forceSource}
              onChange={(event) => setForceSource(event.target.value)}
              className="h-10 w-full rounded-md border border-border bg-surface px-2.5 text-[13.5px] text-fg focus:border-accent focus:outline-none"
            >
              {SOURCES.map((source) => (
                <option key={source.key} value={source.key}>
                  {source.label}
                </option>
              ))}
            </select>
            <p className="mt-1.5 text-[11.5px] text-fg-subtle">
              These read an export you already have. EngiSignal does not connect to a license server.
            </p>
          </div>

          <div>
            <label htmlFor="file" className="mb-1.5 block text-[12px] font-medium text-fg">
              File
            </label>
            <input
              ref={inputRef}
              id="file"
              type="file"
              accept=".csv,.tsv,.xlsx,.xlsm"
              onChange={(event) => setFile(event.target.files?.[0] ?? null)}
              className="block w-full text-[12.5px] text-fg-muted file:mr-3 file:rounded-md file:border file:border-border file:bg-surface-2 file:px-3 file:py-2 file:text-[12.5px] file:font-medium file:text-fg hover:file:bg-surface-3"
            />
            <p className="mt-1.5 text-[11.5px] text-fg-subtle">
              CSV, TSV, XLSX or XLSM. Legacy .xls is not supported — save it as .xlsx first.
            </p>
          </div>
        </div>

        <label className="flex items-start gap-2.5 text-[12.5px] text-fg-muted">
          <input
            type="checkbox"
            checked={dayFirst}
            onChange={(event) => setDayFirst(event.target.checked)}
            className="mt-0.5 size-4 accent-[var(--es-accent)]"
          />
          <span>
            Dates are day-first (DD/MM/YYYY).{' '}
            <span className="text-fg-subtle">
              EngiSignal does not guess this: 03/04/2026 is genuinely ambiguous, and guessing wrong
              moves usage into the wrong month.
            </span>
          </span>
        </label>

        <div className="flex flex-wrap items-center gap-3">
          <Button variant="primary" onClick={onAnalyze} disabled={busy || file === null}>
            {busy ? 'Reading…' : locked ? 'Re-analyze' : 'Analyze file'}
          </Button>
          {locked && (
            <Button onClick={onReset} disabled={busy}>
              Start over
            </Button>
          )}
        </div>
      </div>
    </Card>
  );
}

// ── Detect ───────────────────────────────────────────────────────────────────

function DetectionCard({ detection, sheetNames }: { detection: Detection; sheetNames: string[] }) {
  // The engine's own confidence, unembellished. Rounding it up to "certain"
  // would be the first step toward trusting a wrong mapping.
  const band =
    detection.confidence >= 85 ? 'High' : detection.confidence >= 55 ? 'Moderate' : 'Low';

  return (
    <Card>
      <CardHeader title="Detected source" description="What EngiSignal recognized, and the evidence for it." />
      <div className="space-y-4 px-5 py-5">
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-[22px] font-semibold tracking-[-0.02em] text-fg">{detection.name}</span>
          <Badge tone={detection.fellBack ? 'warning' : band === 'High' ? 'positive' : 'accent'}>
            {detection.fellBack ? 'Not identified' : `${band} · ${detection.confidence}%`}
          </Badge>
        </div>

        {detection.fellBack && (
          <p className="rounded-md border border-warning/40 bg-warning-soft px-3.5 py-2.5 text-[12.5px] text-warning">
            No license manager matched with enough confidence, so generic mapping was used. Review every
            column below before importing.
          </p>
        )}

        <ul className="space-y-1.5">
          {detection.evidence.map((item) => (
            <li key={item} className="flex gap-2.5 text-[12.5px] leading-relaxed text-fg-muted">
              <span className="mt-[7px] size-1 shrink-0 rounded-full bg-accent" aria-hidden="true" />
              {item}
            </li>
          ))}
        </ul>

        {sheetNames.length > 0 && (
          <p className="text-[12px] text-fg-subtle">
            Worksheets read: {sheetNames.join(', ')}
          </p>
        )}
      </div>
    </Card>
  );
}

// ── Map ──────────────────────────────────────────────────────────────────────

function MappingCard({
  mappings,
  fields,
  missingRequired,
  onChange,
  busy,
}: {
  mappings: ColumnMapping[];
  fields: FieldSpec[];
  missingRequired: string[];
  onChange: (sourceColumn: string, field: string) => void;
  busy: boolean;
}) {
  const labelFor = (key: string | null) =>
    key === null ? null : (fields.find((field) => field.key === key)?.label ?? key);

  return (
    <Card>
      <CardHeader
        title="Column mapping"
        description="Every proposal is shown with its confidence and a real value from your file. Change any of them."
      />

      {missingRequired.length > 0 && (
        <p className="mx-5 mt-4 rounded-md border border-danger/40 bg-danger-soft px-3.5 py-2.5 text-[12.5px] text-danger">
          Required and not yet mapped: {missingRequired.join(', ')}. Map these before importing.
        </p>
      )}

      <div className="px-5 py-5">
        <TableShell>
          <thead>
            <tr>
              <Th>Source column</Th>
              <Th>EngiSignal field</Th>
              <Th>Confidence</Th>
              <Th>Sample value</Th>
              <Th>Status</Th>
            </tr>
          </thead>
          <tbody>
            {mappings.map((mapping) => (
              <tr key={mapping.sourceColumn}>
                <Td className="font-medium text-fg">{mapping.sourceColumn}</Td>
                <Td>
                  <select
                    aria-label={`Map ${mapping.sourceColumn}`}
                    value={mapping.field ?? ''}
                    disabled={busy}
                    onChange={(event) => onChange(mapping.sourceColumn, event.target.value)}
                    className="h-8 w-full min-w-[150px] rounded-md border border-border bg-surface px-2 text-[12.5px] text-fg focus:border-accent focus:outline-none"
                  >
                    <option value="">Not mapped</option>
                    {fields.map((field) => (
                      <option key={field.key} value={field.key}>
                        {field.label}
                        {field.required ? ' *' : ''}
                      </option>
                    ))}
                  </select>
                </Td>
                <Td>
                  {mapping.field === null ? (
                    <span className="text-fg-subtle">—</span>
                  ) : (
                    <span className="tnum">{mapping.score}%</span>
                  )}
                </Td>
                <Td className="text-fg-muted">{mapping.sampleValue ?? '—'}</Td>
                <Td>
                  <Badge tone={CONFIDENCE_TONE[mapping.confidence]}>
                    {mapping.field === null ? 'Optional' : CONFIDENCE_LABEL[mapping.confidence]}
                  </Badge>
                </Td>
              </tr>
            ))}
          </tbody>
        </TableShell>

        <p className="mt-3 text-[11.5px] leading-relaxed text-fg-subtle">
          Unmapped columns are not imported. {labelFor('user') !== null && 'A client workstation column is deliberately not treated as a license server — mapping it there would attribute demand to the wrong pool.'}
        </p>
      </div>
    </Card>
  );
}

// ── Validate ─────────────────────────────────────────────────────────────────

function ValidationCard({
  summary,
  warnings,
  rejectionSummary,
  rejections,
  showRejections,
  toggleRejections,
}: {
  summary: { totalRows: number; acceptedRows: number; rejectedRows: number; duplicateRows: number };
  warnings: { code: string; message: string; detail: string | null }[];
  rejectionSummary: RejectionSummary[];
  rejections: Rejection[];
  showRejections: boolean;
  toggleRejections: () => void;
}) {
  const balanced = summary.acceptedRows + summary.rejectedRows === summary.totalRows;

  return (
    <Card>
      <CardHeader title="Validation" description="Every row is accounted for. Nothing is discarded quietly." />

      <div className="space-y-5 px-5 py-5">
        <div className="grid gap-3 sm:grid-cols-4">
          <Stat label="Rows read" value={summary.totalRows} />
          <Stat label="Accepted" value={summary.acceptedRows} tone="positive" />
          <Stat label="Rejected" value={summary.rejectedRows} tone={summary.rejectedRows > 0 ? 'danger' : 'neutral'} />
          <Stat label="Warnings" value={warnings.length} tone={warnings.length > 0 ? 'warning' : 'neutral'} />
        </div>

        {balanced && (
          <p className="text-[11.5px] text-fg-subtle">
            {summary.acceptedRows.toLocaleString('en-US')} accepted +{' '}
            {summary.rejectedRows.toLocaleString('en-US')} rejected ={' '}
            {summary.totalRows.toLocaleString('en-US')} rows read.
            {summary.duplicateRows > 0 &&
              ` ${summary.duplicateRows.toLocaleString('en-US')} of the rejections were duplicates.`}
          </p>
        )}

        {rejectionSummary.length > 0 && (
          <div>
            <p className="mb-2 text-[12px] font-medium text-fg">Why rows were rejected</p>
            <ul className="space-y-1.5">
              {rejectionSummary.map((group) => (
                <li
                  key={`${group.rule}:${group.field ?? ''}`}
                  className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-[12.5px]"
                >
                  <span className="tnum font-semibold text-fg">{group.count.toLocaleString('en-US')}</span>
                  <span className="text-fg-muted">{group.message}</span>
                  {group.examples.length > 0 && (
                    <span className="text-fg-subtle">e.g. {group.examples.join(', ')}</span>
                  )}
                </li>
              ))}
            </ul>

            <Button size="sm" className="mt-3" onClick={toggleRejections}>
              {showRejections ? 'Hide rejected rows' : 'Inspect rejected rows'}
            </Button>

            {showRejections && (
              <div className="mt-3">
                <TableShell>
                  <thead>
                    <tr>
                      <Th>Row</Th>
                      <Th>Sheet</Th>
                      <Th>Field</Th>
                      <Th>Value</Th>
                      <Th>Reason</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {rejections.map((rejection, index) => (
                      <tr key={`${rejection.sourceRow}-${rejection.rule}-${index}`}>
                        <Td className="tnum">{rejection.sourceRow}</Td>
                        <Td className="text-fg-muted">{rejection.sourceSheet ?? '—'}</Td>
                        <Td className="text-fg-muted">{rejection.field ?? '—'}</Td>
                        <Td className="text-fg-muted">{rejection.value ?? '—'}</Td>
                        <Td className="text-fg-muted">{rejection.message}</Td>
                      </tr>
                    ))}
                  </tbody>
                </TableShell>
              </div>
            )}
          </div>
        )}

        {warnings.length > 0 && (
          <div>
            <p className="mb-2 text-[12px] font-medium text-fg">Warnings</p>
            <ul className="space-y-1.5">
              {warnings.slice(0, 8).map((warning, index) => (
                <li key={`${warning.code}-${index}`} className="text-[12.5px] text-fg-muted">
                  {warning.message}
                  {warning.detail !== null && <span className="text-fg-subtle"> {warning.detail}</span>}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </Card>
  );
}

function Stat({ label, value, tone = 'neutral' }: { label: string; value: number; tone?: 'neutral' | 'positive' | 'danger' | 'warning' }) {
  return (
    <div className="rounded-lg border border-border bg-surface-2 px-4 py-3">
      <p className="text-[11px] font-medium uppercase tracking-[0.1em] text-fg-subtle">{label}</p>
      <p
        className={cn(
          'tnum mt-1 text-[22px] font-semibold leading-none tracking-[-0.03em]',
          tone === 'positive' && 'text-positive',
          tone === 'danger' && 'text-danger',
          tone === 'warning' && 'text-warning',
          tone === 'neutral' && 'text-fg',
        )}
      >
        {value.toLocaleString('en-US')}
      </p>
    </div>
  );
}

// ── Preview ──────────────────────────────────────────────────────────────────

function PreviewCard({
  rows,
  dataset,
  quality,
  coverage,
}: {
  rows: Record<string, unknown>[];
  dataset: string;
  quality: AnalyzeResponse['quality'];
  coverage: AnalyzeResponse['coverage'];
}) {
  const columns = rows.length > 0 ? Object.keys(rows[0]!) : [];

  const coverageRows = [
    { label: 'Usage history', ok: coverage.usageRecords > 0, detail: `${coverage.usageRecords.toLocaleString('en-US')} records` },
    { label: 'Concurrent demand', ok: coverage.hasConcurrency, detail: coverage.hasConcurrency ? 'Available' : 'Not supplied' },
    { label: 'Denials', ok: coverage.hasDenials, detail: coverage.hasDenials ? 'Available' : 'Not supplied' },
    { label: 'Entitlements', ok: coverage.entitlementRecords > 0, detail: coverage.entitlementRecords > 0 ? `${coverage.entitlementRecords} records` : 'Not supplied' },
    { label: 'People', ok: coverage.peopleRecords > 0, detail: coverage.peopleRecords > 0 ? `${coverage.peopleRecords} records` : 'Not supplied' },
    { label: 'Cost', ok: false, detail: 'Missing — not carried by license exports' },
  ];

  return (
    <Card>
      <CardHeader
        title="Normalized preview"
        description={`How these rows look as EngiSignal ${dataset} records — not as your spreadsheet.`}
      />

      <div className="space-y-5 px-5 py-5">
        {rows.length === 0 ? (
          <p className="text-[13px] text-fg-muted">No records would be created from this file.</p>
        ) : (
          <div className="es-scroll overflow-x-auto">
            <TableShell>
              <thead>
                <tr>
                  {columns.map((column) => (
                    <Th key={column}>{humanize(column)}</Th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row, index) => (
                  <tr key={index}>
                    {columns.map((column) => (
                      <Td key={column} className={row[column] === null ? 'text-fg-subtle' : 'text-fg-muted'}>
                        {formatCell(row[column])}
                      </Td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </TableShell>
          </div>
        )}

        <div>
          <p className="mb-2 text-[12px] font-medium text-fg">Data coverage</p>
          <ul className="grid gap-1.5 sm:grid-cols-2">
            {coverageRows.map((row) => (
              <li key={row.label} className="flex items-center justify-between gap-3 rounded-md border border-border bg-surface-2 px-3 py-2">
                <span className="text-[12.5px] text-fg">{row.label}</span>
                <Badge tone={row.ok ? 'positive' : 'neutral'}>{row.detail}</Badge>
              </li>
            ))}
          </ul>
        </div>

        {quality.notes.length > 0 && (
          <div>
            <p className="mb-2 text-[12px] font-medium text-fg">What this source can and cannot show</p>
            <ul className="space-y-1.5">
              {quality.notes.map((note) => (
                <li key={note} className="text-[12px] leading-relaxed text-fg-subtle">
                  {note}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </Card>
  );
}

function humanize(key: string): string {
  return key
    .replace(/([A-Z])/g, ' $1')
    .replace(/^./, (character) => character.toUpperCase())
    .trim();
}

function formatCell(value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  const text = String(value);
  return text.length > 32 ? `${text.slice(0, 32)}…` : text;
}

// ── Import ───────────────────────────────────────────────────────────────────

function ImportCard({
  accepted,
  blocked,
  busy,
  onCommit,
}: {
  accepted: number;
  blocked: boolean;
  busy: boolean;
  onCommit: () => void;
}) {
  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-4 px-5 py-5">
        <div>
          <p className="text-[14px] font-semibold text-fg">
            Import {accepted.toLocaleString('en-US')} records
          </p>
          <p className="mt-1 text-[12.5px] text-fg-muted">
            Rejected rows are kept as an audit record and are never used in analysis.
          </p>
        </div>
        <Button variant="primary" onClick={onCommit} disabled={busy || blocked}>
          {busy ? 'Importing…' : `Import ${accepted.toLocaleString('en-US')} records`}
        </Button>
      </div>
    </Card>
  );
}

// ── Verify ───────────────────────────────────────────────────────────────────

function VerifyCard({
  committed,
  coverage,
  capabilities,
  onReset,
}: {
  committed: CommitResponse;
  coverage: AnalyzeResponse['coverage'];
  capabilities: Capabilities;
  onReset: () => void;
}) {
  const unlocked = [
    { label: 'Usage trends', ok: capabilities.usageTrends },
    { label: 'Daily demand', ok: capabilities.dailyDemand },
    { label: 'P95 demand', ok: capabilities.percentileDemand },
    { label: 'Capacity utilization', ok: capabilities.capacityUtilization },
    { label: 'Usage by organization', ok: capabilities.organizationalBreakdown },
    { label: 'Unmet demand', ok: capabilities.denialAnalysis },
  ].filter((entry) => entry.ok);

  return (
    <Card>
      <CardHeader title="Import complete" description="What was stored, and what it now supports." />

      <div className="space-y-5 px-5 py-5">
        <div className="grid gap-3 sm:grid-cols-4">
          <Stat label="Usage records" value={committed.import.usageRecords} tone="positive" />
          <Stat label="Users" value={coverage.distinctUsers} />
          <Stat label="Features" value={coverage.distinctFeatures} />
          <Stat label="History (days)" value={coverage.historyDays} />
        </div>

        <p className="text-[12.5px] text-fg-muted">
          Source: <span className="font-medium text-fg">{committed.detection.name}</span>
          {coverage.firstDate !== null && coverage.lastDate !== null && (
            <>
              {' · '}
              {coverage.firstDate} to {coverage.lastDate}
            </>
          )}
        </p>

        {unlocked.length > 0 && (
          <div>
            <p className="mb-2 text-[11px] font-medium uppercase tracking-[0.11em] text-fg-subtle">
              EngiSignal can now analyze
            </p>
            <ul className="grid gap-1.5 sm:grid-cols-2">
              {unlocked.map((entry) => (
                <li key={entry.label} className="flex items-center gap-2 text-[13px] text-fg">
                  <span className="text-positive" aria-hidden="true">
                    ✓
                  </span>
                  {entry.label}
                </li>
              ))}
            </ul>
          </div>
        )}

        {capabilities.missing.length > 0 && (
          <div>
            <p className="mb-2 text-[11px] font-medium uppercase tracking-[0.11em] text-fg-subtle">
              Add more context to unlock
            </p>
            <ul className="space-y-2">
              {capabilities.missing.map((entry) => (
                <li
                  key={entry.capability}
                  className="flex flex-wrap items-baseline gap-x-2 rounded-md border border-border bg-surface-2 px-3 py-2 text-[12.5px]"
                >
                  <span className="font-medium text-fg">{entry.needs}</span>
                  <span className="text-fg-subtle">→ {entry.capability}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="flex flex-wrap gap-3">
          <Button variant="primary" onClick={onReset}>
            Import another file
          </Button>
        </div>
      </div>
    </Card>
  );
}
