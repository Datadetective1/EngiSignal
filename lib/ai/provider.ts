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
  /**
   * Phrase an answer given retrieved facts. Implementations MUST be given the
   * facts and MUST NOT be asked to compute or recall figures independently.
   */
  phrase?(question: string, facts: string, history: AIMessage[]): Promise<string>;
}

export function configuredProviderId(): AIProviderId {
  const configured = process.env.ENGISIGNAL_AI_PROVIDER;
  if (configured === 'anthropic' && (process.env.ANTHROPIC_API_KEY ?? '').length > 0) return 'anthropic';
  if (configured === 'openai' && (process.env.OPENAI_API_KEY ?? '').length > 0) return 'openai';
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

You explain and locate analysis. You do not perform it.`;

export function getProvider(): AIProvider {
  const id = configuredProviderId();

  if (id === 'none') {
    return {
      id: 'none',
      label: 'Deterministic answers only',
      available: false,
    };
  }

  return {
    id,
    label: id === 'anthropic' ? 'Anthropic' : 'OpenAI',
    available: true,
    async phrase(question, facts, history) {
      // Implementations are intentionally thin: the model receives the facts and
      // is asked only to phrase them.
      if (id === 'anthropic') return callAnthropic(question, facts, history);
      return callOpenAI(question, facts, history);
    },
  };
}

async function callAnthropic(question: string, facts: string, history: AIMessage[]): Promise<string> {
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
        ...history.map((message) => ({ role: message.role, content: message.content })),
        { role: 'user', content: `FACTS:\n${facts}\n\nQUESTION: ${question}` },
      ],
    }),
  });

  if (!response.ok) throw new Error(`Anthropic request failed: ${response.status}`);
  const payload = (await response.json()) as { content: { type: string; text?: string }[] };
  return payload.content
    .filter((block) => block.type === 'text')
    .map((block) => block.text ?? '')
    .join('\n')
    .trim();
}

async function callOpenAI(question: string, facts: string, history: AIMessage[]): Promise<string> {
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${process.env.OPENAI_API_KEY ?? ''}`,
    },
    body: JSON.stringify({
      model: process.env.ENGISIGNAL_AI_MODEL ?? 'gpt-4o',
      max_tokens: 700,
      messages: [
        { role: 'system', content: AI_SYSTEM_PROMPT },
        ...history.map((message) => ({ role: message.role, content: message.content })),
        { role: 'user', content: `FACTS:\n${facts}\n\nQUESTION: ${question}` },
      ],
    }),
  });

  if (!response.ok) throw new Error(`OpenAI request failed: ${response.status}`);
  const payload = (await response.json()) as { choices: { message: { content: string } }[] };
  return payload.choices[0]?.message.content.trim() ?? '';
}
