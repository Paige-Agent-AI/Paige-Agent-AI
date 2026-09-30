import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ rpc: vi.fn(), invoke: vi.fn(), tenant: "a" as string | null, user: "owner" as string | null, loading: false }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: h.rpc, functions: { invoke: h.invoke } } }));
vi.mock("@/hooks/useTenantContext", () => ({
  useTenantContext: () => ({ activeTenantId: h.tenant, activeUserId: h.user, loading: h.loading }),
}));

import {
  useMcpGateway,
  approvalExpiryFromMinutes,
  credentialTooShort,
  mcpGatewayMessage,
  APPROVAL_MIN_LIFETIME_MINUTES,
  type UseMcpGateway,
} from "./useMcpGateway";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | null = null;
let seen: UseMcpGateway[] = [];
function Probe() {
  seen.push(useMcpGateway());
  return null;
}
const latest = () => seen.at(-1)!;

/** One registry row as get_mcp_connections_v2 returns it (host + aggregates, NEVER a secret). */
const row = (label: string, over: Record<string, unknown> = {}) => ({
  connection_id: `id-${label}`,
  provider_key: "generic-remote",
  label,
  transport: "http",
  auth_kind: "bearer",
  configured: true,
  enabled: true,
  status: "pending_verification",
  health: "unknown",
  last_checked_at: null,
  granted_scopes: [],
  visibility: "tenant",
  server_url_host: "services.example.com",
  tool_count: 0,
  approved_count: 0,
  ...over,
});

const listOk = (labels: string[]) => ({ data: labels.map((l) => row(l)), error: null });

/**
 * The REAL `supabase.rpc()` returns a PostgrestFilterBuilder: a thenable with `then` and **no
 * `.catch`**. A plain-Promise double hides any code that calls `.catch` on the builder directly,
 * which is exactly how a `TypeError` that killed every write on this hook once passed both `tsc`
 * and this file. Every double below returns the real shape.
 */
const builder = <T,>(value: T) => ({
  then: <R1, R2>(ok?: ((v: T) => R1 | PromiseLike<R1>) | null, err?: ((e: unknown) => R2 | PromiseLike<R2>) | null) =>
    Promise.resolve(value).then(ok, err),
});

/**
 * A 2xx answer from `supabase.functions.invoke`.
 */
const edgeOk = (body: Record<string, unknown>) => ({ data: body, error: null });

/**
 * A NON-2xx answer, in the shape supabase-js actually produces.
 *
 * This is the whole reason the hook routes refusals through `readFunctionErrorBody`: on a non-2xx
 * the client sets `data = null` and the honest JSON body lives on the FunctionsHttpError's
 * `.context` Response. A double that put the code on `data` would let a hook that only ever reads
 * `data` pass this suite while showing the framework's raw "non-2xx status code" string in the
 * product — the exact jargon §3/§36 forbid.
 */
const edgeRefusal = (code: string, status = 400) => ({
  data: null,
  error: { name: "FunctionsHttpError", message: "Edge Function returned a non-2xx status code", context: { status, json: async () => ({ error: code }) } },
});

function defaultRpc(over: Partial<Record<string, unknown>> = {}) {
  return (name: string) => {
    if (name === "get_mcp_connections_v2") return builder(over.list ?? listOk(["A"]));
    if (name === "is_current_user_tenant_admin") return builder(over.admin ?? { data: true, error: null });
    return builder({ data: {}, error: null });
  };
}

async function mount() {
  h.rpc.mockImplementation(defaultRpc());
  // Default: any edge action not explicitly stubbed by a test answers an honest refusal.
  h.invoke.mockResolvedValue(edgeRefusal("create_failed", 500));
  const host = document.createElement("div");
  root = createRoot(host);
  await act(async () => {
    root!.render(<Probe />);
  });
  await act(async () => {}); // flush the load resolution
}
async function rerender() {
  await act(async () => {
    root!.render(<Probe />);
  });
  await act(async () => {});
}

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  seen = [];
  h.rpc.mockReset();
  h.invoke.mockReset();
  h.tenant = "a";
  h.user = "owner";
  h.loading = false;
});

describe("useMcpGateway", () => {
  it("confirms a save only from fresh same-connection, same-generation safe readback", async () => {
    await mount();
    h.rpc.mockImplementation(defaultRpc({ list: { data: [row("A", {
      config_generation: 3, address_configured: true, credentials_configured: true,
    })], error: null } }));
    let confirmed;
    await act(async () => { confirmed = await latest().confirmSaved("id-A", 3); });
    expect(confirmed).toMatchObject({ id: "id-A", configGeneration: 3, addressConfigured: true });
    await act(async () => { confirmed = await latest().confirmSaved("id-A", 4); });
    expect(confirmed).toBeNull();
    await act(async () => { confirmed = await latest().confirmSaved("id-missing", 3); });
    expect(confirmed).toBeNull();
    await act(async () => { confirmed = await latest().confirmSaved("id-A", null); });
    expect(confirmed).toBeNull();
    expect(h.invoke).not.toHaveBeenCalled();
  });

  it("failed or missing persisted readback cannot confirm a saved connection", async () => {
    await mount();
    for (const list of [{ data: null, error: { code: "offline" } }, { data: [], error: null }]) {
      h.rpc.mockImplementation(defaultRpc({ list }));
      let confirmed;
      await act(async () => { confirmed = await latest().confirmSaved("id-A", 3); });
      expect(confirmed).toBeNull();
    }
    expect(h.invoke).not.toHaveBeenCalled();
  });

  it.each(["tenant", "user"] as const)("rejects late saved readback after a %s switch", async (field) => {
    await mount();
    let resolve!: (value: unknown) => void;
    const deferred = new Promise((done) => { resolve = done; });
    h.rpc.mockImplementation((name: string) => name === "get_mcp_connections_v2"
      ? deferred : builder({ data: true, error: null }));
    let pending!: ReturnType<UseMcpGateway["confirmSaved"]>;
    await act(async () => { pending = latest().confirmSaved("id-A", 3); });
    h[field] = "next";
    h.rpc.mockImplementation(defaultRpc({ list: listOk(["B"]) }));
    await rerender();
    let confirmed;
    await act(async () => {
      resolve({ data: [row("A", { config_generation: 3, address_configured: true })], error: null });
      confirmed = await pending;
    });
    expect(confirmed).toBeNull();
    expect(latest().tools.map((tool) => tool.label)).toEqual(["B"]);
    expect(h.invoke).not.toHaveBeenCalled();
  });

  it("retains only safe credential presence and generation from canonical readback", async () => {
    await mount();
    h.rpc.mockImplementation(defaultRpc({ list: { data: [row("A", {
      address_configured: true, credentials_configured: false, custom_header_count: 2,
      config_generation: 4, server_url: "https://services.example.com/private-path",
      custom_headers: { "X-Private": "not-for-readback" }, auth_token: "not-for-readback",
    })], error: null } }));
    await act(async () => latest().reload());
    expect(latest().tools[0]).toMatchObject({
      addressConfigured: true, credentialsConfigured: false, customHeaderCount: 2, configGeneration: 4,
    });
    expect(JSON.stringify(latest().tools)).not.toMatch(/private-path|not-for-readback|X-Private/);
  });

  it("does not invent credential presence when older readback omits it", async () => {
    await mount();
    expect(latest().tools[0]).toMatchObject({
      addressConfigured: null, credentialsConfigured: null, customHeaderCount: null, configGeneration: null,
    });
  });

  it("sends supplementary headers through the canonical create and replacement writers", async () => {
    await mount();
    const customHeaders = { "X-Workspace": "test-workspace", "X-Access": "test-only-value" };
    h.invoke.mockResolvedValue(edgeOk({ connection_id: "id-A", status: "pending_verification" }));
    await act(async () => {
      await latest().createMcp({ providerKey: "generic-remote", label: "A",
        serverUrl: "https://services.example.com/mcp/", authKind: "bearer",
        authToken: "test-token-not-real", customHeaders });
    });
    expect(h.invoke.mock.calls.at(-1)![1].body).toMatchObject({
      action: "create", server_url: "https://services.example.com/mcp/", custom_headers: customHeaders,
    });
    h.rpc.mockImplementation((name: string) => name === "set_mcp_connection_endpoint"
      ? builder({ data: { connection_id: "id-A", status: "pending_verification" }, error: null })
      : defaultRpc()(name));
    await act(async () => {
      await latest().rekeyMcp("id-A", "https://services.example.com/mcp/", "bearer", "test-token-not-real", null, customHeaders);
    });
    expect(h.rpc.mock.calls.find(c => c[0] === "set_mcp_connection_endpoint")![1])
      .toMatchObject({ _custom_headers: customHeaders, _tenant_id: "a" });
    expect(JSON.stringify(latest().tools)).not.toContain("test-only-value");
  });

  it("does not accept a rejected write just because it includes an id", async () => {
    await mount();
    h.invoke.mockResolvedValue(edgeOk({ ok: false, connection_id: "id-A" }));
    let result: Awaited<ReturnType<UseMcpGateway["createMcp"]>> | undefined;
    await act(async () => {
      result = await latest().createMcp({ providerKey: "generic-remote", label: "A",
        serverUrl: "https://services.example.com/mcp/", authKind: "none" });
    });
    expect(result!.ok).toBe(false);
  });

  it("reports a rejected replacement and leaves retry available", async () => {
    await mount();
    h.rpc.mockImplementation((name: string) => name === "set_mcp_connection_endpoint"
      ? builder({ data: { ok: false, connection_id: "id-A" }, error: null }) : defaultRpc()(name));
    await act(async () => {
      expect((await latest().rekeyMcp("id-A", "https://services.example.com/mcp/", "none", null, null, {})).ok).toBe(false);
    });
    expect(latest().writeError).toBeTruthy();
    expect(latest().saving).toBe(false);
    h.rpc.mockImplementation((name: string) => name === "set_mcp_connection_endpoint"
      ? builder({ data: { connection_id: "id-A" }, error: null }) : defaultRpc()(name));
    await act(async () => {
      expect((await latest().rekeyMcp("id-A", "https://services.example.com/mcp/", "none", null, null, {})).ok).toBe(true);
    });
    expect(latest().writeError).toBeNull();
  });

  it("clears prior workspace write feedback immediately while the next workspace resolves", async () => {
    await mount();
    h.invoke.mockResolvedValue(edgeRefusal("MCP_BAD_CUSTOM_HEADERS"));
    await act(async () => {
      await latest().createMcp({ providerKey: "generic-remote", label: "A", serverUrl: "https://services.example.com/mcp/", authKind: "none" });
    });
    expect(latest().writeError).toMatch(/header names/i);
    h.tenant = "b";
    h.loading = true;
    await rerender();
    expect(latest().tools).toEqual([]);
    expect(latest().writeError).toBeNull();
    expect(latest().saving).toBe(false);
  });

  it("rejects a late credential replacement response after account switching", async () => {
    await mount();
    let resolveWrite!: (answer: unknown) => void;
    const delayed = new Promise(resolve => { resolveWrite = resolve; });
    h.rpc.mockImplementation((name: string) => name === "set_mcp_connection_endpoint" ? delayed : defaultRpc()(name));
    let pending!: ReturnType<UseMcpGateway["rekeyMcp"]>;
    await act(async () => {
      pending = latest().rekeyMcp("id-A", "https://services.example.com/mcp/", "bearer", "test-token-not-real", null, { "X-Workspace": "test-workspace" });
    });
    h.tenant = "b";
    h.rpc.mockImplementation(defaultRpc({ list: listOk(["B"]) }));
    await rerender();
    await act(async () => { resolveWrite({ data: { connection_id: "id-A" }, error: null }); });
    expect((await pending).code).toBe("MCP_STALE");
    expect(latest().tools.map(tool => tool.id)).toEqual(["id-B"]);
    expect(latest().writeError).toBeNull();
    expect(latest().saving).toBe(false);
  });

  it("reads the list with NO tenant argument (server-derived tenant)", async () => {
    await mount();
    const listCalls = h.rpc.mock.calls.filter((c) => c[0] === "get_mcp_connections_v2");
    expect(listCalls.length).toBeGreaterThan(0);
    // The truth-boundary seam: a get_* read carries only its own name, no args object.
    for (const call of listCalls) expect(call.length).toBe(1);
    expect(latest().tools.map((c) => c.label)).toEqual(["A"]);
    expect(latest().canWrite).toBe(true);
    expect(latest().error).toBe(false);
  });

  it("parses host + aggregates only and never surfaces a secret shape", async () => {
    await mount();
    const c = latest().tools[0];
    expect(c.serverUrlHost).toBe("services.example.com");
    expect(c.status).toBe("pending_verification");
    // No credential field of any kind is present on a rendered connection.
    expect(Object.keys(c)).not.toContain("authToken");
    expect(Object.keys(c)).not.toContain("last4");
    expect(JSON.stringify(latest())).not.toContain("secret");
  });

  it("masks another workspace's rows across a switch, then loads the new tenant", async () => {
    await mount();
    expect(latest().tools.map((c) => c.label)).toEqual(["A"]);
    const from = seen.length;
    h.rpc.mockImplementation(defaultRpc({ list: listOk(["B"]) }));
    h.tenant = "b";
    await rerender();
    // Every interim render between the switch and the new load is masked — never tenant A's rows.
    const interim = seen.slice(from);
    expect(interim.some((s) => s.tools.length === 0 && s.loading)).toBe(true);
    expect(interim.every((s) => !s.tools.some((c) => c.label === "A"))).toBe(true);
    expect(latest().tools.map((c) => c.label)).toEqual(["B"]);
  });

  it("distinguishes a failed READ from an empty account", async () => {
    h.rpc.mockImplementation(defaultRpc({ list: { data: null, error: { message: "boom" } } }));
    const host = document.createElement("div");
    root = createRoot(host);
    await act(async () => {
      root!.render(<Probe />);
    });
    await act(async () => {});
    expect(latest().error).toBe(true);
    expect(latest().tools).toEqual([]);
    expect(latest().canWrite).toBe(false);
  });

  it("refuses a write for a non-admin caller with the closed-set forbidden message", async () => {
    h.rpc.mockImplementation(defaultRpc({ admin: { data: false, error: null } }));
    const host = document.createElement("div");
    root = createRoot(host);
    await act(async () => {
      root!.render(<Probe />);
    });
    await act(async () => {});
    expect(latest().canWrite).toBe(false);
    let result: Awaited<ReturnType<UseMcpGateway["createRest"]>> | null = null;
    await act(async () => {
      result = await latest().createRest({ label: "n8n", baseUrl: "https://x.app.n8n.cloud", apiKey: "n8n_api_abc123" });
    });
    expect(result!.ok).toBe(false);
    expect(result!.code).toBe("MCP_FORBIDDEN");
    expect(result!.message).toMatch(/permission/i);
  });

  it("creates a REST connection through the gateway edge, carrying the expected-tenant guard", async () => {
    await mount();
    h.invoke.mockResolvedValue(edgeOk({ connection_id: "id-new", status: "pending_verification", auth_token_last4: null }));
    let result: Awaited<ReturnType<UseMcpGateway["createRest"]>> | null = null;
    await act(async () => {
      result = await latest().createRest({ label: "n8n workflows", baseUrl: "https://x.app.n8n.cloud", apiKey: "n8n_api_abc123456" });
    });
    expect(result!.ok).toBe(true);
    expect(result!.status).toBe("pending_verification");
    expect(result!.connectionId).toBe("id-new");
    // The one door, dispatched on action — never the writer RPC directly any more.
    expect(h.invoke).toHaveBeenCalledWith("mcp-gateway", {
      body: {
        action: "create",
        expected_tenant_id: "a",
        facet: "rest",
        provider_key: "n8n",
        label: "n8n workflows",
        base_url: "https://x.app.n8n.cloud",
        api_key: "n8n_api_abc123456",
      },
    });
    // The create writers must NOT be called directly once the rebind has landed.
    expect(h.rpc.mock.calls.some((c) => String(c[0]).startsWith("create_mcp"))).toBe(false);
  });

  it("sends only the credential the chosen auth kind uses", async () => {
    await mount();
    h.invoke.mockResolvedValue(edgeOk({ connection_id: "id-b", status: "pending_verification" }));
    await act(async () => {
      await latest().createMcp({ providerKey: "generic-remote", label: "B", serverUrl: "https://s.example.com/mcp", authKind: "url", authToken: "should-not-travel", authHeaderName: "X-Nope" });
    });
    const body = h.invoke.mock.calls.at(-1)![1].body as Record<string, unknown>;
    // `url` carries no credential by contract; the writer refuses a stray field from another scheme.
    expect(body.auth_token).toBeNull();
    expect(body.auth_header_name).toBeNull();
    expect(JSON.stringify(body)).not.toContain("should-not-travel");
  });

  it("maps a duplicate-label refusal — read off the non-2xx body, not off data", async () => {
    await mount();
    h.invoke.mockResolvedValue(edgeRefusal("MCP_DUPLICATE_LABEL"));
    let result: Awaited<ReturnType<UseMcpGateway["createMcp"]>> | null = null;
    await act(async () => {
      result = await latest().createMcp({ providerKey: "generic-remote", label: "A", serverUrl: "https://services.example.com/mcp", authKind: "bearer", authToken: "bearer-token-123456" });
    });
    expect(result!.ok).toBe(false);
    expect(result!.code).toBe("MCP_DUPLICATE_LABEL");
    expect(result!.message).toMatch(/already have a tool with that name/i);
    expect(latest().writeError).toMatch(/already have a tool with that name/i);
    // The framework's own string must never reach the owner.
    expect(result!.message).not.toMatch(/non-2xx/i);
  });

  it("speaks the edge's OWN lowercase vocabulary, not only the writers' MCP_* set", async () => {
    await mount();
    h.invoke.mockResolvedValue(edgeRefusal("tenant_mismatch", 409));
    let result: Awaited<ReturnType<UseMcpGateway["createMcp"]>> | null = null;
    await act(async () => {
      result = await latest().createMcp({ providerKey: "generic-remote", label: "A", serverUrl: "https://s.example.com/mcp", authKind: "bearer", authToken: "bearer-token-123456" });
    });
    expect(result!.code).toBe("tenant_mismatch");
    expect(result!.message).toMatch(/switched workspace/i);
  });

  it("reports a probe that REACHED a broken server as a real verdict, not a transport failure", async () => {
    await mount();
    // verify answers 200 with ok:false when the server was reached and could not be used.
    h.invoke.mockResolvedValue(edgeOk({ ok: false, status: "error", health: "needs_attention", tool_count: 0, error_code: "provider_reflected_credential" }));
    let result: Awaited<ReturnType<UseMcpGateway["verify"]>> | null = null;
    await act(async () => {
      result = await latest().verify("11111111-1111-1111-1111-111111111111");
    });
    expect(result!.ok).toBe(false);
    expect(result!.probeStatus).toBe("error");
    expect(result!.probeError).toBe("provider_reflected_credential");
    expect(result!.message).toMatch(/sent your key back/i);
    // A probe verdict is not a REQUEST refusal, so it must not borrow a refusal code.
    expect(result!.code).toBeNull();
  });

  it("reads the verify race verdict off a REAL 409, whose body carries no `error` key", async () => {
    await mount();
    // Two things are load-bearing and an earlier version of this test got both wrong by feeding the
    // body as a 200: (a) verify.ts returns this shape with httpStatus 409, so supabase-js sets
    // `data = null` and an error, and (b) the body keys the reason on `error_code`, with NO `error`
    // key — so a reader that only looks at `error` drops the verdict and falls back to the generic
    // line, leaving this message unreachable. Feeding it as a 200 green-lit exactly the gap the test
    // is named for.
    h.invoke.mockResolvedValue({
      data: null,
      error: {
        name: "FunctionsHttpError",
        message: "Edge Function returned a non-2xx status code",
        context: { status: 409, json: async () => ({ ok: false, status: "pending_verification", tool_count: 0, error_code: "config_changed_during_verify" }) },
      },
    });
    let result: Awaited<ReturnType<UseMcpGateway["verify"]>> | null = null;
    await act(async () => {
      result = await latest().verify("11111111-1111-1111-1111-111111111111");
    });
    expect(result!.ok).toBe(false);
    expect(result!.probeError).toBe("config_changed_during_verify");
    expect(result!.message).toMatch(/changed while it was being checked/i);
    // The 409 body omits `health` entirely — a shape asymmetry the reader must survive rather than
    // read `undefined` as a health value.
    expect(result!.probeHealth).toBeNull();
    expect(result!.probeStatus).toBe("pending_verification");
  });

  it("never reports a sign-in it cannot actually send the browser to", async () => {
    await mount();
    // A 200 with no authorize_url is not a flow. Claiming success would navigate to `undefined`.
    h.invoke.mockResolvedValue(edgeOk({ ok: true }));
    let result: Awaited<ReturnType<UseMcpGateway["beginOAuth"]>> | null = null;
    await act(async () => {
      result = await latest().beginOAuth("11111111-1111-1111-1111-111111111111");
    });
    expect(result!.ok).toBe(false);
    expect(result!.authorizeUrl ?? null).toBeNull();
  });

  it("hands back the authorize URL and does NOT navigate by itself", async () => {
    await mount();
    h.invoke.mockResolvedValue(edgeOk({ authorize_url: "https://provider.example/authorize?x=1" }));
    let result: Awaited<ReturnType<UseMcpGateway["beginOAuth"]>> | null = null;
    await act(async () => {
      result = await latest().beginOAuth("11111111-1111-1111-1111-111111111111");
    });
    expect(result!.ok).toBe(true);
    expect(result!.authorizeUrl).toBe("https://provider.example/authorize?x=1");
    expect(h.invoke).toHaveBeenCalledWith("mcp-gateway", {
      body: { action: "oauth_begin", expected_tenant_id: "a", connection_id: "11111111-1111-1111-1111-111111111111" },
    });
  });

  it("refuses to claim consent the server did not confirm", async () => {
    await mount();
    // ok without approved:true is not an approval, whatever else the body says (§13).
    h.invoke.mockResolvedValue(edgeOk({ ok: true, connection_id: "c1", tool_name: "send_email" }));
    let result: Awaited<ReturnType<UseMcpGateway["approveTool"]>> | null = null;
    await act(async () => {
      result = await latest().approveTool("c1", "send_email", { kind: "no_expiry" });
    });
    expect(result!.ok).toBe(false);
  });

  it("sends an approval with its expiry, and omits the key only for a deliberate no-expiry", async () => {
    await mount();
    h.invoke.mockResolvedValue(edgeOk({ ok: true, connection_id: "c1", tool_name: "send_email", approved: true }));
    await act(async () => {
      await latest().approveTool("c1", "send_email", { kind: "expires", at: "2027-01-01T00:00:00.000Z" });
    });
    expect((h.invoke.mock.calls.at(-1)![1].body as Record<string, unknown>).expires_at).toBe("2027-01-01T00:00:00.000Z");
    await act(async () => {
      await latest().approveTool("c1", "send_email", { kind: "no_expiry" });
    });
    expect((h.invoke.mock.calls.at(-1)![1].body as Record<string, unknown>)).not.toHaveProperty("expires_at");
  });

  it("NEVER sends a sub-floor lifetime as an omission — the fail-open this type exists to stop", async () => {
    // The defect: omitting `expires_at` means NO EXPIRY to the handler. When a sub-floor value and
    // "no expiry" were both `null`, asking for 1 minute produced a PERMANENT approval — the most
    // permissive outcome for the most suspicious input.
    await mount();
    h.invoke.mockResolvedValue(edgeOk({ ok: true, connection_id: "c1", tool_name: "send_email", approved: true }));
    const before = h.invoke.mock.calls.length;
    let result: Awaited<ReturnType<UseMcpGateway["approveTool"]>> | null = null;
    await act(async () => {
      result = await latest().approveTool("c1", "send_email", approvalExpiryFromMinutes(1, Date.now()));
    });
    expect(result!.ok).toBe(false);
    expect(result!.code).toBe("expiry_below_floor");
    expect(result!.message).toMatch(/at least 15 minutes/i);
    // Nothing reached the wire at all — no approval, permanent or otherwise.
    expect(h.invoke.mock.calls.length).toBe(before);
  });

  it("keeps re-key and disconnect on their RPC writers — the edge has no door for them (§58)", async () => {
    await mount();
    h.rpc.mockImplementation((name: string) => {
      if (name === "disconnect_mcp_connection") return builder({ data: { connection_id: "c1", mode: "soft" }, error: null });
      return defaultRpc()(name);
    });
    let result: Awaited<ReturnType<UseMcpGateway["disconnect"]>> | null = null;
    await act(async () => {
      result = await latest().disconnect("c1", false);
    });
    expect(result!.ok).toBe(true);
    const call = h.rpc.mock.calls.find((c) => c[0] === "disconnect_mcp_connection");
    expect(call).toBeTruthy();
    expect((call![1] as Record<string, unknown>)._tenant_id).toBe("a");
    // It must NOT have been sent to the gateway, which would 400 `unsupported_action`.
    expect(h.invoke.mock.calls.some((c) => (c[1]?.body as Record<string, unknown>)?.action === "disconnect")).toBe(false);
  });
});

describe("the INT-153 credential floor, mirrored from the server", () => {
  it("applies to bearer and header only — exactly the kinds the SQL gates", () => {
    expect(credentialTooShort("bearer", "short")).toBe(true);
    expect(credentialTooShort("header", "short")).toBe(true);
    expect(credentialTooShort("bearer", "twelve-chars")).toBe(false);
    // oauth tokens are provider-minted and are NOT scanned; gating them would refuse a real token.
    expect(credentialTooShort("oauth", "short")).toBe(false);
    // the n8n REST facet never reaches the bundle helper; a floor here would invent a server rule.
    expect(credentialTooShort("api_key", "short")).toBe(false);
    expect(credentialTooShort("url", "")).toBe(false);
  });

  it("trims first, exactly as `length(btrim(_auth_token)) < 12` does", () => {
    expect(credentialTooShort("bearer", "   abc   ")).toBe(true);
    expect(credentialTooShort("bearer", "  123456789012  ")).toBe(false);
  });

  it("names the refusal in owner language instead of a raw code", () => {
    expect(mcpGatewayMessage("MCP_CREDENTIAL_TOO_SHORT")).toMatch(/too short/i);
    expect(mcpGatewayMessage("MCP_CREDENTIAL_TOO_SHORT")).toContain("12");
  });
});

describe("the approval-lifetime floor", () => {
  const NOW = Date.parse("2026-09-23T12:00:00.000Z");

  it("builds an expiry the approve door accepts", () => {
    expect(approvalExpiryFromMinutes(60, NOW)).toEqual({ kind: "expires", at: "2026-09-23T13:00:00.000Z" });
  });

  it("REFUSES a lifetime under the floor — distinctly from choosing no expiry", () => {
    // A ~2-minute approval can pass the edge clock check and still be dead at or before first use:
    // five round trips to the trigger, a 60s browser/server skew the checkers grant no grace for,
    // and another external round trip before consent is even asked about at execute time.
    expect(approvalExpiryFromMinutes(1, NOW).kind).toBe("below_floor");
    expect(approvalExpiryFromMinutes(APPROVAL_MIN_LIFETIME_MINUTES - 1, NOW).kind).toBe("below_floor");
    expect(approvalExpiryFromMinutes(APPROVAL_MIN_LIFETIME_MINUTES, NOW).kind).toBe("expires");
    // The decisive property: a refusal is NOT the same value as "no expiry". Collapsing them is
    // what made a one-minute request produce a permanent approval.
    expect(approvalExpiryFromMinutes(1, NOW)).not.toEqual({ kind: "no_expiry" });
  });

  it("refuses a non-finite lifetime rather than minting an Invalid Date", () => {
    expect(approvalExpiryFromMinutes(Number.NaN, NOW).kind).toBe("below_floor");
    expect(approvalExpiryFromMinutes(Number.POSITIVE_INFINITY, NOW).kind).toBe("below_floor");
  });

  it("caps at the maximum instead of writing an unbounded lifetime", async () => {
    const { APPROVAL_MAX_LIFETIME_MINUTES } = await import("./useMcpGateway");
    const over = approvalExpiryFromMinutes(APPROVAL_MAX_LIFETIME_MINUTES * 10, NOW);
    const capped = approvalExpiryFromMinutes(APPROVAL_MAX_LIFETIME_MINUTES, NOW);
    expect(over).toEqual(capped);
  });

  it("offers no 'until I revoke it' choice, because no per-tool revoke exists to name", async () => {
    const { APPROVAL_LIFETIME_CHOICES, APPROVAL_MAX_LIFETIME_MINUTES } = await import("./useMcpGateway");
    // §68 (no authority is permanent) AND §70.2 (never offer a control that does not exist): the
    // edge dispatches no `revoke` action and every approval DELETE in the schema is
    // connection-scoped, so expires_at is the ONLY per-tool withdrawal there is.
    expect(APPROVAL_LIFETIME_CHOICES.length).toBeGreaterThan(0);
    for (const choice of APPROVAL_LIFETIME_CHOICES) {
      expect(typeof choice.minutes).toBe("number");
      expect(choice.minutes).toBeGreaterThanOrEqual(APPROVAL_MIN_LIFETIME_MINUTES);
      expect(choice.minutes).toBeLessThanOrEqual(APPROVAL_MAX_LIFETIME_MINUTES);
      expect(approvalExpiryFromMinutes(choice.minutes, NOW).kind).toBe("expires");
    }
    expect(APPROVAL_LIFETIME_CHOICES.some((c) => (c as { label: string }).label.toLowerCase().includes("revoke"))).toBe(false);
  });
});
