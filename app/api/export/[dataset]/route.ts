import { NextResponse } from 'next/server';
import {
  ALLOCATION_METHODS,
  DIMENSION_LABELS,
  allocateCost,
  type AllocationMethod,
} from '@/lib/analytics/allocation';
import { buildReclaimCandidates } from '@/lib/analytics/named-user';
import { daysInactive } from '@/lib/analytics/named-user';
import { csvResponse, toCsv } from '@/lib/export/csv';
import { annualizedTrend } from '@/lib/analytics/trend';
import type { DimensionKey } from '@/lib/domain/types';
import { employeeIndex, loadWorkspace } from '@/lib/workspace';

export const runtime = 'nodejs';

/**
 * Detail exports.
 *
 * Every figure the UI shows must be extractable, because the people who have to
 * defend a renewal position rebuild it in a spreadsheet at least once.
 */
export async function GET(request: Request, { params }: { params: Promise<{ dataset: string }> }) {
  const { dataset: datasetName } = await params;
  const workspace = await loadWorkspace();
  const url = new URL(request.url);
  const stamp = workspace.dataset.asOf;

  switch (datasetName) {
    case 'portfolio': {
      const headers = [
        'Vendor', 'Product', 'Feature', 'Feature code', 'License model', 'Entitled', 'P95 daily peak',
        'Maximum', 'Utilization %', 'Saturation days', 'Trend % per year', 'Unit price', 'Annual cost',
        'Recommended quantity', 'Quantity delta', 'Optimization opportunity', 'Incremental spend',
        'Renewal date', 'Days to renewal', 'Risk', 'Confidence', 'Confidence score', 'Methodology',
      ];
      const rows = workspace.portfolio.map((row) => [
        row.vendorName, row.productName, row.featureName, row.featureCode, row.licenseModel,
        row.entitled, row.metrics?.p95 ?? '', row.metrics?.max ?? '',
        row.metrics?.utilizationPct ?? row.namedUser?.utilizationPct ?? '',
        row.metrics?.saturationDays ?? '',
        // An empty cell, not a number, when the history behind the trend is
        // too short to support one. A spreadsheet formula over this column
        // must not silently average in a slope taken from three days.
        annualizedTrend(row.metrics) ?? '',
        row.unitPrice ?? '', row.financial.currentAnnualCost ?? '',
        row.rightSizing?.recommended ?? '', row.rightSizing?.quantityDelta ?? '',
        row.financial.optimizationOpportunity ?? '', row.financial.incrementalSpend ?? '',
        row.renewalDate ?? '', row.daysToRenewal ?? '', row.risk, row.confidence.level,
        row.confidence.score, row.rightSizing?.methodology ?? '',
      ]);
      return csvResponse(`engisignal-portfolio-${stamp}.csv`, toCsv(headers, rows));
    }

    case 'users': {
      const featureFilter = url.searchParams.get('feature');
      const employees = employeeIndex(workspace.dataset);
      const featureById = new Map(workspace.portfolio.map((row) => [row.featureId, row]));

      const headers = [
        'User', 'Username', 'Employee ID', 'Employee type', 'Manager', 'Department', 'Business unit',
        'Program', 'Discipline', 'Location', 'Vendor', 'Product', 'Feature', 'Assigned seat',
        'Last used', 'Days inactive', 'Sessions', 'Hours', 'Annual seat cost', 'Recommendation',
      ];

      const rows = workspace.dataset.activities
        .filter((activity) => featureFilter === null || activity.featureId === featureFilter)
        .map((activity) => {
          const employee = employees.get(activity.employeeId);
          const feature = featureById.get(activity.featureId);
          const idle = daysInactive(activity.lastUsedDate, workspace.dataset.asOf);
          const isIdleSeat =
            activity.assigned &&
            (activity.lastUsedDate === null ||
              (idle !== null && idle >= workspace.options.reclaimThresholdDays));

          return [
            employee?.fullName ?? activity.employeeId, employee?.username ?? '',
            employee?.employeeCode ?? '', employee?.employeeType ?? '', employee?.managerName ?? '',
            employee?.department ?? '', employee?.businessUnit ?? '', employee?.program ?? '',
            employee?.discipline ?? '', employee?.location ?? '',
            feature?.vendorName ?? '', feature?.productName ?? '', feature?.featureName ?? '',
            activity.assigned ? 'Yes' : 'No', activity.lastUsedDate ?? 'Never', idle ?? '',
            activity.totalSessions, activity.totalHours,
            activity.assigned ? (feature?.unitPrice ?? '') : '',
            isIdleSeat ? 'Reclaim candidate' : activity.assigned ? 'Keep' : 'Concurrent use',
          ];
        });

      return csvResponse(`engisignal-users-${stamp}.csv`, toCsv(headers, rows));
    }

    case 'reclaim': {
      const featureFilter = url.searchParams.get('feature');
      const employees = employeeIndex(workspace.dataset);
      const employeeContext = new Map(
        [...employees.entries()].map(([id, employee]) => [
          id,
          {
            fullName: employee.fullName,
            managerName: employee.managerName,
            department: employee.department,
            program: employee.program,
          },
        ]),
      );

      const candidates = workspace.portfolio
        .filter((row) => row.namedUser !== null && row.namedUser.reclaimCandidates > 0)
        .filter((row) => featureFilter === null || row.featureId === featureFilter)
        .flatMap((row) =>
          buildReclaimCandidates(workspace.dataset.activities, {
            organizationId: workspace.organization.id,
            featureId: row.featureId,
            featureName: row.featureName,
            productName: row.productName,
            vendorName: row.vendorName,
            unitPrice: row.unitPrice,
            asOf: workspace.dataset.asOf,
            reclaimThresholdDays: workspace.options.reclaimThresholdDays,
            employees: employeeContext,
          }),
        );

      const headers = [
        'Employee', 'Manager', 'Department', 'Program', 'Vendor', 'Product', 'Feature',
        'Last used', 'Days inactive', 'Annual cost', 'Recommendation', 'Owner', 'Status',
      ];
      const rows = candidates.map((candidate) => [
        candidate.employeeName, candidate.managerName ?? '', candidate.department ?? '',
        candidate.program ?? '', candidate.vendorName, candidate.productName, candidate.featureName,
        candidate.lastUsedDate ?? 'Never', candidate.daysInactive ?? '', candidate.annualCost ?? '',
        candidate.recommendation, candidate.owner ?? '', candidate.status,
      ]);

      return csvResponse(`engisignal-reclaim-${stamp}.csv`, toCsv(headers, rows));
    }

    case 'cost': {
      const dimension = (url.searchParams.get('dimension') ?? 'program') as DimensionKey;
      const method = (url.searchParams.get('method') ?? 'duration_weighted') as AllocationMethod;
      const spec = ALLOCATION_METHODS[method] ?? ALLOCATION_METHODS.duration_weighted;

      const allocation = allocateCost({
        method,
        dimension,
        features: workspace.portfolio.map((row) => ({
          featureId: row.featureId,
          licenseModel: row.licenseModel,
          annualCost: row.financial.currentAnnualCost,
          wasteAmount:
            row.licenseModel === 'concurrent' && row.unitPrice !== null && row.metrics !== null
              ? Math.max(0, row.entitled - row.metrics.p95) * row.unitPrice
              : (row.namedUser?.reclaimValue ?? 0),
        })),
        activities: workspace.dataset.activities,
        employees: workspace.dataset.employees,
      });

      const headers = [
        DIMENSION_LABELS[dimension] ?? 'Group', 'Allocated spend', 'Share %', 'Headcount',
        'Cost per engineer', 'Active users', 'Assigned seats', 'Usage hours', 'Potential waste',
        'Allocation method',
      ];
      const rows = allocation.rows.map((row) => [
        row.key, row.allocatedSpend, row.sharePct, row.headcount, row.costPerEngineer ?? '',
        row.activeUsers, row.assignedLicenses, row.usageHours, row.potentialWaste, spec.label,
      ]);

      return csvResponse(`engisignal-cost-${dimension}-${stamp}.csv`, toCsv(headers, rows));
    }

    case 'renewals': {
      const headers = [
        'Vendor', 'Agreement', 'Contract number', 'Renewal date', 'Days remaining', 'Stage',
        'Line items', 'Current annual spend', 'Recommended annual spend', 'Optimization opportunity',
        'Incremental spend', 'Capacity exposure', 'Demand trend %', 'Headcount impact %', 'Confidence',
      ];
      const rows = workspace.renewals.map((renewal) => [
        renewal.vendorName, renewal.agreementName ?? '', renewal.contractNumber, renewal.renewalDate,
        renewal.daysRemaining, renewal.stage, renewal.itemCount, renewal.currentAnnualSpend ?? '',
        renewal.recommendedAnnualSpend ?? '', renewal.optimizationOpportunity ?? '',
        renewal.incrementalSpend ?? '', renewal.capacityExposure, renewal.demandTrendPct ?? '',
        renewal.headcountImpactPct, renewal.confidence.level,
      ]);
      return csvResponse(`engisignal-renewals-${stamp}.csv`, toCsv(headers, rows));
    }

    default:
      return NextResponse.json({ error: 'Unknown export.' }, { status: 404 });
  }
}
