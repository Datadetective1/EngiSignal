'use client';

import { useState } from 'react';
import { Badge, Button, Card, CardHeader, TableShell, Td, Th } from '@/components/ui/primitives';
import { cn } from '@/lib/utils';

/**
 * The import workflow: upload → map → validate.
 *
 * Suggested mappings are always presented for confirmation. A silently applied
 * wrong mapping produces confidently wrong purchasing recommendations, which is
 * the worst failure this product can have.
 */

interface SchemaField {
  key: string;
  label: string;
  description: string;
  required: boolean;
  type: string;
}

interface Suggestion {
  sourceColumn: string;
  field: string | null;
  confidence: 'exact' | 'strong' | 'possible' | 'none';
  score: number;
}

interface ValidationIssue {
  field: string;
  rule: string;
  count: number;
  examples: string[];
}

interface AnalyzeResponse {
  fileName: string;
  fileBytes: number;
  kind: string;
  schema: { label: string; fields: SchemaField[] };
  headers: string[];
  suggestions: Suggestion[];
  mapping: Record<string, string>;
  missingRequired: string[];
  missingOptional: string[];
  preview: Record<string, unknown>[];
  parsedRows: number;
  truncated: boolean;
  parseErrors: string[];
  validation: {
    totalRows: number;
    acceptedRows: number;
    rejectedRows: number;
    issues: ValidationIssue[];
    distinct: { field: string; count: number; samples: string[] }[];
  };
}

const KINDS = [
  { key: 'usage', label: 'Usage', hint: 'License-manager usage export' },
  { key: 'employees', label: 'Employees', hint: 'HR or directory roster' },
  { key: 'contracts', label: 'Contracts', hint: 'Procurement contract extract' },
  { key: 'assignments', label: 'Assignments', hint: 'Named-user seat allocations' },
  { key: 'denials', label: 'Denials', hint: 'Denied license requests' },
] as const;

const CONFIDENCE_TONE = {
  exact: 'positive',
  strong: 'accent',
  possible: 'warning',
  none: 'neutral',
} as const;

const CONFIDENCE_LABEL = {
  exact: 'Exact match',
  strong: 'Strong match',
  possible: 'Possible match',
  none: 'Not mapped',
} as const;

export function ImportWorkflow({ savedMappings }: { savedMappings: { id: string; name: string; kind: string; fields: Record<string, string> }[] }) {
  const [kind, setKind] = useState<string>('usage');
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<AnalyzeResponse | null>(null);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const analyze = async (confirmedMapping?: Record<string, string>) => {
    if (file === null) {
      setError('Choose a CSV or XLSX file first.');
      return;
    }
    setBusy(true);
    setError(null);

    try {
      const form = new FormData();
      form.append('file', file);
      form.append('kind', kind);
      if (confirmedMapping !== undefined) form.append('mapping', JSON.stringify(confirmedMapping));

      const response = await fetch('/api/import/analyze', { method: 'POST', body: form });
      const payload = await response.json();

      if (!response.ok) {
        setError(typeof payload.error === 'string' ? payload.error : 'The file could not be analyzed.');
        setBusy(false);
        return;
      }

      setResult(payload as AnalyzeResponse);
      setMapping((payload as AnalyzeResponse).mapping);
    } catch {
      setError('The upload failed. Check the file and try again.');
    } finally {
      setBusy(false);
    }
  };

  const applyMappingChange = (column: string, field: string) => {
    setMapping((current) => {
      const next = { ...current };
      // A canonical field can only be filled once — clear any prior holder so
      // two columns never collapse into one field.
      for (const [key, value] of Object.entries(next)) {
        if (value === field && key !== column) delete next[key];
      }
      if (field.length === 0) delete next[column];
      else next[column] = field;
      return next;
    });
  };

  const loadSavedMapping = (id: string) => {
    const saved = savedMappings.find((m) => m.id === id);
    if (saved === undefined) return;
    setKind(saved.kind);
    setMapping(saved.fields);
  };

  const validation = result?.validation;
  const acceptRate =
    validation === undefined || validation.totalRows === 0
      ? 0
      : (validation.acceptedRows / validation.totalRows) * 100;

  return (
    <div className="space-y-5">
      {/* ── Step 1 ─────────────────────────────────────────────────────── */}
      <Card>
        <CardHeader
          title="1 · Choose the data and the file"
          description="EngiSignal reads whatever column names your export already uses. There is no template to conform to."
        />
        <div className="space-y-5 px-5 py-5">
          <div>
            <p className="mb-2 text-[12px] font-medium text-fg">Data type</p>
            <div className="flex flex-wrap gap-2">
              {KINDS.map((option) => (
                <button
                  key={option.key}
                  type="button"
                  onClick={() => {
                    setKind(option.key);
                    setResult(null);
                  }}
                  className={cn(
                    'rounded-md border px-3 py-2 text-left transition-colors',
                    kind === option.key
                      ? 'border-accent bg-accent-soft'
                      : 'border-border hover:bg-surface-2',
                  )}
                >
                  <span
                    className={cn(
                      'block text-[12.5px] font-medium',
                      kind === option.key ? 'text-accent' : 'text-fg',
                    )}
                  >
                    {option.label}
                  </span>
                  <span className="block text-[11px] text-fg-subtle">{option.hint}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-wrap items-end gap-3">
            <div className="min-w-0 flex-1">
              <label htmlFor="import-file" className="mb-1.5 block text-[12px] font-medium text-fg">
                File
              </label>
              <input
                id="import-file"
                type="file"
                accept=".csv,.tsv,.txt,.xlsx,.xlsm"
                onChange={(event) => {
                  setFile(event.target.files?.[0] ?? null);
                  setResult(null);
                  setError(null);
                }}
                className="block w-full text-[12.5px] text-fg-muted file:mr-3 file:h-8 file:cursor-pointer file:rounded-md file:border file:border-border file:bg-surface-2 file:px-3 file:text-[12.5px] file:font-medium file:text-fg"
              />
            </div>
            <Button variant="primary" onClick={() => analyze()} disabled={busy || file === null}>
              {busy ? 'Analyzing…' : 'Analyze file'}
            </Button>
          </div>

          {savedMappings.length > 0 && (
            <div>
              <p className="mb-1.5 text-[12px] font-medium text-fg">Reuse a saved mapping</p>
              <div className="flex flex-wrap gap-2">
                {savedMappings.map((saved) => (
                  <button
                    key={saved.id}
                    type="button"
                    onClick={() => loadSavedMapping(saved.id)}
                    className="rounded-md border border-border px-2.5 py-1 text-[11.5px] font-medium text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg"
                  >
                    {saved.name}
                  </button>
                ))}
              </div>
            </div>
          )}

          {error !== null && (
            <p className="rounded-md border border-danger/40 bg-danger-soft px-3.5 py-2.5 text-[12.5px] text-danger">
              {error}
            </p>
          )}
        </div>
      </Card>

      {result !== null && (
        <>
          {/* ── Step 2 ───────────────────────────────────────────────────── */}
          <Card>
            <CardHeader
              title="2 · Confirm the field mapping"
              description={`${result.headers.length} columns found in ${result.fileName}. Adjust anything EngiSignal guessed wrong before continuing.`}
              action={
                <Button onClick={() => analyze(mapping)} disabled={busy}>
                  {busy ? 'Revalidating…' : 'Apply mapping'}
                </Button>
              }
            />

            {result.missingRequired.length > 0 && (
              <p className="border-b border-border bg-warning-soft px-5 py-2.5 text-[12.5px] text-warning">
                Required field{result.missingRequired.length === 1 ? '' : 's'} not yet mapped:{' '}
                <span className="font-medium">{result.missingRequired.join(', ')}</span>
              </p>
            )}

            <TableShell>
              <thead>
                <tr>
                  <Th>Source column</Th>
                  <Th>Sample values</Th>
                  <Th>Maps to</Th>
                  <Th>Match</Th>
                </tr>
              </thead>
              <tbody>
                {result.headers.map((header) => {
                  const suggestion = result.suggestions.find((s) => s.sourceColumn === header);
                  const samples = result.preview
                    .map((row) => row[header])
                    .filter((value) => value !== null && value !== undefined && String(value).trim().length > 0)
                    .slice(0, 3)
                    .map((value) => String(value).slice(0, 24));

                  return (
                    <tr key={header} className="hover:bg-surface-2">
                      <Td>
                        <code className="text-[11.5px] text-fg">{header}</code>
                      </Td>
                      <Td className="text-[11.5px] text-fg-subtle">
                        {samples.length === 0 ? '—' : samples.join(' · ')}
                      </Td>
                      <Td>
                        <select
                          value={mapping[header] ?? ''}
                          onChange={(event) => applyMappingChange(header, event.target.value)}
                          aria-label={`Map column ${header}`}
                          className="h-7 w-full min-w-[170px] rounded-md border border-border bg-surface px-1.5 text-[11.5px] text-fg focus:border-accent focus:outline-none"
                        >
                          <option value="">— Ignore this column —</option>
                          {result.schema.fields.map((field) => (
                            <option key={field.key} value={field.key}>
                              {field.label}
                              {field.required ? ' *' : ''}
                            </option>
                          ))}
                        </select>
                      </Td>
                      <Td>
                        <Badge tone={CONFIDENCE_TONE[suggestion?.confidence ?? 'none']}>
                          {CONFIDENCE_LABEL[suggestion?.confidence ?? 'none']}
                        </Badge>
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
            </TableShell>
          </Card>

          {/* ── Step 3 ───────────────────────────────────────────────────── */}
          {validation !== undefined && (
            <Card>
              <CardHeader
                title="3 · Validation"
                description="What would be accepted, what would be rejected, and exactly why."
              />

              <div className="grid divide-y divide-border sm:grid-cols-3 sm:divide-x sm:divide-y-0">
                <Stat label="Rows parsed" value={validation.totalRows.toLocaleString('en-US')} />
                <Stat
                  label="Would be accepted"
                  value={validation.acceptedRows.toLocaleString('en-US')}
                  tone={acceptRate > 95 ? 'positive' : acceptRate > 80 ? 'warning' : 'danger'}
                  sub={`${acceptRate.toFixed(1)}% of rows`}
                />
                <Stat
                  label="Would be rejected"
                  value={validation.rejectedRows.toLocaleString('en-US')}
                  tone={validation.rejectedRows === 0 ? 'positive' : 'danger'}
                />
              </div>

              {result.truncated && (
                <p className="border-t border-border bg-warning-soft px-5 py-2.5 text-[12px] text-warning">
                  The file exceeded the row limit for a single import and was truncated for this preview.
                  Split the export by date range before committing.
                </p>
              )}

              {validation.issues.length > 0 && (
                <div className="border-t border-border px-5 py-4">
                  <p className="mb-2.5 text-[11px] font-medium uppercase tracking-[0.1em] text-fg-subtle">
                    Issues
                  </p>
                  <ul className="space-y-2">
                    {validation.issues.map((issue, index) => (
                      <li key={index} className="rounded-md border border-border px-3.5 py-2.5">
                        <div className="flex flex-wrap items-baseline justify-between gap-2">
                          <span className="text-[12.5px] font-medium text-fg">
                            {result.schema.fields.find((f) => f.key === issue.field)?.label ?? issue.field}
                          </span>
                          <span className="tnum text-[11.5px] text-fg-muted">
                            {issue.count.toLocaleString('en-US')} rows
                          </span>
                        </div>
                        <p className="mt-0.5 text-[12px] text-fg-muted">{issue.rule}</p>
                        {issue.examples.length > 0 && (
                          <p className="mt-1 text-[11px] text-fg-subtle">
                            Examples: {issue.examples.map((e) => `"${e}"`).join(', ')}
                          </p>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {validation.distinct.length > 0 && (
                <div className="border-t border-border px-5 py-4">
                  <p className="mb-2.5 text-[11px] font-medium uppercase tracking-[0.1em] text-fg-subtle">
                    What arrived
                  </p>
                  <dl className="grid gap-x-8 gap-y-3 sm:grid-cols-2">
                    {validation.distinct.map((entry) => (
                      <div key={entry.field}>
                        <dt className="text-[12px] font-medium text-fg">
                          {entry.count.toLocaleString('en-US')} distinct {entry.field.toLowerCase()} values
                        </dt>
                        <dd className="mt-0.5 truncate text-[11.5px] text-fg-subtle">
                          {entry.samples.join(' · ')}
                        </dd>
                      </div>
                    ))}
                  </dl>
                </div>
              )}

              <div className="border-t border-border bg-surface-2 px-5 py-3.5">
                <p className="text-[12px] leading-relaxed text-fg-muted">
                  This deployment runs against the synthetic demo organization, so validated rows are
                  reported but not committed to the dataset. The parsing, mapping suggestion and validation
                  above are the real pipeline — connect a Supabase project to persist an import.
                </p>
              </div>
            </Card>
          )}
        </>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  sub,
  tone = 'neutral',
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: 'neutral' | 'positive' | 'warning' | 'danger';
}) {
  return (
    <div className="px-5 py-4">
      <p className="text-[11px] uppercase tracking-[0.08em] text-fg-subtle">{label}</p>
      <p
        className={cn(
          'tnum mt-1.5 text-[22px] font-semibold tracking-[-0.025em]',
          tone === 'positive' && 'text-positive',
          tone === 'warning' && 'text-warning',
          tone === 'danger' && 'text-danger',
          tone === 'neutral' && 'text-fg',
        )}
      >
        {value}
      </p>
      {sub !== undefined && <p className="mt-1 text-[11.5px] text-fg-muted">{sub}</p>}
    </div>
  );
}
