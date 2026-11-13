import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TeamHubStudioHandoff } from "./TeamHubStudioHandoff";
import { ChatStudioHandoff } from "./ChatStudioHandoff";
import { parseTeamHubStudioReference, readTeamHubStudioReference, startTeamHubStudio, ProjectStartUnknown } from "./studio-data";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const TENANT = "11111111-1111-4111-8111-111111111111", ACTOR = "22222222-2222-4222-8222-222222222222";
const MESSAGE = "33333333-3333-4333-8333-333333333333", SESSION = "44444444-4444-4444-8444-444444444444", THREAD = "55555555-5555-4555-8555-555555555555";
const OTHER = "66666666-6666-4666-8666-666666666666";
const BRIEF = "Build the service page described in this private request.";
const api = vi.hoisted(() => ({ rpc: vi.fn(), tenant: { value: {} as Record<string, unknown> } }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: api.rpc } }));
vi.mock("@/hooks/useTenantContext", () => ({ useTenantContext: () => api.tenant.value }));
let root: Root, host: HTMLDivElement;
let cleanups: (() => void)[];
const ready = () => ({ ok: true, state: "ready", session_id: SESSION, thread_id: THREAD, created: true });
const prepared = () => ({ ok: true, state: "prepared", brief: BRIEF });
function answer(data: unknown, error: unknown = null) { return { data, error }; }
async function render(agentKey: "nexus" | "paige" = "nexus", expectedTenant = TENANT, originalRequestText?: string) {
  await act(async () => root.render(<TeamHubStudioHandoff messageId={MESSAGE} expectedTenant={expectedTenant} actorId={ACTOR} agentKey={agentKey} originalRequestText={originalRequestText} />));
}
async function click(text: string) {
  const button = Array.from(host.querySelectorAll("button")).find(node => node.textContent === text);
  expect(button, text).toBeTruthy(); await act(async () => button!.click());
}
async function selectTarget(value: string) {
  const select = host.querySelector('select[aria-label="Project target"]') as HTMLSelectElement;
  expect(select).toBeTruthy();
  await act(async () => { select.value = value; select.dispatchEvent(new Event("change", { bubbles: true })); });
}
const calls = (name: string) => api.rpc.mock.calls.filter(call => call[0] === name);
beforeEach(() => {
  api.tenant.value = { activeUserId: ACTOR, activeTenantId: TENANT, activeTenant: { id: TENANT, slug: "test-tenant-studio" }, accountContextLoading: false, accountContextStatus: "ready" };
  api.rpc.mockReset().mockImplementation(async (name: string) => answer(name === "team_hub_studio_reference" ? prepared() : name === "team_hub_start_studio" ? ready() : null));
  host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host); cleanups = [];
});
afterEach(() => { act(() => root.unmount()); host.remove(); cleanups.forEach(fn => fn()); vi.restoreAllMocks(); });

describe("original Team Hub Studio adapter", () => {
  it("strictly parses only native prepared text or an original session UUID", () => {
    expect(parseTeamHubStudioReference(prepared())).toEqual({ ok: true, state: "prepared", brief: BRIEF });
    expect(parseTeamHubStudioReference({ ok: true, state: "ready", session_id: SESSION })).toEqual({ ok: true, state: "ready", sessionId: SESSION });
    for (const value of [null, { ok: true, state: "ready", session_id: "authored" }, { ...prepared(), session_id: SESSION }, { ...prepared(), brief: "x".repeat(10001) }, { ok: true, state: "prepared", brief: "" }]) {
      expect(parseTeamHubStudioReference(value)).toEqual({ ok: false, code: "unknown" });
    }
  });
  it("reads only expected tenant plus original posted message, and never starts from a read", async () => {
    await readTeamHubStudioReference(TENANT, MESSAGE);
    expect(api.rpc).toHaveBeenCalledWith("team_hub_studio_reference", { p_expected_tenant: TENANT, p_message_id: MESSAGE });
    expect(calls("team_hub_start_studio")).toHaveLength(0);
  });
  it("uses one explicit same-source native start and never retries a lost answer itself", async () => {
    api.rpc.mockResolvedValue(answer(null, { message: "lost" }));
    await expect(startTeamHubStudio(TENANT, MESSAGE, { target: { kind: "workspace" }, values: {} })).rejects.toBeInstanceOf(ProjectStartUnknown);
    expect(api.rpc).toHaveBeenCalledTimes(1);
    expect(api.rpc).toHaveBeenCalledWith("team_hub_start_studio", { p_expected_tenant: TENANT, p_message_id: MESSAGE, p_project_context: { target: { kind: "workspace" }, values: {} } });
  });
  it.each([{ ok: false, code: "unexpected" }, { ok: true, state: "ready", session_id: SESSION }])("keeps malformed start results unknown: %j", async (data) => {
    api.rpc.mockResolvedValue(answer(data));
    await expect(startTeamHubStudio(TENANT, MESSAGE, { target: { kind: "workspace" }, values: {} })).rejects.toBeInstanceOf(ProjectStartUnknown);
    expect(api.rpc).toHaveBeenCalledTimes(1);
  });
});
describe("private same-source Studio handoff", () => {
  it("prefills explicit my-business data only after native preparation, and never starts automatically", async () => {
    let finish!: (value: unknown) => void;
    api.rpc.mockImplementation((name: string) => name === "team_hub_studio_reference" ? new Promise(resolve => { finish = resolve; }) : Promise.resolve(answer(null)));
    await render("nexus", TENANT, "Build a landing page for my business.");
    expect(host.querySelector('select[aria-label="Project target"]')).toBeNull();
    expect(calls("get_solo_business_context")).toHaveLength(0);
    await act(async () => finish(answer(prepared())));
    expect((host.querySelector('select[aria-label="Project target"]') as HTMLSelectElement).value).toBe("workspace");
    expect(calls("get_solo_business_context")).toHaveLength(1);
    expect(calls("team_hub_start_studio")).toHaveLength(0);
  });
  it.each(["client", "prospect", "custom"] as const)("prefills explicit %s input with a local reference and no workspace/CRM inheritance", async kind => {
    const phrase = kind === "custom" ? "a different brand" : `my ${kind}`;
    const request = `Build a page for ${phrase}.\nBusiness name: Northwind`;
    await render("nexus", TENANT, request);
    const reference = (host.querySelector('select[aria-label="Project target"]') as HTMLSelectElement).value;
    expect(reference).toBe(kind);
    await render("nexus", TENANT, request + "\nOffer: Editorial services");
    await click("Start Studio project");
    const context = calls("team_hub_start_studio")[0][1].p_project_context;
    expect(context.target).toMatchObject({ kind, reference: expect.stringMatching(/^[0-9a-f-]{36}$/i) });
    expect(context.target.reference).not.toBe(MESSAGE);
    // A later prop must not replace the first reviewed proposal.
    expect(context.values).toEqual({ publicName: "Northwind" });
    expect(calls("get_solo_business_context")).toHaveLength(0);
    expect(api.rpc.mock.calls.some(call => /crm|contact|client_list/.test(call[0]))).toBe(false);
  });
  it("does not infer a target from the model-prepared brief or override a manual choice with late props", async () => {
    api.rpc.mockImplementation(async name => answer(name === "team_hub_studio_reference" ? { ...prepared(), brief: "Build for my business." } : name === "team_hub_start_studio" ? ready() : null));
    await render();
    expect((host.querySelector('select[aria-label="Project target"]') as HTMLSelectElement).value).toBe("");
    await selectTarget("custom");
    await render("nexus", TENANT, "Build for my business.");
    expect((host.querySelector('select[aria-label="Project target"]') as HTMLSelectElement).value).toBe("custom");
    await click("Start Studio project");
    expect(calls("team_hub_start_studio")[0][1].p_project_context.target.kind).toBe("custom");
  });
  it("keeps a manual field edit when later original-request props change", async () => {
    await render("nexus", TENANT, "Build for my client.\nBusiness name: Northwind");
    const label = Array.from(host.querySelectorAll("label")).find(node => node.textContent === "Business name")!;
    const input = document.getElementById(label.htmlFor) as HTMLInputElement;
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "Owner correction"); input.dispatchEvent(new Event("input", { bubbles: true })); });
    await render("nexus", TENANT, "Build for my business.\nBusiness name: Another name");
    await click("Start Studio project");
    expect(calls("team_hub_start_studio")[0][1].p_project_context).toMatchObject({ target: { kind: "client" }, values: { publicName: "Owner correction" } });
  });
  it("forwards optional original human input through the own Chat adapter only after its native read", async () => {
    api.rpc.mockImplementation(async name => answer(name === "chat_studio_reference" ? prepared() : name === "chat_studio_start" ? ready() : null));
    await act(async () => root.render(<ChatStudioHandoff reference={{ tenantId: TENANT, sourceTurnId: MESSAGE }} originalRequestText="Build for my prospect." />));
    expect((host.querySelector('select[aria-label="Project target"]') as HTMLSelectElement).value).toBe("prospect");
    expect(calls("chat_studio_start")).toHaveLength(0);
    await click("Start Studio project");
    expect(calls("chat_studio_start")[0][1]).toMatchObject({ p_expected_tenant: TENANT, p_source_turn_id: MESSAGE, p_project_context: { target: { kind: "prospect" }, values: {} } });
  });
  it("keeps ambiguous original input unselected and never guesses from assistant-prepared text", async () => {
    await render("nexus", TENANT, "Build for my business or for my client.");
    expect((host.querySelector('select[aria-label="Project target"]') as HTMLSelectElement).value).toBe("");
    expect(calls("get_solo_business_context")).toHaveLength(0);
  });
  it("retains the same authored context across an unknown start and later changed source props", async () => {
    let starts = 0;
    api.rpc.mockImplementation(async name => name === "team_hub_start_studio" ? ++starts === 1 ? answer(null, { message: "lost" }) : answer(ready()) : answer(name === "team_hub_studio_reference" ? prepared() : null));
    await render("nexus", TENANT, "Build for my client.\nBusiness name: Northwind");
    await click("Start Studio project");
    const original = calls("team_hub_start_studio")[0][1];
    await render("nexus", TENANT, "Build for my business.");
    await click("Retry same start");
    expect(calls("team_hub_start_studio")[1][1]).toEqual(original);
  });
  it.each(["nexus", "paige"] as const)("%s mount reads only and requires an explicit target before start", async (agent) => {
    await render(agent);
    expect(calls("team_hub_studio_reference")).toHaveLength(1);
    expect(calls("team_hub_start_studio")).toHaveLength(0);
    expect(calls("get_solo_business_context")).toHaveLength(0);
    expect(host.textContent).toContain(BRIEF);
    const start = Array.from(host.querySelectorAll("button")).find(node => node.textContent === "Start Studio project")!;
    expect(start.disabled).toBe(true);
    await selectTarget("workspace"); await click("Start Studio project");
    expect(calls("team_hub_start_studio")).toHaveLength(1);
    expect(calls("team_hub_start_studio")[0][1]).toMatchObject({ p_expected_tenant: TENANT, p_message_id: MESSAGE, p_project_context: { target: { kind: "workspace" }, values: {} } });
  });
  it("assigns an authored crypto UUID for another target without reading CRM or inheriting workspace facts", async () => {
    await render(); await selectTarget("client"); await click("Start Studio project");
    const context = calls("team_hub_start_studio")[0][1].p_project_context;
    expect(context.target.kind).toBe("client");
    expect(context.target.reference).toMatch(/^[0-9a-f-]{36}$/i);
    expect(context.target.reference).not.toBe(MESSAGE);
    expect(context.values).toEqual({});
    expect(calls("get_solo_business_context")).toHaveLength(0);
    expect(api.rpc.mock.calls.some(call => /crm|contact|client_list/.test(call[0]))).toBe(false);
  });
  it("retains an intentional blank project edit so saved Setup cannot fill it back in", async () => {
    await render(); await selectTarget("workspace");
    const label = Array.from(host.querySelectorAll("label")).find(node => node.textContent === "Business name")!;
    const input = document.getElementById(label.htmlFor) as HTMLInputElement;
    for (const value of ["Temporary", ""]) await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await click("Start Studio project");
    expect(calls("team_hub_start_studio")).toHaveLength(1);
    expect(calls("team_hub_start_studio")[0][1].p_project_context.values).toEqual({ publicName: "" });
  });
  it("still rejects a nonblank sensitive project value", async () => {
    await render(); await selectTarget("custom");
    const label = Array.from(host.querySelectorAll("label")).find(node => node.textContent === "Business name")!;
    const input = document.getElementById(label.htmlFor) as HTMLInputElement;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "api_key=synthetic-placeholder");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await click("Start Studio project");
    expect(calls("team_hub_start_studio")).toHaveLength(0);
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("Check the project details");
  });
  it("opens a native ready reference with session ID only through the existing host event", async () => {
    api.rpc.mockResolvedValue(answer({ ok: true, state: "ready", session_id: SESSION }));
    const events: CustomEvent[] = []; const listener = (event: Event) => events.push(event as CustomEvent);
    window.addEventListener("paige-studio", listener); cleanups.push(() => window.removeEventListener("paige-studio", listener));
    await render("nexus", TENANT, "Build for my client.\nBusiness name: Northwind"); expect(events).toHaveLength(0); await click("Open Studio");
    expect(events).toHaveLength(1); expect(events[0].detail.sessionId).toBe(SESSION);
    expect(Object.keys(events[0].detail).sort()).toEqual(["returnFocus", "sessionId"]);
    expect(calls("team_hub_start_studio")).toHaveLength(0);
  });
  it("unknown start re-reads the original binding and opens its ready result without another write", async () => {
    let reads = 0;
    api.rpc.mockImplementation(async (name: string) => answer(name === "team_hub_studio_reference" ? (++reads === 1 ? prepared() : { ok: true, state: "ready", session_id: SESSION }) : null,
      name === "team_hub_start_studio" ? { message: "lost" } : null));
    await render(); await selectTarget("custom"); await click("Start Studio project");
    expect(calls("team_hub_start_studio")).toHaveLength(1);
    expect(calls("team_hub_studio_reference")).toHaveLength(2);
    expect(host.textContent).toContain("Open Studio");
  });
  it("offers only an explicit same-source retry after the native binding still says prepared", async () => {
    let starts = 0;
    api.rpc.mockImplementation(async (name: string) => name === "team_hub_start_studio" ? ++starts === 1 ? answer(null, { message: "lost" }) : answer(ready()) : answer(name === "team_hub_studio_reference" ? prepared() : null));
    await render(); await selectTarget("custom"); await click("Start Studio project");
    expect(calls("team_hub_start_studio")).toHaveLength(1); await click("Retry same start");
    expect(calls("team_hub_start_studio")).toHaveLength(2);
    expect(calls("team_hub_start_studio")[1][1]).toEqual(calls("team_hub_start_studio")[0][1]);
    expect(host.textContent).toContain("Open Studio");
  });
  it("stays read-only while the original binding is unknown", async () => {
    let reads = 0;
    api.rpc.mockImplementation(async (name: string) => name === "team_hub_start_studio" ? answer(null, { message: "lost" })
      : answer(name === "team_hub_studio_reference" ? ++reads === 1 ? prepared() : reads === 2 ? { ok: false, code: "unknown" } : { ok: true, state: "ready", session_id: SESSION } : null));
    await render(); await selectTarget("custom"); await click("Start Studio project");
    expect(host.textContent).not.toContain(BRIEF); expect(host.textContent).not.toContain("Retry same start");
    await click("Check same handoff");
    expect(calls("team_hub_start_studio")).toHaveLength(1); expect(host.textContent).toContain("Open Studio");
  });
  it("does not expose private UI or call readers for a changed actor/tenant", async () => {
    api.tenant.value.activeUserId = OTHER;
    await render(); expect(host.textContent).toBe(""); expect(api.rpc).not.toHaveBeenCalled();
    api.tenant.value.activeUserId = ACTOR;
    await render("nexus", OTHER); expect(host.textContent).toBe(""); expect(api.rpc).not.toHaveBeenCalled();
  });
  it("discards a late ready read when actor scope changes", async () => {
    let finish!: (value: unknown) => void;
    api.rpc.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    await render(); api.tenant.value.activeUserId = OTHER; await render();
    await act(async () => finish(answer({ ok: true, state: "ready", session_id: SESSION })));
    expect(host.textContent).toBe(""); expect(calls("team_hub_start_studio")).toHaveLength(0);
  });
  it("discards a late start response after actor change and never auto-opens the host", async () => {
    let finish!: (value: unknown) => void;
    api.rpc.mockImplementation(async (name: string) => name === "team_hub_start_studio" ? new Promise(resolve => { finish = resolve; }) : answer(name === "team_hub_studio_reference" ? prepared() : null));
    const dispatch = vi.spyOn(window, "dispatchEvent");
    await render(); await selectTarget("custom"); await click("Start Studio project");
    api.tenant.value.activeUserId = OTHER; await render(); await act(async () => finish(answer(ready())));
    expect(host.textContent).toBe(""); expect(dispatch).not.toHaveBeenCalled(); expect(calls("team_hub_start_studio")).toHaveLength(1);
  });
  it("a native refusal removes the private handoff instead of trusting message metadata", async () => {
    api.rpc.mockResolvedValue(answer({ ok: false, code: "not_allowed" }));
    await render(); expect(host.textContent).toBe(""); expect(calls("team_hub_start_studio")).toHaveLength(0);
  });
});
