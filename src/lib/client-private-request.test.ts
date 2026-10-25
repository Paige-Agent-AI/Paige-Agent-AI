import { describe, expect, it } from "vitest";
import { parsePrivateRequestResult, privateRequestArguments } from "./client-private-request";

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
