// agreement-document DOOR THREE — the business's CUSTOMER, signed in to their portal (E09 Slice A).
//
// Doors one and two serve the two parties ESIGN names: the signer by token, the business by its own
// admin session. A customer who has joined the business's portal is the signer AS a portal login,
// and fails door two by construction (no tenant_members row, so no current workspace). This door
// lets that login fetch their OWN completed, sealed copy with the session they already hold.
//
// WHAT DECIDES ACCESS. Not this file. `public.client_portal_agreement_document_scope`, called with
// the CALLER'S client, re-proves the caller's one customer relationship and that the agreement is
// theirs, completed and sealed, and answers with only {agreement_id, tenant_id, title}. The service
// read below then fetches the storage key for exactly that (id, tenant, completed) triple. Nothing
// the request carries can name a different agreement or business: a tenantId query parameter can
// only NARROW the relationship, and an answer that does not match the request is refused.
//
// Pure by construction (both clients are injected), so it is driven under Deno's deny-all sandbox.

type RpcResult = { data: unknown; error: unknown };
export type PortalCallerClient = {
  auth: { getUser(): Promise<{ data: { user: { id: string } | null } | null; error: unknown }> };
  rpc(name: string, args: Record<string, unknown>): PromiseLike<RpcResult>;
};
export type PortalServiceClient = {
  from(table: string): {
    select(columns: string): {
      eq(column: string, value: unknown): {
        eq(column: string, value: unknown): {
          eq(column: string, value: unknown): { maybeSingle(): PromiseLike<RpcResult> };
        };
      };
    };
  };
};

export type PortalDoorResult = { sealedKey: string; title: string; disposition: "inline" | "attachment" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SCOPE_KEYS = ["agreement_id", "tenant_id", "title"];

/** Is this request addressed to door three? Checked BEFORE door two, which matches the same params. */
export function isPortalDoorRequest(params: URLSearchParams): boolean {
  return params.get("portal") === "1";
}

/**
 * Resolve the customer's sealed copy, or null for every refusal — the caller turns null into the
 * one shared refusal, so a stranger learns nothing about which agreements exist.
 */
export async function resolvePortalDocument(
  params: URLSearchParams,
  authHeader: string,
  caller: PortalCallerClient,
  service: PortalServiceClient,
): Promise<PortalDoorResult | null> {
  const agreementId = (params.get("agreementId") ?? "").trim();
  const tenantParam = (params.get("tenantId") ?? "").trim();
  if (!authHeader || !UUID.test(agreementId) || (tenantParam && !UUID.test(tenantParam))) return null;

  const first = await caller.auth.getUser();
  const userId = first?.data?.user?.id;
  if (first?.error || !userId) return null;

  const scope = await caller.rpc("client_portal_agreement_document_scope", {
    p_agreement_id: agreementId,
    p_tenant_id: tenantParam || null,
  });
  if (scope.error || !scope.data || typeof scope.data !== "object" || Array.isArray(scope.data)) return null;
  const row = scope.data as Record<string, unknown>;
  const keys = Object.keys(row).sort();
  if (keys.length !== SCOPE_KEYS.length || keys.some((k, i) => k !== SCOPE_KEYS[i])) return null;
  if (row.agreement_id !== agreementId || typeof row.tenant_id !== "string" || !UUID.test(row.tenant_id)) return null;
  if (tenantParam && row.tenant_id !== tenantParam) return null;

  // The session must still be the same person after the scope read. A token swapped or revoked
  // between the two calls answers for nobody.
  const second = await caller.auth.getUser();
  if (second?.error || second?.data?.user?.id !== userId) return null;

  const { data: agreement, error } = await service.from("paige_agreements")
    .select("id,title,status,sealed_storage_key")
    .eq("id", agreementId).eq("tenant_id", row.tenant_id).eq("status", "completed").maybeSingle();
  if (error || !agreement || typeof agreement !== "object") return null;
  const a = agreement as Record<string, unknown>;
  if (a.id !== agreementId || a.status !== "completed" || typeof a.sealed_storage_key !== "string" || !a.sealed_storage_key) {
    return null;
  }

  return {
    sealedKey: a.sealed_storage_key,
    title: String(a.title ?? ""),
    disposition: params.get("download") === "1" ? "attachment" : "inline",
  };
}
