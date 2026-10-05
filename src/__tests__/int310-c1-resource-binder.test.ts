/**
 * INT-310 C1 — the canonical resource binder (owner ruling, 2026-10-04).
 *
 * C0 stopped the unauthenticated/direct reach. C1 answers the second question: a correctly
 * authenticated Tenant A actor must not read a Tenant B resource by supplying its id. The binder
 * (`_shared/paige-orchestration/resource-binder.ts`, over the canonical `verifySubjectTenant`) ties
 * every caller-selected contact_id/client_id to the SERVER-RESOLVED tenant before any service-role
 * read, and every foreign/malformed/missing/disagreeing value becomes one indistinguishable
 * `resource_not_found` — no existence oracle.
 *
 * Part 1 is the binder's own matrix (pure, with a recording fake db).
 * Part 2 drives the REAL paige-orchestrator and subagent-email-composer handlers and asserts the
 * owner's negative matrix end to end: A+A works, A+B / Admin+B / Owner+B all refuse identically, a
 * workspace switch changes the result, malformed/missing refuse, and the mutation (dropping the
 * tenant binding) makes the foreign-contact test fail.
 */
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import ts from "typescript";

const root = join(__dirname, "..", "..");
const fnDir = join(root, "supabase/functions");

const SERVICE = "svc-role-c1-key";
const ANON = "eyJ.anon.key";
const TENANT_A = "aaaaaaaa-1111-4000-8000-0000000000aa";
const TENANT_B = "bbbbbbbb-1111-4000-8000-0000000000bb";
const CONTACT_A = "11111111-aaaa-4000-8000-0000000000a1"; // owned by TENANT_A
const CONTACT_B = "22222222-bbbb-4000-8000-0000000000b2"; // owned by TENANT_B
const USER_A = "99999999-0000-4000-8000-0000000000a9";    // a plain member of TENANT_A
const ADMIN_A = "99999999-0000-4000-8000-0000000000ad";   // an admin of TENANT_A
const OWNER_A = "99999999-0000-4000-8000-0000000000ae";   // the owner of TENANT_A
const PEOPLE = new Set([USER_A, ADMIN_A, OWNER_A]);

// ───────────────────────── Part 1: the binder in isolation ─────────────────────────
// Transpile the binder (ESM → CJS) and load it with its one relative import (subject-tenant) real.
function loadModule(absEntry: string): Record<string, unknown> {
  const cache = new Map<string, Record<string, unknown>>();
  const load = (abs: string): Record<string, unknown> => {
    if (cache.has(abs)) return cache.get(abs)!;
    const out = ts.transpileModule(readFileSync(abs, "utf8"), {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
    }).outputText;
    const mod = { exports: {} as Record<string, unknown> };
    cache.set(abs, mod.exports);
    const req = (spec: string) => {
      if (spec.startsWith(".")) return load(resolve(dirname(abs), spec));
      throw new Error(`unexpected import ${spec}`);
    };
    new Function("require", "module", "exports", out)(req, mod, mod.exports);
    cache.set(abs, mod.exports);
    return mod.exports;
  };
  return load(absEntry);
}

const binder = loadModule(join(fnDir, "_shared/paige-orchestration/resource-binder.ts")) as {
  bindContactToTenant: (
    db: unknown, tenantId: string | null, input: unknown, context: unknown,
  ) => Promise<{ ok: true; contactId: string | null } | { ok: false; status: number; error: string }>;
  applyBoundContact: (
    input: Record<string, unknown>, context: Record<string, unknown>, id: string | null,
  ) => { input: Record<string, unknown>; context: Record<string, unknown> };
  collectContactSelectors: (i: unknown, c: unknown) => unknown[];
};

// clients rows keyed by id → owning tenant; the fake records every (id, tenant_id) filter pair.
function fakeDb(rows: Record<string, string>, opts: { throwOn?: string } = {}) {
  const calls: Array<Record<string, unknown>> = [];
  return {
    calls,
    from(table: string) {
      const f: Record<string, unknown> = { table };
      const chain = {
        select() { return chain; },
        eq(col: string, val: string) { f[col] = val; return chain; },
        limit() {
          calls.push({ ...f });
          if (opts.throwOn && f.id === opts.throwOn) return Promise.resolve({ data: null, error: { message: "boom" } });
          const owner = rows[f.id as string];
          const ok = owner !== undefined; // row exists
          return Promise.resolve({ data: ok ? [{ tenant_id: owner }] : [], error: null });
        },
      };
      return chain;
    },
  };
}

describe("INT-310 C1 — binder matrix", () => {
  const rows = { [CONTACT_A]: TENANT_A, [CONTACT_B]: TENANT_B };

  it("A actor + A contact → ok, bound to the same id", async () => {
    const db = fakeDb(rows);
    const r = await binder.bindContactToTenant(db, TENANT_A, { contact_id: CONTACT_A }, {});
    expect(r).toEqual({ ok: true, contactId: CONTACT_A });
    // verifySubjectTenant reads the row's REAL owner by id, then compares it to the claimed tenant.
    expect(db.calls[0]).toMatchObject({ table: "clients", id: CONTACT_A });
  });

  it("A actor + B contact → resource_not_found (404)", async () => {
    const r = await binder.bindContactToTenant(fakeDb(rows), TENANT_A, { contact_id: CONTACT_B }, {});
    expect(r).toEqual({ ok: false, status: 404, error: "resource_not_found" });
  });

  it("a non-existent id → the SAME refusal as a foreign id (no existence oracle)", async () => {
    const miss = await binder.bindContactToTenant(fakeDb(rows), TENANT_A, { contact_id: "33333333-cccc-4000-8000-0000000000c3" }, {});
    const foreign = await binder.bindContactToTenant(fakeDb(rows), TENANT_A, { contact_id: CONTACT_B }, {});
    expect(miss).toEqual(foreign);
  });

  it("malformed id → refused before any db call", async () => {
    const db = fakeDb(rows);
    const r = await binder.bindContactToTenant(db, TENANT_A, { contact_id: "not-a-uuid" }, {});
    expect(r).toMatchObject({ ok: false, error: "resource_not_found" });
    expect(db.calls).toEqual([]);
  });

  it("input.contact_id and context.contact_id disagreeing → refused before any db call", async () => {
    const db = fakeDb(rows);
    const r = await binder.bindContactToTenant(db, TENANT_A, { contact_id: CONTACT_A }, { contact_id: CONTACT_B });
    expect(r).toMatchObject({ ok: false, error: "resource_not_found" });
    expect(db.calls).toEqual([]);
  });

  it("input.client_id is a selector too, and binds like contact_id", async () => {
    const db = fakeDb(rows);
    const r = await binder.bindContactToTenant(db, TENANT_A, { client_id: CONTACT_A }, {});
    expect(r).toEqual({ ok: true, contactId: CONTACT_A });
  });

  it("no selector → ok with null (nothing to bind), no db call", async () => {
    const db = fakeDb(rows);
    const r = await binder.bindContactToTenant(db, TENANT_A, { intent: "x" }, {});
    expect(r).toEqual({ ok: true, contactId: null });
    expect(db.calls).toEqual([]);
  });

  it("a selector but NO workspace to bind to → refused before any db call", async () => {
    const db = fakeDb(rows);
    const r = await binder.bindContactToTenant(db, null, { contact_id: CONTACT_A }, {});
    expect(r).toMatchObject({ ok: false, error: "resource_not_found" });
    expect(db.calls).toEqual([]);
  });

  it("a lookup error is reported distinctly (503), never as a hidden success", async () => {
    const db = fakeDb(rows, { throwOn: CONTACT_A });
    const r = await binder.bindContactToTenant(db, TENANT_A, { contact_id: CONTACT_A }, {});
    expect(r).toEqual({ ok: false, status: 503, error: "resource_verification_unavailable" });
  });

  it("applyBoundContact rewrites input.contact_id, input.client_id and context.contact_id to the bound id", () => {
    const { input, context } = binder.applyBoundContact(
      { contact_id: "x", client_id: "y", intent: "keep" }, { contact_id: "x", user_id: "u" }, CONTACT_A,
    );
    expect(input).toEqual({ contact_id: CONTACT_A, client_id: CONTACT_A, intent: "keep" });
    expect(context).toEqual({ contact_id: CONTACT_A, user_id: "u" });
  });
});

// ───────────────────────── Part 2: real handlers, owner negative matrix ─────────────────────────
interface H {
  handler: (r: Request) => Promise<Response>;
  from: string[];
  eqCalls: Array<[string, string]>;
  /** Every outbound call the function made (the orchestrator → specialist hop), with its parsed body. */
  fetches: Array<{ url: string; body: { input?: Record<string, unknown>; context?: Record<string, unknown> } }>;
}

/** rows: clients id→tenant. memberships: user→tenants they belong to. activeTenant: profiles.active_tenant_id. */
function loadEdge(
  fn: string,
  world: { rows: Record<string, string>; activeTenant?: string | null; memberOf?: string[]; tenantRpcFails?: boolean },
  stubs: Record<string, unknown> = {},
  mutate: Record<string, (s: string) => string> = {},
): H {
  const h = { from: [], eqCalls: [], fetches: [] } as unknown as H;
  const fakeFetch = async (url: string, init?: { body?: string }) => {
    h.fetches.push({ url: String(url), body: init?.body ? JSON.parse(init.body) : {} });
    return new Response(JSON.stringify({ ok: true, verdict: "approved" }), { status: 200 });
  };
  const makeClient = (_u: string, _k: string, opts?: { global?: { headers?: Record<string, string> } }) => {
    const fwd = opts?.global?.headers?.Authorization ?? "";
    const person = fwd.replace(/^Bearer\s+/, "");
    const isUserA = PEOPLE.has(person);
    const chain = (table: string): unknown => {
      const f: Record<string, string> = {};
      const c: Record<string, unknown> = {
        select: () => c,
        eq: (col: string, val: string) => { f[col] = val; h.eqCalls.push([col, val]); return c; },
        limit: () => resolveRead(table, f),
        maybeSingle: () => resolveRead(table, f).then((r) => ({ data: (r.data as unknown[])[0] ?? null, error: r.error })),
        order: () => c,
        or: () => c,
        is: () => c,
        in: () => c,
        neq: () => c,
        insert: () => c,
        update: () => c,
        single: () => resolveRead(table, f).then((r) => ({ data: (r.data as unknown[])[0] ?? null, error: r.error })),
        then: (res: (v: unknown) => void) => resolveRead(table, f).then(res),
      };
      return c;
    };
    const resolveRead = (table: string, f: Record<string, string>) => {
      if (table === "clients") {
        const owner = world.rows[f.id];
        const row = owner !== undefined && (!("tenant_id" in f) || f.tenant_id === owner) ? [{ id: f.id, tenant_id: owner, first_name: "X", last_name: "Y" }] : [];
        return Promise.resolve({ data: row, error: null });
      }
      if (table === "tenant_members") {
        const member = (world.memberOf ?? []).includes(f.tenant_id) && PEOPLE.has(f.user_id);
        return Promise.resolve({ data: member ? [{ tenant_id: f.tenant_id }] : [], error: null });
      }
      if (table === "profiles") return Promise.resolve({ data: [{ active_tenant_id: world.activeTenant ?? null }], error: null });
      if (table === "tenants") return Promise.resolve({ data: [{ name: "Acme", brand: { sender_name: "Acme" } }], error: null });
      // A neutral (non-finance) local agent, so the §2 funding opt-in gate does not hide it.
      if (table === "paige_subagents" && f.slug === "ops-helper") {
        return Promise.resolve({ data: [{ slug: "ops-helper", name: "Ops Helper", domain: "operations", description: "",
          runtime: "local", edge_function: "subagent-data-consistency", enabled: true, tenant_id: null, config: {} }], error: null });
      }
      return Promise.resolve({ data: [], error: null });
    };
    return {
      from: (t: string) => { h.from.push(t); return chain(t); },
      rpc: async (name: string) => {
        if (name === "verify_cron_token") return { data: false, error: null };
        if (name === "current_user_tenant_id" && isUserA) {
          return world.tenantRpcFails ? { data: null, error: { message: "db unavailable" } } : { data: world.activeTenant ?? null, error: null };
        }
        if (name === "get_paige_persona_context" && isUserA) return { data: [{ tenant_id: world.activeTenant ?? null, funding_enabled: false }], error: null };
        return { data: null, error: null };
      },
      auth: { getUser: async (tok?: string) => {
        const t = tok ?? fwd.replace(/^Bearer\s+/, "");
        return PEOPLE.has(t) ? { data: { user: { id: t } }, error: null } : { data: { user: null }, error: { message: "no sub" } };
      } },
      storage: { from: () => ({ download: async () => ({ data: null, error: { message: "none" } }) }) },
    };
  };
  const supa = { createClient: makeClient };
  const env: Record<string, string> = { SUPABASE_URL: "https://x.supabase.co", SUPABASE_SERVICE_ROLE_KEY: SERVICE, SUPABASE_ANON_KEY: ANON };
  const Deno = {
    env: { get: (k: string) => env[k] },
    serve: (fnh: H["handler"]) => { h.handler = fnh; },
  };
  const cache = new Map<string, unknown>();
  const load = (abs: string): unknown => {
    if (cache.has(abs)) return cache.get(abs);
    let src = readFileSync(abs, "utf8");
    const rel = abs.slice(fnDir.length + 1);
    if (mutate[rel]) { const b = src; src = mutate[rel](src); if (src === b) throw new Error(`mutation ${rel} matched nothing`); }
    const out = ts.transpileModule(src, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
    const mod = { exports: {} as Record<string, unknown> };
    cache.set(abs, mod.exports);
    const req = (spec: string): unknown => {
      if (spec.endsWith("/cors")) return { corsHeaders: {} };
      if (spec.startsWith("npm:@supabase/supabase-js") || spec.includes("esm.sh/@supabase/supabase-js")) return supa;
      if (spec.startsWith(".")) { const t = resolve(dirname(abs), spec); const k = t.slice(fnDir.length + 1); return (k in stubs) ? stubs[k] : load(t); }
      throw new Error(`unmapped ${spec} in ${rel}`);
    };
    new Function("require", "module", "exports", "Deno", "fetch", out)(req, mod, mod.exports, Deno, fakeFetch);
    cache.set(abs, mod.exports);
    return mod.exports;
  };
  load(join(fnDir, fn, "index.ts"));
  if (!h.handler) throw new Error(`${fn} no handler`);
  return h;
}

const post = (body: unknown, token: string) =>
  new Request("https://x.supabase.co/functions/v1/x", {
    method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify(body),
  });

const ORCH_STUBS = {
  "_shared/model-router.ts": { routedChatCompletion: async () => ({}), pickRoute: () => ({}), isJobKind: () => true, JOB_KINDS: [], DEFAULT_SUBAGENT_JOB_KIND: "internal_first_draft" },
};
const invokeAgent = (contactId: string) => ({ action: "tool_invoke", slug: "ops-helper", input: { contact_id: contactId } });

describe("INT-310 C1 — orchestrator binds a selected contact to the server-resolved tenant", () => {
  const rows = { [CONTACT_A]: TENANT_A, [CONTACT_B]: TENANT_B };

  // Register `fundability` (local) so tool_invoke resolves an agent; its edge call will 404 on the
  // fake fetch, but we only assert the binding decision, which happens first.
  const world = { rows, activeTenant: TENANT_A, memberOf: [TENANT_A] };

  it("A actor + A contact → passes binding (reaches sub-agent resolution)", async () => {
    const h = loadEdge("paige-orchestrator", world, ORCH_STUBS);
    const res = await h.handler(post({ ...invokeAgent(CONTACT_A), context: { tenant_id: TENANT_B } }, USER_A));
    expect(res.status).toBe(200);
    // The specialist receives the ONE bound id and the SERVER-RESOLVED tenant — a caller-supplied
    // context.tenant_id (TENANT_B here) never survives.
    const call = h.fetches.find((x) => x.url.endsWith("/functions/v1/subagent-data-consistency"));
    expect(call?.body.input).toMatchObject({ contact_id: CONTACT_A });
    expect(call?.body.context).toMatchObject({ contact_id: CONTACT_A, tenant_id: TENANT_A });
  });

  it("A actor + B contact → 404 resource_not_found, no sub-agent resolved", async () => {
    const h = loadEdge("paige-orchestrator", world, ORCH_STUBS);
    const res = await h.handler(post(invokeAgent(CONTACT_B), USER_A));
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: "resource_not_found" });
    expect(h.from).not.toContain("paige_subagents");
    expect(h.fetches).toEqual([]);
  });

  it("the A+B refusal is byte-identical for a plain member, an admin and an owner of A", async () => {
    // Three DISTINCT people of tenant A. The binder keys on the resource's tenant, never the caller's
    // role, so how much power someone holds in A buys no reach into B: the refusal bodies match exactly.
    const seen: string[] = [];
    for (const who of [USER_A, ADMIN_A, OWNER_A]) {
      const h = loadEdge("paige-orchestrator", world, ORCH_STUBS);
      const res = await h.handler(post(invokeAgent(CONTACT_B), who));
      expect(res.status).toBe(404);
      expect(h.from).not.toContain("paige_subagents");
      seen.push(await res.text());
    }
    expect(new Set(seen).size).toBe(1);
    expect(JSON.parse(seen[0])).toMatchObject({ error: "resource_not_found" });
  });

  it("malformed and missing ids get the same response as a foreign id", async () => {
    const bodies: string[] = [];
    for (const id of [CONTACT_B, "not-a-uuid", "33333333-cccc-4000-8000-0000000000c3"]) {
      const h = loadEdge("paige-orchestrator", world, ORCH_STUBS);
      const res = await h.handler(post(invokeAgent(id), USER_A));
      expect(res.status).toBe(404);
      bodies.push(await res.text());
    }
    expect(new Set(bodies).size).toBe(1);
  });

  it("input.contact_id disagreeing with context.contact_id → refused", async () => {
    const h = loadEdge("paige-orchestrator", world, ORCH_STUBS);
    const res = await h.handler(post({ ...invokeAgent(CONTACT_A), context: { contact_id: CONTACT_B } }, USER_A));
    expect(res.status).toBe(404);
    expect(h.from).not.toContain("paige_subagents");
  });

  it("same user, active workspace B → the SAME B contact now binds and passes", async () => {
    const hB = loadEdge("paige-orchestrator", { rows, activeTenant: TENANT_B, memberOf: [TENANT_A, TENANT_B] }, ORCH_STUBS);
    const res = await hB.handler(post(invokeAgent(CONTACT_B), USER_A));
    expect(res.status).toBe(200);
    const call = hB.fetches.find((x) => x.url.endsWith("/functions/v1/subagent-data-consistency"));
    expect(call?.body.context).toMatchObject({ contact_id: CONTACT_B, tenant_id: TENANT_B });
  });

  it("mutation proof: not forwarding the tenant makes the A+B foreign read succeed", async () => {
    const h = loadEdge("paige-orchestrator", world, ORCH_STUBS, {
      // Neutralise the binder call so the selector is no longer bound to the resolved tenant.
      "paige-orchestrator/index.ts": (s) =>
        s.replace("const binding = await bindContactToTenant(supabase, tenantId, payload.input ?? {}, ctx);",
                  "const binding = { ok: true, contactId: (payload.input as { contact_id?: string })?.contact_id ?? null } as const;"),
    });
    const res = await h.handler(post(invokeAgent(CONTACT_B), USER_A));
    // Without the binder the foreign selector reaches the specialist — the exact defect.
    expect(res.status).toBe(200);
    expect(h.fetches.some((x) => x.body.input?.contact_id === CONTACT_B)).toBe(true);
  });
});

const EMAIL_STUBS = {
  "_shared/claude.ts": { gatewayCompat: async () => ({ ok: false, status: 502, text: async () => "stubbed" }) },
  "_shared/attachment-extract.ts": { ATTACHMENT_SOURCE_INSTRUCTION: "", bytesToBase64: () => "", extractAttachmentText: async () => "", },
};
const compose = (contactId: string) => ({ input: { intent: "reach out", contact_id: contactId } });

describe("INT-310 C1 — email-composer binds the contact to the caller's own workspace", () => {
  const rows = { [CONTACT_A]: TENANT_A, [CONTACT_B]: TENANT_B };
  const world = { rows, activeTenant: TENANT_A, memberOf: [TENANT_A] };

  it("the anon key (no verified user) is refused 401 before any read", async () => {
    const h = loadEdge("subagent-email-composer", world, EMAIL_STUBS);
    const res = await h.handler(post(compose(CONTACT_A), ANON));
    expect(res.status).toBe(401);
    expect(h.from).not.toContain("clients");
  });

  it("a verified A user + A contact → bound to A, proceeds (gateway stub ends it after the read)", async () => {
    const h = loadEdge("subagent-email-composer", world, EMAIL_STUBS);
    const res = await h.handler(post(compose(CONTACT_A), USER_A));
    expect(h.eqCalls).toContainEqual(["tenant_id", TENANT_A]);
    expect(await res.json().catch(() => ({}))).not.toMatchObject({ error: "resource_not_found" });
  });

  it("a verified A user + B contact → 404 resource_not_found, the clients row never read", async () => {
    const h = loadEdge("subagent-email-composer", world, EMAIL_STUBS);
    const res = await h.handler(post(compose(CONTACT_B), USER_A));
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: "resource_not_found" });
  });
});

describe("INT-310 C1 — email-composer: internal path, compliance hand-off, workspace switch", () => {
  const rows = { [CONTACT_A]: TENANT_A, [CONTACT_B]: TENANT_B };
  // A model stub that returns a real draft, so the composer goes on to the compliance hand-off.
  const DRAFTING = {
    ...EMAIL_STUBS,
    "_shared/claude.ts": { gatewayCompat: async () => new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify({ subject: "Hello", body: "A short note." }) } }],
    }), { status: 200 }) },
  };

  it("internal caller + trusted tenant A + A contact → drafts, and compliance gets the SAME tenant", async () => {
    const h = loadEdge("subagent-email-composer", { rows }, DRAFTING);
    const res = await h.handler(post({ ...compose(CONTACT_A), context: { contact_id: CONTACT_A, tenant_id: TENANT_A } }, SERVICE));
    expect(res.status).toBe(200);
    const review = h.fetches.find((x) => x.url.endsWith("/functions/v1/subagent-compliance"));
    expect(review?.body.context).toMatchObject({ contact_id: CONTACT_A, tenant_id: TENANT_A });
  });

  it("internal caller + trusted tenant A + B contact → refused before any draft or hand-off", async () => {
    const h = loadEdge("subagent-email-composer", { rows }, DRAFTING);
    const res = await h.handler(post({ ...compose(CONTACT_B), context: { contact_id: CONTACT_B, tenant_id: TENANT_A } }, SERVICE));
    expect(res.status).toBe(404);
    expect(h.fetches).toEqual([]);
  });

  it("internal caller with NO trusted tenant + a contact → refused (nothing to bind to)", async () => {
    const h = loadEdge("subagent-email-composer", { rows }, DRAFTING);
    const res = await h.handler(post(compose(CONTACT_A), SERVICE));
    expect(res.status).toBe(404);
  });

  it("a person's workspace switch changes the result for the same contact", async () => {
    const inA = loadEdge("subagent-email-composer", { rows, activeTenant: TENANT_A, memberOf: [TENANT_A, TENANT_B] }, DRAFTING);
    expect((await inA.handler(post(compose(CONTACT_B), USER_A))).status).toBe(404);
    const inB = loadEdge("subagent-email-composer", { rows, activeTenant: TENANT_B, memberOf: [TENANT_A, TENANT_B] }, DRAFTING);
    expect((await inB.handler(post(compose(CONTACT_B), USER_A))).status).toBe(200);
  });

  it("a failure resolving the person's workspace is a 503, not a not-found", async () => {
    const h = loadEdge("subagent-email-composer", { rows, activeTenant: TENANT_A, memberOf: [TENANT_A], tenantRpcFails: true }, DRAFTING);
    const res = await h.handler(post(compose(CONTACT_A), USER_A));
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ error: "resource_verification_unavailable" });
  });

  it("a caller-supplied context.tenant_id does not override a person's own workspace", async () => {
    const h = loadEdge("subagent-email-composer", { rows, activeTenant: TENANT_A, memberOf: [TENANT_A] }, DRAFTING);
    const res = await h.handler(post({ ...compose(CONTACT_B), context: { contact_id: CONTACT_B, tenant_id: TENANT_B } }, USER_A));
    expect(res.status).toBe(404);
  });

  it("mutation proof: binding to a caller-supplied tenant instead of the server-resolved one leaks B", async () => {
    const h = loadEdge("subagent-email-composer", { rows, activeTenant: TENANT_A, memberOf: [TENANT_A] }, DRAFTING, {
      "subagent-email-composer/index.ts": (s) =>
        s.replace(`      workspaceTenant = typeof t === "string" ? t : null;
    } catch (e) {`, `      workspaceTenant = (payload.context?.tenant_id as string) ?? (typeof t === "string" ? t : null);
    } catch (e) {`),
    });
    const res = await h.handler(post({ ...compose(CONTACT_B), context: { contact_id: CONTACT_B, tenant_id: TENANT_B } }, USER_A));
    expect(res.status).toBe(200);
  });
});

describe("INT-310 C1 — specialists bind their own read to the trusted tenant (defense in depth)", () => {
  const rows = { [CONTACT_A]: TENANT_A, [CONTACT_B]: TENANT_B };
  const body = (contactId: string, tenant?: string) => ({ input: { contact_id: contactId }, context: { contact_id: contactId, ...(tenant ? { tenant_id: tenant } : {}) } });
  const SPEC_STUBS = { "_shared/claude.ts": EMAIL_STUBS["_shared/claude.ts"] };

  for (const fn of ["subagent-data-consistency", "subagent-intake-concierge", "subagent-stack-strategist", "subagent-funding-path", "subagent-fundability", "subagent-content-drafter"]) {
    it(`${fn}: service caller with NO trusted tenant → 404 before the clients read`, async () => {
      const h = loadEdge(fn, { rows }, SPEC_STUBS);
      const res = await h.handler(post(body(CONTACT_A), SERVICE));
      expect(res.status).toBe(404);
      expect(h.from).not.toContain("clients");
    });
    it(`${fn}: trusted tenant A + B contact → the read is bound to A and finds nothing (404)`, async () => {
      const h = loadEdge(fn, { rows }, SPEC_STUBS);
      const res = await h.handler(post(body(CONTACT_B, TENANT_A), SERVICE));
      expect(h.eqCalls).toContainEqual(["tenant_id", TENANT_A]);
      expect(res.status).toBe(404);
    });
  }

  it("subagent-compliance: with a contact and no trusted tenant → 404; A + B contact → contact not found", async () => {
    const h1 = loadEdge("subagent-compliance", { rows });
    expect((await h1.handler(post({ ...body(CONTACT_A), input: { contact_id: CONTACT_A, draft_text: "x" } }, SERVICE))).status).toBe(404);
    const h2 = loadEdge("subagent-compliance", { rows });
    const r2 = await h2.handler(post({ input: { contact_id: CONTACT_B, draft_text: "x" }, context: { contact_id: CONTACT_B, tenant_id: TENANT_A } }, SERVICE));
    expect(h2.eqCalls).toContainEqual(["tenant_id", TENANT_A]);
    expect(JSON.stringify(await r2.json())).toContain("not found");
  });

  it("mutation proof: dropping a specialist's tenant predicate lets A read B's row", async () => {
    const h = loadEdge("subagent-data-consistency", { rows }, SPEC_STUBS, {
      "subagent-data-consistency/index.ts": (s) => s.replace('.eq("tenant_id", trustedTenant)', ""),
    });
    const res = await h.handler(post(body(CONTACT_B, TENANT_A), SERVICE));
    expect(res.status).not.toBe(404);
  });
});

describe("INT-310 C1 — paige-problem-reverse-engineer is orchestrator-only and tenant-bound", () => {
  const rows = { [CONTACT_A]: TENANT_A, [CONTACT_B]: TENANT_B };
  const PRE_STUBS = { "_shared/claude.ts": EMAIL_STUBS["_shared/claude.ts"] };
  const body = (tenant?: string) => ({ input: { problem_statement: "why is X failing", contact_id: CONTACT_B }, context: tenant ? { tenant_id: tenant } : {} });

  it("anon-role JWT → 401 before any read", async () => {
    const h = loadEdge("paige-problem-reverse-engineer", { rows }, PRE_STUBS);
    expect((await h.handler(post(body(TENANT_A), ANON))).status).toBe(401);
    expect(h.from).toEqual([]);
  });
  it("an ordinary signed-in user (no direct consumer exists) → 401", async () => {
    const h = loadEdge("paige-problem-reverse-engineer", { rows }, PRE_STUBS);
    expect((await h.handler(post(body(TENANT_A), USER_A))).status).toBe(401);
  });
  it("service caller with a contact but no trusted tenant → 404, no read", async () => {
    const h = loadEdge("paige-problem-reverse-engineer", { rows }, PRE_STUBS);
    expect((await h.handler(post(body(), SERVICE))).status).toBe(404);
    expect(h.from).not.toContain("clients");
  });
  it("service caller, tenant A, B contact → the contact read is bound to A", async () => {
    const h = loadEdge("paige-problem-reverse-engineer", { rows }, PRE_STUBS);
    await h.handler(post(body(TENANT_A), SERVICE));
    expect(h.eqCalls).toContainEqual(["tenant_id", TENANT_A]);
  });
});
