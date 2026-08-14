/**
 * Single source of brand truth for EngiSignal.
 *
 * Legal entity information is intentionally NOT hard-coded here. When a legal
 * entity is registered, populate NEXT_PUBLIC_LEGAL_ENTITY_NAME and it flows
 * through automatically.
 */

export const brand = {
  /** Product name. Always rendered exactly this way. */
  name: 'EngiSignal',

  /** Display name for the operating company. Overridable via env. */
  companyDisplayName: process.env.NEXT_PUBLIC_LEGAL_ENTITY_NAME ?? 'EngiSignal',

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

  contact: {
    support: process.env.NEXT_PUBLIC_SUPPORT_EMAIL ?? 'support@engisignal.com',
    pilot: process.env.NEXT_PUBLIC_PILOT_EMAIL ?? 'pilot@engisignal.com',
  },

  /** Canonical site URL, used for absolute metadata URLs. */
  url: process.env.NEXT_PUBLIC_SITE_URL ?? 'https://engisignal.com',

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
