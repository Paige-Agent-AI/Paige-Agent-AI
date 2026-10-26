// EXP08 stage 0 — the Platform Operator guard and the functions that must use it.
//
//   deno test --allow-import --allow-env --allow-read=supabase/functions --node-modules-dir=none \
//     --deny-net supabase/functions/_shared/operatorAuth.test.ts
//
// Owner ruling 2026-10-26: owning or administering one business must never carry admin power into
// another. The functions below act on PLATFORM resources (any user's login; the platform's Apollo,
// Cal.com, DocuSign and Firecrawl accounts) and used to admit the GLOBAL `user_roles` `admin` row —
// written for an owner/admin seat in ANY workspace. They now admit the Platform Operator only.
//
// The default-resolver tests drive the REAL operatorUserId (systems-check-http.ts) through a stubbed
// fetch, so what is proven is the shipped HTTP path: the token is verified, the RPC asked is
// `is_platform_operator` with the CALLER's bearer, and a caller whose answer is false — every
// workspace owner — is refused. No network: fetch is replaced and --deny-net is set.

import assert from "node:assert/strict";
import { requireOperator } from "./operatorAuth.ts";

const OPERATOR = "0a0a0a0a-1111-4111-8111-111111111111";
const WORKSPACE_OWNER = "0b0b0b0b-2222-4222-8222-222222222222";
const fakeAdmin = { fake: "service-role-client" } as never;

function req(auth?: string): Request {
  return new Request("https://edge.example.test/fn", {
    method: "POST",
    headers: auth ? { Authorization: auth } : {},
  });
}

Deno.test("no bearer token is 401 and the operator check is never asked", async () => {
  let asked = 0;
  for (const auth of [undefined, "", "Basic abc", "Bearer ", "Bearer    "]) {
    const g = await requireOperator(req(auth), { resolveOperator: async () => (asked++, OPERATOR) });
    assert.equal(g.ok, false);
    if (!g.ok) {
      assert.equal(g.response.status, 401);
      assert.deepEqual(await g.response.json(), { error: "unauthorized" });
    }
  }
  assert.equal(asked, 0);
});

Deno.test("a verified non-operator (any workspace owner/admin) is 403", async () => {
  const g = await requireOperator(req("Bearer owner-token"), { resolveOperator: async () => null });
  assert.equal(g.ok, false);
  if (!g.ok) {
    assert.equal(g.response.status, 403);
    assert.deepEqual(await g.response.json(), { error: "forbidden" });
  }
});

Deno.test("an operator-check error fails closed to 403, never a pass", async () => {
  const g = await requireOperator(req("Bearer t"), {
    resolveOperator: async () => { throw new Error("rpc down"); },
  });
  assert.equal(g.ok, false);
  if (!g.ok) assert.equal(g.response.status, 403);
});

Deno.test("a verified operator passes with its uid and a service-role client", async () => {
  let made = 0;
  const g = await requireOperator(req("Bearer op-token"), {
    resolveOperator: async () => OPERATOR,
    makeAdmin: () => (made++, fakeAdmin),
  });
  assert.equal(g.ok, true);
  if (g.ok) {
    assert.equal(g.userId, OPERATOR);
    assert.equal(g.admin, fakeAdmin);
  }
  assert.equal(made, 1);
});

// ── The real default resolver, over a stubbed fetch ────────────────────────────────────────────
// supabase-js starts an auth refresh timer per client, which the sanitizers would call a leak.
function withFetch(
  answer: { user: string | null; operator: boolean | "error" },
  run: (calls: Array<{ url: string; auth: string | null; method: string }>) => Promise<void>,
) {
  return async () => {
    Deno.env.set("SUPABASE_URL", "https://project.example.test");
    Deno.env.set("SUPABASE_ANON_KEY", "anon-key-fixture");
    Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "service-key-fixture");
    const calls: Array<{ url: string; auth: string | null; method: string }> = [];
    const original = globalThis.fetch;
    globalThis.fetch = (async (input: Request | URL | string, init?: RequestInit) => {
      const r = new Request(input, init);
      calls.push({ url: r.url, auth: r.headers.get("Authorization"), method: r.method });
      const json = (b: unknown, status = 200) =>
        new Response(JSON.stringify(b), { status, headers: { "Content-Type": "application/json" } });
      if (r.url.includes("/auth/v1/user")) {
        return answer.user ? json({ id: answer.user, aud: "authenticated" }) : json({ msg: "invalid JWT" }, 401);
      }
      if (r.url.includes("/rest/v1/rpc/is_platform_operator")) {
        return answer.operator === "error" ? json({ message: "boom", code: "XX000" }, 500) : json(answer.operator);
      }
      return json({ message: `unexpected ${r.url}` }, 599);
    }) as typeof fetch;
    try {
      await run(calls);
    } finally {
      globalThis.fetch = original;
    }
  };
}

Deno.test({ name: "default resolver: an operator passes; the RPC is is_platform_operator with the caller's bearer", sanitizeOps: false, sanitizeResources: false, fn: withFetch({ user: OPERATOR, operator: true }, async (calls) => {
    const g = await requireOperator(req("Bearer caller-jwt"));
    assert.equal(g.ok, true);
    if (g.ok) assert.equal(g.userId, OPERATOR);
    const rpc = calls.find((c) => c.url.includes("/rest/v1/rpc/"));
    assert.ok(rpc, "an RPC must be asked");
    assert.ok(rpc!.url.endsWith("/rest/v1/rpc/is_platform_operator"), rpc!.url);
    assert.equal(rpc!.auth, "Bearer caller-jwt");
    assert.equal(calls.some((c) => c.url.includes("has_role") || c.url.includes("user_roles")), false);
  }) });

Deno.test({ name: "default resolver: a workspace owner (is_platform_operator false) is refused 403", sanitizeOps: false, sanitizeResources: false, fn: withFetch({ user: WORKSPACE_OWNER, operator: false }, async () => {
    const g = await requireOperator(req("Bearer owner-jwt"));
    assert.equal(g.ok, false);
    if (!g.ok) assert.equal(g.response.status, 403);
  }) });

Deno.test({ name: "default resolver: an invalid token is refused", sanitizeOps: false, sanitizeResources: false, fn: withFetch({ user: null, operator: true }, async () => {
    const g = await requireOperator(req("Bearer bad-jwt"));
    assert.equal(g.ok, false);
    if (!g.ok) assert.equal(g.response.status, 403);
  }) });

Deno.test({ name: "default resolver: an RPC error is refused", sanitizeOps: false, sanitizeResources: false, fn: withFetch({ user: OPERATOR, operator: "error" }, async () => {
    const g = await requireOperator(req("Bearer caller-jwt"));
    assert.equal(g.ok, false);
    if (!g.ok) assert.equal(g.response.status, 403);
  }) });

// ── Every platform-resource function is bound to the guard ─────────────────────────────────────
const OPERATOR_ONLY = [
  "admin-delete-user",
  "apollo-enrich-company",
  "apollo-enrich-person",
  "apollo-search-people",
  "backfill-memory-embeddings",
  "cal-cancel-booking",
  "cal-list-bookings",
  "docusign-send-envelope",
  "preview-beta-launch-email",
  "web-search",
];

Deno.test("each platform-resource function gates on requireOperator, not the global admin role", async () => {
  for (const fn of OPERATOR_ONLY) {
    const src = await Deno.readTextFile(new URL(`../${fn}/index.ts`, import.meta.url));
    assert.match(src, /import \{ requireOperator \} from "\.\.\/_shared\/operatorAuth\.ts";/, fn);
    assert.match(src, /await requireOperator\(req\)/, fn);
    assert.doesNotMatch(src, /requireAdmin\s*\(/, `${fn} must not call requireAdmin`);
    assert.doesNotMatch(src, /has_role/, `${fn} must not ask has_role`);
    assert.doesNotMatch(src, /\.has\("admin"\)|role === "admin"|r\.role === 'admin'/, `${fn} must not admit the global admin row`);
    const gate = src.indexOf("await requireOperator(req)");
    const body = src.search(/await req\.json\(\)|new URL\(req\.url\)/);
    assert.ok(body === -1 || gate < body, `${fn}: the operator gate must run before the request is read`);
  }
});

Deno.test("admin-delete-user: a platform_admin may not delete a super_admin", async () => {
  const src = await Deno.readTextFile(new URL("../admin-delete-user/index.ts", import.meta.url));
  assert.match(src, /if \(targetIsSuperAdmin && !callerIsSuperAdmin\)/);
  assert.ok(src.indexOf("if (targetIsSuperAdmin && !callerIsSuperAdmin)") < src.indexOf("admin.auth.admin.deleteUser(user_id)"));
});
