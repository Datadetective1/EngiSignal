import type { Metadata } from 'next';
import Link from 'next/link';
import { Logo, LogoMark } from '@/components/brand/logo';
import { HeroNetwork } from '@/components/marketing/hero-network';
import { LiveCalculator } from '@/components/marketing/live-calculator';
import { PilotForm } from '@/components/marketing/pilot-form';
import { ScrollStory } from '@/components/marketing/scroll-story';
import { Reveal } from '@/components/marketing/motion';
import { ArchitectureDiagram, ConnectionPaths } from '@/components/marketing/connection-paths';
import {
  AskShowcase,
  AskTypingLine,
  HowItWorks,
  OutcomeCards,
  Pipeline,
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
                  Every engineering organization has all three, and no single report shows them together.
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

            <Reveal delay={80}>
              <div className="mt-12">
                <p className="mb-5 text-[11px] font-medium uppercase tracking-[0.13em] text-fg-subtle">
                  What EngiSignal combines
                </p>
                <ArchitectureDiagram />
              </div>
            </Reveal>
          </div>
        </section>

        {/* ── Pipeline ─────────────────────────────────────────────────── */}
        <section className="border-b border-border py-16 lg:py-20">
          <div className="mx-auto max-w-[1240px] px-6">
            <Reveal>
              <div className="mb-9 max-w-2xl">
                <h2 className="text-[26px] font-semibold tracking-[-0.028em] text-fg sm:text-[32px]">
                  Six steps from raw data to a decision.
                </h2>
                <p className="mt-2.5 text-[15px] text-fg-muted">
                  Each stage adds the context the next one needs.
                </p>
              </div>
            </Reveal>
            <Pipeline />
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
                  This runs EngiSignal&rsquo;s production analytics engine on real generated demand. Move a
                  slider and watch the position change.
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

        {/* ── Scroll story ─────────────────────────────────────────────── */}
        {/* `relative` is required: Framer Motion measures scroll offsets against
            the nearest positioned ancestor, and warns if it is static. */}
        <section className="relative border-b border-border">
          <div className="mx-auto max-w-[1240px] px-6 pt-16">
            <Reveal>
              <div className="mb-4 max-w-2xl">
                <h2 className="text-[26px] font-semibold tracking-[-0.028em] text-fg sm:text-[32px]">
                  How a renewal position is built.
                </h2>
                <p className="mt-2.5 text-[15px] text-fg-muted">Six numbers, in order.</p>
              </div>
            </Reveal>
          </div>
          <ScrollStory />
        </section>

        {/* ── Outcomes ─────────────────────────────────────────────────── */}
        <section className="border-b border-border py-16 lg:py-20">
          <div className="mx-auto max-w-[1240px] px-6">
            <Reveal>
              <h2 className="mb-9 text-[26px] font-semibold tracking-[-0.028em] text-fg sm:text-[32px]">
                What you get.
              </h2>
            </Reveal>
            <OutcomeCards />
          </div>
        </section>

        {/* ── Signals ──────────────────────────────────────────────────── */}
        <section className="border-b border-border py-16 lg:py-20">
          <div className="mx-auto max-w-[1240px] px-6">
            <Reveal>
              <div className="mb-9 max-w-2xl">
                <h2 className="text-[26px] font-semibold tracking-[-0.028em] text-fg sm:text-[32px]">
                  Signals, not dashboards.
                </h2>
                <p className="mt-2.5 text-[15px] text-fg-muted">
                  Ranked by financial impact, urgency and risk, then weighted by confidence in the underlying
                  data.
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
                  Answers are retrieved from deterministic analytics. The AI locates and explains the
                  analysis — it never performs it, and it never invents a number.
                </p>
              </div>
            </Reveal>
            <AskShowcase />
          </div>
        </section>

        {/* ── How it works ─────────────────────────────────────────────── */}
        <section className="border-b border-border py-16 lg:py-20">
          <div className="mx-auto max-w-[1240px] px-6">
            <Reveal>
              <div className="mb-9 max-w-2xl">
                <h2 className="text-[26px] font-semibold tracking-[-0.028em] text-fg sm:text-[32px]">
                  Start in three steps.
                </h2>
                <p className="mt-2.5 text-[15px] text-fg-muted">
                  What onboarding actually looks like, from first import to first decision.
                </p>
              </div>
            </Reveal>
            <HowItWorks />
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
