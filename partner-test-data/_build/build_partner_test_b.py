"""
Partner Test B — "Halbrook Rail Engineering" (entirely fictional).

A deliberately different-shaped estate from Partner Test A, so two testers
working side by side do not simply confirm each other's findings.

  OPTISTRUCT_HPC   concurrent   entitlement 180 vs contract 140 @ $3,800
                                -> the discrepancy runs the OTHER way from A:
                                   the server issues more than was purchased
  SOLIDWORKS_PREM  concurrent   300 seats @ $1,900 against demand near 115
                                -> the largest single over-provision here
  LSDYNA_MPP       concurrent   60 = 60, demand climbing into the ceiling
                                -> capacity risk and a forward-looking crossing
  SIMPACK_RAIL     named_user   25 seats @ $2,600, six holders long idle
                                -> priced reclaim candidates
  TEAMCENTER_VIS   named_user   15 seats, NO contract line
                                -> idle holders that cannot honestly be priced

  The nearest renewal sits inside a month; others sit further out.
  Two usernames in the usage file have no HR record.
"""
import csv
import os
import random
from datetime import date, timedelta

random.seed(20260820)
OUT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "partner-test-b")
os.makedirs(OUT, exist_ok=True)

AS_OF = date(2026, 8, 19)
START = AS_OF - timedelta(days=320)
DOMAIN = "halbrookrail.example"

# ── People ───────────────────────────────────────────────────────────────────
MANAGERS = [
    ("mgr-5510", "P. Ellingham"),
    ("mgr-5511", "T. Nakagawa"),
    ("mgr-5512", "A. Belhadj"),
    ("mgr-5513", "G. Fairweather"),
    ("mgr-5514", "M. Sorrentino"),
]
DEPTS = ["Bogie Design", "Traction & Power", "Carbody Structures", "Signalling",
         "Vehicle Dynamics", "Interiors"]
SITES = [("Derby", "EMEA"), ("Valencia", "EMEA"), ("Pittsburgh", "AMER")]
PROGRAMS = ["Ironbridge", "Meadowlark", "Sable", "Fenwick"]

FIRST = ["Alina", "Bo", "Cesar", "Dilara", "Emrys", "Fabia", "Gunnar", "Hana", "Idris",
         "Juno", "Kaspar", "Leonie", "Mateo", "Nadja", "Osian", "Perrine", "Quinn",
         "Rafael", "Sanna", "Tomas", "Ulf", "Verena", "Wren", "Yannick", "Zora",
         "Arto", "Bea", "Ciaran", "Delphine", "Eero", "Freya", "Gil", "Hugo", "Iona",
         "Jonas", "Kira", "Leif", "Maja", "Nuno", "Ottilie", "Piet", "Rosa", "Soren",
         "Tanvi", "Ursula", "Vasco", "Willa", "Xavi", "Ylva", "Zeb", "Amaia", "Boris",
         "Clea", "Dermot", "Elsa", "Franz", "Greta", "Havard", "Ines", "Joran", "Katri",
         "Lars", "Mira", "Nils", "Oskar", "Pia", "Rune", "Silje", "Timo", "Ulla",
         "Vera", "Wim", "Yves", "Zita"]
LAST = ["Fitzgerald", "Osei", "Rembrandt", "Kovalenko", "Lindqvist", "Barzetti",
        "Halvorsen", "Takeda", "Mahmoud", "Sandberg", "Weiler", "Dufresne", "Salazar",
        "Petrovic", "Llewellyn", "Girard", "Maddox", "Andrade", "Virtanen", "Kubik",
        "Norheim", "Kaltenbach", "Ashby", "Moreau", "Draganov", "Saarinen", "Whelan",
        "Donovan", "Rousseau", "Lampinen", "Isaksen", "Feldman", "Marchand", "Kelleher",
        "Brenner", "Sokolova", "Estvold", "Zielinski", "Cardoso", "Vanderveld",
        "Boonstra", "Iglesias", "Wikstrom", "Ramachandran", "Steinbach", "Ferreira",
        "Corrigan", "Puig", "Nordahl", "Ackermann", "Etxeberria", "Volkov", "Marchetti",
        "Kavanagh", "Bergstrom", "Hoffmeister", "Lindholm", "Rasmussen", "Faria",
        "Ekstrom", "Mikkola", "Thulin", "Anand", "Sjoberg", "Lindqvist", "Aaltola",
        "Halloran", "Bjornstad", "Rautio", "Nyholm", "Castellan", "Devries", "Rocher",
        "Kallio"]

people = []
usernames = []


def add_person(idx, first, last, dept, mgr_ix, ptype="Employee", mgr_name=None):
    user = f"{first[0].lower()}.{last.lower()}"
    site, region = SITES[idx % len(SITES)]
    mk, mn = MANAGERS[mgr_ix]
    people.append(dict(
        employee_id=f"E{61400 + idx}", username=user, full_name=f"{first} {last}",
        email=f"{user}@{DOMAIN}", status="Active", employee_type=ptype,
        manager=mgr_name if mgr_name else mn,
        manager_id="" if mgr_name else mk,
        department=dept, business_unit="Rolling Stock",
        program=PROGRAMS[idx % len(PROGRAMS)], discipline=dept,
        location=site, region=region, cost_center=f"CC-{9100 + (idx % 6)}",
    ))
    usernames.append(user)
    return user


for i in range(73):
    add_person(i, FIRST[i], LAST[i], DEPTS[i % len(DEPTS)], i % len(MANAGERS),
               ptype="Contractor" if i % 15 == 0 else "Employee")

# Three people name a manager with no identifier.
for j, (first, last) in enumerate([("Rhodri", "Penhale"), ("Sanna", "Kuusela"),
                                   ("Teodor", "Brasov")]):
    add_person(300 + j, first, last, "Signalling", 0, mgr_name="V. Ostergaard")

GHOSTS = [r"HALBROOK\r.calloway", "batch_solver_02"]

PEOPLE_HEADERS = ["employee_id", "username", "full_name", "email", "status", "employee_type",
                  "manager", "manager_id", "department", "business_unit", "program",
                  "discipline", "location", "region", "cost_center"]

with open(f"{OUT}/PartnerTestB_people.csv", "w", newline="", encoding="utf-8") as fh:
    w = csv.DictWriter(fh, fieldnames=PEOPLE_HEADERS)
    w.writeheader()
    w.writerows(people)

# ── Usage ────────────────────────────────────────────────────────────────────
rows = []
_seen = set()


def add(day, hour, feature, user, concurrent, server="rlm-hbk-02"):
    # See build_partner_test_a.py: an identical (day, hour, feature, user) row is
    # a generation artefact, not something a licence-server export produces.
    key = (day, hour, feature, user)
    if key in _seen:
        return
    _seen.add(key)
    rows.append(dict(date=day.isoformat(), hour=f"{hour:02d}:00", feature=feature,
                     user=user, in_use=concurrent, license_server=server))


def weekdays():
    day = START
    while day <= AS_OF:
        if day.weekday() < 5:
            yield day
        day += timedelta(days=1)


# OPTISTRUCT: solid demand against 180 served, comfortable but not idle.
for day in weekdays():
    peak = int(random.gauss(138, 13))
    peak = max(70, min(156, peak))
    for hour in (9, 12, 15):
        level = max(40, int(peak * random.uniform(0.65, 1.0)))
        for user in random.sample(usernames, 6):
            add(day, hour, "OPTISTRUCT_HPC", user, level)
        if random.random() < 0.07:
            add(day, hour, "OPTISTRUCT_HPC", random.choice(GHOSTS), level)

# SOLIDWORKS: 300 seats served against demand nowhere near it.
for day in weekdays():
    peak = int(random.gauss(102, 11))
    peak = max(45, min(122, peak))
    for hour in (10, 14):
        level = max(25, int(peak * random.uniform(0.7, 1.0)))
        for user in random.sample(usernames, 5):
            add(day, hour, "SOLIDWORKS_PREM", user, level)

# LSDYNA: rising across the year, pressing into a 60-seat ceiling.
span = (AS_OF - START).days
for day in weekdays():
    progress = (day - START).days / span
    base = 34 + 25 * progress
    peak = int(random.gauss(base, 4))
    peak = max(16, min(63, peak))
    for hour in (11, 16):
        level = max(10, int(peak * random.uniform(0.75, 1.0)))
        for user in random.sample(usernames, 4):
            add(day, hour, "LSDYNA_MPP", user, level)


def named_user_history(feature, user, last_used_days, sessions, step, level, hour):
    last = AS_OF - timedelta(days=last_used_days)
    for k in range(sessions):
        d = last - timedelta(days=k * step)
        if d < START:
            break
        if d.weekday() < 5:
            add(d, hour, feature, user, level)


# SIMPACK: 25 priced named-user seats, eight holders long idle.
# The idle step is 6 days, not 7: a 7-day step preserves the weekday, so a
# holder whose last session fell on a weekend would emit no rows at all and
# never appear as an assigned seat.
for n, user in enumerate(usernames[0:11]):
    named_user_history("SIMPACK_RAIL", user, 3 + (n % 14), 24, 5, 3, 13)
for n, user in enumerate(usernames[30:38]):
    named_user_history("SIMPACK_RAIL", user, 124 + n * 11, 8, 6, 2, 13)

# TEAMCENTER: 15 unpriced named-user seats, five holders long idle.
for n, user in enumerate(usernames[40:45]):
    named_user_history("TEAMCENTER_VIS", user, 4 + (n % 10), 20, 6, 2, 9)
for n, user in enumerate(usernames[50:55]):
    named_user_history("TEAMCENTER_VIS", user, 133 + n * 12, 7, 8, 2, 9)

rows.sort(key=lambda r: (r["date"], r["hour"], r["feature"]))

with open(f"{OUT}/PartnerTestB_usage.csv", "w", newline="", encoding="utf-8") as fh:
    w = csv.DictWriter(fh, fieldnames=["date", "hour", "feature", "user", "in_use", "license_server"])
    w.writeheader()
    w.writerows(rows)

# ── Entitlements ─────────────────────────────────────────────────────────────
with open(f"{OUT}/PartnerTestB_entitlements.csv", "w", newline="", encoding="utf-8") as fh:
    w = csv.writer(fh)
    w.writerow(["feature", "vendor", "quantity", "license_type", "license_server", "expiry"])
    w.writerow(["OPTISTRUCT_HPC", "Altair", 180, "concurrent", "rlm-hbk-02", "2026-09-14"])
    w.writerow(["SOLIDWORKS_PREM", "Dassault Systemes", 300, "concurrent", "rlm-hbk-02", "2027-02-19"])
    w.writerow(["LSDYNA_MPP", "Ansys", 60, "concurrent", "rlm-hbk-02", "2026-12-05"])
    w.writerow(["SIMPACK_RAIL", "Dassault Systemes", 25, "named user", "rlm-hbk-02", "2027-01-22"])
    w.writerow(["TEAMCENTER_VIS", "Siemens", 15, "named user", "rlm-hbk-02", "2027-06-30"])

# ── Contracts ────────────────────────────────────────────────────────────────
with open(f"{OUT}/PartnerTestB_contracts.csv", "w", newline="", encoding="utf-8") as fh:
    w = csv.writer(fh)
    w.writerow(["feature", "vendor", "contract_number", "po_number", "quantity", "unit_price",
                "currency", "license_type", "renewal_date"])
    # 140 bought, 180 served: the discrepancy runs the opposite way from Test A.
    w.writerow(["OPTISTRUCT_HPC", "Altair", "HBK-7712", "PO-30455", 140, 3800, "USD", "concurrent", "2026-09-14"])
    w.writerow(["SOLIDWORKS_PREM", "Dassault Systemes", "HBK-7690", "PO-30301", 300, 1900, "USD", "concurrent", "2027-02-19"])
    w.writerow(["LSDYNA_MPP", "Ansys", "HBK-7734", "PO-30512", 60, 7400, "USD", "concurrent", "2026-12-05"])
    w.writerow(["SIMPACK_RAIL", "Dassault Systemes", "HBK-7708", "PO-30440", 25, 2600, "USD", "named user", "2027-01-22"])
    # TEAMCENTER_VIS is deliberately absent: idle seats with no defensible price.

print("B: people", len(people), "usage", len(rows))
