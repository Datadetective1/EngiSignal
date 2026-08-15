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

  if (provider.available && provider.phrase !== undefined) {
    try {
      const phrased = await provider.phrase(
        parsed.data.question,
        factsToText(retrieved),
        parsed.data.history ?? [],
      );
      if (phrased.length > 0) {
        narrative = phrased;
        phrasedBy = 'model';
      }
    } catch {
      // A model failure must never lose the answer — the retrieved facts stand
      // on their own, so fall through to the deterministic narrative.
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
  });
}
