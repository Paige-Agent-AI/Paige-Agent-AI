import { beforeEach, describe, expect, it, vi } from "vitest";
const port = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: port.rpc } }));
const { loadStudioBusinessTargets } = await import("./studio-data");
const TENANT = "11111111-1111-4111-8111-111111111111", ID = "22222222-2222-4222-8222-222222222222";
const stamp = "2026-11-13T10:20:30.123456+00:00";
const business = { id: ID, entity_name: "Cedar Consulting", updated_at: stamp };
beforeEach(() => port.rpc.mockReset().mockResolvedValue({ data: { ok: true, businesses: [business] }, error: null }));
describe("minimal caller-native business projection", () => {
  it("requests only the bounded current-tenant reader and retains exact native timestamp text", async () => {
    expect(await loadStudioBusinessTargets(TENANT, " Cedar ")).toEqual([business]);
    expect(port.rpc).toHaveBeenCalledExactlyOnceWith("studio_business_targets", { p_expected_tenant: TENANT, p_query: "Cedar", p_limit: 20 });
    expect((await loadStudioBusinessTargets(TENANT, "Cedar"))[0].updated_at).toBe(stamp);
  });
  it.each([
    { ok: false, businesses: [] }, { ok: true, businesses: null }, { ok: true, businesses: [business], tenant_id: TENANT },
    { ok: true, businesses: [{ ...business, email: "private@example.invalid" }] },
    { ok: true, businesses: [{ ...business, updated_at: null }] }, { ok: true, businesses: [{ ...business, updated_at: "latest" }] },
    { ok: true, businesses: [{ ...business, entity_name: " " }] }, { ok: true, businesses: [{ ...business, id: "unverified" }] },
    { ok: true, businesses: [business, business] }, { ok: true, businesses: Array.from({ length: 21 }, () => business) },
  ])("refuses malformed or broader-than-agreed native data %#", async data => {
    port.rpc.mockResolvedValue({ data, error: null });
    await expect(loadStudioBusinessTargets(TENANT, "Cedar")).rejects.toThrow(); expect(port.rpc).toHaveBeenCalledTimes(1);
  });
  it("refuses invalid scope, oversized searches and prior cancellation before any read", async () => {
    const controller = new AbortController(); controller.abort();
    for (const [tenant, query, signal] of [["foreign-text", "Cedar", undefined], [TENANT, "X".repeat(121), undefined], [TENANT, "Cedar", controller.signal]] as const)
      await expect(loadStudioBusinessTargets(tenant, query, signal)).rejects.toThrow();
    expect(port.rpc).not.toHaveBeenCalled();
  });
  it("does not accept a late reply after cancellation or retry a failed read", async () => {
    let release!: (value: unknown) => void;
    port.rpc.mockReturnValue(new Promise(resolve => { release = resolve; }));
    const controller = new AbortController(); const pending = loadStudioBusinessTargets(TENANT, "Cedar", controller.signal);
    controller.abort(); release({ data: { ok: true, businesses: [business] }, error: null });
    await expect(pending).rejects.toThrow(); expect(port.rpc).toHaveBeenCalledTimes(1);
    port.rpc.mockClear().mockResolvedValue({ data: null, error: { message: "unavailable" } });
    await expect(loadStudioBusinessTargets(TENANT, "Cedar")).rejects.toThrow(); expect(port.rpc).toHaveBeenCalledTimes(1);
  });
});
