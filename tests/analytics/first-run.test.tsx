import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { checkIntegrity } from '@/lib/analytics/integrity';
import { AnalyticsWithheld } from '@/components/app/data-integrity';

/**
 * ── THE FIRST SCREEN A CUSTOMER EVER SEES ───────────────────────────────────
 *
 * A workspace that has imported nothing used to render the "still being
 * analysed" card: it told somebody who had uploaded no file at all that their
 * "imported rows are stored and complete", that "the figures derived from them
 * are still being built", and invited them to reload the page to see whether it
 * had finished. It never would. There was no import button and no next step on
 * the screen.
 *
 * Two states, one message, and the message was false in the state a brand-new
 * pilot customer is actually in.
 *
 * `totalAccepted === 0` is the honest test: a first import that is still
 * landing has already accepted its rows, so an empty workspace can never be
 * confused with a build in flight. Both directions are asserted here, because
 * the bug was not "wrong words" -- it was two situations collapsed into one.
 */

const NONE = { usage: 0, people: 0, entitlements: 0, contracts: 0 };

const render = (report: Parameters<typeof AnalyticsWithheld>[0]['integrity']) =>
  renderToStaticMarkup(<AnalyticsWithheld integrity={report} />);

describe('a workspace that has imported nothing', () => {
  const fresh = checkIntegrity({ accepted: NONE, stored: NONE, analyzed: NONE, analysis: 'absent' });

  it('is not described as having data that is being analysed', () => {
    const html = render(fresh);
    expect(html).not.toContain('being analysed');
    // The specific false claim: there are no imported rows to be complete.
    expect(html).not.toContain('imported rows are stored and complete');
  });

  it('says plainly that there is nothing imported yet', () => {
    expect(render(fresh)).toContain('no data for this workspace yet');
  });

  it('offers the one action that changes the situation', () => {
    const html = render(fresh);
    expect(html).toContain('/app/data/import');
    expect(html).toContain('Import data');
  });
});

describe('a first import that is still landing', () => {
  // The genuine build-in-flight case, as the provider reports it: the rows
  // reconcile across all three counts, and the analysis of them is not current
  // yet. (Counts that disagree are a third state entirely — "analytics
  // withheld" — and belong to a different branch.)
  const landing = checkIntegrity({
    accepted: { ...NONE, usage: 70_439 },
    stored: { ...NONE, usage: 70_439 },
    analyzed: { ...NONE, usage: 70_439 },
    analysis: 'absent',
  });

  it('is still told its analysis is being built', () => {
    const html = render(landing);
    expect(html).toContain('being analysed');
  });

  it('is not mistaken for an empty workspace', () => {
    expect(render(landing)).not.toContain('no data for this workspace yet');
  });
});
