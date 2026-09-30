import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { IntegrationsGatewaySection } from "./settings-integrations-gateway";
import { useMcpGateway } from "./data/useMcpGateway";

const h = vi.hoisted(() => ({ rpc: vi.fn(), invoke: vi.fn(), tenant: "business-a", user: "owner-a", loading: false }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: h.rpc, functions: { invoke: h.invoke } } }));
vi.mock("@/hooks/useTenantContext", () => ({ useTenantContext: () => ({ activeTenantId: h.tenant,
  activeUserId: h.user, loading: h.loading, activeTenant: { name: h.tenant === "business-a" ? "Example business" : "Other business" } }) }));
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const sync = (over = {}) => ({ connection_id: "connection-a", tenant_id: "business-a", enabled: false,
  configured_enabled: false, credential_configured: false, generation: 0, granted_at: null,
  operation: "contacts.create_update", ...over });
const connection = { connection_id: "connection-a", provider_key: "generic-remote", label: "External contacts",
  transport: "http", auth_kind: "none", configured: false, enabled: true, status: "unconfigured",
  health: "unknown", address_configured: false, credentials_configured: false, config_generation: 0 };
let saved = sync();
let rows = [connection];
let host: HTMLDivElement;
let root: Root;
function Subject() { const gw = useMcpGateway(); return <IntegrationsGatewaySection gw={gw}
  group={{ label: "Automation", accent: "var(--pg-violet)", blurb: "External tools" }} tiles={null} />; }
const button = (text: string) => Array.from(host.querySelectorAll<HTMLButtonElement>("button")).find(b => b.textContent?.trim() === text)!;
const click = async (text: string) => { expect(button(text), text).toBeTruthy(); await act(async () => button(text).click()); };
const input = async (selector: string, value: string) => { await act(async () => {
  const field = host.querySelector<HTMLInputElement>(selector)!;
  expect(field).toBeTruthy();
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(field, value);
  field.dispatchEvent(new Event("input", { bubbles: true }));
}); };
const open = async () => { await act(async () => host.querySelector<HTMLButtonElement>('[data-gateway-tool="connection-a"]')!.click()); };
const mount = async () => { await act(async () => root.render(<Subject />)); };
beforeEach(async () => {
  h.tenant = "business-a"; h.user = "owner-a"; h.loading = false;
  saved = sync(); rows = [connection]; h.rpc.mockReset(); h.invoke.mockReset();
  h.rpc.mockImplementation(async (name: string, args: Record<string, unknown>) => {
    if (name === "get_mcp_connections_v2") return { data: rows, error: null };
    if (name === "is_current_user_tenant_admin") return { data: true, error: null };
    if (name === "get_mcp_contact_sync") return { data: saved, error: null };
    if (name === "set_mcp_contact_sync") {
      saved = sync({ enabled: args._enabled, configured_enabled: args._enabled,
        credential_configured: args._enabled, generation: saved.generation + 1,
        granted_at: args._enabled ? "2026-09-30T12:00:00Z" : null });
      return { data: saved, error: null };
    }
    return { data: null, error: { message: "unavailable" } };
  });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host); await mount();
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });

it("starts incoming-only setup from the existing drawer without checking an invented provider", async () => {
  await open();
  expect(host.textContent).toContain("Incoming contacts");
  expect(host.textContent).toContain("Not enabled");
  expect(button("Check now")).toBeUndefined();
  await click("Set up incoming contacts");
  expect(host.querySelector('input[type="password"]')).toBeTruthy();
  expect(host.textContent).toContain("Example business");
  expect(h.invoke).not.toHaveBeenCalled();
});

it("enables only after explicit consent and fresh readback, then revokes without deleting contacts", async () => {
  await open(); await click("Set up incoming contacts");
  expect(button("Enable incoming contacts").disabled).toBe(true);
  await input('input[type="password"]', "synthetic-test-only-incoming-credential-12345");
  await act(async () => host.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click());
  await click("Enable incoming contacts");
  expect(host.textContent).toContain("Saved · incoming permission confirmed");
  expect(host.textContent).not.toContain("synthetic-test-only");
  expect(host.querySelector('input[type="password"]')).toBeNull();
  await click("Revoke incoming access");
  expect(host.textContent).toContain("Contacts already received stay in Paige");
  await click("Revoke access");
  expect(host.textContent).toContain("Incoming access revoked");
  expect(saved.enabled).toBe(false);
  expect(h.invoke).not.toHaveBeenCalled();
});

it("provides incoming-only creation and does not turn a lost response into an automatic duplicate", async () => {
  h.rpc.mockImplementation(async (name: string) => {
    if (name === "get_mcp_connections_v2") return { data: rows, error: null };
    if (name === "is_current_user_tenant_admin") return { data: true, error: null };
    throw new Error("offline");
  });
  await click("Add incoming contacts connection");
  await input('input[name="incoming-name"]', "New external source");
  await click("Save connection");
  expect(host.textContent).toContain("Creation not confirmed");
  expect(button("Save connection")).toBeUndefined();
  await click("Back to Integrations");
  await click("Add incoming contacts connection");
  expect(host.textContent).toContain("Creation not confirmed");
  expect(h.rpc.mock.calls.filter(c => c[0] === "create_mcp_inbound_connection")).toHaveLength(1);
  expect(button("Start a separate connection").disabled).toBe(true);
  await act(async () => host.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click());
  await click("Start a separate connection");
  expect(host.querySelector<HTMLInputElement>('input[name="incoming-name"]')!.value).toBe("");
  expect(h.rpc.mock.calls.filter(c => c[0] === "create_mcp_inbound_connection")).toHaveLength(1);
});

it("clears a private draft immediately on account switch and never sends it", async () => {
  await open(); await click("Set up incoming contacts");
  await input('input[type="password"]', "synthetic-test-only-incoming-credential-12345");
  h.tenant = "business-b"; h.loading = true; await mount();
  expect(host.querySelector('[role="dialog"]')).toBeNull();
  expect(host.querySelector('input[type="password"]')).toBeNull();
  expect(h.rpc.mock.calls.some(c => c[0] === "set_mcp_contact_sync")).toBe(false);
});

it("keeps unsaved incoming details through cancel/Keep editing and clears them on discard", async () => {
  await open(); await click("Set up incoming contacts");
  await input('input[type="password"]', "synthetic-test-only-incoming-credential-12345");
  await click("Cancel"); await click("Keep editing");
  expect(host.querySelector<HTMLInputElement>('input[type="password"]')!.value).toContain("synthetic-test-only");
  await click("Cancel"); await click("Discard changes");
  expect(host.querySelector('input[type="password"]')).toBeNull();
  expect(h.rpc.mock.calls.some(c => c[0] === "set_mcp_contact_sync")).toBe(false);
});

it("preserves uncertain save recovery across close/reopen and never infers success from an old read", async () => {
  const normal = h.rpc.getMockImplementation()!;
  h.rpc.mockImplementation((name: string, args: Record<string, unknown>) => name === "set_mcp_contact_sync"
    ? Promise.reject(new Error("lost response")) : normal(name, args));
  await open(); await click("Set up incoming contacts");
  await input('input[type="password"]', "synthetic-test-only-incoming-credential-12345");
  await act(async () => host.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click());
  await click("Enable incoming contacts");
  expect(host.textContent).toContain("Save not confirmed");
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Close External contacts"]')!.click());
  await open(); expect(host.textContent).toContain("Save not confirmed");
  await click("Read current settings");
  expect(button("Set up incoming contacts")).toBeUndefined();
  saved = sync({ generation: 1 });
  await click("Read current settings");
  expect(host.textContent).toContain("Not enabled");
  expect(button("Set up incoming contacts")).toBeTruthy();
  expect(h.rpc.mock.calls.filter(c => c[0] === "set_mcp_contact_sync")).toHaveLength(1);
});

it("holds a delayed commit recovery notice after closing without promising server cancellation", async () => {
  const normal = h.rpc.getMockImplementation()!;
  let finish!: (value: unknown) => void;
  h.rpc.mockImplementation((name: string, args: Record<string, unknown>) => name === "set_mcp_contact_sync"
    ? new Promise(resolve => { finish = resolve; }) : normal(name, args));
  await open(); await click("Set up incoming contacts");
  await input('input[type="password"]', "synthetic-test-only-incoming-credential-12345");
  await act(async () => host.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click());
  await click("Enable incoming contacts");
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Close External contacts"]')!.click());
  await open(); expect(host.textContent).toContain("Save not confirmed");
  await act(async () => { finish({ data: null, error: null }); });
  expect(host.textContent).toContain("Save not confirmed");
  expect(h.rpc.mock.calls.filter(c => c[0] === "set_mcp_contact_sync")).toHaveLength(1);
});

it("keeps configured-but-inactive access separate from enabled permission", async () => {
  saved = sync({ configured_enabled: true, credential_configured: true, generation: 2, granted_at: "2026-09-30T12:00:00Z" });
  await open();
  expect(host.textContent).toContain("Access no longer active");
  expect(button("Review and enable again")).toBeTruthy();
  expect(button("View sender setup")).toBeUndefined();
  expect(button("Revoke incoming access")).toBeTruthy();
});

it("a forbidden/failed read stays unavailable rather than rendering an off or enabled grant", async () => {
  const normal = h.rpc.getMockImplementation()!;
  h.rpc.mockImplementation((name: string, args: Record<string, unknown>) => name === "get_mcp_contact_sync"
    ? { data: null, error: { message: "MCP_FORBIDDEN" } } : normal(name, args));
  await open();
  expect(host.textContent).toContain("You don’t have permission");
  expect(button("Set up incoming contacts")).toBeUndefined();
  expect(host.textContent).not.toContain("Not enabled");
});

it("sender instructions use only safe connection references and never execute a send", async () => {
  saved = sync({ enabled: true, configured_enabled: true, credential_configured: true, generation: 4, granted_at: "2026-09-30T12:00:00Z" });
  await open(); await click("View sender setup");
  expect(host.textContent).toContain('"connection_id": "connection-a"');
  expect(host.textContent).toContain('"generation": 4');
  expect(host.textContent).toContain("[your sync credential]");
  expect(host.textContent).not.toContain('"tenant_id"');
  expect(h.invoke).not.toHaveBeenCalled();
  expect(h.rpc.mock.calls.some(c => c[0] === "sync_mcp_connection_contact")).toBe(false);
});

it("offers an explicit new grant attempt after an unchanged fresh read, never a blind resend", async () => {
  const normal = h.rpc.getMockImplementation()!;
  let writes = 0;
  h.rpc.mockImplementation((name: string, args: Record<string, unknown>) => {
    if (name === "set_mcp_contact_sync" && ++writes === 1) return Promise.reject(new Error("not sent"));
    return normal(name, args);
  });
  await open(); await click("Set up incoming contacts");
  await input('input[type="password"]', "synthetic-test-only-incoming-credential-12345");
  await act(async () => host.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click());
  await click("Enable incoming contacts");
  expect(button("Review a new attempt").disabled).toBe(true);
  await click("Read current settings");
  await click("Review a new attempt");
  await click("Set up incoming contacts");
  expect(host.querySelector<HTMLInputElement>('input[type="password"]')!.value).toBe("");
  expect(button("Enable incoming contacts").disabled).toBe(true);
  expect(h.rpc.mock.calls.filter(c => c[0] === "set_mcp_contact_sync")).toHaveLength(1);
  await input('input[type="password"]', "synthetic-test-only-replacement-credential-12345");
  await act(async () => host.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click());
  await click("Enable incoming contacts");
  expect(host.textContent).toContain("Saved · incoming permission confirmed");
  expect(saved.generation).toBe(1);
});

it("never calls an incoming-only grant unusable or asks to check an absent outbound address", async () => {
  saved = sync({ enabled: true, configured_enabled: true, credential_configured: true, generation: 1, granted_at: "2026-09-30T12:00:00Z" });
  expect(host.textContent).toContain("View incoming setup");
  expect(host.textContent).not.toContain("not usable yet");
  await open();
  expect(host.textContent).toContain("Enabled");
  expect(host.textContent).not.toContain("Connected MCP Gateway");
  expect(host.textContent).not.toContain("No successful check yet");
  expect(button("Check now")).toBeUndefined();
  expect(button("Add outbound address")).toBeTruthy();
  expect(h.invoke).not.toHaveBeenCalled();
});

it("refuses a deliberate second attempt if the first request commits after the recovery read", async () => {
  const normal = h.rpc.getMockImplementation()!;
  let writes = 0;
  h.rpc.mockImplementation((name: string, args: Record<string, unknown>) => {
    if (name === "set_mcp_contact_sync") {
      if (++writes === 1) return Promise.reject(new Error("reply lost"));
      if (args._expected_generation !== saved.generation) return { data: null, error: { message: "MCP_CONTACT_SYNC_STALE" } };
    }
    return normal(name, args);
  });
  await open(); await click("Set up incoming contacts");
  await input('input[type="password"]', "synthetic-test-only-first-credential-12345");
  await act(async () => host.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click());
  await click("Enable incoming contacts"); await click("Read current settings");
  await click("Review a new attempt"); await click("Set up incoming contacts");
  // Real database concurrency is proved separately. This models its stale-version refusal
  // after an earlier request wins, and verifies the customer's UI does not claim another save.
  saved = sync({ enabled: true, configured_enabled: true, credential_configured: true,
    generation: 1, granted_at: "2026-09-30T12:00:00Z" });
  await input('input[type="password"]', "synthetic-test-only-second-credential-12345");
  await act(async () => host.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click());
  await click("Enable incoming contacts");
  expect(host.textContent).toContain("These settings changed");
  expect(host.textContent).not.toContain("Saved · incoming permission confirmed");
  expect(host.querySelector('input[type="password"]')).toBeNull();
  expect(saved.generation).toBe(1);
  expect(writes).toBe(2);
  await click("Retry reading settings");
  expect(button("Replace sync credential")).toBeTruthy();
});

it("keeps focus in the drawer when an uncertain save replaces the focused action", async () => {
  const normal = h.rpc.getMockImplementation()!;
  h.rpc.mockImplementation((name: string, args: Record<string, unknown>) => name === "set_mcp_contact_sync"
    ? Promise.reject(new Error("lost reply")) : normal(name, args));
  await open(); await click("Set up incoming contacts");
  await input('input[type="password"]', "synthetic-test-only-incoming-credential-12345");
  await act(async () => host.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click());
  button("Enable incoming contacts").focus();
  await click("Enable incoming contacts");
  expect(host.querySelector('[role="dialog"]')!.contains(document.activeElement)).toBe(true);
});

it("keeps focus in the drawer when unconfirmed creation replaces Save", async () => {
  const normal = h.rpc.getMockImplementation()!;
  h.rpc.mockImplementation((name: string, args: Record<string, unknown>) => name === "create_mcp_inbound_connection"
    ? Promise.reject(new Error("lost reply")) : normal(name, args));
  await click("Add incoming contacts connection");
  await input('input[name="incoming-name"]', "New external source");
  button("Save connection").focus(); await click("Save connection");
  expect(host.querySelector('[role="dialog"]')!.contains(document.activeElement)).toBe(true);
});

it("protects incoming text against Escape in the same input turn, before passive effects", async () => {
  await open(); await click("Set up incoming contacts");
  await act(async () => {
    const field = host.querySelector<HTMLInputElement>('input[type="password"]')!;
    field.focus();
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(field, "synthetic-unsaved-credential-12345678");
    field.dispatchEvent(new Event("input", { bubbles: true }));
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  });
  expect(host.querySelector('[role="dialog"]')).not.toBeNull();
  expect(host.textContent).toContain("Discard these unsaved details?");
  await click("Keep editing");
  expect(host.querySelector<HTMLInputElement>('input[type="password"]')!.value).toBe("synthetic-unsaved-credential-12345678");
});

it("protects a new source name against Escape before passive effects", async () => {
  await click("Add incoming contacts connection");
  await act(async () => {
    const field = host.querySelector<HTMLInputElement>('input[name="incoming-name"]')!;
    field.focus();
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(field, "Unsaved external source");
    field.dispatchEvent(new Event("input", { bubbles: true }));
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  });
  expect(host.querySelector('[role="dialog"]')).not.toBeNull();
  expect(host.textContent).toContain("Discard these unsaved details?");
});
