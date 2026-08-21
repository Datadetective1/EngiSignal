# EngiSignal — Connector Architecture

How estate data reaches EngiSignal today, and the design for the EngiSignal
Collector that will let it arrive automatically from inside a customer network.

> **Status.** Everything in §1–§3 ships today. Everything in §4 onward is a
> design and a scaffold. **No component described in §4 is implemented**, and
> Settings reports every live connector as *Planned* for exactly that reason.

---

## 1. Two capabilities, deliberately named apart

| | What it is | Status |
|---|---|---|
| **File ingestion** | The customer exports from their own tooling and uploads the file | **Shipping** — four sources Ready |
| **Live collection** | EngiSignal receives data from a running licence server with nobody exporting anything | **Designed, not built** |

These were conflated once, and the result was a Settings page reading
"0 of 8 implemented" while four working adapters sat in the same codebase.
A customer asking "do you support FlexNet?" got told no by a product that had
been parsing FlexNet exports since Phase 1. They are reported separately now.

---

## 2. What ships today

```
  Customer's own export                 EngiSignal
  ─────────────────────                 ──────────
  lmstat / report log ─┐
  RLM report log       ├─► upload ─► parse ─► detect source ─► resolve columns
  DSLS export          │                                            │
  Sentinel export      ┘                                            ▼
                                              human confirms the mapping
                                                                    │
                                                                    ▼
                                       normalize ─► persist ─► analyse ─► reconcile
```

Nothing is committed before a person has confirmed the column mapping. A wrong
mapping produces a wrong purchasing recommendation, so it is never guessed
silently — detection is advisory, and the review step shows accept and reject
counts with reasons before anything is stored.

### 2.1 Connector status

| Source | File import | Live collection |
|---|---|---|
| FlexNet / FLEXlm | **Ready** | Planned |
| Reprise (RLM) | **Ready** | Planned |
| Dassault DSLS | **Ready** | Planned |
| Sentinel RMS | **Ready** | Planned |
| LM-X | Beta (generic reader) | Planned |
| Autodesk | Beta (generic reader) | Planned |
| Bentley | Beta (generic reader) | Planned |
| Custom / any tabular | Configuration required | Planned |

**"Ready" is a tested claim, not a label.** It means a realistic native export
has been carried the whole distance — parse → detect → map → normalize →
persist → analyse → reconcile — by a case in
[`tests/ingestion/connector-end-to-end.test.ts`](tests/ingestion/connector-end-to-end.test.ts).
That file contains an assertion which **fails the build** if the registry marks
anything Ready without a corresponding proof, which is the only reason the word
carries weight on a page a customer reads.

### 2.2 What each source can and cannot tell you

Captured where the format carries it, and left **null — never zero** where it
does not:

`date` · `hour` · `timestamp` · `user` · `hostname` · `feature` · `version` ·
`product` · `vendor` · `licenses available` · `licenses consumed` ·
`concurrent` · `peak` · `checkout` · `check-in` · `duration` · `denials` ·
`license server` · `pool` · `tokens` · `borrowed` · `expiration` (entitlements)

The distinction matters most for three of them:

- **denials** — FlexNet records them only with debug logging enabled on the
  vendor daemon. An absent denial column means *not logged*, not *no unmet
  demand*, and confidence is reduced rather than the gap being read as zero.
- **borrowed** — a borrowed or roamed licence is unavailable to others while
  nobody is using it. `NULL` means the source cannot report borrowing at all;
  defaulting it to `false` would quietly count idle capacity as demand.
- **version** — FlexNet serves `MECH_ENT 2026.1` and `MECH_ENT 2025.2` from
  separate pools. Collapsing them reports one product with twice the demand.

### 2.3 Sample exports

`GET /api/samples/{flexnet|rlm|dsls|sentinel}` returns a realistic native-format
example, in that vendor's own column vocabulary. Each is asserted by test to
auto-detect as its own source and import with zero rejections — a sample that
does not import is worse than no sample, because the customer concludes the
product is broken using the product's own file.

All sample content is invented: no vendor sample, no customer extract, no
material copied from vendor documentation. Imitating a published column layout
is a fact about a format, not a work.

---

## 3. Where auto-detection stops and the customer decides

Detection scores vendor terminology in headers, sheet names and the first rows.
It is used only when confident; otherwise the customer picks the source.

Two rules are worth stating because both were learned the hard way:

1. **Commercial files are never auto-detected.** A renewal schedule is a list of
   what a company buys, so it is dense with vendor terminology. A procurement
   spreadsheet naming "Dassault Systemes" was confidently detected as DSLS at
   60% and every row stamped `sourceSystem: dsls` in stored provenance — a false
   claim in the one field whose job is to say where a number came from.
2. **Falling back is normal for some files and alarming for others.** The
   message distinguishes the two rather than reporting both as a failure.

---

## 4. The EngiSignal Collector — design

> Not implemented. This section is the specification.

### 4.1 The constraint that shapes everything

**No customer should ever expose a licence server to the internet.** A FlexNet
`lmgrd` or an RLM ISV daemon is not built to face a hostile network, frequently
runs on an operating system years past its support window, and often authorises
by hostname. Any design requiring an inbound firewall rule to a licence server
is unacceptable regardless of how it is authenticated.

So the flow is **outbound only**:

```
   Customer network (private)                    │  Internet   │  EngiSignal
   ───────────────────────────                   │             │  ──────────
   ┌──────────────┐                              │             │
   │ lmgrd / rlm  │◄── lmstat / rlmutil ──┐      │             │
   │ dsls / lserv │    (localhost or LAN)  │     │             │
   └──────────────┘                        │     │             │
                                    ┌──────┴───────────┐       │
                                    │ EngiSignal       │       │
                                    │ Collector        │──── outbound TLS ───►  ingestion API
                                    │ (customer-run)   │   (443, egress only)   │
                                    └──────────────────┘       │             │
                                                               │             │
   No inbound port. No VPN. No licence server on the internet. │             │
```

The collector is a single static binary the customer runs on a host that can
already reach their licence servers. It initiates every connection. EngiSignal
never connects inward and holds no route into the customer network.

### 4.2 Authentication

**Enrolment.** An owner or admin generates an enrolment token in EngiSignal —
short-lived (15 minutes), single-use, organization-scoped, and displayed once.
The collector exchanges it on first start for a long-lived **collector
credential**. The enrolment token is then spent and cannot be replayed.

**Steady state.** Each request carries the collector credential. The credential:

- is **organization-scoped** and carries a collector id;
- is stored by EngiSignal as a **hash only**, never in a recoverable form — the
  same rule the invitation tokens already follow;
- is **rotatable** from Settings, with the old credential valid for a grace
  period so rotation does not require a maintenance window;
- is **revocable** immediately, which stops ingestion on the next request.

**Deliberately not a JWT the collector can mint.** Anything able to sign a token
can sign one claiming a wider scope. The collector holds a bearer credential
whose authority is exactly what the server records against it — the same
reasoning already applied to the ingestion worker's Postgres role rather than a
service-role key.

### 4.3 Customer isolation

The ingestion endpoint resolves the organization **from the credential**, never
from the request body. A collector cannot name a tenant; it can only be one.

Beneath that, unchanged: every row lands in a table with `organization_id` and
Row Level Security keyed on membership. A compromised collector credential can
write into its own tenant and read nothing at all — the ingestion path is
write-only by design, so a stolen credential cannot exfiltrate an estate.

**No service-role key is introduced.** That property is the reason tenant
isolation currently holds even against application bugs, and a collector is not
a good enough reason to give it up.

### 4.4 Credential handling on the customer side

The collector needs to reach licence servers, which for most sources means
running `lmstat`/`rlmutil` against a host and port — not a username and
password. Where a source does need credentials (a DSLS admin API, a Sentinel
admin interface):

- credentials are read from the environment or an OS keychain, never from a
  config file committed anywhere;
- they are used to reach the licence server and are **never transmitted to
  EngiSignal**. EngiSignal has no reason to hold a customer's licence-server
  credentials and will not accept them;
- the collector logs what it collected and from which host, never what it
  authenticated with.

### 4.5 Polling

Configurable per source, defaulting to **hourly**, with a jittered start so a
fleet of collectors does not synchronise into a spike.

Polling frequency is a data-quality property, not just a load one, and the
product already says so: a source polled hourly cannot see a demand spike
shorter than an hour, and its P95 understates true peak. The collector reports
its actual interval, and the confidence model treats interval-sampled data the
way it already treats Sentinel snapshots.

### 4.6 Retries and back-pressure

- Exponential backoff with jitter on 5xx and network failure; **no retry on
  4xx**, which means the collector is wrong and retrying will not fix it.
- `429` is honoured with `Retry-After` rather than backed off blindly.
- Collected batches are **spooled to local disk** so a network outage delays
  delivery rather than losing a day of usage, with a bounded spool that drops
  oldest-first and **reports the drop** rather than failing silently.
- The collector never blocks a licence server. If a poll overruns its interval,
  the next poll is skipped rather than queued.

### 4.7 Deduplication

Delivery is at-least-once, so the server must be idempotent.

Each batch carries a **batch id** (a UUID minted by the collector) and each row
a deterministic **source key** — `collector_id · source · server · feature ·
user · observation timestamp`. The server writes with `on conflict do nothing`
against a unique index on that key, exactly as the current file import path
does. Redelivering a batch is therefore a no-op rather than a double count.

This matters more than it looks: a duplicated batch inflates observed
concurrency, which inflates P95, which inflates the recommended quantity. A
deduplication bug here spends real money.

### 4.8 Heartbeat

The collector posts a heartbeat every five minutes carrying its version, its
configured sources, the last successful poll per source, spool depth and last
error. EngiSignal shows each collector as **Healthy / Degraded / Silent**.

**Silence must be loud.** A collector that stops is indistinguishable from an
estate that stopped being used, and the second reading is catastrophic: usage
appears to fall, right-sizing recommends a reduction, and the customer cancels
licences their engineers are still using. A collector missing two consecutive
heartbeats marks its data stale, and the analysis says so rather than treating
the silence as measurement.

### 4.9 Versioning

- The ingestion API is versioned in the path (`/api/collector/v1/...`).
- The collector sends its version on every request; the server may respond with
  an advisory upgrade notice, never a forced one.
- **Old collectors keep working.** A customer's licence server host is often the
  least-patched machine they own, and an integration that breaks when we deploy
  is an integration that gets uninstalled.
- Additive schema changes only. New fields arrive as nullable, exactly as
  `hostname`, `version` and `borrowed` did.

### 4.10 Deployment options

| Option | For | Notes |
|---|---|---|
| **Static binary** | Most customers | Single file, no runtime. systemd unit or Windows service. Runs on the licence server host or any host that can reach it |
| **Container** | Container-first estates | Same binary. Needs egress to EngiSignal on 443 and reach to the licence servers |
| **Scheduled task** | Locked-down estates | Run once per interval by cron or Task Scheduler; the collector is stateless between runs apart from its spool |
| **Air-gapped export** | No egress permitted at all | Collector writes the same batch format to a file; the customer uploads it through the existing import flow. Same parser, same normalization, same provenance |

The last row is the reason the collector emits the **same canonical shape** the
file path already produces. An estate that cannot talk to the internet is not a
different product.

---

## 5. Scaffold in this repository

`lib/connectors/index.ts` holds the `LicenseManagerConnector` interface —
`test()` and `collect()` — and the registry. Every entry reports
`available: false`, and `availableConnectors()` returns an empty array.

That interface is the seam. A collector-backed source implements `collect()` and
returns `CollectedUsage`; nothing in the analytics engine changes, because the
engine consumes canonical records and has never known where they came from.

**Nothing beyond the interface is built, and the registry says so.** The
alternative — scaffolding a half-collector tonight — would put code in the tree
that looks like an integration and is not one, which is the same failure the
"0 of 8 implemented" line was already making in the other direction.

---

## 6. Deliberately out of scope

- **Writing to a licence server.** EngiSignal reads. It does not reconfigure
  pools, revoke checkouts or edit licence files.
- **Real-time alerting from the collector.** Hourly polling does not support it,
  and claiming it would misrepresent the data's resolution.
- **Storing customer licence-server credentials.** See §4.4.
- **Inbound connectivity of any kind.** See §4.1.
