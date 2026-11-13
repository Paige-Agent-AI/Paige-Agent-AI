import { beforeEach, expect, it, vi } from "vitest";
const h = vi.hoisted(() => ({ calls: [] as string[], reply: { data: null as unknown, error: null as unknown } }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: async (name: string) => { h.calls.push(name); return h.reply; } } }));
const { startStudioProject, lookupStudioProjectStart, ProjectStartUnknown } = await import("./studio-data");
const id = "11111111-1111-4111-8111-111111111111", thread = "22222222-2222-4222-8222-222222222222";
const input = { tenantId: "test-tenant-one", requestId: id, brief: "Build the requested landing page", context: { target: { kind: "workspace" as const }, values: {} } };
beforeEach(() => { h.calls = []; h.reply = { data: null, error: null }; });
it("returns only native original IDs and native created evidence from an explicit start", async () => {
  h.reply.data = { ok: true, state: "ready", session_id: id, thread_id: thread, created: true };
  expect(await startStudioProject(input)).toEqual({ sessionId: id, threadId: thread, created: true });
  expect(h.calls).toEqual(["studio_start_project"]);
});
it("keeps ambiguous starts UNKNOWN and does not replay a write or manufacture another request", async () => {
  h.reply.error = { message: "network interruption" };
  await expect(startStudioProject(input)).rejects.toBeInstanceOf(ProjectStartUnknown);
  expect(h.calls).toEqual(["studio_start_project"]);
  h.reply = { data: { ok: false, code: "unknown" }, error: null };
  expect(await lookupStudioProjectStart(input.tenantId, input.requestId)).toBeNull();
  expect(h.calls).toEqual(["studio_start_project", "studio_lookup_project_start"]);
});
it("reconciles the same original project by read-only lookup without reseeding it", async () => {
  h.reply.data = { ok: true, state: "ready", session_id: id, thread_id: thread, created: true };
  expect(await lookupStudioProjectStart(input.tenantId, input.requestId)).toEqual({ sessionId: id, threadId: thread, created: false });
  expect(h.calls).toEqual(["studio_lookup_project_start"]);
});
it("refuses model URLs, malformed IDs and unproven ready claims", async () => {
  for (const reply of [{ ok: true, state: "ready", session_id: "https://example.test", thread_id: thread, created: true }, { ok: true, state: "ready", session_id: id, thread_id: thread }, { ok: false, code: "not_allowed" }]) {
    h.reply.data = reply;
    await expect(startStudioProject(input)).rejects.toThrow();
  }
  expect(h.calls).toHaveLength(3);
});
