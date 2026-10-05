/**
 * INT-310 — the workflow direct-dispatch allowlist (owner ruling, 2026-10-05).
 *
 * `_shared/workflowDispatch.ts` invokes a `direct_edge_function` target with the SERVICE-ROLE bearer and
 * a body shaped by whoever queued the run (registry rows via paige-mcp register_workflow; run rows via RLS inserts or the action bus). That
 * bearer passes every internal-caller gate (INT-310 C0) and lets the body name its own tenant (C1's
 * internal path), so an unlisted target is a confused deputy. Only allowlisted targets may be dispatched;
 * the allowlist is empty until a target is reviewed to derive tenant/actor server-side.
 *
 * Runs the REAL dispatcher (transpiled, Deno/fetch/supabase stubbed) and asserts both the result and that
 * no outbound call was made. Mutation proof: putting a target on the allowlist lets the service-bearer
 * call through — so the allowlist is the thing doing the stopping.
 */
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import ts from "typescript";
import { isOrchestratorLocalAgentFunctionAllowed, isServiceDispatchDirectFunctionAllowed } from "../../supabase/functions/_shared/marketplace-authority-containment";

const fnDir = join(__dirname, "..", "..", "supabase/functions");
const SERVICE = "svc-role-dispatch-key";

function loadDispatcher(mutate?: (s: string) => string) {
  const fetches: Array<{ url: string; auth: string }> = [];
  const updates: Array<Record<string, unknown>> = [];
  const supa = {
    createClient: () => ({
      from: () => {
        const c: Record<string, unknown> = {};
        const self = () => c;
        Object.assign(c, {
          select: self, eq: self,
          update: (patch: Record<string, unknown>) => { updates.push(patch); return c; },
          maybeSingle: async () => ({ data: null, error: null }),
          then: (res: (v: unknown) => void) => res({ data: null, error: null }),
        });
        return c;
      },
    }),
  };
  const fakeFetch = async (url: string, init?: { headers?: Record<string, string> }) => {
    fetches.push({ url: String(url), auth: init?.headers?.Authorization ?? "" });
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  };
  const Deno = { env: { get: (k: string) => ({ SUPABASE_URL: "https://x.supabase.co", SUPABASE_SERVICE_ROLE_KEY: SERVICE } as Record<string, string>)[k] } };
  const stubs: Record<string, unknown> = {
    "_shared/railAutomation.ts": { contactHintsFromPayload: () => ({ contactId: null, email: null, phone: null }), emitAutomationRail: async () => {} },
    "_shared/platform-operator-tenant.ts": { platformOperatorTenantId: async () => null },
  };
  const cache = new Map<string, unknown>();
  const load = (abs: string): unknown => {
    if (cache.has(abs)) return cache.get(abs);
    const rel = abs.slice(fnDir.length + 1);
    let src = readFileSync(abs, "utf8");
    if (mutate && rel === "_shared/marketplace-authority-containment.ts") {
      const before = src; src = mutate(src);
      if (src === before) throw new Error("mutation matched nothing");
    }
    const out = ts.transpileModule(src, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
    const mod = { exports: {} as Record<string, unknown> };
    cache.set(abs, mod.exports);
    const req = (spec: string): unknown => {
      if (spec.includes("supabase-js")) return supa;
      if (spec.startsWith(".")) {
        const t = resolve(dirname(abs), spec);
        const k = t.slice(fnDir.length + 1);
        return k in stubs ? stubs[k] : load(t);
      }
      throw new Error(`unmapped ${spec}`);
    };
    new Function("require", "module", "exports", "Deno", "fetch", out)(req, mod, mod.exports, Deno, fakeFetch);
    cache.set(abs, mod.exports);
    return mod.exports;
  };
  const mod = load(join(fnDir, "_shared/workflowDispatch.ts")) as {
    dispatchWorkflowRun: (o: Record<string, unknown>) => Promise<{ status: string; error?: string | null }>;
  };
  return { dispatch: mod.dispatchWorkflowRun, fetches, updates };
}

const run = (directFunctionName: string) => ({
  runId: "run-1", provider: "direct_edge_function", n8nWebhookUrl: null, needsN8nLink: null,
  langgraphGraphId: null, directFunctionName,
  payload: { input: { contact_id: "22222222-bbbb-4000-8000-0000000000b2" }, context: { tenant_id: "bbbbbbbb-1111-4000-8000-0000000000bb" } },
});

describe("INT-310 dispatch allowlist — the predicate", () => {
  it("allows nothing today: no reviewed service-dispatch target exists", () => {
    for (const name of [
      "send-message", "credit-verification-initiate", "subagent-fundability", "subagent-email-composer",
      "paige-orchestrator", "paige-problem-reverse-engineer", "paige-deep-research", "",
    ]) {
      expect(isServiceDispatchDirectFunctionAllowed(name)).toBe(false);
    }
  });
  it("rejects non-canonical spellings before any lookup", () => {
    for (const v of ["Send-Message", " send-message", "../send-message", null, 42, {}]) {
      expect(isServiceDispatchDirectFunctionAllowed(v)).toBe(false);
    }
  });
});

describe("INT-310 dispatch allowlist — the real dispatcher refuses before any service-bearer call", () => {
  for (const target of ["send-message", "subagent-fundability", "paige-orchestrator", "subagent-email-composer"]) {
    it(`${target}: run fails as direct_function_not_allowlisted, nothing is called`, async () => {
      const d = loadDispatcher();
      const res = await d.dispatch(run(target));
      expect(res).toMatchObject({ status: "failed", error: "direct_function_not_allowlisted" });
      expect(d.fetches).toEqual([]);
      expect(d.updates.some((u) => u.status === "failed" && u.error === "direct_function_not_allowlisted")).toBe(true);
    });
  }

  it("the existing Marketplace block still answers first (direct_function_not_allowed)", async () => {
    const d = loadDispatcher();
    const res = await d.dispatch(run("marketplace-checkout"));
    expect(res).toMatchObject({ status: "failed", error: "direct_function_not_allowed" });
    expect(d.fetches).toEqual([]);
  });

  it("mutation proof: allowlisting a target lets the service-bearer call through", async () => {
    const d = loadDispatcher((s) => s.replace("new Set<string>([])", 'new Set<string>(["subagent-fundability"])'));
    await d.dispatch(run("subagent-fundability"));
    expect(d.fetches).toHaveLength(1);
    expect(d.fetches[0].auth).toBe(`Bearer ${SERVICE}`);
  });
});

describe("INT-310 dispatch allowlist — the cron sweeper terminates before claiming (structural)", () => {
  it("checks the allowlist before the atomic claim update", () => {
    const src = readFileSync(join(fnDir, "dispatch-queued-workflow-runs/index.ts"), "utf8");
    const gate = src.indexOf('await terminate("direct_function_not_allowlisted")');
    const claim = src.indexOf('.update({ status: "running", last_dispatched_at: claimStamp })');
    expect(gate).toBeGreaterThan(0);
    expect(claim).toBeGreaterThan(gate);
  });
});

describe("INT-310 orchestrator local-agent allowlist — the predicate", () => {
  it("allows exactly the functions built for the orchestrator's {input, context} contract", () => {
    for (const name of ["subagent-email-composer", "paige-problem-reverse-engineer", "paige-deep-research", "subagent-fundability"]) {
      expect(isOrchestratorLocalAgentFunctionAllowed(name)).toBe(true);
    }
  });
  it("refuses any other function, and every non-canonical spelling (no path can escape the functions route)", () => {
    for (const v of [
      "send-message", "subagent-forge", "paige-orchestrator",
      // Registered by early migrations but absent from prod's registry (2026-10-05) and not built to the
      // contract: sales-pipeline / coach-copilot (undeployed, unscoped), financial-research (INT-316,
      // trusts input.user_id), market-research (no caller gate). Each needs review before it is listed.
      "subagent-sales-pipeline", "subagent-coach-copilot", "subagent-financial-research", "subagent-market-research",
      "../../rest/v1/clients", "%2e%2e/%2e%2e/auth/v1/admin/users", "subagent-email-composer/../x",
      "Subagent-Email-Composer", " subagent-email-composer", "", null, 7,
    ]) {
      expect(isOrchestratorLocalAgentFunctionAllowed(v)).toBe(false);
    }
  });
});

describe("INT-317 §58 — the allowlist retires ONE workflow route, not PAIGE messaging", () => {
  // Owner ruling 2026-10-05: `direct_send_message → send-message` is retired from the generic
  // direct_edge_function workflow route only. Messaging stays on its canonical, governed paths, which
  // never pass through the workflow dispatcher and so are not touched by this allowlist.
  const src = (p: string) => readFileSync(join(fnDir, p), "utf8");
  // The exact endpoint, closed by the template literal's backtick (so `send-message-x` does not count).
  const SEND = /\/functions\/v1\/send-message`/;

  it("send-message is still a deployed executor (its handler exists)", () => {
    expect(src("send-message/index.ts")).toMatch(/Deno\.serve\(/);
  });

  it("execute-approval still sends approved email/SMS through send-message, as the approving user", () => {
    const s = src("execute-approval/index.ts");
    expect(s).toMatch(SEND);
    expect(s).toMatch(/Authorization:\s*authHeader/);
  });

  it("the scheduled Comms drain still delivers through send-message", () => {
    expect(src("comms-scheduled-drain/index.ts")).toMatch(SEND);
  });

  it("none of the canonical messaging paths routes through the workflow dispatcher the allowlist gates", () => {
    for (const p of ["send-message/index.ts", "execute-approval/index.ts", "comms-scheduled-drain/index.ts"]) {
      expect(src(p)).not.toMatch(/workflowDispatch/);
    }
    // ...while the generic workflow route to the same function is the one refused.
    expect(isServiceDispatchDirectFunctionAllowed("send-message")).toBe(false);
  });
});
