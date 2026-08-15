import 'server-only';
import { cache } from 'react';
import { buildWindow } from '@/lib/analytics/dates';
import { generateDemoDataset } from '@/lib/synthetic/generate';

/**
 * Showcase data for the public landing page.
 *
 * The live calculator on the marketing site runs on REAL generated demand — the
 * same daily-peak series the product analyses — rather than invented constants.
 * That is why the marketing claim and the product agree exactly.
 */
export const getShowcaseData = cache(() => {
  const dataset = generateDemoDataset();
  const window = buildWindow(dataset.asOf, '12m');

  const feature = dataset.features.find((f) => f.code === 'MECH_ENT');
  const item = dataset.contractItems.find((i) => i.featureId === feature?.id);
  const product = dataset.products.find((p) => p.id === feature?.productId);
  const vendor = dataset.vendors.find((v) => v.id === product?.vendorId);

  const dailyPeaks = dataset.dailyUsage
    .filter((row) => row.featureId === feature?.id && row.date >= window.start && row.date <= window.end)
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((row) => row.peak);

  return {
    dailyPeaks,
    entitled: item?.quantity ?? 400,
    unitPrice: item?.unitPrice ?? 5000,
    productLabel: `${vendor?.name ?? 'Ansys'} ${product?.name ?? 'Mechanical'} — ${feature?.name ?? 'Mechanical Enterprise'}`,
  };
});
