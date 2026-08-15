/**
 * Source signatures.
 *
 * Each rule is a piece of evidence a human could also point at: a column only
 * one product uses, a worksheet name, a term that appears in the data. Rules
 * carry weights, and detection reports which ones fired so the customer can
 * judge the conclusion rather than trust it.
 *
 * `saturation` is the evidence weight at which we are confident. It is not the
 * sum of all rules — a real export never matches every rule — so reaching
 * saturation with two strong signals is enough.
 */

import type { SourceSystem } from '../canonical/types';

export interface DetectionContext {
  /** Original headers as written in the file. */
  headers: string[];
  /** Headers normalized for comparison. */
  normalizedHeaders: string[];
  sheetNames: string[];
  /** Lower-cased sample of cell values, for terminology evidence. */
  sampleValues: string[];
  fileName: string;
}

export interface DetectionRule {
  id: string;
  /** Shown to the customer as evidence when it fires. */
  evidence: string;
  weight: number;
  test(context: DetectionContext): boolean;
}

export interface SourceSignature {
  source: SourceSystem;
  name: string;
  saturation: number;
  rules: DetectionRule[];
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/** True when any normalized header exactly equals one of the names. */
function hasHeader(context: DetectionContext, ...names: string[]): boolean {
  return names.some((name) => context.normalizedHeaders.includes(name));
}

/** True when any normalized header contains the fragment. */
function headerContains(context: DetectionContext, ...fragments: string[]): boolean {
  return fragments.some((fragment) =>
    context.normalizedHeaders.some((header) => header.includes(fragment)),
  );
}

/** True when a term appears in sheet names, the file name, or sampled values. */
function mentions(context: DetectionContext, ...terms: string[]): boolean {
  const haystack = [
    ...context.sheetNames.map((name) => name.toLowerCase()),
    context.fileName.toLowerCase(),
    ...context.sampleValues,
  ];
  return terms.some((term) => haystack.some((text) => text.includes(term)));
}

// ── Signatures ───────────────────────────────────────────────────────────────

const flexnet: SourceSignature = {
  source: 'flexnet',
  name: 'FlexNet / FLEXlm',
  saturation: 100,
  rules: [
    {
      id: 'flexnet.vendor_daemon',
      evidence: 'Vendor daemon column detected, which is FlexNet-specific terminology',
      weight: 55,
      test: (c) => hasHeader(c, 'vendor_daemon', 'vendordaemon', 'daemon'),
    },
    {
      id: 'flexnet.product_names',
      evidence: 'FLEXlm / FlexNet / lmgrd naming found in the file',
      weight: 55,
      test: (c) => mentions(c, 'flexlm', 'flexnet', 'lmgrd', 'lmstat', 'lmutil'),
    },
    {
      id: 'flexnet.feature',
      evidence: 'FEATURE column detected',
      weight: 20,
      test: (c) => hasHeader(c, 'feature', 'feature_name'),
    },
    {
      id: 'flexnet.user_host_display',
      evidence: 'USER, HOST and DISPLAY fields detected, the FlexNet checkout triple',
      weight: 35,
      test: (c) =>
        headerContains(c, 'user') && headerContains(c, 'host') && headerContains(c, 'display'),
    },
    {
      id: 'flexnet.checkout_terminology',
      evidence: 'Checkout / check-in terminology detected',
      weight: 20,
      test: (c) => headerContains(c, 'checkout', 'check_out', 'checkin', 'check_in'),
    },
    {
      id: 'flexnet.issued_in_use',
      evidence: 'Licenses issued and in-use counters detected',
      weight: 20,
      test: (c) =>
        headerContains(c, 'issued', 'licenses_issued') && headerContains(c, 'in_use', 'inuse'),
    },
  ],
};

const rlm: SourceSignature = {
  source: 'rlm',
  name: 'Reprise License Manager',
  saturation: 100,
  rules: [
    {
      id: 'rlm.isv',
      evidence: 'ISV column detected, which RLM uses for the vendor daemon',
      weight: 55,
      test: (c) => hasHeader(c, 'isv', 'isv_name', 'rlm_isv'),
    },
    {
      id: 'rlm.product_names',
      evidence: 'RLM / Reprise naming found in the file',
      weight: 55,
      test: (c) => mentions(c, 'reprise', 'rlm '),
    },
    {
      id: 'rlm.prefixed_headers',
      evidence: 'RLM-prefixed columns detected',
      weight: 45,
      test: (c) => headerContains(c, 'rlm_'),
    },
    {
      id: 'rlm.product_count',
      evidence: 'RLM product and count columns detected',
      weight: 25,
      test: (c) => hasHeader(c, 'product') && headerContains(c, 'count'),
    },
    {
      id: 'rlm.pool',
      evidence: 'License pool column detected',
      weight: 15,
      test: (c) => headerContains(c, 'pool'),
    },
    {
      id: 'rlm.handle',
      evidence: 'Checkout handle column detected',
      weight: 15,
      test: (c) => hasHeader(c, 'handle', 'checkout_handle'),
    },
  ],
};

const dsls: SourceSignature = {
  source: 'dsls',
  name: 'Dassault Systèmes DSLS',
  saturation: 100,
  rules: [
    {
      id: 'dsls.product_names',
      evidence: 'DSLS / DS License Server naming found in the file',
      weight: 60,
      test: (c) => mentions(c, 'dsls', 'ds license', 'dassault', '3dexperience'),
    },
    {
      id: 'dsls.header_prefix',
      evidence: 'DSLS-prefixed columns detected',
      weight: 50,
      test: (c) => headerContains(c, 'dsls'),
    },
    {
      id: 'dsls.tokens',
      evidence: 'Token consumption column detected, used by DS token licensing',
      weight: 35,
      test: (c) => headerContains(c, 'token'),
    },
    {
      id: 'dsls.license_name_max',
      evidence: 'License name with max/in-use counters detected, the DSLS export shape',
      weight: 35,
      test: (c) =>
        hasHeader(c, 'license_name', 'license_id') &&
        headerContains(c, 'max_count', 'in_use', 'max'),
    },
    {
      id: 'dsls.product_line',
      evidence: 'Product line column detected',
      weight: 25,
      test: (c) => hasHeader(c, 'product_line'),
    },
    {
      id: 'dsls.server_id',
      evidence: 'Server ID column detected',
      weight: 15,
      test: (c) => hasHeader(c, 'server_id'),
    },
  ],
};

const sentinel: SourceSignature = {
  source: 'sentinel',
  name: 'Sentinel RMS',
  saturation: 100,
  rules: [
    {
      id: 'sentinel.product_names',
      evidence: 'Sentinel / RMS naming found in the file',
      weight: 60,
      test: (c) => mentions(c, 'sentinel', 'lservrc', 'rms report', 'lserv'),
    },
    {
      id: 'sentinel.header_prefix',
      evidence: 'Sentinel-prefixed columns detected',
      weight: 50,
      test: (c) => headerContains(c, 'sentinel', 'lserv'),
    },
    {
      id: 'sentinel.sublicense',
      evidence: 'Sublicense column detected, which is Sentinel-specific',
      weight: 45,
      test: (c) => headerContains(c, 'sublicense', 'sub_license'),
    },
    {
      id: 'sentinel.client_user',
      evidence: 'Client user / client host columns detected',
      weight: 30,
      test: (c) => headerContains(c, 'client_user', 'client_host', 'client_username'),
    },
    {
      id: 'sentinel.feature_version',
      evidence: 'Feature with version key detected, how Sentinel identifies a license',
      weight: 25,
      test: (c) => headerContains(c, 'feature') && headerContains(c, 'version'),
    },
    {
      id: 'sentinel.snapshot',
      evidence: 'Interval snapshot / poll time column detected',
      weight: 25,
      test: (c) => headerContains(c, 'sample_time', 'poll_time', 'snapshot'),
    },
  ],
};

export const SIGNATURES: SourceSignature[] = [flexnet, rlm, dsls, sentinel];
