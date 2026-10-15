// @vitest-environment node
import { describe, expect, it } from "vitest";
import { knowledgeIngestOutcome, knowledgeInvokeOutcome } from "./ingest-outcome";
const saved = { ok: true, doc_id: "test-doc", chunk_count: 3, embedded: true };
describe("Knowledge caller outcome", () => {
  it("requires positive verified count, document identity and complete embedding", () => {
    expect(knowledgeIngestOutcome(saved).kind).toBe("complete");
    for (const data of [null, {}, { ok: true }, { ...saved, doc_id: "" }, { ...saved, chunk_count: 0 }, { ...saved, embedded: undefined }]) {
      expect(knowledgeIngestOutcome(data).kind).toBe("unknown");
    }
  });
  it("marks partial embedding or truncated extraction without full-success callback eligibility", () => {
    expect(knowledgeIngestOutcome({ ...saved, embedded: false }).kind).toBe("partial");
    expect(knowledgeIngestOutcome({ ...saved, truncated: true }).kind).toBe("partial");
  });
  it("keeps HTTP 200 failure distinct from a verified save", () => {
    expect(knowledgeIngestOutcome({ ok: false, error: "embedding_failed", chunk_count: 0, embedded: false }).kind).toBe("failed");
  });
  it("treats missing insert acknowledgement as uncertain", () => {
    expect(knowledgeIngestOutcome({ ok: false, error: "insert_failed", chunk_count: 0, embedded: false }).kind).toBe("unknown");
    expect(knowledgeIngestOutcome({ ok: false, error: "persistence_unverified", doc_id: "test-doc" })).toMatchObject({ kind: "unknown", docId: "test-doc" });
  });
  it("reads a non-2xx structured body instead of losing uncertain identity", async () => {
    expect(await knowledgeInvokeOutcome(null, { context: new Response(JSON.stringify({ ok: false, error: "persistence_unverified", doc_id: "test-doc" })) }))
      .toMatchObject({ kind: "unknown", docId: "test-doc" });
  });
  it("does not convert transport failure or malformed error body into retry-safe failure", async () => {
    expect((await knowledgeInvokeOutcome(null, new Error("Network lost"))).kind).toBe("unknown");
    expect((await knowledgeInvokeOutcome(null, { context: new Response("not JSON") })).kind).toBe("unknown");
    expect((await knowledgeInvokeOutcome(saved, new Error("Transport failed"))).kind).toBe("unknown");
  });
});
