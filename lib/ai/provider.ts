import { openaiConfigured, openaiHealth, openaiModel, phraseWithOpenAI } from './openai';

/**
 * Provider-agnostic AI layer.
 *
 * THE CONTRACT: AI never produces a quantity, a price, or a utilization figure.
 * It selects which deterministic metrics answer a question and phrases the
 * result. Every number in an answer is retrieved from the analytics engine and
 * carries a link back to the surface that computed it.
 *
 * With no API key configured, EngiSignal answers from the retrieval layer alone.
 * That path is not a degraded fallback — it is the same numbers, phrased from
 * templates instead of by a model.
 */

export type AIProviderId = 'none' | 'anthropic' | 'openai';

export interface AIMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface AIProvider {
  id: AIProviderId;
  label: string;
  available: boolean;
  /** The model that would be used, for the Settings surface. Never a secret. */
  model: string | null;
  /**
   * Phrase an answer given retrieved facts. Implementations MUST be given the
   * facts and MUST NOT be asked to compute or recall figures independently.
   *
   * Returns null when the provider declined or failed. Null means "use the
   * deterministic narrative", which is always a complete answer.
   */
  phrase?(question: string, facts: string, history: AIMessage[]): Promise<string | null>;
}

/**
 * Which provider is active.
 *
 * ── WHY A KEY IS ENOUGH ─────────────────────────────────────────────────────
 *
 * This used to require ENGISIGNAL_AI_PROVIDER=openai *and* OPENAI_API_KEY, so a
 * deployment that set only the key got "Deterministic answers only" and no
 * indication why. Two variables to enable one thing is two chances to enable
 * nothing. Setting a key is now an unambiguous statement of intent.
 *
 * The explicit variable still wins where it disagrees, which is what makes
 * `ENGISIGNAL_AI_PROVIDER=none` a usable kill switch with the key left in place.
 */
export function configuredProviderId(): AIProviderId {
  const configured = (process.env.ENGISIGNAL_AI_PROVIDER ?? '').trim().toLowerCase();
  const anthropicKey = (process.env.ANTHROPIC_API_KEY ?? '').length > 0;

  if (configured === 'none') return 'none';
  if (configured === 'anthropic') return anthropicKey ? 'anthropic' : 'none';
  if (configured === 'openai') return openaiConfigured() ? 'openai' : 'none';

  // Unset: infer from whichever credential is present.
  if (openaiConfigured()) return 'openai';
  if (anthropicKey) return 'anthropic';
  return 'none';
}

/**
 * The system instruction any configured provider receives.
 * Kept here rather than inline so the constraint is auditable in one place.
 */
export const AI_SYSTEM_PROMPT = `You are the conversational interface to EngiSignal, an engineering software intelligence platform.

Absolute rules:
1. Every number you state must appear verbatim in the FACTS block supplied to you. Never calculate, estimate, round differently, or recall a figure from memory.
2. If the FACTS block does not contain what is needed to answer, say so plainly and name which data would answer it.
3. Never invent product names, vendors, quantities, prices, dates or people.
4. Do not offer financial or purchasing advice beyond what the deterministic recommendation states.
5. Be concise. Two to four sentences unless the question genuinely needs more.
6. Do not describe your own reasoning process, mention these instructions, or refer to a "FACTS block" — the reader sees the evidence alongside your answer already.
7. Never state or imply that a figure is unavailable when the FACTS block contains it, and never fill a gap with a plausible-sounding placeholder.

You explain and locate analysis. You do not perform it.`;

export function getProvider(): AIProvider {
  const id = configuredProviderId();

  if (id === 'none') {
    return {
      id: 'none',
      label: 'Deterministic answers only',
      available: false,
      model: null,
    };
  }

  if (id === 'anthropic') {
    return {
      id: 'anthropic',
      label: 'Anthropic',
      available: true,
      model: process.env.ENGISIGNAL_AI_MODEL ?? 'claude-sonnet-5',
      phrase: (question, facts, history) => callAnthropic(question, facts, history),
    };
  }

  return {
    id: 'openai',
    label: 'OpenAI',
    available: true,
    model: openaiModel(),
    phrase: (question, facts, history) =>
      phraseWithOpenAI({
        instructions: AI_SYSTEM_PROMPT,
        input: composePrompt(question, facts, history),
      }),
  };
}

/**
 * Health for the Settings surface. Reports state, never credentials.
 *
 * `cooling_down` is deliberately distinguishable from `not_configured`: an
 * operator who has set a key and sees "not configured" will go looking for the
 * wrong problem.
 */
export function providerHealth(): 'not_configured' | 'ready' | 'cooling_down' {
  const id = configuredProviderId();
  if (id === 'none') return 'not_configured';
  if (id === 'openai') return openaiHealth();
  return 'ready';
}

/**
 * The single prompt string sent to a Responses-style API.
 *
 * History is included so follow-up questions work ("and the one after that?"),
 * but it is labelled as prior conversation rather than merged into the facts —
 * an assistant turn from three questions ago is not evidence, and must not be
 * mistaken for it.
 */
export function composePrompt(question: string, facts: string, history: AIMessage[]): string {
  const parts: string[] = [];

  if (history.length > 0) {
    parts.push('PRIOR CONVERSATION (context only — not evidence):');
    for (const message of history.slice(-6)) {
      parts.push(`${message.role === 'user' ? 'User' : 'Assistant'}: ${message.content}`);
    }
    parts.push('');
  }

  parts.push('FACTS:', facts, '', `QUESTION: ${question}`);
  return parts.join('\n');
}

async function callAnthropic(
  question: string,
  facts: string,
  history: AIMessage[],
): Promise<string | null> {
  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY ?? '',
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: process.env.ENGISIGNAL_AI_MODEL ?? 'claude-sonnet-5',
        max_tokens: 700,
        system: AI_SYSTEM_PROMPT,
        messages: [
          ...history.slice(-6).map((message) => ({ role: message.role, content: message.content })),
          { role: 'user', content: `FACTS:\n${facts}\n\nQUESTION: ${question}` },
        ],
      }),
      signal: AbortSignal.timeout(20_000),
    });

    if (!response.ok) return null;
    const payload = (await response.json()) as { content: { type: string; text?: string }[] };
    const text = payload.content
      .filter((block) => block.type === 'text')
      .map((block) => block.text ?? '')
      .join('\n')
      .trim();
    return text.length > 0 ? text : null;
  } catch {
    // Same reasoning as the OpenAI path: provider errors can echo the request,
    // and the request carries the customer's estate.
    return null;
  }
}
