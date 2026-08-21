import { describe, expect, it, vi } from 'vitest';

// Both modules are server-only, and the marker package refuses to load outside
// a Server Component. The functions under test are pure; only the transport
// around them needs a session.
vi.mock('server-only', () => ({}));

import {
  ASSIGNABLE_ROLES,
  ROLE_LABELS,
  canManageMembers,
  createInvitationToken,
  isOwner,
  membershipErrorMessage,
} from '@/lib/membership';
import { composeInvitation } from '@/lib/email/invitation';

/**
 * Unit cover for the parts of multi-user membership that are pure logic.
 *
 * The authorization rules themselves are NOT tested here, and deliberately so:
 * they live in Postgres, and asserting them against a TypeScript mock would
 * prove only that the mock agrees with itself. They are proven against a live
 * database by tests/sql/multiuser_guarantees.sql, which impersonates real
 * authenticated users and exercises the same policies a request from the
 * internet meets.
 *
 * What is worth testing here is everything that decides what a HUMAN sees: the
 * role predicates the interface uses to hide controls, the token generator, and
 * the words in the invitation email.
 */

describe('role predicates', () => {
  it('lets owners and admins manage membership, and nobody else', () => {
    expect(canManageMembers('owner')).toBe(true);
    expect(canManageMembers('admin')).toBe(true);
    expect(canManageMembers('member')).toBe(false);
    expect(canManageMembers('analyst')).toBe(false);
    expect(canManageMembers('viewer')).toBe(false);
    expect(canManageMembers(null)).toBe(false);
  });

  it('recognises an owner and only an owner', () => {
    expect(isOwner('owner')).toBe(true);
    expect(isOwner('admin')).toBe(false);
    expect(isOwner(null)).toBe(false);
  });

  it('offers exactly two roles to invite into', () => {
    // Owner is deliberately absent: an invitation cannot mint one, because that
    // would be a promotion path around the owner-only rule.
    expect([...ASSIGNABLE_ROLES]).toEqual(['admin', 'member']);
  });

  it('labels the legacy roles honestly rather than folding them into Member', () => {
    // A viewer cannot write; calling it "Member" in the interface would make
    // the product describe a permission the database does not grant.
    expect(ROLE_LABELS.viewer).toContain('legacy');
    expect(ROLE_LABELS.analyst).toContain('legacy');
    expect(ROLE_LABELS.member).toBe('Member');
  });
});

describe('invitation tokens', () => {
  it('is long enough for the database to accept', () => {
    // invite_to_organization rejects anything under 32 characters as a bug
    // upstream rather than trusting the caller to have used a real CSPRNG.
    expect(createInvitationToken().length).toBeGreaterThanOrEqual(32);
  });

  it('is URL-safe, so it survives an email client and an address bar', () => {
    for (let i = 0; i < 50; i++) {
      expect(createInvitationToken()).toMatch(/^[A-Za-z0-9_-]+$/);
    }
  });

  it('does not repeat', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 500; i++) seen.add(createInvitationToken());
    expect(seen.size).toBe(500);
  });
});

describe('membership error messages', () => {
  it('turns each database condition into advice a person can act on', () => {
    expect(membershipErrorMessage('already_member')).toContain('already a member');
    expect(membershipErrorMessage('owner_protected')).toContain('Only an Owner');
    expect(membershipErrorMessage('last_owner: an organization must...')).toContain(
      'at least one Owner',
    );
    expect(membershipErrorMessage('invitation_expired')).toContain('expired');
    expect(membershipErrorMessage('invitation_revoked')).toContain('revoked');
    expect(membershipErrorMessage('invitation_already_used')).toContain('already been used');
    expect(membershipErrorMessage('invitation_email_mismatch')).toContain('different email');
  });

  it('never echoes an unrecognised database error at a customer', () => {
    const message = membershipErrorMessage(
      'duplicate key value violates unique constraint "organization_members_pkey"',
    );
    expect(message).toBe('That did not work. Nothing was changed.');
    expect(message).not.toContain('constraint');
  });

  it('says nothing changed, because nothing did', () => {
    // Every one of these functions either completes or raises; there is no
    // partial path. The message is allowed to promise that.
    expect(membershipErrorMessage(null)).toContain('Nothing was changed');
    expect(membershipErrorMessage(undefined)).toContain('Nothing was changed');
  });
});

describe('the invitation email', () => {
  const base = {
    to: 'colleague@northvane.example',
    organizationName: 'Northvane Aerospace',
    invitedByEmail: 'lead@northvane.example',
    acceptUrl: 'https://www.engisignal.com/invite/abc123',
    // Midday, mid-month: the rendered date is the same in every timezone the
    // server might be running in, so this assertion is not a trap for CI.
    expiresAt: '2026-09-15T12:00:00.000Z',
  };

  it('names the inviter and the workspace in the subject', () => {
    const { subject } = composeInvitation({ ...base, role: 'member' });
    expect(subject).toContain('lead@northvane.example');
    expect(subject).toContain('Northvane Aerospace');
  });

  it('states the role being granted', () => {
    expect(composeInvitation({ ...base, role: 'admin' }).text).toContain('Admin');
    expect(composeInvitation({ ...base, role: 'member' }).text).toContain('Member');
  });

  it('says which address must be used, because that is what acceptance checks', () => {
    const { text } = composeInvitation({ ...base, role: 'member' });
    expect(text).toContain('colleague@northvane.example');
  });

  it('carries the link in both the text and the HTML part', () => {
    const { text, html } = composeInvitation({ ...base, role: 'member' });
    expect(text).toContain(base.acceptUrl);
    expect(html).toContain(base.acceptUrl);
  });

  it('tells the recipient the link is single-use and dated', () => {
    const { text } = composeInvitation({ ...base, role: 'member' });
    expect(text).toContain('works once');
    expect(text).toContain('September');
  });

  it('escapes a workspace name so it cannot inject markup into the email', () => {
    const { html } = composeInvitation({
      ...base,
      organizationName: '<script>alert(1)</script>Acme',
      role: 'member',
    });
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('survives an unparseable expiry rather than printing "Invalid Date"', () => {
    const { text } = composeInvitation({ ...base, expiresAt: 'not-a-date', role: 'member' });
    expect(text).not.toContain('Invalid Date');
    expect(text).toContain('in seven days');
  });
});
