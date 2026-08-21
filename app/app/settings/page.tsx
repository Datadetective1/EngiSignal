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
} from '@/components/ui/primitives';
import { formatDate } from '@/lib/analytics/dates';
import { DEFAULT_METHOD_ID, RIGHT_SIZING_METHODS } from '@/lib/analytics/rightsizing';
import { formatNumber, formatPercent } from '@/lib/analytics/financial';
import { getProvider } from '@/lib/ai/provider';
import { destroySession, isSupabaseAuth } from '@/lib/auth';
import { availableConnectors, CONNECTORS } from '@/lib/connectors';
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
              label="AI provider"
              value={provider.label}
              note={
                provider.available
                  ? 'A model phrases responses; every figure still comes from the analytics engine'
                  : 'Ask EngiSignal answers from deterministic retrieval alone'
              }
            />
            <MetricRow
              label="License manager connectors"
              value={`${availableConnectors().length} of ${CONNECTORS.length} implemented`}
              note="Interfaces are defined; no connector ships in this release"
            />
            <MetricRow
              label="Workflow persistence"
              value={usingMockData ? 'In-memory, session only' : 'Persisted to Postgres'}
            />
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
