'use client';

import Link from 'next/link';
import { useRef, useState } from 'react';
import { Badge, Button, Card } from '@/components/ui/primitives';
import { cn } from '@/lib/utils';

interface AnswerFact {
  label: string;
  value: string;
}

interface Answer {
  question: string;
  headline: string;
  facts: AnswerFact[];
  narrative: string;
  links: { label: string; href: string }[];
  phrasedBy: 'deterministic' | 'model';
}

export function AskPanel({
  suggestions,
  providerLabel,
  modelAvailable,
}: {
  suggestions: readonly string[];
  providerLabel: string;
  modelAvailable: boolean;
}) {
  const [question, setQuestion] = useState('');
  const [answers, setAnswers] = useState<Answer[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const ask = async (value: string) => {
    const trimmed = value.trim();
    if (trimmed.length < 2 || busy) return;

    setBusy(true);
    setError(null);

    try {
      const response = await fetch('/api/ask', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          question: trimmed,
          history: answers.slice(-3).flatMap((answer) => [
            { role: 'user' as const, content: answer.question },
            { role: 'assistant' as const, content: answer.narrative },
          ]),
        }),
      });

      const payload = await response.json();
      if (!response.ok) {
        setError(typeof payload.error === 'string' ? payload.error : 'That question could not be answered.');
        return;
      }

      setAnswers((current) => [{ ...payload, question: trimmed }, ...current]);
      setQuestion('');
    } catch {
      setError('The request failed. Try again.');
    } finally {
      setBusy(false);
      inputRef.current?.focus();
    }
  };

  return (
    <div className="space-y-5">
      <Card>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void ask(question);
          }}
          className="flex flex-wrap items-center gap-2 px-4 py-4"
        >
          <input
            ref={inputRef}
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            placeholder="Ask about savings, renewals, capacity, demand drivers or confidence…"
            aria-label="Ask EngiSignal a question"
            className="h-10 min-w-0 flex-1 rounded-md border border-border bg-surface px-3.5 text-[13.5px] text-fg placeholder:text-fg-subtle focus:border-accent focus:outline-none"
          />
          <Button type="submit" variant="primary" disabled={busy || question.trim().length < 2}>
            {busy ? 'Retrieving…' : 'Ask'}
          </Button>
        </form>

        <div className="border-t border-border px-4 py-3">
          <p className="mb-2 text-[11px] font-medium uppercase tracking-[0.1em] text-fg-subtle">Try</p>
          <div className="flex flex-wrap gap-1.5">
            {suggestions.map((suggestion) => (
              <button
                key={suggestion}
                type="button"
                onClick={() => void ask(suggestion)}
                disabled={busy}
                className="rounded-full border border-border px-3 py-1 text-[12px] text-fg-muted transition-colors hover:border-border-strong hover:bg-surface-2 hover:text-fg disabled:opacity-50"
              >
                {suggestion}
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 border-t border-border bg-surface-2 px-4 py-2.5">
          <Badge tone={modelAvailable ? 'accent' : 'neutral'}>{providerLabel}</Badge>
          <p className="text-[11.5px] leading-relaxed text-fg-muted">
            {modelAvailable
              ? 'A language model phrases the response. Every figure is retrieved from the deterministic analytics engine — the model is never asked to calculate or recall one.'
              : 'No AI provider is configured, so answers are composed directly from the analytics engine. The numbers are identical either way.'}
          </p>
        </div>
      </Card>

      {error !== null && (
        <p className="rounded-md border border-danger/40 bg-danger-soft px-4 py-3 text-[12.5px] text-danger">
          {error}
        </p>
      )}

      {answers.length === 0 && (
        <div className="rounded-lg border border-dashed border-border px-6 py-12 text-center">
          <p className="text-[13.5px] font-medium text-fg">Ask your engineering software portfolio</p>
          <p className="mx-auto mt-1.5 max-w-lg text-[12.5px] leading-relaxed text-fg-muted">
            Name a product to see exactly how its recommendation was derived, or ask about savings,
            renewals, capacity risk, demand drivers, forecasts and confidence.
          </p>
        </div>
      )}

      <ul className="space-y-4">
        {answers.map((answer, index) => (
          <li key={index}>
            <Card className={cn(index === 0 && 'es-reveal')}>
              <div className="border-b border-border px-5 py-3">
                <p className="text-[12px] text-fg-subtle">You asked</p>
                <p className="mt-0.5 text-[13.5px] font-medium text-fg">{answer.question}</p>
              </div>

              <div className="px-5 py-4">
                <p className="text-[15px] font-semibold leading-snug tracking-[-0.015em] text-fg">
                  {answer.headline}
                </p>
                <p className="mt-2 text-[13px] leading-relaxed text-fg-muted">{answer.narrative}</p>

                {answer.facts.length > 0 && (
                  <dl className="mt-4 divide-y divide-border/70 rounded-md border border-border">
                    {answer.facts.map((fact, factIndex) => (
                      <div
                        key={`${fact.label}-${factIndex}`}
                        className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 px-3.5 py-2.5"
                      >
                        <dt className="text-[12.5px] text-fg-muted">{fact.label}</dt>
                        <dd className="tnum text-[12.5px] font-medium text-fg">{fact.value}</dd>
                      </div>
                    ))}
                  </dl>
                )}

                {answer.links.length > 0 && (
                  <nav className="mt-4 flex flex-wrap gap-2">
                    {answer.links.map((link) => (
                      <Link
                        key={link.href}
                        href={link.href}
                        className="inline-flex h-8 items-center rounded-md border border-border px-3 text-[12px] font-medium text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg"
                      >
                        {link.label}
                      </Link>
                    ))}
                  </nav>
                )}
              </div>
            </Card>
          </li>
        ))}
      </ul>
    </div>
  );
}
