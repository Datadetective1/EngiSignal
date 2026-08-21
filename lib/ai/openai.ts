import 'server-only';
import OpenAI from 'openai';

/**
 * The OpenAI transport for Ask EngiSignal.
 *
 * ── WHAT THIS IS ALLOWED TO DO ──────────────────────────────────────────────
 *
 * Phrase facts that EngiSignal has already computed. Nothing else. The model is
 * never asked for a quantity, a price, a percentile or a date, and it is never
 * given the database — it receives a FACTS block assembled by the deterministic
 * retrieval layer, and every figure it is permitted to state appears verbatim
 * in that block.
 *
 * That constraint is the whole design. An engineering software renewal is a
 * six-figure decision defended in a negotiation, and a number that came from a
 * language model cannot be defended at all.
 *
 * ── WHY THE RESPONSES API ───────────────────────────────────────────────────
 *
 * It is the current OpenAI interface, and it takes `instructions` as a distinct
 * field from `input` rather than as a role inside a message array. The grounding
 * rules therefore travel in their own channel instead of as the first item in a
 * list a later message could crowd out.
 *
 * ── store: false, ALWAYS ────────────────────────────────────────────────────
 *
 * Every request carries a customer's estate: product names, vendors,
 * quantities, prices, renewal dates, sometimes usernames. There is no request
 * on this path that does NOT carry customer data, so there is no case where
 * retention would be appropriate and the flag is set unconditionally rather
 * than by a rule somebody could get wrong later.
 *
 * ── FAILURE IS A SUPPORTED STATE ────────────────────────────────────────────
 *
 * Unconfigured, rate-limited, timed out, wrong model name, provider outage —
 * every one of these returns null and the caller renders the deterministic
 * narrative instead. The answer is never lost, because the answer was never in
 * the model's keeping.
 */

/**
 * The default model, in exactly one place.
 *
 * Chosen for breadth of availability rather than capability: this is a phrasing
 * task over supplied facts, not a reasoning task, and a deployment whose account
 * lacks the newest model should still get grounded prose. `OPENAI_MODEL`
 * overrides it. A model name this deployment cannot use fails the same way any
 * other provider error does — deterministically, with the answer intact.
 */
export const DEFAULT_OPENAI_MODEL = 'gpt-4.1-mini';

/** Hard ceiling on the answer. Ask EngiSignal answers in a short paragraph. */
const MAX_OUTPUT_TOKENS = 700;

/** A person is waiting for this. Longer than this and the answer is late. */
const REQUEST_TIMEOUT_MS = 20_000;

/**
 * Retries are for transient faults only.
 *
 * The SDK retries 408/409/429/5xx with backoff. Two is enough to ride out a
 * blip without turning one impatient user into a sustained burst against a
 * provider that is already struggling.
 */
const MAX_RETRIES = 2;

/**
 * ── COST AND RATE PROTECTION ────────────────────────────────────────────────
 *
 * Two independent guards, because they fail differently.
 *
 * A token bucket caps how many calls this process will make in a rolling
 * minute. It exists so a scripted client, a retry loop in a browser, or a
 * genuinely enthusiastic user cannot turn Ask EngiSignal into an unbounded
 * spend. Refusal is silent to the answer: the deterministic narrative is
 * returned exactly as it would be with no key configured.
 *
 * A circuit breaker stops calling entirely after repeated failures. Without
 * one, a bad model name or a revoked key means every question pays the full
 * timeout before falling back — so the product feels broken for as long as the
 * misconfiguration lasts, rather than merely unenhanced.
 *
 * Both are per-process. On serverless that means per warm instance, which is
 * the right granularity for protecting spend without shared state.
 */
const RATE_LIMIT_PER_MINUTE = 20;
const CIRCUIT_FAILURE_THRESHOLD = 4;
const CIRCUIT_COOLDOWN_MS = 60_000;

const callTimestamps: number[] = [];
let consecutiveFailures = 0;
let circuitOpenedAt: number | null = null;

function withinRateLimit(): boolean {
  const now = Date.now();
  while (callTimestamps.length > 0 && now - callTimestamps[0]! > 60_000) callTimestamps.shift();
  if (callTimestamps.length >= RATE_LIMIT_PER_MINUTE) return false;
  callTimestamps.push(now);
  return true;
}

function circuitIsOpen(): boolean {
  if (circuitOpenedAt === null) return false;
  if (Date.now() - circuitOpenedAt >= CIRCUIT_COOLDOWN_MS) {
    circuitOpenedAt = null;
    consecutiveFailures = 0;
    return false;
  }
  return true;
}

function recordSuccess(): void {
  consecutiveFailures = 0;
  circuitOpenedAt = null;
}

function recordFailure(): void {
  consecutiveFailures += 1;
  if (consecutiveFailures >= CIRCUIT_FAILURE_THRESHOLD) circuitOpenedAt = Date.now();
}

/** Server-side only. Never rendered, never logged, never returned by an API. */
function apiKey(): string | null {
  const key = process.env.OPENAI_API_KEY;
  return key !== undefined && key.trim().length > 0 ? key.trim() : null;
}

export function openaiConfigured(): boolean {
  return apiKey() !== null;
}

export function openaiModel(): string {
  const configured = process.env.OPENAI_MODEL;
  return configured !== undefined && configured.trim().length > 0
    ? configured.trim()
    : DEFAULT_OPENAI_MODEL;
}

/** Why the model is not being used right now, for the Settings surface. */
export type OpenAIHealth = 'not_configured' | 'ready' | 'cooling_down';

export function openaiHealth(): OpenAIHealth {
  if (!openaiConfigured()) return 'not_configured';
  return circuitIsOpen() ? 'cooling_down' : 'ready';
}

let client: OpenAI | null = null;

function getClient(): OpenAI | null {
  const key = apiKey();
  if (key === null) return null;
  if (client === null) {
    client = new OpenAI({
      apiKey: key,
      timeout: REQUEST_TIMEOUT_MS,
      maxRetries: MAX_RETRIES,
    });
  }
  return client;
}

/** Reset the module's guards. Tests only — never called by the application. */
export function __resetOpenAIGuardsForTest(): void {
  callTimestamps.length = 0;
  consecutiveFailures = 0;
  circuitOpenedAt = null;
  client = null;
}

export interface PhraseInput {
  instructions: string;
  /** The complete prompt: FACTS block, history and the question. */
  input: string;
}

/**
 * Phrase an answer, or return null.
 *
 * Null is not an error condition to report to the user — it means "the
 * deterministic narrative stands", which is a complete answer on its own.
 */
export async function phraseWithOpenAI(request: PhraseInput): Promise<string | null> {
  const openai = getClient();
  if (openai === null) return null;
  if (circuitIsOpen()) return null;
  if (!withinRateLimit()) return null;

  try {
    const response = await openai.responses.create({
      model: openaiModel(),
      instructions: request.instructions,
      input: request.input,
      // See the header: every request on this path carries customer estate data.
      store: false,
      max_output_tokens: MAX_OUTPUT_TOKENS,
    });

    // A truncated answer is worse than no answer here. It can end mid-sentence
    // in the middle of a figure, and a half-written number next to a currency
    // symbol is exactly the kind of thing somebody screenshots into a
    // negotiation. Fall back to the deterministic narrative instead.
    if (response.status === 'incomplete') {
      recordFailure();
      return null;
    }

    const text = (response.output_text ?? '').trim();
    if (text.length === 0) {
      recordFailure();
      return null;
    }

    recordSuccess();
    return text;
  } catch {
    // Deliberately swallowed and never logged with detail. The provider's error
    // text can echo the request, and the request contains the customer's
    // estate — so a log line written to help debugging becomes the one place
    // tenant data leaves its boundary.
    recordFailure();
    return null;
  }
}
