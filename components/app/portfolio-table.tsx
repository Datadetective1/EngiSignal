'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { Badge, ConfidenceBadge, RiskBadge, TableShell, Td, Th } from '@/components/ui/primitives';
import { formatCurrency, formatNumber, formatPercent } from '@/lib/analytics/financial';
import type { ConfidenceLevel, LicenseModel, RiskLevel } from '@/lib/domain/types';
import { cn } from '@/lib/utils';

export interface PortfolioTableRow {
  featureId: string;
  featureName: string;
  featureCode: string;
  productName: string;
  vendorName: string;
  licenseModel: LicenseModel;
  entitled: number;
  p95: number | null;
  max: number | null;
  utilizationPct: number | null;
  annualCost: number | null;
  recommended: number | null;
  opportunity: number | null;
  incremental: number | null;
  renewalDate: string | null;
  daysToRenewal: number | null;
  risk: RiskLevel;
  confidence: ConfidenceLevel;
  /**
   * Whether any usage was imported for this feature.
   *
   * Drives a visible statement rather than leaving a row of dashes to be
   * interpreted. A dash reads as "nothing here"; the customer needs to know it
   * means "nothing measured", because the fix is to import a usage export.
   */
  usageEvidence: 'observed' | 'not_supplied';
  /** What procurement says was bought. Null when no contract line exists. */
  purchasedQuantity: number | null;
  /** What the licence server is configured to serve. */
  servedQuantity: number | null;
}

const LICENSE_LABELS: Record<LicenseModel, string> = {
  concurrent: 'Concurrent',
  named_user: 'Named user',
  token: 'Token',
  subscription: 'Subscription',
  hybrid: 'Hybrid',
  custom: 'Custom',
};

type SortKey = 'product' | 'entitled' | 'p95' | 'utilization' | 'cost' | 'recommended' | 'opportunity' | 'renewal';

export function PortfolioTable({
  rows,
  initialRisk,
}: {
  rows: PortfolioTableRow[];
  initialRisk?: string;
}) {
  const [query, setQuery] = useState('');
  const [vendor, setVendor] = useState('all');
  const [model, setModel] = useState('all');
  const [risk, setRisk] = useState(initialRisk === 'high' ? 'elevated' : 'all');
  const [sort, setSort] = useState<SortKey>('cost');
  const [descending, setDescending] = useState(true);

  const vendors = useMemo(() => [...new Set(rows.map((r) => r.vendorName))].sort(), [rows]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();

    const matched = rows.filter((row) => {
      if (vendor !== 'all' && row.vendorName !== vendor) return false;
      if (model !== 'all' && row.licenseModel !== model) return false;
      if (risk === 'elevated' && row.risk !== 'High' && row.risk !== 'Critical') return false;
      if (needle.length > 0) {
        const haystack =
          `${row.productName} ${row.featureName} ${row.featureCode} ${row.vendorName}`.toLowerCase();
        if (!haystack.includes(needle)) return false;
      }
      return true;
    });

    const value = (row: PortfolioTableRow): number | string => {
      switch (sort) {
        case 'product':
          return `${row.vendorName} ${row.productName}`;
        case 'entitled':
          return row.entitled;
        case 'p95':
          return row.p95 ?? -1;
        case 'utilization':
          return row.utilizationPct ?? -1;
        case 'cost':
          return row.annualCost ?? -1;
        case 'recommended':
          return row.recommended ?? -1;
        case 'opportunity':
          return (row.opportunity ?? 0) - (row.incremental ?? 0);
        case 'renewal':
          return row.daysToRenewal ?? Number.MAX_SAFE_INTEGER;
      }
    };

    return [...matched].sort((a, b) => {
      const av = value(a);
      const bv = value(b);
      const comparison =
        typeof av === 'string' && typeof bv === 'string' ? av.localeCompare(bv) : Number(av) - Number(bv);
      return descending ? -comparison : comparison;
    });
  }, [rows, query, vendor, model, risk, sort, descending]);

  const toggleSort = (key: SortKey) => {
    if (sort === key) setDescending((v) => !v);
    else {
      setSort(key);
      setDescending(true);
    }
  };

  const SortableTh = ({
    label,
    sortKey,
    align = 'right',
  }: {
    label: string;
    sortKey: SortKey;
    align?: 'left' | 'right';
  }) => (
    <Th align={align} className="cursor-pointer select-none hover:text-fg">
      <button type="button" onClick={() => toggleSort(sortKey)} className="inline-flex items-center gap-1">
        {label}
        <span className={cn('text-[9px]', sort === sortKey ? 'text-accent' : 'text-transparent')}>
          {sort === sortKey && !descending ? '▲' : '▼'}
        </span>
      </button>
    </Th>
  );

  const totals = filtered.reduce(
    (acc, row) => ({
      cost: acc.cost + (row.annualCost ?? 0),
      opportunity: acc.opportunity + (row.opportunity ?? 0),
      incremental: acc.incremental + (row.incremental ?? 0),
    }),
    { cost: 0, opportunity: 0, incremental: 0 },
  );

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search product, feature or vendor"
          aria-label="Search portfolio"
          className="h-8 w-full min-w-0 rounded-md border border-border bg-surface px-3 text-[12.5px] text-fg placeholder:text-fg-subtle focus:border-accent focus:outline-none sm:w-64"
        />
        <Select value={vendor} onChange={setVendor} label="Vendor">
          <option value="all">All vendors</option>
          {vendors.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </Select>
        <Select value={model} onChange={setModel} label="License model">
          <option value="all">All models</option>
          {Object.entries(LICENSE_LABELS).map(([key, label]) => (
            <option key={key} value={key}>
              {label}
            </option>
          ))}
        </Select>
        <Select value={risk} onChange={setRisk} label="Risk">
          <option value="all">All risk levels</option>
          <option value="elevated">High &amp; Critical only</option>
        </Select>

        <span className="tnum ml-auto text-[12px] text-fg-subtle">
          {filtered.length} of {rows.length} features · {formatCurrency(totals.cost)}
        </span>
        {/* A route handler returning Content-Disposition: attachment. next/link
            would client-navigate and never trigger the download, so a plain
            anchor is correct here. */}
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
        <a
          href="/api/export/portfolio"
          className="inline-flex h-8 items-center rounded-md border border-border px-2.5 text-[12px] font-medium text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg"
        >
          Export CSV
        </a>
      </div>

      <div className="rounded-lg border border-border bg-surface">
        <TableShell className="rounded-lg">
          <thead>
            <tr>
              <SortableTh label="Vendor / Product" sortKey="product" align="left" />
              <Th>Model</Th>
              <SortableTh label="Served" sortKey="entitled" />
              <Th align="right">Purchased</Th>
              <SortableTh label="P95" sortKey="p95" />
              <Th align="right">Max</Th>
              <SortableTh label="Utilization" sortKey="utilization" />
              <SortableTh label="Annual cost" sortKey="cost" />
              <SortableTh label="Recommended" sortKey="recommended" />
              <SortableTh label="Opportunity" sortKey="opportunity" />
              <SortableTh label="Renewal" sortKey="renewal" />
              <Th>Risk</Th>
              <Th>Confidence</Th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((row) => {
              const net = (row.opportunity ?? 0) - (row.incremental ?? 0);
              return (
                <tr key={row.featureId} className="transition-colors hover:bg-surface-2">
                  <Td>
                    <Link href={`/app/portfolio/${row.featureId}`} className="group block min-w-[190px]">
                      <span className="block truncate text-[12.5px] font-medium text-fg group-hover:text-accent">
                        {row.productName}
                      </span>
                      <span className="block truncate text-[11px] text-fg-subtle">
                        {row.vendorName} · {row.featureName}
                      </span>
                      {row.usageEvidence === 'not_supplied' && (
                        <span className="mt-1 block text-[10.5px] font-medium text-fg-subtle">
                          Usage evidence not supplied
                        </span>
                      )}
                    </Link>
                  </Td>
                  <Td>
                    <Badge>{LICENSE_LABELS[row.licenseModel]}</Badge>
                  </Td>
                  <Td align="right">{formatNumber(row.entitled)}</Td>
                  <Td align="right" className="tnum">
                    {/* Shown beside served capacity so a disagreement is a
                        thing the customer sees rather than has to look for. */}
                    {row.purchasedQuantity === null ? (
                      <span className="text-fg-subtle">—</span>
                    ) : row.purchasedQuantity !== row.servedQuantity ? (
                      <span className="font-medium text-warning">
                        {formatNumber(row.purchasedQuantity)}
                      </span>
                    ) : (
                      formatNumber(row.purchasedQuantity)
                    )}
                  </Td>
                  <Td align="right">{row.p95 === null ? '—' : formatNumber(row.p95, 0)}</Td>
                  <Td align="right" className="text-fg-muted">
                    {row.max === null ? '—' : formatNumber(row.max)}
                  </Td>
                  <Td align="right">
                    {row.utilizationPct === null ? (
                      '—'
                    ) : (
                      <span
                        className={cn(
                          row.utilizationPct >= 92 && 'font-medium text-danger',
                          row.utilizationPct < 55 && 'text-fg-muted',
                        )}
                      >
                        {formatPercent(row.utilizationPct, 0)}
                      </span>
                    )}
                  </Td>
                  <Td align="right">{formatCurrency(row.annualCost)}</Td>
                  <Td align="right">{row.recommended === null ? '—' : formatNumber(row.recommended)}</Td>
                  <Td align="right">
                    {net === 0 ? (
                      <span className="text-fg-subtle">—</span>
                    ) : (
                      <span className={net > 0 ? 'font-medium text-positive' : 'font-medium text-danger'}>
                        {net > 0 ? '' : '+'}
                        {formatCurrency(Math.abs(net))}
                      </span>
                    )}
                  </Td>
                  <Td align="right" className="text-fg-muted">
                    {row.daysToRenewal === null ? '—' : `${row.daysToRenewal}d`}
                  </Td>
                  <Td>
                    <RiskBadge risk={row.risk} />
                  </Td>
                  <Td>
                    <ConfidenceBadge level={row.confidence} />
                  </Td>
                </tr>
              );
            })}
          </tbody>
        </TableShell>

        {filtered.length === 0 && (
          <p className="px-4 py-10 text-center text-[13px] text-fg-muted">
            No features match these filters.
          </p>
        )}
      </div>
    </div>
  );
}

function Select({
  value,
  onChange,
  label,
  children,
}: {
  value: string;
  onChange: (value: string) => void;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <select
      value={value}
      aria-label={label}
      onChange={(event) => onChange(event.target.value)}
      className="h-8 rounded-md border border-border bg-surface px-2 text-[12.5px] text-fg focus:border-accent focus:outline-none"
    >
      {children}
    </select>
  );
}
