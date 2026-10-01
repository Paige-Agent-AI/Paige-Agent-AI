// N5 §2 de-hardcode — Layer A assembly assertion (§32: a green build is not proof;
// the FULL assembled client prompt for a bare / non-funding tenant must carry ZERO
// credit/funding vertical content, and the funding vertical must reach a client
// ONLY when the tenant opted in. This test would FAIL on the pre-N5 live code
// (the ungated userContext injected "❌ NO CREDIT REPORT UPLOADED YET…" into every
// tenant's prompt) — that failure is the point.
import { describe, expect, it } from "vitest";
import {
  buildFundingProgramVocab,
  buildLaneGuardSection,
  buildNeutralCorePrompt,
  buildPaigePersonaBlock,
  buildUserContext,
  CREDIT_DENYLIST,
  CREDIT_PROGRAM_DENYLIST,
  deriveFinanceInScopeFromFeatures,
  HARD_GUARDRAIL_MARKER,
  resolveDisputeReferralLabel,
  sanitizeClientContextForTier,
} from "../../supabase/functions/_shared/client-context.ts";
// §18 one home / §2 / §3 — the platform-default VOICE block ships in the SAME assembled
// prompt as the persona + neutral core, so it must clear the SAME finance + program
// denylists. It lives in its own shared module (extracted from paige-ai-chat/index.ts)
// so this test scans the exact string the edge function sends (§32: green build ≠ proof).
import { PAIGE_VOICE_BLOCK } from "../../supabase/functions/_shared/paige-voice.ts";
import * as voice from "../../supabase/functions/_shared/paige-voice.ts";
import { readFileSync } from "node:fs";
import ts from "typescript";

describe("INT-104 Live final-answer streaming preserves the canonical tool gate", () => {
  const code = readFileSync("supabase/functions/paige-ai-chat/index.ts", "utf8");
  const source = ts.createSourceFile("chat.ts", code, ts.ScriptTarget.Latest, true);
  const find = (predicate: (node: ts.Node) => boolean): ts.Node => {
    let found: ts.Node | undefined;
    const visit = (node: ts.Node) => { if (found) return; if (predicate(node)) found = node; else ts.forEachChild(node, visit); };
    visit(source); if (!found) throw new Error("Production seam not found"); return found;
  };
  const js = (body: string) => ts.transpileModule(body, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
  const initializer = (name: string) => (find((n) => ts.isVariableDeclaration(n) && n.name.getText(source) === name) as ts.VariableDeclaration).initializer!.getText(source);
  it("uses a private decision instruction only on verified non-document Live rounds", () => {
    const messages = [{ role: "user", content: "Hello" }];
    const make = new Function("liveRuntimeScope", "attachedDocument", js(`return ${initializer("liveDecisionMessages")};`));
    expect(make(null, null)(messages)).toBe(messages);
    expect(make({}, {})(messages)).toBe(messages);
    const decision = make({}, null)(messages);
    expect(decision).toHaveLength(2);
    expect(decision[1].content).toContain("Do not draft the user-facing answer here");
    expect(messages).toHaveLength(1);
    const start = code.indexOf('finalStreamResponse = await gatewayCompat');
    const closing = code.slice(start, code.indexOf('traceFor(', start));
    expect(closing.includes('messages: convo, stream: true')).toBe(true);
    expect(/tools:|tool_choice:/.test(closing)).toBe(false);
  });
  it("does not replay decision-round prose for a verified Live turn", () => {
    const gate = find((n) => ts.isIfStatement(n) && n.expression.getText(source) === "!hasToolCall").getText(source);
    const run = new Function("liveRuntimeScope", js(`let finalChunks=null,finalAssistantText='',liveAnswerPending=false;const hasToolCall=false,allChunks=['decision'],content='not an answer';for(let i=0;i<1;i++){${gate}}return {finalChunks,finalAssistantText,liveAnswerPending};`));
    expect(run({})).toEqual({ finalChunks: null, finalAssistantText: "", liveAnswerPending: true });
    expect(run(null)).toEqual({ finalChunks: ["decision"], finalAssistantText: "not an answer", liveAnswerPending: false });
    expect(code.match(/!finalChunks && \(forcedTermination \|\| liveAnswerPending\) && !tenantKnowledgeScopeInvalidated/g)).toHaveLength(2);
  });
  it("does not mistake early prose followed by a late tool call for an answer", async () => {
    const consume = new Function(js(`return ${initializer("consumeRound")};`))();
    let upstream!: ReadableStreamDefaultController<Uint8Array>;
    const stream = new ReadableStream<Uint8Array>({ start(c) { upstream = c; } });
    let completed = false;
    const result = consume(new Response(stream)).then((r: { hasToolCall: boolean }) => { completed = true; return r; });
    const enc = new TextEncoder();
    upstream.enqueue(enc.encode('data: {"choices":[{"delta":{"content":"Done."}}]}\n\n'));
    await new Promise((r) => setTimeout(r, 0));
    expect(completed).toBe(false);
    upstream.enqueue(enc.encode('data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call","function":{"name":"governed_write","arguments":"{}"}}]},"finish_reason":"tool_calls"}]}\n\ndata: [DONE]\n\n'));
    upstream.close();
    expect((await result).hasToolCall).toBe(true);
  });
  it.each([false, true])("streams only the tools-free final answer, preserving protected hold=%s", async (protectedTurn) => {
    const branch = find((n) => ts.isIfStatement(n) && n.expression.getText(source) === "finalStreamResponse?.ok && finalStreamResponse.body") as ts.IfStatement;
    const body = (branch.thenStatement as ts.Block).statements.map((n) => n.getText(source)).join("\n");
    const heldContent: Uint8Array[] = [], emitted: Uint8Array[] = [];
    const emit = new Function("turnCarriesProtectedContent", "heldContent", js(`return ${initializer("emitContent")};`))(() => protectedTurn, heldContent);
    let upstream!: ReadableStreamDefaultController<Uint8Array>;
    const response = new Response(new ReadableStream<Uint8Array>({ start(c) { upstream = c; } }));
    const run = new Function("finalStreamResponse", "controller", "emitContent", js(`return (async()=>{let finalAssistantText='';const liveRuntimeScope={};${body};return finalAssistantText;})();`));
    const answer = run(response, { enqueue(c: Uint8Array) { emitted.push(c); } }, emit);
    const enc = new TextEncoder();
    upstream.enqueue(enc.encode('data: {"choices":[{"delta":{"content":"First sentence."}}]}\n\n'));
    await new Promise((r) => setTimeout(r, 0));
    expect(emitted.length).toBe(protectedTurn ? 0 : 1);
    expect(heldContent.length).toBe(protectedTurn ? 1 : 0);
    upstream.enqueue(enc.encode('data: {"choices":[{"delta":{"content":" Next sentence."}}]}\n\ndata: [DONE]\n\ndata: {"choices":[{"delta":{"content":" must be ignored"}}]}\n\n'));
    upstream.close();
    expect(await answer).toBe("First sentence. Next sentence.");
    if (protectedTurn) expect(emitted).toEqual([]);
  });
  it.each(["First sentence.", ""])("keeps already-issued safe cards when Live fails with text=%j", async (text) => {
    const caught = find((n) => ts.isCatchClause(n) && n.getText(source).includes('[paige] live reasoning stream failed:')) as ts.CatchClause;
    const meta = { surfaces: ["client"], bundleRef: { approval_queued: [{ id: "approval" }], paige_confirm: [{ tool: "governed_write" }], paige_crm_result: [{ outcome: "success", receipt_recorded: true }] } };
    const persisted: unknown[] = [];
    // The catch also reports what became of the turn's approvals (emitApprovalOutcome); a no-op here.
    const run = new Function("finalAssistantText", "assistantTurnMetadata", "persistAssistantTurn", "turnCarriesProtectedContent", "revalidateTenantKnowledgeScope", "console",
      js(`return (async()=>{const liveRuntimeScope={},payloadThreadId='thread',enc=new TextEncoder(),controller={enqueue(){}},discardContent=()=>{},emitApprovalOutcome=async()=>{};try{throw Error('fixture')}catch(e)${caught.block.getText(source)}})();`));
    await run(text, () => meta, async (content: string, metadata: unknown) => persisted.push({ content, metadata }), () => false, async () => true, { error() {} });
    expect(persisted).toEqual([{ content: text, metadata: meta }]);
    for (const [protectedTurn, validScope] of [[true, true], [false, false]]) {
      persisted.length = 0;
      await run(text, () => meta, async (content: string) => persisted.push(content), () => protectedTurn, async () => validScope, { error() {} });
      expect(persisted).toEqual([]);
    }
  });
  it("writes a receipt-only assistant turn without inventing spoken text", async () => {
    const writes: unknown[] = [];
    const make = new Function("payloadThreadId", "supabaseClient", "maybeRefreshSummary", "console", js(`return ${initializer("persistAssistantTurn")};`));
    const persist = make("thread", { rpc: async (_name: string, args: unknown) => { writes.push(args); }, from() { throw Error("no title in fixture"); } }, async () => {}, { error() {} });
    const bundleRef = { paige_crm_result: [{ outcome: "success", receipt_recorded: true }] };
    await persist("", { bundleRef });
    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatchObject({ p_content: "", p_bundle_ref: bundleRef });
    await persist("", { bundleRef: null });
    expect(writes).toHaveLength(1);
  });
  it("shares the success projection and drops CRM readback and locator from history", () => {
    const make = new Function("stepTrace", "queuedApprovals", "confirmTrace", "crmResultTrace", js(`return ${initializer("assistantTurnMetadata")};`));
    const result = { action: "crm_update", outcome: "success", receipt_recorded: true, external_effect: false, readback: { private: "fixture" }, record_locator: "private-fixture", contact_id: "private-fixture" };
    const project = make([{ kind: "thought", group: "owner" }, { kind: "action", group: "client" }, { kind: "action", group: "client" }], [], [], [result]);
    expect(project()).toEqual({ surfaces: ["client"], bundleRef: { approval_queued: [], paige_confirm: [], paige_crm_result: [{ action: "crm_update", outcome: "success", receipt_recorded: true, external_effect: false }] } });
    expect(code).toContain("persistAssistantTurn(finalAssistantText, assistantTurnMetadata())");
  });
  it.each([false, true].flatMap((protectedTurn) => ["reject", "eof", "error-frame", "enqueue-reject", "non-ok", "bodyless", "empty-done", "whitespace-done"].map((ending) => ({ protectedTurn, ending }))))("settles an interrupted Live stream without success or transcript loss, %j", async ({ protectedTurn, ending }) => {
    const branch = find((n) => ts.isIfStatement(n) && n.expression.getText(source) === "finalStreamResponse?.ok && finalStreamResponse.body") as ts.IfStatement;
    const body = branch.getText(source);
    const caught = find((n) => ts.isCatchClause(n) && n.getText(source).includes('[paige] live reasoning stream failed:')) as ts.CatchClause;
    const heldContent: Uint8Array[] = [], emitted: Uint8Array[] = [], persisted: string[] = [];
    const emit = new Function("turnCarriesProtectedContent", "heldContent", js(`return ${initializer("emitContent")};`))(() => protectedTurn, heldContent);
    let upstream!: ReadableStreamDefaultController<Uint8Array>;
    const hasStream = !["non-ok", "bodyless"].includes(ending);
    const response = hasStream ? new Response(new ReadableStream<Uint8Array>({ start(c) { upstream = c; } }))
      : new Response(null, { status: ending === "non-ok" ? 503 : 200 });
    // An interrupted Live answer still says what became of the turn's approvals, before the error
    // frame the Live client settles on (paige_approval_outcome, _shared/approval-outcome.ts).
    const outcomeReports: string[] = [];
    const run = new Function("finalStreamResponse", "controller", "emitContent", "turnCarriesProtectedContent", "discardContent", "persistAssistantTurn", "revalidateTenantKnowledgeScope", "console", "assistantTurnMetadata", "emitApprovalOutcome",
      js(`return (async()=>{let finalAssistantText='';const liveRuntimeScope={},payloadThreadId='thread',enc=new TextEncoder();try{${body}}catch(e)${caught.block.getText(source)}})();`));
    const settled = run(response, { enqueue(c: Uint8Array) { emitted.push(c); } },
      ending === "enqueue-reject" ? () => { throw new Error("fixture-enqueue-rejected"); } : emit, () => protectedTurn,
      () => { heldContent.length = 0; }, async (text: string) => { persisted.push(text); }, async () => true, { error() {} }, () => ({ surfaces: [], bundleRef: null }),
      async () => { outcomeReports.push(emitted.map((c) => new TextDecoder().decode(c)).join("")); });
    if (hasStream) {
      const content = ending === "empty-done" ? "" : ending === "whitespace-done" ? "   " : "First sentence.";
      upstream.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`));
      await new Promise((r) => setTimeout(r, 0));
      if (ending === "reject") upstream.error(new Error("fixture-stream-interrupted"));
      else {
        if (ending === "error-frame") upstream.enqueue(new TextEncoder().encode('data: {"error":"fixture"}\n\ndata: [DONE]\n\n'));
        if (ending.endsWith("-done")) upstream.enqueue(new TextEncoder().encode('data: [DONE]\n\n'));
        upstream.close();
      }
    }
    await settled;
    const wire = emitted.map((c) => new TextDecoder().decode(c)).join("");
    expect(wire.includes('[DONE]')).toBe(false);
    expect(persisted).toEqual(protectedTurn || !hasStream || ending === "enqueue-reject" || ending.endsWith("-done") ? [] : ["First sentence."]);
    expect(heldContent).toEqual([]);
    expect(wire.includes('paige_live_error')).toBe(true);
    // Once, and before the error frame: the card that asked is answered before the answer ends.
    expect(outcomeReports).toHaveLength(1);
    expect(outcomeReports[0].includes('paige_live_error')).toBe(false);
  });
});

describe("INT-104 S5 — authenticated Live delivery uses the existing voice home", () => {
  const chat = readFileSync("supabase/functions/paige-ai-chat/index.ts", "utf8");
  it("adds spoken delivery only for the server-verified Live scope, never ordinary text", () => {
    const line = chat.split(/\r?\n/).find((line) => line.includes('content: PAIGE_LIVE_SPOKEN_STYLE'));
    expect(line).toBeDefined();
    const assemble = new Function("liveRuntimeScope", "PAIGE_LIVE_SPOKEN_STYLE", `return [${line}]`);
    expect(assemble(null, voice.PAIGE_LIVE_SPOKEN_STYLE)).toEqual([]);
    expect(assemble({ turnId: "verified-turn" }, voice.PAIGE_LIVE_SPOKEN_STYLE))
      .toEqual([{ role: "system", content: voice.PAIGE_LIVE_SPOKEN_STYLE }]);
    expect(chat.indexOf("liveRuntimeScope = scope;")).toBeGreaterThan(chat.indexOf("if (claimError || !claimed)"));
  });

  it("keeps the spoken register tenant-neutral, short, expressive and authority-preserving", () => {
    const style = voice.PAIGE_LIVE_SPOKEN_STYLE;
    expect(typeof style).toBe("string");
    expect(style).toContain("first complete sentence");
    expect(style).toContain("1-3 sentences");
    expect(style).toContain("tenant-authored persona");
    expect(style).toContain("distress");
    expect(style).toContain('A spoken "yes" is review input, never approval');
    expect(style).toContain("Never claim a save, summary, sent message or completed action without its receipt");
    expect(CREDIT_DENYLIST.test(style)).toBe(false);
    expect(CREDIT_PROGRAM_DENYLIST.test(style)).toBe(false);
  });

  it("retires the old text-marker trigger and unsupported post-call promises", () => {
    expect(chat.includes('look for "VOICE_MODE: true"')).toBe(false);
    expect(chat.includes("I'll add a summary of what we discussed to your chat")).toBe(false);
    expect(chat.includes("the extraction card will appear in their chat after the call ends")).toBe(false);
    expect(chat.match(/content: PAIGE_LIVE_SPOKEN_STYLE/g)).toHaveLength(1);
  });
});

// --- Chainable Supabase mock. Every builder method returns `this`; `this` is
// thenable (resolves to {data: list, count}); `.maybeSingle()` resolves to
// {data: single}. Per-table fixtures drive the shape. ---
// (Typed as the module's structural ContextDb via a cast: the mock predates that
// interface and its runtime shape satisfies it — the cast only bridges the types.)
interface MockBuilder {
  select: () => MockBuilder;
  eq: () => MockBuilder;
  neq: () => MockBuilder;
  order: () => MockBuilder;
  limit: () => MockBuilder;
  then: (resolve: (v: unknown) => void) => void;
  maybeSingle: () => Promise<unknown>;
}
function mockSupabase(fixtures: Record<string, { single?: unknown; list?: unknown[]; count?: number }>) {
  function builder(table: string): MockBuilder {
    const cfg = fixtures[table] || {};
    const b: MockBuilder = {
      select: () => b,
      eq: () => b,
      neq: () => b,
      order: () => b,
      limit: () => b,
      then: (resolve: (v: unknown) => void) =>
        resolve({ data: cfg.list ?? null, count: cfg.count ?? null, error: null }),
      maybeSingle: () => Promise.resolve({ data: cfg.single ?? null, error: null }),
    };
    return b;
  }
  return { from: (t: string) => builder(t) } as unknown as import("../../supabase/functions/_shared/client-context.ts").ContextDb;
}

const NEUTRAL_CTX = (userContext: string, clientContext: string) =>
  buildNeutralCorePrompt({
    dateTimeString: "Monday, August 4, 2026 at 10:00 AM EDT",
    timezoneNote: " (timezone: America/New_York)",
    clientContext,
    memoryBlock: "",
    // Not empty: this block is assembled server-side and injected into the prompt, so the §2
    // deny-list must scan its wrapper text too. An empty string here would exempt the newest
    // prompt section from the very scan that exists to catch vertical language reaching a
    // coaching-generic tenant.
    operatingMemoryBlock:
      "\n\n=== WHAT YOU ARE CARRYING (from the record, not from this conversation) ===\n" +
      "You owe them:\n- Send the recap (task, open, due 2026-09-03)\n=== END ===\n",
    sessionDocContext: "",
    userContext,
    fetchedUrlContent: "",
    tenantKbContext: "",
  });

// Strip the ONE place credit words are allowed — the persona guardrail that FORBIDS
// them — before scanning the full assembled prompt for leaks.
function stripGuardrail(s: string): string {
  return s.replace(/HARD GUARDRAIL — STAY IN LANE:[\s\S]*?does not provide\./g, "");
}

describe("N5 §2 — bare tenant assembled prompt is credit-free", () => {
  it("emits NO credit/funding content and keeps the HARD GUARDRAIL", async () => {
    const sb = mockSupabase({}); // no user data at all
    const userContext = await buildUserContext(sb, "user-bare", /*fundingEnabled*/ false);
    const persona = buildPaigePersonaBlock(null, "Acme Co", false, null);
    // Assemble in the SAME order the edge function sends: persona → VOICE → neutral core,
    // so the platform-default voice block is covered by the same §2 denylist scan.
    const full = persona + "\n\n" + PAIGE_VOICE_BLOCK + "\n\n" + NEUTRAL_CTX(userContext, "");

    expect(persona).toContain(HARD_GUARDRAIL_MARKER); // guardrail present
    const scanned = stripGuardrail(full);
    expect(CREDIT_DENYLIST.test(scanned)).toBe(false);
    expect(CREDIT_PROGRAM_DENYLIST.test(scanned)).toBe(false);
    // userContext itself carries no credit — only ungated QuickBooks awareness.
    expect(CREDIT_DENYLIST.test(userContext)).toBe(false);
  });
});

describe("§18/§2/§3 — the platform-default VOICE block is finance- and program-clean", () => {
  it("PAIGE_VOICE_BLOCK carries ZERO credit/funding vocab and no program labels", () => {
    // The voice block ships to EVERY tenant by default (§9), so it must be as
    // coaching-generic + finance-free as the neutral core. It is NOT wrapped by the
    // persona HARD-GUARDRAIL, so no strip is needed — it must pass the denylists raw.
    expect(CREDIT_DENYLIST.test(PAIGE_VOICE_BLOCK)).toBe(false);
    expect(CREDIT_PROGRAM_DENYLIST.test(PAIGE_VOICE_BLOCK)).toBe(false);
    // The recency reassert (should-fix #2) is present at the very end, restating that a
    // tenant-authored voice overrides this default.
    expect(PAIGE_VOICE_BLOCK).toContain("TENANT VOICE WINS");
  });
});

describe("N5 §2 — non-funding coaching tenant assembled prompt is credit-free", () => {
  it("renders the tenant's own domain/persona, tasks plainly, and zero credit", async () => {
    const sb = mockSupabase({
      profiles: { single: { full_name: "Dana Lee", city: "Austin", state: "TX" } },
      user_subscriptions: { single: { plan_slug: "pro", status: "active" } },
      tasks: { list: [{ title: "Send onboarding email", status: "pending", track: "client-success" }] },
      businesses: { list: [{ legal_name: "Peak Fitness", business_type: "fitness", entity_type: "LLC" }] },
      documents: { list: [] },
      quickbooks_connections: { single: null },
    });
    const fitnessPlaybook = {
      persona: { name: "Coach P", role: "training assistant", domain: "fitness coaching", tone: "energetic" },
      probingQuestions: [{ ask: "What's your training goal?", captures: "goal" }],
      journey: [{ label: "Intake", description: "Assess baseline" }],
    };
    const userContext = await buildUserContext(sb, "user-fit", false);
    const persona = buildPaigePersonaBlock(fitnessPlaybook, "Peak Fitness", false, null);
    // Same real assembly order (persona → VOICE → neutral core) so the voice block is scanned.
    const full = persona + "\n\n" + PAIGE_VOICE_BLOCK + "\n\n" + NEUTRAL_CTX(userContext, "");

    expect(persona).toContain("fitness coaching"); // tenant domain leads
    expect(persona).toContain(HARD_GUARDRAIL_MARKER);
    expect(userContext).toContain("Send onboarding email"); // tasks shown plainly
    expect(userContext).not.toContain("dispute-related tasks excluded"); // no credit framing
    const scanned = stripGuardrail(full);
    expect(CREDIT_DENYLIST.test(scanned)).toBe(false);
    expect(CREDIT_PROGRAM_DENYLIST.test(scanned)).toBe(false);
  });
});

describe("N5 §2 — the gate is REAL: same data leaks credit only when funding is on", () => {
  it("buildUserContext emits credit for a funding tenant and none for a non-funding tenant", async () => {
    const fx = {
      profiles: { single: { full_name: "Sam", estimated_fico_ex: 690 } },
      quickbooks_connections: { single: null },
      // gated tables — only read when fundingEnabled:
      credit_report_uploads: { list: [] },
      credit_accounts: { count: 0 },
      credit_negative_items: { list: [] },
      banking_relationships: { list: [] },
      businesses: { list: [] },
      business_credit_reports: { single: null },
    };
    const funding = await buildUserContext(mockSupabase(fx), "u", /*fundingEnabled*/ true);
    const nonFunding = await buildUserContext(mockSupabase(fx), "u", /*fundingEnabled*/ false);

    // Funding tenant DOES get credit vertical (the no-report nudge + fundability + business credit).
    expect(CREDIT_DENYLIST.test(funding)).toBe(true);
    expect(funding).toContain("NO CREDIT REPORT UPLOADED YET");
    // Same data, non-funding tenant → zero credit vertical.
    expect(CREDIT_DENYLIST.test(nonFunding)).toBe(false);
    expect(nonFunding).not.toContain("CREDIT REPORT");
  });
});

describe("N5 §37 — sanitizeClientContextForTier drops credit for non-funding", () => {
  const creditCtx =
    "Session: signed in just now\nCurrent page: Dashboard\nCLIENT CONTEXT — Sam\nBureau Scores:\n  Experian: 690 — Pulled by: Chase\nActive Negatives: 2 unique accounts";
  it("keeps the page/session prefix and strips the credit body for non-funding", () => {
    const out = sanitizeClientContextForTier(creditCtx, false);
    expect(out).toContain("Current page: Dashboard");
    expect(CREDIT_DENYLIST.test(out)).toBe(false);
    expect(out).not.toContain("Bureau Scores");
  });
  it("passes credit through untouched for a funding tenant", () => {
    expect(sanitizeClientContextForTier(creditCtx, true)).toBe(creditCtx);
  });
});

// ===========================================================================
// #184 KILL — the persona SCOPE/lane guard is DATA-DRIVEN. These are the
// load-bearing both-directions assertions: the SAME edge code (buildPaigePersonaBlock
// / buildLaneGuardSection), fed two different installed-Blueprint DATA sets, keeps a
// coaching/consulting tenant credit-CLEAN AND puts credit IN-scope for a funding
// tenant — with ZERO vertical named in the edge code. The distinction lives entirely
// in playbook_config.refusal_boundaries (the installed Blueprint's data).
// ===========================================================================

// The credit-clean refusal_boundaries a horizontal (consulting) Blueprint ships —
// mirrors the consulting v1.0.0 manifest (20260805120000).
const CONSULTING_BOUNDARIES = [
  "Don't give licensed legal, tax, or accounting advice — route those to a qualified professional.",
  "Stay inside this engagement's agreed scope; if the client asks for work beyond it, flag a change order to the team rather than absorbing it silently.",
  "Never commit the consultant to a deliverable, deadline, or price without explicit approval.",
  "Never fabricate a result, a delivered output, or a meeting that didn't happen.",
  "Keep every client's and every engagement's information strictly separate.",
];

// The refusal_boundaries the funding Blueprint ships — DECLARE credit/capital in-scope
// (mirrors the funding v1.1.0 manifest).
const FUNDING_BOUNDARIES = [
  "Credit, business credit, funding, lenders, and capital strategy ARE in scope for this practice — raise them when they genuinely help the client get funding-ready.",
  "You are not a licensed attorney, accountant, or investment advisor — for regulated legal, tax, or securities advice, route the client to a qualified professional.",
  "Never guarantee lender approval, a specific credit-score increase, or a funding amount — outcomes depend on the lender and the client's own profile.",
  "Dispute and credit-repair execution is handled by a separate specialist — refer that work out, don't perform it here.",
];

describe("#184 §2 — the SCOPE guard is data-driven, proven BOTH directions from Blueprint data", () => {
  it("CONSULTING (horizontal) Blueprint → credit-CLEAN persona, no vertical named", () => {
    const consultingPlaybook = {
      persona: { name: "Paige", role: "engagement assistant", domain: "business consulting", tone: "sharp" },
      probingQuestions: [{ ask: "What outcome must this engagement deliver?", captures: "objective" }],
      journey: [{ label: "Discovery", description: "Scope and stakeholders" }],
      refusal_boundaries: CONSULTING_BOUNDARIES,
    };
    // financeInScope=false — a consulting tenant never opts into finance.
    const persona = buildPaigePersonaBlock(consultingPlaybook, "Northstar Consulting", false, null);

    // The tenant's OWN boundaries lead — the data-driven SCOPE section is present…
    expect(persona).toContain("SCOPE & BOUNDARIES");
    expect(persona).toContain("business consulting"); // tenant domain leads
    // …and the assembled prompt is entirely credit/funding-free (both directions of the denylist).
    expect(CREDIT_DENYLIST.test(persona)).toBe(false);
    expect(CREDIT_PROGRAM_DENYLIST.test(persona)).toBe(false);
  });

  it("FUNDING (vertical) Blueprint → credit IS in-scope, straight from the boundary DATA", () => {
    const fundingPlaybook = {
      persona: { name: "Paige", role: "funding strategist", domain: "funding and capital-raising coaching", tone: "sharp" },
      probingQuestions: [{ ask: "What are you raising capital for?", captures: "funding_objective" }],
      journey: [{ label: "Assessment", description: "Readiness reviewed" }],
      refusal_boundaries: FUNDING_BOUNDARIES,
    };
    // financeInScope=true — this tenant opted into the is_finance Blueprint.
    const persona = buildPaigePersonaBlock(fundingPlaybook, "Apex Funding", true, null);

    expect(persona).toContain("SCOPE & BOUNDARIES");
    // Credit/funding vocabulary IS present — because the Blueprint DATA declares it in-scope,
    // NOT because any vertical is hardcoded in the edge code.
    expect(CREDIT_DENYLIST.test(persona)).toBe(true);
    expect(persona).toContain("in scope for this practice");
    // And the neutral platform-default guardrail is NOT emitted when the tenant carries boundaries.
    expect(persona).not.toContain(HARD_GUARDRAIL_MARKER);
  });

  it("buildLaneGuardSection: three branches — boundaries win, then finance fallback, then neutral default", () => {
    // (a) boundaries present → data leads regardless of the finance flag.
    expect(buildLaneGuardSection({ refusal_boundaries: CONSULTING_BOUNDARIES }, "Acme", false))
      .toContain("SCOPE & BOUNDARIES");
    // (b) no boundaries + finance-in-scope → generic vertical-free note, no credit words, no neutral guardrail.
    const financeFallback = buildLaneGuardSection({}, "Acme", true);
    expect(CREDIT_DENYLIST.test(financeFallback)).toBe(false);
    expect(financeFallback).not.toContain(HARD_GUARDRAIL_MARKER);
    // (c) no boundaries + not finance → the neutral platform-default guardrail (§2), credit named only to forbid.
    const neutral = buildLaneGuardSection(null, "Acme", false);
    expect(neutral).toContain(HARD_GUARDRAIL_MARKER);
    expect(neutral.trimEnd().endsWith("does not provide.")).toBe(true); // excisable by the denylist test
  });
});

describe("#184 — deriveFinanceInScopeFromFeatures is the GENERIC no-join signal (no vertical literal)", () => {
  it("reads the generic finance_in_scope flag, true for both boolean and string 'true'", () => {
    expect(deriveFinanceInScopeFromFeatures({ finance_in_scope: true })).toBe(true);
    expect(deriveFinanceInScopeFromFeatures({ finance_in_scope: "true" })).toBe(true);
  });
  it("false for a coaching/consulting tenant — and the legacy 'funding' signals no longer flip it", () => {
    expect(deriveFinanceInScopeFromFeatures({})).toBe(false);
    expect(deriveFinanceInScopeFromFeatures(null)).toBe(false);
    // The generic no-join signal deliberately does NOT key on the vertical literal — a
    // tenant flagged only by the legacy features must be BACKFILLED to finance_in_scope
    // (the migration does this); the raw legacy keys alone do not light up this signal.
    expect(deriveFinanceInScopeFromFeatures({ playbook: "funding" })).toBe(false);
    expect(deriveFinanceInScopeFromFeatures({ enabled_skills: ["funding"] })).toBe(false);
  });
});

describe("N5 §9 Leak 3 — program vocab + dispute label come from the Playbook, no hardcoded default", () => {
  it("empty Playbook → no program sequence and a brand-free dispute label", () => {
    expect(buildFundingProgramVocab(null)).toBe("");
    expect(buildFundingProgramVocab({})).toBe("");
    const label = resolveDisputeReferralLabel(null);
    expect(label).toBe("a separate credit-repair specialist");
    expect(/Mogul/i.test(label)).toBe(false);
  });
  it("renders the tenant's OWN programs when the Playbook defines them", () => {
    const vocab = buildFundingProgramVocab({
      funding: {
        programs: [{ label: "Launch", description: "Foundation" }, { label: "Scale" }],
        dispute_referral_label: "the Peak Credit desk",
      },
    });
    expect(vocab).toContain("Launch: Foundation");
    expect(vocab).toContain("Scale");
    expect(vocab).not.toMatch(CREDIT_PROGRAM_DENYLIST); // no ACCEL/BUILD/FUND baked in
    expect(resolveDisputeReferralLabel({ funding: { dispute_referral_label: "the Peak Credit desk" } }))
      .toBe("the Peak Credit desk");
  });
});
