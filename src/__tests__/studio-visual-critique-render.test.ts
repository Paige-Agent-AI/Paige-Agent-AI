// @vitest-environment node
// studio-visual-critique renders pages through paige-browser /render (the ONE browser host — the
// visual-renderer Fly app it used to call was never deployed and is deleted), critiques the returned
// slices, and leaves an honest audit row even when no verdict was possible.
//
// These run the REAL edge handler with its imports replaced by in-memory doubles (the same harness
// shape as studio-draft-authority.test.ts): paige-browser, the image host, the model and the
// database are doubles. This is not runtime proof against the deployed host or Supabase.
import { readFileSync } from "node:fs";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import * as studioCaller from "../../supabase/functions/_shared/studio-caller.ts";
import { CHEESY_TELLS_AVOID } from "../../supabase/functions/_shared/cheesy-tells.ts";

const MINE = "11111111-1111-4111-8111-111111111111";
const THEIRS = "22222222-2222-4222-8222-222222222222";
const BROWSER = "https://paige-browser.test";
const BASE_ENV: Record<string, string> = { SUPABASE_URL: "https://db.test", SUPABASE_ANON_KEY: "anon", SUPABASE_SERVICE_ROLE_KEY: "service" };
const WITH_BROWSER = { ...BASE_ENV, PAIGE_BROWSER_URL: `${BROWSER}/`, PAIGE_BROWSER_SECRET: "browser-secret" };
const bearer = (role: string) => `h.${Buffer.from(JSON.stringify({ role, sub: "u1" })).toString("base64url")}.s`;

// A tiny but real JPEG header so a slice decodes as image bytes; contents are irrelevant to the double model.
const JPEG_B64 = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 0xff, 0xd9]).toString("base64");
const slices = (n: number) => Array.from({ length: n }, (_, i) => ({ y: i * 1600, height: 1600, jpeg_base64: JPEG_B64 }));
const VERDICT = JSON.stringify({ verdict: "ITERATE", summary: "Hero lacks hierarchy.", blockers: [], should_fix: ["tighten the type ladder"], nits: [], cheesy_tells_hit: [], refined_prompt: "Make the hero headline dominant." });

interface Opts {
  env?: Record<string, string>;
  role?: string;
  browser?: (body: Record<string, unknown>) => { status?: number; json: unknown };
  model?: { content?: string; needs_config?: boolean; throws?: boolean };
  insertError?: { message: string } | null;
  image?: { status?: number; type?: string; bytes?: number };
}

function run(body: Record<string, unknown>, o: Opts = {}) {
  const env = o.env ?? WITH_BROWSER;
  const seen = {
    envKeys: new Set<string>(),
    fetches: [] as Array<{ url: string; headers: Record<string, string>; body: Record<string, unknown> | null }>,
    model: [] as Array<{ content: Array<Record<string, unknown>>; opts: Record<string, unknown> }>,
    inserts: [] as Array<Record<string, unknown>>,
  };
  type Chain = Record<string, (...args: never[]) => unknown>;
  const authed = {
    auth: { getUser: async () => ({ data: { user: { id: "u1" } }, error: null }) },
    rpc: async (fn: string) => {
      if (fn === "current_user_tenant_id") return { data: MINE, error: null };
      if (fn === "is_tenant_admin") return { data: true, error: null };
      return { data: null, error: null };
    },
    from: () => { throw new Error("the critique never reads tables on a person's client"); },
  };
  const service = {
    from: (table: string) => {
      const q: Chain = {
        insert: (row: Record<string, unknown>) => {
          seen.inserts.push({ table, ...row });
          return { then: (ok: (v: unknown) => unknown, bad: (e: unknown) => unknown) => Promise.resolve({ data: null, error: o.insertError ?? null }).then(ok, bad) };
        },
      };
      return q;
    },
  };
  const adapters: Record<string, unknown> = {
    createClient: (_url: string, key: string) => (key === "service" ? service : authed),
    ...studioCaller,
    CHEESY_TELLS_AVOID,
    assertPublicHttpUrl: async (u: string) => { if (u.includes("169.254")) throw new Error("blocked private host"); },
    callModel: async (_mod: string, _tier: string, task: { messages: Array<{ content: Array<Record<string, unknown>> }> }, opts: Record<string, unknown>) => {
      seen.model.push({ content: task.messages[0].content, opts });
      if (o.model?.throws) throw new Error("model down");
      if (o.model?.needs_config) return { needs_config: true };
      return { content: o.model?.content ?? VERDICT, model: "claude-test", cost_estimate_usd: 0.0123 };
    },
  };
  const raw = readFileSync(new URL("../../supabase/functions/studio-visual-critique/index.ts", import.meta.url), "utf8");
  const IMPORT_RE = /^import\s[\s\S]*?\sfrom\s+["'][^"']+["'];\r?\n/gm;
  const compiled = ts.transpileModule(raw.replace(IMPORT_RE, ""), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
  let handler!: (req: Request) => Promise<Response>;
  const scope: Record<string, unknown> = {
    serve: (h: typeof handler) => { handler = h; },
    Deno: { env: { get: (k: string) => { seen.envKeys.add(k); return env[k]; } } },
    fetch: async (url: string, init?: { headers?: Record<string, string>; body?: string }) => {
      seen.fetches.push({ url: String(url), headers: init?.headers ?? {}, body: init?.body ? JSON.parse(init.body) : null });
      if (String(url).startsWith(BROWSER)) {
        const r = o.browser?.(JSON.parse(init?.body ?? "{}")) ?? { json: { ok: true, width: 1440, full_height: 4800, slices: slices(3), truncated: false } };
        return new Response(JSON.stringify(r.json), { status: r.status ?? 200, headers: { "content-type": "application/json" } });
      }
      const img = o.image ?? {};
      return new Response(new Uint8Array(img.bytes ?? 2048), { status: img.status ?? 200, headers: { "content-type": img.type ?? "image/png" } });
    },
    ...adapters,
  };
  new Function(...Object.keys(scope), compiled)(...Object.values(scope));
  const res = handler(new Request("https://edge.test/studio-visual-critique", {
    method: "POST", headers: { Authorization: `Bearer ${bearer(o.role ?? "authenticated")}` }, body: JSON.stringify(body),
  }));
  return { seen, res: res.then(async (r) => ({ status: r.status, json: await r.json() as Record<string, unknown> })) };
}

const PAGE = { blocks: [{ type: "hero", title: "Get your weekends back" }], theme: { primary: "#1f2a5a" }, tenant_name: "Northwind", junk: "dropped" };

describe("pages render through paige-browser /render", () => {
  it("sends the draft page payload with the browser secret, critiques every slice, and logs the verdict", async () => {
    const { seen, res } = run({ render: { page: PAGE }, brief: "a consulting landing page" });
    const r = await res;
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ ok: true, verdict: "ITERATE", logged: true, capture: { width: 1440, full_height: 4800, slices_sent: 3, slices_total: 3, truncated: false, viewport: "desktop" } });
    const call = seen.fetches.find((f) => f.url === `${BROWSER}/render`);
    expect(call?.headers["X-Browser-Secret"]).toBe("browser-secret");
    expect(call?.body).toEqual({ page: { blocks: PAGE.blocks, theme: PAGE.theme, tenant_name: "Northwind" }, viewport: "desktop" });
    const images = seen.model[0].content.filter((c) => c.type === "image_url");
    expect(images).toHaveLength(3);
    expect(String((images[0].image_url as { url: string }).url)).toMatch(/^data:image\/jpeg;base64,/);
    expect(String(seen.model[0].content[0].text)).toContain("Together they show the whole page");
    expect(seen.inserts).toHaveLength(1);
    expect(seen.inserts[0]).toMatchObject({ table: "studio_visual_critique_log", tenant_id: MINE, verdict: "ITERATE", image_source: "render", artifact_kind: "page", cost_estimate_usd: 0.0123 });
  });

  it("sends at most four slices and tells the critic the page continues", async () => {
    const { seen, res } = run({ render: { page: PAGE, viewport: "mobile" } }, {
      browser: () => ({ json: { ok: true, width: 390, full_height: 12000, slices: slices(6), truncated: true } }),
    });
    const r = await res;
    expect(seen.fetches[0].body?.viewport).toBe("mobile");
    expect(seen.model[0].content.filter((c) => c.type === "image_url")).toHaveLength(4);
    expect(String(seen.model[0].content[0].text)).toContain("CONTINUES below what you can see");
    expect(r.json.capture).toMatchObject({ slices_sent: 4, slices_total: 6, truncated: true, viewport: "mobile" });
  });

  it("passes a published url through for paige-browser to allowlist", async () => {
    const { seen, res } = run({ render: { url: "https://paigeagent.ai/p/northwind/home" }, artifact_kind: "funnel" });
    expect((await res).json.ok).toBe(true);
    expect(seen.fetches[0].body).toEqual({ url: "https://paigeagent.ai/p/northwind/home", viewport: "desktop" });
    expect(seen.inserts[0]).toMatchObject({ artifact_kind: "funnel" });
  });

  it("never reads the deleted visual-renderer settings", async () => {
    const { seen, res } = run({ render: { page: PAGE } });
    await res;
    expect([...seen.envKeys].filter((k) => k.startsWith("VISUAL_RENDERER"))).toEqual([]);
    expect(readFileSync(new URL("../../supabase/functions/studio-visual-critique/index.ts", import.meta.url), "utf8")).not.toMatch(/VISUAL_RENDERER_(URL|SECRET)/);
  });
});

describe("no verdict is never a silent outcome", () => {
  it("renderer not configured → needs_config, no network call, and a NO_VERDICT row", async () => {
    const { seen, res } = run({ render: { page: PAGE } }, { env: BASE_ENV });
    const r = await res;
    expect(r.json).toMatchObject({ ok: false, status: "renderer_not_configured", needs_config: true, logged: true });
    expect(seen.fetches).toEqual([]);
    expect(seen.model).toEqual([]);
    expect(seen.inserts[0]).toMatchObject({ verdict: "NO_VERDICT", image_source: "render", findings: { status: "renderer_not_configured" }, model: null, cost_estimate_usd: 0 });
  });

  it("a refused render → render_failed with paige-browser's reason, no model call, a NO_VERDICT row", async () => {
    const { seen, res } = run({ render: { page: PAGE } }, { browser: () => ({ json: { ok: false, reason: "not_ready", error: "never signalled ready" } }) });
    const r = await res;
    expect(r.json).toMatchObject({ ok: false, status: "render_failed", needs_config: false });
    expect(String(r.json.message)).toContain("not_ready");
    expect(seen.model).toEqual([]);
    expect(seen.inserts[0]).toMatchObject({ verdict: "NO_VERDICT", findings: { status: "render_failed" } });
    expect(String((seen.inserts[0].findings as { reason: string }).reason)).toContain("not_ready");
  });

  it("an HTTP refusal from paige-browser carries its status reason", async () => {
    const { res } = run({ render: { url: "https://example.com/" } }, { browser: () => ({ status: 403, json: { ok: false, reason: "origin_not_allowed", error: "not a Paige app origin" } }) });
    expect(String((await res).json.message)).toContain("origin_not_allowed");
  });

  it("the vision model unconfigured → model_not_configured and a NO_VERDICT row", async () => {
    const { seen, res } = run({ render: { page: PAGE } }, { model: { needs_config: true } });
    expect((await res).json).toMatchObject({ ok: false, status: "model_not_configured", needs_config: true });
    expect(seen.inserts[0]).toMatchObject({ verdict: "NO_VERDICT", findings: { status: "model_not_configured" } });
  });

  it("a failed log insert is reported back, not swallowed", async () => {
    const { res } = run({ render: { page: PAGE } }, { insertError: { message: "violates check constraint studio_visual_critique_verdict_chk" } });
    const r = await res;
    expect(r.json).toMatchObject({ ok: true, verdict: "ITERATE", logged: false });
    expect(String(r.json.log_error)).toContain("studio_visual_critique_verdict_chk");
  });

  it("an image that cannot be fetched → image_unavailable and a NO_VERDICT row", async () => {
    const { seen, res } = run({ image_url: "https://img.test/a.png" }, { image: { status: 404 } });
    expect((await res).json).toMatchObject({ ok: false, status: "image_unavailable", needs_config: false });
    expect(seen.inserts[0]).toMatchObject({ verdict: "NO_VERDICT", image_source: "image_url", artifact_kind: "image" });
  });
});

describe("the image path and the inputs", () => {
  it("image_url still critiques one image without touching paige-browser", async () => {
    const { seen, res } = run({ image_url: "https://img.test/a.png" });
    const r = await res;
    expect(r.json).toMatchObject({ ok: true, verdict: "ITERATE", logged: true });
    expect(seen.fetches.map((f) => f.url)).toEqual(["https://img.test/a.png"]);
    expect(seen.model[0].content.filter((c) => c.type === "image_url")).toHaveLength(1);
    expect(seen.inserts[0]).toMatchObject({ image_source: "image_url", artifact_kind: "image" });
    expect(r.json.capture).toBeUndefined();
  });

  it.each([
    ["render.html (retired with the old renderer)", { render: { html: "<h1>x</h1>" } }, "render.html is no longer supported"],
    ["both page and url", { render: { page: PAGE, url: "https://paigeagent.ai/p/a/b" } }, "exactly one of page or url"],
    ["an unknown viewport", { render: { page: PAGE, viewport: "watch" } }, "render.viewport must be one of"],
    ["blocks that are not an array", { render: { page: { blocks: "hero" } } }, "blocks array"],
    ["image_url and render together", { image_url: "https://img.test/a.png", render: { page: PAGE } }, "not both"],
    ["a private render url", { render: { url: "https://169.254.169.254/latest" } }, "render.url rejected"],
  ])("refuses %s with a 400 before any network call", async (_label, body, message) => {
    const { seen, res } = run(body as Record<string, unknown>);
    const r = await res;
    expect(r.status).toBe(400);
    expect(String(r.json.error)).toContain(message);
    expect(seen.fetches).toEqual([]);
  });

  it("refuses an oversized page payload before calling paige-browser", async () => {
    const big = { blocks: [{ type: "rich_text", html: "x".repeat(1_000_001) }] };
    const { seen, res } = run({ render: { page: big } });
    expect((await res).status).toBe(400);
    expect(seen.fetches).toEqual([]);
  });
});

describe("§9 — the tenant a service-role caller names is the tenant everything carries", () => {
  it("logs AND traces the model call under the named tenant, with no session lookups", async () => {
    const { seen, res } = run({ render: { page: PAGE }, tenant_id: THEIRS }, { role: "service_role" });
    expect((await res).status).toBe(200);
    expect(seen.inserts.map((i) => i.tenant_id)).toEqual([THEIRS]);
    expect(seen.model[0].opts).toMatchObject({ tenantId: THEIRS, actorRole: "operator", callerFunction: "studio-visual-critique" });
  });

  it("a JWT caller's model call carries the session's workspace", async () => {
    const { seen, res } = run({ render: { page: PAGE } });
    await res;
    expect(seen.model[0].opts).toMatchObject({ tenantId: MINE, actorRole: "tenant", actorUserId: "u1" });
  });
});
