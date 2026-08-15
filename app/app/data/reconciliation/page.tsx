import type { Metadata } from 'next';
import {
  Badge,
  Card,
  CardHeader,
  Kpi,
  SectionHeading,
  TableShell,
  Td,
  Th,
} from '@/components/ui/primitives';
import { formatCurrency, formatNumber } from '@/lib/analytics/financial';
import { RECONCILIATION_LABELS, reconcile, type ReconciliationState } from '@/lib/analytics/reconciliation';
import { loadWorkspace } from '@/lib/workspace';

export const metadata: Metadata = { title: 'Reconciliation' };

const STATE_TONE: Record<ReconciliationState, 'positive' | 'warning' | 'danger' | 'neutral' | 'accent'> = {
  agree: 'positive',
  contract_exceeds_entitlement: 'warning',
  entitlement_exceeds_contract: 'danger',
  contract_only: 'accent',
  entitlement_only: 'accent',
  unresolved_identity: 'neutral',
};

export default async function ReconciliationPage() {
  const { dataset, portfolio } = await loadWorkspace();

  const entitlementByFeature = new Map<string, number>();
  const contractByFeature = new Map<string, number>();
  for (const source of dataset.quantitySources) {
    if (source.entitlementQuantity !== null) {
      entitlementByFeature.set(source.featureId, source.entitlementQuantity);
    }
    if (source.contractQuantity !== null) {
      contractByFeature.set(source.featureId, source.contractQuantity);
    }
  }

  const summary = reconcile({ portfolio, entitlementByFeature, contractByFeature });

  // Disagreements first — they are the reason to open this page.
  const ordered = [...summary.rows].sort((a, b) => {
    const rank = (state: ReconciliationState) =>
      state === 'entitlement_exceeds_contract'
        ? 0
        : state === 'contract_exceeds_entitlement'
          ? 1
          : state === 'contract_only' || state === 'entitlement_only'
            ? 2
            : state === 'unresolved_identity'
              ? 3
              : 4;
    return rank(a.state) - rank(b.state) || (b.differenceValue ?? 0) - (a.differenceValue ?? 0);
  });

  const hasBothSources = entitlementByFeature.size > 0 && contractByFeature.size > 0;

  return (
    <div className="space-y-6">
      <SectionHeading
        eyebrow="Data / Reconciliation"
        title="Where licensing and procurement records disagree"
        description="Entitlement data says what the licence server is configured to serve. Contract data says what was bought. Both are routinely right, and the difference between them is worth knowing before a vendor points it out."
      />

      {!hasBothSources ? (
        <Card>
          <CardHeader
            title="Both sources are needed"
            description="Reconciliation compares two independent records of the same estate."
          />
          <div className="px-5 pb-5">
            <ul className="space-y-2 text-[13px] leading-relaxed text-fg-muted">
              <li>
                Entitlement quantities:{' '}
                {entitlementByFeature.size > 0 ? (
                  <span className="text-fg">{entitlementByFeature.size} features</span>
                ) : (
                  <span className="text-fg-subtle">Not supplied — import a licence-server entitlement export</span>
                )}
              </li>
              <li>
                Contract quantities:{' '}
                {contractByFeature.size > 0 ? (
                  <span className="text-fg">{contractByFeature.size} features</span>
                ) : (
                  <span className="text-fg-subtle">Not supplied — import a contract or purchase-order export</span>
                )}
              </li>
            </ul>
          </div>
        </Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Kpi label="In agreement" value={formatNumber(summary.agreeing)} tone="positive" detail="Quantities match" />
          <Kpi
            label="Disagreeing"
            value={formatNumber(summary.disagreeing)}
            tone={summary.disagreeing > 0 ? 'warning' : 'neutral'}
            detail="Require review, not assumption"
          />
          <Kpi
            label="Value at stake"
            value={summary.valueAtStake > 0 ? formatCurrency(summary.valueAtStake) : '—'}
            detail="Difference valued at contract price"
          />
          <Kpi
            label="One source only"
            value={formatNumber(summary.contractOnly + summary.entitlementOnly)}
            detail="Present in one export, absent from the other"
          />
        </div>
      )}

      <Card className="overflow-hidden">
        <CardHeader
          title="Quantity by source"
          description="Every figure carries where it came from. A difference is a question, not a verdict."
        />

        {ordered.length === 0 ? (
          <p className="px-5 pb-5 text-[13px] text-fg-muted">Nothing to reconcile yet.</p>
        ) : (
          <div className="es-scroll overflow-x-auto">
            <TableShell>
              <thead>
                <tr>
                  <Th>Feature</Th>
                  <Th>State</Th>
                  <Th align="right">Entitlement</Th>
                  <Th align="right">Contract</Th>
                  <Th align="right">Difference</Th>
                  <Th align="right">At contract price</Th>
                  <Th align="right">P95</Th>
                  <Th align="right">Recommended</Th>
                  <Th>Renewal</Th>
                </tr>
              </thead>
              <tbody>
                {ordered.map((row) => (
                  <tr key={row.featureId}>
                    <Td>
                      <span className="block font-medium text-fg">{row.productName}</span>
                      <span className="block text-[11px] text-fg-subtle">
                        {row.vendorName} · {row.featureName}
                      </span>
                    </Td>
                    <Td>
                      <Badge tone={STATE_TONE[row.state]}>{RECONCILIATION_LABELS[row.state]}</Badge>
                    </Td>
                    <Td align="right" className="tnum">
                      {row.entitlement.quantity === null ? (
                        <span className="text-fg-subtle">Not supplied</span>
                      ) : (
                        formatNumber(row.entitlement.quantity)
                      )}
                    </Td>
                    <Td align="right" className="tnum">
                      {row.contract.quantity === null ? (
                        <span className="text-fg-subtle">Not supplied</span>
                      ) : (
                        formatNumber(row.contract.quantity)
                      )}
                    </Td>
                    <Td align="right" className="tnum">
                      {row.difference === null ? (
                        '—'
                      ) : row.difference === 0 ? (
                        '0'
                      ) : (
                        <span className={row.difference > 0 ? 'text-warning' : 'text-danger'}>
                          {row.difference > 0 ? '+' : ''}
                          {formatNumber(row.difference)}
                        </span>
                      )}
                    </Td>
                    <Td align="right" className="tnum">
                      {row.differenceValue === null || row.differenceValue === 0
                        ? '—'
                        : formatCurrency(row.differenceValue)}
                    </Td>
                    <Td align="right" className="tnum">
                      {/* Never a zero nobody measured. */}
                      {row.p95 === null ? <span className="text-fg-subtle">—</span> : formatNumber(row.p95)}
                    </Td>
                    <Td align="right" className="tnum">
                      {row.recommended === null ? '—' : formatNumber(row.recommended)}
                    </Td>
                    <Td className="tnum text-fg-muted">{row.renewalDate ?? '—'}</Td>
                  </tr>
                ))}
              </tbody>
            </TableShell>
          </div>
        )}
      </Card>

      {summary.disagreeing > 0 && (
        <Card>
          <CardHeader
            title="What a difference can mean"
            description="EngiSignal does not call a discrepancy waste. Several of these mean the DATA is incomplete rather than the estate."
          />
          <div className="space-y-4 px-5 pb-5">
            {ordered
              .filter((row) => row.possibleCauses.length > 0)
              .slice(0, 6)
              .map((row) => (
                <div key={row.featureId}>
                  <p className="text-[12.5px] font-medium text-fg">
                    {row.productName} · {row.featureName}
                  </p>
                  <p className="mt-0.5 text-[12px] leading-relaxed text-fg-muted">{row.interpretation}</p>
                  <ul className="mt-1.5 space-y-1">
                    {row.possibleCauses.map((cause) => (
                      <li key={cause} className="flex gap-2 text-[11.5px] leading-relaxed text-fg-subtle">
                        <span className="mt-[6px] size-1 shrink-0 rounded-full bg-fg-subtle" aria-hidden="true" />
                        {cause}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
          </div>
        </Card>
      )}
    </div>
  );
}
