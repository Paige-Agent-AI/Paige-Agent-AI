import { readClientReleasedDeliveries, type ClientReleasedDelivery } from '@/solo/operations/operations-client-delivery-discovery';

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
