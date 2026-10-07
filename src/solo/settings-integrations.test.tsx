/**
 * Settings → Integrations.
 *
 * Two things are proven here. First the standing truth boundary: this surface
 * only ever calls server-resolved, tenant-scoped status RPCs, never passes a
 * tenant argument, never renders a payload, and never links anywhere. Second
 * the n8n connection flow end to end, through the rendered UI: connect from
 * empty, manage, reconnect, disconnect, reload, permission, invalid input,
 * retry, dirty abandonment, and tenant isolation.
 */
import { act, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SoloIntegrationsView } from "./settings-integrations";
import { n8nWriteMessage } from "./data/useN8nConnection";


const context = vi.hoisted(() => ({ tenantId: "tenant-a", loading: false }));
const rpc = vi.hoisted(() => vi.fn());
// The MCP connection writes through an edge function, not an RPC, because only a
// server-side probe may move a connection to `connected`.
const invoke = vi.hoisted(() => vi.fn());

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("@/hooks/useTenantContext", () => ({
  useTenantContext: () => ({ activeTenantId: context.tenantId, activeUserId: "user-a", loading: context.loading }),
}));
// `from` is stubbed as well as `rpc` because one test navigates to the
// Automations leaf, which mounts `useSoloAutomations` and reads real tables.
// Without it that hook throws asynchronously AFTER the test has passed, which
// vitest reports as an unhandled rejection and a non-zero exit while every
// test still shows green — a failure mode that is invisible unless the exit
// code is checked.
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc,
    // Defined inline: `vi.mock` is hoisted above any top-level const.
    from: () => ({
      select: () => {
        // `.is` is here because the REAL chain has it: `useSoloAutomations` reads
        // pipeline_stages as .eq(...).is("archived_at", null).order(...). Without it the
        // read throws inside a `Promise.all`, which surfaces as an UNHANDLED REJECTION —
        // every assertion in this file still passes and the run still fails, which is a
        // worse failure mode than a red assertion because the summary reads green.
        const ordered = { order: () => Promise.resolve({ data: [], error: null }) };
        return { eq: () => ({ ...ordered, is: () => ordered }) };
      },
    }),
    functions: { invoke },
  },
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

/**
 * Default world: n8n API unconfigured, no MCP connection for any provider, caller
 * is a tenant admin. `mcp` is PROVIDER-KEYED because the registry is provider
 * scoped — one workspace may hold an n8n MCP endpoint and a Zapier one at once.
 */
function world(over: {
  n8n?: Record<string, unknown> | null;
  mcp?: Partial<Record<"n8n" | "zapier", Record<string, unknown>>> | null;
  zapierApi?: Record<string, unknown>;
  gateway?: Record<string, unknown>[];
  socialConnections?: Record<string, unknown>[];
  socialAccounts?: Record<string, unknown>[];
  admin?: boolean;
  writeError?: { message: string } | null;
} = {}) {
  let api: Record<string, unknown> = { tenant_id: context.tenantId, can_write: over.admin !== false, label: null, base_url: null, checked_at: null, last_success_at: null, failure_code: over.n8n?.status === "error" ? "authentication_rejected" : null, health: over.n8n?.configured ? over.n8n.status === "error" ? "needs_attention" : "saved_unverified" : "not_configured", configured: false, workflow_count: null, ...over.n8n };
  const zapierApi = { tenant_id: context.tenantId, can_manage: over.admin !== false, state: "not_connected", failure_code: null, accessible_zap_count: null, last_checked_at: null, last_success_at: null, capabilities: [], limitations: [], ...over.zapierApi };
  rpc.mockImplementation((name: string) => {
    if (name === "get_tenant_n8n_api_readiness") return Promise.resolve({ data: api, error: null });
    if (name === "get_tenant_mcp_connections") return Promise.resolve({ data: over.mcp ?? {}, error: null });
    // The registry-native gateway read that the MCP tools section performs on mount. Modelled
    // explicitly, like every other read here: an unrecognised payload is a READ FAILURE to that
    // reader, not an empty account, so leaving it to the catch-all would render an error state
    // in this surface and put a second "Try again" on the page.
    if (name === "get_mcp_connections_v2") return Promise.resolve({ data: over.gateway ?? [], error: null });
    if (name === "is_current_user_tenant_admin") return Promise.resolve({ data: over.admin !== false, error: null });
    if (name === "social_connection_status") return Promise.resolve({ data: over.socialConnections ?? [], error: null });
    if (name === "social_account_status") return Promise.resolve({ data: over.socialAccounts ?? [], error: null });
    if (name === "social_connection_access") return Promise.resolve({ data: over.admin !== false, error: null });
    return Promise.resolve({ data: null, error: null });
  });
  invoke.mockImplementation((name: string, options: { body: Record<string, unknown> }) => {
    if (name === "tenant-zapier-api-connect" && options.body.action === "status") return Promise.resolve({ data: { ok: true, connection: zapierApi }, error: null });
    if (name !== "tenant-n8n-api-connect") return Promise.resolve({ data: { ok: true, status: "connected", toolCount: 4 }, error: null });
    if (over.writeError) return Promise.resolve({ data: { error: over.writeError.message }, error: {} });
    const disconnected = options.body.action === "disconnect";
    api = { ...api, configured: !disconnected, health: disconnected ? "not_configured" : "connected", failure_code: null, workflow_count: disconnected ? null : 0, checked_at: disconnected ? null : "2026-09-03T12:00:00Z", last_success_at: disconnected ? null : "2026-09-03T12:00:00Z" };
    return Promise.resolve({ data: { ok: true, saved: options.body.action === "save" ? true : undefined, outcome: disconnected ? "disconnected" : "connected", connection: api }, error: null });
  });
}

async function render(initialEntry = "/solo/1971670/settings/integrations") {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => root.render(<MemoryRouter initialEntries={[initialEntry]}><SoloIntegrationsView /></MemoryRouter>));
  await act(async () => { await Promise.resolve(); });
  return { host, root };
}

const buttons = (host: HTMLElement) => Array.from(host.querySelectorAll("button"));
const byText = (host: HTMLElement, text: string) => buttons(host).find((b) => b.textContent?.includes(text));
const click = async (el: Element | undefined) => { await act(async () => { el?.dispatchEvent(new MouseEvent("click", { bubbles: true })); }); };
const openCard = async (host: HTMLElement, provider: string) => {
  await click(host.querySelector(`.ig-card[data-provider="${provider}"]`) ?? undefined);
};
const type = async (input: Element | null | undefined, value: string) => {
  const field = input as HTMLInputElement;
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    setter?.call(field, value);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
};
const fields = (host: HTMLElement) => Array.from(host.querySelectorAll<HTMLInputElement>(".ig-field input"));

const submit = async (host: HTMLElement) => {
  await act(async () => { host.querySelector("form")?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
  await act(async () => { await Promise.resolve(); });
};

beforeEach(() => {
  context.tenantId = "tenant-a";
  context.loading = false;
  rpc.mockReset();
  invoke.mockReset();
  invoke.mockResolvedValue({ data: { ok: true, status: "connected", toolCount: 4 }, error: null });
  document.body.innerHTML = "";
});

describe("canonical OAuth return through the real Integrations route", () => {
  const id = "00000000-0000-4000-8000-000000000021";
  const savedTool = { connection_id: id, provider_key: "generic-remote", label: "Test service",
    transport: "http", auth_kind: "none", configured: true, enabled: true,
    status: "pending_verification", health: "unknown", server_url_host: "service.example" };
  async function route() {
    const host = document.createElement("div"); document.body.appendChild(host);
    const root = createRoot(host);
    let search = "";
    function LocationProbe() { search = useLocation().search; return null; }
    const tree = <StrictMode><MemoryRouter initialEntries={[`/solo/10000001/settings/integrations?mcp=cancelled&connection=${id}&mcp_detail=untrusted-provider-prose&keep=yes`]}><LocationProbe /><SoloIntegrationsView /></MemoryRouter></StrictMode>;
    await act(async () => root.render(tree));
    return { host, root, search: () => search, rerender: async () => { await act(async () => root.render(<StrictMode><MemoryRouter initialEntries={["/unused"]}><LocationProbe /><SoloIntegrationsView /></MemoryRouter></StrictMode>)); } };
  }
  const providerCalls = () => invoke.mock.calls.filter((c) => c[0] === "mcp-gateway" && ["verify", "oauth_begin", "create", "run"].includes(c[1]?.body?.action));
  it("waits for account resolution, strips one-shot hints, and opens only the saved row", async () => {
    world({ gateway: [savedTool] }); context.loading = true;
    const view = await route();
    expect(view.host.querySelector('[role="dialog"]')).toBeNull();
    context.loading = false; await view.rerender();
    expect(view.search()).toBe("?keep=yes");
    expect(view.host.querySelector('[role="dialog"]')?.textContent).toContain("Test service");
    expect(view.host.textContent).not.toContain("untrusted-provider-prose");
    expect(providerCalls()).toHaveLength(0);
    await act(async () => view.root.unmount());
  });
  it("retains the hint across a failed canonical read and permits an explicit read retry", async () => {
    world({ gateway: [savedTool] }); const original = rpc.getMockImplementation()!;
    let failed = true;
    rpc.mockImplementation((name: string, ...args: unknown[]) => name === "get_mcp_connections_v2" && failed
      ? Promise.resolve({ data: null, error: { message: "test-read-unavailable" } }) : original(name, ...args));
    const view = await route();
    expect(view.search()).toBe("?keep=yes");
    expect(view.host.querySelector('[role="dialog"]')).toBeNull();
    expect(view.host.textContent).toContain("Your tools couldn’t be read");
    failed = false; await click(byText(view.host, "Try again"));
    expect(view.host.querySelector('[role="dialog"]')?.textContent).toContain("Test service");
    expect(providerCalls()).toHaveLength(0);
    await act(async () => view.root.unmount());
  });
  it("rejects the previous account's late tool read after an account switch", async () => {
    world(); const original = rpc.getMockImplementation()!;
    const pending = deferred<{ data: unknown; error: null }>();
    rpc.mockImplementation((name: string, ...args: unknown[]) => name === "get_mcp_connections_v2" && context.tenantId === "tenant-a"
      ? pending.promise : original(name, ...args));
    const view = await route();
    context.loading = true; await view.rerender();
    context.tenantId = "tenant-b"; context.loading = false; await view.rerender();
    await act(async () => pending.resolve({ data: [savedTool], error: null }));
    expect(view.host.querySelector('[role="dialog"]')).toBeNull();
    expect(view.host.textContent).not.toContain("Test service");
    expect(providerCalls()).toHaveLength(0);
    await act(async () => view.root.unmount());
  });
});

describe("Truth boundary", () => {
  it("makes PayPal discoverable without inventing seller authorization or a connect action", async () => {
    world(); const p = await render();
    const tile = p.host.querySelector('.ig-card[data-provider="paypal"]');
    expect(tile?.textContent).toContain("PayPal"); expect(tile?.textContent).toContain("Not available");
    await openCard(p.host, "paypal");
    const panel = p.host.querySelector('[role="dialog"]');
    expect(panel?.textContent).toContain("approved seller-onboarding");
    expect(panel?.querySelector('input')).toBeNull();
    expect(buttons(panel as HTMLElement).some(button => /connect paypal/i.test(button.textContent ?? ""))).toBe(false);
    expect(invoke.mock.calls.some(([name]) => /paypal/.test(name))).toBe(false);
    await act(async () => p.root.unmount()); p.host.remove();
  });
  it("calls only server-resolved safe status RPCs, with no tenant argument, and renders no payload", async () => {
    world({ n8n: { configured: true, status: "connected", label: "Workflow bridge", workflow_count: 3, secret: "must-not-survive", raw_payload: "must-not-survive", last_error: "must-not-survive" } });
    const { host } = await render();
    expect(rpc).toHaveBeenCalledWith("get_tenant_n8n_api_readiness");
    expect(rpc).toHaveBeenCalledWith("get_tenant_mcp_connections");
    // No status read may carry a tenant argument: the seam derives it.
    for (const call of rpc.mock.calls.filter((c) => String(c[0]).startsWith("get_"))) {
      expect(call.length).toBe(1);
    }
    expect(host.textContent).toContain("Needs attention");
    expect(host.textContent).not.toContain("must-not-survive");
  });

  it("links nowhere at all — not to Automations, Command Center, Marketplace or a provider", async () => {
    world({ n8n: { configured: true, status: "connected" } });
    const { host } = await render();
    // The owner's rule, enforced structurally: an integration card operates its
    // own integration and never navigates.
    expect(host.querySelectorAll("a").length).toBe(0);
    await openCard(host, "n8n");
    if (byText(host, "Connect API")) await click(byText(host, "Connect API"));
    expect(host.querySelectorAll("a").length).toBe(0);
    const labels = buttons(host).map((b) => b.textContent ?? "");
    expect(labels.some((l) => /open automations|command center|marketplace|systems check|mind/i.test(l))).toBe(false);
  });

  it("fails closed with a retry surface and claims no connection state", async () => {
    rpc.mockImplementation((name: string) => Promise.resolve({
      data: null,
      error: name.startsWith("get_") ? { message: "read failed" } : null,
    }));
    const { host } = await render();
    expect(host.textContent).toMatch(/could not be read/i);
    expect(host.textContent).not.toMatch(/connected/i);
    expect(host.querySelector(".ig-grid")).toBeTruthy();
    expect(host.textContent).toContain("Status unavailable");
    expect(byText(host, "Try again")).toBeTruthy();
  });

  it("clears the previous account immediately and rejects its late response", async () => {
    const first = deferred<{ data: unknown; error: null }>();
    // Hold open ONLY the tenant-A read this test is about, by NAME. It used to hold the first two
    // calls by position, which silently stopped meaning "the n8n reads" the moment this surface
    // mounted more of them: the extra calls fell through to a reset mock returning `undefined`, and
    // the test ran out of doubles instead of exercising the switch. Scoping by name keeps it honest
    // however many reads the surface grows.
    world();
    const answered = rpc.getMockImplementation() as (name: string, ...rest: unknown[]) => unknown;
    rpc.mockImplementation((name: string, ...rest: unknown[]) =>
      name === "get_tenant_n8n_api_readiness" ? first.promise : answered(name, ...rest));
    const { host, root } = await render();

    context.tenantId = "tenant-b";
    world({ n8n: { configured: true, status: "connected", label: "Tenant B bridge" } });
    await act(async () => root.render(<MemoryRouter><SoloIntegrationsView /></MemoryRouter>));
    await act(async () => { await Promise.resolve(); });

    first.resolve({ data: { configured: true, status: "connected", label: "Late tenant A bridge" }, error: null });
    await act(async () => { await Promise.resolve(); });
    expect(host.textContent).not.toContain("Late tenant A bridge");
  });

  it("uses Zapier identity only when the safe MCP host proves Zapier", async () => {
    world({ mcp: { zapier: { configured: true, status: "connected", server_url_host: "https://mcp.zapier.com/x" } } });
    const { host } = await render();
    expect(host.textContent).toContain("Zapier");
  });

  it("never says a connection is live on the card before it has been proven", async () => {
    // A grant is not a working connection. Between the consent completing and the probe
    // succeeding the row is `pending_verification`, and the card must not read as active
    // in that window — nor fall back to a status code the owner has to interpret.
    world({ mcp: { zapier: { configured: true, enabled: true, status: "pending_verification", auth_token_last4: "aaaa" } } });
    const { host } = await render();
    const card = host.querySelector('.ig-card[data-provider="mcp"]');
    expect(card?.textContent).toContain("Setup not finished");
    expect(card?.textContent).not.toContain("Connected");
    expect(card?.textContent).not.toContain("Status not reported");
  });

  it("names the card for the provider AND says which kind of connection it is", async () => {
    // The slot can only ever hold Zapier — the setter writes that provider and that
    // endpoint, and the registry's CHECK refuses a Zapier row that is not OAuth. The
    // name used to be derived by sniffing the connected host, which meant an owner saw
    // a different card depending on state. It is now what the card IS.
    //
    // "MCP" WAS BANNED HERE AND IS NOW REQUIRED. Owner ruling, 2026-08-31: the old rule
    // treated the term as protocol jargon and hid it, which is defensible in the abstract
    // and failed the actual person. Someone who came looking for an MCP connection stood
    // on this screen and could not tell whether they had one. A sentence can be correct
    // and still leave a reader unable to recognise the thing in front of them; recognition
    // wins. The rest of the protocol vocabulary stays out — those are implementation
    // details a workspace never asked about, whereas "MCP" is the name of the thing they
    // came to connect.
    //
    // THE CATEGORY MOVED OFF THE CARD. Owner ruling, 2026-09-22: "Social is a category.
    // It's not the name of Instagram or TikTok or Facebook or YouTube." A category word
    // stamped under every tool inside it is eleven copies of a word the heading already
    // said. So the kind of connection is still recognisable — it is named once, on the
    // group that owns the card — and the card carries only what is its own.
    world();
    const { host } = await render();
    const card = host.querySelector('.ig-card[data-provider="mcp"]');
    expect(card?.textContent).toContain("Zapier");
    expect(card?.textContent).toContain("MCP");
    // The category names itself on the group heading, and only there.
    const group = card?.closest("section.ig-group");
    expect(group?.querySelector(".ig-group-head b")?.textContent).toBe("Automation");
    expect(card?.textContent).not.toContain("Automation");
    for (const jargon of ["bridge", "transport", "SSE", "Bearer", "JSON-RPC"]) {
      expect(card?.textContent).not.toContain(jargon);
    }
  });

  it("never reads one MCP provider's state onto the other", async () => {
    // The registry is provider-scoped. With BOTH connected and in deliberately
    // DIFFERENT states, a card that picked an arbitrary row would show the wrong
    // one — the frontend half of the same nondeterminism fixed in the systems
    // check. The Zapier card reports Zapier; n8n's registry state is not its own.
    world({
      mcp: {
        zapier: { configured: true, status: "error", server_url_host: "https://mcp.zapier.com/x" },
        n8n: { configured: true, status: "connected", server_url_host: "https://harness.app.n8n.cloud" },
      },
    });
    const { host } = await render();
    const bridge = host.querySelector('.ig-card[data-provider="mcp"]');
    // The card's NAME is now static, so it can no longer serve as the proof that the
    // right row was read. Its STATE can, and is the stronger signal anyway: the two
    // rows are in deliberately different states, so a card reading the wrong one shows
    // the wrong words. Zapier is in error; n8n's MCP row is connected.
    expect(bridge?.textContent).toContain("Needs attention");
    expect(bridge?.textContent).not.toContain("Connected");
    expect(bridge?.textContent).not.toContain("n8n");
    // The n8n card reports the shipped API-key connection, never n8n's MCP row —
    // that row is connected here, and the card must still say Not connected.
    expect(host.querySelector('.ig-card[data-provider="n8n"]')?.textContent).toContain("Not connected");
  });

  it("filters the catalogue with accessible pressed controls", async () => {
    world();
    const { host } = await render();
    const all = host.querySelectorAll(".ig-card").length;
    expect(all).toBeGreaterThan(1);
    await click(byText(host, "Documents"));
    const shown = host.querySelectorAll(".ig-card").length;
    expect(shown).toBeLessThan(all);
    // The chip carries its own count, and the count is the truth: filtering to a
    // category shows exactly as many tiles as the chip promised.
    const pressed = host.querySelector('.ig-bar button[aria-pressed="true"]');
    expect(pressed?.textContent).toContain("Documents");
    expect(pressed?.querySelector("em")?.textContent).toBe(String(shown));
  });

  it("offers no setup for a provider with no tenant-safe contract, and says so plainly", async () => {
    world();
    const { host } = await render();
    // Opening a card that owns no n8n seam must not read the n8n connection. Counted
    // across the open, not against zero: the view itself legitimately reads the caller's
    // write permission once on mount for the gateway section, and that read is not the
    // n8n panel's. QuickBooks still has no tenant-safe connection seam.
    const adminReads = () => rpc.mock.calls.filter((c) => c[0] === "is_current_user_tenant_admin").length;
    const before = adminReads();
    // Stripe now owns a canonical merchant contract. QuickBooks still lacks one.
    await openCard(host, "quickbooks");
    expect(host.querySelector('[role="dialog"]')?.textContent).toMatch(/not claimed|not offered here yet/i);
    expect(host.querySelector(".ig-form")).toBeNull();
    expect(adminReads()).toBe(before);
  });
});

describe("n8n connection flow", () => {
  it("connects from empty and never keeps the key after submitting", async () => {
    world();
    const { host } = await render();
    await openCard(host, "n8n");
    if (byText(host, "Connect API")) await click(byText(host, "Connect API"));
    expect(host.querySelector('[role="dialog"]')?.textContent).toMatch(/never displayed after this/i);

    const [url, key, label] = fields(host);
    await type(url, "https://mine.app.n8n.cloud");
    await type(key, "n8n_api_SUPERSECRET");
    await type(label, "My instance");
    await submit(host);

    const call = invoke.mock.calls.find((c) => c[0] === "tenant-n8n-api-connect");
    expect(call?.[1].body).toEqual({ action: "save", expected_tenant_id: "tenant-a", base_url: "https://mine.app.n8n.cloud", api_key: "n8n_api_SUPERSECRET", label: "My instance" });
    // The write carries no tenant argument: the seam derives and enforces it.
    expect(call?.[1]?.body.expected_tenant_id).toBe("tenant-a");
    // The key must be gone from the document the moment it is submitted.
    expect(host.innerHTML).not.toContain("SUPERSECRET");
    expect(fields(host).some((f) => f.value.includes("SUPERSECRET"))).toBe(false);
  });

  it("blocks submission until both the address and a key are present", async () => {
    world();
    const { host } = await render();
    await openCard(host, "n8n");
    if (byText(host, "Connect API")) await click(byText(host, "Connect API"));
    const connect = byText(host, "Save and check connection");
    expect((connect as HTMLButtonElement).disabled).toBe(true);
    await type(fields(host)[0], "https://mine.app.n8n.cloud");
    expect((byText(host, "Save and check connection") as HTMLButtonElement).disabled).toBe(true);
    await type(fields(host)[1], "k");
    expect((byText(host, "Save and check connection") as HTMLButtonElement).disabled).toBe(false);
  });

  it("shows an existing connection as stored, never the key", async () => {
    world({ n8n: { configured: true, status: "connected", label: "Ops", base_url: "https://ops.app.n8n.cloud", api_key_last4: "9f2a", workflow_count: 7 } });
    const { host } = await render();
    await openCard(host, "n8n");
    if (byText(host, "Connect API")) await click(byText(host, "Connect API"));
    const panel = host.querySelector('[role="dialog"]')?.textContent ?? "";
    expect(panel).toContain("ops.app.n8n.cloud");
    expect(panel).toContain("Stored");
    expect(panel).not.toContain("9f2a");

    expect(byText(host, "Reconnect API")).toBeTruthy();
    expect(byText(host, "Disconnect")).toBeTruthy();
  });

  it("reconnects a broken connection with the address prefilled and the key required again", async () => {
    world({ n8n: { configured: true, status: "error", base_url: "https://ops.app.n8n.cloud", api_key_last4: "9f2a" } });
    const { host } = await render();
    await openCard(host, "n8n");
    if (byText(host, "Connect API")) await click(byText(host, "Connect API"));
    expect(byText(host, "Reconnect")).toBeTruthy();
    await click(byText(host, "Reconnect"));
    const [url, key] = fields(host);
    expect(url.value).toBe("https://ops.app.n8n.cloud");
    expect(key.value).toBe("");
    expect((byText(host, "Save and check connection") as HTMLButtonElement).disabled).toBe(true);
  });

  it("disconnects only after an explicit confirmation", async () => {
    world({ n8n: { configured: true, status: "connected", api_key_last4: "9f2a" } });
    const { host } = await render();
    await openCard(host, "n8n");
    if (byText(host, "Connect API")) await click(byText(host, "Connect API"));
    await click(byText(host, "Disconnect"));
    expect(invoke.mock.calls.some((c) => c[0] === "tenant-n8n-api-connect" && c[1].body.action === "disconnect")).toBe(false);
    await click(byText(host, "Confirm disconnect"));
    expect(invoke.mock.calls.some((c) => c[0] === "tenant-n8n-api-connect" && c[1].body.action === "disconnect")).toBe(true);
  });

  it("re-reads the connection after a write so the panel reflects what persisted", async () => {
    world();
    const { host } = await render();
    await openCard(host, "n8n");
    if (byText(host, "Connect API")) await click(byText(host, "Connect API"));
    const before = rpc.mock.calls.filter((c) => c[0] === "get_tenant_n8n_api_readiness").length;
    await type(fields(host)[0], "https://mine.app.n8n.cloud");
    await type(fields(host)[1], "key");
    await submit(host);
    const after = rpc.mock.calls.filter((c) => c[0] === "get_tenant_n8n_api_readiness").length;
    expect(after).toBeGreaterThan(before);
  });

  it("denies a non-admin the controls and says who can change it", async () => {
    world({ admin: false, n8n: { configured: true, status: "connected", api_key_last4: "9f2a" } });
    const { host } = await render();
    await openCard(host, "n8n");
    if (byText(host, "Connect API")) await click(byText(host, "Connect API"));
    expect(host.querySelector('[role="dialog"]')?.textContent).toMatch(/only a workspace admin/i);
    expect(host.querySelector(".ig-form")).toBeNull();
    expect(byText(host, "Disconnect")).toBeFalsy();
    expect(byText(host, "Reconnect API")).toBeFalsy();
  });

  it("denies a non-admin the connect form on an unconfigured workspace", async () => {
    // The case where only the permission gate stands between a reader and the
    // form: with nothing configured, the form is what would otherwise render.
    world({ admin: false, n8n: { configured: false, status: "unconfigured" } });
    const { host } = await render();
    await openCard(host, "n8n");
    if (byText(host, "Connect API")) await click(byText(host, "Connect API"));
    expect(host.querySelector(".ig-form")).toBeNull();
    expect(fields(host).length).toBe(0);
    expect(byText(host, "Save and check connection")).toBeFalsy();
    expect(host.querySelector('[role="dialog"]')?.textContent).toMatch(/only a workspace admin/i);
  });

  it("reports a rejected write in the product's own words, never the database's", async () => {
    world({ writeError: { message: 'N8N_INSECURE_URL: instance URL must be https:// (SQLSTATE 22023) column "base_url_ct"' } });
    const { host } = await render();
    await openCard(host, "n8n");
    if (byText(host, "Connect API")) await click(byText(host, "Connect API"));
    await type(fields(host)[0], "http://mine.example");
    await type(fields(host)[1], "key");
    await submit(host);
    const panel = host.querySelector('[role="dialog"]')?.textContent ?? "";
    expect(panel).toMatch(/could not confirm the result/i);
    expect(panel).not.toMatch(/SQLSTATE|column "|N8N_INSECURE_URL/);
  });

  it("lets the owner retry after a failure, and clears the key on the failed attempt too", async () => {
    world({ writeError: { message: "forbidden" } });
    const { host } = await render();
    await openCard(host, "n8n");
    if (byText(host, "Connect API")) await click(byText(host, "Connect API"));
    await type(fields(host)[0], "https://mine.app.n8n.cloud");
    await type(fields(host)[1], "FAILEDSECRET");
    await submit(host);
    expect(host.querySelector('[role="dialog"]')?.textContent).toMatch(/only a workspace admin/i);
    // A failed save must not leave the secret sitting in the field.
    expect(host.innerHTML).not.toContain("FAILEDSECRET");

    world();
    await click(byText(host, "Try again"));
    await click(byText(host, "Connect API"));
    await type(fields(host)[0], "https://mine.app.n8n.cloud");
    await type(fields(host)[1], "goodkey");
    await submit(host);
    expect(invoke.mock.calls.some((c) => c[0] === "tenant-n8n-api-connect" && c[1].body.api_key === "goodkey")).toBe(true);
  });

  it("asks before discarding half-entered connection details", async () => {
    world();
    const { host } = await render();
    await openCard(host, "n8n");
    if (byText(host, "Connect API")) await click(byText(host, "Connect API"));
    await type(fields(host)[0], "https://half-typed.example");
    await click(host.querySelector(".ig-close") ?? undefined);
    // Still open, with an explicit choice.
    expect(host.querySelector('[role="dialog"]')).toBeTruthy();
    expect(host.textContent).toMatch(/unsaved API details/i);
    await click(byText(host, "Keep editing"));
    expect(host.querySelector(".ig-form")).toBeTruthy();
    await click(host.querySelector(".ig-close") ?? undefined);
    await click(byText(host, "Discard changes"));
    expect(host.querySelector('[role="dialog"]')).toBeNull();
  });

  it("closes without a prompt when nothing was typed", async () => {
    world();
    const { host } = await render();
    await openCard(host, "n8n");
    if (byText(host, "Connect API")) await click(byText(host, "Connect API"));
    await click(host.querySelector(".ig-close") ?? undefined);
    expect(host.querySelector('[role="dialog"]')).toBeNull();
  });
});

describe("Review findings", () => {
  it("keeps the Automations tab reachable from an unknown legacy leaf", async () => {
    world();
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    await act(async () => root.render(
      <MemoryRouter initialEntries={["/solo/1971670/settings/integrations/something-retired"]}>
        <SoloIntegrationsView />
      </MemoryRouter>,
    ));
    await act(async () => { await Promise.resolve(); });
    // Falls back to the catalogue...
    expect(host.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toContain("Integrations");
    // ...and the other tab still opens, rather than navigating to
    // `…/something-retired/automations`, which reads as the catalogue again.
    await click(byText(host, "Automations"));
    expect(host.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toContain("Automations");
    expect(host.querySelector(".ig-grid")).toBeNull();
  });

  it("refreshes the card grid after a connection is made", async () => {
    world();
    const { host } = await render();
    expect(host.querySelector('.ig-card[data-provider="n8n"]')?.textContent).toContain("Not connected");

    await openCard(host, "n8n");
    if (byText(host, "Connect API")) await click(byText(host, "Connect API"));
    await type(fields(host)[0], "https://mine.app.n8n.cloud");
    await type(fields(host)[1], "key");
    // The catalogue read must run again on success, or the card behind the
    // panel keeps claiming the old state.
    world({ n8n: { configured: true, status: "connected", api_key_last4: "9f2a" } });
    const before = rpc.mock.calls.filter((c) => c[0] === "get_tenant_mcp_connections").length;
    await submit(host);
    const after = rpc.mock.calls.filter((c) => c[0] === "get_tenant_mcp_connections").length;
    expect(after).toBeGreaterThan(before);
    expect(host.querySelector('.ig-card[data-provider="n8n"]')?.textContent).toContain("Connected");
  });

  it("refreshes the card grid after a disconnection", async () => {
    world({ n8n: { configured: true, status: "connected", api_key_last4: "9f2a" } });
    const { host } = await render();
    await openCard(host, "n8n");
    if (byText(host, "Connect API")) await click(byText(host, "Connect API"));
    await click(byText(host, "Disconnect"));
    world();
    await click(byText(host, "Confirm disconnect"));
    await act(async () => { await Promise.resolve(); });
    expect(host.querySelector('.ig-card[data-provider="n8n"]')?.textContent).toContain("Not connected");
  });

  it("does not offer to remove a name the seam cannot clear", async () => {
    world({ n8n: { configured: true, status: "connected", label: "Ops", base_url: "https://ops.app.n8n.cloud", api_key_last4: "9f2a" } });
    const { host } = await render();
    await openCard(host, "n8n");
    if (byText(host, "Connect API")) await click(byText(host, "Connect API"));
    await click(byText(host, "Reconnect API"));
    await type(fields(host)[2], "");
    expect(host.querySelector(".ig-form")?.textContent).toMatch(/changed here but not removed/i);

    // The load-bearing part: an emptied name is not a pending change, so
    // closing does not claim there are unsaved details. (Asserting the Save
    // button here would be vacuous — it is disabled anyway while the key is
    // blank, so it passes with or without the fix.)
    await click(host.querySelector(".ig-close") ?? undefined);
    expect(host.querySelector('[role="dialog"]')).toBeNull();
    expect(host.textContent).not.toMatch(/unsaved API details/i);
  });

  it("still treats a genuine name change as a pending change", async () => {
    world({ n8n: { configured: true, status: "connected", label: "Ops", base_url: "https://ops.app.n8n.cloud", api_key_last4: "9f2a" } });
    const { host } = await render();
    await openCard(host, "n8n");
    if (byText(host, "Connect API")) await click(byText(host, "Connect API"));
    await click(byText(host, "Reconnect API"));
    await type(fields(host)[2], "Ops renamed");
    await click(host.querySelector(".ig-close") ?? undefined);
    expect(host.textContent).toMatch(/unsaved API details/i);
  });

  it("returns focus to the card that opened the panel", async () => {
    world();
    const { host } = await render();
    const card = host.querySelector<HTMLButtonElement>('.ig-card[data-provider="stripe"]');
    card?.focus();
    await click(card ?? undefined);
    expect(host.querySelector('[role="dialog"]')).toBeTruthy();
    await click(host.querySelector(".ig-close") ?? undefined);
    expect(host.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(card);
  });
});

describe("Write-error language", () => {
  it("maps every modelled rejection without leaking its code", () => {
    const cases: Array<[string, RegExp]> = [
      ["forbidden", /workspace admin/i], ["unauthorized", /sign in again/i],
      ["tenant_changed", /workspace changed/i], ["not_configured", /save an n8n api/i],
      ["validation_busy", /already in progress/i],
      ['duplicate key value violates unique constraint "uniq_x"', /could not confirm/i],
    ];
    for (const [raw, expected] of cases) {
      const message = n8nWriteMessage(raw);
      expect(message).toMatch(expected);
      expect(message).not.toMatch(/N8N_|SQLSTATE|constraint|violates|column "/);
    }
  });
});

/**
 * The tool bridge — n8n's second, independent connection.
 *
 * The property under test throughout is that a SAVED connection and a PROVEN one are
 * never shown as the same thing. Every other connection surface on this platform has
 * been able to imply a working integration it never tested; this one cannot, because
 * only a server-side probe writes `connected` and the UI has separate words for every
 * state in between.
 */
// The approved n8n tabs replace the static-credential setup flow; coverage lives in settings-integrations.n8n-tabs.test.tsx.

describe("Zapier API and PAIGE tools are independent", () => {
  const panel = (host: HTMLElement) => host.querySelector<HTMLElement>(".ig-panel")!;
  const panelButton = (host: HTMLElement, text: string) => Array.from(panel(host).querySelectorAll("button")).find((b) => b.textContent?.includes(text));
  let assigned: string[] = [];
  beforeEach(() => {
    assigned = [];
    Object.defineProperty(window, "location", { configurable: true, value: { ...window.location, assign: (url: string) => assigned.push(url) } });
  });

  it("shows two independent card states and two manage tabs", async () => {
    world({ zapierApi: { state: "connected", accessible_zap_count: 3, last_checked_at: "2026-09-04T12:00:00Z", last_success_at: "2026-09-04T12:00:00Z" },
      mcp: { zapier: { configured: true, enabled: true, status: "error", auth_kind: "oauth" } } });
    const { host } = await render();
    const card = host.querySelector('.ig-card[data-provider="mcp"]')!;
    expect(card.textContent).toContain("API connectionConnected");
    expect(card.textContent).toContain("Paige tools (MCP)Needs attention");
    await openCard(host, "mcp");
    expect(panelButton(host, "API connection")?.getAttribute("aria-selected")).toBe("true");
    expect(panelButton(host, "Paige tools (MCP)")).toBeTruthy();
  });

  it("starts the provider API OAuth flow and sends no credential", async () => {
    world();
    invoke.mockImplementation((name: string, options: { body: Record<string, unknown> }) => {
      if (name === "tenant-zapier-api-connect" && options.body.action === "status") return Promise.resolve({ data: { ok: true, connection: { tenant_id: "tenant-a", can_manage: true, state: "not_connected", failure_code: null, accessible_zap_count: null, last_checked_at: null, last_success_at: null, capabilities: [], limitations: [] } }, error: null });
      if (name === "tenant-zapier-api-connect" && options.body.action === "oauth_begin") return Promise.resolve({ data: { ok: true, authorize_url: "https://api.zapier.com/v2/authorize?state=bound" }, error: null });
      return Promise.resolve({ data: { ok: true }, error: null });
    });
    const { host } = await render(); await openCard(host, "mcp"); await click(panelButton(host, "Connect API"));
    const body = invoke.mock.calls.at(-1)![1].body;
    expect(body).toEqual({ action: "oauth_begin", expected_tenant_id: "tenant-a" });
    expect(Object.keys(body).join(",")).not.toMatch(/token|secret|key|verifier/i);
    expect(assigned).toEqual(["https://api.zapier.com/v2/authorize?state=bound"]);
  });

  it("starts MCP OAuth from the exact Zapier server and clears it", async () => {
    world();
    invoke.mockResolvedValue({ data: { ok: true, authorize_url: "https://zapier.com/oauth/authorize?state=mcp" }, error: null });
    const { host } = await render(); await openCard(host, "mcp"); await click(panelButton(host, "Paige tools (MCP)"));
    const field=panel(host).querySelector<HTMLInputElement>('input[type="url"]')!;const address="https://mcp.zapier.com/api/mcp/s/server-id/mcp";await type(field,address);await submit(host);
    expect(invoke.mock.calls.at(-1)![1].body).toEqual({ provider:"zapier",action:"oauth_begin",server_url:address,expected_tenant_id:"tenant-a" });
    expect(field.value).toBe("");expect(assigned).toEqual(["https://zapier.com/oauth/authorize?state=mcp"]);
  });

  it("keeps MCP disconnect independent from the API connection", async () => {
    world({ zapierApi: { state:"connected",accessible_zap_count:1,last_checked_at:"2026-09-04T12:00:00Z",last_success_at:"2026-09-04T12:00:00Z" },
      mcp:{zapier:{configured:true,enabled:true,status:"connected",auth_kind:"oauth",approved_capabilities:[]}} });
    const {host}=await render();await openCard(host,"mcp");await click(panelButton(host,"Paige tools (MCP)"));await click(panelButton(host,"Disconnect"));await click(panelButton(host,"Disconnect"));
    expect([...invoke.mock.calls].reverse().find((call)=>call[1].body.action==="disconnect")![1].body).toEqual({provider:"zapier",expected_tenant_id:"tenant-a",action:"disconnect"});
    expect(invoke.mock.calls.some((c)=>c[0]==="tenant-zapier-api-connect"&&c[1].body.action==="disconnect")).toBe(false);
  });

  it("uses the same two-tab keyboard behavior as n8n", async () => {
    world();
    const { host } = await render(); await openCard(host, "mcp");
    const apiTab = panelButton(host, "API connection")!; apiTab.focus();
    await act(async () => apiTab.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })));
    expect(panelButton(host, "Paige tools (MCP)")?.getAttribute("aria-selected")).toBe("true");
    expect(document.activeElement).toBe(panelButton(host, "Paige tools (MCP)"));
  });

  it("lets the owner cancel an in-progress API authorization", async () => {
    world({ zapierApi: { state: "connecting" } });
    const { host } = await render(); await openCard(host, "mcp");
    await click(panelButton(host, "Cancel authorization"));
    expect(invoke.mock.calls.some((call) => call[0] === "tenant-zapier-api-connect" && call[1].body.action === "cancel")).toBe(true);
  });
  it("keeps cleanup visible when provider authorization is unavailable", async () => {
    world({ zapierApi: { state: "capability_unavailable", has_local_connection: true, has_pending_authorization: true } });
    const { host } = await render(); await openCard(host, "mcp");
    expect(panelButton(host, "Cancel authorization")).toBeTruthy();
    expect(panelButton(host, "Disconnect API")).toBeTruthy();
    expect(panelButton(host, "Run safe connection test")).toBeUndefined();
  });
});


describe("Capability approval", () => {
  const connected = (over = {}) => ({
    zapier: { configured: true, enabled: true, status: "connected", auth_kind: "oauth", auth_token_last4: "aaaa",
              transport: "http", server_url_host: "mcp.zapier.com", approved_capabilities: [], ...over },
  });
  const panel = (host: HTMLElement) => host.querySelector<HTMLElement>(".ig-panel")!;
  const capsButton = (host: HTMLElement, text: string) =>
    Array.from(panel(host).querySelectorAll("button")).find((b) => b.textContent?.includes(text));
  const capRows = (host: HTMLElement) =>
    Array.from(panel(host).querySelectorAll<HTMLButtonElement>(".ig-caplist button"));

  const TOOLS = [
    // `pin` and `schema_hash` deliberately DISAGREE: the pin covers the authority as well as
    // the schema, so a regression that sent the schema hash would be caught here rather than
    // passing because the two happened to match.
    { name: "send_email", description: "Send an email", pin: "c".repeat(64), schema_hash: "a".repeat(64), approved: false },
    { name: "delete_row", description: "Delete a row", pin: "d".repeat(64), schema_hash: "b".repeat(64), approved: false },
  ];

  it("is not offered until the connection has been PROVEN", async () => {
    // Offering approvals against an unproven connection would show a list that cannot
    // load — or record approvals for a provider we have never successfully reached.
    world({ mcp: connected({ status: "pending_verification" }) });
    const { host } = await render();
    await openCard(host, "mcp");
    await click(capsButton(host, "Paige tools (MCP)"));
    expect(panel(host).querySelector(".ig-capability-approval")).toBeNull();
  });

  it("says plainly that nothing is approved, and does not call the provider until asked", async () => {
    world({ mcp: connected() });
    const { host } = await render();
    await openCard(host, "mcp");
    await click(capsButton(host, "Paige tools (MCP)"));
    expect(panel(host).textContent).toContain("Nothing is approved yet");
    // Discovery is an outbound request; it does not happen just because a panel opened.
    expect(invoke.mock.calls.some((c) => c[1].body.action === "discover")).toBe(false);

    invoke.mockResolvedValue({ data: { ok: true, tools: TOOLS }, error: null });
    await click(capsButton(host, "See what is available"));
    expect(invoke.mock.calls.at(-1)![1].body).toEqual({ provider: "zapier", action: "discover", expected_tenant_id: "tenant-a" });
    expect(capRows(host).map((b) => b.textContent)).toHaveLength(2);
    expect(capRows(host).every((b) => b.getAttribute("aria-pressed") === "false")).toBe(true);
  });

  it("approves a name together with the contract it was shown with", async () => {
    world({ mcp: connected() });
    invoke.mockResolvedValue({ data: { ok: true, tools: TOOLS }, error: null });
    const { host } = await render();
    await openCard(host, "mcp");
    await click(capsButton(host, "Paige tools (MCP)"));
    await click(capsButton(host, "See what is available"));

    await click(capRows(host)[0]);
    invoke.mockResolvedValue({ data: { ok: true, approved_count: 1, pinned_count: 1 }, error: null });
    await click(capsButton(host, "Approve 1 of 2"));

    const body = [...invoke.mock.calls].reverse().find((call) => call[1].body.action === "approve")![1].body;
    expect(body.action).toBe("approve");
    expect(body.capabilities).toEqual(["send_email"]);
    // The pin is the fingerprint of the contract on screen. Without it the server has no
    // way to tell the provider changed between looking and approving.
    expect(body.pins).toEqual({ send_email: "c".repeat(64) });
    // And nothing was approved that was never ticked.
    expect(body.capabilities).not.toContain("delete_row");
  });

  it("approves the whole list, so unticking withdraws", async () => {
    world({ mcp: connected() });
    invoke.mockResolvedValue({ data: { ok: true, tools: TOOLS.map((t) => ({ ...t, approved: true })) }, error: null });
    const { host } = await render();
    await openCard(host, "mcp");
    await click(capsButton(host, "Paige tools (MCP)"));
    await click(capsButton(host, "See what is available"));
    expect(capRows(host).every((b) => b.getAttribute("aria-pressed") === "true")).toBe(true);

    await click(capRows(host)[1]);
    invoke.mockResolvedValue({ data: { ok: true }, error: null });
    await click(capsButton(host, "Approve 1 of 2"));
    // A statement of the whole set, not an addition to it.
    expect([...invoke.mock.calls].reverse().find((call) => call[1].body.action === "approve")![1].body.capabilities).toEqual(["send_email"]);
  });

  it("refuses to record consent to a list that moved, and reloads it", async () => {
    world({ mcp: connected() });
    invoke.mockResolvedValue({ data: { ok: true, tools: TOOLS }, error: null });
    const { host } = await render();
    await openCard(host, "mcp");
    await click(capsButton(host, "Paige tools (MCP)"));
    await click(capsButton(host, "See what is available"));
    await click(capRows(host)[0]);

    invoke.mockResolvedValue({ data: { error: "capabilities_changed", changed: ["send_email"] }, error: null });
    await click(capsButton(host, "Approve 1 of 2"));

    expect(panel(host).textContent).toContain("changed while you were choosing");
    expect(panel(host).textContent).toContain("nothing was approved");
    // The list on screen is stale; leaving it up would invite approving it again.
    expect(invoke.mock.calls.at(-1)![1].body.action).toBe("discover");
  });

  it("cannot save until something actually changed", async () => {
    world({ mcp: connected() });
    invoke.mockResolvedValue({ data: { ok: true, tools: TOOLS }, error: null });
    const { host } = await render();
    await openCard(host, "mcp");
    await click(capsButton(host, "Paige tools (MCP)"));
    await click(capsButton(host, "See what is available"));
    expect((capsButton(host, "Approve 0 of 2") as HTMLButtonElement).disabled).toBe(true);
    await click(capRows(host)[0]);
    expect((capsButton(host, "Approve 1 of 2") as HTMLButtonElement).disabled).toBe(false);
  });

  it("is not offered to someone who cannot grant it", async () => {
    world({ admin: false, mcp: connected() });
    const { host } = await render();
    await openCard(host, "mcp");
    await click(capsButton(host, "Paige tools (MCP)"));
    expect(panel(host).querySelector(".ig-capability-approval")).toBeNull();
  });
});

describe("Social tenant-owned connection flow", () => {
  const tenantId = "0f0f0f0f-1111-4111-8111-222222222222";
  const connectionId = "11111111-2222-4222-8222-333333333333";
  const accountId = "44444444-5555-4555-8555-666666666666";

  it("starts empty and assumes no workspace, identity, account, or target", async () => {
    context.tenantId = tenantId;
    world({ socialConnections: [], socialAccounts: [] });
    const { host } = await render("/solo/workspace/settings/integrations");
    const card = host.querySelector('.ig-card[data-provider="social-instagram"]');
    expect(card?.textContent).toContain("Setup required");
    expect(host.querySelector('.ig-card[data-provider="social-facebook"]')).not.toBeNull();
    expect(host.querySelector('.ig-card[data-provider="social-youtube"]')).not.toBeNull();
    expect(host.querySelector('.ig-card[data-provider="social-reddit"]')?.textContent).toContain("OAuth unavailable");
    await openCard(host, "social-instagram");
    expect(host.textContent).toContain("No Instagram accounts are connected");
    expect(host.textContent).toContain("Connect Instagram");
    expect(host.textContent).not.toContain("Upload-Post");
    await click(byText(host, "Connect Instagram"));
    expect(invoke).toHaveBeenCalledWith("paige-social", {
      body: {
        action: "start",
        return_path: "/solo/workspace/settings/integrations",
        platform: "instagram",
        label: null,
        expected_tenant_id: tenantId,
      },
    });
  });


  it("keeps loaded platform status truthful when a connection action returns a structured HTTP error", async () => {
    context.tenantId = tenantId;
    world({});
    const fallback = invoke.getMockImplementation();
    invoke.mockImplementation((name: string, options: { body: Record<string, unknown> }) => {
      if (name === "paige-social") return Promise.resolve({
        data: null,
        error: { context: new Response(JSON.stringify({ ok: false, code: "capability_unavailable" }), { status: 503 }) },
      });
      return fallback?.(name, options);
    });
    const { host } = await render("/solo/workspace/settings/integrations");
    await openCard(host, "social-instagram");
    await click(byText(host, "Connect Instagram"));
    expect(host.textContent).toContain("Social connection setup is not configured for this environment.");
    expect(host.querySelector('.ig-card[data-provider="social-facebook"]')?.textContent).toContain("Setup required");
    expect(host.querySelector('.ig-card[data-provider="social-facebook"]')?.textContent).not.toContain("Status unavailable");
  });


  it("keeps multiple identities on the same platform separate and tenant-owned", async () => {
    context.tenantId = tenantId;
    const secondConnectionId = "77777777-8888-4888-8888-999999999999";
    world({
      socialConnections: [
        { id: connectionId, requested_platform: "youtube", status: "connected", account_count: 1 },
        { id: secondConnectionId, requested_platform: "youtube", status: "connected", account_count: 1 },
      ],
      socialAccounts: [
        {
          id: accountId, connection_id: connectionId, platform: "youtube",
          display_name: "Test channel 21", status: "connected", selected: false, capabilities: ["video"],
        },
        {
          id: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee", connection_id: secondConnectionId, platform: "youtube",
          display_name: "Test channel 34", status: "connected", selected: false, capabilities: ["video"],
        },
      ],
    });
    const { host } = await render("/solo/workspace/settings/integrations");
    await openCard(host, "social-youtube");
    expect(host.textContent).toContain("Test channel 21");
    expect(host.textContent).toContain("Test channel 34");
    expect(host.textContent).toContain("Add another YouTube account");
  });
  it("renders only provider-read accounts for the active tenant and never chooses a target implicitly", async () => {
    context.tenantId = tenantId;
    world({
      socialConnections: [{
        id: connectionId, label: null, status: "connected",
        last_verified_at: "2026-09-12T20:00:00Z", account_count: 1,
        requested_platform: "instagram",
      }],
      socialAccounts: [{
        id: accountId, connection_id: connectionId, platform: "instagram",
        display_name: "Test identity 7", handle: "@test_identity_7",
        status: "connected", selected: false, capabilities: ["video", "analytics"],
        last_verified_at: "2026-09-12T20:00:00Z",
      }],
    });
    const { host } = await render("/solo/workspace/settings/integrations");
    await openCard(host, "social-instagram");
    expect(host.textContent).toContain("Test identity 7");
    expect(host.textContent).toContain("@test_identity_7");
    expect(host.textContent).toContain("Select this account");
    expect(host.textContent).not.toContain("Selected");
  });

  it("requires an exact one-time approval before selecting a discovered account", async () => {
    context.tenantId = tenantId;
    world({
      socialConnections: [{ id: connectionId, requested_platform: "linkedin", status: "connected", account_count: 1 }],
      socialAccounts: [{
        id: accountId, connection_id: connectionId, platform: "linkedin",
        display_name: "Test identity 9", status: "connected", selected: false, capabilities: [],
      }],
    });
    const fallback = invoke.getMockImplementation();
    invoke.mockImplementation((name: string, options: { body: Record<string, unknown> }) => {
      if (name === "paige-social") return Promise.resolve({
        data: {
          ok: false,
          state: "approval_required",
          approval: {
            fingerprint: "0123456789abcdef",
            summary: "Select this connected Social account. Nothing will be published.",
            expires_at: "2026-09-12T22:00:00Z",
          },
        },
        error: null,
      });
      return fallback?.(name, options);
    });
    const { host } = await render("/solo/workspace/settings/integrations");
    await openCard(host, "social-linkedin");
    await click(byText(host, "Select this account"));
    expect(invoke).toHaveBeenCalledWith("paige-social", {
      body: {
        action: "select",
        connection_id: connectionId,
        account_id: accountId,
        expected_tenant_id: tenantId,
      },
    });
    expect(host.textContent).toContain("Confirm this Social change");
    expect(host.textContent).toContain("Nothing will be published");
  });

  it("uses only the canonical approval for disconnect", async () => {
    context.tenantId = tenantId;
    world({
      socialConnections: [{ id: connectionId, requested_platform: "x", status: "connected", account_count: 1 }],
      socialAccounts: [{
        id: accountId, connection_id: connectionId, platform: "x",
        display_name: "Test identity 11", status: "connected", selected: true, capabilities: [],
      }],
    });
    const fallback = invoke.getMockImplementation();
    invoke.mockImplementation((name: string, options: { body: Record<string, unknown> }) => {
      if (name === "paige-social" && options.body.action === "disconnect") return Promise.resolve({
        data: {
          ok: false,
          state: "approval_required",
          approval: {
            fingerprint: "fedcba9876543210",
            summary: "Disconnect this Social identity and revoke its provider profile.",
            expires_at: "2026-09-12T22:00:00Z",
          },
        },
        error: null,
      });
      return fallback?.(name, options);
    });
    const { host } = await render("/solo/workspace/settings/integrations");
    await openCard(host, "social-x");
    await click(byText(host, "Disconnect"));
    expect(host.textContent).toContain("Confirm this Social change");
    expect(host.textContent).toContain("Disconnect this Social identity");
    expect(host.textContent).not.toContain("Continue");
    expect(invoke.mock.calls.filter(([name, options]) =>
      name === "paige-social" && options.body.action === "disconnect"
    )).toHaveLength(1);
  });

  it("does not expose callback secrets and treats a verified return as readback, not selection", async () => {
    context.tenantId = tenantId;
    world({
      socialConnections: [{ id: connectionId, requested_platform: "facebook", status: "connected", account_count: 1 }],
      socialAccounts: [{
        id: accountId, connection_id: connectionId, platform: "facebook",
        display_name: "Test identity 12", status: "connected", selected: false, capabilities: [],
      }],
    });
    const { host } = await render("/solo/workspace/settings/integrations?social_result=verified&social_receipt=recorded");
    await openCard(host, "social-facebook");
    expect(host.textContent).toContain("Social accounts were verified");
    expect(host.textContent).toContain("Choose the account");
    expect(host.textContent).not.toContain("Selected");
    expect(invoke.mock.calls.some(([name, options]) =>
      name === "paige-social" && Object.prototype.hasOwnProperty.call(options?.body ?? {}, "callback_token")
    )).toBe(false);
  });
});

/* ── One tool, one tile (owner ruling 2026-09-24) ─────────────────────────────
   The shipped provider tiles and the gateway's connection tiles come from two
   sources that never compared notes, so a tenant who had connected n8n saw n8n
   twice — once here offering setup, once beside it as the connection they had.
   With Zapier doing the same, two connections read as six tiles. */
describe("a connected tool does not also render as a tile offering to set it up", () => {
  const conn = (over: Record<string, unknown> = {}) => ({
    connection_id: "c1", provider_key: "n8n", label: "n8n (API)", transport: "http",
    auth_kind: "api_key", configured: true, enabled: true, status: "connected",
    health: "healthy", last_checked_at: "2026-09-20T10:00:00Z",
    server_url_host: "team.app.n8n.cloud", tool_count: 3, approved_count: 0, ...over,
  });

  it("drops the duplicate once the tenant holds that vendor", async () => {
    world({ gateway: [conn()] });
    const { host } = await render();
    expect(host.querySelector('.ig-card[data-provider="n8n"]')).toBeNull();
    // and the connection itself is still on screen, so nothing was lost by dropping it
    expect(host.querySelector('[data-owner="gateway"][data-gateway-tool]')).toBeTruthy();
  });

  it("keeps the tile for a vendor the tenant has NOT connected", async () => {
    world({ gateway: [conn({ provider_key: "n8n" })] });
    const { host } = await render();
    // n8n is covered; Zapier is not, so its shipped tile stays exactly where it was
    expect(host.querySelector('.ig-card[data-provider="mcp"]')).toBeTruthy();
  });

  it("changes nothing at all for a tenant with no connections", async () => {
    world({ gateway: [] });
    const { host } = await render();
    expect(host.querySelector('.ig-card[data-provider="n8n"]')).toBeTruthy();
    expect(host.querySelector('.ig-card[data-provider="mcp"]')).toBeTruthy();
  });

  it("suppresses nothing while the connection list is unread", async () => {
    // An unread list must never make a shipped tile vanish: that would hide setup from
    // someone whose read merely failed. Empty gateway data is the same shape as loading.
    world({ gateway: [] });
    const { host } = await render();
    expect(host.querySelector('.ig-card[data-provider="n8n"]')).toBeTruthy();
  });

  it("counts what is actually on screen", async () => {
    // The "All" chip and the Automation chip both had to stop counting a tile that no longer
    // renders, or the number disagrees with the grid underneath it. Read from the filter bar,
    // which is where those counts actually live — an assertion aimed at the wrong element
    // passes whatever the code does, which is worse than having no assertion at all.
    const countOnChip = (host: HTMLElement, label: string) => {
      const chip = Array.from(host.querySelectorAll<HTMLElement>('.ig-bar button'))
        .find((b) => b.textContent?.includes(label));
      return Number(chip?.querySelector("em")?.textContent ?? "-1");
    };
    world({ gateway: [] });
    const bare = await render();
    const beforeAll = countOnChip(bare.host, "All");
    const beforeAuto = countOnChip(bare.host, "Automation");
    expect(beforeAll).toBeGreaterThan(0);
    bare.root.unmount();

    world({ gateway: [conn()] });
    const { host } = await render();
    // One shipped tile suppressed, one connection tile gained: both chips hold steady. Without
    // the suppression each would have climbed by one while the grid showed the same tools twice.
    expect(countOnChip(host, "All")).toBe(beforeAll);
    expect(countOnChip(host, "Automation")).toBe(beforeAuto);
  });
});
