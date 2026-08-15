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
import { IdentityReview } from '@/components/app/identity-review';
import { buildReviewQueue } from '@/lib/analytics/review-queue';
import { formatCurrency, formatNumber } from '@/lib/analytics/financial';
import { listConfirmations } from '@/lib/ingestion/confirmations';
import { resolveIngestionContext } from '@/lib/ingestion/session';
import { loadWorkspace } from '@/lib/workspace';

export const metadata: Metadata = { title: 'Identity review' };

export default async function IdentityReviewPage() {
  const { dataset, portfolio } = await loadWorkspace();
  const auth = await resolveIngestionContext();

  const confirmations = auth.ok ? await listConfirmations(auth.context.organizationId) : [];

  const decisions = new Map(
    confirmations
      .filter((entry) => entry.kind === 'feature')
      .map((entry) => [entry.rawValue, entry.decision] as const),
  );

  const queue = buildReviewQueue({
    review: dataset.contractReview,
    portfolio,
    decisions,
  });

  const unresolved = queue.positions.filter((position) => position.status === 'unresolved');

  return (
    <div className="space-y-6">
      <SectionHeading
        eyebrow="Data / Review"
        title="Positions EngiSignal will not merge on its own"
        description="Each of these is a commercial line that could not be tied to observed demand. They still count toward spend and renewal dates — they simply cannot be compared against usage until someone confirms what they are."
      />

      <div className="grid gap-3 sm:grid-cols-3">
        <Kpi
          label="Awaiting review"
          value={formatNumber(unresolved.length)}
          detail={unresolved.length === 0 ? 'Nothing outstanding' : 'Commercial lines not yet placed'}
        />
        <Kpi
          label="Value outside comparison"
          value={queue.totalExcludedValue > 0 ? formatCurrency(queue.totalExcludedValue) : '—'}
          tone={queue.totalExcludedValue > 0 ? 'warning' : 'neutral'}
          detail="Annual cost that cannot yet be right-sized"
        />
        <Kpi
          label="Decisions recorded"
          value={formatNumber(confirmations.length)}
          detail="Reversible, and scoped to your organization"
        />
      </div>

      {queue.positions.length === 0 ? (
        <Card>
          <CardHeader
            title="Nothing to review"
            description="Every commercial line has been matched to an observed feature, or no contract data has been imported yet."
          />
          <p className="px-5 pb-5 text-[13px] leading-relaxed text-fg-muted">
            EngiSignal matches a contract line to a feature only on an exact normalized name, a SKU
            another line already vouched for, or a mapping you have confirmed. Anything else arrives
            here rather than being guessed at.
          </p>
        </Card>
      ) : (
        <IdentityReview positions={queue.positions} />
      )}

      {confirmations.length > 0 && (
        <Card className="overflow-hidden">
          <CardHeader
            title="Decision history"
            description="Who decided what, and when. Every entry can be undone."
          />
          <div className="es-scroll overflow-x-auto">
            <TableShell>
              <thead>
                <tr>
                  <Th>Raw value</Th>
                  <Th>Decision</Th>
                  <Th>Treated as</Th>
                  <Th>Decided by</Th>
                  <Th>When</Th>
                </tr>
              </thead>
              <tbody>
                {confirmations.map((entry) => (
                  <tr key={entry.id}>
                    <Td className="font-medium text-fg">{entry.rawValue}</Td>
                    <Td>
                      <Badge
                        tone={
                          entry.decision === 'confirmed'
                            ? 'positive'
                            : entry.decision === 'rejected'
                              ? 'neutral'
                              : 'accent'
                        }
                      >
                        {entry.decision === 'confirmed'
                          ? 'Confirmed'
                          : entry.decision === 'rejected'
                            ? 'Rejected'
                            : 'Kept separate'}
                      </Badge>
                    </Td>
                    <Td className="text-fg-muted">
                      {entry.decision === 'confirmed' ? entry.canonicalKey : '—'}
                    </Td>
                    <Td className="text-fg-muted">{entry.decidedByEmail ?? 'Unknown'}</Td>
                    <Td className="tnum text-fg-subtle">{entry.decidedAt.slice(0, 10)}</Td>
                  </tr>
                ))}
              </tbody>
            </TableShell>
          </div>
        </Card>
      )}
    </div>
  );
}
