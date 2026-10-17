/** Consume the existing auth-subject-bound CRM projection on the caller's JWT.
 * This is a turn binding, not a tenant selector, staff grant or tool authority.
 */
export type ClientPortalChatBinding = Readonly<{
  actorId: string;
  clientId: string;
  tenantId: string;
}>;

type Caller = {
  rpc(name: string): PromiseLike<{ data: unknown; error: unknown }>;
};

const uuid = (value: unknown): value is string => typeof value === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

/** Structural decoder for the native caller-bound self/frame projections only.
 * Request-body profile data is never an authority source.
 */
export function clientPortalBindingFromProfile(data:unknown,actorId:string):ClientPortalChatBinding|null{
  if(!uuid(actorId)||!data||typeof data!=="object"||Array.isArray(data))return null;
  const row=data as Record<string,unknown>;
  if(!uuid(row.id)||!uuid(row.tenant_id)||row.linked_user_id!==actorId)return null;
  return {actorId,clientId:row.id,tenantId:row.tenant_id};
}

export async function readClientPortalChatBinding(
  caller: Caller,
  actorId: string,
): Promise<ClientPortalChatBinding | null> {
  if (!uuid(actorId)) return null;
  try {
    // Deliberately no tenant/body/email argument. The native function refuses
    // ambiguous relationships and excludes inactive/merged clients or tenants.
    const { data, error } = await caller.rpc("client_portal_self_profile");
    return error ? null : clientPortalBindingFromProfile(data,actorId);
  } catch {
    return null;
  }
}

export function sameClientPortalChatBinding(
  captured: ClientPortalChatBinding | null,
  current: ClientPortalChatBinding | null,
): boolean {
  return !!captured && !!current && captured.actorId === current.actorId &&
    captured.clientId === current.clientId && captured.tenantId === current.tenantId;
}
