// @vitest-environment node
// The Studio draft, edit, route, critique and learn backends decide a person's authority the same
// way generate-image and content-draft do (_shared/studio-caller.ts): the workspace their session is
// in, as its owner, admin or managing agency. A platform-wide user_roles admin/super_admin grants
// nothing, a body tenant naming another workspace is refused rather than swapped, and the
// service-role path (Paige's headless agent, growth-funnel-draft's sibling calls) is unchanged.
//
// These run the REAL edge handlers with their imports replaced by in-memory doubles — the auth
// decision is the handler's own code, the database is a double. This is not authenticated runtime
// proof against Supabase.
import { readFileSync } from "node:fs";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import * as growthBlocks from "../../supabase/functions/_shared/growth-blocks.ts";
import * as growthForms from "../../supabase/functions/_shared/growth-forms.ts";
import * as studioCaller from "../../supabase/functions/_shared/studio-caller.ts";
import { CHEESY_TELLS_AVOID } from "../../supabase/functions/_shared/cheesy-tells.ts";

const MINE = "11111111-1111-4111-8111-111111111111";
const THEIRS = "22222222-2222-4222-8222-222222222222";
const ARTIFACT = "33333333-3333-4333-8333-333333333333";
// STUDIO_VISUAL_CRITIQUE_ENABLED: studio-visual-critique answers "disabled" (no row) on BOTH paths without
// it, and its tests below need the critique to run and log. No other function here reads the flag.
const ENV: Record<string, string> = { SUPABASE_URL: "https://db.test", SUPABASE_ANON_KEY: "anon", SUPABASE_SERVICE_ROLE_KEY: "service", STUDIO_VISUAL_CRITIQUE_ENABLED: "true" };
const bearer = (role: string) => `h.${Buffer.from(JSON.stringify({ role, sub: "u1" })).toString("base64url")}.s`;

interface World { active?: unknown; activeFails?: boolean; admin?: boolean; manages?: boolean; artifactTenant?: string }

function world(w: World) {
  const seen = {
    userRoles: 0,
    rpc: [] as Array<{ fn: string; args?: Record<string, unknown> }>,
    service: [] as Array<{ fn: string; args?: Record<string, unknown> }>,
    inserts: [] as Array<{ table: string; row: Record<string, unknown> }>,
    knowledgeTenant: undefined as unknown,
  };
  type Chain = Record<string, (...args: never[]) => unknown>;
  const chain = (rows: unknown, single: unknown, onInsert?: (row: Record<string, unknown>) => void): Chain => {
    const q: Chain = {
      // gte: studio-visual-critique's per-tenant throttle count (an empty log here → under the limit).
      select: () => q, eq: () => q, in: () => q, limit: () => q, gte: () => q,
      insert: (row: Record<string, unknown>) => { onInsert?.(row); return q; },
      maybeSingle: async () => ({ data: single, error: null }),
      then: (ok: (v: unknown) => unknown, bad: (e: unknown) => unknown) => Promise.resolve({ data: rows, error: null }).then(ok, bad),
    };
    return q;
  };
  const authed = {
    auth: { getUser: async () => ({ data: { user: { id: "u1" } }, error: null }) },
    rpc: async (fn: string, args?: Record<string, unknown>) => {
      seen.rpc.push({ fn, args });
      if (fn === "current_user_tenant_id") return w.activeFails ? { data: null, error: { message: "down" } } : { data: w.active ?? null, error: null };
      if (fn === "is_tenant_admin") return { data: w.admin === true, error: null };
      if (fn === "agency_can_manage_child") return { data: w.manages === true, error: null };
      return { data: null, error: null };
    },
    // A platform-wide super_admin row. Code that still asked user_roles would be granted by it.
    from: (table: string) => {
      if (table === "user_roles") seen.userRoles += 1;
      return chain([{ role: "super_admin" }, { role: "admin" }], null);
    },
  };
  const service = {
    rpc: async (fn: string, args?: Record<string, unknown>) => {
      seen.service.push({ fn, args });
      return { data: fn === "resolve_tool_autonomy" ? "off" : null, error: null };
    },
    from: (table: string) => chain(null,
      table === "growth_pages" ? { id: ARTIFACT, tenant_id: w.artifactTenant, title: "Page", status: "published" } : null,
      (row) => seen.inserts.push({ table, row })),
  };
  const adapters: Record<string, unknown> = {
    createClient: (_url: string, key: string) => (key === "service" ? service : authed),
    ...growthBlocks, ...growthForms, ...studioCaller, CHEESY_TELLS_AVOID,
    routedChatCompletion: async () => ({ choices: [{ message: { content: '{"artifact":"form","reasoning":"a standalone intake"}' } }] }),
    chatCompletionCompat: async () => { throw new Error("model down"); },
    callModel: async () => { throw new Error("model down"); },
    retrieveTenantKnowledge: async (tenant: unknown) => { seen.knowledgeTenant = tenant; return []; },
    buildKnowledgeBlock: () => "",
    deriveFinanceInScopeFromFeatures: () => false,
    assertPublicHttpUrl: async () => {},
    ingestDoc: async () => ({ ok: false, error: "not reached" }),
    flattenBlocks: () => "", flattenFormSchema: () => "",
  };
  return { seen, adapters };
}

const IMPORT_RE = /^import\s[\s\S]*?\sfrom\s+["'][^"']+["'];\r?\n/gm;

function run(fn: string, w: World, body: Record<string, unknown>, role = "authenticated") {
  const raw = readFileSync(new URL(`../../supabase/functions/${fn}/index.ts`, import.meta.url), "utf8");
  // Only the names this file imports are injected, so nothing shadows its own declarations.
  const imported = new Set((raw.match(IMPORT_RE) ?? []).flatMap((s) =>
    (s.match(/\{([\s\S]*?)\}/)?.[1] ?? "").split(",").map((n) => n.trim()).filter((n) => n && !n.startsWith("type "))));
  const compiled = ts.transpileModule(raw.replace(IMPORT_RE, ""), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  }).outputText;
  const { seen, adapters } = world(w);
  let handler!: (req: Request) => Promise<Response>;
  const env: Record<string, unknown> = {
    serve: (h: typeof handler) => { handler = h; },
    Deno: { env: { get: (k: string) => ENV[k] } },
    // growth-funnel-draft calls its sibling drafters over HTTP; never leave the test process.
    fetch: async () => new Response(JSON.stringify({ error: { code: "STUB", message: "sibling not reachable in tests" } }), { status: 503 }),
  };
  for (const name of imported) if (name !== "serve" && name in adapters) env[name] = adapters[name];
  new Function(...Object.keys(env), compiled)(...Object.values(env));
  const res = handler(new Request(`https://edge.test/${fn}`, {
    method: "POST", headers: { Authorization: `Bearer ${bearer(role)}` }, body: JSON.stringify(body),
  }));
  return { seen, res };
}

const HERO = { type: "hero", title: "Get your weekends back" };
const FUNCTIONS: Array<{ fn: string; body: Record<string, unknown>; nested: boolean }> = [
  { fn: "growth-page-draft", body: { brief: "A webinar sign-up page for consultants" }, nested: true },
  { fn: "growth-form-draft", body: { brief: "An intake form for new consulting clients" }, nested: true },
  { fn: "growth-funnel-draft", body: { brief: "A lead funnel for a consulting offer" }, nested: true },
  { fn: "growth-block-edit", body: { block: HERO, instruction: "make the headline punchier" }, nested: true },
  { fn: "growth-studio-route", body: { brief: "An intake form for new clients" }, nested: true },
  { fn: "studio-visual-critique", body: { image_url: "https://img.test/a.png", iteration: 3 }, nested: false },
  { fn: "studio-learn-from-artifact", body: { artifact_type: "page", artifact_id: ARTIFACT }, nested: false },
];

/** For learn, the workspace is the artifact's own; for the rest, the body may only name the session's. */
const withTenant = (fn: string, body: Record<string, unknown>, tenant: string, w: World): [Record<string, unknown>, World] =>
  fn === "studio-learn-from-artifact" ? [body, { ...w, artifactTenant: tenant }] : [{ ...body, tenant_id: tenant }, { ...w, artifactTenant: MINE }];

async function refusal(res: Promise<Response>, nested: boolean) {
  const r = await res;
  const json = await r.json();
  return { status: r.status, forbidden: json.forbidden, code: nested ? json.error?.code : undefined, message: nested ? json.error?.message : json.error };
}

describe.each(FUNCTIONS)("$fn: a person's authority is their own workspace", ({ fn, body, nested }) => {
  it("refuses a platform-wide super_admin who is not the workspace's owner, admin or managing agency", async () => {
    const [b, w] = withTenant(fn, body, MINE, { active: MINE, admin: false, manages: false });
    const { seen, res } = run(fn, w, b);
    expect(await refusal(res, nested)).toMatchObject({ status: 403, forbidden: true, ...(nested ? { code: "FORBIDDEN" } : {}) });
    expect(seen.userRoles).toBe(0);
    expect(seen.rpc.find((c) => c.fn === "is_tenant_admin")?.args).toEqual({ _tenant: MINE });
  });

  it("refuses another workspace — never swaps it, never asks about permissions there", async () => {
    const [b, w] = withTenant(fn, body, THEIRS, { active: MINE, admin: true });
    const { seen, res } = run(fn, w, b);
    expect(await refusal(res, nested)).toMatchObject({ status: 403, forbidden: true });
    expect(seen.rpc.map((c) => c.fn)).toEqual(["current_user_tenant_id"]);
    expect(seen.knowledgeTenant).toBeUndefined();
    expect(seen.inserts).toEqual([]);
  });

  it("refuses when no workspace is open", async () => {
    const [b, w] = withTenant(fn, body, MINE, { active: null, admin: true });
    expect(await refusal(run(fn, w, { ...b, tenant_id: undefined }).res, nested)).toMatchObject({ status: 403, forbidden: true });
  });

  it("answers a failed lookup with a retryable 500, not a permission verdict", async () => {
    const [b, w] = withTenant(fn, body, MINE, { activeFails: true, admin: true });
    const r = await refusal(run(fn, w, b).res, nested);
    expect(r.status).toBe(500);
    expect(r.forbidden).toBeUndefined();
  });
});

describe("the workspace's owner, admin or managing agency gets through, on their own workspace", () => {
  it("growth-studio-route classifies for the owner", async () => {
    const { res } = run("growth-studio-route", { active: MINE, admin: true }, { brief: "An intake form for new clients" });
    const r = await res;
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ artifact: "form" });
  });

  it("growth-form-draft and growth-funnel-draft ground the draft in the session's workspace, for a managing agency too", async () => {
    for (const fn of ["growth-form-draft", "growth-funnel-draft"]) {
      const { seen, res } = run(fn, { active: MINE, admin: false, manages: true }, { brief: "An intake form for new consulting clients", tenant_id: MINE });
      await res;
      expect(seen.knowledgeTenant).toBe(MINE);
      expect(seen.userRoles).toBe(0);
    }
  });

  it("growth-page-draft and growth-block-edit read brand only for the session's workspace", async () => {
    for (const [fn, body] of [["growth-page-draft", { brief: "A webinar sign-up page for consultants" }], ["growth-block-edit", { block: HERO, instruction: "make it punchier" }]] as const) {
      const { seen, res } = run(fn, { active: MINE, admin: true }, body);
      await res;
      expect(seen.service.find((c) => c.fn === "resolve_tenant_brand")?.args).toEqual({ _tenant_id: MINE });
    }
  });

  it("studio-visual-critique logs against the session's workspace", async () => {
    const { seen, res } = run("studio-visual-critique", { active: MINE, admin: true }, { image_url: "https://img.test/a.png", iteration: 3 });
    const r = await res;
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ ok: true, capped: true });
    expect(seen.inserts.map((i) => i.row.tenant_id)).toEqual([MINE]);
  });

  it("studio-learn-from-artifact resolves the learning gate for the artifact's own workspace", async () => {
    const { seen, res } = run("studio-learn-from-artifact", { active: MINE, admin: true, artifactTenant: MINE }, { artifact_type: "page", artifact_id: ARTIFACT });
    const r = await res;
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ blocked: true });
    expect(seen.service.find((c) => c.fn === "resolve_tool_autonomy")?.args).toMatchObject({ _tenant_id: MINE });
  });
});

describe("the service-role path is unchanged: Paige's headless agent names the tenant", () => {
  it.each([
    ["growth-form-draft", { brief: "An intake form for new consulting clients" }],
    ["growth-funnel-draft", { brief: "A lead funnel for a consulting offer" }],
  ] as const)("%s drafts for the tenant it was given, with no session lookups", async (fn, body) => {
    const { seen, res } = run(fn, {}, { ...body, tenant_id: THEIRS }, "service_role");
    await res;
    expect(seen.knowledgeTenant).toBe(THEIRS);
    expect(seen.rpc).toEqual([]);
  });

  it("studio-visual-critique logs for the tenant a service-role caller names", async () => {
    const { seen, res } = run("studio-visual-critique", {}, { image_url: "https://img.test/a.png", iteration: 3, tenant_id: THEIRS }, "service_role");
    expect((await res).status).toBe(200);
    expect(seen.inserts.map((i) => i.row.tenant_id)).toEqual([THEIRS]);
    expect(seen.rpc).toEqual([]);
  });
});
