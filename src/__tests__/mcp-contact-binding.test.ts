import { readFileSync } from "node:fs";
import { webcrypto } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { handleContactSyncRequest } from "../../supabase/functions/paige-bridge/contact-mirror";

beforeEach(() => vi.stubGlobal("crypto", webcrypto));
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

const credential = "test-incoming-secret-not-a-real-credential";
const payload = {
  connection_id: "20000000-0000-4000-8000-000000000021",
  generation: 3,
  event_id: "20000000-0000-4000-8000-000000000031",
  external_id: "external-contact-1",
  source_updated_at: "2026-09-29T00:00:00.000Z",
  email: "ada@example.test",
  first_name: "Ada",
  last_name: "Lovelace",
};
const receipt = { client_id: "20000000-0000-4000-8000-000000000041", action: "created", replayed: false };
const request = (authorization: string | null = `Bearer ${credential}`) => new Request("https://bridge.example.test", {
  method: "POST", headers: authorization === null ? {} : { Authorization: authorization },
});
const database = (data: unknown = receipt, error: unknown = null) => ({
  rpc: vi.fn().mockResolvedValue({ data, error }), from: vi.fn(),
});

describe("connection-bound contact sync Request/Response contract", () => {
  it("returns a non-cacheable safe acknowledgement after the one scoped transaction", async () => {
    const db = database();
    const response = await handleContactSyncRequest(db, request(), payload);
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("application/json");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toEqual({ verb: "upsert_contact_mirror", ok: true, data: receipt });
    expect(db.rpc).toHaveBeenCalledTimes(2);
    expect(db.rpc).toHaveBeenLastCalledWith("sync_mcp_connection_contact", {
      _connection_id: payload.connection_id, _secret: credential, _generation: 3,
      _event_id: payload.event_id, _external_id: payload.external_id,
      _source_updated_at: payload.source_updated_at,
      _contact: { email: payload.email, first_name: "Ada", last_name: "Lovelace" },
    });
    expect(db.from).not.toHaveBeenCalled();
  });

  it.each([null, "", "Basic test-only", "Bearer short", `Bearer ${"x".repeat(513)}`])(
    "rejects missing or malformed per-connection authorization %# before any DB call", async (authorization) => {
      const db = database();
      const response = await handleContactSyncRequest(db, request(authorization), payload);
      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({ verb: "upsert_contact_mirror", ok: false, error: "contact_sync_not_authorized" });
      expect(db.rpc).not.toHaveBeenCalled();
      expect(db.from).not.toHaveBeenCalled();
    },
  );

  it.each([
    null, [], {}, { ...payload, connection_id: "not-a-uuid" }, { ...payload, event_id: null },
    { ...payload, generation: 0 }, { ...payload, generation: 1.5 }, { ...payload, generation: "3" },
    { ...payload, generation: Number.MAX_SAFE_INTEGER + 1 },
    { ...payload, source_updated_at: "2026-09-29" }, { ...payload, source_updated_at: "badTdateZ" },
    { ...payload, email: 12 }, { ...payload, email: "x".repeat(255) },
    { ...payload, external_id: " " }, { ...payload, external_id: "x".repeat(256) },
    { ...payload, first_name: "x".repeat(101) }, { ...payload, phone: {} },
    { ...payload, tenant_id: "test-tenant-other" }, { ...payload, owner_id: "other-owner" },
    { ...payload, assigned_user_id: "other-user" }, { ...payload, credential },
    { ...payload, contact: { tenant_id: "test-tenant-other" } },
  ])("refuses invalid envelopes and caller-selected authority before persistence %#", async (body) => {
    const db = database();
    const response = await handleContactSyncRequest(db, request(), body);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ verb: "upsert_contact_mirror", ok: false, error: "contact_sync_invalid_request" });
    expect(db.rpc).not.toHaveBeenCalled();
    expect(db.from).not.toHaveBeenCalled();
  });

  it("supports legacy name/external-id aliases without restoring legacy authority", async () => {
    const db = database();
    const { external_id, first_name, last_name, ...base } = payload;
    const response = await handleContactSyncRequest(db, request(), {
      ...base, ghl_contact_id: external_id, full_name: `${first_name} ${last_name}`,
      phone: "12", assigned_to_email: "member@example.test",
    });
    expect(response.status).toBe(200);
    expect(db.rpc.mock.calls.at(-1)?.[1]).toEqual({
      _connection_id: payload.connection_id, _secret: credential, _generation: 3,
      _event_id: payload.event_id, _external_id: external_id, _source_updated_at: payload.source_updated_at,
      _contact: { email: payload.email, first_name, last_name, phone: "12", assigned_to_email: "member@example.test" },
    });
    // Phone validity and tenant membership are resolved transactionally, never guessed by this adapter.
    expect(db.from).not.toHaveBeenCalled();
  });

  it("does not invent replacement names when a partial contact update omits them", async () => {
    const db = database();
    const body = { ...payload } as Record<string, unknown>;
    delete body.first_name;
    delete body.last_name;
    expect((await handleContactSyncRequest(db, request(), body)).status).toBe(200);
    expect(db.rpc.mock.calls.at(-1)?.[1]._contact).toEqual({ email: payload.email });
  });

  it("preserves the shared ingress cap and never writes an over-limit request", async () => {
    const db = database(false);
    const response = await handleContactSyncRequest(db, request(), payload);
    expect(response.status).toBe(429);
    expect(await response.json()).toEqual({ verb: "upsert_contact_mirror", ok: false, error: "contact_sync_rate_limited" });
    expect(db.rpc).toHaveBeenCalledExactlyOnceWith("check_rate_limit", {
      _user_id: expect.stringMatching(/^[0-9a-f-]{36}$/), _function_name: "paige-bridge", _max_requests: 600, _window_minutes: 1,
    });
  });

  it.each([
    ["42501", "private-db-canary", 401, "contact_sync_not_authorized"],
    ["22023", "MCP_CONTACT_EVENT_CONFLICT", 409, "MCP_CONTACT_EVENT_CONFLICT"],
    ["23505", "private-db-canary", 409, "contact_sync_conflict"],
    ["57014", "private-db-canary", 503, "contact_sync_unavailable"],
  ] as const)("maps %s/%s refusal to HTTP %s without raw error details", async (code, message, status, error) => {
    const logs = [vi.spyOn(console, "error"), vi.spyOn(console, "warn"), vi.spyOn(console, "log")];
    const db = database(receipt, { code, message, details: credential });
    const response = await handleContactSyncRequest(db, request(), payload);
    expect(response.status).toBe(status);
    expect(await response.json()).toEqual({ verb: "upsert_contact_mirror", ok: false, error });
    for (const log of logs) expect(log).not.toHaveBeenCalled();
  });

  it("does not turn an invalid commit acknowledgement into HTTP success", async () => {
    const response = await handleContactSyncRequest(database({ ...receipt, replayed: undefined }), request(), payload);
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ verb: "upsert_contact_mirror", ok: false, error: "contact_sync_outcome_unverified" });
  });

  it("dispatches this verb before legacy global-key authentication and keeps other verbs behind it", () => {
    const source = readFileSync("supabase/functions/paige-bridge/index.ts", "utf8");
    const route = source.indexOf('if (body?.verb === "upsert_contact_mirror")');
    const auth = source.indexOf("if (!BRIDGE_API_KEY)");
    expect(route).toBeGreaterThan(-1);
    expect(auth).toBeGreaterThan(route);
    expect(source.slice(route, auth)).toContain("return await handleContactSyncRequest(supabase, req, body.payload)");
    expect(source.slice(route, auth)).not.toMatch(/resolveOwnerUserId|\.from\(/);
    expect(source.indexOf("timingSafeEqual(auth.slice(7), BRIDGE_API_KEY)")).toBeGreaterThan(auth);
    expect(source.indexOf('case "notify_admin"')).toBeGreaterThan(auth);
  });
});
