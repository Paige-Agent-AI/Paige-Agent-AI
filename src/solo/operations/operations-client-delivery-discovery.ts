import type { DeliverySourceCaller, DeliverySourceScope } from './operations-delivery-source';

export type ClientReleasedDelivery = {
  release_id: string;
  submission_id: string;
  state: 'awaiting_client' | 'client_revision_requested' | 'accepted';
  revision_no: number;
  artifact_digest: string;
  title: string;
  updated_at: string;
};
export type ClientReleasedDeliveries =
  | { kind: 'ready'; releases: ClientReleasedDelivery[]; unavailableCount: number; hasMore: boolean }
  | { kind: 'unavailable' | 'refused' | 'scope_changed' };

const uuid = (v: unknown): v is string => typeof v === 'string'
  && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(v);
const object = (v: unknown): Record<string, unknown> | null =>
  v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : null;

/** Existing client identity supplies scope; metadata never grants artifact or task authority. */
export async function readClientReleasedDeliveries(
  caller: DeliverySourceCaller, scope: DeliverySourceScope, current: () => boolean,
): Promise<ClientReleasedDeliveries> {
  if (!current()) return { kind: 'scope_changed' };
  if (!uuid(scope.actorId) || !uuid(scope.tenantId)) return { kind: 'unavailable' };
  try {
    // getTenant is the existing legitimate client-portal context, not an inferred
    // employee workspace or View-as identity. The server remains the authority.
    if (await caller.getActor() !== scope.actorId || await caller.getTenant() !== scope.tenantId) return { kind: 'refused' };
    if (!current()) return { kind: 'scope_changed' };
    const reply = await caller.rpc('operations_delivery_client_reviews_scoped', {
      p_expected_actor_id: scope.actorId, p_expected_tenant_id: scope.tenantId, p_limit: 40,
    });
    if (!current()) return { kind: 'scope_changed' };
    if (reply.error) return { kind: 'unavailable' };
    const envelope = object(reply.data);
    if (!envelope || envelope.actor_id !== scope.actorId || envelope.tenant_id !== scope.tenantId
      || !Array.isArray(envelope.releases) || typeof envelope.has_more !== 'boolean'
      || !Number.isSafeInteger(envelope.unavailable_count) || Number(envelope.unavailable_count) < 0
      || envelope.releases.length + Number(envelope.unavailable_count) > 40) return { kind: 'unavailable' };
    const releases: ClientReleasedDelivery[] = [];
    const releaseIds = new Set<string>(), submissionIds = new Set<string>();
    for (const value of envelope.releases) {
      const row = object(value);
      if (!row || !uuid(row.release_id) || !uuid(row.submission_id)
        || releaseIds.has(row.release_id) || submissionIds.has(row.submission_id)
        || typeof row.state !== 'string' || !['awaiting_client', 'client_revision_requested', 'accepted'].includes(row.state)
        || !Number.isSafeInteger(row.revision_no) || Number(row.revision_no) < 1
        || typeof row.artifact_digest !== 'string' || !/^[a-f0-9]{64}$/.test(row.artifact_digest)
        || typeof row.title !== 'string' || !row.title.trim() || row.title.length > 500
        || typeof row.updated_at !== 'string' || row.updated_at.length > 80
        || !Number.isFinite(Date.parse(row.updated_at))) return { kind: 'unavailable' };
      releaseIds.add(row.release_id); submissionIds.add(row.submission_id);
      releases.push({ release_id: row.release_id, submission_id: row.submission_id,
        state: row.state as ClientReleasedDelivery['state'], revision_no: Number(row.revision_no),
        artifact_digest: row.artifact_digest, title: row.title, updated_at: row.updated_at });
    }
    if (await caller.getActor() !== scope.actorId || await caller.getTenant() !== scope.tenantId) return { kind: 'refused' };
    return current() ? { kind: 'ready', releases, unavailableCount: Number(envelope.unavailable_count), hasMore: envelope.has_more }
      : { kind: 'scope_changed' };
  } catch {
    return { kind: current() ? 'unavailable' : 'scope_changed' };
  }
}
