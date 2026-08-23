/**
 * ── EVERY COMPANY EMAIL ADDRESS, IN ONE PLACE ───────────────────────────────
 *
 * EngiSignal runs ten aliases on engisignal.com. Each one means something, and
 * choosing the wrong one is not cosmetic: a security researcher who cannot find
 * a security contact files a public issue, and a prospect who mails the support
 * alias waits behind product questions.
 *
 * Every alias below is a **forwarding alias**, not an independent mailbox.
 * Cloudflare Email Routing forwards them to one private operational mailbox.
 * That destination is deliberately absent from this repository: it must never
 * appear in customer-facing UI, application mail, documentation, metadata or
 * social profiles. Nothing here should ever be "helpfully" replaced with it.
 *
 * The catch-all is disabled on purpose. An address that is not in this file
 * does not receive mail, so inventing one in a component means mail silently
 * bounces.
 *
 * ── Why the literal process.env access ──────────────────────────────────────
 *
 * `config/env.ts` is the canonical accessor everywhere else, and it reads
 * `process.env[name]` by dynamic index. Next.js only substitutes NEXT_PUBLIC_
 * variables into the client bundle where it can see the literal member
 * expression `process.env.NEXT_PUBLIC_FOO` in the source. Routed through a
 * dynamic accessor, these two would compile to `undefined` in the browser and
 * quietly fall back to the defaults — the override would look wired up and do
 * nothing. So they are read literally here, and normalised locally.
 */

/** The one domain every company alias lives on. */
export const MAIL_DOMAIN = 'engisignal.com';

/**
 * Trim, and treat blank as absent.
 *
 * Mirrors `envString` in config/env.ts. A variable created in the platform UI
 * and left empty is an empty string, which `??` does not catch — the mistake
 * that has already broken this project's build once.
 */
function orDefault(value: string | undefined, fallback: string): string {
  const trimmed = value?.trim();
  return trimmed === undefined || trimmed.length === 0 ? fallback : trimmed;
}

const at = (local: string): string => `${local}@${MAIL_DOMAIN}`;

/**
 * The alias set.
 *
 * `support` and `pilot` keep their long-standing environment overrides, because
 * those variables are already set in production and other deployments of this
 * codebase may point them elsewhere. The remaining eight are fixed: adding
 * eight more NEXT_PUBLIC_ variables to express constants would be configuration
 * for its own sake, and this file is already the single place to change them.
 */
export const emailAliases = {
  /** General company and contact enquiries. The default public address. */
  general: at('hello'),

  /** Pilot applications, pilot prospects and pilot communication. */
  pilot: orDefault(process.env.NEXT_PUBLIC_PILOT_EMAIL, at('pilot')),

  /** Product and customer support. */
  support: orDefault(process.env.NEXT_PUBLIC_SUPPORT_EMAIL, at('support')),

  /** Security reports, questionnaires and vulnerability disclosure. */
  security: at('security'),

  /** Billing, subscriptions and invoices. */
  billing: at('billing'),

  /** Privacy and data-rights requests. */
  privacy: at('privacy'),

  /** Contracts, terms and legal notices. */
  legal: at('legal'),

  /** Partnerships, vendors and integrations. */
  partners: at('partners'),

  /** System-generated sender identity. Never advertise it as a contact. */
  notifications: at('notifications'),

  /** Internal infrastructure and administration. Never customer-facing. */
  admin: at('admin'),
} as const;

export type EmailAlias = keyof typeof emailAliases;

/**
 * Aliases that may appear in front of a customer.
 *
 * `notifications` is a sender identity, not a destination anybody should be
 * invited to write to, and `admin` is internal. Both are excluded so a
 * well-meaning "list our contacts" component cannot publish them.
 */
export const PUBLIC_ALIASES = [
  'general',
  'pilot',
  'support',
  'security',
  'billing',
  'privacy',
  'legal',
  'partners',
] as const satisfies readonly EmailAlias[];

export function isPublicAlias(alias: EmailAlias): boolean {
  return (PUBLIC_ALIASES as readonly EmailAlias[]).includes(alias);
}

/**
 * Display name on outbound mail.
 *
 * Held locally rather than imported from `config/brand.ts`, which imports this
 * file for its contact block. A cycle between the two would be resolvable but
 * pointless.
 */
const SENDER_NAME = 'EngiSignal';

/** A ready-to-send `From` header for one alias. */
export function sender(alias: EmailAlias): string {
  return `${SENDER_NAME} <${emailAliases[alias]}>`;
}

/**
 * ── SENDER AND REPLY-TO POLICY ──────────────────────────────────────────────
 *
 * Two rules, and the second is the one that matters.
 *
 *  1. The `From` identity names the system or the function that sent the mail.
 *  2. `Reply-To` names whoever should actually receive a reply — and when a
 *     human answer is wanted, that is never `notifications@`.
 *
 * Current outbound mail:
 *
 *   Pilot operator alert   From  pilot@         (PILOT_NOTIFY_FROM)
 *                          To    pilot@         (PILOT_NOTIFY_TO)
 *                          Reply the prospect who submitted the form, so
 *                                 hitting reply answers the lead.
 *
 *   Workspace invitation   From  notifications@ (ENGISIGNAL_INVITE_FROM,
 *                                 falling back to PILOT_NOTIFY_FROM)
 *                          To    the invitee
 *                          Reply the colleague who sent the invitation, so a
 *                                 confused invitee reaches a person who knows
 *                                 why they were invited.
 *
 * Any future mail that expects a human reply must set `Reply-To` to the alias
 * that owns the conversation — support@ for product problems, billing@ for
 * invoices, pilot@ for pilot logistics.
 */

/** Where a reply should go when the mail has no better human destination. */
export const DEFAULT_REPLY_TO = {
  support: emailAliases.support,
  pilot: emailAliases.pilot,
  billing: emailAliases.billing,
  security: emailAliases.security,
} as const;
