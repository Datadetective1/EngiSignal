import { NextResponse } from 'next/server';
import { getDataProvider } from '@/lib/data';
import { pilotRequestSchema } from '@/lib/pilot-schema';

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
      message: parsed.data.message.length > 0 ? parsed.data.message : null,
    });

    return NextResponse.json({ ok: true, id: created.id });
  } catch {
    return NextResponse.json(
      { error: 'The request could not be recorded. Please email us instead.' },
      { status: 500 },
    );
  }
}
