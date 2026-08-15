# EngiSignal — Data Import Guide

You do not need to reformat anything. EngiSignal reads the column names your exports already use.

---

## 1. What to bring

| Data | Why it matters | Required? |
|---|---|---|
| **Usage** | The demand position. Without it there is no recommendation. | Yes |
| **Contracts** | Turns quantities into money. | Strongly recommended |
| **Employees** | Attributes demand to programs, departments and managers. | Recommended |
| **Assignments** | Named-user seats, for reclaim analysis. | If you have named-user products |
| **Denials** | Risk context. | If your license manager records them |

Usage alone produces quantity recommendations. Usage plus contracts produces financial ones. Add employees and you get cost allocation, reclaim routing and organizational drivers.

---

## 2. The three steps

**1 · Upload.** CSV or XLSX, up to 25 MB. Drop the export in as-is.

**2 · Confirm the mapping.** EngiSignal scores every column against its canonical fields and proposes an assignment, labelled *Exact*, *Strong*, *Possible* or *Not mapped*. Review it. A canonical field can only be filled once, so two columns can never silently collapse into one.

**3 · Review validation.** You see exactly what would be accepted, what would be rejected, and why — with example values. Nothing is committed until you have seen this.

Mappings are saved and reused automatically on the next import from the same source.

> **Nothing is applied silently.** A mapping that quietly guesses wrong produces confidently wrong purchasing recommendations. That is the worst failure this product can have, so the human stays in the loop.

---

## 3. Getting the best out of usage data

**Hourly granularity is worth pursuing.** Daily peak is derived as the maximum across a day's hours. Daily-only data means you are trusting whatever peak your license manager already computed.

**Twelve months beats three.** Under 60 days of history costs 38 confidence points; a full annual cycle costs none. Engineering demand is seasonal around programme milestones.

**Include denial context if you can.** A denial row without `concurrent_at_denial` cannot be distinguished from a licensing-rule rejection. With it, EngiSignal can tell you whether more licenses would actually have helped — and will tell you when they would not.

---

## 4. Column names EngiSignal already understands

It recognises far more than this; these are illustrative.

**Usage** — `USAGE_DATE`, `date`, `day`, `timestamp` · `HOUR_OF_DAY`, `hour` · `NETWORK_USER`, `username`, `login`, `NTWK_ID` · `FEATURE_NAME`, `feature`, `module` · `VENDOR_DAEMON`, `vendor` · `MAX_CONCURRENT`, `peak`, `high_water` · `CHECKOUT_COUNT`, `sessions` · `LIC_SERVER`, `server`

**Employees** — `EMPL_ID`, `employee_id`, `badge` · `FULL_NAME`, `employee_name` · `SUPERVISOR`, `manager`, `reports_to` · `DEPT_DESC`, `department` · `BUS_UNIT`, `division` · `PROGRAM_CD`, `project` · `WORK_LOCATION`, `site`

**Contracts** — `SUPPLIER`, `vendor` · `QTY`, `seats`, `licenses` · `UNIT_COST_ANNUAL`, `price` · `TERM_END`, `renewal_date`, `expiration` · `AGREEMENT_NO`, `contract_number` · `PO_NUMBER` · `COST_CENTER`

Anything unrecognised is left unmapped for you to assign, rather than guessed.

---

## 5. Formats accepted

Dates: `2026-03-02`, `2026-03-02 14:00:00`, `3/2/2026`, `03-02-2026`, `2 March 2026`, `Mar 2, 2026`.

Numbers: `5000`, `$5,000.00`, `1 234` — currency symbols and separators are stripped.

Hours: whole numbers 0–23.

> Dates are parsed strictly on purpose. JavaScript's built-in parser turns `bad-1` into 2001-01-01; accepting that would move usage into the wrong year and silently drop it out of your analysis window. EngiSignal rejects anything that is not recognisably a date, and anything outside 1990–2100.

---

## 6. Templates

Downloadable from **Data → Import templates**, or directly:

```
/api/templates/usage
/api/templates/employees
/api/templates/contracts
/api/templates/assignments
/api/templates/denials
```

Each includes headers and a filled example row. **They are starting points, not requirements.**

---

## 7. After import

Two queues will have entries. Both are worth clearing.

**Unmatched users** — usernames with no employee record. Their usage cannot be attributed to a department, program or manager. EngiSignal proposes matches and flags likely service accounts separately, because service-account usage is real demand with no person behind it and attributing it to someone would distort chargeback. It never auto-assigns: a wrong match corrupts cost allocation in a way that is very hard to detect later.

**Unmapped features** — raw strings with no product mapping. Their demand is currently **excluded**, which understates it. That is the safer error — it can only lead to recommending too few licenses, which surfaces immediately as saturation. Mapping them may increase measured demand and raise a recommended quantity.

Both queues feed the confidence score directly. Clearing them raises it measurably.

---

## 8. Limits

| | |
|---|---|
| File size | 25 MB (`ENGISIGNAL_MAX_UPLOAD_BYTES`) |
| Rows per import | 500,000 (`ENGISIGNAL_MAX_IMPORT_ROWS`) |
| Formats | `.csv` `.tsv` `.txt` `.xlsx` `.xlsm` |

Larger exports: split by date range. Truncation is always reported, never silent.

---

## 9. Current limitation

In the default evaluation deployment, validated rows are **reported but not committed** — the app runs against the synthetic demo organization. The parsing, mapping suggestion and validation are the real pipeline. Connect a Supabase project to persist imports.
