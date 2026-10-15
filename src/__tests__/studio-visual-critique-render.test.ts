// @vitest-environment node
// studio-visual-critique renders landing pages through paige-browser /render (the ONE browser host —
// the visual-renderer Fly app it used to call was never deployed and is deleted), critiques the
// returned slices, and leaves an honest audit row whenever it ATTEMPTED a critique: a verdict, or
// NO_VERDICT with one of six reason codes. Never attempted (flag off, throttled, refused) = no row.
//
// These run the REAL edge handler with its imports replaced by in-memory doubles (the same harness
// shape as studio-draft-authority.test.ts): paige-browser, the image host, the model and the
// database are doubles. This is not runtime proof against the deployed host or Supabase.
import { readFileSync } from "node:fs";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import * as studioCaller from "../../supabase/functions/_shared/studio-caller.ts";
import { CHEESY_TELLS_AVOID } from "../../supabase/functions/_shared/cheesy-tells.ts";
import { pickPagePayload, pagePayloadBytes, validateRenderRequest, renderConfig } from "../../services/paige-browser/render.mjs";

const MINE = "11111111-1111-4111-8111-111111111111";
const THEIRS = "22222222-2222-4222-8222-222222222222";
const DELIVERABLE = "33333333-3333-4333-8333-333333333333";
const SESSION = "44444444-4444-4444-8444-444444444444";
const BROWSER = "https://paige-browser.test";
const BASE_ENV: Record<string, string> = { SUPABASE_URL: "https://db.test", SUPABASE_ANON_KEY: "anon", SUPABASE_SERVICE_ROLE_KEY: "service" };
const FLAG_ON = { ...BASE_ENV, STUDIO_VISUAL_CRITIQUE_ENABLED: "true" };
const WITH_BROWSER = { ...FLAG_ON, PAIGE_BROWSER_URL: `${BROWSER}/`, PAIGE_BROWSER_SECRET: "browser-secret" };
const BROWSER_FLAG_OFF = { ...BASE_ENV, PAIGE_BROWSER_URL: `${BROWSER}/`, PAIGE_BROWSER_SECRET: "browser-secret" };
const bearer = (role: string) => `h.${Buffer.from(JSON.stringify({ role, sub: "u1" })).toString("base64url")}.s`;

const JPEG_B64 = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 0xff, 0xd9]).toString("base64");
const slices = (n: number) => Array.from({ length: n }, (_, i) => ({ y: i * 1600, height: 1600, jpeg_base64: JPEG_B64 }));
const VERDICT = JSON.stringify({ verdict: "ITERATE", summary: "Hero lacks hierarchy.", blockers: [], should_fix: ["tighten the type ladder"], nits: [], cheesy_tells_hit: [], refined_prompt: "Make the hero headline dominant." });

interface Opts {
  env?: Record<string, string>;
  role?: string;
  authFails?: boolean;
  browser?: (body: Record<string, unknown>) => { status?: number; json?: unknown; throws?: boolean; text?: string };
  model?: { content?: string; needs_config?: boolean; throws?: boolean };
  insertError?: { message: string } | null;
  image?: { status?: number; type?: string; bytes?: number };
  throttleCount?: number;
  throttleError?: boolean;
  loopRows?: Array<{ verdict: string; capped?: boolean; cost_estimate_usd?: number }>;
  loopError?: boolean;
}

function run(body: Record<string, unknown>, o: Opts = {}) {
  const env = o.env ?? WITH_BROWSER;
  const seen = {
    envKeys: new Set<string>(),
    fetches: [] as Array<{ url: string; headers: Record<string, string>; body: Record<string, unknown> | null }>,
    model: [] as Array<{ content: Array<Record<string, unknown>>; opts: Record<string, unknown> }>,
    inserts: [] as Array<Record<string, unknown>>,
    reads: [] as Array<{ kind: "count" | "rows"; eqs: Array<[string, unknown]> }>,
    dnsChecks: 0,
  };
  const authed = {
    auth: { getUser: async () => (o.authFails ? { data: { user: null }, error: { message: "bad jwt" } } : { data: { user: { id: "u1" } }, error: null }) },
    rpc: async (fn: string) => {
      if (fn === "current_user_tenant_id") return { data: MINE, error: null };
      if (fn === "is_tenant_admin") return { data: true, error: null };
      return { data: null, error: null };
    },
    from: () => { throw new Error("the critique never reads tables on a person's client"); },
  };
  const service = {
    from: (table: string) => {
      const read = { kind: "rows" as "count" | "rows", eqs: [] as Array<[string, unknown]> };
      const q: Record<string, unknown> = {
        select: (_cols: string, opts?: { count?: string }) => { if (opts?.count) read.kind = "count"; seen.reads.push(read); return q; },
        eq: (c: string, v: unknown) => { read.eqs.push([c, v]); return q; },
        gte: () => q,
        limit: () => q,
        then: (ok: (v: unknown) => unknown, bad: (e: unknown) => unknown) => {
          const r = read.kind === "count"
            ? (o.throttleError ? { count: null, error: { message: "db down" } } : { count: o.throttleCount ?? 0, error: null })
            : (o.loopError ? { data: null, error: { message: "db down" } } : { data: o.loopRows ?? [], error: null });
          return Promise.resolve(r).then(ok, bad);
        },
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
    assertPublicHttpUrl: async (u: string) => { seen.dnsChecks++; if (u.includes("169.254")) throw new Error("blocked private host"); },
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
        if (r.throws) throw new Error("connect ECONNREFUSED");
        return new Response(r.text ?? JSON.stringify(r.json), { status: r.status ?? 200, headers: { "content-type": "application/json" } });
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
const browserCalls = (seen: { fetches: Array<{ url: string }> }) => seen.fetches.filter((f) => f.url.startsWith(BROWSER));

describe("both paths are gated by STUDIO_VISUAL_CRITIQUE_ENABLED", () => {
  it("flag off → status disabled, no paige-browser call, no row, no model", async () => {
    const { seen, res } = run({ render: { page: PAGE } }, { env: BROWSER_FLAG_OFF });
    const r = await res;
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ ok: false, status: "disabled" });
    expect(seen.fetches).toEqual([]);
    expect(seen.inserts).toEqual([]);
    expect(seen.model).toEqual([]);
  });

  it.each([["unset", BASE_ENV], ["off with the browser configured", BROWSER_FLAG_OFF], ["not exactly true", { ...BASE_ENV, STUDIO_VISUAL_CRITIQUE_ENABLED: "yes" }]])(
    "flag %s → the image_url path is disabled too: no image fetch, no throttle read, no model, no row", async (_label, env) => {
      const { seen, res } = run({ image_url: "https://img.test/a.png" }, { env });
      const r = await res;
      expect(r.status).toBe(200);
      expect(r.json).toMatchObject({ ok: false, status: "disabled" });
      expect(seen.fetches).toEqual([]);
      expect(seen.reads).toEqual([]);
      expect(seen.model).toEqual([]);
      expect(seen.inserts).toEqual([]);
      expect(seen.dnsChecks).toBe(0);
    });

  it("flag on → the image_url path critiques", async () => {
    const { res } = run({ image_url: "https://img.test/a.png" }, { env: FLAG_ON });
    expect((await res).json).toMatchObject({ ok: true, verdict: "ITERATE" });
  });
});

describe("pages render through paige-browser /render (flag on)", () => {
  it("sends the draft payload with the browser secret and maxSlices, critiques every slice, logs the verdict", async () => {
    const { seen, res } = run({ render: { page: PAGE }, brief: "a consulting landing page" });
    const r = await res;
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ ok: true, verdict: "ITERATE", logged: true, capture: { width: 1440, full_height: 4800, slices_sent: 3, slices_total: 3, truncated: false, viewport: "desktop" } });
    const call = seen.fetches.find((f) => f.url === `${BROWSER}/render`);
    expect(call?.headers["X-Browser-Secret"]).toBe("browser-secret");
    expect(call?.body).toEqual({ page: { blocks: PAGE.blocks, theme: PAGE.theme, brand: null, tenant_name: "Northwind" }, viewport: "desktop", maxSlices: 4 });
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
    const { seen, res } = run({ render: { url: "https://paigeagent.ai/p/northwind/home" } });
    expect((await res).json.ok).toBe(true);
    expect(seen.fetches[0].body).toEqual({ url: "https://paigeagent.ai/p/northwind/home", viewport: "desktop", maxSlices: 4 });
  });

  it("never reads the deleted visual-renderer settings", async () => {
    const { seen, res } = run({ render: { page: PAGE } });
    await res;
    expect([...seen.envKeys].filter((k) => k.startsWith("VISUAL_RENDERER"))).toEqual([]);
    expect(readFileSync(new URL("../../supabase/functions/studio-visual-critique/index.ts", import.meta.url), "utf8")).not.toMatch(/VISUAL_RENDERER_(URL|SECRET)/);
  });
});

describe("NO_VERDICT carries exactly one truthful reason code, stored and returned", () => {
  const cases: Array<[string, Record<string, unknown>, Opts, string, boolean]> = [
    ["renderer not configured", { render: { page: PAGE } }, { env: FLAG_ON }, "screenshot_service_unavailable", true],
    ["paige-browser unreachable", { render: { page: PAGE } }, { browser: () => ({ throws: true }) }, "screenshot_service_unavailable", false],
    ["paige-browser busy (429)", { render: { page: PAGE } }, { browser: () => ({ status: 429, json: { ok: false, reason: "busy" } }) }, "screenshot_service_unavailable", false],
    ["paige-browser 5xx / not JSON", { render: { page: PAGE } }, { browser: () => ({ status: 502, text: "<html>bad gateway</html>" }) }, "screenshot_service_unavailable", false],
    ["render ok:false (not_ready)", { render: { page: PAGE } }, { browser: () => ({ json: { ok: false, reason: "not_ready", error: "never signalled ready" } }) }, "render_failed", false],
    ["render crashed", { render: { page: PAGE } }, { browser: () => ({ json: { ok: false, reason: "render_crashed", error: "the page threw" } }) }, "render_failed", false],
    ["render refused (403 origin)", { render: { url: "https://example.com/" } }, { browser: () => ({ status: 403, json: { ok: false, reason: "origin_not_allowed", error: "not a Paige app origin" } }) }, "render_failed", false],
    ["render returned no slices", { render: { page: PAGE } }, { browser: () => ({ json: { ok: true, width: 1440, full_height: 10, slices: [] } }) }, "screenshot_unavailable", false],
    ["image fetch failed", { image_url: "https://img.test/a.png" }, { image: { status: 404 } }, "image_unavailable", false],
    ["vision model not configured", { render: { page: PAGE } }, { model: { needs_config: true } }, "critique_unavailable", true],
    ["vision model threw", { render: { page: PAGE } }, { model: { throws: true } }, "critique_failed", false],
    ["vision model reply unparseable", { image_url: "https://img.test/a.png" }, { model: { content: "I think it looks nice!" } }, "critique_failed", false],
  ];
  it.each(cases)("%s → %s", async (_label, body, opts, reason, needsConfig) => {
    const { seen, res } = run(body, opts);
    const r = await res;
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ ok: false, verdict: "NO_VERDICT", reason, needs_config: needsConfig, logged: true });
    expect(seen.inserts).toHaveLength(1);
    expect(seen.inserts[0]).toMatchObject({ verdict: "NO_VERDICT", low_confidence: false, capped: false });
    expect((seen.inserts[0].findings as { reason: string }).reason).toBe(reason);
  });

  it("a not_ready render keeps the page's own error in the logged detail", async () => {
    const { seen, res } = run({ render: { page: PAGE } }, { browser: () => ({ json: { ok: false, reason: "not_ready", error: "the page never signalled ready", page_errors: ["route chunk failed to load"] } }) });
    expect((await res).json).toMatchObject({ verdict: "NO_VERDICT", reason: "render_failed" });
    expect((seen.inserts[0].findings as { detail: string }).detail).toBe("not_ready: the page never signalled ready; page error: route chunk failed to load");
  });

  it("a critic failure is never dressed up as a SHIP", async () => {
    for (const model of [{ throws: true }, { content: "not json" }]) {
      const { seen, res } = run({ render: { page: PAGE } }, { model });
      const r = await res;
      expect(r.json.verdict).not.toBe("SHIP");
      expect(seen.inserts.every((i) => i.verdict !== "SHIP")).toBe(true);
    }
  });

  it("an unparseable reply still records the model and its estimated cost (the call happened)", async () => {
    const { seen, res } = run({ image_url: "https://img.test/a.png" }, { model: { content: "nope" } });
    expect((await res).json).toMatchObject({ cost_estimate_usd: 0.0123 });
    expect(seen.inserts[0]).toMatchObject({ model: "claude-test", cost_estimate_usd: 0.0123 });
  });

  it("a failed log insert is reported back, not swallowed", async () => {
    const { res } = run({ render: { page: PAGE } }, { insertError: { message: "violates check constraint studio_visual_critique_verdict_chk" } });
    const r = await res;
    expect(r.json).toMatchObject({ ok: true, verdict: "ITERATE", logged: false });
    expect(String(r.json.log_error)).toContain("studio_visual_critique_verdict_chk");
  });
});

describe("per-tenant throttle — before any work, never writes a row", () => {
  it.each([["render", { render: { page: PAGE } }], ["image_url", { image_url: "https://img.test/a.png" }]])(
    "%s: at the threshold → 429 throttled, no fetch, no model, no row", async (_l, body) => {
      const { seen, res } = run(body as Record<string, unknown>, { throttleCount: 12 });
      const r = await res;
      expect(r.status).toBe(429);
      expect(r.json).toMatchObject({ ok: false, status: "throttled" });
      expect(seen.fetches).toEqual([]);
      expect(seen.model).toEqual([]);
      expect(seen.inserts).toEqual([]);
      expect(seen.reads.find((x) => x.kind === "count")?.eqs).toEqual([["tenant_id", MINE]]);
    });

  it("one under the threshold still runs", async () => {
    const { res } = run({ image_url: "https://img.test/a.png" }, { throttleCount: 11 });
    expect((await res).json).toMatchObject({ ok: true });
  });

  it("the count failing → 503, fail closed, nothing run or recorded", async () => {
    const { seen, res } = run({ render: { page: PAGE } }, { throttleError: true });
    const r = await res;
    expect(r.status).toBe(503);
    expect(r.json).toMatchObject({ status: "throttle_unavailable" });
    expect(seen.fetches).toEqual([]);
    expect(seen.inserts).toEqual([]);
  });
});

describe("§33 caps use server-derived loop state, not the caller's word", () => {
  const ran = (n: number) => Array.from({ length: n }, () => ({ verdict: "ITERATE", cost_estimate_usd: 0.01 }));

  it("three critiques already ran for this deliverable → capped even when the caller claims iteration 0", async () => {
    const { seen, res } = run({ render: { page: PAGE }, deliverable_id: DELIVERABLE, session_id: SESSION, iteration: 0, spent_usd: 0 }, { loopRows: ran(3) });
    const r = await res;
    expect(r.json).toMatchObject({ ok: true, verdict: "SHIP", capped: true, iteration: 3 });
    expect(r.json.loop).toMatchObject({ iteration_claimed: 0, iteration_derived: 3, key: "deliverable_id" });
    expect(browserCalls(seen)).toEqual([]);
    expect(seen.model).toEqual([]);
    // Deliverable wins over session as the loop key.
    expect(seen.reads.find((x) => x.kind === "rows")?.eqs).toEqual([["tenant_id", MINE], ["deliverable_id", DELIVERABLE]]);
  });

  it("the summed estimated spend reaching the cost cap → capped even when the caller claims $0", async () => {
    const { res } = run({ image_url: "https://img.test/a.png", session_id: SESSION, spent_usd: 0 }, { loopRows: [{ verdict: "ITERATE", cost_estimate_usd: 1.5 }, { verdict: "NO_VERDICT", cost_estimate_usd: 0.6 }] });
    const r = await res;
    expect(r.json).toMatchObject({ capped: true });
    expect(r.json.loop).toMatchObject({ spent_derived: 2.1, key: "session_id", iteration_derived: 1 });
  });

  it.each(["abc", "", "-1", "NaN"])("a malformed cap env (%j) falls back to the defaults instead of switching the caps off", async (bad) => {
    const env = { ...WITH_BROWSER, STUDIO_CRITIQUE_MAX_ITERATIONS: bad, STUDIO_CRITIQUE_COST_CAP_USD: bad };
    const iter = await run({ image_url: "https://img.test/a.png", deliverable_id: DELIVERABLE }, { env, loopRows: ran(3) }).res;
    expect(iter.json).toMatchObject({ verdict: "SHIP", capped: true, iteration: 3 });
    const cost = await run({ image_url: "https://img.test/a.png", deliverable_id: DELIVERABLE }, { env, loopRows: [{ verdict: "ITERATE", cost_estimate_usd: 2 }] }).res;
    expect(cost.json).toMatchObject({ verdict: "SHIP", capped: true });
  });

  it("NO_VERDICT and capped rows are not counted as iterations", async () => {
    const { res } = run({ image_url: "https://img.test/a.png", deliverable_id: DELIVERABLE }, { loopRows: [{ verdict: "NO_VERDICT" }, { verdict: "NO_VERDICT" }, { verdict: "SHIP", capped: true }, { verdict: "BLOCK" }] });
    const r = await res;
    expect(r.json).toMatchObject({ ok: true, verdict: "ITERATE", iteration: 1 });
  });

  it("a higher claim is honoured (max of claimed and derived)", async () => {
    const { res } = run({ image_url: "https://img.test/a.png", deliverable_id: DELIVERABLE, iteration: 5 }, { loopRows: [] });
    expect((await res).json).toMatchObject({ capped: true, iteration: 5 });
  });

  it("without a loop key there is nothing to derive: the claim is used and no loop read happens", async () => {
    const { seen, res } = run({ image_url: "https://img.test/a.png", iteration: 1 });
    expect((await res).json).toMatchObject({ ok: true, iteration: 1 });
    expect(seen.reads.filter((x) => x.kind === "rows")).toEqual([]);
  });

  it("the loop read failing → 503, fail closed", async () => {
    const { seen, res } = run({ render: { page: PAGE }, deliverable_id: DELIVERABLE }, { loopError: true });
    expect((await res).status).toBe(503);
    expect(seen.inserts).toEqual([]);
    expect(browserCalls(seen)).toEqual([]);
  });
});

describe("inputs: refused before any network call, and only after the caller is known", () => {
  it.each([
    ["render.html (retired with the old renderer)", { render: { html: "<h1>x</h1>" } }, "render.html is no longer supported"],
    ["both page and url", { render: { page: PAGE, url: "https://paigeagent.ai/p/a/b" } }, "exactly one of page or url"],
    ["an unknown viewport", { render: { page: PAGE, viewport: "watch" } }, "render.viewport must be one of"],
    ["blocks that are not an array", { render: { page: { blocks: "hero" } } }, "blocks array"],
    ["image_url and render together", { image_url: "https://img.test/a.png", render: { page: PAGE } }, "not both"],
    ["a private render url", { render: { url: "https://169.254.169.254/latest" } }, "render.url rejected"],
    ["a funnel page payload", { render: { page: PAGE }, artifact_kind: "funnel" }, "landing pages only"],
    ["a form page payload", { render: { page: PAGE }, artifact_kind: "form" }, "landing pages only"],
    ["a funnel url", { render: { url: "https://paigeagent.ai/f/a/b" }, artifact_kind: "funnel" }, "landing pages only"],
  ])("refuses %s with a 400", async (_label, body, message) => {
    const { seen, res } = run(body as Record<string, unknown>);
    const r = await res;
    expect(r.status).toBe(400);
    expect(String(r.json.error)).toContain(message);
    expect(seen.fetches).toEqual([]);
    expect(seen.inserts).toEqual([]);
  });

  it("a funnel can still be critiqued from an image", async () => {
    const { res } = run({ image_url: "https://img.test/a.png", artifact_kind: "funnel" });
    expect((await res).json).toMatchObject({ ok: true });
  });

  it("an unauthenticated caller gets 401 — its render input is never parsed or DNS-checked", async () => {
    const { seen, res } = run({ render: { url: "https://169.254.169.254/latest", viewport: "watch" } }, { authFails: true });
    expect((await res).status).toBe(401);
    expect(seen.dnsChecks).toBe(0);
  });
});

describe("the page payload cap is the same byte count on both sides", () => {
  const cfg = renderConfig({});
  const page = (n: number) => ({ blocks: [{ type: "rich_text", html: "x".repeat(n) }] });
  const base = pagePayloadBytes(pickPagePayload(page(0)));
  it("exactly the cap: the edge forwards it AND paige-browser accepts it", async () => {
    const p = page(cfg.maxPayloadBytes - base);
    expect(pagePayloadBytes(pickPagePayload(p))).toBe(1_000_000);
    const { seen, res } = run({ render: { page: p } });
    await res;
    expect(browserCalls(seen)).toHaveLength(1);
    expect((await validateRenderRequest(seen.fetches[0].body, cfg)).ok).toBe(true);
  });
  it("one byte over: both refuse", async () => {
    const p = page(cfg.maxPayloadBytes - base + 1);
    const { seen, res } = run({ render: { page: p } });
    expect((await res).status).toBe(400);
    expect(browserCalls(seen)).toEqual([]);
    expect((await validateRenderRequest({ page: p }, cfg)).reason).toBe("payload_too_large");
  });
});

describe("§9 — the tenant a service-role caller names is the tenant everything carries", () => {
  it("logs AND traces the model call under the named tenant, and the throttle counts that tenant", async () => {
    const { seen, res } = run({ render: { page: PAGE }, tenant_id: THEIRS }, { role: "service_role" });
    expect((await res).status).toBe(200);
    expect(seen.inserts.map((i) => i.tenant_id)).toEqual([THEIRS]);
    expect(seen.model[0].opts).toMatchObject({ tenantId: THEIRS, actorRole: "operator", callerFunction: "studio-visual-critique" });
    expect(seen.reads.find((x) => x.kind === "count")?.eqs).toEqual([["tenant_id", THEIRS]]);
  });

  it("a JWT caller's model call carries the session's workspace", async () => {
    const { seen, res } = run({ render: { page: PAGE } });
    await res;
    expect(seen.model[0].opts).toMatchObject({ tenantId: MINE, actorRole: "tenant", actorUserId: "u1" });
  });
});
