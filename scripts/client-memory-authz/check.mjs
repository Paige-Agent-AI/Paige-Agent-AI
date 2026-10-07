/**
 * P1 — CROSS-CLIENT MEMORY AUTHORIZATION.
 *
 * `paige-ai-chat` loaded client memory with the SERVICE-ROLE client, keyed on the
 * request-body `clientId`. Service role means `auth.uid()` is NULL, so RLS and every
 * SECURITY DEFINER caller-guard are exempt BY CONSTRUCTION — a caller could name any client
 * UUID and receive that client's memories, preferences and past chat snippets, injected
 * verbatim into the prompt.
 *
 * These checks drive the REAL shipped handler with a real `Request`. Only the module
 * boundary is faked (Deno's serve, @supabase/supabase-js, the Voyage fetch). Nothing here
 * passes on a string match against source.
 *
 * Run: node --import ./scripts/client-memory-authz/register.mjs scripts/client-memory-authz/check.mjs
 */

import { readFileSync } from "node:fs";
import { AsyncLocalStorage } from "node:async_hooks";
const modelTurnState = new AsyncLocalStorage();

const USER    = "44444444-4444-4444-8444-444444444444";
const OWN     = "55555555-5555-4555-8555-555555555555"; // a client this caller may read
const FOREIGN = "66666666-6666-4666-8666-666666666666"; // another tenant's client
const NULLTEN = "77777777-7777-4777-8777-777777777777"; // client row with tenant_id NULL
const OTHERTEN = "88888888-8888-4888-8888-888888888888"; // visible via a non-tenant policy, other workspace
const CALLER_TENANT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OTHER_TENANT  = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const LIVE_TEST_SIGNING_KEY = "local-harness-only-live-signing-key-000000000000";

/** Tenant-neutral on purpose: survives `sanitizeClientContextForTier` for a non-funding tenant,
 *  so a missing block means the GUARD dropped it, not the sanitizer. */
const CLIENT_CTX = "Focused client file: current stage is onboarding, last review 12 days ago.";

const VECTOR = Array.from({ length: 1024 }, (_, i) => (i % 7) / 10);

let failures = 0, checks = 0;
function assert(label, cond, detail) {
  checks += 1;
  if (cond) console.log(`  ok   ${label}`);
  else { failures += 1; console.log(`  FAIL ${label}`); if (detail !== undefined) console.log(`         ${detail}`); }
}

globalThis.Deno = {
  env: { get: (k) => ({
    SUPABASE_URL: "https://test.supabase.co", SUPABASE_ANON_KEY: "anon-key",
    SUPABASE_SERVICE_ROLE_KEY: "service-role-key", VOYAGE_API_KEY: "test-voyage-key",
    ANTHROPIC_API_KEY: "test-anthropic-key",
    PAIGE_LIVE_STREAM_SIGNING_KEY: LIVE_TEST_SIGNING_KEY,
  })[k] ?? "" },
};

let embedCount = 0;
/**
 * OFF by default. With no model stub every turn 500s before the response stream is built, so
 * anything the handler EMITS to the caller is unobservable — which is why the refusal signal
 * could not be witnessed at first. Turning it on per-scenario keeps every existing check
 * driving the exact same path it drove before, while making the stream itself drivable.
 */
let modelStub = false;
/** What `runDocumentReadCheck` should answer. Set per scenario to reach the credit-report branch. */
let readCheckReply = { can_read_document: false, document_kind: "other", first_five_account_names: [] };

/**
 * THE TURN FRAME, AUDITED ON EVERY STREAM THIS HARNESS DRIVES (docs/delivery/paige-conversational-loop-c1.md).
 * Every drive below that reaches a stream is checked here, so the frame's rules are held across the
 * whole suite — refusals, documents, confirm cards, client seats, Live — not only on the few scenarios
 * written for it. Findings are collected and asserted once, in the paige_turn group at the end.
 */
const { isTurnFrame, readTurnRecord } = await import("../../supabase/functions/_shared/paige-turn/contract.ts");
const { auditTurnStream, wireAnswerMatchesSaved } = await import("../lib/audit-turn-frames.mjs");
const turnAudit = { streams: 0, violations: [], withheld: 0, confirms: 0, refused: 0, persisted: 0, traced: 0, thoughtsBesideTrace: 0, answersCompared: 0, answerMismatches: [], stepsStarted: 0, stepsWithdrawn: 0, stepsClosedAfterStart: 0 };
function auditTurnFrames(label, responses, rec, narration) {
  const wireThoughts = new Set();
  for (const response of responses) {
    if (response.status !== 200) continue;
    // The structural rules (started first and once, one terminal ahead of the answer and [DONE],
    // withheld ends WITHHELD) are the shared auditor's; this harness adds refusals and confirm cards.
    // A stream that errored part-way (a Live turn ending without its signed `done`) is audited on what
    // reached the wire before the error.
    const audit = auditTurnStream(response.bodyText || response.partialText, { isTurnFrame });
    if (!audit) continue;
    turnAudit.streams += 1;
    for (const why of audit.violations) turnAudit.violations.push(`${label}: ${why}`);
    for (const it of audit.items) if (it.f?.paige_step?.kind === "thought") wireThoughts.add(it.f.paige_step.label);
    // C2b — what the step-lifecycle rules (in the shared auditor) actually got to read.
    const started = new Set(audit.items.filter((it) => it.f?.paige_step?.status === "running").map((it) => it.f.paige_step.id));
    turnAudit.stepsStarted += started.size;
    for (const it of audit.items) {
      const st = it.f?.paige_step;
      if (!st || st.status === "running" || !started.has(st.id)) continue;
      if (st.status === "withdrawn") turnAudit.stepsWithdrawn += 1;
      else turnAudit.stepsClosedAfterStart += 1;
    }
    if (!audit.terminal) continue;
    const bad = (why) => turnAudit.violations.push(`${label}: ${why}`);
    const { t } = audit.terminal;
    if (audit.has("paige_withheld")) turnAudit.withheld += 1;
    if (audit.has("client_scope")) {
      turnAudit.refused += 1;
      if (t.state !== "REFUSED") bad(`a client-scope refusal's terminal is ${t.state}`);
    }
    if (audit.has("paige_confirm") && !audit.has("paige_withheld") && t.state !== "INTERRUPTED") {
      turnAudit.confirms += 1;
      if (t.state !== "WAIT_APPROVAL" || t.event !== "waiting") bad(`a turn that issued a confirm card ended ${t.event}/${t.state}`);
    }
  }
  // THE WIRE AND THE TRANSCRIPT CARRY THE SAME ANSWER (§13/§94): on a drive with one answered stream
  // and one saved assistant turn, what a reader got up to the first [DONE] is exactly what the thread
  // kept, and no reply text follows that [DONE].
  const savedAnswers = rec.rpc.filter((c) => c.name === "paige_chat_turn_append" && c.args?.p_role === "assistant");
  const answered = responses.filter((r) => r.status === 200);
  if (savedAnswers.length === 1 && answered.length === 1) {
    turnAudit.answersCompared += 1;
    const why = wireAnswerMatchesSaved(answered[0].bodyText || answered[0].partialText || "", savedAnswers[0].args?.p_content);
    if (why) turnAudit.answerMismatches.push(`${label}: ${why}`);
  }
  for (const call of rec.rpc.filter((c) => c.name === "paige_chat_turn_append" && c.args?.p_role === "assistant")) {
    const b = call.args.p_bundle_ref;
    const bad = (why) => turnAudit.violations.push(`${label} (persisted): ${why}`);
    if (!String(call.args.p_content ?? "").trim() && !b) continue; // the persist gate: nothing to record
    const state = b?.turn_state;
    if (!state) { bad(`an assistant turn persisted with no turn_state: ${JSON.stringify(b)?.slice(0, 120)}`); continue; }
    turnAudit.persisted += 1;
    const extra = Object.keys(state).filter((k) => !["v", "state", "mode", "rounds", "tools", "waiting_on", "resumed"].includes(k));
    if (extra.length || JSON.stringify(readTurnRecord(state)) !== JSON.stringify(state)) bad(`turn_state outside the contract: ${JSON.stringify(state)}`);
    if (b.turn_trace !== undefined) {
      turnAudit.traced += 1;
      const trace = b.turn_trace;
      if (!Array.isArray(trace) || trace.some((e) => !e || Object.keys(e).sort().join() !== "group,label,status")) bad(`turn_trace outside the contract: ${JSON.stringify(trace)}`);
      const text = JSON.stringify(trace);
      if (narration && text.includes(narration)) bad("turn_trace carries the model's narration");
      for (const thought of wireThoughts) if (text.includes(thought)) bad(`turn_trace carries a thought: ${thought}`);
      if (wireThoughts.size) turnAudit.thoughtsBesideTrace += 1;
    }
  }
}
/** When set, the FIRST streamed round emits a tool call instead of an answer. */
let toolCallOnce = false;
/** The text PAIGE's streamed answer carries. "ok" unless a scenario scripts what she says — which is
 *  how a check sees a reply at all: every other check here is about what she was SENT. */
let scriptedReply = "ok";
/** What the credit report's structured extraction returns this drive; null answers "ok", as before. */
let extractionReplyText = null;
/** When set, the model stub asserts `confirm: true` the moment it is told approval is needed —
 *  a model approving on the operator's behalf, which is the thing the gate has to survive. */
let selfApprove = false;
let selfApproveReplays = 0;
let toolCallSpec = { name: "update_client_data", args: {} };
/** What the model writes BEFORE its tool call in that round — her narration, which becomes a thought
 *  line. Empty unless a scenario scripts one. */
let toolRoundText = "";
/** Every request body sent to the model this turn — the real prompt/model EGRESS surface. */
let modelEgress = [];
/** Every non-model outbound call this turn — the sibling-function surface (write-back, sync). */
let outboundCalls = [];
/** How `paige-write-back` answers this drive, as `{ status, body }`; unset, it answers success. */
let writeBackAnswer = null;
/** How `fetch-url-content` answers this drive, as `{ status, body }`; unset, it answers a bare success. */
let fetchUrlAnswer = null;
/** How any other sibling function answers this drive, by URL fragment; unset, a bare success. */
let otherOutboundAnswers = null;
/**
 * An Anthropic-native tool_use stream. `gatewayCompat` converts it to OpenAI-compat deltas, so
 * the handler's agentic loop sees a real tool call. Without this the whole tool loop — where
 * Paige acts on the focused client — was unreachable by any check.
 */
// `ending` (INT-334 R7): "tool_use" is a finished tool round; "max_tokens" / "refusal" end it on that stop
// reason instead; "cut" ends the stream with no message_delta or message_stop at all (a broken round).
const sseToolCallReply = (name, args, text = "", id = "toolu_test", ending = "tool_use") =>
  new Response(
    [
      `event: message_start\ndata: ${JSON.stringify({ type: "message_start", message: { usage: { input_tokens: 1, output_tokens: 1 } } })}\n\n`,
      ...(text ? [
        `event: content_block_start\ndata: ${JSON.stringify({ type: "content_block_start", index: 0, content_block: { type: "text", text: "" } })}\n\n`,
        `event: content_block_delta\ndata: ${JSON.stringify({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text } })}\n\n`,
        `event: content_block_stop\ndata: ${JSON.stringify({ type: "content_block_stop", index: 0 })}\n\n`,
      ] : []),
      `event: content_block_start\ndata: ${JSON.stringify({ type: "content_block_start", index: text ? 1 : 0, content_block: { type: "tool_use", id, name } })}\n\n`,
      `event: content_block_delta\ndata: ${JSON.stringify({ type: "content_block_delta", index: text ? 1 : 0, delta: { type: "input_json_delta", partial_json: typeof args === "string" ? args : JSON.stringify(args) } })}\n\n`,
      ...(ending === "cut" ? [] : [
        `event: message_delta\ndata: ${JSON.stringify({ type: "message_delta", delta: { stop_reason: ending } })}\n\n`,
        `event: message_stop\ndata: ${JSON.stringify({ type: "message_stop" })}\n\n`,
      ]),
    ].join(""),
    { status: 200, headers: { "Content-Type": "text/event-stream" } },
  );

/**
 * SEVERAL tool calls in ONE round (C2b): one tool_use block per spec, in order. A spec may carry its
 * own `id` (an empty string models a provider that omits it); otherwise `<id>_<n>`. A spec's `rawArgs`
 * is sent as the arguments text verbatim, so a drive can model a provider that cut them off mid-JSON.
 */
const sseToolCallsReply = (specs, text = "", id = "toolu_test") => {
  const lead = text ? 1 : 0;
  return new Response(
    [
      `event: message_start\ndata: ${JSON.stringify({ type: "message_start", message: { usage: { input_tokens: 1, output_tokens: 1 } } })}\n\n`,
      ...(text ? [
        `event: content_block_start\ndata: ${JSON.stringify({ type: "content_block_start", index: 0, content_block: { type: "text", text: "" } })}\n\n`,
        `event: content_block_delta\ndata: ${JSON.stringify({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text } })}\n\n`,
        `event: content_block_stop\ndata: ${JSON.stringify({ type: "content_block_stop", index: 0 })}\n\n`,
      ] : []),
      ...specs.flatMap((spec, n) => [
        `event: content_block_start\ndata: ${JSON.stringify({ type: "content_block_start", index: lead + n, content_block: { type: "tool_use", id: spec.id ?? `${id}_${n}`, name: spec.name } })}\n\n`,
        `event: content_block_delta\ndata: ${JSON.stringify({ type: "content_block_delta", index: lead + n, delta: { type: "input_json_delta", partial_json: spec.rawArgs ?? JSON.stringify(spec.args ?? {}) } })}\n\n`,
        `event: content_block_stop\ndata: ${JSON.stringify({ type: "content_block_stop", index: lead + n })}\n\n`,
      ]),
      `event: message_delta\ndata: ${JSON.stringify({ type: "message_delta", delta: { stop_reason: "tool_use" } })}\n\n`,
      `event: message_stop\ndata: ${JSON.stringify({ type: "message_stop" })}\n\n`,
    ].join(""),
    { status: 200, headers: { "Content-Type": "text/event-stream" } },
  );
};

const sseModelReply = (text) =>
  new Response(
    [
      `data: ${JSON.stringify({ type: "message_start", message: { usage: { input_tokens: 1, output_tokens: 1 } } })}\n\n`,
      `data: ${JSON.stringify({ type: "content_block_delta", delta: { type: "text_delta", text } })}\n\n`,
      `data: ${JSON.stringify({ type: "message_delta", delta: { stop_reason: "end_turn" } })}\n\n`,
      `data: ${JSON.stringify({ type: "message_stop" })}\n\n`,
    ].join(""),
    { status: 200, headers: { "Content-Type": "text/event-stream" } },
  );

/** A streamed answer that gets `text` out (none when empty) and then the connection resets. Pull-
 *  driven, so its events are read before the error (an error raised in `start` discards them). */
const sseBreakingReply = (text) => {
  const events = [`data: ${JSON.stringify({ type: "message_start", message: { usage: { input_tokens: 1, output_tokens: 1 } } })}\n\n`];
  if (text) events.push(`data: ${JSON.stringify({ type: "content_block_delta", delta: { type: "text_delta", text } })}\n\n`);
  const bytes = new TextEncoder().encode(events.join(""));
  let sent = false;
  return new Response(new ReadableStream({
    pull(c) { if (!sent) { sent = true; c.enqueue(bytes); } else c.error(new Error("fixture: upstream connection reset")); },
  }), { status: 200, headers: { "Content-Type": "text/event-stream" } });
};

globalThis.fetch = async (url, init) => {
  const href = String(url);
  if (href.includes("voyageai.com")) {
    embedCount += 1;
    return new Response(JSON.stringify({ data: [{ index: 0, embedding: VECTOR }] }), {
      status: 200, headers: { "Content-Type": "application/json" },
    });
  }
  if (href.includes("anthropic.com")) modelEgress.push(String(init?.body ?? ""));
  else if (!href.includes("voyageai.com")) {
    outboundCalls.push({ url: href, body: String(init?.body ?? "") });
    const answer = href.includes("paige-write-back") && writeBackAnswer ? writeBackAnswer
      : href.includes("fetch-url-content") && fetchUrlAnswer ? fetchUrlAnswer
      : Object.entries(otherOutboundAnswers ?? {}).find(([fragment]) => href.includes(fragment))?.[1]
      ?? { status: 200, body: { success: true } };
    return new Response(JSON.stringify(answer.body), { status: answer.status, headers: { "Content-Type": "application/json" } });
  }
  if (modelStub && href.includes("anthropic.com")) {
    const wantsStream = (() => {
      try { return JSON.parse(String(init?.body ?? "{}")).stream === true; } catch { return false; }
    })();
    if (wantsStream) {
      // A PROVIDER CALL THAT FAILS. `failStreamCalls` names which of this turn's streamed model calls
      // (1-based, in order) answer 529 instead — a mid-loop round, or the closing call that would
      // carry the answer. How a scenario reaches the turn's failure endings at all.
      const failing = modelTurnState.getStore();
      if (failing) {
        failing.streamCalls = (failing.streamCalls ?? 0) + 1;
        // …or never answers at all: the request throws (a reset connection) — `throwStreamCalls`.
        if (failing.throwStreamCalls?.includes(failing.streamCalls)) throw new TypeError("fixture: connection reset by peer");
        if (failing.failStreamCalls?.includes(failing.streamCalls)) {
          return new Response(JSON.stringify({ type: "error", error: { type: "overloaded_error", message: "fixture overloaded" } }),
            { status: failing.failStreamStatus ?? 529, headers: { "Content-Type": "application/json" } });
        }
        // A provider call that answers 200 and then BREAKS (paige-turn). `breakStreamCalls` maps a call
        // number to the text it gets out first ("" = before any text). The translator catches the
        // reset and still ends the stream with a clean [DONE]; only the finish_reason is missing.
        if (failing.breakStreamCalls && Object.hasOwn(failing.breakStreamCalls, failing.streamCalls)) {
          return sseBreakingReply(failing.breakStreamCalls[failing.streamCalls]);
        }
      }
      // A MODEL THAT TRIES TO APPROVE ITSELF. It sees `needs_confirm` in the tool result it was
      // just handed — which is exactly what an LLM has in its own context — and re-emits the same
      // call with `confirm: true`, as though the operator had answered. No human, no request-body
      // echo, one round later. This is not a contrived stub: it is the cheapest thing a competent
      // model does when a tool result says "call this again with confirm: true", and a confused or
      // steered one does it without waiting.
      if (selfApprove) {
        const body = String(init?.body ?? "").replace(/\\"/g, '"');
        if (/"needs_confirm":\s*true/.test(body)) {
          selfApproveReplays += 1;
          return sseToolCallReply(toolCallSpec.name, { ...toolCallSpec.args, confirm: true });
        }
      }
      const turn = modelTurnState.getStore();
      // INT-332 — `streamScript` scripts this turn's streamed calls one by one (index 0 = call 1): a
      // string is a prose round, `{ name, args }` a tool round. A call past its end falls through.
      const scripted = turn?.streamScript && turn.streamCalls >= 1 ? turn.streamScript[turn.streamCalls - 1] : undefined;
      if (typeof scripted === "string") return sseModelReply(scripted);
      if (scripted && typeof scripted === "object") return sseToolCallReply(scripted.name, scripted.args, "", `toolu_s${turn.streamCalls}`, scripted.ending);
      if (turn ? turn.toolCallOnce : toolCallOnce) {
        // A scripted turn may call several tools, one per round, in order (`toolCall` as a list).
        const spec = turn?.next ?? toolCallSpec;
        const id = turn?.round ? `toolu_test_${turn.round}` : "toolu_test";
        if (turn?.queue?.length) { turn.next = turn.queue.shift(); turn.round += 1; }
        else if (turn) turn.toolCallOnce = false;
        else toolCallOnce = false;
        // `{ batch: [spec, …] }` is ONE round that calls several tools at once (C2b).
        if (Array.isArray(spec.batch)) return sseToolCallsReply(spec.batch, toolRoundText, id);
        return sseToolCallReply(spec.name, spec.args, toolRoundText, id, spec.ending);
      }
      return sseModelReply(scriptedReply);
    }
    // Answer the document READ-CHECK with the JSON it expects, so `isCreditReportPdf` can be
    // true and the credit-report upload branch is reachable at all. Match on the outbound body:
    // `gatewayCompat` reshapes the request to Anthropic-native before it reaches fetch, so the
    // caller's `response_format` is gone by here and cannot be used to identify the call. The
    // reply must be Anthropic-shaped too — the gateway converts it back to `choices[0].message`.
    // INT-334 R4 — the TURN CLASSIFIER (_shared/paige-turn/classify.ts). Answer it the way a real
    // classifier would for this harness's turns: a short acknowledgement or bare reply is light
    // conversation; anything else is ordinary work on this workspace's records. A scenario can
    // override per turn (`classification`), including `null` for a classifier that fails.
    if (String(init?.body ?? "").includes("You label one message sent to PAIGE")) {
      const turnState = modelTurnState.getStore();
      let reply;
      if (turnState && Object.hasOwn(turnState, "classification")) {
        reply = turnState.classification === null ? "not json" : JSON.stringify(turnState.classification);
      } else {
        const msg = (String(init?.body ?? "").match(/MESSAGE:\\n<<<\\n([\s\S]*?)\\n>>>/) ?? [])[1] ?? "";
        const light = msg.trim().split(/\s+/).length <= 3;
        reply = JSON.stringify(light
          ? { intent: "converse", research: "none", difficulty: "trivial", image: "none", needs_workspace_data: false, confidence: 0.9 }
          : { intent: "answer", research: "none", difficulty: "routine", image: "none", needs_workspace_data: true, confidence: 0.9 });
      }
      return new Response(JSON.stringify({
        id: "msg_classify", type: "message", role: "assistant", model: "test",
        content: [{ type: "text", text: reply }], stop_reason: "end_turn", usage: { input_tokens: 1, output_tokens: 1 },
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    const isReadCheck = String(init?.body ?? "").includes("verify that you can literally read the PDF");
    const isExtraction = String(init?.body ?? "").includes("Extract the structured data into the required JSON format");
    const text = isReadCheck ? JSON.stringify(readCheckReply) : isExtraction && extractionReplyText !== null ? extractionReplyText : "ok";
    return new Response(
      JSON.stringify({
        id: "msg_test", type: "message", role: "assistant", model: "test",
        content: [{ type: "text", text }],
        stop_reason: "end_turn",
        usage: { input_tokens: 1, output_tokens: 1 },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }
  throw new Error(`client-memory-authz: unexpected outbound fetch to ${href}`);
};

const fake = await import("./fake-supabase.mjs");
await import("../../supabase/functions/paige-ai-chat/index.ts");
const { capturedHandler } = await import("./stub-serve.mjs");
const handler = capturedHandler();
const issuedApproval = (row) => row?.fingerprint && /^[0-9a-f]{8}-[0-9a-f-]{27}$/.test(row.issued_in_request ?? "")
  ? `${row.fingerprint}:${row.issued_in_request}` : row?.fingerprint;

const MEMORY_TEXT = "SECRET-CLIENT-MEMORY-CONTENT";

/**
 * `clientRows` models the `clients` table AS RLS WOULD RETURN IT for this caller: OWN is
 * visible with a tenant, NULLTEN is visible but tenant-less (the `tenant_isolation` policy
 * admits `tenant_id IS NULL` to ANY authenticated user — which is exactly why the handler
 * must exclude it), FOREIGN is invisible.
 */
const NO_CLASSIFICATION = Symbol("no-classification-override");
async function drive({
  authorization = "Bearer test-jwt",
  clientId,
  clientsError = null,
  memoryReadError = null,
  text = "what do you know about me?",
  // The cross-tenant bypass. `undefined` keeps the default non-operator result; pass a full
  // `{ data, error }` to model an operator, or an errored authority check.
  ownerRpc = { data: false, error: null },
  document = undefined,
  stream = false,
  clientContext = undefined,
  readCheck = { can_read_document: false, document_kind: "other", first_five_account_names: [] },
  extraBody = undefined,
  toolCall = undefined,
  /** Per-drive RPC overrides, merged over the defaults below. Needed since `update_client_data`
   *  became autonomy-gated: proving the tool loop still reaches write-back requires driving a
   *  tenant that has deliberately set that tool to `auto`. */
  rpcOverrides = {},
  /** Extra SERVICE-ROLE tables, merged over the service defaults.
   *
   *  This exists because the default `serviceTables.clients` answers for ANY id and ignores an
   *  `eq("tenant_id", …)` filter entirely — so a handler that scopes by tenant on the service
   *  client looks correct whether it does or not. A check that could not override it was grading
   *  the fixture, not the code. */
  serviceTablesExtra = {},
  /** Extra RLS-emulating tables merged over the defaults — needed for the confirm store, whose
   *  rows a scenario has to author because they model a claim that mutates as it is read. */
  tablesExtra = {},
  /** Answers for `functions.invoke`, by function name — `{ data, error }` as supabase-js returns. */
  functionsExtra = {},
  /** Inject a postgrest error for a specific table, to drive the "the write was REJECTED" path. */
  tableErrorsExtra = {},
  /** Drive a model that asserts approval itself, with NO human and no request-body echo. */
  selfApproving = false,
  /** Called synchronously on every insert, so a scenario can model read-your-own-write. */
  onInsert = undefined,
  concurrentRequests = 1,
  /** How `paige-write-back` answers, as `{ status, body }` — to drive a write that answered badly. */
  writeBack = null,
  /** How `fetch-url-content` answers, as `{ status, body }` — to drive a page that was really read. */
  fetchedPage = null,
  /** Any other sibling function's answer, as `{ "<url fragment>": { status, body } }` (C2b). */
  outboundAnswers = null,
  /** What PAIGE's streamed answer says this drive. Default "ok", so every existing check is unchanged. */
  replyText = "ok",
  /** What she writes before her tool call, which becomes a thought line. Default none. */
  toolRoundNarration = "",
  /** What the credit report's structured extraction returns, so the pipeline can get past its
   *  parse and validation to the writes after them. Default null: "ok", which fails the parse. */
  extractionReply = null,
  /** Which of this turn's streamed model calls fail with a 529 (1-based, in call order). Default none. */
  failStreamCalls = [],
  /** Which streamed model calls answer 200 and then break, as { callNumber: textBeforeTheBreak }. */
  breakStreamCalls = {},
  /** Which streamed model calls never answer: the request itself throws (1-based). Default none. */
  throwStreamCalls = [],
  /** The status a `failStreamCalls` call answers with (the gateway's own 429, 402, …). Default 529. */
  failStreamStatus = 529,
  /** INT-332 — what each streamed model call answers, in order (see the stub). Default none. */
  streamScript = null,
  // INT-334 R4 — this turn's classifier answer (a label object, or null for a classifier that fails).
  // Left out, the fake answers as a real classifier would for the message (see the fetch fake).
  classification = NO_CLASSIFICATION,
}) {
  // C0a — a scenario that seats the caller as an ADMIN acts inside a workspace. Production cannot have
  // an admin seat with no resolved workspace (get_paige_persona_context falls back to
  // current_user_tenant_id(), so a null persona means no active workspace at all); before C0a the
  // global admin row needed none, which is why the default persona below could stay null. With the
  // canonical tenant role, the persona of a seated admin resolves to the caller's workspace — exactly
  // what production returns. A scenario that scripts the persona still overrides this.
  const seatedAdmin = (() => {
    const t = tablesExtra.user_roles;
    const rows = (typeof t === "function" ? t([]) : t) ?? [];
    if (Array.isArray(rows) && rows.some((r) => r?.role === "admin")) return true;
    // …or seated directly through the canonical seat check (an owner with no global role at all).
    const seat = rpcOverrides.studio_role_ok;
    const answer = typeof seat === "function" ? seat({}) : seat;
    return answer?.data === true;
  })();
  const logged = [];
  embedCount = 0;
  modelEgress = [];
  outboundCalls = [];
  writeBackAnswer = writeBack;
  fetchUrlAnswer = fetchedPage;
  otherOutboundAnswers = outboundAnswers;
  modelStub = stream;
  readCheckReply = readCheck;
  const toolCalls = Array.isArray(toolCall) ? toolCall : toolCall ? [toolCall] : [];
  toolCallOnce = toolCalls.length > 0;
  if (toolCalls.length) toolCallSpec = toolCalls[0];
  selfApprove = selfApproving;
  selfApproveReplays = 0;
  scriptedReply = replyText;
  toolRoundText = toolRoundNarration;
  extractionReplyText = extractionReply;
  const origError = console.error, origWarn = console.warn;
  console.error = (...a) => logged.push({ level: "error", msg: a.join(" ") });
  console.warn = (...a) => logged.push({ level: "warn", msg: a.join(" ") });

  const rec = fake.setScenario({
    onInsert,
    functions: functionsExtra,
    authUser: { id: USER, email: "owner@example.test" },
    // The declared-scope guard reads profiles.active_tenant_id on evidence-carrying turns.
    // This smoke's resolver DRIFTS by design (scope-mismatch cases script it per call), but the
    // user's DECLARED workspace stays put — so the unscripted profiles read defaults to the
    // caller tenant and a mismatch is always resolver-side, never an accident of the harness.
    declaredActiveTenantId: CALLER_TENANT,
    rpcs: {
      check_rate_limit: { data: true, error: null },
      current_user_tenant_id: { data: CALLER_TENANT, error: null },
      is_platform_operator: { data: false, error: null },
      is_platform_owner: ownerRpc,
      get_paige_persona_context: { data: [{ tenant_id: seatedAdmin ? CALLER_TENANT : null, tenant_name: null, playbook_config: null, playbook_slug: null, funding_enabled: false, brand: null }], error: null },
      match_paige_memory: { data: [{ source: "memory", memory_type: "user_preference", content: MEMORY_TEXT, similarity: 0.95 }], error: null },
      ...rpcOverrides,
    },
    tableErrors: { ...(clientsError ? { clients: clientsError } : {}), ...(memoryReadError ? { client_memory: memoryReadError } : {}), ...tableErrorsExtra },
    // What the SERVICE-ROLE client sees: everything, including the foreign client. This is the
    // hazard itself — if the authorization read is made with this client, a foreign id resolves.
    serviceTables: {
      client_memory: (filters) => (filters.some((f) => f[0] === "gte" && f[1] === "created_at") ? [] : [{ client_user_id: USER, client_id: null, tenant_id: CALLER_TENANT, is_active: true, memory_type: "user_preference", content: MEMORY_TEXT, created_at: new Date().toISOString() }]),
      clients: (filters) => {
        const idEq = filters.find((f) => f[0] === "eq" && f[1] === "id")?.[2];
        return idEq ? [{ id: idEq, tenant_id: "99999999-9999-4999-8999-999999999999" }] : [];
      },
      ...serviceTablesExtra,
    },
    tables: {
      // RLS emulation: only rows this caller may see, and only when the filters match.
      clients: (filters) => {
        const idEq = filters.find((f) => f[0] === "eq" && f[1] === "id")?.[2];
        const excludesNullTenant = filters.some((f) => f[0] === "not" && f[1] === "tenant_id");
        if (idEq === OWN) return [{ id: OWN, tenant_id: CALLER_TENANT }];
        // Visible to this caller via a NON-TENANT policy (coach/cs_rep/sales_rep assignment),
        // but owned by another workspace. "Visible to me" is NOT "may read this client's
        // memory" — the residual bypass the review found.
        if (idEq === OTHERTEN) return [{ id: OTHERTEN, tenant_id: OTHER_TENANT }];
        if (idEq === NULLTEN) return excludesNullTenant ? [] : [{ id: NULLTEN, tenant_id: null }];
        return []; // FOREIGN: invisible under RLS
      },
      // The dedupe probe on the WRITE path selects `id` with a 7-day `gte` window. Returning a
      // row there makes the handler think a duplicate exists and skip the insert — which is
      // exactly why the write assertions passed vacuously at first. Return nothing for the
      // dedupe shape so the insert is genuinely reached and can be witnessed.
      client_memory: (filters) => {
        const isDedupe = filters.some((f) => f[0] === "gte" && f[1] === "created_at");
        if (isDedupe) return [];
        return [{ memory_type: "user_preference", content: MEMORY_TEXT, created_at: new Date().toISOString() }];
      },
      ...tablesExtra,
      // A THREAD ROW ALWAYS HAS AN OWNER. The handler refuses a thread whose `tenant_id` is not the
      // turn's workspace (owner addition 2026-10-05), and a production row always carries that column.
      // A scripted thread row that does not name its tenant models the caller's OWN thread, so it is
      // filled with the workspace the persona resolves — the same default the fake gives `profiles`. A
      // scenario that scripts `tenant_id` (including null, a platform thread) keeps exactly what it wrote.
      ...(typeof tablesExtra.paige_chat_threads === "function" ? {
        paige_chat_threads: (filters) => {
          const persona = rpcOverrides.get_paige_persona_context;
          const answer = persona === undefined
            ? { data: [{ tenant_id: seatedAdmin ? CALLER_TENANT : null }] }
            : typeof persona === "function" ? null : persona; // a scripted function is not called twice
          const own = typeof answer?.data?.[0]?.tenant_id === "string" ? answer.data[0].tenant_id : null;
          return (tablesExtra.paige_chat_threads(filters) ?? []).map((row) =>
            row && typeof row === "object" && !("tenant_id" in row) ? { tenant_id: own, ...row } : row);
        },
      } : {}),
    },
  });

  const responses = await Promise.all(Array.from({ length: concurrentRequests }, () => modelTurnState.run({ toolCallOnce: toolCalls.length > 0, queue: toolCalls.slice(1), round: 0, streamCalls: 0, failStreamCalls, failStreamStatus, breakStreamCalls, throwStreamCalls, streamScript, ...(classification !== NO_CLASSIFICATION ? { classification } : {}) }, async () => {
    let status = null, bodyText = "", partialText = "";
    try {
      const res = await handler(new Request("http://local/paige-ai-chat", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: authorization },
      body: JSON.stringify({
        messages: [{ role: "user", content: text }],
        ...(clientId !== undefined ? { clientId } : {}),
        ...(document !== undefined ? { document } : {}),
        ...(clientContext !== undefined ? { clientContext } : {}),
        ...(extraBody ?? {}),
      }),
    }));
      status = res.status;
      // Read as the client does, chunk by chunk, so a stream that errors part-way (a Live turn that
      // ended without its signed `done` errors by design) still shows what reached the wire before
      // the error, in `partialText`. `bodyText` keeps its meaning: the whole body, or "" if it errored.
      try {
        const reader = res.body?.getReader();
        if (reader) {
          const dec = new TextDecoder();
          for (;;) { const { done, value } = await reader.read(); if (done) break; partialText += dec.decode(value, { stream: true }); }
          partialText += dec.decode();
          bodyText = partialText;
        } else bodyText = await res.text();
      } catch { /* streamed */ }
    } catch (e) { status = "throw:" + (e?.message ?? e); }
    return { status, bodyText, partialText };
  })));
  const status = responses[0]?.status ?? null;
  const bodyText = responses.map((response) => response.bodyText).join("\n");
  modelStub = false;
  toolCallOnce = false;
  selfApprove = false;
  scriptedReply = "ok";
  toolRoundText = "";
  extractionReplyText = null;

  console.error = origError; console.warn = origWarn;
  auditTurnFrames(text.slice(0, 40), responses, rec, toolRoundNarration);
  const memoryReads = rec.from.filter((f) => f.table === "client_memory" && f.op === "select");
  const memoryRpc = rec.rpc.filter((r) => r.name === "match_paige_memory");
  const partialText = responses.map((response) => response.partialText).join("\n");
  return { rec, status, bodyText, partialText, responses, logged, embeds: embedCount, memoryReads, memoryRpc, modelEgress: [...modelEgress], outboundCalls: [...outboundCalls], selfApproveReplays };
}

console.log("\nauthorized paths still work (no regression)");
{
  // INT-326: own-memory recall requires a seated workspace (declared ∧ validated). This scenario
  // seats the caller the way a Solo owner's persona resolves; an UNSEATED caller has no workspace
  // at all and legitimately recalls nothing (40.1-40.2).
  const noClient = await drive({
    clientId: undefined,
    rpcOverrides: { get_paige_persona_context: { data: [{ tenant_id: CALLER_TENANT, tenant_name: null, playbook_config: null, playbook_slug: null, funding_enabled: false, brand: null }], error: null } },
  });
  const ownRpc1 = noClient.rec.rpc.filter((c) => c.name === "get_paige_memory");
  assert("1.1 with NO clientId, memory is read scoped to the caller's own user id (S5: the governed owner-memory read)",
    ownRpc1.length === 1 && ownRpc1[0].args?.p_user_id === USER && ownRpc1[0].args?.p_tenant_id === CALLER_TENANT,
    JSON.stringify({ rpc: ownRpc1.map((c) => c.args), reads: noClient.memoryReads.map((r) => r.filters) }));
  assert("1.2 …and never keyed on a client_id",
    !noClient.memoryReads.some((r) => r.filters.some((f) => f[0] === "eq" && f[1] === "client_id")));

  const own = await drive({ clientId: OWN });
  assert("1.3 an AUTHORIZED client's memory is still retrieved",
    own.memoryReads.some((r) => r.filters.some((f) => f[0] === "eq" && f[1] === "client_id" && f[2] === OWN)),
    JSON.stringify(own.memoryReads.map((r) => r.filters)));
  assert("1.4 …and the semantic RPC is called with that AUTHORIZED id, never the raw body value",
    own.memoryRpc.length > 0 && own.memoryRpc.every((r) => r.args._target_client_id === OWN),
    JSON.stringify(own.memoryRpc.map((r) => r.args._target_client_id)));
  assert("1.5 …and authorization is proven through the CALLER'S client, excluding NULL-tenant rows",
    own.rec.from.some((f) => f.table === "clients"
      && f.filters.some((x) => x[0] === "eq" && x[1] === "id" && x[2] === OWN)
      && f.filters.some((x) => x[0] === "not" && x[1] === "tenant_id")),
    JSON.stringify(own.rec.from.filter((f) => f.table === "clients").map((f) => f.filters)));
}

console.log("\nunauthorized client context fails closed BEFORE any memory is read");
{
  const foreign = await drive({ clientId: FOREIGN });
  assert("2.1 a FOREIGN client id retrieves NO memory at all",
    foreign.memoryReads.length === 0, JSON.stringify(foreign.memoryReads.map((r) => r.filters)));
  assert("2.2 …the semantic memory RPC is never called",
    foreign.memoryRpc.length === 0, JSON.stringify(foreign.memoryRpc.map((r) => r.args)));
  // The MEMORY embedding is the one this boundary controls. The RAG block embeds the same
  // question on its own path and is out of this slice's scope, so assert the DIFFERENCE against
  // an authorized run rather than a global zero — a global-zero assertion is simply false, and
  // passing it would mean weakening the check until it agreed with the code.
  const authorizedForEmbeds = await drive({ clientId: OWN });
  assert("2.3 …the memory embedding (a paid call) is skipped versus an authorized turn",
    foreign.embeds < authorizedForEmbeds.embeds,
    `refused: ${foreign.embeds}, authorized: ${authorizedForEmbeds.embeds}`);
  // NOTE: an earlier 2.4 asserted the response body carries no memory text. That was VACUOUS —
  // ANTHROPIC_API_KEY is "" in this harness so every turn 500s and no body ever contains it,
  // fixed or not. Replaced with what is actually observable: nothing was read to put there.
  assert("2.4 …no client_memory row is read at all, so none can reach the prompt",
    !foreign.rec.from.some((f) => f.table === "client_memory" && f.op === "select"),
    JSON.stringify(foreign.rec.from.filter((f) => f.table === "client_memory")));
  assert("2.5 …and the refusal is logged at ERROR with its reason",
    foreign.logged.some((l) => l.level === "error" && /client scope REFUSED/.test(l.msg) && /not authorized/.test(l.msg)),
    JSON.stringify(foreign.logged.map((l) => `${l.level}:${l.msg.slice(0, 90)}`)));
  assert("2.6 …and the rejected id is never echoed into the log",
    !foreign.logged.some((l) => l.msg.includes(FOREIGN)),
    JSON.stringify(foreign.logged.map((l) => l.msg.slice(0, 120))));

  const nullTenant = await drive({ clientId: NULLTEN });
  assert("2.7 a NULL-TENANT client row is refused (the tenant_isolation policy admits it to anyone)",
    nullTenant.memoryReads.length === 0 && nullTenant.memoryRpc.length === 0,
    JSON.stringify({ reads: nullTenant.memoryReads.length, rpc: nullTenant.memoryRpc.length }));

  const malformed = await drive({ clientId: "not-a-uuid" });
  // MALFORMED is rejected UPSTREAM by the request schema (`clientId: z.string().uuid()`), which
  // 400s the whole request before any handler logic runs — stronger than an in-handler refusal.
  // This asserts the REAL behaviour, not the behaviour I first assumed. There is NO in-handler
  // UUID guard: an earlier draft added a `UUID_RE` constant that was never referenced, and this
  // comment used to claim it existed and was "documented as schema-drift defence" — a §13 drift
  // between the proof and the code. The dead constant is deleted; the schema is the whole guard.
  assert("2.8 a MALFORMED client id is rejected by the request schema with 400",
    malformed.status === 400, `status: ${malformed.status}`);
  assert("2.9 …and no memory work of any kind is performed",
    malformed.memoryReads.length === 0 && malformed.memoryRpc.length === 0
      && !malformed.rec.from.some((f) => f.table === "clients"),
    JSON.stringify({ reads: malformed.memoryReads.length, rpc: malformed.memoryRpc.length }));

  const readFail = await drive({ clientId: OWN, clientsError: { message: "transient read failure", code: "57014" } });
  assert("2.10 an authorization READ FAILURE is unknown authority, not permission: refused",
    readFail.memoryReads.length === 0 && readFail.memoryRpc.length === 0,
    JSON.stringify({ reads: readFail.memoryReads.length, rpc: readFail.memoryRpc.length }));
  assert("2.11 …and is reported as a read failure, not as 'not authorized'",
    readFail.logged.some((l) => l.level === "error" && /authorization read failed/.test(l.msg)),
    JSON.stringify(readFail.logged.map((l) => l.msg.slice(0, 90))));
}

console.log("\nthe authorization read itself is made with the caller's authority");
{
  const own = await drive({ clientId: OWN });
  // THE single load-bearing property of the whole fix. Without this the suite was green against
  // the vulnerable code: swapping the JWT client for the service-role one is one token, and the
  // recorder did not capture who asked, so no assertion could see it.
  const authReads = own.rec.from.filter((f) => f.table === "clients" && f.op === "select");
  assert("4.1 the client authorization read is made through the JWT client",
    authReads.length > 0 && authReads.every((f) => f.client === "jwt"),
    JSON.stringify(authReads.map((f) => f.client)));
  assert("4.2 it is NEVER made through the service-role client",
    !authReads.some((f) => f.client === "service"),
    JSON.stringify(authReads.map((f) => f.client)));

  // "Visible to me" is not "may read this client's private data": coach/cs_rep/sales_rep
  // policies grant visibility with NO tenant predicate.
  const otherTenant = await drive({ clientId: OTHERTEN });
  assert("4.3 a client VISIBLE via a non-tenant policy but owned by another workspace is refused",
    otherTenant.memoryReads.length === 0 && otherTenant.memoryRpc.length === 0,
    JSON.stringify({ reads: otherTenant.memoryReads.length, rpc: otherTenant.memoryRpc.length }));
  assert("4.4 …and the reason names the workspace mismatch, not a generic denial",
    otherTenant.logged.some((l) => l.level === "error" && /different workspace/.test(l.msg)),
    JSON.stringify(otherTenant.logged.map((l) => l.msg.slice(0, 100))));
}

console.log("\na refused client turn WRITES nothing, anywhere");
{
  // The write path is the read's twin: an unauthorized id here plants attacker-authored text as
  // a `user_preference` — the type this handler surfaces at the TOP of the prompt for whoever
  // legitimately reads that client next. Guarding the read alone is stored prompt injection.
  const foreignWrite = await drive({ clientId: FOREIGN, text: "please be brief and stop explaining basics" });
  const ownWrite = await drive({ clientId: OWN, text: "please be brief and stop explaining basics" });
  assert("5.0 the write path IS reachable in this harness (guards the check itself)",
    (ownWrite.rec.inserts ?? []).some((i) => i.table === "client_memory"),
    "an authorized turn must actually write, or 5.1 proves nothing");
  // NOT "no inserts of any kind" — that was literally false and only appeared true while the
  // recorder was blind to memoized clients. The LLM trace admin is built once and reused for the
  // process, so a refused turn still writes its observability row. What must be true is that no
  // CLIENT-SCOPED row is written, and that the trace row carries neither the refused id nor the
  // named client's data (asserted explicitly below rather than exempted).
  const OBSERVABILITY_TABLES = new Set(["paige_llm_trace"]);
  const refusedBusinessWrites = (foreignWrite.rec.inserts ?? []).filter((i) => !OBSERVABILITY_TABLES.has(i.table));
  assert("5.1 a refused turn writes NO client-scoped row",
    refusedBusinessWrites.length === 0,
    JSON.stringify(refusedBusinessWrites.map((i) => i.table)));
  assert("5.1b …and the observability row it does write leaks neither the id nor the client's data",
    (foreignWrite.rec.inserts ?? [])
      .filter((i) => OBSERVABILITY_TABLES.has(i.table))
      .every((i) => !JSON.stringify(i.row ?? {}).includes(FOREIGN)
        && !JSON.stringify(i.row ?? {}).includes(MEMORY_TEXT)),
    JSON.stringify((foreignWrite.rec.inserts ?? []).filter((i) => OBSERVABILITY_TABLES.has(i.table)).map((i) => i.table)));
  assert("5.2 …and no insert anywhere carries the refused id",
    !JSON.stringify(foreignWrite.rec.inserts ?? []).includes(FOREIGN),
    JSON.stringify(foreignWrite.rec.inserts ?? []));
}

console.log("\nno read of ANY table carries a refused client id");
{
  // Section 3 below scopes to client_memory and rpc args. buildUserContext reads profiles,
  // user_subscriptions, tasks, businesses, documents and quickbooks_connections — all
  // service-role, all interpolated into the prompt, and all invisible to a client_memory-only
  // assertion. This is the whole-recorder version.
  const foreignAll = await drive({ clientId: FOREIGN });
  const leaked = foreignAll.rec.from.filter(
    (f) => f.table !== "clients" && JSON.stringify(f.filters).includes(FOREIGN),
  );
  assert("6.1 no table read outside the authorization lookup carries the refused id",
    leaked.length === 0,
    JSON.stringify(leaked.map((f) => `${f.client}:${f.table}`)));
  // NOT "the caller's own id is used instead". That asserted the fallback READ as correct, and
  // it is the same mistake 8.2c/9.3/10.3 made on the write side: the conversation and the UI
  // still name the client, so answering from the caller's profile answers "what is their score?"
  // with the WRONG person's figures. A refused focused turn now ends before any of it.
  assert("6.2 a refused focused turn does not substitute the caller as the subject",
    !foreignAll.rec.from.some((f) => f.table === "profiles" || f.table === "user_subscriptions" || f.table === "documents"),
    JSON.stringify(foreignAll.rec.from.map((f) => f.table)));
}

console.log("\nthe caller cannot reach another client's memory by any body-supplied route");
{
  const foreign = await drive({ clientId: FOREIGN });
  assert("3.1 no client_memory read anywhere carries the foreign id",
    !foreign.rec.from.some((f) => f.table === "client_memory" && JSON.stringify(f.filters).includes(FOREIGN)),
    JSON.stringify(foreign.rec.from.filter((f) => f.table === "client_memory").map((f) => f.filters)));
  assert("3.2 no RPC anywhere is passed the foreign id as a memory target",
    !foreign.rec.rpc.some((r) => JSON.stringify(r.args ?? {}).includes(FOREIGN)),
    JSON.stringify(foreign.rec.rpc.map((r) => r.name)));
}

console.log("\nthe authorization read is made with a real CALLER IDENTITY, not just the right key");
{
  // Choosing the anon key is NOT the same as acting as the caller. Without the caller's JWT
  // forwarded as an Authorization header, `auth.uid()` is NULL, RLS and every SECURITY DEFINER
  // caller-guard are exempt, and the "JWT client" is an anon client wearing the name. The suite
  // previously proved only KEY CHOICE, so deleting the forwarded header left it fully green
  // while making the guard vacuous in production. This is the missing axis.
  const own = await drive({ clientId: OWN });
  const authzRead = own.rec.from.find((f) => f.table === "clients" && f.op === "select");
  assert("4.5 the authorization read carries the caller's forwarded Authorization header",
    !!authzRead && typeof authzRead.authorization === "string" && authzRead.authorization.length > 0,
    JSON.stringify({ authorization: authzRead?.authorization ?? null }));
  assert("4.6 …and so do the authority RPCs it depends on",
    own.rec.rpc.filter((r) => r.name === "current_user_tenant_id" || r.name === "is_platform_owner")
      .every((r) => typeof r.authorization === "string" && r.authorization.length > 0),
    JSON.stringify(own.rec.rpc.filter((r) => r.name === "is_platform_owner").map((r) => r.authorization)));
}

console.log("\nthe OPERATOR bypass — the only unbounded one — is bounded and fails closed");
{
  // The bypass skips tenant equality entirely, so every one of its edges must be witnessed.
  // Untested, it was a single token from being a total authorization bypass: `=== true`
  // relaxed to `!== false` made every caller whose authority check errored an operator, and
  // the whole suite stayed green because no scenario ever varied this RPC.
  const opForeign = await drive({ clientId: OTHERTEN, ownerRpc: { data: true, error: null } });
  assert("4.7 a genuine platform owner MAY read a client in another workspace",
    opForeign.rec.from.some((f) => f.table === "client_memory" && JSON.stringify(f.filters).includes(OTHERTEN))
      || opForeign.memoryRpc.some((r) => JSON.stringify(r.args ?? {}).includes(OTHERTEN)),
    JSON.stringify({ reads: opForeign.memoryReads.map((r) => r.filters), rpc: opForeign.memoryRpc.map((r) => r.args) }));

  // Operator authority is not a licence to read a row the tenant predicate excludes for
  // everyone. A NULL-tenant row is unowned, so it is refused even for an owner — this is the
  // ONLY check that puts real load on `.not("tenant_id","is",null)`, whose behavioural effect
  // is otherwise masked by the tenant-equality clause rejecting a null tenant anyway.
  const opNull = await drive({ clientId: NULLTEN, ownerRpc: { data: true, error: null } });
  assert("4.8 …but an unowned (NULL-tenant) client is refused even for an owner",
    !opNull.rec.from.some((f) => f.table !== "clients" && JSON.stringify(f.filters).includes(NULLTEN))
      && !opNull.rec.rpc.some((r) => JSON.stringify(r.args ?? {}).includes(NULLTEN)),
    JSON.stringify(opNull.rec.from.filter((f) => JSON.stringify(f.filters).includes(NULLTEN)).map((f) => f.table)));

  // UNKNOWN authority is never "not an operator" — it is a refusal. Reading a failed authority
  // check as a negative is what lets a later reordering fail open silently.
  const opErr = await drive({ clientId: OTHERTEN, ownerRpc: { data: null, error: { message: "rpc down", code: "57014" } } });
  assert("4.9 an ERRORED authority check refuses rather than assuming non-operator",
    !opErr.rec.from.some((f) => f.table !== "clients" && JSON.stringify(f.filters).includes(OTHERTEN))
      && !opErr.rec.rpc.some((r) => JSON.stringify(r.args ?? {}).includes(OTHERTEN)),
    JSON.stringify(opErr.rec.from.filter((f) => JSON.stringify(f.filters).includes(OTHERTEN)).map((f) => f.table)));
  assert("4.10 …and says so as authority, not as a workspace mismatch",
    opErr.logged.some((l) => l.msg.includes("REFUSED") && l.msg.includes("authority")),
    JSON.stringify(opErr.logged.filter((l) => l.msg.includes("REFUSED")).map((l) => l.msg)));

  // A non-boolean must never be truthy-read into operator authority.
  const opJunk = await drive({ clientId: OTHERTEN, ownerRpc: { data: "true", error: null } });
  assert("4.11 a non-boolean authority result does NOT confer operator authority",
    !opJunk.rec.from.some((f) => f.table !== "clients" && JSON.stringify(f.filters).includes(OTHERTEN)),
    JSON.stringify(opJunk.rec.from.filter((f) => JSON.stringify(f.filters).includes(OTHERTEN)).map((f) => f.table)));
}

console.log("\na refused turn does not blend the named client's context with the caller's own");
{
  // On refusal the handler falls back to the CALLER's scope, while the body still carries a
  // pre-rendered block built from the NAMED client's file, under a header telling the model it
  // is verified data to always reference. Shipping both puts two identities in one prompt with
  // nothing marking which is which — a defect the fix itself introduced by adding the fallback.
  const denied = await drive({
    clientId: FOREIGN,
    stream: true,
    // Send one, and send TENANT-NEUTRAL text. Asserting that a refused turn drops the block is
    // meaningless if the scenario never supplied a block to drop. A first draft used
    // finance-heavy wording ("FICO", "Chase"), which `sanitizeClientContextForTier` strips for a
    // non-funding tenant — so the block vanished for a reason unrelated to this guard and the
    // check passed with the guard REMOVED. The fixture must isolate the property under test.
    clientContext: CLIENT_CTX,
  });
  // Assert on what actually LEAVES for the model. Checking the RESPONSE body here would be
  // vacuous: a system prompt is egress, never reply, so that assertion passes whether or not
  // the block is injected. This is the difference between testing the guard and testing nothing.
  // Stronger than "the context block is absent": a refused focused turn reaches the model AT
  // ALL only if the choke point failed. There is no prompt to inspect because no prompt is sent.
  assert("7.0 a refused turn performs NO model egress whatsoever",
    denied.modelEgress.length === 0,
    JSON.stringify(denied.modelEgress.map((b) => b.slice(0, 120))));
  assert("7.1 …so neither the named client's context block nor any prompt leaves at all",
    !denied.modelEgress.some((b) => b.includes("CLIENT CONTEXT (VERIFIED DATABASE DATA)")),
    "the named client's context block reached the model after a refusal");
  assert("7.1b …and the refused id never reaches the model either",
    !denied.modelEgress.some((b) => b.includes(FOREIGN)),
    "the refused id reached the model");
  assert("7.1d …and the caller is told plainly, rather than being answered as the wrong subject",
    denied.bodyText.includes("couldn't confirm that this client belongs to your workspace"),
    denied.bodyText.slice(0, 300));

  // Surfacing the refusal is what stops it being a silent wrong behaviour the owner finds live.
  const allowed = await drive({ clientId: OWN, stream: true, clientContext: CLIENT_CTX });
  assert("7.1c an AUTHORIZED turn still delivers the client context (7.1 is not vacuous)",
    allowed.modelEgress.some((b) => b.includes("CLIENT CONTEXT (VERIFIED DATABASE DATA)")),
    "the authorized turn lost its client context — the gate is over-broad");

  assert("7.2 the refusal is announced to the caller as a non-identifying signal",
    denied.bodyText.includes("client_scope") && denied.bodyText.includes("refused"),
    denied.bodyText.slice(0, 400));
  assert("7.3 …and that signal never carries the rejected identifier",
    !denied.bodyText.includes(FOREIGN),
    "the refused id appeared in the response body");
}

console.log("\nthe DOCUMENT-upload path is bound to the same decision");
{
  // ~100 lines of upload targeting were never exercised: `drive()` sent no document, so two
  // raw-body-id lookups sat there passing green. A file is written to `${targetUserId}/…`, so
  // a wrong target is a cross-tenant WRITE, not merely a wrong read.
  const doc = { fileName: "statement.pdf", base64: "JVBERi0xLjQK", mimeType: "application/pdf" };
  const ownDoc = await drive({ clientId: OWN, document: doc, text: "here is my statement" });
  // NOT `status !== 400`: these scenarios resolve 500 without a model stub, so that assertion
  // passed without proving anything about the upload path. The recorded upload is the evidence.
  assert("8.1 an authorized document turn actually reaches the upload path",
    ownDoc.rec.uploads.length > 0,
    JSON.stringify({ status: ownDoc.status, uploads: ownDoc.rec.uploads }));

  const foreignDoc = await drive({ clientId: FOREIGN, document: doc, text: "here is my statement" });
  assert("8.2 a refused document turn never reads clients with the raw body id outside the guard",
    foreignDoc.rec.from.filter((f) => f.table === "clients").length <= 1,
    JSON.stringify(foreignDoc.rec.from.filter((f) => f.table === "clients").map((f) => f.filters)));
  assert("8.2b the authorized turn writes into the AUTHORIZED client's folder",
    ownDoc.rec.uploads.length > 0 && ownDoc.rec.uploads.every((u) => u.path.startsWith(`${OWN}/`)),
    JSON.stringify(ownDoc.rec.uploads.map((u) => u.path)));
  // NOT "writes into the caller's own folder". This asserted the caller-fallback as correct and
  // so encoded the defect — the same mistake 9.3 made. The caller attached this file believing it
  // was the named client's, so filing it under the caller durably misattributes another person's
  // document to them. A refused turn persists nothing.
  assert("8.2c a REFUSED turn persists NO document at all",
    foreignDoc.rec.uploads.length === 0,
    JSON.stringify(foreignDoc.rec.uploads.map((u) => u.path)));
  assert("8.2d …while the NO-CLIENT path still stores the caller's own document (8.2c is not over-broad)",
    (await drive({ clientId: undefined, document: doc, stream: true, text: "here is my statement" }))
      .rec.uploads.some((u) => u.path.startsWith(`${USER}/`)),
    "a legitimate self-upload was suppressed — the gate is too wide");
  assert("8.3 …and no table read or write anywhere carries the refused id",
    !foreignDoc.rec.from.some((f) => f.table !== "clients" && JSON.stringify(f.filters).includes(FOREIGN))
      && !foreignDoc.rec.inserts.some((i) => JSON.stringify(i.row ?? {}).includes(FOREIGN)),
    JSON.stringify({
      reads: foreignDoc.rec.from.filter((f) => f.table !== "clients" && JSON.stringify(f.filters).includes(FOREIGN)).map((f) => f.table),
      writes: foreignDoc.rec.inserts.filter((i) => JSON.stringify(i.row ?? {}).includes(FOREIGN)).map((i) => i.table),
    }));
}

console.log("\nthe SESSION-SUMMARY branch is bound to the same decision");
{
  // Three service-role `client_memory` inserts live behind `generateSessionSummary`. No scenario
  // drove it, so reverting all three to the raw body id left the suite fully green — while the
  // real effect is cross-tenant STORED PROMPT INJECTION: a `session_summary` / `user_preference`
  // row written into another tenant's client, which this handler later lifts into the prompt of
  // whoever legitimately opens that client next.
  const sessionBody = {
    generateSessionSummary: true,
    sessionMessages: [
      { role: "user", content: "keep my updates short" },
      { role: "assistant", content: "understood" },
    ],
  };
  const ownSum = await drive({ clientId: OWN, stream: true, extraBody: sessionBody });
  assert("9.0 the summary branch DOES write on an authorized turn (guards this section)",
    ownSum.rec.inserts.some((i) => i.table === "client_memory"),
    JSON.stringify(ownSum.rec.inserts.map((i) => i.table)));
  assert("9.1 an authorized summary is filed against the AUTHORIZED client",
    ownSum.rec.inserts.filter((i) => i.table === "client_memory")
      .some((i) => JSON.stringify(i.row ?? {}).includes(OWN)),
    JSON.stringify(ownSum.rec.inserts.filter((i) => i.table === "client_memory").map((i) => i.row)));

  const refusedSum = await drive({ clientId: FOREIGN, stream: true, extraBody: sessionBody });
  assert("9.4 a REFUSED summary turn announces the refusal in its JSON response",
    (() => { try { return JSON.parse(refusedSum.bodyText)?.client_scope?.status === "refused"; } catch { return false; } })(),
    refusedSum.bodyText.slice(0, 200));
  assert("9.5 …and an AUTHORIZED summary turn carries no such marker (9.4 is not vacuous)",
    (() => { try { return JSON.parse(ownSum.bodyText)?.client_scope === undefined; } catch { return false; } })(),
    ownSum.bodyText.slice(0, 200));
  assert("9.6 …and the marker never carries the rejected identifier",
    !refusedSum.bodyText.includes(FOREIGN), "the refused id appeared in the summary response");
  assert("9.2 a REFUSED summary turn writes nothing carrying the refused id",
    !JSON.stringify(refusedSum.rec.inserts ?? []).includes(FOREIGN),
    JSON.stringify(refusedSum.rec.inserts ?? []));
  // NOT "filed against the caller instead". An earlier draft asserted exactly that and so
  // enshrined the defect: these rows are DURABLE and are injected into the caller's own future
  // chats, so filing the named client's session under `user.id` contaminates the caller's
  // context with a subject they were never authorized to read. Falling back is not a safe
  // degrade for a WRITE of someone else's data — the only correct outcome is to write nothing.
  assert("9.3 …and writes NO client_memory row at all — the caller is not a fallback subject",
    refusedSum.rec.inserts.filter((i) => i.table === "client_memory").length === 0,
    JSON.stringify(refusedSum.rec.inserts.filter((i) => i.table === "client_memory").map((i) => i.row)));
  const selfSum = await drive({ clientId: undefined, stream: true, extraBody: sessionBody,
    rpcOverrides: { get_paige_persona_context: { data: [{ tenant_id: CALLER_TENANT, tenant_name: null, playbook_config: null, playbook_slug: null, funding_enabled: false, brand: null }], error: null } } });
  const selfSumWrite = selfSum.rec.rpc.filter((c) => c.name === "record_paige_memory");
  assert("9.3b …while the NO-CLIENT path still writes the caller's own summary (S5: through the governed seam, proposed)",
    selfSumWrite.length === 1 && selfSumWrite[0].args?.p_user_id === USER
      && selfSumWrite[0].args?.p_tenant_id === CALLER_TENANT
      && selfSumWrite[0].args?.p_memory_type === "session_summary"
      && selfSumWrite[0].args?.p_confirmation_state === "proposed",
    "a legitimate self-summary was suppressed — the gate is too wide");
}

console.log("\nthe CREDIT-REPORT upload branch is bound to the same decision");
{
  // The highest-severity write in this change: a service-role storage upload plus a
  // `credit_report_uploads` row, both keyed on the target id, both RLS-exempt. It sits behind
  // `isCreditReportPdf`, which requires a model read-check — so with no model stub it was ALWAYS
  // false and this branch was unreachable, leaving a raw-body-id revert here fully green.
  const creditDoc = { fileName: "report.pdf", base64: "JVBERi0xLjQK", mimeType: "application/pdf" };
  const readsAsCreditReport = {
    can_read_document: true,
    document_kind: "credit_report",
    first_five_account_names: ["ACCOUNT ONE"],
  };

  const ownCredit = await drive({ clientId: OWN, stream: true, document: creditDoc, readCheck: readsAsCreditReport });
  // The `credit_report_uploads` INSERT is the only signal unique to this branch. Bucket
  // membership is NOT: the general-document path writes to the SAME bucket under a `general/`
  // prefix, so a bucket-or-insert disjunct was satisfied by any stored PDF — which meant that
  // if the branch went dark (a reworded read-check prompt, a flipped flag) this "guard" still
  // passed AND 10.1-10.3 passed vacuously over empty arrays, letting a revert of the
  // cross-tenant service-role write in this very branch ship green through CI.
  assert("10.0 the credit-report branch IS reached (guards this section)",
    ownCredit.rec.inserts.some((i) => i.table === "credit_report_uploads")
      && ownCredit.rec.uploads.some((u) => u.bucket === "credit-report-uploads" && !u.path.includes("/general/")),
    JSON.stringify({ uploads: ownCredit.rec.uploads, inserts: ownCredit.rec.inserts.map((i) => i.table) }));
  assert("10.1 an authorized credit report is stored against the AUTHORIZED client",
    ownCredit.rec.uploads.filter((u) => u.bucket === "credit-report-uploads" && !u.path.includes("/general/"))
      .every((u) => u.path.startsWith(`${OWN}/`))
      && ownCredit.rec.inserts.filter((i) => i.table === "credit_report_uploads").length > 0
      && ownCredit.rec.inserts.filter((i) => i.table === "credit_report_uploads").every((i) => i.row?.user_id === OWN),
    JSON.stringify({
      uploads: ownCredit.rec.uploads.filter((u) => u.bucket === "credit-report-uploads").map((u) => u.path),
      rows: ownCredit.rec.inserts.filter((i) => i.table === "credit_report_uploads").map((i) => i.row?.user_id),
    }));

  const refusedCredit = await drive({ clientId: FOREIGN, stream: true, document: creditDoc, readCheck: readsAsCreditReport });
  assert("10.2 a REFUSED credit report never lands under the named client",
    !refusedCredit.rec.uploads.some((u) => u.path.includes(FOREIGN))
      && !refusedCredit.rec.inserts.some((i) => JSON.stringify(i.row ?? {}).includes(FOREIGN)),
    JSON.stringify({
      uploads: refusedCredit.rec.uploads.map((u) => u.path),
      rows: refusedCredit.rec.inserts.filter((i) => i.table === "credit_report_uploads").map((i) => i.row?.user_id),
    }));
  // The turn no longer reaches the credit branch at all, so there is nothing to skip: no
  // extraction call, no sync, no model egress of any kind.
  assert("10.4 a REFUSED credit report is never extracted or synced",
    refusedCredit.modelEgress.length === 0
      && !refusedCredit.outboundCalls.some((c) => c.url.includes("sync-credit-report-data")),
    JSON.stringify({ egress: refusedCredit.modelEgress.length, out: refusedCredit.outboundCalls.map((c) => c.url) }));
  assert("10.5 …while an AUTHORIZED one still syncs (10.4 is not vacuous)",
    ownCredit.bodyText.includes("sync_status") && !ownCredit.bodyText.includes("client_scope_refused"),
    ownCredit.bodyText.slice(0, 300));
  // Likewise: no upload, and no `credit_report_uploads` row. Falling back to the caller also
  // stranded that row in `analysis_status: "processing"` forever, because the sync is skipped.
  assert("10.3 …and persists NOTHING: no upload and no credit_report_uploads row",
    refusedCredit.rec.uploads.length === 0
      && !refusedCredit.rec.inserts.some((i) => i.table === "credit_report_uploads"),
    JSON.stringify({
      uploads: refusedCredit.rec.uploads.map((u) => u.path),
      rows: refusedCredit.rec.inserts.filter((i) => i.table === "credit_report_uploads").map((i) => i.row),
    }));
}

console.log("\nthe refusal is announced on BOTH response paths, not just the agentic one");
{
  // The document path builds a SECOND ReadableStream (the agentic one is gated on
  // `!attachedDocument`), so a frame emitted there does not reach a doc-attached turn — the
  // half where the caller is actively filing a document against the client they named.
  const doc = { fileName: "statement.pdf", base64: "JVBERi0xLjQK", mimeType: "application/pdf" };
  const refusedDoc = await drive({ clientId: FOREIGN, stream: true, document: doc });
  assert("11.1 a refused DOCUMENT turn also announces the refusal",
    refusedDoc.bodyText.includes("client_scope") && refusedDoc.bodyText.includes("refused"),
    refusedDoc.bodyText.slice(0, 300));
  assert("11.2 …and still never carries the rejected identifier",
    !refusedDoc.bodyText.includes(FOREIGN),
    "the refused id appeared in the document-path response");
}

console.log("\nthe TOOL loop does not retarget a refused subject at the caller");
{
  // The generalisation behind the two review findings: falling back to the caller is right for
  // READING their own context and wrong for WRITING a named subject's data. `update_client_data`
  // was the third instance — the model calls it believing it is acting on the focused client, and
  // on a refusal the fallback applied those updates to the CALLER's own record. RLS keeps it
  // in-tenant, so it is not a cross-tenant leak; it is still one person's data written onto
  // another's, and no check reached the tool loop at all before this.
  const upd = { name: "update_client_data", args: { updates: { first_name: "Renamed", monthly_revenue: 99999 } } };

  // §13 — `update_client_data` IS NOW AUTONOMY-GATED, so an authorized turn no longer writes on
  // its own. It was the one write tool that reached `paige-write-back` — which can set
  // `profile.ssn` and `profile.date_of_birth` — with no confirm, no off switch and no autonomy row:
  // a tenant that set every other tool to `confirm` still had this one running unattended.
  //
  // These two assertions are UPDATED, not deleted. What they guard — that the tool loop is
  // reachable, and that a write targets the AUTHORIZED client rather than the caller — is exactly
  // as load-bearing as before; it now happens on the far side of an approval. Deleting them because
  // the shape changed would have removed the only proof that this section's refusals are refusing
  // something that otherwise works.
  const proposed = await drive({ clientId: OWN, stream: true, toolCall: upd });
  assert("12.0 an AUTHORIZED turn now PROPOSES rather than writing — the gate covers this tool",
    !proposed.outboundCalls.some((c) => c.url.includes("paige-write-back")),
    JSON.stringify(proposed.outboundCalls.map((c) => c.url)));
  assert("12.0a …and asks, rather than silently doing nothing",
    proposed.bodyText.includes("paige_confirm") || proposed.bodyText.includes("needs_confirm"),
    proposed.bodyText.slice(0, 400));

  // The same call, with autonomy set to `auto` — the tenant's own deliberate choice. The tool loop
  // is still reachable and still targets the authorized client.
  const allowedTool = await drive({
    clientId: OWN, stream: true, toolCall: upd,
    rpcOverrides: { resolve_tool_autonomy: { data: "auto", error: null } },
  });
  assert("12.0b the tool loop IS reachable and a turn the tenant set to auto calls write-back (guards this section)",
    allowedTool.outboundCalls.some((c) => c.url.includes("paige-write-back")),
    JSON.stringify(allowedTool.outboundCalls.map((c) => c.url)));
  assert("12.0c …targeting the AUTHORIZED client, never the caller",
    allowedTool.outboundCalls.filter((c) => c.url.includes("paige-write-back"))
      .every((c) => c.body.includes(OWN) && !c.body.includes(`"target_user_id":"${USER}"`)),
    JSON.stringify(allowedTool.outboundCalls.filter((c) => c.url.includes("paige-write-back")).map((c) => c.body)));

  // The review's point was that gating ONE tool leaves every other mutating branch open —
  // `crm_create_task` service-role-inserts the model's subject-specific title into the caller's
  // tenant, `propose_action` persists an outbound draft. Rather than enumerate them, the turn
  // now ends before the tool loop exists. Drive a DIFFERENT mutating tool to prove the choke
  // point holds generally, not just for the one tool that was gated by hand.
  const refusedTask = await drive({
    clientId: FOREIGN,
    stream: true,
    toolCall: { name: "crm_create_task", args: { title: "Call about their charge-off", description: "subject-specific" } },
  });
  assert("12.4 a refused turn runs NO mutating tool, not merely the one that was gated",
    refusedTask.rec.inserts.filter((i) => !["paige_llm_trace"].includes(i.table)).length === 0
      && refusedTask.outboundCalls.length === 0,
    JSON.stringify({
      inserts: refusedTask.rec.inserts.map((i) => i.table),
      outbound: refusedTask.outboundCalls.map((c) => c.url),
    }));
  assert("12.5 …because the tool loop is never reached — no model round happens at all",
    refusedTask.modelEgress.length === 0,
    JSON.stringify(refusedTask.modelEgress.length));

  const refusedTool = await drive({ clientId: FOREIGN, stream: true, toolCall: upd });
  assert("12.1 a REFUSED turn makes NO write-back call at all",
    !refusedTool.outboundCalls.some((c) => c.url.includes("paige-write-back")),
    JSON.stringify(refusedTool.outboundCalls.map((c) => c.url)));
  assert("12.2 …so the named client's updates never land on the caller's own record",
    !refusedTool.outboundCalls.some((c) => c.body.includes(`"target_user_id":"${USER}"`)),
    JSON.stringify(refusedTool.outboundCalls.map((c) => c.body)));
  assert("12.3 …and no outbound call carries the refused id",
    !refusedTool.outboundCalls.some((c) => c.body.includes(FOREIGN) || c.url.includes(FOREIGN)),
    JSON.stringify(refusedTool.outboundCalls.map((c) => c.url)));
}

/**
 * A FAITHFUL MODEL OF `paige_pending_confirmations`, shared by sections 13 and 18 so there is one
 * model of the table rather than two that can drift apart.
 *
 * Faithful on the axes that decide the outcome: a row remembers which REQUEST minted it, a claim
 * consumes it exactly once, and a claim arrives one of two ways — by fingerprint (a card echoed
 * precisely what it displayed) or by scope alone (the model's arguments drifted, so identity comes
 * from there being exactly ONE live proposal for this tool). `rows` outlives a single drive, so a
 * scenario can model consecutive REQUESTS against one database.
 */
function makeConfirmStore(seed = []) {
  const rows = seed.map((r, i) => ({ id: `row-seed-${i}`, consumed: false, tenant_id:null, thread_id:'cccccccc-cccc-4ccc-8ccc-cccccccccccc', scoped_client_id:r.args?.client_id??null, expires_at:'2099-01-01T00:00:00Z', server_issued_at:'2026-01-01T00:00:00Z', ...r }));
  // `consumed_at` is a real time: the handler's own claim stamps it, and a row seeded consumed was
  // consumed long before any request a check drives (the approval outcome asks which came first).
  const consumedAt = (r) => (r.consumed ? r.consumedAt ?? "2026-01-01T00:00:00.000Z" : null);
  const matches = (r, filters) => filters.every(([op, col, value, extra]) => {
    const v = col === "consumed_at" ? consumedAt(r) : r[col];
    if (op === "eq") return v === value;
    if (op === "filter") return value === "eq" && col.startsWith("args->>") && String(r.args?.[col.slice(7)]) === String(extra);
    if (op === "neq") return v != null && v !== value;
    if (op === "is") return value === null ? v == null : v === value;
    if (op === "not" && value === "is" && extra === null) return v != null;
    if (op === "gt") return v != null && v > value;
    if (op === "gte") return v != null && v >= value;
    if (op === "lt") return v != null && v < value;
    if (op === "lte") return v != null && v <= value;
    if (op === "in") return value.includes(v);
    return true;
  });
  const store = {
    rows,
    /** The row the last insert wrote, for PostgREST's `insert(...).select(...)` readback (set by
     *  mirrorConfirms). A door that mints a proposal reads its own row back that way; without this the
     *  readback saw EVERY row and a store holding history answered "multiple rows" (C4b, 40.4c). */
    lastInsert: null,
    table: (filters) => {
      const update = filters.find(([op]) => op === "update")?.[1];
      const columns = filters.find(([op]) => op === "select")?.[1];
      const inserted = store.lastInsert;
      store.lastInsert = null;
      if (inserted && filters.length === 1 && columns !== undefined) {
        return [Object.fromEntries(String(columns).split(",").map((key) => [key, key === "consumed_at" ? consumedAt(inserted) : structuredClone(inserted[key])]))];
      }
      if (!update && columns === undefined) return [];
      const hits = rows.filter((row) => matches(row, filters))
        .slice(0, filters.find(([op]) => op === "limit")?.[1] ?? rows.length);
      if (update) for (const row of hits) {
        if (Object.hasOwn(update, "consumed_at")) { row.consumed = update.consumed_at !== null; row.consumedAt = update.consumed_at; }
        for (const [key, value] of Object.entries(update)) if (key !== "consumed_at") row[key] = value;
      }
      return hits.map((row) => {
        if (columns === "*") return JSON.parse(JSON.stringify(row));
        return Object.fromEntries(String(columns ?? "id").split(",").map((key) => [key,
          key === "consumed_at" ? consumedAt(row) : structuredClone(row[key]),
        ]));
      });
    },
  };
  return store;
}

/** Mirror inserts LIVE, as the handler writes them, honouring the live-proposal unique index.
 *  Mirroring only AFTER a drive would leave the store empty at claim time, and a self-approval
 *  check would pass because the fixture forgot the row — which is exactly how one once did. */
const mirrorConfirms = (st) => (t, row) => {
  if (t !== "paige_pending_confirmations") return;
  const clash = st.rows.some((r) => r.server_issued_at!=null && row.server_issued_at!=null && !r.consumed && r.fingerprint === row.fingerprint
    && r.user_id === row.user_id);
  // Return the real constraint violation rather than quietly dropping the row: the handler must
  // read this as "exists", never as "created", and a fixture that just skips makes those two
  // outcomes look identical from the handler's side.
  if (clash) return { code: "23505", message: "duplicate key value violates unique constraint" };
  st.rows.push({ id: `row-${st.rows.length}`, consumed: false, expires_at:'2099-01-01T00:00:00Z', ...row });
  st.lastInsert = st.rows.at(-1);
  return null;
};

// ── 13. THE CONFIRM GATE — AN APPROVAL MUST BE REACHABLE, AND MUST MEAN "THIS, ONCE" ─────────
//
// WHY THIS SECTION EXISTS. The first version of the gate required the calling SURFACE to echo a
// fingerprint back. Independent review drove the shipped code and found that only one of the six
// chat surfaces sends it, so every confirm-gated tool had become permanently un-executable on the
// other five; that the client-portal seat lost `update_client_data`, its ONLY write; and that even
// where the echo worked the model had to re-author the arguments byte-identically — a livelock for
// any tool carrying model-written free text. Thirteen separate mutations to that code left every
// suite green, which is the real finding: the mechanism had no coverage at all.
//
// Approval-path hardening. Detailed evidence retained privately.
//
// So each check below names the exact mutation it kills. A check that cannot name one is decoration.
{
  const TOOL = "update_client_data";
  const CONFIRM = { rpcOverrides: { resolve_tool_autonomy: { data: "confirm", error: null } } };
  const THREAD = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
  const EARLIER = "a-previous-request";
  const PROPOSED = { client_id: OWN, updates: { goal: "buy a house" } };

  /** The refusal Paige actually sent BACK to the model next round.
   *
   *  It travels as a JSON string nested inside the request body, so it arrives double-escaped;
   *  unescape once before matching, or every assertion here passes vacuously by finding nothing. */
  function refusalOf(egress) {
    const all = egress
      .map((b) => (typeof b === "string" ? b : JSON.stringify(b)))
      .join("\n")
      .replace(/\\"/g, '"');
    if (!all.includes("needs_confirm")) return null;
    return {
      present: true,
      raw: all,
      fingerprint: (all.match(/"confirm_fingerprint":"([0-9a-f]{16}(?::[0-9a-f-]{36})?)"/) ?? [])[1] ?? null,
      summary: (all.match(/"confirm_summary":"([^"]{0,160})/) ?? [])[1] ?? "",
      note: (all.match(/"note":"([^"]{0,600})/) ?? [])[1] ?? "",
    };
  }

  // ── 13.1 A gated call with no approval PROPOSES rather than acting.
  const st1 = makeConfirmStore();
  const proposed = await drive({
    clientId: OWN, stream: true, extraBody: { threadId: THREAD },
    toolCall: { name: TOOL, args: PROPOSED },
    ...CONFIRM,
    tablesExtra: { paige_pending_confirmations: st1.table },
    onInsert: mirrorConfirms(st1),
  });
  assert("13.1 a confirm-gated call with no approval performs NO write",
    !proposed.outboundCalls.some((c) => c.url.includes("paige-write-back")),
    JSON.stringify(proposed.outboundCalls.map((c) => c.url)));

  // ── 13.2 …and the proposal is PERSISTED, with the arguments that will actually run.
  // Kills: deleting the `recordConfirmation` call, or storing a summary instead of the args.
  const stored = proposed.rec.inserts.find((i) => i.table === "paige_pending_confirmations" && !i.update)?.row;
  assert("13.2 the proposed call is persisted with its exact arguments",
    !!stored && stored.tool_name === TOOL
      && JSON.stringify(stored.args?.updates) === JSON.stringify({ goal: "buy a house" }),
    JSON.stringify(stored ?? null));

  // ── 13.3 …recorded against the PERSON and the scope it was shown in.
  // Kills: dropping user_id/thread_id/scoped_client_id from the insert — each of which would let an
  // approval issued in one place be redeemed in another.
  assert("13.3 the proposal is bound to the person, the thread and the focused client",
    !!stored && stored.user_id === USER && stored.thread_id === THREAD && stored.scoped_client_id === OWN,
    JSON.stringify(stored ?? null));

  // ── 13.3b …and to the REQUEST that minted it, which is what makes "not in this turn" enforceable.
  // Kills: dropping `issued_in_request`, which reopens same-request self-approval.
  assert("13.3b the proposal records which request minted it",
    !!stored && typeof stored.issued_in_request === "string" && stored.issued_in_request.length > 0,
    JSON.stringify(stored ?? null));

  // ── 13.4 canonical proposal contents are server-issued; browser writes are revoked.
  // Explicit scoped predicates replace caller RLS as the service writer's boundary.
  const insertQ = proposed.rec.from.find(
    (f) => f.table === "paige_pending_confirmations" && f.op === "insert");
  assert("13.4 the proposal is written only by the trusted service client",
    !!insertQ && insertQ.client === "service",
    JSON.stringify(insertQ ?? "no query recorded"));

  // ── 13.5 THE HANDSHAKE IS OFFERED, AND IT IS NOT A KEY. The model must be told how to carry a
  // yes — that is the outage this repair is about — but what it is told must not itself be
  // spendable. Kills: reinstating `confirm_token` in the refusal, which is the whole of section 18.
  const refusal = refusalOf(proposed.modelEgress);
  assert("13.5 the refusal explains how to approve and hands back no spendable key",
    !!refusal && refusal.summary.length > 0 && /click Approve/.test(refusal.note)
      && /cannot approve this action/.test(refusal.note) && !/confirm: true/.test(refusal.note)
      && !/confirm_token/.test(refusal.raw),
    JSON.stringify(refusal ?? null));

  // ── 13.6 THE ONE THAT MATTERS. Approval runs the STORED call, even though the model re-emits
  // DIFFERENT arguments — which is what it will do for any tool carrying free text it cannot
  // reproduce. Kills: removing `tc.function.arguments = JSON.stringify(approvedArgs)`, which would
  // send the drifted arguments to write-back; and reverting to the echo-only gate, which would
  // refuse this turn outright.
  const st2 = makeConfirmStore([{
    ...st1.rows[0], args: PROPOSED,
  }]);
  const approved = await drive({
    clientId: OWN, stream: true, extraBody: { threadId: THREAD, approvedConfirmations: [refusal.fingerprint] },
    toolCall: { name: TOOL, args: { client_id: OWN, updates: { goal: "SOMETHING ELSE ENTIRELY" }, confirm: true } },
    ...CONFIRM,
    tablesExtra: { paige_pending_confirmations: st2.table },
  });
  const wrote = approved.outboundCalls.filter((c) => c.url.includes("paige-write-back"));
  assert("13.6 approval executes the STORED call, not the one the model re-emitted",
    wrote.length === 1 && wrote[0].body.includes("buy a house")
      && !wrote[0].body.includes("SOMETHING ELSE ENTIRELY"),
    JSON.stringify(wrote.map((c) => c.body)));

  // ── 13.6b …and the SCOPE lookup that resolved it re-checked scope rather than matching on the
  // tool name alone. Kills: dropping the tenant / thread / focused-client predicates from the
  // lookup, which would let a drifted approval reach across a switch — the thing S2 exists to stop.
  // C4a: the approved card is now carried forward by the server's own resume selection (13.6b2), and
  // the model's drifted re-emit still reaches the gate's approved-set lookup — both are held to scope.
  const lookupQ = approved.rec.from.find(
    (f) => f.table === "paige_pending_confirmations" && f.op === "select"
      && f.filters.some((x) => x[0] === "select" && x[1] === "fingerprint,args,issued_in_request")
      && f.filters.some((x) => x[0] === "in" && x[1] === "fingerprint"));
  const lf = (op, col) => lookupQ?.filters.some((x) => x[0] === op && x[1] === col);
  assert("13.6b the scope lookup re-checks user, tenant, expiry, thread and focused client",
    !!lookupQ && lf("eq", "user_id") && lf("gt", "expires_at")
      && (lf("eq", "tenant_id") || lf("is", "tenant_id"))
      && (lf("eq", "thread_id") || lf("is", "thread_id"))
      && (lf("eq", "scoped_client_id") || lf("is", "scoped_client_id")),
    JSON.stringify(lookupQ?.filters ?? "no lookup recorded"));
  // 13.6b2 — the resume selection carries the claim's own scope: this user, this (non-null) thread,
  // this workspace and focused client, server-issued, and never minted by this very request. It
  // reads consumed and expiry so it can report them truthfully; the claim itself still filters both.
  const resumeQ = approved.rec.from.find(
    (f) => f.table === "paige_pending_confirmations" && f.op === "select"
      && f.filters.some((x) => x[0] === "select" && String(x[1]).includes("consumed_at") && String(x[1]).includes("expires_at")));
  const rf = (op, col, value) => resumeQ?.filters.some((x) => x[0] === op && x[1] === col && (value === undefined || x[2] === value));
  assert("13.6b2 the resume selection re-checks user, thread, tenant, focused client, issuance and the request nonce",
    !!resumeQ && rf("eq", "user_id", USER) && rf("eq", "thread_id", THREAD)
      && (rf("eq", "tenant_id") || rf("is", "tenant_id")) && rf("eq", "scoped_client_id", OWN)
      && rf("not", "server_issued_at") && rf("not", "issued_in_request") && rf("neq", "issued_in_request"),
    JSON.stringify(resumeQ?.filters ?? "no resume selection recorded"));

  // ── 13.6c …and it refuses when it cannot tell WHICH proposal was approved. Two live proposals
  // for the same tool make a drifted yes ambiguous, and a fresh summary is the right answer to an
  // ambiguous yes. Kills: taking the first row instead of requiring exactly one.
  const st2b = makeConfirmStore([
    { user_id: USER, tool_name: TOOL, fingerprint: "1".repeat(16), args: PROPOSED, issued_in_request: EARLIER },
    { user_id: USER, tool_name: TOOL, fingerprint: "2".repeat(16), args: { client_id: OWN, updates: { goal: "a different plan" } }, issued_in_request: EARLIER },
  ]);
  const ambiguous = await drive({
    clientId: OWN, stream: true, extraBody: { threadId: THREAD, approvedConfirmations: ["1".repeat(16), "2".repeat(16)] },
    toolCall: { name: TOOL, args: { client_id: OWN, updates: { goal: "drifted" }, confirm: true } },
    ...CONFIRM,
    tablesExtra: { paige_pending_confirmations: st2b.table },
  });
  assert("13.6c approval-path hardening",
    !ambiguous.outboundCalls.some((c) => c.url.includes("paige-write-back"))
      && st2b.rows.every((row) => !row.consumed)
      && ambiguous.modelEgress.some((body) => body.includes("execution_unavailable")),
    JSON.stringify(ambiguous.outboundCalls.map((c) => c.body)));

  // ── 13.7 The claim is a COMPARE-AND-SET, so one approval cannot execute twice.
  // Kills: dropping `.is("consumed_at", null)` — the review found one approval could otherwise run
  // the same call for every round of the turn.
  //
  // Driven down the SURFACE-ECHO path, where the arguments are identical and the claim is by
  // fingerprint, so the exact-match leg gets its own coverage rather than sharing 13.6's.
  const st2c = makeConfirmStore([{
    ...st1.rows[0], args: PROPOSED,
  }]);
  const cardApproved = await drive({
    clientId: OWN, stream: true,
    extraBody: { threadId: THREAD, approvedConfirmations: [refusal?.fingerprint ?? "0".repeat(16)] },
    toolCall: { name: TOOL, args: PROPOSED },
    ...CONFIRM,
    tablesExtra: { paige_pending_confirmations: st2c.table },
  });
  assert("13.7a a rendered card the person clicked approves the call",
    cardApproved.outboundCalls.some((c) => c.url.includes("paige-write-back") && c.body.includes("buy a house")),
    JSON.stringify(cardApproved.outboundCalls.map((c) => c.body)));

  const claimQ = cardApproved.rec.from.find(
    (f) => f.table === "paige_pending_confirmations" && f.op === "update");
  assert("13.7 the claim is a compare-and-set on consumed_at",
    !!claimQ && claimQ.filters.some((x) => x[0] === "is" && x[1] === "consumed_at" && x[2] === null),
    JSON.stringify(claimQ?.filters ?? "no claim recorded"));

  // ── 13.8 …and it re-checks scope rather than trusting the fingerprint alone.
  // Kills: dropping the tenant/thread/client predicates, which would let an approval survive an
  // account switch or a change of focused client. `tenant_id` is named explicitly here because
  // mutation-testing showed deleting it failed nothing — the one guard this section did not cover.
  const cf = (op, col) => claimQ?.filters.some((x) => x[0] === op && x[1] === col);
  assert("13.8 the claim re-checks user, tenant, expiry, thread and focused client",
    !!claimQ && cf("eq", "user_id") && cf("gt", "expires_at")
      && (cf("eq", "tenant_id") || cf("is", "tenant_id"))
      && (cf("eq", "thread_id") || cf("is", "thread_id"))
      && (cf("eq", "scoped_client_id") || cf("is", "scoped_client_id")),
    JSON.stringify(claimQ?.filters ?? "no claim recorded"));

  // ── 13.8b …and it will not redeem a proposal minted by THIS request.
  // Kills: dropping `.neq("issued_in_request", requestNonce)` — the same-request self-approval leg.
  assert("13.8b the claim excludes proposals minted by this same request",
    !!claimQ && cf("neq", "issued_in_request"),
    JSON.stringify(claimQ?.filters ?? "no claim recorded"));

  // ── 13.9 An approval for one tool cannot redeem another.
  // Kills: dropping `.eq("tool_name", tool)` from the claim and from the scope lookup.
  const st3 = makeConfirmStore([{
    user_id: USER, tool_name: "deal_create", fingerprint: "abcdef0123456789",
    args: { amount: 1 }, issued_in_request: EARLIER,
  }]);
  const wrongTool = await drive({
    clientId: OWN, stream: true, extraBody: { threadId: THREAD, approvedConfirmations: ["abcdef0123456789"] },
    toolCall: { name: TOOL, args: { client_id: OWN, updates: { goal: "x" }, confirm: true } },
    ...CONFIRM,
    tablesExtra: { paige_pending_confirmations: st3.table },
  });
  assert("13.9 an approval issued for a different tool redeems nothing",
    !wrongTool.outboundCalls.some((c) => c.url.includes("paige-write-back")),
    JSON.stringify(wrongTool.outboundCalls.map((c) => c.url)));

  // ── 13.9b A PROPOSAL ALREADY WAITING IS NOT PROPOSED AGAIN. `recordConfirmation` distinguishes
  // "I just created this" from "an earlier request already did and it is still live", and the
  // difference is the whole of section 18 — so it must not be a distinction the code makes and
  // then discards. Here it earns its keep: a model that re-proposes an unanswered action is told
  // the person has not answered, instead of reading them the same summary a second time.
  // Kills: collapsing "exists" into "created", which is the shape the bypass rode in on.
  const st3b = makeConfirmStore();
  await drive({
    clientId: OWN, stream: true, extraBody: { threadId: THREAD },
    toolCall: { name: TOOL, args: PROPOSED }, ...CONFIRM,
    tablesExtra: { paige_pending_confirmations: st3b.table },
    onInsert: mirrorConfirms(st3b),
  });
  const reProposed = await drive({
    clientId: OWN, stream: true, extraBody: { threadId: THREAD },
    toolCall: { name: TOOL, args: PROPOSED }, ...CONFIRM,
    tablesExtra: { paige_pending_confirmations: st3b.table },
    onInsert: mirrorConfirms(st3b),
  });
  const again = refusalOf(reProposed.modelEgress);
  assert("13.9b re-proposing an unanswered action says they have not answered, not the same ask",
    !!again && /pending/.test(again.note) && /Do NOT call this tool again/.test(again.note),
    JSON.stringify(again?.note ?? null));
  assert("13.9b2 …and does not mint a second live proposal for the same call",
    st3b.rows.length === 1, JSON.stringify(st3b.rows.map((r) => r.fingerprint)));

  // ── 13.11 A CANCELLED PROPOSAL IS DEAD. The owner's charter names this explicitly: no action
  // may execute from "a cancelled proposal". Declining used to be prose only — "Hold off — skip
  // that one." went into the transcript and the row stayed redeemable for its whole window, so the
  // refusal was something the model had to keep honouring rather than something the platform had
  // recorded. Kills: deleting `cancelConfirmations`, or calling it without the compare-and-set.
  const st5 = makeConfirmStore([{
    user_id: USER, tool_name: TOOL, fingerprint: "dddddddddddddddd",
    args: PROPOSED, issued_in_request: EARLIER,
  }]);
  const declined = await drive({
    clientId: OWN, stream: true,
    extraBody: { threadId: THREAD, declinedConfirmations: ["dddddddddddddddd"] },
    text: "Hold off — skip that one.",
    toolCall: { name: TOOL, args: { client_id: OWN, updates: { goal: "buy a house" }, confirm: true } },
    ...CONFIRM,
    tablesExtra: { paige_pending_confirmations: st5.table },
  });
  assert("13.11 a proposal the person declined cannot then be executed",
    !declined.outboundCalls.some((c) => c.url.includes("paige-write-back")),
    JSON.stringify(declined.outboundCalls.map((c) => c.body)));

  const declinedReplay = await drive({
    clientId: OWN, stream: true,
    extraBody: { threadId: THREAD, approvedConfirmations: ["dddddddddddddddd"] },
    toolCall: { name: TOOL, args: { ...PROPOSED, confirm: true } }, ...CONFIRM,
    tablesExtra: { paige_pending_confirmations: st5.table },
  });
  assert("13.H1", st5.rows[0].consumed
    && !declinedReplay.outboundCalls.some((call) => call.url.includes("paige-write-back")));

  const cancelQ = declined.rec.from.find((f) => f.table === "paige_pending_confirmations"
    && f.op === "update" && f.filters.some((x) => x[0] === "eq" && x[1] === "issued_in_request"));
  assert("13.11b the decline is a scoped compare-and-set, not a blind update",
    !!cancelQ && cancelQ.client === "service"
      && cancelQ.filters.some((x) => x[0] === "eq" && x[1] === "user_id")
      && cancelQ.filters.some((x) => x[0] === "is" && x[1] === "consumed_at" && x[2] === null),
    JSON.stringify(cancelQ?.filters ?? "no cancel recorded"));

  // ── 13.11c …and a turn carrying no decline does not touch the table that way, or 13.11 would
  // be satisfied by cancelling everything on every request — which is its own outage.
  assert("13.11c a turn with nothing declined cancels nothing",
    !proposed.rec.from.some((f) => f.table === "paige_pending_confirmations"
      && f.filters.some((x) => x[0] === "in" && x[1] === "fingerprint")),
    JSON.stringify(proposed.rec.from.filter((f) => f.table === "paige_pending_confirmations").map((f) => f.op)));

  // ── 13.10 If the proposal cannot be RECORDED, the refusal says so plainly.
  // Kills: reporting a failed insert as a live pending approval — a livelock dressed as one.
  const cannotRecord = await drive({
    clientId: OWN, stream: true, extraBody: { threadId: THREAD },
    toolCall: { name: TOOL, args: { client_id: OWN, updates: { goal: "y" } } },
    ...CONFIRM,
    tableErrorsExtra: { "paige_pending_confirmations:insert": { message: "denied", code: "42501" } },
  });
  const failedRefusal = refusalOf(cannotRecord.modelEgress);
  assert("13.10 an unrecordable proposal does not claim to be pending",
    !!failedRefusal && /could not be recorded/.test(failedRefusal.note),
    JSON.stringify(failedRefusal ?? null));
}

// ── 14. EVERY GATED TOOL CAN BE APPROVED AT ALL ──────────────────────────────────────────────
//
// Forty-eight of the fifty-one gated tools never declared an approval parameter, so the model
// could not signal consent even when it had been given. This reads the schema Paige ACTUALLY sends
// the model — the egress, not the source — and requires it on exactly the gated set.
//
// 14.0 exists because the first draft of this section passed while reading an EMPTY object: the
// egress arrives as JSON strings, so `JSON.stringify(body).includes('"name"')` matched nothing and
// every later filter ran over an empty list. A guard that proves the subject was found is the only
// thing standing between "no violations" and "no evidence" — the two are indistinguishable without
// it, and a mutation that deleted the whole injection left this green.
{
  // INT-334 R5b: the section reads the gated set from the wire — the turn must carry the full
  // manifest (an unclassified turn routes act), not the narrowed read set.
  const seen = await drive({ clientId: OWN, stream: true, classification: null });
  const wire = seen.modelEgress
    .map((b) => (typeof b === "string" ? b : JSON.stringify(b)))
    .join("\n")
    .replace(/\\"/g, '"');
  const declared = [...wire.matchAll(/"name":"([a-z0-9_]+)"/g)].map((m) => m[1]);

  // The gated set and the risk classes now come from the POLICY, because the handler no longer
  // holds either as a literal — which is the change this section is checking. Reading the policy
  // directly also means a check can never be satisfied by parsing the same list it is grading.
  const src = await (await import("node:fs/promises")).readFile(
    new URL("../../supabase/functions/paige-ai-chat/index.ts", import.meta.url), "utf8");
  const { mutatingTools, classifyAction, nonMutatingExemptions, MUTATION_VERB } =
    await import("../../supabase/functions/_shared/action-risk.ts");
  const gated = [...mutatingTools()];
  const highRisk = gated.filter((t) => classifyAction(t) === "high");
  const ownerOnly = gated.filter((t) => classifyAction(t) === "owner_only");
  const offered = gated.filter((t) => declared.includes(t));

  assert("14.0 the tool schema was actually found on the wire (guards this section)",
    gated.length >= 40 && offered.length >= 20,
    JSON.stringify({ gated: gated.length, declared: declared.length, offeredGated: offered.length }));

  /** The slice of the wire describing one tool: from its name to the next tool's name. */
  const blockFor = (t) => {
    const i = wire.indexOf(`"name":"${t}"`);
    if (i < 0) return "";
    const n = wire.indexOf('"name":"', i + 10);
    return wire.slice(i, n < 0 ? undefined : n);
  };

  const missing = offered.filter((t) => !/"confirm":\s*\{/.test(blockFor(t)));
  assert("14.1 every gated tool the model is offered declares how to approve it",
    missing.length === 0, JSON.stringify(missing));

  assert("14.2 …and a read-only tool does not (approval is not sprayed over everything)",
    declared.includes("web_fetch") && !/"confirm":\s*\{/.test(blockFor("web_fetch")),
    JSON.stringify({ sawWebFetch: declared.includes("web_fetch") }));

  // ── 14.3 NOTHING ON THE WIRE IS A SPENDABLE KEY. The parameter the model is given must be an
  // assertion it can make, never a token it can be handed and replay. Kills: reinstating
  // `confirm_token` in the schema, which is the door section 18 nails shut.
  assert("14.3 no gated tool offers the model a token to carry",
    !wire.includes("confirm_token"), "confirm_token is back on the wire");

  // ── 14.4 THE HIGH-RISK SET IS TOLD IT CANNOT SELF-APPROVE. The gate refuses `confirm: true` for
  // these regardless, so this is honesty rather than enforcement — but a model told nothing will
  // keep asserting approval and keep being refused, and the person will be told it is pending
  // forever. Kills: the one-branch description that says the same thing to every tool.
  const offeredHighRisk = highRisk.filter((t) => declared.includes(t));
  const { CRM_COMMAND_TOOL_NAMES } = await import("../../supabase/functions/_shared/crm-command/catalog.ts");
  const notWarned = offeredHighRisk.filter((t) => !(CRM_COMMAND_TOOL_NAMES.has(t)
    ? /not enough on its own/ : /workspace approval control/).test(blockFor(t)));
  assert("14.4 every high-risk tool tells the model its word is not enough",
    highRisk.length >= 10 && offeredHighRisk.length >= 5 && notWarned.length === 0,
    JSON.stringify({ highRisk: highRisk.length, offered: offeredHighRisk.length, notWarned }));

  // ── 14.5 …and an ORDINARY gated tool is not given that warning, or 14.4 would be satisfied by
  // printing it everywhere, which tells the model nothing about which acts are different.
  assert("14.5 approval-path hardening",
    declared.includes("update_client_data") && /workspace approval control/.test(blockFor("update_client_data")),
    JSON.stringify({ sawTool: declared.includes("update_client_data") }));

  // ── 14.6 THE SET IS A RULE, NOT A HAND-LIST. Mutation-testing found that deleting three tools
  // from HIGH_RISK_CONFIRM_TOOLS failed nothing: 18.6 drives one member, and a count threshold
  // cannot notice which members are missing. A hand-list also silently fails to cover the NEXT
  // delete tool somebody adds.
  //
  // So the membership rule is asserted structurally: any gated tool whose own name says it
  // destroys, publishes, or changes who may do what MUST be in the set. It is deliberately
  // one-directional — a tool can be high-risk without matching (`calendar_book_meeting`,
  // `zapier_run_action`) — because the patterns catch what is nameable, not everything that
  // qualifies. Kills: removing any pattern-matching member, and adding a new one outside the set.
  const IRREVERSIBLE_OR_OUTWARD = /(^|_)(delete|remove|revoke|publish|uninstall|install)(_|$)|(^|_)grant(_|$)/;
  const shouldBeStrong = gated.filter((t) => IRREVERSIBLE_OR_OUTWARD.test(t));
  // `owner_only` is stronger than `high`, not weaker, so it satisfies this rule too.
  const escaped = shouldBeStrong.filter((t) => !highRisk.includes(t) && !ownerOnly.includes(t));
  assert("14.6 every gated tool that destroys, publishes or changes permissions is at least high-risk",
    shouldBeStrong.length >= 8 && escaped.length === 0,
    JSON.stringify({ matched: shouldBeStrong, escaped }));

  // ── 14.6b NO FALLBACK PATH REACHES A HIGH-RISK ACTION. Inside a Studio session a short list of
  // creative BUILD tools is escalated from `confirm` to `auto`, because StudioChat has no confirm
  // affordance and gating them there stalls the agent in a loop that never builds anything. That
  // escalation is, by construction, a route to running something without the person answering —
  // which is exactly what a high-risk classification forbids. So the list and the high-risk set
  // must not intersect.
  //
  // §13, stated rather than implied: the runtime guard that enforces this is currently unreachable,
  // because today no member of the list is `high`. Deleting it therefore fails nothing, and this
  // check is what actually holds the property — it catches the change that would matter (promoting
  // a listed tool to `high`, or adding a `high` tool to the list) even though it cannot catch the
  // deletion of the belt beneath the braces.
  const studioAt = src.indexOf("const STUDIO_AUTO_TOOLS = new Set([");
  const studioAuto = studioAt < 0 ? [] : [...src.slice(studioAt, src.indexOf("]);", studioAt))
    .matchAll(/"([a-z0-9_]+)"/g)].map((m) => m[1]);
  const escalatedHighRisk = studioAuto.filter((t) => classifyAction(t) !== "ordinary");
  assert("14.6b the Studio auto-escalation cannot reach a high-risk action",
    studioAuto.length >= 3 && escalatedHighRisk.length === 0,
    JSON.stringify({ studioAuto, escalatedHighRisk }));

  // ── 14.7 THE CLASSIFIER CANNOT BE TALKED INTO A CLASS. An object-literal lookup answers
  // `"constructor"` with a function off the prototype chain, so an invented tool name would come
  // back classified. Kills: swapping the Map for an object literal.
  assert("14.7 an invented tool name is unclassified, not whatever the prototype returns",
    classifyAction("constructor") === "unclassified"
      && classifyAction("__proto__") === "unclassified"
      && classifyAction("toString") === "unclassified"
      && classifyAction("") === "unclassified",
    JSON.stringify(["constructor", "__proto__", "toString", ""].map(classifyAction)));

  // ── 14.8 EVERY DECLARED TOOL IS EITHER CLASSIFIED, EXEMPTED WITH A REASON, OR READS AS A QUERY.
  // This is the inventory: a new write tool cannot be added without landing in one of the three,
  // and the only one of the three that lets it run is the classification. Kills: adding a write
  // tool and forgetting the policy — which is the exact failure the hand-list made free.
  const exempt = nonMutatingExemptions();
  const unaccounted = declared.filter((t) =>
    MUTATION_VERB.test(t) && classifyAction(t) === "unclassified" && !exempt.has(t));
  assert("14.8 no declared tool reads as a write while carrying no classification",
    unaccounted.length === 0, JSON.stringify(unaccounted));
  assert("14.8b …and every exemption states why it persists nothing",
    [...exempt.values()].every((why) => typeof why === "string" && why.length > 20),
    JSON.stringify([...exempt]));

  // ── 14.9 THE EVALUATION-LOOP + CONTAINED SOCIAL PUBLISH SEAM.
  // Improvement proposal and decision remain governed writes. Social publication is deliberately
  // absent from the executable Chat registry until its tenant-safe provider contract, approval,
  // idempotency, readback, receipt, and reconciliation path exists; an unavailable tool must remain
  // unclassified so it cannot be mistaken for a runnable action merely because it has a risk label.
  assert("14.9 improvement_propose is ordinary (stages a proposal; applies nothing)",
    classifyAction("improvement_propose") === "ordinary", classifyAction("improvement_propose"));
  assert("14.9b social_post is unavailable and therefore unclassified",
    classifyAction("social_post") === "unclassified", classifyAction("social_post"));
  assert("14.9c improvement_decide is high (the governed sign-off; never runs from chat uncarded)",
    classifyAction("improvement_decide") === "high", classifyAction("improvement_decide"));
  assert("14.9d `decide` now reads as a mutation verb, so an unclassified *_decide cannot slip through",
    MUTATION_VERB.test("improvement_decide") === true, String(MUTATION_VERB.test("improvement_decide")));
}

// ── 15. §67 — PAIGE BUILDS A PROCESS, BUT NEVER GRANTS HERSELF ONE ───────────────────────────
//
// The whole point of granting autonomy to a PROCESS is that a human decides how much of it runs
// unattended. An agent that could compose a process and authorise it in the same breath would have
// granted itself autonomy, which is the one thing this design exists to prevent. So the row is born
// at the floor — `confirm` and `draft` — whatever the operator said in the same sentence, and
// raising it is a separate, confirm-gated act.
{
  // The tenant has set these to run without asking, so the gate is not what is under test here.
  // The tier is stated EXPLICITLY rather than left to the harness default: `get_actor_access` is
  // unstubbed by default and `resolveTier` fails closed to `client`, so an operator drive that did
  // not say so would silently be testing a client seat — which is how 15.0 below was found.
  const AUTO = { rpcOverrides: {
    resolve_tool_autonomy: { data: "auto", error: null },
    get_actor_access: { data: { tier: "tenant" }, error: null },
  } };
  const AS_CLIENT = { get_actor_access: { data: { tier: "client" }, error: null } };
  /** Model the process tables. The trigger catalogue is real reference data; the automations table
   *  records what was inserted so the invariant can be read off the write itself. */
  function processStore({ resolved = { effective: "confirm", capped_by: null, would_run: false, dark: [] } } = {}) {
    return {
      paige_automation_triggers: (filters) => {
        const key = filters.find((f) => f[0] === "eq" && f[1] === "key")?.[2];
        const rows = [
          { key: "manual.run_now", is_live: true, dark_reason: null },
          { key: "conversation.call_ended", is_live: false, dark_reason: "no voice substrate yet" },
        ];
        return key === undefined ? rows : rows.filter((r) => r.key === key);
      },
      paige_automations: () => [{ id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", name: "New lead welcome", granted_lane: "auto", state: "live" }],
      paige_automation_acts: () => [],
      __rpc: { resolve_automation_autonomy: { data: resolved, error: null } },
    };
  }

  // A CLIENT-PORTAL SEAT CANNOT AUTHOR PROCESSES, and that is checked first because the harness
  // caller is one by default — driving with a focused client is what surfaced it. Automations are
  // an operator capability (§51/§60); a client being able to arm work inside someone's workspace
  // would be the seam failure, not a feature.
  const seatStore = processStore();
  const asClient = await drive({
    clientId: OWN, stream: true,
    toolCall: { name: "automation_draft", args: { name: "x", trigger_key: "manual.run_now", steps: [{ tool_key: "crm_create_task" }] } },
    rpcOverrides: { ...AUTO.rpcOverrides, ...AS_CLIENT, ...seatStore.__rpc },
    tablesExtra: seatStore,
  });
  assert("15.0 a client-portal seat cannot author a process at all",
    !asClient.rec.inserts.some((i) => i.table === "paige_automations"),
    JSON.stringify(asClient.rec.inserts.map((i) => i.table)));

  // ── 15.G THE GATE ITSELF, AT THE DEFAULT LANE. Every other check in this section forces
  // `resolve_tool_autonomy: "auto"` so the gate is out of the way and the HANDLER is what is under
  // test. That left the gate untested: an independent review deleted all three automation tools
  // from `MUTATING_TOOLS` — so they would run unproposed — and every suite stayed green. Section 14
  // could not catch it either, because it derives the gated set by parsing the same literal it is
  // checking, which can only ever find a tool that is gated-but-undeclared, never one that stopped
  // being gated. This drives the DEFAULT lane, where a proposal is the correct outcome.
  {
    const gateStore = processStore();
    const ungated = await drive({
      stream: true,
      toolCall: { name: "automation_set_grant", args: { automation_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", lane: "auto" } },
      // NO resolve_tool_autonomy override: the tenant has set nothing, so the resolver's own safe
      // default (`confirm`) applies — exactly the posture a real workspace starts in.
      rpcOverrides: { get_actor_access: { data: { tier: "tenant" }, error: null }, ...gateStore.__rpc },
      tablesExtra: gateStore,
    });
    assert("15.G raising an autonomy grant is PROPOSED, not performed, at the default lane",
      !ungated.rec.inserts.some((i) => i.table === "paige_automations" && i.update),
      JSON.stringify(ungated.rec.inserts.filter((i) => i.table === "paige_automations")));
    const gateWire = ungated.modelEgress
      .map((b) => (typeof b === "string" ? b : JSON.stringify(b))).join("\n").replace(/\\"/g, '"');
    // §67's red line is no longer "she must ask before raising her own autonomy" — it is that she
    // cannot raise it from a conversation AT ALL, at any approval strength, however the request is
    // worded. So the correct outcome is not a confirm card: it is a refusal that points at
    // Settings. A card here would be the defect, because a card is a thing that can be answered.
    assert("15.H …and it is REFUSED outright, not offered as something to approve",
      !/"needs_confirm":true/.test(gateWire) && /settings/i.test(gateWire),
      gateWire.includes("needs_confirm")
        ? "offered as an approvable card — it must not be approvable here at all"
        : "refused, but without telling them where the decision lives");
  }

  const st = processStore();
  const built = await drive({
    stream: true,
    toolCall: { name: "automation_draft", args: {
      name: "New lead welcome", trigger_key: "manual.run_now",
      // The operator's phrasing said "just run it" — the model faithfully passes it on. It must
      // change nothing, which is exactly why it is in the fixture.
      granted_lane: "auto", state: "live",
      steps: [{ tool_key: "crm_create_task" }],
    } },
    rpcOverrides: { ...AUTO.rpcOverrides, ...st.__rpc },
    tablesExtra: st,
  });
  const row = built.rec.inserts.find((i) => i.table === "paige_automations")?.row;
  assert("15.1 a process Paige builds is born asking-first and switched off",
    !!row && row.granted_lane === "confirm" && row.state === "draft",
    JSON.stringify(row ?? null));
  // Kills: passing the model's arguments straight through, or defaulting these columns instead of
  // setting them. Either would let "just run it automatically" arm a process nobody reviewed.
  assert("15.2 …even when the call it was given said auto and live",
    !!row && row.granted_lane !== "auto" && row.state !== "live",
    JSON.stringify(row ?? null));
  assert("15.3 …and it is stamped with the server-resolved tenant and its author",
    !!row && Object.prototype.hasOwnProperty.call(row, "tenant_id") && row.created_by === USER,
    JSON.stringify(row ?? null));

  // A trigger that is not in the catalogue must be refused rather than invented, or Paige will
  // cheerfully build a process that can never fire.
  const invented = await drive({
    stream: true,
    toolCall: { name: "automation_draft", args: {
      name: "Wishful", trigger_key: "someone.thinks.about.us", steps: [{ tool_key: "crm_create_task" }] } },
    rpcOverrides: { ...AUTO.rpcOverrides, ...st.__rpc },
    tablesExtra: st,
  });
  // ASSERTING THE REFUSAL, NOT MERELY THE ABSENCE OF A WRITE. Mutation-testing caught this one:
  // with the trigger check removed the code throws on the missing row and still writes nothing, so
  // "no insert" was true for the wrong reason and the mutation stayed green. What must hold is that
  // the model is TOLD to pick a real trigger — otherwise it retries with another invented one.
  const inventedWire = invented.modelEgress
    .map((b) => (typeof b === "string" ? b : JSON.stringify(b))).join("\n").replace(/\\"/g, '"');
  assert("15.4 an invented trigger builds nothing, and says why",
    !invented.rec.inserts.some((i) => i.table === "paige_automations")
      && /do not invent one/.test(inventedWire),
    JSON.stringify({ inserts: invented.rec.inserts.map((i) => i.table), told: /do not invent one/.test(inventedWire) }));

  // A process with no steps does nothing when it fires; building one would be a shell the operator
  // finds later and cannot explain.
  const stepless = await drive({
    stream: true,
    toolCall: { name: "automation_draft", args: { name: "Empty", trigger_key: "manual.run_now", steps: [] } },
    rpcOverrides: { ...AUTO.rpcOverrides, ...st.__rpc },
    tablesExtra: st,
  });
  assert("15.5 a process with no steps builds nothing",
    !stepless.rec.inserts.some((i) => i.table === "paige_automations"),
    JSON.stringify(stepless.rec.inserts.map((i) => i.table)));

  // ── 15.6/15.7 REWRITTEN 2026-09-02, AND WHAT THEY USED TO ASSERT IS THE REASON ──────────────
  //
  // These two drove `automation_set_grant` — classified `owner_only` — through this block's `AUTO`
  // fixture, which pins `resolve_tool_autonomy` to "auto". They passed because the entire risk gate
  // lives inside `if (autoMode === "confirm")`, so an `auto` mode skipped not just the confirmation
  // but the `owner_only` refusal with it. `set_tool_autonomy` accepts any mode for any tool key
  // without consulting its class, so that was reachable in production by one row: a tenant admin
  // could put the grant tool on auto and Paige could then RAISE HER OWN AUTONOMY from a
  // conversation. The standing rule is that she may never do that "regardless of action class or
  // owner wording", and a settings toggle is owner wording.
  //
  // So the old assertions were describing the hole rather than the contract, and the handler now
  // clamps `auto` down to `confirm` for any `high` or `owner_only` action before the branch. What
  // is asserted here now is the refusal — including that it names where the decision actually
  // lives, because "you cannot do that" without "here is where it happens" is a dead end.
  //
  // COVERAGE HONESTLY LOST, recorded rather than quietly dropped: the property the old pair
  // protected — §13, that a grant the ceiling holds down is reported as what will ACTUALLY happen
  // rather than as what was asked for — is no longer reachable through chat for this tool, because
  // the tool is no longer reachable through chat at all. The resolved-posture reporting in its
  // result is now dead code on this path. That is a consequence of closing the hole, not an
  // argument against closing it, but the next person to touch `automation_set_grant` should know
  // the posture code is unexercised here.
  const capped = processStore({ resolved: { effective: "confirm", capped_by: "ceiling", would_run: true, dark: [] } });
  const granted = await drive({
    stream: true,
    toolCall: { name: "automation_set_grant", args: { automation_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", lane: "auto" } },
    rpcOverrides: { ...AUTO.rpcOverrides, ...capped.__rpc },
    tablesExtra: capped,
  });
  const wire = granted.modelEgress.map((b) => (typeof b === "string" ? b : JSON.stringify(b))).join("\n").replace(/\\"/g, '"');
  assert("15.6 an owner-only grant is refused even when the workspace set it to auto",
    /"success":false/.test(wire) && /operator's decision to make in their settings/.test(wire),
    wire.includes("what_actually_happens") ? "IT RAN — the auto mode still bypasses the owner_only refusal" : "refused, but not for the stated reason");
  assert("15.7 …and nothing was written, so she cannot report a grant that did not happen",
    !granted.rec.inserts.some((i) => i.table === "paige_automations") &&
      !/"what_actually_happens"/.test(wire),
    JSON.stringify(granted.rec.inserts.map((i) => i.table)));
}

// ── 16. NO DURABLE WRITE IN THIS FILE IGNORES ITS OWN ERROR ──────────────────────────────────
//
// postgrest-js defaults `shouldThrowOnError` to FALSE, so a constraint violation, an RLS refusal or
// a missing column RESOLVES with an `error` on the result instead of throwing. `await
// supabase.from(x).insert(y)` inside a try/catch therefore catches NOTHING for the commonest
// failures, and the row silently never lands. That is how a status outside a live CHECK killed a
// whole feature while the code reported success, and how four `client_memory` inserts — the things
// Paige later recalls about a person — could fail with no symptom but her quietly remembering
// nothing.
//
// THIS IS A STATIC CHECK AND IS LABELLED AS ONE. It reads the source rather than driving a rejected
// write, and I say so rather than dressing it up: the memory write path is not reachable from this
// harness's fixtures, so a runtime assertion here would have witnessed nothing while appearing to
// prove something. What this DOES catch is the recurrence that actually matters — a NEW write added
// later that ignores its error — which no single runtime case would have caught either.
//
// The runtime half is covered elsewhere and honestly: `writeIfScopeCurrent` is driven against a
// postgrest-shaped `{error}` in the extraction path, and 13.10 drives a rejected proposal insert
// through the real handler.
{
  if (process.env.PROBE) {
    for (const t of ["analytics_events","paige_chat_threads","kb_query_telemetry","client_memory","deal_activities"]) {
      const d = await drive({ clientId: OWN, stream: true, extraBody: { threadId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc" },
        tableErrorsExtra: { [`${t}:insert`]: { message: "boom", code: "23514" }, [`${t}:update`]: { message: "boom", code: "23514" } } });
      const hit = d.logged.filter((l) => /write REJECTED/.test(l.msg)).map((l)=>l.msg);
      console.log("PROBE", t, hit.length ? hit[0].slice(0,90) : "(not reached)");
    }
  }
  const raw = await (await import("node:fs/promises")).readFile(
    new URL("../../supabase/functions/paige-ai-chat/index.ts", import.meta.url), "utf8");

  // COMMENTS ARE STRIPPED FIRST. The previous version exempted a write when the word "error"
  // appeared anywhere in the three lines above it — and this file is heavily commented, so almost
  // any write under a paragraph mentioning errors was silently exempt. An independent review drove
  // it: an unchecked insert placed under such a comment passed. Prose must not be able to satisfy
  // a guard about code.
  const src = raw
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");

  // STATEMENTS, NOT LINES. `.from(x)` and `.insert(y)` frequently sit on different lines, so a
  // line-scoped matcher misses them entirely — three real writes in this file were already
  // invisible to it. Splitting on `;` is crude but it is the unit a postgrest chain ends with.
  const statements = src.split(";");
  const unchecked = [];
  for (const st of statements) {
    // `await` IMMEDIATELY BEFORE THE CLIENT is what makes this an EXECUTED write. Without it the
    // chain is a builder being assembled into a variable (`let q = supabaseClient.from(...)`), and
    // the execution — and the error check that belongs with it — happens where that variable is
    // finally awaited. Honest limit: a builder-based write whose await never checks its error
    // would not be caught here. There is exactly one builder in this file (`claimConfirmation`)
    // and it does check; a second one would want this widened.
    if (!/await\s+(supabase|supabaseClient|supabaseAdmin|admin)\s*\.from\(/.test(st)
        && !/await\s+\w+\s*\(\s*"[^"]*",\s*(supabase|supabaseClient|supabaseAdmin|admin)\s*\.from\(/.test(st)) continue;
    // `.update(` matched generally — the old pattern required `.update({`, so passing a variable
    // (`.update(row)`) skipped the guard entirely. Also driven by the review.
    if (!/\.(insert|upsert|update)\s*\(/.test(st)) continue;
    // An EXPLICIT marker, never a substring of prose: routed through a checked helper, or the
    // caller destructures the error itself, or it is returned for a caller to check.
    if (/\brecordWrite\s*\(|\bwriteIfScopeCurrent\s*\(|\bcheckedWrite\s*\(/.test(st)) continue;
    if (/\{[^}]*\berror\b[^}]*\}\s*=\s*await/.test(st)) continue;
    if (/\breturn\s+await\b/.test(st)) continue;
    unchecked.push(st.trim().replace(/\s+/g, " ").slice(0, 110));
  }
  assert("16.1 every durable write reads its error, is wrapped, or returns it",
    unchecked.length === 0, JSON.stringify(unchecked, null, 1));

  // The guard against the guard finding nothing to look at.
  const candidates = statements.filter((st) =>
    /await\s+(?:\w+\s*\(\s*"[^"]*",\s*)?(supabase|supabaseClient|supabaseAdmin|admin)\s*\.from\(/.test(st)
    && /\.(insert|upsert|update)\s*\(/.test(st)).length;
  assert("16.0 the sweep actually found durable writes to check (guards 16.1)",
    candidates >= 15, String(candidates));

}

// ── 17. §70 — A PROPOSAL NOBODY CLICKED IS REACHABLE AGAIN ───────────────────────────────────
//
// The card is live-turn only; it is never rehydrated into a reloaded thread. So a person who read
// Paige's findings, got distracted and came back had no way back to them at all — the row sat at
// `awaiting_review` forever while every other surface correctly reported the upload as analysed.
// Migration 20261019000000 even added a partial index for "what is still waiting on me", and
// nothing ever ran that query.
//
// The load-bearing assertion is 17.2: it is not enough for the tool to succeed, the CARD has to
// reach the wire. The emit sits in an else-if chain whose earlier branches are the document paths,
// so "the third branch is reached on an ordinary turn" is a claim about control flow that has to be
// driven, not read.
{
  const STRUCTURED = {
    scores: { equifax: 712, experian: 705, transunion: 698 },
    negative_items: [{ creditor: "A" }, { creditor: "B" }],
    positive_accounts: [], hard_inquiries: [],
  };
  // Faithful to postgrest: a filter the code sends must NARROW here, or a check that the pending
  // list excludes settled documents would pass whether or not the code filters at all.
  const uploads = (rows) => ({
    credit_report_uploads: (filters) => {
      const eq = (col) => filters.find((f) => f[0] === "eq" && f[1] === col)?.[2];
      const id = eq("id");
      const state = eq("extraction_review_state");
      return rows
        .filter((r) => id === undefined || r.id === id)
        .filter((r) => state === undefined || r.extraction_review_state === state);
    },
  });
  const WAITING = {
    id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee", user_id: USER, client_id: null,
    file_name: "Experian-July.pdf", created_at: "2026-08-20T00:00:00Z",
    last_analyzed_at: "2026-08-20T00:00:00Z",
    analysis_result: STRUCTURED, extraction_review_state: "awaiting_review",
  };

  const SETTLED = { ...WAITING, id: "ffffffff-ffff-4fff-8fff-ffffffffffff",
    file_name: "Equifax-June.pdf", extraction_review_state: "applied" };

  const listed = await drive({
    stream: true,
    toolCall: { name: "document_pending_reviews", args: {} },
    rpcOverrides: { get_actor_access: { data: { tier: "tenant" }, error: null } },
    tablesExtra: uploads([WAITING, SETTLED]),
  });
  const listWire = listed.modelEgress.map((b) => (typeof b === "string" ? b : JSON.stringify(b)))
    .join("\n").replace(/\\"/g, '"');
  assert("17.1 a document still waiting on a person is findable, by name",
    /Experian-July\.pdf/.test(listWire), "the pending list never reached the model");
  // Kills: dropping the state filter, which would offer to "go through" documents already settled.
  assert("17.1b …and one already dealt with is NOT offered as waiting",
    !/Equifax-June\.pdf/.test(listWire), "a settled document was listed as still waiting");

  const resumed = await drive({
    stream: true,
    toolCall: { name: "document_resume_review", args: { upload_id: WAITING.id } },
    rpcOverrides: { get_actor_access: { data: { tier: "tenant" }, error: null } },
    tablesExtra: uploads([WAITING]),
  });
  // THE CARD ITSELF, on the wire the surface reads. Kills: setting the proposal on a variable the
  // close-out never emits, and rebuilding a proposal with no fields.
  assert("17.2 …and resuming it puts the CARD back on the wire",
    /"extraction_proposal"/.test(resumed.bodyText ?? ""),
    (resumed.bodyText ?? "").slice(0, 200));
  assert("17.3 …carrying the findings, re-derived from the stored reading",
    /credit_score_equifax/.test(resumed.bodyText ?? "") && /712/.test(resumed.bodyText ?? ""),
    (resumed.bodyText ?? "").slice(0, 300));
  // It re-SHOWS; it must not save. Kills: any write slipping into the resume path.
  assert("17.4 …and resuming saves nothing",
    !resumed.rec.inserts.some((i) => i.table !== "paige_llm_trace")
      && !resumed.outboundCalls.some((c) => c.url.includes("paige-write-back") || c.url.includes("sync-credit-report-data")),
    JSON.stringify({ inserts: resumed.rec.inserts.map((i) => i.table), out: resumed.outboundCalls.map((c) => c.url) }));

  // A settled document is not re-offerable. Kills: dropping the state check, which would let a
  // person be shown a card for something they had already declined.
  const settled = await drive({
    stream: true,
    toolCall: { name: "document_resume_review", args: { upload_id: WAITING.id } },
    rpcOverrides: { get_actor_access: { data: { tier: "tenant" }, error: null } },
    tablesExtra: uploads([{ ...WAITING, extraction_review_state: "applied" }]),
  });
  assert("17.5 an already-settled document cannot be re-offered",
    !/"extraction_proposal"/.test(settled.bodyText ?? ""),
    (settled.bodyText ?? "").slice(0, 200));
}

// ── 18. APPROVAL-PATH HARDENING ───────────────────────────────────────────────────────────
{
  const CONFIRM = { rpcOverrides: {
    resolve_tool_autonomy: { data: "confirm", error: null },
    get_actor_access: { data: { tier: "tenant" }, error: null },
  } };
  const THREAD = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
  const AUTOMATION = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const wroteBack = (r) => r.outboundCalls.some((c) => c.url.includes("paige-write-back"));

  const hardeningStore = makeConfirmStore();
  const hardeningArgs = { client_id: OWN, updates: { goal: "approval-path-check" } };
  const hardeningDrive = (args, body = {}) => drive({
    stream: true, clientId: OWN, extraBody: { threadId: THREAD, ...body },
    toolCall: { name: "update_client_data", args }, ...CONFIRM,
    tablesExtra: { paige_pending_confirmations: hardeningStore.table },
    onInsert: mirrorConfirms(hardeningStore),
  });
  const hardeningProposal = await hardeningDrive(hardeningArgs);
  const hardeningFrames = hardeningProposal.bodyText.split("\n")
    .filter((line) => line.startsWith("data: ") && line !== "data: [DONE]")
    .map((line) => JSON.parse(line.slice(6)));
  const hardeningCard = hardeningFrames.find((frame) => frame.paige_confirm)?.paige_confirm;
  assert("18.H1", !wroteBack(hardeningProposal)
    && hardeningStore.rows.length === 1
    && /^[0-9a-f]{16}:[0-9a-f-]{36}$/.test(hardeningCard?.fingerprint ?? "")
    && hardeningCard.fingerprint === issuedApproval(hardeningStore.rows[0]));
  const hardeningUnselected = await hardeningDrive({ ...hardeningArgs, confirm: true });
  assert("18.H2", !wroteBack(hardeningUnselected));
  assert("18.H3", hardeningStore.rows.length === 1 && !hardeningStore.rows[0].consumed);
  const hardeningSelected = await hardeningDrive(
    { ...hardeningArgs, updates: { goal: "different-value" }, confirm: true },
    { approvedConfirmations: [hardeningCard?.fingerprint] },
  );
  assert("18.H4", hardeningSelected.outboundCalls.filter((call) => call.url.includes("paige-write-back")).length === 1
    && hardeningSelected.outboundCalls.some((call) => call.body.includes("approval-path-check"))
    && !hardeningSelected.outboundCalls.some((call) => call.body.includes("different-value")));
  const hardeningReplay = await hardeningDrive(hardeningArgs, { approvedConfirmations: [hardeningCard?.fingerprint] });
  assert("18.H5", !wroteBack(hardeningReplay));
  const hardeningReplayAgain = await hardeningDrive(hardeningArgs, { approvedConfirmations: [hardeningCard?.fingerprint] });
  assert("18.H6", !wroteBack(hardeningReplayAgain));
  const hardeningNext = await hardeningDrive(hardeningArgs);
  const hardeningNextCard = hardeningNext.bodyText.split("\n")
    .filter((line) => line.startsWith("data: ") && line !== "data: [DONE]")
    .map((line) => JSON.parse(line.slice(6))).find((frame) => frame.paige_confirm)?.paige_confirm;
  assert("18.H7", !!hardeningNextCard?.fingerprint && hardeningNextCard.fingerprint !== hardeningCard?.fingerprint);
  const hardeningOld = await hardeningDrive(hardeningArgs, { approvedConfirmations: [hardeningCard?.fingerprint] });
  assert("18.H8", !wroteBack(hardeningOld)
    && hardeningStore.rows.some((row) => issuedApproval(row) === hardeningNextCard?.fingerprint && !row.consumed));
  const hardeningNextSelected = await hardeningDrive(hardeningArgs, { approvedConfirmations: [hardeningNextCard?.fingerprint] });
  assert("18.H9", hardeningNextSelected.outboundCalls.filter((call) => call.url.includes("paige-write-back")).length === 1);
  for (let retry = 0; retry < 3; retry++) {
    const result = await hardeningDrive(hardeningArgs, { approvedConfirmations: [hardeningNextCard?.fingerprint] });
    assert("18.H10." + retry, !wroteBack(result));
  }
  const hardeningLegacy = makeConfirmStore([
    { ...hardeningStore.rows[0], fingerprint: "eeeeeeeeeeeeeeee", consumed: true },
    { ...hardeningStore.rows[0], fingerprint: "eeeeeeeeeeeeeeee", id: "legacy-pending", consumed: false, issued_in_request: "legacy-request" },
  ]);
  const hardeningLegacyResult = await drive({
    stream: true, clientId: OWN,
    extraBody: { threadId: THREAD, approvedConfirmations: [hardeningLegacy.rows[0].fingerprint] },
    toolCall: { name: "update_client_data", args: hardeningArgs }, ...CONFIRM,
    tablesExtra: { paige_pending_confirmations: hardeningLegacy.table },
    onInsert: mirrorConfirms(hardeningLegacy),
  });
  assert("18.H11", !wroteBack(hardeningLegacyResult) && !hardeningLegacy.rows[1].consumed);

  const batchStore = makeConfirmStore();
  const batchDrive = (args, body = {}) => drive({
    stream: true, clientId: OWN, extraBody: { threadId: THREAD, ...body },
    toolCall: { name: "update_client_data", args }, ...CONFIRM,
    tablesExtra: { paige_pending_confirmations: batchStore.table },
    onInsert: mirrorConfirms(batchStore),
  });
  const batchArgs = ["one", "two", "three"].map((goal) => ({ client_id: OWN, updates: { goal } }));
  for (const args of batchArgs) await batchDrive(args);
  const batchSelected = await batchDrive({ ...batchArgs[2], confirm: true }, {
    approvedConfirmations: batchStore.rows.map(issuedApproval),
  });
  // C4a: the person approved all three cards, so all three stored calls run — each exactly once,
  // each from its own stored arguments — whatever the model re-emits. (On main only the one the model
  // happened to re-emit ran and the other two were stranded: the prod defect C4a fixes.)
  const batchWrites = batchSelected.outboundCalls.filter((call) => call.url.includes("paige-write-back"));
  assert("18.H12", batchStore.rows.length === 3
    && batchStore.rows.every((row) => row.consumed)
    && batchWrites.length === 3
    && ["one", "two", "three"].every((goal) => batchWrites.filter((call) => call.body.includes(`"goal":"${goal}"`)).length === 1),
    JSON.stringify({ rows: batchStore.rows.length, consumed: batchStore.rows.filter((r) => r.consumed).length, writes: batchWrites.map((c) => c.body.slice(0, 80)) }));
  const legacyFresh = hardeningLegacy.rows.find((row) => !row.consumed
    && row.fingerprint !== hardeningLegacy.rows[0].fingerprint);
  assert("18.H13", !!legacyFresh);
  if (legacyFresh) {
    const legacySelected = await drive({
      stream: true, clientId: OWN,
      extraBody: { threadId: THREAD, approvedConfirmations: [issuedApproval(legacyFresh)] },
      toolCall: { name: "update_client_data", args: hardeningArgs }, ...CONFIRM,
      tablesExtra: { paige_pending_confirmations: hardeningLegacy.table },
      onInsert: mirrorConfirms(hardeningLegacy),
    });
    assert("18.H14", wroteBack(legacySelected));
  }

  const subjectStore = makeConfirmStore();
  const subjectDrive = (args, body = {}) => drive({
    stream: true, extraBody: { threadId: THREAD, ...body },
    toolCall: { name: "action_advance", args }, ...CONFIRM,
    tablesExtra: { paige_pending_confirmations: subjectStore.table, user_roles: [{ role: "admin" }] },
    onInsert: mirrorConfirms(subjectStore),
  });
  const subjectArgs = [OWN, FOREIGN].map((action_id) => ({ action_id, to_status: "dismissed", decision_rationale: "original note" }));
  for (const args of subjectArgs) await subjectDrive(args);
  const subjectSelected = await subjectDrive({ ...subjectArgs[1], decision_rationale: "different note", confirm: true }, {
    approvedConfirmations: subjectStore.rows.map(issuedApproval),
  });
  // C4a: both approved subjects run, each once, each with its STORED rationale; the model's drifted
  // re-emit for the second subject is refused as already handled (same subject id), never a third run.
  const advanced = subjectSelected.rec.rpc.filter((call) => call.name === "advance_action");
  assert("18.H15", subjectStore.rows.length === 2 && subjectStore.rows.every((row) => row.consumed)
    && advanced.length === 2
    && [OWN, FOREIGN].every((id) => advanced.filter((call) => call.args.p_action_id === id && call.args.p_decision_rationale === "original note").length === 1),
    JSON.stringify(advanced.map((c) => c.args)));

  // 18.ID1–ID8 — AN ID THE EXECUTOR CANNOT ADDRESS NEVER BECOMES A CARD, never spends an approval,
  // and never reaches advance_action. 2026-09-13: Paige sent a shortened action id, the approval was
  // claimed, and advance_action failed its uuid cast — 13 proposals, 0 dismissals. The §39 peer-gate
  // on #1458 drove the first version of the check here and found that a MISSING subject and a
  // shortened invocation_id still became cards; these pin the fix on the real handler.
  {
    const frames = (r) => r.bodyText.split("\n").filter((l) => l.startsWith("data: ") && l !== "data: [DONE]")
      .map((l) => { try { return JSON.parse(l.slice(6)); } catch { return null; } }).filter(Boolean);
    const cardOf = (r) => frames(r).find((f) => f.paige_confirm)?.paige_confirm;
    const advanced = (r) => r.rec.rpc.filter((c) => c.name === "advance_action");
    const toldModel = (r) => r.modelEgress.map((b) => b.replace(/\\"/g, '"')).join("\n");
    const audited = (r) => (r.rec.inserts ?? []).filter((i) => i.table === "paige_audit_log");
    const WHOLE = "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11";
    const AUTO = { rpcOverrides: {
      resolve_tool_autonomy: { data: "auto", error: null },
      get_actor_access: { data: { tier: "tenant" }, error: null },
    } };
    const idDrive = (store, args, lane) => drive({
      stream: true, extraBody: { threadId: THREAD },
      toolCall: { name: "action_advance", args }, ...lane,
      tablesExtra: { paige_pending_confirmations: store.table, user_roles: [{ role: "admin" }] },
      onInsert: mirrorConfirms(store),
    });

    for (const [id, label, args] of [
      ["18.ID1", "a shortened subject (the 2026-09-13 value)", { action_id: "424b85ac", to_status: "dismissed" }],
      ["18.ID2", "a missing subject", { to_status: "dismissed" }],
      ["18.ID3", "a blank subject", { action_id: "   ", to_status: "dismissed" }],
      ["18.ID4", "a subject that is not a string", { action_id: 424, to_status: "dismissed" }],
      ["18.ID5", "a shortened invocation_id", { action_id: WHOLE, to_status: "drafted", invocation_id: "3f2a91c0" }],
    ]) {
      const store = makeConfirmStore();
      const r = await idDrive(store, args, CONFIRM);
      assert(`${id} ${label}: no card, nothing to spend, and advance_action is never called`,
        store.rows.length === 0 && !cardOf(r) && advanced(r).length === 0 && /id_not_addressable/.test(toldModel(r)),
        JSON.stringify({ rows: store.rows.length, card: !!cardOf(r), rpc: advanced(r).length }));
    }

    const wholeStore = makeConfirmStore();
    const whole = await idDrive(wholeStore, { action_id: WHOLE, to_status: "dismissed" }, CONFIRM);
    assert("18.ID6 a complete id still becomes a card — the check refuses only what cannot run",
      wholeStore.rows.length === 1 && !!cardOf(whole) && advanced(whole).length === 0,
      JSON.stringify({ rows: wholeStore.rows.length, card: !!cardOf(whole) }));

    const autoStore = makeConfirmStore();
    const auto = await idDrive(autoStore, { action_id: "424b85ac", to_status: "dismissed" }, AUTO);
    const steps = frames(auto).filter((f) => f.paige_step).map((f) => f.paige_step.label);
    assert("18.ID7 the auto lane is refused at dispatch too, and the trace says the action did not move",
      advanced(auto).length === 0 && /id_not_addressable/.test(toldModel(auto))
        && steps.includes("Couldn't move that action") && !steps.includes("Moving that action forward"),
      JSON.stringify({ rpc: advanced(auto).length, steps }));
    assert("18.ID8 …and a refusal that never ran is not written to the audit trail as a failed write",
      !audited(auto).some((row) => JSON.stringify(row).includes("id_not_addressable")),
      JSON.stringify(audited(auto)).slice(0, 300));
  }

  const h16Store = makeConfirmStore();
  let h16Arrivals = 0;
  let h16Release;
  let h16Timeout;
  const h16Ready = new Promise((resolve, reject) => {
    h16Release = () => { clearTimeout(h16Timeout); resolve(); };
    h16Timeout = setTimeout(() => reject(new Error("18.H16")), 3000);
  });
  const h16Table = async (filters) => {
    const snapshot = h16Store.table(filters);
    if (h16Arrivals < 2 && filters.some(([op, columns]) => op === "select" && String(columns).includes("fingerprint"))) {
      h16Arrivals += 1;
      if (h16Arrivals === 2) h16Release();
      await h16Ready;
    }
    return snapshot;
  };
  const h16Result = await drive({
    concurrentRequests: 2, stream: true, clientId: OWN,
    extraBody: { threadId: THREAD }, toolCall: { name: "update_client_data", args: hardeningArgs },
    ...CONFIRM, tablesExtra: { paige_pending_confirmations: h16Table }, onInsert: mirrorConfirms(h16Store),
  });
  const h16Cards = h16Result.bodyText.split("\n")
    .filter((line) => line.startsWith("data: ") && line !== "data: [DONE]")
    .map((line) => JSON.parse(line.slice(6))).filter((frame) => frame.paige_confirm).map((frame) => frame.paige_confirm);
  assert("18.H16", h16Arrivals === 2 && h16Cards.length === 2 && h16Store.rows.length === 1
    && h16Cards[0].fingerprint === h16Cards[1].fingerprint && !wroteBack(h16Result)
    && h16Result.responses.every((response) => response.status === 200
      && response.bodyText.split("\n").filter((line) => line.startsWith("data: ") && line.includes('"paige_confirm":')).length === 1));

  const hCards = (result) => result.bodyText.split("\n")
    .filter((line) => line.startsWith("data: ") && line !== "data: [DONE]")
    .map((line) => JSON.parse(line.slice(6))).filter((frame) => frame.paige_confirm).map((frame) => frame.paige_confirm);
  const hDrive = (store, body = {}, extra = {}) => drive({
    stream: true, clientId: OWN, extraBody: { threadId: THREAD, ...body },
    toolCall: { name: "update_client_data", args: hardeningArgs }, ...CONFIRM,
    tablesExtra: { paige_pending_confirmations: store.table }, onInsert: mirrorConfirms(store), ...extra,
  });
  let h17Arrivals = 0;
  let h17Release;
  let h17Timeout;
  const h17Ready = new Promise((resolve, reject) => {
    h17Release = () => { clearTimeout(h17Timeout); resolve(); };
    h17Timeout = setTimeout(() => reject(new Error("18.H17")), 3000);
  });
  const h17Table = async (filters) => {
    const snapshot = h16Store.table(filters);
    if (h17Arrivals < 2 && !filters.some(([op]) => op === "update")
      && filters.some(([op, columns]) => op === "select" && String(columns).includes("tool_name"))) {
      h17Arrivals += 1;
      if (h17Arrivals === 2) h17Release();
      await h17Ready;
    }
    return snapshot;
  };
  const h17Result = await hDrive(h16Store, { approvedConfirmations: [h16Cards[0]?.fingerprint] }, {
    concurrentRequests: 2, tablesExtra: { paige_pending_confirmations: h17Table },
  });
  assert("18.H17", h17Arrivals === 2 && h17Result.responses.every((response) => response.status === 200)
    && h17Result.outboundCalls.filter((call) => call.url.includes("paige-write-back")).length === 1
    && h16Store.rows.filter((row) => row.consumed).length === 1);

  const h18Store = makeConfirmStore();
  const h18Issued = await hDrive(h18Store);
  const h18Token = hCards(h18Issued)[0]?.fingerprint;
  const h18Stripped = h18Token?.split(":")[0];
  const h18Approved = await hDrive(h18Store, { approvedConfirmations: [h18Stripped] });
  const h18Declined = await hDrive(h18Store, { declinedConfirmations: [h18Stripped] }, { toolCall: null });
  assert("18.H18", !!h18Token?.includes(":") && h18Store.rows.length === 1 && !h18Store.rows[0].consumed
    && !wroteBack(h18Approved) && !wroteBack(h18Declined));
  const h19Token = `${h18Stripped}:11111111-1111-4111-8111-111111111111`;
  const h19Approved = await hDrive(h18Store, { approvedConfirmations: [h19Token] });
  const h19Declined = await hDrive(h18Store, { declinedConfirmations: [h19Token] }, { toolCall: null });
  assert("18.H19", !h18Store.rows[0].consumed && !wroteBack(h19Approved) && !wroteBack(h19Declined));

  h18Store.rows[0].expires_at = "2000-01-01T00:00:00Z";
  const h20Issued = await hDrive(h18Store);
  const h20Token = hCards(h20Issued)[0]?.fingerprint;
  assert("18.H20", h18Store.rows.length === 2 && h18Store.rows[0].consumed && !h18Store.rows[1].consumed
    && h18Store.rows[0].fingerprint === h18Store.rows[1].fingerprint && !!h20Token && h20Token !== h18Token);
  const h21Approved = await hDrive(h18Store, { approvedConfirmations: [h18Token] });
  const h21Declined = await hDrive(h18Store, { declinedConfirmations: [h18Token] }, { toolCall: null });
  assert("18.H21", !wroteBack(h21Approved) && !wroteBack(h21Declined) && !h18Store.rows[1].consumed);
  const h22Approved = await hDrive(h18Store, { approvedConfirmations: [h20Token] });
  assert("18.H22", h18Store.rows[1].consumed
    && h22Approved.outboundCalls.filter((call) => call.url.includes("paige-write-back")).length === 1);

  const h23Store = makeConfirmStore();
  await hDrive(h23Store);
  await hDrive(h23Store, { threadId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd" });
  assert("18.H23", h23Store.rows.length === 2 && h23Store.rows.every((row) => !row.consumed)
    && h23Store.rows[0].fingerprint !== h23Store.rows[1].fingerprint);

  const h24Store = makeConfirmStore();
  const h24Issued = await hDrive(h24Store, {}, {
    toolCall: { name: "update_client_data", args: { ...hardeningArgs, confirm: true, confirm_token: "legacy-value" } },
  });
  const h24Token = hCards(h24Issued)[0]?.fingerprint;
  const h24Approved = await hDrive(h24Store, { approvedConfirmations: [h24Token] });
  assert("18.H24", !!h24Token && h24Store.rows.length === 1 && h24Store.rows[0].consumed
    && !Object.hasOwn(h24Store.rows[0].args, "confirm") && !Object.hasOwn(h24Store.rows[0].args, "confirm_token")
    && h24Approved.outboundCalls.filter((call) => call.url.includes("paige-write-back")).length === 1
    && !h24Approved.outboundCalls.some((call) => call.body.includes("legacy-value")));

  const { crmApprovalSubject } = await import("../../supabase/functions/_shared/crm-command/catalog.ts");
  const h25Args = { patch: { first_name: "Test", last_name: "Contact" } };
  const h25Row = { user_id: USER, tenant_id: CALLER_TENANT, thread_id: null, scoped_client_id: null,
    tool_name: "crm_create_contact", fingerprint: "abababababababab", issued_in_request: "previous-crm-request",
    args: { approval_subject: await crmApprovalSubject("contact.create", { action: "contact.create", ...h25Args }) } };
  const h25Drive = (store, body, toolCall = { name: "crm_create_contact", args: h25Args }) => drive({
    stream: true, extraBody: { threadId: THREAD, ...body }, toolCall,
    rpcOverrides: { ...CONFIRM.rpcOverrides, get_paige_persona_context: { data: [{ tenant_id: CALLER_TENANT }], error: null } },
    tablesExtra: { paige_pending_confirmations: store.table, user_roles: [{ role: "admin" }] }, onInsert: mirrorConfirms(store),
  });
  const h25Composite = `${h25Row.fingerprint}:11111111-1111-4111-8111-111111111111`;
  const h25Store = makeConfirmStore([h25Row]);
  const h25Wrong = await h25Drive(h25Store, { approvedConfirmations: [h25Composite] });
  await h25Drive(h25Store, { declinedConfirmations: [h25Composite] }, null);
  assert("18.H25", !h25Wrong.rec.functions.some((call) => call.name === "crm-command") && !h25Store.rows[0].consumed);
  const h26Mixed = await h25Drive(h25Store, { approvedConfirmations: [h25Composite, h25Row.fingerprint] });
  assert("18.H26", h26Mixed.rec.functions.filter((call) => call.name === "crm-command").length === 1
    && h26Mixed.rec.functions.some((call) => call.name === "crm-command" && call.body.approved_fingerprint === h25Row.fingerprint));
  await h25Drive(h25Store, { declinedConfirmations: [h25Composite, h25Row.fingerprint] }, null);
  assert("18.H27", h25Store.rows[0].consumed);

  // 18.OUT1–OUT12 — THE CARD IS TOLD WHAT BECAME OF EACH APPROVAL, and only what the server knows.
  // Owner-approved recovery design, 2026-09-26: the card that asked stays on screen and reports
  // each action as ran, didn't run, or couldn't confirm, in a sentence the server writes. These
  // drive the real handler through every door that can spend or refuse an approval, including the
  // answers that never come back.
  {
    const { executorFailureSpeech } = await import("../../supabase/functions/_shared/crm-command/executor-error.ts");
    const outcomeOf = (r) => r.bodyText.split("\n").filter((l) => l.startsWith("data: ") && l !== "data: [DONE]")
      .map((l) => { try { return JSON.parse(l.slice(6)); } catch { return null; } })
      .filter((f) => f && f.paige_approval_outcome).map((f) => f.paige_approval_outcome);
    const toldModel = (r) => r.modelEgress.map((b) => b.replace(/\\"/g, '"')).join("\n");
    const show = (r) => JSON.stringify(outcomeOf(r));

    // OUT1/OUT2 — the general gate: an approved write that ran, and a turn with no approvals.
    const o1Store = makeConfirmStore();
    const o1Issued = await hDrive(o1Store);
    const o1Token = hCards(o1Issued)[0]?.fingerprint;
    const o1 = await hDrive(o1Store, { approvedConfirmations: [o1Token] });
    assert("18.OUT1 an approval that ran is reported ran, with nothing to explain",
      wroteBack(o1) && outcomeOf(o1).length === 1
        && JSON.stringify(outcomeOf(o1)[0]) === JSON.stringify({ actions: [{ fingerprint: o1Token, outcome: "ran" }] }), show(o1));
    assert("18.OUT2 a turn that carried no approvals sends no outcome", !!o1Token && outcomeOf(o1Issued).length === 0, show(o1Issued));

    // OUT3 — the general gate's ambiguous terminal: said once, for the whole card, and nothing ran.
    const o3Store = makeConfirmStore([
      { user_id: USER, tool_name: "update_client_data", fingerprint: "3".repeat(16), args: hardeningArgs, issued_in_request: "an-earlier-request" },
      { user_id: USER, tool_name: "update_client_data", fingerprint: "4".repeat(16), args: { client_id: OWN, updates: { goal: "a different plan" } }, issued_in_request: "an-earlier-request" },
    ]);
    const o3 = await drive({
      stream: true, clientId: OWN, extraBody: { threadId: THREAD, approvedConfirmations: ["3".repeat(16), "4".repeat(16)] },
      toolCall: { name: "update_client_data", args: { client_id: OWN, updates: { goal: "drifted" }, confirm: true } }, ...CONFIRM,
      tablesExtra: { paige_pending_confirmations: o3Store.table },
    });
    const o3Frame = outcomeOf(o3)[0];
    assert("18.OUT3 an ambiguous approval is reported not run, once for the whole card",
      !wroteBack(o3) && o3Store.rows.every((row) => !row.consumed)
        && o3Frame?.note === "Nothing changed. More than one approval was waiting, so Paige stopped rather than guess."
        && o3Frame.actions.length === 2 && o3Frame.actions.every((a) => a.outcome === "not_run" && !("note" in a)), show(o3));

    // OUT4–OUT8 — the CRM door, one answer from crm-command at a time.
    const crmDrive = (store, approved, answer) => drive({
      stream: true, extraBody: { threadId: THREAD, approvedConfirmations: approved },
      toolCall: { name: "crm_create_contact", args: h25Args },
      rpcOverrides: { ...CONFIRM.rpcOverrides, get_paige_persona_context: { data: [{ tenant_id: CALLER_TENANT }], error: null } },
      tablesExtra: { paige_pending_confirmations: store.table, user_roles: [{ role: "admin" }] }, onInsert: mirrorConfirms(store),
      functionsExtra: answer ? { "crm-command": answer } : {},
    });
    const httpError = (body) => ({ data: null, error: { name: "FunctionsHttpError", message: "Edge Function returned a non-2xx status code", context: { json: async () => body } } });
    const crmRow = { ...h25Row, fingerprint: "5".repeat(16) };
    const crmSpent = (r) => r.rec.functions.some((call) => call.name === "crm-command" && call.body.approved_fingerprint === crmRow.fingerprint);
    const unconfirmedOne = "This may have gone through. Check before asking again, so it doesn't happen twice.";

    const o4 = await crmDrive(makeConfirmStore([crmRow]), [crmRow.fingerprint],
      { data: { ok: true, outcome: "succeeded", readback: { id: "aaaa1111-2222-4333-8444-555566667777" }, receipt_recorded: true }, error: null });
    assert("18.OUT4 a contact the CRM door created is reported ran",
      crmSpent(o4) && JSON.stringify(outcomeOf(o4)[0]) === JSON.stringify({ actions: [{ fingerprint: crmRow.fingerprint, outcome: "ran" }] }), show(o4));

    const o5 = await crmDrive(makeConfirmStore([crmRow]), [crmRow.fingerprint], { data: null, error: Object.assign(
      new Error("Failed to send a request to the Edge Function"), { name: "FunctionsFetchError", context: new TypeError("fetch failed") }) });
    assert("18.OUT5 when crm-command's answer never came back, the card says it may have gone through, and so does Paige",
      crmSpent(o5) && outcomeOf(o5)[0]?.actions?.[0]?.outcome === "unconfirmed" && outcomeOf(o5)[0]?.note === unconfirmedOne
        && /"outcome_unknown":\s*true/.test(toldModel(o5)) && /could not confirm whether it went through/.test(toldModel(o5))
        && !/Nothing should be claimed as changed/.test(toldModel(o5)), show(o5));

    const o6 = await crmDrive(makeConfirmStore([crmRow]), [crmRow.fingerprint], httpError({ ok: false, outcome: "refused",
      code: "CRM_READBACK_UNAVAILABLE", ...executorFailureSpeech("CRM_READBACK_UNAVAILABLE", [], "unproven") }));
    assert("18.OUT6 crm-command's own 'could not confirm the earlier attempt' is reported as could not confirm",
      crmSpent(o6) && outcomeOf(o6)[0]?.actions?.[0]?.outcome === "unconfirmed" && outcomeOf(o6)[0]?.note === unconfirmedOne, show(o6));

    const o7 = await crmDrive(makeConfirmStore([crmRow]), [crmRow.fingerprint], httpError({ ok: false, outcome: "failed", code: "CRM_CONTACT_ALREADY_EXISTS" }));
    assert("18.OUT7 a change crm-command refused is reported as not gone through, and never as 'nothing changed'",
      crmSpent(o7) && outcomeOf(o7)[0]?.actions?.[0]?.outcome === "not_run" && outcomeOf(o7)[0]?.note === "It didn't go through."
        && !/"outcome_unknown"/.test(toldModel(o7)), show(o7));

    const o8Composite = `${crmRow.fingerprint}:11111111-1111-4111-8111-111111111111`;
    const o8 = await crmDrive(makeConfirmStore([crmRow]), [o8Composite]);
    assert("18.OUT8 an approval the CRM door could not claim is reported not run, with that reason",
      !o8.rec.functions.some((call) => call.name === "crm-command")
        && JSON.stringify(outcomeOf(o8)[0]) === JSON.stringify({ actions: [{ fingerprint: o8Composite, outcome: "not_run" }],
          note: "Nothing changed. That approval no longer matches anything Paige can run." }), show(o8));

    // OUT9–OUT11 — action_advance: a card minted before the id check, and the RPC's two failure kinds.
    const advDrive = (store, approved, args, rpc = {}) => drive({
      stream: true, extraBody: { threadId: THREAD, approvedConfirmations: approved },
      toolCall: { name: "action_advance", args: { ...args, confirm: true } },
      rpcOverrides: { ...CONFIRM.rpcOverrides, ...rpc },
      tablesExtra: { paige_pending_confirmations: store.table, user_roles: [{ role: "admin" }] }, onInsert: mirrorConfirms(store),
    });
    // A minted row carries the workspace it was minted in (the server stamps tenant_id at mint), and
    // the claim re-checks it — so the hand-authored row carries the caller's workspace too (C0a: a
    // seated admin's persona resolves that workspace, as production's does).
    const advRow = (fingerprint, args) => ({ user_id: USER, tenant_id: CALLER_TENANT, tool_name: "action_advance", fingerprint, args, issued_in_request: "an-earlier-request" });
    const shortArgs = { action_id: "424b85ac", to_status: "dismissed" };
    const o9Store = makeConfirmStore([advRow("6".repeat(16), shortArgs)]);
    const o9 = await advDrive(o9Store, ["6".repeat(16)], shortArgs);
    assert("18.OUT9 a card minted before the id check is refused before it runs, and reported as such",
      o9Store.rows[0].consumed && !o9.rec.rpc.some((call) => call.name === "advance_action")
        && outcomeOf(o9)[0]?.actions?.[0]?.outcome === "not_run"
        && outcomeOf(o9)[0]?.note === "Nothing changed. Paige couldn't tell exactly which item this was, so she stopped.", show(o9));

    const wholeArgs = { action_id: "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11", to_status: "dismissed" };
    const o10Store = makeConfirmStore([advRow("7".repeat(16), wholeArgs)]);
    const o10 = await advDrive(o10Store, ["7".repeat(16)], wholeArgs,
      { advance_action: { data: null, error: { code: "", message: "TypeError: fetch failed", details: "", hint: "" } } });
    assert("18.OUT10 a database call whose answer was lost in transit is reported as could not confirm, never as failed",
      o10Store.rows[0].consumed && o10.rec.rpc.some((call) => call.name === "advance_action")
        && outcomeOf(o10)[0]?.actions?.[0]?.outcome === "unconfirmed" && outcomeOf(o10)[0]?.note === unconfirmedOne
        && /could not confirm whether it went through/.test(toldModel(o10)), show(o10));

    const o11Store = makeConfirmStore([advRow("8".repeat(16), wholeArgs)]);
    const o11 = await advDrive(o11Store, ["8".repeat(16)], wholeArgs,
      { advance_action: { data: null, error: { code: "P0001", message: "ACTION_NOT_FOUND", details: "", hint: "" } } });
    assert("18.OUT11 a database refusal is reported as not gone through",
      o11Store.rows[0].consumed && outcomeOf(o11)[0]?.actions?.[0]?.outcome === "not_run"
        && outcomeOf(o11)[0]?.note === "It didn't go through." && !/could not confirm whether/.test(toldModel(o11)), show(o11));

    // OUT12 — a batch that ended two ways: each row carries its own sentence, and only the one
    // that did not run carries one.
    const o12Store = makeConfirmStore([advRow("9".repeat(16), wholeArgs)]);
    const o12Issued = await hDrive(o12Store);
    const o12Token = hCards(o12Issued)[0]?.fingerprint;
    const o12 = await hDrive(o12Store, { approvedConfirmations: [o12Token, "9".repeat(16)] });
    assert("18.OUT12 a mixed batch reports each approval in the order sent, with a sentence only where one did not run",
      wroteBack(o12) && !o12Store.rows.find((row) => row.fingerprint === "9".repeat(16))?.consumed
        && JSON.stringify(outcomeOf(o12)[0]) === JSON.stringify({ actions: [
          { fingerprint: o12Token, outcome: "ran" },
          { fingerprint: "9".repeat(16), outcome: "not_run", note: "Nothing changed. Paige didn't run this." },
        ] }), show(o12));

    // OUT13 — the general gate could not look the approval up: our side's failure, and nothing ran.
    // Only the approved-set lookup fails (it asks for UNconsumed rows); the look for an earlier use
    // (consumed rows) answers normally.
    const lookupFails = ({ op, filters }) => op === "select"
      && filters.some(([o, c, v]) => o === "is" && c === "consumed_at" && v === null)
      && filters.some(([o, c]) => o === "in" && c === "fingerprint")
      ? { code: "57014", message: "canceling statement due to statement timeout" } : undefined;
    const o13Store = makeConfirmStore([
      { user_id: USER, tool_name: "update_client_data", fingerprint: "a1".repeat(8), args: hardeningArgs, issued_in_request: "an-earlier-request" },
    ]);
    const o13 = await drive({
      stream: true, clientId: OWN, extraBody: { threadId: THREAD, approvedConfirmations: ["a1".repeat(8)] },
      toolCall: { name: "update_client_data", args: { client_id: OWN, updates: { goal: "drifted" }, confirm: true } }, ...CONFIRM,
      tablesExtra: { paige_pending_confirmations: o13Store.table },
      tableErrorsExtra: { "paige_pending_confirmations:select": lookupFails },
    });
    assert("18.OUT13 an approval the general gate could not look up is reported not run, as our side's failure",
      !wroteBack(o13) && !o13Store.rows[0].consumed
        && JSON.stringify(outcomeOf(o13)[0]) === JSON.stringify({ actions: [{ fingerprint: "a1".repeat(8), outcome: "not_run" }],
          note: "Nothing changed. Something went wrong on our side while checking your approval." }), show(o13));

    // OUT14 — the look for an earlier use itself fails: nobody knows, and the card says only that.
    const earlierLookFails = ({ op, filters }) => op === "select" && filters.some(([o, c]) => o === "lt" && c === "consumed_at")
      ? { code: "57014", message: "canceling statement due to statement timeout" } : undefined;
    const o14Store = makeConfirmStore([
      { user_id: USER, tool_name: "update_client_data", fingerprint: "3".repeat(16), args: hardeningArgs, issued_in_request: "an-earlier-request" },
      { user_id: USER, tool_name: "update_client_data", fingerprint: "4".repeat(16), args: { client_id: OWN, updates: { goal: "a different plan" } }, issued_in_request: "an-earlier-request" },
    ]);
    const o14 = await drive({
      stream: true, clientId: OWN, extraBody: { threadId: THREAD, approvedConfirmations: ["3".repeat(16), "4".repeat(16)] },
      toolCall: { name: "update_client_data", args: { client_id: OWN, updates: { goal: "drifted" }, confirm: true } }, ...CONFIRM,
      tablesExtra: { paige_pending_confirmations: o14Store.table },
      tableErrorsExtra: { "paige_pending_confirmations:select": earlierLookFails },
    });
    assert("18.OUT14 when the server cannot look for an earlier use, it says only that it couldn't confirm",
      !wroteBack(o14) && outcomeOf(o14)[0]?.actions?.length === 2 && outcomeOf(o14)[0].actions.every((a) => a.outcome === "unconfirmed")
        && outcomeOf(o14)[0]?.note === "These may have gone through. Check before asking again, so nothing happens twice.", show(o14));

    // OUT15 — an approval used before this request (the row is already consumed): "didn't run" is
    // true of THIS request and says nothing about the earlier one, which may have done the work.
    const usedNote = "That approval can't be used any more. Check before asking again, so it doesn't happen twice.";
    const o15Row = { ...crmRow, fingerprint: "c".repeat(16), consumed: true };
    const o15 = await crmDrive(makeConfirmStore([o15Row]), [o15Row.fingerprint],
      httpError({ ok: false, outcome: "refused", code: "CRM_APPROVAL_CLAIM_INVALID" }));
    const o15bStore = makeConfirmStore([
      { user_id: USER, tool_name: "update_client_data", fingerprint: "d".repeat(16), args: hardeningArgs, issued_in_request: "an-earlier-request", consumed: true },
    ]);
    const o15b = await drive({
      stream: true, clientId: OWN, extraBody: { threadId: THREAD, approvedConfirmations: ["d".repeat(16)] },
      toolCall: { name: "update_client_data", args: { client_id: OWN, updates: { goal: "drifted" }, confirm: true } }, ...CONFIRM,
      tablesExtra: { paige_pending_confirmations: o15bStore.table }, onInsert: mirrorConfirms(o15bStore),
    });
    assert("18.OUT15 an approval already used before this request is reported as unusable, never as didn't run — at either door",
      JSON.stringify(outcomeOf(o15)[0]) === JSON.stringify({ actions: [{ fingerprint: o15Row.fingerprint, outcome: "unconfirmed" }], note: usedNote })
        && !wroteBack(o15b)
        && JSON.stringify(outcomeOf(o15b)[0]) === JSON.stringify({ actions: [{ fingerprint: "d".repeat(16), outcome: "unconfirmed" }], note: usedNote }),
      `${show(o15)} ${show(o15b)}`);

    // OUT16 — a write that answered only with an error, no success claim: never "done", and Paige
    // is told the same as the card before she answers.
    const o16Store = makeConfirmStore();
    const o16Issued = await hDrive(o16Store);
    const o16Token = hCards(o16Issued)[0]?.fingerprint;
    const o16 = await hDrive(o16Store, { approvedConfirmations: [o16Token] }, { writeBack: { status: 403, body: { error: "Forbidden" } } });
    assert("18.OUT16 a write that answered only with an error is never reported done, and Paige is told she couldn't confirm",
      wroteBack(o16) && outcomeOf(o16)[0]?.actions?.[0]?.outcome === "unconfirmed" && outcomeOf(o16)[0]?.note === unconfirmedOne
        && /could not confirm whether it went through/.test(toldModel(o16)), show(o16));

    // OUT17 — a change the CRM door reports as not applied carries that fact to the card, so a
    // refusal reads "didn't run" and offers asking again; the same refusal without it would not.
    assert("18.OUT17 crm-command's answered refusal is marked not applied, and a lost answer is not",
      /"not_applied":\s*true/.test(toldModel(o7)) && !/"not_applied"/.test(toldModel(o5)) && !/"not_applied"/.test(toldModel(o6)), "");
  }

  const h28Store = makeConfirmStore();
  const h28First = await hDrive(h28Store);
  h28Store.rows[0].args = { updates: { goal: hardeningArgs.updates.goal }, client_id: OWN };
  const h28Second = await hDrive(h28Store);
  const h28Token = hCards(h28First)[0]?.fingerprint;
  const h28Approved = await hDrive(h28Store, { approvedConfirmations: [h28Token] });
  assert("18.H28", h28Store.rows.length === 1 && hCards(h28Second)[0]?.fingerprint === h28Token
    && wroteBack(h28Approved) && h28Store.rows[0].consumed);

  for (const [label, operation] of [["18.H29", "approve"], ["18.H30", "decline"]]) {
    const store = makeConfirmStore();
    const first = await hDrive(store);
    const token = hCards(first)[0]?.fingerprint;
    const table = store.table;
    let changed = false;
    store.table = (filters) => {
      const snapshot = table(filters);
      // The race is between the CLAIM's own select and its update (C4a: the resume selection, which
      // reads consumed/expiry too, is not that select).
      if (!changed && !filters.some(([op]) => op === "update")
        && filters.some(([op, columns]) => op === "select" && String(columns) === "fingerprint,args,issued_in_request,tool_name")) {
        changed = true;
        store.rows[0].issued_in_request = "22222222-2222-4222-8222-222222222222";
      }
      return snapshot;
    };
    const result = await hDrive(store, operation === "approve"
      ? { approvedConfirmations: [token] } : { declinedConfirmations: [token] }, operation === "decline" ? { toolCall: null } : {});
    assert(label, changed && !wroteBack(result) && !store.rows[0].consumed
      && result.rec.from.some((call) => call.table === "paige_pending_confirmations" && call.op === "update"
        && call.filters.some(([op, column]) => op === "eq" && column === "issued_in_request")));
  }

  // ── 18.1/18.2 — WITHIN ONE REQUEST. The nonce leg. ─────────────────────────────────────────
  const st = makeConfirmStore();
  const selfApproved = await drive({
    stream: true, selfApproving: true, extraBody: { threadId: THREAD },
    toolCall: { name: "update_client_data", args: { client_id: OWN, updates: { goal: "buy a house" } } },
    clientId: OWN,
    ...CONFIRM,
    tablesExtra: { paige_pending_confirmations: st.table },
    onInsert: mirrorConfirms(st),
  });

  assert("18.0 the model DID assert approval on its own (guards this section)",
    selfApproved.selfApproveReplays > 0,
    "the stub never asserted confirm — this section proves nothing without that");

  assert("18.1 a model approving itself inside one request performs NO write",
    !wroteBack(selfApproved),
    JSON.stringify(selfApproved.outboundCalls.map((c) => c.body)));

  const st2 = makeConfirmStore();
  const selfGranted = await drive({
    stream: true, selfApproving: true, extraBody: { threadId: THREAD },
    toolCall: { name: "automation_set_grant", args: { automation_id: AUTOMATION, lane: "auto" } },
    ...CONFIRM,
    tablesExtra: {
      paige_pending_confirmations: st2.table,
      paige_automations: () => [{ id: AUTOMATION, name: "P", granted_lane: "confirm", state: "draft" }],
    },
    onInsert: mirrorConfirms(st2),
  });
  assert("18.2 …and cannot raise its own autonomy grant",
    !selfGranted.rec.inserts.some((i) => i.table === "paige_automations" && i.update),
    JSON.stringify(selfGranted.rec.inserts.filter((i) => i.table === "paige_automations")));

  // ── 18.3 — THE OUTAGE GUARD. Approval from a later request must still work, or "nothing is
  // redeemable" would satisfy every check above and reinstate the outage the token existed to fix.
  const st3 = makeConfirmStore([{
 user_id: USER, tool_name: "update_client_data", fingerprint: "abcdef0123456789",
    args: { client_id: OWN, updates: { goal: "buy a house" } },
    issued_in_request: "a-previous-request",
  }]);
  const laterTurn = await drive({
    stream: true, clientId: OWN, extraBody: { threadId: THREAD },
    // Deliberately NOT the arguments that were proposed. The stored call is what must run.
    toolCall: { name: "update_client_data", args: { client_id: OWN, updates: { goal: "drifted wording" }, confirm: true } },
    ...CONFIRM,
    tablesExtra: { paige_pending_confirmations: st3.table },
  });
  assert("18.3 approval-path hardening",
    !wroteBack(laterTurn) && !st3.rows[0].consumed,
    JSON.stringify(laterTurn.outboundCalls.map((c) => c.body)));
  assert("18.3b …and what runs is the STORED call, never the drifted one it was re-sent with",
    !laterTurn.outboundCalls.some((c) => c.body.includes("drifted wording")),
    JSON.stringify(laterTurn.outboundCalls.map((c) => c.body)));

  // ── 18.4 — a proposal with no request stamped on it is not redeemable. `neq` against NULL is
  // NULL, which drops the row anyway, but relying on that silently leaves the intent unexpressed.
  const st4 = makeConfirmStore([{
 user_id: USER, tool_name: "update_client_data", fingerprint: "beefbeefbeefbeef",
    args: { client_id: OWN, updates: { goal: "legacy" } }, issued_in_request: null,
  }]);
  const legacy = await drive({
    stream: true, clientId: OWN, extraBody: { threadId: THREAD, approvedConfirmations: ["beefbeefbeefbeef"] },
    toolCall: { name: "update_client_data", args: { client_id: OWN, updates: { goal: "legacy" }, confirm: true } },
    ...CONFIRM,
    tablesExtra: { paige_pending_confirmations: st4.table },
  });
  assert("18.4 a proposal with no request stamped on it is NOT redeemable",
    !wroteBack(legacy),
    JSON.stringify(legacy.outboundCalls.map((c) => c.url)));

  // ── 18.5 — THE BYPASS. TWO CONSECUTIVE REQUESTS, ONE STORE. ────────────────────────────────
  //
  // This is the shape no check had. Request A proposes. The human then says NO. Request B carries
  // that refusal, and the model re-emits the same call as an ordinary proposal — not asserting
  // approval, just proposing again. Under the token design that re-proposal was answered with the
  // still-live token from request A, which the model spent one round later. Nothing in request B
  // represents the human's answer, so nothing could stop it.
  //
  // Approval-path hardening. Detailed evidence retained privately.
  const st5 = makeConfirmStore();
  const requestA = await drive({
    stream: true, clientId: OWN, extraBody: { threadId: THREAD },
    toolCall: { name: "update_client_data", args: { client_id: OWN, updates: { goal: "ATTACKER-CONTROLLED-VALUE" } } },
    ...CONFIRM,
    tablesExtra: { paige_pending_confirmations: st5.table },
    onInsert: mirrorConfirms(st5),
  });
  assert("18.5a request A minted a live proposal (guards 18.5b)",
    st5.rows.length === 1 && !st5.rows[0].consumed,
    JSON.stringify(st5.rows));
  assert("18.5a2 …and request A itself wrote nothing",
    !wroteBack(requestA), JSON.stringify(requestA.outboundCalls.map((c) => c.body)));

  const requestB = await drive({
    stream: true, selfApproving: false, clientId: OWN,
    text: "No. Do not do that. Cancel it.",
    extraBody: { threadId: THREAD },
    // The model re-proposes the identical call. It does NOT claim the operator approved — because
    // the operator did not. This is the exact traffic the bypass rode in on.
    toolCall: { name: "update_client_data", args: { client_id: OWN, updates: { goal: "ATTACKER-CONTROLLED-VALUE" } } },
    ...CONFIRM,
    tablesExtra: { paige_pending_confirmations: st5.table },
    onInsert: mirrorConfirms(st5),
  });
  assert("18.5b no gated write happens on a request where the human said NO",
    !wroteBack(requestB),
    JSON.stringify(requestB.outboundCalls.map((c) => c.body)));
  assert("18.5c …and the proposal from request A is still unspent, not consumed behind their back",
    st5.rows.every((r) => !r.consumed),
    JSON.stringify(st5.rows));

  // The same two-request shape against the §67 red line, where the consequence is worst.
  const st6 = makeConfirmStore();
  const grantA = { name: "automation_set_grant", args: { automation_id: AUTOMATION, lane: "auto" } };
  const automationTable = { paige_automations: () => [{ id: AUTOMATION, name: "P", granted_lane: "confirm", state: "draft" }] };
  await drive({
    stream: true, extraBody: { threadId: THREAD }, toolCall: grantA, ...CONFIRM,
    tablesExtra: { paige_pending_confirmations: st6.table, ...automationTable },
    onInsert: mirrorConfirms(st6),
  });
  const grantB = await drive({
    stream: true, extraBody: { threadId: THREAD }, text: "No, leave it on confirm.",
    toolCall: grantA, ...CONFIRM,
    tablesExtra: { paige_pending_confirmations: st6.table, ...automationTable },
    onInsert: mirrorConfirms(st6),
  });
  assert("18.5d the model cannot raise its own autonomy grant across two requests either",
    !grantB.rec.inserts.some((i) => i.table === "paige_automations" && i.update),
    JSON.stringify(grantB.rec.inserts.filter((i) => i.table === "paige_automations")));

  // ── 18.6/18.7 — HIGH RISK: the model's word is refused, a rendered card is not. ────────────
  //
  // Driven on `member_grant_role`, which the policy classifies `high` because it changes who may
  // do what. Deliberately NOT on `automation_set_grant` any more: that is now `owner_only`, so it
  // is refused down BOTH channels, and a check that cannot distinguish "refused because high-risk"
  // from "refused because it never runs here" proves nothing about the high-risk rule.
  //
  // The role gate below the confirm gate reads `user_roles`, so the fixture grants admin. Without
  // it 18.6 would pass because the role gate stopped the write, not because the approval channel
  // did — the check would be measuring the wrong refusal.
  const GRANT_TOOL = "member_grant_role";
  const GRANT_ARGS = { user_id: "99999999-9999-4999-8999-999999999999", role: "coach" };
  const asAdmin = { user_roles: () => [{ role: "admin" }] };
  const granted = (r) => r.rec.rpc.some((c) => c.name === "grant_tenant_member_role");

  // 18.6a — the policy really does classify this `high`, so 18.6/18.7 are about the rule and not
  // about whatever this tool happens to do. Kills: reclassifying it and leaving these checks
  // apparently green while they silently test an ordinary action.
  const { classifyAction: classify } = await import("../../supabase/functions/_shared/action-risk.ts");
  assert("18.6a the tool these two checks drive is classified high (guards 18.6/18.7)",
    classify(GRANT_TOOL) === "high", String(classify(GRANT_TOOL)));

  const st7 = makeConfirmStore([{
    user_id: USER, tool_name: GRANT_TOOL, fingerprint: "1111111111111111",
    args: GRANT_ARGS, issued_in_request: "a-previous-request",
  }]);
  const highRiskWord = await drive({
    stream: true, extraBody: { threadId: THREAD },
    toolCall: { name: GRANT_TOOL, args: { ...GRANT_ARGS, confirm: true } },
    ...CONFIRM,
    tablesExtra: { paige_pending_confirmations: st7.table, ...asAdmin },
  });
  assert("18.6 a high-risk act is NOT approved by the model saying it was approved",
    !granted(highRiskWord), JSON.stringify(highRiskWord.rec.rpc.map((c) => c.name)));
  assert("18.6b …and the proposal is left unspent for the person to actually answer",
    st7.rows.every((r) => !r.consumed), JSON.stringify(st7.rows));

  // ── 18.7 — THE OUTAGE GUARD. A rendered card still approves a high-risk act, or 18.6 would be
  // satisfied by making high-risk tools unapprovable by anyone, which is not a fix.
  //
  // Two real requests, exactly as the product runs: request A proposes and the gate mints the
  // fingerprint; the surface renders that card, the person clicks, and request B carries it back
  // in the request BODY. Using the fingerprint the gate actually minted — rather than one invented
  // by the fixture — is what makes this a test of the echo path and not of the fixture.
  const st8 = makeConfirmStore();
  const proposeGrant = await drive({
    stream: true, extraBody: { threadId: THREAD },
    toolCall: { name: GRANT_TOOL, args: GRANT_ARGS }, ...CONFIRM,
    tablesExtra: { paige_pending_confirmations: st8.table, ...asAdmin },
    onInsert: mirrorConfirms(st8),
  });
  assert("18.7a request A proposed rather than acting, and minted a fingerprint to echo",
    !granted(proposeGrant) && st8.rows.length === 1
      && /^[0-9a-f]{16}$/.test(String(st8.rows[0]?.fingerprint)),
    JSON.stringify(st8.rows));

  const highRiskCard = await drive({
    stream: true,
    extraBody: { threadId: THREAD, approvedConfirmations: [issuedApproval(st8.rows[0])] },
    toolCall: { name: GRANT_TOOL, args: GRANT_ARGS }, ...CONFIRM,
    tablesExtra: { paige_pending_confirmations: st8.table, ...asAdmin },
    onInsert: mirrorConfirms(st8),
  });
  assert("18.7 a high-risk act IS approved when a person clicked the card a surface rendered",
    granted(highRiskCard), JSON.stringify(highRiskCard.rec.rpc.map((c) => c.name)));

  // A real clicked card survives model argument drift; only the STORED call runs.
  const driftStore = makeConfirmStore();
  await drive({stream:true,extraBody:{threadId:THREAD},toolCall:{name:GRANT_TOOL,args:GRANT_ARGS},...CONFIRM,
    tablesExtra:{paige_pending_confirmations:driftStore.table,...asAdmin},onInsert:mirrorConfirms(driftStore)});
  const approvedRow = {...driftStore.rows[0]};
  const driftArgs = {...GRANT_ARGS, role:"model-changed-role", confirm:true};
  const driveCard = (store, body={}) => drive({stream:true,extraBody:{threadId:THREAD,approvedConfirmations:[issuedApproval(approvedRow)],...body},
    toolCall:{name:GRANT_TOOL,args:driftArgs},...CONFIRM,tablesExtra:{paige_pending_confirmations:store.table,...asAdmin},onInsert:mirrorConfirms(store)});
  const driftApproved = await driveCard(driftStore);
  assert("18.7d clicked high-risk card survives model argument drift",granted(driftApproved));
  // C4a: the stored call runs from the resume before the model speaks; the model's drifted re-emit is
  // then a DIFFERENT act, so it can only become a new proposal awaiting its own approval — it never
  // runs. So the check is on what EXECUTED, not on whether the drifted words appear anywhere.
  const grants = driftApproved.rec.rpc.filter((c) => c.name === "grant_tenant_member_role");
  assert("18.7e execution uses stored approved arguments, never the drift",
    grants.length === 1 && !JSON.stringify(grants).includes("model-changed-role") && JSON.stringify(grants).includes("coach") && driftStore.rows[0].consumed,
    JSON.stringify(grants.map((c) => c.args)));
  const replay = await driveCard(driftStore);
  assert("18.7f drifted card cannot replay a consumed approval",!granted(replay));
  for (const [label, patch] of Object.entries({wrong_user:{user_id:FOREIGN},wrong_tenant:{tenant_id:OTHER_TENANT},wrong_thread:{thread_id:FOREIGN},wrong_client:{scoped_client_id:FOREIGN},wrong_tool:{tool_name:"n8n_create_workflow"},expired:{expires_at:"2000-01-01T00:00:00Z"},legacy:{issued_in_request:null}})) {
    const invalidStore=makeConfirmStore([{...approvedRow,...patch,consumed:false}]);
    const refused=await driveCard(invalidStore);
    assert("18.7g drifted card refuses " + label,!granted(refused));
  }
  const ambiguous=makeConfirmStore([{...approvedRow,consumed:false},{...approvedRow,fingerprint:"f".repeat(16),consumed:false}]);
  const ambiguousReply=await driveCard(ambiguous,{approvedConfirmations:[issuedApproval(approvedRow),"f".repeat(16)]});
  // C4a: the scoped approval is PINNED by the server, so nothing is ambiguous about it — it runs once,
  // from its stored call. The bare token beside it (an identical act) is never spent on top of it.
  assert("18.7h ambiguous submitted proposals do not pick an arbitrary call",
    ambiguousReply.rec.rpc.filter((c) => c.name === "grant_tenant_member_role").length === 1
      && ambiguous.rows[0].consumed && !ambiguous.rows[1].consumed,
    JSON.stringify({ grants: ambiguousReply.rec.rpc.filter((c) => c.name === "grant_tenant_member_role").length, rows: ambiguous.rows.map((r) => r.consumed) }));

  // ── 18.7b — OWNER-ONLY IS REFUSED DOWN BOTH CHANNELS, INCLUDING THE CARD. This is the property
  // 18.6/18.7 moved off `automation_set_grant` to make room for. A rendered card is the strongest
  // approval the platform has, and it still must not raise Paige's own autonomy from a chat turn.
  //
  // The fingerprint is COMPUTED from the arguments, so a hand-written one in the fixture can never
  // be the one the gate would accept — a card echo built on an invented fingerprint tests nothing.
  // `automation_set_grant` refuses before it ever mints one, so the fingerprint is taken from the
  // ordinary tool that DOES mint, proving the echo channel is genuinely open in this drive and
  // that what closes it here is the classification. Without this the check passes whether or not
  // owner_only is enforced, which is exactly how 18.7 first passed.
  const st9 = makeConfirmStore();
  const echoProbe = await drive({
    stream: true, clientId: OWN, extraBody: { threadId: THREAD },
    toolCall: { name: "update_client_data", args: { client_id: OWN, updates: { goal: "probe" } } },
    ...CONFIRM,
    tablesExtra: { paige_pending_confirmations: st9.table, ...automationTable, ...asAdmin },
    onInsert: mirrorConfirms(st9),
  });
  const liveFp = issuedApproval(st9.rows[0]);
  assert("18.7b0 the echo channel is genuinely open in this drive (guards 18.7b)",
    typeof liveFp === "string" && /^[0-9a-f]{16}:[0-9a-f-]{36}$/.test(liveFp),
    JSON.stringify({ rows: st9.rows.length, egress: echoProbe.modelEgress.length }));

  const ownerOnlyCard = await drive({
    stream: true, clientId: OWN,
    // Every approval this platform can produce, presented at once: a live card fingerprint AND the
    // model's own assertion. Neither may move an owner_only action.
    extraBody: { threadId: THREAD, approvedConfirmations: [liveFp] },
    toolCall: { name: "automation_set_grant", args: { automation_id: AUTOMATION, lane: "auto", confirm: true } },
    ...CONFIRM,
    tablesExtra: { paige_pending_confirmations: st9.table, ...automationTable, ...asAdmin },
    onInsert: mirrorConfirms(st9),
  });
  assert("18.7b even a clicked card cannot raise Paige's own autonomy from a chat turn",
    !ownerOnlyCard.rec.inserts.some((i) => i.table === "paige_automations" && i.update),
    JSON.stringify(ownerOnlyCard.rec.inserts.filter((i) => i.table === "paige_automations")));
  assert("18.7c …and it never even proposes it, because a proposal is a thing that can be answered",
    !ownerOnlyCard.rec.inserts.some((i) => i.table === "paige_pending_confirmations"
      && i.row?.tool_name === "automation_set_grant"),
    JSON.stringify(ownerOnlyCard.rec.inserts.filter((i) => i.table === "paige_pending_confirmations").map((i) => i.row?.tool_name)));

  // ── 18.9 — THE LAST LINE AT RUNTIME. A tool name that reads as a write and carries no
  // classification is refused before dispatch. The refusal is asserted on the LOG MARKER as well
  // as on the absence of a write, because "an unknown tool did nothing" is true whether the guard
  // exists or not — the marker is the only evidence that the GUARD is what stopped it.
  const inventedWrite = await drive({
    stream: true, clientId: OWN, extraBody: { threadId: THREAD },
    toolCall: { name: "secret_delete_everything", args: { target: "all" } },
    ...CONFIRM,
    tablesExtra: { ...asAdmin },
  });
  assert("18.9 an unclassified write-shaped tool is refused by the policy, not merely unhandled",
    inventedWrite.logged.some((l) => l.msg.includes("[paige] unclassified write refused")),
    JSON.stringify(inventedWrite.logged.map((l) => l.msg).slice(0, 6)));
  assert("18.9b …and nothing left the platform on that turn",
    inventedWrite.outboundCalls.length === 0,
    JSON.stringify(inventedWrite.outboundCalls.map((c) => c.url)));

  // ── 18.9c — …and a read-shaped unknown tool is NOT swallowed by that guard, or 18.9 would be
  // satisfied by refusing everything unfamiliar, which would break every read tool ever added.
  const inventedRead = await drive({
    stream: true, clientId: OWN, extraBody: { threadId: THREAD },
    toolCall: { name: "widget_list_things", args: {} },
    ...CONFIRM,
    tablesExtra: { ...asAdmin },
  });
  assert("18.9c an unknown READ-shaped tool is not caught by the write guard",
    !inventedRead.logged.some((l) => l.msg.includes("[paige] unclassified write refused")),
    JSON.stringify(inventedRead.logged.map((l) => l.msg).slice(0, 6)));

  // ── 18.8 — the token is gone from the wire entirely. A key anyone can ask for is not a key;
  // leaving it in the response "for compatibility" would hand the next reader the same trap.
  assert("18.8 no confirm_token is ever emitted to the model again",
    !/confirm_token/.test(requestA.rec.inserts.length >= 0
      ? (requestA.modelEgress ?? []).join("") + JSON.stringify(requestA.outboundCalls) : ""),
    "a confirm_token still reaches the model's context");
}

// ── 19. EVERY WRITE SAYS WHAT CHANGED, FOR WHOM, ON WHOSE AUTHORITY, AND WHETHER IT WORKED ───
//
// The gap: ten of the forty-nine executable mutations were mirrored onto the per-client rail and
// three wrote a bespoke `audit_logs` row. Everything else — publishes, documents, provider calls,
// role grants, deals, plans — left no trace at all, and the rail's `p_ref_id` was hardcoded null,
// so even a mirrored event could not name the record it changed.
//
// "Paige changed something" with no record of WHAT, or on whose authority, is what this closes.
// The rows go to `paige_audit_log` because it already exists for this and carries `tenant_id`,
// which `audit_logs` does not.
{
  const THREAD = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
  // The persona carries a real tenant here, so 19.3 can assert the row is TENANT-SCOPED rather
  // than merely that the key exists. With the default fixture `tenant_id` resolves to null, and a
  // check that accepts null cannot tell "set explicitly" from "left off the insert" (§26) — the
  // failure mode being an audit row invisible to the tenant whose change it records.
  const WITH_TENANT = {
    get_paige_persona_context: { data: [{ tenant_id: CALLER_TENANT, tenant_name: "T", playbook_config: null, playbook_slug: null, funding_enabled: false, brand: null }], error: null },
  };
  const AUTO = { rpcOverrides: {
    resolve_tool_autonomy: { data: "auto", error: null },
    get_actor_access: { data: { tier: "tenant" }, error: null },
    ...WITH_TENANT,
  } };
  const auditRows = (r) => r.rec.inserts.filter((i) => i.table === "paige_audit_log").map((i) => i.row);

  // ── 19.1 A write that ran at the standing autonomy setting is recorded, with its target.
  const wrote = await drive({
    clientId: OWN, stream: true, extraBody: { threadId: THREAD },
    toolCall: { name: "update_client_data", args: { client_id: OWN, updates: { goal: "buy a house" } } },
    ...AUTO,
  });
  const row = auditRows(wrote)[0];
  assert("19.1 an executed write files an attribution row",
    !!row && row.action === "update_client_data",
    JSON.stringify(auditRows(wrote)));
  assert("19.2 …naming the entity and the record it landed on",
    row?.target_type === "clients" && row?.target_id === OWN,
    JSON.stringify({ target_type: row?.target_type, target_id: row?.target_id }));
  assert("19.3 …the actor, the tenant, and the risk class",
    row?.actor_user_id === USER && row?.tenant_id === CALLER_TENANT && row?.payload?.risk === "ordinary",
    JSON.stringify({ actor: row?.actor_user_id, tenant: row?.tenant_id, risk: row?.payload?.risk }));
  // The distinction that makes the row worth reading: a standing setting is not a yes given here.
  assert("19.4 …and that it ran on a STANDING setting, not on an approval given in this turn",
    row?.payload?.authorised_by === "standing_autonomy_setting"
      && row?.payload?.outcome === "succeeded",
    JSON.stringify(row?.payload ?? null));

  // ── 19.5 An approval given HERE reads differently from a standing setting, or the field is
  // decoration. Driven through the real card path: request A proposes, request B carries the
  // fingerprint the gate actually minted.
  const CONFIRM = { rpcOverrides: {
    resolve_tool_autonomy: { data: "confirm", error: null },
    get_actor_access: { data: { tier: "tenant" }, error: null },
    ...WITH_TENANT,
  } };
  const st = makeConfirmStore();
  const proposed = await drive({
    clientId: OWN, stream: true, extraBody: { threadId: THREAD },
    toolCall: { name: "update_client_data", args: { client_id: OWN, updates: { goal: "buy a house" } } },
    ...CONFIRM,
    tablesExtra: { paige_pending_confirmations: st.table },
    onInsert: mirrorConfirms(st),
  });
  assert("19.5a a proposal awaiting a person files NO attribution row — it is not a write",
    auditRows(proposed).length === 0, JSON.stringify(auditRows(proposed)));

  const approved = await drive({
    clientId: OWN, stream: true,
    extraBody: { threadId: THREAD, approvedConfirmations: [issuedApproval(st.rows[0])] },
    toolCall: { name: "update_client_data", args: { client_id: OWN, updates: { goal: "buy a house" } } },
    ...CONFIRM,
    tablesExtra: { paige_pending_confirmations: st.table },
    onInsert: mirrorConfirms(st),
  });
  assert("19.5 an approval given on the card is recorded as such, not as a standing setting",
    auditRows(approved)[0]?.payload?.authorised_by === "operator_card",
    JSON.stringify(auditRows(approved).map((r) => r.payload?.authorised_by)));

  // ── 19.6 A FAILED write is recorded as failed. A trail that only holds successes tells the
  // reassuring half of the story, which is worse than none — it is the half you would check.
  const failedWrite = await drive({
    clientId: OWN, stream: true, extraBody: { threadId: THREAD },
    toolCall: { name: "crm_add_note", args: { contact_id: OWN, body: "x" } },
    ...AUTO,
    tablesExtra: { user_roles: () => [{ role: "admin" }] },
    tableErrorsExtra: { "client_notes:insert": { message: "denied", code: "42501" } },
  });
  const failRow = auditRows(failedWrite)[0];
  assert("19.6 a write that failed is recorded, and recorded as having failed",
    !!failRow && failRow.payload?.outcome === "failed",
    JSON.stringify(auditRows(failedWrite).map((r) => r.payload)));
  // The arguments can carry a client's details and an audit row is read by more people than the
  // conversation was. Kills: widening the payload to "just include the args, it's useful".
  assert("19.6b …without copying the arguments into a row other people can read",
    !JSON.stringify(failRow?.payload ?? {}).includes("\"updates\"")
      && !JSON.stringify(failRow?.payload ?? {}).includes("\"title\""),
    JSON.stringify(failRow?.payload ?? null));

  // ── 19.7 THE RAIL CAN NAVIGATE TO WHAT IT CHANGED. `p_ref_id` was hardcoded null, so a rail
  // event asserted that something happened to a client without pointing at the record.
  const railCall = wrote.rec.rpc.find((c) => c.name === "record_rail_event");
  assert("19.7 a rail event names the record it changed, not just the table",
    !!railCall && railCall.args?.p_ref_table === "clients" && railCall.args?.p_ref_id === OWN,
    JSON.stringify(railCall?.args ?? "no rail event"));

  // ── 19.8 COVERAGE. The point is that the map is not a hand-picked ten any more: every
  // executable mutation names the entity it touches. Kills: adding a write tool and leaving it
  // out of the map, which would file an attribution row that says only "something happened".
  const { mutatingTools: mt, classifyAction: ca } =
    await import("../../supabase/functions/_shared/action-risk.ts");
  const chatSrc = await (await import("node:fs/promises")).readFile(
    new URL("../../supabase/functions/paige-ai-chat/index.ts", import.meta.url), "utf8");
  const mapAt = chatSrc.indexOf("const WRITE_TARGET: Record<string, string> = {");
  const mapped = new Set([...chatSrc.slice(mapAt, chatSrc.indexOf("};", mapAt))
    .matchAll(/([a-z0-9_]+):\s*"[a-z0-9_]+"/g)].map((m) => m[1]));
  const executable = [...mt()].filter((t) => ca(t) !== "owner_only");
  const unmapped = executable.filter((t) => !mapped.has(t));
  assert("19.8 every executable mutation names the entity it touches",
    mapped.size >= 40 && unmapped.length === 0, JSON.stringify(unmapped));

  // ── 19.9 The rail's membership is DERIVED from that map, not a second hand-picked list. Kills:
  // reverting `isCrm` to the frozen set, which is how `update_client_data` — the most-used
  // per-client write and the client seat's only one — came to be missing from it.
  assert("19.9 the per-client rail is derived from the target map, not a frozen list",
    /WRITE_TARGET\[name\] === "clients"/.test(chatSrc),
    "the rail set is hand-listed again");
}

// ── 20. PAIGE OPENS KNOWING WHAT SHE IS CARRYING ─────────────────────────────────────────────
//
// A transcript is not memory: it is what was SAID, not what is OWED, and it does not survive a new
// thread, a compaction, or a person coming back a week later. `paige_operating_memory()` composes
// the four places that already hold the answer — open commitments, live processes, work in flight,
// and what she actually did with its real outcome — and this section proves the composed read
// reaches the turn, carries the outcome honestly, and is scoped.
{
  const THREAD = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
  const OM = {
    commitments: [{ id: "1", kind: "task", title: "SEND-THE-RECAP", status: "open", due_at: "2026-09-03T10:00:00Z" }],
    in_flight: [{ id: "2", title: "DRAFT-AWAITING-YOU", status: "pending_approval", awaiting_approval: true }],
    processes: [{ id: "3", name: "NEW-LEAD-WELCOME", granted_lane: "auto", state: "live" }],
    recent: [{ action: "crm_create_contact", target_type: "clients", outcome: "failed" }],
    // The cross-thread half (M3). A folded summary of an EARLIER conversation, which is what makes
    // a new thread open knowing what the last one committed to instead of blank.
    continuity: [{
      thread_id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
      title: "LAST-WEEKS-CALL", turns: 40, last_active: "2026-08-28T09:00:00Z",
      summary: "EARLIER-CONVERSATION-RECALLED they agreed to the September start date",
    }],
    scope: { tenant_id: CALLER_TENANT, user_id: USER, contact_id: null },
  };
  const carrying = (extra = {}) => drive({
    clientId: OWN, stream: true, extraBody: { threadId: THREAD },
    rpcOverrides: {
      get_actor_access: { data: { tier: "tenant" }, error: null },
      paige_operating_memory: { data: OM, error: null },
    },
    ...extra,
  });
  const prompt = (r) => r.modelEgress.map((b) => (typeof b === "string" ? b : JSON.stringify(b)))
    .join("\n").replace(/\\"/g, '"').replace(/\\n/g, "\n");

  const opened = await carrying();
  const p0 = prompt(opened);
  assert("20.0 the operating memory is actually read (guards this section)",
    opened.rec.rpc.some((c) => c.name === "paige_operating_memory"),
    JSON.stringify(opened.rec.rpc.map((c) => c.name).slice(0, 12)));
  assert("20.1 what she OWES reaches the turn",
    p0.includes("SEND-THE-RECAP"), "the commitment never reached the prompt");
  assert("20.2 what is WAITING ON THE PERSON reaches the turn, marked as waiting on them",
    /DRAFT-AWAITING-YOU — WAITING ON THEIR APPROVAL/.test(p0),
    "work stopped at an approval is not distinguished from work in progress");
  assert("20.3 what runs WITHOUT being asked reaches the turn, with whether it acts alone",
    /NEW-LEAD-WELCOME \(acts on its own\)/.test(p0),
    "a live process is not distinguished from one that still asks first");
  // §13 — the outcome travels with the action. A list of attempts read as a list of successes is
  // the exact over-claim the write trail exists to prevent.
  assert("20.4 what she last did carries its REAL outcome, not just that it happened",
    /crm_create_contact on clients — failed/.test(p0),
    "a failed action is presented without its failure");

  // ── 20.4b CROSS-THREAD CONTINUITY (M3). Within one thread the rolling summary already carried
  // decisions and open loops; across threads nothing did, so a new conversation opened blank while
  // the tenant's own earlier threads sat summarised and unread. Measured on production: one tenant
  // with 18 threads, 277 turns and 8 folded summaries, none of which a new chat could see.
  assert("20.4b an earlier conversation reaches the turn, so a new thread does not open blank",
    /EARLIER-CONVERSATION-RECALLED/.test(p0),
    "the continuity section is read but never rendered — a read nothing renders is a read nobody sees");
  // §13 — it is the ONLY model-written section here. Presented as recollection, with the record
  // named as the tiebreak, because a folded summary stated with the confidence of an audit row is
  // how a conversation becomes evidence.
  assert("20.4c …labelled as recollection rather than as the record",
    /your own recollection, not the record/.test(p0) && /the record wins/.test(p0),
    "prose about a conversation is being presented with the authority of a real row");
  // …and the block's own header does not undo that label: it used to call everything inside it "from
  // the record" and "what the platform actually holds", the recollection included (owner 2026-10-05).
  assert("20.4d the carrying block's header and footer do not call the recalled conversation the record",
    /=== WHAT YOU ARE CARRYING \(from earlier work, not from this conversation\) ===/.test(p0)
      && !/WHAT YOU ARE CARRYING \(from the record/.test(p0)
      && /Except for any earlier conversation recalled above, this is what the platform actually holds/.test(p0),
    (p0.match(/=== WHAT YOU ARE CARRYING[^\n]*/) ?? [""])[0]);

  // ── 20.5 SCOPE. The read takes NO tenant argument — scope is derived server-side from the
  // session — and when a client is in focus it narrows to that client, which is what stops a
  // switch carrying the previous client's open work into the new scope (§S2).
  const omCall = opened.rec.rpc.find((c) => c.name === "paige_operating_memory");
  assert("20.5 the read is not handed a tenant by the request",
    !!omCall && !Object.keys(omCall.args ?? {}).some((k) => /tenant/i.test(k)),
    JSON.stringify(omCall?.args ?? null));
  assert("20.5b …and it narrows to the client in focus",
    omCall?.args?.p_contact_id === OWN, JSON.stringify(omCall?.args ?? null));
  assert("20.5c …and it is asked as the CALLER, so RLS is the boundary",
    omCall?.client !== "service", JSON.stringify({ client: omCall?.client }));
  // The current thread is excluded by id. Without this the turn is handed its OWN folded summary
  // alongside the copy the caller already injects — budget spent restating what is in front of the
  // model. Asserting the exact id, not merely that the key exists, because a null here is the bug.
  assert("20.5d …and the CURRENT thread is excluded, so it is not handed its own summary back",
    omCall?.args?.p_exclude_thread_id === THREAD, JSON.stringify(omCall?.args ?? null));

  // ── 20.5d BOTH PROMPT PATHS, NOT JUST THE VERTICAL ONE. §2: `FUNDING_SKILL_PROMPT` is the
  // opt-in funding skill and `buildNeutralCorePrompt` is what every tenant that has NOT opted in
  // receives. The first wiring of this reached only the funding one, so the memory landed for the
  // vertical and not for the platform default — the exact shape §2 exists to catch, and invisible
  // to any check that only drove a funding tenant. 20.1–20.4 above drive the NEUTRAL default;
  // this drives the funding path so neither can regress while the other stays green.
  const funding = await drive({
    clientId: OWN, stream: true, extraBody: { threadId: THREAD },
    rpcOverrides: {
      get_actor_access: { data: { tier: "tenant" }, error: null },
      paige_operating_memory: { data: OM, error: null },
      get_paige_persona_context: { data: [{ tenant_id: CALLER_TENANT, tenant_name: "T", playbook_config: null, playbook_slug: null, funding_enabled: true, brand: null }], error: null },
    },
  });
  assert("20.5d the funding-skill prompt carries it too",
    prompt(funding).includes("SEND-THE-RECAP"),
    "the opt-in funding path lost the operating memory");

  // ── 20.6 AN ERROR IS NOT "NOTHING OPEN". Rendering an empty block on a failed read would tell
  // the person, with confidence, that they have no outstanding commitments. Kills: treating the
  // error branch as an empty result, which is the friendliest-looking way to lie.
  const broke = await drive({
    clientId: OWN, stream: true, extraBody: { threadId: THREAD },
    rpcOverrides: {
      get_actor_access: { data: { tier: "tenant" }, error: null },
      paige_operating_memory: { data: null, error: { message: "denied", code: "42501" } },
    },
  });
  const p1 = prompt(broke);
  assert("20.6 a failed read says NOTHING rather than implying there is nothing outstanding",
    !p1.includes("WHAT YOU ARE CARRYING"), "an unavailable read rendered as an empty carrying block");
  assert("20.6b …and the failure is logged rather than swallowed",
    broke.logged.some((l) => l.msg.includes("operating memory unavailable")),
    JSON.stringify(broke.logged.map((l) => l.msg).slice(0, 6)));

  // ── 20.7 …and a genuinely EMPTY carry renders nothing either, so the block's presence always
  // means there is something to say. Kills: emitting a header with no content under it.
  const empty = await drive({
    clientId: OWN, stream: true, extraBody: { threadId: THREAD },
    rpcOverrides: {
      get_actor_access: { data: { tier: "tenant" }, error: null },
      paige_operating_memory: { data: { commitments: [], in_flight: [], processes: [], recent: [] }, error: null },
    },
  });
  assert("20.7 nothing outstanding renders no block at all",
    !prompt(empty).includes("WHAT YOU ARE CARRYING"), "an empty carry still emitted a header");

  // ── 20.8 A REFUSED client focus does no operating-memory read for that client. The refusal
  // path clears the focus, so the read must not be handed an id the turn was not allowed to use.
  const refused = await drive({
    clientId: FOREIGN, stream: true, extraBody: { threadId: THREAD },
    rpcOverrides: {
      get_actor_access: { data: { tier: "tenant" }, error: null },
      paige_operating_memory: { data: OM, error: null },
    },
  });
  assert("20.8 a refused client focus never asks for that client's carrying list",
    !refused.rec.rpc.some((c) => c.name === "paige_operating_memory" && c.args?.p_contact_id === FOREIGN),
    JSON.stringify(refused.rec.rpc.filter((c) => c.name === "paige_operating_memory").map((c) => c.args)));
}

// ── 21. A NOTE LANDS ON THE RIGHT CLIENT'S FILE, AND ONLY ON CONFIRMATION ────────────────────
//
// The routing decision — WHICH client this is about — is now made by a model, so it is the thing
// that has to be constrained. `client_notes` is staff-only by construction (it has no
// client-facing read policy at all), so "visibility" has exactly one honest value and the confirm
// says it rather than offering a choice that does not exist.
{
  const THREAD = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
  const OWN_CONTACT = "11111111-1111-4111-8111-111111111111";
  const CONFIRM = { rpcOverrides: {
    resolve_tool_autonomy: { data: "confirm", error: null },
    get_actor_access: { data: { tier: "tenant" }, error: null },
    get_paige_persona_context: { data: [{ tenant_id: CALLER_TENANT, tenant_name: "T", playbook_config: null, playbook_slug: null, funding_enabled: false, brand: null }], error: null },
  } };
  const AUTO = { rpcOverrides: { ...CONFIRM.rpcOverrides, resolve_tool_autonomy: { data: "auto", error: null } } };
  // The tool is admin/coach gated, and `clients` answers only for rows in the caller's tenant —
  // which is what makes the foreign-contact case below a real refusal and not an empty fixture.
  const CRM = {
    user_roles: () => [{ role: "admin" }],
    clients: (filters) => {
      const eq = (c) => filters.find((f) => f[0] === "eq" && f[1] === c)?.[2];
      const id = eq("id"), ten = eq("tenant_id");
      if (id === OWN_CONTACT && (ten === undefined || ten === CALLER_TENANT)) {
        return [{ id: OWN_CONTACT, first_name: "Dana", last_name: "Reyes", tenant_id: CALLER_TENANT }];
      }
      if (id === OWN) return [{ id: OWN, tenant_id: CALLER_TENANT }];
      return [];
    },
  };
  const notes = (r) => r.rec.inserts.filter((i) => i.table === "client_notes").map((i) => i.row);
  const prompt = (r) => r.modelEgress.map((b) => (typeof b === "string" ? b : JSON.stringify(b)))
    .join("\n").replace(/\\"/g, '"');

  // ── 21.1 A note is PROPOSED, not filed, at the default lane.
  const st = makeConfirmStore();
  const proposed = await drive({
    clientId: OWN, stream: true, extraBody: { threadId: THREAD },
    toolCall: { name: "crm_add_note", args: { contact_id: OWN_CONTACT, body: "Wants to close before year end." } },
    ...CONFIRM,
    tablesExtra: { paige_pending_confirmations: st.table, ...CRM }, serviceTablesExtra: { ...CRM },
    onInsert: mirrorConfirms(st),
  });
  assert("21.1 filing a note is proposed, not performed",
    notes(proposed).length === 0, JSON.stringify(notes(proposed)));

  // ── 21.2 …and the card says what is being filed AND who will see it. A confirm that does not
  // state visibility leaves the operator to assume, and the assumption people make about a note
  // on someone's file is the wrong one.
  const wire = prompt(proposed);
  assert("21.2 the card quotes the note and states it is staff-only",
    /Wants to close before year end/.test(wire) && /Only your team sees it — the client will not/.test(wire),
    (wire.match(/"confirm_summary":"[^"]{0,200}/) ?? ["no summary on the wire"])[0]);

  // ── 21.3 On approval the note is filed — tenant stamped, author the REAL person, not Paige.
  const approved = await drive({
    clientId: OWN, stream: true,
    extraBody: { threadId: THREAD, approvedConfirmations: [issuedApproval(st.rows[0])] },
    toolCall: { name: "crm_add_note", args: { contact_id: OWN_CONTACT, body: "Wants to close before year end." } },
    ...CONFIRM,
    tablesExtra: { paige_pending_confirmations: st.table, ...CRM }, serviceTablesExtra: { ...CRM },
    onInsert: mirrorConfirms(st),
  });
  const row = notes(approved)[0];
  assert("21.3 an approved note is filed on the named client",
    !!row && row.contact_id === OWN_CONTACT && /year end/.test(String(row.body)),
    JSON.stringify(notes(approved)));
  assert("21.4 …stamped with the tenant, and authored by the PERSON rather than by Paige",
    row?.tenant_id === CALLER_TENANT && row?.author_user_id === USER,
    JSON.stringify({ tenant_id: row?.tenant_id, author: row?.author_user_id }));
  // Written as the caller so RLS decides, not as service role which would bypass every policy
  // this slice's migration adds.
  const q = approved.rec.from.find((f) => f.table === "client_notes" && f.op === "insert");
  assert("21.5 …written as the CALLER, so the destination policy actually applies",
    !!q && q.client !== "service", JSON.stringify(q ?? "no insert recorded"));

  // ── 21.6 THE ROUTING DECISION IS CHECKED, NOT TRUSTED. A model naming another tenant's client
  // files nothing — this is the whole point of the slice.
  const foreignNote = await drive({
    clientId: OWN, stream: true, extraBody: { threadId: THREAD },
    toolCall: { name: "crm_add_note", args: { contact_id: FOREIGN, body: "should never land" } },
    ...AUTO,
    tablesExtra: { ...CRM }, serviceTablesExtra: { ...CRM },
  });
  assert("21.6 §9 a note aimed at another tenant's client is NOT filed",
    notes(foreignNote).length === 0, JSON.stringify(notes(foreignNote)));
  assert("21.6b …and the refusal does not reveal whether that client exists elsewhere",
    !prompt(foreignNote).includes("belongs to another"),
    "the refusal distinguishes 'other tenant' from 'no such client', which is a probe");

  // ── 21.6c THE CASE RLS DOES NOT CATCH, and the reason the explicit tenant filter is there.
  // `OTHERTEN` is a client this caller CAN see — a coach assignment reaches across workspaces —
  // but which another tenant owns. RLS on `clients` returns the row happily; only the explicit
  // `eq("tenant_id", …)` refuses it. Without this check, deleting that filter failed nothing,
  // because the fixture's foreign client is invisible for a different reason.
  const visibleButForeign = await drive({
    clientId: OWN, stream: true, extraBody: { threadId: THREAD },
    toolCall: { name: "crm_add_note", args: { contact_id: OTHERTEN, body: "should never land" } },
    ...AUTO,
    tablesExtra: { ...CRM, clients: (filters) => {
      const eq = (c) => filters.find((f) => f[0] === "eq" && f[1] === c)?.[2];
      const id = eq("id"), ten = eq("tenant_id");
      // Visible to this caller, owned elsewhere: returned UNLESS the caller scoped by tenant.
      if (id === OTHERTEN) return ten === undefined ? [{ id: OTHERTEN, tenant_id: OTHER_TENANT }] : [];
      if (id === OWN) return [{ id: OWN, tenant_id: CALLER_TENANT }];
      return [];
    } },
    serviceTablesExtra: { clients: () => [] },
  });
  assert("21.6c a client the caller can SEE but does not own is still refused",
    notes(visibleButForeign).length === 0, JSON.stringify(notes(visibleButForeign)));

  // ── 21.7 …and a nonsense id is refused before any lookup, with something the operator can act on.
  const badId = await drive({
    clientId: OWN, stream: true, extraBody: { threadId: THREAD },
    toolCall: { name: "crm_add_note", args: { contact_id: "not-a-uuid", body: "x" } },
    ...AUTO,
    tablesExtra: { ...CRM }, serviceTablesExtra: { ...CRM },
  });
  assert("21.7 a malformed contact id files nothing and asks for a real one",
    notes(badId).length === 0 && /look them up first/.test(prompt(badId)),
    JSON.stringify(notes(badId)));

  // ── 21.8 The note reaches the client's rail and the write trail, like every other write (C1).
  const railed = approved.rec.rpc.find((c) => c.name === "record_rail_event");
  assert("21.8 the note appears on that client's rail, pointing at the record",
    !!railed && railed.args?.p_ref_table === "client_notes",
    JSON.stringify(railed?.args ?? "no rail event"));
  const audit = approved.rec.inserts.find((i) => i.table === "paige_audit_log")?.row;
  assert("21.9 …and files an attribution row naming the entity and the approval it ran on",
    audit?.action === "crm_add_note" && audit?.target_type === "client_notes"
      && audit?.payload?.authorised_by === "operator_card",
    JSON.stringify(audit ?? "no attribution row"));
}


// Real handler -> real n8n adapter: stored SDK arguments pass validation only after the card.
{
  const THREAD="cccccccc-cccc-4ccc-8ccc-cccccccccccc", SESSION="dddddddd-dddd-4ddd-8ddd-dddddddddddd";
  const authorization="Bearer h."+Buffer.from(JSON.stringify({session_id:SESSION})).toString("base64url")+".s";
  const st=makeConfirmStore();
  const sdk={code:"export default workflow('Approved draft');",name:"Approved draft",versionName:"Draft",versionDescription:"Owner approved design"};
  const base={stream:true,authorization,extraBody:{threadId:THREAD},rpcOverrides:{
    resolve_tool_autonomy:{data:"confirm",error:null},get_actor_access:{data:{tier:"tenant"},error:null},
    get_paige_persona_context:{data:[{tenant_id:CALLER_TENANT,tenant_name:"Workspace",funding_enabled:false}],error:null},
    n8n_oauth_service:{data:null,error:{message:"N8N_FORBIDDEN"}},
  },tablesExtra:{paige_pending_confirmations:st.table},onInsert:mirrorConfirms(st)};
  const proposed=await drive({...base,toolCall:{name:"n8n_create_workflow",args:sdk}});
  const acquired=r=>r.rec.rpc.filter(c=>c.name==="n8n_oauth_service"&&c.args._operation==="acquire");
  assert("22.1 n8n never acquires provider credentials before the approval card",acquired(proposed).length===0&&st.rows.length===1);
  const approved=await drive({...base,extraBody:{threadId:THREAD,approvedConfirmations:[issuedApproval(st.rows[0])]},toolCall:{name:"n8n_create_workflow",args:{...sdk,code:"",confirm:true}}});
  assert("22.2 Solo owner without global CRM roles reaches real n8n adapter after clicked card",acquired(approved).length===1);
  assert("22.3 real adapter validates stored SDK code instead of model's invalid replacement",acquired(approved)[0]?.args._input.session_id===SESSION&&acquired(approved)[0]?.args._input.tenant_id===CALLER_TENANT);
  const audit=approved.rec.inserts.find(i=>i.table==="paige_audit_log"&&i.row.action==="n8n_create_workflow")?.row;
  assert("22.4 refused n8n adapter result is audited as failed with safe reason",audit?.payload.outcome==="failed"&&audit?.payload.error==="forbidden",JSON.stringify(audit));
  // The n8n tools report in `ok`, and refuse before writing unless they say outcome_unknown: the
  // card reads that as didn't run. Read as any other tool, the same answer would be couldn't confirm.
  const n8nOutcome=approved.bodyText.split("\n").filter(l=>l.startsWith("data: ")&&l!=="data: [DONE]").map(l=>{try{return JSON.parse(l.slice(6))}catch{return null}}).find(f=>f&&f.paige_approval_outcome)?.paige_approval_outcome;
  assert("22.4b the card reports an approved n8n change the adapter refused as didn't run",JSON.stringify(n8nOutcome)===JSON.stringify({actions:[{fingerprint:issuedApproval(st.rows[0]),outcome:"not_run"}],note:"It didn't go through."}),JSON.stringify(n8nOutcome));
  assert("22.5 audit excludes SDK code and provider input",!JSON.stringify(audit).includes("export default")&&!JSON.stringify(audit).includes("Owner approved design"));
  const replay=await drive({...base,extraBody:{threadId:THREAD,approvedConfirmations:[issuedApproval(st.rows[0])]},toolCall:{name:"n8n_create_workflow",args:{...sdk,code:"",confirm:true}}});
  assert("22.6 clicked n8n approval cannot acquire again on replay",acquired(replay).length===0);
  const clientSeat=await drive({...base,rpcOverrides:{...base.rpcOverrides,get_actor_access:{data:{tier:"client"},error:null}},toolCall:{name:"n8n_list_workflows",args:{}}});
  assert("22.7 client portal seat never reaches n8n owner adapter",acquired(clientSeat).length===0);
  const executionRead=await drive({...base,toolCall:{name:"n8n_execution_get",args:{workflow_id:"wf1",execution_id:"e1"}}});
  assert("22.8 registered execution metadata tool reaches adapter without a global CRM role",acquired(executionRead).length===1);

}

console.log('\n23. canonical server-issued proposal integrity');
{
 const THREAD='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
 const args={client_id:OWN,updates:{goal:'EXACT-STORED-INTEGRITY'}};
 const CONFIRM={resolve_tool_autonomy:{data:'confirm',error:null},get_actor_access:{data:{tier:'tenant'},error:null}};
 const run=(st,options={})=>drive({stream:true,clientId:OWN,extraBody:{threadId:THREAD},toolCall:{name:'update_client_data',args},rpcOverrides:CONFIRM,tablesExtra:{paige_pending_confirmations:st.table},onInsert:mirrorConfirms(st),...options});
 const writes=r=>r.outboundCalls.filter(c=>c.url.includes('paige-write-back'));
 const initial=makeConfirmStore();const first=await run(initial);const issued=initial.rows[0];
 assert('23.1 issuance is marked and performed by service',!!issued?.server_issued_at && first.rec.from.some(x=>x.table==='paige_pending_confirmations'&&x.op==='insert'&&x.client==='service'));
 if(issued){
  const untrusted=makeConfirmStore([{...issued,server_issued_at:null,consumed:false}]);
  const refused=await run(untrusted,{extraBody:{threadId:THREAD,approvedConfirmations:[issuedApproval(issued)]},toolCall:{name:'update_client_data',args:{...args,updates:{goal:'DRIFT'}}}});
  assert('23.2 unmarked submitted proposal cannot recover or execute',writes(refused).length===0&&!untrusted.rows[0].consumed);
  assert('23.3 same-fingerprint trusted reproposal leaves legacy record intact',untrusted.rows.length===2&&untrusted.rows[0].server_issued_at===null&&!!untrusted.rows[1].server_issued_at);
  // Exact original args produces the same fingerprint; the old record must not block it.
  const old=makeConfirmStore([{...issued,server_issued_at:null,consumed:false}]);await run(old);
  assert('23.3b approval-path hardening',old.rows.length===2&&old.rows[0].fingerprint===old.rows[1].fingerprint&&old.rows[0].issued_in_request!==old.rows[1].issued_in_request&&!!old.rows[1].server_issued_at);
  const success=await run(old,{extraBody:{threadId:THREAD,approvedConfirmations:[issuedApproval(old.rows[1])]}});
  assert('23.4 trusted replacement executes stored args once',writes(success).length===1&&writes(success)[0].body.includes('EXACT-STORED-INTEGRITY')&&!old.rows[0].consumed&&old.rows[1].consumed);
  const replay=await run(old,{extraBody:{threadId:THREAD,approvedConfirmations:[issuedApproval(old.rows[1])]}});
  assert('23.5 replacement cannot replay',writes(replay).length===0);
  for(const key of ['user_id','tenant_id','thread_id','scoped_client_id','tool_name','expires_at','issued_in_request','server_issued_at']){
   const st=makeConfirmStore([{...issued,consumed:false}]);const table=st.table;let raced=false;let claimRows=null;
   st.table=filters=>{const claim=!raced&&filters.some(x=>x[0]==='update')&&filters.some(x=>x[0]==='eq'&&x[1]==='issued_in_request');if(claim){raced=true;st.rows[0][key]=key==='server_issued_at'?null:key==='expires_at'?'2000-01-01T00:00:00Z':FOREIGN;}const result=table(filters);if(claim)claimRows=result.length;return result;};
   const r=await run(st,{extraBody:{threadId:THREAD,approvedConfirmations:[issuedApproval(issued)]},toolCall:{name:'update_client_data',args:{...args,confirm:true,updates:{goal:'changed-value'}}}});
   assert('23.6 final CAS repeats '+key,raced&&claimRows===0&&writes(r).length===0&&(key==='expires_at'||!st.rows[0].consumed));
   const cas=r.rec.from.find(x=>x.table==='paige_pending_confirmations'&&x.op==='update'&&x.filters.some(f=>f[0]==='eq'&&f[1]==='issued_in_request'));
   assert('23.6b final CAS actually reached '+key,!!cas&&cas.client==='service');
  }
  for(const [key,value] of [['user_id',FOREIGN],['tenant_id',OTHER_TENANT],['thread_id',FOREIGN],['scoped_client_id',FOREIGN]]){
   const st=makeConfirmStore([{...issued,consumed:false},{...issued,id:'foreign-row',consumed:false,[key]:value}]);
   await run(st,{extraBody:{threadId:THREAD,declinedConfirmations:[issuedApproval(issued)]},toolCall:null,text:'Do not run it.'});
   assert('23.7 cancellation scopes '+key,st.rows[0].consumed&&!st.rows[1].consumed);
  }
 }
 const failed=await run(makeConfirmStore(),{onInsert:t=>t==='paige_pending_confirmations'?{code:'42703',message:'fixture missing marker column'}:null});
 const wire=failed.modelEgress.join('\n').replace(/\\"/g,'"')+'\n'+failed.bodyText;
 assert('23.8 failed issuance executes nothing and offers no approvable card',writes(failed).length===0&&!/"needs_confirm":true/.test(wire)&&!/"confirm_fingerprint"/.test(wire));
 assert('23.8b failure is described honestly',/could not|couldn.t|retry|not.*recorded/i.test(wire));
}
{
 const st=makeConfirmStore();fake.setScenario({tables:{paige_pending_confirmations:st.table},onInsert:mirrorConfirms(st)});
 const browser=fake.createClient('https://fixture.test','anon-key',{global:{headers:{Authorization:'Bearer test'}}});
 const service=fake.createClient('https://fixture.test','service-role-key');
 const record={user_id:USER,tool_name:'update_client_data',fingerprint:'1234567890abcdef',args:{safe:true},server_issued_at:'2026-01-01T00:00:00Z'};
 for(const [name,query] of [['insert',()=>browser.from('paige_pending_confirmations').insert(record)],['update',()=>browser.from('paige_pending_confirmations').update({args:{evil:true}})],['upsert',()=>browser.from('paige_pending_confirmations').upsert(record)],['delete',()=>browser.from('paige_pending_confirmations').delete()]]){
 const result=await query();assert('23.9 fake boundary refuses browser '+name,result.error?.code==='42501'&&st.rows.length===0);
 }
 const trusted=await service.from('paige_pending_confirmations').insert(record);
 assert('23.10 fake boundary allows service issuance without inventing its marker',trusted.error===null&&st.rows.length===1&&st.rows[0].server_issued_at===record.server_issued_at);
}
console.log('\n24. proposal authority requires proven current scope and durable cancellation');
{
 const THREAD='cccccccc-cccc-4ccc-8ccc-cccccccccccc';const args={updates:{goal:'ROOT-SCOPE-ACTION'}};
 const tenant={tenant_id:CALLER_TENANT};const rpc=data=>({data,error:null});
 const run=(st,resolve=()=>rpc([tenant]),extra={})=>drive({stream:true,extraBody:{threadId:THREAD},toolCall:{name:'update_client_data',args},rpcOverrides:{get_paige_persona_context:resolve,resolve_tool_autonomy:rpc('confirm'),get_actor_access:rpc({tier:'tenant'})},tablesExtra:{paige_pending_confirmations:st.table,user_roles:()=>[{role:'admin'}]},onInsert:mirrorConfirms(st),...extra});
 const writes=r=>r.outboundCalls.filter(x=>x.url.includes('paige-write-back'));
 const pending=r=>r.rec.from.filter(x=>x.table==='paige_pending_confirmations');
 for(const [name,result] of Object.entries({rpc_error:{data:null,error:{code:'57014',message:'scope unavailable'}},null_result:rpc(null),object:rpc({tenant_id:CALLER_TENANT}),malformed:rpc([{}]),bad_id:rpc([{tenant_id:'junk'}]),multiple:rpc([tenant,tenant])})){
 const st=makeConfirmStore();const r=await run(st,()=>result);
 assert('24.1 invalid persona cannot issue '+name,st.rows.length===0&&writes(r).length===0&&pending(r).length===0);
 }
 for(const data of [[],[{tenant_id:null}]]){
 const st=makeConfirmStore();const r=await run(st,()=>rpc(data));assert('24.2 proven legitimate null scope still proposes '+JSON.stringify(data),st.rows.length===1&&!!st.rows[0].server_issued_at);
 }
 const initial=makeConfirmStore();await run(initial);const issued=initial.rows[0];
 assert('24.3 valid no-KB tenant proposal reaches store',!!issued);
 if(issued){
 for(const operation of ['issue','claim','recover','cancel']){
 const st=makeConfirmStore(operation==='issue'?[]:[{...issued,consumed:false}]);let n=0;
 const resolver=()=>rpc([++n===1?tenant:{tenant_id:OTHER_TENANT}]);
 const body={threadId:THREAD,...(operation==='claim'||operation==='recover'?{approvedConfirmations:[issuedApproval(issued)]}:{}),...(operation==='cancel'?{declinedConfirmations:[issuedApproval(issued)]}:{})};
 const r=await run(st,resolver,{extraBody:body,toolCall:{name:'update_client_data',args:operation==='recover'?{updates:{goal:'DRIFT'},confirm:true}:args}});
 assert('24.4 fresh scope mismatch stops '+operation,n>1&&writes(r).length===0&&pending(r).length===0&&(operation==='issue'?st.rows.length===0:!st.rows[0].consumed));
 }
 for(const mode of ['confirm','auto']){
 const st=makeConfirmStore([{...issued,consumed:false}]);let cancelled=false;
 const failure=({filters})=>{if(filters.some(x=>x[0]==='eq'&&x[1]==='issued_in_request')){cancelled=true;return {code:'57014',message:'cancel write failed'};}return null;};
 const r=await run(st,()=>rpc([tenant]),{extraBody:{threadId:THREAD,approvedConfirmations:[issuedApproval(issued)],declinedConfirmations:[issuedApproval(issued)]},toolCall:{name:'update_client_data',args:{...args,confirm:true}},rpcOverrides:{get_paige_persona_context:()=>rpc([tenant]),resolve_tool_autonomy:rpc(mode),get_actor_access:rpc({tier:'tenant'})},tableErrorsExtra:{'paige_pending_confirmations:update':failure}});
 assert('24.5 failed cancellation blocks claim reproposal and '+mode+' mutation',cancelled&&writes(r).length===0&&!st.rows[0].consumed&&pending(r).filter(x=>x.op==='update').length===1&&!pending(r).some(x=>x.op==='insert'));
 }
 }
}
{
 const THREAD='cccccccc-cccc-4ccc-8ccc-cccccccccccc';const args={updates:{goal:'NULL-SCOPE-EXACT'}};
 const st=makeConfirmStore();const base={stream:true,extraBody:{threadId:THREAD},toolCall:{name:'update_client_data',args},rpcOverrides:{get_paige_persona_context:{data:[],error:null},resolve_tool_autonomy:{data:'confirm',error:null},get_actor_access:{data:{tier:'tenant'},error:null}}};
 await drive({...base,tablesExtra:{paige_pending_confirmations:st.table},onInsert:mirrorConfirms(st)});
 if(st.rows[0])for(const op of ['claim','recover','cancel']){
 const store=makeConfirmStore([{...st.rows[0],consumed:false}]);
 const r=await drive({...base,rpcOverrides:{...base.rpcOverrides,get_paige_persona_context:{data:null,error:{message:'scope failed'}}},extraBody:{threadId:THREAD,...(op==='cancel'?{declinedConfirmations:[issuedApproval(st.rows[0])]}:{approvedConfirmations:[issuedApproval(st.rows[0])]})},toolCall:{name:'update_client_data',args:op==='recover'?{updates:{goal:'drift'},confirm:true}:args},tablesExtra:{paige_pending_confirmations:store.table},onInsert:mirrorConfirms(store)});
 assert('24.6 unknown scope never becomes operator-null '+op,!store.rows[0].consumed&&!r.rec.from.some(x=>x.table==='paige_pending_confirmations')&&!r.outboundCalls.some(x=>x.url.includes('paige-write-back')));
 }
 const read=await drive({stream:true,extraBody:{threadId:THREAD,declinedConfirmations:['1234567890abcdef']},toolCall:{name:'pipeline_catalogue',args:{}},rpcOverrides:{get_paige_persona_context:{data:[{tenant_id:CALLER_TENANT}],error:null},get_actor_access:{data:{tier:'tenant'},error:null},get_pipeline_catalogue:{data:{items:[]},error:null}},tablesExtra:{user_roles:()=>[{role:'admin'}]},tableErrorsExtra:{'paige_pending_confirmations:update':{code:'57014',message:'cancel failed'}}});
 assert('24.7 cancellation failure does not disable unrelated reads',read.rec.rpc.some(x=>x.name==='get_pipeline_catalogue'));
}
// ── 25. THE COMMS / CRM TOOL GATE — Super Admin admitted, platform_admin NOT, others unchanged ──
//
// `paige-ai-chat` gates the eight `comms_*` tools (with the CRM operator tools) on
// `roles.includes("admin") || roles.includes("super_admin")`. Slice B admitted super_admin WITHOUT
// widening to `platform_admin` (a distinct role string) or any tenant role; the retired coach role
// was then removed from the gate (coach removal, slice 1b). These drive the REAL handler.
//
// Observables: an ADMITTED `comms_connection_summary` (acting INSIDE a tenant) reaches its
// readiness RPC (`tenant_comms_readiness` in rec.rpc); a DENIED one never does and the gate refusal
// string surfaces in the round-2 model egress. Denial-before-provider is proven on
// `comms_search_numbers`: a denied role produces NO `comms-search-numbers` outbound invoke.
// 25.10/25.11 cover the tenant-LESS admitted case (super_admin at rest): the reads answer the
// documented `tenant_not_resolved`, never an opaque "Unknown error" from the readiness RAISE.
console.log("\ncomms/CRM tool gate — Super Admin admitted, platform_admin denied, no widening");
{
  // C0a: the gate now asks the canonical tenant role (workspace owner/admin seat) and names who CAN
  // act; the global `admin` row is no longer consulted. Super Admin is still admitted explicitly.
  const GATE_REFUSAL = "needs this workspace's owner or an admin";
  const COMMS_THREAD = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
  const commsRpcs = {
    // Clear the EARLIER client-seat gate (:7532) so the ROLE gate (:8888) — the thing Slice B
    // changes — is what decides. get_actor_access fails CLOSED to tier 'client', which refuses
    // every owner-ops tool before the role gate; a non-client tier isolates the role gate.
    get_actor_access: { data: { tier: "tenant" }, error: null },
    // An ADMITTED caller is acting INSIDE a tenant (crmTenantId resolved) — the real usable
    // super_admin path is operator_enter_tenant. The reads now refuse `tenant_not_resolved` at rest
    // (25.10/25.11), so the admit cases must carry a tenant or they would trip that at-rest guard
    // instead of reaching readiness.
    get_paige_persona_context: { data: [{ tenant_id: CALLER_TENANT, tenant_name: "T", playbook_config: null, playbook_slug: null, funding_enabled: false, brand: null }], error: null },
    tenant_comms_readiness: { data: { can_send_sms: false, blocked_reason: null, number: "absent", number_e164: null, a2p: "absent" }, error: null },
    list_tool_autonomy: { data: [], error: null },
  };
  const driveGate = (role, tool = "comms_connection_summary", extra = {}) => drive({
    stream: true,
    extraBody: { threadId: COMMS_THREAD },
    toolCall: { name: tool, args: {} },
    rpcOverrides: commsRpcs,
    tablesExtra: { user_roles: () => (role === null ? [] : [{ role }]) },
    ...extra,
  });
  const readinessRan = (r) => r.rec.rpc.some((c) => c.name === "tenant_comms_readiness");
  const refused = (r) => JSON.stringify(r.modelEgress).includes(GATE_REFUSAL);

  const sa = await driveGate("super_admin");
  assert("25.1 a Super Admin is ADMITTED to the comms tools (the fix)",
    readinessRan(sa) && !refused(sa), JSON.stringify({ readiness: readinessRan(sa), refused: refused(sa) }));

  const pa = await driveGate("platform_admin");
  assert("25.2 a platform_admin (NOT super_admin) is DENIED — no widening",
    !readinessRan(pa) && refused(pa), JSON.stringify({ readiness: readinessRan(pa), refused: refused(pa) }));

  const admin = await driveGate("admin");
  assert("25.3 a tenant admin is still admitted (unchanged)",
    readinessRan(admin) && !refused(admin), JSON.stringify({ readiness: readinessRan(admin), refused: refused(admin) }));
  const coach = await driveGate("coach");
  assert("25.4 the retired coach role is denied",
    !readinessRan(coach) && refused(coach), JSON.stringify({ readiness: readinessRan(coach), refused: refused(coach) }));

  const member = await driveGate("member");
  assert("25.5 a tenant member is denied", !readinessRan(member) && refused(member),
    JSON.stringify({ readiness: readinessRan(member), refused: refused(member) }));
  const client = await driveGate("client");
  assert("25.6 a client is denied", !readinessRan(client) && refused(client),
    JSON.stringify({ readiness: readinessRan(client), refused: refused(client) }));
  const none = await driveGate(null);
  assert("25.7 a caller with no role is denied", !readinessRan(none) && refused(none),
    JSON.stringify({ readiness: readinessRan(none), refused: refused(none) }));

  // Denial happens BEFORE any provider/privileged operation: a denied role never reaches the
  // comms-search-numbers edge invoke.
  const denyProvider = await driveGate("member", "comms_search_numbers");
  assert("25.8 denial precedes provider access — no comms-search-numbers invoke for a denied role",
    !denyProvider.outboundCalls.some((c) => c.url.includes("comms-search-numbers")) && refused(denyProvider),
    JSON.stringify(denyProvider.outboundCalls.map((c) => c.url)));

  // Server-derived authority: a caller-supplied role/tenant/isAdmin in the request BODY cannot
  // admit a denied caller — the gate reads user_roles keyed on the JWT-derived user.id.
  const spoof = await driveGate("member", "comms_connection_summary", {
    extraBody: { threadId: COMMS_THREAD, role: "super_admin", isAdmin: true, tenant_id: CALLER_TENANT },
  });
  assert("25.9 a caller-supplied role/isAdmin in the body cannot admit a denied caller (server-derived)",
    !readinessRan(spoof) && refused(spoof), JSON.stringify({ readiness: readinessRan(spoof), refused: refused(spoof) }));

  // 25.12–25.14 — C0a, "ADMIN IS A TENANT ROLE" (owner ruling 2026-10-04). The gate asks the canonical
  // tenant question (studio_role_ok: an owner/admin seat in the ACTIVE workspace, or the agency managing
  // it) AND that the active workspace is the one PAIGE is acting in — never the global `admin` row.
  const otherWorkspace = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
  const adminElsewhere = await driveGate("admin", "comms_connection_summary", {
    rpcOverrides: { ...commsRpcs, studio_role_ok: { data: false, error: null } },
  });
  assert("25.12 an admin of ANOTHER workspace (global admin row, no seat here) is DENIED — the §59 trap closed",
    !readinessRan(adminElsewhere) && refused(adminElsewhere),
    JSON.stringify({ readiness: readinessRan(adminElsewhere), refused: refused(adminElsewhere) }));
  const seatedOwner = await driveGate(null, "comms_connection_summary", {
    rpcOverrides: { ...commsRpcs, studio_role_ok: { data: true, error: null } },
  });
  assert("25.13 this workspace's owner with NO global role is ADMITTED",
    readinessRan(seatedOwner) && !refused(seatedOwner),
    JSON.stringify({ readiness: readinessRan(seatedOwner), refused: refused(seatedOwner) }));
  const seatElsewhere = await driveGate(null, "comms_connection_summary", {
    rpcOverrides: { ...commsRpcs, studio_role_ok: { data: true, error: null }, current_user_tenant_id: { data: otherWorkspace, error: null } },
  });
  assert("25.14 a seat in a DIFFERENT workspace than the one PAIGE is acting in does not admit",
    !readinessRan(seatElsewhere) && refused(seatElsewhere),
    JSON.stringify({ readiness: readinessRan(seatElsewhere), refused: refused(seatElsewhere) }));
  // 25.15 — the verdict is about the ACTING workspace, asked once and explicitly (Codex P1, PR #1697).
  // Before: `studio_role_ok` answered for whichever workspace was active when it ran, read in parallel
  // with the active workspace, so a switch between the two reads could pair workspace A's admin verdict
  // with workspace B's identity. Modelled directly: the active-workspace answer says admin, the
  // explicit question about the workspace PAIGE acts in says no. The old code admitted this caller.
  const raced = await driveGate(null, "comms_connection_summary", {
    rpcOverrides: { ...commsRpcs, studio_role_ok: { data: true, error: null }, is_tenant_admin_as: { data: false, error: null } },
  });
  assert("25.15 an admin verdict for some OTHER active workspace never admits — the acting workspace is asked explicitly",
    !readinessRan(raced) && refused(raced),
    JSON.stringify({ readiness: readinessRan(raced), refused: refused(raced), asked: raced.rec.rpc.filter((c) => c.name === "is_tenant_admin_as").map((c) => c.args) }));

  // 25.10 / 25.11 — the honesty fix (Codex P2, 2026-09-05). A tenant-less super_admin (at rest,
  // before entering a workspace) is ADMITTED by the role gate but has no tenant. Before the guard,
  // comms_connection_summary / comms_registration_status called tenant_comms_readiness(), which
  // RAISEs COMMS_READINESS_NO_TENANT; that PostgREST error is a plain object, so the shared catch
  // surfaced "Unknown error" instead of the documented `tenant_not_resolved`. The `!crmTenantId`
  // guard now answers `tenant_not_resolved` BEFORE the RPC. Failing-first: without the guard the
  // readiness RPC runs and "Unknown error" reaches the model, so `!readinessRan` alone would fail.
  const tenantlessRpcs = {
    get_actor_access: { data: { tier: "tenant" }, error: null },
    // No workspace resolved — crmTenantId is null, exactly as the SQL current_user_tenant_id() is.
    get_paige_persona_context: { data: [{ tenant_id: null, tenant_name: null, playbook_config: null, playbook_slug: null, funding_enabled: false, brand: null }], error: null },
    // Simulate the SQL RAISE the real RPC makes when current_user_tenant_id() is null.
    tenant_comms_readiness: { data: null, error: { code: "42501", message: "COMMS_READINESS_NO_TENANT" } },
    list_tool_autonomy: { data: [], error: null },
  };
  const egressHas = (r, s) => JSON.stringify(r.modelEgress).includes(s);
  for (const [n, tool] of [["25.10", "comms_connection_summary"], ["25.11", "comms_registration_status"]]) {
    const r = await drive({
      stream: true,
      extraBody: { threadId: COMMS_THREAD },
      toolCall: { name: tool, args: {} },
      rpcOverrides: tenantlessRpcs,
      tablesExtra: { user_roles: () => [{ role: "super_admin" }] },
    });
    assert(`${n} a tenant-less super_admin gets tenant_not_resolved from ${tool}, not "Unknown error"`,
      !readinessRan(r) && egressHas(r, "tenant_not_resolved") && !egressHas(r, "Unknown error"),
      JSON.stringify({ readiness: readinessRan(r), tenant_not_resolved: egressHas(r, "tenant_not_resolved"), unknown_error: egressHas(r, "Unknown error") }));
  }
}

console.log("\nsigned Live runtime admission (real handler and real signed challenge)");
{
  const { createLiveRuntimeProof, liveRuntimeDigest, sameLiveRuntimeScope } = await import("../../supabase/functions/_shared/paige-live-runtime-proof.ts");
  const proof = createLiveRuntimeProof(LIVE_TEST_SIGNING_KEY);
  const threadId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
  const sessionId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
  const transcript = "Check my communication connection status.";
  const scope = { sessionId, tenantId: CALLER_TENANT, actorId: USER, threadId, epoch: "test-epoch", turnId: "test-turn" };
  const historyMarker = "Earlier authenticated conversation about this workspace.";
  // `ordinary` drives a Live turn that carries no protected evidence — no tool call, no memory — so its
  // answer streams live rather than being held for the final check (paige-turn, 26.5–26.6).
  const liveDrive = async ({ authority = { data: true, error: null }, scopeOverride = {}, bodyOverride = {}, failStreamCalls = [], breakStreamCalls = {}, ordinary = false, toolEnding = undefined } = {}) => {
    const issued = await proof.issue({ ...scope, ...scopeOverride }, transcript);
    const session = { id: sessionId, tenant_id: issued.scope.tenantId, actor_user_id: issued.scope.actorId,
      thread_id: threadId, context_epoch: issued.scope.epoch, availability: "LIVE", state: "thinking",
      provider_session_ref: `runtime:${await liveRuntimeDigest(issued.token)}` };
    let claims = 0;
    const initialRef = session.provider_session_ref;
    const matches = (row, filters) => filters.every(([op, key, value]) =>
      op === "eq" ? row[key] === value : op === "in" ? value.includes(row[key]) : true);
    const result = await drive({
      text: transcript, stream: true, failStreamCalls, breakStreamCalls,
      extraBody: { threadId, liveRuntimeChallenge: issued.token, ...bodyOverride },
      toolCall: ordinary ? undefined : { name: "comms_connection_summary", args: {}, ...(toolEnding ? { ending: toolEnding } : {}) },
      replyText: ordinary ? "Your connection is set up." : undefined,
      rpcOverrides: {
        ...(ordinary ? { match_paige_memory: { data: [], error: null } } : {}),
        paige_live_pilot_authorized_internal: authority,
        get_actor_access: { data: { tier: "tenant" }, error: null },
        get_paige_persona_context: { data: [{ tenant_id: CALLER_TENANT, tenant_name: "T", playbook_config: null,
          playbook_slug: null, funding_enabled: false, brand: null }], error: null },
        tenant_comms_readiness: { data: { can_send_sms: false, blocked_reason: null, number: "absent", number_e164: null, a2p: "absent" }, error: null },
        list_tool_autonomy: { data: [], error: null },
      },
      tablesExtra: {
        ...(ordinary ? { client_memory: () => [] } : {}),
        user_roles: () => [{ role: "admin" }],
        paige_chat_threads: (filters) => {
          const row = { id: threadId, tenant_id: CALLER_TENANT, caller_user_id: USER, contact_id: null };
          return matches(row, filters) ? [row] : [];
        },
        paige_chat_turns: () => [{ role: "user", content: historyMarker, seq: 1 }],
      },
      serviceTablesExtra: {
        ...(ordinary ? { client_memory: () => [] } : {}),
        paige_live_tenant_availability: (filters) => {
          const row = { tenant_id: CALLER_TENANT, enabled: true };
          return matches(row, filters) ? [row] : [];
        },
        paige_live_sessions: (filters) => {
          if (!matches(session, filters)) return [];
          const update = filters.find(([op]) => op === "update")?.[1];
          if (update) { claims += 1; Object.assign(session, update); }
          return [{ ...session }];
        },
      },
    });
    return { ...result, claims, session, initialRef, issued };
  };
  const authorized = await liveDrive();
  const authorityCalls = (r) => r.rec.rpc.filter((c) => c.name === "paige_live_pilot_authorized_internal");
  assert("26.1 literal true admits the signed Live request and consumes its challenge once",
    authorized.status === 200 && authorized.claims === 1 && authorized.session.provider_session_ref === null,
    JSON.stringify({ status: authorized.status, claims: authorized.claims, logged: authorized.logged }));
  assert("26.2 authorization uses the authenticated actor and canonical tenant on the service boundary",
    authorityCalls(authorized).length === 1 && authorityCalls(authorized).every((c) => c.client === "service" &&
      c.args._actor_user_id === USER && c.args._tenant_id === CALLER_TENANT), JSON.stringify(authorityCalls(authorized)));
  assert("26.3 admitted Live reads stored history, reaches the model, and executes the read tool",
    authorized.rec.from.some((c) => c.table === "paige_chat_turns") &&
      authorized.modelEgress.some((body) => body.includes(historyMarker)) &&
      authorized.rec.rpc.some((c) => c.name === "tenant_comms_readiness"), JSON.stringify(authorized.logged));
  const tokens = authorized.bodyText.split("\n").flatMap((line) => {
    if (!line.startsWith("data: ")) return [];
    try { const value = JSON.parse(line.slice(6)); return value.paige_live_output ? [value.paige_live_output] : []; } catch { return []; }
  });
  const output = await Promise.all(tokens.map((token) => proof.readOutput(token)));
  assert("26.4 admitted response carries valid signed output through completion for the issued scope",
    output.some((frame) => frame?.kind === "done") && output.every((frame) => frame && sameLiveRuntimeScope(frame.scope, authorized.issued.scope)),
    JSON.stringify({ status: authorized.status, outputKinds: output.map((frame) => frame?.kind), logged: authorized.logged }));

  // paige-turn — WHERE A LIVE TURN'S TERMINAL GOES. A Live answer streams from the tools-free closing
  // call, so on an ORDINARY turn (nothing held) its terminal waits for the first answer line actually
  // forwarded. The closing call is the turn's LAST streamed model call (read from a drive that
  // answered, never hard-coded), and it carries no tools — which is what makes it the closing call.
  // The Live output stream errors by design when a turn ends without its signed `done`, so a failed
  // turn is read from what reached the wire before that error (`partialText`) — what the client had.
  const turnFrames = (text) => text.split("\n").filter((l) => l.startsWith("data: ") && l.includes('"paige_turn"'))
    .map((l) => JSON.parse(l.slice(6)).paige_turn);
  const terminalStates = (text) => turnFrames(text).filter((t) => t.event !== "started").map((t) => t.state).join();
  const streamedCalls = (r) => r.modelEgress.map((b) => { try { return JSON.parse(b); } catch { return {}; } }).filter((b) => b.stream === true);
  const answered = await liveDrive({ ordinary: true });
  const closingCall = streamedCalls(answered).length;
  const firstAnswer = answered.bodyText.indexOf('"choices"');
  assert("26.5 an ordinary Live answer says FINAL once, just ahead of its first answer line (the control for 26.6)",
    answered.status === 200 && !answered.logged.some((l) => l.msg.includes("protected evidence reached the model"))
      && closingCall >= 2 && !("tools" in (streamedCalls(answered)[closingCall - 1] ?? {}))
      && terminalStates(answered.bodyText) === "FINAL" && firstAnswer !== -1
      && answered.bodyText.indexOf('"FINAL"') < firstAnswer && answered.bodyText.includes("Your connection is set up."),
    JSON.stringify({ status: answered.status, closingCall, turns: turnFrames(answered.bodyText), body: answered.bodyText.slice(0, 500) }));
  const unanswered = await liveDrive({ ordinary: true, failStreamCalls: [closingCall] });
  const wire = unanswered.partialText;
  assert("26.6 an ordinary Live turn whose closing call fails ends INTERRUPTED on the wire — never first FINAL — before the Live error frame",
    unanswered.status === 200 && wire.includes("paige_live_error") && terminalStates(wire) === "INTERRUPTED"
      && !wire.includes('"FINAL"') && wire.indexOf('"INTERRUPTED"') < wire.indexOf("paige_live_error"),
    JSON.stringify({ status: unanswered.status, turns: turnFrames(wire), body: wire.slice(0, 600) }));
  // …and the same failure on a PROTECTED Live turn (its tool result is evidence, so it holds) ends the
  // same way: there the terminal waits for release, which a failed answer never reaches.
  const heldUnanswered = await liveDrive({ failStreamCalls: [streamedCalls(authorized).length] });
  assert("26.7 a protected Live turn whose closing call fails also ends INTERRUPTED, before the Live error frame",
    terminalStates(heldUnanswered.partialText) === "INTERRUPTED" && !heldUnanswered.partialText.includes('"FINAL"')
      && heldUnanswered.partialText.indexOf('"INTERRUPTED"') < heldUnanswered.partialText.indexOf("paige_live_error"),
    JSON.stringify({ turns: turnFrames(heldUnanswered.partialText) }));
  // The closing call answers 200 and then BREAKS before any text. `_shared/claude.ts`'s translator always
  // sends a synthetic role-only line first and ends a broken stream with a clean [DONE], so a terminal
  // sent on the first FORWARDED line would put FINAL on the wire with no answer behind it. It waits for
  // the first answer TEXT instead, so this turn ends INTERRUPTED, never first FINAL.
  const brokeEarly = await liveDrive({ ordinary: true, breakStreamCalls: { [closingCall]: "" } });
  const brokeWire = brokeEarly.partialText;
  assert("26.8 an ordinary Live turn whose closing call answers 200 then breaks before any text ends INTERRUPTED — no FINAL — before the Live error frame",
    brokeEarly.status === 200 && brokeWire.includes("paige_live_error") && terminalStates(brokeWire) === "INTERRUPTED"
      && !brokeWire.includes('"FINAL"') && brokeWire.indexOf('"INTERRUPTED"') < brokeWire.indexOf("paige_live_error")
      && streamedCalls(brokeEarly).length === closingCall,
    JSON.stringify({ status: brokeEarly.status, turns: turnFrames(brokeWire), body: brokeWire.slice(0, 600) }));
  // 26.9 INT-334 (R7) — a Live tool round that never finished (here: its token limit) runs nothing. The read
  // tool is never executed, the tools-free closing call is told the step did not run, and the turn ends
  // INTERRUPTED — never FINAL — however the closing answer reads.
  const liveCut = await liveDrive({ toolEnding: "max_tokens" });
  const liveClosing = streamedCalls(liveCut).at(-1);
  assert("26.9 a Live tool round cut at its token limit runs nothing; the closing call is told the step did not run; the turn ends INTERRUPTED",
    liveCut.status === 200 && !liveCut.rec.rpc.some((c) => c.name === "tenant_comms_readiness")
      && !("tools" in (liveClosing ?? {})) && JSON.stringify(liveClosing ?? {}).includes("so it did NOT run")
      && terminalStates(liveCut.bodyText || liveCut.partialText || "").includes("INTERRUPTED")
      && !terminalStates(liveCut.bodyText || liveCut.partialText || "").includes("FINAL"),
    JSON.stringify({ status: liveCut.status, rpc: liveCut.rec.rpc.map((c) => c.name), turns: turnFrames(liveCut.bodyText || liveCut.partialText || ""), calls: streamedCalls(liveCut).length }));

  for (const [name, options, reachesAuthority] of [
    ["false authorization", { authority: { data: false, error: null } }, true],
    ["missing authorization", { authority: { data: null, error: null } }, true],
    ["errored authorization even with true data", { authority: { data: true, error: { message: "unavailable" } } }, true],
    ["nonboolean authorization", { authority: { data: "true", error: null } }, true],
    ["another signed actor", { scopeOverride: { actorId: FOREIGN } }, false],
    ["another signed tenant", { scopeOverride: { tenantId: OTHER_TENANT } }, false],
    ["body-supplied identity cannot override authorization", { authority: { data: false, error: null },
      bodyOverride: { actorId: FOREIGN, user_id: FOREIGN, tenantId: OTHER_TENANT, tenant_id: OTHER_TENANT } }, true],
    // C4a (39.6) — a spoken turn still may not carry an approval, now that an approval RUNS on the
    // server rather than waiting for the model: speech never approves anything.
    ["a Live turn carrying an approval", { bodyOverride: { approvedConfirmations: ["a".repeat(16)] } }, false],
    ["a Live turn carrying a scoped approval token", { bodyOverride: { approvedConfirmations: [`${"b".repeat(16)}:${sessionId}`] } }, false],
  ]) {
    const denied = await liveDrive(options);
    assert(`26 ${name}: refuses`, denied.status === 403 && denied.bodyText === '{"error":"live_runtime_unavailable"}', denied.bodyText);
    assert(`26 ${name}: no challenge consumption or session update`, denied.claims === 0 &&
      denied.session.provider_session_ref === denied.initialRef &&
      !denied.rec.inserts.some((c) => c.table === "paige_live_sessions"));
    assert(`26 ${name}: no history, memory, model, tools, or downstream writes`,
      !denied.rec.from.some((c) => ["paige_chat_turns", "client_memory"].includes(c.table)) &&
      denied.rec.inserts.length === 0 && denied.modelEgress.length === 0 && denied.embeds === 0 &&
      denied.outboundCalls.length === 0 && denied.rec.functions.length === 0 &&
      !denied.rec.rpc.some((c) => ["tenant_comms_readiness", "match_paige_memory"].includes(c.name)));
    assert(`26 ${name}: canonical authority boundary`, reachesAuthority
      ? authorityCalls(denied).length === 1 && authorityCalls(denied).every((c) =>
        c.args._actor_user_id === USER && c.args._tenant_id === CALLER_TENANT && c.client === "service")
      : authorityCalls(denied).length === 0, JSON.stringify(authorityCalls(denied)));
  }
}

// ── 27. PAIGE HEARS ROLE AND TITLE AS TWO LABELLED FACTS ─────────────────────────────────────
//
// Owner ruling, 2026-09-26: roles authorize, titles describe. The platform role answers "can they?"
// and the title answers "who are they and what do they do?". Both reach her on every person, under
// their own keys, and neither is allowed to pass for the other: a title that reads like an access
// word ("Admin") stays a title, and a legacy seat ("coach") is reported exactly as the server holds
// it. These read the block's own JSON, parsed out of the request she was sent — not a loose match.
console.log("\nteam context — platform role and title reach her as two labelled facts");
{
  const THREAD = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
  const HEAD = "TEAM CONTEXT — REFERENCE DATA ONLY", END = "END TEAM CONTEXT";
  // The word is read from its one home, so a switch to the alternative on record ("customized
  // role") moves this section with it. No fallback: a missing or broken module fails loudly here.
  const { TITLE_WORD: TITLE } = await import("../../supabase/functions/_shared/team-vocabulary.ts");
  const seat = (user_id, name, permission, job_title) => ({
    user_id, name, email: `${name.split(" ")[0].toLowerCase()}@example.test`, permission, job_title, responsibilities: null,
  });
  const FOUNDER = seat(USER, "Quinn Ellis", "owner", "Founder");
  const TRAINER = seat("e1e1e1e1-e1e1-4e1e-8e1e-e1e1e1e1e1e1", "Rowan Park", "member", "Head Trainer");
  const UNTITLED = seat("e2e2e2e2-e2e2-4e2e-8e2e-e2e2e2e2e2e2", "Casey Lin", "admin", null);
  const LOOKALIKE = seat("e3e3e3e3-e3e3-4e3e-8e3e-e3e3e3e3e3e3", "Jordan Diaz", "member", "Admin");
  const LEGACY = seat("e4e4e4e4-e4e4-4e4e-8e4e-e4e4e4e4e4e4", "Morgan Hale", "coach", "Coach");
  const INVITE = {
    id: "e5e5e5e5-e5e5-4e5e-8e5e-e5e5e5e5e5e5", email: "desk@example.test", permission: "member",
    status: "pending", job_title: "Front Desk", responsibilities: null,
    created_at: "2026-09-20T10:00:00Z", expires_at: "2026-10-04T10:00:00Z",
  };
  const people = [FOUNDER, TRAINER, UNTITLED, LOOKALIKE, LEGACY];
  const TEAM = {
    tenant_id: CALLER_TENANT, tenant_name: "T", speaker: FOUNDER,
    member_count: people.length, truncated: false, members: people,
    invitation_count: 1, invitations_truncated: false, invitations: [INVITE],
  };
  const teamTurn = (payload) => drive({
    stream: true, extraBody: { threadId: THREAD },
    rpcOverrides: {
      get_actor_access: { data: { tier: "tenant" }, error: null },
      get_paige_persona_context: { data: [{ tenant_id: CALLER_TENANT, tenant_name: "T", playbook_config: null, playbook_slug: null, funding_enabled: false, brand: null }], error: null },
      get_paige_team_context: { data: payload, error: null },
    },
  });
  // Every string in every request body, found by PARSING the body, then each block cut at its own
  // markers. The block's data is the single JSON line directly above END; the rest is her guidance.
  const strings = (v) => (typeof v === "string" ? [v] : v && typeof v === "object" ? Object.values(v).flatMap(strings) : []);
  const blocksIn = (r) => r.modelEgress
    .flatMap((body) => { try { return strings(JSON.parse(body)); } catch { return []; } })
    .flatMap((s) => {
      const found = [];
      for (let at = s.indexOf(HEAD); at !== -1; at = s.indexOf(HEAD, at + HEAD.length)) {
        const end = s.indexOf(END, at);
        if (end !== -1) found.push(s.slice(at, end).trimEnd());
      }
      return found;
    });
  const dataOf = (block) => { try { return JSON.parse(block.split("\n").pop()); } catch { return null; } };
  const guidanceOf = (block) => block.split("\n").slice(0, -1).join("\n");
  const has = (o, k) => !!o && typeof o === "object" && Object.prototype.hasOwnProperty.call(o, k);
  const teamRead = (r) => r.rec.rpc.some((c) => c.name === "get_paige_team_context");

  const turn = await teamTurn(TEAM);
  const blocks = blocksIn(turn);
  const team = blocks.length ? dataOf(blocks[0]) : null;
  const entry = (id) => team?.confirmed_active_members?.find((m) => m?.user_id === id) ?? null;

  assert("27.0 the team read is actually made and its block reaches the turn (guards this section)",
    teamRead(turn) && blocks.length > 0 && !!team,
    JSON.stringify({ read: teamRead(turn), blocks: blocks.length, parsed: !!team }));

  // ── 27.1 TWO LAYERS, ONE ENTRY. Kills: folding the title into the role (or the reverse), dropping
  // either key, or attaching one person's title to another person's entry.
  const misread = people.filter((p) => {
    const e = entry(p.user_id);
    return !(has(e, "platform_role") && has(e, TITLE) && e.platform_role === p.permission && e[TITLE] === p.job_title);
  });
  const speaker = team?.speaker ?? null;
  assert("27.1 every person's platform_role and title reach the turn as separate keys on the same entry",
    !!team && misread.length === 0 && has(speaker, "platform_role") && has(speaker, TITLE)
      && speaker.platform_role === "owner" && speaker[TITLE] === "Founder",
    JSON.stringify({ misread: misread.map((p) => ({ sent: [p.permission, p.job_title], got: entry(p.user_id) })), speaker }));

  // ── 27.2 An unset title is still a fact she is handed. Kills: omitting the key when it is empty,
  // which leaves her to guess whether the person has no title or the title was never sent.
  const untitled = entry(UNTITLED.user_id);
  assert("27.2 an admin with no title still carries the title key, as null — both layers always reach her",
    has(untitled, TITLE) && untitled[TITLE] === null && untitled.platform_role === "admin",
    JSON.stringify(untitled));

  // ── 27.3 A title spelled like an access level grants nothing. Kills: reading "Admin" as the role.
  const lookalike = entry(LOOKALIKE.user_id);
  assert("27.3 a title that reads like an access word stays a title: \"Admin\" is still a member",
    lookalike?.platform_role === "member" && lookalike?.[TITLE] === "Admin",
    JSON.stringify(lookalike));

  // ── 27.4 The role is reported as enforced, never tidied. Kills: mapping a legacy value onto the
  // current three, or moving it into the title because it reads like a job. The cases differ on
  // purpose, so a copy in either direction shows.
  const legacy = entry(LEGACY.user_id);
  assert("27.4 a legacy seat reports platform_role \"coach\" exactly as enforced, and its title separately",
    legacy?.platform_role === "coach" && legacy?.[TITLE] === "Coach",
    JSON.stringify(legacy));

  const invite = team?.team_invitations?.find((i) => i?.invitation_id === INVITE.id) ?? null;
  assert("27.5 an invitation carries proposed_platform_role and its title as separate keys",
    has(invite, "proposed_platform_role") && has(invite, TITLE) && invite.proposed_platform_role === "member"
      && invite[TITLE] === "Front Desk" && invite.invitation_status === "pending",
    JSON.stringify(invite));

  // ── 27.6 The guidance, not the data: a tenant-authored string in the JSON cannot satisfy this.
  const guidance = blocks.length ? guidanceOf(blocks[0]) : "";
  assert("27.6 she is told a title never decides access, and to ask once when an instruction could mean either",
    guidance.includes("never decides access") && guidance.includes("ask once"),
    JSON.stringify({ neverDecidesAccess: guidance.includes("never decides access"), askOnce: guidance.includes("ask once") }));

  // ── 27.7 ONE VOCABULARY. Kills: a half-renamed block, where the prose says one word and the data
  // another, or where an old key survives beside its replacement.
  const stale = blocks.flatMap((b) => b.match(/\b(?:enforced_permission|proposed_permission|job_title)\b/g) ?? []);
  assert("27.7 the old keys enforced_permission / proposed_permission / job_title are gone from the block",
    blocks.length > 0 && stale.length === 0,
    JSON.stringify(blocks.length ? [...new Set(stale)] : "no block to inspect"));

  // ── 27.8 FAIL CLOSED. A payload for another tenant renders nothing, not a partial block. The read
  // and the model call are both required, so an absent block cannot pass by the turn never running.
  const foreign = await teamTurn({ ...TEAM, tenant_id: OTHER_TENANT });
  const leaked = foreign.modelEgress.some((b) => b.includes(HEAD) || b.includes("Head Trainer")) || blocksIn(foreign).length > 0;
  assert("27.8 a team payload for ANOTHER tenant produces no team block at all",
    teamRead(foreign) && foreign.modelEgress.length > 0 && !leaked,
    JSON.stringify({ read: teamRead(foreign), egress: foreign.modelEgress.length, leaked }));
}

// ── 28. THE TEAM TOOLS AND THE CARD A PERSON APPROVES SAY "TITLE" ─────────────────────────────
//
// Owner ruling: owner, admin and member are the only roles; everything else people call each other
// is a title, and the word is "title", not "job title" or "customized role". Section 27 proves the
// block PAIGE reads. This proves the rest of what reaches a person or steers her: the card the owner
// approves before a title is saved, the team tools' descriptions, and what the executed tools hand
// back to her. The word is read from its one home, so these move with it.
console.log("\nteam tools — the approval card, the tool descriptions and the results say title");
{
  const { TITLE_WORD: TITLE } = await import("../../supabase/functions/_shared/team-vocabulary.ts");
  const THREAD = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
  const MEMBER = "e6e6e6e6-e6e6-4e6e-8e6e-e6e6e6e6e6e6";
  const ROSTER = {
    tenant_id: CALLER_TENANT, tenant_name: "T", viewer_permission: "owner",
    members: [{ user_id: MEMBER, full_name: "Rowan Park", email: "rowan@example.test", permission: "member",
      is_owner: false, job_title: "Trainer", responsibilities: "Mornings" }],
    invitations: [],
  };
  const frames = (r) => r.bodyText.split("\n").filter((l) => l.startsWith("data: ") && l !== "data: [DONE]")
    .map((l) => { try { return JSON.parse(l.slice(6)); } catch { return null; } }).filter(Boolean);
  const cardOf = (r) => frames(r).find((f) => f.paige_confirm)?.paige_confirm;
  // What an executed tool handed back to her: the tool-result strings in the follow-up request,
  // found by parsing, never by matching the whole request (which also carries the call's own
  // arguments, whose key is job_title on purpose, and other tools' descriptions).
  const strings = (v) => (typeof v === "string" ? [v] : v && typeof v === "object" ? Object.values(v).flatMap(strings) : []);
  const toolResults = (r) => r.modelEgress
    .flatMap((b) => { try { return strings(JSON.parse(b)); } catch { return []; } })
    .flatMap((str) => { try { const v = JSON.parse(str); return v && typeof v === "object" && v.success === true ? [v] : []; } catch { return []; } });
  // The persona resolves this workspace, so the card names the person (the card an owner normally
  // sees) and the team seam's workspace check passes. Without it every card reads "that teammate".
  const TEAM_RPC = {
    resolve_tool_autonomy: { data: "confirm", error: null },
    get_actor_access: { data: { tier: "tenant" }, error: null },
    get_paige_persona_context: { data: [{ tenant_id: CALLER_TENANT, tenant_name: "T", playbook_config: null, playbook_slug: null, funding_enabled: false, brand: null }], error: null },
    get_solo_team_workspace: { data: ROSTER, error: null },
    set_solo_team_member_work_profile: { data: { job_title: "Head Trainer", responsibilities: "Runs the morning classes" }, error: null },
    set_solo_team_member_permission: { data: null, error: null },
  };
  const teamDrive = (store, name, args, body = {}) => drive({
    stream: true, extraBody: { threadId: THREAD, ...body }, classification: null,
    toolCall: { name, args: { member_user_id: MEMBER, ...args } },
    rpcOverrides: TEAM_RPC,
    tablesExtra: { paige_pending_confirmations: store.table, user_roles: [{ role: "admin" }] },
    onInsert: mirrorConfirms(store),
  });

  const titledStore = makeConfirmStore();
  const titled = await teamDrive(titledStore, "team_set_work_profile", { job_title: "Head Trainer", responsibilities: "Runs the morning classes" });
  const titledCard = cardOf(titled);
  assert(`28.1 the approval card names the person and their new ${TITLE} with the shared word, never "job title"`,
    titledCard?.tool === "team_set_work_profile"
      && titledCard.summary.startsWith(`Save work details for Rowan Park (rowan@example.test): ${TITLE} "Head Trainer",`)
      && !/job title/i.test(titledCard.summary),
    JSON.stringify(titledCard));

  const cleared = await teamDrive(makeConfirmStore(), "team_set_work_profile", { job_title: "", responsibilities: "Mornings" });
  const clearedCard = cardOf(cleared);
  assert(`28.2 clearing it reads "no ${TITLE}" on the named card`,
    !!clearedCard && clearedCard.summary.startsWith(`Save work details for Rowan Park (rowan@example.test): no ${TITLE},`)
      && !/job title/i.test(clearedCard.summary),
    JSON.stringify(clearedCard));

  const longTitle = "A".repeat(130);
  const longCard = cardOf(await teamDrive(makeConfirmStore(), "team_set_work_profile", { job_title: longTitle, responsibilities: "Mornings" }));
  assert(`28.3 a ${TITLE} too long to show is marked as cut, never silently shortened`,
    !!longCard && longCard.summary.includes(`${TITLE} "${"A".repeat(120)}…" (showing the first 120 of 130 characters)`),
    JSON.stringify(longCard?.summary?.slice(0, 80)));

  // The tool list PAIGE is handed, parsed out of the request body rather than matched loosely.
  const toolsSent = titled.modelEgress.flatMap((body) => {
    try { const parsed = JSON.parse(body); return Array.isArray(parsed.tools) ? parsed.tools : []; } catch { return []; }
  });
  const tool = (name) => toolsSent.find((t) => (t.name ?? t.function?.name) === name);
  const descriptionOf = (t) => t?.description ?? t?.function?.description ?? "";
  const argOf = (t, key) => (t?.input_schema ?? t?.parameters ?? t?.function?.parameters)?.properties?.[key]?.description ?? "";
  const profileTool = tool("team_set_work_profile");
  assert(`28.4 the work-details tool she is handed says "${TITLE}" in its description and its argument`,
    descriptionOf(profileTool).includes(`a teammate's ${TITLE} and/or responsibilities`)
      && argOf(profileTool, "job_title").startsWith(`Their ${TITLE}, 120 characters`)
      && !/job title/i.test(descriptionOf(profileTool) + argOf(profileTool, "job_title")),
    JSON.stringify({ found: !!profileTool, arg: argOf(profileTool, "job_title") }));

  const inviteTool = tool("team_invite_member");
  assert(`28.5 the invitation tool's argument says "${TITLE}", so she does not echo its key back`,
    argOf(inviteTool, "job_title").startsWith(`Optional. Their ${TITLE}: what they will be called.`),
    JSON.stringify({ found: !!inviteTool, arg: argOf(inviteTool, "job_title") }));

  const permissionTool = tool("team_set_permission");
  assert(`28.6 the permission tool sends a ${TITLE} change to the work-details tool in the product's word`,
    descriptionOf(permissionTool).includes(`change someone's ${TITLE}, that is team_set_work_profile`)
      && !/job title|describe someone's job/i.test(descriptionOf(permissionTool)),
    JSON.stringify({ found: !!permissionTool }));

  // The argument KEY stays job_title on purpose: approvals already queued carry it, and renaming it
  // would break them for nothing a person sees. The word is the product's; the key is internal.
  assert("28.7 the argument key stays job_title, so approvals already queued still match",
    !!(profileTool?.input_schema ?? profileTool?.parameters ?? profileTool?.function?.parameters)?.properties?.job_title,
    JSON.stringify(Object.keys((profileTool?.input_schema ?? profileTool?.parameters ?? {}).properties ?? {})));

  // Executed, not proposed: approve the card and read what the tool hands back to her.
  const profileArgs = { job_title: "Head Trainer", responsibilities: "Runs the morning classes" };
  const saved = await teamDrive(titledStore, "team_set_work_profile", { ...profileArgs, confirm: true },
    { approvedConfirmations: [titledCard?.fingerprint] });
  const savedResult = toolResults(saved).find((v) => v.member_user_id === MEMBER && "responsibilities" in v);
  assert(`28.8 the saved work details come back to her under "${TITLE}", the key the team block uses`,
    savedResult?.[TITLE] === "Head Trainer" && !("job_title" in savedResult),
    JSON.stringify(savedResult ?? null));

  const permissionStore = makeConfirmStore();
  const permissionArgs = { permission: "admin" };
  const proposedAccess = cardOf(await teamDrive(permissionStore, "team_set_permission", permissionArgs));
  const changedAccess = await teamDrive(permissionStore, "team_set_permission", { ...permissionArgs, confirm: true },
    { approvedConfirmations: [proposedAccess?.fingerprint] });
  const accessResult = toolResults(changedAccess).find((v) => v.member_user_id === MEMBER && v.permission === "admin");
  assert(`28.9 after an access change she is told their ${TITLE} is untouched, in the shared word`,
    accessResult?.note === `Access changed. Their ${TITLE} and responsibilities are untouched.`,
    JSON.stringify({ card: !!proposedAccess, result: accessResult ?? null }));
}

// ── 29. WHAT SHE SAYS IS READ FOR INTERNAL TEXT, WITH A VOCABULARY TAKEN FROM WHAT SHE WAS SENT ──
//
// "Nothing internal reaches a customer" needs a detector that knows what internal IS on that turn,
// and a harness that can make her say something other than "ok". This drives a real, approved team
// turn with a scripted reply and reads it with `_shared/internal-vocabulary.ts`, whose vocabulary is
// derived from the final request the handler sent the model: its tool definitions, its system text
// and the tool result. Never from the user's own words or the model's own turns.
//
// THE HONEST LIMIT, restated where the proof is: this catches known internal vocabulary, not a
// paraphrase. And today nothing acts on a finding — 29.5 records that a leaky reply still streams
// unchanged. The slices that hold or rewrite a reply (portal chat, drafts, owner chat) turn 29.5
// around; this section is the instrument they will be proven with.
console.log("\ninternal text — the detector reads her reply with a vocabulary derived from what she was sent");
{
  const { deriveInternalVocabulary, findInternalLeaks } = await import("../../supabase/functions/_shared/internal-vocabulary.ts");
  const { buildTenantTeamContextBlock } = await import("../../supabase/functions/_shared/team-context.ts");
  const THREAD = "abababab-abab-4bab-8bab-abababababab";
  const MEMBER = "e7e7e7e7-e7e7-4e7e-8e7e-e7e7e7e7e7e7";
  // A tenant-authored title and responsibilities that LOOK like identifiers, on purpose: the team
  // block and the roster both carry them, and neither may make them "internal".
  const seat = (user_id, name, permission, job_title, responsibilities = null) => ({
    user_id, name, email: `${name.split(" ")[0].toLowerCase()}@example.test`, permission, job_title, responsibilities,
  });
  const FOUNDER = seat(USER, "Quinn Ellis", "owner", "Founder");
  const OPS = seat(MEMBER, "Rowan Park", "member", "ops_lead", "Runs the vip_plan intake");
  const TEAM = {
    tenant_id: CALLER_TENANT, tenant_name: "T", speaker: FOUNDER, member_count: 2, truncated: false,
    members: [FOUNDER, OPS], invitation_count: 0, invitations_truncated: false, invitations: [],
  };
  const ROSTER = {
    tenant_id: CALLER_TENANT, tenant_name: "T", viewer_permission: "owner", invitations: [],
    members: [{ user_id: MEMBER, full_name: "Rowan Park", email: "rowan@example.test", permission: "member",
      is_owner: false, job_title: "ops_lead", responsibilities: "Runs the vip_plan intake" }],
  };
  const RPC = {
    resolve_tool_autonomy: { data: "confirm", error: null },
    get_actor_access: { data: { tier: "tenant" }, error: null },
    get_paige_persona_context: { data: [{ tenant_id: CALLER_TENANT, tenant_name: "T", playbook_config: null, playbook_slug: null, funding_enabled: false, brand: null }], error: null },
    get_paige_team_context: { data: TEAM, error: null },
    get_solo_team_workspace: { data: ROSTER, error: null },
    set_solo_team_member_work_profile: { data: { job_title: "Head Trainer", responsibilities: "Runs the morning classes" }, error: null },
  };
  const ARGS = { member_user_id: MEMBER, job_title: "Head Trainer", responsibilities: "Runs the morning classes" };
  const frames = (r) => r.bodyText.split("\n").filter((l) => l.startsWith("data: ") && l !== "data: [DONE]")
    .map((l) => { try { return JSON.parse(l.slice(6)); } catch { return null; } }).filter(Boolean);
  // What the person receives: the streamed answer text, frame by frame, joined.
  const replyOf = (r) => frames(r).map((f) => f.choices?.[0]?.delta?.content).filter((c) => typeof c === "string").join("");
  // What the server sent the model on the turn that produced the answer: the LAST request. Keys and
  // block names come only from text the server VOUCHES it wrote end to end, never from the whole system
  // prompt, which also carries the tenant's persona. The one block vouched here is the team block,
  // rebuilt with the real builder from the same fixture and required to appear verbatim in what she was
  // sent: its prose is platform code and every tenant string in it is a JSON value
  // (_shared/team-context.ts, buildTenantTeamContextBlock).
  const TEAM_BLOCK = buildTenantTeamContextBlock(TEAM, CALLER_TENANT);
  const sentOf = (r) => {
    const last = (() => { try { return JSON.parse(r.modelEgress.at(-1) ?? "null"); } catch { return null; } })();
    const system = typeof last?.system === "string" ? [last.system]
      : Array.isArray(last?.system) ? last.system.map((b) => b?.text ?? "") : [];
    const toolResults = (last?.messages ?? []).flatMap((m) => Array.isArray(m.content)
      ? m.content.filter((c) => c?.type === "tool_result")
        .map((c) => typeof c.content === "string" ? c.content : (c.content ?? []).map((b) => b?.text ?? "").join("\n"))
      : []);
    const vouchedTexts = system.some((text) => text.includes(TEAM_BLOCK)) ? [TEAM_BLOCK] : [];
    return { tools: last?.tools ?? [], vouchedTexts, toolResults, system };
  };

  // Propose, approve, and let the approved turn end in a scripted answer.
  const store = makeConfirmStore();
  const turn = (args, body, replyText) => drive({
    stream: true, extraBody: { threadId: THREAD, ...body }, classification: null,
    toolCall: { name: "team_set_work_profile", args }, rpcOverrides: RPC,
    tablesExtra: { paige_pending_confirmations: store.table, user_roles: [{ role: "admin" }] },
    onInsert: mirrorConfirms(store), replyText,
  });
  const card = frames(await turn(ARGS)).find((f) => f.paige_confirm)?.paige_confirm;
  const approvedTurn = (replyText) => turn({ ...ARGS, confirm: true }, { approvedConfirmations: [card?.fingerprint] }, replyText);

  // One planted leak per kind that can reach a chat answer, each in the words a leaky model uses.
  const LEAKY = [
    "Done — I called team_set_work_profile for Rowan.",
    "Their platform_role is still member.",
    "According to my TEAM CONTEXT, Rowan runs mornings.",
    `Saved to record ${MEMBER}.`,
    'If it fails you may see: new row violates row-level security policy for table "tenant_members".',
    "That setting lives in MMA OS.",
  ].join(" ");
  const CLEAN = [
    "Done — Rowan Park is now your Head Trainer, and still runs the vip_plan intake as ops_lead.",
    "Reach them at rowan@example.test or (415) 555-0132.",
    `Their booking page: https://book.example.test/s/${MEMBER}/intro_call`,
    "You have 3 clients and 5 tasks today; your team context is two trainers and a front desk.",
    "Their title describes the work; their access is member, and only you can change it.",
  ].join(" ");

  const leaky = await approvedTurn(LEAKY);
  const sent = sentOf(leaky);
  const vocabulary = deriveInternalVocabulary(sent);
  // INT-334 R5b — a deterministic resume's narration rounds carry the READ manifest (no mutating
  // defs), so the executed act's own name now reaches the model through the tool RESULT in the
  // conversation instead of the manifest. It is the one name this turn provably ran; add it so the
  // leak scan still treats a mention of it as derived, not internal.
  vocabulary.toolNames.add("team_set_work_profile");
  const leakyReply = replyOf(leaky);

  assert("29.0 the approved turn ran, the scripted answer reached the person verbatim, and the vocabulary came from the real request (guards this section)",
    !!card?.fingerprint && leakyReply === LEAKY && sent.vouchedTexts.length === 1
      && sent.toolResults.some((t) => t.includes('"member_user_id"'))
      && vocabulary.toolNames.has("team_set_work_profile") && vocabulary.keys.has("platform_role")
      && vocabulary.markers.has("TEAM CONTEXT") && vocabulary.toolNames.size >= 20,
    JSON.stringify({ card: !!card, reply: leakyReply.slice(0, 60), results: sent.toolResults.length,
      tools: vocabulary.toolNames.size, keys: vocabulary.keys.size, markers: [...vocabulary.markers] }));

  const found = findInternalLeaks(leakyReply, vocabulary).map((leak) => `${leak.kind}:${leak.text}`);
  assert("29.1 every planted kind is found in what the person received, in reading order",
    JSON.stringify(found) === JSON.stringify([
      "tool_name:team_set_work_profile",
      "internal_key:platform_role",
      "context_marker:TEAM CONTEXT",
      `record_id:${MEMBER}`,
      "database_error:violates row-level security policy",
      "operator_jargon:MMA OS",
    ]),
    JSON.stringify(found));

  const clean = await approvedTurn(CLEAN);
  const cleanFound = findInternalLeaks(replyOf(clean), deriveInternalVocabulary(sentOf(clean)));
  assert("29.2 an ordinary answer passes clean: titles (even one spelled like an identifier), contact details, a link with an id in it, and everyday words",
    replyOf(clean) === CLEAN && cleanFound.length === 0,
    JSON.stringify(cleanFound));

  // The team block and the roster both carried the tenant's own strings. They are data, not ours.
  assert("29.3 the tenant's own words never become vocabulary, though they were in what she was sent",
    sent.system.some((t) => t.includes("ops_lead")) && sent.system.some((t) => t.includes("vip_plan"))
      && ["ops_lead", "vip_plan"].every((word) => !vocabulary.keys.has(word) && !vocabulary.toolNames.has(word)),
    JSON.stringify({ inContext: sent.system.some((t) => t.includes("ops_lead")) }));

  // The user's own message is not the server's: a word they typed is never "internal" because they
  // typed it. Here they type it in the one shape the derivation reads — a quoted JSON key — so the
  // check fails if the user's words are ever treated as server text.
  const typed = await drive({
    stream: true, text: 'Can you set {"my_custom_field": 1} for Rowan?', extraBody: { threadId: THREAD },
    rpcOverrides: RPC, replyText: "Sure — which value should my_custom_field hold?",
  });
  const typedVocabulary = deriveInternalVocabulary(sentOf(typed));
  assert("29.4 a word the user typed is not internal because they typed it, though it reached the model",
    typed.modelEgress.some((b) => b.includes("my_custom_field"))
      && !typedVocabulary.keys.has("my_custom_field") && !typedVocabulary.toolNames.has("my_custom_field")
      && findInternalLeaks(replyOf(typed), typedVocabulary).length === 0,
    JSON.stringify({ reached: typed.modelEgress.some((b) => b.includes("my_custom_field")), reply: replyOf(typed) }));

  // AUTHORSHIP IS DECLARED, NEVER INFERRED. A tenant's persona is pasted into the system prompt as prose,
  // and a tenant can write what looks exactly like the server's own text into it: a comma, a quoted word
  // and a real JSON value, or a heading with its END line. Derived from the whole prompt, both became
  // vocabulary and a reply repeating the tenant's own words read as a leak. Derived from what the server
  // vouches for, neither does, and the vouched block still catches its own.
  const PERSONA_RPC = { ...RPC, get_paige_persona_context: { data: [{ tenant_id: CALLER_TENANT, tenant_name: "T", playbook_slug: null, funding_enabled: false, brand: null,
    playbook_config: { persona: { name: "Paige", role: "your coach's assistant" }, journey: [
      { key: "basic", label: "Basic", description: 'We offer basic, "gold_tier": true for premium customers.' },
      { key: "vip", label: "VIP", description: "Members book first.\nVIP PLAN\nPriority booking, every week.\nEND VIP PLAN" },
    ] } }], error: null } };
  const TENANT_WORDS = "Your gold_tier plan includes early booking — that's part of the VIP PLAN.";
  const persona = await drive({ stream: true, extraBody: { threadId: THREAD }, rpcOverrides: PERSONA_RPC, replyText: TENANT_WORDS });
  const personaSent = sentOf(persona);
  const wholePrompt = deriveInternalVocabulary({ tools: personaSent.tools, vouchedTexts: personaSent.system, toolResults: personaSent.toolResults });
  const personaVocabulary = deriveInternalVocabulary(personaSent);
  assert("29.6 CONTROL: the persona reached the model, and read as if the server wrote it, its words become vocabulary",
    personaSent.system.some((t) => t.includes('"gold_tier": true') && t.includes("END VIP PLAN"))
      && wholePrompt.keys.has("gold_tier") && wholePrompt.markers.has("VIP PLAN"),
    JSON.stringify({ keys: wholePrompt.keys.has("gold_tier"), markers: [...wholePrompt.markers] }));
  assert("29.7 derived from what the server vouches for, a tenant's persona words are never vocabulary, and repeating them is clean",
    !personaVocabulary.keys.has("gold_tier") && !personaVocabulary.markers.has("VIP PLAN")
      && findInternalLeaks(replyOf(persona), personaVocabulary).length === 0 && replyOf(persona) === TENANT_WORDS,
    JSON.stringify({ found: findInternalLeaks(replyOf(persona), personaVocabulary) }));

  // WHERE THINGS STAND, stated as a check so it cannot be forgotten: no filter exists on this path
  // yet, so the leaky answer streamed exactly as the model wrote it. The owner-chat slice flips this.
  assert("29.5 today the leaky answer streams unchanged — nothing on this path acts on a finding yet",
    leakyReply === LEAKY,
    leakyReply.slice(0, 80));
}

// ── 30. A CLIENT SEAT READS NOTHING THAT HAS NOT BEEN READ FIRST (R3) ─────────────────────────────
//
// A client is the person a business serves, signed in to that business's portal. Everything the model
// wrote that a client can read on a turn — the answer and each thought line — is read with the
// section-29 detector before release, on both release points (the agentic stream and the document
// stream). On a finding the whole turn is withheld and the client reads one fixed sentence, which
// invents no answer. An owner's turn is untouched here; that is R4's.
console.log("\nclient seat — her answer is read for internal text before a client can read it");
{
  const { withheldReplyForClient } = await import("../../supabase/functions/_shared/client-seat-reply.ts");
  const THREAD = "cdcdcdcd-cdcd-4dcd-8dcd-cdcdcdcdcdcd";
  const RECORD = "5a5a5a5a-5a5a-4a5a-8a5a-5a5a5a5a5a5a";
  const BUSINESS = "Northside Fitness";
  const PERSONA = { get_paige_persona_context: { data: [{ tenant_id: CALLER_TENANT, tenant_name: BUSINESS, playbook_config: null, playbook_slug: null, funding_enabled: false, brand: null }], error: null } };
  const AS_CLIENT = { ...PERSONA, get_actor_access: { data: { tier: "client" }, error: null } };
  const AS_OWNER = { ...PERSONA, get_actor_access: { data: { tier: "tenant" }, error: null } };
  const WITHHELD = withheldReplyForClient(BUSINESS);
  const frames = (r) => r.bodyText.split("\n").filter((l) => l.startsWith("data: ") && l !== "data: [DONE]")
    .map((l) => { try { return JSON.parse(l.slice(6)); } catch { return null; } }).filter(Boolean);
  const replyOf = (r) => frames(r).map((f) => f.choices?.[0]?.delta?.content).filter((c) => typeof c === "string").join("");
  const thoughtsOf = (r) => frames(r).filter((f) => f.paige_step?.kind === "thought").map((f) => f.paige_step.label);
  const personaCalls = (r) => r.rec.rpc.filter((c) => c.name === "get_paige_persona_context").length;
  const persisted = (r) => r.rec.rpc.filter((c) => c.name === "paige_chat_turn_append" && c.args?.p_role === "assistant").map((c) => c.args.p_content);

  // Each planted kind a client-seat turn can carry: a tool name from the definitions she was sent, a
  // record id, Postgres error text and the operator codename.
  const LEAKY_PARTS = [
    "Done, I ran update_client_data for you.",
    `Your record is ${RECORD}.`,
    'It said: new row violates row-level security policy for table "clients".',
    `That setting lives in ${["MMA", "OS"].join(" ")}.`,
  ];
  const LEAKY = LEAKY_PARTS.join(" ");
  const CLEAN = [
    `Thanks, Jordan. Your next session with ${BUSINESS} is Tuesday at 10am.`,
    "Reach the front desk at desk@northside.example or (415) 555-0132.",
    `Your booking page: https://book.example.test/s/${RECORD}/intro_call`,
    "You have 3 open tasks, and your coach's title is Head Trainer.",
  ].join(" ");

  // No memory on these two, so the owner's turn carries no evidence and is genuinely ordinary: the only
  // thing left to hold the client's is that it is a client's.
  const NO_MEMORY = { tablesExtra: { client_memory: () => [] }, serviceTablesExtra: { client_memory: () => [] } };
  const cleanClient = await drive({ stream: true, rpcOverrides: { ...AS_CLIENT, match_paige_memory: { data: [], error: null } }, replyText: CLEAN, ...NO_MEMORY });
  const cleanOwner = await drive({ stream: true, rpcOverrides: { ...AS_OWNER, match_paige_memory: { data: [], error: null } }, replyText: CLEAN, ...NO_MEMORY });
  assert("30.0 a clean answer reaches a client verbatim, and a client turn carrying no evidence pays no scope re-check, exactly as an owner's ordinary turn",
    replyOf(cleanClient) === CLEAN && personaCalls(cleanClient) === 1 && personaCalls(cleanOwner) === 1,
    JSON.stringify({ reply: replyOf(cleanClient).slice(0, 60), client: personaCalls(cleanClient), owner: personaCalls(cleanOwner) }));

  // HOLDING IS NOT EVIDENCE. A client turn is held so it can be read, but the scope re-check protects
  // retrieved evidence, so a lookup that fails after the turn began cannot refuse an ordinary client
  // answer. The control proves the re-check is still live: the same failing lookup on a client turn
  // that carries evidence (memory) is refused before the model is called.
  const flakyPersona = () => {
    let calls = 0;
    return { ...AS_CLIENT, get_paige_persona_context: () => (++calls === 1 ? PERSONA.get_paige_persona_context : { data: null, error: { message: "temporarily unavailable" } }) };
  };
  const flakyPlain = await drive({ stream: true, rpcOverrides: { ...flakyPersona(), match_paige_memory: { data: [], error: null } }, replyText: CLEAN, ...NO_MEMORY });
  const flakyEvidence = await drive({ stream: true, rpcOverrides: flakyPersona(), replyText: CLEAN });
  assert("30.30 a lookup that fails mid-turn does not refuse a client answer that carried no evidence (control: with evidence it still does)",
    flakyPlain.status === 200 && replyOf(flakyPlain) === CLEAN
      && flakyEvidence.status === 409 && flakyEvidence.bodyText.includes("ACTIVE_ACCOUNT_CHANGED") && !flakyEvidence.bodyText.includes(CLEAN),
    JSON.stringify({ plain: [flakyPlain.status, replyOf(flakyPlain).slice(0, 40)], evidence: [flakyEvidence.status, flakyEvidence.bodyText.slice(0, 80)] }));

  // A CLIENT TURN IS HELD BECAUSE IT IS A CLIENT'S, NOT BECAUSE IT CARRIES EVIDENCE. Every other leaky
  // client check drives the default fixture, whose memory is evidence and would hold the turn anyway.
  // This one carries none (the control: no scope re-check ran), and the leak is still withheld whole.
  const bareLeak = await drive({ stream: true, rpcOverrides: { ...AS_CLIENT, match_paige_memory: { data: [], error: null } }, replyText: LEAKY, ...NO_MEMORY });
  assert("30.31 a client turn that carries no evidence is still held and read: its leaky answer is withheld whole",
    personaCalls(bareLeak) === 1 && replyOf(bareLeak) === WITHHELD && !bareLeak.bodyText.includes(RECORD) && !bareLeak.bodyText.includes("update_client_data"),
    JSON.stringify({ lookups: personaCalls(bareLeak), reply: replyOf(bareLeak).slice(0, 60) }));

  // A CONFIRM CARD'S SUMMARY IS READ TOO. It names the fields the model asked to save, from the model's
  // own arguments, and it is held with the answer; unread, a clean answer would release it as written.
  // The control proves the card is built and released when its fields are ordinary.
  const CONFIRM_CLIENT = { ...AS_CLIENT, resolve_tool_autonomy: { data: "confirm", error: null } };
  const confirmsOf = (r) => frames(r).filter((f) => f.paige_confirm).map((f) => f.paige_confirm.summary);
  const plainCard = await drive({ stream: true, rpcOverrides: CONFIRM_CLIENT, toolCall: { name: "update_client_data", args: { updates: { phone: "(415) 555-0132" } } }, replyText: "I've asked you to confirm the change." });
  const leakyCard = await drive({ stream: true, rpcOverrides: CONFIRM_CLIENT, toolCall: { name: "update_client_data", args: { updates: { [`platform_role ${RECORD}`]: "x" } } }, replyText: "I've asked you to confirm the change." });
  assert("30.32 a confirm card whose summary carries internal text withholds the turn (control: an ordinary card is released with its answer)",
    confirmsOf(plainCard).some((c) => /\(phone\)/.test(c)) && replyOf(plainCard) === "I've asked you to confirm the change."
      && replyOf(leakyCard) === WITHHELD && confirmsOf(leakyCard).length === 0 && !leakyCard.bodyText.includes(RECORD),
    JSON.stringify({ plain: confirmsOf(plainCard), leaky: confirmsOf(leakyCard), reply: replyOf(leakyCard).slice(0, 50) }));

  const leakyClient = await drive({ stream: true, rpcOverrides: AS_CLIENT, replyText: LEAKY });
  const leaked = LEAKY_PARTS.filter((part) => leakyClient.bodyText.includes(part.split(" ").find((w) => /_|-|MMA|violates/.test(w)) ?? part));
  assert("30.1 a leaky answer never reaches a client: the client reads exactly the withheld sentence, and nothing of what was written",
    replyOf(leakyClient) === WITHHELD && leaked.length === 0
      && !leakyClient.bodyText.includes("update_client_data") && !leakyClient.bodyText.includes(RECORD)
      && !leakyClient.bodyText.includes("row-level security"),
    JSON.stringify({ reply: replyOf(leakyClient).slice(0, 80), leaked }));

  const leakyOwner = await drive({ stream: true, rpcOverrides: AS_OWNER, replyText: LEAKY });
  assert("30.2 an owner's turn is untouched by this: the same answer still streams to an owner as written (R4 owns that)",
    replyOf(leakyOwner) === LEAKY,
    replyOf(leakyOwner).slice(0, 80));

  const warned = leakyClient.logged.filter((l) => l.msg.includes("client-seat answer withheld"));
  assert("30.3 the finding is logged by kind and count, never by what was written",
    warned.length === 1 && /"tool_name":1/.test(warned[0].msg) && /"record_id":1/.test(warned[0].msg)
      && /"database_error":1/.test(warned[0].msg) && /"operator_jargon":1/.test(warned[0].msg)
      && !warned[0].msg.includes("update_client_data") && !warned[0].msg.includes(RECORD),
    JSON.stringify(warned.map((w) => w.msg)));

  // A THOUGHT LINE IS READ TOO. The existing thought filter drops a line with an identifier or a
  // record id in it, but Postgres error text in words passes it — so the thought, not the answer, is
  // what carries the leak here. The control proves this shape really does show a thought.
  const NARRATION_CLEAN = "Let me update your phone number now.";
  const NARRATION_LEAKY = "That save was refused: new row violates row-level security policy.";
  const tool = { name: "update_client_data", args: { phone: "(415) 555-0132" } };
  const thoughtControl = await drive({ stream: true, rpcOverrides: AS_CLIENT, toolCall: tool, toolRoundNarration: NARRATION_CLEAN, replyText: "Saved." });
  const thoughtLeak = await drive({ stream: true, rpcOverrides: AS_CLIENT, toolCall: tool, toolRoundNarration: NARRATION_LEAKY, replyText: "Saved." });
  assert("30.4 CONTROL: this shape shows a client her thought line, with the answer",
    thoughtsOf(thoughtControl).includes(NARRATION_CLEAN) && replyOf(thoughtControl) === "Saved.",
    JSON.stringify({ thoughts: thoughtsOf(thoughtControl), reply: replyOf(thoughtControl) }));
  assert("30.5 a leak in a thought line alone withholds the turn, and the thought never reaches the client",
    replyOf(thoughtLeak) === WITHHELD && thoughtsOf(thoughtLeak).length === 0 && !thoughtLeak.bodyText.includes("row-level security"),
    JSON.stringify({ thoughts: thoughtsOf(thoughtLeak), reply: replyOf(thoughtLeak).slice(0, 60) }));

  // THE THREAD KEEPS WHAT THE WIRE CARRIED. A reload must never show a client the answer they were told
  // was not sent.
  const threadLeak = await drive({ stream: true, rpcOverrides: AS_CLIENT, replyText: LEAKY, extraBody: { threadId: THREAD } });
  const threadClean = await drive({ stream: true, rpcOverrides: AS_CLIENT, replyText: CLEAN, extraBody: { threadId: THREAD } });
  assert("30.6 CONTROL: a client's clean answer is saved to the thread as sent",
    JSON.stringify(persisted(threadClean)) === JSON.stringify([CLEAN]),
    JSON.stringify(persisted(threadClean)).slice(0, 120));
  assert("30.7 a withheld answer is saved as the withheld sentence, never as what was written",
    JSON.stringify(persisted(threadLeak)) === JSON.stringify([WITHHELD]) && replyOf(threadLeak) === WITHHELD,
    JSON.stringify(persisted(threadLeak)).slice(0, 120));

  // THE DOCUMENT PATH is a second, independent stream with its own release point.
  const doc = { fileName: "intake.pdf", base64: "JVBERi0xLjQK", mimeType: "application/pdf" };
  const docClean = await drive({ stream: true, rpcOverrides: AS_CLIENT, document: doc, text: "here is my intake form", replyText: "Got it, I've read your intake form." });
  const docLeak = await drive({ stream: true, rpcOverrides: AS_CLIENT, document: doc, text: "here is my intake form", replyText: `Got it. I saved it to record ${RECORD} with update_client_data.` });
  const docOwner = await drive({ stream: true, rpcOverrides: AS_OWNER, document: doc, text: "here is my intake form", replyText: `Got it. I saved it to record ${RECORD} with update_client_data.` });
  assert("30.8 CONTROL: a client's clean answer about a document arrives as written",
    replyOf(docClean) === "Got it, I've read your intake form.",
    JSON.stringify({ status: docClean.status, reply: replyOf(docClean).slice(0, 60) }));
  assert("30.9 on the document path a leaky answer never reaches a client either",
    replyOf(docLeak) === WITHHELD && !docLeak.bodyText.includes(RECORD) && !docLeak.bodyText.includes("update_client_data"),
    JSON.stringify({ reply: replyOf(docLeak).slice(0, 80) }));
  assert("30.10 ...and an owner's document turn is untouched",
    replyOf(docOwner).includes(RECORD),
    replyOf(docOwner).slice(0, 80));
  const docThread = await drive({ stream: true, rpcOverrides: AS_CLIENT, document: doc, text: "here is my intake form", replyText: `Got it. I saved it to record ${RECORD}.`, extraBody: { threadId: THREAD } });
  const docThreadClean = await drive({ stream: true, rpcOverrides: AS_CLIENT, document: doc, text: "here is my intake form", replyText: "Got it, I've read your intake form.", extraBody: { threadId: THREAD } });
  assert("30.14 on the document path too, the thread keeps the withheld sentence, never what was written (the control saves a clean answer as sent)",
    JSON.stringify(persisted(docThread)) === JSON.stringify([WITHHELD])
      && JSON.stringify(persisted(docThreadClean)) === JSON.stringify(["Got it, I've read your intake form."]),
    JSON.stringify({ leak: persisted(docThread), clean: persisted(docThreadClean) }).slice(0, 200));

  // EACH SOURCE OF THE VOCABULARY IS LOAD-BEARING. A key the tool result's own envelope carried, and a
  // block name only the server's document instruction carried: each is caught only if that source is
  // read. The controls prove each word was really in what she was sent, and only there.
  const sentTo = (r) => (r.modelEgress.at(-1) ?? "");
  const resultKey = await drive({ stream: true, rpcOverrides: AS_CLIENT, toolCall: tool, replyText: "I queued it; needs_confirm is set, so tap approve." });
  assert("30.11 a key from the tool result she was sent is caught in a client's answer",
    sentTo(resultKey).includes('\\"needs_confirm\\"') && replyOf(resultKey) === WITHHELD,
    JSON.stringify({ inResult: sentTo(resultKey).includes('\\"needs_confirm\\"'), reply: replyOf(resultKey).slice(0, 60) }));
  const creditRead = { can_read_document: true, document_kind: "credit_report", first_five_account_names: ["ACCOUNT ONE"] };
  const MARKER = "CREDIT REPORT ANALYSIS INSTRUCTIONS";
  const docMarker = await drive({ stream: true, rpcOverrides: AS_CLIENT, document: { fileName: "report.pdf", base64: "JVBERi0xLjQK", mimeType: "application/pdf" }, readCheck: creditRead, text: "here is my report", replyText: `Per my ${MARKER}, your report has three accounts.` });
  // The request that produced the answer is the streamed one; the credit path makes other model calls
  // after it (the read check, the extraction).
  const answered = docMarker.modelEgress.find((body) => { try { return JSON.parse(body).stream === true; } catch { return false; } }) ?? "";
  const docSystem = (() => { try { const b = JSON.parse(answered); return typeof b.system === "string" ? b.system : JSON.stringify(b.system ?? ""); } catch { return ""; } })();
  // Only text the handler VOUCHES for, where it built it, gives block names and keys. The team authority
  // block is vouched (constant header and footer, sentences from a fixed switch), so its name is caught.
  const AUTHORITY = "YOUR AUTHORITY IN THIS WORKSPACE";
  const systemMarker = await drive({ stream: true, rpcOverrides: AS_CLIENT, replyText: `Per ${AUTHORITY}, you are a member here.` });
  const systemOf = (r) => { try { const b = JSON.parse(r.modelEgress.find((x) => { try { return JSON.parse(x).stream === true; } catch { return false; } }) ?? "null"); return typeof b?.system === "string" ? b.system : JSON.stringify(b?.system ?? ""); } catch { return ""; } };
  assert("30.13 the name of a vouched block (the team authority block) is caught in a client's answer",
    systemOf(systemMarker).includes(`=== ${AUTHORITY}`) && replyOf(systemMarker) === WITHHELD,
    JSON.stringify({ inSystem: systemOf(systemMarker).includes(`=== ${AUTHORITY}`), reply: replyOf(systemMarker).slice(0, 60) }));

  // A TENANT'S OWN WORDS NEVER WITHHOLD THEIR CLIENT'S ANSWER. The persona is pasted into the system
  // prompt as prose and is never vouched, and a tenant can write what looks exactly like the server's
  // own text into it: a comma, a quoted word and a real JSON value, or a heading with its END line. Each
  // phrasing, repeated in a client's answer, reaches the client and is saved as written. The control
  // proves the persona really reached the model, and that read as the server's it would have withheld.
  const { deriveInternalVocabulary: vocabularyOf, findInternalLeaks: leaksIn } = await import("../../supabase/functions/_shared/internal-vocabulary.ts");
  const AS_CLIENT_WITH_PERSONA = { ...AS_CLIENT, get_paige_persona_context: { data: [{ tenant_id: CALLER_TENANT, tenant_name: BUSINESS, playbook_slug: null, funding_enabled: false, brand: null,
    playbook_config: { persona: { name: "Paige", role: "your coach's assistant" }, journey: [
      { key: "basic", label: "Basic", description: 'We offer basic, "gold_tier": true for premium customers.' },
      { key: "vip", label: "VIP", description: "Members book first.\nVIP PLAN\nPriority booking, every week.\nEND VIP PLAN" },
    ] } }], error: null } };
  for (const [id, words] of [["30.27", "Your gold_tier plan includes early booking on weekdays."], ["30.28", "You're on the VIP PLAN, so you book first every week."]]) {
    const turn = await drive({ stream: true, rpcOverrides: AS_CLIENT_WITH_PERSONA, replyText: words, extraBody: { threadId: THREAD } });
    const sentSystem = systemOf(turn);
    const personaSent = sentSystem.includes('"gold_tier": true') && sentSystem.includes("END VIP PLAN");
    const asIfServer = leaksIn(words, vocabularyOf({ vouchedTexts: [sentSystem] })).map((leak) => leak.text);
    assert(`${id} a client's answer repeating the tenant's own persona words reaches the client and is saved as written (${words.slice(0, 22)}…)`,
      personaSent && asIfServer.length > 0 && replyOf(turn) === words && persisted(turn).at(-1) === words,
      JSON.stringify({ personaSent, asIfServer, reply: replyOf(turn).slice(0, 60), saved: persisted(turn).at(-1)?.slice(0, 60) }));
  }

  // A TOOL THE SEAT MAY NOT USE RENDERS NO STEP. Action steps go to the wire as they happen and are
  // not read, so a refused owner tool must not become one: it would show a client an owner's action,
  // and buying a number shows the model's own argument, which a client can ask the model to fill with
  // anything. The control proves the call was made and refused, not skipped.
  const stepsOf = (r) => frames(r).filter((f) => f.paige_step?.kind === "action").map((f) => f.paige_step);
  const planted = `update_client_data ${RECORD}`;
  const refused = await drive({ stream: true, rpcOverrides: AS_CLIENT, toolCall: { name: "comms_buy_number", args: { phone_number: planted } }, replyText: "Sorry, I can't do that here." });
  const refusedReached = refused.modelEgress.some((body) => body.includes("forbidden_seat"));
  assert("30.29 a tool a client seat may not use is refused and renders no step, so the model's own argument never reaches the client",
    refusedReached && stepsOf(refused).length === 0 && !refused.bodyText.includes(planted) && !refused.bodyText.includes(RECORD)
      && replyOf(refused) === "Sorry, I can't do that here.",
    JSON.stringify({ refusedReached, steps: stepsOf(refused), reply: replyOf(refused).slice(0, 60) }));
  // A WITHHELD ANSWER IS NOT EXTRACTED FROM. On the credit path the answer is the extraction's input,
  // and the extraction writes a report summary, an analysis and a review proposal; none of that may be
  // made from an answer the client was not shown. The control proves the clean turn does extract.
  const EXTRACTS = "Here is the credit report analysis I just produced";
  const creditClean = await drive({ stream: true, rpcOverrides: AS_CLIENT, document: { fileName: "report.pdf", base64: "JVBERi0xLjQK", mimeType: "application/pdf" }, readCheck: creditRead, text: "here is my report", replyText: "Your report has three accounts." });
  // R3b — A SYNC THAT FAILED IS TOLD IN A SENTENCE. The harness's extraction cannot produce a
  // report, so the pipeline fails the way a real one does; the uploader reads a fixed sentence, never
  // the pipeline's own error text or step name.
  const syncOf = (r) => frames(r).filter((f) => f.sync_status).map((f) => f.sync_status);
  const SYNC_BEFORE_ANY_WRITE = `I read your report, but I couldn't pull out its details for you to review, and none of them were added to your profile. You can try uploading it again, or ask ${BUSINESS} to take a look.`;
  const SYNC_DID_NOT_FINISH = `I read your report, but I couldn't finish pulling out its details for you to review. You can ask ${BUSINESS} to take a look.`;
  const syncSeen = syncOf(creditClean);
  assert("30.33 a credit-report sync that did not complete reaches the uploader as a fixed sentence, with no step and no pipeline text",
    syncSeen.length === 1 && syncSeen[0].success === false && !("step" in syncSeen[0])
      && syncSeen[0].error === SYNC_BEFORE_ANY_WRITE && syncSeen[0].uploader_sentence === true
      && !/Failed to|Validation failed|extraction|pipeline|Unknown/.test(JSON.stringify(syncSeen[0]))
      // "none of them were added" is only true because nothing was: no memory note, no upload stamp.
      && !creditClean.rec.inserts.some((i) => i.table === "client_memory" || (i.table === "credit_report_uploads" && i.update)),
    JSON.stringify({ sync: syncSeen, writes: creditClean.rec.inserts.map((i) => `${i.table}${i.update ? ":update" : ""}`) }));
  // ...AND A SYNC THAT STOPPED AFTER ITS FIRST WRITE NEVER SAYS NOTHING WAS ADDED. Given a report the
  // extraction can read, the pipeline writes a client memory note before it stamps the upload; when the
  // stamp is refused, that note is already kept, so the uploader reads only that it did not finish.
  // The control proves the same report, unrefused, reaches the proposal.
  const REPORT = JSON.stringify({ is_credit_report: true, extraction_verified: true, report_type: "consumer", scores: { equifax: 700, experian: 705, transunion: 698 },
    negative_items: [{ creditor_name: "ACCOUNT ONE", account_type: "revolving", status: "charge_off", balance: 500 }], positive_accounts: [], hard_inquiries: [] });
  const reportDrive = (extra = {}) => drive({ stream: true, rpcOverrides: AS_CLIENT, document: { fileName: "report.pdf", base64: "JVBERi0xLjQK", mimeType: "application/pdf" },
    readCheck: creditRead, text: "here is my report", replyText: "Your report has three accounts.", extractionReply: REPORT,
    // The upload record the portal's upload writes, read back by its id, so the pipeline has a record to stamp.
    serviceTablesExtra: { credit_report_uploads: () => [{ id: "7e7e7e7e-7e7e-4e7e-8e7e-7e7e7e7e7e7e" }] },
    tablesExtra: { credit_report_uploads: () => [{ id: "7e7e7e7e-7e7e-4e7e-8e7e-7e7e7e7e7e7e" }] }, ...extra });
  const proposed = await reportDrive();
  const proposedOwnNote = proposed.rec.rpc.filter((c) => c.name === "record_paige_memory" && c.args?.p_memory_type === "report_upload");
  assert("30.34 CONTROL: a report the extraction can read reaches the proposal, after an owner-memory note is written (S5: governed seam)",
    frames(proposed).some((f) => f.extraction_proposal) && proposedOwnNote.length === 1 && proposedOwnNote[0].args?.p_confirmation_state === "proposed"
      && syncOf(proposed).every((st) => st.awaiting_review === true),
    JSON.stringify({ proposal: frames(proposed).some((f) => f.extraction_proposal), inserts: proposed.rec.inserts.map((i) => i.table), sync: syncOf(proposed) }));
  // A report the extraction reads but validation refuses stops before its first write too.
  const notReport = await reportDrive({ extractionReply: JSON.stringify({ ...JSON.parse(REPORT), is_credit_report: false }) });
  const notReportSync = syncOf(notReport);
  assert("30.36 a report refused by validation tells the uploader nothing was added, and nothing was: no memory note, no upload stamp",
    notReportSync.length === 1 && notReportSync[0].error === SYNC_BEFORE_ANY_WRITE && notReportSync[0].uploader_sentence === true && !("step" in notReportSync[0])
      && !/Validation failed|Not identified|is_credit_report/.test(JSON.stringify(notReportSync))
      && !notReport.rec.inserts.some((i) => i.table === "client_memory" || (i.table === "credit_report_uploads" && i.update)),
    JSON.stringify({ sync: notReportSync, writes: notReport.rec.inserts.map((i) => `${i.table}${i.update ? ":update" : ""}`) }));
  const stampRefused = await reportDrive({ tableErrorsExtra: { "credit_report_uploads:update": { message: "new row violates check constraint", code: "23514" } } });
  const refusedSync = syncOf(stampRefused);
  const refusedOwnNote = stampRefused.rec.rpc.filter((c) => c.name === "record_paige_memory" && c.args?.p_memory_type === "report_upload");
  assert("30.35 a sync refused after its owner-memory note was written tells the uploader it did not finish, never that nothing was added (S5)",
    refusedOwnNote.length === 1
      && refusedSync.length === 1 && refusedSync[0].success === false && !("step" in refusedSync[0]) && !("write" in refusedSync[0])
      && refusedSync[0].error === SYNC_DID_NOT_FINISH && refusedSync[0].uploader_sentence === true
      && !/credit_report_uploads|check constraint|23514|write_rejected/.test(JSON.stringify(refusedSync))
      && stampRefused.logged.some((l) => l.level === "warn" && l.msg.includes("credit report sync did not complete") && l.msg.includes("write_rejected")),
    JSON.stringify({ inserts: stampRefused.rec.inserts.map((i) => i.table), sync: refusedSync, warns: stampRefused.logged.filter((l) => l.level === "warn").map((l) => l.msg.slice(0, 120)) }));
  assert("30.15 CONTROL: a client's clean credit-report answer is extracted from, as before",
    creditClean.modelEgress.some((body) => body.includes(EXTRACTS)) && replyOf(creditClean) === "Your report has three accounts.",
    JSON.stringify({ calls: creditClean.modelEgress.length }));
  assert("30.16 a withheld credit-report answer is never extracted from, so nothing is written from it",
    !docMarker.modelEgress.some((body) => body.includes(EXTRACTS))
      && !docMarker.rec.inserts.some((i) => i.table === "audit_logs" || i.table === "client_memory"),
    JSON.stringify({ extracted: docMarker.modelEgress.some((body) => body.includes(EXTRACTS)), inserts: docMarker.rec.inserts.map((i) => i.table) }));

  // "[DONE]" INSIDE AN ANSWER IS TEXT. Only the whole payload `[DONE]` ends a stream; an answer that
  // contains it was dropped from what the check read and what the thread saved, while its bytes still
  // reached the person.
  const doneLeak = await drive({ stream: true, rpcOverrides: AS_CLIENT, replyText: "Done, I ran update_client_data for you. [DONE]" });
  assert("30.17 an answer that contains the text [DONE] is still read, and withheld when it leaks",
    replyOf(doneLeak) === WITHHELD && !doneLeak.bodyText.includes("update_client_data"),
    replyOf(doneLeak).slice(0, 80));
  const doneOwner = await drive({ stream: true, rpcOverrides: AS_OWNER, replyText: "All set. Reply [DONE] when you have read it.", extraBody: { threadId: THREAD } });
  assert("30.18 ...and on any seat the thread now saves what the person received, [DONE] and all",
    replyOf(doneOwner) === "All set. Reply [DONE] when you have read it."
      && JSON.stringify(persisted(doneOwner)) === JSON.stringify(["All set. Reply [DONE] when you have read it."]),
    JSON.stringify({ reply: replyOf(doneOwner), saved: persisted(doneOwner) }));

  const doneDoc = await drive({ stream: true, rpcOverrides: AS_OWNER, document: doc, text: "here is my intake form", replyText: "Got it. Reply [DONE] once you've checked it.", extraBody: { threadId: THREAD } });
  assert("30.21 ...on the document path too: the answer is delivered and saved in full",
    replyOf(doneDoc) === "Got it. Reply [DONE] once you've checked it."
      && JSON.stringify(persisted(doneDoc)) === JSON.stringify(["Got it. Reply [DONE] once you've checked it."]),
    JSON.stringify({ reply: replyOf(doneDoc), saved: persisted(doneDoc) }));

  // WHEN SOMETHING WAS SAVED, THE SENTENCE SAYS SO — and only then. A client who reads "ask me another
  // way" after their phone number was stored would send it again. "Saved" is the write's own report:
  // the client-data write-back answers `success: true` for the request and lists each field's own
  // outcome, so a request whose every field failed saved nothing.
  const WITHHELD_SAVED = withheldReplyForClient(BUSINESS, { savedSomething: true });
  const AUTO_CLIENT = { ...AS_CLIENT, resolve_tool_autonomy: { data: "auto", error: null } };
  const phoneTool = { name: "update_client_data", args: { updates: [{ field_path: "phone", value: "(415) 555-0132" }] } };
  const savedLeak = await drive({ stream: true, rpcOverrides: AUTO_CLIENT, toolCall: phoneTool, replyText: LEAKY,
    writeBack: { status: 200, body: { success: true, results: [{ field_path: "phone", success: true }] } } });
  const failedLeak = await drive({ stream: true, rpcOverrides: AUTO_CLIENT, toolCall: phoneTool, replyText: LEAKY,
    writeBack: { status: 200, body: { success: true, results: [{ field_path: "phone", success: false, error: "Field not in whitelist" }] } } });
  const pendingLeak = await drive({ stream: true, rpcOverrides: { ...AS_CLIENT, resolve_tool_autonomy: { data: "confirm", error: null } }, toolCall: phoneTool, replyText: LEAKY });
  const wroteBack = (r) => r.outboundCalls.some((c) => c.url.includes("paige-write-back"));
  assert("30.22 a save that landed on the turn is named in the withheld sentence, so the client does not send it again",
    wroteBack(savedLeak) && replyOf(savedLeak) === WITHHELD_SAVED,
    JSON.stringify({ wrote: wroteBack(savedLeak), reply: replyOf(savedLeak).slice(0, 160) }));
  assert("30.23 a write that ran but saved no field is not called saved: the approved sentence, word for word",
    wroteBack(failedLeak) && replyOf(failedLeak) === WITHHELD,
    JSON.stringify({ wrote: wroteBack(failedLeak), reply: replyOf(failedLeak).slice(0, 160) }));
  assert("30.24 a save still waiting on approval is not called saved either",
    !wroteBack(pendingLeak) && replyOf(pendingLeak) === WITHHELD,
    JSON.stringify({ wrote: wroteBack(pendingLeak), reply: replyOf(pendingLeak).slice(0, 160) }));

  // A READ SAVES NOTHING. A client seat's other tool fetches a page; a fetch that succeeded is not
  // "something I'd already finished", so it never earns the saved clause. The control proves the page
  // really was read and handed to the model.
  const readLeak = await drive({ stream: true, rpcOverrides: AUTO_CLIENT, toolCall: { name: "web_fetch", args: { url: "https://example.test/pricing" } }, replyText: LEAKY,
    fetchedPage: { status: 200, body: { success: true, url: "https://example.test/pricing", title: "Pricing", content: "Plans start at $49 a month." } } });
  assert("30.26 a page fetched on the turn is not a save: a withheld answer after it reads the approved sentence",
    readLeak.modelEgress.some((body) => body.includes("Plans start at $49 a month.")) && replyOf(readLeak) === WITHHELD,
    JSON.stringify({ read: readLeak.modelEgress.some((body) => body.includes("Plans start at $49 a month.")), reply: replyOf(readLeak).slice(0, 160) }));

  // THE PORTAL IS TOLD. A withheld turn carries one frame saying so, which the portal reads to keep the
  // sentence from being filed as a document's summary; a clean turn never carries it.
  const withheldFlag = (r) => frames(r).some((f) => f.paige_withheld === true);
  assert("30.25 every withheld turn, on both paths, tells the portal it was withheld; no delivered turn does",
    [leakyClient, thoughtLeak, docLeak, savedLeak].every(withheldFlag)
      && ![cleanClient, docClean, leakyOwner, docOwner].some(withheldFlag),
    JSON.stringify({ withheld: [leakyClient, thoughtLeak, docLeak, savedLeak].map(withheldFlag), clean: [cleanClient, docClean, leakyOwner, docOwner].map(withheldFlag) }));

  // THE CLIENT'S OWN WORDS NEVER BECOME VOCABULARY, even sent as a `system` message (the request schema
  // accepts one) or written into a file name, which the server repeats in its document header.
  const ownSystem = await drive({
    stream: true, rpcOverrides: AS_CLIENT,
    extraBody: { messages: [
      { role: "system", content: '=== MY OWN NOTES ===\n{"favorite_color": "teal"}\n=== END MY OWN NOTES ===' },
      { role: "user", content: "what did I note?" },
    ] },
    replyText: "Per MY OWN NOTES, your favorite_color is teal.",
  });
  assert("30.19 a client's own system message reached the model, and its words never withhold the client's answer",
    ownSystem.modelEgress.some((body) => body.includes("favorite_color")) && replyOf(ownSystem) === "Per MY OWN NOTES, your favorite_color is teal.",
    JSON.stringify({ reached: ownSystem.modelEgress.some((body) => body.includes("favorite_color")), reply: replyOf(ownSystem).slice(0, 60) }));
  // The name is shaped as JSON grammar reads a key (a comma, a quoted word, a value), so the only thing
  // keeping it out of the vocabulary is that the header naming the client's file is never vouched.
  const FILE_NAME = 'plan, "family_plan": 2.pdf';
  const nameWouldBeKey = vocabularyOf({ vouchedTexts: [`[Attached document: ${FILE_NAME} — PDF]`] }).keys.has("family_plan");
  const ownFile = await drive({ stream: true, rpcOverrides: AS_CLIENT, document: { fileName: FILE_NAME, base64: "JVBERi0xLjQK", mimeType: "application/pdf" }, text: "here is my plan", replyText: "Your family_plan document is in." });
  assert("30.20 a client's file name reached the model, and its words never withhold the client's answer",
    nameWouldBeKey && ownFile.modelEgress.some((body) => body.includes("family_plan")) && replyOf(ownFile) === "Your family_plan document is in.",
    JSON.stringify({ nameWouldBeKey, reached: ownFile.modelEgress.some((body) => body.includes("family_plan")), reply: replyOf(ownFile).slice(0, 60) }));
  assert("30.12 a block name only the server's document instruction carried is caught on the document path",
    answered.includes(`=== ${MARKER} ===`) && !docSystem.includes(MARKER) && replyOf(docMarker) === WITHHELD,
    JSON.stringify({ inRequest: answered.includes(`=== ${MARKER} ===`), inSystem: docSystem.includes(MARKER), reply: replyOf(docMarker).slice(0, 60) }));
}

console.log("\noutbound drafts — a draft PAIGE files for a customer is read for internal text before it can be filed or sent");
{
  const THREAD = "cececece-cece-4ece-8ece-cececececece";
  const RECORD = "5a5a5a5a-5a5a-4a5a-8a5a-5a5a5a5a5a5a";
  const CALENDAR = "c1c1c1c1-c1c1-4c1c-8c1c-c1c1c1c1c1c1";
  const ACTION = "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11";
  const PERSONA = { get_paige_persona_context: { data: [{ tenant_id: CALLER_TENANT, tenant_name: "Northside Fitness", playbook_config: null, playbook_slug: null, funding_enabled: false, brand: null }], error: null } };
  const lane = (mode) => ({ rpcOverrides: { ...PERSONA, get_actor_access: { data: { tier: "tenant" }, error: null }, resolve_tool_autonomy: { data: mode, error: null },
    calendar_link_shareable: { data: [{ shareable: true, slug: "intro", title: "Intro call", reason: null }], error: null } } });
  const ADMIN = { user_roles: [{ role: "admin" }], paige_pending_approvals: () => [{ id: "b0b0b0b0-b0b0-4b0b-8b0b-b0b0b0b0b0b0" }] };
  const frames = (r) => r.bodyText.split("\n").filter((l) => l.startsWith("data: ") && l !== "data: [DONE]")
    .map((l) => { try { return JSON.parse(l.slice(6)); } catch { return null; } }).filter(Boolean);
  const cardOf = (r) => frames(r).find((f) => f.paige_confirm)?.paige_confirm;
  const toldModel = (r) => r.modelEgress.map((b) => b.replace(/\\"/g, '"')).join("\n");
  const refusedAsInternal = (r) => toldModel(r).includes("internal_text_in_draft");
  const approvalsFiled = (r) => (r.rec.inserts ?? []).filter((i) => i.table === "paige_pending_approvals");
  const sends = (r) => r.outboundCalls.filter((c) => c.url.includes("/functions/v1/send-message"));
  const rpcsNamed = (r, name) => r.rec.rpc.filter((c) => c.name === name);
  // Each kind the detector needs no conversation for, planted one at a time so a pass cannot ride on
  // another kind: a declared tool's name, a record id, Postgres error text, the operator codename.
  const PLANTS = [
    ["a tool name", "I ran update_client_data so your file is current."],
    ["a record id", `Your file is ${RECORD}.`],
    ["database error text", 'We saw: new row violates row-level security policy for table "clients".'],
    ["the operator codename", `It is set in ${["MMA", "OS"].join(" ")}.`],
  ];
  // A customer's ordinary message: a link, an email address, a phone number and a merge tag, each the
  // reader's to use, and single words that are also keys.
  const CLEAN = "Hi {{first_name}}, you can book your next session here: https://paigeagent.ai/book/intro. Questions? Reply to desk@northside.example or call (415) 555-0132. Your title and tasks are all set.";

  // propose_action is exempt from the confirm gate, so filing IS the moment to stop it.
  const propose = (body, extra = {}) => drive({ stream: true, extraBody: { threadId: THREAD },
    toolCall: { name: "propose_action", args: { action_type: "email", contact_id: OWN, subject: "Your next session", body, summary: "Email Dana about booking", ...extra } },
    ...lane("confirm"), tablesExtra: ADMIN });
  for (const [kind, plant] of PLANTS) {
    const r = await propose(`${CLEAN} ${plant}`);
    assert(`31.1 a drafted email carrying ${kind} is not filed, and PAIGE is told to rewrite it`,
      approvalsFiled(r).length === 0 && refusedAsInternal(r),
      JSON.stringify({ filed: approvalsFiled(r).length, refused: refusedAsInternal(r) }));
  }
  const subjectLeak = await propose(CLEAN, { subject: "Re: update_client_data" });
  assert("31.2 ...and so is one whose subject line carries it", approvalsFiled(subjectLeak).length === 0 && refusedAsInternal(subjectLeak),
    JSON.stringify({ filed: approvalsFiled(subjectLeak).length }));
  const cleanDraft = await propose(CLEAN);
  const filedRow = approvalsFiled(cleanDraft)[0]?.row;
  assert("31.3 CONTROL: a customer's ordinary email files exactly as drafted",
    approvalsFiled(cleanDraft).length === 1 && filedRow?.draft_content?.body === CLEAN && filedRow?.draft_content?.subject === "Your next session" && !refusedAsInternal(cleanDraft),
    JSON.stringify({ filed: approvalsFiled(cleanDraft).length, body: filedRow?.draft_content?.body?.slice(0, 40) }));

  // calendar_link_send is gated: a leaky message never becomes a card, and a card whose stored message
  // carries internal text (one recorded before this check existed) sends nothing when approved.
  const linkArgs = (message) => ({ calendarId: CALENDAR, contactId: OWN, channel: "email", subject: "Book a time", message });
  const linkDrive = (store, args, body = {}) => drive({ stream: true, extraBody: { threadId: THREAD, ...body },
    toolCall: { name: "calendar_link_send", args }, ...lane("confirm"),
    tablesExtra: { paige_pending_confirmations: store.table, user_roles: [{ role: "admin" }] },
    // The contact holds its addresses as contact methods; the send goes to the primary email.
    serviceTablesExtra: { clients: () => [{ id: OWN, client_contact_methods: [{ kind: "email", value: "dana@example.test", is_primary: true }] }] },
    onInsert: mirrorConfirms(store) });
  const leakyLinkStore = makeConfirmStore();
  const leakyLink = await linkDrive(leakyLinkStore, linkArgs(`Pick a time. ${PLANTS[1][1]}`));
  assert("31.4 a booking-link message carrying internal text never becomes an approval card",
    leakyLinkStore.rows.length === 0 && !cardOf(leakyLink) && refusedAsInternal(leakyLink) && sends(leakyLink).length === 0,
    JSON.stringify({ cards: leakyLinkStore.rows.length, refused: refusedAsInternal(leakyLink) }));
  const cleanLinkStore = makeConfirmStore();
  const cleanLink = await linkDrive(cleanLinkStore, linkArgs("Pick a time that suits you."));
  const cleanCard = cleanLinkStore.rows[0];
  assert("31.5 CONTROL: a clean booking-link message becomes a card", cleanLinkStore.rows.length === 1 && !!cardOf(cleanLink) && !refusedAsInternal(cleanLink),
    JSON.stringify({ cards: cleanLinkStore.rows.length }));
  const approveLink = (store) => linkDrive(store, linkArgs("Pick a time that suits you."), { approvedConfirmations: [issuedApproval(store.rows[0])] });
  const approvedClean = await approveLink(cleanLinkStore);
  assert("31.6 CONTROL: approving the clean card sends it", sends(approvedClean).length === 1
    && JSON.parse(sends(approvedClean)[0].body).body.includes("Pick a time that suits you."),
    JSON.stringify({ sends: sends(approvedClean).length }));
  // A card stored before this check existed: seeded the way section 18 seeds a stored card, a row whose
  // token is its own fingerprint, so the approval redeems exactly the arguments it holds while the model
  // re-sends a clean call. The control redeems the same card holding a clean message, and it sends.
  const storedCard = (message) => makeConfirmStore([{ id: "stored-card", fingerprint: "dddddddddddddddd", issued_in_request: "legacy-request",
    user_id: USER, tool_name: "calendar_link_send", tenant_id: CALLER_TENANT, thread_id: THREAD, scoped_client_id: null, args: linkArgs(message) }]);
  const redeem = (store) => linkDrive(store, linkArgs("Pick a time that suits you."), { approvedConfirmations: ["dddddddddddddddd"] });
  const storedCleanStore = storedCard("Pick a time that suits you.");
  const storedClean = await redeem(storedCleanStore);
  assert("31.6b CONTROL: a stored card with a clean message is redeemed and sends", storedCleanStore.rows[0].consumed && sends(storedClean).length === 1,
    JSON.stringify({ consumed: storedCleanStore.rows[0].consumed, sends: sends(storedClean).length }));
  const staleStore = storedCard(`Pick a time. ${PLANTS[0][1]}`);
  const approvedStale = await redeem(staleStore);
  assert("31.7 a stored card whose message carries internal text sends nothing when approved, and PAIGE is told why",
    !!cleanCard && sends(approvedStale).length === 0 && refusedAsInternal(approvedStale) && toldModel(approvedStale).includes("Nothing went ahead."),
    JSON.stringify({ consumed: staleStore.rows[0].consumed, sends: sends(approvedStale).length, refused: refusedAsInternal(approvedStale) }));
  // The usual approval: the model re-sends the card's own arguments. The gate claims the card first, so the
  // refusal is where it runs, and the card says so, rather than a refusal before the gate that leaves the
  // card unclaimed and the owner told only that Paige didn't run it.
  const sameStore = storedCard(`Pick a time. ${PLANTS[0][1]}`);
  const approvedSame = await linkDrive(sameStore, linkArgs(`Pick a time. ${PLANTS[0][1]}`), { approvedConfirmations: ["dddddddddddddddd"] });
  assert("31.7c ...and so does the usual approval, where PAIGE re-sends the card's own message",
    sameStore.rows[0].consumed && sends(approvedSame).length === 0 && refusedAsInternal(approvedSame) && toldModel(approvedSame).includes("Nothing went ahead."),
    JSON.stringify({ consumed: sameStore.rows[0].consumed, sends: sends(approvedSame).length, refused: refusedAsInternal(approvedSame) }));
  // What the owner's card says for it: the server's one sentence, and the action marked as not run.
  const staleOutcome = approvedStale.bodyText.split("\n").filter((l) => l.startsWith("data: ") && l !== "data: [DONE]")
    .map((l) => { try { return JSON.parse(l.slice(6)); } catch { return null; } })
    .find((f) => f && f.paige_approval_outcome)?.paige_approval_outcome;
  assert("31.7b ...and the card reports it as not run, in the sentence for a held-back message",
    staleOutcome?.note === "Nothing changed. The message included internal system details, so Paige stopped before it went out. Ask her to rewrite it."
      && staleOutcome?.actions?.length === 1 && staleOutcome.actions[0].outcome === "not_run",
    JSON.stringify(staleOutcome));

  // action_advance attaches a draft; in the auto lane it runs at once, so dispatch is where it stops.
  const advance = (draft, mode) => { const store = makeConfirmStore(); return drive({ stream: true, extraBody: { threadId: THREAD },
    toolCall: { name: "action_advance", args: { action_id: ACTION, to_status: "drafted", draft_content: draft } }, ...lane(mode),
    tablesExtra: { paige_pending_confirmations: store.table, user_roles: [{ role: "admin" }] }, onInsert: mirrorConfirms(store) }).then((r) => ({ r, store })); };
  for (const mode of ["auto", "confirm"]) {
    const { r, store } = await advance({ channel: "email", subject: "Checking in", body: `Hi Dana. ${PLANTS[2][1]}` }, mode);
    assert(`31.8 a bus draft carrying internal text is not attached (${mode} lane): no advance, no card`,
      rpcsNamed(r, "advance_action").length === 0 && store.rows.length === 0 && refusedAsInternal(r),
      JSON.stringify({ advanced: rpcsNamed(r, "advance_action").length, cards: store.rows.length, refused: refusedAsInternal(r) }));
  }
  const { r: cleanAdvance } = await advance({ channel: "email", subject: "Checking in", body: CLEAN }, "auto");
  assert("31.9 CONTROL: a clean bus draft is attached exactly as written",
    rpcsNamed(cleanAdvance, "advance_action").length === 1 && rpcsNamed(cleanAdvance, "advance_action")[0].args.p_draft_content?.body === CLEAN,
    JSON.stringify({ advanced: rpcsNamed(cleanAdvance, "advance_action").length }));

  // action_file: for a kind whose executor reaches a customer, the title and summary can be what the
  // client reads (a portal recommendation with no draft shows them). An owner-only kind is not read.
  const fileAction = (kind, executor, title) => drive({ stream: true, extraBody: { threadId: THREAD },
    toolCall: { name: "action_file", args: { action_kind: kind, title, summary: "Next step for Dana", contact_id: OWN } }, ...lane("auto"),
    tablesExtra: { user_roles: [{ role: "admin" }], paige_action_kinds: () => [{ executor }] },
    serviceTablesExtra: { paige_action_kinds: () => [{ executor }] } });
  const portalLeak = await fileAction("client.portal_recommendation", "surface_to_client", `Your next step. ${PLANTS[3][1]}`);
  assert("31.10 a portal recommendation whose title carries internal text is not filed",
    rpcsNamed(portalLeak, "file_action").length === 0 && refusedAsInternal(portalLeak),
    JSON.stringify({ filed: rpcsNamed(portalLeak, "file_action").length, refused: refusedAsInternal(portalLeak) }));
  const ownerOnly = await fileAction("owner.internal_note", "record_only", "Retry update_client_data for Dana");
  assert("31.11 an owner-only action's title is not read here (it never reaches a customer)",
    rpcsNamed(ownerOnly, "file_action").length === 1 && !refusedAsInternal(ownerOnly),
    JSON.stringify({ filed: rpcsNamed(ownerOnly, "file_action").length }));
  // The same backstop where a stored card runs the bus tools: the approved card's arguments, not the
  // model's clean re-send, are what the check reads. Each control redeems the same card holding clean text.
  const storedBusCard = (tool, args) => makeConfirmStore([{ id: `stored-${tool}`, fingerprint: "eeeeeeeeeeeeeeee", issued_in_request: "legacy-request",
    user_id: USER, tool_name: tool, tenant_id: CALLER_TENANT, thread_id: THREAD, scoped_client_id: null, args }]);
  const redeemBus = (store, tool, resent, extra = {}) => drive({ stream: true, extraBody: { threadId: THREAD, approvedConfirmations: ["eeeeeeeeeeeeeeee"] },
    toolCall: { name: tool, args: resent }, ...lane("confirm"),
    tablesExtra: { paige_pending_confirmations: store.table, user_roles: [{ role: "admin" }], ...extra }, onInsert: mirrorConfirms(store) });
  const advanceArgs = (body) => ({ action_id: ACTION, to_status: "drafted", draft_content: { channel: "email", subject: "Checking in", body } });
  for (const [label, body, expectRun] of [["CONTROL: a stored card with a clean bus draft runs", "Checking in on your week.", true],
    ["a stored card whose bus draft carries internal text attaches nothing when approved", `Checking in. ${PLANTS[0][1]}`, false]]) {
    const store = storedBusCard("action_advance", advanceArgs(body));
    const r = await redeemBus(store, "action_advance", advanceArgs("Checking in on your week."));
    assert(`31.13 ${label}`, store.rows[0].consumed && (expectRun
      ? rpcsNamed(r, "advance_action").length === 1 && !refusedAsInternal(r)
      : rpcsNamed(r, "advance_action").length === 0 && refusedAsInternal(r)),
      JSON.stringify({ consumed: store.rows[0].consumed, advanced: rpcsNamed(r, "advance_action").length, refused: refusedAsInternal(r) }));
  }
  const fileArgs = (title) => ({ action_kind: "client.portal_recommendation", title, summary: "Next step for Dana", contact_id: OWN });
  for (const [label, title, expectRun] of [["CONTROL: a stored card filing a clean portal recommendation runs", "Book your next session", true],
    ["a stored card filing a portal recommendation with internal text files nothing when approved", `Your next step. ${PLANTS[1][1]}`, false]]) {
    const store = storedBusCard("action_file", fileArgs(title));
    const r = await redeemBus(store, "action_file", fileArgs("Book your next session"), { paige_action_kinds: () => [{ executor: "surface_to_client" }] });
    assert(`31.14 ${label}`, store.rows[0].consumed && (expectRun
      ? rpcsNamed(r, "file_action").length === 1 && !refusedAsInternal(r)
      : rpcsNamed(r, "file_action").length === 0 && refusedAsInternal(r)),
      JSON.stringify({ consumed: store.rows[0].consumed, filed: rpcsNamed(r, "file_action").length, refused: refusedAsInternal(r) }));
  }
  const portalClean = await fileAction("client.portal_recommendation", "surface_to_client", "Book your next session");
  assert("31.12 CONTROL: a clean portal recommendation files", rpcsNamed(portalClean, "file_action").length === 1 && !refusedAsInternal(portalClean),
    JSON.stringify({ filed: rpcsNamed(portalClean, "file_action").length }));

  // A kind the registry cannot answer for is read, never waved through: one it does not list, and one
  // whose lookup fails. The control files the same unlisted kind with clean text.
  const unlisted = (title, extra = {}) => drive({ stream: true, extraBody: { threadId: THREAD },
    toolCall: { name: "action_file", args: { action_kind: "client.unlisted_kind", title, summary: "Next step for Dana", contact_id: OWN } }, ...lane("auto"),
    tablesExtra: { user_roles: [{ role: "admin" }], paige_action_kinds: () => [] }, serviceTablesExtra: { paige_action_kinds: () => [] }, ...extra });
  const noRow = await unlisted(`Your next step. ${PLANTS[0][1]}`);
  assert("31.15 an action whose kind the registry does not list is read: internal text in it is not filed",
    rpcsNamed(noRow, "file_action").length === 0 && refusedAsInternal(noRow), JSON.stringify({ filed: rpcsNamed(noRow, "file_action").length }));
  const lookupFails = await unlisted(`Your next step. ${PLANTS[0][1]}`, { tableErrorsExtra: { "paige_action_kinds:select": { message: "boom", code: "XX000" } } });
  assert("31.15 ...and so is one whose kind could not be looked up",
    rpcsNamed(lookupFails, "file_action").length === 0 && refusedAsInternal(lookupFails), JSON.stringify({ filed: rpcsNamed(lookupFails, "file_action").length }));
  const unlistedClean = await unlisted("Book your next session");
  assert("31.15 CONTROL: the unlisted kind with ordinary text files", rpcsNamed(unlistedClean, "file_action").length === 1 && !refusedAsInternal(unlistedClean),
    JSON.stringify({ filed: rpcsNamed(unlistedClean, "file_action").length }));

  // The vocabulary is the turn's: a key the server wrote into a result PAIGE was sent earlier in the turn
  // is internal text in a draft she files after it. The control files the same draft as the turn's only
  // call, where nothing has taught that key.
  const KEY_BODY = "Hi Dana, your approval_id is ready.";
  const proposal = (body, summary) => ({ name: "propose_action", args: { action_type: "email", contact_id: OWN, subject: "Your next session", body, summary } });
  const sameTurn = await drive({ stream: true, extraBody: { threadId: THREAD },
    toolCall: [proposal(CLEAN, "Email Dana about booking"), proposal(KEY_BODY, "Email Dana again")], ...lane("confirm"), tablesExtra: ADMIN });
  const sameTurnFiled = approvalsFiled(sameTurn);
  assert("31.16 a key from a result earlier in the turn is internal text in a draft filed after it",
    sameTurnFiled.length === 1 && sameTurnFiled[0].row?.draft_content?.body === CLEAN && refusedAsInternal(sameTurn),
    JSON.stringify({ filed: sameTurnFiled.length, refused: refusedAsInternal(sameTurn) }));
  const alone = await propose(KEY_BODY);
  assert("31.16 CONTROL: the same draft as the turn's only call files", approvalsFiled(alone).length === 1 && !refusedAsInternal(alone),
    JSON.stringify({ filed: approvalsFiled(alone).length }));

  // A refused draft did not run: it renders no step in the owner's chat and is not audited as a failed
  // write. The control shows the step and the audit row a filed one does leave, so the readers work.
  const actionSteps = (r) => frames(r).filter((f) => f.paige_step?.kind === "action").map((f) => f.paige_step.label);
  const audited = (r) => (r.rec.inserts ?? []).filter((i) => i.table === "paige_audit_log");
  const refusedFiling = await fileAction("client.portal_recommendation", "surface_to_client", `Your next step. ${PLANTS[0][1]}`);
  const cleanFiling = await fileAction("client.portal_recommendation", "surface_to_client", "Book your next session");
  assert("31.20 a refused draft renders no step and is not audited as a write",
    refusedAsInternal(refusedFiling) && actionSteps(refusedFiling).length === 0 && audited(refusedFiling).length === 0,
    JSON.stringify({ steps: actionSteps(refusedFiling), audited: audited(refusedFiling).length }));
  // Since C2b a filed one shows its step as it starts and as it finishes: ONE row, running then done.
  const stepFrames = (r) => frames(r).filter((f) => f.paige_step?.kind === "action").map((f) => f.paige_step);
  const cleanSteps = stepFrames(cleanFiling);
  assert("31.20 CONTROL: a filed one renders its step and is audited",
    cleanSteps.length === 2 && cleanSteps[0].status === "running" && cleanSteps[1].status === "done"
      && cleanSteps[0].id === cleanSteps[1].id && audited(cleanFiling).length >= 1,
    JSON.stringify({ steps: cleanSteps.map((s) => [s.id, s.status, s.label]), audited: audited(cleanFiling).length }));

  // A body sent as a list is read string by string: the queue would store it joined into one message.
  const listed = await propose(["Hi Dana,", PLANTS[0][1]]);
  assert("31.17 a drafted email whose body arrives as a list is read too, and not filed",
    approvalsFiled(listed).length === 0 && refusedAsInternal(listed), JSON.stringify({ filed: approvalsFiled(listed).length }));

  // A follow-up action is read for what advance_action delivers. Drafted, a kind that requires approval sends
  // its draft through the approval lane WHATEVER its executor, so an owner-only kind that requires approval is
  // read; one that needs none is not, and neither are a draft's ids and channel.
  const advanceKnown = (row, kind, args, extra = {}) => drive({ stream: true, extraBody: { threadId: THREAD },
    toolCall: { name: "action_advance", args: { action_id: ACTION, ...args } }, ...lane("auto"),
    tablesExtra: { user_roles: [{ role: "admin" }], paige_actions: () => [{ id: ACTION, ...row }], paige_action_kinds: () => [kind] }, ...extra });
  const leakyEmail = { channel: "email", contact_id: OWN, subject: "Checking in", body: `Hi Dana. ${PLANTS[0][1]}` };
  const approvalLane = await advanceKnown({ status: "filed", action_kind: "curriculum.suggest_resource", title: "Suggest a resource" },
    { executor: "record_only", requires_approval: true }, { to_status: "drafted", draft_content: leakyEmail });
  assert("31.18 an owner-only kind that requires approval is read: its draft goes out as an email when approved",
    rpcsNamed(approvalLane, "advance_action").length === 0 && refusedAsInternal(approvalLane),
    JSON.stringify({ advanced: rpcsNamed(approvalLane, "advance_action").length, refused: refusedAsInternal(approvalLane) }));
  const noApproval = await advanceKnown({ status: "filed", action_kind: "exec.compile_brief", title: "Weekly brief" },
    { executor: "record_only", requires_approval: false }, { to_status: "drafted", draft_content: leakyEmail });
  assert("31.18 CONTROL: the same draft on an owner-only kind that needs no approval is not read (it never reaches a customer)",
    rpcsNamed(noApproval, "advance_action").length === 1 && !refusedAsInternal(noApproval),
    JSON.stringify({ advanced: rpcsNamed(noApproval, "advance_action").length, refused: refusedAsInternal(noApproval) }));
  const kindUnreadable = await advanceKnown({ status: "filed", action_kind: "exec.compile_brief", title: "Weekly brief" },
    { executor: "record_only", requires_approval: false }, { to_status: "drafted", draft_content: leakyEmail },
    { tableErrorsExtra: { "paige_action_kinds:select": { message: "boom", code: "XX000" } } });
  assert("31.18 ...and when the kind cannot be looked up, the draft is read",
    rpcsNamed(kindUnreadable, "advance_action").length === 0 && refusedAsInternal(kindUnreadable),
    JSON.stringify({ advanced: rpcsNamed(kindUnreadable, "advance_action").length }));
  const withIds = await advanceKnown({ status: "filed", action_kind: "sales.work_followup", title: "Follow up" },
    { executor: "send_via_approval", requires_approval: true },
    { to_status: "drafted", draft_content: { channel: "email", contact_id: OWN, subject: "Checking in", body: "Hi Dana, how was your week?" } });
  assert("31.18 CONTROL: a customer email's contact id and channel are not read as its text",
    rpcsNamed(withIds, "advance_action").length === 1 && !refusedAsInternal(withIds),
    JSON.stringify({ advanced: rpcsNamed(withIds, "advance_action").length, refused: refusedAsInternal(withIds) }));

  // Executing a portal action shows the client its STORED title and draft, which nothing attached now carries.
  const surface = (title) => advanceKnown({ status: "drafted", action_kind: "client.portal_recommendation", title, summary: "Next step",
    draft_content: { body: "Book your next session when it suits you." } }, { executor: "surface_to_client", requires_approval: false }, { to_status: "executing" });
  const storedLeak = await surface(`Your next step. ${PLANTS[1][1]}`);
  assert("31.19 executing a portal action whose stored title carries internal text shows the client nothing",
    rpcsNamed(storedLeak, "advance_action").length === 0 && refusedAsInternal(storedLeak),
    JSON.stringify({ advanced: rpcsNamed(storedLeak, "advance_action").length, refused: refusedAsInternal(storedLeak) }));
  const surfacedClean = await surface("Your next step");
  assert("31.19 CONTROL: executing a clean portal action runs", rpcsNamed(surfacedClean, "advance_action").length === 1 && !refusedAsInternal(surfacedClean),
    JSON.stringify({ advanced: rpcsNamed(surfacedClean, "advance_action").length }));

  // Depth and shape are no way past. String() flattens a body nested any depth into its strings before the
  // queue stores it, and Postgres's ->> writes a portal action's object body out whole, keys and all.
  let nested = ["Hi Dana,", PLANTS[0][1]];
  for (let i = 0; i < 6; i += 1) nested = [nested];
  const deep = await propose(nested);
  assert("31.21 a drafted email whose body is a list nested six deep is read too, and not filed",
    approvalsFiled(deep).length === 0 && refusedAsInternal(deep), JSON.stringify({ filed: approvalsFiled(deep).length }));
  const objectBody = (body) => advanceKnown({ status: "drafted", action_kind: "client.portal_recommendation", title: "Your next step",
    summary: "Next step", draft_content: { body } }, { executor: "surface_to_client", requires_approval: false }, { to_status: "executing" });
  const keyed = await objectBody({ update_client_data: "Book your next session when it suits you." });
  assert("31.21 executing a portal action whose stored body is an object with an internal key shows the client nothing",
    rpcsNamed(keyed, "advance_action").length === 0 && refusedAsInternal(keyed),
    JSON.stringify({ advanced: rpcsNamed(keyed, "advance_action").length, refused: refusedAsInternal(keyed) }));
  const plainKeyed = await objectBody({ note: "Book your next session when it suits you." });
  assert("31.21 CONTROL: an object body whose keys are ordinary words runs",
    rpcsNamed(plainKeyed, "advance_action").length === 1 && !refusedAsInternal(plainKeyed),
    JSON.stringify({ advanced: rpcsNamed(plainKeyed, "advance_action").length }));
}

// ── 32. VIBE STUDIO V0 — THE STUDIO LIFT NEVER RUNS ABOVE THE CEILING; FUNNELS ARE REACHABLE AND TRUTHFUL ──
//
// D1: inside a Studio project the design agent's build tools are lifted from `confirm` to `auto`
// (#292). On Trust Compass rung 1 that lift ran writes the ceiling forbids. The lift now needs the
// canonical `resolve_tool_autonomy_detail.ceiling_allows_auto`. D2: the funnel tools fell through to
// "Unknown tool"; they are reachable, and a build that fails after an earlier write is PARTIAL.
// Each check names the mutation it kills.
{
  const THREAD = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
  const SESSION = "5e550000-0000-4000-8000-000000000001";
  const studioTables = (extra = {}) => ({
    paige_chat_threads: () => [{ studio_session_id: SESSION, summary: null, last_image_content_id: null, last_image_anchor_at: null }],
    paige_subagents: () => [{ name: "Design Studio", system_prompt: "You design pages for this business." }],
    studio_sessions: () => [{ id: SESSION, artifact_refs: [], title: "Spring launch" }],
    ...extra,
  });
  const wire = (r) => r.modelEgress.map((b) => (typeof b === "string" ? b : JSON.stringify(b))).join("\n").replace(/\\"/g, '"');
  const called = (r, name) => r.rec.rpc.filter((c) => c.name === name).length;
  const AS_TENANT = { get_actor_access: { data: { tier: "tenant" }, error: null } };
  // V1: the build tools ask the workspace-scoped authority, and a Studio turn reads its role scope
  // from the platform design-studio row (server client). Both answered as production would.
  const WS = { studio_role_ok: { data: true, error: null } };
  const STUDIO_TOOLS = ["ask_choices", "capability_status", "generate_image", "draft_marketing_content", "content_save", "growth_list",
    "growth_page_generate", "growth_page_save", "growth_page_publish", "growth_funnel_generate", "growth_funnel_build", "growth_funnel_publish",
    "growth_form_save", "growth_form_publish", "web_search", "web_fetch"];
  // Answers only the PLATFORM row read (slug design-studio, tenant_id IS NULL) — so dropping either
  // filter from the scope read fails the Studio checks instead of passing on a fixture that ignores them.
  const platformRowOnly = (row) => (filters) => (
    filters.some((f) => f[0] === "eq" && f[1] === "slug" && f[2] === "design-studio")
    && filters.some((f) => f[0] === "is" && f[1] === "tenant_id" && f[2] === null)
  ) ? [row] : [];
  const SCOPE_ROW = { paige_subagents: platformRowOnly({ config: { capability_scope: { version: 1, mode: "allowlist", tools: STUDIO_TOOLS } } }) };
  const PAGE_ROW = { growth_page_upsert: { data: { id: "page-1", slug: "spring-offer", status: "draft", tenant_id: null }, error: null } };
  const studioSave = async (ceilingAllowsAuto, { detailError = null } = {}) => {
    const st = makeConfirmStore();
    return drive({
      stream: true, extraBody: { threadId: THREAD },
      toolCall: { name: "growth_page_save", args: { title: "Spring offer", blocks: [] } },
      rpcOverrides: {
        ...AS_TENANT, ...WS, ...PAGE_ROW,
        resolve_tool_autonomy: { data: "confirm", error: null },
        resolve_tool_autonomy_detail: detailError
          ? { data: null, error: detailError }
          : { data: { mode: "confirm", ceiling_allows_auto: ceilingAllowsAuto }, error: null },
      },
      serviceTablesExtra: { user_roles: () => [{ role: "admin" }], ...SCOPE_ROW },
      tablesExtra: { ...studioTables(), paige_pending_confirmations: st.table },
      onInsert: mirrorConfirms(st),
    });
  };

  // ── 32.1 At a ceiling that forbids acting unread (rung 0-1), a Studio save is HELD, not run.
  // Kills: deleting `&& (await ceilingAllowsAuto(...))` from the Studio lift.
  const held = await studioSave(false);
  assert("32.1 rung 1: a Studio page save does not write — the ceiling's confirm stands",
    called(held, "growth_page_upsert") === 0, JSON.stringify(held.rec.rpc.map((c) => c.name)));
  assert("32.1b …it is offered for approval instead (a held proposal, not a silent drop)",
    /"needs_confirm":true/.test(wire(held)), wire(held).slice(0, 400));
  assert("32.1c …and the lift asked the ceiling fact, not only the mode",
    called(held, "resolve_tool_autonomy_detail") >= 1, JSON.stringify(held.rec.rpc.map((c) => c.name)));

  // ── 32.2 CONTROL: when the ceiling allows auto, the Studio lift still builds in the same turn.
  // Kills: removing the lift altogether (the #292 stall returns).
  const lifted = await studioSave(true);
  assert("32.2 rung 2+: a Studio page save runs without a card",
    called(lifted, "growth_page_upsert") === 1 && !/"needs_confirm":true/.test(wire(lifted)),
    JSON.stringify({ upserts: called(lifted, "growth_page_upsert") }));

  // ── 32.3 An unclear ceiling answer lifts nothing. Kills: treating an errored detail read as allow.
  const unclear = await studioSave(true, { detailError: { message: "function does not exist" } });
  assert("32.3 an errored ceiling read fails closed: no write",
    called(unclear, "growth_page_upsert") === 0, JSON.stringify(unclear.rec.rpc.map((c) => c.name)));

  // ── 32.4 Main PAIGE is untouched: outside a Studio thread the same save at `confirm` is held, and
  // the ceiling fact is never consulted. Kills: making the lift (or the detail read) global.
  const st4 = makeConfirmStore();
  const mainTurn = await drive({
    stream: true, extraBody: { threadId: THREAD },
    toolCall: { name: "growth_page_save", args: { title: "Spring offer", blocks: [] } },
    rpcOverrides: { ...AS_TENANT, ...WS, ...PAGE_ROW, resolve_tool_autonomy: { data: "confirm", error: null },
      resolve_tool_autonomy_detail: { data: { mode: "confirm", ceiling_allows_auto: true }, error: null } },
    serviceTablesExtra: { user_roles: () => [{ role: "admin" }], ...SCOPE_ROW },
    tablesExtra: { paige_chat_threads: () => [{ studio_session_id: null, summary: null }], paige_pending_confirmations: st4.table },
    onInsert: mirrorConfirms(st4),
  });
  assert("32.4 a main-PAIGE save at confirm is held and never reads the ceiling fact",
    called(mainTurn, "growth_page_upsert") === 0 && called(mainTurn, "resolve_tool_autonomy_detail") === 0,
    JSON.stringify(mainTurn.rec.rpc.map((c) => c.name)));

  // ── 32.5 D2: a funnel build reaches its handler (was "Unknown tool"). Kills: dropping the three
  // funnel names from the dispatch branch.
  const funnelArgs = { name: "Spring launch", page: { title: "Spring offer", blocks: [] }, form: { name: "Intake", schema: { fields: [{ id: "email", type: "email", label: "Email" }] } } };
  const funnelDrive = (formRow) => drive({
    stream: true, extraBody: { threadId: THREAD },
    toolCall: { name: "growth_funnel_build", args: funnelArgs },
    rpcOverrides: {
      ...AS_TENANT, ...WS, ...PAGE_ROW,
      resolve_tool_autonomy: { data: "auto", error: null },
      growth_form_upsert: formRow,
      growth_funnel_upsert: { data: { id: "funnel-1", slug: "spring-launch" }, error: null },
    },
    serviceTablesExtra: { user_roles: () => [{ role: "admin" }], ...SCOPE_ROW },
  });
  const built = await funnelDrive({ data: { id: "form-1", slug: "intake" }, error: null });
  assert("32.5 growth_funnel_build runs its handler: page, form and funnel are written",
    !/Unknown tool: growth_funnel_build/.test(wire(built)) && called(built, "growth_page_upsert") === 1
      && called(built, "growth_form_upsert") === 1 && called(built, "growth_funnel_upsert") === 1,
    JSON.stringify(built.rec.rpc.map((c) => c.name)));

  // ── 32.6 A build whose form comes back without an id is PARTIAL, names what was saved, and never
  // builds the funnel. Kills: the silent form-step drop, or reporting success after a partial write.
  const half = await funnelDrive({ data: null, error: null });
  assert("32.6 a missing form id stops the build: no funnel row, outcome partial, the saved page named",
    called(half, "growth_funnel_upsert") === 0 && /"outcome":"partial"/.test(wire(half))
      && /"saved_drafts":\{"page_id":"page-1"\}/.test(wire(half)) && !/"success":true,"funnel_id"/.test(wire(half)),
    wire(half).slice(0, 600));

  // ── 32.7 A TRANSPORT failure after the page landed is UNKNOWN, never "not built". Kills: mapping
  // every later throw to `partial`, which invites a duplicate funnel on retry.
  const lost = await drive({
    stream: true, extraBody: { threadId: THREAD },
    toolCall: { name: "growth_funnel_build", args: funnelArgs },
    rpcOverrides: {
      ...AS_TENANT, ...WS, ...PAGE_ROW,
      resolve_tool_autonomy: { data: "auto", error: null },
      growth_form_upsert: { data: { id: "form-1", slug: "intake" }, error: null },
      growth_funnel_upsert: { data: null, error: { message: "fetch failed: connection reset" } },
    },
    serviceTablesExtra: { user_roles: () => [{ role: "admin" }], ...SCOPE_ROW },
  });
  assert("32.7 a lost funnel write reports outcome_unknown, not 'was not built'",
    /"outcome_unknown":true/.test(wire(lost)) && !/was not built/.test(wire(lost)),
    wire(lost).slice(0, 600));

  // ── 32.8 A partial build inside a Studio project links its saved drafts to the project (§19).
  // Kills: linking only successful results, which leaves the saved page unreachable from the rail.
  const partialStudio = await drive({
    stream: true, extraBody: { threadId: THREAD },
    toolCall: { name: "growth_funnel_build", args: funnelArgs },
    rpcOverrides: {
      ...AS_TENANT, ...WS, ...PAGE_ROW,
      resolve_tool_autonomy: { data: "auto", error: null },
      growth_form_upsert: { data: null, error: null },
    },
    serviceTablesExtra: { user_roles: () => [{ role: "admin" }], ...SCOPE_ROW },
    tablesExtra: studioTables(),
  });
  assert("32.8 a partial Studio funnel build links the saved page to the project",
    partialStudio.rec.rpc.some((c) => c.name === "link_session_artifact" && c.args?.p_kind === "page" && c.args?.p_artifact_id === "page-1"),
    JSON.stringify(partialStudio.rec.rpc.filter((c) => c.name === "link_session_artifact").map((c) => c.args)));

  // ── 32.9 A funnel built without a form does not claim an intake form. Kills: the fixed note.
  const noForm = await drive({
    stream: true, extraBody: { threadId: THREAD },
    toolCall: { name: "growth_funnel_build", args: { name: "Spring launch", page: { title: "Spring offer", blocks: [] } } },
    rpcOverrides: { ...AS_TENANT, ...WS, ...PAGE_ROW, resolve_tool_autonomy: { data: "auto", error: null },
      growth_funnel_upsert: { data: { id: "funnel-1", slug: "spring-launch" }, error: null } },
    serviceTablesExtra: { user_roles: () => [{ role: "admin" }], ...SCOPE_ROW },
  });
  assert("32.9 a funnel with no form is saved and its note names no intake form",
    /"funnel_id":"funnel-1"/.test(wire(noForm)) && !/intake form, and the flow/.test(wire(noForm)),
    wire(noForm).slice(0, 600));

  // ── 33. VIBE STUDIO V1 — THE STUDIO CAPABILITY BOUNDARY IS RUNTIME, NOT PROMPT ─────────────────
  //
  // A Studio turn is OFFERED only the design-studio role's scope (read from the platform row), and
  // dispatch REFUSES anything outside it — two independent enforcements, each mutation-tested. Main
  // PAIGE keeps every tool. D3: the build tools ask the workspace-scoped `studio_role_ok`.
  const FORBIDDEN = ["crm_create_contact", "crm_update_deal", "ghl_run_action", "member_grant_role", "calendar_book_meeting"];
  const offered = (r) => r.modelEgress.flatMap((body) => {
    try { const parsed = JSON.parse(body); return Array.isArray(parsed.tools) ? parsed.tools : []; } catch { return []; }
  }).map((t) => t.name ?? t.function?.name);
  // The refusal travels as a JSON string inside the next model request, so its quotes arrive escaped.
  const scopeRefused = (r, name) => new RegExp(`"error":"outside_studio_scope","message":"\\\\*"${name}\\\\*" isn't something the design studio can do`).test(wire(r));
  const AUTO_LANE = { resolve_tool_autonomy: { data: "auto", error: null } };
  const studioTurn = (toolCall, scope = SCOPE_ROW, extraRpc = {}, functionsExtra = {}) => drive({
    stream: true, extraBody: { threadId: THREAD }, toolCall, functionsExtra,
    rpcOverrides: { ...AS_TENANT, ...WS, ...AUTO_LANE, ...extraRpc },
    serviceTablesExtra: { user_roles: () => [{ role: "admin" }], ...scope },
    tablesExtra: studioTables(),
  });
  const mainDrive = (toolCall, extraRpc = {}, roles = [{ role: "admin" }], functionsExtra = {}) => drive({
    stream: true, extraBody: { threadId: THREAD }, toolCall, functionsExtra, classification: null,
    rpcOverrides: { ...AS_TENANT, ...WS, ...AUTO_LANE, ...PAGE_ROW, ...extraRpc },
    serviceTablesExtra: { user_roles: () => roles, ...SCOPE_ROW },
    tablesExtra: { paige_chat_threads: () => [{ studio_session_id: null, summary: null }] },
  });

  // 33.1 INVISIBLE. Kills: removing the narrowToolDefs filter.
  const look = await studioTurn(undefined);
  const studioOffered = offered(look);
  assert("33.1 a Studio turn is not offered any of the five forbidden tools",
    studioOffered.length > 0 && FORBIDDEN.every((t) => !studioOffered.includes(t)), JSON.stringify(studioOffered));
  assert("33.1b …it is offered exactly its scope's design tools (nothing outside the allowlist)",
    studioOffered.includes("growth_page_save") && studioOffered.every((t) => STUDIO_TOOLS.includes(t)),
    JSON.stringify(studioOffered.filter((t) => !STUDIO_TOOLS.includes(t))));
  assert("33.1c Knowledge writes and document_generate are not offered in Studio",
    !studioOffered.includes("save_to_knowledge_base") && !studioOffered.includes("document_generate"), JSON.stringify(studioOffered));

  // 33.2 REFUSED AT DISPATCH even when the model names them. Kills: removing the dispatch guard.
  for (const name of FORBIDDEN) {
    const tried = await studioTurn({ name, args: {} });
    assert(`33.2 a Studio turn that calls ${name} anyway is refused outside_studio_scope`,
      scopeRefused(tried, name), wire(tried).slice(0, 300));
  }
  const kbTried = await studioTurn({ name: "save_to_knowledge_base", args: { title: "x", content: "y" } });
  assert("33.2b save_to_knowledge_base is refused in Studio (Knowledge writes wait for V5)",
    scopeRefused(kbTried, "save_to_knowledge_base"), wire(kbTried).slice(0, 300));

  // 33.3 MAIN PAIGE UNCHANGED: the same five are offered and are not scope-refused.
  const mainLook = await mainDrive(undefined);
  const mainOffered = offered(mainLook);
  assert("33.3 main PAIGE is still offered all five", FORBIDDEN.every((t) => mainOffered.includes(t)), JSON.stringify(FORBIDDEN.filter((t) => !mainOffered.includes(t))));
  for (const name of FORBIDDEN) {
    const tried = await mainDrive({ name, args: {} });
    const w = wire(tried);
    // Reached its own path: the CRM door was invoked, or its handler ran an RPC beyond the turn's
    // baseline reads, or the risk gate held it as a proposal — and no scope or unknown-tool refusal.
    const baseline = new Set(["check_rate_limit", "current_user_tenant_id", "is_platform_operator", "is_platform_owner", "get_paige_persona_context", "match_paige_memory", "get_actor_access", "resolve_tool_autonomy", "match_tenant_knowledge", "match_rag_documents", "paige_operating_memory"]);
    const reached = tried.rec.functions.length > 0 || /"needs_confirm":true/.test(w) || tried.rec.rpc.some((c) => !baseline.has(c.name));
    assert(`33.3b main PAIGE calling ${name} reaches its own path (no scope or unknown-tool refusal)`,
      reached && !w.includes("outside_studio_scope") && !/Unknown tool/.test(w),
      JSON.stringify({ functions: tried.rec.functions.map((f) => f.name), rpcs: tried.rec.rpc.map((c) => c.name).filter((n) => !baseline.has(n)) }));
  }

  // 33.4 FAIL CLOSED: no usable scope on the platform row. Kills: defaulting to the full tool list.
  const noScope = { paige_subagents: platformRowOnly({ config: {} }) };
  const blind = await studioTurn(undefined, noScope);
  assert("33.4 a missing scope offers only the fail-closed set (no writes)",
    offered(blind).length > 0 && offered(blind).every((t) => ["ask_choices", "capability_status"].includes(t)), JSON.stringify(offered(blind)));
  const blindSave = await studioTurn({ name: "growth_page_save", args: { title: "x", blocks: [] } }, noScope, PAGE_ROW);
  assert("33.4b …and refuses a build tool at dispatch",
    scopeRefused(blindSave, "growth_page_save") && called(blindSave, "growth_page_upsert") === 0, wire(blindSave).slice(0, 300));
  const widened = { paige_subagents: platformRowOnly({ config: { capability_scope: { mode: "everything", tools: ["*"] } } }) };
  const wide = await studioTurn({ name: "crm_create_contact", args: {} }, widened);
  assert("33.4c a malformed scope cannot widen: still refused", scopeRefused(wide, "crm_create_contact"), wire(wide).slice(0, 300));

  // 33.5 D3: workspace-scoped authority. Kills: keeping the tenant-agnostic global-admin check.
  const otherWorkspaceAdmin = await mainDrive({ name: "growth_page_save", args: { title: "x", blocks: [] } },
    { studio_role_ok: { data: false, error: null } }, [{ role: "admin" }]);
  assert("33.5 a global admin who is not this workspace's owner/admin cannot build here",
    called(otherWorkspaceAdmin, "growth_page_upsert") === 0 && wire(otherWorkspaceAdmin).includes("workspace_owner_or_admin_required"),
    wire(otherWorkspaceAdmin).slice(0, 300));
  const ownerNoGlobalRole = await mainDrive({ name: "growth_page_save", args: { title: "x", blocks: [] } },
    { studio_role_ok: { data: true, error: null } }, []);
  assert("33.5b this workspace's owner builds without any global role",
    called(ownerNoGlobalRole, "growth_page_upsert") === 1, JSON.stringify(ownerNoGlobalRole.rec.rpc.map((c) => c.name)));
  // 33.5c Every Studio build tool's backend now asks the workspace question (Migration D moved
  // save_marketing_content; studio-caller moved the draft functions), so content_save and the two
  // generate tools ask it in chat too: this workspace's owner reaches them without any global role.
  // Kills: leaving any of them on the tenant-agnostic global-role gate.
  for (const [tool, args, reach] of [
    ["content_save", { title: "x", body: "y" }, (r) => called(r, "save_marketing_content") === 1],
    ["growth_page_generate", { brief: "a page for our spring offer" }, (r) => r.rec.functions.some((f) => f.name === "growth-page-draft")],
    ["growth_funnel_generate", { brief: "a funnel for our spring offer" }, (r) => r.rec.functions.some((f) => f.name === "growth-funnel-draft")],
  ]) {
    const ownerOnly = await mainDrive({ name: tool, args }, { studio_role_ok: { data: true, error: null } }, []);
    assert(`33.5c ${tool}: this workspace's owner reaches its backend without any global role`,
      // Exactly two asks of the actor-explicit seat question: once at prompt time (cached — operator
      // mode and the capability projection share it) and once, fresh, for this tool call (shared by
      // every check the call passes). C0a. Never the active-workspace `studio_role_ok` for this gate.
      reach(ownerOnly) && called(ownerOnly, "is_tenant_admin_as") === 2,
      JSON.stringify({ fns: ownerOnly.rec.functions.map((f) => f.name), rpcs: ownerOnly.rec.rpc.map((c) => c.name) }));
  }

  // 33.5d Image generation and copy drafting ask the same workspace question as their backends
  // (_shared/studio-caller.ts). Kills: leaving them on the global-role chat gate, where a workspace
  // owner without the global role is refused in chat and a global admin outside the workspace passes
  // the chat gate only to be refused by the backend.
  const invoked = (r, name) => r.rec.functions.filter((f) => f.name === name).length;
  for (const [tool, fn, args] of [
    ["generate_image", "generate-image", { prompt: "a calm hero image" }],
    ["draft_marketing_content", "content-draft", { channel: "social_post", brief: "spring launch for our clients" }],
  ]) {
    const owner = await mainDrive({ name: tool, args }, { studio_role_ok: { data: true, error: null } }, []);
    assert(`33.5d ${tool}: this workspace's owner reaches ${fn} without any global role`,
      // Exactly two asks of the actor-explicit seat question: prompt time (cached) and fresh for the call.
      invoked(owner, fn) === 1 && called(owner, "is_tenant_admin_as") === 2,
      JSON.stringify({ fns: owner.rec.functions.map((f) => f.name), rpcs: owner.rec.rpc.map((c) => c.name) }));
    const outsider = await mainDrive({ name: tool, args }, { studio_role_ok: { data: false, error: null } }, [{ role: "admin" }]);
    assert(`33.5e ${tool}: a global admin who is not this workspace's owner/admin is refused before ${fn}`,
      invoked(outsider, fn) === 0 && wire(outsider).includes("workspace_owner_or_admin_required"),
      wire(outsider).slice(0, 300));
    // 33.5f The backend's own refusal (a non-2xx whose message only the body carries) reaches the
    // model as itself, never "Unknown error". Kills: `if (error) throw error` before reading the body.
    const REFUSAL = "That isn't the workspace you're signed in to. Nothing was created.";
    const refused = await mainDrive({ name: tool, args }, { studio_role_ok: { data: true, error: null } }, [], {
      [fn]: { data: null, error: { message: "Edge Function returned a non-2xx status code", context: { json: async () => ({ error: REFUSAL, forbidden: true }) } } },
    });
    assert(`33.5f ${tool}: the backend's workspace refusal reaches the model verbatim`,
      wire(refused).includes(REFUSAL) && !wire(refused).includes("non-2xx"), wire(refused).slice(0, 400));
  }

  // 33.5g The growth draft functions refuse with their own body shape ({ error: { code, message },
  // forbidden: true }); that reason reaches the model verbatim too. Kills: throwing before the body.
  for (const [tool, fn] of [["growth_page_generate", "growth-page-draft"], ["growth_funnel_generate", "growth-funnel-draft"]]) {
    const REASON = "Only this workspace's owner or an admin can use the Studio.";
    const refusedDraft = await mainDrive({ name: tool, args: { brief: "a page for our spring offer" } }, { studio_role_ok: { data: true, error: null } }, [], {
      [fn]: { data: null, error: { message: "Edge Function returned a non-2xx status code", context: { json: async () => ({ error: { code: "FORBIDDEN", message: REASON }, forbidden: true }) } } },
    });
    assert(`33.5g ${tool}: the draft backend's workspace refusal reaches the model verbatim`,
      wire(refusedDraft).includes(REASON) && !wire(refusedDraft).includes("non-2xx"), wire(refusedDraft).slice(0, 400));
  }

  // 33.6 A Studio thread whose second read fails still runs as a Studio turn, fail-closed — never as
  // main PAIGE with every tool. Kills: dropping the preStudioSessionId fallback.
  const flaky = await drive({
    stream: true, extraBody: { threadId: THREAD }, toolCall: { name: "crm_create_contact", args: {} },
    rpcOverrides: { ...AS_TENANT, ...WS, ...AUTO_LANE },
    serviceTablesExtra: { user_roles: () => [{ role: "admin" }], ...SCOPE_ROW },
    tablesExtra: studioTables(),
    tableErrorsExtra: { paige_chat_threads: ({ filters }) => (filters.some((f) => f[0] === "select" && String(f[1]).includes("summary")) ? { message: "connection reset", code: "08006" } : null) },
  });
  assert("33.6 a Studio thread whose re-read fails is still fail-closed Studio: off-scope tool refused, only the fail-closed set offered",
    scopeRefused(flaky, "crm_create_contact") && offered(flaky).every((t) => ["ask_choices", "capability_status"].includes(t)),
    JSON.stringify({ offered: offered(flaky), refused: scopeRefused(flaky, "crm_create_contact") }));

  // ── 34. V2a: every Studio act files one honest receipt, through the shared ledger ──────────────
  const receipts = (r, key) => r.rec.rpc.filter((c) => c.name === "record_capability_run" && c.args?._capability_key === key);
  const onlyReceipt = (r, key) => { const rs = receipts(r, key); return rs.length === 1 ? rs[0] : null; };
  const allReceipts = (r) => r.rec.rpc.filter((c) => c.name === "record_capability_run").map((c) => `${c.args?._capability_key}:${c.args?._outcome}`);

  // 34.1 A saved page files one success, on the server client, saying how it was approved and which
  // page it touched. Kills: leaving pages without a receipt; recording through the caller's client.
  const pageSaved = await mainDrive({ name: "growth_page_save", args: { title: "Spring offer", blocks: [] } });
  const pr = onlyReceipt(pageSaved, "growth_page_save");
  assert("34.1 a saved page files one success receipt with its approval channel and page id",
    pr && pr.client === "service" && pr.args._outcome === "capability_succeeded"
      && pr.args._detail?.approval === "standing_autonomy_setting" && pr.args._detail?.page_id === "page-1",
    JSON.stringify(allReceipts(pageSaved)) + " " + JSON.stringify(pr?.args?._detail ?? null));

  // 34.2 A save whose answer never came back may have landed: it is recorded as unknown, never as
  // refused or failed. (An unproven publish takes the same path; its classification is pinned in
  // studio-run-outcome.test.ts, since a publish waits for approval here.) Kills: the forms-era rule
  // that filed every non-success as a refusal.
  const lostSave = await mainDrive({ name: "content_save", args: { title: "x", body: "y" } },
    { save_marketing_content: { data: null, error: { code: "", message: "TypeError: fetch failed", details: "", hint: "" } } });
  assert("34.2 a save whose answer was lost files capability_outcome_unknown",
    onlyReceipt(lostSave, "content_save")?.args._outcome === "capability_outcome_unknown", JSON.stringify(allReceipts(lostSave)));

  // 34.3 A caller who is not this workspace's owner/admin is refused before the write, and the
  // refusal is on the record. Kills: a pre-executor refusal that leaves no trace.
  const notOwner = await mainDrive({ name: "growth_page_save", args: { title: "x", blocks: [] } },
    { studio_role_ok: { data: false, error: null } }, []);
  const nr = onlyReceipt(notOwner, "growth_page_save");
  assert("34.3 a not-owner refusal files a refused receipt and writes nothing",
    called(notOwner, "growth_page_upsert") === 0 && nr?.args._outcome === "capability_refused"
      && nr?.args._detail?.refused === "workspace_owner_or_admin_required",
    JSON.stringify(allReceipts(notOwner)));

  // 34.4 A Studio act switched off is refused on the record too.
  const switchedOff = await mainDrive({ name: "content_save", args: { title: "x", body: "y" } },
    { resolve_tool_autonomy: { data: "off", error: null } });
  assert("34.4 a switched-off Studio act files a refused receipt and writes nothing",
    called(switchedOff, "save_marketing_content") === 0 && onlyReceipt(switchedOff, "content_save")?.args._detail?.refused === "turned_off",
    JSON.stringify(allReceipts(switchedOff)));

  // 34.5 Images: one key, one receipt. Outside a project the chat files it; inside a project paige-
  // media owns every receipt for its job, so the chat files none. Kills: double-counting an image.
  const plainImage = await mainDrive({ name: "generate_image", args: { prompt: "a calm hero image" } }, {}, [], {
    "generate-image": { data: { url: "https://cdn.example.test/i.png", content_id: "c-1", provider: "gemini" }, error: null },
  });
  assert("34.5 an image outside a project files one vibe_media_image success and nothing under generate_image",
    onlyReceipt(plainImage, "vibe_media_image")?.args._outcome === "capability_succeeded"
      && onlyReceipt(plainImage, "vibe_media_image")?.args._detail?.content_id === "c-1"
      && receipts(plainImage, "generate_image").length === 0,
    JSON.stringify(allReceipts(plainImage)));
  // Inside a project paige-media files the receipt once a job exists, and for a budget refusal; any
  // other outcome (a synchronous refusal, an answer that never came) is filed by the chat — exactly
  // one receipt per attempt. Kills: skipping every Studio image (refusals vanish) or none (doubles).
  const IMG = { name: "generate_image", args: { prompt: "a calm hero image" } };
  const jobImage = await studioTurn(IMG, SCOPE_ROW, {}, { "paige-media": { data: { job: { id: "job-1", state: "queued", model: "m" } }, error: null } });
  assert("34.5b an image inside a project that became a paige-media job files no chat receipt (paige-media files it)",
    receipts(jobImage, "vibe_media_image").length === 0 && receipts(jobImage, "generate_image").length === 0,
    JSON.stringify(allReceipts(jobImage)));
  const nonJson = (body) => ({ data: null, error: { message: "Edge Function returned a non-2xx status code", context: { json: async () => body } } });
  const overBudget = await studioTurn(IMG, SCOPE_ROW, {}, { "paige-media": nonJson({ error: "This month's image budget is used up.", budget_denied: true, gate: "ceiling" }) });
  assert("34.5c a budget refusal inside a project files no chat receipt (paige-media filed it)",
    receipts(overBudget, "vibe_media_image").length === 0, JSON.stringify(allReceipts(overBudget)));
  const mediaRefused = await studioTurn(IMG, SCOPE_ROW, {}, { "paige-media": nonJson({ error: "No image provider is set up for this workspace." }) });
  assert("34.5d a synchronous paige-media refusal inside a project is filed once, by the chat, as refused",
    onlyReceipt(mediaRefused, "vibe_media_image")?.args._outcome === "capability_refused", JSON.stringify(allReceipts(mediaRefused)));

  // 34.6 Drafting copy saves nothing, so it runs without an approval card even when the workspace
  // asks Paige to confirm every write (owner ruling 2026-10-04), and files no receipt.
  const draftUnderConfirm = await mainDrive({ name: "draft_marketing_content", args: { channel: "social_post", brief: "spring launch for our clients" } },
    { resolve_tool_autonomy: { data: "confirm", error: null } }, [], {
      "content-draft": { data: { channel: "social_post", drafts: [{ content: "Spring is here." }] }, error: null },
    });
  assert("34.6 a copy draft runs without an approval card under confirm, and files no receipt",
    draftUnderConfirm.rec.functions.some((f) => f.name === "content-draft") && !/"needs_confirm":true/.test(wire(draftUnderConfirm))
      && allReceipts(draftUnderConfirm).length === 0,
    wire(draftUnderConfirm).slice(0, 300));
  const saveUnderConfirm = await mainDrive({ name: "content_save", args: { title: "x", body: "y" } },
    { resolve_tool_autonomy: { data: "confirm", error: null } });
  assert("34.6b saving copy still asks first under confirm",
    called(saveUnderConfirm, "save_marketing_content") === 0 && /"needs_confirm":true/.test(wire(saveUnderConfirm)),
    wire(saveUnderConfirm).slice(0, 300));
}

// ── 35. VIBE STUDIO V2b — ONE PUBLISH DOOR ───────────────────────────────────────────────────
//
// Chat publishing no longer runs its own RPC, readback, gate or receipt. The three publish tools hand
// the act to growth-publish-command — the Studio Publish panel's door — whose 202 becomes the chat's
// Needs-your-OK card; an approved card goes back to the door with the stored fingerprint, and the door
// alone claims it, runs it, proves it and files the one receipt. Each check names the mutation it kills.
console.log("\nV2b — chat publishing goes through the one publish door");
{
  const THREAD = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
  const PAGE_ID = "3a3a3a3a-3a3a-4a3a-8a3a-3a3a3a3a3a3a";
  const FP = "0f0f0f0f0f0f0f0f";
  const PERSONA = { get_paige_persona_context: { data: [{ tenant_id: CALLER_TENANT }], error: null } };
  const frames = (r) => r.bodyText.split("\n").filter((l) => l.startsWith("data: ") && l !== "data: [DONE]")
    .map((l) => { try { return JSON.parse(l.slice(6)); } catch { return null; } }).filter(Boolean);
  const cards = (r) => frames(r).filter((f) => f.paige_confirm).flatMap((f) => [].concat(f.paige_confirm));
  const outcomes = (r) => frames(r).filter((f) => f.paige_approval_outcome).map((f) => f.paige_approval_outcome);
  const doorCalls = (r) => r.rec.functions.filter((f) => f.name === "growth-publish-command");
  const publishRpcs = (r) => r.rec.rpc.filter((c) => /^growth_(page|form|funnel)_publish$/.test(c.name));
  const chatReceipts = (r) => r.rec.rpc.filter((c) => c.name === "record_capability_run");
  const publishDrive = ({ approved, rows = [], answer, lane = "confirm" } = {}) => {
    const store = makeConfirmStore(rows);
    return drive({
      stream: true, extraBody: { threadId: THREAD, ...(approved ? { approvedConfirmations: approved } : {}) },
      toolCall: { name: "growth_page_publish", args: { page_id: PAGE_ID } },
      rpcOverrides: { get_actor_access: { data: { tier: "tenant" }, error: null }, resolve_tool_autonomy: { data: lane, error: null },
        studio_role_ok: { data: true, error: null }, ...PERSONA },
      serviceTablesExtra: { user_roles: () => [{ role: "admin" }] },
      tablesExtra: { paige_pending_confirmations: store.table, paige_chat_threads: () => [{ studio_session_id: null, summary: null }] },
      onInsert: mirrorConfirms(store),
      functionsExtra: answer ? { "growth-publish-command": answer } : {},
    }).then((r) => ({ ...r, store }));
  };

  // 35.1 A first call asks the door — never the RPC — and its 202 becomes ONE card carrying the door's
  // fingerprint. Kills: leaving the inline growth_page_publish RPC in chat; minting a second (chat-gate)
  // proposal beside the door's.
  const asked = await publishDrive({ answer: { data: { ok: false, approval_required: true, fingerprint: FP,
    summary: 'Publish the page "Spring offer" at /p/acme/spring-offer.', preview: { kind: "page" } }, error: null } });
  const askedCards = cards(asked);
  assert("35.1 chat publish invokes growth-publish-command with the operator's JWT, marked as a chat attempt (so a refusal is filed), and calls no publish RPC",
    doorCalls(asked).length === 1 && publishRpcs(asked).length === 0
      && JSON.stringify(doorCalls(asked)[0].body) === JSON.stringify({ action: "publish", kind: "page", id: PAGE_ID, expected_tenant_id: CALLER_TENANT, chat_attempt: true })
      && doorCalls(asked)[0].headers?.Authorization === "Bearer test-jwt",
    JSON.stringify({ door: doorCalls(asked), rpcs: publishRpcs(asked).map((c) => c.name) }));
  assert("35.1b …the door's 202 is the one Needs-your-OK card, with the door's fingerprint, and chat stored no proposal of its own",
    askedCards.length === 1 && askedCards[0].fingerprint === FP && /Spring offer/.test(askedCards[0].summary ?? "") && asked.store.rows.length === 0,
    JSON.stringify({ cards: askedCards, stored: asked.store.rows.length }));
  assert("35.1c …and chat files no receipt for the proposal (the door files receipts, once, for acts)",
    chatReceipts(asked).length === 0, JSON.stringify(chatReceipts(asked).map((c) => c.args?._capability_key)));

  // 35.2 Approving the card hands the door the STORED proposal: its fingerprint and its artifact id,
  // whatever the model re-emits. The chat runs nothing itself and files no receipt. Kills: executing the
  // model's re-emitted id; a chat-side claim; a second receipt beside the door's.
  const stored = { user_id: USER, tenant_id: CALLER_TENANT, thread_id: null, scoped_client_id: null, tool_name: "growth_page_publish", fingerprint: FP,
    issued_in_request: "an-earlier-request", args: { action: "publish", kind: "page", id: PAGE_ID, expected_tenant_id: CALLER_TENANT, approval_subject: `publish:page:${PAGE_ID}`, approval_cycle_nonce: "11111111-2222-4333-8444-555555555555" } };
  const approvedRun = await publishDrive({ approved: [FP], rows: [stored],
    answer: { data: { ok: true, action: "publish", kind: "page", id: PAGE_ID, status: "published", published_at: "2026-10-04T10:00:00Z", url: "/p/acme/spring-offer", receipt_recorded: true }, error: null } });
  assert("35.2 an approved card sends the door the stored id and the fingerprint; chat calls no publish RPC and leaves the claim to the door",
    doorCalls(approvedRun).length === 1 && doorCalls(approvedRun)[0].body.approved_fingerprint === FP && doorCalls(approvedRun)[0].body.id === PAGE_ID
      && publishRpcs(approvedRun).length === 0 && approvedRun.store.rows[0].consumed === false,
    JSON.stringify({ door: doorCalls(approvedRun).map((c) => c.body), consumed: approvedRun.store.rows[0].consumed }));
  assert("35.2b …one receipt total: the chat files none for the publish (the door filed it)",
    chatReceipts(approvedRun).length === 0, JSON.stringify(chatReceipts(approvedRun).map((c) => `${c.args?._capability_key}:${c.args?._outcome}`)));
  assert("35.2c …the card that asked reports the approval as ran, from the door's answer",
    JSON.stringify(outcomes(approvedRun)[0]) === JSON.stringify({ actions: [{ fingerprint: FP, outcome: "ran" }] }), JSON.stringify(outcomes(approvedRun)));
  assert("35.2d …and Paige is told the real address the door returned",
    /\/p\/acme\/spring-offer/.test(approvedRun.modelEgress.join("\n")), "");

  // 35.3 Even on an `auto` lane, chat's legacy gate does not run for a publish: the door decides (and
  // clamps high-risk to a card). Kills: chat executing a publish on its own auto lane.
  const autoLane = await publishDrive({ lane: "auto", answer: { data: { ok: false, approval_required: true, fingerprint: FP, summary: "Publish it" }, error: null } });
  assert("35.3 on an auto lane chat still only asks the door; no publish RPC runs from chat",
    doorCalls(autoLane).length === 1 && publishRpcs(autoLane).length === 0 && cards(autoLane).length === 1,
    JSON.stringify({ door: doorCalls(autoLane).length, rpcs: publishRpcs(autoLane).length }));

  // 35.4 An answer that never came back is not "nothing changed": the card says couldn't confirm.
  const lost = await publishDrive({ approved: [FP], rows: [stored], answer: { data: null, error: Object.assign(new Error("Failed to send a request to the Edge Function"), { name: "FunctionsFetchError", context: new TypeError("fetch failed") }) } });
  assert("35.4 a lost door answer is reported as couldn't confirm, never ran or didn't run",
    outcomes(lost)[0]?.actions?.[0]?.outcome === "unconfirmed" && /"outcome_unknown":true/.test(lost.modelEgress.join("\n").replace(/\\"/g, '"')),
    JSON.stringify(outcomes(lost)));
}

console.log("\nsurface-aware self-knowledge — what she can do, what the owner says, and what is operator scope (owner 2026-10-05)");
{
  // THE CASE THE OWNER SURFACED: in their Solo workspace they said the dev team is building Marketing and
  // Sales, and PAIGE answered as if she were tracking the platform build herself. Three sources must stay
  // apart in what she is SENT: the per-turn capability projection (what she can do here), what the person
  // TELLS her (their account), and operator-only program state (never in a workspace chat — not even when
  // the human in the workspace is the platform owner). These checks read the real system prompt the
  // handler built; what a real model then SAYS is not provable here (scripted model double).
  const { CAPABILITY_TRUTH_RULE } = await import("../../supabase/functions/_shared/paige-capability-status/render.ts");
  const OWNER_MARKER = "PRIVATE-OPERATOR-PRIORITY-MARKER";
  const ownerMemory = {
    paige_owner_memory: () => [{ memory_type: "active_priority", content: `${OWNER_MARKER} — wire Marketing and Sales into the platform.`, created_at: new Date().toISOString() }],
  };
  // The platform owner's actor tier is `god`; that is the hardest case for a leak, so it is the one driven.
  const OPERATOR = { is_platform_operator: { data: true, error: null }, get_actor_access: { data: { tier: "god" }, error: null } };
  const SOLO_OWNER = { ...OPERATOR, studio_role_ok: { data: true, error: null } };
  const OPERATOR_ONLY = ["=== OPERATOR BRIEFING", "DOCTRINE §-INDEX", "PLATFORM SNAPSHOT", OWNER_MARKER];
  const streamed = (r) => { try { return JSON.parse(r.modelEgress.find((x) => { try { return JSON.parse(x).stream === true; } catch { return false; } }) ?? "null"); } catch { return null; } };
  const sysText = (r) => { const b = streamed(r); return typeof b?.system === "string" ? b.system : JSON.stringify(b?.system ?? ""); };
  // The system prompt as sent, with JSON escaping undone, so a rule containing quotes can be found whole.
  const sysPlain = (r) => { const b = streamed(r); return typeof b?.system === "string" ? b.system : (Array.isArray(b?.system) ? b.system.map((x) => x?.text ?? "").join("\n") : ""); };
  const emitted = (r) => new Set((streamed(r)?.tools ?? []).map((t) => t?.name).filter(Boolean));
  const capabilityBlock = (r) => {
    const sys = sysPlain(r);
    const at = sys.indexOf("WHAT YOU CAN ACTUALLY DO HERE");
    if (at < 0) return "";
    const end = sys.indexOf("\n\n=====", at + 10);
    return sys.slice(at, end > at ? end : undefined);
  };

  // A — a Solo owner who is ALSO a platform operator, describing the roadmap in their own workspace.
  const solo = await drive({
    stream: true, rpcOverrides: SOLO_OWNER, serviceTablesExtra: ownerMemory, classification: null,
    text: "We're building Sales and Marketing inside you right now.",
  });
  const soloSys = sysPlain(solo);
  assert("38.1 a Solo turn (owner who is also a platform operator) carries the who-said-it contract beside the capability block",
    capabilityBlock(solo).includes(CAPABILITY_TRUTH_RULE),
    JSON.stringify({ hasBlock: capabilityBlock(solo).length > 0, hasRule: soloSys.includes(CAPABILITY_TRUTH_RULE) }));
  // …and its referent is true in both places it is read (the block and the capability_status note), and a
  // claimed capability is answered with the state the report gives it before the scenario-E line is used.
  const stateFirstAt = CAPABILITY_TRUTH_RULE.indexOf("answer with the state this report gives it");
  const lastResortAt = CAPABILITY_TRUTH_RULE.indexOf("That's the direction you've given me, but this workspace does not currently expose that capability to me yet.");
  assert("38.2 …the contract tells her to attribute owner-described plans, answer a claim with its listed state, and hold the projection over an owner's claim (A, E)",
    CAPABILITY_TRUTH_RULE.includes("Based on what you're telling me") && CAPABILITY_TRUTH_RULE.includes("this capability report")
      && !/this block/i.test(CAPABILITY_TRUTH_RULE) && stateFirstAt > -1 && lastResortAt > stateFirstAt
      && CAPABILITY_TRUTH_RULE.slice(stateFirstAt, lastResortAt).includes("Only when it is not listed as something you can do at all"),
    JSON.stringify({ stateFirstAt, lastResortAt, head: CAPABILITY_TRUTH_RULE.slice(0, 120) }));
  // B / §52 — the human is the platform owner, but the SURFACE is a workspace: no operator briefing,
  // no doctrine index, no platform snapshot, no owner-memory row.
  assert("38.3 no operator briefing or program-state text reaches a workspace chat, even for the platform owner (B, §52/§53)",
    OPERATOR_ONLY.every((m) => !sysText(solo).includes(m)),
    JSON.stringify(OPERATOR_ONLY.filter((m) => sysText(solo).includes(m))));
  // The capability block lists only what this turn really emitted, under the projection's own headings.
  const HEADINGS = ["CAN DO NOW", "CAN PREPARE FOR YOUR APPROVAL", "NEEDS A CONNECTION OR SETUP FIRST", "CAN ATTEMPT, BUT NOT PROVEN HERE YET", "NOT SOMETHING YOU CAN DO HERE YET", "CANNOT CONFIRM FOR THIS WORKSPACE", "NOT AVAILABLE TO THIS PERSON HERE"];
  const blockText = capabilityBlock(solo);
  const tools = emitted(solo);
  let section = "";
  const strays = [];
  const sectionsSeen = new Set();
  for (const line of blockText.split("\n")) {
    const heading = HEADINGS.find((h) => line.startsWith(h));
    if (heading) { section = heading; sectionsSeen.add(heading); continue; }
    if (line.startsWith("YOUR SPECIALISTS")) { section = "specialists"; continue; }
    const m = line.match(/^- [^:]+: (.+?)(?: — .*)?$/);
    if (!m || section === "specialists" || section === "NOT SOMETHING YOU CAN DO HERE YET") continue;
    for (const name of m[1].split(", ")) if (!tools.has(name)) strays.push(`${section}: ${name}`);
  }
  assert("38.4 the capability block names only tools emitted this turn, each under a projection state heading",
    tools.size > 0 && sectionsSeen.size > 0 && strays.length === 0,
    JSON.stringify({ emitted: tools.size, sections: [...sectionsSeen], strays: strays.slice(0, 5) }));

  // D — the SAME operator, tenant-less: the operator surface is unchanged. The briefing is reached (the
  // control that 38.3 is not passing on a broken loader), and no workspace capability block is built.
  const operator = await drive({ stream: true, rpcOverrides: OPERATOR, serviceTablesExtra: ownerMemory, text: "What's on the table?" });
  assert("38.5 CONTROL (D) — on the tenant-less operator surface the operator briefing still arrives, unchanged",
    sysText(operator).includes("=== OPERATOR BRIEFING") && sysText(operator).includes(OWNER_MARKER),
    sysText(operator).slice(0, 120));
  assert("38.6 …and that surface gets no workspace capability block (operator scope is not a workspace)",
    capabilityBlock(operator) === "", capabilityBlock(operator).slice(0, 80));
  // §52 UNKNOWN SCOPE: the persona read FAILED, so whether this is a workspace turn is unknown, and the
  // handler's default persona (a null tenant) looks exactly like the operator surface. The operator's
  // briefing must not even be LOADED on such a turn. (Measured at base: the turn was already refused
  // before the model by the active-workspace re-check — 409 ACTIVE_ACCOUNT_CHANGED — so this is defence
  // in depth on the load, not a briefing that reached a model.)
  const unknownScope = await drive({
    stream: true, serviceTablesExtra: ownerMemory, text: "What's on the table?",
    rpcOverrides: { ...OPERATOR, get_paige_persona_context: { data: null, error: { message: "fixture: persona read failed" } } },
  });
  const ownerMemoryReads = unknownScope.rec.from.filter((f) => f.table === "paige_owner_memory");
  assert("38.7 a failed persona read never loads the operator briefing (an unknown scope is not tenant-less)",
    ownerMemoryReads.length === 0 && unknownScope.modelEgress.every((b) => OPERATOR_ONLY.every((m) => !b.includes(m))),
    JSON.stringify({ ownerMemoryReads: ownerMemoryReads.length, status: unknownScope.status, egress: unknownScope.modelEgress.length }));

  // THE ROLLING SUMMARY. A folded summary is model-written prose about what was SAID; read back as
  // "things you already know", an owner's roadmap remark became her own knowledge on later turns.
  const THREAD = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
  const SAID = "SUMMARY-MARKER the owner said the dev team is building Marketing and Sales.";
  const recalled = await drive({
    stream: true, rpcOverrides: SOLO_OWNER, extraBody: { threadId: THREAD }, text: "Where were we?",
    tablesExtra: { paige_chat_threads: () => [{ studio_session_id: null, summary: SAID, message_count: 3, summary_through_seq: 0, last_compacted_at: null }] },
  });
  const recallSys = sysPlain(recalled);
  const recallAt = recallSys.indexOf("CONVERSATION MEMORY");
  const recallLine = recallAt >= 0 ? recallSys.slice(recallAt, recallSys.indexOf(SAID, recallAt)) : "";
  assert("38.8 the rolling summary reaches her as her recollection of what was said, not as things she knows",
    recallSys.includes(SAID) && /recollection of what was said/i.test(recallLine) && !/things you already know/i.test(recallLine),
    recallLine.slice(0, 200));
  // …and the summarizer is told to keep the owner's account attributed, and not to log an action Paige
  // never took (a live summary recorded "flagging the mismatch to the dev team" — there is no such channel).
  const turnsAt = new Date(Date.now() - 3600_000).toISOString();
  const folding = await drive({
    stream: true, rpcOverrides: SOLO_OWNER, extraBody: { threadId: THREAD }, text: "Next.",
    tablesExtra: {
      paige_chat_threads: () => [{ studio_session_id: null, summary: null, message_count: 16, summary_through_seq: 0, last_compacted_at: null }],
      paige_chat_turns: () => Array.from({ length: 16 }, (_, i) => ({ role: i % 2 ? "assistant" : "user", content: `turn ${i + 1}`, seq: i + 1, created_at: turnsAt })),
    },
  });
  const foldBody = folding.modelEgress.find((x) => x.includes("Maintain a rolling memory")) ?? "";
  assert("38.9 the summarizer is told to attribute what the owner SAID about plans and never to record an action Paige did not take",
    foldBody.length > 0 && foldBody.includes("the owner said") && /never record a promise to pass something on/i.test(foldBody),
    JSON.stringify({ folded: foldBody.length > 0, tail: foldBody.slice(foldBody.indexOf("PRESERVE"), foldBody.indexOf("PRESERVE") + 420) }));

  // THE THREAD MUST BE THIS WORKSPACE'S (§9). RLS lets the platform owner read EVERY thread, so a
  // super_admin standing in their Solo workspace could name a platform-lens thread (tenant_id NULL) and
  // its operator summary would be folded and read into the Solo prompt — a verifier proved that with a
  // probe. The fixture rows below model what RLS returns to the platform owner: the row, whatever its
  // workspace. Every thread read and write keys on the id alone, so the refusal has to come first.
  const PLATFORM_THREAD = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
  const PLATFORM_SUMMARY = "PLATFORM-THREAD-SUMMARY-MARKER the operator's program priorities for this week.";
  const SUPER_ADMIN_SOLO = { ...SOLO_OWNER, is_platform_owner: { data: true, error: null } };
  const threadRow = (tenantId, summary, extra = {}) => () => [{
    tenant_id: tenantId, lens: tenantId === null ? "platform" : "coach", studio_session_id: null, summary,
    message_count: 16, summary_through_seq: 0, last_compacted_at: null, last_image_content_id: null, last_image_anchor_at: null, ...extra,
  }];
  const foldableTurns = () => Array.from({ length: 16 }, (_, i) => ({ role: i % 2 ? "assistant" : "user", content: `platform turn ${i + 1}`, seq: i + 1, created_at: turnsAt }));
  const threadWrites = (r) => ({
    appends: r.rec.rpc.filter((c) => c.name === "paige_chat_turn_append").length,
    threadUpdates: r.rec.from.filter((f) => f.table === "paige_chat_threads" && f.op === "update").length,
  });
  const crossed = await drive({
    stream: true, rpcOverrides: SUPER_ADMIN_SOLO, ownerRpc: { data: true, error: null }, extraBody: { threadId: PLATFORM_THREAD }, text: "Where were we?",
    tablesExtra: { paige_chat_threads: threadRow(null, PLATFORM_SUMMARY), paige_chat_turns: foldableTurns },
  });
  const crossedBody = (() => { try { return JSON.parse(crossed.bodyText); } catch { return null; } })();
  assert("38.10 a super_admin in their Solo workspace naming a platform-lens thread is refused 409 ACTIVE_ACCOUNT_CHANGED (§9)",
    crossed.status === 409 && crossedBody?.code === "ACTIVE_ACCOUNT_CHANGED",
    JSON.stringify({ status: crossed.status, body: crossed.bodyText.slice(0, 160) }));
  assert("38.11 …and that thread's summary never reaches any model call — not the turn, not the fold — and nothing is written to it",
    crossed.modelEgress.every((b) => !b.includes("PLATFORM-THREAD-SUMMARY-MARKER") && !b.includes("platform turn 1"))
      && threadWrites(crossed).appends === 0 && threadWrites(crossed).threadUpdates === 0,
    JSON.stringify({ egress: crossed.modelEgress.length, leaked: crossed.modelEgress.some((b) => b.includes("PLATFORM-THREAD-SUMMARY-MARKER")), ...threadWrites(crossed) }));
  // The same rule for a thread in ANOTHER tenant workspace, and for a thread whose owner could not be read.
  const foreign = await drive({
    stream: true, rpcOverrides: SUPER_ADMIN_SOLO, ownerRpc: { data: true, error: null }, extraBody: { threadId: PLATFORM_THREAD }, text: "Where were we?",
    tablesExtra: { paige_chat_threads: threadRow(OTHER_TENANT, PLATFORM_SUMMARY) },
  });
  const unread = await drive({
    stream: true, rpcOverrides: SUPER_ADMIN_SOLO, ownerRpc: { data: true, error: null }, extraBody: { threadId: PLATFORM_THREAD }, text: "Where were we?",
    tablesExtra: { paige_chat_threads: threadRow(CALLER_TENANT, PLATFORM_SUMMARY) },
    tableErrorsExtra: { paige_chat_threads: ({ filters }) => (filters.some((f) => f[0] === "select" && String(f[1]).trim() === "tenant_id") ? { message: "connection reset", code: "08006" } : null) },
  });
  assert("38.12 a thread in another tenant workspace is refused the same way, before any model call",
    foreign.status === 409 && foreign.modelEgress.length === 0 && foreign.bodyText.includes("ACTIVE_ACCOUNT_CHANGED"),
    JSON.stringify({ status: foreign.status, egress: foreign.modelEgress.length }));
  assert("38.13 a thread whose owner could not be read is refused (an unknown owner is not a match)",
    unread.status === 409 && unread.modelEgress.length === 0 && unread.bodyText.includes("ACTIVE_ACCOUNT_CHANGED"),
    JSON.stringify({ status: unread.status, egress: unread.modelEgress.length }));
  // CONTROL — the same super_admin's own Solo thread still works, and its summary is what she recalls.
  const ownSolo = await drive({
    stream: true, rpcOverrides: SUPER_ADMIN_SOLO, ownerRpc: { data: true, error: null }, extraBody: { threadId: PLATFORM_THREAD }, text: "Where were we?",
    tablesExtra: { paige_chat_threads: threadRow(CALLER_TENANT, "OWN-SOLO-SUMMARY-MARKER we planned the spring launch.", { message_count: 3 }) },
  });
  assert("38.14 CONTROL — the same person's own Solo thread still answers, its summary reaches the turn, and the user turn is saved to it",
    ownSolo.status === 200 && sysPlain(ownSolo).includes("OWN-SOLO-SUMMARY-MARKER")
      && ownSolo.rec.rpc.some((c) => c.name === "paige_chat_turn_append" && c.args?.p_role === "user"),
    JSON.stringify({ status: ownSolo.status, recalled: sysPlain(ownSolo).includes("OWN-SOLO-SUMMARY-MARKER"), ...threadWrites(ownSolo) }));
  // CONTROL — on the tenant-less operator surface the platform thread is theirs (null matches null).
  const ownPlatform = await drive({
    stream: true, rpcOverrides: OPERATOR, ownerRpc: { data: true, error: null }, extraBody: { threadId: PLATFORM_THREAD }, text: "Where were we?",
    tablesExtra: { paige_chat_threads: threadRow(null, PLATFORM_SUMMARY, { message_count: 3 }) },
  });
  assert("38.15 CONTROL — the operator on their own tenant-less surface still reaches their platform thread and its summary",
    ownPlatform.status === 200 && sysPlain(ownPlatform).includes("PLATFORM-THREAD-SUMMARY-MARKER"),
    JSON.stringify({ status: ownPlatform.status, recalled: sysPlain(ownPlatform).includes("PLATFORM-THREAD-SUMMARY-MARKER") }));
  // THE REVERSE DIRECTION — on the tenant-less operator surface, a WORKSPACE's thread is not theirs either.
  // RLS admits the platform owner to it, so without the check its summary would be folded into the operator
  // prompt beside the §52 briefing. A check skipped whenever the persona tenant is null would pass every
  // case above; this one fails it.
  const operatorIntoWorkspace = await drive({
    stream: true, rpcOverrides: OPERATOR, ownerRpc: { data: true, error: null }, extraBody: { threadId: PLATFORM_THREAD }, text: "Where were we?",
    tablesExtra: { paige_chat_threads: threadRow(CALLER_TENANT, "WORKSPACE-THREAD-SUMMARY-MARKER the client's private plan.") },
  });
  assert("38.16 the operator on the tenant-less surface naming a workspace's thread is refused 409 and its summary reaches no model",
    operatorIntoWorkspace.status === 409 && operatorIntoWorkspace.bodyText.includes("ACTIVE_ACCOUNT_CHANGED")
      && operatorIntoWorkspace.modelEgress.every((b) => !b.includes("WORKSPACE-THREAD-SUMMARY-MARKER")) && threadWrites(operatorIntoWorkspace).appends === 0,
    JSON.stringify({ status: operatorIntoWorkspace.status, egress: operatorIntoWorkspace.modelEgress.length, ...threadWrites(operatorIntoWorkspace) }));
  // AN UNKNOWN SCOPE MATCHES NOTHING. A failed persona read leaves the default null tenant, which looks
  // exactly like the operator surface — so a null-tenant platform thread would "match" it. Refused.
  const unknownScopeThread = await drive({
    stream: true, ownerRpc: { data: true, error: null }, extraBody: { threadId: PLATFORM_THREAD }, text: "Where were we?",
    rpcOverrides: { ...OPERATOR, get_paige_persona_context: { data: null, error: { message: "fixture: persona read failed" } } },
    tablesExtra: { paige_chat_threads: threadRow(null, PLATFORM_SUMMARY), paige_chat_turns: foldableTurns },
  });
  assert("38.17 a turn whose scope is unknown (persona read failed) cannot use a null-tenant thread: refused 409, nothing reaches a model",
    unknownScopeThread.status === 409 && unknownScopeThread.bodyText.includes("ACTIVE_ACCOUNT_CHANGED")
      && unknownScopeThread.modelEgress.every((b) => !b.includes("PLATFORM-THREAD-SUMMARY-MARKER") && !b.includes("platform turn 1"))
      && threadWrites(unknownScopeThread).appends === 0,
    JSON.stringify({ status: unknownScopeThread.status, egress: unknownScopeThread.modelEgress.length, ...threadWrites(unknownScopeThread) }));
}

// ── 39. C4a — AN APPROVAL RESUMES THE SAME OBJECTIVE ON THE SERVER ───────────────────────────────
//
// docs/delivery/paige-conversational-loop-c4.md. Approve used to start a new request in which the
// MODEL had to re-emit the approved act; when it did not, nothing ran (prod, 30 days: 14 of 28
// approved general-gate proposals never executed). Now the server rebuilds the act from its stored
// row, claims it once through the existing gate, runs the stored arguments, and only then calls PAIGE
// with the result. Each check names the defect it catches; "red at base" means it fails on main.
console.log("\nC4a — an approval resumes the same objective on the server");
{
  const THREAD = "c4c4c4c4-c4c4-4c4c-8c4c-c4c4c4c4c4c4";
  const SUSPENDED = "5a5a5a5a-5a5a-4a5a-8a5a-5a5a5a5a5a5a";
  const TOOL = "update_client_data";
  const ARGS = { client_id: OWN, updates: { goal: "resume-stored-goal" } };
  const CONFIRM_LANE = { resolve_tool_autonomy: { data: "confirm", error: null } };
  const writes = (r) => r.outboundCalls.filter((c) => c.url.includes("paige-write-back"));
  const framesOf = (text) => String(text ?? "").split("\n").filter((l) => l.startsWith("data: ") && l !== "data: [DONE]")
    .flatMap((l) => { try { return [JSON.parse(l.slice(6))]; } catch { return []; } });
  const outcomeOf = (text) => framesOf(text).find((f) => f.paige_approval_outcome)?.paige_approval_outcome ?? null;
  const resumedFrames = (text) => framesOf(text).filter((f) => f.paige_turn?.event === "resumed");
  const savedAnswer = (r) => r.rec.rpc.filter((c) => c.name === "paige_chat_turn_append" && c.args?.p_role === "assistant").at(-1)?.args?.p_bundle_ref ?? null;
  const toldModel = (r) => r.modelEgress.join("\n").replace(/\\"/g, '"');
  const turnsWith = (token) => ({ paige_chat_turns: () => [
    { id: SUSPENDED, role: "assistant", content: "Here is what I'll change.", seq: 2, bundle_ref: { paige_confirm: [{ tool: TOOL, summary: "Update the goal", fingerprint: token }] } },
  ] });
  const propose = async (store, extra = {}) => {
    const r = await drive({
      stream: true, clientId: OWN, extraBody: { threadId: THREAD }, toolCall: { name: TOOL, args: ARGS },
      rpcOverrides: { ...CONFIRM_LANE, ...(extra.rpc ?? {}) },
      tablesExtra: { paige_pending_confirmations: store.table, ...(extra.tables ?? {}) },
      onInsert: mirrorConfirms(store),
    });
    return framesOf(r.bodyText).find((f) => f.paige_confirm)?.paige_confirm?.fingerprint ?? null;
  };
  const approve = (store, token, opts = {}) => drive({
    stream: true, clientId: OWN, text: "Approved — run it.",
    extraBody: { threadId: THREAD, ...(opts.declined ? { declinedConfirmations: [token] } : { approvedConfirmations: [token] }) },
    toolCall: opts.toolCall,
    rpcOverrides: { ...CONFIRM_LANE, ...(opts.rpc ?? {}) },
    tablesExtra: { paige_pending_confirmations: store.table, ...turnsWith(token), ...(opts.tables ?? {}) },
    onInsert: mirrorConfirms(store),
    concurrentRequests: opts.concurrent ?? 1,
  });

  // ── 39.1 THE PROD STRAND. Approve, and the model does NOT re-emit the act: it still runs, once,
  // from the STORED arguments. Red at base (nothing ran). Kills: deleting the resumed round.
  const st1 = makeConfirmStore();
  const token1 = await propose(st1);
  assert("39.0 the proposal minted a scoped card token (guards 39.1)", /^[0-9a-f]{16}:[0-9a-f-]{36}$/.test(token1 ?? ""), String(token1));
  const ran = await approve(st1, token1);
  assert("39.1 approved with NO model re-emit: the stored act runs exactly once, from the stored arguments",
    writes(ran).length === 1 && writes(ran)[0].body.includes("resume-stored-goal") && st1.rows[0]?.consumed === true,
    JSON.stringify({ writes: writes(ran).map((c) => c.body.slice(0, 120)), consumed: st1.rows[0]?.consumed, status: ran.status }));
  const outcome1 = outcomeOf(ran.bodyText);
  assert("39.1b the card reports it ran (the act's own result, never optimism)",
    outcome1?.actions?.length === 1 && outcome1.actions[0].fingerprint === token1 && outcome1.actions[0].outcome === "ran",
    JSON.stringify(outcome1));
  assert("39.1c PAIGE is called AFTER the act ran, with its result: the objective continues in the same answer",
    ran.modelEgress.length >= 1 && /"tool_use_id":"resume_[0-9a-f]{16}_[0-9a-f-]{36}"/.test(ran.modelEgress[0].replace(/\\"/g, '"')),
    ran.modelEgress[0]?.slice(0, 300));
  assert("39.1d the wire says resumed once, WORKING, after started and before the terminal",
    resumedFrames(ran.bodyText).length === 1 && resumedFrames(ran.bodyText)[0].paige_turn.state === "WORKING",
    JSON.stringify(framesOf(ran.bodyText).filter((f) => f.paige_turn).map((f) => f.paige_turn)));
  const resumeSteps = framesOf(ran.bodyText).filter((f) => String(f.paige_step?.id ?? "").includes("resume_")).map((f) => f.paige_step);
  assert("39.1e the resumed act's step closes done from its own result, on the same answer (C2b lifecycle)",
    resumeSteps.length >= 1 && resumeSteps.at(-1).status === "done" && resumeSteps.every((st) => st.kind === "action"),
    JSON.stringify(resumeSteps));

  // ── 39.2 A MODEL THAT RE-EMITS THE ACT AFTER THE RESUME is refused as already handled: no second
  // run, no new card. Red at base (the re-emit was the act; nothing said "already handled").
  const st2 = makeConfirmStore();
  const token2 = await propose(st2);
  const reemit = await approve(st2, token2, { toolCall: { name: TOOL, args: { ...ARGS, confirm: true } } });
  assert("39.2 the model re-emitting the resumed act is refused as already handled — one run, no new card",
    writes(reemit).length === 1 && st2.rows.length === 1
      && toldModel(reemit).includes("already_handled_this_reply")
      && !framesOf(reemit.bodyText).some((f) => f.paige_confirm),
    JSON.stringify({ writes: writes(reemit).length, rows: st2.rows.length, cards: framesOf(reemit.bodyText).filter((f) => f.paige_confirm).length }));

  // ── 39.2b …and a re-emit byte-identical to the stored call (no `confirm` key at all) is refused the
  // same way — never mistaken for the model repeating itself (a no-progress LIMIT stop). Kills:
  // counting the resumed round's signature as a model round's.
  const st2b = makeConfirmStore();
  const token2b = await propose(st2b);
  const identical = await approve(st2b, token2b, { toolCall: { name: TOOL, args: ARGS } });
  const terminal2b = framesOf(identical.bodyText).filter((f) => f.paige_turn && f.paige_turn.event !== "started" && f.paige_turn.event !== "resumed").at(-1)?.paige_turn;
  assert("39.2b a byte-identical re-emit is refused as already handled, and the turn does not end LIMIT_REACHED",
    writes(identical).length === 1 && toldModel(identical).includes("already_handled_this_reply") && terminal2b?.state !== "LIMIT_REACHED",
    JSON.stringify({ writes: writes(identical).length, terminal: terminal2b }));

  // ── 39.3 DOUBLE APPROVE (two POSTs, same token, at once): one execution; the loser says it can't
  // confirm — never "ran", never "nothing changed". Red at base (nothing ran in either).
  const st3 = makeConfirmStore();
  const token3 = await propose(st3);
  const doubled = await approve(st3, token3, { concurrent: 2 });
  const outcomes3 = doubled.responses.map((r) => outcomeOf(r.bodyText)?.actions?.[0]?.outcome ?? null).sort();
  const loserNote3 = doubled.responses.map((r) => outcomeOf(r.bodyText)).find((o) => o?.actions?.[0]?.outcome === "unconfirmed")?.note ?? "";
  assert("39.3 two approvals of one card at once: exactly one execution, from the stored arguments",
    writes(doubled).length === 1 && st3.rows.length === 1 && st3.rows[0].consumed === true,
    JSON.stringify({ writes: writes(doubled).length, rows: st3.rows.length }));
  assert("39.3b …the winner reports ran, the loser reports it can't confirm (it may already have happened)",
    JSON.stringify(outcomes3) === JSON.stringify(["ran", "unconfirmed"]) && /can't be used any more/.test(loserNote3),
    JSON.stringify({ outcomes3, loserNote3 }));
  // …and a refresh / reopen that sends the same approval again later runs nothing and says the same.
  const again3 = await approve(st3, token3);
  assert("39.3c the same approval sent again later runs nothing and reports can't confirm",
    writes(again3).length === 0 && outcomeOf(again3.bodyText)?.actions?.[0]?.outcome === "unconfirmed" && resumedFrames(again3.bodyText).length === 0,
    JSON.stringify(outcomeOf(again3.bodyText)));

  // ── 39.3d THE LOSER THAT ARRIVES JUST AFTER THE WINNER CLAIMED: its approval was used by another
  // request that started AFTER this one — the earlier-use check (claim time < this request's start)
  // cannot see that. It still says "can't confirm", never "Paige didn't run this"; and a re-emit of
  // the act is refused rather than becoming a fresh card for something that may already have run.
  const st3d = makeConfirmStore();
  const token3d = await propose(st3d);
  st3d.rows[0].consumed = true;
  // After this request began, and (as every real claim is) inside the proposal's window — a claim
  // stamped at or past `expires_at` is a shape only the expiry sweep produces (39.9b).
  st3d.rows[0].consumedAt = "2098-01-01T00:00:00.000Z";
  const late = await approve(st3d, token3d, { toolCall: { name: TOOL, args: { ...ARGS, confirm: true } } });
  const outcome3d = outcomeOf(late.bodyText);
  assert("39.3d an approval another request claimed after this one began: can't confirm, nothing runs, no fresh card",
    writes(late).length === 0 && st3d.rows.length === 1 && outcome3d?.actions?.[0]?.outcome === "unconfirmed"
      && /can't be used any more/.test(outcome3d?.note ?? "") && toldModel(late).includes("approval_already_used"),
    JSON.stringify({ writes: writes(late).length, rows: st3d.rows.length, outcome3d }));

  // ── 39.4 A TOKEN FROM ANOTHER SCOPE is not claimed and nothing runs. Each patch moves the stored
  // row out of this caller's user / tenant / thread / focused client. Kills: dropping a predicate
  // from the resume selection.
  const st4seed = makeConfirmStore();
  const token4 = await propose(st4seed);
  for (const [label, patch] of Object.entries({
    another_user: { user_id: FOREIGN }, another_tenant: { tenant_id: OTHER_TENANT },
    another_thread: { thread_id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd" }, another_client: { scoped_client_id: FOREIGN },
  })) {
    const st = makeConfirmStore([{ ...st4seed.rows[0], ...patch, consumed: false }]);
    const r = await approve(st, token4);
    assert(`39.4 a token whose proposal belongs to ${label.replace("_", " ")} is not claimed and nothing runs`,
      writes(r).length === 0 && !st.rows[0].consumed && resumedFrames(r.bodyText).length === 0,
      JSON.stringify({ writes: writes(r).length, consumed: st.rows[0].consumed }));
  }

  // ── 39.5 DECLINE IS UNCHANGED: recorded, nothing runs, no resume.
  const st5 = makeConfirmStore();
  const token5 = await propose(st5);
  const declined = await approve(st5, token5, { declined: true });
  assert("39.5 Not now still cancels the stored proposal and runs nothing; no resume",
    writes(declined).length === 0 && st5.rows[0].consumed === true && resumedFrames(declined.bodyText).length === 0 && !outcomeOf(declined.bodyText),
    JSON.stringify({ writes: writes(declined).length, consumed: st5.rows[0].consumed }));

  // ── 39.7 A→B→A. The approval was minted in workspace A. Arriving while B is active, the thread is
  // refused (409) before anything is claimed; back in A, it runs once; sent again, it runs nothing.
  const PERSONA = (tenant) => ({ get_paige_persona_context: { data: [{ tenant_id: tenant, tenant_name: "T", playbook_config: null, playbook_slug: null, funding_enabled: false, brand: null }], error: null } });
  const threadOfA = { paige_chat_threads: () => [{ id: THREAD, tenant_id: CALLER_TENANT, caller_user_id: USER, contact_id: null }] };
  const st7 = makeConfirmStore();
  const token7 = await propose(st7, { rpc: PERSONA(CALLER_TENANT), tables: threadOfA });
  const inB = await approve(st7, token7, { rpc: PERSONA(OTHER_TENANT), tables: threadOfA });
  assert("39.7 approval minted in A, request arrives with B active: 409, nothing claimed, nothing runs",
    inB.status === 409 && writes(inB).length === 0 && st7.rows[0]?.consumed === false && st7.rows[0]?.tenant_id === CALLER_TENANT,
    JSON.stringify({ status: inB.status, writes: writes(inB).length, row: st7.rows[0] && { consumed: st7.rows[0].consumed, tenant: st7.rows[0].tenant_id } }));
  const backInA = await approve(st7, token7, { rpc: PERSONA(CALLER_TENANT), tables: threadOfA });
  assert("39.7b …back in A, the same approval runs once under A's authority",
    backInA.status === 200 && writes(backInA).length === 1 && st7.rows[0].consumed === true, JSON.stringify({ status: backInA.status, writes: writes(backInA).length }));
  const againInA = await approve(st7, token7, { rpc: PERSONA(CALLER_TENANT), tables: threadOfA });
  assert("39.7c …and once more in A, nothing runs again", writes(againInA).length === 0, String(writes(againInA).length));

  // ── 39.8 WIRE = PERSIST: the saved answer carries turn_state.resumed and paige_resume, whose report
  // is byte-for-byte the frame the card read live. Red at base (no record of the resume at all).
  const saved1 = savedAnswer(ran);
  // (Imported defensively so this group can be run against main to show it is red there.)
  const { readResumeRecord } = await import("../../supabase/functions/_shared/paige-turn/resume.ts").catch(() => ({ readResumeRecord: () => null }));
  const rec1 = readResumeRecord(saved1?.paige_resume);
  assert("39.8 the saved answer records the resume: kind, the suspended turn, each act's outcome",
    saved1?.turn_state?.resumed?.kind === "approval" && rec1?.kind === "approval" && rec1.from_turn_id === SUSPENDED
      && JSON.stringify(rec1.outcomes) === JSON.stringify([{ tool: TOOL, outcome: "ran" }]),
    JSON.stringify(saved1 ? { turn_state: saved1.turn_state, paige_resume: saved1.paige_resume } : null));
  // The resumed round is not a model call: the record counts the ONE model call PAIGE made after it
  // and the ONE act that ran. Kills: counting the resumed round as a model round.
  assert("39.8a the saved turn counts what really happened: one model call, one act, FINAL",
    saved1?.turn_state?.state === "FINAL" && saved1.turn_state.rounds === 1 && saved1.turn_state.tools === 1
      && ran.modelEgress.filter((b) => b.includes('"stream":true')).length === 1,
    JSON.stringify({ turn_state: saved1?.turn_state, streamed: ran.modelEgress.filter((b) => b.includes('"stream":true')).length }));
  assert("39.8b the saved report is exactly the report the wire carried (the reload rebuilds the same card)",
    !!outcome1 && JSON.stringify(rec1?.approval_outcome) === JSON.stringify(outcome1),
    JSON.stringify({ saved: rec1?.approval_outcome, wire: outcome1 }));
  assert("39.8c an ordinary approval-less turn records no resume",
    !savedAnswer(declined)?.paige_resume && !savedAnswer(declined)?.turn_state?.resumed, JSON.stringify(savedAnswer(declined)));

  // ── 39.9 EXPIRED: nothing runs, and the card says it expired (not "Paige didn't run this").
  const st9 = makeConfirmStore();
  const token9 = await propose(st9);
  st9.rows[0].expires_at = "2000-01-01T00:00:00Z";
  const expired = await approve(st9, token9);
  const outcome9 = outcomeOf(expired.bodyText);
  assert("39.9 an expired approval runs nothing and the card says it expired",
    writes(expired).length === 0 && !st9.rows[0].consumed && outcome9?.actions?.[0]?.outcome === "not_run" && /expired/.test(outcome9?.note ?? "")
      && resumedFrames(expired.bodyText).length === 0,
    JSON.stringify(outcome9));

  // ── 39.10 THE LANE MOVED TO AUTO AFTER THE CARD: the resumed act still spends its approval (the
  // claim is the exactly-once), so a second send runs nothing. Kills: letting `auto` skip the claim.
  const st10 = makeConfirmStore();
  const token10 = await propose(st10);
  const autoNow = await approve(st10, token10, { rpc: { resolve_tool_autonomy: { data: "auto", error: null } } });
  const autoAgain = await approve(st10, token10, { rpc: { resolve_tool_autonomy: { data: "auto", error: null } } });
  assert("39.10 a lane moved to auto after the card still claims the approval: one run, then none",
    writes(autoNow).length === 1 && st10.rows[0].consumed === true && writes(autoAgain).length === 0,
    JSON.stringify({ first: writes(autoNow).length, consumed: st10.rows[0].consumed, second: writes(autoAgain).length }));

  // ── 39.11 THE BRAKE PULLED AFTER THE CARD (lane `off`) is honoured: nothing runs, nothing claimed.
  const st11 = makeConfirmStore();
  const token11 = await propose(st11);
  const off = await approve(st11, token11, { rpc: { resolve_tool_autonomy: { data: "off", error: null } } });
  assert("39.11 a lane switched off after the card: the resumed act does not run and the approval is not spent",
    writes(off).length === 0 && !st11.rows[0].consumed && outcomeOf(off.bodyText)?.actions?.[0]?.outcome === "not_run",
    JSON.stringify(outcomeOf(off.bodyText)));

  // ════ C4a review fixes (verifier + compliance, 2026-10-05). Each names the mutation it kills. ════

  // ── 39.12 THE PROMPT ONLY SAYS "IT ALREADY RAN" ON A TURN WHERE IT WAS ATTEMPTED. Rule 1 is neutral;
  // the resume note is turn-local. Kills: putting the note (or its claim) back into the standing prompt,
  // or adding the note on a turn the server did not carry forward.
  // Driven as the platform operator, whose prompt carries rule 1 (the CRM operator block), so the
  // standing rule's own wording is on the wire to check — not just the note's absence.
  // The platform operator is a super_admin role row (workspace-authority.ts: platformOperator).
  const OPERATOR = { is_platform_operator: { data: true, error: null }, is_super_admin: { data: true, error: null } };
  const OPERATOR_ROLE = { user_roles: [{ role: "super_admin" }] };
  const RESUME_NOTE_HEAD = "THIS TURN CARRIES AN APPROVAL FORWARD";
  const FALSE_CLAIM = "the platform runs that stored action itself and its result is already in this conversation";
  const NEUTRAL_RULE = "When there is no such result, do not say the action ran";
  const st12a = makeConfirmStore();
  const token12a = await propose(st12a, { rpc: OPERATOR, tables: OPERATOR_ROLE });
  const resumed12 = await approve(st12a, token12a, { rpc: OPERATOR, tables: OPERATOR_ROLE });
  assert("39.12 a resume turn tells PAIGE the approved act was attempted before she was asked (turn-local note); rule 1 stays neutral",
    resumedFrames(resumed12.bodyText).length === 1 && toldModel(resumed12).includes(RESUME_NOTE_HEAD)
      && toldModel(resumed12).includes(NEUTRAL_RULE) && !toldModel(resumed12).includes(FALSE_CLAIM),
    JSON.stringify({ resumed: resumedFrames(resumed12.bodyText).length, note: toldModel(resumed12).includes(RESUME_NOTE_HEAD), rule: toldModel(resumed12).includes(NEUTRAL_RULE) }));
  const st12 = makeConfirmStore();
  const token12 = await propose(st12, { rpc: OPERATOR, tables: OPERATOR_ROLE });
  // A read in the reply makes a second model call, whose messages are the loop's conversation — where
  // the note would be if it were added on every turn rather than only a resumed one.
  const legacyTurn = await approve(st12, token12.split(":")[0], { rpc: OPERATOR, tables: OPERATOR_ROLE, toolCall: { name: "capability_status", args: {} } });
  assert("39.12b an approval turn the server did NOT carry forward (a bare legacy token) is not told anything ran",
    resumedFrames(legacyTurn.bodyText).length === 0 && legacyTurn.modelEgress.length >= 2
      && !toldModel(legacyTurn).includes(RESUME_NOTE_HEAD) && !toldModel(legacyTurn).includes(FALSE_CLAIM)
      && toldModel(legacyTurn).includes(NEUTRAL_RULE),
    JSON.stringify({ resumed: resumedFrames(legacyTurn.bodyText).length, calls: legacyTurn.modelEgress.length, rule: toldModel(legacyTurn).includes(NEUTRAL_RULE) }));

  // ── 39.13 A DRIFTED RE-EMIT ON A LANE NOW `auto` IS NOT A SECOND WRITE. The lane moved to auto after
  // the card; the stored act runs (spending its approval), and the model's re-emit with different
  // arguments — a different act to the identity check — becomes a card, never a second run (VFY-A).
  // Kills: dropping the same-tool confirm clamp while a carried-forward act is in the reply.
  const st13 = makeConfirmStore();
  const token13 = await propose(st13);
  const drifted13 = await approve(st13, token13, {
    rpc: { resolve_tool_autonomy: { data: "auto", error: null } },
    toolCall: { name: TOOL, args: { client_id: OWN, updates: { goal: "drifted-goal" } } },
  });
  assert("39.13 lane moved to auto + a drifted re-emit: one write (the stored one), the drifted call is held as a card",
    writes(drifted13).length === 1 && writes(drifted13)[0].body.includes("resume-stored-goal")
      && !writes(drifted13).some((c) => c.body.includes("drifted-goal")) && /"needs_confirm":true/.test(toldModel(drifted13)),
    JSON.stringify({ writes: writes(drifted13).map((c) => c.body.slice(0, 120)) }));

  // ── 39.14 SAME SUBJECT, RE-AUTHORED CONTENT: refused as already handled — not a second change, not a
  // fresh card re-asking for an action the approval already carried forward. `draft_content` is part of
  // the act's identity (only `decision_rationale` is set aside), so a model that rewords the draft on its
  // re-emit is a different act to the identity check; the subject id is what recognises it.
  // Kills: removing the subject-key refusal (MV6). (Accepted cost, stated in the delivery record: a
  // genuinely different second change to the SAME action in the same reply is refused too, and can be
  // proposed on the next turn. action_advance is the only tool with a subject key.)
  const ACTION14 = "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a14";
  const st14 = makeConfirmStore();
  const advDrive = (body, toolCall) => drive({
    stream: true, extraBody: { threadId: THREAD, ...body }, toolCall,
    rpcOverrides: { ...CONFIRM_LANE, get_actor_access: { data: { tier: "tenant" }, error: null } },
    tablesExtra: { paige_pending_confirmations: st14.table, user_roles: [{ role: "admin" }], ...turnsWith("x") },
    onInsert: mirrorConfirms(st14),
  });
  const proposed14 = await advDrive({}, { name: "action_advance", args: { action_id: ACTION14, to_status: "drafted", draft_content: "Hi Sam, checking in on your week." } });
  const token14 = framesOf(proposed14.bodyText).find((f) => f.paige_confirm)?.paige_confirm?.fingerprint ?? null;
  const subj14 = await advDrive({ approvedConfirmations: [token14] },
    { name: "action_advance", args: { action_id: ACTION14, to_status: "drafted", draft_content: "Hi Sam, just checking in on how your week is going.", confirm: true } });
  const advanced14 = subj14.rec.rpc.filter((c) => c.name === "advance_action");
  assert("39.14 a same-subject re-emit with re-authored content is refused as already handled: one change, stored draft, no card",
    !!token14 && advanced14.length === 1 && JSON.stringify(advanced14[0].args).includes("checking in on your week.")
      && st14.rows.length === 1 && toldModel(subj14).includes("already_handled_this_reply") && !framesOf(subj14.bodyText).some((f) => f.paige_confirm),
    JSON.stringify({ token14, advanced: advanced14.map((c) => c.args), rows: st14.rows.length }));

  // ── 39.15 A ROW WHOSE STORED ARGUMENTS NO LONGER MATCH ITS CARD TOKEN is not carried forward at all.
  // Kills: dropping the integrity check from the resume selection (MV1) — the claim's own check would
  // still refuse it, but only after a "resumed" turn and a check-failed card for something never valid.
  const st15 = makeConfirmStore();
  const token15 = await propose(st15);
  st15.rows[0].args = { client_id: OWN, updates: { goal: "tampered-after-the-card" } };
  const tampered = await approve(st15, token15);
  assert("39.15 a stored proposal altered after its card was shown: no resume, nothing claimed, nothing runs",
    resumedFrames(tampered.bodyText).length === 0 && writes(tampered).length === 0 && !st15.rows[0].consumed,
    JSON.stringify({ resumed: resumedFrames(tampered.bodyText).length, writes: writes(tampered).length, consumed: st15.rows[0].consumed }));

  // ── 39.16 MANY CONSUMED ROWS OF THE SAME ACT do not crowd the live one out of the bounded read.
  // A thread where the same act was proposed again and again leaves consumed rows sharing the scoped
  // fingerprint. Kills: dropping the issuing-request narrowing from the resume selection.
  const st16 = makeConfirmStore();
  const token16 = await propose(st16);
  const live16 = st16.rows[0];
  for (let i = 0; i < 40; i += 1) {
    st16.rows.unshift({ ...structuredClone(live16), id: `old-${i}`, issued_in_request: crypto.randomUUID(), consumed: true, consumedAt: "2026-01-01T00:00:00.000Z" });
  }
  const crowded = await approve(st16, token16);
  assert("39.16 forty spent proposals of the same act ahead of the live one: the approved one still runs, once",
    writes(crowded).length === 1 && live16.consumed === true && resumedFrames(crowded.bodyText).length === 1,
    JSON.stringify({ writes: writes(crowded).length, consumed: live16.consumed }));

  // ── 39.9b A ROW THE EXPIRY SWEEP STAMPED (consumed at or after its window closed) says EXPIRED, not
  // "may already have happened". Kills: reading every consumed row as used elsewhere.
  const st9b = makeConfirmStore();
  const token9b = await propose(st9b);
  Object.assign(st9b.rows[0], { expires_at: "2000-01-01T00:00:00Z", consumed: true, consumedAt: "2000-01-01T00:05:00.000Z" });
  const swept = await approve(st9b, token9b);
  const outcome9b = outcomeOf(swept.bodyText);
  assert("39.9b an approval whose proposal the expiry sweep closed: nothing runs, the card says it expired",
    writes(swept).length === 0 && outcome9b?.actions?.[0]?.outcome === "not_run" && /expired/.test(outcome9b?.note ?? "")
      && resumedFrames(swept.bodyText).length === 0,
    JSON.stringify(outcome9b));

  // ── 39.9c A ROW THAT EXPIRES BETWEEN THE RESUME'S SELECTION AND ITS CLAIM says EXPIRED too, and PAIGE
  // is told the same. Kills: reading every failed claim on a no-longer-live row as "used elsewhere".
  const st9c = makeConfirmStore();
  const token9c = await propose(st9c);
  const expiringTable = (filters) => {
    const out = st9c.table(filters);
    const cols = filters.find(([op]) => op === "select")?.[1];
    if (cols === "fingerprint,args,issued_in_request,tool_name,consumed_at,expires_at") st9c.rows[0].expires_at = "2000-01-01T00:00:00Z";
    return out;
  };
  const expiring = await drive({
    stream: true, clientId: OWN, text: "Approved — run it.", extraBody: { threadId: THREAD, approvedConfirmations: [token9c] },
    rpcOverrides: { ...CONFIRM_LANE }, tablesExtra: { paige_pending_confirmations: expiringTable, ...turnsWith(token9c) },
    onInsert: mirrorConfirms(st9c),
  });
  const outcome9c = outcomeOf(expiring.bodyText);
  assert("39.9c an approval that expires between selection and claim: nothing runs, card and PAIGE both say expired",
    writes(expiring).length === 0 && !st9c.rows[0].consumed && outcome9c?.actions?.[0]?.outcome === "not_run"
      && /expired/.test(outcome9c?.note ?? "") && toldModel(expiring).includes("approval_expired"),
    JSON.stringify({ outcome9c, consumed: st9c.rows[0].consumed }));

  // ── 39.17 THE CAPABILITY FINGERPRINT: an approved tool this turn does not offer is not run, and the
  // approval is left unspent. Here a writer since removed from the chat manifest (the legacy CRM stage
  // writer, whose dispatch branch is tombstoned), approved on the owner seat. Red before the fix: the
  // stored row was claimed and the tombstoned branch dispatched (it answered contact_not_found).
  // Kills: removing the offered-tools check from the resume.
  const { confirmFingerprint: fpOf } = await import("../../supabase/functions/_shared/confirm-fingerprint.ts");
  const TENANT_PERSONA = { get_paige_persona_context: { data: [{ tenant_id: CALLER_TENANT, tenant_name: "T", playbook_config: null, playbook_slug: null, funding_enabled: false, brand: null }], error: null } };
  const tenantThread = { paige_chat_threads: () => [{ id: THREAD, tenant_id: CALLER_TENANT, caller_user_id: USER, contact_id: null, studio_session_id: null, summary: null }] };
  const OWNER_SEAT = { ...TENANT_PERSONA, get_actor_access: { data: { tier: "tenant" }, error: null }, studio_role_ok: { data: true, error: null } };
  const LEGACY = "crm_update_pipeline_stage";
  const legacyArgs = { contact_id: OWN, stage: "qualified" };
  const legacyNonce = "7e7e7e7e-7e7e-4e7e-8e7e-7e7e7e7e7e7e";
  const legacyFp = await fpOf(LEGACY, { intent: await fpOf(LEGACY, legacyArgs), tenant: CALLER_TENANT, thread: THREAD, client: null });
  const st17 = makeConfirmStore([{ user_id: USER, tenant_id: CALLER_TENANT, thread_id: THREAD, scoped_client_id: null, tool_name: LEGACY,
    fingerprint: legacyFp, issued_in_request: legacyNonce, args: legacyArgs, summary: "Move the contact to Qualified" }]);
  const withdrawn = await drive({
    stream: true, text: "Approved — run it.", extraBody: { threadId: THREAD, approvedConfirmations: [`${legacyFp}:${legacyNonce}`] },
    rpcOverrides: { ...CONFIRM_LANE, ...OWNER_SEAT }, tablesExtra: { paige_pending_confirmations: st17.table, ...tenantThread },
    onInsert: mirrorConfirms(st17),
  });
  const outcome17 = outcomeOf(withdrawn.bodyText);
  assert("39.17 an approved tool no longer offered this turn: not run, approval unspent, card says it no longer matches",
    !st17.rows[0].consumed && resumedFrames(withdrawn.bodyText).length === 0 && outcome17?.actions?.[0]?.outcome === "not_run"
      && /no longer matches anything Paige can run/.test(outcome17?.note ?? "") && !toldModel(withdrawn).includes("contact_not_found"),
    JSON.stringify({ consumed: st17.rows[0].consumed, outcome17 }));

  // ── 39.17b …and a model that names the withheld tool anyway (with the stored arguments) cannot spend
  // that approval by the other door, the approved-set lookup. Kills: dropping the lookup's skip of
  // approvals the resume already handled (MV8) — the withheld approval is the one the act-identity
  // clause does not cover, because nothing was carried forward for it.
  const st17b = makeConfirmStore([{ ...structuredClone(st17.rows[0]), id: "row-17b", consumed: false }]);
  const named = await drive({
    stream: true, text: "Approved — run it.", extraBody: { threadId: THREAD, approvedConfirmations: [`${legacyFp}:${legacyNonce}`] },
    toolCall: { name: LEGACY, args: { ...legacyArgs, confirm: true } },
    rpcOverrides: { ...CONFIRM_LANE, ...OWNER_SEAT }, tablesExtra: { paige_pending_confirmations: st17b.table, ...tenantThread },
    onInsert: mirrorConfirms(st17b),
  });
  assert("39.17b the withheld tool named by the model anyway does not spend the approval or reach its branch",
    !st17b.rows[0].consumed && !toldModel(named).includes("contact_not_found")
      && /no longer matches anything Paige can run/.test(outcomeOf(named.bodyText)?.note ?? outcomeOf(named.bodyText)?.actions?.[0]?.note ?? ""),
    JSON.stringify({ consumed: st17b.rows[0].consumed, outcome: outcomeOf(named.bodyText), rows: st17b.rows.length }));

  // ── 39.18 THE PROPOSER LOST THE ROLE BEFORE APPROVING (workspace admin → member): refused by the
  // role gate before any claim; the approval is left unspent. Tenant persona (§51 Standalone/Sub-account).
  const PAGE = { growth_page_upsert: { data: { id: "page-1", slug: "spring-offer", status: "draft", tenant_id: CALLER_TENANT }, error: null } };
  const st18 = makeConfirmStore();
  const pageDrive = (seat, body, toolCall) => drive({
    stream: true, extraBody: { threadId: THREAD, ...body }, toolCall,
    rpcOverrides: { ...CONFIRM_LANE, ...TENANT_PERSONA, ...PAGE, get_actor_access: { data: { tier: "tenant" }, error: null }, studio_role_ok: { data: seat, error: null } },
    tablesExtra: { paige_pending_confirmations: st18.table, ...tenantThread },
    onInsert: mirrorConfirms(st18),
  });
  const proposed18 = await pageDrive(true, {}, { name: "growth_page_save", args: { title: "Spring offer", blocks: [] } });
  const token18 = framesOf(proposed18.bodyText).find((f) => f.paige_confirm)?.paige_confirm?.fingerprint ?? null;
  const demoted = await pageDrive(false, { approvedConfirmations: [token18] });
  assert("39.18 a proposer demoted from admin before approving: refused by the role gate, nothing written, approval unspent",
    !!token18 && demoted.rec.rpc.filter((c) => c.name === "growth_page_upsert").length === 0 && st18.rows[0]?.consumed === false
      && toldModel(demoted).includes("workspace_owner_or_admin_required") && outcomeOf(demoted.bodyText)?.actions?.[0]?.outcome === "not_run",
    JSON.stringify({ token18, upserts: demoted.rec.rpc.filter((c) => c.name === "growth_page_upsert").length, consumed: st18.rows[0]?.consumed }));
  const reinstated = await pageDrive(true, { approvedConfirmations: [token18] });
  assert("39.18b …the same approval, once the role is back, runs once under the tenant's scope",
    reinstated.rec.rpc.filter((c) => c.name === "growth_page_upsert").length === 1 && st18.rows[0].consumed === true && st18.rows[0].tenant_id === CALLER_TENANT,
    JSON.stringify({ upserts: reinstated.rec.rpc.filter((c) => c.name === "growth_page_upsert").length }));

  // ── 39.19 GOD TIER (platform operator, no workspace). (a) The Operator client sends no threadId, so
  // its approvals are NOT carried forward: nothing is resumed and the model-re-emit path is unchanged
  // (the honest boundary — Operator is open work). (b) The same server, given a thread, resumes the
  // tenant-less proposal under the operator's own null scope, once.
  const st19 = makeConfirmStore();
  const opPropose = await drive({ stream: true, clientId: OWN, toolCall: { name: TOOL, args: ARGS }, rpcOverrides: { ...CONFIRM_LANE, ...OPERATOR },
    tablesExtra: { paige_pending_confirmations: st19.table, ...OPERATOR_ROLE }, onInsert: mirrorConfirms(st19) });
  const token19 = framesOf(opPropose.bodyText).find((f) => f.paige_confirm)?.paige_confirm?.fingerprint ?? null;
  const opApprove = await drive({ stream: true, clientId: OWN, text: "Approved — run it.", extraBody: { approvedConfirmations: [token19] },
    rpcOverrides: { ...CONFIRM_LANE, ...OPERATOR }, tablesExtra: { paige_pending_confirmations: st19.table, ...OPERATOR_ROLE }, onInsert: mirrorConfirms(st19) });
  assert("39.19 Operator (no threadId): no resume — nothing claimed, no resumed frame; the old path is unchanged",
    !!token19 && st19.rows[0]?.thread_id == null && resumedFrames(opApprove.bodyText).length === 0 && writes(opApprove).length === 0 && st19.rows[0]?.consumed === false,
    JSON.stringify({ token19, thread: st19.rows[0]?.thread_id, consumed: st19.rows[0]?.consumed }));
  const st19b = makeConfirmStore();
  const token19b = await propose(st19b, { rpc: OPERATOR, tables: OPERATOR_ROLE });
  const opThread = await approve(st19b, token19b, { rpc: OPERATOR, tables: OPERATOR_ROLE });
  assert("39.19b a tenant-less operator proposal on a thread is carried forward once under the operator's null scope",
    st19b.rows[0]?.tenant_id == null && writes(opThread).length === 1 && st19b.rows[0].consumed === true && resumedFrames(opThread.bodyText).length === 1,
    JSON.stringify({ tenant: st19b.rows[0]?.tenant_id, writes: writes(opThread).length }));

  // ── 39.20 STUDIO. (a) A design-studio save held for approval is carried forward once from its stored
  // proposal. (b) If the Studio scope stops offering the tool before the approval arrives, it is not run
  // and the approval is left unspent — the capability fingerprint, not just the dispatch scope guard.
  const SESSION20 = "5e550000-0000-4000-8000-000000000020";
  const STUDIO_TOOLS20 = ["ask_choices", "capability_status", "growth_page_save", "growth_list", "web_search"];
  const studioScope = (tools) => ({ paige_subagents: (filters) => (
    filters.some((f) => f[0] === "eq" && f[1] === "slug" && f[2] === "design-studio") && filters.some((f) => f[0] === "is" && f[1] === "tenant_id" && f[2] === null)
  ) ? [{ config: { capability_scope: { version: 1, mode: "allowlist", tools } } }] : [] });
  const studioThread = { paige_chat_threads: () => [{ studio_session_id: SESSION20, summary: null, last_image_content_id: null, last_image_anchor_at: null }],
    studio_sessions: () => [{ id: SESSION20, artifact_refs: [], title: "Spring launch" }] };
  const studioDrive = (st, tools, body, toolCall) => drive({
    stream: true, extraBody: { threadId: THREAD, ...body }, toolCall,
    rpcOverrides: { get_actor_access: { data: { tier: "tenant" }, error: null }, studio_role_ok: { data: true, error: null }, ...PAGE,
      resolve_tool_autonomy: { data: "confirm", error: null }, resolve_tool_autonomy_detail: { data: { mode: "confirm", ceiling_allows_auto: false }, error: null } },
    serviceTablesExtra: { user_roles: () => [{ role: "admin" }], ...studioScope(tools) },
    tablesExtra: { ...studioThread, paige_pending_confirmations: st.table },
    onInsert: mirrorConfirms(st),
  });
  const st20 = makeConfirmStore();
  const held20 = await studioDrive(st20, STUDIO_TOOLS20, {}, { name: "growth_page_save", args: { title: "Spring offer", blocks: [] } });
  const token20 = framesOf(held20.bodyText).find((f) => f.paige_confirm)?.paige_confirm?.fingerprint ?? null;
  const studioRan = await studioDrive(st20, STUDIO_TOOLS20, { approvedConfirmations: [token20] });
  assert("39.20 Studio: an approved held save is carried forward once from its stored proposal",
    !!token20 && studioRan.rec.rpc.filter((c) => c.name === "growth_page_upsert").length === 1 && st20.rows[0].consumed === true
      && resumedFrames(studioRan.bodyText).length === 1,
    JSON.stringify({ token20, upserts: studioRan.rec.rpc.filter((c) => c.name === "growth_page_upsert").length }));
  const st20b = makeConfirmStore();
  const held20b = await studioDrive(st20b, STUDIO_TOOLS20, {}, { name: "growth_page_save", args: { title: "Spring offer", blocks: [] } });
  const token20b = framesOf(held20b.bodyText).find((f) => f.paige_confirm)?.paige_confirm?.fingerprint ?? null;
  const narrowed = await studioDrive(st20b, STUDIO_TOOLS20.filter((t) => t !== "growth_page_save"), { approvedConfirmations: [token20b] });
  const outcome20b = outcomeOf(narrowed.bodyText);
  assert("39.20b Studio scope narrowed after the card: not run, approval unspent, the card says it no longer matches",
    !!token20b && narrowed.rec.rpc.filter((c) => c.name === "growth_page_upsert").length === 0 && !st20b.rows[0].consumed
      && resumedFrames(narrowed.bodyText).length === 0 && /no longer matches anything Paige can run/.test(outcome20b?.note ?? ""),
    JSON.stringify({ outcome20b, consumed: st20b.rows[0].consumed }));

  // ── 39.21 A DOOR TOOL'S ROW is never carried forward here, even one that (unlike real door rows)
  // carries a thread. Kills: letting door tools through `isResumableTool` (MV15) — on real rows the
  // thread predicate already excludes them, so only this shape can tell.
  const { CRM_COMMAND_TOOL_NAMES } = await import("../../supabase/functions/_shared/crm-command/catalog.ts");
  const { mutatingTools } = await import("../../supabase/functions/_shared/action-risk.ts");
  const DOOR = [...CRM_COMMAND_TOOL_NAMES].find((t) => mutatingTools().has(t));
  const doorArgs = { name: "Spring pipeline" };
  const doorNonce = "8e8e8e8e-8e8e-4e8e-8e8e-8e8e8e8e8e8e";
  const doorFp = await fpOf(DOOR, { intent: await fpOf(DOOR, doorArgs), tenant: null, thread: THREAD, client: OWN });
  const st21 = makeConfirmStore([{ user_id: USER, tenant_id: null, thread_id: THREAD, scoped_client_id: OWN, tool_name: DOOR,
    fingerprint: doorFp, issued_in_request: doorNonce, args: doorArgs, summary: "door act" }]);
  const doorTurn = await approve(st21, `${doorFp}:${doorNonce}`);
  assert("39.21 a door tool's proposal is never carried forward by the general resume (nothing claimed, no resumed frame)",
    !!DOOR && !st21.rows[0].consumed && resumedFrames(doorTurn.bodyText).length === 0,
    JSON.stringify({ DOOR, consumed: st21.rows[0].consumed }));
}

// C4c (group 41, and group 40's composition check) — THE TRANSCRIPT, as the database keeps it: one ordered store per scenario that the handler reads
// (with the caller's session, newest first) and appends to (paige_chat_turn_append), with the
// partial unique index modelled exactly — one USER turn per thread per `paige_resume.key` (23505).
const makeThreadStore = (threads) => {
  const turns = [];
  let seq = 0;
  const store = {
    turns,
    seed(threadId, role, content, bundle_ref = null, created_at = new Date().toISOString()) {
      const id = crypto.randomUUID();
      turns.push({ id, thread_id: threadId, role, content, bundle_ref: structuredClone(bundle_ref), seq: ++seq, created_at });
      return id;
    },
    table: (filters) => {
      const thread = filters.find(([op, col]) => op === "eq" && col === "thread_id")?.[2];
      if (!threads.some((t) => t.id === thread && t.caller_user_id === USER)) return []; // RLS: own threads only
      let rows = turns.filter((t) => t.thread_id === thread);
      const order = filters.find(([op]) => op === "order");
      rows = [...rows].sort((a, b) => (order?.[2]?.ascending === false ? b.seq - a.seq : a.seq - b.seq));
      const limit = filters.find(([op]) => op === "limit")?.[1];
      return rows.slice(0, limit ?? rows.length).map((t) => structuredClone(t));
    },
    threadsTable: (filters) => {
      const id = filters.find(([op, col]) => op === "eq" && col === "id")?.[2];
      return threads.filter((t) => t.id === id && t.caller_user_id === USER)
        .map((t) => ({ id: t.id, tenant_id: t.tenant_id, caller_user_id: t.caller_user_id, contact_id: null, studio_session_id: null, summary: null, title: "Kestrel onboarding", message_count: 2 }));
    },
    append: (args) => {
      const thread = threads.find((t) => t.id === args.p_thread_id);
      if (!thread) return { data: null, error: { code: "P0001", message: "thread not found" } };
      if (thread.caller_user_id !== USER) return { data: null, error: { code: "P0001", message: "thread not owned by caller" } };
      const key = args.p_role === "user" ? args.p_bundle_ref?.paige_resume?.key : undefined;
      if (key != null && turns.some((t) => t.thread_id === args.p_thread_id && t.role === "user" && t.bundle_ref?.paige_resume?.key === key)) {
        return { data: null, error: { code: "23505", message: 'duplicate key value violates unique constraint "paige_chat_turns_resume_uk"' } };
      }
      return { data: store.seed(args.p_thread_id, args.p_role, args.p_content, args.p_bundle_ref ?? null), error: null };
    },
  };
  return store;
};

// ── 40. C4b — A DOOR APPROVAL RESUMES ON THE SERVER ─────────────────────────────────────────────────
//
// docs/delivery/paige-conversational-loop-c4.md §3. A door (crm-command, the Sales doors,
// growth-publish-command) mints its own proposal — thread and client NULL, the bare fingerprint as the
// card token, the door's own stored request as `args`. Until C4b only a MODEL re-emitting the call
// reached the door with the approval (prod, 30 days: 8 of 21 door approvals never executed — deal_create
// 5 of 7, crm_create_contact 3 of 10). Now the server carries the approved proposal forward itself,
// pinned to the stored row, through the SAME door branch, and the door — still the only claim site —
// runs what it stored.
//
// THE CRM DOOR IN THESE CHECKS IS THE REAL ONE. `supabase/functions/crm-command/index.ts` is loaded
// through the same module boundary as the chat (its serve() captured), and `functions.invoke` routes
// to it: its own readback-before-claim, its atomic claim on the shared proposal store, its
// governed decision, its proposal minting and its executor call all run as shipped. Only the database
// is the harness's: the proposal store (makeConfirmStore, with real filter semantics), and the two
// executor RPCs, modelled as a committed-result table keyed by the idempotency key — which is exactly
// the contract crm-command reads (`read_crm_command_result`) and writes (`execute_crm_command`).
// The publish and Sales doors are MODELLED (their claim predicates, replay-before-claim and
// re-propose-on-failed-claim are cited at each model); they are not run here.
console.log("\nC4b — a door approval resumes on the server; the door stays the only claim site");
// A check below that approves a card the real door never minted cannot mean anything, so the group
// stops there with a NAMED failure carrying the door's own answer (proposeVia), never a TypeError on
// `card.fingerprint` that hides why. The rest of the harness still runs.
class Group40Abort extends Error {}
try {
  await import("../../supabase/functions/crm-command/index.ts");
  const { capturedHandler: capturedDoor } = await import("./stub-serve.mjs");
  const crmDoor = capturedDoor();
  if (crmDoor === handler) throw new Error("group 40: crm-command's handler was not captured");

  const THREAD = "c4b0c4b0-c4b0-4c4b-8c4b-c4b0c4b0c4b0";
  const SUSPENDED = "5b5b5b5b-5b5b-4b5b-8b5b-5b5b5b5b5b5b";
  const PIPELINE = "71717171-7171-4171-8171-717171717171";
  const STAGE = "72727272-7272-4272-8272-727272727272";
  const framesOf = (text) => String(text ?? "").split("\n").filter((l) => l.startsWith("data: ") && l !== "data: [DONE]")
    .flatMap((l) => { try { return [JSON.parse(l.slice(6))]; } catch { return []; } });
  const outcomeOf = (text) => framesOf(text).find((f) => f.paige_approval_outcome)?.paige_approval_outcome ?? null;
  const resumedFrames = (text) => framesOf(text).filter((f) => f.paige_turn?.event === "resumed");
  const cardsOf = (text) => framesOf(text).filter((f) => f.paige_confirm).map((f) => f.paige_confirm);
  const savedAnswer = (r) => r.rec.rpc.filter((c) => c.name === "paige_chat_turn_append" && c.args?.p_role === "assistant").at(-1)?.args?.p_bundle_ref ?? null;
  const toldModel = (r) => r.modelEgress.join("\n").replace(/\\"/g, '"');
  const doorCalls = (r, name = "crm-command") => r.rec.functions.filter((f) => f.name === name);

  // The committed-result table crm-command reads back and writes through (keyed as the executor keys it).
  const crmDb = () => ({ committed: new Map(), executions: [] });
  const crmRpcs = (db) => ({
    read_crm_command_result: (args) => ({ data: db.committed.get(`${args._tenant_id}:${args._actor_id}:${args._idempotency_key}`) ?? null, error: null }),
    execute_crm_command: (args) => {
      const key = `${args._tenant_id}:${args._actor_id}:${args._idempotency_key}`;
      const prior = db.committed.get(key);
      if (prior) return { data: { ...prior, replayed: true }, error: null };
      db.executions.push({ command: args._command, idempotency_key: args._idempotency_key, tenant: args._tenant_id });
      const result = { ok: true, outcome: "succeeded", action: args._command?.action, readback: { id: `rec-${db.executions.length}` } };
      db.committed.set(key, result);
      return { data: result, error: null };
    },
  });
  // supabase-js `functions.invoke` over the REAL door handler: a 2xx is data, anything else a
  // FunctionsHttpError whose context is the response, exactly as the chat and the card lane read it.
  const realCrmDoor = async (options) => {
    const res = await crmDoor(new Request("http://local/crm-command", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: options?.headers?.Authorization ?? "Bearer test-jwt" },
      body: JSON.stringify(options?.body ?? {}),
    }));
    const json = await res.json();
    return res.ok ? { data: json, error: null } : { data: null, error: { name: "FunctionsHttpError", message: `status ${res.status}`, context: { status: res.status, json: async () => json } } };
  };
  const PERSONA = (tenant) => ({ get_paige_persona_context: { data: [{ tenant_id: tenant, tenant_name: "T", playbook_config: null, playbook_slug: null, funding_enabled: false, brand: null }], error: null } });
  const SEAT = (tenant) => ({
    ...PERSONA(tenant),
    current_user_tenant_id: { data: tenant, error: null },
    resolve_tool_autonomy: { data: "confirm", error: null },
    get_actor_access: { data: { tier: "tenant" }, error: null },
    studio_role_ok: { data: true, error: null },
  });
  // What crm-command reads about the caller with its service client: an active owner seat, the route.
  // INT-327 (#1761): a deal is created FOR a resolved canonical client (or as an explicitly unlinked
  // prospect). crm-command resolves a client_ref with its service client inside the caller's workspace
  // (client-ref.ts: clients, eq tenant_id, eq account_number) — modelled with those filters honoured, so
  // a reference from another workspace, or one that no longer exists, is not found here either.
  const DEAL_CLIENT_REF = "CLT-0042";
  const DEAL_CLIENT_ROWS = [{ id: OWN, tenant_id: CALLER_TENANT, account_number: DEAL_CLIENT_REF, first_name: "Dana", last_name: "Reyes" }];
  const clientsByFilter = (rows) => (filters) => rows.filter((row) => filters.every(([op, col, value]) => op !== "eq" || row[col] === value));
  const DOOR_SERVICE = {
    tenant_members: () => [{ role: "owner", status: "active" }],
    tenants: () => [{ account_number: 3855, account_type: "standalone", parent_tenant_id: null }],
    clients: clientsByFilter(DEAL_CLIENT_ROWS),
  };
  const turnsWith = (fp, tool) => ({ paige_chat_turns: () => [
    { id: SUSPENDED, role: "assistant", content: "Here is what I'll do.", seq: 2, bundle_ref: { paige_confirm: [{ tool, summary: "Do it", fingerprint: fp }] } },
  ] });
  const crmDrive = (store, db, { tenant = CALLER_TENANT, body = {}, toolCall, fixtureTool = "crm_create_contact", threadId = THREAD, concurrent = 1, extraRpc = {}, extraTables = {}, extraService = {}, tableErrors = {}, clientId } = {}) => drive({
    stream: true, clientId, text: body.approvedConfirmations || body.declinedConfirmations ? "Approved — run it." : "please do it",
    extraBody: { ...(threadId ? { threadId } : {}), ...body }, toolCall,
    rpcOverrides: { ...SEAT(tenant), ...crmRpcs(db), ...extraRpc },
    serviceTablesExtra: { user_roles: () => [{ role: "admin" }], ...DOOR_SERVICE, ...extraService },
    tablesExtra: { paige_pending_confirmations: store.table, ...(body.approvedConfirmations ? turnsWith(body.approvedConfirmations[0], fixtureTool) : {}), ...extraTables },
    onInsert: mirrorConfirms(store),
    functionsExtra: { "crm-command": realCrmDoor },
    concurrentRequests: concurrent,
    tableErrorsExtra: tableErrors,
  });
  // The approved card's OWN lane (PaigeAIChat.tsx ~L1932-1960): it invokes crm-command directly with the
  // card's command, idempotency key and fingerprint, before (and instead of) echoing it to the chat.
  const cardLane = async (store, db, card, tenant = CALLER_TENANT) => {
    fake.setScenario({
      authUser: { id: USER, email: "owner@example.test" }, onInsert: mirrorConfirms(store),
      rpcs: { ...SEAT(tenant), ...crmRpcs(db) },
      serviceTables: { user_roles: () => [{ role: "admin" }], ...DOOR_SERVICE },
      tables: { paige_pending_confirmations: store.table },
    });
    const r = await realCrmDoor({ body: { command: card.command, idempotency_key: card.idempotency_key, approved_fingerprint: card.fingerprint } });
    return r.data ?? await r.error?.context?.json?.();
  };
  const CONTACT = { name: "crm_create_contact", args: { patch: { first_name: "Dana", last_name: "Reyes" } } };
  // The client is named the way Paige is shown it (lower-case here: the door normalizes it).
  const DEAL = { name: "deal_create", args: { title: "Acme retainer", pipeline_id: PIPELINE, stage_id: STAGE, client_ref: DEAL_CLIENT_REF.toLowerCase() } };
  const proposeVia = async (store, db, call, opts = {}) => {
    const r = await crmDrive(store, db, { toolCall: call, ...opts });
    const card = cardsOf(r.bodyText)[0] ?? null;
    if (!card) {
      // What the door answered instead (the tool result PAIGE was given), so the failure names its cause.
      const told = toldModel(r);
      const answer = told.slice(told.lastIndexOf('"tool_result"'), told.lastIndexOf('"tool_result"') + 400);
      assert(`40.G (guard) the real door minted a ${call.name} card for this check to approve`, false,
        JSON.stringify({ door: doorCalls(r).map((c) => c.body), answer, errors: r.logged.filter((l) => l.level === "error").map((l) => l.msg).slice(-3) }));
      throw new Group40Abort(`no ${call.name} card was minted, so nothing after it can be checked`);
    }
    return card;
  };

  // ── 40.1 THE PROD STRAND, both tools. The real door mints the proposal; the person approves; the model
  // does NOT re-emit. The door is handed the stored proposal and executes it exactly once, from what it
  // stored. Red at base (nothing reached the door: 0 executions). Kills: deleting the door half of the
  // resume; the CRM branch ignoring the pin.
  const strand = async (call) => {
    const st = makeConfirmStore();
    const db = crmDb();
    const card = await proposeVia(st, db, call);
    const minted = { rows: st.rows.length, executions: db.executions.length, row: st.rows[0] && { ...st.rows[0] } };
    const r = await crmDrive(st, db, { body: { approvedConfirmations: [card?.fingerprint] }, fixtureTool: call.name });
    return { st, db, card, r, minted };
  };
  const contact = await strand(CONTACT);
  const deal = await strand(DEAL);
  for (const [label, { st, db, card, r, minted }] of [["crm_create_contact", contact], ["deal_create", deal]]) {
    assert(`40.0 ${label}: the real door minted ONE door-scoped proposal (thread and client NULL, bare token, its own key) — guards 40.1`,
      !!card && /^[0-9a-f]{16}$/.test(card.fingerprint ?? "") && minted.rows === 1 && minted.row?.thread_id == null && minted.row?.scoped_client_id == null
        && minted.row?.tool_name === label && typeof minted.row?.args?.idempotency_key === "string" && minted.executions === 0,
      JSON.stringify({ card, minted }));
    const stored = st.rows.find((row) => row.fingerprint === card?.fingerprint);
    assert(`40.1 ${label}: approved with NO model re-emit — the door executes the STORED command once, under the stored key`,
      db.executions.length === 1 && db.executions[0].idempotency_key === stored.args.idempotency_key
        && db.executions[0].command.action === stored.args.command.action
        && JSON.stringify(Object.fromEntries(Object.entries(db.executions[0].command).filter(([k]) => k !== "approval_channel" && !k.startsWith("__"))))
          === JSON.stringify(Object.fromEntries(Object.entries(stored.args.command).filter(([k]) => !k.startsWith("__"))))
        && db.executions[0].command.approval_channel === "operator_card" && stored.consumed === true,
      JSON.stringify({ executions: db.executions, stored: stored?.args, consumed: stored?.consumed }));
    const pinnedBody = doorCalls(r)[0]?.body;
    assert(`40.1b ${label}: the door is handed exactly the pinned proposal — its fingerprint, its stored command and key — and nothing else`,
      doorCalls(r).length === 1 && pinnedBody?.approved_fingerprint === card.fingerprint
        && JSON.stringify(pinnedBody?.command) === JSON.stringify(stored.args.command) && pinnedBody?.idempotency_key === stored.args.idempotency_key
        && Object.keys(pinnedBody ?? {}).sort().join() === "approved_fingerprint,command,idempotency_key",
      JSON.stringify(doorCalls(r).map((c) => c.body)));
    const outcome = outcomeOf(r.bodyText);
    assert(`40.1c ${label}: the card reports ran from the door's own answer; one resumed frame; PAIGE is called after, with the result`,
      outcome?.actions?.length === 1 && outcome.actions[0].fingerprint === card.fingerprint && outcome.actions[0].outcome === "ran"
        && resumedFrames(r.bodyText).length === 1 && r.modelEgress.length >= 1
        && new RegExp(`"tool_use_id":"resume_${card.fingerprint}"`).test(r.modelEgress[0].replace(/\\"/g, '"')),
      JSON.stringify({ outcome, resumed: resumedFrames(r.bodyText).length, egress: r.modelEgress[0]?.slice(0, 200) }));
    assert(`40.1d ${label}: no fresh card, and no second proposal row`,
      cardsOf(r.bodyText).length === 0 && st.rows.length === 1, JSON.stringify({ cards: cardsOf(r.bodyText), rows: st.rows.length }));
    if (label === "deal_create") {
      // INT-327 × C4b: the door stores the command AFTER resolving the client (contact-refs.ts, on a COPY
      // of its frozen canonical command, re-issued through the canonical boundary — crm-command ~L367-375),
      // and the pinned resume hands that stored command back — so what runs is the deal FOR that client.
      // Kills: a resume that rebuilt the command from the call (or dropped the reference) on the way.
      const ran = db.executions[0]?.command;
      assert("40.1e deal_create (INT-327): the stored proposal carries the canonical client (reference normalized, resolved to that workspace's contact), and the resume runs the deal WITH it",
        stored?.args?.command?.client_ref === DEAL_CLIENT_REF && stored?.args?.command?.contact_id === OWN
          && !("unlinked_reason" in (stored?.args?.command ?? {}))
          && ran?.client_ref === DEAL_CLIENT_REF && ran?.contact_id === OWN,
        JSON.stringify({ stored: stored?.args?.command, ran }));
    }
  }

  // ── 40.1f INT-327's Chat-side preservation, carried through C4b. In a client-scoped conversation the
  // model may omit the client; Chat preserves the AUTHORIZED client's reference on deal.create
  // (preserveResolvedDealClient, paige-ai-chat ~L9608) BEFORE the door is asked, so the door stores the
  // deal for that client, and the server resume runs exactly that stored command. Kills: dropping the
  // preservation (the door would refuse an unlinked deal: no card); a resume that bypassed what the door
  // stored.
  {
    const st = makeConfirmStore(); const db = crmDb();
    const scopedClients = { clients: clientsByFilter(DEAL_CLIENT_ROWS) };
    const bare = { name: "deal_create", args: { title: "Acme retainer", pipeline_id: PIPELINE, stage_id: STAGE } };
    const card = await proposeVia(st, db, bare, { clientId: OWN, extraTables: scopedClients });
    const minted = st.rows[0]?.args?.command;
    const r = await crmDrive(st, db, { body: { approvedConfirmations: [card.fingerprint] }, fixtureTool: "deal_create", clientId: OWN, extraTables: scopedClients });
    const ran = db.executions[0]?.command;
    assert("40.1f deal_create in a client-scoped conversation, client omitted by the model: Chat preserves the authorized client, the door stores it resolved, and the resume runs that stored deal once",
      minted?.client_ref === DEAL_CLIENT_REF && minted?.contact_id === OWN && st.rows[0]?.scoped_client_id == null
        && db.executions.length === 1 && ran?.contact_id === OWN && ran?.client_ref === DEAL_CLIENT_REF
        && JSON.stringify(doorCalls(r)[0]?.body?.command) === JSON.stringify(st.rows[0].args.command)
        && outcomeOf(r.bodyText)?.actions?.[0]?.outcome === "ran",
      JSON.stringify({ minted, ran, outcome: outcomeOf(r.bodyText) }));
  }

  // ── 40.2 EXACTLY ONCE ACROSS THE CARD'S OWN LANE AND THE SERVER RESUME. (a) The card lane ran it first
  // (it strips the token it ran, so a second surface — a stale tab, Studio, the drawer — is what sends
  // it): the server asks the door, which reads back what it committed under the stored key. No second
  // execution; the card says ran (from the readback, not optimism). (b) The server ran it first; the
  // card lane then runs in a stale tab: the door reads back, nothing runs twice. (c) Two POSTs of the
  // same approval at once: one execution. Kills: skipping the door for a used row (40.2a would read
  // "can't confirm"); the door branch sending a fresh key (40.2a/b would execute twice).
  {
    const st = makeConfirmStore(); const db = crmDb();
    const card = await proposeVia(st, db, CONTACT);
    const lane = await cardLane(st, db, card);
    assert("40.2 the card's own lane ran the stored proposal once (the guard for 40.2a)",
      lane?.ok === true && db.executions.length === 1 && st.rows[0].consumed === true, JSON.stringify({ lane, executions: db.executions.length }));
    const after = await crmDrive(st, db, { body: { approvedConfirmations: [card.fingerprint] } });
    const outcome = outcomeOf(after.bodyText);
    assert("40.2a card lane first, then the server resume: the door reads back — no second execution, the card says ran",
      db.executions.length === 1 && doorCalls(after).length === 1 && doorCalls(after)[0].body.idempotency_key === card.idempotency_key
        && outcome?.actions?.[0]?.outcome === "ran" && cardsOf(after.bodyText).length === 0 && st.rows.length === 1,
      JSON.stringify({ executions: db.executions.length, outcome, rows: st.rows.length }));
  }
  {
    const { st, db, card } = await strand(CONTACT);
    const lane = await cardLane(st, db, card);
    assert("40.2b server resume first, then the card lane in a stale tab: the door reads back — still one execution",
      db.executions.length === 1 && lane?.ok === true && lane?.outcome === "succeeded" && st.rows.length === 1,
      JSON.stringify({ executions: db.executions.length, lane }));
  }
  {
    const st = makeConfirmStore(); const db = crmDb();
    const card = await proposeVia(st, db, DEAL);
    const twice = await crmDrive(st, db, { body: { approvedConfirmations: [card.fingerprint] }, concurrent: 2 });
    const outcomes = twice.responses.map((r) => outcomeOf(r.bodyText)?.actions?.[0]?.outcome ?? null).sort();
    assert("40.2c two approvals of one door card at once: exactly one execution",
      db.executions.length === 1, JSON.stringify({ executions: db.executions.length, rows: st.rows.length }));
    assert("40.2d …each request reports ran (its own run, or the door's readback of the other's) or can't confirm — never 'didn't run', never a fresh card",
      outcomes.every((o) => o === "ran" || o === "unconfirmed") && outcomes.includes("ran")
        && twice.responses.every((r) => cardsOf(r.bodyText).length === 0),
      JSON.stringify({ outcomes, rows: st.rows.map((r) => ({ consumed: r.consumed, issued: r.issued_in_request })) }));
    // A request that loses the claim before the winner has committed makes crm-command propose the act
    // again (its own behaviour on a failed claim, crm-command ~L575+), under the SAME fingerprint. That
    // proposal is never shown, and it is retired before the request ends: no live row is left for the
    // card's token to claim later. Kills: not retiring the door's re-proposal (settlePinnedDoorResult).
    assert("40.2e …a door that proposed again for the loser left NO live proposal behind (and never a card)",
      st.rows.every((row) => row.consumed === true) && twice.responses.every((r) => cardsOf(r.bodyText).length === 0),
      JSON.stringify({ rows: st.rows.map((row) => ({ consumed: !!row.consumed, issued: row.issued_in_request })) }));
  }

  // ── 40.3 ANOTHER WORKSPACE / ANOTHER PERSON: the row is not selected, the door is never handed it,
  // nothing runs, the approval stays unspent. Kills: dropping the user or tenant predicate from the
  // door selection (then the door is handed it and claims under the caller's own tenant and user —
  // which the claim would refuse, but the selection must never be wider than the claim).
  for (const [label, patch] of Object.entries({ "another workspace": { tenant_id: OTHER_TENANT }, "another person": { user_id: FOREIGN },
    // Not a door's own proposal at all: a door tool's row that carries a thread or a focused client was
    // not minted by the door, and the door's claim (thread and client NULL) could never take it.
    "a thread (not a door row)": { thread_id: THREAD }, "a focused client (not a door row)": { scoped_client_id: OWN } })) {
    const st = makeConfirmStore(); const db = crmDb();
    const card = await proposeVia(st, db, CONTACT);
    Object.assign(st.rows[0], patch);
    const r = await crmDrive(st, db, { body: { approvedConfirmations: [card.fingerprint] } });
    assert(`40.3 a door proposal of ${label} is not carried forward: the door is never handed it, nothing runs, unspent`,
      doorCalls(r).length === 0 && db.executions.length === 0 && !st.rows[0].consumed && resumedFrames(r.bodyText).length === 0,
      JSON.stringify({ door: doorCalls(r).map((c) => c.body), consumed: st.rows[0].consumed }));
  }

  // ── 40.4 EXPIRED / ALREADY USED WITH NOTHING COMMITTED / DECLINED — truthful outcomes, nothing runs.
  {
    const st = makeConfirmStore(); const db = crmDb();
    const card = await proposeVia(st, db, CONTACT);
    st.rows[0].expires_at = "2000-01-01T00:00:00Z";
    const r = await crmDrive(st, db, { body: { approvedConfirmations: [card.fingerprint] } });
    const outcome = outcomeOf(r.bodyText);
    assert("40.4 expired: the door is not asked (it would only propose again), nothing runs, the card says it expired",
      doorCalls(r).length === 0 && db.executions.length === 0 && outcome?.actions?.[0]?.outcome === "not_run" && /expired/.test(outcome?.note ?? "")
        && cardsOf(r.bodyText).length === 0,
      JSON.stringify(outcome));
  }
  {
    // Declined (Not now), then approved from a stale card: the row is used and nothing was committed.
    const st = makeConfirmStore(); const db = crmDb();
    const card = await proposeVia(st, db, CONTACT);
    await crmDrive(st, db, { body: { declinedConfirmations: [card.fingerprint] } });
    assert("40.4b (guard) Not now consumed the door proposal", st.rows[0].consumed === true, JSON.stringify(st.rows[0]));
    const r = await crmDrive(st, db, { body: { approvedConfirmations: [card.fingerprint] } });
    const outcome = outcomeOf(r.bodyText);
    assert("40.4c a used approval with nothing committed under its key: nothing runs, the card says can't confirm, no fresh card",
      db.executions.length === 0 && outcome?.actions?.[0]?.outcome === "unconfirmed" && /can't be used any more/.test(outcome?.note ?? "")
        && cardsOf(r.bodyText).length === 0 && toldModel(r).includes("approval_already_used"),
      JSON.stringify({ outcome, executions: db.executions.length, rows: st.rows.length }));
    // The door proposed the act again under the SAME fingerprint (the stored command and key re-hash to
    // it). That row was never shown, and it must not stay live: the same declined token, posted once
    // more (a third surface, a re-send), would claim and run it. Kills: not retiring the re-proposal.
    const liveAfter = st.rows.filter((row) => !row.consumed);
    const again = await crmDrive(st, db, { body: { approvedConfirmations: [card.fingerprint] } });
    assert("40.4e declined, approved from a stale card, then posted AGAIN: no hidden live proposal was left, nothing ever runs",
      liveAfter.length === 0 && db.executions.length === 0 && st.rows.every((row) => row.consumed === true)
        && outcomeOf(again.bodyText)?.actions?.[0]?.outcome === "unconfirmed" && cardsOf(again.bodyText).length === 0,
      JSON.stringify({ liveAfter: liveAfter.length, executions: db.executions.length, outcome: outcomeOf(again.bodyText) }));
  }
  {
    // Expired between this request's selection and the door's claim: the door proposes again; the
    // carried-forward approval reads "expired", not "can't confirm", and no card is shown. Time really
    // passes: the proposal's window closes while the door's claim is on its way (an async store answer).
    const st = makeConfirmStore(); const db = crmDb();
    const card = await proposeVia(st, db, CONTACT);
    const closesAt = Date.now() + 1500;
    st.rows[0].expires_at = new Date(closesAt).toISOString();
    const r = await crmDrive(st, db, { body: { approvedConfirmations: [card.fingerprint] },
      extraTables: { paige_pending_confirmations: async (filters) => {
        const isClaim = filters.some(([op]) => op === "update") && filters.some(([op, col]) => op === "gt" && col === "expires_at");
        if (isClaim) await new Promise((res) => setTimeout(res, Math.max(0, closesAt - Date.now()) + 20));
        const now = new Date().toISOString();
        return st.table(filters.map((f) => (f[0] === "gt" && f[1] === "expires_at" ? ["gt", "expires_at", now] : f)));
      } } });
    const outcome = outcomeOf(r.bodyText);
    assert("40.4d expired between selection and the door's claim: nothing runs, the card says it expired, no fresh card",
      db.executions.length === 0 && outcome?.actions?.[0]?.outcome === "not_run" && /expired/.test(outcome?.note ?? "")
        && cardsOf(r.bodyText).length === 0 && toldModel(r).includes("approval_expired"),
      JSON.stringify({ outcome, executions: db.executions.length, rows: st.rows.length }));
    // The person was told it expired. The door's fresh proposal (same fingerprint) is retired, so a
    // later re-send of the same token runs nothing — "expired" stays true.
    const liveAfter = st.rows.filter((row) => !row.consumed && row.expires_at > new Date().toISOString());
    const later = await crmDrive(st, db, { body: { approvedConfirmations: [card.fingerprint] } });
    assert("40.4f …and the token posted again later: no live proposal was left behind, nothing runs",
      liveAfter.length === 0 && db.executions.length === 0 && cardsOf(later.bodyText).length === 0
        && outcomeOf(later.bodyText)?.actions?.[0]?.outcome !== "ran",
      JSON.stringify({ liveAfter: liveAfter.length, executions: db.executions.length, outcome: outcomeOf(later.bodyText) }));
  }
  {
    // THE DOOR'S CLAIM ITSELF COULD NOT RUN (a store error on its claim update) while the card is still
    // live. crm-command reads that as nothing claimed and proposes again — its insert meets the live
    // card (the live unique index) and it answers with THAT card. Nothing ran, and the approval is still
    // good: the truthful outcome is C4a's "could not be checked" (the pinned row re-read: still live),
    // never "it may already have happened". The card was shown minutes ago (a real card, not a row
    // minted milliseconds before the request), so it is outside the retirement's clock allowance
    // altogether — it must stay live. Kills: settling a failed door claim without re-reading the row;
    // widening the retirement's allowance (it would consume the person's live card).
    const st = makeConfirmStore(); const db = crmDb();
    const card = await proposeVia(st, db, CONTACT);
    st.rows[0].server_issued_at = new Date(Date.now() - 5 * 60_000).toISOString();
    const claimDown = ({ filters }) => (filters.some(([op]) => op === "update") && filters.some(([op, col]) => op === "gt" && col === "expires_at")
      ? { code: "57014", message: "canceling statement due to statement timeout" } : null);
    const r = await crmDrive(st, db, { body: { approvedConfirmations: [card.fingerprint] }, tableErrors: { "paige_pending_confirmations:update": claimDown } });
    const outcome = outcomeOf(r.bodyText);
    assert("40.4g the door's claim errors while the card is live: nothing runs, the person is told it could not be checked (not 'may already have happened'), no card",
      db.executions.length === 0 && doorCalls(r).length === 1 && outcome?.actions?.[0]?.outcome === "not_run"
        && /checking your approval/.test(outcome?.note ?? "") && toldModel(r).includes("approval_check_unavailable")
        && !toldModel(r).includes("approval_already_used") && cardsOf(r.bodyText).length === 0,
      JSON.stringify({ outcome, executions: db.executions.length, told: toldModel(r).match(/approval_[a-z_]+/g) }));
    assert("40.4g …and the person's card is still live (not retired), so the same Approve, sent again, runs it once",
      st.rows.length === 1 && st.rows[0].consumed === false, JSON.stringify(st.rows.map((row) => ({ consumed: !!row.consumed, issued: row.server_issued_at }))));
    const retry = await crmDrive(st, db, { body: { approvedConfirmations: [card.fingerprint] } });
    assert("40.4g …the retry runs the stored command once and reports ran",
      db.executions.length === 1 && st.rows[0].consumed === true && outcomeOf(retry.bodyText)?.actions?.[0]?.outcome === "ran",
      JSON.stringify({ executions: db.executions.length, outcome: outcomeOf(retry.bodyText) }));
    // The same failed claim on a card minted a moment ago (inside the clock allowance): the pinned row is
    // never what the retirement consumes, so it is still live and the outcome is still "could not be
    // checked". Kills: dropping the pinned-row exclusion from the retirement.
    const st2 = makeConfirmStore(); const db2 = crmDb();
    const card2 = await proposeVia(st2, db2, CONTACT);
    const r2 = await crmDrive(st2, db2, { body: { approvedConfirmations: [card2.fingerprint] }, tableErrors: { "paige_pending_confirmations:update": claimDown } });
    assert("40.4g2 …a card minted a moment before the request is the pinned row, and the retirement never consumes it",
      db2.executions.length === 0 && st2.rows.length === 1 && st2.rows[0].consumed === false
        && outcomeOf(r2.bodyText)?.actions?.[0]?.outcome === "not_run" && toldModel(r2).includes("approval_check_unavailable"),
      JSON.stringify({ rows: st2.rows.map((row) => ({ consumed: !!row.consumed })), outcome: outcomeOf(r2.bodyText) }));
  }
  {
    // THE RETIREMENT TAKES ONLY WHAT IS STILL LIVE. History with the
    // card's fingerprint (a declined card, and an earlier unshown re-proposal already retired), both
    // issued inside the retirement's window, both consumed at a known moment. A stale Approve: the
    // pinned (newest) row is used, the door proposes again, and only that fresh row is retired — the
    // consumed rows keep their consumed_at (an audit of when each was used stays true). Kills: dropping
    // `consumed_at IS NULL` from the retirement (the older consumed row is re-stamped).
    const st = makeConfirmStore(); const db = crmDb();
    const card = await proposeVia(st, db, CONTACT);
    const now = Date.now();
    const base = st.rows[0];
    Object.assign(base, { server_issued_at: new Date(now - 1000).toISOString(), consumed: true, consumedAt: new Date(now - 900).toISOString() });
    st.rows.push({ ...structuredClone(base), id: "row-older-reproposal", issued_in_request: "an-earlier-reproposal",
      server_issued_at: new Date(now - 500).toISOString(), consumed: true, consumedAt: new Date(now - 450).toISOString() });
    const before = st.rows.map((row) => ({ id: row.id, consumedAt: row.consumedAt ?? null }));
    const r = await crmDrive(st, db, { body: { approvedConfirmations: [card.fingerprint] } });
    const fresh = st.rows.filter((row) => !before.some((b) => b.id === row.id));
    assert("40.4h a stale Approve over consumed history: nothing runs, the door's fresh proposal is retired, every consumed row keeps its consumed_at",
      db.executions.length === 0 && outcomeOf(r.bodyText)?.actions?.[0]?.outcome === "unconfirmed" && cardsOf(r.bodyText).length === 0
        && fresh.length === 1 && fresh[0].consumed === true
        && before.filter((b) => b.consumedAt !== null).every((b) => st.rows.find((row) => row.id === b.id)?.consumedAt === b.consumedAt),
      JSON.stringify({ before, after: st.rows.map((row) => ({ id: row.id, consumedAt: row.consumedAt ?? null })), outcome: outcomeOf(r.bodyText) }));
  }

  // ── 40.5 A MODEL THAT CALLS THE DOOR TOOL AGAIN AFTER THE RESUME — the same act, or a drifted one —
  // is not run and gets no card. A door decides its own lane, so a drifted re-emit on a lane at `auto`
  // would otherwise be a second write. Kills: removing the door re-emit guard.
  for (const [label, lane, args] of [
    ["the same act", "confirm", CONTACT.args],
    ["a drifted re-emit on a lane at auto", "auto", { patch: { first_name: "Dana", last_name: "Reyes", email: "dana@example.test" } }],
  ]) {
    const st = makeConfirmStore(); const db = crmDb();
    const card = await proposeVia(st, db, CONTACT);
    const r = await crmDrive(st, db, { body: { approvedConfirmations: [card.fingerprint] }, toolCall: { name: CONTACT.name, args },
      extraRpc: { resolve_tool_autonomy: { data: lane, error: null } } });
    assert(`40.5 ${label}: the model's call is refused as already handled — one execution, no card, the door asked once`,
      db.executions.length === 1 && doorCalls(r).length === 1 && cardsOf(r.bodyText).length === 0
        && toldModel(r).includes("already_handled_this_reply"),
      JSON.stringify({ executions: db.executions.length, door: doorCalls(r).length, cards: cardsOf(r.bodyText).length }));
  }

  // ── 40.5c THE "ELSEWHERE" HALF OF THE RE-EMIT GUARD. Declined, then a stale Approve whose reply ALSO
  // has the model call the door tool for the same act. The carried-forward call reads "can't confirm"
  // (nothing was committed); the model's own call must not reach the door either — it would claim (or,
  // with the re-proposal retired, re-propose as a fresh card) the act the person turned down. Kills:
  // a guard that only refuses re-emits after a call that ran ("here").
  {
    const st = makeConfirmStore(); const db = crmDb();
    const card = await proposeVia(st, db, CONTACT);
    await crmDrive(st, db, { body: { declinedConfirmations: [card.fingerprint] } });
    const r = await crmDrive(st, db, { body: { approvedConfirmations: [card.fingerprint] }, toolCall: CONTACT });
    const lostResults = (toldModel(r).match(/"error":"approval_already_used"/g) ?? []).length;
    assert("40.5c declined, stale Approve, and the model calls the door again: the re-emit is refused too — nothing runs, no card, the door asked once",
      db.executions.length === 0 && doorCalls(r).length === 1 && cardsOf(r.bodyText).length === 0 && lostResults >= 2,
      JSON.stringify({ executions: db.executions.length, door: doorCalls(r).length, cards: cardsOf(r.bodyText).length, lostResults }));
  }

  // ── 40.6 WITHHELD: the approved door tool is not offered on this turn (a Studio scope without CRM).
  // Not run, approval unspent, the card says it no longer matches. Kills: dropping the capability check
  // from the door half.
  {
    const st = makeConfirmStore(); const db = crmDb();
    const card = await proposeVia(st, db, CONTACT);
    const SESSION = "5e550000-0000-4000-8000-0000000000c4";
    const r = await crmDrive(st, db, { body: { approvedConfirmations: [card.fingerprint] },
      extraService: { paige_subagents: (filters) => (filters.some((f) => f[0] === "eq" && f[1] === "slug" && f[2] === "design-studio"))
        ? [{ config: { capability_scope: { version: 1, mode: "allowlist", tools: ["ask_choices", "capability_status", "growth_list"] } } }] : [] },
      extraTables: { paige_chat_threads: () => [{ studio_session_id: SESSION, summary: null, last_image_content_id: null, last_image_anchor_at: null }],
        studio_sessions: () => [{ id: SESSION, artifact_refs: [], title: "Spring launch" }] } });
    const outcome = outcomeOf(r.bodyText);
    assert("40.6 an approved door tool not offered this turn: the door is not handed it, nothing runs, unspent, 'no longer matches'",
      doorCalls(r).length === 0 && db.executions.length === 0 && !st.rows[0].consumed && resumedFrames(r.bodyText).length === 0
        && /no longer matches anything Paige can run/.test(outcome?.note ?? ""),
      JSON.stringify({ door: doorCalls(r).length, consumed: st.rows[0].consumed, outcome }));
  }

  // ── 40.7 A→B→A. Minted in A. In B (with A's thread): 409 before anything. In B with NO thread (a door
  // needs none): the row is not B's, so nothing is selected. Back in A: runs once. Again in A: the door
  // reads back, nothing runs twice. Kills: selecting door rows by fingerprint without the workspace.
  {
    const st = makeConfirmStore(); const db = crmDb();
    const card = await proposeVia(st, db, CONTACT);
    const threadOfA = { paige_chat_threads: () => [{ id: THREAD, tenant_id: CALLER_TENANT, caller_user_id: USER, contact_id: null }] };
    const inB = await crmDrive(st, db, { tenant: OTHER_TENANT, body: { approvedConfirmations: [card.fingerprint] }, extraTables: threadOfA });
    assert("40.7 minted in A, approved while B is active (A's thread): 409, the door is never asked, nothing runs",
      inB.status === 409 && doorCalls(inB).length === 0 && db.executions.length === 0 && !st.rows[0].consumed, JSON.stringify({ status: inB.status }));
    const inBNoThread = await crmDrive(st, db, { tenant: OTHER_TENANT, threadId: null, body: { approvedConfirmations: [card.fingerprint] } });
    assert("40.7b …and in B with no thread at all: not B's proposal, so it is not selected and the door is never handed it",
      doorCalls(inBNoThread).length === 0 && db.executions.length === 0 && !st.rows[0].consumed && resumedFrames(inBNoThread.bodyText).length === 0,
      JSON.stringify({ door: doorCalls(inBNoThread).map((c) => c.body) }));
    const backInA = await crmDrive(st, db, { body: { approvedConfirmations: [card.fingerprint] }, extraTables: threadOfA });
    assert("40.7c …back in A it runs once, under A", db.executions.length === 1 && db.executions[0].tenant === CALLER_TENANT && st.rows[0].consumed === true,
      JSON.stringify(db.executions));
    const againInA = await crmDrive(st, db, { body: { approvedConfirmations: [card.fingerprint] }, extraTables: threadOfA });
    assert("40.7d …and sent again in A (a refresh, a reopened thread): read back as ran, nothing runs twice",
      db.executions.length === 1 && outcomeOf(againInA.bodyText)?.actions?.[0]?.outcome === "ran", JSON.stringify(outcomeOf(againInA.bodyText)));
  }

  // ── 40.8 WIRE = PERSIST = RELOAD for a door resume: the saved answer carries turn_state.resumed and
  // paige_resume (the suspended turn, the door tool, its outcome), and its report is the wire frame.
  {
    const { r, card } = contact;
    const saved = savedAnswer(r);
    const { readResumeRecord } = await import("../../supabase/functions/_shared/paige-turn/resume.ts");
    const rec = readResumeRecord(saved?.paige_resume);
    assert("40.8 the saved answer records the door resume: kind, the suspended turn, the door tool's outcome",
      saved?.turn_state?.resumed?.kind === "approval" && rec?.kind === "approval" && rec.from_turn_id === SUSPENDED
        && JSON.stringify(rec.outcomes) === JSON.stringify([{ tool: "crm_create_contact", outcome: "ran" }]),
      JSON.stringify(saved ? { turn_state: saved.turn_state, paige_resume: saved.paige_resume } : null));
    assert("40.8b the saved report is exactly the frame the card read live (a reload rebuilds the same card)",
      JSON.stringify(rec?.approval_outcome) === JSON.stringify(outcomeOf(r.bodyText)) && rec?.approval_outcome?.actions?.[0]?.fingerprint === card.fingerprint,
      JSON.stringify({ saved: rec?.approval_outcome, wire: outcomeOf(r.bodyText) }));
  }

  // ── 40.9 THE PUBLISH AND SALES DOORS each resume once. MODELLED doors (not run here):
  //  - growth-publish-command: claims only with the approved fingerprint and the artifact id
  //    (_shared/growth-publish-command/door.ts ~L307-319); a failed claim answers 409
  //    APPROVAL_NOT_AVAILABLE and never proposes again (~L344-348).
  //  - sales-invoice-command: replays a committed operation before anything (~L54-57); claims with the
  //    fingerprint (~L95-104); a failed claim proposes again (~L114-139).
  const PAGE_ID = "3b3b3b3b-3b3b-4b3b-8b3b-3b3b3b3b3b3b";
  const INVOICE = "4c4c4c4c-4c4c-4c4c-8c4c-4c4c4c4c4c4c";
  const OPERATION = "4d4d4d4d-4d4d-4d4d-8d4d-4d4d4d4d4d4d";
  const { confirmFingerprint } = await import("../../supabase/functions/_shared/confirm-fingerprint.ts");
  const doorRow = async (tool, args, extra = {}) => ({ user_id: USER, tenant_id: CALLER_TENANT, thread_id: null, scoped_client_id: null,
    tool_name: tool, fingerprint: await confirmFingerprint(tool, args), issued_in_request: "a-door-request", args, summary: "door act", ...extra });
  const claimRow = (store, b, tool, extraMatch = () => true) => {
    const now = new Date().toISOString();
    const hit = store.rows.find((r) => r.user_id === USER && r.tenant_id === CALLER_TENANT && r.tool_name === tool && r.fingerprint === b.approved_fingerprint
      && r.thread_id == null && r.scoped_client_id == null && !r.consumed && r.server_issued_at != null && r.expires_at > now && extraMatch(r));
    if (hit) { hit.consumed = true; hit.consumedAt = now; }
    return hit ?? null;
  };
  const httpErr = (status, body) => ({ data: null, error: { name: "FunctionsHttpError", context: { status, json: async () => body } } });
  const publishArgs = { action: "publish", kind: "page", id: PAGE_ID, expected_tenant_id: CALLER_TENANT, approval_subject: `publish:page:${PAGE_ID}`, approval_cycle_nonce: "11111111-2222-4333-8444-555555555555" };
  const salesArgs = { command: { action: "invoice.void", invoice_id: INVOICE, expected_version: 2, reason: "Issued twice by mistake" }, operation_id: OPERATION, expected_tenant_id: CALLER_TENANT,
    approval_subject: `invoice.void:${INVOICE}`, approval_cycle_nonce: "22222222-3333-4444-8555-666666666666" };
  const modelDoors = (store, log) => ({
    "growth-publish-command": (options) => {
      const b = options.body;
      if (!b.approved_fingerprint) return { data: { ok: false, approval_required: true, fingerprint: "e".repeat(16), summary: "Publish" }, error: null };
      const hit = claimRow(store, b, "growth_page_publish", (r) => r.args?.id === b.id);
      if (!hit) return httpErr(409, { ok: false, refused: true, outcome: "refused", code: "APPROVAL_NOT_AVAILABLE", error: "That approval was already used or has expired, so nothing ran." });
      log.push({ door: "publish", id: hit.args.id });
      return { data: { ok: true, action: "publish", kind: "page", id: hit.args.id, status: "published", published_at: "2026-10-05T10:00:00Z", url: "/p/acme/spring" }, error: null };
    },
    "sales-invoice-command": (options) => {
      const b = options.body;
      const prior = log.find((e) => e.door === "sales" && e.operation === b.operation_id);
      if (prior) return { data: { ...prior.result, replayed: true }, error: null };
      const hit = b.approved_fingerprint ? claimRow(store, b, "sales_void_invoice") : null;
      if (!hit) return { data: { ok: false, outcome: "approval_required", fingerprint: "f".repeat(16), operation_id: b.operation_id, summary: "Void" }, error: null };
      const result = { ok: true, operation: { id: hit.args.operation_id, action: hit.args.command.action }, invoice: { id: INVOICE, status: "void", version: 3 } };
      log.push({ door: "sales", operation: hit.args.operation_id, command: hit.args.command, result });
      return { data: result, error: null };
    },
  });
  // The card each approval answers was shown in THIS thread (a door approval is carried forward only
  // from the thread whose turn carried its card — 40.12).
  const cardTurns = (fp) => turnsWith(fp, "door_tool");
  const modelDrive = (store, log, approved, toolCall) => drive({
    stream: true, text: "Approved — run it.", extraBody: { threadId: THREAD, approvedConfirmations: approved }, toolCall,
    rpcOverrides: { ...SEAT(CALLER_TENANT) },
    serviceTablesExtra: { user_roles: () => [{ role: "admin" }] },
    tablesExtra: { paige_pending_confirmations: store.table, paige_chat_threads: () => [{ studio_session_id: null, summary: null }], ...cardTurns(approved[0]) },
    onInsert: mirrorConfirms(store), functionsExtra: modelDoors(store, log),
  });
  {
    const st = makeConfirmStore([await doorRow("growth_page_publish", publishArgs)]);
    const log = [];
    const r = await modelDrive(st, log, [st.rows[0].fingerprint]);
    const calls = doorCalls(r, "growth-publish-command");
    assert("40.9 publish: approved with no re-emit — the door is handed the stored page and fingerprint and publishes it once",
      log.filter((e) => e.door === "publish").length === 1 && calls.length === 1 && calls[0].body.approved_fingerprint === st.rows[0].fingerprint
        && calls[0].body.id === PAGE_ID && st.rows[0].consumed === true && outcomeOf(r.bodyText)?.actions?.[0]?.outcome === "ran"
        && resumedFrames(r.bodyText).length === 1,
      JSON.stringify({ log, calls: calls.map((c) => c.body), outcome: outcomeOf(r.bodyText) }));
    const again = await modelDrive(st, log, [st.rows[0].fingerprint]);
    const outcome = outcomeOf(again.bodyText);
    assert("40.9b publish, sent again: the publish door keeps no readback, so it is not asked — can't confirm, nothing runs twice",
      log.filter((e) => e.door === "publish").length === 1 && doorCalls(again, "growth-publish-command").length === 0
        && outcome?.actions?.[0]?.outcome === "unconfirmed",
      JSON.stringify({ outcome, calls: doorCalls(again, "growth-publish-command").length }));
    // Claimed by another request between this request's selection and the door's claim: the door says
    // "not available" (nothing ran HERE), which for the approval reads can't confirm — never "didn't run".
    const st2 = makeConfirmStore([await doorRow("growth_page_publish", publishArgs)]);
    const log2 = [];
    const doors2 = modelDoors(st2, log2);
    const raced = await drive({
      stream: true, text: "Approved — run it.", extraBody: { threadId: THREAD, approvedConfirmations: [st2.rows[0].fingerprint] },
      rpcOverrides: { ...SEAT(CALLER_TENANT) }, serviceTablesExtra: { user_roles: () => [{ role: "admin" }] },
      tablesExtra: { paige_pending_confirmations: st2.table, paige_chat_threads: () => [{ studio_session_id: null, summary: null }], ...cardTurns(st2.rows[0].fingerprint) },
      onInsert: mirrorConfirms(st2),
      functionsExtra: { ...doors2, "growth-publish-command": (o) => { st2.rows[0].consumed = true; st2.rows[0].consumedAt = new Date().toISOString(); return doors2["growth-publish-command"](o); } },
    });
    const outcome2 = outcomeOf(raced.bodyText);
    assert("40.9c publish, claimed elsewhere between selection and the door: can't confirm (never 'didn't run'), no card",
      log2.length === 0 && outcome2?.actions?.[0]?.outcome === "unconfirmed" && cardsOf(raced.bodyText).length === 0,
      JSON.stringify({ outcome2 }));
    // A pinned call is handed its proposal by the server; it never depends on the bridge's own approval
    // lookup (which an unpinned call still makes). With that lookup failing, the carried-forward
    // approval still runs once. Kills: not passing the pin to the publish bridge.
    const st3 = makeConfirmStore([await doorRow("growth_page_publish", publishArgs)]);
    const log3 = [];
    const lookupDown = await drive({
      stream: true, text: "Approved — run it.", extraBody: { threadId: THREAD, approvedConfirmations: [st3.rows[0].fingerprint] },
      rpcOverrides: { ...SEAT(CALLER_TENANT) }, serviceTablesExtra: { user_roles: () => [{ role: "admin" }] },
      tablesExtra: { paige_pending_confirmations: st3.table, paige_chat_threads: () => [{ studio_session_id: null, summary: null }], ...cardTurns(st3.rows[0].fingerprint) },
      tableErrorsExtra: { "paige_pending_confirmations:select": ({ filters }) =>
        (filters.some((f) => f[0] === "gt" && f[1] === "expires_at") && !filters.some((f) => f[0] === "update") ? { code: "XX000", message: "lookup down" } : null) },
      onInsert: mirrorConfirms(st3), functionsExtra: modelDoors(st3, log3),
    });
    assert("40.9f publish: the carried-forward approval does not depend on the bridge's approval lookup — it runs once with that lookup down",
      log3.filter((e) => e.door === "publish").length === 1 && outcomeOf(lookupDown.bodyText)?.actions?.[0]?.outcome === "ran",
      JSON.stringify({ log3, outcome: outcomeOf(lookupDown.bodyText) }));
    // Declined ("Not now") in a thread, then approved from a stale surface. The decline must consume the
    // publish door's own proposal (thread and client NULL), as it does CRM's and Sales': otherwise the
    // server carries the stale approval to the door and the page the person turned down goes live.
    // Kills: the publish door's tools missing from the decline seam (cancelConfirmations).
    const st4 = makeConfirmStore([await doorRow("growth_page_publish", publishArgs)]);
    const log4 = [];
    await drive({ stream: true, text: "Not now.", extraBody: { threadId: THREAD, declinedConfirmations: [st4.rows[0].fingerprint] },
      rpcOverrides: { ...SEAT(CALLER_TENANT) }, serviceTablesExtra: { user_roles: () => [{ role: "admin" }] },
      tablesExtra: { paige_pending_confirmations: st4.table, paige_chat_threads: () => [{ studio_session_id: null, summary: null }] },
      onInsert: mirrorConfirms(st4), functionsExtra: modelDoors(st4, log4) });
    const declinedConsumed = st4.rows[0].consumed === true;
    const stale = await modelDrive(st4, log4, [st4.rows[0].fingerprint]);
    assert("40.9g publish declined (Not now), then approved from a stale surface: the decline consumed it — nothing publishes, can't confirm, no card",
      declinedConsumed && log4.filter((e) => e.door === "publish").length === 0 && doorCalls(stale, "growth-publish-command").length === 0
        && outcomeOf(stale.bodyText)?.actions?.[0]?.outcome === "unconfirmed" && cardsOf(stale.bodyText).length === 0,
      JSON.stringify({ declinedConsumed, log4, outcome: outcomeOf(stale.bodyText) }));
  }
  {
    const st = makeConfirmStore([await doorRow("sales_void_invoice", salesArgs)]);
    const log = [];
    const r = await modelDrive(st, log, [st.rows[0].fingerprint]);
    const calls = doorCalls(r, "sales-invoice-command");
    assert("40.9d Sales: approved with no re-emit — the door is handed the stored command, operation and fingerprint, and voids once",
      log.filter((e) => e.door === "sales").length === 1 && calls.length === 1 && calls[0].body.approved_fingerprint === st.rows[0].fingerprint
        && calls[0].body.operation_id === OPERATION && JSON.stringify(calls[0].body.command) === JSON.stringify(salesArgs.command)
        && st.rows[0].consumed === true && outcomeOf(r.bodyText)?.actions?.[0]?.outcome === "ran" && resumedFrames(r.bodyText).length === 1,
      JSON.stringify({ log: log.map((e) => e.operation), calls: calls.map((c) => c.body), outcome: outcomeOf(r.bodyText) }));
    const again = await modelDrive(st, log, [st.rows[0].fingerprint]);
    assert("40.9e Sales, sent again: the door replays the committed operation — ran, nothing runs twice, no card",
      log.filter((e) => e.door === "sales").length === 1 && outcomeOf(again.bodyText)?.actions?.[0]?.outcome === "ran" && cardsOf(again.bodyText).length === 0,
      JSON.stringify({ outcome: outcomeOf(again.bodyText) }));

    // A Sales door whose claim finds nothing proposes again (sales-invoice-command ~L114-139): it reuses
    // a live cycle for the same operation, else mints a fresh one (a new cycle nonce, so a new
    // fingerprint). Modelled HERE with that insert, so the retirement of what it minted is observable.
    const remintingSales = (store, log) => {
      const base = modelDoors(store, log)["sales-invoice-command"];
      return async (options) => {
        const answer = await base(options);
        if (answer.data?.outcome !== "approval_required") return answer;
        const now = Date.now();
        // The door reuses only the CALLER's live cycle: this person, this workspace (sales-invoice-command ~L73-77).
        const reuse = store.rows.find((r) => r.user_id === USER && r.tenant_id === CALLER_TENANT
          && r.tool_name === "sales_void_invoice" && !r.consumed && r.args?.operation_id === options.body.operation_id
          && r.server_issued_at != null && r.expires_at > new Date(now).toISOString());
        if (reuse) return { data: { ...answer.data, fingerprint: reuse.fingerprint }, error: null };
        const args = { ...salesArgs, approval_cycle_nonce: crypto.randomUUID() };
        const row = await doorRow("sales_void_invoice", args, { issued_in_request: crypto.randomUUID(), server_issued_at: new Date(now).toISOString(), expires_at: new Date(now + 600_000).toISOString() });
        store.rows.push({ id: `row-sales-${store.rows.length}`, consumed: false, ...row });
        return { data: { ...answer.data, fingerprint: row.fingerprint }, error: null };
      };
    };
    const salesDecline = (store, log) => drive({ stream: true, text: "Not now.", extraBody: { threadId: THREAD, declinedConfirmations: [store.rows[0].fingerprint] },
      rpcOverrides: { ...SEAT(CALLER_TENANT) }, serviceTablesExtra: { user_roles: () => [{ role: "admin" }] },
      tablesExtra: { paige_pending_confirmations: store.table, paige_chat_threads: () => [{ studio_session_id: null, summary: null }] },
      onInsert: mirrorConfirms(store), functionsExtra: modelDoors(store, log) });
    const salesStale = (store, log) => drive({ stream: true, text: "Approved — run it.", extraBody: { threadId: THREAD, approvedConfirmations: [store.rows[0].fingerprint] },
      rpcOverrides: { ...SEAT(CALLER_TENANT) }, serviceTablesExtra: { user_roles: () => [{ role: "admin" }] },
      tablesExtra: { paige_pending_confirmations: store.table, paige_chat_threads: () => [{ studio_session_id: null, summary: null }], ...cardTurns(store.rows[0].fingerprint) },
      onInsert: mirrorConfirms(store), functionsExtra: { ...modelDoors(store, log), "sales-invoice-command": remintingSales(store, log) } });
    {
      // Declined, then a stale Approve: the door finds nothing to claim and mints a fresh cycle no card
      // shows. It is retired by the fingerprint the door proposed (not the card's), so no live, unshown
      // Sales proposal is left behind. Kills: retiring only the card's own fingerprint.
      const stD = makeConfirmStore([await doorRow("sales_void_invoice", salesArgs)]);
      const logD = [];
      await salesDecline(stD, logD);
      const declined = stD.rows[0].consumed === true;
      const stale = await salesStale(stD, logD);
      assert("40.9h Sales declined, then approved from a stale surface: nothing voids, can't confirm, and the door's fresh unshown proposal is retired",
        declined && logD.length === 0 && stD.rows.length === 2 && stD.rows.every((r) => r.consumed === true)
          && outcomeOf(stale.bodyText)?.actions?.[0]?.outcome === "unconfirmed" && cardsOf(stale.bodyText).length === 0,
        JSON.stringify({ declined, log: logD.length, rows: stD.rows.map((r) => ({ fp: r.fingerprint, consumed: !!r.consumed })), outcome: outcomeOf(stale.bodyText) }));
    }
    {
      // …but a card for the same operation that was ALREADY live before this request (shown elsewhere,
      // its own cycle and fingerprint) is the door's answer when it reuses it — and it is not this
      // request's to retire: only rows issued since this request selected the pinned one are. Kills:
      // dropping the time bound from the retirement.
      const stE = makeConfirmStore([await doorRow("sales_void_invoice", salesArgs),
        await doorRow("sales_void_invoice", { ...salesArgs, approval_cycle_nonce: "33333333-4444-4555-8666-777777777777" }, { issued_in_request: "an-earlier-request" })]);
      const logE = [];
      await salesDecline(stE, logE);
      const stale = await salesStale(stE, logE);
      assert("40.9i …a live Sales card for the same operation issued BEFORE this request stays live (it was not this request's to retire)",
        logE.length === 0 && stE.rows[0].consumed === true && stE.rows[1].consumed === false && stE.rows.length === 2
          && outcomeOf(stale.bodyText)?.actions?.[0]?.outcome === "unconfirmed",
        JSON.stringify({ rows: stE.rows.map((r) => ({ fp: r.fingerprint, consumed: !!r.consumed })), outcome: outcomeOf(stale.bodyText) }));
    }
    {
      // The same, with that earlier card shown MINUTES before the request (not at the start of the year,
      // as above): the retirement's clock allowance is seconds, so a card a person was shown minutes ago
      // is never inside it. Kills: widening the allowance (to an hour, say).
      const stF = makeConfirmStore([await doorRow("sales_void_invoice", salesArgs),
        await doorRow("sales_void_invoice", { ...salesArgs, approval_cycle_nonce: "44444444-5555-4666-8777-888888888888" },
          { issued_in_request: "a-card-minutes-ago", server_issued_at: new Date(Date.now() - 5 * 60_000).toISOString() })]);
      const logF = [];
      await salesDecline(stF, logF);
      const stale = await salesStale(stF, logF);
      assert("40.9j …and a live Sales card shown MINUTES before this request stays live too (the allowance is seconds, not minutes)",
        logF.length === 0 && stF.rows[0].consumed === true && stF.rows[1].consumed === false && stF.rows.length === 2
          && outcomeOf(stale.bodyText)?.actions?.[0]?.outcome === "unconfirmed",
        JSON.stringify({ rows: stF.rows.map((r) => ({ fp: r.fingerprint, consumed: !!r.consumed, issued: r.server_issued_at })), outcome: outcomeOf(stale.bodyText) }));
    }
    {
      // THE RETIREMENT TAKES ONLY THIS DOOR TOOL'S ROWS. A live row of ANOTHER tool carrying the declined
      // card's 16-hex value, issued inside the retirement's window. Only a 64-bit collision produces one
      // (the fingerprint hashes the tool), so this row is SYNTHETIC. Under the live unique index (user,
      // fingerprint) the CRM door could not even re-propose beside it, so the predicate is observable only
      // here, where the declined card's fingerprint is consumed and the Sales door mints a new cycle's.
      // Kills: dropping `tool_name` from the retirement (near-equivalent in production, for that reason).
      const stG = makeConfirmStore([await doorRow("sales_void_invoice", salesArgs)]);
      stG.rows.push({ ...structuredClone(stG.rows[0]), id: "row-collision", tool_name: "configure_tenant_pipeline", issued_in_request: "another-tool",
        server_issued_at: new Date().toISOString(), consumed: false });
      const logG = [];
      await salesDecline(stG, logG);
      const guard = stG.rows[0].consumed === true && stG.rows[1].consumed === false;
      await salesStale(stG, logG);
      assert("40.9k …a live row of another tool with the same fingerprint value is not retired (synthetic collision)",
        guard && logG.length === 0 && stG.rows[1].consumed === false && stG.rows.length === 3 && stG.rows[2].consumed === true,
        JSON.stringify({ guard, rows: stG.rows.map((r) => ({ id: r.id, tool: r.tool_name, consumed: !!r.consumed })) }));
    }
    // THE RETIREMENT TAKES ONLY THIS WORKSPACE'S AND THIS PERSON'S ROWS. The same synthetic collision, but
    // the colliding live row belongs to ANOTHER WORKSPACE (same person, same tool, same fingerprint value)
    // or to ANOTHER PERSON (same workspace, same tool, same value), issued inside the retirement's window —
    // stamped just before the stale request, so it is inside the window however long the decline took.
    // Neither is this request's to retire. Kills: dropping `tenant_id` (X1) or `user_id` (X2) from the
    // retirement — each otherwise left every check green (exact-head review, 2026-10-05).
    for (const [id, label, patch] of [
      ["40.9l", "another WORKSPACE's", { tenant_id: OTHER_TENANT, issued_in_request: "another-workspace" }],
      ["40.9m", "another PERSON's", { user_id: FOREIGN, issued_in_request: "another-person" }],
    ]) {
      const stH = makeConfirmStore([await doorRow("sales_void_invoice", salesArgs)]);
      stH.rows.push({ ...structuredClone(stH.rows[0]), id: "row-collision", ...patch, consumed: false });
      const logH = [];
      await salesDecline(stH, logH);
      const guard = stH.rows[0].consumed === true && stH.rows[1].consumed === false;
      stH.rows[1].server_issued_at = new Date().toISOString();
      const stale = await salesStale(stH, logH);
      assert(`${id} …a live row of ${label} with the same tool and fingerprint value, issued inside the window, is not retired (synthetic collision)`,
        guard && logH.length === 0 && stH.rows[1].consumed === false && stH.rows.length === 3 && stH.rows[2].consumed === true
          && outcomeOf(stale.bodyText)?.actions?.[0]?.outcome === "unconfirmed",
        JSON.stringify({ guard, rows: stH.rows.map((r) => ({ id: r.id, user: r.user_id, tenant: r.tenant_id, consumed: !!r.consumed })), outcome: outcomeOf(stale.bodyText) }));
    }
  }

  // ── 40.10 WHAT IS NOT CARRIED FORWARD keeps its existing path: a CRM preview binding (the door cannot
  // take `{action, preview_id}` back as a command) and a row whose args no longer hash to its
  // fingerprint. Nothing is handed to the door, nothing is claimed, no resumed frame.
  {
    const previewArgs = { command: { action: "deal.delete", preview_id: "73737373-7373-4373-8373-737373737373" }, idempotency_key: "k-preview", approval_subject: "deal:x" };
    const st = makeConfirmStore([await doorRow("crm_delete_deal", previewArgs)]);
    const db = crmDb();
    const r = await crmDrive(st, db, { body: { approvedConfirmations: [st.rows[0].fingerprint] } });
    assert("40.10 a CRM preview-bound proposal is not carried forward (no door call, unspent, no resumed frame)",
      doorCalls(r).length === 0 && !st.rows[0].consumed && resumedFrames(r.bodyText).length === 0,
      JSON.stringify({ door: doorCalls(r).map((c) => c.body) }));
    const tamperedRow = await doorRow("crm_create_contact", { command: { action: "contact.create", patch: { first_name: "A", last_name: "B" } }, idempotency_key: "k1", approval_subject: "s" });
    tamperedRow.args = { ...tamperedRow.args, command: { action: "contact.create", patch: { first_name: "Mallory", last_name: "B" } } };
    const st2 = makeConfirmStore([tamperedRow]);
    const r2 = await crmDrive(st2, db, { body: { approvedConfirmations: [st2.rows[0].fingerprint] } });
    assert("40.10b a row whose stored request no longer hashes to its fingerprint is not carried forward",
      doorCalls(r2).length === 0 && !st2.rows[0].consumed && resumedFrames(r2.bodyText).length === 0,
      JSON.stringify({ door: doorCalls(r2).map((c) => c.body) }));
    // Not a door's proposal at all: a door-tool row the server never issued, or one no request minted.
    // The door's own claim refuses both (server_issued_at / issued_in_request NOT NULL); the selection
    // must never be wider than the claim, so neither is handed to the door. Kills: dropping the
    // server-issued filters from the door selection.
    for (const [label, patch] of [["the server never issued", { server_issued_at: null }], ["no request minted", { issued_in_request: null }]]) {
      const row = await doorRow("crm_create_contact", { command: { action: "contact.create", patch: { first_name: "Ana", last_name: "Diaz" } }, idempotency_key: "k-untrusted", approval_subject: "contact.create:ana" }, patch);
      const stX = makeConfirmStore([row]);
      const rX = await crmDrive(stX, db, { body: { approvedConfirmations: [row.fingerprint] } });
      assert(`40.10c a door-tool row ${label} is not selected: the door is never handed it, nothing runs, no resumed frame`,
        doorCalls(rX).length === 0 && !stX.rows[0].consumed && resumedFrames(rX.bodyText).length === 0,
        JSON.stringify({ door: doorCalls(rX).map((c) => c.body) }));
    }
  }

  // ── 40.11 OPERATOR (no thread is sent). A tenant-less operator has no door proposals to carry: none is
  // selected (a door row always names a workspace). An operator who has entered a workspace has the
  // door's own binding (this user, that workspace), so the approval is carried forward once, with no
  // thread — the record has no suspended turn to name and nothing is persisted (no thread to persist to).
  {
    const OPERATOR = { is_platform_operator: { data: true, error: null }, is_super_admin: { data: true, error: null } };
    const st = makeConfirmStore(); const db = crmDb();
    const card = await proposeVia(st, db, CONTACT, { threadId: null });
    const atRest = await crmDrive(st, db, { tenant: null, threadId: null, body: { approvedConfirmations: [card.fingerprint] },
      extraRpc: { ...OPERATOR, current_user_tenant_id: { data: null, error: null } }, extraService: { user_roles: () => [{ role: "super_admin" }] } });
    assert("40.11 Operator at rest (no workspace): no door proposal is selected, nothing runs",
      doorCalls(atRest).length === 0 && db.executions.length === 0 && !st.rows[0].consumed && resumedFrames(atRest.bodyText).length === 0,
      JSON.stringify({ door: doorCalls(atRest).length }));
    const entered = await crmDrive(st, db, { threadId: null, body: { approvedConfirmations: [card.fingerprint] },
      extraRpc: { ...OPERATOR }, extraService: { user_roles: () => [{ role: "super_admin" }] } });
    assert("40.11b Operator inside a workspace (no thread): the door approval is carried forward once, under the door's own binding",
      db.executions.length === 1 && st.rows[0].consumed === true && resumedFrames(entered.bodyText).length === 1
        && outcomeOf(entered.bodyText)?.actions?.[0]?.outcome === "ran",
      JSON.stringify({ executions: db.executions.length, outcome: outcomeOf(entered.bodyText) }));
  }

  // ── 40.13 EVERY CRM ACTION THE RESUME CARRIES FORWARD, through the REAL door. 40.1 drives two
  // actions; the rest were carried forward by inference (doorResumeShape → the door's own schema and
  // its claimed-vs-requested check). Here each non-preview action is MINTED by the real crm-command
  // (no approved fingerprint, lane confirm), then approved with no model re-emit: the door must
  // execute the command it stored, once, under its stored key. A preview-bound action is listed by
  // the catalog (CRM_PREVIEW_REQUIRED_ACTIONS) and covered by 40.10 — it keeps its existing path.
  {
    const { CRM_ACTION_CAPABILITY: CAPS, CRM_PREVIEW_REQUIRED_ACTIONS: PREVIEW } = await import("../../supabase/functions/_shared/crm-command/catalog.ts");
    const C = "7a7a7a7a-7a7a-4a7a-8a7a-7a7a7a7a7a7a", CO = "7b7b7b7b-7b7b-4b7b-8b7b-7b7b7b7b7b7b", T = "7c7c7c7c-7c7c-4c7c-8c7c-7c7c7c7c7c7c";
    const D = "7d7d7d7d-7d7d-4d7d-8d7d-7d7d7d7d7d7d", U = "7e7e7e7e-7e7e-4e7e-8e7e-7e7e7e7e7e7e", AT = "2026-10-01T10:00:00.000Z";
    const CONTACT_AT = { contact_id: C, expected_updated_at: AT };
    const TASK_AT = { task_id: T, expected_updated_at: AT };
    const COMMANDS = {
      "contact.create": { patch: { first_name: "Ana", last_name: "Diaz" } },
      "contact.update": { ...CONTACT_AT, patch: { email: "ana@example.test" } },
      "contact.archive": { ...CONTACT_AT, reason: "Duplicate entry" },
      "contact.restore": { ...CONTACT_AT },
      "contact.link_company": { ...CONTACT_AT, company_id: CO },
      "contact.unlink_company": { ...CONTACT_AT, company_id: CO },
      "contact.assign_coach": { ...CONTACT_AT, owner_user_id: U },
      "contact.assign_owner": { ...CONTACT_AT, owner_user_id: U },
      "company.create": { contact_id: C, patch: { name: "Acme Studio" } },
      "company.update": { company_id: CO, expected_updated_at: AT, patch: { name: "Acme Studio LLC" } },
      "company.archive": { company_id: CO, expected_updated_at: AT },
      "company.restore": { company_id: CO, expected_updated_at: AT },
      "task.create": { patch: { title: "Send the welcome pack" } },
      "task.update": { ...TASK_AT, patch: { title: "Send the welcome pack today" } },
      "task.assign": { ...TASK_AT, patch: { assigned_to: U } },
      "task.reschedule": { ...TASK_AT, patch: { due_date: "2026-10-09" } },
      "task.complete": { ...TASK_AT },
      "task.reopen": { ...TASK_AT },
      "task.cancel": { ...TASK_AT },
      "activity.log": { contact_id: C, patch: { kind: "note", body: "Spoke about onboarding." } },
      "deal.create": { title: "Acme retainer", pipeline_id: PIPELINE, stage_id: STAGE, client_ref: DEAL_CLIENT_REF },
      "deal.update": { deal_id: D, expected_version: 3, title: "Acme retainer (annual)" },
      "deal.assign_owner": { deal_id: D, expected_version: 3, owner_user_id: U },
      "deal.assign_contact": { deal_id: D, expected_version: 3, contact_id: C },
      "deal.move": { deal_id: D, pipeline_id: PIPELINE, target_stage_id: STAGE, expected_version: 3, expected_target_version: 1 },
      "deal.close": { deal_id: D, expected_version: 3, outcome_type: "won", outcome_date: "2026-10-04" },
      "deal.reopen": { deal_id: D, expected_version: 4, target_stage_id: STAGE },
    };
    const actions = Object.keys(CAPS).filter((a) => !PREVIEW.has(a));
    const untabled = actions.filter((a) => !COMMANDS[a]);
    assert("40.13 (guard) every non-preview CRM action in the catalog has a row in this table", untabled.length === 0 && actions.length === Object.keys(COMMANDS).length,
      JSON.stringify({ untabled, actions: actions.length }));
    const failures = [];
    for (const action of actions) {
      const st = makeConfirmStore(); const db = crmDb();
      fake.setScenario({
        authUser: { id: USER, email: "owner@example.test" }, onInsert: mirrorConfirms(st),
        rpcs: { ...SEAT(CALLER_TENANT), ...crmRpcs(db) },
        serviceTables: { user_roles: () => [{ role: "admin" }], ...DOOR_SERVICE },
        tables: { paige_pending_confirmations: st.table },
      });
      const key = `k-${action}`;
      const minted = await realCrmDoor({ body: { command: { action, ...COMMANDS[action] }, idempotency_key: key } });
      const mint = minted.data ?? await minted.error?.context?.json?.();
      const stored = st.rows[0]?.args;
      if (mint?.outcome !== "approval_required" || st.rows.length !== 1) { failures.push({ action, stage: "mint", mint }); continue; }
      const r = await crmDrive(st, db, { body: { approvedConfirmations: [mint.fingerprint] }, fixtureTool: CAPS[action] });
      const ran = db.executions[0];
      const sameCommand = ran && JSON.stringify(Object.fromEntries(Object.entries(ran.command).filter(([k]) => k !== "approval_channel" && !k.startsWith("__"))))
        === JSON.stringify(Object.fromEntries(Object.entries(stored.command).filter(([k]) => !k.startsWith("__"))));
      if (!(db.executions.length === 1 && ran.idempotency_key === key && sameCommand && st.rows[0].consumed === true
        && outcomeOf(r.bodyText)?.actions?.[0]?.outcome === "ran" && cardsOf(r.bodyText).length === 0)) {
        failures.push({ action, stage: "resume", executions: db.executions, stored: stored?.command, outcome: outcomeOf(r.bodyText),
          door: doorCalls(r).map((c) => c.body), told: toldModel(r).slice(-400) });
      }
    }
    assert(`40.13 every non-preview CRM action (${actions.length}) minted by the real door and approved with no re-emit runs its STORED command once, under its stored key`,
      failures.length === 0, JSON.stringify(failures).slice(0, 4000));
  }

  // ── 40.14 A RESUME NEVER BYPASSES INT-327. The pinned resume hands the door the command IT stored, and
  // the door re-validates and re-resolves that command on every request before it claims anything
  // (crm-command: the relationship rule in its schema, then resolveCommandContactRefs). So (a) a deal
  // proposal stored WITHOUT a canonical client — one minted before INT-327 shipped, still inside its
  // window — is refused by the door when carried forward: nothing runs; and (b) a stored deal whose
  // client no longer resolves in this workspace (deleted, or moved) is refused as not found: nothing
  // runs. Neither becomes a fresh card. Kills: a resume path that skipped the door's validation, or
  // executed the stored command without re-resolving its client.
  {
    const unlinked = { command: { action: "deal.create", title: "Acme retainer", pipeline_id: PIPELINE, stage_id: STAGE }, idempotency_key: "k-pre-int327", approval_subject: "deal:pre-int327" };
    const st = makeConfirmStore([await doorRow("deal_create", unlinked)]);
    const db = crmDb();
    const r = await crmDrive(st, db, { body: { approvedConfirmations: [st.rows[0].fingerprint] }, fixtureTool: "deal_create" });
    const told = toldModel(r);
    assert("40.14a a stored deal proposal with NO canonical client (pre-INT-327), carried forward: the door is handed it and refuses it — nothing runs, no card, never reported ran",
      doorCalls(r).length === 1 && JSON.stringify(doorCalls(r)[0].body.command) === JSON.stringify(unlinked.command)
        && db.executions.length === 0 && cardsOf(r.bodyText).length === 0
        && outcomeOf(r.bodyText)?.actions?.[0]?.outcome !== "ran" && /CRM_COMMAND_INVALID/.test(told),
      JSON.stringify({ door: doorCalls(r).map((c) => c.body), executions: db.executions.length, outcome: outcomeOf(r.bodyText), consumed: st.rows[0].consumed }));

    const gone = { command: { action: "deal.create", title: "Acme retainer", pipeline_id: PIPELINE, stage_id: STAGE, client_ref: DEAL_CLIENT_REF, contact_id: OWN }, idempotency_key: "k-client-gone", approval_subject: "deal:gone" };
    const st2 = makeConfirmStore([await doorRow("deal_create", gone)]);
    const db2 = crmDb();
    const r2 = await crmDrive(st2, db2, { body: { approvedConfirmations: [st2.rows[0].fingerprint] }, fixtureTool: "deal_create",
      extraService: { clients: clientsByFilter([]) } });
    assert("40.14b a stored deal whose client no longer resolves in this workspace, carried forward: the door re-resolves it and refuses (not found) — nothing runs, no card",
      doorCalls(r2).length === 1 && db2.executions.length === 0 && cardsOf(r2.bodyText).length === 0
        && outcomeOf(r2.bodyText)?.actions?.[0]?.outcome !== "ran" && /CRM_CONTACT_NOT_FOUND/.test(toldModel(r2)),
      JSON.stringify({ executions: db2.executions.length, outcome: outcomeOf(r2.bodyText), consumed: st2.rows[0].consumed }));
  }

  // ── 40.12 RESUME PRESERVES THE THREAD. A door row carries no thread, so the card is the binding: the
  // card was shown in thread X; its token posted in thread Y (whose turns never showed it) is not
  // carried forward there — the door is not handed it, nothing runs, the approval stays unspent. Back in
  // X it runs once, as the resume of X's suspended turn. Kills: carrying a door token forward in a
  // thread that never showed its card.
  {
    const st = makeConfirmStore(); const db = crmDb();
    const card = await proposeVia(st, db, CONTACT);
    const OTHER_THREAD = "c4b1c4b1-c4b1-4c4b-8c4b-c4b1c4b1c4b1";
    const inY = await crmDrive(st, db, { threadId: OTHER_THREAD, body: { approvedConfirmations: [card.fingerprint] },
      extraTables: { paige_chat_turns: () => [{ id: "6b6b6b6b-6b6b-4b6b-8b6b-6b6b6b6b6b6b", role: "assistant", content: "Hi.", seq: 2, bundle_ref: null }] } });
    assert("40.12 a door card's token posted in ANOTHER thread is not carried forward there: the door is never handed it, nothing runs, unspent",
      doorCalls(inY).length === 0 && db.executions.length === 0 && !st.rows[0].consumed && resumedFrames(inY.bodyText).length === 0,
      JSON.stringify({ door: doorCalls(inY).map((c) => c.body), consumed: st.rows[0].consumed }));
    const inX = await crmDrive(st, db, { body: { approvedConfirmations: [card.fingerprint] } });
    const saved = savedAnswer(inX);
    const { readResumeRecord } = await import("../../supabase/functions/_shared/paige-turn/resume.ts");
    assert("40.12b …in the thread that showed the card it runs once, as the resume of that thread's suspended turn",
      db.executions.length === 1 && st.rows[0].consumed === true && outcomeOf(inX.bodyText)?.actions?.[0]?.outcome === "ran"
        && readResumeRecord(saved?.paige_resume)?.from_turn_id === SUSPENDED,
      JSON.stringify({ executions: db.executions.length, outcome: outcomeOf(inX.bodyText) }));
    // The thread's turns cannot be read: the card binding cannot be checked, so no door token is carried
    // forward (it keeps its existing path) — never "carry it anyway". Kills: a read failure that leaves
    // the door tokens in place.
    const st2 = makeConfirmStore(); const db2 = crmDb();
    const card2 = await proposeVia(st2, db2, CONTACT);
    const unreadable = await drive({
      stream: true, text: "Approved — run it.", extraBody: { threadId: THREAD, approvedConfirmations: [card2.fingerprint] },
      rpcOverrides: { ...SEAT(CALLER_TENANT), ...crmRpcs(db2) },
      serviceTablesExtra: { user_roles: () => [{ role: "admin" }], ...DOOR_SERVICE },
      tablesExtra: { paige_pending_confirmations: st2.table },
      tableErrorsExtra: { "paige_chat_turns:select": () => ({ code: "XX000", message: "turns down" }) },
      onInsert: mirrorConfirms(st2), functionsExtra: { "crm-command": realCrmDoor },
    });
    assert("40.12c the thread's turns cannot be read: no door token is carried forward, nothing runs, unspent",
      doorCalls(unreadable).length === 0 && db2.executions.length === 0 && !st2.rows[0].consumed && resumedFrames(unreadable.bodyText).length === 0,
      JSON.stringify({ door: doorCalls(unreadable).map((c) => c.body), consumed: st2.rows[0].consumed }));
    // TWO door tokens in one request, only ONE of whose cards this thread showed: each token is bound to
    // its own card, so only that one is carried forward; the other is never handed to the door, nothing
    // of it runs, and it stays unspent. Kills: admitting every token once ANY of them was shown here.
    const st3 = makeConfirmStore(); const db3 = crmDb();
    const shown = await proposeVia(st3, db3, CONTACT);
    const notShown = await proposeVia(st3, db3, DEAL);
    const both = await crmDrive(st3, db3, { body: { approvedConfirmations: [shown.fingerprint, notShown.fingerprint] }, fixtureTool: "crm_create_contact" });
    const dealRow = st3.rows.find((row) => row.fingerprint === notShown.fingerprint);
    assert("40.12d two door tokens, only one card shown in this thread: only that one is carried forward — the other is never handed to the door, nothing of it runs, unspent",
      doorCalls(both).length === 1 && doorCalls(both)[0].body.approved_fingerprint === shown.fingerprint
        && db3.executions.length === 1 && db3.executions[0].command.action === "contact.create"
        && dealRow?.consumed === false && st3.rows.length === 2,
      JSON.stringify({ door: doorCalls(both).map((c) => c.body?.approved_fingerprint), executions: db3.executions.map((e) => e.command.action), deal: dealRow?.consumed }));
  }

  // ── 40.15 C4c × C4b — ONE OBJECTIVE: PAIGE asks → the person answers → PAIGE proposes a DOOR act (the
  // real crm-command mints the card) → the person approves → the door runs it EXACTLY ONCE, carried
  // forward from the answer's continuation turn → approving again runs nothing. The composition Sales
  // commercial assembly depends on (verifier F5: 41.10/41.11 composed only a C4a general-gate card).
  {
    const ts = makeThreadStore([{ id: THREAD, tenant_id: CALLER_TENANT, caller_user_id: USER }]);
    const st = makeConfirmStore(); const db = crmDb();
    const onThread = { extraTables: { paige_chat_turns: ts.table, paige_chat_threads: ts.threadsTable }, extraRpc: { paige_chat_turn_append: (args) => ts.append(args), match_paige_memory: { data: [], error: null } } };
    const asked = await crmDrive(st, db, { ...onThread, toolCall: { name: "ask_choices", args: { prompt: "Which name should the new contact go under?", needs: "the contact's name", objective: "Adding Kestrel's lead to your contacts" } } });
    const ask = framesOf(asked.bodyText).find((f) => f.paige_choices)?.paige_choices ?? null;
    const answered = await crmDrive(st, db, { ...onThread, body: { resume: { kind: "answer", ask_id: ask?.ask_id } }, toolCall: CONTACT });
    const card = cardsOf(answered.bodyText)[0] ?? null;
    const continuation = ts.turns.filter((t) => t.role === "assistant").at(-1);
    assert("40.15 ask → answer → a DOOR card: the answer resumes the objective, the real door mints ONE proposal and nothing runs yet",
      !!ask?.ask_id && answered.status === 200 && resumedFrames(answered.bodyText).length === 1 && !!card?.fingerprint
        && st.rows.length === 1 && db.executions.length === 0 && continuation?.bundle_ref?.turn_state?.resumed?.kind === "answer"
        && continuation?.bundle_ref?.turn_state?.state === "WAIT_APPROVAL",
      JSON.stringify({ ask, status: answered.status, card, rows: st.rows.length, executions: db.executions.length, cont: continuation?.bundle_ref?.turn_state }));
    const approved = await crmDrive(st, db, { ...onThread, body: { approvedConfirmations: [card?.fingerprint] }, fixtureTool: "crm_create_contact" });
    const resumedTurn = ts.turns.filter((t) => t.role === "assistant").at(-1);
    assert("40.15b …the approval runs the door's STORED act exactly once (C4b), carried forward from the answer's continuation turn, in the same thread",
      approved.status === 200 && db.executions.length === 1 && doorCalls(approved).length === 1 && doorCalls(approved)[0].body.approved_fingerprint === card?.fingerprint
        && st.rows[0].consumed === true && resumedTurn?.bundle_ref?.turn_state?.resumed?.kind === "approval"
        && resumedTurn?.bundle_ref?.paige_resume?.from_turn_id === continuation?.id && cardsOf(approved.bodyText).length === 0,
      JSON.stringify({ status: approved.status, executions: db.executions.length, door: doorCalls(approved).map((c) => c.body?.approved_fingerprint), consumed: st.rows[0]?.consumed, resumed: resumedTurn?.bundle_ref?.paige_resume }));
    const again = await crmDrive(st, db, { ...onThread, body: { approvedConfirmations: [card?.fingerprint] }, fixtureTool: "crm_create_contact" });
    const kinds = ts.turns.map((t) => `${t.role}:${t.bundle_ref?.paige_ask ? "ask" : t.bundle_ref?.turn_state?.resumed?.kind ?? (t.bundle_ref?.paige_resume?.kind === "answer" ? "answer" : "-")}`);
    // (The door answers a re-sent approval from its committed result — C4b's replay — so the card reads
    // the earlier outcome; what this checks is that nothing EXECUTES a second time.)
    assert("40.15c …approving again executes nothing a second time (no new card, no new proposal); the thread holds ONE question, ONE answer, ONE door execution — no other workflow record",
      db.executions.length === 1 && cardsOf(again.bodyText).length === 0 && st.rows.length === 1
        && ts.turns.filter((t) => t.role === "user" && t.bundle_ref?.paige_resume?.kind === "answer").length === 1
        && ts.turns.filter((t) => t.bundle_ref?.paige_ask).length === 1,
      JSON.stringify({ executions: db.executions.length, outcome: outcomeOf(again.bodyText), kinds }));
  }
} catch (e) {
  if (!(e instanceof Group40Abort)) throw e;
  assert(`40.ABORT group 40 stopped: ${e.message}`, false);
}

// ── 41. C4c — PAIGE ASKS, WAITS, AND THE SAME OBJECTIVE RESUMES ON THE ANSWER ─────────────────────────
//
// docs/delivery/paige-conversational-loop-c4.md §2c. When PAIGE cannot continue without one fact only
// the person has, she asks with `ask_choices` (now offered in the main chat on a saved thread). The
// question turn IS the ask (`bundle_ref.paige_ask`, ASK_USER). A reply sent AS the answer (`resume:
// {kind:"answer", ask_id}`) is bound to it once — re-derived from the thread, claimed through the
// transcript's partial unique index — and PAIGE continues the same objective. Each check names the
// defect it catches; "red at base" means it fails on main (before C4c the tool was Studio-only, nothing
// was saved but the question's words, and every answer was an ordinary message that could land twice).
console.log("\nC4c — PAIGE asks, waits, and the same objective resumes on the answer");
{
  const THREAD = "c4c41000-0000-4000-8000-000000000001";
  const THREAD_B = "c4c41000-0000-4000-8000-000000000002";      // another thread of the same person, workspace B
  const THREAD_OTHER_USER = "c4c41000-0000-4000-8000-000000000003";
  const framesOf = (text) => String(text ?? "").split("\n").filter((l) => l.startsWith("data: ") && l !== "data: [DONE]")
    .flatMap((l) => { try { return [JSON.parse(l.slice(6))]; } catch { return []; } });
  const choicesOf = (r) => framesOf(r.bodyText).find((f) => f.paige_choices)?.paige_choices ?? null;
  const turnFrames = (r) => framesOf(r.bodyText).filter((f) => f.paige_turn).map((f) => f.paige_turn);
  const terminalOf = (r) => turnFrames(r).find((t) => t.event === "completed" || t.event === "waiting") ?? null;
  const resumedOf = (r) => turnFrames(r).filter((t) => t.event === "resumed");
  const streamedCalls = (r) => r.modelEgress.filter((b) => b.includes('"stream":true'));
  const toldModel = (r) => r.modelEgress.join("\n").replace(/\\"/g, '"');
  const bodyJson = (r) => { try { return JSON.parse(r.bodyText); } catch { return null; } };
  const appends = (r, role) => r.rec.rpc.filter((c) => c.name === "paige_chat_turn_append" && (!role || c.args?.p_role === role));
  const offered = (r) => { try { return (JSON.parse(streamedCalls(r)[0] ?? "{}").tools ?? []).map((t) => t.name); } catch { return []; } };
  // Imported defensively so this group can be run against main to show it is red there (main's
  // resume.ts has none of the C4c readers).
  const resumeModule = await import("../../supabase/functions/_shared/paige-turn/resume.ts").catch(() => ({}));
  const readAskRecord = resumeModule.readAskRecord ?? (() => null);
  const readAnswerClaim = resumeModule.readAnswerClaim ?? (() => null);
  const readResumeRecord = resumeModule.readResumeRecord ?? (() => null);
  const answerTurnNote = resumeModule.answerTurnNote ?? (() => "");
  const resolveLiveness = (store, askId) => resumeModule.resolveAskLiveness
    ? resumeModule.resolveAskLiveness([...store.turns].sort((x, y) => y.seq - x.seq), askId) : null;

  const THREADS = [
    { id: THREAD, tenant_id: CALLER_TENANT, caller_user_id: USER },
    { id: THREAD_B, tenant_id: OTHER_TENANT, caller_user_id: USER },
    { id: THREAD_OTHER_USER, tenant_id: CALLER_TENANT, caller_user_id: FOREIGN },
  ];
  const PERSONA = (tenant) => ({ get_paige_persona_context: { data: [{ tenant_id: tenant, tenant_name: "T", playbook_config: null, playbook_slug: null, funding_enabled: false, brand: null }], error: null } });
  const SEAT = (tenant = CALLER_TENANT) => ({
    ...PERSONA(tenant),
    current_user_tenant_id: { data: tenant, error: null },
    resolve_tool_autonomy: { data: "confirm", error: null },
    get_actor_access: { data: { tier: "tenant" }, error: null },
    studio_role_ok: { data: true, error: null },
    match_paige_memory: { data: [], error: null },
    growth_page_upsert: { data: { id: "page-41", slug: "kestrel-welcome", status: "draft", tenant_id: tenant }, error: null },
  });
  const ASK_FREE = { name: "ask_choices", args: { prompt: "Kestrel signed but didn't pick a start date. When should the onboarding start?", needs: "the start date", objective: "Setting up Kestrel's onboarding" } };
  const ASK_CHOICE = { name: "ask_choices", args: {
    prompt: "Kestrel signed a 14-person engagement but didn't pick a start. Which start should I build?",
    needs: "which start to build", objective: "Setting up Kestrel's onboarding",
    options: [
      { label: "Full kickoff", value: "full_kickoff", description: "90-minute workshop plus the intake form" },
      { label: "Light start", value: "light_start", description: "Intake form now, kickoff next month" },
      { label: "Mirror Lumen Freight", value: "mirror_lumen", description: "Copy the onboarding you ran for Lumen Freight" },
    ],
  } };
  const PAGE = { name: "growth_page_save", args: { title: "Kestrel welcome", blocks: [] } };
  const turn = (store, { text = "Set up onboarding for Kestrel.", tenant = CALLER_TENANT, threadId = THREAD, toolCall, resume, body = {}, rpc = {}, tables = {}, service = {}, concurrent = 1, confirms, failStreamCalls = [], failStreamStatus, throwStreamCalls = [], tableErrors = {}, document } = {}) => drive({
    stream: true, text, toolCall, failStreamCalls, ...(failStreamStatus ? { failStreamStatus } : {}), throwStreamCalls, tableErrorsExtra: tableErrors, ...(document ? { document } : {}),
    extraBody: { ...(threadId ? { threadId } : {}), ...(resume ? { resume } : {}), ...body },
    rpcOverrides: { ...SEAT(tenant), paige_chat_turn_append: (args) => store.append(args), ...rpc },
    tablesExtra: {
      paige_chat_turns: store.table, paige_chat_threads: store.threadsTable,
      client_memory: () => [],
      ...(confirms ? { paige_pending_confirmations: confirms.table } : {}),
      ...tables,
    },
    serviceTablesExtra: { client_memory: () => [], ...service },
    ...(confirms ? { onInsert: mirrorConfirms(confirms) } : {}),
    concurrentRequests: concurrent,
  });
  const askThen = async (store, ask = ASK_FREE, opts = {}) => {
    const r = await turn(store, { toolCall: ask, ...opts });
    return { r, frame: choicesOf(r), askTurn: store.turns.filter((t) => t.role === "assistant").at(-1) ?? null };
  };
  const answer = (store, askId, text, opts = {}) => turn(store, { text, resume: { kind: "answer", ask_id: askId, ...(opts.skipped ? { skipped: true } : {}) }, ...opts });

  // ── 41.1 A MISSING SCALAR FACT. PAIGE asks (free-form, no options) and the turn waits; the person's
  // own words answer it; the SAME objective resumes. Red at base: the tool was never offered outside
  // Studio, nothing about the question was saved, and an answer was just another message.
  const s1 = makeThreadStore(THREADS);
  const a1 = await askThen(s1);
  assert("41.0 the main chat on a saved thread is offered the question tool (the owner seat)",
    offered(a1.r).includes("ask_choices"), JSON.stringify(offered(a1.r).filter((n) => /ask/.test(n))));
  const rec1 = readAskRecord(a1.askTurn?.bundle_ref?.paige_ask);
  assert("41.1 PAIGE asks a free-form question: one paige_choices frame with a server ask_id and no options; the turn ends waiting ASK_USER",
    !!a1.frame && /^[0-9a-f-]{36}$/.test(a1.frame.ask_id ?? "") && Array.isArray(a1.frame.options) && a1.frame.options.length === 0
      && terminalOf(a1.r)?.event === "waiting" && terminalOf(a1.r)?.state === "ASK_USER",
    JSON.stringify({ frame: a1.frame, terminal: terminalOf(a1.r) }));
  assert("41.1b the question turn IS the ask: saved with its words, paige_ask (same id, needs, objective) and turn_state ASK_USER waiting on choice",
    a1.askTurn?.content === ASK_FREE.args.prompt && rec1?.ask_id === a1.frame?.ask_id && rec1?.needs === "the start date"
      && rec1?.objective === "Setting up Kestrel's onboarding"
      && a1.askTurn?.bundle_ref?.turn_state?.state === "ASK_USER" && a1.askTurn?.bundle_ref?.turn_state?.waiting_on?.kind === "choice",
    JSON.stringify(a1.askTurn));
  const r1 = await answer(s1, a1.frame?.ask_id, "Start it November 1.");
  const claim1 = readAnswerClaim(s1.turns.find((t) => t.role === "user" && t.content === "Start it November 1.")?.bundle_ref?.paige_resume);
  assert("41.1c the answer is bound to the question once: the person's turn carries the claim answer:<ask_id> from the question turn",
    r1.status === 200 && claim1?.key === `answer:${a1.frame?.ask_id}` && claim1?.from_turn_id === a1.askTurn?.id
      && appends(r1, "user").length === 1,
    JSON.stringify({ status: r1.status, claim1, userAppends: appends(r1, "user").length }));
  assert("41.1d PAIGE continues the SAME objective: one model call, told (from the SAVED question) what she asked, what she was doing and what she needed",
    streamedCalls(r1).length === 1 && toldModel(r1).includes("THIS TURN CARRIES AN ANSWER FORWARD")
      && toldModel(r1).includes(ASK_FREE.args.prompt) && toldModel(r1).includes("Setting up Kestrel's onboarding") && toldModel(r1).includes("the start date"),
    toldModel(r1).slice(0, 200));
  assert("41.1e the wire says resumed once (WORKING) after started; the turn completes FINAL",
    resumedOf(r1).length === 1 && resumedOf(r1)[0].state === "WORKING" && turnFrames(r1)[0]?.event === "started" && terminalOf(r1)?.state === "FINAL",
    JSON.stringify(turnFrames(r1)));
  const cont1 = s1.turns.filter((t) => t.role === "assistant").at(-1);
  const res1 = readResumeRecord(cont1?.bundle_ref?.paige_resume);
  assert("41.1f the continuation is saved as the same objective resumed by an answer: turn_state.resumed {kind: answer}, paige_resume names the question turn",
    cont1?.bundle_ref?.turn_state?.resumed?.kind === "answer" && res1?.kind === "answer" && res1.from_turn_id === a1.askTurn?.id && res1.outcomes.length === 0,
    JSON.stringify(cont1?.bundle_ref));

  // ── 41.2 A BOUNDED CHOICE. Options ride the frame and the record; the selection resumes.
  const s2 = makeThreadStore(THREADS);
  const a2 = await askThen(s2, ASK_CHOICE);
  assert("41.2 a bounded choice: three options on the wire and in the saved record, single-select",
    a2.frame?.options?.length === 3 && a2.frame.multi === false && readAskRecord(a2.askTurn?.bundle_ref?.paige_ask)?.options?.map((o) => o.value).join() === "full_kickoff,light_start,mirror_lumen",
    JSON.stringify(a2.frame));
  const r2 = await answer(s2, a2.frame?.ask_id, "Light start");
  assert("41.2b picking an option resumes the same objective, with the choices PAIGE offered named for her",
    r2.status === 200 && resumedOf(r2).length === 1 && toldModel(r2).includes('"Light start" → "light_start"'),
    JSON.stringify({ status: r2.status, resumed: resumedOf(r2).length }));

  // ── 41.3 AN UNRELATED REPLY DOES NOT SILENTLY SATISFY THE ASK. (a) A message NOT sent as the answer
  // is an ordinary message: no claim, no resume, no note — and the question is then stale for good.
  // (b) A reply sent as the answer but that does not give the fact: PAIGE is told not to invent it.
  const s3 = makeThreadStore(THREADS);
  const a3 = await askThen(s3);
  const other3 = await turn(s3, { text: "Actually — who's on my calendar tomorrow?" });
  const u3 = s3.turns.find((t) => t.content === "Actually — who's on my calendar tomorrow?");
  assert("41.3 an ordinary message after an open question is NOT taken as its answer: no claim, no resumed frame, no answer note",
    other3.status === 200 && !u3?.bundle_ref?.paige_resume && resumedOf(other3).length === 0 && !toldModel(other3).includes("CARRIES AN ANSWER FORWARD"),
    JSON.stringify({ status: other3.status, bundle: u3?.bundle_ref, resumed: resumedOf(other3).length }));
  assert("41.3b the answer note forbids filling the missing fact from an unrelated reply, and says an answer approves nothing",
    /do not invent it, assume it, or fill it in from something unrelated/.test(answerTurnNote(readAskRecord(a3.askTurn?.bundle_ref?.paige_ask), { skipped: false }))
      && /approves nothing/.test(answerTurnNote(readAskRecord(a3.askTurn?.bundle_ref?.paige_ask), { skipped: false })),
    answerTurnNote(readAskRecord(a3.askTurn?.bundle_ref?.paige_ask), { skipped: false }));
  const s3b = makeThreadStore(THREADS);
  const a3b = await askThen(s3b);
  const unrelated = await answer(s3b, a3b.frame?.ask_id, "the weather is nice");
  assert("41.3c a reply sent as the answer that does not give the fact: PAIGE is told what she needed and not to invent it — nothing is written into any field",
    unrelated.status === 200 && toldModel(unrelated).includes("the start date") && toldModel(unrelated).includes("do not invent it")
      && unrelated.outboundCalls.length === 0 && unrelated.rec.rpc.every((c) => ["paige_chat_turn_append", "check_rate_limit", "current_user_tenant_id", "is_platform_operator", "is_platform_owner", "get_paige_persona_context", "match_paige_memory", "get_actor_access", "studio_role_ok", "is_tenant_admin_as", "resolve_tool_autonomy"].includes(c.name) || !/upsert|save|update|create|insert/.test(c.name)),
    JSON.stringify({ status: unrelated.status, outbound: unrelated.outboundCalls.length, rpcs: [...new Set(unrelated.rec.rpc.map((c) => c.name))] }));

  // ── 41.4 A STALE ASK REFUSES SAFELY: the question was superseded (41.3's ordinary message), so an
  // answer to it now is refused — 409, nothing appended, PAIGE never asked.
  const stale = await answer(s3, a3.frame?.ask_id, "Start it November 1.");
  assert("41.4 an answer to a question someone moved past: 409 ASK_NOT_OPEN, nothing saved, no model call",
    stale.status === 409 && bodyJson(stale)?.code === "ASK_NOT_OPEN" && appends(stale).length === 0 && stale.modelEgress.length === 0,
    JSON.stringify({ status: stale.status, body: bodyJson(stale), appends: appends(stale).length, egress: stale.modelEgress.length }));
  const unknownAsk = await answer(s3, crypto.randomUUID(), "Start it November 1.");
  assert("41.4b an answer naming a question this thread never asked: 409 ASK_NOT_OPEN, nothing saved, no model call",
    unknownAsk.status === 409 && bodyJson(unknownAsk)?.code === "ASK_NOT_OPEN" && appends(unknownAsk).length === 0 && unknownAsk.modelEgress.length === 0,
    JSON.stringify({ status: unknownAsk.status, body: bodyJson(unknownAsk) }));

  // ── 41.4c A question turn that did not END waiting (its answer was withheld by the final check, or it
  // was interrupted) is not open, even when its record names the question — nothing is answered.
  const s4c = makeThreadStore(THREADS);
  s4c.seed(THREAD, "user", "Set up onboarding for Kestrel.");
  s4c.seed(THREAD, "assistant", "I held that answer back after a final check.", {
    turn_state: { v: 1, state: "WITHHELD", mode: "clarify", rounds: 1, tools: 0 },
    paige_ask: { v: 1, ask_id: "c4c41000-0000-4000-8000-0000000000c4", question: "When should it start?", options: [], multi: false, allow_other: true, needs: "the start date", objective: "Onboarding" },
  });
  const notWaiting = await answer(s4c, "c4c41000-0000-4000-8000-0000000000c4", "Start it November 1.");
  assert("41.4c a question turn that ended WITHHELD (not waiting) cannot be answered: 409 ASK_NOT_OPEN, nothing saved, no model call",
    notWaiting.status === 409 && bodyJson(notWaiting)?.code === "ASK_NOT_OPEN" && appends(notWaiting).length === 0 && notWaiting.modelEgress.length === 0,
    JSON.stringify({ status: notWaiting.status, body: bodyJson(notWaiting) }));

  // ── 41.5 ONE ASK → ONE RESUME. Sent again later (a reload, a retry): refused as already answered.
  // Sent twice at once (a double tap, two tabs): the database lets one win; the other is refused
  // before any model call — one claim row, one continuation.
  const again = await answer(s1, a1.frame?.ask_id, "Start it November 1.");
  assert("41.5 an already-answered question cannot be answered again: 409 ASK_ALREADY_ANSWERED, nothing saved, no model call",
    again.status === 409 && bodyJson(again)?.code === "ASK_ALREADY_ANSWERED" && appends(again).length === 0 && again.modelEgress.length === 0,
    JSON.stringify({ status: again.status, body: bodyJson(again) }));
  const s5 = makeThreadStore(THREADS);
  const a5 = await askThen(s5);
  const double = await answer(s5, a5.frame?.ask_id, "Start it November 1.", { concurrent: 2 });
  const statuses5 = double.responses.map((x) => x.status).sort();
  const claims5 = s5.turns.filter((t) => t.role === "user" && t.bundle_ref?.paige_resume?.key === `answer:${a5.frame?.ask_id}`);
  const conts5 = s5.turns.filter((t) => t.role === "assistant" && t.bundle_ref?.paige_resume?.kind === "answer");
  assert("41.5b two answers at once: one 200 and one 409, ONE claim row, ONE continuation, ONE model call",
    JSON.stringify(statuses5) === JSON.stringify([200, 409]) && claims5.length === 1 && conts5.length === 1 && streamedCalls(double).length === 1
      && double.responses.some((x) => { try { return JSON.parse(x.bodyText).code === "ASK_ALREADY_ANSWERED"; } catch { return false; } }),
    JSON.stringify({ statuses5, claims: claims5.length, conts: conts5.length, streamed: streamedCalls(double).length }));

  // ── 41.6 RELOAD BEFORE THE ANSWER: what a reload reads is the question, open, exactly as asked
  // (the client rebuilds the card from this record — vitest). 41.7 RELOAD AFTER: the claim, then the
  // continuation, and the wire terminal = the saved state.
  const reread = s2.turns.find((t) => t.id === a2.askTurn?.id);
  assert("41.6 reload before answering: the latest turn is the question, its record still ASK_USER, its options readable as asked",
    !!reread && readAskRecord(reread.bundle_ref?.paige_ask)?.options?.length === 3 && reread.bundle_ref?.turn_state?.state === "ASK_USER"
      && JSON.stringify(readAskRecord(a1.askTurn?.bundle_ref?.paige_ask)) === JSON.stringify(a1.askTurn?.bundle_ref?.paige_ask),
    JSON.stringify(reread?.bundle_ref));
  const order1 = s1.turns.map((t) => `${t.role}:${t.bundle_ref?.paige_ask ? "ask" : t.bundle_ref?.paige_resume?.kind ?? "-"}`);
  assert("41.7 reload after answering: question → the answer (its claim) → the continuation (resumed), and the saved state is the wire's terminal",
    JSON.stringify(order1.slice(-3)) === JSON.stringify(["assistant:ask", "user:answer", "assistant:answer"])
      && cont1?.bundle_ref?.turn_state?.state === terminalOf(r1)?.state,
    JSON.stringify({ order1, saved: cont1?.bundle_ref?.turn_state?.state, wire: terminalOf(r1)?.state }));

  // ── 41.8 WORKSPACE SWITCH: the question was asked in A; the person is now in B. The thread is
  // refused (409 ACTIVE_ACCOUNT_CHANGED) before anything is read, claimed or asked.
  const s8 = makeThreadStore(THREADS);
  const a8 = await askThen(s8);
  const inB = await answer(s8, a8.frame?.ask_id, "Start it November 1.", { tenant: OTHER_TENANT });
  assert("41.8 (isolation 1) an answer from another workspace: 409 before anything — no claim, no model call, the question still open",
    inB.status === 409 && bodyJson(inB)?.code === "ACTIVE_ACCOUNT_CHANGED" && appends(inB).length === 0 && inB.modelEgress.length === 0
      && s8.turns.at(-1)?.id === a8.askTurn?.id,
    JSON.stringify({ status: inB.status, body: bodyJson(inB) }));
  // (isolation 2) the same person's OTHER workspace thread, naming this question's id: not that
  // thread's question, so not open there — and nothing in thread A moves.
  const crossThread = await answer(s8, a8.frame?.ask_id, "Start it November 1.", { tenant: OTHER_TENANT, threadId: THREAD_B });
  assert("41.8b (isolation 2) the same person in their other workspace's thread cannot answer this question: 409 ASK_NOT_OPEN, no model call, A untouched",
    crossThread.status === 409 && bodyJson(crossThread)?.code === "ASK_NOT_OPEN" && crossThread.modelEgress.length === 0
      && appends(crossThread).length === 0 && s8.turns.at(-1)?.id === a8.askTurn?.id,
    JSON.stringify({ status: crossThread.status, body: bodyJson(crossThread) }));
  // (isolation 3) a STALE declaration: the server resolves A, but the workspace the person declared
  // is B (profiles.active_tenant_id). Declared ∧ validated must agree, or nothing is answered.
  const staleDecl = await answer(s8, a8.frame?.ask_id, "Start it November 1.", { tables: { profiles: () => [{ user_id: USER, active_tenant_id: OTHER_TENANT }] } });
  assert("41.8c (isolation 3) a stale active-workspace declaration cannot answer: 409 ASK_NOT_OPEN, no claim, no model call",
    staleDecl.status === 409 && bodyJson(staleDecl)?.code === "ASK_NOT_OPEN" && appends(staleDecl).length === 0 && staleDecl.modelEgress.length === 0,
    JSON.stringify({ status: staleDecl.status, body: bodyJson(staleDecl), appends: appends(staleDecl).length }));
  // …and back in A with the declaration agreeing, the same question is still answerable, once.
  const backInA = await answer(s8, a8.frame?.ask_id, "Start it November 1.");
  assert("41.8d …back in A, declared and validated, the question is answered once and the objective resumes",
    backInA.status === 200 && resumedOf(backInA).length === 1, JSON.stringify({ status: backInA.status }));

  // ── 41.9 ANOTHER PERSON CANNOT ANSWER (isolation 4). The question lives in someone else's thread:
  // under RLS this caller reads none of it, and the append RPC refuses a thread they do not own.
  const s9 = makeThreadStore(THREADS);
  const theirAsk = s9.seed(THREAD_OTHER_USER, "assistant", "When should it start?", {
    turn_state: { v: 1, state: "ASK_USER", mode: "clarify", rounds: 1, tools: 0, waiting_on: { kind: "choice" } },
    paige_ask: { v: 1, ask_id: "c4c41000-0000-4000-8000-0000000000aa", question: "When should it start?", options: [], multi: false, allow_other: true, needs: "the start date", objective: "Onboarding" },
  });
  const foreignAnswer = await answer(s9, "c4c41000-0000-4000-8000-0000000000aa", "Start it November 1.", { threadId: THREAD_OTHER_USER });
  assert("41.9 (isolation 4) a second person cannot answer someone else's question: refused, nothing appended to their thread, no model call",
    foreignAnswer.status !== 200 && s9.turns.length === 1 && s9.turns[0].id === theirAsk && foreignAnswer.modelEgress.length === 0,
    JSON.stringify({ status: foreignAnswer.status, body: bodyJson(foreignAnswer), turns: s9.turns.length }));

  // ── 41.10 ASK_USER → answer → WAIT_APPROVAL: the answer gives the fact; what PAIGE then wants to do
  // is a consequential act, and it becomes a card — one objective, no execution, no other record.
  const s10 = makeThreadStore(THREADS);
  const c10 = makeConfirmStore();
  const a10 = await askThen(s10, ASK_FREE, { confirms: c10 });
  const r10 = await answer(s10, a10.frame?.ask_id, "Start it November 1.", { toolCall: PAGE, confirms: c10 });
  const card10 = framesOf(r10.bodyText).find((f) => f.paige_confirm)?.paige_confirm ?? null;
  const cont10 = s10.turns.filter((t) => t.role === "assistant").at(-1);
  assert("41.10 after the answer PAIGE proposes the act: a card, terminal WAIT_APPROVAL, the turn still records resumed {kind: answer}",
    !!card10?.fingerprint && terminalOf(r10)?.state === "WAIT_APPROVAL" && resumedOf(r10).length === 1
      && cont10?.bundle_ref?.turn_state?.resumed?.kind === "answer" && cont10?.bundle_ref?.turn_state?.state === "WAIT_APPROVAL"
      && r10.rec.rpc.filter((c) => c.name === "growth_page_upsert").length === 0 && c10.rows.length === 1 && !c10.rows[0].consumed,
    JSON.stringify({ card10, terminal: terminalOf(r10), upserts: r10.rec.rpc.filter((c) => c.name === "growth_page_upsert").length, rows: c10.rows.length }));

  // ── 41.11 …approval then runs it EXACTLY ONCE through C4a, in the same thread, and PAIGE continues.
  const approve11 = await turn(s10, { text: "Approved — run it.", body: { approvedConfirmations: [card10?.fingerprint] }, confirms: c10 });
  const resume11 = s10.turns.filter((t) => t.role === "assistant").at(-1);
  assert("41.11 approving the card the answer led to runs the stored act once (C4a), resumed {kind: approval}, from the card's turn",
    approve11.status === 200 && approve11.rec.rpc.filter((c) => c.name === "growth_page_upsert").length === 1 && c10.rows[0].consumed === true
      && resume11?.bundle_ref?.turn_state?.resumed?.kind === "approval" && readResumeRecord(resume11?.bundle_ref?.paige_resume)?.from_turn_id === cont10?.id,
    JSON.stringify({ status: approve11.status, upserts: approve11.rec.rpc.filter((c) => c.name === "growth_page_upsert").length, consumed: c10.rows[0].consumed, resumed: resume11?.bundle_ref?.turn_state }));
  const approve11b = await turn(s10, { text: "Approved — run it.", body: { approvedConfirmations: [card10?.fingerprint] }, confirms: c10 });
  assert("41.11b …and the same approval sent again runs nothing (one ask → one answer → one card → one execution)",
    approve11b.rec.rpc.filter((c) => c.name === "growth_page_upsert").length === 0
      && s10.turns.filter((t) => t.role === "user" && t.bundle_ref?.paige_resume?.kind === "answer").length === 1,
    JSON.stringify({ upserts: approve11b.rec.rpc.filter((c) => c.name === "growth_page_upsert").length }));

  // ── 41.12 AN ANSWER CONFERS NO AUTHORITY. "Yes, send it" as the answer still produces a card, never
  // an execution; and an answer cannot ride beside an approval in the same request.
  const s12 = makeThreadStore(THREADS);
  const c12 = makeConfirmStore();
  const a12 = await askThen(s12, ASK_FREE, { confirms: c12 });
  const yes = await answer(s12, a12.frame?.ask_id, "Yes, publish it now.", { toolCall: { name: PAGE.name, args: { ...PAGE.args, confirm: true } }, confirms: c12 });
  assert("41.12 an answer saying 'yes, publish it' is not an approval: the act becomes a card, nothing runs",
    framesOf(yes.bodyText).some((f) => f.paige_confirm) && yes.rec.rpc.filter((c) => c.name === "growth_page_upsert").length === 0
      && terminalOf(yes)?.state === "WAIT_APPROVAL",
    JSON.stringify({ cards: framesOf(yes.bodyText).filter((f) => f.paige_confirm).length, upserts: yes.rec.rpc.filter((c) => c.name === "growth_page_upsert").length }));
  const s12b = makeThreadStore(THREADS);
  const a12b = await askThen(s12b);
  const mixed = await answer(s12b, a12b.frame?.ask_id, "Start it November 1.", { body: { approvedConfirmations: ["0123456789abcdef"] } });
  assert("41.12b an answer cannot carry an approval beside it: refused before anything, no claim, no model call",
    mixed.status === 409 && bodyJson(mixed)?.code === "ASK_NOT_OPEN" && appends(mixed).length === 0 && mixed.modelEgress.length === 0,
    JSON.stringify({ status: mixed.status, body: bodyJson(mixed) }));

  // ── 41.13 OPERATOR / NO THREAD (isolation 5), classified on its own: with no thread nothing can be
  // bound, so the question tool is not offered (PAIGE asks in prose, unchanged) and an answer is refused.
  const s13 = makeThreadStore(THREADS);
  const noThread = await turn(s13, { threadId: null, rpc: { get_actor_access: { data: { tier: "god" }, error: null }, ...PERSONA(null), is_platform_operator: { data: true, error: null } } });
  assert("41.13 (isolation 5) no thread (the Operator surface sends none): the question tool is not offered",
    noThread.status === 200 && !offered(noThread).includes("ask_choices"), JSON.stringify(offered(noThread).filter((n) => /ask/.test(n))));
  const noThreadAnswer = await answer(s13, crypto.randomUUID(), "Start it November 1.", { threadId: null });
  const whyRefused = (r) => r.logged.filter((l) => /answer not bound to a question/.test(l.msg)).map((l) => { try { return JSON.parse(l.msg.slice(l.msg.indexOf("{"))).why; } catch { return null; } });
  assert("41.13b …and an answer with no thread is refused for THAT reason (never read as anything): 409 ASK_NOT_OPEN, nothing saved, no model call",
    noThreadAnswer.status === 409 && bodyJson(noThreadAnswer)?.code === "ASK_NOT_OPEN" && noThreadAnswer.modelEgress.length === 0
      && JSON.stringify(whyRefused(noThreadAnswer)) === JSON.stringify(["no_thread"]) && noThreadAnswer.rec.from.every((f) => f.table !== "paige_chat_turns"),
    JSON.stringify({ status: noThreadAnswer.status, body: bodyJson(noThreadAnswer), why: whyRefused(noThreadAnswer) }));
  const clientSeat = await askThen(makeThreadStore(THREADS), ASK_FREE, { rpc: { get_actor_access: { data: { tier: "client" }, error: null } } });
  assert("41.13c a client portal seat is not offered the question tool",
    !offered(clientSeat.r).includes("ask_choices") && !clientSeat.frame, JSON.stringify(offered(clientSeat.r).filter((n) => /ask/.test(n))));
  // …and a client seat that names a question (one it could only have forged into its own thread) is
  // refused as a client seat, before the thread is read.
  const s13d = makeThreadStore(THREADS);
  s13d.seed(THREAD, "assistant", "When should it start?", {
    turn_state: { v: 1, state: "ASK_USER", mode: "clarify", rounds: 1, tools: 0, waiting_on: { kind: "choice" } },
    paige_ask: { v: 1, ask_id: "c4c41000-0000-4000-8000-0000000000d4", question: "When should it start?", options: [], multi: false, allow_other: true, needs: null, objective: null },
  });
  const seatAnswer = await answer(s13d, "c4c41000-0000-4000-8000-0000000000d4", "Start it November 1.", { rpc: { get_actor_access: { data: { tier: "client" }, error: null } } });
  assert("41.13d a client portal seat cannot answer a question: refused as a client seat, nothing saved, no model call",
    seatAnswer.status === 409 && JSON.stringify(whyRefused(seatAnswer)) === JSON.stringify(["client_seat"]) && appends(seatAnswer).length === 0 && seatAnswer.modelEgress.length === 0,
    JSON.stringify({ status: seatAnswer.status, why: whyRefused(seatAnswer) }));

  // (isolation 5, the other half) the platform operator in a PAIGE chat that DOES send its platform
  // thread (tenant NULL): offered, and the answer is bound under the operator's null scope, once.
  const THREAD_P = "c4c41000-0000-4000-8000-000000000004";
  const sP = makeThreadStore([...THREADS, { id: THREAD_P, tenant_id: null, caller_user_id: USER }]);
  const OP41 = { ...PERSONA(null), current_user_tenant_id: { data: null, error: null }, get_actor_access: { data: { tier: "god" }, error: null }, is_platform_operator: { data: true, error: null }, is_platform_owner: { data: true, error: null } };
  const opAsk = await askThen(sP, ASK_FREE, { threadId: THREAD_P, rpc: OP41 });
  const opAnswer = await answer(sP, opAsk.frame?.ask_id, "Start it November 1.", { threadId: THREAD_P, rpc: OP41 });
  assert("41.13e (isolation 5) the operator in a PAIGE chat with its platform thread: offered, and the answer is bound once under the null scope",
    offered(opAsk.r).includes("ask_choices") && opAnswer.status === 200 && resumedOf(opAnswer).length === 1
      && sP.turns.filter((t) => t.role === "user" && t.bundle_ref?.paige_resume?.key === `answer:${opAsk.frame?.ask_id}`).length === 1,
    JSON.stringify({ offered: offered(opAsk.r).includes("ask_choices"), status: opAnswer.status, body: bodyJson(opAnswer) }));

  // ── 41.14 A QUESTION ASKED BESIDE OTHER CALLS (main chat): the other calls run; the question is not
  // shown (it could be answered before they finish) and PAIGE is told to ask it on its own. Red at
  // base in Studio's rule: the sibling calls were silently dropped.
  const s14 = makeThreadStore(THREADS);
  const beside = await turn(s14, { toolCall: { batch: [{ name: "web_search", args: { query: "Kestrel Group" } }, ASK_FREE] } });
  assert("41.14 a question beside another call: not shown, the other call ran, PAIGE told 'ask it on its own'",
    !choicesOf(beside) && toldModel(beside).includes('"ask_alone"') && terminalOf(beside)?.state !== "ASK_USER"
      && toldModel(beside).includes('"tool_use_id":"toolu_test_0"') && toldModel(beside).includes('"tool_use_id":"toolu_test_1"'),
    JSON.stringify({ choices: choicesOf(beside), terminal: terminalOf(beside) }));

  // ── 41.15 SKIP — "use your best guess" is an answer too: bound once, and PAIGE is told to choose.
  const s15 = makeThreadStore(THREADS);
  const a15 = await askThen(s15, ASK_CHOICE);
  const skip = await answer(s15, a15.frame?.ask_id, "Use your best guess.", { skipped: true });
  const claim15 = readAnswerClaim(s15.turns.find((t) => t.role === "user" && t.bundle_ref?.paige_resume)?.bundle_ref?.paige_resume);
  assert("41.15 skip: the claim records skipped, the objective resumes, and PAIGE is told to pick and say what she picked",
    skip.status === 200 && claim15?.skipped === true && resumedOf(skip).length === 1 && toldModel(skip).includes("use your best judgement"),
    JSON.stringify({ status: skip.status, claim15 }));

  // ── 41.16 STUDIO KEEPS ITS QUESTION EXACTLY (two to four options required, its own wording), and its
  // question is now saved the same way (one record, one seam). Fixture as group 32 drives Studio.
  const SESSION16 = "5e550000-0000-4000-8000-000000000041";
  const s16 = makeThreadStore(THREADS);
  const studioTables16 = {
    paige_chat_threads: (filters) => s16.threadsTable(filters).map((t) => ({ ...t, studio_session_id: SESSION16, last_image_content_id: null, last_image_anchor_at: null })),
    paige_subagents: () => [{ name: "Design Studio", system_prompt: "You design pages for this business." }],
    studio_sessions: () => [{ id: SESSION16, artifact_refs: [], title: "Kestrel launch" }],
  };
  const studioScope16 = { paige_subagents: (filters) => (filters.some((f) => f[0] === "eq" && f[1] === "slug" && f[2] === "design-studio")
    ? [{ config: { capability_scope: { version: 1, mode: "allowlist", tools: ["ask_choices", "capability_status", "growth_list"] } } }] : []) };
  const studioAsk = await turn(s16, { toolCall: { name: "ask_choices", args: { prompt: "Which direction?", options: [{ label: "Bold", value: "bold" }, { label: "Calm", value: "calm" }] } }, tables: studioTables16, service: { user_roles: () => [{ role: "admin" }], ...studioScope16 } });
  const studioFree = await turn(s16, { toolCall: { name: "ask_choices", args: { prompt: "What should it say?" } }, tables: studioTables16, service: { user_roles: () => [{ role: "admin" }], ...studioScope16 } });
  const studioSaved = s16.turns.filter((t) => t.role === "assistant")[0];
  assert("41.16 Studio: a two-option question is shown and saved as the same record; a no-option question is still not shown there",
    choicesOf(studioAsk)?.options?.length === 2 && /^[0-9a-f-]{36}$/.test(choicesOf(studioAsk)?.ask_id ?? "")
      && readAskRecord(studioSaved?.bundle_ref?.paige_ask)?.ask_id === choicesOf(studioAsk)?.ask_id
      && !choicesOf(studioFree),
    JSON.stringify({ studio: choicesOf(studioAsk), free: choicesOf(studioFree), saved: studioSaved?.bundle_ref }));

  // ── 41.17 ONE ASK NEVER ENDS WITH ZERO RESUMES. The answer is claimed, then PAIGE cannot be reached
  // (the model gateway refuses). The question is asked AGAIN — the same words, need and objective, a
  // new id that names the one it re-asks, waiting ASK_USER — and the response says so (ASK_REOPENED,
  // with the new question). Red before this fix (independent verifier, F1): 500, the thread ended on
  // the claim, and the client's retry was refused "already answered" with nothing having come of it.
  const s17 = makeThreadStore(THREADS);
  const a17 = await askThen(s17);
  const fail17 = await answer(s17, a17.frame?.ask_id, "Start it November 1.", { failStreamCalls: [1] });
  const again17 = s17.turns.at(-1);
  const rec17 = readAskRecord(again17?.bundle_ref?.paige_ask);
  const order17 = s17.turns.map((t) => `${t.role}:${t.bundle_ref?.paige_ask ? "ask" : t.bundle_ref?.paige_resume?.kind ?? "-"}`);
  assert("41.17 PAIGE not reached after the claim: the SAME question is asked again (new id naming the old, waiting ASK_USER) and the reply says ASK_REOPENED with it",
    fail17.status >= 400 && bodyJson(fail17)?.code === "ASK_REOPENED" && bodyJson(fail17)?.ask_reopened?.ask_id === rec17?.ask_id
      && rec17?.ask_id !== a17.frame?.ask_id && rec17?.reopens === a17.frame?.ask_id && rec17?.question === ASK_FREE.args.prompt
      && rec17?.needs === "the start date" && rec17?.objective === "Setting up Kestrel's onboarding"
      && again17?.bundle_ref?.turn_state?.state === "ASK_USER" && again17?.bundle_ref?.turn_state?.waiting_on?.kind === "choice"
      && String(again17?.content).startsWith("I didn't finish carrying on from your answer. Anything I'd already done is saved.") && String(again17?.content).endsWith(ASK_FREE.args.prompt)
      && JSON.stringify(order17.slice(-3)) === JSON.stringify(["assistant:ask", "user:answer", "assistant:ask"]),
    JSON.stringify({ status: fail17.status, body: bodyJson(fail17), order17, again: again17 }));
  const old17 = await answer(s17, a17.frame?.ask_id, "Start it November 1.");
  assert("41.17b the first question, sent again: refused as re-asked (409 ASK_REOPENED, naming the open one) — never 'already answered', nothing saved, no model call",
    old17.status === 409 && bodyJson(old17)?.code === "ASK_REOPENED" && bodyJson(old17)?.ask_reopened?.ask_id === rec17?.ask_id
      && appends(old17).length === 0 && old17.modelEgress.length === 0,
    JSON.stringify({ status: old17.status, body: bodyJson(old17) }));
  const ok17 = await answer(s17, rec17?.ask_id, "Start it November 1.");
  const conts17 = s17.turns.filter((t) => t.role === "assistant" && t.bundle_ref?.turn_state?.resumed?.kind === "answer");
  assert("41.17c answering the re-asked question resumes the same objective once: one model call, the saved question carried forward, ONE continuation in the thread",
    ok17.status === 200 && streamedCalls(ok17).length === 1 && resumedOf(ok17).length === 1 && toldModel(ok17).includes("Setting up Kestrel's onboarding")
      && conts17.length === 1 && readResumeRecord(conts17[0].bundle_ref?.paige_resume)?.from_turn_id === again17?.id,
    JSON.stringify({ status: ok17.status, conts: conts17.length }));
  // …the same for a failure that is not the gateway: the claim is written and the request then throws
  // before PAIGE (here, the re-read after the claim throws → the outer catch), or that re-read fails.
  for (const [label, opts] of [
    ["a throw after the claim (outer catch)", (st) => { let reads = 0; return { tables: { paige_chat_turns: (f) => { reads += 1; if (reads === 2) throw new Error("fixture: connection reset"); return st.table(f); } } }; }],
    ["a failed re-read after the claim", () => { let reads = 0; return { tableErrors: { paige_chat_turns: () => { reads += 1; return reads === 2 ? { message: "fixture: read failed", code: "08006" } : null; } } }; }],
  ]) {
    const st = makeThreadStore(THREADS);
    const a = await askThen(st);
    const r = await answer(st, a.frame?.ask_id, "Start it November 1.", opts(st));
    const last = st.turns.at(-1);
    assert(`41.17d ${label}: the question is asked again, the reply says so, PAIGE was never called`,
      r.status >= 400 && bodyJson(r)?.code === "ASK_REOPENED" && readAskRecord(last?.bundle_ref?.paige_ask)?.reopens === a.frame?.ask_id
        && streamedCalls(r).length === 0,
      JSON.stringify({ status: r.status, body: bodyJson(r), last: last?.bundle_ref }));
  }

  // ── 41.18 A MESSAGE THAT LANDS BETWEEN THE CHECK AND THE CLAIM (another tab) moved past the question
  // first: the claim is written but does not directly follow the question, so PAIGE is not called, the
  // reply is ASK_NOT_OPEN, and the question reads as moved past from then on (never as answered).
  // Red before this fix (verifier F3): both requests ran, one continuing a question already moved past.
  const s18 = makeThreadStore(THREADS);
  const a18 = await askThen(s18);
  let slipped = false;
  const race18 = await answer(s18, a18.frame?.ask_id, "Start it November 1.", { rpc: { paige_chat_turn_append: (args) => {
    if (!slipped && args.p_role === "user" && args.p_bundle_ref?.paige_resume) { slipped = true; s18.seed(THREAD, "user", "Actually, who's on my calendar tomorrow?"); }
    return s18.append(args);
  } } });
  assert("41.18 a message from another tab slips in between the check and the claim: PAIGE is not called, 409 ASK_NOT_OPEN saying the answer is KEPT in the conversation (answer_kept — never 'send it as a new message'), and the question reads as moved past",
    slipped && race18.status === 409 && bodyJson(race18)?.code === "ASK_NOT_OPEN" && race18.modelEgress.length === 0
      && bodyJson(race18)?.answer_kept === true && /kept in the conversation/.test(bodyJson(race18)?.reason ?? "") && !/new message|back in the box/.test(bodyJson(race18)?.reason ?? "")
      && resolveLiveness(s18, a18.frame?.ask_id)?.state === "stale",
    JSON.stringify({ status: race18.status, body: bodyJson(race18), live: resolveLiveness(s18, a18.frame?.ask_id) }));

  // ── 41.19 A CLAIM WITH NOTHING AFTER IT. Younger than any request can run: PAIGE may still be on it —
  // said exactly so (ASK_ANSWER_IN_PROGRESS), nothing saved, no second model call. Older (the request
  // died: a crash, a workspace switch mid-answer): the question is asked again, so it can be answered.
  const strandedStore = (ageMs) => {
    const st = makeThreadStore(THREADS);
    const askId = crypto.randomUUID();
    st.seed(THREAD, "user", "Set up onboarding for Kestrel.");
    const q = st.seed(THREAD, "assistant", ASK_FREE.args.prompt, {
      turn_state: { v: 1, state: "ASK_USER", mode: "clarify", rounds: 1, tools: 0, waiting_on: { kind: "choice" } },
      paige_ask: { v: 1, ask_id: askId, question: ASK_FREE.args.prompt, options: [], multi: false, allow_other: true, needs: "the start date", objective: "Setting up Kestrel's onboarding" },
    });
    st.seed(THREAD, "user", "Start it November 1.", { paige_resume: { kind: "answer", key: `answer:${askId}`, from_turn_id: q } }, ageMs === null ? undefined : new Date(Date.now() - ageMs).toISOString());
    if (ageMs === null) delete st.turns.at(-1).created_at;
    return { st, askId };
  };
  const young = strandedStore(30_000);
  const young19 = await answer(young.st, young.askId, "Start it November 1.");
  const undated = strandedStore(null);
  const undated19 = await answer(undated.st, undated.askId, "Start it November 1.");
  assert("41.19 a claim with nothing after it, seconds old (or of unknown age): 409 ASK_ANSWER_IN_PROGRESS — said as 'already has your answer' (never claims she is still working), with the same 10-minute window the server applies — nothing saved, no model call",
    [young19, undated19].every((r) => r.status === 409 && bodyJson(r)?.code === "ASK_ANSWER_IN_PROGRESS" && /already has your answer/.test(bodyJson(r)?.reason ?? "") && !/still (be )?working/.test(bodyJson(r)?.reason ?? "") && /hasn't replied 10 minutes after you sent it/.test(bodyJson(r)?.reason ?? "")
      && appends(r).length === 0 && r.modelEgress.length === 0),
    JSON.stringify([young19, undated19].map((r) => ({ status: r.status, body: bodyJson(r) }))));
  const dead = strandedStore(11 * 60_000);
  const dead19 = await answer(dead.st, dead.askId, "Start it November 1.");
  const deadAgain = readAskRecord(dead.st.turns.at(-1)?.bundle_ref?.paige_ask);
  assert("41.19b a claim with nothing after it, older than any request can run: the question is asked again (ASK_REOPENED with it), no model call",
    dead19.status === 409 && bodyJson(dead19)?.code === "ASK_REOPENED" && deadAgain?.reopens === dead.askId && bodyJson(dead19)?.ask_reopened?.ask_id === deadAgain?.ask_id
      && dead19.modelEgress.length === 0 && appends(dead19, "assistant").length === 1 && appends(dead19, "user").length === 0,
    JSON.stringify({ status: dead19.status, body: bodyJson(dead19) }));
  const dead19b = await answer(dead.st, deadAgain?.ask_id, "Start it November 1.");
  assert("41.19c …and the re-asked question, answered, resumes the objective once",
    dead19b.status === 200 && resumedOf(dead19b).length === 1 && streamedCalls(dead19b).length === 1,
    JSON.stringify({ status: dead19b.status }));

  // ── 41.20 THE PERSON'S OTHER WORKSPACE IN THE THREAD'S PLACE AT CLAIM TIME: the append refuses the
  // thread ("belongs to a different workspace"). Retrying from here cannot change that, so the reply is
  // ASK_NOT_OPEN — not "try again in a moment" (verifier F6) — and PAIGE is never called.
  const s20 = makeThreadStore(THREADS);
  const a20 = await askThen(s20);
  const moved20 = await answer(s20, a20.frame?.ask_id, "Start it November 1.", { rpc: { paige_chat_turn_append: (args) => args.p_role === "user"
    ? { data: null, error: { code: "P0001", message: "thread belongs to a different workspace" } } : s20.append(args) } });
  assert("41.20 the append refuses the thread as another workspace's: 409 ASK_NOT_OPEN (not 503 'try again'), no model call",
    moved20.status === 409 && bodyJson(moved20)?.code === "ASK_NOT_OPEN" && moved20.modelEgress.length === 0,
    JSON.stringify({ status: moved20.status, body: bodyJson(moved20) }));
  // ── 41.17e THE FIRST QUESTION'S ID FOLLOWS THE CHAIN (re-verifier 2, V2-2). s17 now holds: the
  // question → its claim → the question asked again → ITS answer → PAIGE's continuation. The first id,
  // sent again, is already answered — never "PAIGE asked again" about a question that is no longer open.
  const old17e = await answer(s17, a17.frame?.ask_id, "Start it November 1.");
  assert("41.17e the first question's id, after its re-asked question was answered and continued: 409 ASK_ALREADY_ANSWERED (never ASK_REOPENED), nothing saved, no model call",
    old17e.status === 409 && bodyJson(old17e)?.code === "ASK_ALREADY_ANSWERED" && !bodyJson(old17e)?.ask_reopened
      && appends(old17e).length === 0 && old17e.modelEgress.length === 0
      && resolveLiveness(s17, a17.frame?.ask_id)?.state === "answered",
    JSON.stringify({ status: old17e.status, body: bodyJson(old17e), live: resolveLiveness(s17, a17.frame?.ask_id) }));
  // ── 41.17f THE GATEWAY'S OWN REFUSALS (429 rate limit, 402 credits) after the claim are not left with
  // an answer and nothing after it either: the question is asked again and the status is kept (adopted
  // from re-verifier 2's VFY2.429 / VFY2.402).
  for (const status of [429, 402]) {
    const sg = makeThreadStore(THREADS);
    const ag = await askThen(sg);
    const rg = await answer(sg, ag.frame?.ask_id, "Start it November 1.", { failStreamCalls: [1], failStreamStatus: status });
    const lastg = sg.turns.at(-1);
    assert(`41.17f gateway ${status} after the claim: the question is asked again (ASK_REOPENED, status ${status} kept), PAIGE never reached`,
      rg.status === status && bodyJson(rg)?.code === "ASK_REOPENED" && readAskRecord(lastg?.bundle_ref?.paige_ask)?.reopens === ag.frame?.ask_id
        && bodyJson(rg)?.ask_reopened?.ask_id === readAskRecord(lastg?.bundle_ref?.paige_ask)?.ask_id,
      JSON.stringify({ status: rg.status, body: bodyJson(rg), last: lastg?.bundle_ref }));
  }

  // ── 41.19d A STRANDED CLAIM IS RE-ASKED EXACTLY ONCE (re-verifier 2, V2-1). The client now sends a
  // re-send of a claimed answer WITH its question's id; once the claim is older than any request can run
  // the question is asked again — and the same id sent again names THAT question, it does not ask a third.
  const once = strandedStore(11 * 60_000);
  const once1 = await answer(once.st, once.askId, "Start it November 1.");
  const onceQ = readAskRecord(once.st.turns.at(-1)?.bundle_ref?.paige_ask);
  const once2 = await answer(once.st, once.askId, "Start it November 1.");
  assert("41.19d a stranded claim re-sent twice: asked again ONCE (one assistant turn), the second send names that same question (ASK_REOPENED), no model call either time",
    once1.status === 409 && bodyJson(once1)?.code === "ASK_REOPENED" && onceQ?.reopens === once.askId
      && once2.status === 409 && bodyJson(once2)?.code === "ASK_REOPENED" && bodyJson(once2)?.ask_reopened?.ask_id === onceQ?.ask_id
      && appends(once2).length === 0 && once1.modelEgress.length + once2.modelEgress.length === 0
      && once.st.turns.filter((t) => readAskRecord(t.bundle_ref?.paige_ask)?.reopens === once.askId).length === 1,
    JSON.stringify({ once1: bodyJson(once1), once2: bodyJson(once2) }));
  // ── 41.19e TWO RE-SENDS OF A STRANDED CLAIM AT ONCE (two tabs) can each save the re-asked question —
  // but neither reaches PAIGE, the first id then names the NEWEST, and only one answer to it ever runs.
  const pair = strandedStore(11 * 60_000);
  const pair1 = await answer(pair.st, pair.askId, "Start it November 1.", { concurrent: 2 });
  const reasks = pair.st.turns.filter((t) => readAskRecord(t.bundle_ref?.paige_ask)?.reopens === pair.askId).map((t) => readAskRecord(t.bundle_ref.paige_ask).ask_id);
  const named = resolveLiveness(pair.st, pair.askId);
  const pairAns = await answer(pair.st, reasks.at(-1), "Start it November 1.", { concurrent: 2 });
  const pairOlder = reasks.length > 1 ? await answer(pair.st, reasks[0], "Start it November 1.") : null;
  const pairConts = pair.st.turns.filter((t) => t.role === "assistant" && t.bundle_ref?.turn_state?.resumed?.kind === "answer");
  assert("41.19e two re-sends of a stranded claim at once: no model call, both ASK_REOPENED; the first id names the newest re-ask; answering it twice at once runs ONCE; an older re-ask is refused",
    pair1.modelEgress.length === 0 && pair1.responses.every((x) => x.status === 409 && JSON.parse(x.bodyText).code === "ASK_REOPENED")
      && reasks.length >= 1 && reasks.length <= 2 && named?.state === "reopened" && named?.ask?.ask_id === reasks.at(-1)
      && JSON.stringify(pairAns.responses.map((x) => x.status).sort()) === JSON.stringify([200, 409]) && streamedCalls(pairAns).length === 1
      && pairConts.length === 1 && (pairOlder === null || (pairOlder.status === 409 && pairOlder.modelEgress.length === 0)),
    JSON.stringify({ first: pair1.responses.map((x) => [x.status, x.bodyText.slice(0, 60)]), reasks, named, answered: pairAns.responses.map((x) => x.status), older: pairOlder && [pairOlder.status, bodyJson(pairOlder)?.code] }));
  // ── 41.19f TWO RE-SENDS OF A YOUNG CLAIM AT ONCE (the first request may still be running): both told
  // "already has your answer", nothing saved, PAIGE never called a second time.
  const youngPair = strandedStore(30_000);
  const yp = await answer(youngPair.st, youngPair.askId, "Start it November 1.", { concurrent: 2 });
  assert("41.19f two re-sends of a young claim at once: both 409 ASK_ANSWER_IN_PROGRESS, nothing saved, no model call",
    yp.responses.every((x) => x.status === 409 && JSON.parse(x.bodyText).code === "ASK_ANSWER_IN_PROGRESS") && yp.modelEgress.length === 0 && youngPair.st.turns.length === 3,
    JSON.stringify(yp.responses.map((x) => [x.status, x.bodyText.slice(0, 60)])));

  // ── 41.21 A FAILURE INSIDE THE CONTINUATION (PAIGE was reached, a tool then threw) ends in its own
  // interrupted turn — "I hit a snag…" — and that turn still names the question it continued, so the
  // record says the answer was carried forward (re-verifier 2, V2-5) and the question reads answered.
  const unreadable21 = new Proxy({}, { get() { throw new Error("fixture: unreadable error"); }, getPrototypeOf() { throw new Error("fixture: unreadable error"); } });
  const s21 = makeThreadStore(THREADS);
  const a21 = await askThen(s21);
  const r21 = await answer(s21, a21.frame?.ask_id, "Start it November 1.", { toolCall: { name: "integrations_list", args: {} }, rpc: { list_integration_surface: { data: null, error: unreadable21 } } });
  const snag21 = s21.turns.at(-1);
  assert("41.21 a throw inside the continuation: the snag turn is saved INTERRUPTED, resumed {kind: answer}, with paige_resume naming the question turn",
    r21.status === 200 && r21.bodyText.includes("I hit a snag finishing that") && snag21?.role === "assistant" && String(snag21?.content).startsWith("I hit a snag")
      && snag21?.bundle_ref?.turn_state?.state === "INTERRUPTED" && snag21?.bundle_ref?.turn_state?.resumed?.kind === "answer"
      && readResumeRecord(snag21?.bundle_ref?.paige_resume)?.from_turn_id === a21.askTurn?.id
      && resolveLiveness(s21, a21.frame?.ask_id)?.state === "answered",
    JSON.stringify({ status: r21.status, snag: snag21 }));

  // ── 41.22 A DOCUMENT TURN IS NOT OFFERED THE QUESTION (that path offers tools but runs none, so a
  // question there could never be shown) — the control is 41.0, the same thread without a file.
  const s22 = makeThreadStore(THREADS);
  const r22 = await turn(s22, { document: { fileName: "kestrel.pdf", base64: "JVBERi0xLjQK", mimeType: "application/pdf" }, text: "Here is Kestrel's agreement." });
  assert("41.22 a turn carrying a document on a saved thread is not offered ask_choices (other tools still are)",
    r22.status === 200 && offered(r22).length > 0 && !offered(r22).includes("ask_choices"),
    JSON.stringify({ status: r22.status, offeredAsk: offered(r22).includes("ask_choices"), n: offered(r22).length }));

  // ── 41.23 THE WORKSPACE CHANGES AFTER THE ANSWER WAS CHECKED AND BEFORE THE CLAIM (a turn carrying
  // protected evidence runs the pre-model re-check): 409 ACTIVE_ACCOUNT_CHANGED, NO claim written, PAIGE
  // not called — and the question is still open, so the same answer sent again from A binds once.
  const MEM23 = [{ client_user_id: USER, client_id: null, tenant_id: CALLER_TENANT, is_active: true, memory_type: "user_preference", content: "Kestrel prefers mornings", created_at: new Date().toISOString() }];
  const evidence23 = { tables: { client_memory: () => MEM23 }, service: { client_memory: () => MEM23 } };
  const s23 = makeThreadStore(THREADS);
  const a23 = await askThen(s23);
  let reads23 = 0;
  const r23 = await answer(s23, a23.frame?.ask_id, "Start it November 1.", { ...evidence23, rpc: { get_paige_persona_context: () => { reads23 += 1; return PERSONA(reads23 <= 1 ? CALLER_TENANT : OTHER_TENANT).get_paige_persona_context; } } });
  const live23 = resolveLiveness(s23, a23.frame?.ask_id);
  const back23 = await answer(s23, a23.frame?.ask_id, "Start it November 1.", evidence23);
  assert("41.23 the workspace changes between the answer check and the claim: 409 ACTIVE_ACCOUNT_CHANGED, no claim, no model call, the question still open — and answered once from A after",
    reads23 >= 2 && r23.status === 409 && bodyJson(r23)?.code === "ACTIVE_ACCOUNT_CHANGED" && appends(r23, "user").length === 0 && r23.modelEgress.length === 0
      && live23?.state === "live" && back23.status === 200 && resumedOf(back23).length === 1 && streamedCalls(back23).length === 1,
    JSON.stringify({ reads23, status: r23.status, body: bodyJson(r23), live23, back: back23.status }));

  // ── 41.23b THE WORKSPACE CHANGES AFTER PAIGE WAS REACHED (the in-stream re-check, mid-answer). The
  // stream stops and nothing can be saved after the claim (the thread now belongs to another workspace),
  // so the claim strands — and PAIGE may already have acted. What happens next must stay TRUE: the
  // re-sent answer is told PAIGE already has it (never that she is still working), the question asked
  // again never says nothing was done, and answering it tells PAIGE an earlier attempt may have done
  // part of the work, so she checks before repeating it.
  let found23b = null;
  for (let n = 3; n <= 8 && !found23b; n += 1) {
    const st = makeThreadStore(THREADS);
    const a = await askThen(st);
    let reads = 0;
    const r = await answer(st, a.frame?.ask_id, "Start it November 1.", { toolCall: PAGE, ...evidence23, rpc: { get_paige_persona_context: () => { reads += 1; return PERSONA(reads < n ? CALLER_TENANT : OTHER_TENANT).get_paige_persona_context; } } });
    if (r.status === 200 && streamedCalls(r).length >= 1 && /active workspace changed/i.test(r.bodyText)) found23b = { st, a, r, n };
  }
  const st23b = found23b?.st;
  const claim23b = st23b?.turns.at(-1);
  const live23b = found23b ? resolveLiveness(st23b, found23b.a.frame?.ask_id) : null;
  assert("41.23b the workspace changes after PAIGE was reached: the stream stops, the claim is the last turn (nothing saved after it) and reads as pending",
    !!found23b && claim23b?.role === "user" && !!claim23b?.bundle_ref?.paige_resume && appends(found23b.r, "assistant").length === 0 && live23b?.state === "pending",
    JSON.stringify({ n: found23b?.n ?? null, last: claim23b?.role ?? null, live: live23b }));
  const young23b = found23b ? await answer(st23b, found23b.a.frame?.ask_id, "Start it November 1.", evidence23) : null;
  if (claim23b) claim23b.created_at = new Date(Date.now() - 11 * 60_000).toISOString();
  const dead23b = found23b ? await answer(st23b, found23b.a.frame?.ask_id, "Start it November 1.", evidence23) : null;
  const again23b = st23b?.turns.at(-1);
  const againRec23b = readAskRecord(again23b?.bundle_ref?.paige_ask);
  assert("41.23c …re-sent inside the window it is told PAIGE already has it (not that she is still working); after the window the question is asked again, and neither the reply nor the re-asked question says nothing was done",
    young23b?.status === 409 && bodyJson(young23b)?.code === "ASK_ANSWER_IN_PROGRESS" && !/still (be )?working|nothing was done/i.test(bodyJson(young23b)?.reason ?? "")
      && dead23b?.status === 409 && bodyJson(dead23b)?.code === "ASK_REOPENED" && againRec23b?.reopens === found23b?.a.frame?.ask_id
      && /Anything she'd already done is saved/.test(bodyJson(dead23b)?.reason ?? "") && !/nothing was done/i.test(bodyJson(dead23b)?.reason ?? "")
      && String(again23b?.content).startsWith("I didn't finish carrying on from your answer. Anything I'd already done is saved.") && !/nothing was done/i.test(String(again23b?.content)),
    JSON.stringify({ young: young23b && bodyJson(young23b), dead: dead23b && bodyJson(dead23b), again: again23b?.content }));
  const re23b = againRec23b ? await answer(st23b, againRec23b.ask_id, "Start it November 1.", evidence23) : null;
  assert("41.23d …answering the re-asked question resumes once and tells PAIGE an earlier attempt may have done part of the work — check what exists, repeat nothing",
    re23b?.status === 200 && resumedOf(re23b).length === 1 && streamedCalls(re23b).length === 1
      && toldModel(re23b).includes("earlier attempt") && toldModel(re23b).includes("check what already exists") && toldModel(re23b).includes("do not repeat anything that already happened"),
    JSON.stringify({ status: re23b?.status }));
  // The control: a first answer is never told about an earlier attempt.
  assert("41.23e a first answer's note says nothing about an earlier attempt",
    !toldModel(found23b?.r ?? { modelEgress: [] }).includes("earlier attempt"),
    "first answer mentioned an earlier attempt");
}

// ── 43. INT-332 — AN ACCEPTED OFFER REACHES A TOOL, A CARD, A QUESTION OR A TRUTHFUL REFUSAL ─────────────
//
// Prod 2026-10-06, a long Solo thread: PAIGE closed a FINAL answer with "Want me to send that approval card
// now…?", the owner replied "Yes we may as well for sure", and the turn was FINAL / fast_answer / 0 tools:
// "Sending the approval card now…" — no tool, no card, no proposal row. The next turn guessed an authority
// rule ("if approvals are OFF I can run it directly"). These checks drive the REAL chat handler and the
// REAL crm-command door (its own claim, minting and executor calls) over a thread store and the shared
// proposal store. What they hold: an affirmative to ONE fresh offer PAIGE just made runs on the tier that
// calls tools and is told the offered step is the task; prose that claims a card no tool created, or that
// decides approval, is never the answer; and nothing here can create, run or duplicate an act the gate
// would not — a choice asks, a stale/standing/foreign offer is the ordinary path, an approval runs once.
console.log("\nINT-332 — an accepted offer reaches a tool, a card, a question or a truthful refusal");
{
  const continuity = await import("../../supabase/functions/_shared/paige-turn/continuity.ts").catch(() => ({}));
  const { CLAUDE_REASONING, CLAUDE_CLASSIFICATION } = await import("../../supabase/functions/_shared/claude-models.ts");
  const CORRECTION = continuity.CLAIM_CORRECTION ?? { card: "\u0000no-correction-at-base", authority: "\u0000no-correction-at-base" };
  const NOTE = continuity.NOTHING_RAN_NOTE ?? "\u0000no-note-at-base";
  const keptWithNote = (text) => `${text}\n\n${NOTE}`;
  const fallbackOf = (kind, didWork) => continuity.claimFallback ? continuity.claimFallback(kind, { didWork }) : "\u0000no-fallback-at-base";
  await import("../../supabase/functions/crm-command/index.ts");
  const door = capturedHandler();
  assert("43.G the real crm-command handler is the one these checks drive (not the chat's)", door !== handler, "captured the chat handler");

  const THREAD = "43320000-0000-4000-8000-000000000001";
  const THREAD_FRESH = "43320000-0000-4000-8000-000000000002";
  const THREAD_B = "43320000-0000-4000-8000-000000000003";        // the same person's thread in workspace B
  const THREAD_OTHER_USER = "43320000-0000-4000-8000-000000000004";
  const DEAL_ID = "a0799c2d-79ee-4880-b86a-7743b5e9d798";
  const THREADS = [
    { id: THREAD, tenant_id: CALLER_TENANT, caller_user_id: USER },
    { id: THREAD_FRESH, tenant_id: CALLER_TENANT, caller_user_id: USER },
    { id: THREAD_B, tenant_id: OTHER_TENANT, caller_user_id: USER },
    { id: THREAD_OTHER_USER, tenant_id: CALLER_TENANT, caller_user_id: FOREIGN },
  ];
  const framesOf = (text) => String(text ?? "").split("\n").filter((l) => l.startsWith("data: ") && l !== "data: [DONE]")
    .flatMap((l) => { try { return [JSON.parse(l.slice(6))]; } catch { return []; } });
  const cardsOf = (r) => framesOf(r.bodyText).filter((f) => f.paige_confirm).map((f) => f.paige_confirm);
  const contentOf = (r) => framesOf(r.bodyText).map((f) => f.choices?.[0]?.delta?.content ?? "").join("");
  const terminalOf = (r) => framesOf(r.bodyText).map((f) => f.paige_turn).filter(Boolean).find((t) => t.event === "completed" || t.event === "waiting") ?? null;
  const streamed = (r) => r.modelEgress.filter((b) => b.includes('"stream":true')).map((b) => { try { return JSON.parse(b); } catch { return {}; } });
  const modelOf = (r, i = 0) => streamed(r)[i]?.model ?? null;
  const told = (r) => r.modelEgress.join("\n").replace(/\\"/g, '"');
  const doorCalls = (r) => r.rec.functions.filter((f) => f.name === "crm-command");
  const savedAssistant = (store, threadId) => store.turns.filter((t) => t.thread_id === threadId && t.role === "assistant").at(-1) ?? null;

  // The door's world: the committed-result table it reads back and writes through, an owner seat, and the
  // canonical client it resolves the reference against — exactly as group 40 models it.
  const crmDb = () => ({ committed: new Map(), executions: [] });
  const crmRpcs = (db) => ({
    read_crm_command_result: (args) => ({ data: db.committed.get(`${args._tenant_id}:${args._actor_id}:${args._idempotency_key}`) ?? null, error: null }),
    execute_crm_command: (args) => {
      const key = `${args._tenant_id}:${args._actor_id}:${args._idempotency_key}`;
      const prior = db.committed.get(key);
      if (prior) return { data: { ...prior, replayed: true }, error: null };
      db.executions.push({ command: args._command, idempotency_key: args._idempotency_key });
      const result = { ok: true, outcome: "succeeded", action: args._command?.action, readback: { id: DEAL_ID } };
      db.committed.set(key, result);
      return { data: result, error: null };
    },
  });
  const realDoor = async (options) => {
    const res = await door(new Request("http://local/crm-command", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: options?.headers?.Authorization ?? "Bearer test-jwt" },
      body: JSON.stringify(options?.body ?? {}),
    }));
    const json = await res.json();
    return res.ok ? { data: json, error: null } : { data: null, error: { name: "FunctionsHttpError", message: `status ${res.status}`, context: { status: res.status, json: async () => json } } };
  };
  const CLIENT_REF = "CLT-0042";
  const clientsByFilter = (rows) => (filters) => rows.filter((row) => filters.every(([op, col, value]) => op !== "eq" || row[col] === value));
  const DOOR_SERVICE = {
    tenant_members: () => [{ role: "owner", status: "active" }],
    tenants: () => [{ account_number: 3855, account_type: "standalone", parent_tenant_id: null }],
    clients: clientsByFilter([{ id: OWN, tenant_id: CALLER_TENANT, account_number: CLIENT_REF, first_name: "Dana", last_name: "Reyes" }]),
    client_memory: () => [],
  };
  const SEAT = (tenant = CALLER_TENANT) => ({
    get_paige_persona_context: { data: [{ tenant_id: tenant, tenant_name: "T", playbook_config: null, playbook_slug: null, funding_enabled: false, brand: null }], error: null },
    current_user_tenant_id: { data: tenant, error: null },
    resolve_tool_autonomy: { data: "confirm", error: null },
    get_actor_access: { data: { tier: "tenant" }, error: null },
    studio_role_ok: { data: true, error: null },
    match_paige_memory: { data: [], error: null },
  });
  const ASSIGN = { name: "crm_assign_deal_contact", args: { deal_id: DEAL_ID, client_ref: CLIENT_REF, expected_version: 3 } };
  // The offer, shaped like prod's 15:21:48 turn (names swapped for the harness's own client).
  const OFFER = "Here's where things stand.\n\n**Sales / CRM** — anything that writes, I draft and you approve on a card.\n\n**Back to Dana** — the link is still outstanding. Want me to send that approval card now so we actually close this loop, and then move into building her $2,500 invoice for Wednesday?";
  // Prod's 15:25:30 reply, verbatim in shape: a card narrated, none created.
  const NARRATION = "Sending the approval card now for the canonical deal-to-contact link.\n\n**What you're approving:**\nLink deal \"Dana Reyes — Retainer\" to contact Dana Reyes.\n\nOnce you click Approve on the card, I'll read the deal back and confirm the link took.";
  // Prod's 15:26:19 reply: approval guessed from a setting.
  const BYPASS = "If approvals are OFF in your workspace, then I can run this link directly without the card — just say the word.";
  const AFTER_CARD = "That's in front of you now — approve it and I'll read the deal back.";
  const FINAL = (state = "FINAL") => ({ turn_state: { v: 1, state, mode: "answer", tools: 3, rounds: 2 } });
  const ago = (ms) => new Date(Date.now() - ms).toISOString();

  const seedOffer = (store, threadId, { history = 2, offer = OFFER, ageMs = 4 * 60_000, bundle = FINAL() } = {}) => {
    for (let i = 0; i < history; i++) store.seed(threadId, i % 2 ? "assistant" : "user", i % 2 ? `Earlier answer ${i}.` : `Earlier question ${i}.`, i % 2 ? FINAL() : null, ago(ageMs + (history - i) * 60_000));
    return store.seed(threadId, "assistant", offer, bundle, ago(ageMs));
  };
  const turn = (store, confirms, db, { text, threadId = THREAD, script, tenant = CALLER_TENANT, body = {}, failStreamCalls = [], ...classified } = {}) => drive({
    stream: true, text, streamScript: script, failStreamCalls, ...("classification" in classified ? { classification: classified.classification } : {}),
    extraBody: { threadId, ...body },
    rpcOverrides: { ...SEAT(tenant), ...crmRpcs(db), paige_chat_turn_append: (args) => store.append(args) },
    tablesExtra: { paige_chat_turns: store.table, paige_chat_threads: store.threadsTable, client_memory: () => [], paige_pending_confirmations: confirms.table },
    serviceTablesExtra: { user_roles: () => [{ role: "admin" }], ...DOOR_SERVICE },
    onInsert: mirrorConfirms(confirms),
    functionsExtra: { "crm-command": realDoor },
  });

  // ── 43.1 THE PROD STRAND, on a LONG thread (40 earlier turns). PAIGE narrates the card first — exactly
  // what the cheap tier did — then, corrected inside the same turn, calls the tool. The real door mints
  // ONE proposal; the wire, the saved turn and the store agree; the narration never reaches the person.
  // Red at base: the cheap tier, no note, and the narration saved as FINAL with no card.
  const s1 = makeThreadStore(THREADS), c1 = makeConfirmStore(), db1 = crmDb();
  seedOffer(s1, THREAD, { history: 40 });
  const r1 = await turn(s1, c1, db1, { text: "Yes we may as well for sure", script: [NARRATION, ASSIGN, AFTER_CARD] });
  const card1 = cardsOf(r1).flat()[0] ?? null;
  const saved1 = savedAssistant(s1, THREAD);
  assert("43.1a F1 (long thread) the accepted offer runs on the reasoning tier, not the cheap one",
    modelOf(r1, 0) === CLAUDE_REASONING, JSON.stringify({ model: modelOf(r1, 0) }));
  assert("43.1b …and PAIGE is told the person is answering her offer, quoting the offer she made",
    told(r1).includes("THE PERSON IS ANSWERING YOUR OFFER") && told(r1).includes("Want me to send that approval card now"), "no foreground note");
  assert("43.1c the narrated card is corrected inside the turn (no card existed), on the reasoning tier",
    told(r1).includes(CORRECTION.card) && modelOf(r1, 1) === CLAUDE_REASONING, JSON.stringify({ second: modelOf(r1, 1) }));
  assert("43.1d F10 the real door minted exactly ONE crm_assign_deal_contact proposal, and one card went out naming it",
    doorCalls(r1).length === 1 && c1.rows.length === 1 && c1.rows[0].tool_name === "crm_assign_deal_contact" && !!card1 && db1.executions.length === 0,
    JSON.stringify({ door: doorCalls(r1).length, rows: c1.rows.map((r) => r.tool_name), card: card1, executions: db1.executions.length }));
  assert("43.1e F10 wire = persist: the turn ends WAIT_APPROVAL and the saved turn carries the same card",
    terminalOf(r1)?.state === "WAIT_APPROVAL" && saved1?.bundle_ref?.turn_state?.state === "WAIT_APPROVAL"
      && saved1?.bundle_ref?.paige_confirm?.[0]?.fingerprint === card1?.fingerprint && c1.rows[0].fingerprint === card1?.fingerprint,
    JSON.stringify({ terminal: terminalOf(r1), saved: saved1?.bundle_ref?.turn_state, savedFp: saved1?.bundle_ref?.paige_confirm?.[0]?.fingerprint, wireFp: card1?.fingerprint }));
  assert("43.1f the narration never reached the person: not on the wire, not in the saved turn",
    !contentOf(r1).includes("Sending the approval card now") && !String(saved1?.content).includes("Sending the approval card now"),
    JSON.stringify({ wire: contentOf(r1).slice(0, 120), saved: String(saved1?.content).slice(0, 120) }));

  // ── 43.2 THE FRESH-THREAD CONTROL: the same offer as a thread's first exchange; PAIGE calls the tool at once.
  const s2 = makeThreadStore(THREADS), c2 = makeConfirmStore(), db2 = crmDb();
  seedOffer(s2, THREAD_FRESH, { history: 1 });
  const r2 = await turn(s2, c2, db2, { text: "Yes we may as well for sure", threadId: THREAD_FRESH, script: [ASSIGN, AFTER_CARD] });
  const card2 = cardsOf(r2).flat()[0] ?? null;
  assert("43.2 F1 (fresh thread) reasoning tier, one door call, one proposal, one card, WAIT_APPROVAL, no correction needed",
    modelOf(r2, 0) === CLAUDE_REASONING && doorCalls(r2).length === 1 && c2.rows.length === 1 && !!card2
      && terminalOf(r2)?.state === "WAIT_APPROVAL" && !told(r2).includes(CORRECTION.card),
    JSON.stringify({ model: modelOf(r2, 0), door: doorCalls(r2).length, rows: c2.rows.length, terminal: terminalOf(r2) }));

  // ── 43.3 F11 — the card is approved: the door runs the stored act exactly once, through C4, and a
  // second approval of the same card runs nothing.
  const r3 = card2 ? await turn(s2, c2, db2, { text: "Approved — run it.", threadId: THREAD_FRESH, body: { approvedConfirmations: [card2.fingerprint] }, script: ["Done — Dana's deal is linked to her record."] }) : null;
  const r3b = card2 ? await turn(s2, c2, db2, { text: "Approved — run it.", threadId: THREAD_FRESH, body: { approvedConfirmations: [card2.fingerprint] }, script: ["Done."] }) : null;
  assert("43.3 F11 approving the minted card executes the stored assign once; approving it again executes nothing more",
    db2.executions.length === 1 && db2.executions[0].command?.action === "deal.assign_contact" && c2.rows[0].consumed === true && !!r3 && !!r3b,
    JSON.stringify({ executions: db2.executions.map((e) => e.command?.action), consumed: c2.rows[0]?.consumed }));

  // ── 43.4 F12 — a card is already standing (the previous turn is WAIT_APPROVAL) and the person says "yes"
  // again: that is not an offer to accept, PAIGE is not told it is, and even when she re-emits the same
  // call the door does not create a second proposal. Pointing at the card above is not an unbacked claim.
  const s4 = makeThreadStore(THREADS), c4 = makeConfirmStore(), db4 = crmDb();
  seedOffer(s4, THREAD_FRESH, { history: 1 });
  await turn(s4, c4, db4, { text: "yes", threadId: THREAD_FRESH, script: [ASSIGN, AFTER_CARD] });
  const r4 = await turn(s4, c4, db4, { text: "yes", threadId: THREAD_FRESH, script: [ASSIGN, "The card above is still waiting — approve it there."] });
  const liveRows4 = c4.rows.filter((r) => !r.consumed);
  assert("43.4 F12 with a card standing, a second yes is not read as an offer and creates no second live proposal; nothing executes",
    !told(r4).includes("THE PERSON IS ANSWERING YOUR OFFER") && liveRows4.length === 1 && db4.executions.length === 0 && !told(r4).includes(CORRECTION.card),
    JSON.stringify({ rows: c4.rows.length, live: liveRows4.length, executions: db4.executions.length }));

  // ── 43.5 F2 — other plain acceptances read the same way.
  for (const [i, reply] of ["sure", "go ahead", "yep 👍"].entries()) {
    const s = makeThreadStore(THREADS), c = makeConfirmStore(), db = crmDb();
    seedOffer(s, THREAD_FRESH, { history: 1 });
    const r = await turn(s, c, db, { text: reply, threadId: THREAD_FRESH, script: [ASSIGN, AFTER_CARD] });
    assert(`43.5.${i + 1} F2 "${reply}" accepts the offer: reasoning tier, the note, one card`,
      modelOf(r, 0) === CLAUDE_REASONING && told(r).includes("THE PERSON IS ANSWERING YOUR OFFER") && c.rows.length === 1,
      JSON.stringify({ model: modelOf(r, 0), rows: c.rows.length }));
  }

  // ── 43.6 F4 — an offer of alternatives: "yes" asks which; nothing is proposed.
  const s6 = makeThreadStore(THREADS), c6 = makeConfirmStore(), db6 = crmDb();
  seedOffer(s6, THREAD_FRESH, { history: 1, offer: "Two things are open.\n\nWant me to send the approval card now, or build her invoice first?" });
  const r6 = await turn(s6, c6, db6, { text: "yes", threadId: THREAD_FRESH, script: ["Which first — the link card or the invoice?"] });
  assert("43.6 F4 alternatives: PAIGE is told to ask which, she asks, and no door call or proposal happens",
    told(r6).includes("BUT IT NAMED MORE THAN ONE THING") && doorCalls(r6).length === 0 && c6.rows.length === 0 && terminalOf(r6)?.state === "FINAL",
    JSON.stringify({ door: doorCalls(r6).length, terminal: terminalOf(r6) }));

  // ── 43.7 F5 / F6 — an informational turn, and a stale offer: the ordinary path, on the ordinary tier.
  const s7 = makeThreadStore(THREADS), c7 = makeConfirmStore(), db7 = crmDb();
  seedOffer(s7, THREAD_FRESH, { history: 1, offer: "Your pipeline has 4 open deals worth $12,400. Dana's is still at $0." });
  const r7 = await turn(s7, c7, db7, { text: "ok", threadId: THREAD_FRESH, script: ["Anything else you want on it?"] });
  const s7b = makeThreadStore(THREADS), c7b = makeConfirmStore(), db7b = crmDb();
  seedOffer(s7b, THREAD_FRESH, { history: 1, ageMs: 2 * 60 * 60_000 });
  const r7b = await turn(s7b, c7b, db7b, { text: "yes", threadId: THREAD_FRESH, script: ["Do you mean the link to Dana from earlier? Want me to set that up now?"] });
  assert("43.7a F5 an acknowledgement of an informational answer is just that: cheap tier, no note, no correction, FINAL",
    modelOf(r7, 0) === CLAUDE_CLASSIFICATION && !told(r7).includes("ANSWERING YOUR OFFER") && !told(r7).includes("Correction:") && terminalOf(r7)?.state === "FINAL",
    JSON.stringify({ model: modelOf(r7, 0), terminal: terminalOf(r7) }));
  assert("43.7b F6 a two-hour-old offer is not continued by a bare yes: cheap tier, no note, nothing proposed",
    modelOf(r7b, 0) === CLAUDE_CLASSIFICATION && !told(r7b).includes("ANSWERING YOUR OFFER") && c7b.rows.length === 0,
    JSON.stringify({ model: modelOf(r7b, 0), rows: c7b.rows.length }));

  // ── 43.8 F7 / F8 — the offer is in another workspace's thread, or another person's: never continued.
  const s8 = makeThreadStore(THREADS), c8 = makeConfirmStore(), db8 = crmDb();
  seedOffer(s8, THREAD_B, { history: 1 });
  seedOffer(s8, THREAD_OTHER_USER, { history: 1 });
  // The model here answers in prose: what these hold is that the foreign offer is never READ as one.
  const ASKS = "Which deal do you mean?";
  const r8a = await turn(s8, c8, db8, { text: "yes", threadId: THREAD_B, script: [ASKS] });
  const r8b = await turn(s8, c8, db8, { text: "yes", threadId: THREAD_OTHER_USER, script: [ASKS] });
  assert("43.8a F7 a thread from another workspace: the turn is refused before PAIGE is reached — no note, no model call, no door call",
    !told(r8a).includes("ANSWERING YOUR OFFER") && streamed(r8a).length === 0 && doorCalls(r8a).length === 0,
    JSON.stringify({ status: r8a.status, calls: streamed(r8a).length, door: doorCalls(r8a).length }));
  assert("43.8b F8 another person's thread: their offer is invisible (RLS) and never continued — no note, cheap tier, nothing proposed",
    !told(r8b).includes("ANSWERING YOUR OFFER") && modelOf(r8b, 0) === CLAUDE_CLASSIFICATION && doorCalls(r8b).length === 0 && c8.rows.length === 0,
    JSON.stringify({ status: r8b.status, model: modelOf(r8b, 0), door: doorCalls(r8b).length, rows: c8.rows.length }));

  // ── 43.9 F9 — the offered act can't be done: a truthful refusal is a terminal answer (no loop, no fallback).
  const s9 = makeThreadStore(THREADS), c9 = makeConfirmStore(), db9 = crmDb();
  seedOffer(s9, THREAD_FRESH, { history: 1 });
  const REFUSAL = "I can't link that deal from here — it was closed after I offered, so there's nothing to link.";
  const r9 = await turn(s9, c9, db9, { text: "yes", threadId: THREAD_FRESH, script: [REFUSAL] });
  assert("43.9 F9 a truthful refusal ends the turn as said: one model call, FINAL, saved verbatim, nothing proposed",
    streamed(r9).length === 1 && terminalOf(r9)?.state === "FINAL" && savedAssistant(s9, THREAD_FRESH)?.content === REFUSAL && c9.rows.length === 0,
    JSON.stringify({ calls: streamed(r9).length, terminal: terminalOf(r9), saved: savedAssistant(s9, THREAD_FRESH)?.content }));

  // ── 43.10 THE MODEL NEVER CALLS THE TOOL. Every round narrates a card. After the correction budget the
  // server answers truthfully: the person reads that nothing is waiting, the wire and the transcript agree,
  // and nothing was proposed. Red at base: the narration is saved as the answer.
  const s10 = makeThreadStore(THREADS), c10 = makeConfirmStore(), db10 = crmDb();
  seedOffer(s10, THREAD_FRESH, { history: 1 });
  const r10 = await turn(s10, c10, db10, { text: "Yes we may as well for sure", threadId: THREAD_FRESH, script: [NARRATION, NARRATION, NARRATION, NARRATION, NARRATION] });
  const saved10 = savedAssistant(s10, THREAD_FRESH);
  assert("43.10 a card narrated every round never becomes the answer: the server's truthful sentence is on the wire and saved, the turn records its spent budget; nothing proposed",
    contentOf(r10).includes(fallbackOf("card", false)) && saved10?.content === fallbackOf("card", false) && !contentOf(r10).includes("Sending the approval card now")
      && terminalOf(r10)?.state === "LIMIT_REACHED" && saved10?.bundle_ref?.turn_state?.state === "LIMIT_REACHED"
      && c10.rows.length === 0 && doorCalls(r10).length === 0,
    JSON.stringify({ wire: contentOf(r10).slice(0, 160), saved: saved10?.content, terminal: terminalOf(r10), savedState: saved10?.bundle_ref?.turn_state?.state }));

  // ── 43.11 E — PAIGE deciding approval herself (prod's 15:26 reply) is corrected; her truthful answer stands.
  const s11 = makeThreadStore(THREADS), c11 = makeConfirmStore(), db11 = crmDb();
  seedOffer(s11, THREAD_FRESH, { history: 1, offer: "I've looked at Dana's deal. It's still unlinked." });
  const TRUTH = "Whether it needs your OK is decided when I set it up — I'll put it through and you'll get a card if it needs one.";
  const r11 = await turn(s11, c11, db11, { text: "The approval card doesn't show up", threadId: THREAD_FRESH, script: [BYPASS, TRUTH] });
  assert("43.11 E an authority claim ('approvals are OFF… run it directly') is corrected inside the turn and never reaches the person",
    told(r11).includes(CORRECTION.authority) && savedAssistant(s11, THREAD_FRESH)?.content === TRUTH && !contentOf(r11).includes("run this link directly"),
    JSON.stringify({ saved: savedAssistant(s11, THREAD_FRESH)?.content, wire: contentOf(r11).slice(0, 120) }));

  // ── 43.13 C1 — accepting the offer is action intent in any words: prose that only promises ("On it —
  // I'll link it now.") claims no card, so the claim guard does not see it; C1 must still carry the turn
  // on to the tool instead of letting the promise stand as the answer.
  const s13 = makeThreadStore(THREADS), c13 = makeConfirmStore(), db13 = crmDb();
  seedOffer(s13, THREAD_FRESH, { history: 1 });
  const r13 = await turn(s13, c13, db13, { text: "Yes we may as well for sure", threadId: THREAD_FRESH, script: ["On it — I'll link Dana's deal now.", ASSIGN, AFTER_CARD] });
  assert("43.13 C1 a promise without a tool call is continued (not a claim, so not the guard's), and the card is minted",
    told(r13).includes("The person accepted the step you offered") && !told(r13).includes(CORRECTION.card) && c13.rows.length === 1 && terminalOf(r13)?.state === "WAIT_APPROVAL",
    JSON.stringify({ rows: c13.rows.length, terminal: terminalOf(r13) }));

  // ── 43.14–43.18 — independent review round 1 (FIX_FIRST). The guard runs on every ordinary turn, so it
  // must stay quiet on true prose, and acceptance must stay narrow.
  // 43.14 a payment card is not an approval card: Sales prose on an ordinary turn stands as said.
  const s14 = makeThreadStore(THREADS), c14 = makeConfirmStore(), db14 = crmDb();
  seedOffer(s14, THREAD_FRESH, { history: 1, offer: "Dana's deal is linked." });
  const PAY = "The invoice is ready — Dana can pay by card or bank transfer. Your Stripe account is up, and card payments are ready.";
  const r14 = await turn(s14, c14, db14, { text: "How can Dana pay?", threadId: THREAD_FRESH, script: [PAY] });
  assert("43.14 a payment card is not an approval card: one model call, no correction, saved verbatim",
    streamed(r14).length === 1 && !told(r14).includes("Correction:") && savedAssistant(s14, THREAD_FRESH)?.content === PAY,
    JSON.stringify({ calls: streamed(r14).length, saved: savedAssistant(s14, THREAD_FRESH)?.content }));
  // 43.15 alternatives in separate paragraphs ask which — the yes never runs the last one.
  const s15 = makeThreadStore(THREADS), c15 = makeConfirmStore(), db15 = crmDb();
  seedOffer(s15, THREAD_FRESH, { history: 1, offer: "Want me to send the approval card now?\n\nOr should I build her invoice first?" });
  const r15 = await turn(s15, c15, db15, { text: "yes", threadId: THREAD_FRESH, script: ["Which first — the link card or the invoice?"] });
  assert("43.15 alternatives across paragraphs: PAIGE is told to ask which; nothing proposed",
    told(r15).includes("BUT IT NAMED MORE THAN ONE THING") && !told(r15).includes("that accepts it") && c15.rows.length === 0,
    JSON.stringify({ rows: c15.rows.length }));
  // 43.16 a decline worded as "ok" is not an acceptance.
  const s16 = makeThreadStore(THREADS), c16 = makeConfirmStore(), db16 = crmDb();
  seedOffer(s16, THREAD_FRESH, { history: 1 });
  const r16 = await turn(s16, c16, db16, { text: "Ok I'll do it myself", threadId: THREAD_FRESH, script: ["Sounds good — it's all yours."] });
  // (The tier here is the pre-existing literal-word router's — "do it" matches it — not the offer's.)
  assert("43.16 \"Ok I'll do it myself\" is not read as accepting the offer: no note, nothing proposed",
    !told(r16).includes("ANSWERING YOUR OFFER") && c16.rows.length === 0 && doorCalls(r16).length === 0,
    JSON.stringify({ model: modelOf(r16, 0), rows: c16.rows.length }));
  // 43.17 a true statement about approval is not PAIGE deciding it.
  const s17 = makeThreadStore(THREADS), c17 = makeConfirmStore(), db17 = crmDb();
  seedOffer(s17, THREAD_FRESH, { history: 1, offer: "Dana's deal is linked." });
  const TRUE17 = "Reads are free: approval is not needed to look up contacts. Tasks don't need a card either.";
  const r17 = await turn(s17, c17, db17, { text: "What needs my approval?", threadId: THREAD_FRESH, script: [TRUE17] });
  assert("43.17 explaining what needs approval is not an authority claim: no correction, saved verbatim",
    streamed(r17).length === 1 && savedAssistant(s17, THREAD_FRESH)?.content === TRUE17,
    JSON.stringify({ calls: streamed(r17).length, saved: savedAssistant(s17, THREAD_FRESH)?.content }));
  // 43.18 a real card minted, then an authority claim whose correction call FAILS: the turn still ends
  // WAIT_APPROVAL with its card (never INTERRUPTED), and the server's sentence does not hide the work.
  const s18 = makeThreadStore(THREADS), c18 = makeConfirmStore(), db18 = crmDb();
  seedOffer(s18, THREAD_FRESH, { history: 1 });
  const r18 = await turn(s18, c18, db18, { text: "yes", threadId: THREAD_FRESH, script: [ASSIGN, BYPASS], failStreamCalls: [3] });
  const saved18 = savedAssistant(s18, THREAD_FRESH);
  assert("43.18 a failed correction beside a minted card keeps WAIT_APPROVAL and the card; the reply is the server's, naming the work above",
    terminalOf(r18)?.state === "WAIT_APPROVAL" && saved18?.bundle_ref?.turn_state?.state === "WAIT_APPROVAL" && cardsOf(r18).flat().length === 1
      && saved18?.content === fallbackOf("authority", true) && c18.rows.length === 1,
    JSON.stringify({ terminal: terminalOf(r18), saved: saved18?.content, savedState: saved18?.bundle_ref?.turn_state?.state, cards: cardsOf(r18).flat().length }));

  // 43.19 (review round 2, S6) a tool ran, then a narrated card whose correction call FAILS: the turn is not
  // marked INTERRUPTED (the work it did stands) and the server's sentence says that work is shown above.
  const s19 = makeThreadStore(THREADS), c19 = makeConfirmStore(), db19 = crmDb();
  seedOffer(s19, THREAD_FRESH, { history: 1, offer: "Dana's deal is linked." });
  const r19 = await turn(s19, c19, db19, { text: "Find Dana for me.", threadId: THREAD_FRESH,
    script: [{ name: "crm_search_contacts", args: { query: "Dana" } }, NARRATION], failStreamCalls: [3] });
  const saved19 = savedAssistant(s19, THREAD_FRESH);
  assert("43.19 a failed correction after a tool ran: not INTERRUPTED, and the server's sentence names the work shown above",
    terminalOf(r19)?.state !== "INTERRUPTED" && saved19?.bundle_ref?.turn_state?.state !== "INTERRUPTED"
      && saved19?.content === fallbackOf("card", true) && c19.rows.length === 0,
    JSON.stringify({ terminal: terminalOf(r19), savedState: saved19?.bundle_ref?.turn_state?.state, saved: saved19?.content }));

  // 43.40 INT-334 (the R7 invariant) — A TOOL ROUND THAT NEVER FINISHED RUNS NOTHING. The provider shows a
  // whole tool call (the accepted step) and then the round is cut off, hits its token limit, or ends as a
  // refusal. Nothing from it executes — no door call, no card — no model is called again, and the turn
  // ends INTERRUPTED with the server's own sentence. The CONTROL is the same call, finished: one card.
  for (const [label, ending] of [["cut off", "cut"], ["at the token limit", "max_tokens"], ["as a refusal", "refusal"], ["CONTROL, finished", "tool_use"]]) {
    const s40 = makeThreadStore(THREADS), c40 = makeConfirmStore(), db40 = crmDb();
    seedOffer(s40, THREAD_FRESH, { history: 1 });
    const r40 = await turn(s40, c40, db40, { text: "Yes we may as well for sure", threadId: THREAD_FRESH, script: [{ ...ASSIGN, ending }, AFTER_CARD] });
    const saved40 = savedAssistant(s40, THREAD_FRESH);
    const calls40 = r40.modelEgress.filter((b) => b.includes('"stream":true')).length;
    if (ending === "tool_use") {
      assert(`43.40 ${label}: the same call from a finished round mints its card`,
        c40.rows.length === 1 && terminalOf(r40)?.state === "WAIT_APPROVAL",
        JSON.stringify({ rows: c40.rows.length, terminal: terminalOf(r40) }));
    } else {
      assert(`43.40 a whole tool call from a round ended ${label} runs nothing: no door call, no card, no second model call, the server's sentence, INTERRUPTED`,
        doorCalls(r40).length === 0 && c40.rows.length === 0 && calls40 === 1
          && saved40?.content?.startsWith("My last step was cut off before it finished, so I didn't run it.")
          && saved40?.content?.includes("Nothing was sent, saved or changed in this reply.")
          && saved40?.bundle_ref?.turn_state?.state === "INTERRUPTED",
        JSON.stringify({ door: doorCalls(r40).length, rows: c40.rows.length, calls: calls40, saved: saved40?.content, state: saved40?.bundle_ref?.turn_state?.state }));
    }
  }

  // 43.41 INT-334 (R7) — CUT-OFF ARGUMENTS IN A FINISHED ROUND ARE NEVER RUN AS {}. The CRM door's branch
  // reads a parse failure as `{}`; the dispatcher now refuses the call before any branch reads it, and the
  // model is told why (it can resend the call whole). The round itself finished, so the turn continues.
  {
    const s41 = makeThreadStore(THREADS), c41 = makeConfirmStore(), db41 = crmDb();
    seedOffer(s41, THREAD_FRESH, { history: 1 });
    const r41 = await turn(s41, c41, db41, { text: "Yes we may as well for sure", threadId: THREAD_FRESH,
      script: [{ name: ASSIGN.name, args: '{"deal_id":"' + ASSIGN.args.deal_id.slice(0, 8) }, "I couldn't finish that step — want me to try again?"] });
    assert("43.41 a finished round's call with cut-off arguments reaches no door (never run as {}), and the model is told ARGUMENTS_UNPARSEABLE",
      doorCalls(r41).length === 0 && c41.rows.length === 0 && told(r41).includes("ARGUMENTS_UNPARSEABLE"),
      JSON.stringify({ door: doorCalls(r41).length, rows: c41.rows.length, told: told(r41).includes("ARGUMENTS_UNPARSEABLE") }));
  }

  // 43.42 INT-334 R4 — THE ROUTE, END TO END: state decides first, and the classifier is called only where
  // state leaves the class open. An approval resume and an accepted act make no classifier call at all; a
  // fresh acknowledgement is the cheap tier only on a classifier's say-so; a classifier that fails, or one
  // that reads a bare go-ahead as act, keeps the turn on the reasoning tier.
  {
    const classified = (r) => r.modelEgress.filter((b) => b.includes("You label one message sent to PAIGE")).length;
    assert("43.42a an approval resume makes no classifier call (the stored act runs; no words are routed)",
      !!r3 && classified(r3) === 0, JSON.stringify({ classifier: r3 ? classified(r3) : "no card" }));
    assert("43.42b an accepted act makes no classifier call and runs on the reasoning tier",
      classified(r1) === 0 && modelOf(r1, 0) === CLAUDE_REASONING, JSON.stringify({ classifier: classified(r1), model: modelOf(r1, 0) }));
    const sTh = makeThreadStore(THREADS), cTh = makeConfirmStore(), dbTh = crmDb();
    const thanks = await turn(sTh, cTh, dbTh, { text: "thanks", threadId: THREAD_FRESH, script: ["Anytime."] });
    assert("43.42c a fresh 'thanks' labelled light conversation: one classifier call, the cheap tier",
      classified(thanks) === 1 && modelOf(thanks, 0) === CLAUDE_CLASSIFICATION, JSON.stringify({ classifier: classified(thanks), model: modelOf(thanks, 0) }));
    const sF = makeThreadStore(THREADS), cF = makeConfirmStore(), dbF = crmDb();
    const failed = await turn(sF, cF, dbF, { text: "thanks", threadId: THREAD_FRESH, script: ["Anytime."], classification: null });
    assert("43.42d the same 'thanks' with a classifier that fails: the conservative route, the reasoning tier",
      classified(failed) === 1 && modelOf(failed, 0) === CLAUDE_REASONING, JSON.stringify({ classifier: classified(failed), model: modelOf(failed, 0) }));
    const sD = makeThreadStore(THREADS), cD = makeConfirmStore(), dbD = crmDb();
    const doIt = await turn(sD, cD, dbD, { text: "do it", threadId: THREAD_FRESH, script: ["What would you like me to do?"],
      classification: { intent: "act", research: "none", difficulty: "trivial", image: "none", needs_workspace_data: false, confidence: 0.9 } });
    assert("43.42e a bare 'do it' labelled act never takes the cheap tier, even when trivial",
      modelOf(doIt, 0) === CLAUDE_REASONING, JSON.stringify({ model: modelOf(doIt, 0) }));
    // INT-334 R5b — the cheap round now carries the PRESENTATION set alone: the escalation signal
    // (plus ask_choices where a surface offers it), never a governed tool. The governed list stays
    // on the reasoning tier; the rescue for a misread cheap turn is the signal (43.43).
    const toolsOf = (r, i = 0) => streamed(r)[i]?.tools ?? null;
    const namesOf = (r, i = 0) => (toolsOf(r, i) ?? []).map((t) => t?.function?.name ?? t?.name).filter(Boolean);
    assert("43.42f the cheap round carries the presentation set alone — the escalation signal, no governed tool",
      Array.isArray(toolsOf(thanks, 0)) && namesOf(thanks, 0).includes("request_capability")
        && namesOf(thanks, 0).every((n) => n === "request_capability" || n === "ask_choices")
        && namesOf(failed, 0).length > namesOf(thanks, 0).length && namesOf(failed, 0).includes("crm_command_run") !== true,
      JSON.stringify({ cheap: namesOf(thanks, 0), reasoningCount: namesOf(failed, 0).length }));
    // INT-332 — a claim correction is operational work whatever the turn's own class: a cheap turn that
    // narrates a card it never minted is corrected on the reasoning tier, with the governed tools.
    const sC = makeThreadStore(THREADS), cC = makeConfirmStore(), dbC = crmDb();
    const cheapClaim = await turn(sC, cC, dbC, { text: "ok great", threadId: THREAD_FRESH, script: [NARRATION, "Sorry — I haven't set anything up yet."],
      classification: { intent: "converse", research: "none", difficulty: "trivial", image: "none", needs_workspace_data: false, confidence: 0.9 } });
    assert("43.42g a cheap turn's claim correction runs on the reasoning tier with the governed tools",
      modelOf(cheapClaim, 0) === CLAUDE_CLASSIFICATION && told(cheapClaim).includes(CORRECTION.card)
        && modelOf(cheapClaim, 1) === CLAUDE_REASONING && Array.isArray(toolsOf(cheapClaim, 1)) && toolsOf(cheapClaim, 1).length > 0,
      JSON.stringify({ calls: streamed(cheapClaim).map((b) => [b.model, b.tools?.length ?? null]), corrected: told(cheapClaim).includes(CORRECTION.card) }));

    // ── INT-334 R5b: the narrowing + the rescue. A cheap or read-only round never silently loses the
    // objective: it carries the `request_capability` signal, whose dispatch re-routes the SAME turn on
    // the operational class with the full governed set — and every widened call still passes the same
    // gates (the door, the card, the autonomy lanes). Cheap classification can neither make a
    // legitimate action disappear nor grant execution authority.
    // 43.43a — the rescue: a misread cheap turn escalates and the card still comes from the door.
    const sA = makeThreadStore(THREADS), cA = makeConfirmStore(), dbA = crmDb();
    const rescued = await turn(sA, cA, dbA, { text: "ok great", threadId: THREAD_FRESH,
      script: [{ name: "request_capability", args: {} }, { name: ASSIGN.name, args: { ...ASSIGN.args, confirm: true } }, AFTER_CARD],
      classification: { intent: "converse", research: "none", difficulty: "trivial", image: "none", needs_workspace_data: false, confidence: 0.9 } });
    assert("43.43a a cheap round that asks for capability re-routes to the reasoning tier with the governed tools",
      modelOf(rescued, 0) === CLAUDE_CLASSIFICATION && namesOf(rescued, 0).includes("request_capability")
        && modelOf(rescued, 1) === CLAUDE_REASONING && namesOf(rescued, 1).includes(ASSIGN.name)
        && told(rescued).includes("gates still decide"),
      JSON.stringify({ calls: streamed(rescued).map((b) => [b.model, b.tools?.length ?? null]) }));
    assert("43.43b the escalated act still goes through the door and mints the approval card — the rescue grants no authority",
      doorCalls(rescued).length === 1 && cA.rows.length === 1 && cA.rows[0].tool_name === ASSIGN.name
        && terminalOf(rescued)?.state === "WAIT_APPROVAL" && dbA.executions.length === 0,
      JSON.stringify({ door: doorCalls(rescued).length, rows: cA.rows.map((r) => r.tool_name), terminal: terminalOf(rescued)?.state, executions: dbA.executions.length }));
    // 43.43c — read exposure: a workspace-data answer keeps lookups, withholds writes, carries the signal.
    const sR = makeThreadStore(THREADS), cR = makeConfirmStore(), dbR = crmDb();
    const lookup = await turn(sR, cR, dbR, { text: "what do we have for Dana?", threadId: THREAD_FRESH,
      script: [{ name: "crm_search_contacts", args: { query: "Dana" } }, "Dana Reyes — Retainer, Enrolled."],
      classification: { intent: "answer", research: "none", difficulty: "routine", image: "none", needs_workspace_data: true, confidence: 0.9 } });
    const lookupNames = namesOf(lookup, 0);
    assert("43.43c a read turn keeps its lookups, withholds every mutating tool, and carries the signal",
      modelOf(lookup, 0) === CLAUDE_REASONING && lookupNames.includes("crm_search_contacts")
        && lookupNames.includes("request_capability") && !lookupNames.includes(ASSIGN.name) && !lookupNames.includes("crm_create_contact"),
      JSON.stringify({ model: modelOf(lookup, 0), kept: lookupNames.length, hasAssign: lookupNames.includes(ASSIGN.name) }));
    // 43.43d — bounded: a second signal on the escalated turn is answered, never a third model round.
    const sD2 = makeThreadStore(THREADS), cD2 = makeConfirmStore(), dbD2 = crmDb();
    const twice = await turn(sD2, cD2, dbD2, { text: "ok great", threadId: THREAD_FRESH,
      script: [{ name: "request_capability", args: {} }, { name: "request_capability", args: {} }, { name: ASSIGN.name, args: { ...ASSIGN.args, confirm: true } }, AFTER_CARD],
      classification: { intent: "converse", research: "none", difficulty: "trivial", image: "none", needs_workspace_data: false, confidence: 0.9 } });
    // The bound is layered: the once-per-turn flag answers a repeat in-band, and the loop's signature
    // dedupe (a second IDENTICAL call) ends the turn truthfully at its limit instead of looping. The
    // escalate flag alone would let a vary-args repeat spin; the dedupe closes that.
    assert("43.43d a repeated signal cannot loop the turn — the signature dedupe ends it truthfully at its limit",
      streamed(twice).length === 3 && terminalOf(twice)?.state === "LIMIT_REACHED" && !cardsOf(twice).length,
      JSON.stringify({ rounds: streamed(twice).length, terminal: terminalOf(twice)?.state }));
    // 43.43e — a refusal in prose on a cheap round stays terminal: the narrowing adds no loop.
    const sE = makeThreadStore(THREADS), cE = makeConfirmStore(), dbE = crmDb();
    const refused = await turn(sE, cE, dbE, { text: "ok great", threadId: THREAD_FRESH, script: ["I can't do that from here."],
      classification: { intent: "converse", research: "none", difficulty: "trivial", image: "none", needs_workspace_data: false, confidence: 0.9 } });
    assert("43.43e a stated refusal on a narrowed cheap round is terminal — exactly one model call",
      streamed(refused).length === 1 && modelOf(refused, 0) === CLAUDE_CLASSIFICATION,
      JSON.stringify({ rounds: streamed(refused).length }));
    // 43.43f — the action-intent continuation escalates too: a C1-continued cheap misread re-enters on
    // the reasoning tier with the governed tools (the latent R5a-era gap: roundClass stayed cheap).
    const sF2 = makeThreadStore(THREADS), cF2 = makeConfirmStore(), dbF2 = crmDb();
    seedOffer(sF2, THREAD_FRESH, { history: 1 });
    const cont = await turn(sF2, cF2, dbF2, { text: "please add Dana to the deal", threadId: THREAD_FRESH,
      script: ["Sure, considered it done.", { name: ASSIGN.name, args: { ...ASSIGN.args, confirm: true } }, AFTER_CARD],
      classification: { intent: "converse", research: "none", difficulty: "trivial", image: "none", needs_workspace_data: false, confidence: 0.9 } });
    assert("43.43f an action-intent continuation out of a cheap round runs on the reasoning tier with the governed tools",
      modelOf(cont, 0) === CLAUDE_CLASSIFICATION && modelOf(cont, 1) === CLAUDE_REASONING && namesOf(cont, 1).includes(ASSIGN.name),
      JSON.stringify({ calls: streamed(cont).map((b) => [b.model, b.tools?.length ?? null]) }));
    // 43.43h — behavioral, client seat: the seat CAN escalate (the round after the signal is
    // operational with the governed set), and the governed call it then makes is refused BY THE SEAT
    // GATE (`forbidden_seat`) — the capability never disappears, and never executes either.
    const sH = makeThreadStore(THREADS), cH = makeConfirmStore(), dbH = crmDb();
    const seatTurn = (opts) => drive({
      stream: true, text: "ok great", streamScript: opts.script,
      classification: { intent: "converse", research: "none", difficulty: "trivial", image: "none", needs_workspace_data: false, confidence: 0.9 },
      extraBody: { threadId: THREAD_FRESH },
      rpcOverrides: { ...SEAT(CALLER_TENANT), get_actor_access: { data: { tier: "client" }, error: null }, ...crmRpcs(dbH), paige_chat_turn_append: (args) => sH.append(args) },
      tablesExtra: { paige_chat_turns: sH.table, paige_chat_threads: sH.threadsTable, client_memory: () => [], paige_pending_confirmations: cH.table },
      serviceTablesExtra: { user_roles: () => [{ role: "admin" }], ...DOOR_SERVICE },
      onInsert: mirrorConfirms(cH),
      functionsExtra: { "crm-command": realDoor },
    });
    const seat = await seatTurn({ script: [{ name: "request_capability", args: {} }, { name: ASSIGN.name, args: { ...ASSIGN.args, confirm: true } }, "That action isn't available from a client seat — nothing was changed."] });
    assert("43.43h a client seat escalates, and the governed call it then makes is refused by the seat gate",
      modelOf(seat, 0) === CLAUDE_CLASSIFICATION && modelOf(seat, 1) === CLAUDE_REASONING && namesOf(seat, 1).includes(ASSIGN.name)
        && told(seat).includes("client portal seat") && doorCalls(seat).length === 0 && cH.rows.length === 0,
      JSON.stringify({ calls: streamed(seat).map((b) => b.model), refused: told(seat).includes("client portal seat"), door: doorCalls(seat).length, cards: cH.rows.length }));
    // 43.43i — the re-resolution honors the route's own cap at RUNTIME: an ambiguous offer that
    // signals does NOT get the write set — the person still chooses. (The route unit test pins the
    // resolver; this pins that the handler's escalation actually goes through it.)
    const sI = makeThreadStore(THREADS), cI = makeConfirmStore(), dbI = crmDb();
    seedOffer(sI, THREAD_FRESH, { history: 1, offer: "Two things are open for Dana.\n\nWant me to send the approval card? Or should I draft her invoice first?" });
    const amb = await turn(sI, cI, dbI, { text: "yes please", threadId: THREAD_FRESH,
      script: [{ name: "request_capability", args: {} }, "Which would you like first — the approval card, or the invoice draft?"],
      classification: { intent: "converse", research: "none", difficulty: "trivial", image: "none", needs_workspace_data: false, confidence: 0.9 } });
    assert("43.43i an ambiguous offer that escalates still carries reads, never the write set — the cap outranks the widening at runtime",
      modelOf(amb, 0) === CLAUDE_REASONING && namesOf(amb, 0).includes("request_capability") && !namesOf(amb, 0).includes(ASSIGN.name)
        && modelOf(amb, 1) === CLAUDE_REASONING && namesOf(amb, 1).includes("request_capability") && !namesOf(amb, 1).includes(ASSIGN.name)
        && cI.rows.length === 0,
      JSON.stringify({ calls: streamed(amb).map((b) => [b.model, (b.tools ?? []).length]), hasAssign: [namesOf(amb, 0).includes(ASSIGN.name), namesOf(amb, 1).includes(ASSIGN.name)], cards: cI.rows.length }));
    // 43.43g — source-level: the signal's dispatch sits BEFORE the client-seat gate, so a client seat's
    // question can escalate too — and every subsequent governed call still meets that gate.
    const handlerSrc = readFileSync(new URL("../../supabase/functions/paige-ai-chat/index.ts", import.meta.url), "utf8");
    const signalIdx = handlerSrc.indexOf('tc.function.name === REQUEST_CAPABILITY_NAME');
    const seatIdx = handlerSrc.indexOf("CLIENT-SEAT GATE");
    assert("43.43g the signal dispatches before the client-seat gate (the rescue works on every seat)",
      signalIdx > -1 && seatIdx > -1 && signalIdx < seatIdx,
      JSON.stringify({ signalIdx, seatIdx }));
  }

  // 43.20 (review round 4, structural) — on an accepted offer, a prose QUESTION is not a terminal answer: the
  // person already said yes to the step. Prose that claims no card (so the guard cannot see it) and ends on a
  // question used to stand as FINAL; it now continues to the tool and the card. A clarification goes through
  // ask_choices (ASK_USER); a stated refusal still ends the turn (43.9).
  const s20 = makeThreadStore(THREADS), c20 = makeConfirmStore(), db20 = crmDb();
  seedOffer(s20, THREAD_FRESH, { history: 1 });
  const r20 = await turn(s20, c20, db20, { text: "Yes we may as well for sure", threadId: THREAD_FRESH, script: ["Sure. Want me to start the invoice after?", ASSIGN, AFTER_CARD] });
  assert("43.20 an accepted offer answered with a prose question is continued to the tool: one card, WAIT_APPROVAL",
    told(r20).includes("The person accepted the step you offered") && c20.rows.length === 1 && terminalOf(r20)?.state === "WAIT_APPROVAL",
    JSON.stringify({ rows: c20.rows.length, terminal: terminalOf(r20) }));

  // 43.21 (review round 5, BLOCKING-1) — an offer to EXPLAIN or DRAFT is fulfilled by the prose itself. It
  // is not held to a tool: the answer stands as written, after one call, never replaced by the server's
  // "wasn't able to complete" sentence — whether or not it ends on a follow-up question.
  const EXPLAIN = "Approvals work like this: anything that writes to your records comes to you as a card first, and reads run freely. Your Trust settings decide how much runs on its own. Want me to open those settings for you?";
  const EXPLAIN_FLAT = "Approvals work like this: anything that writes to your records comes to you as a card first, and reads run freely.";
  const DRAFT = "Here's a draft:\n\nSubject: Quick check-in\n\nHi Dana, just checking you got the link. Happy to hop on a call.\n\nWant me to tweak the tone?";
  for (const [id, offer, answer] of [
    ["43.21a", "That's the pipeline.\n\nWant me to walk you through how approvals work here?", EXPLAIN],
    ["43.21b", "That's the pipeline.\n\nWant me to walk you through how approvals work here?", EXPLAIN_FLAT],
    ["43.21c", "Dana hasn't replied in a week.\n\nWant me to draft a short follow-up you can send her?", DRAFT],
  ]) {
    const s21 = makeThreadStore(THREADS), c21 = makeConfirmStore(), db21 = crmDb();
    seedOffer(s21, THREAD_FRESH, { history: 1, offer });
    const r21 = await turn(s21, c21, db21, { text: "sure", threadId: THREAD_FRESH, script: [answer, answer, answer, answer] });
    const saved21 = savedAssistant(s21, THREAD_FRESH);
    assert(`${id} an accepted offer to explain/draft: the prose answer stands after one call, nothing is replaced`,
      streamed(r21).length === 1 && saved21?.content === answer && contentOf(r21).includes(answer.slice(0, 40))
        && told(r21).includes("THE PERSON IS ANSWERING YOUR OFFER") && !told(r21).includes("The person accepted the step you offered")
        && terminalOf(r21)?.state !== "LIMIT_REACHED" && c21.rows.length === 0,
      JSON.stringify({ calls: streamed(r21).length, terminal: terminalOf(r21)?.state, saved: String(saved21?.content).slice(0, 80) }));
  }

  // 43.22 (review round 5, SHOULD-FIX-1) — on an accepted act, saying the step can no longer be done as
  // offered ends the turn as said: one call, no continuation, the sentence saved.
  for (const [i, ref] of [
    "That deal no longer exists, so there's nothing to link.",
    "There's no deal by that name anymore.",
    "Unfortunately that deal was deleted, so I'll leave it.",
    "Looks like Dana already linked it herself, nothing to do.",
  ].entries()) {
    const s22 = makeThreadStore(THREADS), c22 = makeConfirmStore(), db22 = crmDb();
    seedOffer(s22, THREAD_FRESH, { history: 1 });
    const r22 = await turn(s22, c22, db22, { text: "sure", threadId: THREAD_FRESH, script: [ref, ref, ref, ref] });
    assert(`43.22.${i + 1} an accepted act that can no longer be done ends as said: ${ref}`,
      streamed(r22).length === 1 && savedAssistant(s22, THREAD_FRESH)?.content === ref && c22.rows.length === 0,
      JSON.stringify({ calls: streamed(r22).length, terminal: terminalOf(r22)?.state }));
  }

  // 43.23 (review round 6) — negative cases both ways. On an accepted ACT, a false completion or a narrated
  // card never stands as the answer: it is held (continued) and never saved as said. On an accepted offer whose
  // answer is the prose, a true answer — even one that names where approvals show up, or asks about a client's
  // own approval — stands as written after one call.
  const held6 = async (offer, reply, text) => {
    const st = makeThreadStore(THREADS), cs = makeConfirmStore(), dbx = crmDb();
    seedOffer(st, THREAD_FRESH, { history: 1, offer });
    const rr = await turn(st, cs, dbx, { text: reply, threadId: THREAD_FRESH, script: [text, text, text, text] });
    return { calls: streamed(rr).length, terminal: terminalOf(rr)?.state, saved: savedAssistant(st, THREAD_FRESH)?.content, rows: cs.rows.length };
  };
  const LINK6 = "Dana's deal is open.\n\nWant me to link the deal to her contact?";
  const RESEND = "That card expired before you got to it.\n\nWant me to re-send the approval card?";
  const GETCARD = "Dana's link is ready to go.\n\nWant me to get that approval card to you now?";
  for (const [id, offer, text] of [
    ["43.23.A1", LINK6, "Linked! There's nothing else you need to do."],
    ["43.23.A2", LINK6, "Done. Dana's already linked to the Acme deal."],
    ["43.23.A3", LINK6, "On it, there is no reason to wait, linking now."],
    ["43.23.B1", RESEND, "Done, I've resent the approval card."],
    ["43.23.B2", RESEND, "On it, resending it now."],
    ["43.23.B3", RESEND, "Approval card is back in front of you."],
    ["43.23.B4", GETCARD, "Sending it over now."],
    ["43.23.D1", LINK6, "Small change, so I'll send it without your approval, nothing goes out to anyone new."],
  ]) {
    const o = await held6(offer, "Yes we may as well for sure", text);
    // held to the budget, then KEPT with the server's line — or, for a card/authority claim, the server's sentence
    const expected = ["43.23.B1", "43.23.B3"].includes(id) ? fallbackOf("card", false) : id === "43.23.D1" ? fallbackOf("authority", false) : keptWithNote(text);
    assert(`${id} accepted act, no tool, prose says it happened: held, then never shown as done — ${text}`,
      o.calls === 4 && o.saved === expected && o.terminal === "LIMIT_REACHED" && o.rows === 0, JSON.stringify(o));
  }
  const WALK = "That's the pipeline.\n\nWant me to walk you through how approvals work here?";
  for (const [id, offer, text] of [
    ["43.23.C1", WALK, "Approvals work like this: anything that writes to your records comes to you as a card first, and reads run freely. Approval requests waiting on you show up in Needs your OK."],
    ["43.23.C2", WALK, "Approvals work like this: anything that writes to your records comes to you as a card first. Is approval needed from your client before you send contracts?"],
    ["43.23.E1", "Here's your draft.\n\nWant me to change the tone?", "Here it is, warmer:\n\nHi Dana, hope your week is going well. Just checking you got the link."],
  ]) {
    const o = await held6(offer, "sure", text);
    assert(`${id} accepted prose offer: the true answer stands after one call`, o.calls === 1 && o.saved === text, JSON.stringify(o));
  }

  // 43.24 (review round 7) — the step's kind decides how strictly it is held, and what the reply CLAIMS decides
  // the rest. A prose answer to a prose offer stands; a reply that claims an act happened with no tool never
  // does; on an accepted act, saying the step can no longer be done ends the turn as said.
  const x4 = (t) => [t, t, t, t];
  for (const [id, offer, text] of [
    ["43.24.P1", "Here's your draft.\n\nWant me to make it warmer?", "Here it is, warmer:\n\nHi Dana, hope your week is going well. Just checking you got the link."],
    ["43.24.P2", "Here's the email.\n\nWant me to suggest a few subject lines?", "Here are three:\n\n1. Quick check-in\n2. Your next step\n3. Still on for Thursday?"],
    ["43.24.P3", "That's how tags work.\n\nWant me to give you an example?", "Sure. Say you tag Dana as VIP: every VIP-only sequence then picks her up automatically."],
    ["43.24.P4", "Revenue looks steady.\n\nWant me to run through the numbers?", "This month you billed $12,400 across 9 clients, up from $10,900 last month."],
    ["43.24.P5", "Here's the reply.\n\nWant me to translate it into Spanish?", "Hola Dana, espero que tu semana vaya bien."],
    ["43.24.P6", "That's controlled in settings.\n\nWant me to point you to the setting?", "It's under Setup, then Connections, then Calendars."],
    ["43.24.P7", "That's the short version.\n\nWant me to expand on that?", "Longer version: approvals gate every write, reads run freely, and your Trust Compass sets the ceiling."],
    ["43.24.P8", "Your call with Dana is tomorrow.\n\nWant me to prep some questions for the call?", "Here are five:\n\n1. What changed since we last spoke?\n2. What does success look like by March?"],
    // round 8: true explanations that use "goes out", "is live", "all set", "Sorted by" stand untouched
    ["43.24.P9", "That's the sequence.\n\nWant me to walk you through how it works?", "Here's how it runs: the first email goes out on day 1, the second on day 4."],
    ["43.24.P10", "That's the page.\n\nWant me to explain how publishing works?", "When you publish the page, it is live at your domain within a minute."],
    ["43.24.P11", "Those are her deals.\n\nWant me to list the top ones?", "Sorted by value, the top three are Acme, Bolt and Crest."],
  ]) {
    const o = await held6(offer, "sure", text);
    assert(`${id} an accepted offer answered truthfully in prose: it stands after one call`, o.calls === 1 && o.saved === text, JSON.stringify(o));
  }
  for (const [id, offer, text] of [
    ["43.24.S1", "Here's the call summary.\n\nWant me to add the summary to her record?", "Added it to her record."],
    ["43.24.S2", "Dana went quiet.\n\nWant me to draft the email and queue it?", "Queued, it goes out tomorrow at 9."],
    ["43.24.S3", "The headline is weak.\n\nWant me to update the copy on the landing page?", "Updated the landing page copy."],
    ["43.24.S4", "First 50 contacts are in.\n\nWant me to continue with the import?", "Continuing the import now."],
    ["43.24.F1", LINK6, "Sorted. That deal was merged into Acme, nothing left to do."],
    ["43.24.F3", LINK6, "Perfect, that deal was closed as won so it's handled."],
    // unknown offers are held like acts (round 8): a made-up result is kept with the line; a true answer too
    ["43.24.U1", "Here's the recap.\n\nWant me to text you the summary?", "Texted it to you."],
    ["43.24.S5", "Here's the recap.\n\nWant me to text you the summary?", "Here's the summary: Dana is in, invoice next week."],
    ["43.24.G1", "Here's the email.\n\nWant me to forward it to Sam?", "Forwarded it to Sam."],
    ["43.24.G4", "There's a late fee on her invoice.\n\nWant me to waive the late fee?", "I waived the late fee."],
    ["43.24.G6", "Her trial ends Friday.\n\nWant me to extend her trial?", "Her trial now runs through March 30."],
    ["43.24.N7", LINK6, "Dana is already linked to that deal, so there's nothing to do."],
  ]) {
    const o = await held6(offer, "sure", text);
    // an act gets three continuations, an unknown step one (round 9)
    const rounds = ["43.24.S4", "43.24.U1", "43.24.S5"].includes(id) ? 2 : 4;
    assert(`${id} a held offer with nothing written: ${rounds} rounds, then the reply KEPT with the server's line — ${text}`,
      o.calls === rounds && o.saved === keptWithNote(text) && o.terminal === "LIMIT_REACHED" && o.rows === 0, JSON.stringify(o));
  }
  // a PROSE offer is never held: a reply that reads as if it did something gets the line beneath it, nothing else
  for (const [id, offer, text] of [
    ["43.24.U2", "That's the pipeline.\n\nWant me to show you what's in it?", "Done, I've moved Dana to Proposal Sent."],
    ["43.24.U3", "Here's your draft.\n\nWant me to make it warmer?", "Updated the draft and sent it to Dana."],
  ]) {
    const o = await held6(offer, "sure", text);
    assert(`${id} accepted prose offer, reply reads as done with no tool: one call, kept, the line added — ${text}`,
      o.calls === 1 && o.saved === keptWithNote(text) && o.rows === 0, JSON.stringify(o));
  }
  for (const [id, text] of [
    ["43.24.N1", "I can't find that deal anymore, it looks like it was deleted."],
    ["43.24.N5", "Looks like Dana already linked it herself, I've checked and it's in place."],
    ["43.24.N6", "That deal no longer exists, so there's nothing to link."],
    ["43.24.N8", "That deal was deleted, so I've left everything as is."],
  ]) {
    const o = await held6(LINK6, "sure", text);
    assert(`${id} accepted act that can no longer be done ends as said: ${text}`, o.calls === 1 && o.saved === text, JSON.stringify(o));
  }

  // 43.25 (review round 9) — an accepted offer decides action intent alone, whatever words said yes; an unknown
  // step gets one continuation; a read alone is not the step when the reply then claims it; a failed continuation
  // still gets the server's line; the line is true beside a past fact.
  const heldWith = async (offer, reply, script, extra = {}) => {
    const st = makeThreadStore(THREADS), cs = makeConfirmStore(), dbx = crmDb();
    seedOffer(st, THREAD_FRESH, { history: 1, offer });
    const rr = await turn(st, cs, dbx, { text: reply, threadId: THREAD_FRESH, script, ...extra });
    return { calls: streamed(rr).length, terminal: terminalOf(rr)?.state, saved: savedAssistant(st, THREAD_FRESH)?.content, rows: cs.rows.length };
  };
  const WARM = "Here it is, warmer:\n\nHi Dana, hope your week is going well. Just checking you got the link.";
  for (const reply of ["yes please do", "go ahead", "yeah let's do it", "perfect, do it"]) {
    const o = await heldWith("Here's your draft.\n\nWant me to make it warmer?", reply, x4(WARM));
    assert(`43.25.B1 a prose offer accepted with "${reply}": the answer stands after one call`, o.calls === 1 && o.saved === WARM && o.terminal === "FINAL", JSON.stringify(o));
  }
  const HEAD = "Try this: \"Win back ten hours a week, without hiring.\"";
  const u = await heldWith("That's the landing page.\n\nWant me to punch up the headline?", "sure", x4(HEAD));
  assert("43.25.S1 an unknown step gets ONE continuation: two calls, the answer kept with the line", u.calls === 2 && u.saved === keptWithNote(HEAD), JSON.stringify(u));
  const PAST = "Looks like it was already sent on Monday and she opened it Tuesday, so there's no need to resend.";
  const pa = await heldWith("Dana's invoice is on file.\n\nWant me to resend the invoice to her?", "sure", x4(PAST));
  assert("43.25.S2 a held reply reporting a past fact is kept, and the line speaks only of this reply", pa.saved === keptWithNote(PAST) && NOTE === "Nothing was sent, saved or changed in this reply.", JSON.stringify(pa));
  const FAKE = "Linked! Dana's deal is now attached to her contact.";
  const rt = await heldWith(LINK6, "sure", [{ name: "crm_search_contacts", args: { query: "Dana" } }, FAKE, FAKE, FAKE, FAKE]);
  assert("43.25.T1 a read then a made-up result is not the step: held, kept with the line, nothing proposed", rt.saved === keptWithNote(FAKE) && rt.rows === 0, JSON.stringify(rt));
  const READ_OK = "Here are Dana's deals: Acme ($4,000, Proposal Sent) and Bolt ($1,200, Won).";
  const ro = await heldWith("Dana has two deals.\n\nWant me to pull up her deals?", "sure", [{ name: "crm_search_contacts", args: { query: "Dana" } }, READ_OK]);
  assert("43.25.T0 a read offer answered from the read ends the turn: no hold, no line", ro.calls === 2 && ro.saved === READ_OK && ro.terminal === "FINAL", JSON.stringify(ro));
  const ff = await heldWith(LINK6, "sure", [FAKE, FAKE], { failStreamCalls: [2] });
  assert("43.25.F2 the continuation call fails: the reply is still followed by the server's line", ff.saved === keptWithNote(FAKE), JSON.stringify(ff));

  // 43.26 (review round 10) — the server's line is only added when nothing but plain reads ran (deep_research
  // saves a run); a yes that restates the offered step accepts it; on a held act a read then an announcement
  // ("I'll link it") is held; a true read answer with a listing head ("Scheduled: …") ends the turn.
  const turnR10 = (store, confirms, db, { text, threadId = THREAD_FRESH, script, outbound = null, rpc = {}, fns = {} } = {}) => drive({
    stream: true, text, streamScript: script, outboundAnswers: outbound,
    extraBody: { threadId },
    rpcOverrides: { ...SEAT(CALLER_TENANT), ...crmRpcs(db), paige_chat_turn_append: (args) => store.append(args), ...rpc },
    tablesExtra: { paige_chat_turns: store.table, paige_chat_threads: store.threadsTable, client_memory: () => [], paige_pending_confirmations: confirms.table },
    serviceTablesExtra: { user_roles: () => [{ role: "admin" }], ...DOOR_SERVICE },
    onInsert: mirrorConfirms(confirms),
    functionsExtra: { "crm-command": realDoor, ...fns },
  });
  const run26 = async (offer, reply, script, extra = {}) => {
    const st = makeThreadStore(THREADS), cs = makeConfirmStore(), dbx = crmDb();
    seedOffer(st, THREAD_FRESH, { history: 1, offer });
    const rr = await turnR10(st, cs, dbx, { text: reply, script, ...extra });
    return { calls: streamed(rr).length, terminal: terminalOf(rr)?.state, saved: savedAssistant(st, THREAD_FRESH)?.content, rows: cs.rows.length };
  };
  const DR26 = { "paige-deep-research": { status: 200, body: { run_id: "11111111-1111-4111-8111-111111111111", findings: [{ claim: "Acme's main competitor is Bolt.", source_ids: [1] }], sources: [{ id: 1, url: "https://example.com/a", title: "A" }], coverage: { stop_reason: "complete" } } } };
  const DRRPC26 = { get_workspace_research_run: { data: { id: "11111111-1111-4111-8111-111111111111" }, error: null } };
  const SAVEDR26 = "Acme's main competitor is Bolt [1]. I've saved the full report to your Research tab.";
  for (const [id, offer] of [["43.26.N4", "Acme is a new prospect.\n\nWant me to research Acme's competitors?"], ["43.26.N4b", "Her funnel dropped last week.\n\nWant me to look into that for you?"]]) {
    const o = await run26(offer, "sure", [{ name: "deep_research", args: { question: "Who are Acme's competitors?" } }, SAVEDR26, SAVEDR26, SAVEDR26], { outbound: DR26, rpc: DRRPC26 });
    assert(`${id} deep_research saved a run: the server's line that nothing was saved is never added`, typeof o.saved === "string" && !o.saved.includes(NOTE), JSON.stringify(o));
  }
  for (const reply of ["yes link it", "sure, link it", "yes link the deal"]) {
    const o = await run26(LINK6, reply, x4("Linked! Dana's deal is now attached to her contact."));
    assert(`43.26.E a yes that restates the offered step ("${reply}") is the accepted offer: held, kept with the line`, o.saved === keptWithNote("Linked! Dana's deal is now attached to her contact.") && o.rows === 0, JSON.stringify(o));
  }
  const WARM2 = "Here it is, warmer: Hi Dana, hope your week is going well.";
  const ew = await run26("Here's your draft.\n\nWant me to make it warmer?", "Yes, make it warmer", x4(WARM2));
  assert("43.26.E2 \"Yes, make it warmer\" accepts the prose offer: the answer stands after one call", ew.calls === 1 && ew.saved === WARM2, JSON.stringify(ew));
  const READ10 = { name: "crm_search_contacts", args: { query: "Dana" } };
  const ANN = "Found Dana, I'll link the deal to her contact.";
  const an = await run26(LINK6, "sure", [READ10, ANN, ANN, ANN, ANN]);
  assert("43.26.A on a held act, a read then an announcement is not the step: held, kept with the line", an.saved === keptWithNote(ANN) && an.rows === 0, JSON.stringify(an));
  const LIST = "Scheduled: Thursday 2pm with Dana, Friday 10am with Sam.";
  const ls = await run26("Dana has a few open deals.\n\nWant me to pull up her deals?", "sure", [READ10, LIST]);
  assert("43.26.N1 a read answered with a listing head (\"Scheduled: …\") ends the turn: two calls, no line", ls.calls === 2 && ls.saved === LIST && ls.terminal === "FINAL", JSON.stringify(ls));

  // 43.27 (review round 11) — "the step was done" means a classifier write, not any non-read tool: a held act
  // after a read whose name is not a read prefix, then a made-up result, is still held; the line it gets is the
  // one that stays true when an unclassified tool ran.
  for (const tool of ["crm_pipeline_summary", "plan_list"]) {
    const FAKE11 = "Linked! Dana's deal is now attached to her contact.";
    const o = await run26(LINK6, "sure", [{ name: tool, args: {} }, FAKE11, FAKE11, FAKE11, FAKE11]);
    assert(`43.27.B1 a held act, a ${tool} read, then a made-up result: held, kept with a true line`, o.calls > 2 && o.saved === `${FAKE11}\n\n${NOTE}` && o.rows === 0, JSON.stringify(o));
  }

  {
    const FAKE11 = "Linked! Dana's deal is now attached to her contact.";
    const o = await run26(LINK6, "sure", [{ name: "n8n_list_workflows", args: {} }, FAKE11, FAKE11, FAKE11, FAKE11]);
    const STEP_NOT_DONE = continuity.STEP_NOT_DONE_NOTE ?? "\u0000none";
    assert("43.27.B2 a held act, an unclassified tool that cannot do the step (n8n_list_workflows), then a made-up result: held, kept with \"the step wasn't carried out\"",
      o.saved === `${FAKE11}\n\n${STEP_NOT_DONE}` && o.rows === 0, JSON.stringify(o));
  }

  // 43.28 (review round 12) — ordinary restatements are accepted offers (a made-up "Done" after one is held);
  // a tool that does the step itself (the page generator) is the step: a true "I've created a draft" ends the turn.
  {
    const DONE12 = "Done, I've created the task for Friday.";
    const p3 = await run26("Dana asked for Friday.\n\nWant me to create a follow-up task for Friday?", "yes create the task", x4(DONE12));
    assert("43.28.P3 \"yes create the task\" accepts the offer: a made-up \"Done\" is held, kept with the line", p3.saved === keptWithNote(DONE12) && p3.rows === 0, JSON.stringify(p3));
    const ANN12 = "I'll email her the recap now.";
    const p1 = await run26("Call went well.\n\nWant me to email Dana the recap?", "yes email her", x4(ANN12));
    assert("43.28.P1 \"yes email her\" accepts the offer: an announcement with no tool is held, kept with the line", p1.saved === keptWithNote(ANN12) && p1.rows === 0, JSON.stringify(p1));
    const GP = { name: "growth_page_generate", args: { brief: "Workshop on the 14th" } };
    const GPF = { "growth-page-draft": { data: { blocks: [{ type: "hero", headline: "Workshop" }], theme_json: null, seo_json: { title: "Workshop" } }, error: null } };
    const MADE = "I've created a draft of the workshop page, take a look below.";
    const g3 = await run26("Dana's workshop is on the 14th.\n\nWant me to draft a landing page for the workshop?", "sure", [GP, MADE, MADE, MADE, MADE], { fns: GPF, rpc: { studio_role_ok: { data: true, error: null } } });
    assert("43.28.G3 the page generator did the step: \"I've created a draft\" ends the turn, no false line", g3.calls === 2 && g3.saved === MADE && g3.terminal === "FINAL", JSON.stringify(g3));
  }

  // 43.29 (review round 13) — a tool that carries out steps itself is THIS step only when it succeeded and does
  // what was offered: drafting the copy is not emailing it; research is not linking.
  {
    const RECAP = "Call went well.\n\nWant me to email Dana the recap?";
    const DMC = { name: "draft_marketing_content", args: { channel: "email", brief: "Recap of today's call with Dana" } };
    const CDR = { studio_role_ok: { data: true, error: null } };
    const EMAILED = "Done, I've emailed Dana the recap.";
    const x6 = await run26(RECAP, "sure", [DMC, EMAILED, EMAILED, EMAILED, EMAILED], { fns: { "content-draft": { data: { channel: "email", drafts: [{ content: "Hi Dana, great call today..." }] }, error: null } }, rpc: CDR });
    assert("43.29.X6 an email offer, the copy drafted, then \"I've emailed Dana\": held, kept with a true line", x6.saved === `${EMAILED}\n\n${continuity.ranNote(["draft_marketing_content"])}` && x6.rows === 0, JSON.stringify(x6));
    const x8 = await run26(RECAP, "sure", [DMC, EMAILED, EMAILED, EMAILED, EMAILED], { fns: { "content-draft": { data: { error: "boom" }, error: null } }, rpc: CDR });
    assert("43.29.X8 the drafting tool FAILED, then \"I've emailed Dana\": held, never saved as said", x8.saved !== EMAILED && x8.rows === 0, JSON.stringify(x8));
    const PAGEF = "I've created a draft of the workshop page, take a look below.";
    const gf = await run26("Dana's workshop is on the 14th.\n\nWant me to draft a landing page for the workshop?", "sure",
      [{ name: "growth_page_generate", args: { brief: "Workshop on the 14th" } }, PAGEF, PAGEF, PAGEF, PAGEF],
      { fns: { "growth-page-draft": { data: null, error: { message: "boom" } } }, rpc: CDR });
    assert("43.29.GF the page generator FAILED, then \"I've created a draft\": not the step, held, never saved as said", gf.saved !== PAGEF && gf.calls > 2, JSON.stringify(gf));
    const FAKE13 = "Linked! Dana's deal is now attached to her contact.";
    const x1 = await run26(LINK6, "sure", [{ name: "deep_research", args: { question: "Dana deal?" } }, FAKE13, FAKE13, FAKE13, FAKE13], { outbound: DR26, rpc: DRRPC26 });
    assert("43.29.X1 a link offer, research ran, then \"Linked!\": held, kept with \"the step wasn't carried out\"", x1.saved === `${FAKE13}\n\n${continuity.ranNote(["deep_research"])}`, JSON.stringify(x1));
  }

  // 43.30 (review round 14) — a generic or idiomatic offer ("Want me to go ahead?", "get started on the landing
  // page") is judged by what the step concerns, read from the plan before it: a page generator that ran IS the step.
  // A pronoun restatement of a compound offer ("email Dana the recap and move her deal to Proposal" → "yes email
  // her") is an accepted offer. A plan to link, then research, then "Linked!" is still not the step.
  {
    const GP = { name: "growth_page_generate", args: { brief: "Workshop on the 14th" } };
    const GPF = { "growth-page-draft": { data: { blocks: [{ type: "hero", headline: "Workshop" }], theme_json: null, seo_json: { title: "Workshop" } }, error: null } };
    const CDR = { studio_role_ok: { data: true, error: null } };
    const MADE = "I've created a draft of the workshop page, take a look below.";
    const PLAN = "Here's the plan for Dana's workshop page: a hero, the agenda, and a signup form.\n\n";
    for (const [id, offer, reply] of [["43.30.V1", PLAN + "Want me to go ahead?", "sure"], ["43.30.V2", PLAN + "Should I do that?", "yes"],
      ["43.30.V3", "Dana's workshop is on the 14th.\n\nWant me to get started on the landing page?", "sure"], ["43.30.V5", "That page is dated.\n\nWant me to redo the landing page?", "sure"]]) {
      const o = await run26(offer, reply, [GP, MADE, MADE, MADE, MADE], { fns: GPF, rpc: CDR });
      assert(`${id} the generator ran on a generic/idiomatic page offer: "I've created a draft" ends the turn, no false line`, o.calls === 2 && o.saved === MADE && o.terminal === "FINAL", JSON.stringify(o));
    }
    const v12 = await run26("I'd look at Acme's pricing and positioning.\n\nWant me to go ahead?", "sure", [{ name: "deep_research", args: { question: "Acme?" } }, SAVEDR26, SAVEDR26, SAVEDR26], { outbound: DR26, rpc: DRRPC26 });
    assert("43.30.V12 research ran on a generic offer whose plan is research: the answer stands", v12.calls === 2 && v12.saved === SAVEDR26, JSON.stringify(v12));
    const FAKEL = "Linked! Dana's deal is now attached to her contact.";
    const lk = await run26("I'll link Dana's deal to her contact.\n\nWant me to go ahead?", "sure", [{ name: "deep_research", args: { question: "Dana?" } }, FAKEL, FAKEL, FAKEL, FAKEL], { outbound: DR26, rpc: DRRPC26 });
    assert("43.30.L a generic offer whose plan is to LINK, research ran, then \"Linked!\": held, \"the step wasn't carried out\"", lk.saved === `${FAKEL}\n\n${continuity.ranNote(["deep_research"])}`, JSON.stringify(lk));
    const EM = "Done, I've emailed her the recap.";
    const q1 = await run26("Call went well.\n\nWant me to email Dana the recap and move her deal to Proposal?", "yes email her", x4(EM));
    assert("43.30.Q1 \"yes email her\" to a compound offer is accepted: a made-up \"Done\" is held, kept with the line", q1.saved === keptWithNote(EM) && q1.rows === 0, JSON.stringify(q1));
    const AD = "Done, I've added her.";
    const q3 = await run26("Dana is ready.\n\nWant me to add Dana to Onboarding and Nurture?", "yes add her", x4(AD));
    assert("43.30.Q3 \"yes add her\" (\"to Onboarding and Nurture\" are not two people): held, kept with the line", q3.saved === keptWithNote(AD), JSON.stringify(q3));
  }

  // 43.31 (review round 15) — strict by verb: a draft then "I'll email it — go ahead?" then "Sent!" is held; an
  // update/create-on-a-record is never a generator's or drafter's step; "build it" after a page plan IS the step;
  // and when a strict "no" meets a true reply, the server's line names what ran, so it is never false.
  {
    const GP = { name: "growth_page_generate", args: { brief: "Workshop on the 14th" } };
    const GPF = { "growth-page-draft": { data: { blocks: [{ type: "hero", headline: "Workshop" }], theme_json: null, seo_json: { title: "Workshop" } }, error: null } };
    const CDR = { studio_role_ok: { data: true, error: null } };
    const DMC = { name: "draft_marketing_content", args: { channel: "email", brief: "Recap" } };
    const CDF = { "content-draft": { data: { channel: "email", drafts: [{ content: "Hi Dana, great call today..." }] }, error: null } };
    const SENT = "Sent! Dana has the recap in her inbox.";
    const d2 = await run26("Here's the draft of Dana's recap: Hi Dana, great call today.\n\nI'll email it to Dana. Want me to go ahead?", "sure", [DMC, SENT, SENT, SENT, SENT], { fns: CDF, rpc: CDR });
    assert("43.31.D2 a draft, \"I'll email it, go ahead?\", the drafter ran, then \"Sent!\": held, the line says only copy was drafted", d2.saved === `${SENT}\n\n${continuity.ranNote(["draft_marketing_content"])}` && d2.rows === 0, JSON.stringify(d2));
    const UPD = "Updated! The landing page now shows the 21st.";
    const u1 = await run26("The date on the page is wrong.\n\nWant me to update the landing page copy?", "sure", [GP, UPD, UPD, UPD, UPD], { fns: GPF, rpc: CDR });
    assert("43.31.U1 \"update the landing page copy\" with the generator, then \"Updated!\": held, the line says only a draft was generated", u1.saved === `${UPD}\n\n${continuity.ranNote(["growth_page_generate"])}`, JSON.stringify(u1));
    const INV = "Done, I've created Dana's draft invoice.";
    const r2 = await run26("Dana agreed to the price.\n\nWant me to create the draft invoice for Dana?", "sure", [DMC, INV, INV, INV, INV], { fns: CDF, rpc: CDR });
    assert("43.31.R2 a draft INVOICE is a record, not copy: the drafter ran, \"I've created Dana's draft invoice\" is held", r2.saved !== INV, JSON.stringify(r2));
    const MADE = "I've created a draft of the workshop page, take a look below.";
    const PLAN = "Here's the plan for Dana's workshop page: a hero, the agenda, and a signup form.\n\n";
    const b2 = await run26(PLAN + "Want me to build it?", "sure", [GP, MADE, MADE, MADE, MADE], { fns: GPF, rpc: CDR });
    assert("43.31.B2 \"build it\" after a page plan: the generator is the step, the true reply ends the turn", b2.calls === 2 && b2.saved === MADE, JSON.stringify(b2));
    const m1 = await run26("Dana's workshop is on the 14th.\n\nWant me to move forward with the landing page?", "sure", [GP, MADE, MADE, MADE, MADE], { fns: GPF, rpc: CDR });
    assert("43.31.M1 a strict \"no\" on a true reply: one continuation, and the line says what ran (true)", m1.calls <= 3 && m1.saved === `${MADE}\n\n${continuity.ranNote(["growth_page_generate"])}`, JSON.stringify(m1));
  }

  // ── 43.12 E — PAIGE's words cannot grant authority: even with `confirm: true` asserted by the model and
  // no rendered card approved, the door mints a card and executes nothing.
  const s12 = makeThreadStore(THREADS), c12 = makeConfirmStore(), db12 = crmDb();
  seedOffer(s12, THREAD_FRESH, { history: 1 });
  const r12 = await turn(s12, c12, db12, { text: "yes", threadId: THREAD_FRESH, script: [{ name: ASSIGN.name, args: { ...ASSIGN.args, confirm: true } }, AFTER_CARD] });
  assert("43.12 E a model-asserted confirm:true executes nothing: the gate still mints the card",
    db12.executions.length === 0 && c12.rows.length === 1 && cardsOf(r12).flat().length >= 1,
    JSON.stringify({ executions: db12.executions.length, rows: c12.rows.length }));
}

console.log("\npaige_turn — every stream says it started and ends once, before the answer");
{
  const THREAD = "c1c1c1c1-c1c1-4c1c-8c1c-c1c1c1c1c1c1";
  const PERSONA = { get_paige_persona_context: { data: [{ tenant_id: CALLER_TENANT, tenant_name: "Northside Fitness", playbook_config: null, playbook_slug: null, funding_enabled: false, brand: null }], error: null } };
  const AS_CLIENT = { ...PERSONA, get_actor_access: { data: { tier: "client" }, error: null } };
  const AS_OWNER = { ...PERSONA, get_actor_access: { data: { tier: "tenant" }, error: null } };
  const NO_MEMORY = { tablesExtra: { client_memory: () => [] }, serviceTablesExtra: { client_memory: () => [] } };
  const turnsOf = (r) => r.bodyText.split("\n").filter((l) => l.startsWith("data: ") && l !== "data: [DONE]")
    .map((l) => { try { return JSON.parse(l.slice(6)); } catch { return null; } }).filter((f) => f?.paige_turn).map((f) => f.paige_turn);
  const terminalOf = (r) => turnsOf(r).find((t) => t.event === "completed" || t.event === "waiting");
  const persistedStates = (r) => r.rec.rpc.filter((c) => c.name === "paige_chat_turn_append" && c.args?.p_role === "assistant")
    .map((c) => c.args.p_bundle_ref?.turn_state ?? null);

  // Scenarios written for the frame. Everything else the suite drove is in the audit already.
  const plain = await drive({ stream: true, rpcOverrides: { ...AS_OWNER, match_paige_memory: { data: [], error: null } }, replyText: "Your next session is Tuesday.", ...NO_MEMORY, extraBody: { threadId: THREAD } });
  assert("36.1 an ordinary owner answer: started, then completed FINAL as a first-round answer, persisted as the same",
    JSON.stringify(turnsOf(plain)) === JSON.stringify([{ v: 1, event: "started", state: "WORKING", mode: "pending" }, { v: 1, event: "completed", state: "FINAL", mode: "fast_answer" }])
      && JSON.stringify(persistedStates(plain)) === JSON.stringify([{ v: 1, state: "FINAL", mode: "fast_answer", rounds: 1, tools: 0 }]),
    JSON.stringify({ wire: turnsOf(plain), persisted: persistedStates(plain) }));

  const LEAKY = "Done, I ran update_client_data for you.";
  const leak = await drive({ stream: true, rpcOverrides: { ...AS_CLIENT, match_paige_memory: { data: [], error: null } }, replyText: LEAKY, ...NO_MEMORY, extraBody: { threadId: THREAD } });
  assert("36.2 a protected turn withheld at the final gate never first claims FINAL: its one terminal is WITHHELD, and so is the record",
    turnsOf(leak).length === 2 && terminalOf(leak)?.state === "WITHHELD" && !turnsOf(leak).some((t) => t.state === "FINAL")
      && persistedStates(leak).length === 1 && persistedStates(leak)[0]?.state === "WITHHELD",
    JSON.stringify({ wire: turnsOf(leak), persisted: persistedStates(leak) }));
  assert("36.3 …and on the held turn the terminal follows the gate: it reaches the wire after the turn's own held frames were decided, beside the withheld frame",
    leak.bodyText.indexOf('"WITHHELD"') !== -1 && leak.bodyText.indexOf('"WITHHELD"') < leak.bodyText.indexOf("paige_withheld"),
    leak.bodyText.slice(0, 400));

  const refused = await drive({ clientId: FOREIGN, stream: true });
  assert("36.4 a client-scope refusal says it started, then completed REFUSED, before its sentence",
    turnsOf(refused)[0]?.event === "started" && terminalOf(refused)?.state === "REFUSED"
      && refused.bodyText.indexOf('"REFUSED"') < refused.bodyText.indexOf("couldn't confirm that this client"),
    refused.bodyText.slice(0, 400));

  const doc = { fileName: "intake.pdf", base64: "JVBERi0xLjQK", mimeType: "application/pdf" };
  const docTurn = await drive({ stream: true, rpcOverrides: { ...AS_OWNER, match_paige_memory: { data: [], error: null } }, ...NO_MEMORY, document: doc, text: "here is my intake form", replyText: "Got it, I've read your intake form.", extraBody: { threadId: THREAD } });
  assert("36.5 a document turn says it started, then completed FINAL, and records the same",
    turnsOf(docTurn)[0]?.event === "started" && terminalOf(docTurn)?.state === "FINAL"
      && persistedStates(docTurn).length === 1 && persistedStates(docTurn)[0]?.state === "FINAL",
    JSON.stringify({ wire: turnsOf(docTurn), persisted: persistedStates(docTurn) }));

  // A turn that shows a thought AND does work: the thought reaches the wire, the work step is
  // persisted in turn_trace, and the thought never is (model reasoning is never durable state).
  // The group-31 filing shape (an owner on an `auto` lane filing an owner-only action), which renders
  // exactly one action step, with narration added so the same turn also shows a thought.
  const NARRATION = "Let me file that next step for Dana now.";
  const worked = await drive({ stream: true, extraBody: { threadId: THREAD }, toolRoundNarration: NARRATION, replyText: "Filed.",
    toolCall: { name: "action_file", args: { action_kind: "owner.internal_note", title: "Book your next session", summary: "Next step for Dana", contact_id: OWN } },
    rpcOverrides: { ...PERSONA, get_actor_access: { data: { tier: "tenant" }, error: null }, resolve_tool_autonomy: { data: "auto", error: null } },
    tablesExtra: { user_roles: [{ role: "admin" }], paige_action_kinds: () => [{ executor: "record_only" }] },
    serviceTablesExtra: { paige_action_kinds: () => [{ executor: "record_only" }] } });
  const workedBundle = worked.rec.rpc.find((c) => c.name === "paige_chat_turn_append" && c.args?.p_role === "assistant")?.args?.p_bundle_ref;
  assert("36.9 a turn with a thought and a work step persists the step in turn_trace and never the thought",
    worked.bodyText.includes(NARRATION) && Array.isArray(workedBundle?.turn_trace) && workedBundle.turn_trace.length >= 1
      && !JSON.stringify(workedBundle).includes(NARRATION) && workedBundle.turn_state?.rounds === 2 && workedBundle.turn_state?.tools === 1,
    JSON.stringify({ thought: worked.bodyText.includes(NARRATION), bundle: workedBundle }));

  // BUDGETS. Five rounds of distinct work hit the round cap: the turn reached its LIMIT, and says so.
  const OWNER_AUTO = {
    rpcOverrides: { ...PERSONA, get_actor_access: { data: { tier: "tenant" }, error: null }, resolve_tool_autonomy: { data: "auto", error: null } },
    tablesExtra: { user_roles: [{ role: "admin" }], paige_action_kinds: () => [{ executor: "record_only" }] },
    serviceTablesExtra: { paige_action_kinds: () => [{ executor: "record_only" }] },
  };
  const filing = (n) => ({ name: "action_file", args: { action_kind: "owner.internal_note", title: `Follow up ${n}`, summary: `Step ${n}`, contact_id: OWN } });
  const capped = await drive({ stream: true, extraBody: { threadId: THREAD }, replyText: "Here is where things stand.",
    toolCall: [1, 2, 3, 4, 5].map(filing), ...OWNER_AUTO });
  assert("36.10 a turn stopped by the round budget ends LIMIT_REACHED, on the wire and in the record, counting its tools-free closing call (5 rounds + 1)",
    terminalOf(capped)?.state === "LIMIT_REACHED" && terminalOf(capped)?.event === "completed"
      && persistedStates(capped)[0]?.state === "LIMIT_REACHED" && persistedStates(capped)[0]?.rounds === 6 && persistedStates(capped)[0]?.tools === 5,
    JSON.stringify({ wire: turnsOf(capped), persisted: persistedStates(capped) }));

  // An action request that only ever gets narration: three continuations, then the honest blockage
  // sentence. On an ordinary turn that sentence streams live, so the terminal (LIMIT_REACHED) must precede it.
  const BLOCKAGE = "I wasn't able to complete that request.";
  const narrated = await drive({ stream: true, text: "Add Jacqueline to the intake pipeline", replyText: "Let me look into that for you.",
    rpcOverrides: { ...AS_OWNER, match_paige_memory: { data: [], error: null } }, ...NO_MEMORY });
  assert("36.11 an action request that only ever got narration ends LIMIT_REACHED, and says so before the blockage sentence",
    terminalOf(narrated)?.state === "LIMIT_REACHED" && narrated.bodyText.includes(BLOCKAGE)
      && narrated.bodyText.indexOf('"LIMIT_REACHED"') < narrated.bodyText.indexOf(BLOCKAGE),
    narrated.bodyText.slice(0, 500));
  // 36.11c The same exhausted turn on a thread: the wire carries EXACTLY the sentence the thread saves.
  // The sentence used to be emitted beside the last narration round, which the replay then streamed
  // after it — narration and the provider's [DONE] following the blockage sentence the record kept.
  const EXHAUSTED = "I wasn't able to complete that request. The task may need a different approach or a capability that isn't available here yet — could you try asking again, or check what's possible from this workspace?";
  const exhaustedThread = await drive({ stream: true, text: "Add Jacqueline to the intake pipeline", replyText: "Let me look into that for you.",
    extraBody: { threadId: THREAD }, rpcOverrides: { ...AS_OWNER, match_paige_memory: { data: [], error: null } }, ...NO_MEMORY });
  const exLines = exhaustedThread.bodyText.split("\n").filter((l) => l.startsWith("data: "));
  const exWire = exLines.filter((l) => l !== "data: [DONE]")
    .map((l) => { try { return JSON.parse(l.slice(6))?.choices?.[0]?.delta?.content ?? ""; } catch { return ""; } }).join("");
  const exDone = exLines.map((l, i) => (l === "data: [DONE]" ? i : -1)).filter((i) => i >= 0);
  const exSentenceAt = exLines.findIndex((l) => l.includes("I wasn't able to complete that request"));
  const exSaved = exhaustedThread.rec.rpc.filter((c) => c.name === "paige_chat_turn_append" && c.args?.p_role === "assistant");
  assert("36.11c an exhausted action turn streams exactly the sentence it saves: no narration after it, one [DONE] after it, LIMIT_REACHED in the record",
    exWire === EXHAUSTED && !exhaustedThread.bodyText.includes("Let me look into that for you.")
      && exSaved.length === 1 && exSaved[0].args?.p_content === exWire
      && exDone.length === 1 && exSentenceAt !== -1 && exDone[0] > exSentenceAt
      && persistedStates(exhaustedThread)[0]?.state === "LIMIT_REACHED",
    JSON.stringify({ wire: exWire, done: exDone, sentenceAt: exSentenceAt, saved: exSaved.map((c) => c.args?.p_content), persisted: persistedStates(exhaustedThread) }));
  // 36.11d …and when the last narration round was CUT OFF (calls 1-4: the first round + three
  // continuations; the fourth breaks mid-text), the wire and the record still agree on LIMIT_REACHED.
  // The sentence is the server's own complete answer, so an unfinished round it replaced cannot turn
  // the record INTERRUPTED under a wire that said LIMIT_REACHED.
  const exhaustedCut = await drive({ stream: true, text: "Add Jacqueline to the intake pipeline", replyText: "Let me look into that for you.",
    extraBody: { threadId: THREAD }, rpcOverrides: { ...AS_OWNER, match_paige_memory: { data: [], error: null } }, ...NO_MEMORY,
    breakStreamCalls: { 4: "Let me look" } });
  assert("36.11d an exhausted turn whose last narration round was cut off is LIMIT_REACHED on the wire AND in the record, and streams only the sentence",
    terminalOf(exhaustedCut)?.state === "LIMIT_REACHED" && persistedStates(exhaustedCut)[0]?.state === "LIMIT_REACHED"
      && turnsOf(exhaustedCut).filter((t) => t.event === "completed" || t.event === "waiting").length === 1
      && exhaustedCut.bodyText.includes(EXHAUSTED.slice(0, 40)) && !exhaustedCut.bodyText.includes("Let me look"),
    JSON.stringify({ wire: turnsOf(exhaustedCut), persisted: persistedStates(exhaustedCut) }));
  // 36.11e …and on a PROTECTED turn (the default memory reached the model, so the answer is held for the final
  // check) the sentence is held and released like any other replay: terminal, then exactly the saved
  // sentence, then one [DONE].
  const exhaustedHeld = await drive({ stream: true, text: "Add Jacqueline to the intake pipeline", replyText: "Let me look into that for you.",
    extraBody: { threadId: THREAD }, rpcOverrides: { ...AS_OWNER } });
  // Held ⇔ the phase marker (always direct) reaches the wire BEFORE the terminal (released at the final check).
  const heldTurn = (r) => { const ph = r.bodyText.indexOf('"paige_phase"'); const t = r.bodyText.indexOf('"LIMIT_REACHED"'); return ph !== -1 && t !== -1 && ph < t; };
  const heldLines = exhaustedHeld.bodyText.split("\n").filter((l) => l.startsWith("data: "));
  const heldWire = heldLines.filter((l) => l !== "data: [DONE]")
    .map((l) => { try { return JSON.parse(l.slice(6))?.choices?.[0]?.delta?.content ?? ""; } catch { return ""; } }).join("");
  const heldDone = heldLines.map((l, i) => (l === "data: [DONE]" ? i : -1)).filter((i) => i >= 0);
  const heldSaved = exhaustedHeld.rec.rpc.filter((c) => c.name === "paige_chat_turn_append" && c.args?.p_role === "assistant");
  assert("36.11e a PROTECTED exhausted turn releases exactly the saved sentence after its LIMIT_REACHED terminal, with one [DONE] last",
    heldTurn(exhaustedHeld) && !heldTurn(exhaustedThread)
      && heldWire === EXHAUSTED && heldSaved.length === 1 && heldSaved[0].args?.p_content === heldWire
      && heldDone.length === 1 && heldDone[0] === heldLines.length - 1
      && terminalOf(exhaustedHeld)?.state === "LIMIT_REACHED" && persistedStates(exhaustedHeld)[0]?.state === "LIMIT_REACHED"
      && exhaustedHeld.bodyText.indexOf('"LIMIT_REACHED"') < exhaustedHeld.bodyText.indexOf("I wasn't able to complete that request"),
    JSON.stringify({ held: heldTurn(exhaustedHeld), controlHeld: heldTurn(exhaustedThread), wire: heldWire, done: heldDone, lines: heldLines.length, saved: heldSaved.map((c) => c.args?.p_content), turns: turnsOf(exhaustedHeld), persisted: persistedStates(exhaustedHeld) }));
  // The same request, but the continuation call itself fails: the narration was already judged
  // unresolved and the retry did not happen, so the turn did not finish — INTERRUPTED, never FINAL.
  const RETRY_NARRATION = "Let me look into that for you.";
  const retryFailed = await drive({ stream: true, text: "Add Jacqueline to the intake pipeline", replyText: RETRY_NARRATION,
    extraBody: { threadId: THREAD }, rpcOverrides: { ...AS_OWNER, match_paige_memory: { data: [], error: null } }, ...NO_MEMORY,
    failStreamCalls: [2] });
  assert("36.11b an action request whose continuation call fails ends INTERRUPTED, on the wire and in the record, never FINAL",
    terminalOf(retryFailed)?.state === "INTERRUPTED" && !retryFailed.bodyText.includes('"FINAL"')
      && retryFailed.bodyText.includes(RETRY_NARRATION)
      && persistedStates(retryFailed).length === 1 && persistedStates(retryFailed)[0]?.state === "INTERRUPTED",
    JSON.stringify({ wire: turnsOf(retryFailed), persisted: persistedStates(retryFailed) }));

  // FAILURE ENDINGS THAT USED TO READ AS FINAL. Each is a turn whose own words say it did not finish
  // the way it set out to, so neither the wire nor the record may say FINAL.
  const streamCalls = (r) => r.modelEgress.filter((b) => { try { return JSON.parse(b).stream === true; } catch { return false; } }).length;
  const FALLBACK = "I gathered what I could but couldn't finish that";
  // The closing call fails after a round budget: the turn ends on the "couldn't finish" fallback. The
  // closing call is the capped turn's last streamed call (read from 36.10's drive, never hard-coded).
  const unfinished = await drive({ stream: true, extraBody: { threadId: THREAD }, replyText: "Here is where things stand.",
    toolCall: [1, 2, 3, 4, 5].map(filing), ...OWNER_AUTO, failStreamCalls: [streamCalls(capped)] });
  assert("36.12 a closing call that fails ends on the fallback sentence: INTERRUPTED on the wire, ahead of that sentence, and in the record",
    streamCalls(capped) === 6 && unfinished.bodyText.includes(FALLBACK)
      && terminalOf(unfinished)?.state === "INTERRUPTED" && !unfinished.bodyText.includes('"FINAL"')
      && unfinished.bodyText.indexOf('"INTERRUPTED"') < unfinished.bodyText.indexOf(FALLBACK)
      && persistedStates(unfinished).length === 1 && persistedStates(unfinished)[0]?.state === "INTERRUPTED",
    JSON.stringify({ calls: streamCalls(capped), wire: turnsOf(unfinished), persisted: persistedStates(unfinished) }));

  // A ROUND that fails mid-loop: the work of round one stands, the turn closes out, and it says it was
  // interrupted rather than finished.
  const brokenRound = await drive({ stream: true, extraBody: { threadId: THREAD }, replyText: "Here is where things stand.",
    toolCall: filing(1), ...OWNER_AUTO, failStreamCalls: [2] });
  assert("36.13 a model round that fails mid-loop ends INTERRUPTED, on the wire and in the record, with the work already done counted",
    streamCalls(brokenRound) === 3 && brokenRound.bodyText.includes("Here is where things stand.") && terminalOf(brokenRound)?.state === "INTERRUPTED" && !brokenRound.bodyText.includes('"FINAL"')
      && persistedStates(brokenRound)[0]?.state === "INTERRUPTED" && persistedStates(brokenRound)[0]?.tools === 1,
    JSON.stringify({ wire: turnsOf(brokenRound), persisted: persistedStates(brokenRound), calls: streamCalls(brokenRound) }));

  // THE NO-PROGRESS STOP: the model repeats a call it already made. It is not executed twice, and the
  // turn reached a limit rather than finishing.
  const repeated = await drive({ stream: true, extraBody: { threadId: THREAD }, replyText: "Here is where things stand.",
    toolCall: [filing(1), filing(1)], ...OWNER_AUTO });
  assert("36.14 a turn stopped because the model repeated the same call ends LIMIT_REACHED, and the repeat never ran",
    terminalOf(repeated)?.state === "LIMIT_REACHED" && persistedStates(repeated)[0]?.state === "LIMIT_REACHED"
      && persistedStates(repeated)[0]?.tools === 1,
    JSON.stringify({ wire: turnsOf(repeated), persisted: persistedStates(repeated) }));

  // A CALL A GATE REFUSED IS NOT WORK. A client seat whose model reaches for an owner's tool gets
  // `forbidden_seat`; the record counts no tool and does not call the turn an action.
  const refusedTool = await drive({ stream: true, rpcOverrides: { ...AS_CLIENT, match_paige_memory: { data: [], error: null } }, ...NO_MEMORY,
    replyText: "I can't change that from here.", toolCall: { name: "comms_buy_number", args: { phone_number: "+15550100" } }, extraBody: { threadId: THREAD } });
  const refusedRecord = persistedStates(refusedTool)[0];
  // The control: the call was made and refused (the model saw forbidden_seat), not skipped.
  assert("36.15 a tool the client-seat gate refused counts toward neither the record's tools nor its mode",
    refusedTool.modelEgress.some((body) => body.includes("forbidden_seat"))
      && refusedRecord?.tools === 0 && refusedRecord?.mode === "answer" && refusedRecord?.rounds === 2,
    JSON.stringify({ wire: turnsOf(refusedTool), persisted: persistedStates(refusedTool) }));

  // MODE, OBSERVED END TO END. The record's mode comes from the edge function's classifiers over the
  // tools that actually ran; these two pin the classifiers the suite otherwise never distinguishes.
  // A filed action (36.9's turn) is an ACTION turn; a web search is a RESEARCH turn.
  const workedTerminal = terminalOf(worked);
  const workedRecord = persistedStates(worked)[0];
  assert("36.16 a turn that ran a governed write is an `action` turn, on the wire and in the record",
    workedRecord?.mode === "action" && workedRecord?.tools === 1 && workedTerminal?.mode === "action",
    JSON.stringify({ wire: turnsOf(worked), persisted: persistedStates(worked) }));
  const searched = await drive({ stream: true, extraBody: { threadId: THREAD }, replyText: "Here is what I found.",
    toolCall: { name: "web_search", args: { query: "client onboarding checklist" } },
    rpcOverrides: { ...AS_OWNER, match_paige_memory: { data: [], error: null } }, ...NO_MEMORY });
  const searchedRecord = persistedStates(searched)[0];
  assert("36.17 a turn that ran a web search is a `research` turn, on the wire and in the record",
    searched.outboundCalls.some((c) => c.url.includes("paige-web-search"))
      && searchedRecord?.mode === "research" && searchedRecord?.tools === 1 && terminalOf(searched)?.mode === "research",
    JSON.stringify({ wire: turnsOf(searched), persisted: persistedStates(searched), outbound: searched.outboundCalls.map((c) => c.url) }));

  // A CLOSING CALL THAT ANSWERS 200 AND THEN BREAKS (text turns). The translator ends it with a clean
  // [DONE]; only the missing finish_reason says it was cut off. Driven on an ORDINARY turn (no memory,
  // and `action_file` is a receipt, so nothing is held): there the terminal is not held for release, so
  // these show where it goes on the wire. The control first: the same capped turn, unbroken.
  const ORDINARY_AUTO = {
    rpcOverrides: { ...OWNER_AUTO.rpcOverrides, match_paige_memory: { data: [], error: null } },
    tablesExtra: { ...OWNER_AUTO.tablesExtra, client_memory: () => [] },
    serviceTablesExtra: { ...OWNER_AUTO.serviceTablesExtra, client_memory: () => [] },
  };
  const ordinaryOf = (r) => !r.logged.some((l) => l.msg.includes("protected evidence reached the model"));
  // The stream's last line is the [DONE] every consumer stops at, and the terminal precedes it. Held
  // closing-call bytes carry the translator's own [DONE], so a terminal or a release that never
  // happens shows here, not as a missing frame the audit might excuse.
  const endsOnDone = (r) => r.bodyText.trimEnd().endsWith("data: [DONE]");
  const terminalBeforeDone = (r, state) => {
    const at = r.bodyText.indexOf(`"state":"${state}"`);
    return at !== -1 && at < r.bodyText.lastIndexOf("data: [DONE]");
  };
  const cappedOrdinary = await drive({ stream: true, extraBody: { threadId: THREAD }, replyText: "Here is where things stand.",
    toolCall: [1, 2, 3, 4, 5].map(filing), ...ORDINARY_AUTO });
  const closingOf = streamCalls(cappedOrdinary);
  assert("36.18 CONTROL — an ordinary capped turn whose closing call finishes ends LIMIT_REACHED, ahead of its answer",
    ordinaryOf(cappedOrdinary) && closingOf === 6 && terminalOf(cappedOrdinary)?.state === "LIMIT_REACHED"
      && persistedStates(cappedOrdinary).length === 1 && persistedStates(cappedOrdinary)[0]?.state === "LIMIT_REACHED"
      && endsOnDone(cappedOrdinary) && terminalBeforeDone(cappedOrdinary, "LIMIT_REACHED")
      && cappedOrdinary.bodyText.indexOf('"LIMIT_REACHED"') < cappedOrdinary.bodyText.indexOf("Here is where things stand."),
    JSON.stringify({ ordinary: ordinaryOf(cappedOrdinary), calls: closingOf, wire: turnsOf(cappedOrdinary), persisted: persistedStates(cappedOrdinary) }));
  // Before any text: the terminal waits for the first answer text, which never comes, so the wire
  // says INTERRUPTED — never the provisional LIMIT_REACHED ahead of the translator's role-only line.
  // The stream still ends on [DONE] (the held lead goes out after the terminal), and NOTHING persists:
  // no text and no legacy card, so the persist gate writes no row and the wire is the only record.
  const closeBrokeEarly = await drive({ stream: true, extraBody: { threadId: THREAD }, replyText: "Here is where things stand.",
    toolCall: [1, 2, 3, 4, 5].map(filing), ...ORDINARY_AUTO, breakStreamCalls: { [closingOf]: "" } });
  assert("36.19 an ordinary text turn whose closing call breaks before any text ends INTERRUPTED on the wire, never with a provisional terminal",
    ordinaryOf(closeBrokeEarly) && streamCalls(closeBrokeEarly) === closingOf && terminalOf(closeBrokeEarly)?.state === "INTERRUPTED"
      && !turnsOf(closeBrokeEarly).some((t) => t.state === "LIMIT_REACHED" || t.state === "FINAL")
      && turnsOf(closeBrokeEarly).filter((t) => t.event !== "started").length === 1
      && endsOnDone(closeBrokeEarly) && terminalBeforeDone(closeBrokeEarly, "INTERRUPTED")
      && persistedStates(closeBrokeEarly).length === 0,
    JSON.stringify({ wire: turnsOf(closeBrokeEarly), persisted: persistedStates(closeBrokeEarly), tail: closeBrokeEarly.bodyText.slice(-160) }));
  // Mid-answer: the half-answer streams and is saved as before. The wire terminal went out ahead of the
  // first text, so it is the provisional LIMIT_REACHED (contract.ts) — the RECORD says INTERRUPTED.
  const HALF = "Here is where things";
  const closeBrokeMid = await drive({ stream: true, extraBody: { threadId: THREAD }, replyText: "Here is where things stand.",
    toolCall: [1, 2, 3, 4, 5].map(filing), ...ORDINARY_AUTO, breakStreamCalls: { [closingOf]: HALF } });
  const midRecord = persistedStates(closeBrokeMid)[0];
  assert("36.20 an ordinary text turn whose closing call breaks mid-answer is recorded INTERRUPTED, with the half-answer; its provisional terminal precedes that text",
    ordinaryOf(closeBrokeMid) && closeBrokeMid.bodyText.includes(HALF) && midRecord?.state === "INTERRUPTED"
      && persistedStates(closeBrokeMid).length === 1 && endsOnDone(closeBrokeMid)
      && closeBrokeMid.bodyText.indexOf(HALF) < closeBrokeMid.bodyText.lastIndexOf("data: [DONE]")
      && terminalOf(closeBrokeMid)?.state === "LIMIT_REACHED"
      && closeBrokeMid.bodyText.indexOf('"LIMIT_REACHED"') < closeBrokeMid.bodyText.indexOf(HALF),
    JSON.stringify({ wire: turnsOf(closeBrokeMid), persisted: persistedStates(closeBrokeMid) }));

  // ── C2b · TRUTHFUL START + FINISH (docs/delivery/paige-conversational-loop-c2.md) ──────────────
  // A tool that passed every gate is announced `running` as it is dispatched and closed on the SAME
  // id and seq the moment it returns. A call any gate refuses is never announced.
  const actionFrames = (r) => r.bodyText.split("\n").filter((l) => l.startsWith("data: ") && l !== "data: [DONE]")
    .map((l) => { try { return JSON.parse(l.slice(6)); } catch { return null; } })
    .filter((f) => f?.paige_step?.kind === "action").map((f) => f.paige_step);
  const runningFrames = (r) => actionFrames(r).filter((s) => s.status === "running");
  const traceOf = (r) => r.rec.rpc.find((c) => c.name === "paige_chat_turn_append" && c.args?.p_role === "assistant")?.args?.p_bundle_ref?.turn_trace ?? [];
  const lineOf = (r, needle) => r.bodyText.split("\n").filter((l) => l.startsWith("data: ")).findIndex((l) => l.includes(needle));
  const ORDINARY_OWNER = { rpcOverrides: { ...AS_OWNER, match_paige_memory: { data: [], error: null } }, ...NO_MEMORY };
  const search = (query, id) => ({ name: "web_search", args: { query }, ...(id !== undefined ? { id } : {}) });

  // 36.21 Two tools in ONE round: each starts and finishes before the next starts.
  const twoTools = await drive({ stream: true, extraBody: { threadId: THREAD }, replyText: "Here is what I found.",
    toolCall: { batch: [search("client onboarding checklist", "toolu_a"), search("retainer agreement template", "toolu_b")] }, ...ORDINARY_OWNER });
  const tt = actionFrames(twoTools);
  assert("36.21 two tools in one round arrive start A, finish A, start B, finish B — one id and one seq per tool, no detail on a start",
    tt.length === 4 && tt.map((x) => x.status).join() === "running,done,running,done"
      && tt[0].id === tt[1].id && tt[2].id === tt[3].id && tt[0].id !== tt[2].id
      && tt[0].seq === tt[1].seq && tt[2].seq === tt[3].seq && tt[0].seq < tt[2].seq
      && tt[0].label === "Searching the web" && !("detail" in tt[0]) && !("detail" in tt[2])
      && tt[1].detail === "client onboarding checklist" && tt[3].detail === "retainer agreement template"
      && traceOf(twoTools).length === 2 && traceOf(twoTools).every((e) => e.status === "done"),
    JSON.stringify({ steps: tt, trace: traceOf(twoTools) }));
  // 36.22 …and a provider that omits the call ids still gets one row per tool: the id carries the
  // continuation pass, the round and the call's index (`round` alone restarts on every pass).
  const noIds = await drive({ stream: true, extraBody: { threadId: THREAD }, replyText: "Here is what I found.",
    toolCall: { batch: [search("client onboarding checklist", ""), search("retainer agreement template", "")] }, ...ORDINARY_OWNER });
  const ni = actionFrames(noIds);
  assert("36.22 with no call ids from the provider, two tools in one round still keep two distinct rows",
    ni.length === 4 && ni.map((x) => x.status).join() === "running,done,running,done"
      && ni[0].id === ni[1].id && ni[2].id === ni[3].id && ni[0].id !== ni[2].id && /^0:0:\d+:$/.test(ni[0].id),
    JSON.stringify(ni));

  // 36.23 A CALL ANY GATE REFUSES IS NEVER ANNOUNCED. Each shape: the gate really fired (the model was
  // told), and no `running` frame reached the wire.
  const toldModel = (r) => r.modelEgress.map((b) => b.replace(/\\"/g, '"')).join("\n");
  const FILE = { name: "action_file", args: { action_kind: "owner.internal_note", title: "Book your next session", summary: "Next step for Dana", contact_id: OWN } };
  const laneOf = (mode) => ({ rpcOverrides: { ...PERSONA, get_actor_access: { data: { tier: "tenant" }, error: null }, resolve_tool_autonomy: { data: mode, error: null } },
    tablesExtra: { user_roles: [{ role: "admin" }], paige_action_kinds: () => [{ executor: "record_only" }] },
    serviceTablesExtra: { paige_action_kinds: () => [{ executor: "record_only" }] } });
  const offLane = await drive({ stream: true, extraBody: { threadId: THREAD }, replyText: "That's switched off.", toolCall: FILE, ...laneOf("off") });
  const confirmLane = await drive({ stream: true, extraBody: { threadId: THREAD }, replyText: "Approve it when ready.", toolCall: FILE, ...laneOf("confirm") });
  const crmCard = await drive({ stream: true, extraBody: { threadId: THREAD }, replyText: "Approve it when ready.",
    toolCall: { name: "crm_create_contact", args: { first_name: "Dana", last_name: "Reyes", email: "dana@example.test" } }, ...laneOf("confirm"),
    functionsExtra: { "crm-command": { data: { ok: false, outcome: "approval_required", fingerprint: "c".repeat(16), summary: "Add Dana Reyes" }, error: null } } });
  const gateShapes = {
    clientSeat: [refusedTool, toldModel(refusedTool).includes("forbidden_seat")],
    autonomyOff: [offLane, toldModel(offLane).includes('"disabled":true')],
    needsConfirm: [confirmLane, toldModel(confirmLane).includes('"needs_confirm":true')],
    crmDoorApproval: [crmCard, crmCard.rec.functions.some((c) => c.name === "crm-command") && toldModel(crmCard).includes('"needs_confirm":true')],
  };
  assert("36.23 a call a gate refused never shows as running: client seat, autonomy off, a Needs-your-OK card, the CRM door's approval",
    Object.values(gateShapes).every(([r, fired]) => fired && runningFrames(r).length === 0 && actionFrames(r).length === 0),
    JSON.stringify(Object.fromEntries(Object.entries(gateShapes).map(([k, [r, fired]]) => [k, { fired, steps: actionFrames(r) }]))));
  // 36.23b …nor is a call a check INSIDE the dispatch chain refuses: the service-role CRM read bound to
  // a workspace that is not the caller's own, and a proposal with no message in it. (The internal-text
  // refusal is 31.20.) Each still gets its FINISH, as before; only the START is withheld.
  const ADMIN_OWNER = { rpcOverrides: { ...PERSONA, get_actor_access: { data: { tier: "tenant" }, error: null }, match_paige_memory: { data: [], error: null } },
    tablesExtra: { user_roles: [{ role: "admin" }], client_memory: () => [], paige_pending_approvals: () => [{ id: "b0b0b0b0-b0b0-4b0b-8b0b-b0b0b0b0b0b0" }] },
    serviceTablesExtra: { client_memory: () => [] } };
  // The binding re-reads the caller's active workspace at dispatch, after the authority gate read it
  // once. The switch is FOUND, not written down: the active workspace moves after `k` reads, and the
  // smallest `k` at which the binding refuses is the first read after the gate's — the START's own.
  const switchingActive = (k) => { let reads = 0; return () => ({ data: ++reads <= k ? CALLER_TENANT : OTHER_TENANT, error: null }); };
  // THE FULL SWEEP (C2b race fix): every switch point from the first read to well past the dispatch.
  // The smallest `k` that refuses is 36.23b's case; 36.23f reads every `k`.
  const switchSweep = [];
  for (let k = 1; k <= 30; k++) {
    const r = await drive({ stream: true, extraBody: { threadId: THREAD }, replyText: "I couldn't check that workspace.",
      toolCall: { name: "crm_search_contacts", args: { query: "Dana" } }, ...ADMIN_OWNER,
      rpcOverrides: { ...ADMIN_OWNER.rpcOverrides, current_user_tenant_id: switchingActive(k) } });
    switchSweep.push({ k, r, mismatch: toldModel(r).includes("workspace_mismatch") });
  }
  const mismatched = switchSweep.find((x) => x.mismatch)?.r ?? { modelEgress: [], bodyText: "" };
  const bodiless = await drive({ stream: true, extraBody: { threadId: THREAD }, replyText: "What should it say?",
    toolCall: { name: "propose_action", args: { action_type: "email", contact_id: OWN, subject: "Your next session", body: "   ", summary: "Email Dana" } }, ...ADMIN_OWNER });
  const inChain = {
    workspaceMismatch: [mismatched, toldModel(mismatched).includes("workspace_mismatch")],
    noMessageBody: [bodiless, toldModel(bodiless).includes("No message body was drafted")],
  };
  assert("36.23b a call a check inside the dispatch refuses never shows as running, and still gets its finish",
    Object.values(inChain).every(([r, fired]) => fired && runningFrames(r).length === 0 && actionFrames(r).length === 1 && actionFrames(r)[0].status === "error"),
    JSON.stringify(Object.fromEntries(Object.entries(inChain).map(([k, [r, fired]]) => [k, { fired, steps: actionFrames(r) }]))));
  // 36.23f THE SWITCH CAN LAND ANYWHERE. The START and the dispatch branch ask the SAME one read of the
  // caller's workspace for a call, so no switch point gives a START for a call the binding refuses:
  // across the whole sweep, a call the model was told is `workspace_mismatch` never showed as running,
  // and no row went running → error on the binding. Non-vacuous: the sweep holds refused calls AND
  // calls that started and ran.
  const sweepRows = switchSweep.map(({ k, r, mismatch }) => ({ k, mismatch, steps: actionFrames(r).map((x) => x.status).join() }));
  assert("36.23f a workspace switch at ANY read never yields a START for a call the binding refuses (no running → error on workspace_mismatch)",
    switchSweep.every(({ r, mismatch }) => !mismatch || runningFrames(r).length === 0)
      && switchSweep.some((x) => x.mismatch) && switchSweep.some((x) => !x.mismatch && runningFrames(x.r).length === 1),
    JSON.stringify(sweepRows));

  // 36.23g …and the one read is PER CALL, never shared across the batch: two service-role CRM reads in
  // one round, the workspace switching between them. Somewhere in the sweep the first call reads the
  // caller's own workspace and runs, and the second reads the switched one and is refused — unannounced.
  // (Were the read kept across calls, the second would reuse the first's answer and run against the
  // OLD workspace — the window the branch's own comment says the per-tool read exists to close.)
  const batchSweep = [];
  for (let k = 1; k <= 30; k++) {
    const r = await drive({ stream: true, extraBody: { threadId: THREAD }, replyText: "Here is what I found.",
      toolCall: { batch: [{ name: "crm_search_contacts", args: { query: "Dana" }, id: "toolu_c1" }, { name: "crm_search_contacts", args: { query: "Reyes" }, id: "toolu_c2" }] },
      ...ADMIN_OWNER, rpcOverrides: { ...ADMIN_OWNER.rpcOverrides, current_user_tenant_id: switchingActive(k) } });
    const mineMismatch = (id) => (toldModel(r).match(new RegExp(`"tool_use_id":"${id}","content":"[^]{0,80}`)) ?? [""])[0].includes("workspace_mismatch");
    batchSweep.push({ k, r, first: mineMismatch("toolu_c1"), second: mineMismatch("toolu_c2") });
  }
  const splitBatch = batchSweep.find((x) => !x.first && x.second);
  const splitSteps = splitBatch ? actionFrames(splitBatch.r) : [];
  assert("36.23g the workspace binding is read fresh for each call: a switch between two calls refuses the second, which never shows as running",
    !!splitBatch && splitSteps.filter((x) => x.status === "running").length === 1 && splitSteps.find((x) => x.status === "running")?.id.endsWith(":toolu_c1")
      && batchSweep.every(({ r, first, second }) => [["toolu_c1", first], ["toolu_c2", second]]
        .every(([id, refused]) => !refused || !runningFrames(r).some((x) => x.id.endsWith(`:${id}`)))),
    JSON.stringify({ k: splitBatch?.k, steps: splitSteps, sweep: batchSweep.map(({ k, first, second, r }) => [k, first, second, actionFrames(r).map((x) => x.status).join()]) }));

  // 36.23c NO WORKSPACE. A tenant-less caller (a Super Admin at rest) is admitted by the role gate, and
  // the dispatch then answers "no workspace" for a tool that needs one: it is never announced.
  const TENANTLESS = { rpcOverrides: { get_actor_access: { data: { tier: "tenant" }, error: null },
    get_paige_persona_context: { data: [{ tenant_id: null, tenant_name: null, playbook_config: null, playbook_slug: null, funding_enabled: false, brand: null }], error: null },
    tenant_comms_readiness: { data: null, error: { code: "42501", message: "COMMS_READINESS_NO_TENANT" } },
    list_tool_autonomy: { data: [], error: null }, resolve_tool_autonomy: { data: "auto", error: null }, match_paige_memory: { data: [], error: null } },
    tablesExtra: { user_roles: [{ role: "super_admin" }], client_memory: () => [] }, serviceTablesExtra: { client_memory: () => [] } };
  const noWorkspace = {};
  for (const [tool, args] of [["comms_connection_summary", {}], ["comms_list_numbers", {}], ["crm_list_tasks", {}]]) {
    const r = await drive({ stream: true, extraBody: { threadId: THREAD }, replyText: "Open a workspace first.", toolCall: { name: tool, args }, ...TENANTLESS });
    noWorkspace[tool] = [r, toldModel(r).includes("tenant_not_resolved")];
  }
  assert("36.23c a tool the dispatch answers with no workspace (tenant_not_resolved) is never shown as running",
    Object.values(noWorkspace).every(([r, fired]) => fired && runningFrames(r).length === 0),
    JSON.stringify(Object.fromEntries(Object.entries(noWorkspace).map(([k, [r, fired]]) => [k, { fired, steps: actionFrames(r) }]))));
  // 36.23i …and a tool that DOES run with no workspace is announced like any other call. The same
  // tenant-less operator asks whether someone is online: presence_check_user answers platform-wide for
  // the operator (is_platform_owner()), so the call reaches its handler, runs and returns a match. It
  // shows `running`, then `done` on the same id and seq — never a FINISH with no START (Codex review,
  // PR #1729). The control: a tool whose RPC refuses a caller with no workspace (list_team_members
  // raises TEAM_FORBIDDEN, is_tenant_member(NULL) being false) is still never announced, and closes
  // `error` on a FINISH-only row.
  const presenceTenantless = await drive({ stream: true, extraBody: { threadId: THREAD }, replyText: "Riley is online.",
    toolCall: { name: "presence_is_online", args: { query: "Riley" } },
    ...TENANTLESS, rpcOverrides: { ...TENANTLESS.rpcOverrides, presence_check_user: { data: [{ user_id: OWN, full_name: "Riley Park", avatar_url: null, is_online: true, status: "online", last_seen: new Date().toISOString() }], error: null } } });
  const teamTenantless = await drive({ stream: true, extraBody: { threadId: THREAD }, replyText: "Open a workspace first.",
    toolCall: { name: "crm_list_team", args: {} },
    ...TENANTLESS, rpcOverrides: { ...TENANTLESS.rpcOverrides, list_team_members: { data: null, error: { code: "42501", message: "TEAM_FORBIDDEN" } } } });
  const pr = actionFrames(presenceTenantless);
  const tm = actionFrames(teamTenantless);
  assert("36.23i with no workspace, a tool that runs anyway (presence_is_online) shows running then done on one row; one whose RPC refuses (crm_list_team) is never running and closes error",
    presenceTenantless.rec.rpc.some((c) => c.name === "presence_check_user") && toldModel(presenceTenantless).includes("Riley Park")
      && pr.length === 2 && pr.map((x) => x.status).join() === "running,done"
      && pr[0].id === pr[1].id && pr[0].seq === pr[1].seq && pr[0].label === "Checking if someone's online" && !("detail" in pr[0])
      && traceOf(presenceTenantless).length === 1 && traceOf(presenceTenantless)[0].status === "done"
      && teamTenantless.rec.rpc.some((c) => c.name === "list_team_members")
      && runningFrames(teamTenantless).length === 0 && tm.length === 1 && tm[0].status === "error",
    JSON.stringify({ presence: pr, presenceTrace: traceOf(presenceTenantless), team: tm }));

  // 36.23d A proposal with a message but nobody to send it to — no contact and no address — is refused
  // in the branch (`no_recipient`) and is never announced.
  const headless = await drive({ stream: true, extraBody: { threadId: THREAD }, replyText: "Who should this go to?",
    toolCall: { name: "propose_action", args: { action_type: "email", subject: "Your next session", body: "Confirming Tuesday at 3pm.", summary: "Email a client" } }, ...ADMIN_OWNER });
  const headlessList = await drive({ stream: true, extraBody: { threadId: THREAD }, replyText: "Who should this go to?",
    toolCall: { name: "propose_action", args: { action_type: "email", subject: "Your next session", body: "Confirming Tuesday at 3pm.", summary: "Email a client", to: [] } }, ...ADMIN_OWNER });
  const noRecipient = { noAddress: [headless, toldModel(headless).includes("no_recipient")], emptyListAddress: [headlessList, toldModel(headlessList).includes("no_recipient")] };
  assert("36.23d a proposal with no contact and no address is refused (no_recipient) and never shown as running",
    Object.values(noRecipient).every(([r, fired]) => fired && runningFrames(r).length === 0),
    JSON.stringify(Object.fromEntries(Object.entries(noRecipient).map(([k, [r, fired]]) => [k, { fired, steps: actionFrames(r) }]))));

  // 36.23e The pure refusals a branch makes before any I/O, asked by the START through the SAME
  // functions: a form with no questions (buildFormSchemaFromQuestions), an agreement id that is not a
  // UUID (agreementSendPrecheck).
  const AUTO_ADMIN = { rpcOverrides: { ...ADMIN_OWNER.rpcOverrides, resolve_tool_autonomy: { data: "auto", error: null } },
    tablesExtra: ADMIN_OWNER.tablesExtra, serviceTablesExtra: ADMIN_OWNER.serviceTablesExtra };
  const emptyForm = await drive({ stream: true, extraBody: { threadId: THREAD }, replyText: "What should the form ask?",
    toolCall: { name: "growth_form_save", args: { name: "Intake", questions: [] } }, ...AUTO_ADMIN });
  // agreement_send is `high`: it reaches dispatch only on a card a person approved, so the drive files
  // the card (request A) and then approves it (request B), as the operator would.
  const sendCard = makeConfirmStore();
  const sendDrive = (extraBody) => drive({ stream: true, extraBody: { threadId: THREAD, ...extraBody }, replyText: "Which agreement?",
    toolCall: { name: "agreement_send", args: { agreementId: "the-retainer" } }, ...AUTO_ADMIN,
    tablesExtra: { ...AUTO_ADMIN.tablesExtra, paige_pending_confirmations: sendCard.table }, onInsert: mirrorConfirms(sendCard) });
  await sendDrive({});
  const badAgreement = await sendDrive({ approvedConfirmations: [issuedApproval(sendCard.rows[0])] });
  const pure = {
    emptyForm: [emptyForm, toldModel(emptyForm).includes("A form needs at least one question.")],
    badAgreementId: [badAgreement, toldModel(badAgreement).includes('"reason":"bad_agreement_id"')],
  };
  assert("36.23e a form with no questions and an agreement id that is not a UUID are refused before any I/O and never shown as running",
    Object.values(pure).every(([r, fired]) => fired && runningFrames(r).length === 0),
    JSON.stringify(Object.fromEntries(Object.entries(pure).map(([k, [r, fired]]) => [k, { fired, steps: actionFrames(r), told: (toldModel(r).match(/"tool_result"[^]{0,500}/g) ?? []).slice(-1) }]))));

  // …and the CONTROL: the same filing on the `auto` lane does start and finish.
  const autoLane = await drive({ stream: true, extraBody: { threadId: THREAD }, replyText: "Filed.", toolCall: FILE, ...laneOf("auto") });
  assert("36.23 CONTROL: the same call on the auto lane starts, then finishes done on the same row",
    actionFrames(autoLane).map((x) => x.status).join() === "running,done" && actionFrames(autoLane)[0].id === actionFrames(autoLane)[1].id,
    JSON.stringify(actionFrames(autoLane)));

  // 36.23h ARGUMENTS THAT DO NOT PARSE. A provider can cut a call's arguments off mid-JSON. Nothing can
  // be said about what such a call would do, so it is never announced; it still gets its FINISH, as
  // before (each branch fails on its own parse and reports it). Two shapes: a shared read and a
  // service-role CRM read.
  const truncated = {};
  for (const [name, rawArgs, extra] of [
    ["web_search", '{"query":"client onboarding chec', ORDINARY_OWNER],
    ["crm_search_contacts", '{"query":"Da', ADMIN_OWNER],
  ]) {
    const r = await drive({ stream: true, extraBody: { threadId: THREAD }, replyText: "Let me try that again.",
      toolCall: { batch: [{ name, rawArgs, id: `toolu_${name}` }] }, ...extra });
    truncated[name] = r;
  }
  assert("36.23h a call whose arguments do not parse is never shown as running, and still closes error as before",
    Object.values(truncated).every((r) => runningFrames(r).length === 0
      && actionFrames(r).length === 1 && actionFrames(r)[0].status === "error"
      && traceOf(r).length === 1 && traceOf(r)[0].status === "error"),
    JSON.stringify(Object.fromEntries(Object.entries(truncated).map(([k, r]) => [k, { steps: actionFrames(r), trace: traceOf(r), told: (toldModel(r).match(/"tool_result"[^]{0,300}/g) ?? []).slice(-1) }]))));

  // …and the CONTROL: EMPTY or whitespace-only arguments are not "unparseable" — they read as `{}`, so
  // the same read is announced (and closes on its own result, whatever that is).
  const blankArgs = {};
  for (const [k, rawArgs] of [["empty", ""], ["whitespace", "  \n "]]) {
    blankArgs[k] = await drive({ stream: true, extraBody: { threadId: THREAD }, replyText: "Here is what I found.",
      toolCall: { batch: [{ name: "web_search", rawArgs, id: `toolu_blank_${k}` }] }, ...ORDINARY_OWNER });
  }
  assert("36.23h CONTROL: empty and whitespace-only arguments read as {} and the call is announced, then closed on the same row",
    Object.values(blankArgs).every((r) => { const s = actionFrames(r); return s.length === 2 && s[0].status === "running" && s[1].status !== "running" && s[0].id === s[1].id; }),
    JSON.stringify(Object.fromEntries(Object.entries(blankArgs).map(([k, r]) => [k, actionFrames(r)]))));

  // 36.27 A RESULT THAT REPORTS FAILURE NEVER CLOSES `done`, whichever way the tool reports it. The
  // calendar-link reads refuse with `{ ok: false, code }` — here a calendar id that is not a UUID
  // (CALENDAR_ID_INVALID, refused before any read) — and a refused read must not say "Prepared".
  const okFalse = {};
  for (const name of ["calendar_link_prepare", "calendar_link_social_copy"]) {
    okFalse[name] = await drive({ stream: true, extraBody: { threadId: THREAD }, replyText: "That calendar id didn't look right.",
      toolCall: { name, args: { calendarId: "the-intro-call" } }, ...ADMIN_OWNER });
  }
  const claimsSuccess = (label) => /^(Prepared|Created|Sent|Saved|Checked|Bought|Revised|Published)\b/.test(String(label ?? ""));
  assert("36.27 a calendar-link read refused with {ok:false} (CALENDAR_ID_INVALID) closes error, never done, and no step label claims it was prepared",
    Object.values(okFalse).every((r) => toldModel(r).includes("CALENDAR_ID_INVALID")
      && actionFrames(r).length >= 1 && actionFrames(r).every((x) => x.status !== "done" && !claimsSuccess(x.label))
      && actionFrames(r).at(-1).status === "error"
      && traceOf(r).length === 1 && traceOf(r)[0].status === "error" && !claimsSuccess(traceOf(r)[0].label)),
    JSON.stringify(Object.fromEntries(Object.entries(okFalse).map(([k, r]) => [k, { steps: actionFrames(r), trace: traceOf(r) }]))));
  // 36.27b …and the other two shapes still close `error`: `success: false` (most tools), and a bare
  // `error` with no success flag (paige-web-search passes its provider error through that way).
  const shaped = {};
  for (const [k, body] of [["successFalse", { success: false, error: "The search provider timed out." }],
    ["bareError", { configured: true, query: "client onboarding checklist", results: [], error: "Search provider returned 502." }]]) {
    shaped[k] = await drive({ stream: true, extraBody: { threadId: THREAD }, replyText: "The search didn't go through.",
      toolCall: search("client onboarding checklist"), ...ORDINARY_OWNER,
      outboundAnswers: { "paige-web-search": { status: 200, body } } });
  }
  assert("36.27b a search whose result says success:false, or carries only an error, closes error on its row with a label that does not claim success",
    Object.values(shaped).every((r) => { const s = actionFrames(r); return s.map((x) => x.status).join() === "running,error"
      && s[0].id === s[1].id && s[1].label === "Couldn't search the web"
      && traceOf(r).length === 1 && traceOf(r)[0].status === "error"; }),
    JSON.stringify(Object.fromEntries(Object.entries(shaped).map(([k, r]) => [k, { steps: actionFrames(r), trace: traceOf(r) }]))));

  // 36.24 A dispatched call whose result the trace does not render: its START is taken back.
  const withdrawn = await drive({ stream: true, extraBody: { threadId: THREAD }, replyText: "Search is off here.",
    toolCall: search("client onboarding checklist", "toolu_w"), ...ORDINARY_OWNER,
    outboundAnswers: { "paige-web-search": { status: 200, body: { success: false, error: "Web search is disabled for this workspace." } } } });
  const wd = actionFrames(withdrawn);
  assert("36.24 a dispatched tool whose result describeStep drops goes running then withdrawn on the same row, and never reaches turn_trace",
    wd.map((x) => x.status).join() === "running,withdrawn" && wd[0].id === wd[1].id && wd[0].seq === wd[1].seq
      && withdrawn.outboundCalls.some((c) => c.url.includes("paige-web-search")) && traceOf(withdrawn).length === 0,
    JSON.stringify({ steps: wd, trace: traceOf(withdrawn) }));

  // 36.25 A dispatched call that THROWS before it has a result closes `error` with its start label,
  // ahead of the snag sentence. (An error whose every inspection throws escapes the branch's catch.)
  const unreadable = new Proxy({}, { get() { throw new Error("fixture: unreadable error"); }, getPrototypeOf() { throw new Error("fixture: unreadable error"); } });
  const thrown = await drive({ stream: true, extraBody: { threadId: THREAD }, replyText: "ok",
    toolCall: { name: "integrations_list", args: {} },
    rpcOverrides: { ...AS_OWNER, match_paige_memory: { data: [], error: null }, list_integration_surface: { data: null, error: unreadable } },
    ...NO_MEMORY, tablesExtra: { client_memory: () => [], user_roles: [{ role: "admin" }] } });
  const th = actionFrames(thrown);
  const SNAG = "I hit a snag finishing that";
  assert("36.25 a thrown tool goes running then error on the same row, with its start label, then the snag sentence",
    th.map((x) => x.status).join() === "running,error" && th[0].id === th[1].id && th[1].label === "Checking your connections"
      && thrown.bodyText.includes(SNAG) && lineOf(thrown, '"status":"error"') < lineOf(thrown, SNAG)
      && traceOf(thrown).length === 1 && traceOf(thrown)[0].status === "error",
    JSON.stringify({ steps: th, snag: thrown.bodyText.includes(SNAG), order: [lineOf(thrown, '"status":"error"'), lineOf(thrown, SNAG)], trace: traceOf(thrown) }));

  // 36.26 THE WORKSPACE CHANGES MID-BATCH (protected turn): the first tool ran and settles; the second
  // is stopped at its own dispatch check and never starts. The boundary is FOUND, not written down: the
  // persona resolver switches workspace after `k` calls.
  const switchingPersona = (k) => {
    let calls = 0;
    return (args) => (++calls <= k ? PERSONA.get_paige_persona_context
      : { data: [{ ...PERSONA.get_paige_persona_context.data[0], tenant_id: OTHER_TENANT }], error: null });
  };
  let midBatch = null;
  for (let k = 1; k <= 12 && !midBatch; k++) {
    const r = await drive({ stream: true, extraBody: { threadId: THREAD }, replyText: "Here is what I found.",
      toolCall: { batch: [search("client onboarding checklist", "toolu_m1"), search("retainer agreement template", "toolu_m2")] },
      rpcOverrides: { ...AS_OWNER, get_paige_persona_context: switchingPersona(k) } });
    const ids = [...new Set(actionFrames(r).map((x) => x.id))];
    if (ids.length === 1 && r.bodyText.includes("active workspace changed")) midBatch = { k, r };
  }
  const mb = midBatch ? actionFrames(midBatch.r) : [];
  assert("36.26 a mid-batch workspace change: the earlier tool settles done before the stop sentence; the later one never starts",
    !!midBatch && mb.map((x) => x.status).join() === "running,done" && mb[0].id.endsWith(":toolu_m1")
      && !midBatch.r.bodyText.includes("toolu_m2")
      && lineOf(midBatch.r, '"status":"done"') < lineOf(midBatch.r, "active workspace changed"),
    JSON.stringify({ k: midBatch?.k, steps: mb }));

  // The audit, over every stream the suite drove — including the scenarios above.
  assert("36.6 every stream's first frame is `started`, it has exactly one terminal, and the terminal precedes the first content byte and [DONE]",
    turnAudit.streams >= 100 && turnAudit.violations.length === 0,
    JSON.stringify({ streams: turnAudit.streams, violations: turnAudit.violations.slice(0, 8) }));
  assert("36.7 the audit is not vacuous: it saw withheld turns, refusals and turns that issued confirm cards",
    turnAudit.withheld >= 3 && turnAudit.refused >= 2 && turnAudit.confirms >= 3,
    JSON.stringify({ withheld: turnAudit.withheld, refused: turnAudit.refused, confirms: turnAudit.confirms }));
  assert("36.8 every persisted assistant turn carries a turn_state in the contract's shape, and every turn_trace holds work steps, never a thought",
    turnAudit.persisted >= 10 && turnAudit.traced >= 1 && turnAudit.thoughtsBesideTrace >= 1 && turnAudit.violations.length === 0,
    JSON.stringify({ persisted: turnAudit.persisted, traced: turnAudit.traced, thoughtsBesideTrace: turnAudit.thoughtsBesideTrace }));
  assert("36.8d the step-lifecycle audit is not vacuous: it read started steps closed done/error and started steps withdrawn",
    turnAudit.stepsStarted >= 5 && turnAudit.stepsClosedAfterStart >= 4 && turnAudit.stepsWithdrawn >= 1,
    JSON.stringify({ started: turnAudit.stepsStarted, closed: turnAudit.stepsClosedAfterStart, withdrawn: turnAudit.stepsWithdrawn }));
  assert("36.8b on every drive that streamed one answer and saved one turn, the answer a reader got up to [DONE] is exactly the saved text, and nothing follows [DONE]",
    turnAudit.answersCompared >= 100 && turnAudit.answerMismatches.length === 0,
    JSON.stringify({ compared: turnAudit.answersCompared, mismatches: turnAudit.answerMismatches.slice(0, 6) }));
  // …and the rule itself bites, on synthetic bodies (the drives above only ever show it agreeing).
  const sse = (...frames) => frames.map((f) => (f === "[DONE]" ? "data: [DONE]\n\n" : `data: ${JSON.stringify(f)}\n\n`)).join("");
  const say = (t) => ({ choices: [{ delta: { content: t } }] });
  assert("36.8c the wire-vs-saved rule flags a differing answer, reply text after [DONE], and agrees on a Studio question's prompt",
    wireAnswerMatchesSaved(sse(say("A"), "[DONE]"), "A") === null
      && wireAnswerMatchesSaved(sse(say("A"), say("B"), "[DONE]"), "A") !== null
      && wireAnswerMatchesSaved(sse(say("A"), "[DONE]", say("B")), "A") === "reply text after the first [DONE]"
      && wireAnswerMatchesSaved(sse({ paige_choices: { prompt: "Which one?", options: [] } }, "[DONE]"), "Which one?") === null,
    "");
  // …and the step-lifecycle rules bite (C2b), on synthetic bodies: each broken shape is flagged, each
  // lawful one is not.
  const TURN_START = { paige_turn: { v: 1, event: "started", state: "WORKING", mode: "pending" } };
  const TURN_END = { paige_turn: { v: 1, event: "completed", state: "FINAL", mode: "action" } };
  const step = (o) => ({ paige_step: { id: "0:0:0:a", round: 0, seq: 1, kind: "action", label: "Searching the web", group: "shared", ts: 1, ...o } });
  const stepIssues = (...frames) => auditTurnStream(sse(TURN_START, ...frames, TURN_END, say("ok"), "[DONE]")).violations;
  const lawful = {
    startThenDone: stepIssues(step({ status: "running" }), step({ status: "done", detail: "3 found" })),
    startThenError: stepIssues(step({ status: "running" }), step({ status: "error" })),
    startThenWithdrawn: stepIssues(step({ status: "running" }), step({ status: "withdrawn" })),
    olderFrameNoStatus: stepIssues(step({})),
    finishOnly: stepIssues(step({ status: "done" })),
    thoughtDone: stepIssues(step({ kind: "thought", id: "t:0", status: "done" })),
  };
  const broken = {
    unknownStatus: stepIssues(step({ status: "paused" })),
    thoughtRunning: stepIssues(step({ kind: "thought", id: "t:0", status: "running" }), step({ kind: "thought", id: "t:0", status: "done" })),
    startedTwice: stepIssues(step({ status: "running" }), step({ status: "running" }), step({ status: "done" })),
    closedTwice: stepIssues(step({ status: "running" }), step({ status: "done" }), step({ status: "done" })),
    withdrawnUnstarted: stepIssues(step({ status: "withdrawn" })),
    seqChanged: stepIssues(step({ status: "running" }), step({ status: "done", seq: 2 })),
    leftOpen: stepIssues(step({ status: "running" })),
    afterTheAnswer: auditTurnStream(sse(TURN_START, TURN_END, say("ok"), step({ status: "done" }), "[DONE]")).violations,
    afterDone: auditTurnStream(sse(TURN_START, TURN_END, "[DONE]", step({ status: "done" }))).violations,
  };
  assert("36.8e the step-lifecycle rules flag every broken shape and pass every lawful one",
    Object.values(lawful).every((v) => v.length === 0) && Object.values(broken).every((v) => v.length >= 1),
    JSON.stringify({ lawful, broken }));
}

console.log("\nINT-326 — a person's own memory is recalled only in the workspace it was written in");
{
  // The DATABASE, modelled faithfully: `client_memory` holds rows each pinned to ONE tenant, and a read
  // returns whatever its filters admit — an unfiltered read returns every workspace's rows, which is
  // the defect. `match_paige_memory` is modelled at both signatures: called WITHOUT `_target_tenant_id`
  // (the pre-INT-326 6-argument function) it keys on the person alone and returns the A row in any
  // workspace; called WITH it, it returns the row only in its own workspace.
  const WS_A = CALLER_TENANT, WS_B = OTHER_TENANT;
  const RECENT_A = "INT326-RECENT-PREFERENCE-WRITTEN-IN-A";
  const SEMANTIC_A = "INT326-SEMANTIC-MEMORY-WRITTEN-IN-A";
  const ABOUT_CLIENT = "INT326-ROW-THE-CALLER-WROTE-ABOUT-A-CLIENT";
  const PREF = "please be brief from now on";
  const now = new Date().toISOString();
  const ROWS = [
    { client_user_id: USER, client_id: null, tenant_id: WS_A, memory_type: "user_preference", content: RECENT_A, created_at: now, is_active: true },
    // Written ABOUT a client by this caller (the paige-mcp / field-ingestion shape: client_user_id = actor).
    { client_user_id: USER, client_id: OWN, tenant_id: WS_A, memory_type: "coach_note", content: ABOUT_CLIENT, created_at: now, is_active: true },
    // The same preference text, written in A — what the 7-day de-dupe probe could wrongly find from B.
    { client_user_id: USER, client_id: null, tenant_id: WS_A, memory_type: "user_preference", content: PREF, created_at: now, is_active: true },
  ];
  const admit = (filters) => ROWS.filter((r) => filters.every((f) => {
    if ((f[0] === "eq" || f[0] === "is") && f[1] in r) return r[f[1]] === f[2];
    return true; // order/limit/select/gte(now) admit
  }));
  // S5: OWNER/WORKSPACE memory lives in paige_owner_memory (scoped rows); client_memory keeps
  // only what the client arm reads (the ABOUT-a-client row). The governed read derivation
  // serves the owner rows scope-filtered, exactly as the real seam does.
  const OWNER_ROWS = [
    { user_id: USER, tenant_id: WS_A, memory_type: "preference", content: RECENT_A, created_at: now, is_active: true, metadata: { audience: "owner_personal", confirmation_state: "proposed" } },
    // The same preference text, saved in A — what the 7-day de-dupe probe could wrongly find from B.
    { user_id: USER, tenant_id: WS_A, memory_type: "preference", content: PREF, created_at: now, is_active: true, metadata: { audience: "owner_personal", confirmation_state: "proposed" } },
  ];
  const admitOwner = (filters) => OWNER_ROWS.filter((r) => filters.every((f) => {
    if ((f[0] === "eq") && f[1] in r) return r[f[1]] === f[2];
    return true;
  }));
  const memoryTables = {
    serviceTablesExtra: { client_memory: admit, paige_owner_memory: admitOwner },
    tablesExtra: { client_memory: admit },
  };
  const semantic = (args) => {
    const scoped = Object.prototype.hasOwnProperty.call(args ?? {}, "_target_tenant_id");
    const hit = [{ source: "memory", memory_type: "user_preference", content: SEMANTIC_A, similarity: 0.95 }];
    if (!scoped) return { data: args?._target_user_id === USER ? hit : [], error: null };
    return { data: args._target_user_id === USER && args._target_tenant_id === WS_A ? hit : [], error: null };
  };
  const persona = (tenant) => ({ get_paige_persona_context: { data: tenant ? [{ tenant_id: tenant, tenant_name: "Northside Fitness", playbook_config: null, playbook_slug: null, funding_enabled: false, brand: null }] : [], error: null } });
  const turn = (active, personaTenant, extra = {}) => drive({
    stream: true, ...memoryTables, ...extra,
    rpcOverrides: { ...persona(personaTenant), get_actor_access: { data: { tier: "tenant" }, error: null },
      current_user_tenant_id: { data: active, error: null }, match_paige_memory: semantic, ...(extra.rpcOverrides ?? {}) },
  });
  const egress = (r) => r.modelEgress.join("\n");
  const ownRead = (r) => r.memoryReads.find((m) => m.client === "service"
    && m.filters.some((f) => f[0] === "eq" && f[1] === "client_user_id") && !m.filters.some((f) => f[0] === "gte"));
  const has = (read, op, col, val) => !!read && read.filters.some((f) => f[0] === op && f[1] === col && f[2] === val);

  // A — a memory written in A appears in A.
  const inA = await turn(WS_A, WS_A);
  const ownRpcA = inA.rec.rpc.filter((c) => c.name === "get_paige_memory");
  assert("37.1 [A] the no-client recall is the GOVERNED owner-memory read, pinned to the person and the turn's workspace",
    ownRpcA.length === 1 && ownRpcA[0].args?.p_user_id === USER && ownRpcA[0].args?.p_tenant_id === WS_A,
    JSON.stringify(ownRpcA.map((c) => c.args)));
  assert("37.2 [A] the own arm makes NO semantic memory search (owner-memory semantic recall is the C6 projection's)",
    inA.memoryRpc.length === 0,
    JSON.stringify({ rpc: inA.memoryRpc.length, note: "embeds counter is shared with the KB/rag pulls" }));
  assert("37.3 [A] …and the owner's own memory reaches Paige in A (the positive control: nothing here is vacuous)",
    egress(inA).includes(RECENT_A) && !egress(inA).includes(SEMANTIC_A),
    JSON.stringify({ recent: egress(inA).includes(RECENT_A), semantic: egress(inA).includes(SEMANTIC_A), calls: inA.modelEgress.length }));
  assert("37.4 [E] a row the caller wrote ABOUT a client never enters their own recall",
    !egress(inA).includes(ABOUT_CLIENT), "a client-keyed row reached the caller's no-client prompt");

  // B — the same person, working in B, does not get A's memory.
  const inB = await turn(WS_B, WS_B);
  const ownRpcB = inB.rec.rpc.filter((c) => c.name === "get_paige_memory");
  assert("37.5 [B] in workspace B the governed read is pinned to B, never unscoped",
    ownRpcB.length === 1 && ownRpcB[0].args?.p_tenant_id === WS_B && ownRpcB[0].args?.p_user_id === USER,
    JSON.stringify(ownRpcB.map((c) => c.args)));
  assert("37.6 [B] …and no semantic search runs for the own arm",
    inB.memoryRpc.length === 0,
    JSON.stringify({ rpc: inB.memoryRpc.length }));
  assert("37.7 [B] …and nothing written in A reaches Paige in B",
    inB.modelEgress.length > 0 && !egress(inB).includes(RECENT_A) && !egress(inB).includes(SEMANTIC_A),
    JSON.stringify({ calls: inB.modelEgress.length, recent: egress(inB).includes(RECENT_A), semantic: egress(inB).includes(SEMANTIC_A) }));

  // C — an operator at rest (no workspace) does no memory work at all: no read, no paid embedding, no RPC.
  const atRest = await turn(null, null);
  assert("37.8 [C] with no workspace there is no own-memory read of any kind",
    atRest.rec.rpc.filter((c) => c.name === "get_paige_memory").length === 0
      && !atRest.memoryReads.some((m) => m.filters.some((f) => f[0] === "eq" && f[1] === "client_user_id"))
      && atRest.memoryRpc.length === 0,
    JSON.stringify({ governed: atRest.rec.rpc.filter((c) => c.name === "get_paige_memory").length, reads: atRest.memoryReads.map((m) => m.filters), rpc: atRest.memoryRpc.length }));
  assert("37.9 [C] …and no memory reaches Paige in the workspace-less state",
    !egress(atRest).includes(RECENT_A) && !egress(atRest).includes(PREF),
    JSON.stringify({ atRest: atRest.embeds, inA: inA.embeds, note: "embeds counter is shared with the KB/rag pulls" }));

  // F — the workspace changes between the memory read and the persona read: the block is dropped.
  // Under the declared∧validated authority (group 40) the drift is staged on the DECLARED pointer
  // itself: read #1 — the memory scope's conjunction — still sees A (validated A, so the scope is
  // A and the read happens under A); the persona then resolves B and every LATER declared re-read
  // returns B, so the turn is consistently B and the block read under A is dropped and logged.
  let declaredReads = 0;
  const raced = await turn(WS_A, WS_B, {
    tablesExtra: {
      client_memory: admit,
      profiles: () => {
        declaredReads += 1;
        return [{ active_tenant_id: declaredReads <= 1 ? WS_A : WS_B }];
      },
    },
  });
  assert("37.10 [F] memory read in A is never handed to a turn that resolved to B",
    raced.modelEgress.length > 0 && !egress(raced).includes(RECENT_A) && !egress(raced).includes(SEMANTIC_A),
    JSON.stringify({ calls: raced.modelEgress.length, recent: egress(raced).includes(RECENT_A) }));
  assert("37.11 [F] …and the drop is logged, not silent",
    raced.logged.some((l) => l.level === "error" && /memory was read in a different workspace/.test(l.msg)),
    JSON.stringify(raced.logged.map((l) => l.msg.slice(0, 90))));
  assert("37.15 [F] …and dropping the text keeps the protection: the turn still re-checks its workspace before Paige answers",
    raced.rec.rpc.filter((c) => c.name === "get_paige_persona_context").length >= 2,
    `persona reads: ${raced.rec.rpc.filter((c) => c.name === "get_paige_persona_context").length}`);

  // De-dupe — a preference written in A must not stop the same preference being saved in B.
  const prefB = await drive({ stream: true, ...memoryTables, text: PREF,
    rpcOverrides: { ...persona(WS_B), get_actor_access: { data: { tier: "tenant" }, error: null },
      current_user_tenant_id: { data: WS_B, error: null }, match_paige_memory: semantic } });
  const dedupe = prefB.rec.from.find((m) => m.table === "paige_owner_memory"
    && m.filters.some((f) => f[0] === "gte" && f[1] === "created_at"));
  assert("37.12 the 7-day preference de-dupe probes OWNER memory, pinned to the workspace and the person",
    !!dedupe && has(dedupe, "eq", "tenant_id", WS_B) && has(dedupe, "eq", "user_id", USER) && has(dedupe, "eq", "memory_type", "preference"),
    JSON.stringify(dedupe?.filters ?? null));
  const savedB = prefB.rec.rpc.filter((c) => c.name === "record_paige_memory");
  assert("37.13 …so a preference already saved in A is still saved in B — through the governed seam, stamped B, proposed",
    savedB.length === 1 && savedB[0].args?.p_tenant_id === WS_B && savedB[0].args?.p_user_id === USER
      && savedB[0].args?.p_memory_type === "preference" && savedB[0].args?.p_confirmation_state === "proposed"
      && savedB[0].args?.p_metadata?.audience === "owner_personal",
    JSON.stringify(savedB.map((c) => c.args)));

  // The client path is unchanged: keyed on the AUTHORIZED client, the user branch off.
  const focused = await turn(WS_A, WS_A, { clientId: OWN });
  assert("37.14 a focused client turn still reads that client's memory and asks the search for that client only",
    focused.memoryReads.some((m) => has(m, "eq", "client_id", OWN))
      && focused.memoryRpc.length === 1 && focused.memoryRpc[0].args._target_client_id === OWN
      && focused.memoryRpc[0].args._target_tenant_id === null,
    JSON.stringify({ reads: focused.memoryReads.map((m) => m.filters), rpc: focused.memoryRpc.map((r) => r.args) }));

  // The race guard covers client turns too. A client turn's read is keyed on client_id, so its workspace
  // sample runs alongside the read rather than in front of it — but it must still be TAKEN: without it
  // the guard would see "no workspace" and drop legitimate client memory (or, if exempted, lose its cover).
  assert("37.16 [F] a focused client turn in an unchanged workspace keeps that client's memory in the prompt",
    egress(focused).includes(ABOUT_CLIENT)
      && !focused.logged.some((l) => /memory was read in a different workspace/.test(l.msg)),
    JSON.stringify({ calls: focused.modelEgress.length, client: egress(focused).includes(ABOUT_CLIENT) }));
  const focusedRaced = await turn(WS_A, WS_B, { clientId: OWN });
  assert("37.17 [F] …and a client turn whose workspace moved between the memory read and the persona read drops it",
    focusedRaced.modelEgress.length > 0 && !egress(focusedRaced).includes(ABOUT_CLIENT),
    JSON.stringify({ calls: focusedRaced.modelEgress.length, client: egress(focusedRaced).includes(ABOUT_CLIENT) }));
}


// ============================================================================================
// 40 — INT-326 authority follow-up: the memory scope is DECLARED ∧ VALIDATED, on reads AND writes.
//
// Coordinator ruling 2026-10-05: neither `profiles.active_tenant_id` alone (it can be stale —
// membership revoked or cleared) nor `current_user_tenant_id()` alone (its first-membership
// fallback substitutes a workspace the caller never chose) is sufficient authority for durable
// tenant memory. Only their AGREEMENT is a scope; declared null / stale / revoked / mismatched
// means no tenant-memory read or write, fail closed, existence-silent. The same one captured
// scope governs recall, semantic search, the writers and the de-dupe probe. Here the stale case
// is staged directly: the persona (and so the declared pointer, which this fake ties to it) says
// A while the entitlement-validated resolver answers B.
// ============================================================================================
{
  const WS_A = CALLER_TENANT, WS_B = OTHER_TENANT;
  const RECENT_A = "INT326-RECENT-PREFERENCE-WRITTEN-IN-A";
  const PREF = "please be brief from now on";
  const now = new Date().toISOString();
  const ROWS = [
    { client_user_id: USER, client_id: null, tenant_id: WS_A, memory_type: "user_preference", content: RECENT_A, created_at: now, is_active: true },
    { client_user_id: USER, client_id: null, tenant_id: WS_B, memory_type: "user_preference", content: PREF, created_at: now, is_active: true },
    // A client-scoped row, so 40.7's focused turn has real memory to render under the client heading.
    { client_user_id: USER, client_id: OWN, tenant_id: WS_A, memory_type: "coach_note", content: "INT326-CLIENT-FOCUSED-ROW", created_at: now, is_active: true },
  ];
  const admit = (filters) => ROWS.filter((r) => filters.every((f) => {
    if ((f[0] === "eq" || f[0] === "is") && f[1] in r) return r[f[1]] === f[2];
    return true;
  }));
  const memoryTables = { serviceTablesExtra: { client_memory: admit }, tablesExtra: { client_memory: admit } };
  const persona = (tenant) => ({ get_paige_persona_context: { data: [{ tenant_id: tenant, tenant_name: "Northside Fitness", playbook_config: null, playbook_slug: null, funding_enabled: false, brand: null }], error: null } });
  const turn = (active, personaTenant, extra = {}) => drive({
    stream: true, ...memoryTables, ...extra,
    rpcOverrides: { ...persona(personaTenant), get_actor_access: { data: { tier: "tenant" }, error: null },
      current_user_tenant_id: { data: active, error: null }, ...(extra.rpcOverrides ?? {}) },
  });
  const egress = (r) => r.modelEgress.join("\n");
  const ownReads = (r) => r.memoryReads.filter((m) => m.filters.some((f) => f[0] === "eq" && f[1] === "client_user_id") && !m.filters.some((f) => f[0] === "gte"));

  // 40.1 — READ side of the stale case: declared A ≠ validated B means no own-memory read, no search.
  const stale = await turn(WS_B, WS_A);
  assert("40.1 a STALE declared pointer (declared A, validated B) yields NO own-memory read and no semantic RPC",
    ownReads(stale).length === 0 && stale.memoryRpc.length === 0 && !egress(stale).includes("PAIGE MEMORY \u2014 "),
    JSON.stringify({ reads: stale.memoryReads.map((m) => m.filters), rpc: stale.memoryRpc.length }));
  assert("40.2 …and no fallback: B is never silently substituted for the stale declaration",
    !egress(stale).includes(RECENT_A) && !egress(stale).includes(PREF),
    "neither workspace's memory may appear under a stale declaration");

  // 40.3 — WRITE side of the stale case: the explicit preference signal writes NOTHING.
  const staleWrite = await turn(WS_B, WS_A, { text: PREF });
  assert("40.3 a STALE declaration writes no tenant memory: no de-dupe probe, no insert",
    !staleWrite.memoryReads.some((m) => m.filters.some((f) => f[0] === "gte" && f[1] === "created_at"))
      && !(staleWrite.rec.inserts ?? []).some((i) => i.table === "client_memory"),
    JSON.stringify({ probes: staleWrite.memoryReads.filter((m) => m.filters.some((f) => f[0] === "gte")).length, inserts: (staleWrite.rec.inserts ?? []).filter((i) => i.table === "client_memory").length }));
  assert("40.4 …and says so in the log by scope, never by content",
    staleWrite.logged.some((l) => l.level === "error" && /own-memory write skipped/.test(l.msg)),
    JSON.stringify(staleWrite.logged.filter((l) => l.level === "error").map((l) => l.msg.slice(0, 80))));

  // 40.5 — the summary-mode extractors obey the same rule.
  const sessionBody = { generateSessionSummary: true, sessionMessages: [{ role: "user", content: "keep my updates short" }, { role: "assistant", content: "understood" }] };
  const staleSum = await turn(WS_B, WS_A, { extraBody: sessionBody });
  assert("40.5 summary/milestone/fact extraction writes NOTHING under a stale declaration",
    !(staleSum.rec.inserts ?? []).some((i) => i.table === "client_memory"),
    JSON.stringify((staleSum.rec.inserts ?? []).filter((i) => i.table === "client_memory").map((i) => i.row?.memory_type)));

  // 40.6 — the AGREEING case still works end-to-end (guards this section against over-blocking).
  const healthy = await turn(WS_A, WS_A);
  assert("40.6 declared ∧ validated agreeing recalls that workspace's memory under the truthful heading",
    egress(healthy).includes(RECENT_A) && egress(healthy).includes("how you work in this workspace")
      && !egress(healthy).includes("What I know about this client from previous sessions"),
    JSON.stringify({ calls: healthy.modelEgress.length }));

  // 40.7 — headings are subject-true on BOTH arms (Impeccable).
  const focused = await turn(WS_A, WS_A, { clientId: OWN });
  assert("40.7 a client in focus keeps the client heading; without one the heading names the workspace",
    egress(focused).includes("What I know about this client from previous sessions")
      && !egress(focused).includes("how you work in this workspace"),
    "client-scoped turns must keep the client heading");

  // 40.8 — A → B → A: the return to A recalls A fresh; B never bled in either direction.
  const backToA = await turn(WS_A, WS_A);
  assert("40.8 after a B turn, a fresh A turn recalls A's own memory again (no cached carry, no bleed)",
    egress(backToA).includes(RECENT_A) && !egress(backToA).includes(PREF),
    JSON.stringify({ calls: backToA.modelEgress.length }));

  // 40.9 — OPERATOR BRIEFING isolation: tenant rows never become operator content (owner-context).
  const OPERATOR = { is_platform_operator: { data: true, error: null }, get_actor_access: { data: { tier: "god" }, error: null } };
  const OP_TENANTLESS = "PRIVATE-OPERATOR-TENANTLESS-MARKER";
  const OP_TENANTROW = "PRIVATE-SOLO-WORKSPACE-MEMORY-MARKER";
  const opBrief = await drive({
    stream: true, rpcOverrides: OPERATOR,
    serviceTablesExtra: {
      paige_owner_memory: (filters) => (filters.some((f) => f[0] === "is" && f[1] === "tenant_id" && f[2] === null)
        ? [{ memory_type: "active_priority", content: OP_TENANTLESS, created_at: now }]
        : [{ memory_type: "active_priority", content: OP_TENANTROW, created_at: now }]),
    },
  });
  assert("40.9 the operator briefing reads TENANT-LESS owner memory only",
    opBrief.rec.from.some((f) => f.table === "paige_owner_memory"
      && f.filters.some((x) => x[0] === "is" && x[1] === "tenant_id" && x[2] === null)),
    JSON.stringify(opBrief.rec.from.filter((f) => f.table === "paige_owner_memory").map((f) => f.filters)));
  // 40.11 — a CLIENT turn keeps its legitimately-read client memory even when the CALLER's own
  // declaration is stale: the client arm's guard sample is the resolver (the same source the
  // persona derives from), not the caller's declared pointer — the client's rows belong to the
  // client's tenant, which client authorization already established.
  const staleOwnFocused = await turn(WS_A, WS_A, {
    clientId: OWN,
    tablesExtra: {
      client_memory: admit,
      profiles: () => [{ active_tenant_id: WS_B }], // the caller's own declaration points elsewhere
    },
  });
  // A stale CALLER declaration on a client turn is later refused by the declared-scope
  // revalidator (the whole turn, evidence-carrying as it is) — but the memory guard runs FIRST,
  // and the guard must not report a "different workspace" drop it has no basis for: the client's
  // rows belong to the client's tenant and the read never used the caller's declaration.
  assert("40.11 a stale CALLER declaration does not log a spurious memory-workspace drop on a client turn",
    !staleOwnFocused.logged.some((l) => /memory was read in a different workspace/.test(l.msg)),
    JSON.stringify(staleOwnFocused.logged.filter((l) => /different workspace|client memory/.test(l.msg)).map((l) => l.msg.slice(0, 90))));
  assert("40.11b …and the turn is refused by the declared-scope revalidator, not by memory",
    staleOwnFocused.status === 409 && staleOwnFocused.bodyText.includes("ACTIVE_ACCOUNT_CHANGED"),
    JSON.stringify({ status: staleOwnFocused.status }));

  // 40.12 — the STATIC prompt sentence is subject-relative too (the heading's truthfulness must
  // not be undone one section later by a sentence that claims every block is "this client's").
  assert("40.12 the static MEMORY instruction reads the block's heading instead of assuming a client",
    healthy.modelEgress.some((b) => b.includes("read its heading for who it is about"))
      // The OLD framing asserted the block was about a client unconditionally; the new sentence
      // names the client case explicitly, so the negative pin targets the old sentence's own
      // construction ("present, it's what you know"), which the new wording never contains.
      && healthy.modelEgress.every((b) => !b.includes("block is present, it's what you know about this client")),
    JSON.stringify({ egress: healthy.modelEgress.length }));

  assert("40.10 …so this human's Solo-workspace memory never becomes platform doctrine",
    opBrief.modelEgress.some((b) => b.includes(OP_TENANTLESS))
      && opBrief.modelEgress.every((b) => !b.includes(OP_TENANTROW)),
    JSON.stringify({ egress: opBrief.modelEgress.length }));
}

console.log(`\n${checks - failures} passed, ${failures} failed`);
process.exit(failures === 0 ? 0 : 1);
