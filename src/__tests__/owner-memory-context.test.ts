import { describe, expect, it } from "vitest";
import { C6_MAX_ITEMS, C6_PROPOSED_CAP, resolveOwnerMemoryContext } from "../../supabase/functions/_shared/paige-context/owner-memory.ts";

const scope = { actorId: "test-actor", tenantId: "test-tenant", focusedClientId: null, denied: false };
const row = (state: unknown = "confirmed", id = "test-memory") => ({
  id, memory_type: "preference", content: "Use concise answers",
  source_thread_id: "test-thread", created_at: "2026-10-08T00:00:00Z",
  updated_at: "2026-10-08T00:00:00Z", metadata: { confirmation_state: state },
});
const item = (state: "confirmed" | "corrected" | "proposed", id = "test-memory") => ({
  id, memory_type: "preference", content: "Use concise answers",
  source_thread_id: "test-thread", created_at: "2026-10-08T00:00:00Z", updated_at: "2026-10-08T00:00:00Z",
  state, candidate: state === "proposed",
});
describe("C6 governed owner-memory context (INT-326 dials)", () => {
  it("pins the captured read scope and canonical provenance without retaining mutable input", () => {
    const captured = { ...scope }; const input = row();
    const result = resolveOwnerMemoryContext(captured, { data: [input], error: null });
    captured.tenantId = "other-tenant"; input.content = "changed";
    expect(result.status).toBe("available");
    expect(result.data).toEqual({ scope: { actorId: "test-actor", tenantId: "test-tenant" }, memories: [item("confirmed")] });
  });
  it("admits corrected rows as knowledge, after confirmed in precedence", () => {
    const result = resolveOwnerMemoryContext(scope, { data: [row("corrected", "c1"), row("confirmed", "k1")], error: null });
    expect(result.data?.memories.map((m) => [m.id, m.candidate])).toEqual([["k1", false], ["c1", false]]);
  });
  it("admits proposed rows as capped, labelled candidates", () => {
    const proposed = Array.from({ length: C6_PROPOSED_CAP + 3 }, (_, i) => row("proposed", `p${i}`));
    const result = resolveOwnerMemoryContext(scope, { data: proposed, error: null });
    expect(result.data?.memories).toHaveLength(C6_PROPOSED_CAP);
    expect(result.data?.memories.every((m) => m.candidate && m.state === "proposed")).toBe(true);
  });
  it("a missing confirmation_state is UNCONFIRMED — a candidate, never confirmed", () => {
    const absentState = { ...row("proposed", "absent"), metadata: {} };
    const result = resolveOwnerMemoryContext(scope, { data: [absentState], error: null });
    expect(result.data?.memories).toEqual([item("proposed", "absent")]);
  });
  it.each(["retired", "CONFIRMED", "garbage", 7])("excludes %s without promoting it", (state) => {
    const result = resolveOwnerMemoryContext(scope, { data: [row(state, "bad")], error: null });
    expect(result.data?.memories).toEqual([]);
  });
  it("orders confirmed > corrected > proposed and caps the total at the C6 dial", () => {
    // More rows than the cap: precedence decides who survives the cut, and the proposed
    // cap holds even when seats remain.
    const rows = [
      ...Array.from({ length: C6_MAX_ITEMS - 3 }, (_, i) => row("confirmed", `k${i}`)),
      row("proposed", "p1"), row("proposed", "p2"), row("proposed", "p3"), row("proposed", "p4"),
      row("corrected", "c1"),
    ];
    const result = resolveOwnerMemoryContext(scope, { data: rows, error: null });
    const memories = result.data?.memories ?? [];
    expect(memories).toHaveLength(C6_MAX_ITEMS);
    const states = memories.map((m) => m.state);
    expect(states.lastIndexOf("confirmed")).toBeLessThan(states.indexOf("corrected"));
    expect(states.lastIndexOf("corrected")).toBeLessThan(states.indexOf("proposed"));
    // The proposed cap admitted 3, then the TOTAL cap cut the last one: precedence decides
    // who survives the cut, and no candidate displaces knowledge.
    expect(memories.filter((m) => m.state === "proposed")).toHaveLength(C6_PROPOSED_CAP - 1);
  });
  it("distinguishes successful empty from failure, including data beside an error", () => {
    expect(resolveOwnerMemoryContext(scope, { data: [], error: null }).status).toBe("available");
    expect(resolveOwnerMemoryContext(scope, { data: [row()], error: { message: "SECRET ERROR" } })).toEqual({
      status: "degraded", reason: "owner_memory_read_failed", data: null,
    });
  });
  it("does not derive actor, workspace or confirmation authority from incidental row metadata", () => {
    const candidate = { ...row("proposed", "cand-1"), confirmation_state: "confirmed" };
    const confirmed = { ...row("confirmed", "conf-1"), metadata: { confirmation_state: "confirmed", actorId: "foreign-actor", tenantId: "foreign-tenant" } };
    const result = resolveOwnerMemoryContext(scope, { data: [candidate, confirmed], error: null });
    expect(result.data?.scope).toEqual({ actorId: scope.actorId, tenantId: scope.tenantId });
    // The incidental TOP-LEVEL confirmation_state granted nothing: the row stays exactly
    // what its metadata says — a candidate — never promoted by where a field happened to sit.
    expect(result.data?.memories.map((m) => [m.id, m.candidate])).toEqual([["conf-1", false], ["cand-1", true]]);
  });
  it.each([{ ...scope, denied: true }, { ...scope, tenantId: null }, { ...scope, actorId: "" }, { ...scope, focusedClientId: "test-client" }])("does not admit an inapplicable or unresolved scope", (binding) => {
    expect(resolveOwnerMemoryContext(binding, { data: [row()], error: null }).status).toBe("unavailable");
  });
  it("fails closed on malformed successful read and malformed admitted provenance", () => {
    expect(resolveOwnerMemoryContext(scope, { data: null, error: null }).status).toBe("degraded");
    expect(resolveOwnerMemoryContext(scope, { data: [{ ...row(), id: null }], error: null }).status).toBe("degraded");
    expect(resolveOwnerMemoryContext(scope, { data: [{ ...row("proposed", "p1"), created_at: "not-a-date" }], error: null }).status).toBe("degraded");
  });
});
