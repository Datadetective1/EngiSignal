import { NextResponse } from 'next/server';
import { getDataProvider } from '@/lib/data';
import { pilotRequestSchema } from '@/lib/pilot-schema';
import { notifyPilotRequest } from '@/lib/pilot/notify';
import { recordNotificationOutcome } from '@/lib/pilot/record-outcome';

export const runtime = 'nodejs';

/**
 * Pilot request capture.
 *
 * Public by necessity, so it is rate-limited per IP and validated server-side
 * regardless of what the client did. Nothing collected here is sensitive
 * beyond ordinary business contact details, and no payment information is
 * requested at any point.
 */

const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 5;
const attempts = new Map<string, { count: number; resetAt: number }>();

function rateLimit(key: string): boolean {
  const now = Date.now();
  const entry = attempts.get(key);

  if (entry === undefined || now > entry.resetAt) {
    attempts.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return true;
  }
  if (entry.count >= MAX_PER_WINDOW) return false;
  entry.count += 1;
  return true;
}

export async function POST(request: Request) {
  const forwarded = request.headers.get('x-forwarded-for') ?? 'unknown';
  const ip = forwarded.split(',')[0]?.trim() ?? 'unknown';

  if (!rateLimit(ip)) {
    return NextResponse.json(
      { error: 'Too many requests. Try again in a minute.' },
      { status: 429 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
  }

  const parsed = pilotRequestSchema.safeParse(body);
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const field = issue.path[0];
      if (typeof field === 'string' && fieldErrors[field] === undefined) {
        fieldErrors[field] = issue.message;
      }
    }
    return NextResponse.json({ error: 'Some details need attention.', fieldErrors }, { status: 400 });
  }

  try {
    const created = await getDataProvider().createPilotRequest({
      ...parsed.data,
      // Optional fields are stored as empty strings rather than omitted, so the
      // record shape stays uniform for whoever reads the pipeline.
      approximateEmployees: parsed.data.approximateEmployees ?? '',
      engineeringEmployees: parsed.data.engineeringEmployees ?? '',
      primaryChallenge: parsed.data.primaryChallenge ?? '',
      majorVendors: parsed.data.majorVendors,
      message: parsed.data.message.length > 0 ? parsed.data.message : null,
    });

    // ── THE REQUEST IS STORED; TELLING US IS SEPARATE ────────────────────
    //
    // Awaited rather than fired and forgotten, because a serverless invocation
    // can be frozen the moment the response is returned and an un-awaited send
    // would simply vanish. It cannot fail the request: `notifyPilotRequest`
    // never throws and carries its own timeout, so the worst case costs this
    // response a few seconds and the prospect still gets their confirmation.
    const notified = await notifyPilotRequest(created);

    // Recorded against the request itself, not only in a log. Resend rejected
    // every send for a day with "Invalid from field" and the product said
    // nothing: the prospect saw success, correctly, and the operator saw
    // silence. Stamping the outcome makes "was this lead announced?" a query.
    //
    // Non-fatal, like the send itself: the lead is already stored, and losing
    // its delivery receipt is not a reason to tell the prospect otherwise.
    await recordNotificationOutcome(created.id, notified).catch(() => undefined);

    if (notified.outcome === 'failed') {
      console.error(
        `Pilot request ${created.id} stored but the notification failed: ${notified.detail ?? 'no detail'}`,
      );
    }

    return NextResponse.json({ ok: true, id: created.id });
  } catch {
    return NextResponse.json(
      { error: 'The request could not be recorded. Please email us instead.' },
      { status: 500 },
    );
  }
}
