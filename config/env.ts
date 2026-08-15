/**
 * Environment access.
 *
 * ONE accessor, because this codebase has now shipped the same bug twice.
 *
 *   NEXT_PUBLIC_SITE_URL=""          → new URL('') threw and broke the build
 *   ENGISIGNAL_MAX_UPLOAD_BYTES=""   → Number('') was 0, rejecting every upload
 *
 * Both had the same shape: `??` only falls back on null and undefined, and a
 * platform variable that exists but was left blank is an empty string. It
 * passes the guard and then fails somewhere far away, as a wrong value rather
 * than a missing one — which is much harder to diagnose than a crash.
 *
 * The rule here is simple and applies everywhere: a blank or whitespace-only
 * variable is treated as ABSENT. Nothing downstream ever sees an empty string.
 */

/** Raw value, or undefined when unset, blank or whitespace-only. */
export function envValue(name: string): string | undefined {
  const raw = process.env[name];
  if (typeof raw !== 'string') return undefined;
  const trimmed = raw.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}

export function envString(name: string, fallback: string): string {
  return envValue(name) ?? fallback;
}

/** Optional string with no fallback — for genuinely optional configuration. */
export function envOptional(name: string): string | null {
  return envValue(name) ?? null;
}

/**
 * Positive integer, or the fallback.
 *
 * Zero and negatives are rejected rather than honoured: every current use is a
 * limit, and a limit of zero silently disables the feature it guards instead of
 * loosening it.
 */
export function envPositiveInt(name: string, fallback: number): number {
  const raw = envValue(name);
  if (raw === undefined) return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.floor(parsed);
}

export function envBoolean(name: string, fallback = false): boolean {
  const raw = envValue(name)?.toLowerCase();
  if (raw === undefined) return fallback;
  if (['1', 'true', 'yes', 'on'].includes(raw)) return true;
  if (['0', 'false', 'no', 'off'].includes(raw)) return false;
  return fallback;
}

/** True when every named variable is present and non-blank. */
export function envAllPresent(...names: string[]): boolean {
  return names.every((name) => envValue(name) !== undefined);
}

// ─────────────────────────────────────────────────────────────────────────────
// Derived configuration
// ─────────────────────────────────────────────────────────────────────────────

export const SUPABASE_URL_VAR = 'NEXT_PUBLIC_SUPABASE_URL';
export const SUPABASE_ANON_VAR = 'NEXT_PUBLIC_SUPABASE_ANON_KEY';

export function supabaseUrl(): string | null {
  return envOptional(SUPABASE_URL_VAR);
}

export function supabaseAnonKey(): string | null {
  return envOptional(SUPABASE_ANON_VAR);
}

/** Supabase is usable only when BOTH credentials are genuinely present. */
export function hasSupabaseCredentials(): boolean {
  return envAllPresent(SUPABASE_URL_VAR, SUPABASE_ANON_VAR);
}

/**
 * Whether EngiSignal should run against Supabase.
 *
 * Requires the explicit selection AND working credentials. A half-configured
 * environment falls back to the local dataset rather than failing, because a
 * broken evaluation is worse than a local one — but see `configReport()`, which
 * makes that fallback visible instead of silent.
 */
export function supabaseEnabled(): boolean {
  return envValue('ENGISIGNAL_DATA_PROVIDER') === 'supabase' && hasSupabaseCredentials();
}

export interface ConfigIssue {
  variable: string;
  problem: 'blank' | 'missing';
  impact: string;
}

/**
 * Configuration problems worth surfacing.
 *
 * Distinguishes blank from missing deliberately: "you created this variable and
 * left it empty" is a different mistake from "you never set it", and the first
 * one is the one that has bitten this project.
 */
export function configReport(): { usingSupabase: boolean; issues: ConfigIssue[] } {
  const issues: ConfigIssue[] = [];
  const selected = envValue('ENGISIGNAL_DATA_PROVIDER') === 'supabase';

  if (selected) {
    for (const variable of [SUPABASE_URL_VAR, SUPABASE_ANON_VAR]) {
      if (envValue(variable) === undefined) {
        issues.push({
          variable,
          problem: typeof process.env[variable] === 'string' ? 'blank' : 'missing',
          impact: 'Supabase was selected but cannot be reached, so EngiSignal fell back to local data.',
        });
      }
    }
  }

  for (const variable of ['ENGISIGNAL_MAX_UPLOAD_BYTES', 'ENGISIGNAL_MAX_IMPORT_ROWS']) {
    if (typeof process.env[variable] === 'string' && envValue(variable) === undefined) {
      issues.push({
        variable,
        problem: 'blank',
        impact: 'Blank limit ignored; the documented default is used instead of zero.',
      });
    }
  }

  return { usingSupabase: supabaseEnabled(), issues };
}
