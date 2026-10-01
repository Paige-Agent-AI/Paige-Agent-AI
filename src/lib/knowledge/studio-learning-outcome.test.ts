// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("@/integrations/supabase/client", () => ({ supabase: { auth: { getSession: async () => ({ data: { session: { access_token: "test-token" } } }) } } }));
import { learnFromArtifact } from "../../components/admin/studio/studio";
const input = { tenantId: "test-tenant-a", artifactType: "page" as const, artifactId: "test-artifact" };
const saved = { ok: true, learned: true, embedded: true, chunk_count: 2, doc_id: "test-doc" };
afterEach(() => vi.unstubAllGlobals());
async function call(body: unknown, status = 200) {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status })));
  return learnFromArtifact(input);
}
describe("Studio learning caller", () => {
  it("reports a verified full result", async () => {
    expect(await call(saved)).toMatchObject({ kind: "learned", docId: "test-doc", chunkCount: 2 });
  });
  it("keeps explicit confirmation and off responses", async () => {
    expect(await call({ ok: false, needs_confirm: true, proposal: "Save this?" })).toEqual({ kind: "needs_confirm", proposal: "Save this?" });
    expect(await call({ ok: false, blocked: true })).toEqual({ kind: "blocked" });
  });
  for (const body of [{}, null, { ...saved, chunk_count: 1.5 }, { ...saved, doc_id: " " }, { ok: false, error: "insert_failed" }, { ...saved, learned: false, error: "replacement_unverified" }]) {
    it(`marks an uncertain result for ${JSON.stringify(body)}`, async () => expect(await call(body)).toMatchObject({ kind: "uncertain" }));
  }
  it("does not let learned:true override partial indexing", async () => {
    expect(await call({ ...saved, embedded: false })).toMatchObject({ kind: "partial" });
    expect(await call({ ...saved, partial: true })).toMatchObject({ kind: "partial" });
  });
  it("does not turn an unsuccessful HTTP response into learned", async () => expect(await call(saved, 500)).toMatchObject({ kind: "uncertain" }));
  it("reports transport uncertainty without throwing or failing publication", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("lost reply")));
    expect(await learnFromArtifact(input)).toMatchObject({ kind: "uncertain" });
  });
});
