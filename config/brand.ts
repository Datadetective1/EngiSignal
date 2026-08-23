import { resolveSiteUrl } from './site-url';
import { emailAliases } from './email';

/**
 * Single source of brand truth for EngiSignal.
 *
 * Legal entity information is intentionally NOT hard-coded here. When a legal
 * entity is registered, populate NEXT_PUBLIC_LEGAL_ENTITY_NAME and it flows
 * through automatically.
 */

/**
 * Fall back when a variable is missing OR defined-but-blank.
 *
 * `??` only catches null and undefined. An environment variable created
 * without a value is an empty string, which would otherwise render as an empty
 * company name or an empty `mailto:` link. This is the same root cause that
 * broke the production build via `new URL('')`.
 */
function envOr(value: string | undefined, fallback: string): string {
  const trimmed = value?.trim();
  return trimmed === undefined || trimmed.length === 0 ? fallback : trimmed;
}

export const brand = {
  /** Product name. Always rendered exactly this way. */
  name: 'EngiSignal',

  /** Display name for the operating company. Overridable via env. */
  companyDisplayName: envOr(process.env.NEXT_PUBLIC_LEGAL_ENTITY_NAME, 'EngiSignal'),

  /** Product category — how we describe what kind of software this is. */
  category: 'Engineering Software Intelligence',

  /** Primary positioning line. */
  tagline: 'Turn engineering software data into signals you can act on.',

  /** The concrete promise. Used in hero support copy and meta description. */
  promise: 'Know what engineering software you actually need before your next renewal.',

  /** Short supporting message for secondary surfaces. */
  supportingMessage: 'Usage, cost, renewals and forecasts in one intelligence layer.',

  /** Hero headline. */
  heroHeadline: 'Engineering software. Clear signals. Better decisions.',
  heroSupport: 'Know what you use, what you need, and what to renew.',

  /**
   * Company contact addresses.
   *
   * The alias set lives in `config/email.ts`, which owns what each address
   * means and which of them may be shown to a customer. This is a re-export so
   * that `brand.contact.support` and `brand.contact.pilot` keep working for
   * everything that already reads them, and so that a component reaching for
   * `security` or `privacy` finds it in the same place rather than hard-coding
   * a new address.
   */
  contact: emailAliases,

  /**
   * Canonical site URL, used for absolute metadata URLs.
   *
   * Resolved rather than read directly: a defined-but-blank environment
   * variable is an empty string, which `??` does not catch and `new URL()`
   * rejects. See config/site-url.ts.
   */
  url: resolveSiteUrl(),

  meta: {
    title: 'EngiSignal — Engineering Software Intelligence',
    titleTemplate: '%s · EngiSignal',
    description:
      'EngiSignal turns engineering software usage, licenses, contracts and organizational data into explainable renewal, cost and capacity decisions.',
    keywords: [
      'engineering software intelligence',
      'engineering license optimization',
      'concurrent license analytics',
      'software renewal management',
      'license utilization',
      'engineering software spend',
    ],
  },

  social: {
    ogImageAlt: 'EngiSignal — Engineering Software Intelligence',
    twitterCard: 'summary_large_image' as const,
  },

  /** Primary commercial motion. */
  pilot: {
    name: '30-Day Engineering Software Intelligence Pilot',
    shortName: '30-Day Pilot',
    cta: 'Request a 30-Day Pilot',
    weeks: [
      { week: 'Week 1', label: 'Connect', detail: 'Import usage, contracts and organizational data.' },
      { week: 'Week 2', label: 'Analyze', detail: 'Normalize, compute demand and surface Signals.' },
      { week: 'Week 3', label: 'Validate', detail: 'Review evidence with your license administrators.' },
      { week: 'Week 4', label: 'Decide', detail: 'Produce renewal positions and an executive brief.' },
    ],
  },

  /** Legal disclosure required wherever third-party vendor names appear. */
  vendorDisclosure:
    'Product names, logos and brands are property of their respective owners. Their appearance does not imply affiliation or endorsement.',
} as const;

export type Brand = typeof brand;
