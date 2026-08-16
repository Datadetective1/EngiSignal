"""
Phase 2C acceptance datasets — "Northvane Aerospace".

Built to exercise every Phase 2C requirement against the deployed app:

  ANSYS_MECH_ENT  concurrent   contract 440 @ $5,000 vs entitlement 350
                               THE critical financial test.
  MATLAB          named_user   10 seats @ $900, users A-E in five states
  CATIA_V5        concurrent   entitlement only, no contract -> served capacity
  NX_CAM          named_user   entitlement only, unpriced -> reclaim, no value

  Usage carries NO duration column, so allocation must fall back to distinct
  observed users. Two usernames never appear in the people file, so a real
  UNALLOCATED amount exists.
"""
import csv, os, random
from datetime import date, timedelta

random.seed(20260815)
OUT = os.path.dirname(os.path.abspath(__file__))

AS_OF = date(2026, 8, 15)
START = AS_OF - timedelta(days=180)

# ── People ───────────────────────────────────────────────────────────────────
# managerKey is the identifier; two managers deliberately share the NAME
# "J. Smith" with different IDs, so a name-based rollup would merge them.
MANAGERS = [
    ("mgr-1041", "M. Okafor"),
    ("mgr-1042", "J. Smith"),
    ("mgr-1043", "J. Smith"),   # different person, same name
    ("mgr-1044", "P. Lindqvist"),
]
DEPTS = ["Structures", "Aerodynamics", "Propulsion", "Controls", "Materials"]
SITES = [("Bristol", "EMEA"), ("Toulouse", "EMEA"), ("Wichita", "AMER")]

people = []
# The five named-user states the spec asks for, on MATLAB.
STATES = [
    # (user, name, code, dept, mgr, last MATLAB use in days before as-of)
    ("a.rehman",   "Aisha Rehman",   "E20101", "Controls", 0, 5),     # A recent
    ("t.bergman",  "Tomas Bergman",  "E20102", "Controls", 0, 136),   # B long idle
    ("n.achebe",   "Ngozi Achebe",   "E20103", "Controls", 0, None),  # C never seen
    ("r.delacroix","Remy Delacroix", "E20104", "Controls", 0, 40),    # D inside threshold
    # E has no people record at all -> unresolved identity (see GHOSTS)
]
for user, name, code, dept, mgr_ix, _ in STATES:
    mk, mn = MANAGERS[mgr_ix]
    site, region = SITES[0]
    people.append(dict(
        employee_id=code, username=user, full_name=name,
        email=f"{user}@northvane.example", status="Active", employee_type="Employee",
        manager=mn, manager_id=mk, department=dept, business_unit="Engineering",
        program="Halo", discipline="Controls", location=site, region=region,
        cost_center="CC-4400",
    ))

for i in range(46):
    mk, mn = MANAGERS[i % len(MANAGERS)]
    dept = DEPTS[i % len(DEPTS)]
    site, region = SITES[i % len(SITES)]
    first = ["Lena","Omar","Priya","Sven","Ada","Kwame","Mira","Tomas","Ines","Hiro",
             "Nadia","Felix","Rosa","Jun","Elif","Pablo","Anja","Yusuf","Clara","Dmitri",
             "Sofia","Marcus","Leila","Bruno","Greta","Amir","Nora","Viktor","Zara","Ravi",
             "Ilse","Karim","Petra","Hugo","Maya","Otto","Sara","Emil","Tara","Milos",
             "Nina","Cato","Rania","Jonas","Alba","Piotr"][i]
    last = ["Voss","Haddad","Nair","Ek","Lovelace","Mensah","Patel","Nyberg","Duarte","Sato",
            "Belkacem","Brandt","Iglesias","Park","Demir","Sanz","Larsen","Yilmaz","Novak","Orlov",
            "Ferreira","Holt","Nasser","Costa","Vogel","Haidar","Lindgren","Petrov","Khan","Menon",
            "Bakker","Toure","Kovac","Mercier","Singh","Reinhardt","Lindqvist","Berg","Osei","Jovic",
            "Sorensen","Dupont","Aziz","Weiss","Marti","Nowak"][i]
    user = f"{first[0].lower()}.{last.lower()}"
    people.append(dict(
        employee_id=f"E{20200 + i}", username=user, full_name=f"{first} {last}",
        email=f"{user}@northvane.example", status="Active",
        employee_type="Contractor" if i % 11 == 0 else "Employee",
        manager=mn, manager_id=mk, department=dept, business_unit="Engineering",
        program=["Halo", "Vertex", "Corvid"][i % 3], discipline=dept,
        location=site, region=region, cost_center=f"CC-{4400 + (i % 5)}",
    ))

# Three people whose manager is named but carries NO id -> "name only" group.
for j, (first, last) in enumerate([("Iris","Bergstrom"), ("Noel","Achterberg"), ("Wren","Castellanos")]):
    user = f"{first[0].lower()}.{last.lower()}"
    people.append(dict(
        employee_id=f"E203{j:02d}", username=user, full_name=f"{first} {last}",
        email=f"{user}@northvane.example", status="Active", employee_type="Employee",
        manager="H. Vandermeer", manager_id="", department="Materials",
        business_unit="Engineering", program="Corvid", discipline="Materials",
        location="Wichita", region="AMER", cost_center="CC-4404",
    ))

# Usernames that appear in usage and NOT in the people file.
GHOSTS = ["EMEA\\c.wexford", "svc_batch_sim", "eng_intern_04"]

PEOPLE_HEADERS = ["employee_id","username","full_name","email","status","employee_type",
                  "manager","manager_id","department","business_unit","program",
                  "discipline","location","region","cost_center"]

with open(f"{OUT}/qa_people.csv", "w", newline="", encoding="utf-8") as fh:
    w = csv.DictWriter(fh, fieldnames=PEOPLE_HEADERS)
    w.writeheader()
    w.writerows(people)

# ── Usage ────────────────────────────────────────────────────────────────────
# NO duration column anywhere: the distinct-observed-users path is the point.
usernames = [p["username"] for p in people]
rows = []

def add(day, hour, feature, user, concurrent):
    rows.append(dict(date=day.isoformat(), hour=f"{hour:02d}:00", feature=feature,
                     user=user, in_use=concurrent, license_server="flex-01"))

# ANSYS: broad concurrent demand, peaking around 300 against 350 served.
day = START
while day <= AS_OF:
    if day.weekday() < 5:
        peak = int(random.gauss(250, 28))
        peak = max(120, min(305, peak))
        for hour in (9, 11, 14, 16):
            level = max(40, int(peak * random.uniform(0.55, 1.0)))
            for _ in range(6):
                add(day, hour, "ANSYS_MECH_ENT", random.choice(usernames), level)
            if random.random() < 0.10:
                add(day, hour, "ANSYS_MECH_ENT", random.choice(GHOSTS), level)
    day += timedelta(days=1)

# CATIA: steady demand, entitlement only.
day = START
while day <= AS_OF:
    if day.weekday() < 5:
        for hour in (10, 15):
            level = max(20, int(random.gauss(88, 12)))
            for _ in range(4):
                add(day, hour, "CATIA_V5", random.choice(usernames), level)
    day += timedelta(days=1)

# MATLAB: the five states, exactly.
def matlab_history(user, last_used_days, span_days):
    if last_used_days is None:
        return
    last = AS_OF - timedelta(days=last_used_days)
    for k in range(span_days):
        d = last - timedelta(days=k * 3)
        if d < START:
            break
        add(d, 10, "MATLAB", user, 3)

matlab_history("a.rehman", 5, 20)
matlab_history("t.bergman", 136, 8)     # stops 136 days ago
matlab_history("r.delacroix", 40, 12)
# n.achebe: never appears at all.
# The unresolved identity, still using MATLAB.
matlab_history("EMEA\\c.wexford", 3, 10)

# NX_CAM: named-user, unpriced, one clearly idle holder.
matlab_nx = [("j.park", 150), ("l.voss", 12), ("o.haddad", 8)]
for user, days in matlab_nx:
    last = AS_OF - timedelta(days=days)
    for k in range(10):
        d = last - timedelta(days=k * 4)
        if d < START:
            break
        add(d, 13, "NX_CAM", user, 2)

with open(f"{OUT}/qa_usage.csv", "w", newline="", encoding="utf-8") as fh:
    w = csv.DictWriter(fh, fieldnames=["date","hour","feature","user","in_use","license_server"])
    w.writeheader()
    w.writerows(rows)

# ── Entitlements — what the licence server is configured to serve ────────────
with open(f"{OUT}/qa_entitlements.csv", "w", newline="", encoding="utf-8") as fh:
    w = csv.writer(fh)
    w.writerow(["feature", "vendor", "quantity", "license_type", "license_server", "expiry"])
    w.writerow(["ANSYS_MECH_ENT", "Ansys", 350, "concurrent", "flex-01", "2026-11-15"])
    w.writerow(["CATIA_V5", "Dassault Systemes", 120, "concurrent", "flex-01", "2027-02-28"])
    w.writerow(["MATLAB", "MathWorks", 10, "named user", "flex-01", "2027-01-31"])
    w.writerow(["NX_CAM", "Siemens", 6, "named user", "flex-01", "2027-04-30"])

# ── Contracts — what procurement actually bought ─────────────────────────────
with open(f"{OUT}/qa_contracts.csv", "w", newline="", encoding="utf-8") as fh:
    w = csv.writer(fh)
    w.writerow(["feature","vendor","contract_number","po_number","quantity","unit_price",
                "currency","license_type","renewal_date"])
    # 440 bought, 350 served. The critical test.
    w.writerow(["ANSYS_MECH_ENT","Ansys","CTR-2291","PO-88410",440,5000,"USD","concurrent","2026-11-15"])
    w.writerow(["MATLAB","MathWorks","CTR-2317","PO-88502",10,900,"USD","named user","2027-01-31"])
    # CATIA and NX_CAM appear in no contract file at all: served capacity only,
    # and NX_CAM's reclaim therefore has no defensible dollar value.

print("people", len(people), "usage", len(rows))
