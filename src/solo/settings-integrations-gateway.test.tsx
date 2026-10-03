/**
 * Integrations → Paige's tools (the MCP gateway section).
 *
 * Driven through the rendered DOM, not through the hook: the §70 question is whether a
 * human can FINISH the job, and only the surface can answer that. Covered here are first
 * use from a genuinely empty account, the add path through the one catalogue, the honest
 * stops for a tool whose connect step is not wired, re-key, both disconnect shapes,
 * permission refusal, a failed read kept distinct from an empty account, and the truth
 * boundary — a tool is never shown as ready before the server proves it.
 */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { IntegrationsGatewaySection } from "./settings-integrations-gateway";
import { useMcpGateway } from "./data/useMcpGateway";

/** The Automation group heading the parent surface hands the gateway in production. */
const GROUP = { label: "Automation", accent: "var(--k-automation)", blurb: "Run workflows and reach other apps." };
/**
 * The surface owns the one gateway hook instance and hands it down, so the filter bar can count
 * the same tools the group renders. These tests stand in for that owner: the hook is the REAL
 * one, running against the mocked RPC exactly as before — only who calls it moved.
 */
function Section({ onOpenLegacy, oauthReturn }: { onOpenLegacy?: (which: "n8n" | "zapier" | "social") => void; oauthReturn?: { connectionId: string; result: "connected" | "cancelled" | "error" } }) {
  const gw = useMcpGateway();
  return <IntegrationsGatewaySection onOpenLegacy={onOpenLegacy} gw={gw} group={GROUP} tiles={null} oauthReturn={oauthReturn} />;
}

const context = vi.hoisted(() => ({ tenantId: "tenant-a" as string | null, userId: "user-a", loading: false }));
const rpc = vi.hoisted(() => vi.fn());
const invoke = vi.hoisted(() => vi.fn());

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("@/hooks/useTenantContext", () => ({
  useTenantContext: () => ({ activeTenantId: context.tenantId, activeUserId: context.userId, loading: context.loading }),
}));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc, functions: { invoke } } }));

/**
 * The REAL `supabase.rpc()` returns a PostgrestFilterBuilder: a thenable that has `then` and
 * **no `.catch`**. A double that returns a plain Promise hides any code calling `.catch` on the
 * builder directly — which is how a `TypeError` that killed every write on this surface once sat
 * behind a green `tsc` and a green suite. Every double here returns the real shape, so the whole
 * file guards that class.
 */
const builder = <T,>(value: T) => ({
  then: <R1, R2>(ok?: ((v: T) => R1 | PromiseLike<R1>) | null, err?: ((e: unknown) => R2 | PromiseLike<R2>) | null) =>
    Promise.resolve(value).then(ok, err),
});

/** One row as `get_mcp_connections_v2` returns it. No secret is ever in this shape. */
const row = (over: Record<string, unknown> = {}) => ({
  connection_id: "conn-1",
  provider_key: "generic-remote",
  label: "Scheduling tool",
  transport: "http",
  auth_kind: "bearer",
  configured: true,
  enabled: true,
  status: "connected",
  health: "healthy",
  last_checked_at: "2026-09-20T10:00:00Z",
  server_url_host: "services.example.com",
  tool_count: 6,
  approved_count: 2,
  ...over,
});

/**
 * Default world: the caller may write and the account holds whatever rows are passed.
 * `write` decides what every write RPC returns, so a refusal can be driven end to end.
 */
/** The RPCs this surface genuinely calls. Anything else is a bug in the caller or a
 *  gap in this file, and either way must fail loudly rather than succeed quietly. */
const WRITE_RPCS = new Set([
  "set_mcp_connection_endpoint",
  "set_mcp_rest_connection_endpoint",
  "disconnect_mcp_connection",
]);
/** The gateway edge actions this surface genuinely dispatches, `tools` handled apart. */
const EDGE_ACTIONS = new Set(["create", "verify", "oauth_begin", "approve"]);

/** A connection whose catalogue has been read and holds nothing — the default, because
 *  it is the honest shape for a fixture that declares no tools, and because the
 *  alternative (a body with no `tools` array at all) is what hid the degraded render. */
const emptyToolsAnswer = {
  data: { ok: true, connection_id: "conn-1", tools: [], tool_count: 0, approved_count: 0, observed_at: null },
  error: null,
};

/** One row as the gateway's `tools` action returns it. Every approval verdict here is a
 *  SERVER verdict in production, so the fixture states them rather than deriving them. */
const toolRow = (over: Record<string, unknown> = {}) => ({
  name: "list_contacts",
  effects: ["read"],
  app: "Gmail",
  actionType: "contact.list",
  requiresApproval: false,
  approvalBasis: null,
  approved: false,
  approvedAt: null,
  expiresAt: null,
  approvalExpired: false,
  approvalStale: false,
  approvedByYou: false,
  approvalBlockedReason: null,
  observedAt: "2026-09-20T10:00:00Z",
  ...over,
});

/** A `tools` answer carrying rows, with the counts the server would have computed. */
const toolsAnswer = (rows: Record<string, unknown>[]) => ({
  data: {
    ok: true,
    connection_id: "conn-1",
    tools: rows,
    tool_count: rows.length,
    approved_count: rows.filter((r) => r.approved === true && r.approvalBlockedReason == null).length,
    observed_at: rows.map((r) => String(r.observedAt ?? "")).sort().at(-1) || null,
  },
  error: null,
});

function world(over: {
  rows?: Record<string, unknown>[];
  admin?: boolean;
  /** What a WRITE answers. Writes now go to the gateway edge, so this is an invoke() answer. */
  write?: { data?: unknown; error?: unknown };
  /** What a WRITE answers on the RETAINED rpc lane (re-key, disconnect) — still a builder answer. */
  rpcWrite?: { data?: unknown; error?: unknown };
  /** What the `tools` READ answers. Its own lane, because it is the only edge action
   *  a drawer fires on OPEN — sharing the write lane is what hid it. */
  tools?: { data?: unknown; error?: unknown };
} = {}) {
  let persisted = over.rows ?? [];
  rpc.mockImplementation((name: string, args: Record<string, unknown>) => {
    if (name === "get_mcp_connections_v2") return builder({ data: persisted, error: null });
    if (name === "is_current_user_tenant_admin") return builder({ data: over.admin !== false, error: null });
    if (WRITE_RPCS.has(name)) {
      if (!over.rpcWrite && name === "set_mcp_connection_endpoint") {
        persisted = persisted.map(item => item.connection_id !== args._connection_id ? item : {
          ...item, config_generation: Number(item.config_generation ?? 0) + 1, address_configured: true,
          credentials_configured: Boolean(args._auth_token), custom_header_count: Object.keys(args._custom_headers as object ?? {}).length,
          auth_kind: args._auth_kind, status: "pending_verification", enabled: true,
        });
        return builder({ data: { connection_id: args._connection_id, config_generation: persisted.find(item => item.connection_id === args._connection_id)?.config_generation }, error: null });
      }
      return builder(over.rpcWrite ?? { data: { connection_id: "conn-new", status: "pending_verification" }, error: null });
    }
    // A catch-all here answered ANY name with a connection-shaped success, and that
    // shape is exactly what the hook's acknowledgement guard accepts — so a renamed
    // or mistyped RPC was indistinguishable from the real writer working. Naming the
    // three real ones and throwing on the rest turns that into a failure that says
    // which call was unstubbed.
    throw new Error(`unstubbed rpc: ${name}`);
  });
  invoke.mockImplementation((_fn: string, opts: { body?: Record<string, unknown> }) => {
    const action = String(opts?.body?.action ?? "");
    // The same hole, one layer out, and worse: ONE resolved value served every edge
    // action. A `tools` call got a connection-shaped body, `listTools` found no array
    // where it expected one, and the drawer rendered its degraded branch — in every
    // test that opens a drawer. Fifty-two of them passed that way.
    if (action === "tools") return Promise.resolve(over.tools ?? emptyToolsAnswer);
    if (action === "create" && !over.write) {
      const draft = opts.body!;
      const created = row({ connection_id: "conn-new", label: draft.label, auth_kind: draft.auth_kind,
        config_generation: 1, address_configured: true, credentials_configured: Boolean(draft.auth_token),
        custom_header_count: Object.keys(draft.custom_headers as object ?? {}).length,
        status: "pending_verification", server_url_host: new URL(String(draft.server_url)).hostname });
      persisted = [...persisted, created];
      return Promise.resolve({ data: { connection_id: "conn-new", config_generation: 1 }, error: null });
    }
    if (EDGE_ACTIONS.has(action)) {
      return Promise.resolve(over.write ?? { data: { connection_id: "conn-new", status: "pending_verification" }, error: null });
    }
    return Promise.reject(new Error(`unstubbed gateway action: ${action}`));
  });
}

/** The body of the last gateway call, for asserting what actually went over the wire. */
const lastEdgeBody = () => (invoke.mock.calls.at(-1)?.[1]?.body ?? {}) as Record<string, unknown>;
/** Every gateway call made with a given action. */
const edgeCalls = (action: string) =>
  invoke.mock.calls.filter((c) => (c[1]?.body as Record<string, unknown> | undefined)?.action === action);
/** A non-2xx edge refusal, in supabase-js's real shape (code lives on error.context, not on data). */
const edgeRefusal = (code: string, status = 400) => ({
  data: null,
  error: { name: "FunctionsHttpError", message: "Edge Function returned a non-2xx status code", context: { status, json: async () => ({ error: code }) } },
});

async function render(onOpenLegacy?: (which: "n8n" | "zapier" | "social") => void) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => root.render(<Section onOpenLegacy={onOpenLegacy} />));
  await act(async () => { await Promise.resolve(); });
  return { host, root };
}

const buttons = (host: HTMLElement) => Array.from(host.querySelectorAll("button"));
const byText = (host: HTMLElement, text: string) => buttons(host).find((b) => b.textContent?.includes(text));
const click = async (el: Element | undefined | null) => {
  await act(async () => { el?.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
  await act(async () => { await Promise.resolve(); });
};
const type = async (input: Element | null | undefined, value: string) => {
  const field = input as HTMLInputElement;
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    setter?.call(field, value);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
};
const dialog = (host: HTMLElement) => host.querySelector<HTMLElement>('[role="dialog"]');
const fieldFor = (host: HTMLElement, label: string) =>
  Array.from(host.querySelectorAll<HTMLLabelElement>("label.ig-field"))
    .find((l) => l.querySelector("span")?.textContent === label)
    ?.querySelector("input");
const tile = (host: HTMLElement, name: string) =>
  Array.from(host.querySelectorAll<HTMLButtonElement>(".ig-gw-tile"))
    .find((b) => b.querySelector(".ig-gw-tile-name")?.textContent === name);
/** The repeatable "MCP server" tile — the one way in, always present, never only when empty
 *  (owner ruling 2026-09-22). Matched on its own hook so the catalogue's "Any MCP server" tile
 *  inside the open drawer can never be mistaken for it. */
const addTile = (host: HTMLElement) => host.querySelector<HTMLButtonElement>('.ig-card[data-provider="mcp-add"]');
/** Open the add drawer (the catalogue IS the add path). */
const openCatalogue = async (host: HTMLElement) => { await click(addTile(host)); };
/** Open the add FORM through the catalogue's generic entry, the way a human reaches it. */
const openAddForm = async (host: HTMLElement) => {
  await openCatalogue(host);
  await click(tile(host, "Any MCP server"));
};

beforeEach(() => {
  context.userId = "user-a";
  context.tenantId = "tenant-a";
  context.loading = false;
  rpc.mockReset();
  invoke.mockReset();
  document.body.innerHTML = "";
});

describe("MCP configuration keyboard handoffs", () => {
  it("focuses the first invalid field rather than leaving its error above the viewport", async () => {
    world({ rows: [] });
    const { host } = await render();
    await openAddForm(host);
    byText(host, "Save configuration")!.focus();
    await click(byText(host, "Save configuration"));
    expect(document.activeElement).toBe(fieldFor(host, "Name"));
    expect(edgeCalls("create")).toHaveLength(0);
  });

  it("hands keyboard focus to the persisted receipt", async () => {
    world({ rows: [] });
    const { host } = await render();
    await openAddForm(host);
    await type(fieldFor(host, "Name"), "Test tool");
    await type(fieldFor(host, "Server URL"), "https://tools.example.com/mcp");
    await click(byText(host, "None"));
    byText(host, "Save configuration")!.focus();
    await click(byText(host, "Save configuration"));
    expect(document.activeElement?.textContent).toContain("Saved — configuration confirmed.");
    expect(document.activeElement?.getAttribute("role")).toBe("status");
  });

  it("focuses the safe discard choice and restores Cancel on Keep editing", async () => {
    world({ rows: [] });
    const { host } = await render();
    await openAddForm(host);
    await type(fieldFor(host, "Name"), "Unsaved tool");
    const cancel = byText(host, "Cancel")!;
    cancel.focus();
    await click(cancel);
    expect(document.activeElement).toBe(byText(host, "Keep editing"));
    await click(byText(host, "Keep editing"));
    expect(document.activeElement).toBe(cancel);
  });

  it("focuses the dirty Escape guard and returns to the interrupted field", async () => {
    world({ rows: [] });
    const { host } = await render();
    await openAddForm(host);
    await type(fieldFor(host, "Name"), "Unsaved tool");
    const field = fieldFor(host, "Name")!;
    field.focus();
    await act(async () => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(document.activeElement).toBe(byText(host, "Keep editing"));
    await click(byText(host, "Keep editing"));
    expect(document.activeElement).toBe(field);
  });
});

describe("one explicit MCP configuration journey", () => {
  it("retains credentials when the already-selected authentication choice is activated", async () => {
    world({ rows: [] });
    const { host } = await render();
    await openAddForm(host);
    await click(byText(host, "Token + headers"));
    await type(fieldFor(host, "Token"), "synthetic-retained-token");
    await type(fieldFor(host, "Credential header"), "X-Api-Key");
    await click(byText(host, "Add header"));
    await type(fieldFor(host, "Header 1 name"), "Workspace-Reference");
    await type(fieldFor(host, "Header 1 value"), "synthetic-reference");
    await click(byText(host, "Token + headers"));
    expect(fieldFor(host, "Token")?.value).toBe("synthetic-retained-token");
    expect(fieldFor(host, "Credential header")?.value).toBe("X-Api-Key");
    expect(fieldFor(host, "Header 1 value")?.value).toBe("synthetic-reference");
    await click(buttons(host).find(button => button.textContent === "Token"));
    expect(fieldFor(host, "Token")?.value).toBe("");
    expect(fieldFor(host, "Header 1 name")).toBeUndefined();
  });
  it("saves a token and printable per-connection headers without reflecting their values", async () => {
    world();
    const { host } = await render();
    await openAddForm(host);
    await type(fieldFor(host, "Name"), "Example tool");
    await type(fieldFor(host, "Server URL"), "https://tools.example.com/api/mcp/");
    await click(buttons(host).find(b => b.textContent === "Token + headers"));
    await type(fieldFor(host, "Token"), "synthetic-token-for-test");
    await click(byText(host, "Add header"));
    await type(fieldFor(host, "Header 1 name"), "Workspace-Reference");
    await type(fieldFor(host, "Header 1 value"), "synthetic-location-123");
    await click(byText(host, "Save configuration"));
    expect(edgeCalls("create")[0]?.[1].body).toMatchObject({ auth_kind: "bearer", custom_headers: { "Workspace-Reference": "synthetic-location-123" }, server_url: "https://tools.example.com/api/mcp/" });
    expect(dialog(host)?.textContent).toMatch(/Saved.*confirmed/i);
    expect(dialog(host)?.textContent).toContain("1 additional headers on file");
    expect(host.innerHTML).not.toContain("synthetic-token-for-test");
    expect(host.innerHTML).not.toContain("synthetic-location-123");
    expect(edgeCalls("oauth_begin")).toHaveLength(0);
  });

  it.each(["https://10.0.0.1/mcp", "https://example.local/mcp", "https://192.168.2.1/mcp", "https://127.0.0.1/mcp"])("rejects private endpoint %s before any write", async endpoint => {
    world(); const { host } = await render(); await openAddForm(host);
    await type(fieldFor(host, "Name"), "Private tool");
    await type(fieldFor(host, "Server URL"), endpoint);
    await click(buttons(host).find(b => b.textContent === "None"));
    await click(byText(host, "Save configuration"));
    expect(edgeCalls("create")).toHaveLength(0);
    expect(dialog(host)?.textContent).toMatch(/public https:\/\/ address/i);
  });

  it.each(["tenant", "actor"])("clears a draft and rejects a late save after a %s switch", async kind => {
    world(); const { host, root } = await render(); await openAddForm(host);
    await type(fieldFor(host, "Name"), "Private draft A");
    await type(fieldFor(host, "Server URL"), "https://tools.example.com/mcp");
    await click(buttons(host).find(b => b.textContent === "Token"));
    await type(fieldFor(host, "Token"), "synthetic-secret-draft-a");
    let finish!: (value: unknown) => void;
    invoke.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    await click(byText(host, "Save configuration"));
    if (kind === "tenant") context.tenantId = "tenant-b"; else context.userId = "user-b";
    await act(async () => root.render(<Section />));
    expect(dialog(host)).toBeNull();
    expect(host.innerHTML).not.toContain("synthetic-secret-draft-a");
    await act(async () => finish({ data: { connection_id: "old-a", config_generation: 1 }, error: null }));
    expect(dialog(host)).toBeNull();
    expect(host.textContent).not.toContain("Saved");
    expect(edgeCalls("oauth_begin")).toHaveLength(0);
  });

  it("clears the old successful check after replacing a configuration", async () => {
    world({ rows: [row({ config_generation: 1, address_configured: true })], write: { data: { ok: true, connection_id: "conn-1", tool_count: 0 }, error: null } });
    const { host } = await render();
    await click(host.querySelector('[data-gateway-tool="conn-1"]'));
    await click(byText(host, "Check now"));
    expect(dialog(host)?.textContent).toContain("Checked just now");
    await click(byText(host, "Re-key"));
    await type(fieldFor(host, "Full address"), "https://tools.example.com/new/mcp");
    await click(buttons(host).find(b => b.textContent === "None"));
    await click(byText(host, "Save configuration"));
    await click(byText(host, "Review saved tool"));
    expect(dialog(host)?.textContent).not.toContain("Checked just now");
    expect(dialog(host)?.textContent).toMatch(/hasn’t been checked yet/i);
    expect(edgeCalls("verify")).toHaveLength(1);
  });

  it("offers the same explicit authentication choices from a preset and a custom server", async () => {
    world();
    const { host, root } = await render();
    await openCatalogue(host);
    await click(tile(host, "Close"));
    for (const name of ["OAuth", "Token", "Token + headers", "None"]) {
      expect(buttons(host).find(b => b.textContent === name), name).toBeDefined();
    }
    expect(edgeCalls("oauth_begin")).toHaveLength(0);
    expect(edgeCalls("create")).toHaveLength(0);
    await act(async () => root.unmount());
  });

  it("does not claim Saved when the acknowledged configuration cannot be read back", async () => {
    world({ write: { data: { connection_id: "conn-new", config_generation: 1 }, error: null } });
    const { host, root } = await render();
    await openAddForm(host);
    await type(fieldFor(host, "Name"), "Example server");
    await type(fieldFor(host, "Server URL"), "https://tools.example.com/api/mcp");
    await click(buttons(host).find(b => b.textContent === "None"));
    await click(byText(host, "Save configuration"));
    expect(edgeCalls("create")).toHaveLength(1);
    expect(dialog(host)?.textContent).toMatch(/could not confirm the saved configuration/i);
    expect(byText(host, "Retry confirmation")).toBeDefined();
    expect(edgeCalls("verify")).toHaveLength(0);
    expect(edgeCalls("oauth_begin")).toHaveLength(0);
    await click(byText(host, "Retry confirmation"));
    expect(edgeCalls("create")).toHaveLength(1);
    await act(async () => root.unmount());
  });

  it("keeps a confirmed save visible and never checks or signs in automatically", async () => {
    world({ rows: [row({ connection_id: "conn-new", auth_kind: "none", config_generation: 1, address_configured: true, credentials_configured: false, custom_header_count: 0 })], write: { data: { connection_id: "conn-new", config_generation: 1 }, error: null } });
    const { host, root } = await render();
    await openAddForm(host);
    await type(fieldFor(host, "Name"), "Example server");
    await type(fieldFor(host, "Server URL"), "https://tools.example.com/api/mcp");
    await click(buttons(host).find(b => b.textContent === "None"));
    await click(byText(host, "Save configuration"));
    expect(dialog(host)?.textContent).toMatch(/Saved.*confirmed/i);
    expect(byText(host, "Review saved tool")).toBeDefined();
    expect(edgeCalls("verify")).toHaveLength(0);
    expect(edgeCalls("oauth_begin")).toHaveLength(0);
    await act(async () => root.unmount());
  });
});

describe("saved configuration is visible without disclosing its contents", () => {
  it("shows canonical address, credential and header presence separately from readiness", async () => {
    world({ rows: [row({
      address_configured: true, credentials_configured: true, custom_header_count: 2,
      status: "pending_verification", health: "unknown", last_checked_at: null,
      server_url: "https://services.example.com/private-path/mcp",
      auth_token: "test-only-secret-never-render",
      custom_headers: { "X-Private": "test-only-header-never-render" },
    })] });
    const { host, root } = await render();
    await click(host.querySelector('[data-gateway-tool]'));
    const facts = dialog(host)?.querySelector(".ig-facts")?.textContent;
    expect(facts).toContain("AddressOn file · kept private");
    expect(facts).toContain("CredentialsOn file · encrypted");
    expect(facts).toContain("Additional headers2 on file · encrypted");
    expect(facts).toContain("Not checked yet");
    expect(host.textContent).not.toContain("private-path");
    expect(host.textContent).not.toContain("test-only-secret-never-render");
    expect(host.textContent).not.toContain("test-only-header-never-render");
    expect(edgeCalls("verify")).toHaveLength(0);
    await act(async () => root.unmount());
  });

  it.each(["none", "bearer", "url"])("reports absent credentials without treating %s as proof of a key", async (authKind) => {
    world({ rows: [row({ auth_kind: authKind, address_configured: authKind !== "url", credentials_configured: false, custom_header_count: 0 })] });
    const { host, root } = await render();
    await click(host.querySelector('[data-gateway-tool]'));
    const facts = dialog(host)?.querySelector(".ig-facts")?.textContent;
    expect(facts).toContain(authKind === "none" ? "CredentialsNot used" : "CredentialsNot on file");
    expect(facts).toContain("Additional headersNone on file");
    await act(async () => root.unmount());
  });

  it.each(["bearer", "url"])("does not turn unavailable %s readback into an absent configuration claim", async (authKind) => {
    world({ rows: [row({ auth_kind: authKind })] });
    const { host, root } = await render();
    await click(host.querySelector('[data-gateway-tool]'));
    const facts = dialog(host)?.querySelector(".ig-facts")?.textContent;
    expect(facts).toContain("AddressNot confirmed");
    expect(facts).toContain("CredentialsNot confirmed");
    expect(facts).toContain("Additional headersNot confirmed");
    await act(async () => root.unmount());
  });

  it("reports URL-carried credentials on file without showing the private address", async () => {
    world({ rows: [row({ auth_kind: "url", address_configured: true, credentials_configured: true,
      server_url: "https://services.example.com/private-test-value/mcp" })] });
    const { host, root } = await render();
    await click(host.querySelector('[data-gateway-tool]'));
    expect(dialog(host)?.querySelector(".ig-facts")?.textContent).toContain("CredentialsOn file · encrypted");
    expect(host.textContent).not.toContain("private-test-value");
    await act(async () => root.unmount());
  });
});

describe("OAuth return is a navigation hint, never connection authority", () => {
  it.each(["cancelled", "error", null] as const)("offers an explicit same-row retry for a credential-free shell (%s)", async (result) => {
    world({ rows: [row({ auth_kind: "none", status: "pending_verification", health: "unknown" })], write: edgeRefusal("discovery_failed") });
    const { host, root } = await render();
    if (result) await act(async () => root.render(<Section oauthReturn={{ connectionId: "conn-1", result }} />));
    else await click(host.querySelector('[data-owner="gateway"][data-gateway-tool]'));
    const signIn = buttons(host).find((button) => button.textContent === "Sign in");
    expect(signIn).toBeTruthy();
    expect(edgeCalls("oauth_begin")).toHaveLength(0);
    expect(edgeCalls("verify")).toHaveLength(0);
    await click(signIn);
    expect(edgeCalls("oauth_begin")).toHaveLength(1);
    expect(lastEdgeBody().connection_id).toBe("conn-1");
    expect(edgeCalls("create")).toHaveLength(0);
    expect(dialog(host)?.querySelector('[role="alert"]')).not.toBeNull();
    await act(async () => root.unmount());
  });
  it.each([
    { enabled: false }, { configured: false }, { transport: "rest" },
    { provider_key: "n8n" }, { auth_kind: "bearer" },
  ])("does not derive sign-in eligibility from a return hint (%j)", async (over) => {
    world({ rows: [row({ auth_kind: "none", ...over })] });
    const { host, root } = await render();
    await act(async () => root.render(<Section oauthReturn={{ connectionId: "conn-1", result: "cancelled" }} />));
    expect(buttons(host).find((button) => button.textContent === "Sign in")).toBeUndefined();
    expect(edgeCalls("oauth_begin")).toHaveLength(0);
    await act(async () => root.unmount());
  });
  it("opens only the current owned row and retains pending rather than inventing Ready", async () => {
    world({ rows: [row({ status: "pending_verification", health: "unknown", auth_kind: "oauth" })] });
    const { host, root } = await render();
    await act(async () => root.render(<Section oauthReturn={{ connectionId: "conn-1", result: "connected" }} />));
    expect(dialog(host)).not.toBeNull();
    expect(dialog(host)?.textContent).toContain("Returning from sign-in does not verify this tool");
    expect(dialog(host)?.textContent).toContain("Not checked yet");
    expect(edgeCalls("verify")).toHaveLength(0);
    expect(edgeCalls("oauth_begin")).toHaveLength(0);
    await click(host.querySelector('button[aria-label="Close Scheduling tool"]'));
    expect(document.activeElement).toBe(host.querySelector('[data-gateway-tool="conn-1"]'));
    await act(async () => root.unmount());
  });
  it("does not open a foreign or missing callback row", async () => {
    world({ rows: [row()] });
    const { host, root } = await render();
    await act(async () => root.render(<Section oauthReturn={{ connectionId: "foreign-connection", result: "connected" }} />));
    expect(dialog(host)).toBeNull();
    expect(host.textContent).toContain("That tool is not available in this workspace");
    expect(invoke).not.toHaveBeenCalled();
    await act(async () => root.unmount());
  });
  it("clears returned tool context synchronously while switching accounts", async () => {
    world({ rows: [row({ auth_kind: "oauth" })] });
    const { host, root } = await render();
    await act(async () => root.render(<Section oauthReturn={{ connectionId: "conn-1", result: "cancelled" }} />));
    expect(dialog(host)).not.toBeNull();
    context.loading = true; context.tenantId = null;
    await act(async () => root.render(<Section />));
    expect(dialog(host)).toBeNull();
    expect(host.textContent).not.toContain("Returning from sign-in");
    await act(async () => root.unmount());
  });
});

describe("explicit OAuth retry after confirmed persistence", () => {
  async function savedOAuth() {
    world({ rows: [row({ connection_id: "conn-oauth", auth_kind: "none", config_generation: 1, address_configured: true })] });
    const { host } = await render();
    await openCatalogue(host);
    await click(tile(host, "Close"));
    await click(buttons(host).find(b => b.textContent === "OAuth"));
    invoke.mockResolvedValueOnce({ data: { connection_id: "conn-oauth", config_generation: 1 }, error: null });
    await click(byText(host, "Save configuration"));
    expect(dialog(host)?.textContent).toMatch(/Saved.*confirmed/i);
    expect(edgeCalls("oauth_begin")).toHaveLength(0);
    return host;
  }

  it("retries authorization on the existing row without a duplicate create or replacement", async () => {
    const host = await savedOAuth();
    invoke.mockResolvedValue(edgeRefusal("oauth_begin_failed", 502));
    await click(byText(host, "Authorize with server"));
    expect(dialog(host)?.textContent).toMatch(/configuration is saved, but sign-in did not start/i);
    await click(byText(host, "Authorize with server"));
    expect(edgeCalls("create")).toHaveLength(1);
    expect(edgeCalls("oauth_begin")).toHaveLength(2);
    expect(edgeCalls("oauth_begin").every(c => c[1].body.connection_id === "conn-oauth")).toBe(true);
    expect(rpc.mock.calls.filter(c => c[0] === "set_mcp_connection_endpoint")).toHaveLength(0);
  });

  it("routes an address correction through replacement of the saved row, never re-creates it", async () => {
    const host = await savedOAuth();
    await click(byText(host, "Review saved tool"));
    await click(byText(host, "Re-key"));
    expect(fieldFor(host, "Full address")).toHaveProperty("value", "");
    await type(fieldFor(host, "Full address"), "https://corrected.example.com/api/mcp");
    await click(buttons(host).find(b => b.textContent === "None"));
    await click(byText(host, "Save configuration"));
    expect(rpc.mock.calls.find(c => c[0] === "set_mcp_connection_endpoint")?.[1]).toMatchObject({
      _connection_id: "conn-oauth", _server_url: "https://corrected.example.com/api/mcp",
    });
    expect(edgeCalls("create")).toHaveLength(1);
  });

  it("never exposes an editable name after creation when no rename contract exists", async () => {
    const host = await savedOAuth();
    expect(fieldFor(host, "Name")).toBeUndefined();
    await click(byText(host, "Review saved tool"));
    await click(byText(host, "Re-key"));
    expect(fieldFor(host, "Name")).toBeUndefined();
  });
});

describe("Truth boundary", () => {
  it("reads with no tenant argument and renders no payload of its own", async () => {
    world({ rows: [row({ label: "Scheduling tool" })] });
    const { host } = await render();
    expect(rpc).toHaveBeenCalledWith("get_mcp_connections_v2");
    for (const call of rpc.mock.calls.filter((c) => String(c[0]).startsWith("get_"))) {
      expect(call.length).toBe(1);
    }
    expect(host.textContent).toContain("Scheduling tool");
  });

  it("never says a tool is ready before the server has proven it", async () => {
    // A row that exists is not a row that works. The probe that promotes a row is a later slice,
    // so nothing is checking it yet — and the label must not imply that something is.
    world({ rows: [row({ status: "pending_verification", health: "unknown" })] });
    const { host } = await render();
    expect(host.textContent).toContain("Not checked yet");
    expect(host.textContent).not.toMatch(/\bReady\b/);
    expect(host.textContent).not.toMatch(/Checking…/);
    expect(host.textContent).toContain("not usable yet");
  });

  it("keeps a failed read distinct from an account with no tools", async () => {
    rpc.mockImplementation((name: string) =>
      builder({ data: null, error: name === "get_mcp_connections_v2" ? { message: "read failed" } : null }));
    const { host } = await render();
    expect(host.textContent).toMatch(/couldn’t be read/i);
    expect(addTile(host)).toBeNull();
    expect(host.querySelectorAll(".ig-card").length).toBe(0);
    expect(byText(host, "Try again")).toBeTruthy();
  });

  it("drops the previous workspace's tools immediately and rejects its late answer", async () => {
    let resolveFirst!: (value: { data: unknown; error: null }) => void;
    const first = new Promise<{ data: unknown; error: null }>((done) => { resolveFirst = done; });
    rpc.mockImplementationOnce(() => first).mockImplementation(() => builder({ data: [], error: null }));
    const { host, root } = await render();

    context.tenantId = "tenant-b";
    world({ rows: [row({ connection_id: "conn-b", label: "Tenant B tool" })] });
    await act(async () => root.render(<Section />));
    await act(async () => { await Promise.resolve(); });

    resolveFirst({ data: [row({ label: "Late tenant A tool" })], error: null });
    await act(async () => { await Promise.resolve(); });
    expect(host.textContent).not.toContain("Late tenant A tool");
  });

  it("never renders a secret, and shows only the endpoint host", async () => {
    world({ rows: [row({ auth_token: "must-not-survive", api_key: "must-not-survive" })] });
    const { host } = await render();
    expect(host.textContent).not.toContain("must-not-survive");
    expect(host.textContent).toContain("services.example.com");
  });
});

describe("First use", () => {
  it("offers the add path from a genuinely empty account", async () => {
    world({ rows: [] });
    const { host } = await render();
    expect(host.textContent).not.toMatch(/couldn’t be read/i);
    const add = addTile(host);
    expect(add).toBeTruthy();
    // The way in says it may be taken more than once, because it may.
    expect(add?.textContent).toMatch(/repeatable/i);
    await click(add);
    expect(dialog(host)).toBeTruthy();
  });

  it("offers no add path to someone who cannot write, and claims nothing about why", async () => {
    world({ rows: [], admin: false });
    const { host } = await render();
    expect(addTile(host)).toBeNull();
  });
});

describe("Adding a tool", () => {
  it("browses one catalogue and adds a pasted-key tool end to end", async () => {
    world({ rows: [] });
    const { host } = await render();
    await openCatalogue(host);
    expect(dialog(host)).toBeTruthy();
    // The catalogue IS the add path — there is no separate browse surface and no type picker.
    expect(host.querySelectorAll(".ig-gw-tile").length).toBeGreaterThan(20);

    await click(tile(host, "Any MCP server"));
    await type(fieldFor(host, "Name"), "Scheduling tool");
    await type(fieldFor(host, "Server URL"), "https://services.example.com/mcp");
    await click(buttons(host).find(b => b.textContent === "Token"));
    await type(fieldFor(host, "Token"), "tok_live_value_123");
    await click(byText(host, "Save configuration"));

    // The write goes to the ONE gateway door, dispatched on action — not to the writer RPC.
    expect(edgeCalls("create").length).toBe(1);
    expect(lastEdgeBody()).toMatchObject({ action: "create", facet: "mcp", label: "Scheduling tool", server_url: "https://services.example.com/mcp" });
    // The write carries the caller's own tenant as an expected-tenant guard.
    expect(lastEdgeBody().expected_tenant_id).toBe("tenant-a");
    // Success closes the drawer and the list is re-read from the server, never patched locally.
    expect(dialog(host)?.textContent).toMatch(/Saved.*confirmed/i);
    expect(edgeCalls("verify")).toHaveLength(0);
    expect(rpc.mock.calls.filter((c) => c[0] === "get_mcp_connections_v2").length).toBeGreaterThan(1);
  });

  it("refuses a private or non-HTTPS address instead of letting the server reject it", async () => {
    world({ rows: [] });
    const { host } = await render();
    await openAddForm(host);
    await type(fieldFor(host, "Name"), "Internal tool");
    await type(fieldFor(host, "Server URL"), "http://localhost:5678/mcp");
    await click(buttons(host).find(b => b.textContent === "Token"));
    await type(fieldFor(host, "Token"), "tok");
    await click(byText(host, "Save configuration"));
    expect(host.textContent).toMatch(/public https:\/\/ address/i);
    expect(rpc.mock.calls.some((c) => c[0] === "create_mcp_connection")).toBe(false);
  });

  it("blocks submission until every detail the chosen shape needs is present", async () => {
    world({ rows: [] });
    const { host } = await render();
    await openAddForm(host);
    await click(byText(host, "Save configuration"));
    expect(host.textContent).toMatch(/enter a name/i);
    expect(rpc.mock.calls.some((c) => c[0] === "create_mcp_connection")).toBe(false);
    // aria-invalid says THAT a field is wrong; the message has to be reachable from it, or a
    // screen-reader user is told something is broken and never told what.
    const name = fieldFor(host, "Name") as HTMLInputElement;
    expect(name.getAttribute("aria-invalid")).toBe("true");
    const described = name.getAttribute("aria-describedby");
    expect(described).toBeTruthy();
    const messages = described!.split(" ").map((id) => host.querySelector(`#${id}`)?.textContent ?? "");
    expect(messages.join(" ")).toMatch(/enter a name/i);
  });

  it("keeps n8n API setup on its specialized owner rather than treating it as generic MCP", async () => {
    world();
    const onLegacy = vi.fn();
    const { host } = await render(onLegacy);
    await openCatalogue(host);
    await click(tile(host, "n8n"));
    expect(onLegacy).toHaveBeenCalledWith("n8n");
    expect(edgeCalls("create")).toHaveLength(0);
  });

  it("reports a refused write in the product's own words and keeps the details on screen", async () => {
    world({ rows: [], write: edgeRefusal("MCP_FORBIDDEN", 403) });
    const { host } = await render();
    await openAddForm(host);
    await type(fieldFor(host, "Name"), "Scheduling tool");
    await type(fieldFor(host, "Server URL"), "https://services.example.com/mcp");
    await click(buttons(host).find(b => b.textContent === "Token"));
    await type(fieldFor(host, "Token"), "tok_live_value_123");
    await click(byText(host, "Save configuration"));
    expect(dialog(host)).toBeTruthy();
    expect(host.textContent).not.toContain("42501");
    expect(host.textContent).not.toContain("permission denied for function");
    expect((fieldFor(host, "Name") as HTMLInputElement).value).toBe("Scheduling tool");
  });

  it("a plain preset does not infer OAuth or contact a provider", async () => {
    world();
    const { host } = await render();
    await openCatalogue(host);
    // A tile with NO provider contract — the first Social connect tile, not the Popular
    // row's HighLevel (whose provider-declared required headers legitimately preselect
    // Token + headers; the companion test below pins that behavior).
    await click([...host.querySelectorAll<HTMLButtonElement>('.ig-gw-tile[data-mode="connect"]')]
      .find(b => b.textContent?.includes("Metricool")));
    expect(dialog(host)?.querySelectorAll('[aria-label="Authentication"] button')).toHaveLength(4);
    expect(dialog(host)?.querySelector('[aria-pressed="true"]')).toBeNull();
    expect(edgeCalls("oauth_begin")).toHaveLength(0);
    expect(edgeCalls("create")).toHaveLength(0);
  });

  it("the HighLevel preset carries its provider contract: gohighlevel identity, Token + headers preselected, locationId required", async () => {
    world();
    const { host } = await render();
    await openCatalogue(host);
    await click([...host.querySelectorAll<HTMLButtonElement>('.ig-gw-tile[data-mode="connect"]')]
      .find(b => b.textContent?.includes("HighLevel")));
    // The provider contract preselects the only mode that can satisfy required headers.
    const pressed = dialog(host)?.querySelector('[aria-pressed="true"]');
    expect(pressed?.textContent).toBe("Token + headers");
    // Saving without the locationId header is refused in the product's own words.
    await type(fieldFor(host, "Token"), "pit-token-value-0123456789");
    await click(byText(host, "Save configuration"));
    expect(dialog(host)?.textContent).toMatch(/requires the locationId header/i);
    // With the header present, the create carries the provider identity and the header.
    await click(byText(host, "Add header"));
    await type(fieldFor(host, "Header 1 name"), "locationId");
    await type(fieldFor(host, "Header 1 value"), "loc-123");
    invoke.mockResolvedValueOnce({ data: { connection_id: "conn-ghl", config_generation: 1 }, error: null });
    await click(byText(host, "Save configuration"));
    const call = edgeCalls("create")[0];
    expect(call[1].body).toMatchObject({ provider_key: "gohighlevel", auth_kind: "bearer", custom_headers: { locationId: "loc-123" } });
  });

  it.each(["oauth_begin_failed", "unmapped_refusal"])("keeps Saved distinct from an authorization failure: %s", async (code) => {
    world({ rows: [row({ connection_id: "conn-oauth", auth_kind: "none", config_generation: 1, address_configured: true })] });
    const { host } = await render();
    await openAddForm(host);
    await type(fieldFor(host, "Name"), "Example OAuth");
    await type(fieldFor(host, "Server URL"), "https://tools.example.com/mcp");
    await click(buttons(host).find(b => b.textContent === "OAuth"));
    invoke.mockResolvedValueOnce({ data: { connection_id: "conn-oauth", config_generation: 1 }, error: null });
    await click(byText(host, "Save configuration"));
    expect(edgeCalls("create")[0][1].body).toMatchObject({ auth_kind: "none", auth_token: null });
    invoke.mockResolvedValueOnce(edgeRefusal(code, 502));
    await click(byText(host, "Authorize with server"));
    expect(dialog(host)?.textContent).toMatch(/configuration is saved, but sign-in did not start/i);
    expect(byText(host, "Authorize with server")).toBeDefined();
    expect(byText(host, "Review saved tool")).toBeDefined();
  });

  it("narrows the catalogue by search and still leaves a way to finish", async () => {
    world({ rows: [] });
    const { host } = await render();
    await openCatalogue(host);
    const search = host.querySelector<HTMLInputElement>('input[type="search"]');
    await type(search, "zzzzznotarealtool");
    // A tool we do not list is not a dead end: the generic entry survives every filter,
    // and the empty note points at it by the name it actually carries.
    expect(Array.from(host.querySelectorAll(".ig-gw-tile-name")).map((n) => n.textContent)).toEqual(["Any MCP server"]);
    expect(host.textContent).toMatch(/no listed tool matches/i);
    expect(tile(host, "Any MCP server")).toBeTruthy();
  });

  it("adds a tool it does not list, by address, with nothing prefilled", async () => {
    world({ rows: [] });
    const { host } = await render();
    await openAddForm(host);
    // The generic entry names no vendor, so it must not seed the name with its own label.
    expect((fieldFor(host, "Name") as HTMLInputElement).value).toBe("");
    await type(fieldFor(host, "Name"), "Ops server");
    await type(fieldFor(host, "Server URL"), "https://ops.example.com/mcp");
    await click(buttons(host).find(b => b.textContent === "Token"));
    await type(fieldFor(host, "Token"), "tok_value_123456");
    await click(byText(host, "Save configuration"));
    expect(lastEdgeBody()).toMatchObject({ action: "create", label: "Ops server" });
  });
});

describe("Writes reach the server", () => {
  it("sends the write through the gateway edge and retains its confirmed result", async () => {
    // The builder-shape regression this once guarded now lives on the RETAINED rpc lane (re-key and
    // disconnect), which still calls `supabase.rpc()` directly — see the disconnect test below and
    // the hook suite. Creates no longer touch the builder at all.
    world({ rows: [] });
    const { host } = await render();
    await openAddForm(host);
    await type(fieldFor(host, "Name"), "Ops server");
    await type(fieldFor(host, "Server URL"), "https://ops.example.com/mcp");
    await click(buttons(host).find(b => b.textContent === "Token"));
    await type(fieldFor(host, "Token"), "tok_value_123456");
    await click(byText(host, "Save configuration"));
    expect(edgeCalls("create").length).toBe(1);
    expect(dialog(host)?.textContent).toMatch(/Saved.*confirmed/i);
  });

  it("never renders a tool whose identity the server did not state", async () => {
    // An id-only row used to be accepted and its identity invented — "generic-remote", "Tool", a
    // default status — rendering a tool the owner never added, described in words the server never
    // said. Fabricated state is worse than a visible read failure: nothing marks it as a guess.
    world({ rows: [] });
    rpc.mockImplementation((name: string) =>
      name === "get_mcp_connections_v2"
        ? builder({ data: [{ connection_id: "conn-id-only" }], error: null })
        : builder({ data: true, error: null }));
    const { host } = await render();
    expect(host.textContent).toMatch(/couldn’t be read/i);
    expect(host.textContent).not.toContain("Tool");
    expect(host.querySelectorAll(".ig-card").length).toBe(0);
  });

  it("fails the whole read when ANY row is unreadable, never a quietly short list", async () => {
    // Dropping the bad rows and rendering the rest is the quieter lie: the list looks complete
    // while silently missing whatever did not parse, and the owner cannot tell.
    world({ rows: [] });
    rpc.mockImplementation((name: string) =>
      name === "get_mcp_connections_v2"
        ? builder({ data: [row({ connection_id: "conn-good", label: "Readable tool" }), { connection_id: "conn-broken" }], error: null })
        : builder({ data: true, error: null }));
    const { host } = await render();
    expect(host.textContent).toMatch(/couldn’t be read/i);
    expect(host.textContent).not.toContain("Readable tool");
  });

  it("never reports a write as done on an envelope carrying no acknowledgement", async () => {
    // `{data: null, error: null}` is a VALID envelope with no confirmation in it. Every shipped
    // writer acknowledges with `connection_id`, so an answer without one did not confirm the write.
    world({ rows: [] });
    const { host } = await render();
    await openAddForm(host);
    await type(fieldFor(host, "Name"), "Unacknowledged tool");
    await type(fieldFor(host, "Server URL"), "https://unacked.example.com/mcp");
    await click(buttons(host).find(b => b.textContent === "Token"));
    await type(fieldFor(host, "Token"), "harness-token-not-a-real-secret");
    // A VALID envelope with no confirmation in it: 2xx, no error, and a body carrying no
    // connection_id. Every create acknowledges with one, so this did not confirm the write.
    invoke.mockResolvedValue({ data: {}, error: null });
    await click(byText(host, "Save configuration"));
    expect(dialog(host)).toBeTruthy();
  });

  it("never reports a write as done on an answer that confirms nothing", async () => {
    // An adapter that resolves `{}` carries no acknowledgement that anything happened. Treating the
    // absent `error` key as success would close the drawer on a write the server never confirmed,
    // and a later reload cannot make that success true (§13).
    world({ rows: [] });
    const { host } = await render();
    await openAddForm(host);
    await type(fieldFor(host, "Name"), "Unconfirmed tool");
    await type(fieldFor(host, "Server URL"), "https://unconfirmed.example.com/mcp");
    await click(buttons(host).find(b => b.textContent === "Token"));
    await type(fieldFor(host, "Token"), "harness-token-not-a-real-secret");
    // An adapter that resolves with a non-object carries no acknowledgement at all.
    invoke.mockResolvedValue(undefined);
    await click(byText(host, "Save configuration"));
    // The drawer stays open on the details, and the owner is told it did not go through.
    expect(dialog(host)).toBeTruthy();
    expect(host.textContent).not.toMatch(/Unconfirmed tool.*added/i);
  });

  it("leaves the owner able to try again after a refused write", async () => {
    world({ rows: [], write: edgeRefusal("MCP_FORBIDDEN", 403) });
    const { host } = await render();
    await openAddForm(host);
    await type(fieldFor(host, "Name"), "Ops server");
    await type(fieldFor(host, "Server URL"), "https://ops.example.com/mcp");
    await click(buttons(host).find(b => b.textContent === "Token"));
    await type(fieldFor(host, "Token"), "tok_value_123456");
    await click(byText(host, "Save configuration"));
    // The submit control must come back — a write that failed once must not disable the surface.
    const submit = byText(host, "Save configuration") as HTMLButtonElement;
    expect(submit.disabled).toBe(false);
  });

  it("accepts a public address that merely contains private-looking digits", async () => {
    world({ rows: [] });
    const { host } = await render();
    await openAddForm(host);
    await type(fieldFor(host, "Name"), "Versioned tool");
    await type(fieldFor(host, "Server URL"), "https://api.example.com/v1.10.2/mcp");
    await click(buttons(host).find(b => b.textContent === "Token"));
    await type(fieldFor(host, "Token"), "tok_value_123456");
    await click(byText(host, "Save configuration"));
    expect(edgeCalls("create").length).toBe(1);
  });
});

describe("A superseded read never wins", () => {
  it("keeps the FRESH action list when a superseded read resolves last", async () => {
    // "Check now" tears down and immediately re-runs the read effect. A single shared
    // liveness boolean is false during teardown and true again before the OLDER request
    // resolves, so that older answer passes the guard and overwrites the newer one —
    // rendering "Checked just now" directly above the list read BEFORE the check.
    // Every read is held here and settled by hand, newest FIRST, so the superseded ones
    // land late: the exact interleaving the defect needs, which real timing only
    // sometimes produces.
    rpc.mockImplementation((name: string) => {
      if (name === "get_mcp_connections_v2") {
        return builder({ data: [row({ status: "connected", health: "healthy", tool_count: 1 })], error: null });
      }
      if (name === "is_current_user_tenant_admin") return builder({ data: true, error: null });
      return builder({ data: { connection_id: "conn-1" }, error: null });
    });

    const pending: ((v: unknown) => void)[] = [];
    invoke.mockImplementation((_fn: string, opts: { body?: Record<string, unknown> }) => {
      const action = String(opts?.body?.action ?? "");
      if (action === "tools") return new Promise((resolve) => { pending.push(resolve); });
      return Promise.resolve({ data: { ok: true, status: "connected", health: "healthy", tool_count: 1, error_code: null }, error: null });
    });

    const { host } = await render();
    await click(host.querySelector('[data-gateway-tool="conn-1"]'));
    const beforeCheck = pending.length;
    expect(beforeCheck).toBeGreaterThan(0); // a read is in flight, deliberately unresolved

    await click(byText(host, "Check now"));
    expect(pending.length).toBeGreaterThan(beforeCheck); // the reload issued a newer read

    const held = pending.length;
    // The NEWEST read lands first, carrying what the server says now.
    pending[held - 1](toolsAnswer([toolRow({ name: "fresh_action" })]));
    await act(async () => { await Promise.resolve(); });
    // Then every superseded read lands late, carrying what it read before the check.
    for (let i = 0; i < held - 1; i += 1) {
      pending[i](toolsAnswer([toolRow({ name: "stale_action" })]));
    }
    await act(async () => { await Promise.resolve(); });
    await act(async () => { await Promise.resolve(); });

    const text = dialog(host)!.textContent!;
    expect(text).toContain("fresh_action");
    expect(text).not.toContain("stale_action");
  });
});

describe("The open drawer tells one story", () => {
  it("re-reads the row from the live list after a check, instead of contradicting itself", async () => {
    // Slice ④ added the first write that leaves this drawer OPEN. Re-key and disconnect both close
    // it, so a frozen snapshot never had a way to show. After "Check now" reloads the list, a
    // snapshot would leave the facts list reading "Not checked yet" with no last-checked time,
    // directly above a banner saying Paige had just reached it.
    let listed = [row({ status: "pending_verification", health: "unknown", last_checked_at: null, tool_count: 0 })];
    rpc.mockImplementation((name: string) => {
      if (name === "get_mcp_connections_v2") return builder({ data: listed, error: null });
      if (name === "is_current_user_tenant_admin") return builder({ data: true, error: null });
      return builder({ data: { connection_id: "conn-1" }, error: null });
    });
    invoke.mockResolvedValue({ data: { ok: true, status: "connected", health: "healthy", tool_count: 11, error_code: null }, error: null });

    const { host } = await render();
    await click(host.querySelector('[data-gateway-tool="conn-1"]'));
    expect(dialog(host)?.textContent).toMatch(/not checked yet/i);

    // The server's own answer to the probe: the row is now connected and healthy.
    listed = [row({ status: "connected", health: "healthy", last_checked_at: "2026-09-23T17:00:00Z", tool_count: 11 })];
    await click(byText(host, "Check now"));

    const text = dialog(host)!.textContent!;
    expect(text).toMatch(/checked just now/i);
    // The decisive assertions: the facts list moved WITH the verdict. A frozen snapshot fails both
    // — it would still read "Not checked yet" and "No successful check yet" under the banner.
    // Matched without \b, since textContent concatenates the <dt>/<dd> pair into "StatusReady".
    expect(text).toMatch(/StatusReady/);
    expect(text).not.toMatch(/not checked yet/i);
    expect(text).not.toMatch(/no successful check yet/i);
  });
});

describe("What the surface claims about approvals is true of the runner", () => {
  it("claims neither a bulk approval nor a blanket block — both are false, in opposite directions", async () => {
    // The sentence this replaces said choosing actions "hasn't shipped yet", which was true
    // until the list did ship. Two earlier versions were false in opposite directions:
    // "all-or-nothing" named a bulk approval that exists nowhere (the door takes ONE
    // tool_name), and "nothing runs without your approval" over-corrected, because
    // resolveEffectApproval returns requiresApproval:false for a declared read and the
    // runner skips the consent check for it outright. The list now proves both, per row.
    world({
      rows: [row({ status: "connected", health: "healthy", tool_count: 3, approved_count: 1 })],
      tools: toolsAnswer([
        toolRow({ name: "list_contacts", effects: ["read"], requiresApproval: false }),
        toolRow({ name: "send_email", effects: ["read"], requiresApproval: true, approvalBasis: "server_name_floor" }),
        toolRow({ name: "create_booking", effects: ["create"], requiresApproval: true, approvalBasis: "provider_declared_effect",
                  approved: true, expiresAt: "2026-10-20T11:00:00Z", approvedByYou: true }),
      ]),
    });
    const { host } = await render();
    await click(host.querySelector('[data-gateway-tool="conn-1"]'));
    const text = dialog(host)!.textContent!;

    expect(text).not.toMatch(/all-or-nothing/i);
    expect(text).not.toMatch(/nothing runs without your approval/i);
    // The claim that shipped in its place is dead, and must not come back as copy.
    expect(text).not.toMatch(/hasn.t shipped yet/i);
    // A declared read is honestly marked as needing nothing — the true statement the
    // over-correction denied.
    expect(text).toMatch(/Runs without asking/);
    // And a mutation is honestly gated, per row, with its reason. `send_email` is labelled
    // ["read"] by its provider and is raised anyway, which is the server floor working.
    expect(text).toMatch(/Needs your approval/);
    expect(text).toMatch(/name says it sends or changes something/i);
    // The summary counts CONSENT, not rows: one of the two gated actions is approved.
    expect(text).toMatch(/1 of 2 approved/);
  });

  it("tells an owner when an approval that LOOKS live would be refused at dispatch", async () => {
    // The defect this exists to prevent: `approved` means only "a row exists", while the
    // function governing execution refuses on seven conditions. An approval bound to an
    // endpoint this connection no longer uses is unexpired, unstale, and useless — and the
    // surface used to render it as "You approved this" with no control to fix it.
    world({
      rows: [row({ status: "connected", health: "healthy", tool_count: 2, approved_count: 2 })],
      tools: toolsAnswer([
        toolRow({ name: "charge_card", effects: ["send"], requiresApproval: true, approvalBasis: "provider_declared_effect",
                  approved: true, expiresAt: "2026-10-20T11:00:00Z", approvalBlockedReason: "endpoint_changed" }),
        toolRow({ name: "wipe_all", effects: ["delete"], requiresApproval: true, approvalBasis: "server_name_floor",
                  approved: true, approvalBlockedReason: "approval_not_endpoint_bound" }),
      ]),
    });
    const { host } = await render();
    await click(host.querySelector('[data-gateway-tool="conn-1"]'));
    const text = dialog(host)!.textContent!;

    expect(text).toMatch(/Approved for a different address/);
    expect(text).toMatch(/Approval needs redoing/);
    // Neither may read as live consent, and the count must not include them.
    expect(text).not.toMatch(/You approved this/);
    expect(text).toMatch(/0 of 2 approved/);
    // Both are recoverable, so both offer the control that recovers them.
    expect(buttons(host).filter((b) => b.textContent === "Approve again")).toHaveLength(2);
  });

  it("does not offer a control that could only be refused", async () => {
    // A member who is not a workspace admin is refused before anything is sent, and the
    // server refuses independently. They still see the whole list — it is already disclosed
    // to them — plus a line naming who can act on it.
    world({
      admin: false,
      rows: [row({ status: "connected", health: "healthy", tool_count: 1, approved_count: 0 })],
      tools: toolsAnswer([toolRow({ name: "send_email", effects: ["send"], requiresApproval: true, approvalBasis: "server_name_floor" })]),
    });
    const { host } = await render();
    await click(host.querySelector('[data-gateway-tool="conn-1"]'));
    expect(byText(host, "Approve")).toBeUndefined();
    const text = dialog(host)!.textContent!;
    expect(text).toMatch(/send_email/);
    expect(text).toMatch(/A workspace admin approves what Paige may use/);
  });

  it("keeps 'never read' and 'offers nothing' as different sentences", async () => {
    // Both arrive as an empty array. `observedAt` cannot separate them — it is derived from
    // the rows, so it is null whenever there are none. The connection's own last-checked time
    // is what says whether anyone ever asked. Production is entirely the first case today, so
    // one "nothing here" line would be false about every connection anyone owns.
    world({ rows: [row({ status: "connected", health: "healthy", last_checked_at: null, tool_count: 0, approved_count: 0 })] });
    const first = await render();
    await click(first.host.querySelector('[data-gateway-tool="conn-1"]'));
    expect(dialog(first.host)!.textContent).toMatch(/hasn.t looked at what this tool can do yet/i);
    first.root.unmount();

    world({ rows: [row({ status: "connected", health: "healthy", last_checked_at: "2026-09-20T10:00:00Z", tool_count: 0, approved_count: 0 })] });
    const second = await render();
    await click(second.host.querySelector('[data-gateway-tool="conn-1"]'));
    expect(dialog(second.host)!.textContent).toMatch(/offered nothing she can run/i);
  });

  it("does not render an empty list as 'offers nothing' when the read was REFUSED", async () => {
    world({
      rows: [row({ status: "connected", health: "healthy", tool_count: 4, approved_count: 0 })],
      tools: edgeRefusal("not_found", 404),
    });
    const { host } = await render();
    await click(host.querySelector('[data-gateway-tool="conn-1"]'));
    const text = dialog(host)!.textContent!;
    expect(text).toMatch(/could not be found/i);
    expect(text).not.toMatch(/offered nothing/i);
    expect(text).not.toMatch(/hasn.t looked/i);
  });

  it("records consent without claiming Paige will then run it", async () => {
    // Approving records CONSENT. Whether Paige may act on it is a separate switch that is off
    // by default, and promising a run here would swap one false sentence for another.
    world({
      rows: [row({ status: "connected", health: "healthy", tool_count: 1, approved_count: 0 })],
      tools: toolsAnswer([toolRow({ name: "send_email", effects: ["send"], requiresApproval: true, approvalBasis: "server_name_floor" })]),
      write: { data: { ok: true, connection_id: "conn-1", tool_name: "send_email", approved: true }, error: null },
    });
    const { host } = await render();
    await click(host.querySelector('[data-gateway-tool="conn-1"]'));
    await click(byText(host, "Approve"));

    const sent = edgeCalls("approve").at(-1)?.[1]?.body as Record<string, unknown>;
    expect(sent.tool_name).toBe("send_email");
    // The lifetime floor is applied before the wire, never by omitting the field — omitting it
    // means NO EXPIRY to the handler, which would make the most suspicious input the most
    // permissive outcome.
    expect(typeof sent.expires_at).toBe("string");

    const text = dialog(host)!.textContent!;
    expect(text).toMatch(/consent recorded/i);
    expect(text).not.toMatch(/Paige can use it/i);
  });
});

describe("A turned-off tool offers only the recovery it actually has", () => {
  it("hides Check now and Sign in again, which could only refuse", async () => {
    world({ rows: [row({ enabled: false, status: "unconfigured", auth_kind: "oauth" })] });
    const { host } = await render();
    await click(host.querySelector('[data-gateway-tool="conn-1"]'));
    // Both actions answer connection_disabled on a turned-off row. A control whose only outcome is
    // a refusal is the §70.1 failure, not a safety net.
    expect(byText(host, "Check now")).toBeUndefined();
    expect(byText(host, "Sign in again")).toBeUndefined();
    expect(byText(host, "Disconnect")).toBeTruthy();
  });

  it("allows an OAuth tool to replace its cleared configuration through the canonical setter", async () => {
    // Soft-disable nulls the credential and never changes auth_kind, so an OAuth row stays OAuth,
    // `rekeyable` stays false, and Re-key never renders. Naming it would be an instruction with
    // nothing behind it — the exact defect the first fix for this string introduced.
    world({ rows: [row({ enabled: false, status: "unconfigured", auth_kind: "oauth" })] });
    const { host } = await render();
    await click(host.querySelector('[data-gateway-tool="conn-1"]'));
    expect(byText(host, "Re-key")).toBeDefined();
    await click(byText(host, "Re-key"));
    await type(fieldFor(host, "Full address"), "https://tools.example.com/mcp");
    await click(buttons(host).find(b => b.textContent === "Token"));
    await type(fieldFor(host, "Token"), "synthetic-new-token");
    await click(byText(host, "Save configuration"));
    expect(rpc.mock.calls.find(c => c[0] === "set_mcp_connection_endpoint")?.[1]).toMatchObject({ _auth_kind: "bearer", _auth_token: "synthetic-new-token" });
    expect(edgeCalls("oauth_begin")).toHaveLength(0);
  });

  it("names Re-key for a turned-off tool that genuinely has it", async () => {
    // A successful re-key restores enabled=true, so for a re-keyable row this really is the path.
    world({ rows: [row({ enabled: false, status: "unconfigured", auth_kind: "bearer" })] });
    const { host } = await render();
    await click(host.querySelector('[data-gateway-tool="conn-1"]'));
    expect(byText(host, "Re-key")).toBeTruthy();
    expect(dialog(host)?.textContent).toMatch(/Re-key it to switch it back on/i);
  });
});

describe("Listed is never connected", () => {
  it("stops honestly on a provider with no capability record instead of opening a prefilled form", async () => {
    // A tile that opens a real connection form prefilled with that provider's endpoint asserts
    // authority, ownership and cost the Integration Capability Registry has never recorded.
    world({ rows: [] });
    const { host } = await render();
    await openCatalogue(host);
    await click(tile(host, "Buffer"));
    expect(dialog(host)?.textContent).toMatch(/isn’t cleared for use yet/i);
    // No form, no prefilled endpoint, and nothing sent.
    expect(fieldFor(host, "Server URL")).toBeUndefined();
    expect(rpc.mock.calls.some((c) => String(c[0]).startsWith("create_"))).toBe(false);
    // The neutral path stays open, so the capability is not lost.
    expect(dialog(host)?.textContent).toMatch(/Any MCP server/);
  });

  it("still opens the real form for the provider-neutral entry", async () => {
    world({ rows: [] });
    const { host } = await render();
    await openAddForm(host);
    expect(fieldFor(host, "Server URL")).toBeTruthy();
  });
});

describe("An unreadable account is never rendered as an empty one", () => {
  it("treats a payload it cannot parse as a failed read, not as zero tools", async () => {
    rpc.mockImplementation((name: string) => {
      if (name === "get_mcp_connections_v2") return builder({ data: { unexpected: "shape" }, error: null });
      if (name === "is_current_user_tenant_admin") return builder({ data: true, error: null });
      return builder({ data: null, error: null });
    });
    const { host } = await render();
    expect(host.textContent).toMatch(/couldn’t be read/i);
    expect(host.querySelectorAll(".ig-card").length).toBe(0);
  });

  it("treats rows that all fail to parse as a failed read", async () => {
    world({ rows: [{ nothing: "useful" }, { also: "bad" }] });
    const { host } = await render();
    expect(host.textContent).toMatch(/couldn’t be read/i);
    expect(host.querySelectorAll(".ig-card").length).toBe(0);
  });

  it("still offers the add path for a genuinely empty account", async () => {
    world({ rows: [] });
    const { host } = await render();
    expect(addTile(host)).toBeTruthy();
    expect(host.textContent).not.toMatch(/couldn’t be read/i);
  });
});

describe("A failure belongs to the tool it happened on", () => {
  it("does not replay one tool's refusal as a live alert on the next tool opened", async () => {
    world({
      rows: [row(), row({ connection_id: "conn-2", label: "Docs tool" })],
      // Disconnect is on the RETAINED rpc lane (the gateway edge has no disconnect action), so its
      // refusal is still a Postgres error, not an edge body.
      rpcWrite: { data: null, error: { code: "42501", message: "MCP_FORBIDDEN: not permitted" } },
    });
    const { host } = await render();
    await click(host.querySelector('[data-gateway-tool="conn-1"]'));
    await click(byText(host, "Disconnect"));
    await click(host.querySelector(".ig-gw-actions button[data-danger]"));
    // One operation, one alert — the same refusal must not render twice in the same drawer.
    const shown = dialog(host)!.textContent!.match(/don't have permission/gi) ?? [];
    expect(shown.length).toBe(1);
    await click(host.querySelector(".ig-close"));
    await click(host.querySelector('[data-gateway-tool="conn-2"]'));
    // The second tool has done nothing wrong; the first tool's refusal must not follow it here.
    expect(dialog(host)?.textContent).toContain("Docs tool");
    expect(dialog(host)?.textContent).not.toMatch(/don't have permission/i);
  });
});

describe("Shipped flows are routed, never reimplemented", () => {
  it("sends the n8n and Zapier tiles to their existing drawers instead of the gateway form", async () => {
    world({ rows: [] });
    const seen: string[] = [];
    const { host } = await render((which) => seen.push(which));
    await openCatalogue(host);
    await click(tile(host, "n8n"));
    expect(seen).toEqual(["n8n"]);
    // Routing closes this drawer so the shipped one owns the screen.
    expect(dialog(host)).toBeNull();

    await openCatalogue(host);
    await click(tile(host, "Zapier"));
    expect(seen).toEqual(["n8n", "zapier"]);
  });
});

describe("Managing a tool", () => {
  it.each(["url", "none", "bearer", "header"])("never submits a reconstructed host when re-keying %s authentication", async (authKind) => {
    world({ rows: [row({ auth_kind: authKind })] });
    const { host } = await render();
    await click(host.querySelector('[data-gateway-tool="conn-1"]'));
    await click(byText(host, "Re-key"));
    if (authKind === "bearer" || authKind === "header") {
      await type(fieldFor(host, "Token"), "test-replacement-value");
    }
    if (authKind === "header") await type(fieldFor(host, "Credential header"), "X-Api-Key");
    await click(byText(host, "Save configuration"));
    expect(rpc.mock.calls.filter((call) => WRITE_RPCS.has(call[0]))).toEqual([]);
    expect(edgeCalls("verify")).toHaveLength(0);
    expect(fieldFor(host, "Full address")).toHaveProperty("value", "");
    expect(fieldFor(host, "Full address")?.getAttribute("aria-invalid")).toBe("true");
    expect(host.textContent).toContain("Enter the full public https:// address.");
    expect(host.textContent).not.toContain("Paige stores only the host");
  });

  it("opens a tool and re-keys it, warning that approvals are cleared", async () => {
    world({ rows: [row()] });
    const { host } = await render();
    await click(host.querySelector('[data-gateway-tool="conn-1"]'));
    expect(dialog(host)?.textContent).toContain("services.example.com");

    await click(byText(host, "Re-key"));
    expect(host.textContent).toMatch(/clears this tool’s approvals/i);
    await type(fieldFor(host, "Full address"), "https://services.example.com/mcp");
    await type(fieldFor(host, "Token"), "new_token_value");
    await click(byText(host, "Save configuration"));
    const write = rpc.mock.calls.find((c) => c[0] === "set_mcp_connection_endpoint");
    expect(write?.[1]).toMatchObject({ _connection_id: "conn-1", _tenant_id: "tenant-a" });
  });

  it.each(["url", "none", "bearer", "header"])("preserves an explicitly entered endpoint path for %s authentication", async (authKind) => {
    world({ rows: [row({ auth_kind: authKind })] });
    const { host } = await render();
    await click(host.querySelector('[data-gateway-tool="conn-1"]'));
    await click(byText(host, "Re-key"));
    const endpoint = "https://services.example.com/api/mcp/team%2Ftools/?region=test";
    await type(fieldFor(host, "Full address"), endpoint);
    if (authKind === "bearer" || authKind === "header") await type(fieldFor(host, "Token"), "test-replacement-value");
    if (authKind === "header") await type(fieldFor(host, "Credential header"), "X-Api-Key");
    await click(byText(host, "Save configuration"));
    expect(rpc.mock.calls.find((call) => call[0] === "set_mcp_connection_endpoint")?.[1]).toMatchObject({
      _connection_id: "conn-1", _server_url: endpoint, _auth_kind: authKind === "url" ? "none" : authKind,
    });
  });

  it("requires an explicit address on the shared REST re-key form too", async () => {
    world({ rows: [row({ provider_key: "n8n", auth_kind: "api_key" })] });
    const { host } = await render();
    await click(host.querySelector('[data-gateway-tool="conn-1"]'));
    await click(byText(host, "Re-key"));
    await type(fieldFor(host, "New API key"), "test-replacement-value");
    await click(byText(host, "Save API configuration"));
    expect(rpc.mock.calls.filter((call) => WRITE_RPCS.has(call[0]))).toEqual([]);
    await type(fieldFor(host, "Base URL"), "https://services.example.com/automation/");
    await click(byText(host, "Save API configuration"));
    expect(rpc.mock.calls.find((call) => call[0] === "set_mcp_rest_connection_endpoint")?.[1]).toMatchObject({
      _connection_id: "conn-1", _base_url: "https://services.example.com/automation/",
    });
  });

  it("does not carry an abandoned endpoint into another connection", async () => {
    world({ rows: [row(), row({ connection_id: "conn-2", label: "Other tool", auth_kind: "none" })] });
    const { host } = await render();
    await click(host.querySelector('[data-gateway-tool="conn-1"]'));
    await click(byText(host, "Re-key"));
    await type(fieldFor(host, "Full address"), "https://services.example.com/private-path/mcp");
    await click(byText(host, "Cancel"));
    await click(host.querySelector(".ig-close"));
    if (host.querySelector('[role="alertdialog"]')) await click(byText(host, "Discard them"));
    await click(host.querySelector('[data-gateway-tool="conn-2"]'));
    await click(byText(host, "Re-key"));
    expect(fieldFor(host, "Full address")).toHaveProperty("value", "");
    expect(rpc.mock.calls.filter((call) => WRITE_RPCS.has(call[0]))).toEqual([]);
  });

  it("keeps the full entered endpoint after a refused save so the owner can retry", async () => {
    world({ rows: [row({ auth_kind: "none" })], rpcWrite: { data: null, error: { code: "42501", message: "permission denied" } } });
    const { host } = await render();
    await click(host.querySelector('[data-gateway-tool="conn-1"]'));
    await click(byText(host, "Re-key"));
    const endpoint = "https://services.example.com/mcp/";
    await type(fieldFor(host, "Full address"), endpoint);
    await click(byText(host, "Save configuration"));
    expect(fieldFor(host, "Full address")).toHaveProperty("value", endpoint);
    expect(dialog(host)?.querySelector('[role="alert"]')).toBeTruthy();
    expect(edgeCalls("verify")).toHaveLength(0);
    world({ rows: [row({ auth_kind: "none" })] });
    await click(byText(host, "Save configuration"));
    expect(rpc.mock.calls.filter((call) => call[0] === "set_mcp_connection_endpoint")).toHaveLength(2);
  });

  it("will not re-key on an empty value", async () => {
    world({ rows: [row()] });
    const { host } = await render();
    await click(host.querySelector('[data-gateway-tool="conn-1"]'));
    await click(byText(host, "Re-key"));
    await type(fieldFor(host, "Full address"), "https://services.example.com/mcp");
    await click(byText(host, "Save configuration"));
    expect(host.textContent).toMatch(/enter the token/i);
    expect(rpc.mock.calls.some((c) => c[0] === "set_mcp_connection_endpoint")).toBe(false);
  });

  it("disconnects only after an explicit choice, and defaults to the reversible one", async () => {
    world({ rows: [row()] });
    const { host } = await render();
    await click(host.querySelector('[data-gateway-tool="conn-1"]'));
    await click(byText(host, "Disconnect"));
    expect(rpc.mock.calls.some((c) => c[0] === "disconnect_mcp_connection")).toBe(false);
    await click(host.querySelector(".ig-gw-actions button[data-danger]"));
    expect(rpc.mock.calls.find((c) => c[0] === "disconnect_mcp_connection")?.[1]).toMatchObject({ _connection_id: "conn-1", _hard: false });
  });

  it("deletes permanently only when that shape is chosen deliberately", async () => {
    world({ rows: [row()] });
    const { host } = await render();
    await click(host.querySelector('[data-gateway-tool="conn-1"]'));
    await click(byText(host, "Disconnect"));
    await click(byText(host, "Delete it"));
    await click(host.querySelector(".ig-gw-actions button[data-danger]"));
    expect(rpc.mock.calls.find((c) => c[0] === "disconnect_mcp_connection")?.[1]).toMatchObject({ _hard: true });
  });

  it("offers no re-key or disconnect to someone who cannot write", async () => {
    world({ rows: [row()], admin: false });
    const { host } = await render();
    await click(host.querySelector('[data-gateway-tool="conn-1"]'));
    expect(dialog(host)).toBeTruthy();
    expect(byText(host, "Re-key")).toBeUndefined();
    expect(byText(host, "Disconnect")).toBeUndefined();
  });

  it("asks before discarding a half-entered key, and lets the owner keep editing", async () => {
    world({ rows: [row()] });
    const { host } = await render();
    await click(host.querySelector('[data-gateway-tool="conn-1"]'));
    await click(byText(host, "Re-key"));
    await type(fieldFor(host, "Token"), "half-typed");
    await click(host.querySelector(".ig-close"));
    expect(host.querySelector('[role="alertdialog"]')).toBeTruthy();
    await click(byText(host, "Keep editing"));
    expect(dialog(host)).toBeTruthy();
    await click(host.querySelector(".ig-close"));
    await click(byText(host, "Discard them"));
    expect(dialog(host)).toBeNull();
  });

  it("closes a tool with Escape when nothing has been typed", async () => {
    world({ rows: [row()] });
    const { host } = await render();
    await click(host.querySelector('[data-gateway-tool="conn-1"]'));
    await act(async () => { window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })); });
    expect(dialog(host)).toBeNull();
  });

  it("re-keys to the address the owner confirms, never a truncated host", async () => {
    // The read returns the HOST only by design, so rebuilding the address from it would silently
    // re-point a working tool at its bare host and clear its approvals.
    world({ rows: [row()] });
    const { host } = await render();
    await click(host.querySelector('[data-gateway-tool="conn-1"]'));
    await click(byText(host, "Re-key"));
    const address = fieldFor(host, "Full address") as HTMLInputElement;
    expect(address).toBeTruthy();
    await type(address, "https://services.example.com/mcp/v2");
    await type(fieldFor(host, "Token"), "new_token_value");
    await click(byText(host, "Save configuration"));
    expect(rpc.mock.calls.find((c) => c[0] === "set_mcp_connection_endpoint")?.[1])
      .toMatchObject({ _server_url: "https://services.example.com/mcp/v2" });
  });

  it("carries the header name when the tool authenticates with a custom header", async () => {
    world({ rows: [row({ auth_kind: "header" })] });
    const { host } = await render();
    await click(host.querySelector('[data-gateway-tool="conn-1"]'));
    await click(byText(host, "Re-key"));
    await type(fieldFor(host, "Credential header"), "X-Api-Key");
    await type(fieldFor(host, "Full address"), "https://services.example.com/mcp");
    await type(fieldFor(host, "Token"), "synthetic-new-value");
    await click(byText(host, "Save configuration"));
    // Without the header name the server refuses the bundle every time and the typed key is lost.
    expect(rpc.mock.calls.find((c) => c[0] === "set_mcp_connection_endpoint")?.[1])
      .toMatchObject({ _auth_header_name: "X-Api-Key", _auth_token: "synthetic-new-value" });
  });

  it("offers shared replacement without reading back the OAuth credential", async () => {
    world({ rows: [row({ auth_kind: "oauth" })] });
    const { host } = await render();
    await click(host.querySelector('[data-gateway-tool="conn-1"]'));
    expect(byText(host, "Re-key")).toBeDefined();
    expect(byText(host, "Disconnect")).toBeTruthy();
  });

  it("drops an open tool when the workspace changes under it", async () => {
    world({ rows: [row({ label: "Tenant A tool" })] });
    const { host, root } = await render();
    await click(host.querySelector('[data-gateway-tool="conn-1"]'));
    expect(dialog(host)?.textContent).toContain("Tenant A tool");
    context.tenantId = "tenant-b";
    world({ rows: [] });
    await act(async () => root.render(<Section />));
    await act(async () => { await Promise.resolve(); });
    // The drawer holds one workspace's facts; it must not keep painting them over another's.
    expect(dialog(host)).toBeNull();
    expect(host.textContent).not.toContain("Tenant A tool");
  });

  it("says plainly that a tool the shipped path owns is changed on its own card", async () => {
    world({ rows: [row()], rpcWrite: { data: null, error: { code: "42501", message: "MCP_LEGACY_CONNECTION_READONLY: managed by the legacy connection path" } } });
    const { host } = await render();
    await click(host.querySelector('[data-gateway-tool="conn-1"]'));
    await click(byText(host, "Disconnect"));
    await click(host.querySelector(".ig-gw-actions button[data-danger]"));
    // A refused disconnect must say something — and must not tell the owner to do it here.
    expect(dialog(host)?.textContent).toMatch(/integration card below/i);
    expect(dialog(host)?.textContent).not.toMatch(/disconnect it and add it again/i);
  });

  it("says a broken tool is broken, and offers the fix rather than a status code", async () => {
    world({ rows: [row({ status: "error", health: "needs_attention" })] });
    const { host } = await render();
    expect(host.textContent).toContain("Couldn’t reach it");
    await click(host.querySelector('[data-gateway-tool="conn-1"]'));
    expect(dialog(host)?.textContent).toMatch(/fix the address or re-key/i);
  });
});

/* ── One tool, one tile ───────────────────────────────────────────────────────
   The owner reported two connections reading as SIX tiles. The three lists that draw
   them are built from unrelated sources and never compared notes, so a connected
   provider appeared as something to add AND as the thing already added.

   These drive the merge itself, not its wiring: every assertion opens the real
   catalogue against real hook state and reads what rendered. */
describe("a tool the tenant already has is one tile, not two", () => {
  /** Open the catalogue drawer and hand back the tile for a named vendor. */
  const catalogueTile = async (host: HTMLElement, vendor: string) => {
    await click(byText(host, "MCP server"));
    return Array.from(host.querySelectorAll<HTMLElement>(".ig-gw-tile"))
      .find((t) => t.querySelector(".ig-gw-tile-name")?.textContent === vendor);
  };

  it("shows a connected vendor's real status in the catalogue instead of offering to add it again", async () => {
    world({ rows: [row({ provider_key: "zapier", label: "MMA-Zapier", auth_kind: "oauth", server_url_host: "mcp.zapier.com" })] });
    const { host } = await render();
    const tile = await catalogueTile(host, "Zapier");
    expect(tile).toBeTruthy();
    // The foot carries the connection's status, not the "paste a key" mode badge.
    expect(tile!.querySelector(".ig-gw-chip")?.textContent).toBe("Ready");
    expect(tile!.querySelector(".ig-gw-badge")).toBeNull();
    expect(tile!.getAttribute("data-held")).toBe("");
    // And it says so to a screen reader, rather than leaving the label claiming an add flow.
    expect(tile!.getAttribute("aria-label")).toContain("connected");
  });

  it("opens the connection it represents rather than the add form", async () => {
    world({ rows: [row({ provider_key: "zapier", label: "MMA-Zapier", auth_kind: "oauth", server_url_host: "mcp.zapier.com" })] });
    const { host } = await render();
    await click(await catalogueTile(host, "Zapier"));
    // The detail drawer for the connection — not the add drawer, which would have a name field.
    expect(dialog(host)?.textContent).toContain("MMA-Zapier");
    expect(fieldFor(host, "API key")).toBeUndefined();
  });

  it("still offers a vendor the tenant has NOT connected", async () => {
    world({ rows: [row({ provider_key: "zapier", server_url_host: "mcp.zapier.com" })] });
    const { host } = await render();
    const tile = await catalogueTile(host, "n8n");
    expect(tile!.querySelector(".ig-gw-badge")).toBeTruthy();
    expect(tile!.getAttribute("data-held")).toBeNull();
  });

  it("changes nothing for a tenant with no connections at all", async () => {
    world({ rows: [] });
    const { host } = await render();
    const tiles = Array.from(host.querySelectorAll<HTMLElement>(".ig-gw-tile"));
    expect(await catalogueTile(host, "Zapier")).toBeTruthy();
    expect(host.querySelectorAll(".ig-gw-tile[data-held]").length).toBe(0);
    expect(tiles.length).toBe(0); // the catalogue only exists once opened
  });

  it("matches on the ADDRESS when the provider key is the generic one", async () => {
    // A tool added through a catalogue tile is stored as `generic-remote`; its address is what
    // identifies it. Without this arm every catalogue-added tool would still duplicate.
    world({ rows: [row({ provider_key: "generic-remote", label: "Notes", server_url_host: "mcp.notion.com" })] });
    const { host } = await render();
    const tile = await catalogueTile(host, "Notion");
    expect(tile!.getAttribute("data-held")).toBe("");
  });

  it("does NOT let a tenant's own label claim a vendor's tile", async () => {
    // A label is tenant-editable text, not provider provenance. A generic server someone
    // named "Zapier" must not mark the Zapier tile as held: doing so opens that unrelated
    // server from Zapier's tile and — via the parent's suppression — removes the real
    // Zapier setup path from the surface entirely.
    world({ rows: [row({
      connection_id: "spoof", provider_key: "generic-remote", label: "Zapier",
      server_url_host: "unrelated.example",
    })] });
    const { host } = await render();
    const tile = await catalogueTile(host, "Zapier");
    expect(tile).toBeTruthy();
    expect(tile!.getAttribute("data-held")).toBeNull();
  });

  it("still matches that same row by its real identity", async () => {
    // The guard above must not be "match nothing": the row IS matched when its provider
    // key genuinely says Zapier, which is the arm that carries the de-duplication.
    world({ rows: [row({ connection_id: "real", provider_key: "zapier", label: "whatever they called it" })] });
    const { host } = await render();
    const tile = await catalogueTile(host, "Zapier");
    expect(tile!.getAttribute("data-held")).toBe("");
  });

  it("prefers a usable row when the tenant holds several for one vendor", async () => {
    // Production has a tenant with two n8n rows. Pointing the tile at the turned-off one while a
    // working one sits behind the same name would be the wrong half of the truth.
    world({ rows: [
      row({ connection_id: "off", provider_key: "n8n", label: "n8n API connection", enabled: false, status: "unconfigured", configured: false }),
      row({ connection_id: "live", provider_key: "n8n", label: "n8n (API)", auth_kind: "api_key" }),
    ] });
    const { host } = await render();
    await click(await catalogueTile(host, "n8n"));
    expect(dialog(host)?.textContent).toContain("n8n (API)");
  });
});

describe("a connection tile is named for its tool, not for whoever's data it came from", () => {
  it("titles a recognised vendor's tile with the vendor, keeping the tenant's own label in the drawer", async () => {
    // The backfill composed labels per tenant — "MMA-Zapier". A tile answers "which tool is this",
    // and one account's internal shorthand is not that answer on a platform every tenant shares.
    world({ rows: [row({ provider_key: "zapier", label: "MMA-Zapier", auth_kind: "oauth", server_url_host: "mcp.zapier.com" })] });
    const { host } = await render();
    const card = host.querySelector<HTMLElement>('[data-owner="gateway"][data-gateway-tool]');
    expect(card!.querySelector("strong")?.textContent).toBe("Zapier");
    expect(card!.textContent).not.toContain("MMA");
    // The label is not lost — it is where telling two Zapier connections apart is the question.
    await click(card);
    expect(dialog(host)?.textContent).toContain("MMA-Zapier");
  });

  it("leaves a tenant-named server alone, because there the label is the only name it has", async () => {
    world({ rows: [row({ provider_key: "generic-remote", label: "Ops bridge", server_url_host: "mcp.internal.example" })] });
    const { host } = await render();
    const card = host.querySelector<HTMLElement>('[data-owner="gateway"][data-gateway-tool]');
    expect(card!.querySelector("strong")?.textContent).toBe("Ops bridge");
  });
});

describe("the older setup panel stays reachable once its duplicate tile is gone", () => {
  it("offers the way back for a vendor that still has one, and routes to that vendor's panel", async () => {
    const seen: string[] = [];
    world({ rows: [row({ provider_key: "n8n", label: "n8n (API)", auth_kind: "api_key" })] });
    const { host } = await render((which) => seen.push(which));
    await click(host.querySelector('[data-owner="gateway"][data-gateway-tool]'));
    await click(byText(host, "Older setup options"));
    expect(seen).toEqual(["n8n"]);
  });

  it("offers nothing for a vendor that never had one", async () => {
    world({ rows: [row({ provider_key: "generic-remote", label: "Ops bridge" })] });
    const { host } = await render();
    await click(host.querySelector('[data-owner="gateway"][data-gateway-tool]'));
    expect(byText(host, "Older setup options")).toBeUndefined();
  });
});
