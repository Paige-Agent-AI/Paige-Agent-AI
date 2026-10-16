import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useSoloComms } from "./useSoloComms";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const TENANT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OTHER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const state = vi.hoisted(() => ({ tenant: "", actor: "", loading: false, invoke: vi.fn() }));
vi.mock("@/hooks/useTenantContext", () => ({ useTenantContext: () => ({
  activeTenantId: state.tenant || null, activeUserId: state.actor || null, activeTenant: null, loading: state.loading,
}) }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {
  rpc: vi.fn(async (name: string) => ({ data: name === "is_current_user_tenant_admin" ? true : null, error: null })),
  from: (table: string) => {
    const answer = { data: table === "tenants" ? { brand: {} } : [], error: null };
    const b = { select: () => b, eq: () => b, order: () => b, limit: () => b,
      maybeSingle: async () => answer, then: (done: (v: unknown) => unknown) => Promise.resolve(answer).then(done) };
    return b;
  },
  functions: { invoke: state.invoke },
} }));
const mounted: Root[] = [];
function mount() {
  const result = { current: undefined as unknown as ReturnType<typeof useSoloComms> };
  function Probe() { result.current = useSoloComms(); return null; }
  const root = createRoot(document.createElement("div")); mounted.push(root);
  const render = () => act(() => root.render(<Probe/>));
  render();
  return { result, render, unmount: () => act(() => root.unmount()) };
}
async function ready(result: ReturnType<typeof mount>["result"]) {
  await vi.waitFor(async () => { await act(async () => { await Promise.resolve(); }); expect(result.current.loading).toBe(false); });
}
beforeEach(() => {
  state.tenant = TENANT; state.actor = "actor-a"; state.loading = false;
  state.invoke.mockReset().mockImplementation(async (name: string) => ({
    data: name === "gmail-oauth-start" ? { authorization_url: "https://accounts.google.com/fixture" }
      : name === "gmail-disconnect" ? { ok: true, disconnected: true } : { domains: [] }, error: null,
  }));
});
afterEach(() => { mounted.splice(0).forEach(root => act(() => root.unmount())); });

describe("SOLO Gmail mutations bind the selected workspace without granting authority", () => {
  for (const [code, message] of [
    ["gmail_disconnected_result_withheld", "PAIGE disconnected Google"],
    ["gmail_disconnect_outcome_unknown", "could not be confirmed"],
  ]) {
    for (const wire of ["body", "http-error"]) {
      it(`disconnect preserves ${code} truth from ${wire} without claiming nothing happened`, async () => {
        const { result } = mount(); await ready(result);
        const body = { error: code, disconnected: code === "gmail_disconnected_result_withheld" ? true : null };
        state.invoke.mockResolvedValue(wire === "body" ? { data: body, error: null }
          : { data: null, error: { context: new Response(JSON.stringify(body), { status: 503 }) } });
        let output: Awaited<ReturnType<typeof result.current.disconnectGmail>>;
        await act(async () => { output = await result.current.disconnectGmail(); });
        expect(output!.ok).toBe(false); expect(output!.error).toContain(message);
        expect(output!.error).not.toContain("nothing");
      });
    }
  }
  for (const body of [{}, { ok: true }, null,
    { error: "gmail_disconnected_result_withheld" },
    { error: "gmail_disconnected_result_withheld", disconnected: false }]) {
    it(`does not claim a disconnection from incomplete/contradictory native facts ${JSON.stringify(body)}`, async () => {
      const { result } = mount(); await ready(result);
      state.invoke.mockResolvedValue({ data: body, error: null });
      let output: Awaited<ReturnType<typeof result.current.disconnectGmail>>;
      await act(async () => { output = await result.current.disconnectGmail(); });
      expect(output!.ok).toBe(false); expect(output!.error).toContain("could not be confirmed");
      expect(output!.error).not.toContain("PAIGE disconnected");
    });
  }
  it("does not turn a lost disconnect transport into absence or an immediate retry invitation", async () => {
    const { result } = mount(); await ready(result);
    state.invoke.mockRejectedValue(new Error("neutral transport failure"));
    let output: Awaited<ReturnType<typeof result.current.disconnectGmail>>;
    await act(async () => { output = await result.current.disconnectGmail(); });
    expect(output!.ok).toBe(false); expect(output!.error).toContain("could not be confirmed");
    expect(output!.error).toContain("original workspace");
    expect(state.invoke.mock.calls.filter(([name]) => name === "gmail-disconnect")).toHaveLength(1);
  });
  for (const name of ["startGmailConnect", "disconnectGmail"] as const) {
    it(`${name} carries the intended workspace to the existing native door`, async () => {
      const { result } = mount(); await ready(result);
      await act(async () => { await result.current[name](); });
      const target = name === "startGmailConnect" ? "gmail-oauth-start" : "gmail-disconnect";
      expect(state.invoke).toHaveBeenCalledWith(target, expect.objectContaining({ body: expect.objectContaining({ expected_tenant_id: TENANT }) }));
      if (name === "startGmailConnect") {
        const body = state.invoke.mock.calls.find(([key]) => key === target)![1].body;
        expect(body.purpose).toBeUndefined(); // No new inbox consent/scope activation in this repair.
      }
    });
    it(`${name} presents a native stale-workspace refusal without a false completion`, async () => {
      const { result } = mount(); await ready(result);
      state.invoke.mockResolvedValue({ data: null, error: {
        context: new Response(JSON.stringify({ error: "workspace_changed" }), { status: 409 }),
      } });
      let output: Awaited<ReturnType<typeof result.current[typeof name]>>;
      await act(async () => { output = await result.current[name](); });
      expect(output!.error).toContain("Workspace changed");
      if ("url" in output!) expect(output!.url).toBeNull();
      if ("ok" in output!) expect(output!.ok).toBe(false);
    });
    for (const mode of ["missing", "missing actor", "changed actor", "loading", "stale callback"] as const) {
      it(`${name} refuses ${mode} context without invoking a mutation`, async () => {
        const { result, render } = mount(); await ready(result);
        const action = result.current[name]; state.invoke.mockClear();
        if (mode === "missing") state.tenant = "";
        if (mode === "loading") state.loading = true;
        if (mode === "stale callback") state.tenant = OTHER;
        if (mode === "missing actor") state.actor = "";
        if (mode === "changed actor") state.actor = "actor-b";
        render();
        let output: Awaited<ReturnType<typeof action>>;
        await act(async () => { output = await action(); });
        expect(output!.error).toBeTruthy();
        expect(state.invoke.mock.calls.some(([key]) => key === "gmail-oauth-start" || key === "gmail-disconnect")).toBe(false);
      });
    }
    for (const mode of ["workspace switch", "changed actor", "A-B-A", "unmount"] as const) {
      it(`${name} withholds a former-scope completion after ${mode}`, async () => {
        const { result, render, unmount } = mount(); await ready(result);
        let finish!: (value: unknown) => void;
        state.invoke.mockImplementation((key: string) => key === "manage-tenant-domain"
          ? Promise.resolve({ data: { domains: [] }, error: null }) : new Promise(done => { finish = done; }));
        const pending = result.current[name]();
        if (mode === "unmount") unmount();
        else {
          if (mode === "changed actor") state.actor = "actor-b";
          else state.tenant = OTHER;
          render();
          if (mode === "A-B-A") { state.tenant = TENANT; render(); }
        }
        let output: Awaited<ReturnType<typeof result.current[typeof name]>>;
        await act(async () => {
          finish({ data: { ok: true, disconnected: true, authorization_url: "https://accounts.google.com/fixture" }, error: null });
          output = await pending;
        });
        expect(output!.error).toBeTruthy();
        if ("url" in output!) expect(output!.url).toBeNull();
        if ("ok" in output!) expect(output!.ok).toBe(false);
      });
    }
  }
});
