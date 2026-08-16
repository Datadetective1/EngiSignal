"""
Phase 2D acceptance estate — "Kestrel Dynamics".

A realistically sized engineering estate at the production upload ceiling,
built so that TRUNCATING ANY PART OF IT MATERIALLY CHANGES THE ANSWERS.

  * Rows are emitted in date order, the way a real export arrives. Reading only
    the first N rows therefore loses whole features, shifts the analysis
    as-of date backwards, and inflates every renewal countdown — the exact
    failure Phase 2C found in production.
  * Two features start late (STAR_CCM at day 300, VERICUT at day 330), so a
    truncated read drops them entirely rather than merely under-counting them.
  * ABAQUS_STD is low-volume and high-unit-price: 60 seats at $8,500. Losing
    its rows costs a $510,000 position from the portfolio.

Coverage the estate is designed to force:

  license models   concurrent, named_user, node_locked (-> custom)
  quantity basis   contract-only, entitlement-only, both-and-disagreeing
  pricing          priced, unpriced, and a node_locked contract with no
                   entitlement at all
  confidence       full-year history (High) and 60-day history (Low) together
  identity         6 usernames absent from the people file
  managers         12 managers, two sharing a name with different ids,
                   plus a name-only manager with no id
  named user       the five activity states from Phase 2C, at scale
"""
import csv, os, random
from datetime import date, timedelta

random.seed(20260816)
OUT = os.path.dirname(os.path.abspath(__file__))

AS_OF = date(2026, 8, 14)
DAYS = 365
START = AS_OF - timedelta(days=DAYS - 1)

# ── Organization shape ───────────────────────────────────────────────────────
DEPTS = ["Structures", "Aerodynamics", "Propulsion", "Avionics", "Materials", "Systems"]
PROGRAMS = ["Kestrel", "Harrier", "Merlin", "Osprey"]
DISCIPLINES = ["Mechanical", "Fluids", "Controls", "Stress", "Manufacturing"]
COMPETENCIES = ["Simulation", "Design", "Test", "Integration"]
SITES = [("Bristol", "EMEA"), ("Toulouse", "EMEA"), ("Wichita", "AMER"), ("Nagoya", "APAC")]

# Two managers deliberately share the NAME "R. Whitfield" with different ids.
MANAGERS = [
    ("mgr-3101", "M. Okafor"),   ("mgr-3102", "R. Whitfield"),
    ("mgr-3103", "R. Whitfield"), ("mgr-3104", "P. Lindqvist"),
    ("mgr-3105", "S. Bhattacharya"), ("mgr-3106", "D. Aterno"),
    ("mgr-3107", "K. Mensah"),  ("mgr-3108", "L. Fontaine"),
    ("mgr-3109", "T. Ishikawa"), ("mgr-3110", "A. Novakova"),
    ("mgr-3111", "G. Oyelaran"), ("mgr-3112", "H. Castellanos"),
]

FIRST = ["Lena","Omar","Priya","Sven","Ada","Kwame","Mira","Tomas","Ines","Hiro","Nadia","Felix",
         "Rosa","Jun","Elif","Pablo","Anja","Yusuf","Clara","Dmitri","Sofia","Marcus","Leila",
         "Bruno","Greta","Amir","Nora","Viktor","Zara","Ravi","Ilse","Karim","Petra","Hugo",
         "Maya","Otto","Sara","Emil","Tara","Milos","Nina","Cato","Rania","Jonas","Alba","Piotr",
         "Iris","Noel","Wren","Bo","Idris","Freya","Sami","Vera","Luc","Talia","Nikhil","Ewa",
         "Gustav","Amara","Rafal","Suki","Owen","Dalia","Tobias","Hana","Marek","Yara","Erik","Zofia"]
LAST = ["Voss","Haddad","Nair","Ek","Lovelace","Mensah","Patel","Nyberg","Duarte","Sato","Belkacem",
        "Brandt","Iglesias","Park","Demir","Sanz","Larsen","Yilmaz","Novak","Orlov","Ferreira","Holt",
        "Nasser","Costa","Vogel","Haidar","Lindgren","Petrov","Khan","Menon","Bakker","Toure","Kovac",
        "Mercier","Singh","Reinhardt","Lindqvist","Berg","Osei","Jovic","Sorensen","Dupont","Aziz",
        "Weiss","Marti","Nowak","Bergstrom","Achterberg","Castellanos","Lim","Okonjo","Halvorsen",
        "Rashid","Adamek","Girard","Zielinski","Roy","Kaminska","Ohlsson","Diallo","Wozniak","Tanaka",
        "Fitzgerald","Moreau","Schwarz","Ito","Dabrowski","Saleh","Lund","Wisniewska"]

PEOPLE_HEADERS = ["employee_id","username","full_name","email","status","employee_type","manager",
                  "manager_id","department","business_unit","program","discipline","competency",
                  "location","region","cost_center"]

people = []
seen = set()

def add_person(user, name, code, dept, mgr_ix, program=None, discipline=None, site_ix=None,
               manager_id=None, manager_name=None):
    if user in seen:
        return None
    seen.add(user)
    if manager_id is None:
        manager_id, manager_name = MANAGERS[mgr_ix % len(MANAGERS)]
    site, region = SITES[(site_ix if site_ix is not None else len(people)) % len(SITES)]
    row = dict(
        employee_id=code, username=user, full_name=name,
        email=f"{user}@kestreldyn.example", status="Active",
        employee_type="Contractor" if len(people) % 13 == 0 else "Employee",
        manager=manager_name, manager_id=manager_id,
        department=dept, business_unit="Engineering",
        program=program or PROGRAMS[len(people) % len(PROGRAMS)],
        discipline=discipline or DISCIPLINES[len(people) % len(DISCIPLINES)],
        competency=COMPETENCIES[len(people) % len(COMPETENCIES)],
        location=site, region=region,
        cost_center=f"CC-{5100 + (len(people) % 9)}",
    )
    people.append(row)
    return row

# The five named-user states from Phase 2C, kept explicit and named.
NU_STATES = [
    ("a.rehman",    "Aisha Rehman",    "E50001", 5),    # used recently
    ("t.bergman",   "Tomas Bergman",   "E50002", 141),  # long idle -> candidate
    ("n.achebe",    "Ngozi Achebe",    "E50003", None), # never observed
    ("r.delacroix", "Remy Delacroix",  "E50004", 44),   # inside threshold
    # the fifth state is an unresolved identity, in GHOSTS below
]
for user, name, code, _ in NU_STATES:
    add_person(user, name, code, "Avionics", 0, program="Kestrel", discipline="Controls", site_ix=0)

for i in range(400 - len(people)):
    first = FIRST[i % len(FIRST)]
    last = LAST[(i * 7 + i // len(LAST)) % len(LAST)]
    user = f"{first[0].lower()}.{last.lower()}"
    if user in seen:
        user = f"{first[0].lower()}{last.lower()}{i}"
    add_person(user, f"{first} {last}", f"E{50100 + i}", DEPTS[i % len(DEPTS)], i, site_ix=i)

# Three people whose manager is named but carries NO id -> "name only" group.
for j in range(3):
    first, last = ("Iris", "Bergstrom"), ("Noel", "Achterberg"),
for j, (first, last) in enumerate([("Wren","Castellanos"), ("Bo","Lim"), ("Idris","Okonjo")]):
    user = f"nm.{last.lower()}{j}"
    add_person(user, f"{first} {last}", f"E5090{j}", "Materials", 0,
               manager_id="", manager_name="H. Vandermeer")

# Usernames that appear in usage and NOT in the people file.
GHOSTS = ["EMEA\\c.wexford", "svc_batch_sim", "eng_intern_04",
          "APAC\\k.tanabe", "hpc_scheduler", "legacy_acct_88"]

with open(f"{OUT}/scale_people.csv", "w", newline="", encoding="utf-8") as fh:
    w = csv.DictWriter(fh, fieldnames=PEOPLE_HEADERS)
    w.writeheader()
    w.writerows(people)

usernames = [p["username"] for p in people]

# ── Features ─────────────────────────────────────────────────────────────────
# (feature, vendor, model, entitled, contract_qty, unit_price, renewal,
#  rows_per_slot, base_demand, first_day_offset)
FEATURES = [
    # THE MONEY TEST, carried forward: 440 bought vs 350 served.
    ("ANSYS_MECH_ENT", "Ansys",             "concurrent", 350, 440, 5000, "2026-11-15", 13, 250, 0),
    ("ANSYS_CFD",      "Ansys",             "concurrent", 120, 120, 6200, "2026-11-15", 7,  84, 0),
    ("CATIA_V5",       "Dassault Systemes", "concurrent", 200, None, None, None,        11, 150, 0),
    ("NX_DESIGN",      "Siemens",           "concurrent", 180, 180, 3400, "2027-03-31", 10, 128, 0),
    ("ABAQUS_STD",     "Dassault Systemes", "concurrent",  60,  60, 8500, "2026-10-02", 5,  41, 0),
    ("HYPERMESH",      "Altair",            "concurrent",  45,  45, 4800, "2027-01-20", 5,  30, 0),
    ("LS_DYNA",        "Ansys",             "concurrent",  70,  70, 5600, "2027-02-14", 5,  44, 0),
    # Deployed late: only 60 days of history -> LOW confidence, by construction.
    ("STAR_CCM",       "Siemens",           "concurrent",  75,  90, 7100, "2026-12-05", 7,  52, 305),
]
NAMED_USER = [
    ("MATLAB",  "MathWorks", 120, 120,  900, "2027-01-31"),
    ("SIMULINK","MathWorks",  80,  80, 1400, "2027-01-31"),
    ("NX_CAM",  "Siemens",    40, None, None, None),          # unpriced reclaim
    ("VERICUT", "CGTech",     25,  25, 2200, "2027-05-18"),
]
# node_locked in the CONTRACT only, with no entitlement row at all. Exercises
# the Phase 2C fix that reads a licence model the contract stated.
NODE_LOCKED = ("FLOEFD", "Siemens", 30, 3900, "2027-04-09")

rows = []
def emit(day, hour, feature, user, concurrent):
    rows.append((day.isoformat(), f"{hour:02d}:00", feature, user, concurrent, "flex-01"))

# Concurrent demand, in date order.
for offset in range(DAYS):
    day = START + timedelta(days=offset)
    if day.weekday() >= 5:
        continue
    for (feat, _v, _m, _e, _cq, _up, _r, per_slot, base, first_day) in FEATURES:
        if offset < first_day:
            continue
        # A mild upward trend plus daily noise, clipped below entitlement so the
        # estate reads as a real one rather than a saturated one.
        drift = 1.0 + 0.10 * (offset / DAYS)
        peak = int(random.gauss(base * drift, base * 0.11))
        peak = max(int(base * 0.45), peak)
        for hour in (9, 11, 14, 16):
            level = max(1, int(peak * random.uniform(0.62, 1.0)))
            for _ in range(per_slot):
                emit(day, hour, feat, random.choice(usernames), level)
        if random.random() < 0.04:
            emit(day, 11, feat, random.choice(GHOSTS), peak)

# Named-user activity.
def nu_history(feature, user, last_used_days, span, step=4):
    if last_used_days is None:
        return
    last = AS_OF - timedelta(days=last_used_days)
    for k in range(span):
        d = last - timedelta(days=k * step)
        if d < START:
            break
        emit(d, 10, feature, user, 2)

for user, _n, _c, idle in NU_STATES:
    nu_history("MATLAB", user, idle, 26)
nu_history("MATLAB", "EMEA\\c.wexford", 3, 20)          # unresolved, still active
for i in range(60):                                      # a broad MATLAB population
    nu_history("MATLAB", usernames[i * 3 % len(usernames)], 6 + (i % 70), 14)
for i in range(46):
    nu_history("SIMULINK", usernames[(i * 5 + 11) % len(usernames)], 4 + (i % 80), 12)
for i in range(22):
    nu_history("NX_CAM", usernames[(i * 11 + 3) % len(usernames)], 7 + (i % 190), 10)
for i in range(14):
    nu_history("VERICUT", usernames[(i * 17 + 5) % len(usernames)], 5 + (i % 60), 9)
for i in range(18):
    nu_history("FLOEFD", usernames[(i * 13 + 2) % len(usernames)], 9 + (i % 50), 8)

# Date order is how a real export arrives, and is what makes truncation lossy.
rows.sort(key=lambda r: (r[0], r[1], r[2]))

with open(f"{OUT}/scale_usage.csv", "w", newline="", encoding="utf-8") as fh:
    w = csv.writer(fh)
    w.writerow(["date", "hour", "feature", "user", "in_use", "license_server"])
    w.writerows(rows)

# ── Entitlements: what the licence servers are configured to serve ───────────
with open(f"{OUT}/scale_entitlements.csv", "w", newline="", encoding="utf-8") as fh:
    w = csv.writer(fh)
    w.writerow(["feature", "vendor", "quantity", "license_type", "license_server", "expiry"])
    for (feat, vendor, _m, entitled, _cq, _up, renewal, *_x) in FEATURES:
        w.writerow([feat, vendor, entitled, "concurrent", "flex-01", renewal or ""])
    for (feat, vendor, entitled, _cq, _up, renewal) in NAMED_USER:
        w.writerow([feat, vendor, entitled, "named user", "flex-01", renewal or ""])
    # FLOEFD deliberately absent: contract evidence only.

# ── Contracts: what procurement actually bought ──────────────────────────────
with open(f"{OUT}/scale_contracts.csv", "w", newline="", encoding="utf-8") as fh:
    w = csv.writer(fh)
    w.writerow(["feature","vendor","contract_number","po_number","quantity","unit_price",
                "currency","license_type","renewal_date"])
    n = 4400
    for (feat, vendor, _m, _e, cq, up, renewal, *_x) in FEATURES:
        if cq is None:
            continue
        n += 1
        w.writerow([feat, vendor, f"CTR-{n}", f"PO-{90000+n}", cq, up, "USD", "concurrent", renewal])
    for (feat, vendor, _e, cq, up, renewal) in NAMED_USER:
        if cq is None:
            continue
        n += 1
        w.writerow([feat, vendor, f"CTR-{n}", f"PO-{90000+n}", cq, up, "USD", "named user", renewal])
    feat, vendor, cq, up, renewal = NODE_LOCKED
    n += 1
    w.writerow([feat, vendor, f"CTR-{n}", f"PO-{90000+n}", cq, up, "USD", "node locked", renewal])

size = os.path.getsize(f"{OUT}/scale_usage.csv")
print(f"people   {len(people)}")
print(f"usage    {len(rows)} rows, {size:,} bytes ({size/1024/1024:.2f} MB)")
print(f"features {len(FEATURES)} concurrent + {len(NAMED_USER)} named-user + 1 node-locked")
