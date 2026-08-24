# Lifecycle emails — what exists, what does not, and what each one needs

Assessed 23 August 2026 against production `main`.

Every email EngiSignal sends today goes out **inline inside a request**:
`notifyPilotRequest` and `acknowledgePilotRequest` during the pilot form POST,
`sendInvitationEmail` during the invite action, `sendPasswordChangedEmail` during
the reset action. There is no queue, no cron and no webhook, and nothing below
proposes one unless it genuinely cannot be avoided.

The test applied to each candidate is the same:

1. **Is there a reliable server-side event?** A place in code that runs exactly
   once when the thing actually happened.
2. **Is the recipient's address reachable there?** Without widening RLS or
   reading another tenant's data.
3. **Can it be verified before it reaches a customer?**

---

## Built

### B · Password changed ✅

| | |
|---|---|
| Event | `updatePasswordAction` — `app/auth/reset/actions.ts`, after `updateUser` succeeds |
| Recipient | The acting user's own address, from the recovery session |
| Reply-To | `security@engisignal.com` |

Built because it is the strongest case of the five: the event is exact, the
recipient is the session's own account so no lookup crosses a tenant boundary,
and it is a **security control** rather than a nicety — without it, somebody who
completes a reset they did not start leaves the real owner with no signal at all.

Sent before the `redirect()`, which throws to unwind, and wrapped so that a mail
failure cannot undo a password change that has already been applied.

---

## Not built, and why

### A · Welcome / workspace ready ❌ — no "was created" signal

The event looks like it exists and does not. `ensureOrganization()` calls
`bootstrap_organization`, which `returns uuid` — **the same uuid whether it just
created the workspace or found an existing one**. It is called on every sign-in
and every confirmed sign-up, so sending from there would mail a welcome on every
login.

**Minimum architecture:** change `bootstrap_organization` to report which
happened — either return a row `(organization_id uuid, created boolean)`, or add
a second definer function `organization_created_at(org uuid)` the caller can
compare against `now()`. That is a migration, so it needs to be designed with the
RLS review rather than bolted on.

**Do not** infer it by counting memberships before and after: two concurrent
sign-ins race, and the loser sends a second welcome.

### C · Invitation accepted → tell the inviter ❌ — reachable, but the read is awkward

The event is fine: `accept_invitation_by_id` / `accept_organization_invitation`,
called from a server action. The inviter's address exists as
`organization_invitations.invited_by_email`.

The problem is **when** it can be read. The acceptor is the invitee, who at that
moment is not yet a member of the organization; after acceptance the invitation
row is consumed. So the address has to be captured *before* the RPC and carried
through, and there are two entry points (`/invite/[token]` and `/invitations`)
that both have to do it identically or the notification silently stops firing on
one of them.

**Minimum architecture:** have the accept RPC return `invited_by_email` alongside
the organization it joined. One definer function already inside the transaction,
one read, no ordering to get wrong, both entry points fixed at once.

### D · Role changed · E · Removed from workspace ⚠️ — buildable now, deliberately held

Both have a reliable event (`changeRoleAction`, `removeMemberAction`) and a
reachable recipient: `organization_members` carries an `email` column, which the
Members page already reads, so the acting admin can read it under existing RLS.
For **E** the read must happen *before* the RPC, because the row is gone after.

Each is roughly ten lines plus a template. They were not built in this pass for
two reasons that are about caution, not effort:

- **They mail a third party on an admin's behalf.** Every email the product
  sends today goes either to the person who acted, or to an address that person
  typed into a form. "Tell somebody else that something was done to their
  account" is a new class of action, and it deserves its own review rather than
  arriving as a side effect of a pilot-email change.
- **They cannot be production-verified without altering a live workspace.**
  Demoting or removing a real member to test an email is not an acceptable
  verification step, so these would ship covered by unit tests alone.

The copy also needs a decision that is not mine: whether being removed from a
workspace should generate an email at all. Some products do, many deliberately
do not, and the answer depends on how you want that conversation to go.

**Ready to build on approval of the wording.** Nothing technical is blocking.

---

## Ranked by importance

| Rank | Gap | Why | Blocker |
|---|---|---|---|
| 1 | **A · Welcome / workspace ready** | Signup lands in an empty workspace with nothing saying what to do. It is the largest hole in the customer experience. | Migration to signal "created" |
| 2 | **D · Role changed** | Gaining or losing admin silently is a security-relevant surprise. | Copy approval |
| 3 | **C · Invite accepted** | Owner currently polls the Members page to find out. | Accept RPC should return the inviter |
| 4 | **E · Removed** | Access disappears with no explanation. | Copy approval, and a product decision |

Rank 1 is both the most valuable and the only one needing real design work, which
is the usual shape of these things.
