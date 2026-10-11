import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useOperationsEngagementEvidence } from "./useOperationsEngagementEvidence";
const ports = vi.hoisted(() => ({ actor: "actor-a", rpc: vi.fn(), getUser: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: ports.rpc, auth: { getUser: ports.getUser } } }));
let root: Root | null = null; let host: HTMLDivElement | null = null;
let current: ReturnType<typeof useOperationsEngagementEvidence>;
function Probe({ actor, tenant, agreement }: { actor: string | null; tenant: string | null; agreement: string | null }) {
  current = useOperationsEngagementEvidence(actor, tenant, agreement);
  return <p>{current.evidence?.agreementId}</p>;
}
const payload = (agreement = "agreement-a", tenant = "tenant-a") => ({ ok: true, actor_id: "actor-a", tenant_id: tenant,
  evidence: { agreement_id: agreement, tenant_id: tenant, contact_id: "client-a", commercial_terms_id: "terms-a",
    offer_id: null, version: 3, status: "completed", completed_at: "2026-10-09T12:00:00Z",
    content_sha256: "a".repeat(64), sealed_sha256: "b".repeat(64), sealed_copy_recorded: true,
    handoff_authorized: false, client_accepted: false } });
async function render(actor: string | null = "actor-a", tenant: string | null = "tenant-a", agreement: string | null = "agreement-a") {
  if (!host) { host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host); }
  await act(async () => { root!.render(<Probe actor={actor} tenant={tenant} agreement={agreement}/>); });
}
beforeEach(() => { ports.actor = "actor-a"; ports.getUser.mockImplementation(async () => ({ data: { user: { id: ports.actor } }, error: null })); });
afterEach(async () => { if (root) await act(async () => root!.unmount()); host?.remove(); root = null; host = null; vi.resetAllMocks(); });
describe("engagement evidence request fencing", () => {
  it("reads only the selected server agreement with the expected actor and workspace", async () => {
    ports.rpc.mockResolvedValue({ data: payload(), error: null }); await render();
    expect(ports.rpc).toHaveBeenCalledWith("operations_engagement_evidence_read", {
      p_expected_actor_id: "actor-a", p_expected_tenant_id: "tenant-a", p_agreement_id: "agreement-a" });
    expect(current.evidence?.version).toBe(3); expect(current.error).toBeNull();
  });
  it("refuses an authenticated actor mismatch before reading", async () => {
    ports.actor = "other"; await render(); expect(ports.rpc).not.toHaveBeenCalled();
    expect(current.forbidden).toBe(true); expect(current.evidence).toBeNull();
  });
  it("masks prior evidence on missing selection without reading", async () => {
    ports.rpc.mockResolvedValue({ data: payload(), error: null }); await render();
    await render("actor-a", "tenant-a", null); expect(current.evidence).toBeNull(); expect(current.loading).toBe(false);
    expect(ports.rpc).toHaveBeenCalledTimes(1);
  });
  it("ignores a late response from the previous selected agreement", async () => {
    let resolveA!: (value: unknown) => void;
    ports.rpc.mockImplementation((_name: string, args: Record<string, unknown>) => args.p_agreement_id === "agreement-a"
      ? new Promise(resolve => { resolveA = resolve; }) : Promise.resolve({ data: payload("agreement-b"), error: null }));
    await render(); await render("actor-a", "tenant-a", "agreement-b");
    await act(async () => resolveA({ data: payload(), error: null }));
    expect(current.evidence?.agreementId).toBe("agreement-b");
  });
  it("does not treat a refused refresh as an empty successful source", async () => {
    ports.rpc.mockResolvedValueOnce({ data: payload(), error: null }); await render();
    ports.rpc.mockResolvedValueOnce({ data: null, error: { code: "42501", message: "private details" } });
    await act(async () => { await current.refresh(); });
    expect(current.evidence).toBeNull(); expect(current.forbidden).toBe(true);
    expect(current.error).not.toContain("private details");
  });
  it("ignores original workspace evidence after switching tenants", async () => {
    let resolveA!: (value: unknown) => void;
    ports.rpc.mockImplementation((_name: string, args: Record<string, unknown>) => args.p_expected_tenant_id === "tenant-a"
      ? new Promise(resolve => { resolveA = resolve; }) : Promise.resolve({ data: payload("agreement-b", "tenant-b"), error: null }));
    await render(); await render("actor-a", "tenant-b", "agreement-b");
    await act(async () => resolveA({ data: payload(), error: null }));
    expect(current.evidence?.tenantId).toBe("tenant-b"); expect(current.evidence?.agreementId).toBe("agreement-b");
  });
  it("refuses an identity change during the read", async () => {
    ports.rpc.mockImplementation(async () => { ports.actor = "other"; return { data: payload(), error: null }; });
    await render(); expect(current.evidence).toBeNull(); expect(current.forbidden).toBe(true);
  });
  it("rejects a foreign source bundle and offers honest recovery", async () => {
    ports.rpc.mockResolvedValue({ data: payload("agreement-a", "foreign"), error: null }); await render();
    expect(current.evidence).toBeNull(); expect(current.error).toBeTruthy(); expect(current.forbidden).toBe(false);
  });
});
