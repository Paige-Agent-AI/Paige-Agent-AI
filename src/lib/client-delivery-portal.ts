import { readClientReleasedDeliveries, type ClientReleasedDelivery } from '@/solo/operations/operations-client-delivery-discovery';
import { readClientDeliveryArtifact } from '@/lib/operations-client-review';

type Reply = { data: unknown; error: unknown };
type ClientLimit = { limit: (count: 2) => PromiseLike<Reply> };
type ClientFilter = { is: (column: 'merged_into_contact_id', value: null) => ClientLimit };
type ClientEqual = { eq: (column: 'linked_user_id', actorId: string) => ClientFilter };
export type ClientDeliveryPortalPort = {
  auth: { getUser: () => PromiseLike<{ data: { user: { id: string } | null }; error: unknown }> };
  from: (table: 'clients') => { select: (columns: 'id,tenant_id') => ClientEqual };
  rpc: (name: string, args: Record<string, unknown>) => PromiseLike<Reply>;
};
export type LinkedPortalClient = Readonly<{ actorId: string; clientId: string; tenantId: string }>;
type LinkFailure = { kind: 'unlinked' | 'ambiguous' | 'refused' | 'unavailable' | 'scope_changed' };
export type PortalLinkRead = { kind: 'ready'; scope: LinkedPortalClient } | LinkFailure;
export type PortalReleasedWork = {
  kind: 'ready'; scope: LinkedPortalClient; releases: ClientReleasedDelivery[];
  unavailableCount: number; hasMore: boolean;
} | LinkFailure;

export type PortalReviewReference = Readonly<{ scope: LinkedPortalClient; release: ClientReleasedDelivery }>;
export type PortalReviewAccess = { kind: 'ready' } | LinkFailure
  | { kind: 'refused'; invalidated: true };

/** Existing exact reader proves visibility only; no body, receipt, close permission or mutation. */
export async function checkPortalReviewAccess(
  caller: ClientDeliveryPortalPort, reference: PortalReviewReference, current: () => boolean,
): Promise<PortalReviewAccess> {
  if (!current()) return { kind: 'scope_changed' };
  const { scope, release } = reference;
  const sameLink = (fresh: LinkedPortalClient) => fresh.actorId === scope.actorId
    && fresh.clientId === scope.clientId && fresh.tenantId === scope.tenantId;
  let actorChanged = false;
  // Observe the same existing auth reads, without a second session lookup/store.
  // An SDK error is uncertain; a successful different/missing user is actual loss.
  const observedCaller: ClientDeliveryPortalPort = {
    auth: { getUser: async () => {
      const result = await caller.auth.getUser();
      if (!result.error && result.data?.user?.id !== scope.actorId) actorChanged = true;
      return result;
    } },
    from: table => caller.from(table), rpc: (name, args) => caller.rpc(name, args),
  };
  try {
    const before = await readLinkedPortalClient(observedCaller, scope.actorId, current);
    if (!current()) return { kind: 'scope_changed' };
    if (before.kind !== 'ready') return actorChanged ? { kind: 'refused', invalidated: true } : before;
    if (!sameLink(before.scope)) return { kind: 'refused', invalidated: true };
    const reply = await caller.rpc('operations_delivery_client_read_scoped', {
      p_release_id: release.release_id, p_expected_actor_id: scope.actorId,
      p_expected_tenant_id: scope.tenantId,
    });
    if (!current()) return { kind: 'scope_changed' };
    const after = await readLinkedPortalClient(observedCaller, scope.actorId, current);
    if (!current()) return { kind: 'scope_changed' };
    if (after.kind !== 'ready') return actorChanged ? { kind: 'refused', invalidated: true } : after;
    if (!sameLink(after.scope)) return { kind: 'refused', invalidated: true };
    if (reply.error) {
      const code = object(reply.error)?.code;
      return typeof code === 'string' && ['42501', '40001', '22023'].includes(code)
        ? { kind: 'refused', invalidated: true } : { kind: 'unavailable' };
    }
    const artifact = readClientDeliveryArtifact(reply.data, {
      actorId: scope.actorId, tenantId: scope.tenantId, releaseId: release.release_id,
    });
    if (!artifact) return { kind: 'unavailable' };
    if (artifact.submissionId !== release.submission_id || artifact.revisionNo !== release.revision_no
      || artifact.artifactDigest !== release.artifact_digest || artifact.title !== release.title) return { kind: 'refused', invalidated: true };
    // A canonical terminal decision may change updatedAt. It is still only access
    // evidence here; the unchanged Operations component reconciles its own attempt.
    return { kind: 'ready' };
  } catch {
    return { kind: current() ? 'unavailable' : 'scope_changed' };
  }
}

const uuid = (value: unknown): value is string => typeof value === 'string'
  && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value);
const object = (value: unknown): Record<string, unknown> | null => value && typeof value === 'object'
  && !Array.isArray(value) ? value as Record<string, unknown> : null;

/** Existing caller-JWT self-link; no email claim, first-row choice or permission inference. */
export async function readLinkedPortalClient(
  caller: ClientDeliveryPortalPort, actorId: string, current: () => boolean,
): Promise<PortalLinkRead> {
  if (!current()) return { kind: 'scope_changed' };
  if (!uuid(actorId)) return { kind: 'unavailable' };
  try {
    const before = await caller.auth.getUser();
    if (!current()) return { kind: 'scope_changed' };
    if (before.error || before.data?.user?.id !== actorId) return { kind: 'refused' };
    const reply = await caller.from('clients').select('id,tenant_id')
      .eq('linked_user_id', actorId).is('merged_into_contact_id', null).limit(2);
    if (!current()) return { kind: 'scope_changed' };
    if (reply.error || !Array.isArray(reply.data)) return { kind: 'unavailable' };
    const after = await caller.auth.getUser();
    if (!current()) return { kind: 'scope_changed' };
    if (after.error || after.data?.user?.id !== actorId) return { kind: 'refused' };
    if (!reply.data.length) return { kind: 'unlinked' };
    if (reply.data.length !== 1) return { kind: 'ambiguous' };
    const row = object(reply.data[0]);
    if (!row || !uuid(row.id) || !uuid(row.tenant_id)) return { kind: 'unavailable' };
    return { kind: 'ready', scope: Object.freeze({ actorId, clientId: row.id, tenantId: row.tenant_id }) };
  } catch {
    return { kind: current() ? 'unavailable' : 'scope_changed' };
  }
}

/** Reuse Operations' strict metadata projection; its server predicates remain authority. */
export async function readPortalReleasedWork(
  caller: ClientDeliveryPortalPort, actorId: string, current: () => boolean,
): Promise<PortalReleasedWork> {
  const linked = await readLinkedPortalClient(caller, actorId, current);
  if (!current()) return { kind: 'scope_changed' };
  if (linked.kind !== 'ready') return linked;
  const scope = linked.scope;
  const result = await readClientReleasedDeliveries({
    getActor: async () => {
      const user = await caller.auth.getUser();
      return current() && !user.error ? user.data?.user?.id ?? null : null;
    },
    getTenant: async () => {
      const fresh = await readLinkedPortalClient(caller, actorId, current);
      return fresh.kind === 'ready' && fresh.scope.clientId === scope.clientId
        && fresh.scope.tenantId === scope.tenantId ? scope.tenantId : null;
    },
    rpc: (name, args) => {
      if (!current() || name !== 'operations_delivery_client_reviews_scoped'
        || args.p_expected_actor_id !== scope.actorId || args.p_expected_tenant_id !== scope.tenantId
        || args.p_limit !== 40) return Promise.resolve({ data: null, error: { code: 'PORTAL_SCOPE_REFUSED' } });
      return caller.rpc(name, args);
    },
  }, { actorId: scope.actorId, tenantId: scope.tenantId }, current);
  if (!current()) return { kind: 'scope_changed' };
  return result.kind === 'ready' ? { ...result, scope } : result;
}
