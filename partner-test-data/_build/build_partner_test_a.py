"""
Partner Test A — "Calder Marine Systems" (entirely fictional).

Built for partner usability testing. Four files, importable through the normal
EngiSignal onboarding flow, sized to import in seconds.

The estate is arranged so a genuine prospect working through it finds:

  STARCCM_POWER    concurrent   contract 260 @ $4,200 vs entitlement 220
                                -> quantity discrepancy AND deep over-provision
                                   (demand peaks near 140 against 220 served)
  ABAQUS_STANDARD  concurrent   90 = 90, demand climbing into the ceiling
                                -> capacity risk and a forward-looking crossing
  MATHCAD_PRIME    named_user   40 seats @ $1,150, seven holders long idle
                                -> priced reclaim candidates
  HYPERMESH_CFD    concurrent   entitlement only, no contract line
                                -> served capacity that procurement cannot see

  Renewals are staggered so more than one horizon is populated.
  Three usernames in the usage file have no HR record, so a real unmatched
  identity queue exists and some cost genuinely cannot be attributed.

Usage carries no duration column, matching the most common real-world export.
"""
import csv
import os
import random
from datetime import date, timedelta

random.seed(20260819)
OUT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "partner-test-a")
os.makedirs(OUT, exist_ok=True)

AS_OF = date(2026, 8, 19)
START = AS_OF - timedelta(days=320)
DOMAIN = "caldermarine.example"

# ── People ───────────────────────────────────────────────────────────────────
MANAGERS = [
    ("mgr-2201", "H. Lindqvist"),
    ("mgr-2202", "D. Achebe"),
    ("mgr-2203", "S. Marchetti"),
    ("mgr-2204", "R. Whitfield"),
]
DEPTS = ["Hydrodynamics", "Carbody Structures", "Propulsion", "Electrical Systems",
         "Naval Architecture", "Systems Integration"]
SITES = [("Portsmouth", "EMEA"), ("Gdansk", "EMEA"), ("Halifax", "AMER")]
PROGRAMS = ["Tidewater", "Longbow", "Kestrel"]

FIRST = ["Aina", "Bertil", "Camila", "Dario", "Eshe", "Finn", "Gaia", "Halvard", "Ingrid",
         "Jarek", "Kaia", "Ludo", "Marit", "Nils", "Oona", "Pavel", "Quentin", "Rasmus",
         "Saoirse", "Tobias", "Ulla", "Vidar", "Wenna", "Xanthe", "Yara", "Zeno",
         "Anouk", "Bram", "Cato", "Dagny", "Emre", "Fenna", "Gustav", "Hedda", "Ivar",
         "Jolan", "Kirsi", "Lasse", "Mireia", "Noor", "Olav", "Petra", "Rune", "Sigrid",
         "Torvald", "Ulrike", "Veit", "Wilma", "Yusra", "Zola", "Anders", "Birte",
         "Colm", "Doria", "Eirik", "Freja", "Gero", "Hilde", "Imre", "Janna", "Kalle",
         "Linnea", "Mattis", "Neve"]
LAST = ["Storsveen", "Okonkwo", "Ferrero", "Halloran", "Mwangi", "Bakhtiari", "Solberg",
        "Duarte", "Vermeulen", "Kaczmarek", "Lindahl", "Bonnet", "Aaltonen", "Rask",
        "Cabral", "Novotny", "Ilves", "Sandoval", "Byrne", "Kruger", "Marchetti",
        "Oyelaran", "Thoresen", "Villalobos", "Nakamura", "Grimaldi", "Petersen",
        "Ashworth", "Delgado", "Hovland", "Yildirim", "Bosma", "Reinholt", "Falk",
        "Sagan", "Muniz", "Hakala", "Brenner", "Costa", "Aziz", "Skarsgard", "Wojcik",
        "Lindgren", "Amara", "Bergqvist", "Neumann", "Callaghan", "Dijkstra", "Farah",
        "Gudmundur", "Holt", "Ibarra", "Jorgensen", "Kovacs", "Lemaitre", "Meier",
        "Nyland", "Oduya", "Palme", "Radek", "Stenberg", "Tavares", "Ulriksen", "Voss"]

people = []
usernames = []


def add_person(idx, first, last, dept, mgr_ix, ptype="Employee", mgr_key=None, mgr_name=None):
    user = f"{first[0].lower()}.{last.lower()}"
    site, region = SITES[idx % len(SITES)]
    mk, mn = MANAGERS[mgr_ix]
    people.append(dict(
        employee_id=f"E{30100 + idx}", username=user, full_name=f"{first} {last}",
        email=f"{user}@{DOMAIN}", status="Active", employee_type=ptype,
        manager=mgr_name if mgr_name else mn,
        manager_id="" if mgr_name else (mgr_key if mgr_key else mk),
        department=dept, business_unit="Engineering",
        program=PROGRAMS[idx % len(PROGRAMS)], discipline=dept,
        location=site, region=region, cost_center=f"CC-{7200 + (idx % 6)}",
    ))
    usernames.append(user)
    return user


for i in range(64):
    add_person(i, FIRST[i], LAST[i], DEPTS[i % len(DEPTS)], i % len(MANAGERS),
               ptype="Contractor" if i % 13 == 0 else "Employee")

# Four people name a manager with no identifier — a label, not a reporting line.
for j, (first, last) in enumerate([("Rolf", "Andersen"), ("Suvi", "Kettunen"),
                                   ("Milo", "Brandao"), ("Nina", "Espegard")]):
    add_person(200 + j, first, last, "Naval Architecture", 0, mgr_name="K. Ravensworth")

# Usernames that appear in usage and in no HR record at all.
GHOSTS = [r"CALDER\d.okonkwo", "svc_meshfarm", "contract_temp_17"]

PEOPLE_HEADERS = ["employee_id", "username", "full_name", "email", "status", "employee_type",
                  "manager", "manager_id", "department", "business_unit", "program",
                  "discipline", "location", "region", "cost_center"]

with open(f"{OUT}/PartnerTestA_people.csv", "w", newline="", encoding="utf-8") as fh:
    w = csv.DictWriter(fh, fieldnames=PEOPLE_HEADERS)
    w.writeheader()
    w.writerows(people)

# ── Usage ────────────────────────────────────────────────────────────────────
rows = []
_seen = set()


def add(day, hour, feature, user, concurrent, server="flex-cal-01"):
    # A licence server records one checkout per user per sampling interval, so an
    # identical (day, hour, feature, user) row is an artefact of generation, not
    # something a real export contains. Dropping it here keeps the tester's
    # review step free of duplicate-row noise they would have to reason about.
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


# STARCCM: flat, comfortable demand well under a 220-seat entitlement.
for day in weekdays():
    peak = int(random.gauss(128, 14))
    peak = max(70, min(148, peak))
    for hour in (9, 11, 14, 16):
        level = max(35, int(peak * random.uniform(0.6, 1.0)))
        for user in random.sample(usernames, 6):
            add(day, hour, "STARCCM_POWER", user, level)
        if random.random() < 0.08:
            add(day, hour, "STARCCM_POWER", random.choice(GHOSTS), level)

# ABAQUS: demand rising across the year, pressing into a 90-seat ceiling.
span = (AS_OF - START).days
for day in weekdays():
    progress = (day - START).days / span
    base = 54 + 32 * progress
    peak = int(random.gauss(base, 5))
    peak = max(30, min(93, peak))
    for hour in (10, 13, 15):
        level = max(20, int(peak * random.uniform(0.72, 1.0)))
        for user in random.sample(usernames, 5):
            add(day, hour, "ABAQUS_STANDARD", user, level)

# HYPERMESH: steady, modest, entitlement-only.
for day in weekdays():
    for hour in (10, 15):
        level = max(8, int(random.gauss(26, 5)))
        for user in random.sample(usernames, 3):
            add(day, hour, "HYPERMESH_CFD", user, level)

# MATHCAD: named-user seats. Fourteen active holders, seven long idle.
MATHCAD_ACTIVE = usernames[0:14]
MATHCAD_IDLE = usernames[20:27]


def named_user_history(feature, user, last_used_days, sessions, step, level, hour):
    last = AS_OF - timedelta(days=last_used_days)
    for k in range(sessions):
        d = last - timedelta(days=k * step)
        if d < START:
            break
        if d.weekday() < 5:
            add(d, hour, feature, user, level)


for n, user in enumerate(MATHCAD_ACTIVE):
    named_user_history("MATHCAD_PRIME", user, 2 + (n % 12), 26, 5, 4, 11)
for n, user in enumerate(MATHCAD_IDLE):
    named_user_history("MATHCAD_PRIME", user, 118 + n * 14, 9, 6, 3, 11)

rows.sort(key=lambda r: (r["date"], r["hour"], r["feature"]))

with open(f"{OUT}/PartnerTestA_usage.csv", "w", newline="", encoding="utf-8") as fh:
    w = csv.DictWriter(fh, fieldnames=["date", "hour", "feature", "user", "in_use", "license_server"])
    w.writeheader()
    w.writerows(rows)

# ── Entitlements — what the licence servers are configured to serve ──────────
with open(f"{OUT}/PartnerTestA_entitlements.csv", "w", newline="", encoding="utf-8") as fh:
    w = csv.writer(fh)
    w.writerow(["feature", "vendor", "quantity", "license_type", "license_server", "expiry"])
    w.writerow(["STARCCM_POWER", "Siemens", 220, "concurrent", "flex-cal-01", "2026-10-09"])
    w.writerow(["ABAQUS_STANDARD", "Dassault Systemes", 90, "concurrent", "flex-cal-01", "2027-03-31"])
    w.writerow(["MATHCAD_PRIME", "PTC", 40, "named user", "flex-cal-01", "2026-11-13"])
    w.writerow(["HYPERMESH_CFD", "Altair", 45, "concurrent", "flex-cal-01", "2027-04-30"])

# ── Contracts — what procurement actually bought ─────────────────────────────
with open(f"{OUT}/PartnerTestA_contracts.csv", "w", newline="", encoding="utf-8") as fh:
    w = csv.writer(fh)
    w.writerow(["feature", "vendor", "contract_number", "po_number", "quantity", "unit_price",
                "currency", "license_type", "renewal_date"])
    # 260 bought against 220 served: the quantity discrepancy.
    w.writerow(["STARCCM_POWER", "Siemens", "CAL-4417", "PO-51280", 260, 4200, "USD", "concurrent", "2026-10-09"])
    w.writerow(["ABAQUS_STANDARD", "Dassault Systemes", "CAL-4402", "PO-51194", 90, 6500, "USD", "concurrent", "2027-03-31"])
    w.writerow(["MATHCAD_PRIME", "PTC", "CAL-4438", "PO-51341", 40, 1150, "USD", "named user", "2026-11-13"])
    # HYPERMESH_CFD is deliberately absent: served capacity with no contract line.

print("A: people", len(people), "usage", len(rows))
