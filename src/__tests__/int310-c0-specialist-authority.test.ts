/**
 * INT-310 C0 / INT-313 — containment of the privileged specialist paths (owner ruling, 2026-10-04).
 *
 * The defect: seven deployed `subagent-*` functions read canonical client data with the SERVICE ROLE
 * and had no caller check of their own, so the gateway's verify_jwt — which the public anon key and
 * any user JWT pass — was the only "authority" in front of a cross-tenant lookup by caller-chosen id.
 * paige-orchestrator's tool_invoke accepted an anon-role JWT as a caller, and subagent-forge honoured
 * agent-origin semantics (body tenant_id + actor_user_id) on a header any client can set.
 *
 * The fix reuses the canonical internal-caller verifier (`isAuthorizedInternalCaller`,
 * _shared/systems-check-http.ts — exact service-role bearer or a verified cron token).
 *
 * This suite runs the REAL handlers (and the real verifier) against a recording fake database: a
 * refusal is proven by the status AND by the database never being touched. Each guard carries a
 * mutation proof — restoring the weak authority condition must turn the matching assertion red.
 */
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import ts from "typescript";
import * as nodeUtil from "node:util";
import { draftClaimedAction } from "../../supabase/functions/paige-action-worker/draft.ts";

const root = join(__dirname, "..", "..");
const fnDir = join(root, "supabase/functions");

const SERVICE = "svc-role-test-key";
const ANON = "eyJ.anon-role.public-key";
const USER_JWT = "eyJ.authenticated.user-a";
const CRON = "cron-token-valid";
const CONTACT = "05fa1630-d579-402e-a598-3c26d719e6ab";
const USER_A = "aaaaaaaa-0000-4000-8000-00000000000a";
const TENANT_A = "aaaaaaaa-1111-4000-8000-0000000000aa";

interface Harness {
  handler: (req: Request) => Promise<Response>;
  from: string[];
  writes: string[];
  rpc: string[];
}

/** A chainable stand-in for a supabase-js client. Every .from() is recorded (and every write
 *  verb), every query resolves to "no row", and auth.getUser resolves a person ONLY for USER_JWT. */
function fakeSupabase(h: Harness, cronValid: boolean) {
  return {
    createClient: (_url: string, _key: string, opts?: { global?: { headers?: Record<string, string> } }) => {
      const fwd = opts?.global?.headers?.Authorization ?? "";
      const chain = (table: string): unknown =>
        new Proxy(
          {},
          {
            get(_t, prop) {
              if (prop === "then") return (res: (v: unknown) => void) => res({ data: null, error: null });
              if (["insert", "update", "upsert", "delete"].includes(String(prop))) h.writes.push(table);
              return () => chain(table);
            },
          },
        );
      return {
        from: (table: string) => {
          h.from.push(table);
          return chain(table);
        },
        rpc: async (name: string) => {
          h.rpc.push(name);
          if (name === "verify_cron_token") return { data: cronValid, error: null };
          if (name === "get_paige_persona_context" && fwd === `Bearer ${USER_JWT}`) {
            return { data: [{ tenant_id: TENANT_A, funding_enabled: false }], error: null };
          }
          if (name === "current_user_tenant_id" && fwd === `Bearer ${USER_JWT}`) return { data: TENANT_A, error: null };
          return { data: null, error: null };
        },
        auth: {
          getUser: async (tok?: string) => {
            const t = tok ?? fwd.replace(/^Bearer\s+/, "");
            return t === USER_JWT
              ? { data: { user: { id: USER_A } }, error: null }
              : { data: { user: null }, error: { message: "invalid claim: missing sub claim" } };
          },
        },
      };
    },
  };
}

// Cache only compilation TEXT, never modules, authority, fixtures or results. Every
// original/mutated source has its own key; each load still constructs fresh modules
// and injected ports. Bound repeated compilation of the shared Fabric/registry
// graph without caching any runtime or authorization decision.
const compiledSource = new Map<string, string>();

/** Load an edge function's REAL source (transpiled) with Deno + npm/URL imports stubbed and every
 *  relative import loaded for real, unless named in `stubs`. `mutate` rewrites one file's source. */
function loadEdge(
  fn: string,
  opts: { cronValid?: boolean; stubs?: Record<string, unknown>; mutate?: Record<string, (s: string) => string>; database?: () => unknown } = {},
): Harness {
  const h = { from: [], writes: [], rpc: [] } as unknown as Harness;
  const supa = opts.database ? { createClient: opts.database } : fakeSupabase(h, opts.cronValid ?? false);
  const env: Record<string, string> = {
    SUPABASE_URL: "https://example.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: SERVICE,
    SUPABASE_ANON_KEY: ANON,
  };
  const Deno = { env: { get: (k: string) => env[k] }, serve: (fnh: Harness["handler"]) => { h.handler = fnh; } };
  const cache = new Map<string, unknown>();
  const load = (abs: string): unknown => {
    if (cache.has(abs)) return cache.get(abs);
    let src = readFileSync(abs, "utf8");
    // Fixture dictionaries use portable paths. Windows separators previously
    // skipped the requested mutations/stubs and tested the original handler.
    const rel = abs.slice(fnDir.length + 1).replace(/\\/g, "/");
    if (opts.mutate?.[rel]) {
      const before = src;
      src = opts.mutate[rel](src);
      if (src === before) throw new Error(`mutation for ${rel} matched nothing`);
    }
    const compileKey = `${abs}\0${src}`;
    const out = compiledSource.get(compileKey) ?? ts.transpileModule(src, {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
    }).outputText;
    compiledSource.set(compileKey, out);
    const mod = { exports: {} as Record<string, unknown> };
    cache.set(abs, mod.exports);
    const req = (spec: string): unknown => {
      if (spec === "node:util") return nodeUtil;
      if (spec.endsWith("/cors")) return { corsHeaders: {} };
      if (spec.startsWith("npm:@supabase/supabase-js") || spec.includes("esm.sh/@supabase/supabase-js")) return supa;
      if (spec.startsWith(".")) {
        const target = resolve(dirname(abs), spec);
        const key = target.slice(fnDir.length + 1).replace(/\\/g, "/");
        if (opts.stubs && key in opts.stubs) return opts.stubs[key];
        return load(target);
      }
      throw new Error(`unmapped import ${spec} in ${rel}`);
    };
    new Function("require", "module", "exports", "Deno", out)(req, mod, mod.exports, Deno);
    cache.set(abs, mod.exports);
    return mod.exports;
  };
  load(join(fnDir, fn, "index.ts"));
  if (!h.handler) throw new Error(`${fn} registered no Deno.serve handler`);
  return h;
}

const post = (body: unknown, headers: Record<string, string> = {}) =>
  new Request("https://example.supabase.co/functions/v1/x", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });

const STUBS = { "_shared/claude.ts": { gatewayCompat: () => { throw new Error("model not called in tests"); } } };

// The seven deployed, internal-only specialists. Prod paige_subagents (queried 2026-10-04) registers none
// of them — its only `local` rows are email-composer, problem-reverse-engineer and deep-research — so their
// only callers are the orchestrator (service role) and email-composer's compliance review (service role).
// RESIDUAL until INT-310 C1: email-composer itself is still directly reachable and relays a caller-chosen
// contact_id to compliance under its own service bearer; this gate cannot see through that relay. The
// relay test below proves only that the call is service-authenticated, NOT that the contact is in scope.
const SPECIALISTS = [
  "subagent-compliance",
  "subagent-content-drafter",
  "subagent-data-consistency",
  "subagent-fundability",
  "subagent-funding-path",
  "subagent-intake-concierge",
  "subagent-stack-strategist",
];
// context.tenant_id is the server-resolved tenant the orchestrator forwards (INT-310 C1); C0 tests the
// caller-authority gate in front of the lookup, so the fixture carries it like the real caller does.
const specialistBody = {
  input: { contact_id: CONTACT, draft_text: "hello", intent: "x" },
  context: { contact_id: CONTACT, tenant_id: TENANT_A },
};

describe("INT-310 C0 — internal-only specialists refuse every non-internal caller before any lookup", () => {
  for (const fn of SPECIALISTS) {
    describe(fn, () => {
      it("anon-role JWT (the public key) → 401, database untouched", async () => {
        const h = loadEdge(fn, { stubs: STUBS });
        const res = await h.handler(post(specialistBody, bearer(ANON)));
        expect(res.status).toBe(401);
        expect(h.from).toEqual([]);
        expect(h.writes).toEqual([]);
      });
      it("an ordinary signed-in user's JWT → 401, database untouched", async () => {
        const h = loadEdge(fn, { stubs: STUBS });
        const res = await h.handler(post(specialistBody, bearer(USER_JWT)));
        expect(res.status).toBe(401);
        expect(h.from).toEqual([]);
      });
      it("a spoofed X-Orchestrator-Call header does not stand in for authority", async () => {
        const h = loadEdge(fn, { stubs: STUBS });
        const res = await h.handler(post(specialistBody, { ...bearer(USER_JWT), "X-Orchestrator-Call": "1" }));
        expect(res.status).toBe(401);
        expect(h.from).toEqual([]);
      });
      it("an invalid cron token → 401", async () => {
        const h = loadEdge(fn, { stubs: STUBS, cronValid: false });
        const res = await h.handler(post(specialistBody, { ...bearer(ANON), "x-cron-token": "nope" }));
        expect(res.status).toBe(401);
        expect(h.from).toEqual([]);
      });
      it("the canonical service-role caller still reaches the specialist's lookup", async () => {
        const h = loadEdge(fn, { stubs: STUBS });
        const res = await h.handler(post(specialistBody, bearer(SERVICE)));
        expect(res.status).not.toBe(401);
        expect(h.from).toContain("clients");
      });
    });
  }

  it("a verified cron token is accepted (the canonical verifier's second internal credential)", async () => {
    const h = loadEdge("subagent-fundability", { cronValid: true });
    const res = await h.handler(post(specialistBody, { ...bearer(ANON), "x-cron-token": CRON }));
    expect(res.status).not.toBe(401);
    expect(h.rpc).toContain("verify_cron_token");
  });

  it("email-composer → compliance (the one specialist-to-specialist call) sends the service bearer", () => {
    const src = readFileSync(join(fnDir, "subagent-email-composer/index.ts"), "utf8");
    const call = src.slice(src.indexOf("/functions/v1/subagent-compliance"), src.indexOf("signal: AbortSignal.timeout(8000)"));
    expect(call).toContain("Authorization: `Bearer ${SERVICE_ROLE_KEY}`");
  });

  describe("mutation proofs — the weak authority condition turns the guard red", () => {
    it("removing the specialist's gate lets the anon key reach the service-role clients lookup", async () => {
      const h = loadEdge("subagent-fundability", {
        mutate: {
          "subagent-fundability/index.ts": (s) =>
            s.replace("if (!(await isAuthorizedInternalCaller(req, adminClient())))", "if (false)"),
        },
      });
      const res = await h.handler(post(specialistBody, bearer(ANON)));
      expect(res.status).not.toBe(401);
      expect(h.from).toContain("clients");
    });
    it("weakening the verifier to 'any bearer' lets an anon-role JWT through", async () => {
      const h = loadEdge("subagent-data-consistency", {
        mutate: {
          "_shared/systems-check-http.ts": (s) =>
            s.replace("bearer.length > 0 && bearer === service", "bearer.length > 0"),
        },
      });
      const res = await h.handler(post(specialistBody, bearer(ANON)));
      expect(res.status).not.toBe(401);
      expect(h.from).toContain("clients");
    });
  });
});

// paige-orchestrator imports the model router; its routing is irrelevant to the authority gate.
const ORCH_STUBS = {
  "_shared/model-router.ts": {
    routedChatCompletion: async () => ({}),
    pickRoute: () => ({}),
    isJobKind: () => true,
    JOB_KINDS: [],
    DEFAULT_SUBAGENT_JOB_KIND: "internal_first_draft",
  },
};
// No contact selector: C0 asserts WHO may invoke; contact binding is C1's suite (int310-c1-resource-binder).
const invoke = { action: "tool_invoke", slug: "email-composer", input: { intent: "x" } };

// Exercise the REAL whole handler and canonical capability recorder. Only the
// database/model transports are synthetic; no provider or production record.
function durableSpecialist(options: { insert?: "error" | "invalid"; update?: "error" | "missing" | "mismatch" | "wrong-id" | "throw"; receipt?: "error" | "throw"; runtimeThrows?: boolean; actorlessWorker?: boolean } = {}) {
  const id = "cccccccc-2222-4222-8222-222222222222";
  const rows: Record<string, unknown>[] = [];
  const rpc = vi.fn(async (_name: string, ..._args: unknown[]) => {
    if (options.receipt === "throw") throw new Error("synthetic receipt disconnect");
    return { data: true, error: options.receipt === "error" ? { message: "synthetic receipt refusal" } : null };
  });
  const model = vi.fn(async () => {
    if (options.runtimeThrows) throw new Error("synthetic model interruption");
    return { choices: [{ message: { content: "Synthetic planning draft" } }] };
  });
  const database = () => ({
    auth: { getUser: async () => ({ data: { user: { id: USER_A } }, error: null }) },
    rpc: async (name: string, ...args: unknown[]) => name === "get_paige_persona_context"
      ? { data: [{ tenant_id: TENANT_A, funding_enabled: false }], error: null }
      : name === "is_tenant_admin_as" ? { data: true, error: null }
      : name === "agency_can_manage_child" ? { data: false, error: null } : rpc(name, ...args),
    from(table: string) {
      let mode = "read", patch: Record<string, unknown> = {};
      const result = () => {
        if (table === "paige_subagents") return { data: { id: CONTACT, version: 1, slug: "zion", name: "ZION", runtime: "soft", domain: "operations", enabled: true, system_prompt: "Synthetic registered instructions", config: {}, tenant_id: null }, error: null };
        if (table === "user_roles") return { data: [], error: null };
        if (table === "tenant_members") return { data: { role: "owner" }, error: null };
        if (mode === "insert") return { data: options.insert === "error" ? null : { id: options.insert === "invalid" ? "not-a-work-identity" : id }, error: options.insert === "error" ? { message: "synthetic insert failure" } : null };
        if (options.update === "throw") throw new Error("synthetic lost update response");
        return { data: options.update === "missing" ? null : { id: options.update === "wrong-id" ? CONTACT : id, status: options.update === "mismatch" ? "pending" : patch.status }, error: options.update === "error" ? { message: "synthetic update failure" } : null };
      };
      const chain = {
        select: () => chain, eq: () => chain, or: () => chain, is: () => chain, limit: () => chain,
        insert: (row: Record<string, unknown>) => { mode = "insert"; rows.push(row); return chain; },
        update: (row: Record<string, unknown>) => { mode = "update"; patch = row; return chain; },
        single: async () => result(), maybeSingle: async () => result(),
        then: (resolve: (value: unknown) => void) => Promise.resolve(result()).then(resolve),
      };
      return chain;
    },
  });
  const h = loadEdge("paige-orchestrator", { database, stubs: { ...ORCH_STUBS,
    "_shared/model-router.ts": { ...ORCH_STUBS["_shared/model-router.ts"], pickRoute: () => ({ tier: "classification" }), routedChatCompletion: model },
    "_shared/model-fabric.ts": { fabricCompletion: async (_request: unknown, options: { beforeProviderAttempt: () => Promise<boolean> }) => {
      if (!await options.beforeProviderAttempt()) return { ok: false, error: { failure: "caller_refused" } };
      return { ok: true, response: await model() };
    } },
  } });
  const run = (body: unknown = { action: "tool_invoke", slug: "zion", input: { request: "Synthetic read-only plan" }, context: { user_id: "forged-actor" } }) => h.handler(post(body, bearer(options.actorlessWorker ? SERVICE : USER_JWT)));
  return { id, rows, rpc, model, run };
}

describe("EXP05 original specialist durable outcome", () => {
  it.each(["error", "invalid"] as const)("cannot dispatch when original invocation insert is %s", async insert => {
    const h = durableSpecialist({ insert }); const r = await h.run();
    expect(r.status).toBe(503); expect(await r.json()).toMatchObject({ ok: false, not_applied: true });
    expect(h.model).not.toHaveBeenCalled(); expect(h.rpc).not.toHaveBeenCalled();
  });
  it.each(["error", "missing", "mismatch", "wrong-id", "throw"] as const)("a %s original outcome acknowledgment is unknown, never completed or retried", async update => {
    const h = durableSpecialist({ update }); const r = await h.run(); const body = await r.json();
    expect(body).toMatchObject({ ok: false, outcome_unknown: true, invocation_id: h.id });
    expect(body).not.toHaveProperty("result"); expect(h.model).toHaveBeenCalledOnce(); expect(h.rpc).not.toHaveBeenCalled();
  });
  it.each(["error", "throw"] as const)("a %s at the canonical receipt does not become verified completion", async receipt => {
    const h = durableSpecialist({ receipt }); const r = await h.run();
    expect(await r.json()).toMatchObject({ ok: false, outcome_unknown: true, invocation_id: h.id, outcome_recorded: true, receipt_unverified: true });
    expect(h.model).toHaveBeenCalledOnce(); expect(h.rpc).toHaveBeenCalledOnce();
  });
  it("verified completion retains the original actor, invocation and canonical receipt", async () => {
    const h = durableSpecialist(); const r = await h.run();
    expect(r.status).toBe(200); expect(await r.json()).toMatchObject({ ok: true, invocation_id: h.id, receipt_recorded: true });
    expect(h.rows[0]).toMatchObject({ invoked_by: USER_A, tenant_id: TENANT_A, subagent_slug: "zion" });
    expect(h.model).toHaveBeenCalledOnce(); expect(h.rpc).toHaveBeenCalledOnce();
  });
  it("a confirmed runtime refusal retains its failed outcome and original receipt", async () => {
    const h = durableSpecialist({ runtimeThrows: true }); const r = await h.run();
    expect(r.status).toBe(502); expect(await r.json()).toMatchObject({ ok: false, receipt_recorded: true, invocation_id: h.id });
    expect(h.rpc.mock.calls[0][1]).toMatchObject({ _run_id: h.id, _actor_id: USER_A, _tenant_id: TENANT_A, _outcome: "capability_failed" });
    expect(h.model).toHaveBeenCalledOnce();
  });
  it("the original actorless ActionBus draft remains usable without an invented actor or receipt", async () => {
    const h = durableSpecialist({ actorlessWorker: true }), advance = vi.fn(async () => ({ error: null }));
    const result = await draftClaimedAction({ rpc: advance, invoke: async request => {
      const response = await h.run(request), body = await response.json();
      expect(body).toMatchObject({ ok: true, invocation_id: h.id, receipt_recorded: false });
      return { httpOk: response.ok, status: response.status, body };
    } }, { id: CONTACT, tenant_id: TENANT_A, action_kind: "owner.synthetic_plan", contact_id: null,
      conversation_id: null, title: "Synthetic bounded draft", summary: null, payload: {}, draft_subagent_slug: "zion" });
    expect(result).toMatchObject({ kind: "drafted", invocationId: h.id });
    expect(h.rows[0]).toMatchObject({ invoked_by: null, tenant_id: TENANT_A });
    expect(h.rpc).not.toHaveBeenCalled(); expect(h.model).toHaveBeenCalledOnce();
    expect(advance).toHaveBeenCalledWith("advance_action", expect.objectContaining({ p_invocation_id: h.id, p_tenant_id: TENANT_A }));
  });
});

describe("INT-310 C0 — paige-orchestrator tool_invoke needs a real actor", () => {
  it("anon-role JWT (no verified person) → 401 before any sub-agent is resolved", async () => {
    const h = loadEdge("paige-orchestrator", { stubs: ORCH_STUBS });
    const res = await h.handler(post(invoke, bearer(ANON)));
    expect(res.status).toBe(401);
    expect(h.from).not.toContain("paige_subagents");
    expect(h.from).not.toContain("paige_subagent_invocations");
  });
  it("a body claiming actorless-service authority cannot promote an anonymous caller", async () => {
    const h = loadEdge("paige-orchestrator", { stubs: ORCH_STUBS });
    const res = await h.handler(post({ ...invoke, slug: "zion", actorlessService: true, isService: true, tenant_id: TENANT_A }, bearer(ANON)));
    expect(res.status).toBe(401); expect(h.from).not.toContain("paige_subagents");
    expect(h.from).not.toContain("paige_subagent_invocations");
  });
  it("a verified signed-in person still proceeds to sub-agent resolution", async () => {
    const h = loadEdge("paige-orchestrator", { stubs: ORCH_STUBS });
    const res = await h.handler(post(invoke, bearer(USER_JWT)));
    expect(res.status).not.toBe(401);
    expect(h.from).toContain("paige_subagents");
  });
  it("the canonical service caller still proceeds", async () => {
    const h = loadEdge("paige-orchestrator", { stubs: ORCH_STUBS });
    const res = await h.handler(post({ ...invoke, tenant_id: null }, bearer(SERVICE)));
    expect(res.status).not.toBe(401);
    expect(h.from).toContain("paige_subagents");
  });
  it("read-only roster listing is unchanged for an anon-role caller (out of C0 scope)", async () => {
    const h = loadEdge("paige-orchestrator", { stubs: ORCH_STUBS });
    const res = await h.handler(post({ action: "list_subagents" }, bearer(ANON)));
    expect(res.status).toBe(200);
  });
  it("mutation proof: dropping the actor requirement lets the anon key invoke", async () => {
    const h = loadEdge("paige-orchestrator", {
      stubs: ORCH_STUBS,
      mutate: {
        "paige-orchestrator/index.ts": (s) =>
          s.replace('if (!isService && !callerId) return fail("Authentication required", 401);', ""),
      },
    });
    const res = await h.handler(post(invoke, bearer(ANON)));
    expect(res.status).not.toBe(401);
    expect(h.from).toContain("paige_subagents");
  });
});

const FORGE_STUBS = { "_shared/model-router.ts": ORCH_STUBS["_shared/model-router.ts"] };
const victimPropose = {
  action: "propose",
  slug: "planted-agent",
  name: "Planted",
  domain: "ops",
  description: "x",
  rationale: "x",
  runtime: "soft",
  system_prompt: "x",
  tenant_id: "bbbbbbbb-1111-4000-8000-0000000000bb",
};

describe("INT-313 — subagent-forge: X-Orchestrator-Call is a signal, never authority", () => {
  for (const [who, tok] of [["anon-role JWT", ANON], ["ordinary user JWT", USER_JWT]] as const) {
    it(`${who} + forged X-Orchestrator-Call: 1 → 403 before anything is read or written`, async () => {
      const h = loadEdge("subagent-forge", { stubs: FORGE_STUBS });
      const res = await h.handler(post(victimPropose, { ...bearer(tok), "X-Orchestrator-Call": "1" }));
      expect(res.status).toBe(403);
      expect(h.from).toEqual([]);
      expect(h.writes).toEqual([]);
    });
  }
  it("the canonical service caller keeps agent-origin semantics (chat / MCP / orchestrator)", async () => {
    const h = loadEdge("subagent-forge", { stubs: FORGE_STUBS });
    const res = await h.handler(post({ action: "list", tenant_id: TENANT_A }, { ...bearer(SERVICE), "X-Orchestrator-Call": "1" }));
    expect(res.status).toBe(200);
    expect(h.from).toContain("paige_subagent_proposals");
  });
  it("a signed-in person without the header keeps the ordinary forge path", async () => {
    const h = loadEdge("subagent-forge", { stubs: FORGE_STUBS });
    const res = await h.handler(post({ action: "list" }, bearer(USER_JWT)));
    expect(res.status).not.toBe(403);
  });
  it("mutation proof: trusting the header again lets a user JWT reach the forge with a victim tenant", async () => {
    const h = loadEdge("subagent-forge", {
      stubs: FORGE_STUBS,
      mutate: {
        "subagent-forge/index.ts": (s) =>
          s.replace("if (claimsAgentOrigin && !(await isAuthorizedInternalCaller(req, adminClient())))", "if (false)"),
      },
    });
    const res = await h.handler(post(victimPropose, { ...bearer(USER_JWT), "X-Orchestrator-Call": "1" }));
    expect(res.status).not.toBe(403);
    expect(h.from.length).toBeGreaterThan(0);
  });
});
