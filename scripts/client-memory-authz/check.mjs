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
const { auditTurnStream } = await import("../lib/audit-turn-frames.mjs");
const turnAudit = { streams: 0, violations: [], withheld: 0, confirms: 0, refused: 0, persisted: 0, traced: 0, thoughtsBesideTrace: 0 };
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
  for (const call of rec.rpc.filter((c) => c.name === "paige_chat_turn_append" && c.args?.p_role === "assistant")) {
    const b = call.args.p_bundle_ref;
    const bad = (why) => turnAudit.violations.push(`${label} (persisted): ${why}`);
    if (!String(call.args.p_content ?? "").trim() && !b) continue; // the persist gate: nothing to record
    const state = b?.turn_state;
    if (!state) { bad(`an assistant turn persisted with no turn_state: ${JSON.stringify(b)?.slice(0, 120)}`); continue; }
    turnAudit.persisted += 1;
    const extra = Object.keys(state).filter((k) => !["v", "state", "mode", "rounds", "tools", "waiting_on"].includes(k));
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
/**
 * An Anthropic-native tool_use stream. `gatewayCompat` converts it to OpenAI-compat deltas, so
 * the handler's agentic loop sees a real tool call. Without this the whole tool loop — where
 * Paige acts on the focused client — was unreachable by any check.
 */
const sseToolCallReply = (name, args, text = "", id = "toolu_test") =>
  new Response(
    [
      `event: message_start\ndata: ${JSON.stringify({ type: "message_start", message: { usage: { input_tokens: 1, output_tokens: 1 } } })}\n\n`,
      ...(text ? [
        `event: content_block_start\ndata: ${JSON.stringify({ type: "content_block_start", index: 0, content_block: { type: "text", text: "" } })}\n\n`,
        `event: content_block_delta\ndata: ${JSON.stringify({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text } })}\n\n`,
        `event: content_block_stop\ndata: ${JSON.stringify({ type: "content_block_stop", index: 0 })}\n\n`,
      ] : []),
      `event: content_block_start\ndata: ${JSON.stringify({ type: "content_block_start", index: text ? 1 : 0, content_block: { type: "tool_use", id, name } })}\n\n`,
      `event: content_block_delta\ndata: ${JSON.stringify({ type: "content_block_delta", index: text ? 1 : 0, delta: { type: "input_json_delta", partial_json: JSON.stringify(args) } })}\n\n`,
      `event: message_delta\ndata: ${JSON.stringify({ type: "message_delta", delta: { stop_reason: "tool_use" } })}\n\n`,
      `event: message_stop\ndata: ${JSON.stringify({ type: "message_stop" })}\n\n`,
    ].join(""),
    { status: 200, headers: { "Content-Type": "text/event-stream" } },
  );

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
      : { status: 200, body: { success: true } };
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
        if (failing.failStreamCalls?.includes(failing.streamCalls)) {
          return new Response(JSON.stringify({ type: "error", error: { type: "overloaded_error", message: "fixture overloaded" } }),
            { status: 529, headers: { "Content-Type": "application/json" } });
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
      if (turn ? turn.toolCallOnce : toolCallOnce) {
        // A scripted turn may call several tools, one per round, in order (`toolCall` as a list).
        const spec = turn?.next ?? toolCallSpec;
        const id = turn?.round ? `toolu_test_${turn.round}` : "toolu_test";
        if (turn?.queue?.length) { turn.next = turn.queue.shift(); turn.round += 1; }
        else if (turn) turn.toolCallOnce = false;
        else toolCallOnce = false;
        return sseToolCallReply(spec.name, spec.args, toolRoundText, id);
      }
      return sseModelReply(scriptedReply);
    }
    // Answer the document READ-CHECK with the JSON it expects, so `isCreditReportPdf` can be
    // true and the credit-report upload branch is reachable at all. Match on the outbound body:
    // `gatewayCompat` reshapes the request to Anthropic-native before it reaches fetch, so the
    // caller's `response_format` is gone by here and cannot be used to identify the call. The
    // reply must be Anthropic-shaped too — the gateway converts it back to `choices[0].message`.
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
      client_memory: (filters) => (filters.some((f) => f[0] === "gte" && f[1] === "created_at") ? [] : [{ memory_type: "user_preference", content: MEMORY_TEXT, created_at: new Date().toISOString() }]),
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
    },
  });

  const responses = await Promise.all(Array.from({ length: concurrentRequests }, () => modelTurnState.run({ toolCallOnce: toolCalls.length > 0, queue: toolCalls.slice(1), round: 0, streamCalls: 0, failStreamCalls, breakStreamCalls }, async () => {
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
  const noClient = await drive({ clientId: undefined });
  assert("1.1 with NO clientId, memory is read scoped to the caller's own user id",
    noClient.memoryReads.some((r) => r.filters.some((f) => f[0] === "eq" && f[1] === "client_user_id" && f[2] === USER)),
    JSON.stringify(noClient.memoryReads.map((r) => r.filters)));
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
  assert("9.3b …while the NO-CLIENT path still writes the caller's own summary (9.3 is not over-broad)",
    (await drive({ clientId: undefined, stream: true, extraBody: sessionBody }))
      .rec.inserts.some((i) => i.table === "client_memory" && (i.row?.client_user_id ?? null) === USER),
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
  return {
    rows,
    table: (filters) => {
      const update = filters.find(([op]) => op === "update")?.[1];
      const columns = filters.find(([op]) => op === "select")?.[1];
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
  const lookupQ = approved.rec.from.find(
    (f) => f.table === "paige_pending_confirmations" && f.op === "select"
      && f.filters.some((x) => x[0] === "in" && x[1] === "fingerprint"));
  const lf = (op, col) => lookupQ?.filters.some((x) => x[0] === op && x[1] === col);
  assert("13.6b the scope lookup re-checks user, tenant, expiry, thread and focused client",
    !!lookupQ && lf("eq", "user_id") && lf("gt", "expires_at")
      && (lf("eq", "tenant_id") || lf("is", "tenant_id"))
      && (lf("eq", "thread_id") || lf("is", "thread_id"))
      && (lf("eq", "scoped_client_id") || lf("is", "scoped_client_id")),
    JSON.stringify(lookupQ?.filters ?? "no lookup recorded"));

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
  const seen = await drive({ clientId: OWN, stream: true });
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
  assert("18.H12", batchStore.rows.length === 3
    && batchStore.rows.filter((row) => row.consumed).length === 1
    && batchStore.rows[2].consumed
    && batchSelected.outboundCalls.filter((call) => call.url.includes("paige-write-back")).length === 1);
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
  assert("18.H15", subjectStore.rows.length === 2 && !subjectStore.rows[0].consumed && subjectStore.rows[1].consumed
    && subjectSelected.rec.rpc.filter((call) => call.name === "advance_action").length === 1
    && subjectSelected.rec.rpc.some((call) => call.name === "advance_action"
      && call.args.p_action_id === FOREIGN && call.args.p_decision_rationale === "original note"));

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
      if (!changed && !filters.some(([op]) => op === "update")
        && filters.some(([op, columns]) => op === "select" && String(columns).includes("tool_name"))) {
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
  assert("18.7e execution uses stored approved arguments, never the drift", !JSON.stringify(driftApproved.rec.rpc).includes("model-changed-role") && driftStore.rows[0].consumed);
  const replay = await driveCard(driftStore);
  assert("18.7f drifted card cannot replay a consumed approval",!granted(replay));
  for (const [label, patch] of Object.entries({wrong_user:{user_id:FOREIGN},wrong_tenant:{tenant_id:OTHER_TENANT},wrong_thread:{thread_id:FOREIGN},wrong_client:{scoped_client_id:FOREIGN},wrong_tool:{tool_name:"n8n_create_workflow"},expired:{expires_at:"2000-01-01T00:00:00Z"},legacy:{issued_in_request:null}})) {
    const invalidStore=makeConfirmStore([{...approvedRow,...patch,consumed:false}]);
    const refused=await driveCard(invalidStore);
    assert("18.7g drifted card refuses " + label,!granted(refused));
  }
  const ambiguous=makeConfirmStore([{...approvedRow,consumed:false},{...approvedRow,fingerprint:"f".repeat(16),consumed:false}]);
  const ambiguousReply=await driveCard(ambiguous,{approvedConfirmations:[issuedApproval(approvedRow),"f".repeat(16)]});
  assert("18.7h ambiguous submitted proposals do not pick an arbitrary call",!granted(ambiguousReply));

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
  const liveDrive = async ({ authority = { data: true, error: null }, scopeOverride = {}, bodyOverride = {}, failStreamCalls = [], breakStreamCalls = {}, ordinary = false } = {}) => {
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
      toolCall: ordinary ? undefined : { name: "comms_connection_summary", args: {} },
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

  for (const [name, options, reachesAuthority] of [
    ["false authorization", { authority: { data: false, error: null } }, true],
    ["missing authorization", { authority: { data: null, error: null } }, true],
    ["errored authorization even with true data", { authority: { data: true, error: { message: "unavailable" } } }, true],
    ["nonboolean authorization", { authority: { data: "true", error: null } }, true],
    ["another signed actor", { scopeOverride: { actorId: FOREIGN } }, false],
    ["another signed tenant", { scopeOverride: { tenantId: OTHER_TENANT } }, false],
    ["body-supplied identity cannot override authorization", { authority: { data: false, error: null },
      bodyOverride: { actorId: FOREIGN, user_id: FOREIGN, tenantId: OTHER_TENANT, tenant_id: OTHER_TENANT } }, true],
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
    stream: true, extraBody: { threadId: THREAD, ...body },
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
    stream: true, extraBody: { threadId: THREAD, ...body },
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
  assert("30.34 CONTROL: a report the extraction can read reaches the proposal, after a client memory note is written",
    frames(proposed).some((f) => f.extraction_proposal) && proposed.rec.inserts.some((i) => i.table === "client_memory")
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
  assert("30.35 a sync refused after its client memory note was written tells the uploader it did not finish, never that nothing was added",
    stampRefused.rec.inserts.some((i) => i.table === "client_memory")
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
  assert("31.20 CONTROL: a filed one renders its step and is audited",
    actionSteps(cleanFiling).length === 1 && audited(cleanFiling).length >= 1,
    JSON.stringify({ steps: actionSteps(cleanFiling), audited: audited(cleanFiling).length }));

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
    stream: true, extraBody: { threadId: THREAD }, toolCall, functionsExtra,
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
  assert("36.10 a turn stopped by the round budget ends LIMIT_REACHED, on the wire and in the record",
    terminalOf(capped)?.state === "LIMIT_REACHED" && terminalOf(capped)?.event === "completed"
      && persistedStates(capped)[0]?.state === "LIMIT_REACHED" && persistedStates(capped)[0]?.rounds === 5 && persistedStates(capped)[0]?.tools === 5,
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
}

console.log(`\n${checks - failures} passed, ${failures} failed`);
process.exit(failures === 0 ? 0 : 1);
