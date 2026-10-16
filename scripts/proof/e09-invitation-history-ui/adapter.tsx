import { useTenantRelationshipsData as basePeople } from "../e09-dashboard-ui/adapter";
export * from "../e09-dashboard-ui/adapter";
// Explicit neutral SDK transport; all browser network and all writes are refused.
const options = (window as unknown as { portalProof: { tenant: string; state: string } }).portalProof;
const actor = "e0911000-0000-0000-0000-000000000001";
const contact = "e0931000-0000-0000-0000-000000000001";
const at = "2026-10-15T12:00:00Z", calls: string[] = [];
const boundedHistory = Array.from({ length: 50 }, (_, i) => ({
  id: "e0951000-0000-0000-0000-" + String(i + 1).padStart(12, "0"),
  status: i === 0 ? "sent" : i === 49 ? "failed" : "delivery_delayed",
  at: new Date(Date.parse(at) + i * 1000).toISOString(),
  outcome: i === 0 ? "accepted" : i === 49 ? "unknown" : "delayed",
}));
export const useTenantContext = () => ({ activeTenantId: options.tenant, activeUserId: actor, activeTenant: { id: options.tenant, name: "Test Service Studio", account_type: "standalone", parent_tenant_id: null }, accountContextStatus: "ready", accountContextLoading: false });
export const useTenantRelationshipsData = () => {
  const data = basePeople();
  return { ...data, people: data.people.map((person, index) => ({ ...person, id: index === 0 ? contact : "e0931000-0000-0000-0000-00000000000" + (index + 1) })) };
};
const row = (n: number) => ({ id: "e0941000-0000-0000-0000-00000000000" + n, contact_id: contact, email: n === 1 ? "long.recipient.for.responsive.verification@example.test" : "client0@example.test",
  created_at: at, expires_at: "2099-10-30T12:00:00Z", last_used_at: n === 2 ? at : null, revoked_at: null,
  delivery: { history: n === 1 ? boundedHistory :
    [{ id: "e0951000-0000-0000-0000-000000000003", status: "delivered", at, outcome: "delivered" }], truncated: n === 1 } });
export const supabase = {
  auth: { getUser: async () => ({ data: { user: { id: actor } }, error: null }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }) },
  rpc: (name: string, args?: Record<string, unknown>) => {
    calls.push(name);
    if (name === "can_manage_tenant_brand") return Promise.resolve({ data: true, error: null });
    if (name !== "client_portal_owner_invitations" || args?.p_expected_actor_id !== actor || args.p_expected_tenant_id !== options.tenant) throw new Error("Unexpected or foreign fixture operation");
    return { abortSignal: async () => ({ data: { actor_id: actor, tenant_id: options.tenant, invitations: [row(1), row(2)] },
      error: options.state === "history-error" ? { code: "42501", message: "Synthetic refusal" } : null }) };
  },
  from: () => { throw new Error("Raw fixture table access refused"); }, functions: { invoke: () => { throw new Error("Provider fixture operation refused"); } },
};
(window as unknown as { invitationProof: () => unknown }).invitationProof = () => ({ calls: [...calls], actualAuth: false, synthetic: true });
