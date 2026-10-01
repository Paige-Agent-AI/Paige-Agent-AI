// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { z } from "zod";

// Execute the real edge handler with injected boundary adapters. This is not
// authenticated/provider proof; imports alone are replaced, not handler logic.
function handler(path: string, adapters: Record<string, unknown>) {
  const source = readFileSync(new URL(`../../supabase/functions/${path}/index.ts`, import.meta.url), "utf8")
    .replace(/^import .*;\r?\n/gm, "");
  const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
  let run: (req: Request) => Promise<Response>;
  const env = { serve: (fn: typeof run) => { run = fn; }, Deno: { env: { get: (key: string) => key } }, z, ...adapters };
  new Function(...Object.keys(env), compiled)(...Object.values(env));
  return (body: unknown) => run(new Request("https://local.test/ingest", { method: "POST", headers: { Authorization: "Bearer test.token.signature" }, body: JSON.stringify(body) }));
}
const complete = { ok: true, doc_id: "new-doc", chunk_count: 2, embedded: true };
const uncertain = { ok: false, error: "persistence_unverified", detail: "Check knowledge before retrying.", doc_id: "new-doc", chunk_count: 0, embedded: false };
function client() {
  const q = { select: () => q, eq: () => q, maybeSingle: async () => ({ data: { active_tenant_id: "test-tenant-a" } }) };
  return { from: () => q, auth: { getClaims: async () => ({ data: { claims: { sub: "test-user" } } }), getUser: async () => ({ data: { user: { id: "test-user" } } }) }, storage: { from: () => ({ download: async () => ({ data: new Blob(["A long enough reference document."]) }) }) } };
}
describe("ingestion adapter response truth", () => {
  it("doc preserves uncertain persistence identity and zero verified count", async () => {
    const run = handler("kb-ingest-doc", { createClient: client, ingestDoc: async () => uncertain });
    const res = await run({ title: "Reference", content: "Text" });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual(uncertain);
  });
  it("doc retains complete and partial contracts", async () => {
    for (const embedded of [true, false]) {
      const result = { ...complete, embedded };
      const run = handler("kb-ingest-doc", { createClient: client, ingestDoc: async () => result });
      expect(await (await run({ title: "Reference", content: "Text" })).json()).toEqual(result);
    }
  });
  it("doc retains HTTP 200 embedding failure without losing structured fields", async () => {
    const result = { ...uncertain, error: "embedding_failed", doc_id: undefined };
    const run = handler("kb-ingest-doc", { createClient: client, ingestDoc: async () => result });
    const res = await run({ title: "Reference", content: "Text" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(JSON.parse(JSON.stringify(result)));
  });
  it("file preserves non-2xx uncertainty through the nested invocation", async () => {
    const run = handler("kb-ingest-file", { createClient: client, callClaude: vi.fn(), fetch: async () => new Response(JSON.stringify(uncertain), { status: 400 }) });
    const res = await run({ path: "test-tenant-a/file.txt", filename: "file.txt" });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject(uncertain);
  });
  it("URL preserves non-2xx uncertainty through the nested invocation", async () => {
    const fetch = vi.fn().mockResolvedValueOnce(new Response("A long enough document body for extraction.", { headers: { "Content-Type": "text/plain" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify(uncertain), { status: 400 }));
    const run = handler("kb-ingest-url", { createClient: client, assertPublicHttpUrl: async () => {}, SsrfError: class extends Error {}, fetch });
    const res = await run({ url: "https://example.com/reference" });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject(uncertain);
  });
  it("malformed nested acknowledgement stays uncertain", async () => {
    const run = handler("kb-ingest-file", { createClient: client, callClaude: vi.fn(), fetch: async () => new Response("invalid JSON") });
    expect(await (await run({ path: "test-tenant-a/file.txt" })).json()).toMatchObject({ ok: false, error: "persistence_unverified" });
  });
  it("failure before ingestion is identified as not started", async () => {
    const run = handler("kb-ingest-file", { createClient: () => { throw Error("auth unavailable"); }, callClaude: vi.fn() });
    expect(await (await run({ path: "test-tenant-a/file.txt" })).json()).toMatchObject({ ok: false, error: "ingestion_not_started" });
  });
  it("URL extraction truncation remains visible on a verified save", async () => {
    const fetch = vi.fn().mockResolvedValueOnce(new Response("x".repeat(200_001), { headers: { "Content-Type": "text/plain" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify(complete)));
    const run = handler("kb-ingest-url", { createClient: client, assertPublicHttpUrl: async () => {}, SsrfError: class extends Error {}, fetch });
    expect(await (await run({ url: "https://example.com/reference" })).json()).toMatchObject({ ...complete, truncated: true });
  });
});

function studio(result: Record<string, unknown>, fault = "") {
  const calls: Array<{ op: string; filters: Array<[string, unknown]> }> = [];
  let oldExists = true;
  const db = { rpc: async () => ({ data: "auto" }), from: (table: string) => {
    let op = "read", fields = "";
    const filters: Array<[string, unknown]> = [];
    const q = { select: (v: string) => { fields = v; return q; }, eq: (k: string, v: unknown) => { filters.push([k, v]); return q; },
      neq: (k: string, v: unknown) => { filters.push([`neq:${k}`, v]); return q; },
      in: (k: string, v: unknown) => { filters.push([`in:${k}`, v]); return q; },
      delete: () => { op = "delete"; return q; }, limit: () => q, maybeSingle: () => q,
      then: (resolve: (value: unknown) => void, reject: (reason: unknown) => void) => Promise.resolve().then(() => {
        if (table === "growth_pages") return { data: fields === "blocks_json" ? { blocks_json: [] } : { id: "artifact", tenant_id: "00000000-0000-4000-a000-000000000001", title: "Reference", status: "published" } };
        calls.push({ op, filters });
        if (op === "delete") {
          if (fault === "delete-error") return { error: { message: "write unavailable" } };
          if (fault === "delete-throw") throw Error("lost response");
          if (fault !== "zero-delete") oldExists = false;
          return { error: null };
        }
        if (fault === "read-error") return { data: null, error: { message: "read unavailable" } };
        return { data: oldExists ? [{ id: "prior-doc" }] : [], count: fault === "capped-snapshot" ? 1001 : oldExists ? 1 : 0, error: null };
      }).then(resolve, reject),
    }; return q;
  } };
  const run = handler("studio-learn-from-artifact", { createClient: () => db, ingestDoc: async () => result,
    flattenBlocks: () => fault === "truncated" ? "x".repeat(400_001) : "The approved methodology contains enough detail to index.", flattenFormSchema: () => "", atob: () => '{"role":"service_role"}' });
  return { run: () => run({ artifact_type: "page", artifact_id: "00000000-0000-4000-a000-000000000002" }), calls };
}
describe("Studio replacement truth", () => {
  it("keeps prior knowledge after partial indexing", async () => {
    const s = studio({ ...complete, embedded: false });
    expect(await (await s.run()).json()).toMatchObject({ ok: true, learned: false, partial: true, embedded: false, doc_id: "new-doc" });
    expect(s.calls.some(c => c.op === "delete")).toBe(false);
  });
  it("preserves uncertain ingest identity and does not prune prior knowledge", async () => {
    const s = studio(uncertain);
    expect(await (await s.run()).json()).toMatchObject(uncertain);
    expect(s.calls.some(c => c.op === "delete")).toBe(false);
  });
  for (const fault of ["delete-error", "delete-throw", "zero-delete", "read-error", "capped-snapshot"]) {
    it(`does not claim completed learning when replacement is ${fault}`, async () => {
      const s = studio(complete, fault);
      expect(await (await s.run()).json()).toMatchObject({ ok: true, learned: false, error: "replacement_unverified", doc_id: "new-doc" });
    });
  }
  it("preserves prior knowledge if extraction was truncated despite full embedding", async () => {
    const s = studio(complete, "truncated");
    expect(await (await s.run()).json()).toMatchObject({ ok: true, learned: false, partial: true, truncated: true });
    expect(s.calls.some(c => c.op === "delete")).toBe(false);
  });
  it("removes only captured prior IDs and verifies absence before completed learning", async () => {
    const s = studio(complete);
    expect(await (await s.run()).json()).toMatchObject({ ...complete, learned: true });
    const writes = s.calls.filter(c => c.op === "delete");
    expect(writes).toHaveLength(1);
    expect(writes[0].filters).toContainEqual(["in:id", ["prior-doc"]]);
    expect(writes[0].filters).toContainEqual(["tenant_id", "00000000-0000-4000-a000-000000000001"]);
    expect(s.calls.at(-1)?.op).toBe("read");
  });
});
