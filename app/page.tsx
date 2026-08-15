import type { Metadata } from 'next';
import Link from 'next/link';
import { Logo, LogoMark } from '@/components/brand/logo';
import { HeroNetwork } from '@/components/marketing/hero-network';
import { LiveCalculator } from '@/components/marketing/live-calculator';
import { PilotForm } from '@/components/marketing/pilot-form';
import { RecommendationChain } from '@/components/marketing/recommendation-chain';
import { Reveal } from '@/components/marketing/motion';
import { ArchitectureDiagram, ConnectionPaths } from '@/components/marketing/connection-paths';
import {
  AskShowcase,
  AskTypingLine,
  ProblemCards,
  SignalsShowcase,
  VendorMarquee,
} from '@/components/marketing/sections';
import { brand } from '@/config/brand';
import { getShowcaseData } from '@/lib/marketing';

export const metadata: Metadata = {
  title: brand.meta.title,
  description: brand.meta.description,
  alternates: { canonical: '/' },
};

export default function LandingPage() {
  const showcase = getShowcaseData();

  return (
    <div className="theme-dark min-h-dvh bg-bg text-fg">
      <SiteHeader />

      <main>
        {/* ── Hero ─────────────────────────────────────────────────────── */}
        <section className="relative overflow-hidden border-b border-border">
          <div className="mx-auto max-w-[1240px] px-6 pb-16 pt-14 lg:pb-24 lg:pt-20">
            <div className="max-w-3xl">
              <Reveal>
                <p className="mb-5 inline-flex items-center gap-2 rounded-full border border-border bg-surface px-3 py-1.5 text-[12px] text-fg-muted">
                  <span className="size-1.5 rounded-full bg-accent" />
                  {brand.category}
                </p>
              </Reveal>

              <Reveal delay={60}>
                <h1 className="text-[38px] font-semibold leading-[1.08] tracking-[-0.035em] text-fg sm:text-[52px] lg:text-[60px]">
                  Engineering software.
                  <br />
                  Clear signals. Better decisions.
                </h1>
              </Reveal>

              <Reveal delay={130}>
                <p className="mt-5 max-w-xl text-[16px] leading-relaxed text-fg-muted sm:text-[17.5px]">
                  {brand.heroSupport}
                </p>
              </Reveal>

              <Reveal delay={190}>
                <div className="mt-8 flex flex-wrap items-center gap-3">
                  <Link
                    href="#pilot"
                    className="inline-flex h-12 items-center rounded-md bg-accent px-6 text-[14.5px] font-medium text-accent-fg transition-[filter] hover:brightness-110"
                  >
                    {brand.pilot.cta}
                  </Link>
                  <Link
                    href="/signin"
                    className="inline-flex h-12 items-center rounded-md border border-border px-6 text-[14.5px] font-medium text-fg transition-colors hover:bg-surface-2"
                  >
                    Explore EngiSignal
                  </Link>
                </div>
              </Reveal>
            </div>

            <Reveal delay={260}>
              <div className="mt-14 lg:mt-16">
                <HeroNetwork className="w-full" />
              </div>
            </Reveal>
          </div>
        </section>

        {/* ── Vendor context ───────────────────────────────────────────── */}
        <section className="border-b border-border py-14">
          <div className="mx-auto max-w-[1240px] px-6">
            <Reveal>
              <div className="mb-8 max-w-2xl">
                <h2 className="text-[24px] font-semibold tracking-[-0.026em] text-fg sm:text-[28px]">
                  Built for the engineering software stack.
                </h2>
                <p className="mt-2.5 text-[15px] text-fg-muted">
                  Designed for teams managing specialized engineering applications.
                </p>
              </div>
            </Reveal>
            <VendorMarquee />
          </div>
        </section>

        {/* ── Problem ──────────────────────────────────────────────────── */}
        <section className="border-b border-border py-16 lg:py-20">
          <div className="mx-auto max-w-[1240px] px-6">
            <Reveal>
              <div className="mb-9 max-w-2xl">
                <h2 className="text-[26px] font-semibold tracking-[-0.028em] text-fg sm:text-[32px]">
                  Three shapes of the same problem.
                </h2>
                <p className="mt-2.5 text-[15px] text-fg-muted">
                  Engineering organizations often manage these problems across separate systems and reports.
                  EngiSignal brings them into one decision model.
                </p>
              </div>
            </Reveal>
            <ProblemCards />
          </div>
        </section>

        {/* ── Connection paths ─────────────────────────────────────────── */}
        <section id="connect" className="scroll-mt-16 border-b border-border py-16 lg:py-20">
          <div className="mx-auto max-w-[1240px] px-6">
            <Reveal>
              <div className="mb-9 max-w-2xl">
                <h2 className="text-[26px] font-semibold tracking-[-0.028em] text-fg sm:text-[32px]">
                  Connect the way your environment already works.
                </h2>
                <p className="mt-2.5 text-[15px] text-fg-muted">
                  Start quickly with existing exports, then automate your production data flows when
                  you&rsquo;re ready.
                </p>
              </div>
            </Reveal>

            <ConnectionPaths />
          </div>
        </section>

        {/* ── What EngiSignal combines ─────────────────────────────────── */}
        <section className="border-b border-border py-16 lg:py-20">
          <div className="mx-auto max-w-[1240px] px-6">
            <Reveal>
              <div className="mb-9 max-w-2xl">
                <h2 className="text-[26px] font-semibold tracking-[-0.028em] text-fg sm:text-[32px]">
                  What EngiSignal combines.
                </h2>
                <p className="mt-2.5 text-[15px] text-fg-muted">
                  Engineering license data joined to the enterprise context that gives it meaning.
                </p>
              </div>
            </Reveal>
            <Reveal delay={80}>
              <ArchitectureDiagram />
            </Reveal>
          </div>
        </section>

        {/* ── Live calculator ──────────────────────────────────────────── */}
        <section className="border-b border-border py-16 lg:py-20">
          <div className="mx-auto max-w-[1240px] px-6">
            <Reveal>
              <div className="mb-9 max-w-2xl">
                <h2 className="text-[26px] font-semibold tracking-[-0.028em] text-fg sm:text-[32px]">
                  Try the recommendation yourself.
                </h2>
                <p className="mt-2.5 text-[15px] text-fg-muted">
                  This runs EngiSignal&rsquo;s production analytics engine against a reproducible synthetic
                  engineering-software dataset. Move the sliders and watch the recommendation recalculate.
                </p>
              </div>
            </Reveal>

            <Reveal delay={80}>
              <LiveCalculator
                dailyPeaks={showcase.dailyPeaks}
                entitled={showcase.entitled}
                unitPrice={showcase.unitPrice}
                productLabel={showcase.productLabel}
              />
            </Reveal>
          </div>
        </section>

        {/* ── Recommendation methodology ───────────────────────────────── */}
        <section className="border-b border-border py-16 lg:py-20">
          <div className="mx-auto max-w-[1240px] px-6">
            <Reveal>
              <div className="mb-9 max-w-2xl">
                <h2 className="text-[26px] font-semibold tracking-[-0.028em] text-fg sm:text-[32px]">
                  See how EngiSignal builds a recommendation.
                </h2>
                <p className="mt-2.5 text-[15px] text-fg-muted">
                  Four stages, each one traceable to the data underneath it.
                </p>
              </div>
            </Reveal>
            <RecommendationChain />
          </div>
        </section>

        {/* ── Signals ──────────────────────────────────────────────────── */}
        <section className="border-b border-border py-16 lg:py-20">
          <div className="mx-auto max-w-[1240px] px-6">
            <Reveal>
              <div className="mb-9 max-w-2xl">
                <p className="mb-3 text-[11px] font-medium uppercase tracking-[0.13em] text-fg-subtle">
                  Signals, not dashboards
                </p>
                <h2 className="text-[26px] font-semibold tracking-[-0.028em] text-fg sm:text-[32px]">
                  From dashboards to decisions.
                </h2>
                <p className="mt-2.5 text-[15px] text-fg-muted">
                  EngiSignal ranks what deserves attention by financial impact, urgency, capacity risk, and
                  confidence in the underlying data.
                </p>
              </div>
            </Reveal>
            <Reveal delay={80}>
              <SignalsShowcase />
            </Reveal>
          </div>
        </section>

        {/* ── Ask ──────────────────────────────────────────────────────── */}
        <section className="border-b border-border py-16 lg:py-20">
          <div className="mx-auto max-w-[1240px] px-6">
            <Reveal>
              <div className="mb-9 max-w-2xl">
                <h2 className="text-[26px] font-semibold tracking-[-0.028em] text-fg sm:text-[32px]">
                  Ask your engineering software portfolio.
                </h2>
                <p className="mt-3 text-[15px] text-fg-muted">
                  <span className="text-fg-subtle">Try: </span>
                  <AskTypingLine />
                </p>
                <p className="mt-3 text-[13.5px] leading-relaxed text-fg-subtle">
                  EngiSignal AI retrieves and explains deterministic analysis. It does not invent financial,
                  utilization, forecast, or recommendation values.
                </p>
              </div>
            </Reveal>
            <AskShowcase />
          </div>
        </section>

        {/* ── Pilot ────────────────────────────────────────────────────── */}
        <section id="pilot" className="scroll-mt-16 py-16 lg:py-24">
          <div className="mx-auto max-w-[1240px] px-6">
            <div className="grid gap-12 lg:grid-cols-[1fr_1.15fr]">
              <div>
                <Reveal>
                  <h2 className="text-[26px] font-semibold tracking-[-0.028em] text-fg sm:text-[32px]">
                    {brand.pilot.name}
                  </h2>
                  <p className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12.5px] font-medium text-fg-muted">
                    <span>Connect</span>
                    <span className="text-fg-subtle" aria-hidden="true">
                      →
                    </span>
                    <span>Analyze</span>
                    <span className="text-fg-subtle" aria-hidden="true">
                      →
                    </span>
                    <span>Decide</span>
                  </p>
                  <p className="mt-3 max-w-md text-[15px] leading-relaxed text-fg-muted">
                    Bring the exports you already have. In four weeks you will have a demand-backed position
                    for your next renewal, with the evidence behind every number.
                  </p>
                  <p className="mt-4 max-w-md rounded-lg border border-border bg-surface px-4 py-3 text-[13px] leading-relaxed text-fg-muted">
                    <span className="font-medium text-fg">
                      Start with existing exports for the pilot. Connect production systems when you&rsquo;re
                      ready.
                    </span>{' '}
                    No production-system integration is required to begin.
                  </p>
                </Reveal>

                <ol className="mt-8 space-y-3">
                  {brand.pilot.weeks.map((week, index) => (
                    <Reveal key={week.week} delay={index * 80} as="li">
                      <div className="flex gap-4 rounded-lg border border-border bg-surface px-4 py-3.5">
                        <span className="tnum shrink-0 text-[11.5px] font-medium text-accent">
                          {week.week}
                        </span>
                        <div>
                          <p className="text-[13.5px] font-semibold text-fg">{week.label}</p>
                          <p className="mt-0.5 text-[12.5px] leading-relaxed text-fg-muted">{week.detail}</p>
                        </div>
                      </div>
                    </Reveal>
                  ))}
                </ol>
              </div>

              <Reveal delay={100}>
                <PilotForm supportEmail={brand.contact.pilot} />
              </Reveal>
            </div>
          </div>
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}

function SiteHeader() {
  return (
    <header className="sticky top-0 z-50 border-b border-border/70 bg-bg/85 backdrop-blur-md">
      <div className="mx-auto flex max-w-[1240px] items-center justify-between gap-6 px-6 py-3.5">
        <Link href="/" className="text-fg" aria-label={`${brand.name} home`}>
          <Logo size={25} />
        </Link>

        <nav className="hidden items-center gap-7 md:flex" aria-label="Main">
          <a href="#connect" className="text-[13.5px] text-fg-muted transition-colors hover:text-fg">
            Connect Your Data
          </a>
          <a href="#pilot" className="whitespace-nowrap text-[13.5px] text-fg-muted transition-colors hover:text-fg">
            How the Pilot Works
          </a>
          <Link href="/signin" className="text-[13.5px] text-fg-muted transition-colors hover:text-fg">
            Sign in
          </Link>
        </nav>

        <div className="flex items-center gap-2.5">
          <Link
            href="/signin"
            className="inline-flex h-9 shrink-0 items-center whitespace-nowrap rounded-md border border-border px-3 text-[12.5px] font-medium text-fg transition-colors hover:bg-surface-2 md:hidden"
          >
            Sign in
          </Link>
          <Link
            href="#pilot"
            className="inline-flex h-9 shrink-0 items-center whitespace-nowrap rounded-md bg-accent px-3.5 text-[12.5px] font-medium text-accent-fg transition-[filter] hover:brightness-110 sm:px-4 sm:text-[13px]"
          >
            {brand.pilot.shortName}
          </Link>
        </div>
      </div>
    </header>
  );
}

function SiteFooter() {
  return (
    <footer className="border-t border-border py-12">
      <div className="mx-auto max-w-[1240px] px-6">
        <div className="flex flex-wrap items-start justify-between gap-8">
          <div className="max-w-sm">
            <span className="inline-flex items-center gap-2.5 text-fg">
              <LogoMark size={24} />
              <span className="text-[16px] font-semibold tracking-[-0.02em]">{brand.name}</span>
            </span>
            <p className="mt-3 text-[13px] leading-relaxed text-fg-muted">{brand.tagline}</p>
          </div>

          <nav className="flex gap-12" aria-label="Footer">
            <div>
              <p className="mb-2.5 text-[11px] font-medium uppercase tracking-[0.11em] text-fg-subtle">
                Product
              </p>
              <ul className="space-y-2 text-[13px]">
                <li>
                  <Link href="/signin" className="text-fg-muted hover:text-fg">
                    Sign in
                  </Link>
                </li>
                <li>
                  <a href="#pilot" className="text-fg-muted hover:text-fg">
                    Request a pilot
                  </a>
                </li>
              </ul>
            </div>
            <div>
              <p className="mb-2.5 text-[11px] font-medium uppercase tracking-[0.11em] text-fg-subtle">
                Contact
              </p>
              <ul className="space-y-2 text-[13px]">
                <li>
                  <a href={`mailto:${brand.contact.pilot}`} className="text-fg-muted hover:text-fg">
                    {brand.contact.pilot}
                  </a>
                </li>
                <li>
                  <a href={`mailto:${brand.contact.support}`} className="text-fg-muted hover:text-fg">
                    {brand.contact.support}
                  </a>
                </li>
              </ul>
            </div>
          </nav>
        </div>

        <div className="mt-10 border-t border-border pt-6">
          <p className="text-[11.5px] leading-relaxed text-fg-subtle">{brand.vendorDisclosure}</p>
          <p className="mt-2 text-[11.5px] text-fg-subtle">
            © {new Date().getFullYear()} {brand.companyDisplayName}. {brand.category}.
          </p>
        </div>
      </div>
    </footer>
  );
}
