import type { Metadata } from 'next';
import { AskPanel } from '@/components/app/ask-panel';
import { MethodologyNote, SectionHeading } from '@/components/ui/primitives';
import { getProvider } from '@/lib/ai/provider';
import { SUGGESTED_QUESTIONS } from '@/lib/ai/retrieval';
import { loadWorkspace } from '@/lib/workspace';

export const metadata: Metadata = { title: 'Ask EngiSignal' };

export default async function AskPage() {
  await loadWorkspace();
  const provider = getProvider();

  return (
    <div>
      <SectionHeading
        eyebrow="Ask EngiSignal"
        title="Interrogate the analysis in plain language"
        description="Ask EngiSignal retrieves deterministic metrics and evidence. It locates and explains analysis — it never performs it."
      />

      <AskPanel
        suggestions={SUGGESTED_QUESTIONS}
        providerLabel={provider.label}
        modelAvailable={provider.available}
      />

      <MethodologyNote>
        The retrieval layer runs first and always. When a language model is configured it receives the
        retrieved facts and is asked only to phrase them, under an instruction that forbids calculating,
        estimating or recalling any figure. If the model fails or is absent, the same facts are returned
        with a template narrative — the numbers do not change.
      </MethodologyNote>
    </div>
  );
}
