/** An untrusted request hint. Only the original native relationship resolver grants access. */
export const isClientPortalBusinessId = (value: unknown): value is string =>
  typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value);

/** Scope one original SDK request; never change shared client headers or staff workspace state. */
export function withClientPortalBusiness<T extends {setHeader(name: string, value: string): T}>(
  request: T, businessId: string | null,
): T {
  if (businessId === null) return request;
  if (!isClientPortalBusinessId(businessId)) throw new Error("Customer business could not be checked");
  return request.setHeader("x-client-portal-business", businessId);
}

type ExistingPortalAuth = {
  getUser(jwt?: string): Promise<{data: {user: {id: string} | null}; error: unknown}>;
  getSession(): Promise<{data: {session: {user: {id: string}; access_token: string} | null}; error: unknown}>;
};

/** Capture the original SDK session for this intended actor, never another login's later token.
 * Ephemeral request input only: native Auth/CRM/RLS remains the authority. Never persist/log it.
 */
export async function captureClientPortalAuthorization(
  auth: ExistingPortalAuth, actorId: string, current: () => boolean,
): Promise<string> {
  const check=()=>{if(!current())throw new Error("Customer request changed");};
  check();
  const actual=await auth.getUser();
  check();
  if(actual.error||actual.data.user?.id!==actorId)throw new Error("Customer session changed");
  const saved=await auth.getSession();
  check();
  const session=saved.data.session;
  if(saved.error||session?.user.id!==actorId||!session.access_token)throw new Error("Customer session changed");
  // Session.user is cached presentation. Verify the exact captured bearer through original Auth.
  const verified=await auth.getUser(session.access_token);
  check();
  if(verified.error||verified.data.user?.id!==actorId)throw new Error("Customer session changed");
  return `Bearer ${session.access_token}`;
}
