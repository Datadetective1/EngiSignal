import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import {
  Badge,
  Button,
  Card,
  CardHeader,
  LinkButton,
  MethodologyNote,
  MetricRow,
  SectionHeading,
  TableShell,
  Td,
  Th,
} from '@/components/ui/primitives';
import { formatDate } from '@/lib/analytics/dates';
import { DEFAULT_METHOD_ID, RIGHT_SIZING_METHODS } from '@/lib/analytics/rightsizing';
import { formatNumber, formatPercent } from '@/lib/analytics/financial';
import { getProvider, providerHealth } from '@/lib/ai/provider';
import { destroySession, isSupabaseAuth } from '@/lib/auth';
import {
  CONNECTORS,
  CONNECTOR_READINESS,
  CONNECTOR_STATUS_LABELS,
  readyFileConnectors,
} from '@/lib/connectors';
import { loadWorkspace } from '@/lib/workspace';

export const metadata: Metadata = { title: 'Settings' };

async function signOut() {
  'use server';
  await destroySession();
  redirect('/signin');
}

export default async function SettingsPage() {
  const workspace = await loadWorkspace();
  const { dataset, organization, options, session, usingMockData } = workspace;
  const provider = getProvider();
  const aiHealth = providerHealth();

  return (
    <div className="space-y-6">
      <SectionHeading
        eyebrow="Settings"
        title="Organization, methodology and environment"
        description="What EngiSignal assumes, where its data comes from, and what is and is not configured in this deployment."
      />

      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader title="Organization" description="The tenant this workspace is scoped to." />
          <div className="px-5 py-4">
            <MetricRow label="Name" value={organization.name} />
            <MetricRow label="Industry" value={organization.industry ?? '—'} />
            <MetricRow
              label="Technical headcount"
              value={formatNumber(organization.technicalHeadcount)}
              note="Denominator for cost-per-engineer metrics"
            />
            <MetricRow
              label="Headcount growth assumption"
              value={formatPercent((organization.headcountGrowthRate ?? 0) * 100, 0)}
              note="Feeds every forecast"
            />
            <MetricRow label="Currency" value={organization.currency} />
            <MetricRow label="Analysis date" value={formatDate(dataset.asOf)} emphasis />
            <div className="mt-4">
              <LinkButton href="/app/settings/members" variant="secondary">
                Manage members
              </LinkButton>
            </div>
          </div>
        </Card>

        <Card>
          <CardHeader title="Analysis defaults" description="The assumptions behind every recommendation." />
          <div className="px-5 py-4">
            <MetricRow
              label="Observation period"
              value={options.periodKey === '12m' ? '12 months' : options.periodKey}
            />
            <MetricRow label="Percentile" value={`P${(options.percentile * 100).toFixed(0)}`} />
            <MetricRow label="Growth factor" value={options.growthFactor.toFixed(2)} />
            <MetricRow label="Safety buffer" value={`${((options.safetyFactor - 1) * 100).toFixed(0)}%`} />
            <MetricRow
              label="Reclaim threshold"
              value={`${options.reclaimThresholdDays} days`}
              note="Days without activity before a named-user seat becomes a candidate"
            />
            <MetricRow
              label="Right-sizing method"
              value={RIGHT_SIZING_METHODS[DEFAULT_METHOD_ID]?.label ?? 'Percentile'}
            />

            <MethodologyNote>
              Every one of these is adjustable per analysis in the Scenario Lab, which recalculates using the
              same engine. Changing a default here would require a persisted organization preference — a
              deliberate v2 item rather than a hidden toggle.
            </MethodologyNote>
          </div>
        </Card>

        <Card>
          <CardHeader title="Session" description="Who is signed in and how." />
          <div className="px-5 py-4">
            <MetricRow label="Signed in as" value={session.displayName} />
            <MetricRow label="Email" value={session.email} />
            <MetricRow
              label="Authentication"
              value={isSupabaseAuth() ? 'Supabase Auth' : 'Evaluation session'}
              note={
                isSupabaseAuth()
                  ? 'Real authentication with row-level security enforced in the database'
                  : 'Zero-setup evaluation mode — not an authentication system'
              }
            />
            <div className="mt-4">
              <form action={signOut}>
                <Button type="submit" variant="secondary">
                  Sign out
                </Button>
              </form>
            </div>
          </div>
        </Card>

        <Card>
          <CardHeader title="Environment" description="What is configured in this deployment." />
          <div className="px-5 py-4">
            <MetricRow
              label="Data provider"
              value={usingMockData ? 'Local synthetic dataset' : 'Supabase (Postgres)'}
              note={
                usingMockData
                  ? 'Set ENGISIGNAL_DATA_PROVIDER=supabase with credentials to switch'
                  : 'Row Level Security enforced per organization'
              }
            />
            <MetricRow
              label="Workflow persistence"
              value={usingMockData ? 'In-memory, session only' : 'Persisted to Postgres'}
            />
          </div>
        </Card>

        {/* ── WHAT IS ANSWERING QUESTIONS, AND ON WHAT BASIS ─────────────────
            Four separate facts, because they fail separately. "AI provider:
            OpenAI" alone would let a customer assume the figures came from the
            model, which is the one thing that must never be true here. */}
        <Card>
          <CardHeader
            title="Ask EngiSignal"
            description="What answers questions, and where the numbers in those answers come from."
          />
          <div className="px-5 py-4">
            <MetricRow
              label="Analytics engine"
              value="Deterministic — source of truth"
              note="Every quantity, price, percentile, forecast and recommendation is computed here. This never changes."
              emphasis
            />
            <MetricRow
              label="Grounding"
              value="Retrieval-first, refuses without evidence"
              note="Answers are assembled from analytics output. When EngiSignal holds no evidence for a question, it says so and no model is called."
            />
            <MetricRow
              label="Explanation layer"
              value={provider.label}
              note={
                provider.available
                  ? 'Phrases the retrieved evidence in prose. It is given the facts and cannot compute or recall a figure.'
                  : 'Not configured. Answers are phrased from templates — the same numbers, different wording.'
              }
            />
            <MetricRow
              label="Status"
              value={
                aiHealth === 'ready'
                  ? 'Connected'
                  : aiHealth === 'cooling_down'
                    ? 'Paused after repeated errors'
                    : 'Not configured'
              }
              note={
                aiHealth === 'ready'
                  ? `Model: ${provider.model ?? 'default'}. Requests carry no retention (store: false).`
                  : aiHealth === 'cooling_down'
                    ? 'The provider failed repeatedly, so calls are suspended briefly. Answers continue deterministically in the meantime.'
                    : 'Set OPENAI_API_KEY in the server environment to enable prose explanations. Optional — nothing else changes.'
              }
            />
            <MethodologyNote>
              The API key is read on the server only. It is never sent to the browser, never written to a
              log, and cannot be viewed or edited from this page.
            </MethodologyNote>
          </div>
        </Card>

        {/* ── CONNECTORS, HONESTLY ───────────────────────────────────────────
            This used to read "0 of 8 implemented", which described the live
            polling connectors and quietly denied the four file adapters that
            have shipped since Phase 1. */}
        <Card className="lg:col-span-2">
          <CardHeader
            title="License manager connectors"
            description={`${readyFileConnectors().length} of ${CONNECTOR_READINESS.length} sources import today. No connector polls a licence server in this release.`}
          />
          <TableShell>
            <thead>
              <tr>
                <Th>Source</Th>
                <Th>File import</Th>
                <Th>Live collection</Th>
                <Th>What you export</Th>
                <Th>Sample</Th>
              </tr>
            </thead>
            <tbody>
              {CONNECTOR_READINESS.map((entry) => {
                const connector = CONNECTORS.find((candidate) => candidate.id === entry.id);
                return (
                  <tr key={entry.id}>
                    <Td>
                      <div className="font-medium text-fg">{connector?.name ?? entry.id}</div>
                      <div className="text-[12px] leading-relaxed text-fg-muted">{entry.detail}</div>
                    </Td>
                    <Td>
                      <Badge>{CONNECTOR_STATUS_LABELS[entry.fileIngestion]}</Badge>
                    </Td>
                    <Td>
                      <span className="text-fg-muted">
                        {CONNECTOR_STATUS_LABELS[entry.liveCollection]}
                      </span>
                    </Td>
                    <Td>{entry.fileSource}</Td>
                    <Td>
                      {entry.fileIngestion === 'ready' ? (
                        <a
                          href={`/api/samples/${entry.id}`}
                          className="underline underline-offset-4 hover:text-fg"
                        >
                          Download
                        </a>
                      ) : (
                        <span className="text-fg-subtle">—</span>
                      )}
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </TableShell>
          <div className="px-5 py-4">
            <MethodologyNote>
              <strong>Ready</strong> means a realistic export from that vendor&rsquo;s tooling has been carried
              the whole way — parse, detect, map, normalize, persist, analyse, reconcile — by a test that
              fails if the claim is not true. <strong>Beta</strong> imports through the generic reader and
              needs the source chosen by hand. <strong>Planned</strong> means the interface exists and nothing
              behind it does. Automatic collection from a licence server inside your network is described in
              CONNECTOR_ARCHITECTURE.md and is not built.
            </MethodologyNote>
          </div>
        </Card>
      </div>

      {organization.isDemo && (
        <Card>
          <CardHeader
            title="How this demo data was made"
            description="Aerospace Dynamics Corporation is entirely fictional and deterministically generated."
          />
          <div className="space-y-4 px-5 py-4 text-[13px] leading-relaxed text-fg-muted">
            <p>
              Every employee, manager, program, contract, price and usage record is invented. No real
              organization, person or customer data was used, and nothing here is derived from any actual
              license deployment.
            </p>
            <p>
              Usage is produced by rank mapping rather than naive sampling: the generator constructs the
              exact sorted distribution of daily peaks it wants, then assigns those values to specific dates
              in order of a demand-propensity score built from weekday pattern, holidays, trend and noise.
              That makes the P95 of daily peaks exact rather than approximate — so the figures quoted in
              this demo reproduce precisely on every machine — while keeping the time series realistic, with
              weekends dipping and trending products visibly trending.
            </p>
            <p>
              The dataset deliberately contains ten scenarios worth demonstrating, including three different
              denial patterns chosen to exercise EngiSignal&rsquo;s honesty guards: genuine capacity
              exhaustion that must classify as high risk, a single engineer&rsquo;s retry loop that must
              classify as low despite a large denial count, and denials recorded while capacity was free
              that must be identified as a licensing-rule issue no purchase would fix.
            </p>
            <div className="flex flex-wrap gap-2 pt-1">
              {[
                `${formatNumber(dataset.employees.length)} employees`,
                `${formatNumber(dataset.features.length)} features`,
                `${formatNumber(dataset.vendors.length)} vendors`,
                `${formatNumber(dataset.dailyUsage.length)} daily usage rows`,
                `${formatNumber(dataset.hourlyUsage.length)} hourly rows`,
                `${formatNumber(dataset.activities.length)} activity records`,
                `${formatNumber(dataset.denials.length)} denial events`,
              ].map((fact) => (
                <Badge key={fact}>{fact}</Badge>
              ))}
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}
