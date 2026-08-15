'use client';

import { useState, useTransition } from 'react';
import { Badge, Button, Card, TableShell, Td, Th } from '@/components/ui/primitives';
import { decideIdentityAction } from '@/app/app/data/review/actions';
import { describeUserConfirmationEffect, type UnresolvedUser } from '@/lib/analytics/user-review';
import { formatNumber } from '@/lib/analytics/financial';

/**
 * The people-side review surface.
 *
 * Deliberately the same interaction as the feature alias queue: nothing
 * pre-selected, the consequence shown before the button, and the same three
 * decisions. A customer who has learned one has learned both, and a second
 * design language for the same judgement would only invite the assumption that
 * the two work differently.
 */
export function UserIdentityReview({ users }: { users: UnresolvedUser[] }) {
  return (
    <div className="space-y-4">
      {users.map((user) => (
        <UserCard key={user.rawUsername} user={user} />
      ))}
    </div>
  );
}

function UserCard({ user }: { user: UnresolvedUser }) {
  const [selected, setSelected] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const candidate = user.candidates.find((entry) => entry.confirmationKey === selected) ?? null;

  const submit = (decision: 'confirmed' | 'rejected' | 'separate', canonicalKey: string) => {
    const form = new FormData();
    form.set('kind', 'user');
    form.set('rawValue', user.rawUsername);
    form.set('canonicalKey', canonicalKey);
    form.set('decision', decision);
    if (candidate !== null) form.set('suggestedKey', candidate.confirmationKey);

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
            <p className="text-[13px] font-semibold text-fg">{user.rawUsername}</p>
            <p className="mt-1 text-[12px] text-fg-muted">
              {formatNumber(user.observations)} usage{' '}
              {user.observations === 1 ? 'observation' : 'observations'}
              {user.employeeCode === null ? '' : ` · employee code ${user.employeeCode} in the usage export`}
            </p>
          </div>
          <Badge tone={user.status === 'ambiguous' ? 'danger' : 'warning'}>
            {user.status === 'ambiguous' ? 'Ambiguous' : 'Unresolved'}
          </Badge>
        </div>

        {user.status === 'ambiguous' && user.ambiguousBetween.length > 0 && (
          <p className="mt-3 text-[12px] leading-relaxed text-fg-muted">
            {/* The reason this is a decision and not a lookup. */}
            More than one person claims this identifier —{' '}
            <span className="text-fg">{user.ambiguousBetween.join(', ')}</span>. EngiSignal will not
            choose between them, because attributing one person&rsquo;s licence use to another sends
            a reclaim decision to the wrong manager.
          </p>
        )}

        {user.decision !== 'unresolved' && (
          <p className="mt-3 text-[12px] text-fg-muted">
            <Badge tone={user.decision === 'confirmed' ? 'positive' : 'accent'}>
              {user.decision === 'confirmed'
                ? 'Confirmed'
                : user.decision === 'rejected'
                  ? 'Rejected'
                  : 'Kept separate'}
            </Badge>{' '}
            Undo this from the decision history below.
          </p>
        )}
      </div>

      {user.decision === 'unresolved' && (
        <div className="px-5 py-4">
          {user.candidates.length === 0 ? (
            <p className="text-[12.5px] leading-relaxed text-fg-muted">
              No person in your people file resembles this identifier. EngiSignal does not suggest
              people by name similarity, so if this is a real person, import a people record whose
              username, employee code or email matches — or keep it separate if it is a service
              account.
            </p>
          ) : (
            <>
              <p className="mb-2 text-[12px] font-medium text-fg">
                Possible people — suggestions only, ranked for your review
              </p>
              <div className="es-scroll overflow-x-auto">
                <TableShell>
                  <thead>
                    <tr>
                      <Th>Choose</Th>
                      <Th>Person</Th>
                      <Th>Employee ID</Th>
                      <Th>Department</Th>
                      <Th>Manager</Th>
                      <Th>Why suggested</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {user.candidates.map((entry) => (
                      <tr key={entry.confirmationKey}>
                        <Td>
                          <label className="flex cursor-pointer items-center gap-2">
                            <input
                              type="radio"
                              name={`person-${user.rawUsername}`}
                              value={entry.confirmationKey}
                              checked={selected === entry.confirmationKey}
                              onChange={() => setSelected(entry.confirmationKey)}
                              className="size-3.5 accent-[var(--accent)]"
                            />
                            <span className="text-[11px] text-fg-subtle">{entry.score}%</span>
                          </label>
                        </Td>
                        <Td>
                          <span className="block font-medium text-fg">
                            {entry.fullName ?? entry.confirmationKey}
                          </span>
                          <span className="block text-[11px] text-fg-subtle">
                            {entry.username.trim().length > 0 ? entry.username : entry.confirmationKey}
                            {entry.email === null ? '' : ` · ${entry.email}`}
                          </span>
                        </Td>
                        <Td className="text-fg-muted">{entry.employeeCode ?? '—'}</Td>
                        <Td className="text-fg-muted">{entry.department ?? '—'}</Td>
                        <Td className="text-fg-muted">{entry.managerName ?? '—'}</Td>
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
                {describeUserConfirmationEffect(user, candidate).map((effect) => (
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
              onClick={() => candidate !== null && submit('confirmed', candidate.confirmationKey)}
            >
              Confirm as this person
            </Button>
            <Button
              variant="secondary"
              disabled={candidate === null || pending}
              onClick={() => candidate !== null && submit('rejected', candidate.confirmationKey)}
            >
              Not this person
            </Button>
            <Button
              variant="secondary"
              disabled={pending}
              onClick={() => submit('separate', user.rawUsername)}
            >
              Not a person — keep separate
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
