import { describe, expect, it } from "vitest";
import { parsePrivateRequestHistory, parsePrivateRequestResult, privateHistoryArguments, privateRequestArguments } from "./client-private-request";

const scope = {
  actor: "e09df000-0000-4000-8000-000000000001",
  tenant: "e09df000-0000-4000-8000-000000000002",
  contact: "e09df000-0000-4000-8000-000000000003",
  intent: "e09df000-0000-4000-8000-000000000004",
};
const time = "2026-10-25T09:00:00.123456+00:00";
const work = "e09df000-0000-4000-8000-000000000005";
const customerAction = "e09df000-0000-4000-8000-000000000006";
const status = () => ({ schema_version: 1, actor_id: scope.actor, tenant_id: scope.tenant,
  contact_id: scope.contact, intent_id: scope.intent, found: true,
  request: { work_id: work, status: "assigned", created_at: time, version: time,
    content_state: "prepared", title: "Review the guide", body: "Read the shared guide.", customer_action_id: null },
  recipient_available: true, missing_is_rejection: false, read_at: time });

describe("original private-request native consumer contract (not mounted)", () => {
  it("keeps the original Work and exact microsecond version without time normalization", () => {
    const value = parsePrivateRequestResult(status(), scope, "status");
    expect(value.request?.work_id).toBe(work);
    expect(value.request?.version).toBe(time);
    expect(value.request?.body).toBe("Read the shared guide.");
  });
  it("preserves missing as unconfirmed, never a rejected or replacement request", () => {
    const value = parsePrivateRequestResult({ ...status(), found: false, request: null }, scope, "status");
    expect(value.found).toBe(false); expect(value.missing_is_rejection).toBe(false);
  });
  it("accepts original preparation replay without inventing a new Work identity", () => {
    const value = parsePrivateRequestResult({ ...status(), replayed: true }, scope, "preparation");
    expect(value.request?.work_id).toBe(work); expect(value.replayed).toBe(true);
  });
  it("keeps words concealed after original Work content changes", () => {
    const value = status(); Object.assign(value.request, { status: "drafted", content_state: "changed", title: null, body: null });
    expect(parsePrivateRequestResult(value, scope, "status").request?.body).toBeNull();
  });
  it("accepts a linked shared record without inferring a completed service", () => {
    const value = status(); Object.assign(value.request, { status: "executing", content_state: "shared", title: null, body: null, customer_action_id: customerAction });
    expect(parsePrivateRequestResult(value, scope, "status").request?.status).toBe("executing");
  });
  for (const key of ["actor_id", "tenant_id", "contact_id", "intent_id"] as const) {
    it(`refuses another ${key} even when the response otherwise looks valid`, () => {
      expect(() => parsePrivateRequestResult({ ...status(), [key]: customerAction }, scope, "status")).toThrow();
    });
  }
  for (const [name, change] of [
    ["missing scope", (x: Record<string, unknown>) => { delete x.intent_id; }],
    ["private payload expansion", (x: Record<string, unknown>) => { x.payload = { private: "hidden" }; }],
    ["missing-as-rejection", (x: Record<string, unknown>) => { x.missing_is_rejection = true; }],
    ["missing read evidence", (x: Record<string, unknown>) => { delete x.read_at; }],
    ["missing request", (x: Record<string, unknown>) => { x.request = null; }],
    ["request despite missing", (x: Record<string, unknown>) => { x.found = false; }],
    ["string booleans", (x: Record<string, unknown>) => { x.recipient_available = "true"; }],
  ] as const) it(`refuses ${name}`, () => {
    const value = status(); change(value); expect(() => parsePrivateRequestResult(value, scope, "status")).toThrow();
  });
  for (const [name, change] of [
    ["missing original version", { version: undefined }], ["invalid saved version", { version: "infinity" }],
    ["expanded Work payload", { payload: { internal: "hidden" } }],
    ["prepared words on a changed record", { content_state: "changed" }],
    ["shared state without original link", { content_state: "shared", title: null, body: null }],
    ["prepared state with customer link", { customer_action_id: customerAction }],
    ["prepared state after another transition", { status: "drafted" }],
  ] as const) it(`refuses ${name}`, () => {
    const value = status(); Object.assign(value.request, change);
    expect(() => parsePrivateRequestResult(value, scope, "status")).toThrow();
  });
  it("a preparation acknowledgment must contain a saved request and explicit replay evidence", () => {
    expect(() => parsePrivateRequestResult(status(), scope, "preparation")).toThrow();
    expect(() => parsePrivateRequestResult({ ...status(), replayed: false, found: false, request: null }, scope, "preparation")).toThrow();
    expect(() => parsePrivateRequestResult({ ...status(), replayed: false }, scope, "status")).toThrow();
  });
  it("constructs the original scoped native arguments without creating an intent", () => {
    expect(privateRequestArguments(scope)).toEqual({ _expected_actor_id: scope.actor, _expected_tenant_id: scope.tenant, _contact_id: scope.contact, _intent_id: scope.intent });
    expect(privateRequestArguments(scope, { title: "  Review\t", body: "\nRead it. " })).toEqual({
      ...privateRequestArguments(scope), _title: "Review", _body: "Read it.",
    });
  });
  it("matches PostgreSQL character limits for non-BMP text and preserves canonical words", () => {
    expect(privateRequestArguments(scope, { title: "🌱".repeat(160), body: "Read it." })._title).toBe("🌱".repeat(160));
    expect(() => privateRequestArguments(scope, { title: "🌱".repeat(161), body: "Read it." })).toThrow();
    expect(privateRequestArguments(scope, { title: "\u00a0", body: "Read it." })._title).toBe("\u00a0");
  });
  it("refuses malformed scope and empty or excessive words without broadening permissions", () => {
    expect(() => privateRequestArguments({ ...scope, intent: "" })).toThrow();
    expect(() => privateRequestArguments(scope, { title: " \t", body: "Read" })).toThrow();
    expect(() => privateRequestArguments(scope, { title: "Review", body: "x".repeat(4001) })).toThrow();
  });
});

const page = (count = 1, more = false) => {
  const requests = Array.from({ length: count }, (_, index) => ({
    intent_id: `e09df200-0000-4000-8000-${String(count - index).padStart(12, "0")}`,
    request: { ...status().request, work_id: `e09df300-0000-4000-8000-${String(count - index).padStart(12, "0")}` },
  }));
  const last = requests[requests.length - 1];
  return { schema_version: 1, actor_id: scope.actor, tenant_id: scope.tenant, contact_id: scope.contact,
    requests, more, next_cursor: more && requests.length ? { created_at: last.request.created_at, work_id: last.request.work_id } : null,
    recipient_available: true, missing_is_rejection: false, read_at: time };
};
describe("returning-owner original private Work history contract", () => {
  it("recovers actual Work and intent from the closed source rather than browser state", () => {
    const value = parsePrivateRequestHistory(page(), scope);
    expect(value.requests[0].intent_id).toBe(page().requests[0].intent_id);
    expect(value.requests[0].request.version).toBe(time);
  });
  it("keeps the exact last-record cursor, including local offset and microseconds", () => {
    const value = page(20, true), local = "2026-10-25T05:00:00.123456-04:00";
    value.requests[value.requests.length - 1].request.created_at = local; value.next_cursor!.created_at = local;
    const result = parsePrivateRequestHistory(value, scope);
    expect(privateHistoryArguments(scope, result.next_cursor)._before_created_at).toBe(local);
    expect(privateHistoryArguments(scope, result.next_cursor)._before_work_id).toBe(value.requests[value.requests.length - 1].request.work_id);
  });
  it("allows empty saved history without allowing rejection or an automatic new intent", () => {
    const result = parsePrivateRequestHistory(page(0), scope);
    expect(result.requests).toEqual([]); expect(result.missing_is_rejection).toBe(false); expect(result.next_cursor).toBeNull();
    expect(privateHistoryArguments(scope)).toEqual({ _expected_actor_id: scope.actor, _expected_tenant_id: scope.tenant,
      _contact_id: scope.contact, _before_created_at: null, _before_work_id: null });
  });
  for (const [name, change] of [
    ["foreign business", { tenant_id: customerAction }], ["foreign actor", { actor_id: customerAction }],
    ["foreign contact", { contact_id: customerAction }], ["expanded staff data", { payload: { private: true } }],
    ["empty-as-rejection", { missing_is_rejection: true }], ["incomplete more cursor", { more: true }],
    ["oversized page", { requests: page(21).requests }], ["duplicate intent", { requests: [...page().requests, ...page().requests] }],
    ["cursor after final page", { next_cursor: { created_at: time, work_id: work } }],
  ] as const) it(`rejects ${name}`, () => expect(() => parsePrivateRequestHistory({ ...page(), ...change }, scope)).toThrow());
  it("rejects a cursor that does not identify the actual last original Work record", () => {
    const value = page(20, true); value.next_cursor!.work_id = work;
    expect(() => parsePrivateRequestHistory(value, scope)).toThrow();
  });
  it("applies the original prepared/changed privacy rules to every history item", () => {
    const value = page(); Object.assign(value.requests[0].request, { content_state: "changed", status: "drafted" });
    expect(() => parsePrivateRequestHistory(value, scope)).toThrow();
    Object.assign(value.requests[0].request, { title: null, body: null });
    expect(parsePrivateRequestHistory(value, scope).requests[0].request.body).toBeNull();
  });
});
