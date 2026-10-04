/**
 * INT-308 — the orchestrator trusted-actor boundary (P0 hotfix ruling, 2026-10-04).
 *
 * The defect: `ctx = { ...payload.context, user_id: payload.context?.user_id ?? callerId }`
 * let a NON-SERVICE caller's body override the verified JWT identity — and local agents are
 * then invoked with the SERVICE ROLE, so the forged id flowed into attribution (invoked_by)
 * and into delegated engines (#1705's adapter maps context.user_id → the canonical user_id,
 * from which paige-deep-research resolves tenant lineage server-side).
 *
 * The fix: buildTrustedContext — ONE downstream context derived after authentication.
 *   • JWT/anon: user_id IS the verified callerId; a supplied value is ignored + warned.
 *   • Service-role: a named acting user under a resolved tenant must PROVE active
 *     membership (fail-closed 403 on tenant A + tenant B's user); malformed actor → 400.
 *
 * This suite extracts the REAL buildTrustedContext from source and runs the ruling's full
 * negative matrix (§6 A–K), the trusted positive paths (§7), the Deep-Research chain
 * regression (§8 — orchestrator trusted actor → #1705 adapter → engine user_id stay
 * identical), and the mutation proof (§6: restoring the vulnerable assignment MUST fail).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import ts from "typescript";

const root = join(__dirname, "..", "..");
const orchPath = join(root, "supabase/functions/paige-orchestrator/index.ts");
const enginePath = join(root, "supabase/functions/paige-deep-research/index.ts");
const source = readFileSync(orchPath, "utf8");
const engineSource = readFileSync(enginePath, "utf8");

const js = (body: string) =>
  ts.transpileModule(body, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;

/** Extract a named async function's full text via the TypeScript AST — a brace walk
 *  would truncate at the first `{` inside a return-type annotation (this function's
 *  Promise<{…} | {…}> type), so the parser is the only precise extractor. */
const extractFn = (src: string, name: string): string => {
  const sf = ts.createSourceFile("fn.ts", src, ts.ScriptTarget.ES2022, true);
  let found: string | null = null;
  const walk = (n: ts.Node) => {
    if (ts.isFunctionDeclaration(n) && n.name?.text === name) found = n.getText(sf);
    n.forEachChild(walk);
  };
  walk(sf);
  if (!found) throw new Error(`${name} not found`);
  return found;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const A = "aaaaaaaa-0000-4000-8000-00000000000a"; // JWT caller, tenant A member
const B = "bbbbbbbb-0000-4000-8000-00000000000b"; // another user (same or foreign tenant)
const TENANT_A = "aaaaaaaa-1111-4000-8000-0000000000aa";
const TENANT_B = "bbbbbbbb-1111-4000-8000-0000000000bb";

/** A chainable in-memory stand-in for the service client's tenant_members query.
 *  .eq() arguments are RECORDED so the filter shape (user_id/tenant_id/status-active
 *  — the exact columns the real proof filters on) is pinned, not just the row result. */
const makeSupabase = (rows: unknown[] = [], err: unknown = null) => {
  const q: Record<string, unknown> = { data: rows, error: err, eqCalls: [] as unknown[][] };
  const chain: Record<string, unknown> = {};
  for (const m of ["select", "limit", "or", "is", "maybeSingle"]) {
    q[m] = (..._args: unknown[]) => chain;
  }
  q["eq"] = (...args: unknown[]) => { (q.eqCalls as unknown[][]).push(args); return chain; };
  Object.assign(chain, q);
  return { from: (_t: string) => chain };
};

type Ctx = { user_id?: string; contact_id?: string; conversation_id?: string };
type Scope = { tenantId: string | null; callerId: string | null; isService: boolean };
type BuildResult = { ctx: Ctx } | { error: string; status: number };

const build = async (fnText: string, payloadCtx: Ctx, scope: Scope, memberRows: unknown[] = []): Promise<BuildResult> => {
  // two-stage eval: the outer call binds the stubs (the function body's free variables
  // close over these parameters), the returned function is the real builder.
  const outer = new Function("supabase", "UUID_RE", "console", js(`return (${fnText});`)) as unknown as
    (sb: unknown, re: unknown, log: unknown) => (p: { context?: Ctx }, s: Scope) => Promise<BuildResult>;
  return outer(makeSupabase(memberRows), UUID_RE, { warn() {} })({ context: payloadCtx }, scope);
};

const realFn = extractFn(source, "buildTrustedContext");

describe("INT-308 §6 — the negative matrix (JWT callers cannot forge identity)", () => {
  const jwt = (callerId: string | null) => ({ tenantId: TENANT_A, callerId, isService: false });

  it("A: no supplied context.user_id → downstream user_id = the verified caller", async () => {
    const r = await build(realFn, {}, jwt(A));
    expect("ctx" in r && r.ctx.user_id).toBe(A);
  });

  it("B: caller supplies their OWN id → downstream remains the verified caller", async () => {
    const r = await build(realFn, { user_id: A }, jwt(A));
    expect("ctx" in r && r.ctx.user_id).toBe(A);
  });

  it("C: caller supplies ANOTHER member's id (same tenant) → downstream must NOT impersonate", async () => {
    const r = await build(realFn, { user_id: B }, jwt(A));
    expect("ctx" in r && r.ctx.user_id).toBe(A);
  });

  it("D: caller supplies a FOREIGN tenant's user id → downstream must NOT receive that identity", async () => {
    const r = await build(realFn, { user_id: B }, jwt(A));
    expect("ctx" in r && r.ctx.user_id).toBe(A);
  });

  it("E: malformed user_id cannot affect downstream identity", async () => {
    for (const bad of ["not-a-uuid", "", 42, { injection: true }]) {
      const r = await build(realFn, { user_id: bad as unknown as string }, jwt(A));
      expect("ctx" in r && r.ctx.user_id).toBe(A);
    }
  });

  it("anon caller (no verified user) → downstream carries NO user_id, whatever the body claims", async () => {
    const r = await build(realFn, { user_id: B }, jwt(null));
    expect("ctx" in r && r.ctx.user_id).toBeUndefined();
  });

  it("F: invocation attribution is built from the trusted ctx (invoked_by cannot be forged)", () => {
    expect(source).toContain("invoked_by: ctx.user_id ?? null");
    expect(source).toContain("const trusted = await buildTrustedContext(payload, scope);");
    expect(source).toContain('if ("error" in trusted) return fail(trusted.error, trusted.status);');
    // the raw caller context is never spread into a downstream context again
    expect(source).not.toContain("user_id: payload.context?.user_id ?? callerId");
  });

  it("H: soft-agent invocations receive (and deliberately ignore) the SAME trusted context — nothing to forge", () => {
    // invokeSoft's context param is unused by design (matrix H: identity reaches the seam
    // verified; the soft runtime does not consume it today). Pin the seam exists:
    expect(source).toMatch(/async function invokeSoft\([\s\S]{0,200}_context: OrchestratorRequest\["context"\]/);
  });

  it("I: langgraph dispatch forwards the trusted context (same object, no re-derivation)", () => {
    expect(source).toContain("body: JSON.stringify({ graph, input, context })");
    expect(source).toContain("body: JSON.stringify({ input, context })"); // invokeLocal envelope
    expect(source).toContain("invokeLocal(agent.edge_function, payload.input ?? {}, ctx)");
  });

  it("J/K: agent scoping is unchanged — platform defaults or THIS tenant's own, from the trusted tenantId", () => {
    expect(source).toContain("invQ = tenantId ? invQ.or(`tenant_id.is.null,tenant_id.eq.${tenantId}`) : invQ.is(\"tenant_id\", null);");
  });
});

describe("INT-308 §2/§7 — trusted service-role callers, with the actor/tenant association proof", () => {
  const svc = (tenantId: string | null) => ({ tenantId, callerId: null, isService: true });

  it("positive: canonical service caller (PAIGE chat) names the acting user of its resolved tenant → forwarded", async () => {
    const sb = makeSupabase([{ tenant_id: TENANT_A }]);
    // two-stage eval: the outer call binds the stubs, the returned function is the real builder
    const outer = new Function("supabase", "UUID_RE", "console", js(`return (${realFn});`)) as unknown as
      (sb: unknown, re: unknown, log: unknown) => (p: { context?: Ctx }, s: ReturnType<typeof svc>) => Promise<{ ctx: Ctx } | { error: string; status: number }>;
    const fn = outer(sb, UUID_RE, { warn() {} });
    const r = await fn({ context: { user_id: A, conversation_id: "c1" } }, svc(TENANT_A));
    expect("ctx" in r && r.ctx.user_id).toBe(A);
    expect("ctx" in r && r.ctx.conversation_id).toBe("c1");
    // the association proof filters EXACTLY these columns: user_id, tenant_id, status='active'
    expect((sb.from("") as Record<string, unknown>)["eqCalls"]).toEqual([
      ["user_id", A], ["tenant_id", TENANT_A], ["status", "active"],
    ]);
  });

  it("fail-closed: tenant A + tenant B's user is refused (403), never forwarded", async () => {
    const r = await build(realFn, { user_id: B }, svc(TENANT_A), []); // B has no active membership in A
    expect("error" in r && r.status).toBe(403);
  });

  it("fail-closed with the exact refusal state (the stub models the no-row class the status filter produces)", async () => {
    const r = await build(realFn, { user_id: B }, svc(TENANT_A), []);
    expect("error" in r && r.status).toBe(403);
    expect("error" in r && r.error).toContain("not a member");
  });

  it("malformed acting user from an internal caller → 400, not garbage downstream", async () => {
    const r = await build(realFn, { user_id: "garbage" }, svc(TENANT_A));
    expect("error" in r && r.status).toBe(400);
  });

  it("service caller with NO resolved tenant forwards the named actor (platform-default path, unchanged)", async () => {
    const r = await build(realFn, { user_id: A }, svc(null));
    expect("ctx" in r && r.ctx.user_id).toBe(A);
  });

  it("service caller naming no actor forwards none (no invented identity)", async () => {
    const r = await build(realFn, {}, svc(TENANT_A));
    expect("ctx" in r && r.ctx.user_id).toBeUndefined();
  });

  it("a member-read ERROR propagates (throws) rather than fail-open", async () => {
    const outer = new Function("supabase", "UUID_RE", "console", js(`return (${realFn});`)) as unknown as
      (sb: unknown, re: unknown, log: unknown) => (p: { context?: Ctx }, s: ReturnType<typeof svc>) => Promise<unknown>;
    const fn = outer(makeSupabase([], { message: "db down" }), UUID_RE, { warn() {} });
    await expect(fn({ context: { user_id: A } }, svc(TENANT_A))).rejects.toThrow("db down");
  });
});

describe("INT-308 §6 mutation proof — restoring the vulnerable assignment MUST fail the matrix", () => {
  const mutated = realFn.replace(
    "user_id: scope.callerId ?? undefined",
    "user_id: payload.context?.user_id ?? scope.callerId ?? undefined",
  );
  expect(mutated).not.toBe(realFn); // the mutation actually applied

  it("matrix C/D go red under the mutation (impersonation succeeds → test fails)", async () => {
    const r = await build(mutated, { user_id: B }, { tenantId: TENANT_A, callerId: A, isService: false });
    expect("ctx" in r && r.ctx.user_id).toBe(B); // the vulnerability, demonstrated…
  });
  it("…which the REAL code prevents (the load-bearing inverse)", async () => {
    const r = await build(realFn, { user_id: B }, { tenantId: TENANT_A, callerId: A, isService: false });
    expect("ctx" in r && r.ctx.user_id).toBe(A);
  });
});

describe("INT-308 §8 — the delegated Deep-Research chain stays identity-true", () => {
  const engineBlock = (() => {
    const start = engineSource.indexOf("// ── INT-305: delegated-specialist envelope normalization");
    const end = engineSource.indexOf("const question = typeof body.question", start);
    expect(start).toBeGreaterThan(-1);
    return engineSource.slice(start, end);
  })();
  const engineNormalize = (fixture: unknown): Record<string, unknown> =>
    (new Function("body", js(`return (function (body) {\n${engineBlock}\nreturn body;\n})(body);`)) as (b: unknown) => Record<string, unknown>)(fixture);

  it("tenant-A caller injecting tenant B's UUID: the orchestrator drops it, the adapter never sees it", async () => {
    // 1. the orchestrator boundary: verified caller A wins
    const trusted = await build(realFn, { user_id: B }, { tenantId: TENANT_A, callerId: A, isService: false });
    const ctx = "ctx" in trusted ? trusted.ctx : undefined as never;
    expect(ctx.user_id).toBe(A);
    // 2. the envelope the orchestrator would post to a local agent — carries ONLY the trusted id
    const envelope = { input: { question: "q" }, context: ctx };
    // 3. the #1705 engine adapter maps context.user_id → the canonical user_id
    const mapped = engineNormalize(envelope);
    expect(mapped.user_id).toBe(A);
    expect(mapped.user_id).not.toBe(B);
  });

  it("the engine still resolves lineage SERVER-SIDE only (no caller-supplied tenant authority) — M0 canonical", () => {
    // the engine's own §9 block (pinned in deep-research-int305-entry-contract) stays authority;
    // this hotfix adds no tenant parameter anywhere on the chain:
    expect(engineBlock).not.toMatch(/tenant_id|expected_tenant/);
    expect(source).not.toMatch(/expected_tenant_id/);
  });
});
