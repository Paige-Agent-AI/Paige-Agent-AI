// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const h = vi.hoisted(() => ({ rpc: vi.fn(), invoke: vi.fn(), tenant: "workspace-a", user: "user-a", loading: false, api: { configured: true, status: "error", workflow_count: 0, last_sync_at: "2026-09-03T12:00:00Z", base_url: "https://example.invalid" } as Record<string, unknown>, mcp: { configured: true, enabled: true, status: "error", auth_kind: "bearer", tool_count: null, approved_capabilities: [], pinned_count: 0 } as Record<string, unknown>, admin: true, apiError: false, mcpError: false }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: h.rpc, functions: { invoke: h.invoke } } }));
vi.mock("@/hooks/useTenantContext", () => ({ useTenantContext: () => ({ activeTenantId: h.tenant, activeUserId: h.user, loading: h.loading }) }));
import { SoloIntegrationsView } from "./settings-integrations";
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let root: Root, host: HTMLDivElement;
const click = async (element: Element | null | undefined) => { expect(element).toBeTruthy(); await act(async () => element!.dispatchEvent(new MouseEvent("click", { bubbles: true }))); };
const button = (text: string) => Array.from(host.querySelectorAll("button")).find(el => el.textContent?.trim() === text);
// Opening Integrations also reads Stripe merchant status; neither status read grants mutation authority.
const onlyIntegrationStatusReads = () => h.invoke.mock.calls.every(call =>
  ["tenant-zapier-api-connect", "tenant-stripe-connect"].includes(call[0]) &&
  call[1]?.body?.action === "status" && call[1]?.body?.expected_tenant_id === h.tenant);
async function mount() { host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host); await act(async () => root.render(<MemoryRouter><SoloIntegrationsView /></MemoryRouter>)); }
async function open() { await click(host.querySelector('[data-provider="n8n"].ig-card')); }
async function type(input: HTMLInputElement, text: string) { await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, text); input.dispatchEvent(new Event("input", { bubbles: true })); }); }
beforeEach(() => { h.tenant = "workspace-a"; h.user = "user-a"; h.loading = false; h.admin = true; h.apiError = false; h.mcpError = false; h.api = { configured: true, status: "error", workflow_count: 0, last_sync_at: "2026-09-03T12:00:00Z", base_url: "https://example.invalid" }; h.mcp = { configured: true, enabled: true, status: "error", auth_kind: "bearer", tool_count: null, approved_capabilities: [], pinned_count: 0 }; h.rpc.mockImplementation((name: string) => { if (name === "get_n8n_connection_readiness") return Promise.resolve({ data: { tenant_id: h.tenant, can_manage: h.admin, api: {}, mcp: { state: h.mcp.oauth_state ?? (h.mcp.status === "connected" ? "connected_no_approved_tools" : "oauth_needed"), auth_kind: h.mcp.auth_kind, oauth_readiness: "ready", approved_workflow_count: 0, approved_tool_count: 0, server_url: "https://example.invalid/mcp-server/http" } }, error: h.mcpError ? { message: "private provider error" } : null }); if (name === "get_tenant_n8n_api_readiness") return Promise.resolve({ data: { tenant_id: h.tenant, can_write: h.admin, health: h.api.status === "error" ? "needs_attention" : "saved_unverified", failure_code: h.api.status === "error" ? "authentication_rejected" : null, checked_at: null, last_success_at: null, ...h.api }, error: h.apiError ? { message: "private provider error" } : null }); if (name === "get_tenant_mcp_connections") return Promise.resolve({ data: { n8n: h.mcp }, error: h.mcpError ? { message: "private provider error" } : null }); if (name === "is_current_user_tenant_admin") return Promise.resolve({ data: h.admin, error: null }); return Promise.resolve({ data: null, error: null }); }); h.invoke.mockResolvedValue({ data: { ok: true }, error: null }); });
afterEach(() => { act(() => root?.unmount()); host?.remove(); vi.clearAllMocks(); });
describe("approved n8n independent connection tabs", () => {
 it("shows both tile and overview states with no credential field by default", async () => { await mount(); const tile = host.querySelector('.ig-card[data-provider="n8n"]')!; expect(tile.textContent).toContain("API connection"); expect(tile.textContent).toContain("Paige tools (MCP)"); await open(); expect(host.querySelector('input[type="password"]')).toBeNull(); expect(host.querySelectorAll('[role="tab"]').length).toBeGreaterThanOrEqual(2); expect(host.textContent).toContain("Let Paige see the n8n workspace and its available workflows."); });
 it("offers owner OAuth reconnect with no bearer credential field", async () => { await mount(); await open(); await click(button("Paige tools (MCP)")); await click(button("Reconnect authorization")); expect(button("Connect n8n with OAuth")).toBeTruthy(); expect(host.querySelector('input[type="password"]')).toBeNull(); expect(host.textContent).not.toContain("temporarily unavailable"); expect(onlyIntegrationStatusReads()).toBe(true); });
 it("never infers successful API health or zero from a saved connected record", async () => { h.api.status = "connected"; await mount(); await open(); expect(host.textContent).toContain("health has not been verified"); expect(host.textContent).not.toContain("0 workflows seen"); expect(host.textContent).not.toContain("Last successful check"); });
 it.each(["api", "mcp"])("keeps other connection readable when %s read fails", async which => { h.apiError = which === "api"; h.mcpError = which === "mcp"; await mount(); await open(); expect(host.textContent).toContain("Status unavailable"); expect(host.textContent).toContain(which === "api" ? "MCP OAuth authorization needed" : "Needs attention"); expect(host.textContent).not.toContain("private provider error"); });
 it("refreshes MCP through reads only", async () => { await mount(); await open(); await click(button("Paige tools (MCP)")); const before = h.rpc.mock.calls.length; await click(button("Refresh status")); expect(h.rpc.mock.calls.length).toBeGreaterThan(before); expect(onlyIntegrationStatusReads()).toBe(true); });
 it("guards dirty API details on tab change", async () => { await mount(); await open(); await click(button("Reconnect API")); await type(host.querySelector('input[type="password"]')!, "local-draft"); await click(button("Paige tools (MCP)")); expect(host.textContent).toContain("unsaved API details"); await click(button("Keep editing")); expect(host.querySelector('input[type="password"]')).toBeTruthy(); await click(button("Paige tools (MCP)")); await click(button("Discard changes")); expect(host.querySelector('input[type="password"]')).toBeNull(); expect(host.textContent).toContain("Let Paige use the n8n tools and workflows you explicitly authorize."); });
 it("keeps legacy authorization separate and allows OAuth replacement", async () => { h.mcp = { ...h.mcp, status: "connected" }; await mount(); await open(); await click(button("Paige tools (MCP)")); expect(host.textContent).toContain("not OAuth"); await click(button("Reconnect authorization")); expect(host.textContent).toContain("Your saved connection stays in place"); expect(onlyIntegrationStatusReads()).toBe(true); });
 it("requires confirmation before removing MCP and leaves API intact", async () => { h.mcp.auth_kind = "oauth"; await mount(); await open(); await click(button("Paige tools (MCP)")); await click(button("Disconnect")); expect(onlyIntegrationStatusReads()).toBe(true); await click(button("Disconnect OAuth")); expect(h.invoke.mock.calls.some(call => call[1]?.body?.action === "disconnect")).toBe(true); expect(h.rpc.mock.calls.some(c => c[0] === "clear_tenant_n8n_connection")).toBe(false); });
 it("closes and drops drafts immediately on workspace change", async () => { await mount(); await open(); await click(button("Reconnect API")); await type(host.querySelector('input[type="password"]')!, "local-draft"); h.tenant = "workspace-b"; await act(async () => root.render(<MemoryRouter><SoloIntegrationsView /></MemoryRouter>)); expect(host.querySelector('[role="dialog"]')).toBeNull(); expect(host.innerHTML).not.toContain("local-draft"); });
 it("lets a viewer read both tabs without mutations", async () => { h.admin = false; await mount(); await open(); expect(button("Reconnect API")).toBeUndefined(); await click(button("Paige tools (MCP)")); expect(button("Remove saved MCP connection")).toBeUndefined(); expect(button("Refresh status")).toBeTruthy(); });
});

it("does not describe an in-flight save as discardable or canceled by closing", async () => {
  await mount(); await open(); await click(button("Reconnect API"));
  await type(host.querySelector('input[type="password"]')!, "local-only-draft");
  const ordinary = h.rpc.getMockImplementation()!;
  let finish!: (result: unknown) => void;
  h.invoke.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  await act(async () => host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
  expect(host.textContent).toContain("Saving and checking this connection…");
  expect((button("Paige tools (MCP)") as HTMLButtonElement).disabled).toBe(true);
  await click(host.querySelector('button[aria-label="Close n8n"]'));
  expect(host.textContent).toContain("Saving is still in progress. Closing will not cancel it.");
  expect(button("Discard changes")).toBeUndefined();
  await click(button("Close while saving"));
  finish({ data: null, error: null }); await act(async () => { await Promise.resolve(); });
  expect(host.querySelector('[role="dialog"]')).toBeNull();
  expect(host.innerHTML).not.toContain("local-only-draft");
});

it.each(["user", "loading"])("drops the drawer on a same-workspace %s identity boundary", async change => {
  await mount(); await open(); await click(button("Reconnect API"));
  await type(host.querySelector('input[type="password"]')!, "local-only-draft");
  if (change === "user") h.user = "user-b"; else h.loading = true;
  await act(async () => root.render(<MemoryRouter><SoloIntegrationsView /></MemoryRouter>));
  expect(host.querySelector('[role="dialog"]')).toBeNull();
  expect(host.innerHTML).not.toContain("local-only-draft");
});

it("uses arrow keys for the two connection tabs without changing authority", async () => {
  await mount(); await open();
  const apiTab = button("API connection")!; apiTab.focus();
  await act(async () => apiTab.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })));
  expect(button("Paige tools (MCP)")?.getAttribute("aria-selected")).toBe("true");
  expect(document.activeElement).toBe(button("Paige tools (MCP)"));
  expect(onlyIntegrationStatusReads()).toBe(true);
});
it("shows verified zero-workflow health independently of blocked MCP", async()=>{ h.api={...h.api,status:undefined,health:"connected",checked_at:"2026-09-03T12:00:00Z",last_success_at:"2026-09-03T12:00:00Z",workflow_count:0}; await mount();await open();expect(host.querySelector('.ig-n8n-summary')?.textContent).toContain("Connected");expect(host.textContent).toContain("0 workflows available");expect(host.textContent).toContain("Last successful check");expect(host.textContent).toContain("MCP OAuth authorization needed");});
 it("closes a saved but refused draft, clears the key, and offers reconnect",async()=>{await mount();await open();await click(button("Reconnect API"));await type(host.querySelector('input[type="password"]')!,"local-draft");h.invoke.mockResolvedValue({data:{ok:true,saved:true,outcome:"needs_attention",connection:{tenant_id:h.tenant,can_write:true,...h.api,health:"needs_attention",failure_code:"authentication_rejected",checked_at:"2026-09-03T12:00:00Z",last_success_at:null,workflow_count:null}},error:null});await act(async()=>host.querySelector('form')!.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));expect(host.querySelector('form')).toBeNull();expect(host.textContent).toContain("The saved n8n connection needs attention. Check the API key or its access in n8n, then reconnect.");expect(button("Reconnect API")).toBeTruthy();expect(host.innerHTML).not.toContain("local-draft");});
 it("checks the saved API key again through the server without a credential form",async()=>{await mount();await open();h.invoke.mockResolvedValue({data:{ok:true,outcome:"connected",connection:{tenant_id:h.tenant,can_write:true,...h.api,health:"connected",failure_code:null,checked_at:"2026-09-03T12:00:00Z",last_success_at:"2026-09-03T12:00:00Z",workflow_count:0}},error:null});await click(button("Refresh status"));expect(h.invoke).toHaveBeenCalledWith("tenant-n8n-api-connect",{body:{action:"validate",expected_tenant_id:h.tenant}});expect(host.querySelector('input[type="password"]')).toBeNull();expect(host.textContent).toContain("0 workflows available");});it("starts OAuth with a POST launch and never changes API authority", async () => {
 h.mcp = { configured: false, oauth_state: "not_configured" }; await mount(); await open(); await click(button("Paige tools (MCP)"));
 await type(host.querySelector('input[type="url"]')!, "https://separate-workspace.example/mcp-server/http");
 const submitted: Array<{method:string;action:string;names:string[]}> = [];
 const submit = vi.spyOn(HTMLFormElement.prototype, "submit").mockImplementation(function(this: HTMLFormElement) { submitted.push({method:this.method,action:this.action,names:Array.from(this.querySelectorAll('input')).map(i=>i.name)}); });
 h.invoke.mockResolvedValueOnce({data:{launch_url:"https://paige.example/oauth",launch_ticket:"synthetic-ticket",launch_proof:"synthetic-proof"},error:null});
 await act(async()=>host.querySelector('form')!.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));
 expect(h.invoke).toHaveBeenCalledWith("tenant-n8n-oauth",{body:{action:"begin",expected_tenant_id:"workspace-a",server_url:"https://separate-workspace.example/mcp-server/http"}});
 expect(submitted).toEqual([{method:"post",action:"https://paige.example/oauth",names:["launch_ticket","launch_proof"]}]);
 expect(document.body.innerHTML).not.toContain("synthetic-proof");expect(host.textContent).toContain("Needs attention"); submit.mockRestore();
});
it("shows connected OAuth without approving or running workflows",async()=>{
 h.mcp={auth_kind:"oauth",oauth_state:"connected_no_approved_tools"};await mount();await open();await click(button("Paige tools (MCP)"));
 expect(host.textContent).toContain("Connected, with no approved workflows or tools");expect(button("Manage access")).toBeTruthy();expect(onlyIntegrationStatusReads()).toBe(true);
 h.invoke.mockResolvedValueOnce({data:{workflows:[],inventory_complete:true,total_count:0},error:null});await click(button("Manage access"));expect(h.invoke.mock.calls.at(-1)?.[1].body.action).toBe("discover");expect(host.textContent).toContain("No eligible workflows");
});
it("suggests only the active workspace API address for a new OAuth connection",async()=>{
 h.api.base_url="https://another-owner.example";h.mcp={configured:false,oauth_state:"not_configured"};
 const ordinary=h.rpc.getMockImplementation()!;h.rpc.mockImplementation((name:string)=>name==="get_n8n_connection_readiness"?Promise.resolve({data:{tenant_id:h.tenant,can_manage:true,api:{},mcp:{state:"not_configured",oauth_readiness:"ready"}},error:null}):ordinary(name));
 await mount();await open();await click(button("Paige tools (MCP)"));expect(host.querySelector<HTMLInputElement>('input[type="url"]')?.value).toBe("https://another-owner.example/mcp-server/http");expect(onlyIntegrationStatusReads()).toBe(true);
});
it.each([0,1])("labels bounded partial inventory with %s shown without claiming global zero",async(length)=>{
 h.mcp={auth_kind:"oauth",oauth_state:"connected_no_approved_tools"};await mount();await open();await click(button("Paige tools (MCP)"));
 h.invoke.mockResolvedValueOnce({data:{workflows:length?[{id:"visible",name:"Approved candidate",approved:false}]:[],inventory_complete:false,total_count:350,discovery_id:"snapshot"},error:null});await click(button("Manage access"));
 expect(host.textContent).toContain(`Partial workflow list: ${length} shown of 350 reported by n8n`);expect(host.textContent).not.toContain("No eligible workflows are available");
});
it("distinguishes saved legacy credentials from a failed replacement OAuth attempt",async()=>{
 const ordinary=h.rpc.getMockImplementation()!;h.rpc.mockImplementation(async(name:string)=>{const result=await ordinary(name);if(name==="get_n8n_connection_readiness")result.data.attempt_state="failed";return result;});
 await mount();await open();await click(button("Paige tools (MCP)"));expect(host.textContent).toContain("Saved MCP configurationLegacy static credential (not OAuth)");expect(host.textContent).toContain("Latest OAuth attempt: Authorization failed");expect(button("Reconnect authorization")).toBeTruthy();
});
