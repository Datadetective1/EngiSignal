'use client';

import { useState, useTransition } from 'react';
import { Badge, Button, Card, Td, Th, TableShell } from '@/components/ui/primitives';
import { decideIdentityAction } from '@/app/app/data/review/actions';
import { describeConfirmationEffect, type ReviewPosition } from '@/lib/analytics/review-queue';
import { formatCurrency, formatNumber } from '@/lib/analytics/financial';

/**
 * The review surface.
 *
 * Two rules govern the interaction:
 *
 *  1. Nothing is pre-selected. A default selection on a screen whose whole
 *     purpose is a judgement call would convert inattention into a merge.
 *  2. The consequence is shown BEFORE the button is pressed. A merge is easy to
 *     describe and hard to reverse mentally once the numbers have moved.
 */
export function IdentityReview({ positions }: { positions: ReviewPosition[] }) {
  return (
    <div className="space-y-4">
      {positions.map((position) => (
        <PositionCard key={position.rawValue} position={position} />
      ))}
    </div>
  );
}

function PositionCard({ position }: { position: ReviewPosition }) {
  const [selected, setSelected] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const candidate = position.candidates.find((entry) => entry.featureKey === selected) ?? null;

  const submit = (decision: 'confirmed' | 'rejected' | 'separate', canonicalKey: string) => {
    const form = new FormData();
    form.set('kind', 'feature');
    form.set('rawValue', position.rawValue);
    form.set('canonicalKey', canonicalKey);
    form.set('decision', decision);
    if (candidate !== null) form.set('suggestedKey', candidate.featureKey);

    startTransition(async () => {
      const response = await decideIdentityAction(form);
      setResult(response.message);
    });
  };

  return (
    <Card className="overflow-hidden">
      <div className="border-b border-border px-5 py-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-[13px] font-semibold text-fg">{position.rawValue}</p>
            <p className="mt-1 text-[12px] text-fg-muted">
              {position.vendor ?? 'Vendor not stated'}
              {position.sku === null ? '' : ` · SKU ${position.sku}`}
              {position.occurrences > 1 ? ` · ${position.occurrences} lines` : ''}
            </p>
          </div>
          <div className="text-right">
            {position.annualCost === null ? (
              <Badge tone="neutral">Unpriced</Badge>
            ) : (
              <>
                <p className="tnum text-[15px] font-semibold text-fg">
                  {formatCurrency(position.annualCost)}
                </p>
                <p className="text-[11px] text-fg-subtle">outside demand comparison</p>
              </>
            )}
          </div>
        </div>

        {position.status !== 'unresolved' && (
          <p className="mt-3 text-[12px] text-fg-muted">
            <Badge tone={position.status === 'confirmed' ? 'positive' : 'accent'}>
              {position.status === 'confirmed'
                ? 'Confirmed'
                : position.status === 'rejected'
                  ? 'Rejected'
                  : 'Kept separate'}
            </Badge>{' '}
            Undo this from the decision history below.
          </p>
        )}
      </div>

      {position.status === 'unresolved' && (
        <div className="px-5 py-4">
          {position.candidates.length === 0 ? (
            <p className="text-[12.5px] leading-relaxed text-fg-muted">
              No observed feature resembles this line. Import usage that names it, or keep it as a
              separate position — it will still count toward spend and renewal exposure.
            </p>
          ) : (
            <>
              <p className="mb-2 text-[12px] font-medium text-fg">
                Possible matches — suggestions only, ranked for your review
              </p>
              <div className="es-scroll overflow-x-auto">
                <TableShell>
                  <thead>
                    <tr>
                      <Th>Choose</Th>
                      <Th>Observed feature</Th>
                      <Th align="right">P95</Th>
                      <Th align="right">Days observed</Th>
                      <Th>Why suggested</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {position.candidates.map((entry) => (
                      <tr key={entry.featureId}>
                        <Td>
                          <label className="flex cursor-pointer items-center gap-2">
                            <input
                              type="radio"
                              name={`candidate-${position.rawValue}`}
                              value={entry.featureKey}
                              checked={selected === entry.featureKey}
                              onChange={() => setSelected(entry.featureKey)}
                              className="size-3.5 accent-[var(--accent)]"
                            />
                            <span className="text-[11px] text-fg-subtle">{entry.score}%</span>
                          </label>
                        </Td>
                        <Td className="font-medium text-fg">{entry.featureName}</Td>
                        <Td align="right" className="tnum">
                          {entry.p95 === null ? '—' : formatNumber(entry.p95)}
                        </Td>
                        <Td align="right" className="tnum">
                          {entry.observedDays === null ? '—' : formatNumber(entry.observedDays)}
                        </Td>
                        <Td className="text-[11.5px] text-fg-subtle">{entry.rationale}</Td>
                      </tr>
                    ))}
                  </tbody>
                </TableShell>
              </div>
            </>
          )}

          {candidate !== null && (
            <div className="mt-4 rounded-md border border-accent/40 bg-accent-soft px-4 py-3">
              <p className="mb-2 text-[11px] font-medium uppercase tracking-[0.1em] text-accent">
                What confirming would do
              </p>
              <ul className="space-y-1.5">
                {describeConfirmationEffect(position, candidate).map((effect) => (
                  <li key={effect} className="text-[12px] leading-relaxed text-fg-muted">
                    {effect}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="mt-4 flex flex-wrap gap-2">
            <Button
              variant="primary"
              disabled={candidate === null || pending}
              onClick={() => candidate !== null && submit('confirmed', candidate.featureKey)}
            >
              Confirm as the same product
            </Button>
            <Button
              variant="secondary"
              disabled={candidate === null || pending}
              onClick={() => candidate !== null && submit('rejected', candidate.featureKey)}
            >
              Not the same
            </Button>
            <Button
              variant="secondary"
              disabled={pending}
              onClick={() => submit('separate', position.rawValue)}
            >
              Keep as its own position
            </Button>
          </div>

          {result !== null && (
            <p role="status" className="mt-3 text-[12.5px] text-accent">
              {result}
            </p>
          )}
        </div>
      )}
    </Card>
  );
}
