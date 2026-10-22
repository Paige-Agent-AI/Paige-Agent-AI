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
