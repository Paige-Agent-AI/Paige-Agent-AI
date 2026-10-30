// node --test supabase/functions/_shared/growth/list-pages.test.ts   (also: deno test)
// EXP08 A2b (plan S2) — EXTRACTION PARITY for `growth_list`.
//
// `chatBranchBefore` is the paige-ai-chat `growth_list` branch exactly as it stood at 6d8e5c56a
// (index.ts lines 16416-16447, the body of the branch at 16415), transcribed verbatim with its free variables (supabaseClient, admin,
// personaCtx) made parameters; `chatBranchAfter` is the new call site, verbatim. Both run against the
// SAME two recording fakes (the caller's session and the service role): the same requests on each
// client in the same order, a byte-identical result, or the identical thrown error.
//
// EVIDENCE CLASS: automated unit test of the moved code against in-memory fakes.
import { test } from "node:test";
import assert from "node:assert/strict";
import { listGrowthPages } from "./list-pages.ts";
// node:test's describe/it are not in Deno 2.1's node compat; this keeps one file runnable by both
// `node --test` and `deno test` (flat tests named "suite > case").
let suite = "";
const describe = (name: string, body: () => void) => { const prev = suite; suite = name; body(); suite = prev; };
const it = (name: string, fn: () => unknown) => { test(`${suite} > ${name}`, async () => { await fn(); }); };

// deno-lint-ignore no-explicit-any
async function chatBranchBefore(supabaseClient: any, admin: any, personaCtx: any) {
  // deno-lint-ignore no-explicit-any
  let result: any = { success: false };
              // Caller-authed read, EXPLICITLY tenant-pinned (§9). Don't rely on RLS
              // alone: a platform admin's manage-RLS would span tenants, and the URLs
              // below are built from personaCtx's single slug — cross-tenant rows would
              // get wrong links (§13). No tenant context → empty, never a leak.
              const _listTid = personaCtx?.tenant_id ?? null;
              const { data: pages, error } = _listTid
                ? await supabaseClient
                    .from("growth_pages")
                    .select("id, slug, title, status, published_at, updated_at")
                    .eq("tenant_id", _listTid)
                    .order("updated_at", { ascending: false })
                    .limit(100)
                // deno-lint-ignore no-explicit-any
                : { data: [] as any[], error: null };
              if (error) throw error;
              // Resolve the tenant slug once to build the REAL public URL for published
              // pages (§13 — never a made-up link); drafts have no public URL yet.
              let tenantSlug: string | null = null;
              // deno-lint-ignore no-explicit-any
              if ((pages || []).some((p: any) => p.status === "published") && personaCtx?.tenant_id) {
                const { data: t } = await admin.from("tenants").select("slug").eq("id", personaCtx.tenant_id).maybeSingle();
                // deno-lint-ignore no-explicit-any
                tenantSlug = (t as any)?.slug ?? null;
              }
              result = {
                success: true,
                count: (pages || []).length,
                // deno-lint-ignore no-explicit-any
                pages: (pages || []).map((p: any) => ({
                  id: p.id,
                  slug: p.slug,
                  title: p.title,
                  status: p.status,
                  url: p.status === "published" && tenantSlug ? `/p/${tenantSlug}/${p.slug}` : null,
                })),
              };
  return result;
}

// deno-lint-ignore no-explicit-any
async function chatBranchAfter(supabaseClient: any, admin: any, personaCtx: any) {
  // deno-lint-ignore no-explicit-any
  let result: any = { success: false };
              result = await listGrowthPages(supabaseClient, admin, personaCtx?.tenant_id ?? null);
  return result;
}

const TENANT = "11111111-1111-4111-8111-111111111111";
const PAGES = [
  { id: "p1", slug: "spring-masterclass", title: "Spring Masterclass", status: "published", published_at: "2026-10-01T00:00:00Z", updated_at: "2026-10-27T00:00:00Z" },
  { id: "p2", slug: "intake", title: "Intake", status: "draft", published_at: null, updated_at: "2026-10-26T00:00:00Z" },
  { id: "p3", slug: "old-offer", title: "Old offer", status: "archived", published_at: "2026-01-01T00:00:00Z", updated_at: "2026-02-01T00:00:00Z" },
];

type Answer = { data: unknown; error: unknown };
function recordingClient(name: string, wire: unknown[], answers: Record<string, Answer>) {
  return {
    from(table: string) {
      const chain: Array<[string, unknown[]]> = [];
      // deno-lint-ignore no-explicit-any
      const builder: any = new Proxy({}, {
        get(_t, prop) {
          if (prop === "then") {
            // deno-lint-ignore no-explicit-any
            return (ok: any, fail: any) => {
              wire.push({ client: name, query: table, chain: structuredClone(chain) });
              return Promise.resolve(answers[table] ?? { data: null, error: null }).then(ok, fail);
            };
          }
          return (...a: unknown[]) => { chain.push([String(prop), a]); return builder; };
        },
      });
      return builder;
    },
  };
}

// deno-lint-ignore no-explicit-any
async function both(personaCtx: any, answers: Record<string, Answer>) {
  const run = async (fn: typeof chatBranchBefore) => {
    const wire: unknown[] = [];
    try {
      const out = await fn(recordingClient("caller", wire, answers), recordingClient("service", wire, answers), personaCtx);
      return { wire, result: JSON.stringify(out) };
    } catch (e) { return { wire, threw: e }; }
  };
  return { before: await run(chatBranchBefore), after: await run(chatBranchAfter) };
}

describe("growth_list moved to _shared/growth/list-pages.ts — byte-identical", () => {
  const cases: Array<[string, unknown, Record<string, Answer>]> = [
    ["published + draft + archived, slug resolved", { tenant_id: TENANT }, { growth_pages: { data: PAGES, error: null }, tenants: { data: { slug: "north-star" }, error: null } }],
    ["published page but the slug read returns nothing → url null", { tenant_id: TENANT }, { growth_pages: { data: PAGES, error: null }, tenants: { data: null, error: null } }],
    ["drafts only → no slug read at all", { tenant_id: TENANT }, { growth_pages: { data: [PAGES[1]], error: null } }],
    ["no pages (null) → empty list", { tenant_id: TENANT }, { growth_pages: { data: null, error: null } }],
    ["no workspace → empty list, nothing read", { tenant_id: null }, { growth_pages: { data: PAGES, error: null } }],
    ["persona missing → empty list, nothing read", undefined, { growth_pages: { data: PAGES, error: null } }],
  ];
  for (const [label, persona, answers] of cases) {
    it(label, async () => {
      const { before, after } = await both(persona, answers);
      assert.deepEqual(after.wire, before.wire, "the same requests on the same clients, in the same order");
      assert.equal(after.result, before.result, "the same result, byte for byte");
      assert.ok(before.result);
    });
  }
  it("a page-query error is thrown as the same object, before any slug read", async () => {
    const err = { code: "42501", message: "permission denied for table growth_pages" };
    const { before, after } = await both({ tenant_id: TENANT }, { growth_pages: { data: null, error: err } });
    assert.deepEqual(after.wire, before.wire);
    assert.equal(before.threw, err);
    assert.equal(after.threw, err);
  });
  it("the page list goes through the caller's session; the service role reads only the workspace slug (§9)", async () => {
    const { after } = await both({ tenant_id: TENANT }, { growth_pages: { data: PAGES, error: null }, tenants: { data: { slug: "north-star" }, error: null } });
    assert.deepEqual(after.wire, [
      { client: "caller", query: "growth_pages", chain: [["select", ["id, slug, title, status, published_at, updated_at"]], ["eq", ["tenant_id", TENANT]], ["order", ["updated_at", { ascending: false }]], ["limit", [100]]] },
      { client: "service", query: "tenants", chain: [["select", ["slug"]], ["eq", ["id", TENANT]], ["maybeSingle", []]] },
    ]);
  });
});
