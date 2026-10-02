// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { z } from "zod";
const A = "00000000-0000-4000-a000-000000000001", B = "00000000-0000-4000-a000-000000000002";
const guardPath = "../../supabase/functions/_shared/knowledge-ingest-scope.ts";
const { KnowledgeIngestScopeError } = await import(guardPath);
function setup(kind: string, options: { active?: unknown; member?: unknown; owner?: unknown; downloadSwitch?: boolean; fetchSwitch?: boolean; userMissing?: boolean; authorityError?: boolean; nestedSwitch?: boolean; providerSwitch?: boolean } = {}) {
  let active: unknown = options.active === undefined ? A : options.active;
  const calls = { download: vi.fn(), provider: vi.fn(), ingest: vi.fn(), fetch: vi.fn() };
  const client = { auth: { getUser: async () => ({ data: { user: options.userMissing ? null : { id: "actor" } }, error: null }), getClaims: async () => ({ data: { claims: { sub: "actor" } } }) },
    rpc: async (name: string) => ({ data: name === "is_platform_owner" ? ("owner" in options ? options.owner : false) : ("member" in options ? options.member : true), error: options.authorityError ? { message: "lookup failed" } : null }),
    from: () => { const q = { select: () => q, eq: () => q, maybeSingle: async () => ({ data: { active_tenant_id: active }, error: null }) }; return q; },
    readActiveTenant: async () => ({ data: { active_tenant_id: active }, error: null }),
    storage: { from: () => ({ download: async () => { calls.download(); if (options.downloadSwitch) active = B; return { data: new Blob(["Readable private knowledge document" ]), error: null }; } }) },
  };
  let run!: (r: Request) => Promise<Response>;
  const env = { serve: (f: typeof run) => { run = f; }, Deno: { env: { get: (k: string) => k } }, z,
    KnowledgeIngestScopeError, createClient: () => client,
    bindKnowledgeIngestScope: async (...args: unknown[]) => (await import(guardPath)).bindKnowledgeIngestScope(...args),
    ingestDoc: async (...args: unknown[]) => { calls.ingest(...args); return { ok: true, doc_id: "doc", embedded: true, chunk_count: 1 }; },
    callClaude: async (args: unknown) => { calls.provider(args); if (options.providerSwitch) active = B; return { text: "Readable private knowledge document" }; },
    assertPublicHttpUrl: async () => {}, SsrfError: class extends Error {},
    fetch: async (url: string, init?: RequestInit) => { calls.fetch(url, init); if (url.includes("kb-ingest-doc")) { if (options.nestedSwitch) active = B; return new Response(JSON.stringify({ ok: true, doc_id: "doc", embedded: true, chunk_count: 1 })); } if (options.fetchSwitch) active = B; return new Response("Readable private knowledge document", { headers: { "Content-Type": "text/plain" } }); },
  };
  const src = readFileSync(new URL(`../../supabase/functions/kb-ingest-${kind}/index.ts`, import.meta.url), "utf8").replace(/^import .*;\r?\n/gm, "");
  new Function(...Object.keys(env), ts.transpileModule(src, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText)(...Object.values(env));
  const body = kind === "doc" ? { title: "Reference", content: "Private content" } : kind === "file" ? { path: `${A}/file.png`, filename: "file.png" } : { url: "https://example.com/reference" };
  return { calls, run: (extra: object = {}) => run(new Request("https://local.test", { method: "POST", headers: { Authorization: "Bearer token" }, body: JSON.stringify({ ...body, ...extra }) })) };
}
describe("Knowledge ingestion workspace binding", () => {
  for (const kind of ["doc", "file", "url"]) {
    for (const [name, options, extra] of [
      ["dual-member explicit mismatch", {}, { tenant_id: B }],
      ["null active", { active: null }, {}],
      ["revoked member", { member: false }, {}],
      ["malformed member", { member: "true" }, {}],
      ["malformed owner", { owner: "true" }, {}],
      ["deleted actor", { userMissing: true }, {}],
      ["null authority", { member: null }, {}],
      ["authority lookup error", { authorityError: true }, {}],
      ["malformed active workspace", { active: [] }, {}],
    ] as const) it(`${kind} refuses ${name} before egress or write`, async () => {
      const s = setup(kind, options); const res = await s.run(extra);
      expect(res.status).toBe(name === "deleted actor" ? 401 : 403);
      expect(s.calls.ingest).not.toHaveBeenCalled(); expect(s.calls.download).not.toHaveBeenCalled(); expect(s.calls.provider).not.toHaveBeenCalled(); expect(s.calls.fetch).not.toHaveBeenCalled();
    });
  }
  it("rejects another membership's storage path before download", async () => { const s = setup("file"); expect((await s.run({ path: `${B}/file.png` })).status).toBeGreaterThanOrEqual(400); expect(s.calls.download).not.toHaveBeenCalled(); });
  it("revalidates after download before extraction", async () => { const s = setup("file", { downloadSwitch: true }); expect((await s.run()).status).toBeGreaterThanOrEqual(400); expect(s.calls.provider).not.toHaveBeenCalled(); expect(s.calls.fetch).not.toHaveBeenCalled(); });
  it("revalidates after URL fetch before nested write", async () => { const s = setup("url", { fetchSwitch: true }); expect((await s.run()).status).toBeGreaterThanOrEqual(400); expect(s.calls.fetch).toHaveBeenCalledTimes(1); });
  for (const kind of ["file", "url"]) it(`${kind} pins derived workspace in downstream request`, async () => { const s = setup(kind); expect((await s.run()).status).toBe(200); const nested = s.calls.fetch.mock.calls.find(c => String(c[0]).includes("kb-ingest-doc"))!; expect(JSON.parse(nested[1].body as string).tenant_id).toBe(A); });
});

it("preserves private defaults and uses actor scope for doc writes", async () => {
  const s = setup("doc"); expect((await s.run()).status).toBe(200);
  expect(s.calls.ingest.mock.calls[0][1]).toMatchObject({ tenantId: A, created_by: "actor", share_to_network: false });
  expect(s.calls.ingest.mock.calls[0][2]).toMatchObject({ authorize: expect.any(Function) });
});
it("retains platform-owner authority only in the selected workspace", async () => {
  const s = setup("doc", { owner: true, member: false }); expect((await s.run()).status).toBe(200);
  expect((await s.run({ tenant_id: B })).status).toBeGreaterThanOrEqual(400);
});
it("pins extraction trace and stops a switch during extraction before nested write", async () => {
  const s = setup("file", { providerSwitch: true }); expect((await s.run()).status).toBeGreaterThanOrEqual(400);
  expect(s.calls.provider.mock.calls[0][0]).toMatchObject({ trace: { tenant_id: A } }); expect(s.calls.fetch).not.toHaveBeenCalled();
});
for (const kind of ["file", "url"]) it(kind + " suppresses success when scope changes during downstream write", async () => {
  const s = setup(kind, { nestedSwitch: true }); const response = await s.run();
  expect(response.status).toBe(500); expect(await response.json()).toMatchObject({ ok: false, error: "persistence_unverified" });
});

for (const traversal of ["../", "%2e%2e/"]) it("rejects a storage traversal " + traversal, async () => { const s = setup("file"); expect((await s.run({ path: `${A}/${traversal}${B}/file.png` })).status).toBe(403); expect(s.calls.download).not.toHaveBeenCalled(); });
