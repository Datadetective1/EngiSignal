/**
 * Tenant resolution for ingestion endpoints.
 *
 * One place, so every route resolves the organization the same way: from the
 * caller's own memberships. The client never supplies an organization id, which
 * removes the class of bug where a crafted form field addresses another tenant.
 */

import 'server-only';
import { getSession } from '@/lib/auth';
import { getDataProvider } from '@/lib/data';

export interface IngestionContext {
  userId: string;
  organizationId: string;
}

export type IngestionAuth =
  | { ok: true; context: IngestionContext }
  | { ok: false; status: 401 | 403; error: string };

export async function resolveIngestionContext(): Promise<IngestionAuth> {
  const session = await getSession();
  if (session === null) {
    return { ok: false, status: 401, error: 'Not authenticated.' };
  }

  const organizations = await getDataProvider().listOrganizations(session.userId);
  const organization = organizations[0];
  if (organization === undefined) {
    return { ok: false, status: 403, error: 'No organization is available for this account.' };
  }

  return { ok: true, context: { userId: session.userId, organizationId: organization.id } };
}
