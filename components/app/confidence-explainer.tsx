import { Badge, Card, CardHeader } from '@/components/ui/primitives';
import { explainConfidence } from '@/lib/analytics/confidence-explanation';
import type { ConfidenceResult } from '@/lib/domain/types';

/**
 * The reusable confidence explanation.
 *
 * A badge reading "Low" tells a software asset manager nothing they can act on.
 * This tells them how much history the figure rests on, why that lowered the
 * level, what would raise it, and — the part that protects them — which
 * readings EngiSignal has deliberately refused to make on their behalf.
 *
 * The recommendation is never hidden. A qualified answer is useful; a withheld
 * one just sends the customer back to a spreadsheet.
 */

const TONE = {
  High: 'positive',
  Medium: 'warning',
  Low: 'danger',
} as const;

export function ConfidenceExplainer({
  confidence,
  className,
}: {
  confidence: ConfidenceResult;
  className?: string;
}) {
  const explanation = explainConfidence(confidence);

  return (
    <Card className={className}>
      <CardHeader
        title="Confidence in this recommendation"
        description={explanation.summary}
        action={
          <Badge tone={TONE[explanation.level]}>
            {explanation.level} · {explanation.score}/100
          </Badge>
        }
      />

      <div className="space-y-4 px-5 pb-5">
        {explanation.observedHistory !== null && (
          <p className="rounded-md border border-border bg-surface-2 px-3.5 py-2.5 text-[12.5px] leading-relaxed text-fg">
            {explanation.observedHistory}
          </p>
        )}

        <Section title="Why the confidence is this level" items={explanation.why} />

        {explanation.improve.length > 0 && (
          <Section title="What would raise it" items={explanation.improve} />
        )}

        {/* Deliberately last and visually distinct: it is the part that stops a
            reader filling the gap with an assumption of their own. */}
        <div>
          <p className="mb-1.5 text-[11px] font-medium uppercase tracking-[0.1em] text-accent">
            What EngiSignal is not assuming
          </p>
          <ul className="space-y-1.5 border-l-2 border-accent/40 pl-3.5">
            {explanation.notAssuming.map((line) => (
              <li key={line} className="text-[12.5px] leading-relaxed text-fg-muted">
                {line}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </Card>
  );
}

function Section({ title, items }: { title: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <div>
      <p className="mb-1.5 text-[11px] font-medium uppercase tracking-[0.1em] text-fg-subtle">
        {title}
      </p>
      <ul className="space-y-1.5">
        {items.map((line) => (
          <li key={line} className="text-[12.5px] leading-relaxed text-fg-muted">
            {line}
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * The compact form, for the Executive Brief.
 *
 * The brief is printed and carried into a negotiation, so it must carry the
 * same qualification as the screen — a reader who only ever sees the PDF must
 * not end up with a more confident-looking number than the app showed.
 */
export function ConfidenceQualification({ confidence }: { confidence: ConfidenceResult }) {
  const explanation = explainConfidence(confidence);

  return (
    <div className="print-avoid-break rounded-md border border-border bg-surface-2 px-4 py-3.5">
      <p className="text-[11px] font-medium uppercase tracking-[0.1em] text-fg-subtle">
        Confidence qualification
      </p>
      <p className="mt-1.5 text-[12.5px] font-medium text-fg">{explanation.summary}</p>
      {explanation.observedHistory !== null && (
        <p className="mt-1 text-[12px] leading-relaxed text-fg-muted">
          {explanation.observedHistory}
        </p>
      )}
      <ul className="mt-2 space-y-1">
        {explanation.notAssuming.map((line) => (
          <li key={line} className="text-[11.5px] leading-relaxed text-fg-subtle">
            {line}
          </li>
        ))}
      </ul>
    </div>
  );
}
