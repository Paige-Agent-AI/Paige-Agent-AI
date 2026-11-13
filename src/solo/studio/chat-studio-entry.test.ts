// Execute the ORIGINAL entry declarations/guard/artifact/metadata blocks. The
// harness supplies admitted runtime facts and buffered provider rounds; it does
// not claim HTTP admission, real model behavior, native authority or reload UI.
import { readFileSync } from "node:fs";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { CHAT_STUDIO_PREPARATION_PROMPT, CHAT_STUDIO_TARGET_QUESTION, createChatStudioPreparation, extractChatStudioPreparation, stripChatStudioControl } from "../../../supabase/functions/_shared/growth/chat-studio-preparation";
import { createTurnTracker, NO_TOOLS, type TurnTracker } from "../../../supabase/functions/_shared/paige-turn/reducer";
import { CLAIM_CORRECTION, claimFallback, announcesTheStep, NO_LONGER_POSSIBLE, NOTHING_RAN_NOTE, offerKind, ranNote, saysItWasDone, unbackedClaim } from "../../../supabase/functions/_shared/paige-turn/continuity";
import { decodeChunks } from "../../../supabase/functions/_shared/client-seat-reply";

const source = readFileSync("supabase/functions/paige-ai-chat/index.ts", "utf8");
const ast = ts.createSourceFile("chat.ts", source, ts.ScriptTarget.Latest, true);
const nodes: ts.Node[] = [];
function visit(node: ts.Node) { nodes.push(node); ts.forEachChild(node, visit); }
visit(ast);
function one<T extends ts.Node>(matches: T[], label: string): T {
  if (matches.length !== 1) throw Error(`Original Chat ${label} missing or ambiguous: ${matches.length}`);
  return matches[0];
}
function declaration(name: string) {
  const node = one(nodes.filter(ts.isVariableDeclaration).filter(node => node.name.getText(ast) === name), name);
  return `const ${node.getText(ast)};`;
}
const initialization = ["chatStudioPreparation", "chatStudioPromptAllowed", "liveDecisionMessages"].map(declaration).join("\n");
const sanitation = one(nodes.filter(ts.isExpressionStatement).filter(node => node.getText(ast).startsWith("chatStudioCandidate = !liveRuntimeScope")), "candidate sanitation");
if (!ts.isBlock(sanitation.parent)) throw Error("Original post-loop block missing");
const postStatements = sanitation.parent.statements;
const sanitationIndex = postStatements.indexOf(sanitation);
const postLoop = postStatements.slice(sanitationIndex).map(node => node.getText(ast)).join("\n");
if (!ts.isBreakStatement(postStatements[postStatements.length - 1])) throw Error("Original C1 post-loop break missing");
const stage = one(nodes.filter(ts.isIfStatement).filter(node => node.expression.getText(ast).startsWith("chatStudioPromptAllowed && chatStudioCandidate?.preparation")), "final Studio stage");
if (!ts.isBlock(stage.parent)) throw Error("Original artifact block missing");
const emissionStatements = stage.parent.statements;
const stageIndex = emissionStatements.indexOf(stage);
const lastArtifact = one(emissionStatements.filter(ts.isForOfStatement).filter(node => node.expression.getText(ast) === "chatStudioReferences"), "Studio artifact emission");
const artifactEmission = emissionStatements.slice(stageIndex, emissionStatements.indexOf(lastArtifact) + 1).map(node => node.getText(ast)).join("\n");
const toolHistory = one(nodes.filter(ts.isExpressionStatement).filter(node => node.getText(ast).startsWith('convo.push({ role: "assistant", content: stripChatStudioControl')), "sanitized tool history").getText(ast);
const guardConstants = ["PROSE_TERMINAL_RE", "PROSE_REFUSAL_RE", "MAX_CONTINUATIONS", "ACTION_INTENT_RE", "isActionIntent", "continuationLimitFor"].map(declaration).join("\n");
const metadata = declaration("assistantTurnMetadata");

async function execute<T>(environment: Record<string, unknown>, code: string): Promise<T> {
  const js = ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
  const run = new Function(...Object.keys(environment), `return (async () => {${js}\n})();`) as (...values: unknown[]) => Promise<T>;
  return run(...Object.values(environment));
}
const THREAD = "11111111-1111-4111-8111-111111111111", ACTOR = "22222222-2222-4222-8222-222222222222";
const TENANT = "33333333-3333-4333-8333-333333333333", INTENT = "44444444-4444-4444-8444-444444444444";
const NONCE = "55555555-5555-4555-8555-555555555555", SOURCE = "66666666-6666-4666-8666-666666666666", OTHER = "77777777-7777-4777-8777-777777777777";
const BRIEF = "Create the requested public launch page with a native enquiry form.";
const QUESTION = CHAT_STUDIO_TARGET_QUESTION;
const terminal = (brief = BRIEF) => '\n```paige_studio_brief\n' + JSON.stringify({ brief }) + '\n```';
const enc = new TextEncoder();
function round(text = QUESTION + terminal(), extra: Partial<{ finished: boolean; completed: boolean; answerEnd: string }> = {}) {
  const raw = 'event: message\nid: original-answer\ndata: ' + JSON.stringify({ id: "original", choices: [{ delta: { role: "assistant", content: text }, finish_reason: "stop" }], usage: { completion_tokens: 17 } }) + '\n\ndata: [DONE]\n\n';
  const bytes = enc.encode(raw);
  return { text, chunks: Array.from({ length: Math.ceil(bytes.length / 3) }, (_, i) => bytes.slice(i * 3, i * 3 + 3)), finished: true, completed: true, answerEnd: "complete", ...extra };
}
type Round = ReturnType<typeof round>;
type Facts = Record<string, unknown>;
type Options = {
  facts?: Facts; first?: Round; following?: Round[]; failProvider?: boolean;
  scopeFailureAt?: number; stageResult?: unknown; stageThrows?: boolean;
  beforeCheck?: () => void; afterStage?: (facts: Facts, stop: AbortController) => void;
  tracker?: (tracker: TurnTracker) => void;
};
async function world(options: Options = {}) {
  const stop = new AbortController(), events: string[] = [], calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const provider: Array<{ messages: unknown[]; reason: string }> = [], emitted: Uint8Array[] = [];
  const interactive = { superseded: false, check: async () => { events.push("interactive.check"); options.beforeCheck?.(); } };
  const tracker = createTurnTracker(NO_TOOLS); tracker.roundStarted(); options.tracker?.(tracker);
  const first = options.first ?? round(), following = [...(options.following ?? [])];
  let scopeReads = 0;
  const environment: Facts = {
    interactive, interactiveConversational: false, interactiveRecoveryReadOnly: false,
    callerTier: "tenant", calendarBookingAccountShape: "solo", customerPortal: false, scopedClientId: null,
    interactiveReceiptScope: { thread: THREAD, tenant: TENANT, intent: INTENT },
    personaCtx: { tenant_id: TENANT }, payloadThreadId: THREAD, user: { id: ACTOR }, runtimeIdentity: { requestNonce: NONCE },
    validatedData: { interactive: { kind: "message" } }, studioSessionId: null, attachedDocument: null,
    liveRuntimeScope: null, answerBinding: null, answerResume: null, resumeCalls: [], approvedConfirmations: new Set(), declinedConfirmations: [],
    req: { signal: stop.signal },
    CHAT_STUDIO_PREPARATION_PROMPT, CHAT_STUDIO_TARGET_QUESTION, createChatStudioPreparation, extractChatStudioPreparation, stripChatStudioControl,
    finalChunks: first.chunks, finalAssistantText: first.text, chatStudioCandidate: null,
    lastRoundFinished: first.finished, lastRoundCompletedAnswer: first.completed, lastRoundAnswerEnd: first.answerEnd,
    forcedTermination: false, unfinishedRound: false, liveAnswerPending: false, tenantKnowledgeScopeInvalidated: false,
    tenantKnowledgeScopeRevoked: false, proposalScopeInvalidated: false,
    requestExecutionState: { needsReview: false }, durableApprovalPause: false, durableResearchPause: false,
    queuedApprovals: [], confirmTrace: [], crmResultTrace: [], researchTrace: [], interactiveEffects: [], readLinkTrace: [],
    totalToolCalls: 0, writeAttempts: 0, classifierWrites: 0, admittedReadsGrounded: 0, continuationsUsed: 0,
    continuationFailed: false, continueContinuation: false, heldAccept: false, acceptedKind: null, stepToolsRan: [],
    turnRoute: { intent: "act" }, aiMessages: [{ role: "user", content: "Create a landing page for the launch" }],
    foreground: { standingCard: false, offer: { kind: "none" } }, convo: [{ role: "user", content: "Create a landing page for the launch" }],
    turnTracker: tracker, currentResponse: null, enc,
    CLAIM_CORRECTION, claimFallback, announcesTheStep, NO_LONGER_POSSIBLE, NOTHING_RAN_NOTE, offerKind, ranNote, saysItWasDone,
    unbackedClaim: (...args: Parameters<typeof unbackedClaim>) => { events.push("guard.claim"); return unbackedClaim(...args); },
    escalateTurn: (why: string) => events.push(`escalate:${why}`), roundClassNow: () => "reasoning", roundTools: () => [], traceFor: (reason: string) => ({ reason }),
    noteFabric: (_why: string, value: unknown) => value, revalidateTurnProvider: async () => true,
    fabricChatStream: async (_class: unknown, input: { messages: unknown[] }, settings: { trace: { reason: string }; beforeProviderAttempt: () => Promise<boolean> }) => {
      events.push(`provider:${settings.trace.reason}`); provider.push({ messages: input.messages, reason: settings.trace.reason });
      if (!await settings.beforeProviderAttempt()) return { ok: false };
      return options.failProvider || !following.length ? { ok: false } : { ok: true, round: following.shift() };
    },
    takeProviderRound: (response: { round: Round }) => { tracker.roundStarted(); return response.round; },
    chatStudioReferences: [], chatArtifacts: [], controller: {}, emitContent: (_controller: unknown, bytes: Uint8Array) => emitted.push(bytes),
    stepTrace: [], payloadRequestIntentId: INTENT, crmResultReferenceMetadata: () => ({}), readRecordLinks: (links: unknown) => links,
    researchLimitFallbackCopy: () => "Existing research fallback",
    ...options.facts,
  };
  environment.supabase = { rpc: async (name: string, args: Record<string, unknown>) => {
    calls.push({ name, args }); events.push(`native:${name}`);
    if (name === "chat_studio_scope") return { data: ++scopeReads === options.scopeFailureAt ? { ok: false } : { ok: true, source_turn_id: SOURCE }, error: null };
    if (name !== "chat_stage_studio_brief") throw Error(`Unexpected native operation: ${name}`);
    options.afterStage?.(environment, stop);
    if (options.stageThrows) throw Error("native response lost");
    return { data: Object.prototype.hasOwnProperty.call(options, "stageResult") ? options.stageResult : { ok: true, source_turn_id: SOURCE, outcome: "staged" }, error: null };
  } };
  const initialized = await execute<{ chatStudioPreparation: ReturnType<typeof createChatStudioPreparation>; chatStudioPromptAllowed: boolean; liveDecisionMessages: (messages: unknown[]) => unknown[] }>(environment,
    initialization + "\nreturn { chatStudioPreparation, chatStudioPromptAllowed, liveDecisionMessages };");
  Object.assign(environment, initialized);
  const run = async () => execute<{
    finalAssistantText: string; finalChunks: Uint8Array[] | null; chatStudioCandidate: ReturnType<typeof extractChatStudioPreparation> | null;
    chatStudioReferences: unknown[]; saved: { surfaces: unknown[]; bundleRef: Record<string, unknown> | null }; continuationsUsed: number;
  }>(environment, `${guardConstants}
    for (let pass = 0; pass < 6; pass++) {
      if (pass > 0) {
        const next = takeProviderRound(currentResponse);
        finalChunks = next.chunks; finalAssistantText = next.text; lastRoundFinished = next.finished;
        lastRoundCompletedAnswer = next.completed; lastRoundAnswerEnd = next.answerEnd;
      }
      ${postLoop}
    }
    ${artifactEmission}
    ${metadata}
    return { finalAssistantText, finalChunks, chatStudioCandidate, chatStudioReferences, saved: assistantTurnMetadata(), continuationsUsed };
  `);
  return { environment, initialized, stop, events, calls, provider, emitted, tracker, run };
}
function artifacts(bytes: Uint8Array[]) {
  return decodeChunks(bytes).split("\n\n").filter(Boolean).map(record => JSON.parse(record.slice("data: ".length)).paige_artifact);
}

describe("original Chat optional preparation admission", () => {
  it("clones eligible decision messages without altering their history or adding a tool", async () => {
    const w = await world(), messages = Object.freeze([{ role: "user", content: "Create the public launch page" }]);
    const decorated = w.initialized.liveDecisionMessages(messages as unknown as unknown[]);
    expect(decorated).not.toBe(messages); expect(decorated.slice(0, -1)).toEqual(messages);
    expect(decorated.at(-1)).toEqual({ role: "system", content: CHAT_STUDIO_PREPARATION_PROMPT });
    expect(messages).toHaveLength(1); expect(w.calls).toEqual([{ name: "chat_studio_scope", args: { p_thread: THREAD, p_actor: ACTOR, p_tenant: TENANT, p_intent: INTENT, p_request_nonce: NONCE } }]);
  });
  it.each([
    ["no admitted lease", { interactive: null }], ["conversational/degraded", { interactiveConversational: true }],
    ["recovery", { interactiveRecoveryReadOnly: true }], ["operator", { callerTier: "platform" }],
    ["agency shape", { calendarBookingAccountShape: "agency" }], ["customer portal", { customerPortal: true }],
    ["client scope", { scopedClientId: OTHER }], ["Studio", { studioSessionId: OTHER }],
    ["document", { attachedDocument: {} }], ["Live", { liveRuntimeScope: {} }], ["answer binding", { answerBinding: {} }],
    ["approval resume", { resumeCalls: [{}] }], ["accepted approval", { approvedConfirmations: new Set([OTHER]) }],
    ["declined approval", { declinedConfirmations: [OTHER] }],
    ["research resume", { validatedData: { interactive: { kind: "message" }, researchResume: {} } }],
    ["request resume", { validatedData: { interactive: { kind: "message" }, resume: {} } }],
    ["answer request", { validatedData: { interactive: { kind: "answer" } } }],
    ["workspace mismatch", { interactiveReceiptScope: { thread: THREAD, tenant: OTHER, intent: INTENT } }],
    ["thread mismatch", { interactiveReceiptScope: { thread: OTHER, tenant: TENANT, intent: INTENT } }],
    ["noncanonical nonce", { runtimeIdentity: { requestNonce: "caller-authored" } }],
  ])("does not attach preparation guidance or call its native scope for %s", async (_label, facts) => {
    const w = await world({ facts: facts as Facts }), messages = [{ role: "user", content: "Create the public launch page" }];
    const decorated = w.initialized.liveDecisionMessages(messages);
    expect(w.initialized.chatStudioPromptAllowed).toBe(false); expect(w.calls).toHaveLength(0);
    expect(decorated).not.toContainEqual({ role: "system", content: CHAT_STUDIO_PREPARATION_PROMPT });
    if (!(facts as Facts).liveRuntimeScope) expect(decorated).toBe(messages);
    const result = await w.run(); expect(result.chatStudioReferences).toEqual([]);
  });
  it("native unavailable admission keeps the same ordinary messages and emits no pointer", async () => {
    const w = await world({ scopeFailureAt: 1 }), messages = [{ role: "user", content: "Public page" }];
    expect(w.initialized.liveDecisionMessages(messages)).toBe(messages);
    expect((await w.run()).chatStudioReferences).toEqual([]); expect(w.calls.map(call => call.name)).toEqual(["chat_studio_scope"]);
  });
});

describe("original sanitation → unchanged guards → final source pointer", () => {
  it("stages only after original verdicts, preserving opaque answer frames and exact reload reference", async () => {
    const generic = { artifactType: "document", kind: "document", id: OTHER, title: "Existing deliverable", url: null };
    const w = await world({ facts: { chatArtifacts: [generic], stepTrace: [{ kind: "thought", group: "hidden" }, { kind: "action", group: "owner" }] } });
    const result = await w.run();
    expect(result.finalAssistantText).toBe(QUESTION); expect(result.continuationsUsed).toBe(0); expect(w.provider).toEqual([]);
    const stageCalls = w.calls.filter(call => call.name === "chat_stage_studio_brief");
    expect(stageCalls).toEqual([{ name: "chat_stage_studio_brief", args: { p_thread: THREAD, p_actor: ACTOR, p_tenant: TENANT, p_intent: INTENT, p_request_nonce: NONCE, p_brief: BRIEF } }]);
    expect(w.events.indexOf("native:chat_stage_studio_brief")).toBeGreaterThan(w.events.lastIndexOf("guard.claim"));
    const pointer = { artifactType: "studio", kind: "studio_source", id: SOURCE, title: "Studio brief", url: null, tenant_id: TENANT };
    expect(artifacts(w.emitted)).toEqual([generic, pointer]);
    expect(result.saved.surfaces).toEqual(["owner"]); expect(result.saved.bundleRef?.paige_artifact).toEqual([pointer]);
    expect(JSON.stringify(result.saved)).not.toContain(BRIEF); expect(JSON.stringify(result.saved)).not.toMatch(/session_id|receipt/);
    const wire = decodeChunks(result.finalChunks!);
    expect(wire).toContain('"usage":{"completion_tokens":17}'); expect(wire).toContain('"finish_reason":"stop"'); expect(wire).toContain("id: original-answer");
    expect(wire).toContain("data: [DONE]"); expect(wire).not.toContain("studio_brief");
  });
  it("keeps the original unresolved-action continuation verdict when only control is removed", async () => {
    const ordinary = "I will prepare that design now.";
    const baseline = await world({ first: round(ordinary), failProvider: true });
    // A question inside reserved JSON must not make narration a terminal prose
    // clarification; the ordinary reply still needs the SAME C1 continuation.
    const controlled = await world({ first: round(ordinary + terminal("Should the launch page use a form?")), failProvider: true });
    const [before, after] = await Promise.all([baseline.run(), controlled.run()]);
    expect(controlled.provider.map(call => call.reason)).toEqual(baseline.provider.map(call => call.reason));
    expect(controlled.provider).toHaveLength(1); expect(after.finalAssistantText).toBe(before.finalAssistantText);
    expect(after.continuationsUsed).toBe(before.continuationsUsed); expect(controlled.tracker.state).toBe(baseline.tracker.state);
    expect(after.chatStudioReferences).toEqual([]); expect(controlled.calls.some(call => call.name === "chat_stage_studio_brief")).toBe(false);
    expect((controlled.provider[0].messages as Array<{ role: string; content: unknown }>).filter(message => message.role === "assistant")).toEqual([{ role: "assistant", content: ordinary }]);
  });
  it.each([
    "I created the landing page.", "Your page is published and live.", "Your Studio project is saved.",
  ])("does not promote false completion prose to a Studio pointer: %s", async claim => {
    const text = `${claim} ${QUESTION}`;
    const baseline = await world({ first: round(text) }), controlled = await world({ first: round(text + terminal()) });
    const [before, after] = await Promise.all([baseline.run(), controlled.run()]);
    expect(after.finalAssistantText).toBe(before.finalAssistantText); expect(after.finalAssistantText).toBe(text);
    expect(controlled.provider).toEqual(baseline.provider); expect(controlled.tracker.state).toBe(baseline.tracker.state);
    expect(after.chatStudioReferences).toEqual([]); expect(after.saved.bundleRef).toBeNull();
    expect(controlled.calls.filter(call => call.name === "chat_stage_studio_brief")).toHaveLength(0);
  });
  it("keeps original unbacked-card correction/fallback ahead of any attempted stage", async () => {
    const ordinary = "The approval card is ready. Which project is this for?";
    const beforeWorld = await world({ first: round(ordinary), failProvider: true });
    const afterWorld = await world({ first: round(ordinary + terminal()), failProvider: true });
    const [before, after] = await Promise.all([beforeWorld.run(), afterWorld.run()]);
    expect(afterWorld.provider.map(call => call.reason)).toEqual(["chat-claim-correction"]);
    expect(after.finalAssistantText).toBe(before.finalAssistantText); expect(after.finalAssistantText).not.toContain("card is ready");
    expect(after.chatStudioReferences).toEqual([]); expect(afterWorld.calls.filter(call => call.name === "chat_stage_studio_brief")).toEqual([]);
  });
  it("retains only the final provider round candidate after a real C1 continuation", async () => {
    const w = await world({ first: round("I will prepare that now." + terminal("Outdated first brief")), following: [round(QUESTION + terminal("Final requested public design"))] });
    const result = await w.run(); expect(w.provider.map(call => call.reason)).toEqual(["chat-continuation"]);
    expect(result.finalAssistantText).toBe(QUESTION); expect(result.chatStudioReferences).toHaveLength(1);
    expect(w.calls.filter(call => call.name === "chat_stage_studio_brief").map(call => call.args.p_brief)).toEqual(["Final requested public design"]);
  });
  it("does not stage when an original prose backstop changes a completed candidate answer", async () => {
    const w = await world({ first: round("I've created the landing page. Which project is this for?" + terminal()), facts: { acceptedKind: "prose" } });
    const result = await w.run();
    expect(result.finalAssistantText).toContain(NOTHING_RAN_NOTE); expect(w.tracker.state).toBe("FINAL");
    expect(result.chatStudioReferences).toEqual([]); expect(w.calls.filter(call => call.name === "chat_stage_studio_brief")).toHaveLength(0);
  });
  it.each([
    ["duplicate fence", QUESTION + terminal() + terminal()], ["partial fence", QUESTION + terminal().slice(0, -2)],
    ["extra metadata", QUESTION + '\n```paige_studio_brief\n{"brief":"Design","session_id":"invented"}\n```'],
  ])("sanitizes %s but never stages it", async (_name, text) => {
    const w = await world({ first: round(text) }), result = await w.run();
    expect(result.finalAssistantText).toBe(QUESTION); expect(result.chatStudioReferences).toEqual([]);
    expect(decodeChunks(result.finalChunks!)).not.toContain("studio_brief"); expect(w.calls.some(call => call.name === "chat_stage_studio_brief")).toBe(false);
  });
  it("strips control from the actual tool-history append and cannot stage after any tool in the turn", async () => {
    const history = await execute<{ convo: unknown[] }>({ convo: [], content: "Tool narration." + terminal(), stripChatStudioControl, askAlongside: false, executed: [{ id: "real-tool" }], chooseTc: null }, toolHistory + "\nreturn { convo };");
    expect(history.convo).toEqual([{ role: "assistant", content: "Tool narration.", tool_calls: [{ id: "real-tool" }] }]);
    const w = await world({ facts: { totalToolCalls: 1 } }), result = await w.run();
    expect(result.chatStudioReferences).toEqual([]); expect(w.calls.some(call => call.name === "chat_stage_studio_brief")).toBe(false);
  });
  it.each([
    ["unfinished", { first: round(undefined, { finished: false }) }], ["not completed", { first: round(undefined, { completed: false }) }],
    ["limited", { first: round(undefined, { answerEnd: "limited" }) }], ["refused", { first: round(undefined, { answerEnd: "refused" }) }],
    ["partial tool round", { facts: { unfinishedRound: true } }], ["forced close", { facts: { forcedTermination: true } }],
    ["scope invalidated", { facts: { tenantKnowledgeScopeInvalidated: true } }], ["proposal invalidated", { facts: { proposalScopeInvalidated: true } }],
    ["scope revoked", { facts: { tenantKnowledgeScopeRevoked: true } }], ["needs review", { facts: { requestExecutionState: { needsReview: true } } }],
    ["approval pause", { facts: { durableApprovalPause: true } }], ["research pause", { facts: { durableResearchPause: true } }],
    ["effect unknown", { facts: { interactiveEffects: [{ outcome: "outcome_unknown" }] } }],
    ["approval pending", { facts: { queuedApprovals: [{}] } }], ["confirmation pending", { facts: { confirmTrace: [{}] } }],
    ["tracker interrupted", { tracker: (tracker: TurnTracker) => tracker.interrupted() }],
    ["tracker budget stopped", { tracker: (tracker: TurnTracker) => tracker.budgetStop() }],
    ["tracker asking", { tracker: (tracker: TurnTracker) => tracker.choicesAsked() }],
  ])("withholds preparation for %s without forcing a successful turn", async (_label, options) => {
    const w = await world(options as Options), result = await w.run();
    expect(result.chatStudioReferences).toEqual([]); expect(w.calls.some(call => call.name === "chat_stage_studio_brief")).toBe(false);
  });
  it.each([null, { ok: false }, { ok: true, source_turn_id: OTHER, outcome: "staged" }])("never retries an UNKNOWN/spoofed stage result %j", async stageResult => {
    const w = await world({ stageResult }), result = await w.run();
    expect(w.calls.filter(call => call.name === "chat_stage_studio_brief")).toHaveLength(1);
    expect(result.chatStudioReferences).toEqual([]); expect(result.saved.bundleRef).toBeNull();
    expect(await w.initialized.chatStudioPreparation.stage({ brief: BRIEF })).toBeNull();
    expect(w.calls.filter(call => call.name === "chat_stage_studio_brief")).toHaveLength(1);
  });
  it("does not retry a lost native stage response", async () => {
    const w = await world({ stageThrows: true }), result = await w.run();
    expect(result.chatStudioReferences).toEqual([]); expect(w.calls.filter(call => call.name === "chat_stage_studio_brief")).toHaveLength(1);
  });
  it.each([2, 3])("withholds native pointer when current scope is lost at scope read %i", async scopeFailureAt => {
    const w = await world({ scopeFailureAt }), result = await w.run();
    expect(result.chatStudioReferences).toEqual([]); expect(result.saved.bundleRef).toBeNull();
    expect(w.calls.filter(call => call.name === "chat_stage_studio_brief")).toHaveLength(scopeFailureAt === 2 ? 0 : 1);
  });
  it("Stop before the final emission gate prevents native staging", async () => {
    const w = await world(); w.stop.abort(); const result = await w.run();
    expect(result.chatStudioReferences).toEqual([]); expect(w.calls.filter(call => call.name === "chat_stage_studio_brief")).toHaveLength(0);
  });
  it("Stop while native staging is in flight withholds the late pointer", async () => {
    const w = await world({ afterStage: (_facts, stop) => stop.abort() }), result = await w.run();
    expect(result.chatStudioReferences).toEqual([]); expect(w.calls.filter(call => call.name === "chat_stage_studio_brief")).toHaveLength(1);
  });
  it("a superseding turn during native staging withholds the confirmed pointer", async () => {
    const w = await world({ afterStage: facts => { (facts.interactive as { superseded: boolean }).superseded = true; } }), result = await w.run();
    expect(result.chatStudioReferences).toEqual([]); expect(result.saved.bundleRef).toBeNull();
    expect(w.calls.filter(call => call.name === "chat_stage_studio_brief")).toHaveLength(1);
  });
  it("a superseded lease before emission never calls the native stage", async () => {
    const w = await world(); (w.environment.interactive as { superseded: boolean }).superseded = true;
    const result = await w.run(); expect(result.chatStudioReferences).toEqual([]);
    expect(w.calls.filter(call => call.name === "chat_stage_studio_brief")).toHaveLength(0);
  });
});
