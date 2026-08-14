/**
 * The synthetic engineering organization.
 *
 * Aerospace Dynamics Corporation is fictional. Every employee, manager,
 * program and location below is invented. No real person or company is
 * represented, and no confidential or customer data was used.
 */

import type { Employee } from '@/lib/domain/types';
import type { Rng } from './prng';

export const DEMO_ORG = {
  name: 'Aerospace Dynamics Corporation',
  slug: 'aerospace-dynamics',
  industry: 'Aerospace & Defense',
  technicalHeadcount: 3850,
  /** SCENARIO I: expected annual technical headcount growth. */
  headcountGrowthRate: 0.05,
  currency: 'USD',
} as const;

/** SCENARIO G: Program Helios deliberately dominates consumption. */
const PROGRAMS = [
  { value: 'Program Helios', weight: 38 },
  { value: 'Program Vega', weight: 22 },
  { value: 'Program Aurora', weight: 16 },
  { value: 'Program Meridian', weight: 12 },
  { value: 'Sustaining Engineering', weight: 12 },
];

const BUSINESS_UNITS = [
  { value: 'Aerostructures', weight: 34 },
  { value: 'Propulsion Systems', weight: 24 },
  { value: 'Avionics & Software', weight: 26 },
  { value: 'Advanced Programs', weight: 16 },
];

/** SCENARIO H: Structures is the concentrated department. */
const DEPARTMENTS: { value: string; weight: number; discipline: string }[] = [
  { value: 'Structures', weight: 19, discipline: 'Structural Analysis' },
  { value: 'Aerodynamics', weight: 11, discipline: 'CFD' },
  { value: 'Thermal Sciences', weight: 9, discipline: 'Thermal Analysis' },
  { value: 'Propulsion Engineering', weight: 10, discipline: 'CFD' },
  { value: 'Avionics Hardware', weight: 9, discipline: 'Electrical Design' },
  { value: 'Flight Controls', weight: 8, discipline: 'Controls' },
  { value: 'Systems Engineering', weight: 9, discipline: 'Systems' },
  { value: 'Materials & Processes', weight: 6, discipline: 'Materials' },
  { value: 'Manufacturing Engineering', weight: 10, discipline: 'Manufacturing' },
  { value: 'Test & Validation', weight: 6, discipline: 'Test' },
  { value: 'Electromagnetics', weight: 3, discipline: 'Electromagnetics' },
];

const COMPETENCIES = [
  'Simulation & Analysis',
  'Design Engineering',
  'Systems Integration',
  'Verification & Test',
  'Manufacturing Engineering',
];

const LOCATIONS = [
  { value: { location: 'Everett, WA', region: 'North America' }, weight: 30 },
  { value: { location: 'Wichita, KS', region: 'North America' }, weight: 18 },
  { value: { location: 'Huntsville, AL', region: 'North America' }, weight: 16 },
  { value: { location: 'Toulouse, France', region: 'EMEA' }, weight: 14 },
  { value: { location: 'Bengaluru, India', region: 'APAC' }, weight: 15 },
  { value: { location: 'Montréal, Canada', region: 'North America' }, weight: 7 },
];

const CONTRACTOR_COMPANIES = [
  'Northgate Technical Services',
  'Vector Engineering Partners',
  'Calder Aerospace Staffing',
  'Rivet Technical Resources',
];

const FIRST_NAMES = [
  'Amara', 'Devon', 'Priya', 'Marcus', 'Lena', 'Tobias', 'Nadia', 'Elliot', 'Sofia', 'Rahul',
  'Imani', 'Gregor', 'Yuki', 'Callum', 'Farida', 'Nils', 'Beatriz', 'Omar', 'Hannah', 'Kwame',
  'Ingrid', 'Mateo', 'Chloe', 'Dmitri', 'Aisha', 'Fionn', 'Camila', 'Jonas', 'Leila', 'Andre',
  'Meera', 'Stefan', 'Rosa', 'Hugo', 'Anouk', 'Kenji', 'Talia', 'Bram', 'Noor', 'Viktor',
  'Elise', 'Samir', 'Greta', 'Idris', 'Maya', 'Lorenzo', 'Freya', 'Hassan', 'Clara', 'Theo',
];

const LAST_NAMES = [
  'Okafor', 'Lindqvist', 'Raghunathan', 'Delacroix', 'Moreau', 'Vasquez', 'Nakamura', 'Osei',
  'Villanueva', 'Brennan', 'Kowalski', 'Haddad', 'Sorensen', 'Ferreira', 'Bianchi', 'Novak',
  'Adeyemi', 'Petrov', 'Castellanos', 'Whitfield', 'Aaltonen', 'Marchetti', 'Duarte', 'Ivanova',
  'Chaudhry', 'Lindgren', 'Bergeron', 'Kaminski', 'Rasmussen', 'Oyelaran', 'Salgado', 'Voss',
  'Tremblay', 'Kirchner', 'Amadi', 'Solberg', 'Renard', 'Baptiste', 'Halvorsen', 'Krishnan',
];

/** Distinct manager pool, so reclaim campaigns route to a plausible person. */
function buildManagers(rng: Rng, count: number): string[] {
  const managers = new Set<string>();
  let guard = 0;
  while (managers.size < count && guard < count * 20) {
    managers.add(`${rng.pick(FIRST_NAMES)} ${rng.pick(LAST_NAMES)}`);
    guard += 1;
  }
  return [...managers];
}

export interface GeneratedOrganization {
  employees: Employee[];
  /** Employees grouped by engineering discipline, for usage attribution. */
  byDiscipline: Map<string, Employee[]>;
}

export function generateEmployees(rng: Rng, organizationId: string): GeneratedOrganization {
  const managers = buildManagers(rng, 96);
  const employees: Employee[] = [];
  const usernames = new Set<string>();

  for (let i = 0; i < DEMO_ORG.technicalHeadcount; i++) {
    const department = rng.weighted(DEPARTMENTS.map((d) => ({ value: d, weight: d.weight })));
    const place = rng.weighted(LOCATIONS);
    const firstName = rng.pick(FIRST_NAMES);
    const lastName = rng.pick(LAST_NAMES);

    // Usernames follow a first-initial + surname + disambiguator convention,
    // the kind of thing a license server actually records.
    const base = `${firstName[0]?.toLowerCase() ?? 'x'}${lastName.toLowerCase().replace(/[^a-z]/g, '')}`;
    let username = base;
    let suffix = 1;
    while (usernames.has(username)) {
      suffix += 1;
      username = `${base}${suffix}`;
    }
    usernames.add(username);

    const isContractor = rng.chance(0.15);
    const employeeCode = `ADC${String(100000 + i).slice(-6)}`;

    employees.push({
      id: `emp-${i}`,
      organizationId,
      employeeCode,
      username,
      fullName: `${firstName} ${lastName}`,
      email: `${username}@aerodynamics-demo.example`,
      managerName: rng.pick(managers),
      department: department.value,
      businessUnit: rng.weighted(BUSINESS_UNITS),
      program: rng.weighted(PROGRAMS),
      discipline: department.discipline,
      competency: rng.pick(COMPETENCIES),
      location: place.location,
      region: place.region,
      employeeType: isContractor ? 'contractor' : 'employee',
      // A small share of leavers, which is what creates genuine reclaim value.
      status: rng.chance(0.03) ? 'inactive' : 'active',
      contractorCompany: isContractor ? rng.pick(CONTRACTOR_COMPANIES) : null,
    });
  }

  const byDiscipline = new Map<string, Employee[]>();
  for (const employee of employees) {
    const key = employee.discipline ?? 'Unassigned';
    const bucket = byDiscipline.get(key);
    if (bucket === undefined) byDiscipline.set(key, [employee]);
    else bucket.push(employee);
  }

  return { employees, byDiscipline };
}

export { DEPARTMENTS, PROGRAMS, CONTRACTOR_COMPANIES };
