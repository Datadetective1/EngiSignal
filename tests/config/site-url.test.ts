import { afterEach, describe, expect, it } from 'vitest';
import { LOCAL_SITE_URL, normalizeSiteUrl, resolveSiteUrl, siteUrlObject } from '@/config/site-url';

const KEYS = ['NEXT_PUBLIC_SITE_URL', 'VERCEL_PROJECT_PRODUCTION_URL', 'VERCEL_URL'] as const;

function clearEnv() {
  for (const key of KEYS) delete process.env[key];
}

afterEach(clearEnv);

describe('normalizeSiteUrl', () => {
  it('rejects the empty string that broke the production build', () => {
    // `new URL('')` throws ERR_INVALID_URL. A Vercel variable created without
    // a value arrives as '' and is NOT caught by `??`.
    expect(() => new URL('')).toThrow();
    expect(normalizeSiteUrl('')).toBeNull();
    expect(normalizeSiteUrl('   ')).toBeNull();
  });

  it('rejects missing values', () => {
    expect(normalizeSiteUrl(undefined)).toBeNull();
    expect(normalizeSiteUrl(null)).toBeNull();
  });

  it('rejects malformed and non-http values instead of throwing', () => {
    expect(normalizeSiteUrl('not a url')).toBeNull();
    expect(normalizeSiteUrl('http://')).toBeNull();
    expect(normalizeSiteUrl('javascript:alert(1)')).toBeNull();
    expect(normalizeSiteUrl('ftp://example.com')).toBeNull();
  });

  it('accepts a full URL and strips the trailing slash', () => {
    expect(normalizeSiteUrl('https://engisignal.com')).toBe('https://engisignal.com');
    expect(normalizeSiteUrl('https://engisignal.com/')).toBe('https://engisignal.com');
  });

  it('adds https to the bare hostnames Vercel supplies', () => {
    expect(normalizeSiteUrl('engisignal.vercel.app')).toBe('https://engisignal.vercel.app');
  });

  it('preserves localhost with its port and protocol', () => {
    expect(normalizeSiteUrl('http://localhost:3000')).toBe('http://localhost:3000');
  });

  it('trims surrounding whitespace', () => {
    expect(normalizeSiteUrl('  https://engisignal.com  ')).toBe('https://engisignal.com');
  });

  it('preserves a base path when one is configured', () => {
    expect(normalizeSiteUrl('https://example.com/engisignal')).toBe('https://example.com/engisignal');
  });
});

describe('resolveSiteUrl — preference order', () => {
  it('prefers explicit configuration above everything', () => {
    process.env.NEXT_PUBLIC_SITE_URL = 'https://engisignal.com';
    process.env.VERCEL_PROJECT_PRODUCTION_URL = 'prod.vercel.app';
    process.env.VERCEL_URL = 'deployment.vercel.app';
    expect(resolveSiteUrl()).toBe('https://engisignal.com');
  });

  it('falls through to the Vercel production domain', () => {
    process.env.VERCEL_PROJECT_PRODUCTION_URL = 'prod.vercel.app';
    process.env.VERCEL_URL = 'deployment.vercel.app';
    expect(resolveSiteUrl()).toBe('https://prod.vercel.app');
  });

  it('falls through to the per-deployment Vercel domain', () => {
    process.env.VERCEL_URL = 'deployment.vercel.app';
    expect(resolveSiteUrl()).toBe('https://deployment.vercel.app');
  });

  it('falls back to localhost only when nothing else is configured', () => {
    expect(resolveSiteUrl()).toBe(LOCAL_SITE_URL);
  });

  it('skips a blank explicit value rather than failing the build', () => {
    // This is the exact production failure: the variable exists but is empty.
    process.env.NEXT_PUBLIC_SITE_URL = '';
    process.env.VERCEL_PROJECT_PRODUCTION_URL = 'prod.vercel.app';
    expect(resolveSiteUrl()).toBe('https://prod.vercel.app');
  });

  it('skips every blank candidate down to localhost', () => {
    process.env.NEXT_PUBLIC_SITE_URL = '';
    process.env.VERCEL_PROJECT_PRODUCTION_URL = '';
    process.env.VERCEL_URL = '';
    expect(resolveSiteUrl()).toBe(LOCAL_SITE_URL);
  });

  it('skips a malformed explicit value', () => {
    process.env.NEXT_PUBLIC_SITE_URL = 'not a url';
    expect(resolveSiteUrl()).toBe(LOCAL_SITE_URL);
  });
});

describe('siteUrlObject', () => {
  it('never throws, for any combination of blank or broken input', () => {
    const cases: (string | undefined)[] = [undefined, '', '   ', 'not a url', 'http://', 'ftp://x.com'];

    for (const value of cases) {
      clearEnv();
      if (value !== undefined) process.env.NEXT_PUBLIC_SITE_URL = value;
      expect(() => siteUrlObject(), `input: ${JSON.stringify(value)}`).not.toThrow();
      expect(siteUrlObject()).toBeInstanceOf(URL);
    }
  });

  it('produces a usable metadataBase', () => {
    process.env.NEXT_PUBLIC_SITE_URL = 'https://engisignal.com';
    const base = siteUrlObject();
    expect(base.origin).toBe('https://engisignal.com');
    expect(new URL('/app', base).href).toBe('https://engisignal.com/app');
  });
});
