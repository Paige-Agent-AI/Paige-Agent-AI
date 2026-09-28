import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { useSoloSetupBrief } from "./useSoloSetupBrief";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const testState = vi.hoisted(() => ({
  tenantId: "tenant-a",
  pending: [] as Array<{ tenantId: string; resolve: (value: unknown) => void }>,
  saves: [] as Array<{ tenantId: string; resolve: (value: unknown) => void }>,
}));

vi.mock("@/hooks/useTenantContext", () => ({
  useTenantContext: () => ({ activeTenantId: testState.tenantId }),
}));

vi.mock("./useSoloPeople", () => ({
  useSoloPeople: () => ({ loading: false, error: null, people: [], refresh: vi.fn() }),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: vi.fn((name: string) => {
      if (name === "resolve_tenant_domain_identity") return Promise.resolve({ data: null, error: null });
      if (name === "get_solo_setup_context") {
        const tenantId = testState.tenantId;
        return new Promise((resolve) => testState.pending.push({ tenantId, resolve }));
      }
      if (name === "save_solo_setup_context") {
        const tenantId = testState.tenantId;
        return new Promise((resolve) => testState.saves.push({ tenantId, resolve }));
      }
      return Promise.resolve({ data: null, error: null });
    }),
  },
}));

function Probe() {
  const data = useSoloSetupBrief();
  return <button type="button" data-loading={data.loading} disabled={!data.canEdit}>{data.brief.publicName || "Unresolved"}</button>;
}

function SaveProbe() {
  const data = useSoloSetupBrief();
  const [result, setResult] = useState("Ready");
  return <button type="button" data-saving={data.saving} disabled={!data.canEdit} onClick={async () => {
    const saved = await data.save(data.brief, data.businessOwners, null);
    setResult(saved.kind);
  }}>{data.loading ? "Loading" : result}</button>;
}

function ErrorProbe() {
  const data = useSoloSetupBrief();
  return <output data-loading={String(data.loading)}>{data.error ?? "no error"}</output>;
}

describe("useSoloSetupBrief tenant gate", () => {
  it("drops a late prior-tenant response and enables editing only after the current tenant resolves", async () => {
    testState.tenantId = "tenant-a";
    testState.pending.length = 0;
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);

    await act(async () => root.render(<Probe />));
    expect(testState.pending.map((item) => item.tenantId)).toEqual(["tenant-a"]);

    testState.tenantId = "tenant-b";
    await act(async () => root.render(<Probe />));
    expect(testState.pending.map((item) => item.tenantId)).toEqual(["tenant-a", "tenant-b"]);
    expect(host.querySelector("button")?.disabled).toBe(true);

    await act(async () => {
      testState.pending[0].resolve({
        data: { tenantId: "tenant-a", tenantName: "Business A", brief: { publicName: "Business A" }, accessScope: "owner_full", businessOwners: [] },
        error: null,
      });
      await Promise.resolve();
    });
    expect(host.textContent).toBe("Unresolved");
    expect(host.querySelector("button")?.disabled).toBe(true);

    await act(async () => {
      testState.pending[1].resolve({
        data: { tenantId: "tenant-b", tenantName: "Business B", brief: { publicName: "Business B" }, accessScope: "owner_full", businessOwners: [] },
        error: null,
      });
      await Promise.resolve();
    });
    expect(host.textContent).toBe("Business B");
    expect(host.querySelector("button")?.disabled).toBe(false);

    await act(async () => root.unmount());
    host.remove();
  });

  it("classifies a durable-write conflict without claiming success", async () => {
    testState.tenantId = "tenant-a";
    testState.pending.length = 0;
    testState.saves.length = 0;
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    await act(async () => root.render(<SaveProbe />));
    await act(async () => {
      testState.pending[0].resolve({
        data: { tenantId: "tenant-a", tenantName: "Business A", brief: { publicName: "Business A", updatedAt: "v1" }, accessScope: "owner_full", businessOwners: [] },
        error: null,
      });
      await Promise.resolve();
    });
    await act(async () => host.querySelector("button")?.click());
    await act(async () => {
      testState.saves[0].resolve({ data: null, error: { code: "40001", hint: "SETUP_CONFLICT", message: "This brief changed in another session." } });
      await Promise.resolve();
    });
    expect(host.textContent).toBe("conflict");
    await act(async () => root.unmount());
    host.remove();
  });

  it("returns ok on a genuine successful save, even though this suite's client mock has no `functions` key at all", async () => {
    // Regression guard: save() now fires a fire-and-forget Systems Check rescan
    // (rescanBusinessContext, via supabase.functions.invoke) after a successful save. This
    // suite's own supabase mock above declares no `functions` key — exactly the shape that would
    // throw if the rescan trigger were not defensively wrapped. A real save must still resolve
    // "saved" here, proving the rescan can never turn a successful Setup save into a failure.
    testState.tenantId = "tenant-a";
    testState.pending.length = 0;
    testState.saves.length = 0;
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    await act(async () => root.render(<SaveProbe />));
    await act(async () => {
      testState.pending[0].resolve({
        data: { tenantId: "tenant-a", tenantName: "Business A", brief: { publicName: "Business A", updatedAt: "v1" }, accessScope: "owner_full", businessOwners: [] },
        error: null,
      });
      await Promise.resolve();
    });
    await act(async () => host.querySelector("button")?.click());
    await act(async () => {
      testState.saves[0].resolve({
        data: { tenantId: "tenant-a", tenantName: "Business A", brief: { publicName: "Business A", updatedAt: "v2" }, accessScope: "owner_full", businessOwners: [] },
        error: null,
      });
      await Promise.resolve();
    });
    expect(host.textContent).toBe("saved");
    await act(async () => root.unmount());
    host.remove();
  });

  it("drops a save response that returns after the active account changes", async () => {
    testState.tenantId = "tenant-a";
    testState.pending.length = 0;
    testState.saves.length = 0;
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    await act(async () => root.render(<SaveProbe />));
    await act(async () => {
      testState.pending[0].resolve({
        data: { tenantId: "tenant-a", tenantName: "Business A", brief: { publicName: "Business A", updatedAt: "v1" }, accessScope: "owner_full", businessOwners: [] },
        error: null,
      });
      await Promise.resolve();
    });
    await act(async () => host.querySelector("button")?.click());
    testState.tenantId = "tenant-b";
    await act(async () => root.render(<SaveProbe />));
    expect(host.querySelector("button")?.getAttribute("data-saving")).toBe("false");
    await act(async () => {
      testState.saves[0].resolve({
        data: { tenantId: "tenant-a", tenantName: "Business A", brief: { publicName: "Old response", updatedAt: "v2" }, accessScope: "owner_full", businessOwners: [] },
        error: null,
      });
      await Promise.resolve();
    });
    expect(host.textContent).not.toContain("saved");
    expect(host.textContent).not.toContain("Old response");
    await act(async () => root.unmount());
    host.remove();
  });
  // Owner live drive 2026-09-28: an operator acting as a workspace got NULL from the Setup read and
  // Business Game Plan sat on its skeleton forever, because a failed read never counted as settled.
  describe("a read that fails for the current workspace", () => {
    async function mountErrorProbe() {
      testState.tenantId = "tenant-a";
      testState.pending.length = 0;
      const host = document.createElement("div");
      document.body.append(host);
      const root = createRoot(host);
      await act(async () => root.render(<ErrorProbe />));
      return { host, root };
    }

    it("settles a refused read (no row) into an error instead of loading forever", async () => {
      const { host } = await mountErrorProbe();
      await act(async () => {
        testState.pending[0].resolve({ data: null, error: null });
        await Promise.resolve();
      });
      const out = host.querySelector("output");
      expect(out?.dataset.loading).toBe("false");
      expect(out?.textContent).not.toBe("no error");
    });

    it("settles a failed read into its error instead of loading forever", async () => {
      const { host } = await mountErrorProbe();
      await act(async () => {
        testState.pending[0].resolve({ data: null, error: { message: "permission denied" } });
        await Promise.resolve();
      });
      const out = host.querySelector("output");
      expect(out?.dataset.loading).toBe("false");
      expect(out?.textContent).toContain("permission denied");
    });

    it("does not let a late failure for the previous workspace settle the current one", async () => {
      const { host, root } = await mountErrorProbe();
      testState.tenantId = "tenant-b";
      await act(async () => root.render(<ErrorProbe />));
      await act(async () => {
        testState.pending[0].resolve({ data: null, error: { message: "permission denied" } });
        await Promise.resolve();
      });
      const out = host.querySelector("output");
      expect(out?.dataset.loading).toBe("true");
      expect(out?.textContent).toBe("no error");
    });
  });
});
