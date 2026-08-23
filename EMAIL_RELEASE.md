# Transactional Email — Release Evidence

**Status: CLOSED** · 23 August 2026 · production `9ff01d6`

The pilot-request alert and the workspace invitation now render through a shared
design system instead of being assembled per-message. This records what shipped,
what was measured, and what still needs a human.

Related: [`PILOT_RELEASE.md`](PILOT_RELEASE.md) (the notification pipeline),
[`MULTI_USER_RELEASE.md`](MULTI_USER_RELEASE.md) (invitations),
[`docs/supabase-auth-templates/`](docs/supabase-auth-templates/) (the two auth
emails this codebase does not send).

---

## 1. What shipped

| Commit | |
|---|---|
| `5941f46` | The design system, the pilot and invitation templates, 71 tests |
| `c795403` | Supabase auth templates and instructions; plain-text mailto polish |
| `9ff01d6` | Decision strip, highlighted primary challenge, named reply button |

### The design system — `lib/email/design.ts`

An email is described as a document — title, optional badge, blocks — and
rendered **twice** from that one description. That is the load-bearing decision:
a hand-written plain-text alternative drifts from the HTML the first time
somebody adds a field, and the drift is invisible because almost nobody reads
the text part. Here both renderers walk the same blocks.

Block kinds: `paragraph`, `summary`, `sections` (with optional `highlight`),
`message`, `cta`, `notice`, `meta`.

Constraints the file is shaped by:

- **Tables, not flexbox or grid.** Outlook on Windows renders through Word.
- **Inline styles on everything that matters.** The `<style>` block carries only
  the mobile media query, which is enhancement rather than load-bearing.
- **Solid hex only.** `rgba()` is unreliable across clients, so every tint is
  pre-flattened against white.
- **The light theme from `app/globals.css`**, not a new palette. The body is a
  light surface, so buttons use `#1F6FEB`; the dark theme's `#4DA3FF` lacks
  contrast on white.
- **One image** — the mark, served from engisignal.com — beside a live-text
  wordmark, so a blocked image still reads as EngiSignal. No webfont, script,
  form, tracking pixel or third-party host.

### The pilot alert — `lib/email/templates/pilot-request.ts`

Decision strip (renewal / software spend / primary concern) → Contact →
Organization → Software environment with the primary challenge highlighted →
Message → named reply button → received timestamp and request id.

Two rules govern its content:

- **Prospect values are verbatim.** "Over-licensed" reads better in a three-column
  strip than "We suspect we are over-licensed", but it would be our words
  attributed to them, and every other number in this product carries its
  provenance.
- **Absent means absent.** A missing value drops its row, its strip item or its
  whole section. No placeholder dash — that reads as data we lost rather than
  data that was never given.

The primary challenge is accent-tinted, not toned by severity: nothing in a
submission says how urgent it is, and implying otherwise is a claim.

### The invitation — `lib/email/templates/invitation.ts`

Workspace, inviter, role and recipient as a labelled block; a prominent join
button with its expiry; a security notice that the invitation is single-use,
grants access to another organization's data, and should not be forwarded.

---

## 2. What was deliberately not touched

Transport is unchanged. The only difference on the wire is that the request now
carries an `html` part alongside the `text` it already sent:

```
from:      config.from        ← PILOT_NOTIFY_FROM
to:        [config.to]        ← PILOT_NOTIFY_TO
reply_to:  request.workEmail  ← the prospect
```

No migrations, no auth, no analytics, no RLS, no middleware. `git diff` across
all three commits touches none of `supabase/`, `lib/analytics/`,
`lib/membership/`, `lib/auth/` or `middleware.ts`.

---

## 3. Verification

**Suite:** 1134 tests across 63 files, of which 103 cover email. Lint, typecheck
and production build clean.

Email tests cover: every submitted field in both parts; HTML escaping and
injection through pilot form fields; `javascript:`/`data:` URLs yielding no
button; missing optional fields; 4000-character messages and 180-character
company names; Gmail's ~102KB clipping threshold; plain-text parity asserted
against the document model rather than by eye; the decision strip's values,
omissions and width redistribution; first-name derivation including honorifics,
non-Latin scripts and unsafe inputs; mobile stacking rules; and the absence of
any internal configuration name, key-shaped string or verification language.

**Production sends** — three, each stored and delivered through
EngiSignal → Resend → `pilot@engisignal.com` → Cloudflare Email Routing → Outlook,
each visually reviewed in Outlook:

| Purpose | Row | Outcome | Latency |
|---|---|---|---|
| Routing | `0ac9b6bc` | sent | — |
| Redesign | `11ca3de9` | sent | 267 ms |
| UX refinement | `0458f672` | sent | 297 ms |

All three disposable rows were deleted by explicit id after review.

**Mail posture**, confirmed by DNS rather than assumed:

| Record | Value |
|---|---|
| Inbound MX | `route1/2/3.mx.cloudflare.net` |
| Root SPF | `v=spf1 include:_spf.mx.cloudflare.net ~all` |
| Resend DKIM | `resend._domainkey.engisignal.com` present |
| Return path | `send.engisignal.com` → `feedback-smtp.us-east-1.amazonses.com`, SPF `include:amazonses.com` |
| DMARC | `v=DMARC1; p=none; rua=...@dmarc-reports.cloudflare.net` |

The DKIM selector at the domain apex is what establishes **domain-level**
verification in Resend, which is why any `@engisignal.com` address can be a
sender.

---

## 4. Defects found and fixed during the work

1. **Fixed inline `width:600px` on the container.** It beat the media query and
   pushed the card off the side of a phone; text was clipped at 360px. Replaced
   with `width:100%` + `max-width` + the `width` attribute for Outlook. A test
   now asserts the fixed width cannot return.
2. **Mobile border stubs on the decision strip.** Stacked `<td>`s became
   `display:block` while the table and row stayed table elements, so the two
   disagreed about width and the panel border drew a fragment beside each cell.
   The table and row now stack with the cells.
3. **`--danger` was never defined** in the social-kit token set, so a Capacity
   Signal row silently lost its dot and colour. Found while building the brand
   kit; fixed there.

---

## 5. Still requires manual configuration

| Item | Where | Notes |
|---|---|---|
| **Supabase auth templates** | Supabase dashboard | [`docs/supabase-auth-templates/`](docs/supabase-auth-templates/) has the HTML and click-by-click steps. The link expression is deliberately withheld as `{{LINK}}`: `/auth/confirm` is a two-step page chosen to avoid PKCE `bad_code_verifier`, and a guessed URL would break sign-up. |
| **`ENGISIGNAL_INVITE_FROM`** | Vercel | Optional. Set to `EngiSignal <notifications@engisignal.com>` so invitations send from the system identity rather than the pilot alias. Unset is safe — it falls back to `PILOT_NOTIFY_FROM`. |
| **`next={{ .RedirectTo }}`** | Supabase dashboard | Separate change, documented in the folder above. Do not bundle it with the restyle. |

### Two standing notes

**`.env.local` points at production Supabase.** A local `npm run start` writing
to `/api/pilot` creates a **production** row. Row `d9b1ad62` ("Example
Aerostructures", message "Local verification only.") is exactly that, and it is
still in the table — retained because deletion was scoped to the UX row only.
Use a separate Supabase project for local work, or expect to clean up after
every local pilot-form test.

**`security.txt` expires 2027-08-23.** RFC 9116 requires the field; renew it
annually. See [`SECURITY.md`](SECURITY.md).

---

## 6. Closure

The pilot-request email redesign is **CLOSED**. Design approved in Outlook by
the operator across three review rounds; no further design or functional changes
are to be made to this email.
