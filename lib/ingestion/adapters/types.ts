/**
 * The adapter contract.
 *
 * An adapter is declarative: it describes what its source calls things and what
 * its source is capable of recording. The normalization pipeline does the work,
 * so adding a sixth license manager means adding a table of aliases — not a
 * second copy of the parsing, validation and provenance logic.
 */

import type { CanonicalDataset, LicenseModel, SourceSystem } from '../canonical/types';

/** Canonical fields an adapter can map a source column onto. */
export type UsageField =
  | 'date'
  | 'hour'
  | 'observedAt'
  | 'user'
  | 'employeeCode'
  | 'feature'
  | 'product'
  | 'vendor'
  | 'quantity'
  | 'concurrent'
  | 'peak'
  | 'available'
  | 'durationHours'
  | 'checkoutAt'
  | 'checkinAt'
  | 'denied'
  | 'denialCount'
  | 'licenseServer'
  | 'pool'
  | 'tokens'
  | 'hostname'
  | 'version'
  | 'borrowed';

export type EntitlementField =
  | 'feature'
  | 'product'
  | 'vendor'
  | 'entitledQuantity'
  | 'licenseModel'
  | 'licenseServer'
  | 'pool'
  | 'expiresOn';

export type PeopleField =
  | 'user'
  | 'employeeCode'
  | 'displayName'
  | 'email'
  | 'employmentStatus'
  | 'employmentType'
  | 'managerName'
  | 'managerKey'
  | 'department'
  | 'organization'
  | 'businessUnit'
  | 'program'
  | 'discipline'
  | 'competency'
  | 'location'
  | 'region'
  | 'costCenter';

export type ContractField =
  | 'feature'
  | 'product'
  | 'vendor'
  | 'sku'
  | 'contractNumber'
  | 'agreementNumber'
  | 'purchaseOrder'
  | 'supplier'
  | 'quantity'
  | 'unitPrice'
  | 'totalCost'
  | 'annualCost'
  | 'currency'
  | 'licenseModel'
  | 'pricingUnit'
  | 'contractStartDate'
  | 'contractEndDate'
  | 'renewalDate'
  | 'businessUnit'
  | 'costCenter'
  | 'owner'
  | 'notes';

export type CanonicalFieldKey = UsageField | EntitlementField | PeopleField | ContractField;

export type FieldValueType = 'string' | 'number' | 'date' | 'datetime' | 'hour' | 'boolean';

export interface FieldSpec {
  key: CanonicalFieldKey;
  label: string;
  type: FieldValueType;
  required: boolean;
  description: string;
}

/**
 * What a source can record at all.
 *
 * Drives the quality report. A false here means "this source cannot provide
 * it", which is a different statement from "this file happened not to have it",
 * and customers are told which one they are looking at.
 */
export interface SourceCapabilities {
  /** Finest granularity the source records. */
  resolution: 'event' | 'interval' | 'daily' | 'unknown';
  checkoutCheckin: boolean;
  denials: boolean;
  tokens: boolean;
  concurrency: boolean;
  entitlements: boolean;
  /** Free-text constraint an implementer or customer must know. */
  notes: string[];
}

/** Aliases per canonical field. Matching is fuzzy; these are the anchors. */
export type AliasTable = Partial<Record<CanonicalFieldKey, string[]>>;

export interface IngestionAdapter {
  source: SourceSystem;
  name: string;
  /** How the customer obtains this file, in their own vocabulary. */
  exportDescription: string;
  supports: CanonicalDataset[];
  capabilities: SourceCapabilities;
  /**
   * Aliases used in addition to the shared base table.
   *
   * Partial by dataset: a license manager has no commercial vocabulary of its
   * own — a FlexNet report log is not a purchase order — so those adapters
   * declare nothing for `contracts` and the shared base table does the work.
   * Omission is the honest way to say "this source has no opinion here".
   */
  aliases: Partial<Record<CanonicalDataset, AliasTable>>;
  /**
   * Source-specific value interpretation, applied before generic coercion.
   * Returning undefined defers to the generic parser.
   */
  coerce?: {
    licenseModel?(raw: string): LicenseModel | undefined;
    denied?(raw: string): boolean | undefined;
  };
}
