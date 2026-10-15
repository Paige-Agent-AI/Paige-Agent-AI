/**
 * R6-B Phase 1 (#1851) — the research-owned consumer adapter onto the shared Model Fabric
 * class seam (fabricCompletion, #1831), DORMANT by construction.
 *
 * The ruling's core guarantees, pinned from both sides:
 *   • flag OFF (the only state this slice ships): every research model call is BYTE-PARITY
 *     with the R5/R6-A shipped path — the same routed job kind, the same body, no trace arg,
 *     no telemetry side-effects;
 *   • flag ON (dormant, owner-gated later): the request carries ONLY a cognitive class from
 *     the engine's own RESEARCH_COGNITIVE_CLASSES declaration and a stable research job
 *     identity — never a provider or model — plus the server-resolved tenant/actor trace;
 *   • telemetry projects the fabric's served-route evidence into CLOSED diagnostic values —
 *     no raw provider error text, no attempt detail, no model-choice guesses;
 *   • the strategist stays a SHARED consumer (no research-owned migration of strategize.ts);
 *   • the R6-A escalation predicate answers the BINDING corrected 7/78 seven: the four
 *     all-truncated zero-candidate cases escalate only with sufficient evidence; the three
 *     typed-insufficiency cases NEVER escalate.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import ts from "typescript";

const root = join(__dirname, "..", "..");
const core = readFileSync(join(root, "supabase/functions/paige-deep-research/index.ts"), "utf8");
const fabric = readFileSync(join(root, "supabase/functions/paige-deep-research/fabric.ts"), "utf8");
const r5artifact = JSON.parse(readFileSync(join(root, "docs/research-quality/q0/r5-after-dev.json"), "utf8")) as Array<{ id: string; class: string; outcomes: string[] }>;

const js = (body: string) =>
  ts.transpileModule(body, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;

const extractFn = (from: string, name: string): string => {
  const sf = ts.createSourceFile("fn.ts", from, ts.ScriptTarget.ES2022, true);
  let found: string | null = null;
  const walk = (n: ts.Node) => {
    if (ts.isFunctionDeclaration(n) && n.name?.text === name) found = n.getText(sf);
    if (ts.isVariableStatement(n)) {
      for (const d of n.declarationList.declarations) {
        if (ts.isIdentifier(d.name) && d.name.text === name) found = n.getText(sf);
      }
    }
    n.forEachChild(walk);
  };
  walk(sf);
  if (!found) throw new Error(`${name} not found`);
  return found;
};

// The adapter's own module-scope tables are extracted with the function (ROUTED_JOB_KINDS,
// FABRIC_JOBS, projectRoute) so the behavioral runs execute the REAL source, not a copy.
const stripExport = (src: string) => src.replace(/^export\s+/m, "");
const tableLiteral = (name: string): string => {
  const m = new RegExp("const " + name + "[^=]*=\\s*([\\s\\S]*?\\n};)").exec(fabric);
  if (!m) throw new Error(`${name} table not found`);
  return m[1];
};

const buildAdapter = (enabled: boolean) => {
  const fnText = stripExport(extractFn(fabric, "researchCompletion"));
  const projectText = stripExport(extractFn(fabric, "projectRoute"));
  const body = `
    const ROUTED_JOB_KINDS = ${tableLiteral("ROUTED_JOB_KINDS")}
    const FABRIC_JOBS = ${tableLiteral("FABRIC_JOBS")}
    const RESEARCH_FABRIC_ENABLED = ${enabled};
    ${projectText}
    ${fnText}
  `;
  return (new Function(js(body) + "\nreturn { researchCompletion, projectRoute };")()) as {
    researchCompletion: (phase: string, cls: string, body: Record<string, unknown>, ctx: { tenantId: string | null; runId: string | null }, deps: { routed: (...a: unknown[]) => Promise<unknown>; fabric: (...a: unknown[]) => Promise<{ ok: boolean; route?: unknown; response?: unknown }> }) => Promise<{ resp: unknown; route: Record<string, unknown> | null }>;
    projectRoute: (r: unknown) => Record<string, unknown>;
  };
};

describe("R6-B — the dormant gate (default OFF is the shipped state)", () => {
  it("RESEARCH_FABRIC_ENABLED is a real boolean const pinned false in source", () => {
    expect(fabric).toContain("export const RESEARCH_FABRIC_ENABLED: boolean = false;");
  });
  it("the engine consumes the adapter; the adapter is the ONLY new model-call path", () => {
    expect(core).toContain('import { researchCompletion');
    expect(fabric).toContain('from "../_shared/model-router.ts"');
    expect(fabric).toContain('from "../_shared/model-fabric.ts"');
  });
  it("no research-owned file imports a provider transport directly", () => {
    for (const banned of ["api.openai.com", "api.anthropic.com", "featherless.ai", "from \"../_shared/claude.ts\"", "from \"../_shared/openai-responses.ts\""]) {
      expect(fabric).not.toContain(banned);
      expect(core).not.toContain(banned);
    }
  });
});

describe("R6-B — flag OFF: byte-parity with the shipped R5/R6-A path", () => {
  const phases: Array<[string, string]> = [
    ["hop_query_planner", "extract"],
    ["unit_planner", "extract"],
    ["unit_synthesis", "doc_draft"],
    ["dossier_synthesis", "doc_draft"],
  ];
  for (const [phase, jobKind] of phases) {
    it(`${phase}: routedChatCompletion receives exactly (${jobKind}, body) — no trace, no fabric call, no route`, async () => {
      const list: Array<{ kind: unknown; b: unknown }> = [];
      const adapter = buildAdapter(false);
      const out = await adapter.researchCompletion(phase, "cheap", { messages: [], temperature: 0.2, max_tokens: 700 }, { tenantId: "t", runId: "r" }, {
        routed: ((kind: unknown, b: unknown) => { list.push({ kind, b }); return Promise.resolve({ content: "x" }); }) as never,
        fabric: (() => { throw new Error("fabric must not be called while disabled"); }) as never,
      });
      expect(list.length).toBe(1);
      expect(list[0]).toEqual({ kind: jobKind, b: { messages: [], temperature: 0.2, max_tokens: 700 } });
      expect((out as { resp: unknown }).resp).toEqual({ content: "x" });
      expect(out.route).toBeNull();
    });
  }
  it("a deterministic phase NEVER reaches a model — the adapter refuses it", async () => {
    const adapter = buildAdapter(false);
    await expect(adapter.researchCompletion("hop_query_planner", "deterministic", { messages: [] }, { tenantId: null, runId: null }, {
      routed: (() => { throw new Error("must not call"); }) as never,
      fabric: (() => { throw new Error("must not call"); }) as never,
    })).rejects.toThrow("deterministic");
  });
});

describe("R6-B — flag ON (dormant): the class-bearing fabric request", () => {
  const adapter = buildAdapter(true);
  it("cheap and operational phases pass the CALL SITE's declared class (from the engine's own map)", async () => {
    const reqs: Array<Record<string, unknown>> = [];
    await adapter.researchCompletion("hop_query_planner", "cheap", { messages: [], max_tokens: 700 }, { tenantId: "t1", runId: "r1" }, {
      routed: (() => { throw new Error("routed must not run while enabled"); }) as never,
      fabric: ((req: Record<string, unknown>) => { reqs.push(req); return Promise.resolve({ ok: true, route: { requested_class: "cheap", job: req.job, served: { provider: "x", model: "m" }, fallback: false, reason: "served_primary", attempts: [] }, response: { content: "ok" } }); }) as never,
    });
    await adapter.researchCompletion("unit_synthesis", "operational", { messages: [], max_tokens: 2400 }, { tenantId: "t1", runId: "r1" }, {
      routed: (() => { throw new Error(); }) as never,
      fabric: ((req: Record<string, unknown>) => { reqs.push(req); return Promise.resolve({ ok: true, route: { requested_class: "operational", job: req.job, served: { provider: "x", model: "m" }, fallback: false, reason: "served_primary", attempts: [] }, response: { content: "ok" } }); }) as never,
    });
    expect(reqs[0].cognitive_class).toBe("cheap");
    expect(reqs[1].cognitive_class).toBe("operational");
    // the body rides through untouched
    expect(reqs[0].max_tokens).toBe(700);
    expect(reqs[1].max_tokens).toBe(2400);
  });
  it("job identities are the consumer's own stable snake_case names", async () => {
    expect(fabric).toContain('hop_query_planner: "research_hop_planner"');
    expect(fabric).toContain('unit_planner: "research_unit_planner"');
    expect(fabric).toContain('unit_synthesis: "research_unit_synthesis"');
    expect(fabric).toContain('dossier_synthesis: "research_dossier_synthesis"');
  });
  it("the trace carries the SERVER-resolved tenant, the research agent, and the run correlation", async () => {
    const optsSeen: Array<Record<string, unknown>> = [];
    await adapter.researchCompletion("unit_synthesis", "operational", { messages: [] }, { tenantId: "7e700000-0000-0000-0000-000000000007", runId: "run-42" }, {
      routed: (() => { throw new Error(); }) as never,
      fabric: ((_req: unknown, opts: Record<string, unknown>) => { optsSeen.push(opts); return Promise.resolve({ ok: true, route: { requested_class: "operational", job: "j", served: null, fallback: false, reason: "failed", attempts: [] }, response: {} }); }) as never,
    });
    const trace = optsSeen[0].trace as Record<string, unknown>;
    expect(trace.tenant_id).toBe("7e700000-0000-0000-0000-000000000007");
    expect(trace.agent_id).toBe("paige-deep-research");
    expect(trace.task_id).toBe("run-42");
    expect(trace.job_kind).toBe("research_unit_synthesis");
  });
  it("an unresolved tenant stays NULL — never invented, never defaulted to a membership guess", async () => {
    const optsSeen: Array<Record<string, unknown>> = [];
    await adapter.researchCompletion("hop_query_planner", "cheap", { messages: [] }, { tenantId: null, runId: null }, {
      routed: (() => { throw new Error(); }) as never,
      fabric: ((_req: unknown, opts: Record<string, unknown>) => { optsSeen.push(opts); return Promise.resolve({ ok: true, route: { requested_class: "cheap", job: "j", served: null, fallback: false, reason: "failed", attempts: [] }, response: {} }); }) as never,
    });
    expect((optsSeen[0].trace as Record<string, unknown>).tenant_id).toBeNull();
    expect((optsSeen[0].trace as Record<string, unknown>).task_id).toBeNull();
  });
  it("the fabric response unwraps to the chat shape the call sites already parse", async () => {
    const out = await adapter.researchCompletion("unit_synthesis", "operational", { messages: [] }, { tenantId: "t", runId: "r" }, {
      routed: (() => { throw new Error(); }) as never,
      fabric: (() => Promise.resolve({ ok: true, route: { requested_class: "operational", job: "j", served: { provider: "p", model: "m" }, fallback: false, reason: "served_primary", attempts: [{}] }, response: { choices: [{ message: { content: "{}" } }] } })) as never,
    });
    expect((out.resp as { choices: unknown[] }).choices.length).toBe(1);
    expect(out.route).not.toBeNull();
  });
  it("a failed route throws a CLOSED research error — no provider text, no identifiers", async () => {
    await expect(adapter.researchCompletion("unit_synthesis", "operational", { messages: [] }, { tenantId: "t", runId: "r" }, {
      routed: (() => { throw new Error(); }) as never,
      fabric: (() => Promise.resolve({ ok: false, route: { requested_class: "operational", job: "j", served: null, fallback: true, reason: "failed", attempts: [{ provider: "sensitive", model: "secret", failure: "rate_limited" }] }, response: undefined })) as never,
    })).rejects.toThrow("research_fabric_route_failed:failed");
  });
  it("a budget stop rethrows as-is (terminal, never swallowed into a fake result)", async () => {
    const budgetErr = Object.assign(new Error("budget"), { code: "budget_exceeded" });
    await expect(adapter.researchCompletion("unit_synthesis", "operational", { messages: [] }, { tenantId: "t", runId: "r" }, {
      routed: (() => { throw new Error(); }) as never,
      fabric: (() => Promise.reject(budgetErr)) as never,
    })).rejects.toBe(budgetErr);
  });
});

describe("R6-B — served-route telemetry projects CLOSED values only", () => {
  const { projectRoute } = buildAdapter(false);
  it("projects the fabric's own route evidence", () => {
    const d = projectRoute({ requested_class: "operational", job: "research_unit_synthesis", served: { provider: "a", model: "m1" }, fallback: true, reason: "served_fallback", attempts: [{}, {}, {}] });
    expect(d).toEqual({ requested_class: "operational", job: "research_unit_synthesis", served_provider: "a", served_model: "m1", fallback: true, reason: "served_fallback", attempt_count: 3 });
  });
  it("carries NO attempt detail, NO failure text, NO raw identifiers (mutation: leaking attempts fails)", () => {
    const d = projectRoute({ requested_class: "cheap", job: "j", served: null, fallback: false, reason: "failed", attempts: [{ provider: "p", model: "m", failure: "auth_config", error_message: "secret key rejected" }] });
    expect(JSON.stringify(d)).not.toContain("auth_config");
    expect(JSON.stringify(d)).not.toContain("secret");
    expect(JSON.stringify(d)).not.toContain("error");
    expect(d.attempt_count).toBe(1);
    expect(d.served_provider).toBeNull();
    expect(d.reason).toBe("failed");
  });
  it("a missing route degrades to honest nulls/zero, never a fabricated pass", () => {
    const d = projectRoute(undefined);
    expect(d.served_provider).toBeNull();
    expect(d.served_model).toBeNull();
    expect(d.attempt_count).toBe(0);
  });
});

describe("R6-B — engine integration pins (the four call sites route through the adapter)", () => {
  it("each LLM phase consumes researchCompletion with the REAL declared class", () => {
    expect(core).toContain('researchCompletion("hop_query_planner", RESEARCH_COGNITIVE_CLASSES.hop_query_planner');
    expect(core).toContain('researchCompletion("unit_planner", RESEARCH_COGNITIVE_CLASSES.unit_planner');
    expect(core).toContain('researchCompletion("unit_synthesis", cognitiveClass ?? RESEARCH_COGNITIVE_CLASSES.unit_synthesis');
    expect(core).toContain('researchCompletion("dossier_synthesis", RESEARCH_COGNITIVE_CLASSES.dossier_synthesis');
  });
  it("no direct routedChatCompletion call remains in the engine (the adapter owns the dispatch)", () => {
    expect(core).not.toContain('await routedChatCompletion(');
    expect(core).not.toContain('routedChatCompletion("extract"');
    expect(core).not.toContain('routedChatCompletion("doc_draft"');
  });
  it("the engine threads the server-resolved run context to every phase", () => {
    expect(core).toContain("const fabricCtx");
    expect(core).toContain("tenantId: resolvedTenantId");
    expect(core).toContain("await planHop(question, domainHint, hop, evidence, strategyHint, fabricCtx)");
    expect(core).toContain("planSynthesisUnits(question, domainHint, citable, fabricCtx)");
  });
  it("unit diagnostics gain served_route; the R6-A served_model readback survives", () => {
    expect(core).toContain("served_route:");
    expect(core).toContain("__served_route");
    expect(core).toContain("__served_model");
  });
  it("the strategist stays the SHARED consumer — no research-owned migration of strategize.ts", () => {
    expect(core).toContain('from "../_shared/reasoning/strategize.ts"');
    const strat = readFileSync(join(root, "supabase/functions/_shared/reasoning/strategize.ts"), "utf8");
    expect(strat).toContain('routedChatCompletion("plan"'); // unchanged shared module
    expect(fabric).not.toContain("strategist");
  });
});

describe("R6-B — the escalation predicate answers the BINDING corrected 7/78 seven", () => {
  const build = () => {
    const fnText = extractFn(core, "shouldEscalateToFrontier");
    const typeText = core.match(/type UnitOutcome = [^;]+;/)![0];
    return (new Function(js(`${typeText}\n${fnText}\nreturn shouldEscalateToFrontier;`)) as unknown as () => (x: {
      unitKind: string; evidenceSufficient: boolean; sourceCount: number; priorOutcome: string | null; ambiguityUnresolved: boolean;
    }) => { escalate: boolean; reason: string | null })();
  };
  const byId = (id: string) => r5artifact.find((c) => c.id === id)!;

  it("the artifact's seven are exactly the four all-truncated + three typed-insufficient zero-candidate cases", () => {
    const seven = ["C1", "C4", "A1", "A2", "S3", "S4", "A4"].map(byId);
    expect(seven.every((c) => c.outcomes.every((o) => o === "truncated" || o === "insufficient"))).toBe(true);
    expect(seven.filter((c) => c.outcomes.every((o) => o === "truncated")).map((c) => c.id).sort()).toEqual(["A1", "A2", "C1", "C4"]);
    expect(seven.filter((c) => c.outcomes.every((o) => o === "insufficient")).map((c) => c.id).sort()).toEqual(["A4", "S3", "S4"]);
  });

  it("the four all-truncated cases (retrieval was healthy — the defect was the token ceiling) escalate WITH sufficient evidence", () => {
    const f = build();
    for (const id of ["C1", "C4", "A1", "A2"]) {
      const c = byId(id);
      for (const outcome of c.outcomes) {
        const r = f({ unitKind: "facet", evidenceSufficient: true, sourceCount: 3, priorOutcome: outcome, ambiguityUnresolved: false });
        expect(r).toEqual({ escalate: true, reason: "typed_truncation_with_sufficient_evidence" });
      }
    }
  });
  it("the same truncated cases with NO evidence stay honest insufficiency — never try-harder", () => {
    const f = build();
    const r = f({ unitKind: "facet", evidenceSufficient: false, sourceCount: 1, priorOutcome: "truncated", ambiguityUnresolved: false });
    expect(r).toEqual({ escalate: false, reason: null });
  });
  it("the three typed-insufficiency cases NEVER escalate — even with abundant evidence (A4 is the sharp case)", () => {
    const f = build();
    for (const id of ["S3", "S4", "A4"]) {
      const c = byId(id);
      expect(c.outcomes).toEqual(["insufficient"]);
      for (const ev of [true, false]) {
        const r = f({ unitKind: "insufficiency", evidenceSufficient: ev, sourceCount: ev ? 9 : 0, priorOutcome: "insufficient", ambiguityUnresolved: true });
        expect(r).toEqual({ escalate: false, reason: null });
      }
    }
  });
  it("boundary: ok-but-unreconciled escalates; plain ok does not; two sources is the floor", () => {
    const f = build();
    expect(f({ unitKind: "relation", evidenceSufficient: true, sourceCount: 4, priorOutcome: "ok", ambiguityUnresolved: true }))
      .toEqual({ escalate: true, reason: "hard_reconciliation_unresolved_after_operational_attempt" });
    expect(f({ unitKind: "relation", evidenceSufficient: true, sourceCount: 4, priorOutcome: "ok", ambiguityUnresolved: false }))
      .toEqual({ escalate: false, reason: null });
    expect(f({ unitKind: "facet", evidenceSufficient: true, sourceCount: 1, priorOutcome: "truncated", ambiguityUnresolved: false }))
      .toEqual({ escalate: false, reason: null });
  });
});

describe("R6-B — no second routing authority anywhere in research-owned code", () => {
  const executable = (src: string) =>
    src.split(String.fromCharCode(10))
      .map((l) => (l.includes("//") ? l.slice(0, l.indexOf("//")) : l))
      .join(String.fromCharCode(10))
      .replace(/\/\*[\s\S]*?\*\//g, "");
  it("the adapter holds no policy, no candidate list, no fallback logic", () => {
    for (const banned of ["CLASS_POLICY", "mayFallback", "candidatesFor", "OPENAI_", "CLAUDE_", 'provider: "', 'model: "']) {
      expect(executable(fabric)).not.toContain(banned);
    }
  });
  it("the provider-string ban holds on the adapter's executable code (comments may document)", () => {
    const noComments = executable(fabric);
    for (const banned of ["openai", "gpt-6", "astra", "sol", "sonnet", "claude", "groq", "qwen", "luna", "haiku", "opus"]) {
      expect(noComments.toLowerCase()).not.toContain(banned);
    }
  });
});
