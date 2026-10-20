import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Playbook } from "./types";

const fixture = vi.hoisted(() => ({
  actor: "test-owner", tenant: "test-tenant-empty-a" as string | null,
  signedIn: true, records: new Map<string, Record<string, unknown>>(),
  reads: [] as Array<[string, string, unknown]>, rpc: vi.fn(),
}));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {
  auth: { getUser: async () => ({ data: { user: fixture.signedIn ? { id: fixture.actor } : null } }) },
  from: (table: string) => ({ select: () => ({ eq: (column: string, value: unknown) => ({ maybeSingle: async () => {
    fixture.reads.push([table, column, value]);
    if (table === "profiles" && column === "user_id" && value === fixture.actor)
      return { data: { active_tenant_id: fixture.tenant } };
    if (table === "tenants" && column === "id" && typeof value === "string")
      return { data: { features: fixture.records.get(value) } };
    throw new Error("Unscoped fixture read");
  } }) }) }),
  rpc: (...args: unknown[]) => fixture.rpc(...args),
} }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() } }));

const { resolveActivePlaybook } = await import("./resolve");
const { generalDefault } = await import("./presets");
const { usePlaybookEditor } = await import("@/components/paige/usePlaybookEditor");
const { IntakeSection } = await import("@/components/paige/sections/IntakeSection");
const authored = (): Playbook => ({ ...structuredClone(generalDefault), slug: "test-authored", name: "Test authored", intake: [] });
let root: Root | null = null;
let host: HTMLDivElement | null = null;
let editor: ReturnType<typeof usePlaybookEditor>;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  fixture.actor = "test-owner"; fixture.tenant = "test-tenant-empty-a"; fixture.signedIn = true;
  fixture.records.clear(); fixture.reads.length = 0; fixture.rpc.mockReset();
  fixture.rpc.mockImplementation(async (name, args) => {
    expect(name).toBe("set_tenant_playbook");
    expect(Object.keys(args).sort()).toEqual(["_config", "_tenant_id"]);
    expect(args._tenant_id).toBe(fixture.tenant);
    fixture.records.set(args._tenant_id, { playbook_config: structuredClone(args._config) });
    return { error: null };
  });
});
afterEach(() => { if (root) act(() => root!.unmount()); host?.remove(); root = null; host = null; });

describe("authored intake is not replaced on resolve", () => {
  it("retains an explicit empty array and every other authored section", async () => {
    const config = authored(); const snapshot = structuredClone(config);
    fixture.records.set(fixture.tenant!, { playbook_config: config });
    expect(await resolveActivePlaybook()).toEqual(snapshot);
    expect(config).toEqual(snapshot);
    expect(fixture.reads).toEqual([["profiles", "user_id", fixture.actor], ["tenants", "id", fixture.tenant]]);
    expect(fixture.rpc).not.toHaveBeenCalled();
  });
  it.each([undefined, null, "invalid", { length: 0 }])("preserves the incumbent fallback for missing/non-array intake %j", async intake => {
    const config = { ...authored(), intake };
    fixture.records.set(fixture.tenant!, { playbook_config: config });
    expect((await resolveActivePlaybook()).intake).toEqual(generalDefault.intake);
  });
  it("preserves a valid nonempty authored question exactly", async () => {
    const config = authored(); config.intake = [{ key: "test_choice", label: "Test choice", type: "select", required: true, options: ["One", "Two"] }];
    fixture.records.set(fixture.tenant!, { playbook_config: config });
    expect(await resolveActivePlaybook()).toEqual(config);
  });
  it("keeps the existing unconfigured starter fallback", async () => {
    fixture.records.set(fixture.tenant!, {});
    expect(await resolveActivePlaybook()).toBe(generalDefault);
    expect(fixture.rpc).not.toHaveBeenCalled();
  });
  it("does not read a tenant when no user is signed in", async () => {
    fixture.signedIn = false;
    expect(await resolveActivePlaybook()).toBe(generalDefault);
    expect(fixture.reads).toEqual([]);
  });
  it("does not read tenant features without the incumbent active selection", async () => {
    fixture.tenant = null;
    expect(await resolveActivePlaybook()).toBe(generalDefault);
    expect(fixture.reads).toEqual([["profiles", "user_id", fixture.actor]]);
  });
});

it.each(["test-tenant-empty-a", "test-tenant-empty-b"])("actual editor Remove → Save → remount retains zero questions for %s", async tenant => {
  fixture.tenant = tenant;
  const config = authored(); config.intake = [{ key: "test_question", label: "Test question", type: "text" }];
  fixture.records.set(tenant, { playbook_config: config });
  const foreign = tenant.endsWith("a") ? "test-tenant-empty-b" : "test-tenant-empty-a";
  const foreignConfig = { playbook_config: { ...authored(), name: "Other test configuration" } };
  fixture.records.set(foreign, structuredClone(foreignConfig));
  function Harness() {
    editor = usePlaybookEditor(tenant);
    return editor.loading || !editor.pb ? <p>Loading</p> : <IntakeSection pb={editor.pb} patch={editor.patch} />;
  }
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  await act(async () => { root!.render(<Harness />); });
  expect(host.querySelectorAll('[aria-label="Intake field label"]')).toHaveLength(1);
  await act(async () => { host!.querySelector<HTMLButtonElement>('[aria-label="Remove"]')!.click(); });
  expect(editor!.dirty).toBe(true);
  expect(host.querySelectorAll('[aria-label="Intake field label"]')).toHaveLength(0);
  await act(async () => { expect(await editor!.save()).toBe(true); });
  expect(fixture.rpc).toHaveBeenCalledTimes(1);
  expect((fixture.records.get(tenant)!.playbook_config as Playbook).intake).toEqual([]);
  expect(fixture.records.get(foreign)).toEqual(foreignConfig);
  act(() => root!.unmount()); root = createRoot(host);
  await act(async () => { root!.render(<Harness />); });
  expect(editor!.pb!.intake).toEqual([]);
  expect(editor!.dirty).toBe(false);
  expect(host.querySelectorAll('[aria-label="Intake field label"]')).toHaveLength(0);
  expect(host.textContent).toContain("Add field");
  expect(fixture.rpc).toHaveBeenCalledTimes(1);
});
