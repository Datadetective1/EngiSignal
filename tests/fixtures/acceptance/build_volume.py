"""
Phase 2E volume estates — "Kestrel Dynamics" at 150k and 300k usage rows.

The Phase 2D estate sat at the per-file upload ceiling: 68,008 rows in 3.20 MB.
A real annual export set for a large engineering estate is several times that
and arrives as SEVERAL FILES, because 4 MB is a per-request limit and not a
per-customer one. These estates are therefore generated already split into
parts, and imported as parts, which is what a customer actually does.

What the volume is for: Phase 2E replaced per-request recomputation with a
stored projection, and the claim that makes it work is that the PROJECTION is
bounded by features x days x people while the RAW ROWS are bounded by
observations. That claim is only testable if the two grow at different rates,
so these estates add observations and people without adding years.

Everything else is deliberately identical to build_scale.py — the same features,
prices, licence models, renewal dates and named-user states — so a figure that
changes between 68k and 300k is a real finding and not a different fixture.
"""
import csv, os, random, sys
from datetime import date, timedelta

TARGET_ROWS = int(sys.argv[1]) if len(sys.argv) > 1 else 150_000
LABEL = sys.argv[2] if len(sys.argv) > 2 else "vol150"
MAX_PART_BYTES = 3_400_000          # comfortably inside the 4 MB request guard

random.seed(20260817)
OUT = os.path.dirname(os.path.abspath(__file__))

AS_OF = date(2026, 8, 14)
DAYS = 365
START = AS_OF - timedelta(days=DAYS - 1)

DEPTS = ["Structures", "Aerodynamics", "Propulsion", "Avionics", "Materials", "Systems"]
PROGRAMS = ["Kestrel", "Harrier", "Merlin", "Osprey"]
DISCIPLINES = ["Mechanical", "Fluids", "Controls", "Stress", "Manufacturing"]
COMPETENCIES = ["Simulation", "Design", "Test", "Integration"]
SITES = [("Bristol", "EMEA"), ("Toulouse", "EMEA"), ("Wichita", "AMER"), ("Nagoya", "APAC")]

MANAGERS = [(f"mgr-3{i:03d}", n) for i, n in enumerate([
    "M. Okafor", "R. Whitfield", "R. Whitfield", "P. Lindqvist", "S. Bhattacharya",
    "D. Aterno", "K. Mensah", "L. Fontaine", "T. Ishikawa", "A. Novakova",
    "G. Oyelaran", "H. Castellanos"], start=101)]

FIRST = ["Lena","Omar","Priya","Sven","Ada","Kwame","Mira","Tomas","Ines","Hiro","Nadia","Felix",
         "Rosa","Jun","Elif","Pablo","Anja","Yusuf","Clara","Dmitri","Sofia","Marcus","Leila",
         "Bruno","Greta","Amir","Nora","Viktor","Zara","Ravi","Ilse","Karim","Petra","Hugo",
         "Maya","Otto","Sara","Emil","Tara","Milos","Nina","Cato","Rania","Jonas","Alba","Piotr"]
LAST = ["Voss","Haddad","Nair","Ek","Lovelace","Mensah","Patel","Nyberg","Duarte","Sato","Belkacem",
        "Brandt","Iglesias","Park","Demir","Sanz","Larsen","Yilmaz","Novak","Orlov","Ferreira","Holt",
        "Nasser","Costa","Vogel","Haidar","Lindgren","Petrov","Khan","Menon","Bakker","Toure","Kovac",
        "Mercier","Singh","Reinhardt","Lindqvist","Berg","Osei","Jovic","Sorensen","Dupont","Aziz"]

PEOPLE_HEADERS = ["employee_id","username","full_name","email","status","employee_type","manager",
                  "manager_id","department","business_unit","program","discipline","competency",
                  "location","region","cost_center"]

# People scale with the estate: a bigger export is a bigger company, not the
# same company logged more often. This is what makes `activities` grow too.
HEADCOUNT = max(400, TARGET_ROWS // 250)

people, seen = [], set()

def add_person(user, name, code, dept, mgr_ix, program=None, discipline=None, site_ix=None,
               manager_id=None, manager_name=None):
    if user in seen:
        return
    seen.add(user)
    if manager_id is None:
        manager_id, manager_name = MANAGERS[mgr_ix % len(MANAGERS)]
    site, region = SITES[(site_ix if site_ix is not None else len(people)) % len(SITES)]
    people.append(dict(
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
    ))

# The five named-user states, carried forward unchanged.
NU_STATES = [
    ("a.rehman",    "Aisha Rehman",    "E50001", 5),
    ("t.bergman",   "Tomas Bergman",   "E50002", 141),
    ("n.achebe",    "Ngozi Achebe",    "E50003", None),
    ("r.delacroix", "Remy Delacroix",  "E50004", 44),
]
for user, name, code, _ in NU_STATES:
    add_person(user, name, code, "Avionics", 0, program="Kestrel", discipline="Controls", site_ix=0)

i = 0
while len(people) < HEADCOUNT:
    first = FIRST[i % len(FIRST)]
    last = LAST[(i * 7 + i // len(LAST)) % len(LAST)]
    user = f"{first[0].lower()}.{last.lower()}"
    if user in seen:
        user = f"{first[0].lower()}{last.lower()}{i}"
    add_person(user, f"{first} {last}", f"E{50100 + i}", DEPTS[i % len(DEPTS)], i, site_ix=i)
    i += 1

for j, (first, last) in enumerate([("Wren","Castellanos"), ("Bo","Lim"), ("Idris","Okonjo")]):
    add_person(f"nm.{last.lower()}{j}", f"{first} {last}", f"E5090{j}", "Materials", 0,
               manager_id="", manager_name="H. Vandermeer")

GHOSTS = ["EMEA\\c.wexford", "svc_batch_sim", "eng_intern_04",
          "APAC\\k.tanabe", "hpc_scheduler", "legacy_acct_88"]

with open(f"{OUT}/{LABEL}_people.csv", "w", newline="", encoding="utf-8") as fh:
    w = csv.DictWriter(fh, fieldnames=PEOPLE_HEADERS)
    w.writeheader()
    w.writerows(people)

usernames = [p["username"] for p in people]

FEATURES = [
    ("ANSYS_MECH_ENT", "Ansys",             "concurrent", 350, 440, 5000, "2026-11-15", 250, 0),
    ("ANSYS_CFD",      "Ansys",             "concurrent", 120, 120, 6200, "2026-11-15", 84,  0),
    ("CATIA_V5",       "Dassault Systemes", "concurrent", 200, None, None, None,        150, 0),
    ("NX_DESIGN",      "Siemens",           "concurrent", 180, 180, 3400, "2027-03-31", 128, 0),
    ("ABAQUS_STD",     "Dassault Systemes", "concurrent",  60,  60, 8500, "2026-10-02", 41,  0),
    ("HYPERMESH",      "Altair",            "concurrent",  45,  45, 4800, "2027-01-20", 30,  0),
    ("LS_DYNA",        "Ansys",             "concurrent",  70,  70, 5600, "2027-02-14", 44,  0),
    ("STAR_CCM",       "Siemens",           "concurrent",  75,  90, 7100, "2026-12-05", 52,  305),
]
NAMED_USER = [
    ("MATLAB",  "MathWorks", 120, 120,  900, "2027-01-31"),
    ("SIMULINK","MathWorks",  80,  80, 1400, "2027-01-31"),
    ("NX_CAM",  "Siemens",    40, None, None, None),
    ("VERICUT", "CGTech",     25,  25, 2200, "2027-05-18"),
]
NODE_LOCKED = ("FLOEFD", "Siemens", 30, 3900, "2027-04-09")

weekdays = [START + timedelta(days=o) for o in range(DAYS)
            if (START + timedelta(days=o)).weekday() < 5]

# Observations per slot, solved for the requested total rather than hard-coded,
# so the same generator produces every scale in the series.
slots = sum(4 * len([d for d in weekdays if (d - START).days >= first_day])
            for *_x, first_day in [(f[-1],) and f for f in FEATURES])
per_slot = max(1, round(TARGET_ROWS * 0.94 / max(1, slots)))

rows = []
def emit(day, hour, feature, user, concurrent):
    rows.append((day.isoformat(), f"{hour:02d}:00", feature, user, concurrent, "flex-01"))

for day in weekdays:
    offset = (day - START).days
    for (feat, _v, _m, _e, _cq, _up, _r, base, first_day) in FEATURES:
        if offset < first_day:
            continue
        drift = 1.0 + 0.10 * (offset / DAYS)
        peak = max(int(base * 0.45), int(random.gauss(base * drift, base * 0.11)))
        for hour in (9, 11, 14, 16):
            level = max(1, int(peak * random.uniform(0.62, 1.0)))
            for _ in range(per_slot):
                emit(day, hour, feat, random.choice(usernames), level)
        if random.random() < 0.04:
            emit(day, 11, feat, random.choice(GHOSTS), peak)

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
nu_history("MATLAB", "EMEA\\c.wexford", 3, 20)
for i in range(60):
    nu_history("MATLAB", usernames[i * 3 % len(usernames)], 6 + (i % 70), 14)
for i in range(46):
    nu_history("SIMULINK", usernames[(i * 5 + 11) % len(usernames)], 4 + (i % 80), 12)
for i in range(22):
    nu_history("NX_CAM", usernames[(i * 11 + 3) % len(usernames)], 7 + (i % 190), 10)
for i in range(14):
    nu_history("VERICUT", usernames[(i * 17 + 5) % len(usernames)], 5 + (i % 60), 9)
for i in range(18):
    nu_history("FLOEFD", usernames[(i * 13 + 2) % len(usernames)], 9 + (i % 50), 8)

rows.sort(key=lambda r: (r[0], r[1], r[2]))

# Split into parts under the per-request guard, on a date boundary so each part
# is a coherent export rather than a byte-sliced one.
HEADER = ["date", "hour", "feature", "user", "in_use", "license_server"]
parts, current, size = [], [], 0
for row in rows:
    line = ",".join(str(v) for v in row)
    if size + len(line) + 1 > MAX_PART_BYTES and current:
        parts.append(current)
        current, size = [], 0
    current.append(row)
    size += len(line) + 1
if current:
    parts.append(current)

for index, part in enumerate(parts, start=1):
    name = f"{OUT}/{LABEL}_usage_{index}.csv"
    with open(name, "w", newline="", encoding="utf-8") as fh:
        w = csv.writer(fh)
        w.writerow(HEADER)
        w.writerows(part)

with open(f"{OUT}/{LABEL}_entitlements.csv", "w", newline="", encoding="utf-8") as fh:
    w = csv.writer(fh)
    w.writerow(["feature", "vendor", "quantity", "license_type", "license_server", "expiry"])
    for (feat, vendor, _m, entitled, _cq, _up, renewal, *_x) in FEATURES:
        w.writerow([feat, vendor, entitled, "concurrent", "flex-01", renewal or ""])
    for (feat, vendor, entitled, _cq, _up, renewal) in NAMED_USER:
        w.writerow([feat, vendor, entitled, "named user", "flex-01", renewal or ""])

with open(f"{OUT}/{LABEL}_contracts.csv", "w", newline="", encoding="utf-8") as fh:
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

total = sum(os.path.getsize(f"{OUT}/{LABEL}_usage_{i}.csv") for i in range(1, len(parts) + 1))
print(f"{LABEL}: {len(rows)} usage rows, {len(people)} people, "
      f"{len(parts)} parts, {total:,} bytes total "
      f"(largest {max(os.path.getsize(f'{OUT}/{LABEL}_usage_{i}.csv') for i in range(1, len(parts)+1)):,})")
