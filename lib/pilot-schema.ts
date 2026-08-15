import { z } from 'zod';

/**
 * Pilot request validation.
 *
 * Shared by the client form and the API route so the two can never disagree
 * about what is acceptable. Validation runs on the server regardless of what
 * the client did.
 */

export const EMPLOYEE_RANGES = [
  'Under 250',
  '250 – 1,000',
  '1,000 – 5,000',
  '5,000 – 20,000',
  'Over 20,000',
] as const;

export const ENGINEERING_RANGES = [
  'Under 100',
  '100 – 500',
  '500 – 2,000',
  '2,000 – 10,000',
  'Over 10,000',
] as const;

export const SPEND_RANGES = [
  'Under $500K',
  '$500K – $2M',
  '$2M – $10M',
  '$10M – $50M',
  'Over $50M',
  'Not sure',
] as const;

export const RENEWAL_TIMINGS = [
  'Within 30 days',
  'Within 90 days',
  'Within 6 months',
  'Within 12 months',
  'No renewal imminent',
] as const;

export const CHALLENGES = [
  'We cannot see what is actually used',
  'Renewals happen without a demand position',
  'We suspect we are over-licensed',
  'We hit capacity limits and denials',
  'We cannot allocate cost to programs or departments',
  'We cannot forecast next year’s demand',
  'Something else',
] as const;

/**
 * An optional select: an unselected control submits an empty string, which is
 * not a valid enum member. Normalize blank to undefined before validating so a
 * skipped optional field cannot fail the form.
 */
function optionalEnum<T extends readonly [string, ...string[]]>(values: T) {
  return z.preprocess(
    (value) => (typeof value === 'string' && value.trim().length === 0 ? undefined : value),
    z.enum(values).optional(),
  );
}

export const pilotRequestSchema = z.object({
  // ── Required: the minimum needed to scope a pilot conversation ───────────
  name: z.string().trim().min(2, 'Enter your name.').max(120),
  workEmail: z
    .string()
    .trim()
    .min(5, 'Enter your work email.')
    .max(200)
    .email('Enter a valid email address.'),
  company: z.string().trim().min(2, 'Enter your company.').max(160),
  jobTitle: z.string().trim().min(2, 'Enter your job title.').max(160),
  softwareSpendRange: z.enum(SPEND_RANGES),
  renewalTiming: z.enum(RENEWAL_TIMINGS),

  // ── Optional: useful context, never a barrier to requesting a pilot ──────
  approximateEmployees: optionalEnum(EMPLOYEE_RANGES),
  engineeringEmployees: optionalEnum(ENGINEERING_RANGES),
  majorVendors: z.string().trim().max(400).optional().default(''),
  primaryChallenge: optionalEnum(CHALLENGES),
  message: z.string().trim().max(2000).optional().default(''),
});

export type PilotRequestInput = z.infer<typeof pilotRequestSchema>;
