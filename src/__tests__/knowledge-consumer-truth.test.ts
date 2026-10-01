// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { z } from "zod";
const { embeddingsCompat } = vi.hoisted(() => ({ embeddingsCompat: vi.fn() }));
vi.mock("../../supabase/functions/_shared/voyage", () => ({ VOYAGE_DIMS: 1024, embeddingsCompat }));
const scopePath = "../../supabase/functions/_shared/knowledge-ingest-scope.ts";
const { bindKnowledgeIngestScope, KnowledgeIngestScopeError } = await import(scopePath);
const corePath = "../../supabase/functions/_shared/kb-ingest-core.ts";
const { ingestDoc: realIngestDoc } = await import(corePath);

// Execute the real edge handler with injected boundary adapters. This is not
// authenticated/provider proof; imports alone are replaced, not handler logic.
function handler(path: string, adapters: Record<string, unknown>) {
  const source = readFileSync(new URL(`../../supabase/functions/${path}/index.ts`, import.meta.url), "utf8")
    .replace(/^import .*;\r?\n/gm, "");
  const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
  let run: (req: Request) => Promise<Response>;
  const env = { serve: (fn: typeof run) => { run = fn; }, Deno: { env: { get: (key: string) => key } }, z, bindKnowledgeIngestScope, KnowledgeIngestScopeError, ...adapters };
  new Function(...Object.keys(env), compiled)(...Object.values(env));
  return (body: unknown) => run(new Request("https://local.test/ingest", { method: "POST", headers: { Authorization: "Bearer test.token.signature" }, body: JSON.stringify(body) }));
}
const complete = { ok: true, doc_id: "new-doc", chunk_count: 2, embedded: true };
const uncertain = { ok: false, error: "persistence_unverified", detail: "Check knowledge before retrying.", doc_id: "new-doc", chunk_count: 0, embedded: false };
function client() {
  const q = { select: () => q, eq: () => q, maybeSingle: async () => ({ data: { active_tenant_id: "00000000-0000-4000-a000-000000000001" } }) };
  return { rpc: async (name: string) => ({ data: name === "is_tenant_member", error: null }), from: () => q, auth: { getClaims: async () => ({ data: { claims: { sub: "test-user" } } }), getUser: async () => ({ data: { user: { id: "test-user" } } }) }, storage: { from: () => ({ download: async () => ({ data: new Blob(["A long enough reference document."]) }) }) } };
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
    const res = await run({ path: "00000000-0000-4000-a000-000000000001/file.txt", filename: "file.txt" });
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
    expect(await (await run({ path: "00000000-0000-4000-a000-000000000001/file.txt" })).json()).toMatchObject({ ok: false, error: "persistence_unverified" });
  });
  it("failure before ingestion is identified as not started", async () => {
    const run = handler("kb-ingest-file", { createClient: () => { throw Error("auth unavailable"); }, callClaude: vi.fn() });
    expect(await (await run({ path: "00000000-0000-4000-a000-000000000001/file.txt" })).json()).toMatchObject({ ok: false, error: "ingestion_not_started" });
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
      gt: (k: string, v: unknown) => { filters.push([`gt:${k}`, v]); return q; },
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

it("a completing Studio ingest never deletes a peer paused after its real doc insertion", async () => {
  type Row = Record<string, unknown>;
  const tenantId = "00000000-0000-4000-a000-000000000001";
  const artifactId = "00000000-0000-4000-a000-000000000002";
  const docs: Row[] = [{ id: "prior", tenant_id: tenantId, source_url: `studio://page/${artifactId}`, chunk_count: 2 }];
  const chunks: Row[] = [];
  let serial = 0;
  const db = { rpc: async () => ({ data: "auto" }), from(table: string) {
    let op = "read", value: Row | Row[] = {}, single = false, low = 0, high = Infinity;
    const filters: Array<(row: Row) => boolean> = [];
    const q = {
      select: () => q, insert: (v: Row | Row[]) => { op = "insert"; value = v; return q; },
      update: (v: Row) => { op = "update"; value = v; return q; }, delete: () => { op = "delete"; return q; },
      eq: (k: string, v: unknown) => { filters.push(r => r[k] === v); return q; },
      neq: (k: string, v: unknown) => { filters.push(r => r[k] !== v); return q; },
      in: (k: string, v: unknown[]) => { filters.push(r => v.includes(r[k])); return q; },
      gt: (k: string, v: number) => { filters.push(r => typeof r[k] === "number" && r[k] > v); return q; },
      not: (k: string) => { filters.push(r => r[k] != null); return q; }, order: () => q,
      range: (a: number, b: number) => { low = a; high = b; return q; }, limit: (n: number) => { high = n - 1; return q; },
      single: () => { single = true; return q; }, maybeSingle: () => { single = true; return q; },
      then: (resolve: (v: unknown) => void, reject: (e: unknown) => void) => Promise.resolve().then(() => {
        if (table === "growth_pages") return { data: { id: artifactId, tenant_id: tenantId, title: "Reference", status: "published", blocks_json: [] } };
        const rows = table.endsWith("chunks") ? chunks : docs;
        const match = (r: Row) => filters.every(f => f(r));
        if (op === "insert") {
          const inserted = (Array.isArray(value) ? value : [value]).map(r => table.endsWith("docs") ? { ...r, id: `new-${++serial}` } : r);
          if (table.endsWith("chunks") && inserted.some(r => !docs.some(d => d.id === r.doc_id))) return { error: { message: "missing parent" } };
          rows.push(...inserted);
          return { data: single ? inserted[0] : inserted, error: null };
        }
        if (op === "update") rows.filter(match).forEach(r => Object.assign(r, value));
        if (op === "delete") for (let i = rows.length - 1; i >= 0; i--) if (match(rows[i])) rows.splice(i, 1);
        const found = rows.filter(match);
        return { data: single ? found[0] ?? null : found.slice(low, high + 1), count: found.length, error: null };
      }).then(resolve, reject),
    }; return q;
  } };
  let resume!: () => void, started!: () => void;
  const paused = new Promise<void>(r => { resume = r; });
  const inserted = new Promise<void>(r => { started = r; });
  let calls = 0;
  embeddingsCompat.mockImplementation(async () => {
    if (++calls === 1) { started(); await paused; }
    return new Response(JSON.stringify({ data: [{ embedding: Array(1024).fill(0.1) }] }));
  });
  const run = handler("studio-learn-from-artifact", { createClient: () => db, ingestDoc: realIngestDoc,
    flattenBlocks: () => "The approved methodology contains enough content to index.", flattenFormSchema: () => "", atob: () => '{"role":"service_role"}' });
  const a = run({ artifact_type: "page", artifact_id: artifactId });
  await inserted;
  expect(docs.find(d => d.id === "new-1")?.chunk_count).toBe(0);
  const b = await run({ artifact_type: "page", artifact_id: artifactId });
  expect(await b.json()).toMatchObject({ learned: true });
  const pendingPreserved = docs.some(d => d.id === "new-1");
  resume();
  const firstResult = await (await a).json();
  expect(pendingPreserved).toBe(true);
  expect(firstResult).toMatchObject({ ok: true, learned: true });
  expect(docs.map(d => d.id).sort()).toEqual(["new-1", "new-2"]);
});
