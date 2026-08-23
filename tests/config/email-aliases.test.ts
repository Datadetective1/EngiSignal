import { describe, expect, it } from 'vitest';

import { brand } from '@/config/brand';
import {
  MAIL_DOMAIN,
  PUBLIC_ALIASES,
  emailAliases,
  isPublicAlias,
  sender,
  type EmailAlias,
} from '@/config/email';

/**
 * ── THE ADDRESSES THE COMPANY ACTUALLY OWNS ─────────────────────────────────
 *
 * Two things can go wrong with company email in a codebase, and both are quiet.
 *
 * An address gets hard-coded into a component. Cloudflare's catch-all is
 * disabled, so a plausible-looking alias that nobody created does not bounce
 * loudly to the person who wrote it — it bounces to whoever mailed it.
 *
 * Or the private forwarding mailbox behind the aliases gets pasted somewhere
 * customer-facing, because it is the address that actually receives the mail
 * and it is therefore the one a helpful person reaches for. It must never
 * appear: not in the UI, not in application mail, not in metadata.
 *
 * These tests hold both lines at the only place the addresses are defined.
 */

const ALIASES = Object.keys(emailAliases) as EmailAlias[];

describe('the alias set', () => {
  it('covers every alias configured in Cloudflare Email Routing', () => {
    expect(ALIASES.sort()).toEqual(
      [
        'admin',
        'billing',
        'general',
        'legal',
        'notifications',
        'partners',
        'pilot',
        'privacy',
        'security',
        'support',
      ].sort(),
    );
  });

  it('puts every alias on the company domain', () => {
    for (const alias of ALIASES) {
      expect(emailAliases[alias], alias).toMatch(
        new RegExp(`@${MAIL_DOMAIN.replace('.', '\\.')}$`),
      );
    }
  });

  it('uses each local part exactly once, so two names cannot mean one mailbox', () => {
    const addresses = ALIASES.map((alias) => emailAliases[alias]);
    expect(new Set(addresses).size).toBe(addresses.length);
  });

  it('never carries a free-mail or forwarding destination', () => {
    // The aliases forward to a private operational mailbox. That address is a
    // Cloudflare concern and must not exist in this repository at all.
    for (const alias of ALIASES) {
      expect(emailAliases[alias], alias).not.toMatch(
        /outlook\.com|hotmail\.|gmail\.com|live\.com|yahoo\./i,
      );
    }
  });
});

describe('which addresses may face a customer', () => {
  it('keeps the system sender and the internal alias out of public lists', () => {
    expect(isPublicAlias('notifications')).toBe(false);
    expect(isPublicAlias('admin')).toBe(false);
  });

  it('publishes the eight that answer a real question', () => {
    expect([...PUBLIC_ALIASES].sort()).toEqual([
      'billing',
      'general',
      'legal',
      'partners',
      'pilot',
      'privacy',
      'security',
      'support',
    ]);
  });

  it('marks every public alias as public', () => {
    for (const alias of PUBLIC_ALIASES) {
      expect(isPublicAlias(alias), alias).toBe(true);
    }
  });
});

describe('sender identities', () => {
  it('names the company in front of the address', () => {
    expect(sender('pilot')).toBe(`EngiSignal <${emailAliases.pilot}>`);
    expect(sender('notifications')).toBe(`EngiSignal <${emailAliases.notifications}>`);
  });
});

describe('the brand contact block', () => {
  it('is the alias set, so there is one place to change an address', () => {
    expect(brand.contact).toBe(emailAliases);
  });

  it('still answers the two keys that shipped before the alias set existed', () => {
    // app/page.tsx and the pilot form read these. Renaming them silently would
    // compile and then render an empty mailto:.
    expect(brand.contact.support).toBe(emailAliases.support);
    expect(brand.contact.pilot).toBe(emailAliases.pilot);
  });
});
