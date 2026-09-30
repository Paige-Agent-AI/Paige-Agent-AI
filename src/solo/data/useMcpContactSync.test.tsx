import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ rpc: vi.fn(), invoke: vi.fn(), tenant: "test-tenant-a" as string | null,
  user: "test-owner-a" as string | null, loading: false }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: h.rpc, functions: { invoke: h.invoke } } }));
vi.mock("@/hooks/useTenantContext", () => ({ useTenantContext: () => ({
  activeTenantId: h.tenant, activeUserId: h.user, loading: h.loading,
}) }));

import { useMcpGateway, type UseMcpGateway } from "./useMcpGateway";
import type { ContactSyncResult } from "./mcpContactSync";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | null = null;
let observed: UseMcpGateway;
function Probe() { observed = useMcpGateway(); return null; }
const current = () => observed;
const id = "test-connection-a";
// Synthetic local input, never a provider credential or production fixture.
const credential = "synthetic-contact-credential-for-unit-tests";
const grant = (over: Record<string, unknown> = {}) => ({
  connection_id: id, tenant_id: "test-tenant-a", enabled: false, configured_enabled: false,
  credential_configured: false, generation: 0, granted_at: null,
  operation: "contacts.create_update", ...over,
});
const enabled = (over: Record<string, unknown> = {}) => grant({ enabled: true,
  configured_enabled: true, credential_configured: true, generation: 1,
  granted_at: "2026-09-30T12:00:00.000Z", ...over });
// Postgrest builders have .then, not .catch. Do not hide that boundary with Promise mocks.
const builder = <T,>(value: T) => ({ then: <A, B>(resolve?: ((value: T) => A | PromiseLike<A>) | null,
  reject?: ((reason: unknown) => B | PromiseLike<B>) | null) => Promise.resolve(value).then(resolve, reject) });
const ok = (data: unknown) => builder({ data, error: null });
function deferred() {
  let resolve!: (value: unknown) => void;
  const promise = new Promise<unknown>(done => { resolve = done; });
  return { promise, resolve };
}
function configure(overrides: Record<string, () => unknown> = {}, admin = true) {
  h.rpc.mockImplementation((name: string) => {
    if (overrides[name]) return overrides[name]();
    if (name === "get_mcp_connections_v2") return ok([]);
    if (name === "is_current_user_tenant_admin") return ok(admin);
    if (name === "get_mcp_contact_sync") return ok(grant());
    return ok(null);
  });
}
async function mount(admin = true) {
  configure({}, admin);
  root = createRoot(document.createElement("div"));
  await act(async () => { root!.render(<Probe />); });
}
async function render() { await act(async () => { root!.render(<Probe />); }); }
async function call(run: () => Promise<ContactSyncResult>) {
  let result!: ContactSyncResult;
  await act(async () => { result = await run(); });
  return result;
}
const writes = () => h.rpc.mock.calls.filter(c => ["create_mcp_inbound_connection", "set_mcp_contact_sync"].includes(c[0]));

afterEach(() => {
  act(() => root?.unmount()); root = null;
  h.rpc.mockReset(); h.invoke.mockReset(); h.tenant = "test-tenant-a";
  h.user = "test-owner-a"; h.loading = false;
});

describe("incoming contact canonical read and commit confirmation", () => {
  it("uses the existing scoped RPC and returns only a safe explicit projection", async () => {
    await mount();
    configure({ get_mcp_contact_sync: () => ok(enabled({ secret_hash: "never-return-hash", secret: "never-return-secret" })) });
    const result = await call(() => current().readContactSync(id));
    expect(result).toEqual({ ok: true, code: null, message: null, record: {
      connectionId: id, tenantId: "test-tenant-a", enabled: true, configuredEnabled: true,
      credentialConfigured: true, generation: 1, grantedAt: "2026-09-30T12:00:00.000Z", operation: "contacts.create_update",
    } });
    expect(h.rpc).toHaveBeenCalledWith("get_mcp_contact_sync", { _connection_id: id, _tenant_id: "test-tenant-a" });
    expect(JSON.stringify(result)).not.toMatch(/never-return|secret_hash/);
    expect(h.invoke).not.toHaveBeenCalled();
  });

  it.each([
    ["wrong business", { tenant_id: "test-tenant-b" }], ["wrong connection", { connection_id: "test-connection-b" }],
    ["negative generation", { generation: -1 }], ["fractional generation", { generation: 1.5 }],
    ["string boolean", { enabled: "false" }], ["wrong operation", { operation: "contacts.delete" }],
    ["missing credential presence", { credential_configured: undefined }],
    ["invalid timestamp", { granted_at: "yesterday" }], ["enabled without grant", { enabled: true }],
  ])("refuses %s in canonical readback", async (_name, patch) => {
    await mount(); configure({ get_mcp_contact_sync: () => ok(grant(patch)) });
    const result = await call(() => current().readContactSync(id));
    expect(result).toMatchObject({ ok: false, code: "MCP_CONTACT_READ_UNAVAILABLE", record: null });
  });

  it("preserves configured grant separately from effective permission after grantor access is lost", async () => {
    await mount(); configure({ get_mcp_contact_sync: () => ok(enabled({ enabled: false })) });
    expect(await call(() => current().readContactSync(id))).toMatchObject({ ok: true,
      record: { enabled: false, configuredEnabled: true, credentialConfigured: true } });
  });

  it("confirms creation only after the same canonical empty record is read afresh", async () => {
    await mount(); configure({ create_mcp_inbound_connection: () => ok(grant()) });
    const result = await call(() => current().createIncoming("Incoming contacts"));
    expect(result).toMatchObject({ ok: true, record: { connectionId: id, generation: 0, enabled: false } });
    expect(writes()).toEqual([["create_mcp_inbound_connection", { _label: "Incoming contacts", _tenant_id: "test-tenant-a" }]]);
    expect(h.rpc.mock.calls.findIndex(c => c[0] === "get_mcp_contact_sync"))
      .toBeGreaterThan(h.rpc.mock.calls.findIndex(c => c[0] === "create_mcp_inbound_connection"));
    expect(h.invoke).not.toHaveBeenCalled();
  });

  it.each([null, { connection_id: id }, grant({ tenant_id: "test-tenant-b" }), enabled()])(
    "never claims creation from a malformed or unexpected acknowledgement %#", async ack => {
      await mount(); configure({ create_mcp_inbound_connection: () => ok(ack) });
      expect(await call(() => current().createIncoming("Incoming contacts")))
        .toMatchObject({ ok: false, code: "MCP_CONTACT_OUTCOME_UNKNOWN", record: null });
      expect(writes()).toHaveLength(1);
    });

  it("confirms an enabled grant only after exact generation and configuration readback", async () => {
    await mount(); configure({ set_mcp_contact_sync: () => ok(enabled()), get_mcp_contact_sync: () => ok(enabled()) });
    expect(await call(() => current().setContactSync(id, true, credential, 0)))
      .toMatchObject({ ok: true, record: { connectionId: id, generation: 1, enabled: true } });
    expect(writes()).toEqual([["set_mcp_contact_sync", { _connection_id: id, _enabled: true,
      _secret: credential, _expected_generation: 0, _tenant_id: "test-tenant-a" }]]);
    expect(h.invoke).not.toHaveBeenCalled();
  });

  it("revokes through the same writer, sends no secret, and reads the cleared grant", async () => {
    await mount(); const revoked = grant({ generation: 2 });
    configure({ set_mcp_contact_sync: () => ok(revoked), get_mcp_contact_sync: () => ok(revoked) });
    expect(await call(() => current().setContactSync(id, false, credential, 1))).toMatchObject({ ok: true,
      record: { generation: 2, enabled: false, configuredEnabled: false, credentialConfigured: false } });
    expect(writes()[0][1]).toMatchObject({ _enabled: false, _secret: null, _expected_generation: 1 });
  });

  it.each([
    ["old generation", enabled({ generation: 0 })], ["skipped generation", enabled({ generation: 2 })],
    ["wrong record", enabled({ connection_id: "test-connection-b" })],
    ["wrong tenant", enabled({ tenant_id: "test-tenant-b" })], ["opposite configuration", grant({ generation: 1 })],
  ])("does not accept a write acknowledgement with %s", async (_name, ack) => {
    await mount(); configure({ set_mcp_contact_sync: () => ok(ack) });
    expect(await call(() => current().setContactSync(id, true, credential, 0)))
      .toMatchObject({ ok: false, code: "MCP_CONTACT_OUTCOME_UNKNOWN", record: null });
    expect(writes()).toHaveLength(1);
  });

  it.each([grant(), enabled({ generation: 2 }), enabled({ enabled: false }), null])(
    "requires fresh readback matching the whole acknowledgement %#", async readback => {
      await mount(); configure({ set_mcp_contact_sync: () => ok(enabled()), get_mcp_contact_sync: () => ok(readback) });
      expect(await call(() => current().setContactSync(id, true, credential, 0)))
        .toMatchObject({ ok: false, code: "MCP_CONTACT_OUTCOME_UNKNOWN", record: null });
      expect(writes()).toHaveLength(1);
    });

  it("a lost reply is unknown and never automatically retried", async () => {
    await mount(); configure({ create_mcp_inbound_connection: () => Promise.reject(new Error("network lost")) });
    expect(await call(() => current().createIncoming("Incoming contacts")))
      .toMatchObject({ ok: false, code: "MCP_CONTACT_OUTCOME_UNKNOWN", record: null });
    expect(writes()).toHaveLength(1); expect(current().saving).toBe(false);
  });

  it("a failed read after commit reports unknown, never saved", async () => {
    await mount(); configure({ set_mcp_contact_sync: () => ok(enabled()),
      get_mcp_contact_sync: () => builder({ data: null, error: { code: "offline" } }) });
    expect(await call(() => current().setContactSync(id, true, credential, 0)))
      .toMatchObject({ ok: false, code: "MCP_CONTACT_OUTCOME_UNKNOWN", record: null });
    expect(writes()).toHaveLength(1);
  });

  it("holds the write lock until delayed readback finishes", async () => {
    await mount(); const read = deferred();
    configure({ set_mcp_contact_sync: () => ok(enabled()), get_mcp_contact_sync: () => read.promise });
    let pending!: Promise<ContactSyncResult>;
    await act(async () => { pending = current().setContactSync(id, true, credential, 0); });
    expect(current().saving).toBe(true);
    expect(await call(() => current().createIncoming("Second connection"))).toMatchObject({ ok: false, code: "MCP_BUSY" });
    let result!: ContactSyncResult;
    await act(async () => { read.resolve({ data: enabled(), error: null }); result = await pending; });
    expect(result.ok).toBe(true); expect(current().saving).toBe(false); expect(writes()).toHaveLength(1);
  });
});

describe("incoming contact scope and authority fences", () => {
  it("refuses writes from a caller without management permission", async () => {
    await mount(false);
    expect(await call(() => current().createIncoming("Incoming contacts"))).toMatchObject({ ok: false, code: "MCP_FORBIDDEN" });
    expect(await call(() => current().setContactSync(id, true, credential, 0))).toMatchObject({ ok: false, code: "MCP_FORBIDDEN" });
    expect(writes()).toHaveLength(0);
  });

  it.each(["tenant", "user", "loading"] as const)("rejects late read and write answers after %s changes", async field => {
    await mount(); const read = deferred(); const write = deferred();
    configure({ get_mcp_contact_sync: () => read.promise, set_mcp_contact_sync: () => write.promise });
    let reading!: Promise<ContactSyncResult>; let writing!: Promise<ContactSyncResult>;
    await act(async () => {
      reading = current().readContactSync(id); writing = current().setContactSync(id, true, credential, 0);
    });
    if (field === "loading") h.loading = true; else h[field] = "test-next-scope";
    configure(); await render();
    let readResult!: ContactSyncResult; let writeResult!: ContactSyncResult;
    await act(async () => {
      read.resolve({ data: grant(), error: null }); write.resolve({ data: enabled(), error: null });
      readResult = await reading; writeResult = await writing;
    });
    expect(readResult).toMatchObject({ ok: false, code: "MCP_STALE", record: null });
    expect(writeResult).toMatchObject({ ok: false, code: "MCP_STALE", record: null });
    expect(current().writeError).toBeNull(); expect(current().saving).toBe(false);
  });

  it("rejects a late answer after unmount", async () => {
    await mount(); const read = deferred(); configure({ get_mcp_contact_sync: () => read.promise });
    const pending = current().readContactSync(id);
    act(() => { root!.unmount(); root = null; });
    read.resolve({ data: grant(), error: null });
    expect(await pending).toMatchObject({ ok: false, code: "MCP_STALE", record: null });
  });

  it("sends no request until a business and caller resolve", async () => {
    h.tenant = null; h.user = null; h.loading = true; await mount(); h.rpc.mockClear();
    expect(await call(() => current().readContactSync(id))).toMatchObject({ ok: false, code: "MCP_NOT_READY" });
    expect(await call(() => current().createIncoming("Incoming contacts"))).toMatchObject({ ok: false, code: "MCP_NOT_READY" });
    expect(h.rpc).not.toHaveBeenCalled(); expect(h.invoke).not.toHaveBeenCalled();
  });
});
