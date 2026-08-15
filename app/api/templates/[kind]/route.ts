import { NextResponse } from 'next/server';
import { csvResponse, toCsv } from '@/lib/export/csv';
import { IMPORT_KINDS, IMPORT_SCHEMAS } from '@/lib/import/schema';
import type { ImportKind } from '@/lib/domain/types';

export const runtime = 'nodejs';

/** Illustrative rows, so the template shows the expected shape of each field. */
const SAMPLES: Record<ImportKind, Record<string, string>[]> = {
  usage: [
    {
      date: '2026-03-02',
      hour: '10',
      username: 'aokafor',
      employeeCode: 'ADC100482',
      featureCode: 'MECH_ENT',
      vendor: 'Ansys',
      product: 'Mechanical',
      licenseServer: 'lic-sim-01',
      peakUsage: '268',
      concurrent: '241',
      sessions: '312',
      durationHours: '1840',
      available: '400',
      denials: '0',
    },
    {
      date: '2026-03-02',
      hour: '11',
      username: 'dlindqvist',
      employeeCode: 'ADC100613',
      featureCode: 'FLUENT',
      vendor: 'Ansys',
      product: 'Fluent',
      licenseServer: 'lic-sim-01',
      peakUsage: '142',
      concurrent: '138',
      sessions: '186',
      durationHours: '990',
      available: '165',
      denials: '2',
    },
  ],
  employees: [
    {
      employeeCode: 'ADC100482',
      username: 'aokafor',
      fullName: 'Amara Okafor',
      email: 'aokafor@example.com',
      managerName: 'Priya Raghunathan',
      department: 'Structures',
      businessUnit: 'Aerostructures',
      program: 'Program Helios',
      discipline: 'Structural Analysis',
      competency: 'Simulation & Analysis',
      location: 'Everett, WA',
      region: 'North America',
      employeeType: 'employee',
      status: 'active',
      contractorCompany: '',
    },
  ],
  contracts: [
    {
      vendor: 'Ansys',
      product: 'Mechanical',
      featureCode: 'MECH_ENT',
      sku: 'ANS-MECH-ENT',
      licenseModel: 'concurrent',
      quantity: '400',
      unitPrice: '5000',
      annualPrice: '2000000',
      contractNumber: 'ADC-ANS-2024-118',
      startDate: '2025-08-28',
      renewalDate: '2026-08-27',
      purchaseOrder: 'PO-884201',
      businessOwner: 'Priya Raghunathan',
      costCenter: 'CC-4400 Engineering Tools',
    },
  ],
  assignments: [
    {
      username: 'aokafor',
      featureCode: 'MATLAB',
      assignedOn: '2024-11-04',
      lastUsedDate: '2026-06-19',
      totalSessions: '184',
      totalHours: '612',
    },
  ],
  denials: [
    {
      date: '2026-05-14',
      hour: '14',
      username: 'dlindqvist',
      featureCode: 'STARCCM',
      count: '3',
      concurrentAtDenial: '100',
      availableAtDenial: '0',
    },
  ],
};

export async function GET(_request: Request, { params }: { params: Promise<{ kind: string }> }) {
  const { kind } = await params;

  if (!IMPORT_KINDS.includes(kind as ImportKind)) {
    return NextResponse.json({ error: 'Unknown template.' }, { status: 404 });
  }

  const typedKind = kind as ImportKind;
  const schema = IMPORT_SCHEMAS[typedKind];
  const headers = schema.fields.map((field) => field.label);
  const rows = SAMPLES[typedKind].map((sample) => schema.fields.map((field) => sample[field.key] ?? ''));

  return csvResponse(`engisignal-${kind}-template.csv`, toCsv(headers, rows));
}
