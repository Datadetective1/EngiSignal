/**
 * The shortest password this product will accept.
 *
 * Must match the Supabase project's Auth setting. When the two disagree the
 * lower one is useless: the form accepts what the database then refuses, and
 * the customer is told something generic about a password they just typed.
 *
 * It lives here rather than beside the sign-in actions because that file is a
 * `'use server'` module, and those may export only async functions — exporting
 * a constant from one fails the build, which is how this file came to exist.
 */
export const MINIMUM_PASSWORD_LENGTH = 10;
