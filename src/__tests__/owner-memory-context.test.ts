import { describe, expect, it } from "vitest";
import { resolveOwnerMemoryContext } from "../../supabase/functions/_shared/paige-context/owner-memory.ts";

const scope = { actorId: "test-actor", tenantId: "test-tenant", focusedClientId: null, denied: false };
const row = (state: unknown = "confirmed") => ({
  id: "test-memory", memory_type: "preference", content: "Use concise answers",
  source_thread_id: "test-thread", created_at: "2026-10-08T00:00:00Z",
  updated_at: "2026-10-08T00:00:00Z", metadata: { confirmation_state: state },
});
describe("C6 governed owner-memory context", () => {
  it("pins the captured read scope and canonical provenance without retaining mutable input", () => {
    const captured = { ...scope }; const input = row();
    const result = resolveOwnerMemoryContext(captured, { data: [input], error: null });
    captured.tenantId = "other-tenant"; input.content = "changed";
    expect(result.status).toBe("available");
    expect(result.data).toEqual({ scope: { actorId: "test-actor", tenantId: "test-tenant" }, memories: [row()] });
  });
  it.each(["proposed", "corrected", "retired", undefined, null, "CONFIRMED"])("excludes %s without promoting candidates", (state) => {
    const candidate = row(); candidate.metadata.confirmation_state = state;
    expect(resolveOwnerMemoryContext(scope, { data: [candidate], error: null })).toEqual({
      status: "available", data: { scope: { actorId: scope.actorId, tenantId: scope.tenantId }, memories: [] },
    });
  });
  it("distinguishes successful empty from failure, including data beside an error", () => {
    expect(resolveOwnerMemoryContext(scope, { data: [], error: null }).status).toBe("available");
    expect(resolveOwnerMemoryContext(scope, { data: [row()], error: { message: "SECRET ERROR" } })).toEqual({
      status: "degraded", reason: "owner_memory_read_failed", data: null,
    });
  });
  it("does not derive actor, workspace or confirmation authority from incidental row metadata", () => {
    const candidate = { ...row("proposed"), confirmation_state: "confirmed" };
    const confirmed = { ...row(), metadata: { confirmation_state: "confirmed", actorId: "foreign-actor", tenantId: "foreign-tenant" } };
    const result = resolveOwnerMemoryContext(scope, { data: [candidate, confirmed], error: null });
    expect(result.data?.scope).toEqual({ actorId: scope.actorId, tenantId: scope.tenantId });
    expect(result.data?.memories).toEqual([row()]);
  });
  it.each([{ ...scope, denied: true }, { ...scope, tenantId: null }, { ...scope, actorId: "" }, { ...scope, focusedClientId: "test-client" }])("does not admit an inapplicable or unresolved scope", (binding) => {
    expect(resolveOwnerMemoryContext(binding, { data: [row()], error: null }).status).toBe("unavailable");
  });
  it("fails closed on malformed successful read and malformed confirmed provenance", () => {
    expect(resolveOwnerMemoryContext(scope, { data: null, error: null }).status).toBe("degraded");
    expect(resolveOwnerMemoryContext(scope, { data: [{ ...row(), id: null }], error: null }).status).toBe("degraded");
  });
});
