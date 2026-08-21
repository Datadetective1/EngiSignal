import { NextResponse } from 'next/server';
import { z } from 'zod';
import { factsToText, retrieve } from '@/lib/ai/retrieval';
import { getProvider } from '@/lib/ai/provider';
import { loadWorkspace } from '@/lib/workspace';

export const runtime = 'nodejs';
export const maxDuration = 30;

const requestSchema = z.object({
  question: z.string().min(2).max(500),
  history: z
    .array(z.object({ role: z.enum(['user', 'assistant']), content: z.string().max(4000) }))
    .max(10)
    .optional(),
});

export async function POST(request: Request) {
  const workspace = await loadWorkspace();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
  }

  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Ask a question between 2 and 500 characters.' }, { status: 400 });
  }

  // Retrieval runs first and always. Every figure in the response comes from
  // here, whether or not a language model is configured.
  const retrieved = retrieve(workspace, parsed.data.question);
  const provider = getProvider();

  let narrative = retrieved.narrative;
  let phrasedBy: 'deterministic' | 'model' = 'deterministic';

  // ── THE HALLUCINATION GATE ────────────────────────────────────────────────
  //
  // When retrieval found no evidence, the model is not called at all.
  //
  // The alternative — hand it an empty FACTS block, a direct question, and an
  // instruction to admit ignorance — relies on the model choosing to obey under
  // exactly the conditions that most invite it not to. "Which renewal should we
  // prioritise?" with nothing to go on is a question a helpful assistant wants
  // to answer, and the answer would be fluent, plausible and entirely invented.
  //
  // So the refusal is deterministic. There is nothing to phrase, and no request
  // is made.
  const groundable = retrieved.evidence !== 'none';

  if (groundable && provider.available && provider.phrase !== undefined) {
    // The provider swallows its own failures and returns null; a throw here
    // would be a bug rather than an outage, and is caught for the same reason.
    try {
      const phrased = await provider.phrase(
        parsed.data.question,
        factsToText(retrieved),
        parsed.data.history ?? [],
      );
      if (phrased !== null && phrased.length > 0) {
        narrative = phrased;
        phrasedBy = 'model';
      }
    } catch {
      phrasedBy = 'deterministic';
    }
  }

  return NextResponse.json({
    intent: retrieved.intent,
    headline: retrieved.headline,
    facts: retrieved.facts,
    narrative,
    links: retrieved.links,
    phrasedBy,
    provider: provider.label,
    // Surfaced so the interface can show that an answer is a considered refusal
    // rather than a failure, and so this is assertable from a test.
    evidence: retrieved.evidence,
    ...(retrieved.missing === undefined ? {} : { missing: retrieved.missing }),
  });
}
