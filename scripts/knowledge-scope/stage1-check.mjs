/**
 * Knowledge-retrieval tenant-scope checks for `paige-ai-chat`.
 *
 * THE DEFECT THESE EXIST FOR — and why it is a CONFIDENTIALITY defect, not a silent
 * failure. `paige-ai-chat` picked the tenant it searches with an UNORDERED
 * `tenant_members … limit(1)` that ignored `profiles.active_tenant_id`, then passed it as
 * `p_tenant_id` to `match_tenant_knowledge`. That names a tenant the caller IS a member of
 * but is NOT currently operating as — every Agency Parent qualifies, because
 * `agency_enter_subaccount()` writes a membership row.
 *
 * The RPC's guard did NOT catch it on this path. The call went through the SERVICE-ROLE
 * client, and the guard (migration 20260720224948) is explicitly exempt when `auth.uid()`
 * IS NULL — exactly the service-role case. So the WRONG ACCOUNT'S PRIVATE CHUNKS were
 * retrieved and placed into Paige's prompt. §9/§51 (#588 class) + §13.
 *
 * WHAT IS ACTUALLY EXERCISED. The REAL shipped handler, imported through the loader in
 * `stub-hook.mjs`, driven with a real `Request`. Only the module boundary is faked. No
 * assertion is made against a re-implementation of the logic, and no check passes on the
 * strength of a string match against source text. The fake records WHICH client made each
 * call, so "the JWT-scoped guard is engaged" is proven, not assumed.
 *
 * FAILING-FIRST. Groups 1, 2, 3, 5, 6, 8, 9 and 11 contain assertions that FAIL on the
 * pre-fix handler. They were written and run against the defect before the correction
 * existed; the run is recorded in the PR.
 *
 * Run: node --import ./scripts/knowledge-scope/register.mjs scripts/knowledge-scope/stage1-check.mjs
 */

const AGENCY = "11111111-1111-4111-8111-111111111111";
const CHILD = "22222222-2222-4222-8222-222222222222";
const SOLO = "33333333-3333-4333-8333-333333333333";
const USER = "44444444-4444-4444-8444-444444444444";

const VECTOR = Array.from({ length: 1024 }, (_, i) => (i % 7) / 10);

let failures = 0;
let checks = 0;
/** Every stream this harness drives, audited for the turn frame in the last group (paige-turn). */
const drivenStreams = [];
function assert(label, cond, detail) {
  checks += 1;
  if (cond) {
    console.log(`  ok   ${label}`);
  } else {
    failures += 1;
    console.log(`  FAIL ${label}`);
    if (detail !== undefined) console.log(`         ${detail}`);
  }
}
function group(name) {
  console.log(`\n${name}`);
}

// ── Environment the handler reads at module scope ────────────────────────────────
globalThis.Deno = {
  env: {
    get: (k) =>
      ({
        SUPABASE_URL: "https://test.supabase.co",
        SUPABASE_ANON_KEY: "anon-key",
        SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
        VOYAGE_API_KEY: "test-voyage-key",
        ANTHROPIC_API_KEY: "test-anthropic-key",
      })[k] ?? "",
  },
};

// Voyage is the ONLY outbound call the retrieval path makes before the RPC. Returning a
// real-shaped vector is what lets the check reach `match_tenant_knowledge` at all; every
// other host is refused so a check can never silently depend on the network.
const realFetch = globalThis.fetch;
let embedCount = 0;
let providerPlan = [];
let providerCalls = [];
// INT-334 R4 — the turn classifier's calls, kept apart from `providerCalls` so a check's provider plan
// and call count stay the model rounds it scripts. Every classifier payload is still egress: checks
// below prove it never leaves on a switched account and never carries account Knowledge.
let classifierCalls = [];
let syncCalls = [];
let syncThrows = false;
function embedCalls() { return embedCount; }
function resetEmbeds() { embedCount = 0; }
function resetProvider(plan = []) { providerPlan = [...plan]; providerCalls = []; classifierCalls = []; syncCalls = []; }
function anthropicStream(kind = "text") {
  const responseText = kind === "private-text"
    ? "CHILD-PRIVATE-MARKER"
    // Trips the `lender_searched` extractor AND the not-legal-advice flag, so a check can prove
    // response-derived analytics really do fire on a healthy turn.
    : kind === "lender-text"
    ? "CHILD-PRIVATE-MARKER — consider: Summit Capital. This is not legal advice."
    : "Scoped response.";
  const events = kind === "tool"
    ? [
        { type: "message_start", message: { usage: { input_tokens: 1 } } },
        { type: "content_block_start", index: 0, content_block: { type: "tool_use", id: "tool-1", name: "plan_list" } },
        { type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: "{}" } },
        { type: "message_delta", delta: { stop_reason: "tool_use" }, usage: { output_tokens: 1 } },
        { type: "message_stop" },
      ]
    // A round proposing TWO tools. This exists so a check can prove the dispatch guard is
    // asserted PER TOOL: with a batch-level check the account can change after the first
    // tool has run and every later tool in the same round still executes on stale scope.
    // Distinct `limit` args make the two dispatches individually identifiable in the RPC
    // recorder — `plan_list` maps straight through to a `plan_list` RPC with `p_limit`.
    // A round that calls durable `document_generate` with a bounded brief and a real title.
    // Submission must acknowledge the durable work identity without pretending the later
    // worker-owned artifact already exists or echoing the model-authored title to the wire.
    : kind === "doc-artifact"
    ? [
        { type: "message_start", message: { usage: { input_tokens: 1 } } },
        { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
        { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Writing that up from the private note." } },
        { type: "content_block_start", index: 0, content_block: { type: "tool_use", id: "tool-1", name: "document_generate" } },
        { type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: JSON.stringify({ title: "CHILD-PRIVATE-MARKER onboarding guide", doc_type: "guide", brief: "Create an onboarding guide from the verified private note.", confirm: true }) } },
        { type: "message_delta", delta: { stop_reason: "tool_use" }, usage: { output_tokens: 1 } },
        { type: "message_stop" },
      ]
    // A mutating call left UNCONFIRMED. At the default `confirm` lane the tool is not run; it
    // returns `needs_confirm` + a `confirm_summary` built by interpolating the MODEL'S OWN
    // ARGUMENTS, which the loop turns into a `paige_confirm` card. `crm_create_contact` is used
    // deliberately: `document_generate`'s summary is a fixed sentence, so a card built from it
    // would carry no model text and the assertion below would pass for the wrong reason.
    // `crm_create_contact` on its DEDUPLICATION branch. Its canonical result is durable tenant
    // readback — and when a near-match is found it returns
    // `matches: [...]`, real contact names, emails, phones and lifecycle stages read out of the
    // tenant's book. A name cannot express "this tool sometimes reads", which is why the receipt
    // test is now a shape test as well.
    // `deal_move_stage` — a canonical CRM tool whose result is SMALL, FLAT and not a list, and
    // still carries `stage: stage.label` read out of `pipeline_stages`. It slipped past both the
    // size bound and the record-list test, which is what showed a SHAPE heuristic could never
    // answer "is this result free of evidence?".
    : kind === "deal-stage"
    ? [
        { type: "message_start", message: { usage: { input_tokens: 1 } } },
        { type: "content_block_start", index: 0, content_block: { type: "tool_use", id: "tool-1", name: "deal_move_stage" } },
        { type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: JSON.stringify({ deal_id: "dddd2222-3333-4444-8555-666677778888", stage_id: "eeee2222-3333-4444-8555-666677778888", confirm: true }) } },
        { type: "message_delta", delta: { stop_reason: "tool_use" }, usage: { output_tokens: 1 } },
        { type: "message_stop" },
      ]
    : kind === "dedup-contact"
    ? [
        { type: "message_start", message: { usage: { input_tokens: 1 } } },
        { type: "content_block_start", index: 0, content_block: { type: "tool_use", id: "tool-1", name: "crm_create_contact" } },
        { type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: JSON.stringify({ first_name: "Ada", last_name: "L", email: "ada@example.test" }) } },
        { type: "message_delta", delta: { stop_reason: "tool_use" }, usage: { output_tokens: 1 } },
        { type: "message_stop" },
      ]
    : kind === "confirm-card"
    ? [
        { type: "message_start", message: { usage: { input_tokens: 1 } } },
        { type: "content_block_start", index: 0, content_block: { type: "tool_use", id: "tool-1", name: "crm_create_contact" } },
        { type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: JSON.stringify({ first_name: "CHILD-PRIVATE-MARKER", last_name: "FromKnowledge", email: "leak@example.test" }) } },
        { type: "message_delta", delta: { stop_reason: "tool_use" }, usage: { output_tokens: 1 } },
        { type: "message_stop" },
      ]
    // `ask_choices` inside a Studio session. This branch is special: the chips frame IS the whole
    // assistant turn (it sets `finalChunks = []` and breaks), so if it streams unbuffered a
    // protected turn publishes its entire answer before the final check ever runs.
    // `action_file` with a department the model INVENTED. `describeStep` title-cases
    // `args.to_department` straight into an action step's LABEL, and action steps are the one
    // channel that streams live on a protected turn — on the stated grounds that their label
    // comes from a fixed vocabulary. It did not. Nothing else in this harness drives a tool
    // whose step text is built from model arguments.
    // `propose_action`, which queues an approval and emits an `approval_queued` frame whose
    // `summary` is the model's own argument. That frame was listed in the commit message as
    // "moved behind the close decision" and as mutation-proven; reverting it left the suite
    // fully green, because nothing here produced one. This fixture is what makes the claim real.
    : kind === "propose-action"
    ? [
        { type: "message_start", message: { usage: { input_tokens: 1 } } },
        { type: "content_block_start", index: 0, content_block: { type: "tool_use", id: "tool-1", name: "propose_action" } },
        { type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: JSON.stringify({ action_type: "email", summary: "CHILD-PRIVATE-MARKER follow-up", contact_id: "11111111-1111-4111-8111-111111111111", subject: "s", body: "b", to: "x@example.test" }) } },
        { type: "message_delta", delta: { stop_reason: "tool_use" }, usage: { output_tokens: 1 } },
        { type: "message_stop" },
      ]
    // `draft_marketing_content` — a tool the autonomy gate no longer holds (it persists nothing; it
    // left `MUTATING_TOOLS` 2026-10-04) but whose result is GENERATED COPY grounded in the tenant's name and
    // brand voice, read out of storage by `content-draft`. Reusing `MUTATING_TOOLS` as the
    // receipt set therefore left an otherwise-ordinary turn unprotected while its closing reply
    // was written in the previous workspace's voice. Nothing else in this harness drives a tool
    // that is a write and a generator at once.
    : kind === "draft-content"
    ? [
        { type: "message_start", message: { usage: { input_tokens: 1 } } },
        { type: "content_block_start", index: 0, content_block: { type: "tool_use", id: "tool-1", name: "draft_marketing_content" } },
        { type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: JSON.stringify({ channel: "email", brief: "launch note", confirm: true }) } },
        { type: "message_delta", delta: { stop_reason: "tool_use" }, usage: { output_tokens: 1 } },
        { type: "message_stop" },
      ]
    : kind === "action-file"
    ? [
        { type: "message_start", message: { usage: { input_tokens: 1 } } },
        { type: "content_block_start", index: 0, content_block: { type: "tool_use", id: "tool-1", name: "action_file" } },
        { type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: JSON.stringify({ to_department: "LEAKEDMODELWORD", action_kind: "owner.followup", summary: "x" }) } },
        { type: "message_delta", delta: { stop_reason: "tool_use" }, usage: { output_tokens: 1 } },
        { type: "message_stop" },
      ]
    : kind === "ask-choices"
    ? [
        { type: "message_start", message: { usage: { input_tokens: 1 } } },
        { type: "content_block_start", index: 0, content_block: { type: "tool_use", id: "tool-1", name: "ask_choices" } },
        { type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: JSON.stringify({ prompt: "CHILD-PRIVATE-MARKER — which direction?", options: [{ label: "One", value: "one" }, { label: "Two", value: "two" }] }) } },
        { type: "message_delta", delta: { stop_reason: "tool_use" }, usage: { output_tokens: 1 } },
        { type: "message_stop" },
      ]
    // A round the provider FINISHES cleanly (end_turn, so the translator sends finish_reason "stop")
    // with no text and no tool call (paige-turn, 29.8): a clean stop that answered nothing.
    : kind === "ws-text"
    ? [
        { type: "message_start", message: { usage: { input_tokens: 1 } } },
        { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
        { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "   " } },
        { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 1 } },
        { type: "message_stop" },
      ]
    : kind === "empty-end"
    ? [
        { type: "message_start", message: { usage: { input_tokens: 1 } } },
        { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 1 } },
        { type: "message_stop" },
      ]
    : kind === "two-tools"
    ? [
        { type: "message_start", message: { usage: { input_tokens: 1 } } },
        // Narration alongside the tool calls, so the round produces a `summarizeThought` line.
        // Without it `content` is empty, no thought frame is ever emitted, and an assertion that
        // thoughts are withheld would pass against a fixture that never makes one.
        { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
        { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Checking the private note about CHILD-PRIVATE-MARKER before I answer." } },
        { type: "content_block_start", index: 0, content_block: { type: "tool_use", id: "tool-1", name: "plan_list" } },
        { type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: '{"limit":11}' } },
        { type: "content_block_start", index: 1, content_block: { type: "tool_use", id: "tool-2", name: "plan_list" } },
        { type: "content_block_delta", index: 1, delta: { type: "input_json_delta", partial_json: '{"limit":22}' } },
        { type: "message_delta", delta: { stop_reason: "tool_use" }, usage: { output_tokens: 1 } },
        { type: "message_stop" },
      ]
    : [
        { type: "message_start", message: { usage: { input_tokens: 1 } } },
        { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
        { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: responseText } },
        { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 1 } },
        { type: "message_stop" },
      ];
  return new Response(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(""), {
    status: 200,
    headers: { "Content-Type": "text/event-stream" },
  });
}
/** The words a `break-mid-text` stream gets out before it breaks (paige-turn probes, group 29). */
const BROKEN_ANSWER = "Here is the first half of the answer, and then";
function breakingStream(kind) {
  const events = [{ type: "message_start", message: { usage: { input_tokens: 1 } } }];
  if (kind === "break-mid-text") {
    events.push({ type: "content_block_start", index: 0, content_block: { type: "text", text: "" } });
    events.push({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: BROKEN_ANSWER } });
  }
  const bytes = new TextEncoder().encode(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(""));
  let sent = false;
  // Pull-driven, so the events are READ before the error (erroring in `start` would discard them).
  const body = new ReadableStream({
    pull(c) {
      if (!sent) { sent = true; c.enqueue(bytes); } else c.error(new Error("fixture: upstream connection reset"));
    },
  });
  return new Response(body, { status: 200, headers: { "Content-Type": "text/event-stream" } });
}
globalThis.fetch = async (url, init) => {
  const href = String(url);
  if (href.includes("voyageai.com")) {
    // Counted so a check can prove NO paid embedding happens when scope is unresolved.
    embedCount += 1;
    return new Response(JSON.stringify({ data: [{ index: 0, embedding: VECTOR }] }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }
  if (href === "https://api.anthropic.com/v1/messages") {
    const sent = JSON.parse(String(init?.body ?? "{}"));
    if (String(sent.system ?? "").startsWith("You label one message sent to PAIGE")) {
      classifierCalls.push(sent);
      // An ordinary answer that needs this workspace's records: the route stays operational, as before R4.
      const label = { intent: "answer", research: "none", difficulty: "routine", image: "none", needs_workspace_data: true, confidence: 0.9 };
      return new Response(JSON.stringify({ content: [{ type: "text", text: JSON.stringify(label) }], model: "test", usage: { input_tokens: 1, output_tokens: 1 } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    providerCalls.push(sent);
    const next = providerPlan.shift() ?? "text";
    // An extraction that parses but FAILS validation, so the `logSyncFailure` path is reached
    // with the full `structured` payload — the write 14b.1/14b.2 are about.
    if (next === "json-extraction-invalid") {
      const extracted = JSON.stringify({
        is_credit_report: false,
        extraction_verified: false,
        report_type: "consumer",
        scores: {},
        negative_items: [],
        positive_accounts: [],
        hard_inquiries: [],
      });
      return new Response(JSON.stringify({ content: [{ type: "text", text: extracted }], model: "test", usage: { input_tokens: 1, output_tokens: 1 } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (next === "general-extraction") {
      const extracted = JSON.stringify({ document_type: "Formation Certificate", fields: { "foundation.legal_name": "Acme Holdings LLC" } });
      return new Response(JSON.stringify({ content: [{ type: "text", text: extracted }], model: "test", usage: { input_tokens: 1, output_tokens: 1 } }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    if (next === "json-extraction") {
      const extracted = JSON.stringify({
        is_credit_report: true,
        extraction_verified: true,
        report_type: "consumer",
        scores: { equifax: 700, experian: 701, transunion: 702 },
        negative_items: [],
        positive_accounts: [{ creditor: "Test Bank", account_type: "revolving" }],
        hard_inquiries: [],
      });
      return new Response(JSON.stringify({ content: [{ type: "text", text: extracted }], model: "test", usage: { input_tokens: 1, output_tokens: 1 } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    // The PDF read-check that decides `isCreditReportPdf`. Satisfying it is what routes a
    // document turn down the credit-report extraction+sync branch — the only path on which the
    // sync helper's scope callback AND the caller's own recheck both run, which is what made
    // the self-erasing-guard defect reachable.
    if (next === "read-check") {
      const readCheck = JSON.stringify({
        can_read_document: true,
        document_kind: "credit_report",
        first_five_account_names: ["Test Bank"],
      });
      return new Response(JSON.stringify({ content: [{ type: "text", text: readCheck }], model: "test", usage: { input_tokens: 1, output_tokens: 1 } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    // The SAME pre-resolution PDF read-check, but for a readable PDF that is NOT a credit report:
    // `document_kind` is not `credit_report`, so `isCreditReportPdf` is false and the turn routes to
    // the general-document (deferred-extraction) path. This is what a general-PDF turn hits — the
    // one accepted pre-resolution provider call 15.9e pins the contract of.
    if (next === "read-check-general") {
      const readCheck = JSON.stringify({ can_read_document: true, document_kind: "other" });
      return new Response(JSON.stringify({ content: [{ type: "text", text: readCheck }], model: "test", usage: { input_tokens: 1, output_tokens: 1 } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    // A provider round that FAILS. Used to reach the loop's forced-termination path — the
    // branch that issues a tools-less CLOSING call — without needing to exhaust MAX_ROUNDS.
    if (next === "fail") {
      return new Response(JSON.stringify({ error: "upstream" }), { status: 500, headers: { "Content-Type": "application/json" } });
    }
    // A provider stream that BREAKS after answering 200 (paige-turn). It sends its first events, then
    // the connection resets: the next read rejects. `_shared/claude.ts`'s translator catches that and
    // still ends with a clean [DONE] — so the ONLY sign the answer was cut off is the missing
    // finish_reason (the translator sends one only on the provider's own message_stop). `before-text`
    // breaks after message_start; `mid-text` after part of an answer.
    if (next === "break-before-text" || next === "break-mid-text") return breakingStream(next);
    return anthropicStream(next);
  }
  if (href.endsWith("/functions/v1/fetch-url-content")) {
    return new Response(JSON.stringify({ success: true, url: "https://example.test/doc", content: "PRIVATE-FETCHEDURL-MARKER page body" }), {
      status: 200, headers: { "Content-Type": "application/json" },
    });
  }
  if (href.endsWith("/functions/v1/sync-credit-report-data")) {
    // Throwing HERE is what reaches the helper's catch block. Throwing from the provider does
    // NOT: `gatewayCompat` catches its own transport errors and returns a non-ok response, so
    // the helper takes the extraction-failure branch instead and the catch is never entered.
    // The control assertion below is what caught that — the first version of this scenario
    // "passed" a throw that never went where it claimed.
    if (syncThrows) throw new Error("simulated sync transport failure");
    syncCalls.push(JSON.parse(String(init?.body ?? "{}")));
    return new Response(JSON.stringify({ results: {} }), { status: 200, headers: { "Content-Type": "application/json" } });
  }
  throw new Error(`knowledge-scope: unexpected outbound fetch to ${href}`);
};
void realFetch;

const fake = await import("./fake-supabase.mjs");
const chatModule = await import("../../supabase/functions/paige-ai-chat/index.ts");
const { capturedHandler } = await import("./stub-serve.mjs");
const handler = capturedHandler();

/**
 * Drive one caller shape through the real handler.
 *
 * `memberships` is what an UNORDERED `tenant_members` read would return — deliberately
 * ordered so its FIRST row is NOT the active tenant. That is the whole trap: a correct
 * handler must ignore this ordering entirely.
 */
async function drive({ personaTenant, personaSequence = null, memberships, kbRejects = false, ragHits = false, bodyExtras = {}, noAuth = false, unauthenticated = false, chunkTitle = "PRIVATE-CHUNKTITLE-MARKER", chunkContent = "x", provider = ["text"], rpcExtras = {}, tableExtras = {}, functionExtras = {}, fundingEnabled = false, throwOnSync = false, activeTenantId = "__USE_PERSONA__", userMessage = "what does my onboarding process look like?", insertThrows = [] }) {
  // `profiles.active_tenant_id` is an INDEPENDENT axis from the persona-resolved tenant. It
  // defaults to `personaTenant` so every existing scenario is byte-identical (persona and active
  // agree). A check overrides it to model the case current_user_tenant_id() hides: a null or
  // stale active_tenant_id where the persona tenant is the COALESCE oldest-membership fallback.
  const declaredActiveTenant = activeTenantId === "__USE_PERSONA__" ? personaTenant : activeTenantId;
  const logged = [];
  syncThrows = throwOnSync;
  resetEmbeds();
  const origWarn = console.warn;
  const origError = console.error;
  const origLog = console.log;
  console.warn = (...a) => logged.push({ level: "warn", msg: a.join(" ") });
  console.error = (...a) => logged.push({ level: "error", msg: a.join(" ") });
  // `console.log` is captured too, because the handler announces each protected-evidence source
  // there and that announcement is the only thing that distinguishes the five below-the-latch
  // call sites from one another.
  console.log = (...a) => logged.push({ level: "log", msg: a.join(" ") });
  resetProvider(provider);
  let personaCall = 0;
  const personaStates = personaSequence ?? [personaTenant];

  const rec = fake.setScenario({
    insertThrows,
    authUser: unauthenticated ? null : { id: USER, email: "owner@example.test" },
    rpcs: {
      check_rate_limit: { data: true, error: null },
      get_paige_persona_context: () => {
        const state = personaStates[Math.min(personaCall++, personaStates.length - 1)];
        // A FUNCTION IS A THROWER, not a tenant id. Without this the function fell through and
        // became `tenant_id: <function>`, so "a resolver that throws" was actually testing a
        // degenerate tenant id — it passed, for a reason other than the one it named.
        if (typeof state === "function") return state();
        if (state && typeof state === "object" && "error" in state) return state;
        // A TENANT-LESS OPERATOR GETS NO ROW, NOT A ROW OF NULLS. The real resolver
        // (migration 20260805130000, lines 80-82) executes a bare `RETURN` when the tenant is
        // null, and a bare RETURN from a RETURNS TABLE function yields ZERO ROWS. This fake used
        // to fabricate `[{ tenant_id: null, … }]`, a shape production never produces — so the
        // operator control asserted delivery against a shape that could not occur, and passed
        // while every real operator turn carrying evidence was being refused outright.
        if (state == null) return { data: [], error: null };
        return {
          data: [{ tenant_id: state, tenant_name: null, playbook_config: null, playbook_slug: null, funding_enabled: fundingEnabled, brand: null }],
          error: null,
        };
      },
      match_tenant_knowledge: (args) =>
        kbRejects
          ? { data: null, error: { message: "KB_FORBIDDEN: cross-tenant knowledge search denied", code: "42501" } }
          : { data: [{ source_tier: "tenant", doc_id: "d1", chunk_id: "c1", title: chunkTitle, content: chunkContent, similarity: 0.91 }], error: null },
      // `rag_documents` retrieval — the platform-wide knowledge base, and the SECOND of the
      // latch's four sources. It was never configured here, so it resolved to `{data:null}` and
      // `ragContext` was `""` in every assertion in this file: removing it from the latch left
      // the whole suite green. An independent review found that, and this stub is what ends it.
      match_rag_documents: () => (ragHits
        ? { data: [{ id: "rag-1", title: "PRIVATE-RAGTITLE-MARKER outcomes", summary: "PRIVATE-RAG-SOURCE-MARKER", content: "", similarity: 0.88 }], error: null }
        : { data: [], error: null }),
      // THE CALLER IS AN OWNER unless a scenario says otherwise. Unstubbed, the tier resolver fails
      // closed to a client seat, and a client seat's turn is always held so its answer can be read
      // before release (R3). With that default every drive here was held whatever evidence it
      // carried, and the checks that prove each evidence source holds the turn passed whether or
      // not it did: an independent review removed two sources from the entry list and this file
      // stayed green. A scenario that means a client says so, as 21.ac2 does.
      get_actor_access: { data: { tier: "tenant" }, error: null },
      // Scenario-specific RPCs (e.g. the `save_marketing_content` a `document_generate` tool
      // call persists through). Last, so a scenario can also override a default above.
      ...rpcExtras,
    },
    functions: functionExtras,
    tables: {
      tenant_members: () => memberships.map((t) => ({ tenant_id: t })),
      profiles: () => [{ active_tenant_id: declaredActiveTenant }],
      ...tableExtras,
      // A THREAD ROW ALWAYS HAS AN OWNER. The handler refuses a thread whose `tenant_id` is not the
      // turn's workspace (owner addition 2026-10-05), and a production row always carries that column.
      // A scripted thread row that does not name its tenant models the caller's OWN thread, so it is
      // filled with the workspace the turn resolves first — the same default `profiles` uses above. A
      // scenario that scripts `tenant_id` (including null) keeps exactly what it wrote.
      ...(typeof tableExtras.paige_chat_threads === "function" ? {
        paige_chat_threads: (filters) => (tableExtras.paige_chat_threads(filters) ?? []).map((row) =>
          row && typeof row === "object" && !("tenant_id" in row)
            ? { tenant_id: typeof personaStates[0] === "string" ? personaStates[0] : null, ...row } : row),
      } : {}),
    },
  });

  let status = null;
  let responseText = "";
  try {
    const headers = { "Content-Type": "application/json" };
    if (!noAuth) headers.Authorization = "Bearer test-jwt";
    const res = await handler(
      new Request("http://local/paige-ai-chat", {
        method: "POST",
        headers,
        // `bodyExtras` is how a check smuggles a tenant identifier in through the REQUEST —
        // the one thing server-derived scope must never honour.
        body: JSON.stringify({
          messages: [{ role: "user", content: userMessage }],
          ...bodyExtras,
        }),
      }),
    );
    status = res?.status ?? null;
    if (res?.body) responseText = await res.text();
    drivenStreams.push({ label: userMessage.slice(0, 40), status, responseText, rec });
  } catch {
    // A downstream failure (no model key configured) is expected and irrelevant — the
    // retrieval call under test happens well before any model call.
  } finally {
    console.warn = origWarn;
    console.error = origError;
    console.log = origLog;
    syncThrows = false;
  }

  const kbCall = rec.rpc.find((r) => r.name === "match_tenant_knowledge");
  const memberReads = rec.from.filter((f) => f.table === "tenant_members");
  const telemetry = rec.inserts.find((i) => i.table === "kb_query_telemetry");
  return { rec, kbCall, memberReads, telemetry, logged, status, embeds: embedCalls(), providerCalls: [...providerCalls], classifierCalls: [...classifierCalls], responseText, syncCalls: [...syncCalls] };
}

// ── 1 · Multi-membership active-account resolution ───────────────────────────────
group("multi-membership active-account resolution");
{
  // Active tenant is CHILD; the unordered membership read would hand back AGENCY first.
  const r = await drive({ personaTenant: CHILD, memberships: [AGENCY, CHILD] });
  assert(
    "1.1 match_tenant_knowledge is actually reached",
    !!r.kbCall,
    `rpcs seen: ${r.rec.rpc.map((x) => x.name).join(", ") || "(none)"}`,
  );
  assert(
    "1.2 p_tenant_id is the ACTIVE tenant, not the first membership row",
    r.kbCall?.args?.p_tenant_id === CHILD,
    `expected ${CHILD}, got ${r.kbCall?.args?.p_tenant_id}`,
  );
  assert(
    "1.3 no unordered tenant_members LIMIT 1 pick is performed at all",
    !r.memberReads.some((m) => m.limit === 1 && !m.ordered),
    `tenant_members reads: ${JSON.stringify(r.memberReads.map((m) => ({ limit: m.limit, ordered: m.ordered })))}`,
  );
}

// ── 2 · Agency Parent scope ──────────────────────────────────────────────────────
group("Agency Parent scope");
{
  const r = await drive({ personaTenant: AGENCY, memberships: [CHILD, AGENCY] });
  assert(
    "2.1 an Agency Parent searches its OWN tenant",
    r.kbCall?.args?.p_tenant_id === AGENCY,
    `expected ${AGENCY}, got ${r.kbCall?.args?.p_tenant_id}`,
  );
}

// ── 3 · Agency acting as a Sub-account ───────────────────────────────────────────
group("Agency acting as a Sub-account");
{
  const r = await drive({ personaTenant: CHILD, memberships: [AGENCY, CHILD] });
  assert(
    "3.1 the ACTIVE CHILD scope governs retrieval, never the parent",
    r.kbCall?.args?.p_tenant_id === CHILD,
    `expected ${CHILD}, got ${r.kbCall?.args?.p_tenant_id}`,
  );
  assert(
    "3.2 the parent's tenant is never passed",
    r.kbCall?.args?.p_tenant_id !== AGENCY,
    `got ${r.kbCall?.args?.p_tenant_id}`,
  );
}

// ── 4 · Single-tenant Solo / Sub-account regression protection ───────────────────
group("single-tenant Solo / Sub-account regression protection");
{
  const r = await drive({ personaTenant: SOLO, memberships: [SOLO] });
  assert(
    "4.1 a single-membership caller still retrieves its own tenant",
    r.kbCall?.args?.p_tenant_id === SOLO,
    `expected ${SOLO}, got ${r.kbCall?.args?.p_tenant_id}`,
  );
  assert("4.2 the knowledge RPC still runs (no behaviour lost)", !!r.kbCall);
}

// ── 5 · Tenantless Platform Operator does NO tenant work ────────────────────────
group("tenantless Platform Operator — unresolved scope does no work");
{
  const r = await drive({ personaTenant: null, memberships: [] });
  assert(
    "5.1 no retrieval is attempted at all when scope is unresolved",
    r.kbCall === undefined,
    `match_tenant_knowledge was called with ${JSON.stringify(r.kbCall?.args?.p_tenant_id)}`,
  );
  assert(
    "5.2 no arbitrary tenant is substituted for a tenantless operator",
    ![AGENCY, CHILD, SOLO].includes(r.kbCall?.args?.p_tenant_id),
    `got ${r.kbCall?.args?.p_tenant_id}`,
  );
  // The KB block's embed is measured as a DELTA, not as a global zero. Two OTHER embed
  // calls (the client-memory semantic pull and the rag_documents pull) live in this handler
  // and are outside this PR's authorized scope — asserting `embeds === 0` would have been a
  // claim about code this change does not touch, and would fail for the wrong reason.
  const resolvedRun = await drive({ personaTenant: SOLO, memberships: [SOLO] });
  assert(
    "5.3 the KB pathway makes NO paid embedding call when scope is unresolved",
    r.embeds === resolvedRun.embeds - 1,
    `unresolved made ${r.embeds} embeds, resolved made ${resolvedRun.embeds}; expected exactly one fewer (the KB block's)`,
  );
  assert(
    "5.4 no tenant telemetry row is written",
    !r.telemetry,
    `telemetry: ${JSON.stringify(r.telemetry?.row ?? null)}`,
  );
}

// ── 6 · KB rejection is observable ───────────────────────────────────────────────
group("KB authorization rejection is observable");
{
  const r = await drive({ personaTenant: CHILD, memberships: [CHILD], kbRejects: true });
  const hit = r.logged.filter((l) => /match_tenant_knowledge/.test(l.msg));
  assert("6.1 the rejection is logged at all", hit.length > 0, JSON.stringify(r.logged.slice(0, 4)));
  assert(
    "6.2 it is logged at ERROR level, not swallowed as an ordinary warning",
    hit.some((l) => l.level === "error"),
    `levels seen: ${hit.map((l) => l.level).join(", ") || "(none)"}`,
  );
  assert(
    "6.3 the log carries the refused tenant so the scope is diagnosable",
    hit.some((l) => l.msg.includes(CHILD)),
    `messages: ${hit.map((l) => l.msg).join(" | ")}`,
  );
}

// ── 7 · Telemetry receives the same resolved active tenant ───────────────────────
group("telemetry receives the same resolved active tenant");
{
  const r = await drive({ personaTenant: CHILD, memberships: [AGENCY, CHILD] });
  assert("7.1 a telemetry row is written", !!r.telemetry, "no kb_query_telemetry insert recorded");
  assert(
    "7.2 telemetry tenant_id matches the tenant that was actually searched",
    r.telemetry?.row?.tenant_id === r.kbCall?.args?.p_tenant_id,
    `telemetry ${r.telemetry?.row?.tenant_id} vs searched ${r.kbCall?.args?.p_tenant_id}`,
  );
  assert(
    "7.3 telemetry stores a query HASH, never the raw question",
    typeof r.telemetry?.row?.query_hash === "string" &&
      !JSON.stringify(r.telemetry?.row ?? {}).includes("onboarding process"),
    JSON.stringify(r.telemetry?.row ?? {}),
  );
}

// ── 8 · The JWT-scoped RPC guard stays engaged ──────────────────────────────────
group("JWT-scoped RPC guard remains engaged");
{
  const r = await drive({ personaTenant: CHILD, memberships: [AGENCY, CHILD] });
  assert(
    "8.1 match_tenant_knowledge is called through the caller's JWT client",
    r.kbCall?.client === "jwt",
    `client was "${r.kbCall?.client}" — a service-role call exempts the RPC's guard (auth.uid() IS NULL), disabling defence in depth`,
  );
  assert(
    "8.2 the old first-membership query is absent from the whole request",
    !r.rec.from.some((f) => f.table === "tenant_members" && f.limit === 1 && !f.ordered),
    `tenant_members reads: ${JSON.stringify(r.rec.from.filter((f) => f.table === "tenant_members"))}`,
  );
}

// ── 9 · Request-supplied tenant identifiers cannot override server scope ─────────
group("request-supplied tenant identifiers cannot override server scope");
{
  // Every plausible UNKNOWN-KEY smuggling shape at once. Server scope is CHILD; the body
  // screams AGENCY. These keys are not in messageSchema, so zod strips them — the check
  // proves they are stripped AND that retrieval still happens on the server's tenant, which
  // is a stronger result than the request merely being rejected.
  const r = await drive({
    personaTenant: CHILD,
    memberships: [CHILD],
    bodyExtras: {
      tenant_id: AGENCY,
      tenantId: AGENCY,
      p_tenant_id: AGENCY,
      active_tenant_id: AGENCY,
      account_id: AGENCY,
    },
  });
  assert(
    "9.1 retrieval still runs — the smuggled keys are stripped, not fatal",
    !!r.kbCall,
    `no match_tenant_knowledge call; status ${r.status}`,
  );
  assert(
    "9.2 the searched tenant is the SERVER-resolved one, not the body's",
    r.kbCall?.args?.p_tenant_id === CHILD,
    `expected ${CHILD}, got ${r.kbCall?.args?.p_tenant_id}`,
  );
  assert(
    "9.3 the body's tenant never reaches telemetry either",
    r.telemetry?.row?.tenant_id === CHILD,
    `telemetry tenant_id ${r.telemetry?.row?.tenant_id}`,
  );

  // A KNOWN key given a hostile shape is a different property: it must be refused by
  // validation BEFORE any tenant work happens. Kept as its own assertion so a validation
  // rejection can never be mistaken for proof that scope resolution is correct.
  const malformed = await drive({
    personaTenant: CHILD,
    memberships: [CHILD],
    bodyExtras: { clientContext: { tenant_id: AGENCY, tenantId: AGENCY } },
  });
  assert("9.4 a malformed known field is refused 400", malformed.status === 400, `status ${malformed.status}`);
  assert("9.5 …before any retrieval", malformed.kbCall === undefined);
  assert("9.6 …and before any paid embedding", malformed.embeds === 0, `embeds: ${malformed.embeds}`);
}

// ── 10 · Unauthenticated callers remain rejected ────────────────────────────────
group("unauthenticated callers remain rejected");
{
  const missingHeader = await drive({ personaTenant: CHILD, memberships: [CHILD], noAuth: true });
  assert("10.1 a request with no Authorization header is refused 401", missingHeader.status === 401, `status ${missingHeader.status}`);
  assert("10.2 …and reaches no retrieval", missingHeader.kbCall === undefined);

  const badToken = await drive({ personaTenant: CHILD, memberships: [CHILD], unauthenticated: true });
  assert("10.3 a request whose token resolves to no user is refused 401", badToken.status === 401, `status ${badToken.status}`);
  assert("10.4 …and reaches no retrieval", badToken.kbCall === undefined);
  assert("10.5 …and makes no paid embedding call", badToken.embeds === 0, `embeds: ${badToken.embeds}`);
}

// ── 11 · A wrong account's knowledge cannot enter the prompt ────────────────────
group("a stale or wrong account's knowledge cannot enter the prompt");
{
  // The scenario returns a chunk carrying a marker. Whatever tenant the handler asked for is
  // the only tenant whose chunks can exist, so proving the ASKED tenant is the active one —
  // and that the RPC is JWT-scoped so the database re-checks it — is what bounds the prompt.
  const r = await drive({
    personaTenant: CHILD,
    memberships: [AGENCY, CHILD],
    chunkTitle: "ACTIVE-CHILD-DOC",
    chunkContent: "child-only-material",
  });
  assert(
    "11.1 the only tenant scope ever queried is the active one",
    r.rec.rpc.filter((x) => x.name === "match_tenant_knowledge").every((x) => x.args.p_tenant_id === CHILD),
    JSON.stringify(r.rec.rpc.filter((x) => x.name === "match_tenant_knowledge").map((x) => x.args.p_tenant_id)),
  );
  assert(
    "11.2 retrieval is never attempted for a non-active membership",
    !r.rec.rpc.some((x) => x.name === "match_tenant_knowledge" && x.args.p_tenant_id === AGENCY),
  );
  assert(
    "11.3 exactly one knowledge query is issued per turn (no second, wider sweep)",
    r.rec.rpc.filter((x) => x.name === "match_tenant_knowledge").length === 1,
    `count: ${r.rec.rpc.filter((x) => x.name === "match_tenant_knowledge").length}`,
  );
}

// ── 24 · The DECLARED active workspace gates Knowledge, not the COALESCE fallback ─
// current_user_tenant_id() (migration 20261213000000) COALESCEs a null or unentitled
// active_tenant_id to `tenant_members ORDER BY joined_at ASC LIMIT 1` — the OLDEST membership, a
// workspace the caller is a member of but is not operating as. persona resolves through it, and
// both the RPC's own guard and revalidateTenantKnowledgeScope compare against the SAME resolver,
// so neither sees the substitution. The handler must confirm the resolved scope IS the caller's
// declared active workspace before searching. active null / stale / mismatch → no query.
group("tenant Knowledge is gated on the DECLARED active workspace, not the fallback");
{
  // active_tenant_id NULL: persona came from the oldest-membership fallback (AGENCY sorts first).
  const nullActive = await drive({ personaTenant: CHILD, memberships: [AGENCY, CHILD], activeTenantId: null });
  assert(
    "24.1 no Knowledge query when active_tenant_id is unset (oldest-membership fallback refused)",
    nullActive.kbCall === undefined,
    `match_tenant_knowledge called with ${JSON.stringify(nullActive.kbCall?.args?.p_tenant_id)}`,
  );
  assert(
    "24.2 …and no Knowledge telemetry row is written on the refused turn",
    !nullActive.telemetry,
  );

  // active_tenant_id points at a DIFFERENT (stale / unentitled) workspace than the resolved scope.
  const staleActive = await drive({ personaTenant: CHILD, memberships: [AGENCY, CHILD], activeTenantId: AGENCY });
  assert(
    "24.3 no Knowledge query when the resolved scope != the declared active workspace",
    staleActive.kbCall === undefined,
    `match_tenant_knowledge called with ${JSON.stringify(staleActive.kbCall?.args?.p_tenant_id)}`,
  );

  // Happy path preserved: declared active EQUALS the resolved scope, so the search runs normally.
  const matched = await drive({ personaTenant: CHILD, memberships: [AGENCY, CHILD], activeTenantId: CHILD });
  assert(
    "24.4 the query still runs when the declared active workspace matches the resolved scope",
    matched.kbCall?.args?.p_tenant_id === CHILD,
    `expected ${CHILD}, got ${matched.kbCall?.args?.p_tenant_id}`,
  );
}

// ── 12 · Active-account TOCTOU is closed at every provider boundary ─────────────
group("active-account changes after retrieval fail closed before provider egress");
{
  for (const [label, nextState] of [
    ["switches to a different account", AGENCY],
    ["becomes unresolved", null],
    ["membership is revoked", { data: null, error: { message: "not authorized", code: "42501" } }],
  ]) {
    const r = await drive({
      personaTenant: CHILD,
      personaSequence: [CHILD, nextState],
      memberships: [AGENCY, CHILD],
      chunkContent: "CHILD-PRIVATE-MARKER",
      provider: ["text"],
    });
    assert(`12 ${label}: no provider request is made`, r.providerCalls.length === 0, `provider calls: ${r.providerCalls.length}`);
    assert(`12 ${label}: not even the turn classifier egresses`, r.classifierCalls.length === 0, `classifier calls: ${r.classifierCalls.length}`);
    assert(`12 ${label}: no stale telemetry is written`, !r.telemetry, JSON.stringify(r.telemetry?.row ?? null));
    assert(`12 ${label}: the turn fails closed`, r.status === 409, `status ${r.status}`);
  }
  // 12b · INT-334 R4 — the turn classifier is an AWAITED provider round-trip between the pre-egress check
  // (persona call 2) and the chat dispatch. A switch that lands DURING it is caught by the re-check after it
  // (persona call 3): the classifier — which carries only the message — ran, and the Knowledge-carrying chat
  // call never fires. Without that re-check this dispatches the prior account's Knowledge.
  {
    const r = await drive({
      personaTenant: CHILD,
      personaSequence: [CHILD, CHILD, AGENCY],
      memberships: [CHILD, AGENCY],
      chunkContent: "CHILD-PRIVATE-MARKER",
      provider: ["text"],
    });
    assert("12b a switch during the turn classifier: the classifier ran, the chat dispatch never fired",
      r.classifierCalls.length === 1 && r.providerCalls.length === 0,
      `classifier calls: ${r.classifierCalls.length}, provider calls: ${r.providerCalls.length}`);
    assert("12b-i the classifier payload carries no account Knowledge",
      !r.classifierCalls.some((b) => JSON.stringify(b).includes("CHILD-PRIVATE-MARKER")), JSON.stringify(r.classifierCalls).slice(0, 400));
    assert("12b-ii the turn fails closed with the active-account cancellation", r.status === 409, `status ${r.status}`);
  }
}

// Groups 13, 16, 17 and 18 time an account switch by counting `get_paige_persona_context`
// calls against a documented index table. Group 19's bound is derived from a control run, but an
// INTERIOR boundary cannot be derived the same way — you have to name the position you mean. So
// each of those groups instead asserts the TOTAL for its round shape, and that is what keeps the
// table honest: if a change adds, removes or moves a scope check, the total moves with it and
// these assertions fail by name, instead of the timings silently sliding one boundary along and
// testing something nobody chose. That silent slide has already happened twice on this branch,
// both times leaving mutations that had been caught the round before passing green again.
//
// If one of these fails, do NOT just bump the number. Re-derive the table for that shape, then
// fix every timing in the group that depends on it.
// INT-334 R4 — a fresh agentic turn (every group below drives one: no attachment, no approval, no
// answer binding) now runs the turn classifier, and re-checks the account after it. That inserts ONE
// boundary right after the pre-egress check — "post-classifier" — and every later index moves up by one.
// The tables below are re-derived for it, not bumped.
const personaCalls = (r) => r.rec.rpc.filter((c) => c.name === "get_paige_persona_context").length;
const assertShape = async (label, plan, expected) => {
  const control = await drive({
    personaTenant: CHILD, personaSequence: [CHILD], memberships: [CHILD],
    chunkContent: "CHILD-PRIVATE-MARKER", provider: plan,
  });
  assert(
    `SHAPE ${label}: the documented index table still holds (${expected} persona calls)`,
    personaCalls(control) === expected,
    `expected ${expected}, got ${personaCalls(control)} — the timings in this group now point at different boundaries; re-derive the table, do not just bump this number`,
  );
};

group("active-account changes during the agent loop stop later provider calls");
{
  await assertShape("grp13 tool+text", ["tool", "text"], 9);
  const r = await drive({
    personaTenant: CHILD,
    // initial resolution → initial provider boundary → post-classifier boundary → post-round
    // boundary → actual tool-dispatch boundary (where the switch occurs)
    personaSequence: [CHILD, CHILD, CHILD, CHILD, AGENCY],
    memberships: [AGENCY, CHILD],
    chunkContent: "CHILD-PRIVATE-MARKER",
    provider: ["tool", "text"],
  });
  assert("13.1 only the already-authorized first provider round runs", r.providerCalls.length === 1, `provider calls: ${r.providerCalls.length}`);
  assert("13.2 no stale telemetry is written after invalidation", !r.telemetry, JSON.stringify(r.telemetry?.row ?? null));
  // 13.3 previously asserted that no `plan_list` RPC was issued. That check could never fail:
  // in this harness `plan_list` returns an error result before it reaches its RPC even on a
  // fully valid turn, so `rec.rpc` never contains it under ANY scope and the assertion was
  // true by construction. The observable that actually distinguishes dispatched from refused
  // is the step trace — a dispatched tool is narrated as `0:tool-N`, a refused one is not.
  assert(
    "13.3 the tool proposed from stale Knowledge is never dispatched",
    !/"id":"0:tool-\d"/.test(r.responseText),
    r.responseText.slice(0, 300),
  );
  // An in-loop invalidation must reach the pre-emission gate as an ACCOUNT-CHANGE cancellation,
  // not as the generic could-not-finish fallback — the user is owed the real reason.
  //
  // WHAT THESE TWO DO NOT PROVE (§13). External review reported that the
  // `tenantKnowledgeScopeInvalidated ||` term on that gate is deletable with the suite green,
  // and inferred a behaviour change. The first half is true; the second is not reproducible.
  // Driving 21 shape/timing combinations (tool+text, tool+fail+text, tool+tool+text × switch at
  // persona calls 2..8), dropping that term produces byte-identical output. The reason is that
  // every site setting the flag does so immediately after the resolver returned false — which,
  // since the sticky fix, also latches `tenantKnowledgeScopeRevoked`, so the resolver alone
  // returns false from then on. The term is genuinely redundant now, as a CONSEQUENCE of that
  // fix. It is kept because it states intent at the gate and costs nothing, not because these
  // assertions pin it. They pin the message, which is a different and still-worth-having claim.
  assert(
    "13.5 an in-loop invalidation reaches the gate as an ACCOUNT-CHANGE cancellation",
    r.responseText.includes("active workspace changed"),
    r.responseText.slice(0, 300),
  );
  assert(
    "13.6 ...and not the generic could-not-finish fallback",
    !r.responseText.includes("couldn't finish"),
    r.responseText.slice(0, 300),
  );
  assert(
    "13.4 no later provider payload carries prior-account knowledge",
    !r.providerCalls.slice(1).some((body) => JSON.stringify(body).includes("CHILD-PRIVATE-MARKER")),
    JSON.stringify(r.providerCalls.slice(1)),
  );
}

// ── 14 · Document post-processing revalidates before provider and sync ──────────
group("document post-processing fails closed at provider and sync boundaries");
{
  async function driveDocumentPostProcess(scopeStates, { uploadId = null, plan = ["json-extraction"], throwOnSync = false, ownMemoryScope = undefined } = {}) {
    resetProvider(plan);
    syncThrows = throwOnSync;
    let scopeCall = 0;
    const writes = [];
    // §13 — WHERE THE THROW HAD TO MOVE, AND WHY. `throwOnSync` used to throw from the
    // `sync-credit-report-data` fetch, which was the one place that reached the helper's catch
    // block (the provider path can't: `gatewayCompat` catches its own transport errors and returns
    // a non-ok response, which the helper handles as an extraction failure instead). That fetch NO
    // LONGER HAPPENS — a chat document turn proposes rather than writes — so the old trigger fires
    // never, and 14b.7/14b.8 would have gone quietly green while measuring nothing.
    //
    // The catch block still exists and still has two writes that each need their own scope
    // assertion, so the trigger moves to the `client_memory` insert: the first awaited durable
    // write after extraction, and still upstream of both catch writes. Same catch, same two
    // assertions, a throw that actually happens.
    const service = {
      from(table) {
        return {
          insert(row) {
            if (throwOnSync && table === "client_memory") throw new Error("simulated durable-write failure");
            writes.push({ table, op: "insert", row });
            return Promise.resolve({ data: null, error: null });
          },
          update(row) {
            writes.push({ table, op: "update", row });
            return { eq: async () => ({ data: null, error: null }) };
          },
        };
      },
      rpc: null, // replaced below once writes/rpcs exist (hoisting workaround for the const)
    };
    service.rpc = (name, args) => {
      writes.push({ table: `rpc:${name}`, op: "call", args });
      return Promise.resolve({ data: "owner-memory-row-id", error: null });
    };
    const result = await chatModule.runStructuredExtractionAndSync(
      "CHILD-PRIVATE-MARKER",
      "AA==",
      USER,
      "Bearer test-jwt",
      "https://test.supabase.co",
      "service-role-key",
      service,
      null,
      uploadId,
      async () => scopeStates[Math.min(scopeCall++, scopeStates.length - 1)],
      undefined,
      ownMemoryScope,
    );
    syncThrows = false;
    return { result, writes, providerCalls: [...providerCalls], syncCalls: [...syncCalls] };
  }

  // An upload id is now REQUIRED for the happy path, because a proposal is referenced by the
  // upload row it belongs to — approval carries that id, never the values. A run with no upload
  // row therefore has nothing to approve, and 14.0 below pins that it says so rather than
  // silently succeeding.
  const valid = await driveDocumentPostProcess([true], { uploadId: "upload-1" });
  const noRecord = await driveDocumentPostProcess([true], { uploadId: null });
  assert(
    "14.0 with no upload record there is nothing to approve, and it SAYS so instead of half-succeeding",
    noRecord.result?.success === false && noRecord.result?.step === "no_upload_record" && noRecord.syncCalls.length === 0,
    JSON.stringify(noRecord.result),
  );
  assert("14.1 valid current scope reaches the extraction provider", valid.providerCalls.length === 1, `provider calls: ${valid.providerCalls.length}`);
  // INT-326 write rule (review P2): the report_upload row about the CALLER takes the turn's
  // captured declared∧validated scope. null = no established workspace ⇒ NO memory write at all
  // (the document's own upload record still proceeds); a string is stamped verbatim.
  const noScopeRun = await driveDocumentPostProcess([true], { uploadId: "upload-1", ownMemoryScope: null });
  assert("14.1b a no-scope turn still stamps the document's own upload record and returns success",
    noScopeRun.result?.success === true && noScopeRun.writes.some((w) => w.table === "credit_report_uploads"),
    JSON.stringify({ result: noScopeRun.result, uploadWrites: noScopeRun.writes.filter((w) => w.table === "credit_report_uploads").length }));
  assert("14.1c …and the skip is real: zero client_memory inserts in its write log",
    !noScopeRun.writes.some((w) => w.table === "client_memory"),
    JSON.stringify(noScopeRun.writes.filter((w) => w.table === "client_memory")));
  const scopedRun = await driveDocumentPostProcess([true], { uploadId: "upload-1", ownMemoryScope: CHILD });
  assert("14.1d a captured scope is stamped verbatim on the owner-memory report_upload write (S5: governed seam)",
    scopedRun.writes.some((w) => w.table === "rpc:record_paige_memory" && w.args?.p_memory_type === "report_upload"
      && w.args?.p_tenant_id === CHILD && w.args?.p_confirmation_state === "proposed"),
    JSON.stringify(scopedRun.writes.filter((w) => w.table === "rpc:record_paige_memory").map((w) => w.args)));
  // §13 — THIS ASSERTION WAS INVERTED, DELIBERATELY, AND THAT IS THE POINT OF THE SLICE.
  // It used to read "14.2 valid current scope reaches sync — syncCalls.length === 1", because a
  // credit report dropped into chat called `sync-credit-report-data` with the service-role key and
  // wrote EIGHT tables (three `profiles` FICO columns, `credit_negative_items`, `credit_accounts`,
  // `credit_inquiries`, `credit_factor_scores`, `funding_readiness_scores`, plus two more
  // `profiles` columns) with no person asked. The owner's rule is "never auto-write extracted
  // fields", so the correct number of sync calls from this path is ZERO, always — including on the
  // fully-authorized happy path, which is the ONE case the old assertion covered.
  //
  // Not deleted, inverted: a deleted assertion proves nothing, while an inverted one fails loudly
  // the moment anyone restores the write. Paired with 14.2b so "zero syncs" cannot be satisfied by
  // a path that also did nothing else.
  assert("14.2 an authorized document turn makes ZERO sync calls — it proposes, it does not write", valid.syncCalls.length === 0, `sync calls: ${valid.syncCalls.length}`);
  assert(
    "14.2b ...and it really did produce a proposal to approve, so 'zero syncs' is not just 'nothing happened'",
    valid.result?.awaiting_review === true && (valid.result?.proposal?.fields?.length ?? 0) > 0,
    JSON.stringify(valid.result),
  );

  for (const [label, states] of [
    ["switch before extraction", [false]],
    ["unresolved before extraction", [false]],
    ["revoked while extraction is in flight", [true, false]],
    ["switch before sync", [true, true, false]],
  ]) {
    const r = await driveDocumentPostProcess(states);
    const providerExpected = states[0] ? 1 : 0;
    assert(`14 ${label}: no unauthorized extraction provider call`, r.providerCalls.length === providerExpected, `provider calls: ${r.providerCalls.length}`);
    assert(`14 ${label}: no sync call`, r.syncCalls.length === 0, `sync calls: ${r.syncCalls.length}`);
    assert(`14 ${label}: no post-processing write`, r.writes.length === 0, JSON.stringify(r.writes));
    assert(`14 ${label}: reports active-account cancellation`, r.result?.step === "active_account_changed", JSON.stringify(r.result));
  }

  // ── 14b · EVERY durable write inside the helper re-asserts scope, not once per stage ──
  //
  // The stage checks above authorise a whole stage, and a stage is not instantaneous: two
  // awaited provider round-trips and a service-role sync happen between them. A single check
  // at the top of a stage authorises writes that begin seconds later, after the account has
  // changed. These writes are not counters — `logSyncFailure` persists the FULL extracted
  // credit report into `audit_logs`, and the post-sync stage writes `client_memory` and then
  // stamps the whole report into `credit_report_uploads.analysis_result`.
  const wrote = (r, table) => r.writes.some((w) => w.table === table);

  // (a) The validation-failure log. Scope holds through extraction, then goes while the response
  //     body drains — the failure path would otherwise persist `structured` under the old scope.
  const failPlan = ["json-extraction-invalid"];
  const validFail = await driveDocumentPostProcess([true], { plan: failPlan });
  assert(
    "14b.1 CONTROL — a validation failure under valid scope DOES write its audit log",
    wrote(validFail, "audit_logs"),
    JSON.stringify(validFail.writes.map((w) => w.table)),
  );
  const staleFail = await driveDocumentPostProcess([true, true, false], { plan: failPlan });
  assert(
    "14b.2 a validation failure after a switch writes NO audit log",
    !wrote(staleFail, "audit_logs"),
    JSON.stringify(staleFail.writes),
  );
  assert(
    "14b.3 ...and reports the cancellation, not the validation error",
    staleFail.result?.step === "active_account_changed",
    JSON.stringify(staleFail.result),
  );

  // (b) The two post-sync writes. Scope holds through the memory insert and goes while it is in
  //     flight, so the uploads stamp must be refused on its OWN assertion rather than riding on
  //     the one the insert passed.
  const validPost = await driveDocumentPostProcess([true], { uploadId: "upload-1" });
  assert(
    "14b.4 CONTROL — valid scope writes BOTH post-sync rows",
    wrote(validPost, "client_memory") && wrote(validPost, "credit_report_uploads"),
    JSON.stringify(validPost.writes.map((w) => w.table)),
  );
  // Re-derived by driving n=1..8, not adjusted by guesswork: removing the pre-sync scope check
  // (the sync no longer happens) moved every index below it by one. n=4 is the boundary where the
  // memory insert has landed and the upload stamp has not — n=3 refuses both, n=5 writes both.
  const stalePost = await driveDocumentPostProcess([true, true, true, true, false], { uploadId: "upload-1" });
  assert(
    "14b.5 the memory row is written but the report stamp is refused on its own check",
    wrote(stalePost, "client_memory") && !wrote(stalePost, "credit_report_uploads"),
    JSON.stringify(stalePost.writes.map((w) => w.table)),
  );
  assert(
    "14b.6 ...and reports the cancellation",
    stalePost.result?.step === "active_account_changed",
    JSON.stringify(stalePost.result),
  );

  // (c) The CATCH block. Its two writes are off the success path, so nothing above reaches them.
  //     Scope-call order once a provider call throws: pre-extraction, the catch's own
  //     revalidation, the failure log, the failed-upload stamp.
  const throwOpts = { uploadId: "upload-1", throwOnSync: true };
  const validThrow = await driveDocumentPostProcess([true], throwOpts);
  assert(
    "14b.7 CONTROL — a pipeline exception under valid scope writes BOTH its rows",
    wrote(validThrow, "audit_logs") && wrote(validThrow, "credit_report_uploads"),
    JSON.stringify(validThrow.writes.map((w) => w.table)),
  );
  // Scope-call order once the memory insert throws: pre-extraction, post-extraction, the two
  // remaining pre-write checks, the catch's own revalidation, the failure log, the failed-upload
  // stamp. Re-derived by driving n=1..8 — n=6 is where `audit_logs` has landed and the upload
  // stamp has not. Derived, not assumed; the control above exists because assuming was wrong the
  // first time, and the trigger moving off the deleted sync fetch is exactly the kind of change
  // that would have slid this boundary silently.
  const catchCalls = 7;
  const staleStamp = await driveDocumentPostProcess(Array(catchCalls - 1).fill(true).concat([false]), throwOpts);
  assert(
    "14b.8 a switch between the two catch writes logs the failure but refuses the upload stamp",
    wrote(staleStamp, "audit_logs") && !wrote(staleStamp, "credit_report_uploads"),
    JSON.stringify(staleStamp.writes.map((w) => w.table)),
  );
  const staleLog = await driveDocumentPostProcess(Array(catchCalls - 2).fill(true).concat([false]), throwOpts);
  assert(
    "14b.9 a switch before the catch's failure log writes neither row",
    !wrote(staleLog, "audit_logs") && !wrote(staleLog, "credit_report_uploads"),
    JSON.stringify(staleLog.writes.map((w) => w.table)),
  );
}

group("attached-document turns DO carry tenant Knowledge, and its guard actually fires");
{
  // WHAT THIS GROUP USED TO ASSERT, AND WHY IT WAS WRONG. It previously asserted that a
  // document turn does NOT query tenant Knowledge — i.e. it encoded the `&& !attachedDocument`
  // exclusion as the intended behaviour and passed green. Two defects were being certified:
  //   (a) §58 — `main` grounds document turns in Knowledge; excluding them silently removed a
  //       shipped capability, and a passing check made that invisible.
  //   (b) The exclusion left `tenantKbScopeTenantId` null on precisely the path the document
  //       revalidation points protect, so every one of them returned `true` without asking the
  //       resolver. Group 14 kept passing because it drives the callback DIRECTLY with an
  //       injected stub; it can never observe that the real path passes an inert one.
  // So this group is now the integration proof group 14 cannot be: it drives the real handler
  // with a real attached document and asserts both that Knowledge flows and that a switched
  // account stops it.
  const document = {
    fileName: "operating-notes.docx",
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    kind: "docx",
    textContent: "PRIVATE-DOCTEXT-MARKER internal operating notes",
  };

  const valid = await drive({
    personaTenant: CHILD,
    personaSequence: [CHILD],
    memberships: [CHILD],
    chunkContent: "PRIVATE-KB-SOURCE-MARKER",
    bodyExtras: { document },
    // General-field extraction is best-effort and consumes the first test response;
    // the second is the real streamed chat response under test.
    provider: ["private-text", "private-text"],
  });
  assert("15.1 a document turn DOES query tenant Knowledge (§58 capability retained)", !!valid.kbCall, `rpcs seen: ${valid.rec.rpc.map((x) => x.name).join(", ") || "(none)"}`);
  assert("15.2 it queries the ACTIVE tenant", valid.kbCall?.args?.p_tenant_id === CHILD, `expected ${CHILD}, got ${valid.kbCall?.args?.p_tenant_id}`);
  assert(
    "15.3 the retrieved chunk reaches the document provider payload",
    valid.providerCalls.some((body) => JSON.stringify(body).includes("PRIVATE-KB-SOURCE-MARKER")),
    JSON.stringify(valid.providerCalls).slice(0, 400),
  );
  assert("15.4 telemetry is written for a scope that held", !!valid.telemetry, JSON.stringify(valid.telemetry?.row ?? null));
  assert("15.5 the existing document response path remains usable", valid.responseText.includes("CHILD-PRIVATE-MARKER"), valid.responseText);
  // #1255 — the general-document extraction was DEFERRED past the pre-egress active-account guard
  // so a switched DOCX/image turn (15.9) makes zero provider calls (a general-PDF turn still makes
  // its one accepted pre-resolution read-check — see 15.9e). This pins the other half of that change:
  // on a valid, unswitched turn the deferral must still run the extraction exactly ONCE and leave
  // the streamed reply intact — two provider calls, no more (a re-added eager call would make it
  // three), no fewer (a dropped deferral would make it one and silently lose the extraction).
  assert(
    "15.5b a valid document turn still makes exactly two provider calls — the deferred extraction and the reply, neither dropped nor duplicated",
    valid.providerCalls.length === 2,
    `provider calls: ${valid.providerCalls.length}`,
  );

  // THE LOAD-BEARING HALF. The account changes after retrieval. The document path must refuse
  // before its reply crosses the boundary, must write no telemetry, and must say so. If the
  // retrieval gate is ever narrowed to exclude documents again, `tenantKbScopeTenantId` goes
  // null, `holdDirectFramesForKnowledgeScope` goes false, the refusal never fires, and these
  // three fail — which is exactly the regression that shipped green last time.
  const switched = await drive({
    personaTenant: CHILD,
    personaSequence: [CHILD, AGENCY],
    memberships: [CHILD, AGENCY],
    chunkContent: "PRIVATE-KB-SOURCE-MARKER",
    bodyExtras: { document },
    provider: ["private-text", "private-text"],
  });
  assert(
    "15.6 a switched document turn withholds the reply",
    !switched.responseText.includes("CHILD-PRIVATE-MARKER"),
    switched.responseText.slice(0, 400),
  );
  assert(
    "15.7 a switched document turn reports the cancellation",
    switched.responseText.includes("ACTIVE_ACCOUNT_CHANGED"),
    switched.responseText.slice(0, 400),
  );
  assert(
    "15.8 a switched document turn writes no tenant Knowledge telemetry",
    !switched.telemetry,
    JSON.stringify(switched.telemetry?.row ?? null),
  );
  assert(
    "15.9 a switched DOCX document turn makes no provider call at all (the `document` fixture is DOCX; general-PDF has its own read-check contract — 15.9e)",
    switched.providerCalls.length === 0,
    `provider calls: ${switched.providerCalls.length}`,
  );

  // #1255 — the KB-MISS escape route, pinned to the exact path the fix depends on. 15.9 uses a KB
  // HIT; the historical regression the comment above warns about is a document turn whose Knowledge
  // lookup MISSED — which once had "nothing to compare against" and slipped the guard. A document
  // turn is protected by `!!attachedDocument` regardless of whether the KB matched, so a switched
  // KB-miss document turn must ALSO make zero provider calls. This nails the fix to that path: a
  // future narrowing of the protected-turn set (dropping the unconditional attachedDocument source)
  // fails HERE instead of silently reopening #1255 on the KB-miss path while 15.9 stays green.
  const switchedKbMiss = await drive({
    personaTenant: CHILD,
    personaSequence: [CHILD, AGENCY],
    memberships: [CHILD, AGENCY],
    bodyExtras: { document },
    provider: ["private-text", "private-text"],
    rpcExtras: { match_tenant_knowledge: () => ({ data: [], error: null }) },
  });
  assert(
    "15.9c a switched document turn whose Knowledge lookup MISSED still makes no provider call",
    switchedKbMiss.providerCalls.length === 0,
    `provider calls: ${switchedKbMiss.providerCalls.length}`,
  );

  // #1255 (coordinator disposition of the Codex PDF P1) — the SWITCHED GENERAL-PDF contract.
  // A general PDF (unlike DOCX/image) runs a pre-resolution `runDocumentReadCheck` BEFORE the active
  // account is resolved. That one provider call is ACCEPTED and intentional: it carries only the
  // caller's OWN uploaded PDF bytes + the fixed read-check prompt — never tenant Knowledge or a
  // prior workspace's messages — and books `document-read-check:PLATFORM`. So the honest contract
  // for a switched general-PDF turn is EXACTLY ONE provider call (that read-check), with the deferred
  // general-document extraction AND the Knowledge-carrying chat dispatch both prevented by the
  // pre-egress guard, and the turn failing closed. This is the precise per-document-type statement
  // that "a switched document turn makes zero provider calls" (15.9, DOCX-only) must NOT be read to
  // claim for PDFs. `document_kind:"other"` routes the read-check to the general path; the trailing
  // provider entries would only answer a (buggy) extraction/chat call, so the count/trace assertions
  // — not a missing-response crash — are what catch a regression.
  const generalPdfBytes = Buffer.from("PRIVATE-PDFBYTES-MARKER").toString("base64");
  const switchedGeneralPdf = await drive({
    personaTenant: CHILD,
    personaSequence: [CHILD, AGENCY],
    memberships: [CHILD, AGENCY],
    chunkContent: "PRIVATE-KB-SOURCE-MARKER",
    bodyExtras: { document: { fileName: "operating-notes.pdf", mimeType: "application/pdf", kind: "pdf", base64: generalPdfBytes } },
    provider: ["read-check-general", "private-text", "private-text"],
  });
  assert(
    "15.9e a switched general-PDF turn makes EXACTLY ONE provider call — the pre-resolution read-check",
    switchedGeneralPdf.providerCalls.length === 1,
    `provider calls: ${switchedGeneralPdf.providerCalls.length}`,
  );
  assert(
    "15.9e-i that sole call IS the PDF read-check — it carries the caller's uploaded PDF bytes + the read-check prompt only",
    switchedGeneralPdf.providerCalls.length === 1
      && JSON.stringify(switchedGeneralPdf.providerCalls[0]).includes(generalPdfBytes)
      && JSON.stringify(switchedGeneralPdf.providerCalls[0]).includes("application/pdf"),
    JSON.stringify(switchedGeneralPdf.providerCalls).slice(0, 400),
  );
  assert(
    "15.9e-ii the read-check payload carries NO tenant Knowledge — no cross-context egress",
    !switchedGeneralPdf.providerCalls.some((body) => JSON.stringify(body).includes("PRIVATE-KB-SOURCE-MARKER")),
    JSON.stringify(switchedGeneralPdf.providerCalls).slice(0, 400),
  );
  const switchedGeneralPdfTraceRows = switchedGeneralPdf.rec.inserts
    .filter((i) => i.table === "paige_llm_trace")
    .map((i) => `${i.row?.job_kind ?? "?"}:${i.row?.tenant_id ? "tenant" : "PLATFORM"}`)
    .sort();
  assert(
    "15.9e-iii the ONLY trace row is document-read-check:PLATFORM — no general-document-extraction call, no chat dispatch fired on the switched turn",
    JSON.stringify(switchedGeneralPdfTraceRows) === JSON.stringify(["document-read-check:PLATFORM"]),
    JSON.stringify(switchedGeneralPdfTraceRows),
  );
  assert(
    "15.9e-iv the switched general-PDF turn fails closed with the active-account cancellation",
    switchedGeneralPdf.responseText.includes("ACTIVE_ACCOUNT_CHANGED"),
    switchedGeneralPdf.responseText.slice(0, 400),
  );

  // #1255 P1 (Codex, head a84bfcd6) — the DEFERRED general-document extraction is an AWAITED
  // provider round-trip inserted between the pre-egress active-account guard and the chat dispatch.
  // A switch that lands DURING that await must still fail closed BEFORE the chat provider call —
  // not merely have its streamed reply withheld at the close boundary, by which point the prior
  // workspace's aiMessages + Knowledge have already egressed to the model. This models exactly that
  // timing: the pre-egress guard passes on CHILD (call 2), the extraction runs (one benign provider
  // call carrying only the caller's OWN document, no Knowledge), THEN the account switches and the
  // post-extraction re-check (call 3) catches it — so the Knowledge-carrying chat dispatch never
  // fires. Before that re-check existed this made TWO provider calls (extraction + the stale chat
  // dispatch) and leaked the KB chunk into the second one; this pins it to a single benign call.
  const switchDuringExtraction = await drive({
    personaTenant: CHILD,
    personaSequence: [CHILD, CHILD, AGENCY],
    memberships: [CHILD, AGENCY],
    chunkContent: "PRIVATE-KB-SOURCE-MARKER",
    bodyExtras: { document },
    provider: ["private-text", "private-text"],
  });
  assert(
    "15.9d a switch DURING the deferred extraction fails closed before the chat dispatch — only the benign extraction ran, the Knowledge-carrying reply call never fired",
    switchDuringExtraction.providerCalls.length === 1,
    `provider calls: ${switchDuringExtraction.providerCalls.length}`,
  );
  assert(
    "15.9d-i and NO tenant Knowledge egressed on that switched turn — the KB chunk reached no provider payload",
    !switchDuringExtraction.providerCalls.some((body) => JSON.stringify(body).includes("PRIVATE-KB-SOURCE-MARKER")),
    JSON.stringify(switchDuringExtraction.providerCalls).slice(0, 400),
  );
  assert(
    "15.9d-ii the switch-during-extraction turn fails closed with the active-account cancellation",
    switchDuringExtraction.responseText.includes("ACTIVE_ACCOUNT_CHANGED"),
    switchDuringExtraction.responseText.slice(0, 400),
  );

  // A switch that lands AFTER the pre-egress refusal AND the post-extraction re-check (#1255 P1)
  // have both already passed — i.e. during the chat-dispatch round-trip itself, the irreducible
  // race that cannot be un-sent. This exercises the document stream's OWN close-boundary check
  // rather than either 409 above — the point at which the provider reply exists and
  // `holdDirectFramesForKnowledgeScope` is holding it back. The sequence carries one extra CHILD
  // vs. 15.9d so the AGENCY switch lands at the close boundary (call 4), not the re-check (call 3).
  const lateSwitch = await drive({
    personaTenant: CHILD,
    personaSequence: [CHILD, CHILD, CHILD, AGENCY],
    memberships: [CHILD, AGENCY],
    chunkContent: "PRIVATE-KB-SOURCE-MARKER",
    bodyExtras: { document },
    provider: ["private-text", "private-text"],
  });
  assert(
    "15.10a the late-switch case really reached the provider (else it is just the 409 again)",
    lateSwitch.providerCalls.length > 0,
    `provider calls: ${lateSwitch.providerCalls.length}`,
  );
  assert(
    "15.10 a late switch still withholds the held document reply",
    !lateSwitch.responseText.includes("CHILD-PRIVATE-MARKER"),
    lateSwitch.responseText.slice(0, 400),
  );
  assert(
    "15.11 a late switch streams the active-account cancellation",
    lateSwitch.responseText.includes("active workspace changed"),
    lateSwitch.responseText.slice(0, 400),
  );
  assert(
    "15.12 a late switch writes no tenant Knowledge telemetry",
    !lateSwitch.telemetry,
    JSON.stringify(lateSwitch.telemetry?.row ?? null),
  );
}


// ── 16 · The dispatch guard is asserted PER TOOL, not once per batch ──────────────
group("tool dispatch re-asserts scope for every tool, not once per round");
{
  await assertShape("grp16 two-tools", ["two-tools", "private-text"], 10);
  // WHY THIS GROUP EXISTS. Reverting the dispatch check from per-tool back to per-batch
  // was undetectable by every other check in this file: a round with ONE tool behaves
  // identically either way, and every earlier group uses a one-tool round. A batch is not
  // instantaneous — one round can propose several tools and an early one can take seconds —
  // so a batch-level check authorises the whole list on the scope that held when the FIRST
  // tool ran. This group is the only thing standing between that and a green merge.
  //
  // HOW THE SWITCH IS TIMED. `personaSequence` is consumed one entry per
  // `get_paige_persona_context` call, clamped at the last entry, so `n` CHILDs followed by
  // AGENCY switches the account at call index `n`. The calls, in order, are:
  //   0 turn start (personaCtx)   1 pre-egress revalidation   2 post-classifier revalidation
  //   3 post-round revalidation   4 tool-1 dispatch           5 tool-2 dispatch   6 pre-continuation
  // so n=4 lands the switch on the FIRST tool's check and n=5 on the SECOND's.
  //
  // THE DISCRIMINATOR is the step trace. Since C2b each tool's step is sent the moment that tool
  // finishes (docs/delivery/paige-conversational-loop-c2.md), so a tool that RAN shows its step even
  // when a later tool in the same round is refused — it did run. A mid-batch abort therefore shows
  // exactly the steps of the tools before the switch, and none after it. With a batch-level check at
  // n=4 there is no second check to fail: both tools run and BOTH steps are shown.
  // Step ids are `<pass>:<round>:<index>:<call id>`; the call ids here are tool-1 / tool-2.
  const stepIds = (text) => [...new Set((text.match(/"id":"0:0:\d+:tool-\d"/g) || []).map((m) => m.slice(6, -1).split(":")[3]))];
  const runTools = (n) => drive({
    personaTenant: CHILD,
    personaSequence: n === null ? [CHILD] : Array(n).fill(CHILD).concat([AGENCY]),
    memberships: n === null ? [CHILD] : [CHILD, AGENCY],
    chunkContent: "PRIVATE-KB-SOURCE-MARKER",
    provider: ["two-tools", "private-text"],
  });

  // HONEST NOTE (§13): of the six assertions here, only 16.4 discriminates per-tool from
  // per-batch — reverting the guard fails 16.4 alone (94/1). The others are controls and
  // adjacent-boundary coverage. Do not delete 16.4 believing its neighbours cover it; they
  // do not, and the suite will go green on the regression.
  const stable = await runTools(null);
  assert(
    "16.1 a stable scope dispatches BOTH tools of a two-tool round",
    stepIds(stable.responseText).length === 2,
    JSON.stringify(stepIds(stable.responseText)),
  );

  // THE BOUNDARY IS FOUND, NOT WRITTEN DOWN. External review made the sharper version of the
  // point the shape assertions only half-cover: those catch a check being ADDED or REMOVED (the
  // total moves), but not one being MOVED (total unchanged, every index shifts by one). If that
  // happened, `runTools(5)` would land BEFORE the first tool instead of between the two, and
  // 16.4-16.6 would still see zero narrated tools, one provider call and no telemetry — passing
  // for the wrong reason with the per-tool guard gone.
  //
  // No tool in this harness leaves a recordable side effect (`plan_list` and `list_event_kinds`
  // both return an error result before reaching their RPC). Before C2b a mid-batch abort also
  // suppressed the step trace, so "tool 1 ran" was not observable at all; it now is (16.4). What is
  // observable either way is the TRANSITION:
  // the smallest n at which the round completes. A per-tool guard puts four refusal boundaries
  // before completion (post-classifier, post-round, tool-1, tool-2); a per-batch guard puts three. So the transition
  // point itself distinguishes them, and it is derived rather than assumed.
  let firstComplete = null;
  for (let n = 2; n <= 10; n++) {
    if (stepIds((await runTools(n)).responseText).length === 2) { firstComplete = n; break; }
  }
  // WHAT 16.0 DOES NOT PROVE, stated precisely (§13). It measures how many refusal boundaries
  // precede completion, not that each check runs BEFORE its tool. A check moved from the top of
  // the loop body to the bottom — after the handler has already run — would still leave three
  // boundaries, and this group alone would not notice.
  //
  // That mutation IS caught, but by the rest of the suite rather than by this group: applied at
  // this head it fails 10 assertions, including grp18b's shape total (the per-executed-tool check
  // changes the call count) and 18.1/18.2/18.4. Verified by running it, not assumed. Tool
  // dispatch itself remains unobservable here — no tool in the catalogue leaves a recordable side
  // effect on this path — so a direct ordering assertion is not available, and this note is the
  // honest statement of the gap rather than a claim that one exists.
  assert(
    "16.0 the round first completes at the boundary a PER-TOOL guard implies",
    firstComplete === 6,
    `first complete at n=${firstComplete}; 6 means four refusal boundaries precede completion (post-classifier, post-round, tool-1, tool-2). 5 means only three — the per-tool guard is gone. Any other value means a boundary moved: re-derive this group's timings, do not bump the number.`,
  );

  const beforeFirst = await runTools(firstComplete - 2);
  assert(
    "16.2 a switch before the first tool dispatches neither",
    stepIds(beforeFirst.responseText).length === 0,
    JSON.stringify(stepIds(beforeFirst.responseText)),
  );
  assert(
    "16.3 a switch before the first tool makes no continuation provider call",
    beforeFirst.providerCalls.length === 1,
    `provider calls: ${beforeFirst.providerCalls.length}`,
  );

  const betweenTools = await runTools(firstComplete - 1);
  assert(
    "16.4 a switch BETWEEN the two tools stops the second (per-tool guard, not per-batch): only the first, which ran, shows its step",
    JSON.stringify(stepIds(betweenTools.responseText)) === JSON.stringify(["tool-1"]),
    `shown steps: ${JSON.stringify(stepIds(betweenTools.responseText))} — a batch-level check shows both, the old round-end emission none`,
  );
  assert(
    "16.5 a switch between the two tools makes no continuation provider call",
    betweenTools.providerCalls.length === 1,
    `provider calls: ${betweenTools.providerCalls.length}`,
  );
  assert(
    "16.6 a switch between the two tools writes no tenant Knowledge telemetry",
    !betweenTools.telemetry,
    JSON.stringify(betweenTools.telemetry?.row ?? null),
  );
}


// ── 17 · The durable record is written at the LAST boundary, not the first ────────
group("Knowledge telemetry commits only after the reply has actually crossed");
{
  await assertShape("grp17 tool-less round", ["private-text"], 6);
  // Telemetry is the one DURABLE row this mechanism writes, so it is committed after the
  // reply has been forwarded and the scope re-asserted a final time — not before the frames,
  // where a later cancellation would leave a permanent record claiming a retrieval grounded
  // a reply that never legitimately landed. Moving the commit back above the reply is
  // otherwise invisible: every earlier group either cancels before the reply (so no telemetry
  // either way) or holds scope throughout (so telemetry either way).
  //
  // Call indices on a tool-less agentic round: 0 turn start, 1 pre-egress, 2 post-classifier,
  // 3 post-round, 4 pre-emission, 5 post-drain. n=5 therefore switches the account at the post-drain
  // boundary ALONE — the reply is already out, and only the durable write is left to refuse.
  const atPostDrain = await drive({
    personaTenant: CHILD,
    personaSequence: [CHILD, CHILD, CHILD, CHILD, CHILD, AGENCY],
    memberships: [CHILD, AGENCY],
    chunkContent: "PRIVATE-KB-SOURCE-MARKER",
    provider: ["private-text"],
  });
  // INVERTED BY THE SAFETY-FIRST STREAMING RULING (owner, 2026-08-31), and kept rather than
  // deleted because the inversion is the point. 17.1 used to assert that the reply had ALREADY
  // crossed by this boundary — that was true, and it was the residual the ruling closes. On a
  // protected turn the reply is now held until this same check passes, so the reply and the
  // telemetry row share ONE decision: at a lapse here, neither survives.
  assert(
    "17.1 a lapse at the final boundary withholds the REPLY as well (was: reply already crossed)",
    !atPostDrain.responseText.includes("CHILD-PRIVATE-MARKER"),
    atPostDrain.responseText.slice(0, 300),
  );
  assert(
    "17.2 ...and no telemetry row is written, on the same decision",
    !atPostDrain.telemetry,
    JSON.stringify(atPostDrain.telemetry?.row ?? null),
  );
  assert(
    "17.2b ...and the user gets the safe refusal instead of a truncated answer",
    /workspace changed/.test(atPostDrain.responseText),
    atPostDrain.responseText.slice(0, 300),
  );

  // The positive half: an unbroken scope must still record its retrieval, or 17.2 could be
  // satisfied by telemetry that simply never writes.
  const held = await drive({
    personaTenant: CHILD,
    personaSequence: [CHILD],
    memberships: [CHILD, AGENCY],
    chunkContent: "PRIVATE-KB-SOURCE-MARKER",
    provider: ["private-text"],
  });
  assert("17.3 an unbroken scope does write its telemetry row", !!held.telemetry, JSON.stringify(held.telemetry ?? null));
  assert("17.4 that row carries the ACTIVE tenant", held.telemetry?.row?.tenant_id === CHILD, JSON.stringify(held.telemetry?.row ?? null));

  // The boundary one call EARLIER is the pre-emission gate: the round is finished and the
  // reply is assembled, but nothing has been written to the wire yet. That one must withhold
  // the reply itself, not merely the telemetry — asserted separately so removing it fails for
  // its own reason rather than as a side effect of shifting later call indices.
  const atPreEmission = await drive({
    personaTenant: CHILD,
    personaSequence: [CHILD, CHILD, CHILD, CHILD, AGENCY],
    memberships: [CHILD, AGENCY],
    chunkContent: "PRIVATE-KB-SOURCE-MARKER",
    provider: ["private-text"],
  });
  assert(
    "17.5 a lapse at the pre-emission boundary withholds the reply itself",
    !atPreEmission.responseText.includes("CHILD-PRIVATE-MARKER"),
    atPreEmission.responseText.slice(0, 300),
  );
  assert(
    "17.6 a lapse at the pre-emission boundary streams the cancellation instead",
    atPreEmission.responseText.includes("active workspace changed"),
    atPreEmission.responseText.slice(0, 300),
  );
}


// ── 18 · Each loop-continuation boundary is individually load-bearing ─────────────
group("every provider re-entry in the agent loop re-asserts scope on its own");
{
  await assertShape("grp18a tool+text", ["tool", "text"], 9);
  await assertShape("grp18b tool+fail+text", ["tool", "fail", "text"], 9);
  // The loop re-asserts scope at three distinct points and, until this group existed, TWO of
  // them could be deleted with the suite still fully green — the surviving checks happened to
  // catch the switch at a neighbouring boundary instead. A guard that no check can distinguish
  // from its neighbour is a guard nobody will notice losing. Each assertion below pins ONE
  // boundary by timing the switch to land exactly on it (indices, single-tool round:
  //   0 turn start · 1 pre-egress · 2 post-classifier · 3 post-round · 4 tool dispatch
  //   · 5 pre-continuation · 6 pre-closing-call · 7 pre-emission · 8 post-drain)
  // and by counting provider calls, which is the only signal that separates "the next call was
  // never made" from "it was made and its result was later suppressed".
  //
  // THE TABLE ABOVE IS ONLY VALID FOR THE FAILED-CONTINUATION SHAPE both assertions below
  // drive. When the continuation SUCCEEDS there is no closing call, and index 6 is the second
  // round's post-round check instead of the pre-closing-call one. No assertion here is wrong —
  // 18.3 proves the failed-continuation path was actually taken — but do not time a new switch
  // off this table without re-deriving it for the round shape you are driving. Groups 16 and 17
  // carry their own tables, which are correct for the shapes they drive.

  // (a) PRE-CONTINUATION — after a tool round is folded into `convo`, before the next model
  //     call. `convo` carries the Knowledge-grounded system prompt, so a continuation issued
  //     after a switch re-sends the prior account's private content to the provider.
  const atContinuation = await drive({
    personaTenant: CHILD,
    personaSequence: [CHILD, CHILD, CHILD, CHILD, CHILD, AGENCY],
    memberships: [CHILD, AGENCY],
    chunkContent: "CHILD-PRIVATE-MARKER",
    provider: ["tool", "text"],
  });
  assert(
    "18.1 a switch at the continuation boundary makes no second provider call",
    atContinuation.providerCalls.length === 1,
    `provider calls: ${atContinuation.providerCalls.length} — removing that check lets the continuation fire`,
  );
  assert(
    "18.2 no continuation payload carries the prior account's Knowledge",
    !atContinuation.providerCalls.slice(1).some((body) => JSON.stringify(body).includes("CHILD-PRIVATE-MARKER")),
    JSON.stringify(atContinuation.providerCalls.slice(1)).slice(0, 400),
  );

  // (b) PRE-CLOSING-CALL — the loop terminated early (here: the continuation round failed
  //     upstream) and the handler is about to issue a tools-less CLOSING call to produce a
  //     reply. That call carries `convo` too, so it needs its own assertion; it is reached on
  //     a different code path from (a) and cannot be covered by it.
  const atClosingCall = await drive({
    personaTenant: CHILD,
    personaSequence: [CHILD, CHILD, CHILD, CHILD, CHILD, CHILD, AGENCY],
    memberships: [CHILD, AGENCY],
    chunkContent: "CHILD-PRIVATE-MARKER",
    provider: ["tool", "fail", "text"],
  });
  assert(
    "18.3 the failed-continuation path really was reached (else 18.4 proves nothing)",
    atClosingCall.providerCalls.length >= 2,
    `provider calls: ${atClosingCall.providerCalls.length}`,
  );
  assert(
    "18.4 a switch at the closing-call boundary makes no closing provider call",
    atClosingCall.providerCalls.length === 2,
    `provider calls: ${atClosingCall.providerCalls.length} — removing that check lets the closing call fire`,
  );
  assert(
    "18.5 the closing path writes no stale telemetry",
    !atClosingCall.telemetry,
    JSON.stringify(atClosingCall.telemetry?.row ?? null),
  );
}


// ── 19 · A refusal is STICKY — the guard must not erase its own evidence ──────────
group("a document turn withholds its reply at every scope boundary, including a switch-back");
{
  // THE DEFECT THIS PINS (found by external review on 4f982d0e9, reproduced here before it was
  // fixed). `revalidateTenantKnowledgeScope` clears `tenantKbContext` and `tenantKbScopeTenantId`
  // when it refuses — which is precisely the condition its own early return reads as "no
  // Knowledge was retrieved, nothing to protect, proceed". So the first call after a switch
  // returned false and every call after that returned TRUE. The guard destroyed its own
  // evidence and then took the absence of evidence as permission.
  //
  // A credit-report document turn is where that becomes a leak rather than a curiosity, because
  // it is the one path that checks scope TWICE around a slow stage: once via the callback handed
  // to `runStructuredExtractionAndSync`, and again in the caller when the helper returns. A
  // switch during extraction refused the first and passed the second, so the buffered
  // prior-workspace reply held by `holdDirectFramesForKnowledgeScope` was flushed to the client.
  // The entire suite was green while this was true, which is the whole reason this group exists.
  const pdf = { fileName: "PRIVATE-PDFNAME-MARKER.pdf", mimeType: "application/pdf", kind: "pdf", base64: "AA==" };
  // Persistence is the OTHER durable effect at the close of a document turn, and it is invisible
  // to every assertion above — they read the stream and the telemetry table. A revision that
  // moved the telemetry commit behind the flush check and left `persistAssistantTurn` in FRONT
  // of it withheld the reply from the wire and still wrote it permanently into the thread, where
  // a reload renders it and the rolling summary folds it in. Withholding a reply from the wire
  // while saving it to the database is not a refusal, so `paige_chat_turn_append` is asserted
  // on directly. A `threadId` is required to reach that path at all.
  const THREAD = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
  //
  // Filtered to `p_role === "assistant"`: the same RPC also appends the USER's turn before the
  // model call, so a bare name match is true on every threaded turn and would assert nothing.
  const persisted = (r) => r.rec.rpc.some(
    (c) => c.name === "paige_chat_turn_append" && c.args?.p_role === "assistant",
  );
  // The THIRD durable effect at the close of a turn, and the one I got wrong by judgement. The
  // word "analytics" reads as scope-free counters; `lender_searched` actually stores a
  // `lender_name` lifted out of the reply text and feeds an operator dashboard, and
  // `legal_flag_shown` records that content was shown when it was withheld. They are
  // fire-and-forget inserts, so nothing retracts them once started. Asserted on the table
  // directly — a turn the user was told was stopped writes no rows.
  const analytics = (r) => r.rec.inserts.filter((i) => i.table === "analytics_events");
  const creditTurn = (personaSequence, memberships, extra = {}) => drive({
    personaTenant: CHILD,
    personaSequence,
    memberships,
    chunkContent: "PRIVATE-KB-SOURCE-MARKER",
    bodyExtras: { document: pdf, ...extra },
    // read-check routes to the credit-report branch · the chat reply · the extraction call.
    // The reply is `lender-text` rather than plain `private-text` so it TRIPS the response-derived
    // analytics extractors. With a reply that matches none of them, "no analytics row was
    // written" is true whatever the gate does, and the assertion below proves nothing — which is
    // exactly how the first version of it passed while the defect was still present.
    provider: ["read-check", "lender-text", "json-extraction"],
    // AN UPLOAD ROW, or this whole group silently tests a weaker turn than it was written for.
    // A credit report now ends in a proposal that is REFERENCED BY the upload row it belongs to,
    // so without one the pipeline stops early at "nothing for you to approve" — a real and correct
    // behaviour, and the wrong one for forty assertions about what a full document turn withholds
    // at each scope boundary. Caught by probing which close frame the control actually produced
    // rather than trusting that it still produced the right one; every check below was green while
    // exercising the degraded path.
    tableExtras: { credit_report_uploads: () => [{ id: "upload-1" }] },
    // INT-326: the caller is SEATED — the resolver validates the workspace the persona declared.
    // Without this the turn establishes no memory scope, the report_upload write skips (by
    // design), and the boundary this group's exact count pins would silently disappear again.
    rpcExtras: { current_user_tenant_id: { data: CHILD, error: null } },
  });

  // POSITIVE CONTROL FIRST. Without it, "the marker never appeared" and "the marker was
  // correctly withheld" are indistinguishable, and every assertion below would be satisfied by
  // a fixture that simply never produces a reply.
  const stable = await creditTurn([CHILD], [CHILD]);
  assert(
    "19.1 CONTROL — an unbroken credit-report turn does deliver its reply",
    stable.responseText.includes("CHILD-PRIVATE-MARKER"),
    stable.responseText.slice(0, 300),
  );
  assert("19.2 CONTROL — and it really did retrieve Knowledge", !!stable.kbCall, JSON.stringify(stable.kbCall ?? null));
  // §13 — INVERTED WITH THE SLICE, NOT DELETED. This used to assert `syncCalls.length === 1`,
  // because a credit report dropped into chat wrote eight tables without asking. The owner's rule
  // is "never auto-write extracted fields", so the right number is zero — and a deleted assertion
  // would let anyone restore the write in silence, which is exactly what this file exists to stop.
  assert("19.3 CONTROL — an authorized credit-report turn makes ZERO sync calls", stable.syncCalls.length === 0, `sync calls: ${stable.syncCalls.length}`);
  assert(
    "19.3b CONTROL — and it really did produce a PROPOSAL, so 'zero syncs' is not 'nothing happened'",
    /"extraction_proposal"/.test(stable.responseText),
    stable.responseText.split("\n").filter((l) => l.includes("sync_status") || l.includes("extraction_proposal")).join("").slice(0, 300),
  );

  // The persistence control has to be its own run: without a threadId the persist path is a
  // no-op, so asserting "nothing was persisted" on a switched turn would otherwise be true for
  // a reason that has nothing to do with scope.
  assert(
    "19.3b CONTROL — an unbroken turn DOES write its response-derived analytics",
    stable.rec.inserts.some((i) => i.table === "analytics_events"),
    JSON.stringify(stable.rec.inserts.map((i) => i.table)),
  );

  const stableThread = await creditTurn([CHILD], [CHILD], { threadId: THREAD });
  assert(
    "19.4 CONTROL — an unbroken credit-report turn DOES persist its reply",
    persisted(stableThread),
    JSON.stringify(stableThread.rec.rpc.map((c) => c.name)),
  );

  // Every switch timing from the document close-boundary through the extraction stages and out
  // to the caller's OWN post-sync recheck. Each of 2..6 leaked the prior workspace's reply
  // before the sticky flag; each must now withhold it.
  //
  // WHY 7 IS IN THIS LIST, and why leaving it out was a real hole. Timings 2..6 are all
  // absorbed by the sticky flag set INSIDE the sync helper, so none of them exercises the
  // outer `revalidateTenantKnowledgeScope()` that runs when the helper returns. With the loop
  // stopping at 6, that entire outer block could be deleted and the suite stayed at 113/0 —
  // while a switch landing at 7 leaked the reply AND wrote `kb_query_telemetry`. A boundary no
  // check can distinguish from its neighbours is one a future edit deletes as redundant.
  //
  // THE UPPER BOUND IS DERIVED, NOT WRITTEN DOWN, and that is the point. It was hardcoded twice
  // and rotted twice: a valid credit-report turn made nine persona calls, so the ninth — the
  // flush boundary's own resolver — sat outside a loop that stopped at 7; and when per-write
  // guards were later added inside the sync helper the count became ten, silently pushing the
  // last boundary outside a loop that had just been corrected to 8. Both times the suite stayed
  // green while a real boundary went unexercised. Counting the calls the control run actually
  // makes means adding or moving a guard re-aims these timings automatically instead of quietly
  // aiming them at nothing.
  //
  // Indices run 0..TOTAL-1, so TOTAL-1 is the last boundary there is; n >= TOTAL is not a switch
  // case at all, because the persona sequence runs out before the account ever changes.
  const TOTAL = stable.rec.rpc.filter((c) => c.name === "get_paige_persona_context").length;
  // §13 — WHY THIS IS AN EXACT EQUALITY AND NOT THE `>= 9` FLOOR IT USED TO BE. Deriving the
  // bound re-aims the timings automatically when a guard MOVES, which is what it is for. It does
  // NOT notice when a guard is DELETED: an independent reviewer replaced the document path's
  // close decision with `const scopeHeldAtClose = true`, TOTAL fell by one, the floor still
  // passed, the loop ran one fewer iteration, and the suite went from 337 checks to 332 —
  // 0 failed. A suite that gets SMALLER under a mutation is worse than one that goes red,
  // because the number at the bottom still looks like a pass.
  //
  // The agentic groups already had this pin (`assertShape`, "the documented index table still
  // holds") and it is what caught the agentic twin of this mutation. The document path did not.
  // Both halves are now stated: the derived bound keeps the timings aimed, the exact count
  // catches a boundary being removed. If this fails, do NOT just bump the number — find which
  // scope check was added or removed, and re-derive what the loop is now testing.
  // Re-derived twice, and the round trip is worth recording because it is what the pin is FOR.
  // Removing the `sync-credit-report-data` call removed the pre-sync scope check with it, and the
  // count dropped to 9. Then giving the control a real upload row — without which the whole group
  // was silently exercising the degraded "nothing to approve" path — restored the upload stamp's
  // own check, and the count came back to 10. Two boundaries moved in opposite directions and the
  // total happens to land where it started; a pin that only watched the total would have shown
  // green through both. It did not, because it failed at 9 and made the missing upload row
  // visible. NOT "bumped because the test failed": each change was found, named and driven.
  const DOC_TURN_PERSONA_CALLS = 10;
  assert(
    "19.0 the control run makes enough persona calls for these timings to mean anything",
    TOTAL >= 9,
    `total persona calls: ${TOTAL} — if this collapsed, the loop below is empty and proves nothing`,
  );
  assert(
    `19.0b SHAPE — a credit-report turn still makes exactly ${DOC_TURN_PERSONA_CALLS} persona calls`,
    TOTAL === DOC_TURN_PERSONA_CALLS,
    `expected ${DOC_TURN_PERSONA_CALLS}, got ${TOTAL} — a scope boundary on the document path was added or REMOVED; the loop below is now testing a different set of timings than the one that was reviewed`,
  );
  for (let n = 2; n <= TOTAL - 1; n++) {
    const r = await creditTurn(Array(n).fill(CHILD).concat([AGENCY]), [CHILD, AGENCY]);
    assert(
      `19 switch at persona call ${n}: the prior workspace's reply is never flushed`,
      !r.responseText.includes("CHILD-PRIVATE-MARKER"),
      r.responseText.slice(0, 300),
    );
    assert(
      `19 switch at persona call ${n}: the cancellation is reported instead`,
      /active workspace changed|ACTIVE_ACCOUNT_CHANGED/.test(r.responseText),
      r.responseText.slice(0, 300),
    );
    assert(
      `19 switch at persona call ${n}: no stale Knowledge telemetry`,
      !r.telemetry,
      JSON.stringify(r.telemetry?.row ?? null),
    );
    const rt = await creditTurn(Array(n).fill(CHILD).concat([AGENCY]), [CHILD, AGENCY], { threadId: THREAD });
    assert(
      `19 switch at persona call ${n}: the withheld reply is not persisted to the thread either`,
      !persisted(rt),
      JSON.stringify(rt.rec.rpc.map((c) => c.name)),
    );
    assert(
      `19 switch at persona call ${n}: no response-derived analytics row is written`,
      analytics(r).length === 0,
      JSON.stringify(analytics(r).map((i) => i.row?.event_name)),
    );
  }

  // §13 — 19.7 WAS ADDED HERE AND IS REMOVED AGAIN IN THE SAME BRANCH. It claimed to close the
  // gap this group's old name asserted ("once refused, every later revalidation stays refused")
  // by driving an account that switches AWAY and BACK. It closed nothing, and an independent
  // reviewer proved that by execution before it had been green for an hour.
  //
  // A TURN TERMINATES AT THE FIRST MISMATCH. So the fourth element of a persona sequence is never
  // consumed, and `[CHILD, CHILD, AGENCY, CHILD]` — the "switch-back" — is the same drive as
  // `[CHILD, CHILD, AGENCY]`, which is loop iteration n=2 above. Driven three ways plus a
  // thrower planted in slot 4 (the fake treats a function as a thrower, so a consumed slot would
  // have raised):
  //
  //     back  [C,C,A,C]   persona calls 3   response 185 bytes
  //     stay  [C,C,A,A]   persona calls 3   response 185 bytes
  //     n=2   [C,C,A]     persona calls 3   response 185 bytes    identical: true
  //
  // Three assertions that duplicate an existing case are not coverage; they are three more green
  // lines making the total look bigger. Deleting them is the honest move.
  //
  // THE STANDING TRUTH, so nobody adds this again: a switch-back is STRUCTURALLY UNREACHABLE on
  // this harness, on both the document and the agentic path, because the first mismatch ends the
  // turn. It cannot be written without changing what terminates a turn — which would be changing
  // the thing under test to suit the test. Consequently the sticky flag
  // (`tenantKnowledgeScopeRevoked`) is exercised by NOTHING here: deleting it leaves the suite
  // fully green. It is defence in depth behind the per-path latches, and this suite cannot tell
  // whether it works. Written down rather than smoothed over, because the failure mode is a
  // future reader deleting it as redundant on the strength of a green suite.
}


// ── 20 · SAFETY-FIRST STREAMING (owner ruling) ────────────────────────────────────
// Any reply that reads, summarizes, transforms or otherwise carries tenant Knowledge or
// document-derived content stays FULLY BUFFERED until its final scope and permission checks
// pass. Ordinary chat that touches no protected evidence keeps live token streaming. This
// replaces the previous position — a documented "closing window" residual on the chat path and
// an inconsistent hold on the document path — with one explicit rule.
//
// PROTECTED CONTENT, and therefore what must never survive a failed final check: the reply's own
// `choices[].delta.content` tokens; `paige_step` frames of kind "thought" (`summarizeThought`
// of model output — prose generated FROM a Knowledge-bearing prompt, which reads as progress but
// is derived content); the approval, confirm, artifact and choice-chip frames, each of which
// carries model-authored text; `sync_status`, which carries the bureau scores read out of the
// uploaded PDF; and the `[DONE]` sentinel, which must not overtake the buffer it terminates.
//
// Neutral progress that MAY still stream on a protected turn: action steps, phase frames,
// compaction frames, and the fixed client-scope refusal category. That list is NOT taken on
// trust — `nonNeutralFrames` below enforces the shape of each rather than the presence of its
// key, because keying on the name alone meant a leak only had to reuse a neutral key. Three
// mutations that put the whole tenant-Knowledge block on the wire under `paige_phase`,
// `client_scope` and an action step's `detail` all passed 223/223 before that was fixed.
//
// HOW THIS IS PROVEN, and why not by timing. Whether a frame was enqueued before or after the
// gate is not observable from outside: the handler can fill the stream's queue before the test
// reads a single byte, which would make "all RPCs then all frames" look like correct ordering
// even from a streaming implementation. So the property is proven CAUSALLY instead — fail the
// final gate and assert nothing protected survives. A turn that streamed content early cannot
// retract it, so its frames are still in the output; a turn that buffered has nothing to flush.
// That is the same property, and it cannot pass for the wrong reason.
// THE COMPLEMENT OF "NEUTRAL", stated as a denylist of the safe frames rather than an
// allowlist of the unsafe ones. Enumerating what to withhold is how the first version of this
// rule shipped, and it is why `paige_artifact`, `approval_queued`, `paige_confirm` and
// `extraction_proposal` all went straight to the wire on a turn whose reply was withheld: each
// was simply not on the list. Written this way, a frame added later is protected by DEFAULT and
// has to be argued onto the neutral list, which is the direction the safe error runs in.
//
// Neutral, and only these: an action step (fixed-vocabulary label, count detail), a phase
// marker, the fixed client-scope refusal category, and the refusal sentence itself.
// EVERY MARKER ANY FIXTURE PLANTS IN PROTECTED EVIDENCE. A frame is non-neutral if it carries
// one, whatever key it arrives under. The first version of this classifier keyed purely on the
// frame's TOP-LEVEL NAME, so a leak simply had to reuse a neutral key: putting the whole
// tenant-Knowledge block inside a `paige_phase` frame, inside a `client_scope` frame, or inside
// an action step's `detail` all streamed the evidence live on a protected turn with 223/223
// green. "Protected by default" was the claim; "neutral by default if you reuse a key" was the
// behaviour.
// EVERY MARKER ANY FIXTURE PLANTS IN PROTECTED EVIDENCE — and the list is DERIVED, not typed.
// The hand-written version was two markers short of its own fixtures: `PRIVATE-MEMORY-MARKER`
// and `PRIVATE-PDF-MARKER`, the two the newest and strongest latch sources are built on, were
// missing. Eight leak mutations therefore streamed real `client_memory` and real funding
// client-file text live on a protected turn with the whole suite green — including one that
// mutated the SHIPPED live-neutral channel. A hand-maintained list of what to look for is the
// same failure as a hand-maintained list of what to protect, one layer down.
//
// So it is read out of this file's own source at startup. Add a fixture with a new `*-MARKER`
// token and it is covered the moment it exists; there is nothing to remember.
const { APPROVAL_OUTCOME_SENTENCES } = await import("../../supabase/functions/_shared/approval-outcome.ts");
const { TURN_CONTRACT_VERSION, TURN_EVENTS, TURN_STATES, TURN_MODES } = await import("../../supabase/functions/_shared/paige-turn/contract.ts");
const HARNESS_SOURCE = (await import("node:fs")).readFileSync(new URL(import.meta.url), "utf8");
const DISCOVERED_MARKERS = [...new Set(HARNESS_SOURCE.match(/\b[A-Z][A-Z0-9-]*MARKER[A-Z0-9-]*\b/g) ?? [])]
  .filter((m) => !/^(PROTECTED_MARKERS|DISCOVERED_MARKERS)$/.test(m));
// An EMPTY list would compile to `new RegExp("")`, which matches every string and turns every
// frame non-neutral — loud, but for the wrong reason. It would equally hide a silent inversion if
// the pattern were ever written to match nothing. Fail on the spot instead.
if (DISCOVERED_MARKERS.length < 4) {
  console.error(`knowledge-scope: marker discovery found only ${DISCOVERED_MARKERS.length} (${DISCOVERED_MARKERS.join(", ")}) — the pattern is wrong, not the fixtures.`);
  process.exit(1);
}
const PROTECTED_MARKERS = new RegExp(DISCOVERED_MARKERS.map((m) => m.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|"));
const nonNeutralFrames = (text) => text.split("\n").filter((l) => {
  if (!l.startsWith("data: ")) return false;
  const raw = l.slice(6);
  if (raw.trim() === "[DONE]") return false;
  let p;
  try { p = JSON.parse(raw); } catch { return true; }
  // A frame smuggling a second key alongside a neutral one is not neutral.
  const keys = Object.keys(p);
  if (keys.length !== 1) return true;
  // Nothing neutral may contain evidence, whatever key it wears. This is the check that does the
  // real work; the shape checks below are what stop a neutral frame growing a free-text field
  // that a future fixture's marker would not happen to land in.
  if (PROTECTED_MARKERS.test(raw)) return true;
  const [k] = keys;
  const v = p[k];
  if (k === "paige_step") {
    // Thoughts are model prose and are protected. An ACTION step is neutral only while its
    // detail stays short — the code's claim is "a fixed vocabulary label and a count", and a
    // long detail means that claim has stopped being true.
    if (v?.kind === "thought") return true;
    // BOTH fields, bounded. The first version checked `detail` and not `label` — the very field
    // `describeStep`'s department fix exists to keep closed — so a step carrying 300 characters
    // of tenant memory in its label was classified neutral.
    if (typeof v?.detail === "string" && v.detail.length > 40) return true;
    return typeof v?.label === "string" && v.label.length > 60;
  }
  if (k === "paige_phase") return typeof v !== "string" || v.length > 24;
  if (k === "paige_compacting") return Object.keys(v ?? {}).some((x) => x !== "state" && x !== "pct");
  if (k === "client_scope") return typeof v?.reason !== "string" || v.reason.length > 64;
  // What became of the person's approvals. Neutral ONLY in its exact shape: fingerprints their own
  // screen sent, one of three outcomes, and sentences from the server's closed set — never free
  // text, which is the one way a model's words or evidence could ride along on it.
  if (k === "paige_approval_outcome") {
    const closed = (note) => note === undefined || APPROVAL_OUTCOME_SENTENCES.has(note);
    if (!v || typeof v !== "object" || Object.keys(v).some((x) => x !== "actions" && x !== "note") || !closed(v.note)) return true;
    return !Array.isArray(v.actions) || v.actions.some((a) => !a || typeof a !== "object"
      || Object.keys(a).some((x) => x !== "fingerprint" && x !== "outcome" && x !== "note")
      || typeof a.fingerprint !== "string" || !/^[0-9a-f]{16}(?::[0-9a-f-]{36})?$/.test(a.fingerprint)
      || !["ran", "not_run", "unconfirmed"].includes(a.outcome) || !closed(a.note));
  }
  // The turn frame: neutral ONLY in its closed shape — exactly v/event/state/mode, each from the
  // contract's own enums. It is sent direct and the client-seat reader does not scan it, so a field
  // or a value outside that shape is the one way prose could ride along on it. Written out here
  // rather than calling the contract's `isTurnFrame`, so loosening the contract cannot loosen this.
  // Four keys, and each of the four named values checked: a fifth key fails the count, and a renamed
  // one leaves its named value undefined, which no enum admits (so no separate name check is needed).
  if (k === "paige_turn") {
    if (!v || typeof v !== "object" || Array.isArray(v)) return true;
    if (Object.keys(v).length !== 4) return true;
    return v.v !== TURN_CONTRACT_VERSION || !TURN_EVENTS.includes(v.event) || !TURN_STATES.includes(v.state)
      || !TURN_MODES.includes(v.mode);
  }
  // The refusal sentence itself, and nothing else wearing `choices`.
  if (k === "choices") return !/workspace changed/.test(raw);
  return true;
});
const personaCallsOf = (r) => r.rec.rpc.filter((c) => c.name === "get_paige_persona_context").length;

group("safety-first streaming: protected turns buffer, ordinary turns stream");
{
  const protectedFrames = (text) => text.split("\n").filter((l) => {
    if (!l.startsWith("data: ") || l.includes("[DONE]")) return false;
    try {
      const p = JSON.parse(l.slice(6));
      return typeof p?.choices?.[0]?.delta?.content === "string" || p?.paige_step?.kind === "thought";
    } catch { return false; }
  });
  // Everything the reply itself is made of, minus the refusal sentence the gate emits on failure.
  const replyContent = (text) => protectedFrames(text)
    .filter((l) => !/workspace changed/.test(l));
  const neutralFrames = (text) => text.split("\n").filter((l) => {
    if (!l.startsWith("data: ") || l.includes("[DONE]")) return false;
    try {
      const p = JSON.parse(l.slice(6));
      return (p?.paige_step && p.paige_step.kind !== "thought") || !!p?.paige_phase;
    } catch { return false; }
  });

  const docx = {
    fileName: "PRIVATE-DOCXNAME-MARKER.docx",
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    kind: "docx",
    textContent: "PRIVATE-DOCTEXT-MARKER internal operating notes",
  };

  // Each shape is driven twice: once stable (the positive control — it must DELIVER), then once
  // with the account switching at the shape's LAST gate, derived from the control's own call
  // count rather than written down, for the reasons group 19 records.
  const shapes = [
    {
      id: "knowledge chat",
      opts: { chunkContent: "PRIVATE-KB-SOURCE-MARKER", provider: ["private-text"] },
      protectedTurn: true,
    },
    {
      id: "document + Knowledge",
      opts: { chunkContent: "PRIVATE-KB-SOURCE-MARKER", bodyExtras: { document: docx }, provider: ["private-text", "private-text"] },
      protectedTurn: true,
    },
    {
      // THE §58 CASE. Document-derived content is protected on its own, with or without a KB
      // match. Before this rule such a turn streamed live, and that inconsistency is what the
      // owner ruling resolves.
      id: "document, NO Knowledge match",
      opts: { kbRejects: true, bodyExtras: { document: docx }, provider: ["private-text", "private-text"] },
      protectedTurn: true,
    },
  ];

  for (const shape of shapes) {
    const stable = await drive({
      personaTenant: CHILD, personaSequence: [CHILD], memberships: [CHILD], ...shape.opts,
    });
    assert(
      `20 ${shape.id}: CONTROL — a clean turn still delivers its reply`,
      stable.responseText.includes("CHILD-PRIVATE-MARKER"),
      stable.responseText.slice(0, 200),
    );
    const total = personaCallsOf(stable);
    assert(
      `20 ${shape.id}: CONTROL — enough gates exist for the timing below to mean anything`,
      total >= 3,
      `persona calls: ${total}`,
    );

    // Switch at the LAST gate: everything up to it succeeded, so this isolates the final check.
    const atFinalGate = await drive({
      personaTenant: CHILD,
      personaSequence: Array(total - 1).fill(CHILD).concat([AGENCY]),
      memberships: [CHILD, AGENCY],
      ...shape.opts,
    });
    assert(
      `20 ${shape.id}: a failed FINAL check leaves no protected content in the transcript`,
      replyContent(atFinalGate.responseText).length === 0,
      JSON.stringify(replyContent(atFinalGate.responseText)).slice(0, 300),
    );
    assert(
      `20 ${shape.id}: ...no fragment of the reply survives`,
      !atFinalGate.responseText.includes("CHILD-PRIVATE-MARKER"),
      atFinalGate.responseText.slice(0, 300),
    );
    assert(
      `20 ${shape.id}: ...the user gets a safe refusal with a recovery path`,
      /workspace changed|ACTIVE_ACCOUNT_CHANGED/.test(atFinalGate.responseText) &&
        /[Tt]ry again|Start this request again/.test(atFinalGate.responseText),
      atFinalGate.responseText.slice(0, 300),
    );
    assert(
      `20 ${shape.id}: ...and writes no Knowledge telemetry`,
      !atFinalGate.telemetry,
      JSON.stringify(atFinalGate.telemetry?.row ?? null),
    );
    // Not just the reply: NOTHING that is not neutral progress may survive the failed gate.
    // This is the assertion that would have caught the four ungated frames, and it keeps
    // catching the next one without anybody remembering to name it.
    assert(
      `20 ${shape.id}: ...and no non-neutral frame of any kind survives`,
      nonNeutralFrames(atFinalGate.responseText).length === 0,
      JSON.stringify(nonNeutralFrames(atFinalGate.responseText)).slice(0, 300),
    );
  }

  // ORDINARY CHAT IS UNAFFECTED. `kbRejects` leaves the turn with no protected evidence, so it
  // must still deliver — this is what stops the rule being satisfied by "buffer everything".
  const ordinary = await drive({
    personaTenant: CHILD, personaSequence: [CHILD], memberships: [CHILD],
    kbRejects: true, provider: ["private-text"],
  });
  assert(
    "20.ordinary an unprotected turn still delivers its reply",
    ordinary.responseText.includes("CHILD-PRIVATE-MARKER"),
    ordinary.responseText.slice(0, 200),
  );
  assert(
    "20.ordinary ...and retrieved no Knowledge, so it is genuinely unprotected",
    !ordinary.telemetry && !!ordinary.logged.find((l) => /KB_FORBIDDEN|REFUSED/.test(l.msg)),
    JSON.stringify({ tel: !!ordinary.telemetry }),
  );
  // THE OTHER HALF OF THE RULING, MEASURED RATHER THAN ASSERTED. "Ordinary chat retains normal
  // live token streaming" is a claim about COST as well as content: the guard must short-circuit
  // before the RPC, not merely return true after paying for one. An ordinary turn makes exactly
  // the ONE persona call every request makes to resolve its own scope, and no revalidation on
  // top. Without this, a change that made every turn pay four extra round-trips would be
  // invisible here — every content assertion in this file would still pass.
  assert(
    "20.ordinary ...and pays NO revalidation RPC (exactly the one initial resolution)",
    personaCallsOf(ordinary) === 1,
    `persona calls: ${personaCallsOf(ordinary)}`,
  );

  // NEUTRAL PROGRESS STILL REACHES THE USER while a protected answer is being checked. The rule
  // is "buffer the derived content", not "show nothing".
  const withTools = await drive({
    personaTenant: CHILD, personaSequence: [CHILD], memberships: [CHILD],
    chunkContent: "PRIVATE-KB-SOURCE-MARKER", provider: ["two-tools", "private-text"],
  });
  assert(
    "20.progress a protected turn still emits neutral progress frames",
    neutralFrames(withTools.responseText).length > 0,
    JSON.stringify(neutralFrames(withTools.responseText)).slice(0, 200),
  );

  // THOUGHT FRAMES ARE CONTENT, NOT PROGRESS. `summarizeThought(model output)` is prose the
  // model wrote from a Knowledge-bearing prompt; it streamed live before this rule and reads
  // like status, which is exactly why it needs its own assertion. A tool round is required for
  // one to exist at all — the tool-less shapes above can never produce one, so without this the
  // "no protected content survives" assertions say nothing about thoughts.
  const toolTotal = personaCallsOf(withTools);
  const thoughtsAtGate = await drive({
    personaTenant: CHILD,
    personaSequence: Array(toolTotal - 1).fill(CHILD).concat([AGENCY]),
    memberships: [CHILD, AGENCY],
    chunkContent: "PRIVATE-KB-SOURCE-MARKER", provider: ["two-tools", "private-text"],
  });
  assert(
    "20.thought CONTROL — the tool shape really does produce thought frames when it completes",
    withTools.responseText.includes('"kind":"thought"'),
    JSON.stringify(withTools.responseText.slice(0, 200)),
  );
  assert(
    "20.thought a failed final check leaves no model-authored thought line either",
    !thoughtsAtGate.responseText.includes('"kind":"thought"'),
    thoughtsAtGate.responseText.slice(0, 300),
  );

  // AN UNRESOLVABLE SCOPE IS NOT A MATCH. If the resolver errors, the turn must refuse rather
  // than read "still the same" — otherwise a tenant-less operator, whose scope is legitimately
  // null, passes the final check on a failed lookup.
  const rpcError = { data: null, error: { message: "resolver unavailable", code: "57014" } };
  const unresolvable = await drive({
    personaTenant: CHILD,
    personaSequence: [CHILD, rpcError],
    memberships: [CHILD],
    chunkContent: "PRIVATE-KB-SOURCE-MARKER", provider: ["private-text"],
  });
  assert(
    "20.unresolved an unresolvable scope withholds the protected reply",
    !unresolvable.responseText.includes("CHILD-PRIVATE-MARKER"),
    unresolvable.responseText.slice(0, 300),
  );
  assert(
    "20.unresolved ...and writes no Knowledge telemetry",
    !unresolvable.telemetry,
    JSON.stringify(unresolvable.telemetry?.row ?? null),
  );

  // THE TENANT-LESS CASE IS WHERE "unresolvable" ACTUALLY BITES. For a tenant-BEARING turn a
  // failed lookup yields null, which already differs from the turn's scope, so the refusal
  // happens either way. For the PLATFORM OPERATOR the turn scope is legitimately null — so
  // comparing without first requiring the lookup to have SUCCEEDED reads a broken resolver as
  // "still null, still fine" and releases the reply. The operator has no Knowledge (retrieval
  // needs a tenant) but can absolutely attach a document, so the turn is protected.
  const operatorDoc = { document: docx };
  const operatorClean = await drive({
    personaTenant: null, personaSequence: [null], memberships: [],
    bodyExtras: operatorDoc, provider: ["private-text", "private-text"],
  });
  assert(
    "20.operator CONTROL — a tenant-less operator's document turn still delivers",
    operatorClean.responseText.includes("CHILD-PRIVATE-MARKER"),
    operatorClean.responseText.slice(0, 250),
  );
  // AND IT MUST BE A ZERO-ROW ANSWER THAT DELIVERS IT, not a fabricated row of nulls. The fake
  // used to return `[{ tenant_id: null, … }]` here, which the real resolver never produces — it
  // bare-`RETURN`s zero rows for a null tenant. So this control asserted delivery against an
  // impossible response and stayed green while every real operator turn carrying a document,
  // session-document context, a RAG hit or memory was refused outright. Pinning the shape is
  // what stops the fake drifting back to something more convenient than production.
  assert(
    "20.operator CONTROL — ...and the resolver answered with NO ROW, the way production does",
    operatorClean.rec.rpc.some((c) => c.name === "get_paige_persona_context"),
    JSON.stringify(operatorClean.rec.rpc.map((c) => c.name)),
  );
  const operatorBroken = await drive({
    personaTenant: null,
    personaSequence: [null, rpcError],
    memberships: [],
    bodyExtras: operatorDoc, provider: ["private-text", "private-text"],
  });
  assert(
    "20.operator a broken resolver withholds the operator's document reply (null is not a match)",
    !operatorBroken.responseText.includes("CHILD-PRIVATE-MARKER"),
    operatorBroken.responseText.slice(0, 250),
  );
}

// ── 21 · The protected sources the first enumeration missed ──────────────────────
//
// Group 20 proved the rule for the three sources it listed. Two more carry protected content
// and were reached by neither, which an independent read of the pushed diff found and this
// group now holds down.
group("safety-first streaming: the sources the first enumeration missed");
{
  const artifactFrames = (text) => text.split("\n").filter((l) => l.startsWith("data: ") && l.includes("paige_artifact"));

  // 21.a — A FOLLOW-UP QUESTION ABOUT A DOCUMENT READ EARLIER IN THE SESSION. No attachment on
  // this turn and no Knowledge match, so all three of the original sources are false; the whole
  // of the evidence is `sessionDocumentContext`, whose filenames and summaries the handler
  // interpolates into the system prompt. Before the latch counted it, such a turn streamed live
  // AND the revalidation guard short-circuited to `true` without ever asking the resolver — so
  // the answer to "what did that contract say?" crossed with no active-account check at all.
  const sessionDocs = {
    sessionDocumentContext: [
      { fileName: "PRIVATE-DOCNAME-MARKER-terms.pdf", summary: "PRIVATE-SESSION-DOC-MARKER: 30-day notice required." },
    ],
  };
  const sessionClean = await drive({
    personaTenant: CHILD, personaSequence: [CHILD], memberships: [CHILD],
    kbRejects: true, bodyExtras: sessionDocs, provider: ["private-text"],
  });
  assert(
    "21.a CONTROL — a session-document follow-up still delivers its reply",
    sessionClean.responseText.includes("CHILD-PRIVATE-MARKER"),
    sessionClean.responseText.slice(0, 200),
  );
  assert(
    "21.a CONTROL — the turn retrieved no Knowledge, so ONLY the session document protects it",
    !sessionClean.telemetry && !!sessionClean.logged.find((l) => /KB_FORBIDDEN|REFUSED/.test(l.msg)),
    JSON.stringify({ tel: !!sessionClean.telemetry }),
  );
  const sessionTotal = personaCallsOf(sessionClean);
  // The discriminator. With the source unenumerated the guard returns `true` with no RPC, so the
  // turn has exactly the ONE persona call every request makes. A second call is the latch.
  assert(
    "21.a CONTROL — the turn is actually gated (the guard asks the resolver, it does not short-circuit)",
    sessionTotal >= 2,
    `persona calls: ${sessionTotal}`,
  );
  const sessionAtGate = await drive({
    personaTenant: CHILD,
    personaSequence: Array(Math.max(sessionTotal - 1, 1)).fill(CHILD).concat([AGENCY]),
    memberships: [CHILD, AGENCY],
    kbRejects: true, bodyExtras: sessionDocs, provider: ["private-text"],
  });
  assert(
    "21.a a failed final check withholds a reply grounded in an earlier session document",
    !sessionAtGate.responseText.includes("CHILD-PRIVATE-MARKER"),
    sessionAtGate.responseText.slice(0, 300),
  );
  assert(
    "21.a ...and the user gets the safe refusal with a recovery path",
    /workspace changed/.test(sessionAtGate.responseText) && /[Tt]ry again/.test(sessionAtGate.responseText),
    sessionAtGate.responseText.slice(0, 300),
  );
  assert(
    "21.a ...and no non-neutral frame survives",
    nonNeutralFrames(sessionAtGate.responseText).length === 0,
    JSON.stringify(nonNeutralFrames(sessionAtGate.responseText)).slice(0, 300),
  );

  // 21.b — DURABLE DOCUMENT SUBMISSION. The request now creates durable work; the worker owns
  // the later artifact and completion turn. This request must therefore prove it submitted the
  // model-authored title while emitting neither a premature artifact nor that private title.
  const artifactOpts = {
    chunkContent: "PRIVATE-KB-SOURCE-MARKER",
    provider: ["doc-artifact", "private-text"],
    bodyExtras: { threadId: "99999999-9999-4999-8999-999999999999", requestIntentId: "77777777-7777-4777-8777-777777777777" },
    rpcExtras: {
      // A real tenant seat: without it the actor resolves to the most-restricted `client` tier
      // and `document_generate` is refused before it can produce anything to assert about.
      get_actor_access: { data: { tier: "tenant" }, error: null },
      // §16 lane. The default is `confirm`, which returns a needs_confirm result instead of
      // submitting durable work.
      resolve_tool_autonomy: { data: "auto", error: null },
      submit_paige_document_work: { data: [{ work_id: "88888888-8888-4888-8888-888888888888", work_status: "claimed", resumed_existing: false }], error: null },
      // The creative tools need this workspace's owner or an admin — a TENANT role (C0a, owner
      // ruling "ADMIN IS A TENANT ROLE"): a seat in the active workspace (`studio_role_ok`) that is
      // the workspace the chat acts in. Without it the call is refused and nothing is produced.
      studio_role_ok: { data: true, error: null },
      // …asked of the acting workspace explicitly (C0a: one verdict about one workspace).
      is_tenant_admin_as: { data: true, error: null },
      current_user_tenant_id: { data: CHILD, error: null },
    },
  };
  const artifactClean = await drive({
    personaTenant: CHILD, personaSequence: [CHILD], memberships: [CHILD], ...artifactOpts,
  });
  const durableSubmit = artifactClean.rec.rpc.find((call) => call.name === "submit_paige_document_work");
  assert(
    "21.b CONTROL — the tool shape really does submit durable document work",
    durableSubmit?.args?._request_payload?.title === "CHILD-PRIVATE-MARKER onboarding guide",
    JSON.stringify(durableSubmit ?? artifactClean.rec.rpc).slice(0, 400),
  );
  assert(
    "21.b CONTROL — accepted work emits no premature artifact",
    artifactFrames(artifactClean.responseText).length === 0,
    artifactClean.responseText.slice(0, 400),
  );
  const artifactTotal = personaCallsOf(artifactClean);
  const artifactAtGate = await drive({
    personaTenant: CHILD,
    personaSequence: Array(artifactTotal - 1).fill(CHILD).concat([AGENCY]),
    memberships: [CHILD, AGENCY],
    ...artifactOpts,
  });
  assert(
    "21.b a failed final check leaves no artifact frame in the transcript",
    artifactFrames(artifactAtGate.responseText).length === 0,
    artifactFrames(artifactAtGate.responseText).join("").slice(0, 300),
  );
  assert(
    "21.b ...and the artifact TITLE appears nowhere in the transcript",
    !artifactAtGate.responseText.includes("CHILD-PRIVATE-MARKER"),
    artifactAtGate.responseText.slice(0, 300),
  );
  assert(
    "21.b ...and no non-neutral frame survives",
    nonNeutralFrames(artifactAtGate.responseText).length === 0,
    JSON.stringify(nonNeutralFrames(artifactAtGate.responseText)).slice(0, 300),
  );

  // 21.c — THE `rag_documents` SOURCE, which had NO COVERAGE AT ALL. `match_rag_documents` was
  // never configured in the fake, so `ragContext` was empty in all 186 assertions of the
  // previous revision and deleting it from the latch left the suite green. The latch named it as
  // "enumerated rather than assumed"; until this case existed it was assumed.
  const ragClean = await drive({
    personaTenant: CHILD, personaSequence: [CHILD], memberships: [CHILD],
    kbRejects: true, ragHits: true, provider: ["private-text"],
  });
  assert(
    "21.c CONTROL — a platform-knowledge turn still delivers its reply",
    ragClean.responseText.includes("CHILD-PRIVATE-MARKER"),
    ragClean.responseText.slice(0, 200),
  );
  assert(
    "21.c CONTROL — tenant Knowledge was refused, so ONLY rag_documents protects it",
    !ragClean.telemetry && !!ragClean.logged.find((l) => /KB_FORBIDDEN|REFUSED/.test(l.msg)),
    JSON.stringify({ tel: !!ragClean.telemetry }),
  );
  const ragTotal = personaCallsOf(ragClean);
  assert(
    "21.c CONTROL — the turn is actually gated (the guard asks the resolver)",
    ragTotal >= 2,
    `persona calls: ${ragTotal}`,
  );
  const ragAtGate = await drive({
    personaTenant: CHILD,
    personaSequence: Array(Math.max(ragTotal - 1, 1)).fill(CHILD).concat([AGENCY]),
    memberships: [CHILD, AGENCY],
    kbRejects: true, ragHits: true, provider: ["private-text"],
  });
  assert(
    "21.c a failed final check withholds a reply grounded in platform knowledge",
    !ragAtGate.responseText.includes("CHILD-PRIVATE-MARKER"),
    ragAtGate.responseText.slice(0, 300),
  );
  assert(
    "21.c ...and no non-neutral frame survives",
    nonNeutralFrames(ragAtGate.responseText).length === 0,
    JSON.stringify(nonNeutralFrames(ragAtGate.responseText)).slice(0, 300),
  );

  // 21.d — A SHAPELESS RESOLVER ROW IS NOT A RESOLUTION. The suite only ever drove the resolver
  // to an ERROR. A row that comes back present but carrying no `tenant_id` reads as a null
  // tenant, and for the platform operator — whose turn scope is legitimately null — that
  // compared equal and released the protected reply. Same class as the errored lookup, a
  // different failure shape, and it needs its own case because the operator is the only tier
  // where the two are distinguishable.
  const emptyRow = { data: [{}], error: null };
  const docFixture = {
    fileName: "PRIVATE-DOCXNAME-MARKER.docx",
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    kind: "docx",
    textContent: "PRIVATE-DOCTEXT-MARKER internal operating notes",
  };
  const operatorDegenerate = await drive({
    personaTenant: null,
    personaSequence: [null, emptyRow],
    memberships: [],
    bodyExtras: { document: docFixture }, provider: ["private-text", "private-text"],
  });
  assert(
    "21.d a resolver row with no tenant_id is not a match — the operator's reply is withheld",
    !operatorDegenerate.responseText.includes("CHILD-PRIVATE-MARKER"),
    operatorDegenerate.responseText.slice(0, 300),
  );
  assert(
    "21.d ...and no non-neutral frame survives",
    nonNeutralFrames(operatorDegenerate.responseText).length === 0,
    JSON.stringify(nonNeutralFrames(operatorDegenerate.responseText)).slice(0, 300),
  );

  // 21.e — THE CONFIRM CARD. `describeConfirm` interpolates the model's own arguments into a
  // sentence describing what Paige proposes to do, and it went straight to the wire. A turn
  // whose answer was correctly withheld still showed the user that proposal, written out of the
  // previous workspace's evidence and naming what it found there.
  const confirmFrames = (text) => text.split("\n").filter((l) => l.startsWith("data: ") && l.includes("paige_confirm"));
  const confirmOpts = {
    chunkContent: "PRIVATE-KB-SOURCE-MARKER",
    provider: ["confirm-card", "private-text"],
    // The DEFAULT lane. `auto` would run the tool and produce an artifact instead of a card.
    rpcExtras: { get_actor_access: { data: { tier: "tenant" }, error: null } },
    tableExtras: { user_roles: () => [{ role: "admin" }] },
    functionExtras: { "crm-command": { data: { outcome: "approval_required", fingerprint: "abcd1234abcd1234", summary: "Create CHILD-PRIVATE-MARKER contact" }, error: null } },
  };
  const confirmClean = await drive({
    personaTenant: CHILD, personaSequence: [CHILD], memberships: [CHILD], ...confirmOpts,
  });
  assert(
    "21.e CONTROL — the shape really does emit a confirm card when the turn completes",
    confirmFrames(confirmClean.responseText).length > 0,
    confirmClean.responseText.slice(0, 400),
  );
  assert(
    "21.e CONTROL — and that card carries the model's own words",
    confirmFrames(confirmClean.responseText).join("").includes("CHILD-PRIVATE-MARKER"),
    confirmFrames(confirmClean.responseText).join("").slice(0, 300),
  );
  const confirmTotal = personaCallsOf(confirmClean);
  const confirmAtGate = await drive({
    personaTenant: CHILD,
    personaSequence: Array(confirmTotal - 1).fill(CHILD).concat([AGENCY]),
    memberships: [CHILD, AGENCY],
    ...confirmOpts,
  });
  assert(
    "21.e a failed final check leaves no confirm card in the transcript",
    confirmFrames(confirmAtGate.responseText).length === 0,
    confirmFrames(confirmAtGate.responseText).join("").slice(0, 300),
  );
  assert(
    "21.e ...and no non-neutral frame survives",
    nonNeutralFrames(confirmAtGate.responseText).length === 0,
    JSON.stringify(nonNeutralFrames(confirmAtGate.responseText)).slice(0, 300),
  );

  // 21.f — THE CHOICE CHIPS, which are the whole assistant turn. `ask_choices` sets
  // `finalChunks = []` and breaks, so the chips frame is the entire answer. Streaming it live
  // meant a protected turn published that answer, then discarded an empty buffer at the final
  // check and printed a refusal underneath an answer already on screen — the worst version of
  // this defect, because the refusal makes it look handled.
  const choiceFrames = (text) => text.split("\n").filter((l) => l.startsWith("data: ") && l.includes("paige_choices"));
  const STUDIO_THREAD = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
  const choiceOpts = {
    chunkContent: "PRIVATE-KB-SOURCE-MARKER",
    provider: ["ask-choices"],
    bodyExtras: { threadId: STUDIO_THREAD, requestIntentId: "66666666-6666-4666-8666-666666666666" },
    // `ask_choices` is Studio-gated, and studioSessionId is read off the thread row.
    tableExtras: { paige_chat_threads: () => [{ summary: null, studio_session_id: "studio-sess-1" }] },
  };
  const choiceClean = await drive({
    personaTenant: CHILD, personaSequence: [CHILD], memberships: [CHILD], ...choiceOpts,
  });
  assert(
    "21.f CONTROL — the Studio shape really does emit a choices frame",
    choiceFrames(choiceClean.responseText).length > 0,
    choiceClean.responseText.slice(0, 400),
  );
  assert(
    "21.f CONTROL — and the chips prompt is the model's own words",
    choiceFrames(choiceClean.responseText).join("").includes("CHILD-PRIVATE-MARKER"),
    choiceFrames(choiceClean.responseText).join("").slice(0, 300),
  );
  const choiceTotal = personaCallsOf(choiceClean);
  const choiceAtGate = await drive({
    personaTenant: CHILD,
    personaSequence: Array(choiceTotal - 1).fill(CHILD).concat([AGENCY]),
    memberships: [CHILD, AGENCY],
    ...choiceOpts,
  });
  assert(
    "21.f a failed final check leaves no choices frame in the transcript",
    choiceFrames(choiceAtGate.responseText).length === 0,
    choiceFrames(choiceAtGate.responseText).join("").slice(0, 300),
  );
  assert(
    "21.f ...and no non-neutral frame survives",
    nonNeutralFrames(choiceAtGate.responseText).length === 0,
    JSON.stringify(nonNeutralFrames(choiceAtGate.responseText)).slice(0, 300),
  );

  // 21.g — THE CLOSE FRAME ON THE CREDIT-REPORT PATH. It carries the three bureau scores read out
  // of the uploaded PDF, plus the item counts. It was once emitted with a direct enqueue and never
  // entered `directFrames`, so it bypassed the document path's hold entirely: a turn whose
  // analysis was withheld still put the numbers from that analysis on screen.
  //
  // THE FRAME CHANGED KEY, AND THE PROPERTY DID NOT. A credit report now ends in an
  // `extraction_proposal` a human approves, not a `sync_status` reporting eight tables already
  // written. The scores are still in it — they are the whole point of the card — so the hold still
  // has to cover it. Matching on either key is deliberate: `sync_status` remains the frame for the
  // failure and nothing-to-propose cases, and both must be held for the same reason.
  const syncFrames = (text) => text.split("\n").filter((l) => l.startsWith("data: ") && (l.includes("sync_status") || l.includes("extraction_proposal")));
  const pdfFixture = { fileName: "PRIVATE-PDFNAME-MARKER.pdf", mimeType: "application/pdf", kind: "pdf", base64: "AA==" };
  const syncOpts = {
    chunkContent: "PRIVATE-KB-SOURCE-MARKER",
    bodyExtras: { document: pdfFixture },
    provider: ["read-check", "private-text", "json-extraction"],
    // The credit branch inserts an upload row and reads its id back. Without a row the pipeline
    // now stops at "nothing for you to approve", which is correct behaviour and the wrong thing to
    // be measuring here — this group is about whether a document turn's close frames are HELD.
    tableExtras: { credit_report_uploads: () => [{ id: "upload-1" }] },
  };
  const syncClean = await drive({
    personaTenant: CHILD, personaSequence: [CHILD], memberships: [CHILD], ...syncOpts,
  });
  assert(
    "21.g CONTROL — a credit-report turn really does emit a close frame",
    syncFrames(syncClean.responseText).length > 0,
    syncClean.responseText.slice(-400),
  );
  assert(
    "21.g CONTROL — and that frame carries the scores read out of the document",
    /"credit_score_(equifax|experian|transunion)"/.test(syncFrames(syncClean.responseText).join("")),
    syncFrames(syncClean.responseText).join("").slice(0, 300),
  );
  assert(
    "21.g CONTROL — and it is a PROPOSAL, not a report of writes already made",
    /"extraction_proposal"/.test(syncFrames(syncClean.responseText).join("")) &&
      !/"scores_synced"/.test(syncClean.responseText),
    syncFrames(syncClean.responseText).join("").slice(0, 300),
  );
  const syncTotal = personaCallsOf(syncClean);
  const syncAtGate = await drive({
    personaTenant: CHILD,
    personaSequence: Array(syncTotal - 1).fill(CHILD).concat([AGENCY]),
    memberships: [CHILD, AGENCY],
    ...syncOpts,
  });
  assert(
    "21.g a failed final check leaves no close frame in the transcript",
    syncFrames(syncAtGate.responseText).length === 0,
    syncFrames(syncAtGate.responseText).join("").slice(0, 300),
  );
  assert(
    "21.g ...and no non-neutral frame survives",
    nonNeutralFrames(syncAtGate.responseText).length === 0,
    JSON.stringify(nonNeutralFrames(syncAtGate.responseText)).slice(0, 300),
  );

  // 21.h — STUDIO FAILS CLOSED BEFORE DURABLE SUBMISSION. The worker cannot yet link an
  // asynchronously completed document into the Studio canvas, so Studio must refuse instead
  // of accepting work whose artifact would be unreachable.
  const studioOpts = {
    chunkContent: "PRIVATE-KB-SOURCE-MARKER",
    provider: ["doc-artifact", "private-text"],
    bodyExtras: { threadId: STUDIO_THREAD, requestIntentId: "66666666-6666-4666-8666-666666666666" },
    rpcExtras: {
      get_actor_access: { data: { tier: "tenant" }, error: null },
      resolve_tool_autonomy: { data: "auto", error: null },
      submit_paige_document_work: { data: [{ work_id: "55555555-5555-4555-8555-555555555555", work_status: "claimed", resumed_existing: false }], error: null },
    },
    tableExtras: {
      user_roles: () => [{ role: "admin" }],
      paige_chat_threads: () => [{ summary: null, studio_session_id: "studio-sess-1" }],
    },
  };
  const studioClean = await drive({
    personaTenant: CHILD, personaSequence: [CHILD], memberships: [CHILD], ...studioOpts,
  });
  const studioSubmit = studioClean.rec.rpc.find((call) => call.name === "submit_paige_document_work");
  assert(
    "21.h CONTROL — Studio refuses before durable document submission",
    studioSubmit === undefined,
    JSON.stringify(studioClean.rec.rpc).slice(0, 400),
  );
  assert(
    "21.h CONTROL — Studio emits no premature canvas artifact",
    artifactFrames(studioClean.responseText).length === 0,
    studioClean.responseText.slice(0, 500),
  );
  const studioTotal = personaCallsOf(studioClean);
  const studioAtGate = await drive({
    personaTenant: CHILD,
    personaSequence: Array(studioTotal - 1).fill(CHILD).concat([AGENCY]),
    memberships: [CHILD, AGENCY],
    ...studioOpts,
  });
  assert(
    "21.h a failed final check leaves no canvas artifact frame in the transcript",
    artifactFrames(studioAtGate.responseText).length === 0,
    artifactFrames(studioAtGate.responseText).join("").slice(0, 300),
  );
  assert(
    "21.h ...and no non-neutral frame survives",
    nonNeutralFrames(studioAtGate.responseText).length === 0,
    JSON.stringify(nonNeutralFrames(studioAtGate.responseText)).slice(0, 300),
  );

  // 21.i — AN ACTION STEP'S LABEL IS NOT AUTOMATICALLY NEUTRAL. The whole justification for
  // streaming action steps live while a protected answer is checked is that their label comes
  // from a closed vocabulary and their detail is a count. `describeStep`'s `action_file` case
  // title-cased `args.to_department` — a model-authored string — straight into the label, so the
  // one sanctioned live channel was carrying model text on a protected turn. This case is what
  // makes the "fixed vocabulary" sentence a checked property rather than an intention.
  const stepFrames = (text) => text.split("\n").filter((l) => l.startsWith("data: ") && l.includes("paige_step"));
  const actionFileOpts = {
    chunkContent: "PRIVATE-KB-SOURCE-MARKER",
    provider: ["action-file", "private-text"],
    rpcExtras: {
      get_actor_access: { data: { tier: "tenant" }, error: null },
      resolve_tool_autonomy: { data: "auto", error: null },
    },
    tableExtras: { user_roles: () => [{ role: "admin" }] },
  };
  const actionFile = await drive({
    personaTenant: CHILD, personaSequence: [CHILD], memberships: [CHILD], ...actionFileOpts,
  });
  assert(
    "21.i CONTROL — the shape really does emit an action step for the filed action",
    stepFrames(actionFile.responseText).some((l) => /"kind":"action"/.test(l)),
    actionFile.responseText.slice(0, 400),
  );
  assert(
    "21.i a live action step never carries the model's own words in its label",
    // NOT one of the PROTECTED_MARKERS: `describeStep` splits the department on [_-] before
    // title-casing it, so a hyphenated marker is shredded and the assertion would pass against
    // the unfixed code. A single unbroken token is what actually survives that transform.
    !stepFrames(actionFile.responseText).join("").includes("LEAKEDMODELWORD"),
    stepFrames(actionFile.responseText).join("").slice(0, 300),
  );

  // 21.j — A LATE TOOL RETRIEVAL SWITCHES THE TURN, which the ruling requires in those words and
  // which nothing was checking. This turn starts with NO protected evidence at all — Knowledge
  // refused, no document, no session docs, non-funding tenant — so at entry it is an ordinary
  // live-streaming turn. Then it runs a READ tool, whose result enters the model's context and
  // grounds the closing reply. If that does not flip the turn onto the buffered path, the answer
  // streams live and the guard never asks the resolver.
  //
  // The `tool` fixture, NOT `two-tools`, and the difference is load-bearing. `two-tools` narrates,
  // and on a late-retrieval turn round one's thought line is emitted BEFORE that round's tools
  // run — so it streams live. That is correct: round one's narration is written from the entry
  // prompt, which by definition carries no protected evidence on a turn that only becomes
  // protected later. But it means the reply marker and the narration marker are the same string,
  // and "the marker is absent" would stop meaning "the reply was withheld". A silent fixture
  // leaves the reply as the only source of it.
  const lateOpts = {
    kbRejects: true,
    provider: ["tool", "private-text"],
    rpcExtras: { get_actor_access: { data: { tier: "tenant" }, error: null } },
  };
  const lateClean = await drive({
    personaTenant: CHILD, personaSequence: [CHILD], memberships: [CHILD], ...lateOpts,
  });
  assert(
    "21.j CONTROL — a tool-only turn still delivers its reply",
    lateClean.responseText.includes("CHILD-PRIVATE-MARKER"),
    lateClean.responseText.slice(0, 250),
  );
  assert(
    "21.j CONTROL — and it carried NO protected evidence at entry (Knowledge was refused)",
    !lateClean.telemetry && !!lateClean.logged.find((l) => /KB_FORBIDDEN|REFUSED/.test(l.msg)),
    JSON.stringify({ tel: !!lateClean.telemetry }),
  );
  const lateTotal = personaCallsOf(lateClean);
  assert(
    "21.j the late tool retrieval switched the turn onto the guarded path (>1 persona call)",
    lateTotal > 1,
    `persona calls: ${lateTotal} — 1 means the guard short-circuited, i.e. the switch never happened`,
  );
  const lateAtGate = await drive({
    personaTenant: CHILD,
    personaSequence: Array(lateTotal - 1).fill(CHILD).concat([AGENCY]),
    memberships: [CHILD, AGENCY],
    ...lateOpts,
  });
  assert(
    "21.j ...so a failed final check withholds the reply it grounded",
    !lateAtGate.responseText.includes("CHILD-PRIVATE-MARKER"),
    lateAtGate.responseText.slice(0, 300),
  );
  assert(
    "21.j ...and no non-neutral frame survives",
    nonNeutralFrames(lateAtGate.responseText).length === 0,
    JSON.stringify(nonNeutralFrames(lateAtGate.responseText)).slice(0, 300),
  );

  // 21.k — THE SENTINEL MUST NOT OVERTAKE THE BUFFER IT TERMINATES. On the couldn't-finish
  // branch the fallback text goes through `emitContent` and was therefore held, while `[DONE]`
  // went straight to the wire — so on a protected turn the sentinel arrived FIRST and the
  // released reply landed behind it. Four of the seven SSE consumers `break` on `[DONE]`, so
  // they dropped the reply, while it was still persisted to the thread: the transcript and the
  // wire disagreeing, which is the property this whole rule exists to establish.
  const wireOrder = (text) => {
    const lines = text.split("\n").filter((l) => l.startsWith("data: "));
    return {
      done: lines.findIndex((l) => l.slice(6).trim() === "[DONE]"),
      content: lines.findIndex((l) => /couldn't finish that/.test(l)),
    };
  };
  // "fail" twice drives the loop to forced termination AND makes the closing call fail, which is
  // the only route to the fallback branch.
  const fallbackOpts = { chunkContent: "PRIVATE-KB-SOURCE-MARKER", provider: ["two-tools", "fail", "fail"] };
  const fallback = await drive({
    personaTenant: CHILD, personaSequence: [CHILD], memberships: [CHILD], ...fallbackOpts,
  });
  const fbOrder = wireOrder(fallback.responseText);
  assert(
    "21.k CONTROL — the fixture really does reach the couldn't-finish fallback",
    fbOrder.content !== -1,
    fallback.responseText.slice(-300),
  );
  assert(
    "21.k on a protected turn the released reply reaches the wire BEFORE [DONE]",
    fbOrder.done === -1 || fbOrder.content < fbOrder.done,
    `content at ${fbOrder.content}, [DONE] at ${fbOrder.done}`,
  );
  // AND THE FALLBACK TEXT ITSELF IS BUFFERED, not merely ordered. Ordering alone left a mutation
  // that forwards the fallback straight to the wire fully green: the sentinel still trailed it,
  // so wire order was satisfied while the text escaped a refused turn.
  const fbTotal = personaCallsOf(fallback);
  const fbAtGate = await drive({
    personaTenant: CHILD,
    personaSequence: Array(fbTotal - 1).fill(CHILD).concat([AGENCY]),
    memberships: [CHILD, AGENCY],
    ...fallbackOpts,
  });
  assert(
    "21.k a failed final check withholds the couldn't-finish text too",
    !/couldn't finish that/.test(fbAtGate.responseText),
    fbAtGate.responseText.slice(0, 300),
  );

  // 21.l — `client_memory`, and it is the strongest of the sources the enumerations missed
  // because it is DURABLE ACROSS SESSIONS. The `report_upload` row persists the very extraction
  // this handler buffers `sync_status` for — the bureau scores and item counts read out of the
  // uploaded PDF — and it is interpolated into the prompt of every later turn. Buffering the
  // frame while streaming the persisted extraction of it on every turn afterwards is not a rule,
  // it is a coincidence of which surface happened to be audited.
  // INT-326: own memory is read only when the caller has an active workspace, so this scenario
  // resolves one (CHILD). Without it the handler correctly reads no own memory and the three checks
  // below would prove nothing about the final-check gate. The row is stamped like a production row;
  // this fake table does not apply query filters, so the workspace filter itself is proven in
  // `test:client-memory-authz` group 37, not here.
  const memoryOpts = {
    kbRejects: true,
    provider: ["private-text"],
    // S5: OWNER/WORKSPACE continuity recalls through the governed read — the marker row is
    // staged there (client_memory only serves the CLIENT arm now).
    rpcExtras: {
      current_user_tenant_id: { data: CHILD, error: null },
      get_paige_memory: { data: [{ id: "pom-1", memory_type: "report_upload", content: "Credit report analyzed (consumer). Scores: EQ 712, EX 705, TU 698. PRIVATE-MEMORY-MARKER", source_thread_id: null, metadata: { audience: "owner_personal", confirmation_state: "confirmed" }, created_at: new Date().toISOString(), updated_at: new Date().toISOString() }], error: null },
    },
    tableExtras: {
      client_memory: () => [{
        tenant_id: CHILD,
        client_id: null,
        memory_type: "report_upload",
        content: "Credit report analyzed (consumer). Scores: EQ 712, EX 705, TU 698. PRIVATE-MEMORY-MARKER",
        created_at: new Date().toISOString(),
      }],
    },
  };
  const memClean = await drive({
    personaTenant: CHILD, personaSequence: [CHILD], memberships: [CHILD], ...memoryOpts,
  });
  assert(
    "21.l CONTROL — a memory-bearing turn still delivers its reply",
    memClean.responseText.includes("CHILD-PRIVATE-MARKER"),
    memClean.responseText.slice(0, 250),
  );
  assert(
    "21.l CONTROL — the memory really did reach the model's prompt",
    memClean.providerCalls.some((c) => JSON.stringify(c).includes("PRIVATE-MEMORY-MARKER")),
    JSON.stringify(memClean.providerCalls).slice(0, 200),
  );
  const memTotal = personaCallsOf(memClean);
  assert(
    "21.l CONTROL — and the turn is treated as protected (the guard asks the resolver)",
    memTotal >= 2,
    `persona calls: ${memTotal}`,
  );
  const memAtGate = await drive({
    personaTenant: CHILD,
    personaSequence: Array(Math.max(memTotal - 1, 1)).fill(CHILD).concat([AGENCY]),
    memberships: [CHILD, AGENCY],
    ...memoryOpts,
  });
  assert(
    "21.l a failed final check withholds a reply grounded in persisted memory",
    !memAtGate.responseText.includes("CHILD-PRIVATE-MARKER"),
    memAtGate.responseText.slice(0, 300),
  );
  const proposedMemory = structuredClone(memoryOpts.rpcExtras.get_paige_memory);
  proposedMemory.data[0].metadata.confirmation_state = "proposed";
  const candidateOnly = await drive({
    personaTenant: CHILD, personaSequence: [CHILD], memberships: [CHILD], ...memoryOpts,
    rpcExtras: { ...memoryOpts.rpcExtras, get_paige_memory: proposedMemory },
  });
  // INT-326 C6 dials: a proposed row may enter ONLY as labelled recollection — never as
  // unqualified task knowledge. The marker must never appear without the fixed label.
  const candidateCalls = JSON.stringify(candidateOnly.providerCalls);
  assert(
    "21.l C6 — a proposed owner row enters only as labelled recollection, never as bare task context",
    !candidateCalls.includes("PRIVATE-MEMORY-MARKER")
      || candidateCalls.includes("(my recollection — not yet confirmed)"),
    candidateCalls.slice(0, 200),
  );
  assert(
    "21.l C6 — the recollection label rides with the proposed row wherever it appears",
    !candidateOnly.providerCalls.some((c) =>
      JSON.stringify(c).includes("PRIVATE-MEMORY-MARKER") && !JSON.stringify(c).includes("(my recollection — not yet confirmed)")),
    candidateCalls.slice(0, 200),
  );

  // 21.m — THE FUNDING TENANT'S CLIENT FILE. Under `fundingEnabled`, `buildUserContext` reads the
  // uploaded PDF's file name, the three bureau scores and every active negative item with
  // creditor and amount, and puts them in the prompt. That made EVERY ordinary chat turn on a
  // funding tenant document-derived and unbuffered. The gate matters in both directions, so the
  // NON-funding control below proves the fix did not simply buffer the whole platform.
  const fundingRows = {
    credit_report_uploads: () => [{ id: "u1", file_name: "PRIVATE-PDF-MARKER.pdf", analysis_status: "completed", created_at: "2026-01-01T00:00:00Z", last_analyzed_at: "2026-01-01T00:00:00Z", bureau_detected: "PRIVATE-BUREAU-MARKER", error_message: null }],
    profiles: () => [{ active_tenant_id: CHILD, full_name: "Test", estimated_fico_ex: 705, estimated_fico_eq: 712, estimated_fico_tu: 698 }],
  };
  const fundingOpts = { kbRejects: true, provider: ["private-text"], fundingEnabled: true, tableExtras: fundingRows };
  const fundClean = await drive({
    personaTenant: CHILD, personaSequence: [CHILD], memberships: [CHILD], ...fundingOpts,
  });
  assert(
    "21.m CONTROL — the uploaded PDF's name really did reach the funding tenant's prompt",
    fundClean.providerCalls.some((c) => JSON.stringify(c).includes("PRIVATE-PDF-MARKER")),
    JSON.stringify(fundClean.providerCalls).slice(0, 200),
  );
  const fundTotal = personaCallsOf(fundClean);
  assert(
    "21.m CONTROL — and that turn is treated as protected",
    fundTotal >= 2,
    `persona calls: ${fundTotal}`,
  );
  const fundAtGate = await drive({
    personaTenant: CHILD,
    personaSequence: Array(Math.max(fundTotal - 1, 1)).fill(CHILD).concat([AGENCY]),
    memberships: [CHILD, AGENCY],
    ...fundingOpts,
  });
  assert(
    "21.m a failed final check withholds the funding tenant's reply",
    !fundAtGate.responseText.includes("CHILD-PRIVATE-MARKER"),
    fundAtGate.responseText.slice(0, 300),
  );
  // THE OTHER DIRECTION. A non-funding tenant's client file carries profile, subscription, tasks
  // and document-TYPE counts — tenant data, but not document-derived evidence — so it must NOT
  // latch. Without this, "latch on userContext unconditionally" would pass 21.m and quietly
  // buffer every turn on the platform.
  const nonFunding = await drive({
    personaTenant: CHILD, personaSequence: [CHILD], memberships: [CHILD],
    kbRejects: true, provider: ["private-text"], tableExtras: fundingRows,
  });
  assert(
    "21.m a NON-funding tenant's client file does not latch — ordinary chat still streams",
    personaCallsOf(nonFunding) === 1,
    `persona calls: ${personaCallsOf(nonFunding)}`,
  );

  // 21.n — THE APPROVAL CARD. `approval_queued[].summary` is the model's own argument describing
  // what it proposes to do, written from the Knowledge-bearing prompt. The commit that moved it
  // behind the close decision also claimed every moved frame was mutation-proven individually;
  // reverting THIS one left the suite green, because no fixture produced an approval. That is the
  // seventh check on this branch to have passed for a reason other than the one it named, and it
  // is the reason this case exists.
  const approvalFrames = (text) => text.split("\n").filter((l) => l.startsWith("data: ") && l.includes("approval_queued"));
  const approvalOpts = {
    chunkContent: "PRIVATE-KB-SOURCE-MARKER",
    provider: ["propose-action", "private-text"],
    rpcExtras: {
      get_actor_access: { data: { tier: "tenant" }, error: null },
      resolve_tool_autonomy: { data: "auto", error: null },
      // propose_action needs this workspace's owner or an admin (C0a: a tenant seat, not the
      // global `admin` row).
      studio_role_ok: { data: true, error: null },
      // …asked of the acting workspace explicitly (C0a: one verdict about one workspace).
      is_tenant_admin_as: { data: true, error: null },
      current_user_tenant_id: { data: CHILD, error: null },
    },
    tableExtras: {
      // The insert's `.select("id").single()` reads back through the scenario table, so without
      // this the queue insert returns no id and the tool bails before pushing the approval.
      paige_pending_approvals: () => [{ id: "22222222-2222-4222-8222-222222222222" }],
    },
  };
  const approvalClean = await drive({
    personaTenant: CHILD, personaSequence: [CHILD], memberships: [CHILD], ...approvalOpts,
  });
  assert(
    "21.n CONTROL — the shape really does emit an approval frame when the turn completes",
    approvalFrames(approvalClean.responseText).length > 0,
    approvalClean.responseText.slice(0, 500),
  );
  assert(
    "21.n CONTROL — and that frame carries the model's own summary",
    approvalFrames(approvalClean.responseText).join("").includes("CHILD-PRIVATE-MARKER"),
    approvalFrames(approvalClean.responseText).join("").slice(0, 300),
  );
  const approvalTotal = personaCallsOf(approvalClean);
  const approvalAtGate = await drive({
    personaTenant: CHILD,
    personaSequence: Array(approvalTotal - 1).fill(CHILD).concat([AGENCY]),
    memberships: [CHILD, AGENCY],
    ...approvalOpts,
  });
  assert(
    "21.n a failed final check leaves no approval frame in the transcript",
    approvalFrames(approvalAtGate.responseText).length === 0,
    approvalFrames(approvalAtGate.responseText).join("").slice(0, 300),
  );
  assert(
    "21.n ...and no non-neutral frame survives",
    nonNeutralFrames(approvalAtGate.responseText).length === 0,
    JSON.stringify(nonNeutralFrames(approvalAtGate.responseText)).slice(0, 300),
  );

  // 21.o — A ROW *AND* AN ERROR. The `!error` half of the resolver predicate was never load-
  // bearing: every scenario drove the error case as `{ data: null, error }`, where `!!row` is
  // already false. Supabase can return a row alongside an error on a partial result, and that
  // shape sailed through — `20.unresolved` passed on the strength of `!!row` alone while
  // crediting `!error` in its comment.
  const rowAndError = { data: [{ tenant_id: CHILD }], error: { message: "partial result", code: "57014" } };
  const partial = await drive({
    personaTenant: CHILD,
    personaSequence: [CHILD, rowAndError],
    memberships: [CHILD],
    chunkContent: "PRIVATE-KB-SOURCE-MARKER", provider: ["private-text"],
  });
  assert(
    "21.o a resolver that returns a row AND an error is not a resolution",
    !partial.responseText.includes("CHILD-PRIVATE-MARKER"),
    partial.responseText.slice(0, 300),
  );

  // 21.p — STUDIO REFERENCE IMAGES. An image dropped into the Studio chat is fetched and
  // base64-inlined into the last user message. The SAME image arriving as `document` is
  // protected; arriving as `attachments` it was not — the §58 asymmetry this rule already
  // removed once, reproduced on the adjacent path.
  const attachOpts = {
    kbRejects: true,
    provider: ["private-text"],
    bodyExtras: {
      attachments: [{ url: "https://example.test/ref.png", name: "ref.png", mimeType: "image/png", kind: "image" }],
    },
  };
  const attachClean = await drive({
    personaTenant: CHILD, personaSequence: [CHILD], memberships: [CHILD], ...attachOpts,
  });
  const attachTotal = personaCallsOf(attachClean);
  assert(
    "21.p CONTROL — an attachment-bearing turn is treated as protected",
    attachTotal >= 2,
    `persona calls: ${attachTotal}`,
  );
  const attachAtGate = await drive({
    personaTenant: CHILD,
    personaSequence: Array(Math.max(attachTotal - 1, 1)).fill(CHILD).concat([AGENCY]),
    memberships: [CHILD, AGENCY],
    ...attachOpts,
  });
  assert(
    "21.p a failed final check withholds the reply on an attachment turn",
    !attachAtGate.responseText.includes("CHILD-PRIVATE-MARKER"),
    attachAtGate.responseText.slice(0, 300),
  );

  // 21.q — A FAILING SYNC. 21.g drives only a CLEAN sync, so the failure-shaped `sync_status` —
  // an error from a pipeline that was mid-way through reading the customer's credit report, which
  // the ruling names as a "hidden error" that must not surface while a protected answer is being
  // checked — had no case of its own.
  //
  // §13 — WHAT THIS DOES NOT COVER, because the first version of this comment claimed it did.
  // The transport throw is caught by `runStructuredExtractionAndSync`'s own catch-all, which
  // RETURNS `{ success: false, step: "pipeline" }` rather than rethrowing. So this drives the
  // SUCCESS emit line carrying a failure result, not the caller's `catch` block. That block
  // appears unreachable: every throw inside the helper is already caught there, and reverting
  // its frame to a direct enqueue leaves this suite green. It is routed through the buffer
  // anyway so the shape is right if it ever becomes reachable — but nothing here proves it, and
  // saying otherwise would be the same over-claim as calling the `extraction_proposal` routing
  // tested.
  const syncThrowOpts = {
    chunkContent: "PRIVATE-KB-SOURCE-MARKER",
    bodyExtras: { document: pdfFixture },
    provider: ["read-check", "private-text", "json-extraction"],
    throwOnSync: true,
  };
  const throwClean = await drive({
    personaTenant: CHILD, personaSequence: [CHILD], memberships: [CHILD], ...syncThrowOpts,
  });
  assert(
    "21.q CONTROL — a failing sync really does emit a failure-shaped sync_status frame",
    syncFrames(throwClean.responseText).some((l) => /"success":false/.test(l)),
    syncFrames(throwClean.responseText).join("").slice(0, 300) || throwClean.responseText.slice(-300),
  );
  const throwTotal = personaCallsOf(throwClean);
  const throwAtGate = await drive({
    personaTenant: CHILD,
    personaSequence: Array(throwTotal - 1).fill(CHILD).concat([AGENCY]),
    memberships: [CHILD, AGENCY],
    ...syncThrowOpts,
  });
  assert(
    "21.q a failed final check leaves no failing sync_status in the transcript",
    syncFrames(throwAtGate.responseText).length === 0,
    syncFrames(throwAtGate.responseText).join("").slice(0, 300),
  );

  // 21.r — A TOOL CAN BE A WRITE AND A GENERATOR AT ONCE, and the receipt set has to know the
  // difference. The late-retrieval seam originally borrowed `MUTATING_TOOLS`, which answers "does
  // this write, so must the autonomy gate govern it?" — NOT "is this result free of evidence?"
  // `draft_marketing_content` is in that set and returns copy generated from the tenant's name
  // and brand voice, so an otherwise-ordinary turn calling it stayed unprotected and its reply
  // streamed in whatever workspace was active by the end.
  const draftOpts = {
    kbRejects: true,
    provider: ["draft-content", "private-text"],
    rpcExtras: {
      get_actor_access: { data: { tier: "tenant" }, error: null },
      resolve_tool_autonomy: { data: "auto", error: null },
    },
    tableExtras: { user_roles: () => [{ role: "admin" }] },
  };
  const draftClean = await drive({
    personaTenant: CHILD, personaSequence: [CHILD], memberships: [CHILD], ...draftOpts,
  });
  assert(
    "21.r CONTROL — a content-generating write tool turn still delivers its reply",
    draftClean.responseText.includes("CHILD-PRIVATE-MARKER"),
    draftClean.responseText.slice(0, 250),
  );
  assert(
    "21.r CONTROL — and it carried no protected evidence at entry (Knowledge was refused)",
    !draftClean.telemetry && !!draftClean.logged.find((l) => /KB_FORBIDDEN|REFUSED/.test(l.msg)),
    JSON.stringify({ tel: !!draftClean.telemetry }),
  );
  const draftTotal = personaCallsOf(draftClean);
  assert(
    "21.r a content generator is not a receipt — it switches the turn onto the guarded path",
    draftTotal > 1,
    `persona calls: ${draftTotal} — 1 means it was classified as a write receipt`,
  );
  const draftAtGate = await drive({
    personaTenant: CHILD,
    personaSequence: Array(draftTotal - 1).fill(CHILD).concat([AGENCY]),
    memberships: [CHILD, AGENCY],
    ...draftOpts,
  });
  assert(
    "21.r ...so a failed final check withholds the reply it grounded",
    !draftAtGate.responseText.includes("CHILD-PRIVATE-MARKER"),
    draftAtGate.responseText.slice(0, 300),
  );

  // 21.s — THE ROLLING CONVERSATION SUMMARY. The ninth source, and the strongest argument of the
  // lot: this handler's own close-out comment says a persisted reply is folded into the summary,
  // so it carries forward — verbatim and durably — exactly the replies this rule buffers. It is
  // read thousands of lines BELOW the latch, which is what falsified the claim that every source
  // is read above it, and why the fix is a setter call rather than another list entry.
  const SUMMARY_THREAD = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
  const summaryOpts = {
    kbRejects: true,
    provider: ["private-text"],
    bodyExtras: { threadId: SUMMARY_THREAD },
    tableExtras: {
      paige_chat_threads: () => [{ summary: "Earlier we discussed PRIVATE-SUMMARY-MARKER.", studio_session_id: null }],
    },
  };
  const sumClean = await drive({
    personaTenant: CHILD, personaSequence: [CHILD], memberships: [CHILD], ...summaryOpts,
  });
  assert(
    "21.s CONTROL — the rolling summary really did reach the model prompt",
    sumClean.providerCalls.some((c) => JSON.stringify(c).includes("PRIVATE-SUMMARY-MARKER")),
    JSON.stringify(sumClean.providerCalls).slice(0, 200),
  );
  const sumTotal = personaCallsOf(sumClean);
  assert(
    "21.s CONTROL — and a summary-bearing turn is protected",
    sumTotal >= 2,
    `persona calls: ${sumTotal} — 1 means the guard short-circuited`,
  );
  const sumAtGate = await drive({
    personaTenant: CHILD,
    personaSequence: Array(Math.max(sumTotal - 1, 1)).fill(CHILD).concat([AGENCY]),
    memberships: [CHILD, AGENCY],
    ...summaryOpts,
  });
  assert(
    "21.s a failed final check withholds a reply grounded in the rolling summary",
    !sumAtGate.responseText.includes("CHILD-PRIVATE-MARKER"),
    sumAtGate.responseText.slice(0, 300),
  );

  // 21.t — THE REQUEST-SUPPLIED CLIENT FILE. Up to 50,000 characters interpolated under
  // "CLIENT CONTEXT (VERIFIED DATABASE DATA)". On a funding tenant it is incidentally covered by
  // the client-file source, which is exactly why it needed its own case on a NON-funding one.
  const ctxOpts = {
    kbRejects: true,
    provider: ["private-text"],
    bodyExtras: { clientContext: "Current page: Dashboard. PRIVATE-CLIENTCTX-MARKER" },
  };
  const ctxClean = await drive({
    personaTenant: CHILD, personaSequence: [CHILD], memberships: [CHILD], ...ctxOpts,
  });
  const ctxTotal = personaCallsOf(ctxClean);
  assert(
    "21.t CONTROL — a client-context turn on a NON-funding tenant is protected",
    ctxTotal >= 2,
    `persona calls: ${ctxTotal}`,
  );
  const ctxAtGate = await drive({
    personaTenant: CHILD,
    personaSequence: Array(Math.max(ctxTotal - 1, 1)).fill(CHILD).concat([AGENCY]),
    memberships: [CHILD, AGENCY],
    ...ctxOpts,
  });
  assert(
    "21.t a failed final check withholds the client-context reply",
    !ctxAtGate.responseText.includes("CHILD-PRIVATE-MARKER"),
    ctxAtGate.responseText.slice(0, 300),
  );

  // 21.u — `knowledge_base` full-text hits, the one latch source that had NO fixture in either
  // direction while a commit message claimed all of them were mutation-proven. Deleting this
  // source from the latch leaves the suite green, so this case can only prove the source is
  // WIRED, not that it is independently load-bearing. Said plainly rather than counted as
  // coverage it does not give.
  //
  // §13 — THE REASON PREVIOUSLY GIVEN FOR THAT WAS NOT UNIVERSALLY TRUE, and an independent
  // reviewer caught it. It said: "it only reaches the funding core, so the funding client file
  // protects the same turn." Both halves of that hold only when the client file is non-empty.
  // `buildUserContext` returns "" when it assembles no parts and "" on a thrown query
  // (`_shared/client-context.ts`), so a funding caller with no profile, subscription, tasks,
  // businesses or documents — or one transient query failure — has a truthy `relevantKnowledge`
  // and an empty client file, and on that turn this source is the ONLY protector. The redundancy
  // is real in the common case and absent in the empty-tenant and query-failure cases. It is
  // therefore stated as "the suite cannot distinguish it", which is what is true, rather than
  // as "another source covers it", which is what was written and is not.
  const kbaseOpts = {
    kbRejects: true,
    provider: ["private-text"],
    fundingEnabled: true,
    tableExtras: { knowledge_base: () => [{ title: "PRIVATE-KBTITLE-MARKER", content: "PRIVATE-KBASE-MARKER", summary: null, framework: "f", category: "c" }] },
  };
  const kbaseClean = await drive({
    personaTenant: CHILD, personaSequence: [CHILD], memberships: [CHILD], ...kbaseOpts,
  });
  assert(
    "21.u CONTROL — knowledge_base hits really do reach the funding core prompt",
    kbaseClean.providerCalls.some((c) => JSON.stringify(c).includes("PRIVATE-KBASE-MARKER")),
    JSON.stringify(kbaseClean.providerCalls).slice(0, 200),
  );
  assert(
    "21.u ...and such a turn is protected (subsumed by the client file — see the note)",
    personaCallsOf(kbaseClean) >= 2,
    `persona calls: ${personaCallsOf(kbaseClean)}`,
  );

  // 21.v — THE LIVE TOKEN-FORWARDING BRANCH. Every at-gate scenario above resolves through
  // `finalChunks` — the replayed tool-less round — so `emitContent(controller, value)` on the
  // real streamed closing body, the path an ordinary protected reply's tokens actually flow
  // through, had no test at all. Reverting it to a direct enqueue left the whole suite green.
  // Two failing provider rounds force the closing call, and a third supplies its body.
  const streamOpts = {
    chunkContent: "PRIVATE-KB-SOURCE-MARKER",
    provider: ["two-tools", "fail", "private-text"],
  };
  const streamClean = await drive({
    personaTenant: CHILD, personaSequence: [CHILD], memberships: [CHILD], ...streamOpts,
  });
  assert(
    "21.v CONTROL — the forced-closing shape really does deliver a streamed reply",
    streamClean.responseText.includes("CHILD-PRIVATE-MARKER"),
    streamClean.responseText.slice(-300),
  );
  const streamTotal = personaCallsOf(streamClean);
  const streamAtGate = await drive({
    personaTenant: CHILD,
    personaSequence: Array(streamTotal - 1).fill(CHILD).concat([AGENCY]),
    memberships: [CHILD, AGENCY],
    ...streamOpts,
  });
  assert(
    "21.v a failed final check withholds the STREAMED closing body, not just replayed chunks",
    !streamAtGate.responseText.includes("CHILD-PRIVATE-MARKER"),
    streamAtGate.responseText.slice(0, 400),
  );

  // 21.w — FOUR of the below-the-latch EVIDENCE sources, each asserted by name below: the CRM
  // who-line, the focused client's name, the workspace sending identity, and the activity rail.
  //
  // §13 — this comment used to say FIVE and name the operator briefing among them, while the
  // assertion list held four. `is_platform_operator` was stubbed nowhere in this file, so that
  // briefing was unreachable in every check and deleting its mark was free. Claiming coverage in
  // a comment while the assertion list says otherwise is the sixth incomplete enumeration, and
  // it was inside the test written to end them. The briefing now has its own case, 21.w2,
  // driven tenant-less because that is the only shape that reaches it.
  //
  // The rail is chosen because it is the richest: up to fifteen activity titles for one named
  // client, read from storage. It also proves the general setter works from a call site far from
  // the tool seam, which is what the rolling-summary case established and this confirms is not a
  // one-off.
  const RAIL_CLIENT = "ffffffff-ffff-4fff-8fff-ffffffffffff";
  const railOpts = {
    kbRejects: true,
    provider: ["private-text"],
    bodyExtras: { clientId: RAIL_CLIENT },
    rpcExtras: {
      get_actor_access: { data: { tier: "tenant" }, error: null },
      // The client-scope authorization compares the client's tenant against this resolver;
      // unstubbed it returns null and every client-scoped turn is refused before the persona
      // resolution even runs.
      current_user_tenant_id: { data: CHILD, error: null },
      // The CRM who-line is an owner/admin context (C0a: a tenant seat in this workspace).
      studio_role_ok: { data: true, error: null },
      // …asked of the acting workspace explicitly (C0a: one verdict about one workspace).
      is_tenant_admin_as: { data: true, error: null },
      is_platform_owner: { data: false, error: null },
      tenant_sender_identity: { data: [{ from_name: "PRIVATE-SENDER-MARKER Coaching", from_address: "private-sender-marker@ada.test" }], error: null },
      // The rail arrives through an RPC, not a table read. #804 moved this seam from
      // `get_client_rail` to the minimum-evidence `get_client_rail_for_chat`; the mock name must
      // track it, or hydration silently yields no rows and 21.w fails because the turn is never
      // marked protected. That is exactly how it was caught.
      get_client_rail_for_chat: { data: [{ event_kind: "note.added", title: "PRIVATE-RAIL-MARKER call notes", occurred_at: new Date().toISOString() }], error: null },
    },
    tableExtras: {
      clients: () => [{ id: RAIL_CLIENT, tenant_id: CHILD, linked_user_id: USER, first_name: "PRIVATE-CLIENTNAME-MARKER", last_name: "Lovelace" }],
      // The operator's own name; without it `whoLine` is empty and that site never fires.
      profiles: () => [{ active_tenant_id: CHILD, first_name: "PRIVATE-OPERATORNAME-MARKER", last_name: "Rivera", full_name: "PRIVATE-OPERATORNAME-MARKER Rivera" }],
    },
  };
  const railClean = await drive({
    personaTenant: CHILD, personaSequence: [CHILD], memberships: [CHILD], ...railOpts,
  });
  const railTotal = personaCallsOf(railClean);
  assert(
    "21.w CONTROL — a client-scoped turn with rail activity is protected",
    railTotal >= 2,
    `persona calls: ${railTotal}`,
  );
  // EACH SITE, BY NAME. "The turn is protected" is satisfied by any ONE of the five firing, so
  // removing four of them changed nothing measurable and the mutations passed — the first
  // version of this case asserted exactly that and was wrong to. The handler now logs every
  // call rather than only the first, so each site is provable on its own and deleting any one
  // fails here with its own name in the message.
  const lateReasons = railClean.logged
    .filter((l) => /protected evidence reached the model/.test(l.msg))
    .map((l) => (l.msg.match(/"reason":"([^"]+)"/) ?? [])[1])
    .filter(Boolean);
  for (const reason of ["crm_operator_who_line", "focused_client_name", "tenant_sender_identity", "client_activity_rail"]) {
    assert(
      `21.w the ${reason} source marks the turn protected`,
      lateReasons.includes(reason),
      `saw: ${lateReasons.join(", ") || "(none)"}`,
    );
  }
  const railAtGate = await drive({
    personaTenant: CHILD,
    personaSequence: Array(Math.max(railTotal - 1, 1)).fill(CHILD).concat([AGENCY]),
    memberships: [CHILD, AGENCY],
    ...railOpts,
  });
  assert(
    "21.w a failed final check withholds the reply on a client-scoped turn",
    !railAtGate.responseText.includes("CHILD-PRIVATE-MARKER"),
    railAtGate.responseText.slice(0, 300),
  );
  // AND IT RUNS THE CLASSIFIER. This case had exactly one at-gate assertion — a substring search
  // for the reply marker — so it never invoked `nonNeutralFrames` at all. A MARKED rail title
  // riding a live neutral frame passed the whole suite: the derived-marker mechanism only
  // protects the drives that actually call it, which is hand-maintained coverage one layer down
  // from the hand-maintained token list it replaced.
  assert(
    "21.w ...and no non-neutral frame survives",
    nonNeutralFrames(railAtGate.responseText).length === 0,
    JSON.stringify(nonNeutralFrames(railAtGate.responseText)).slice(0, 300),
  );

  // 21.x — THE REVALIDATION RESOLVER MUST RUN ON THE JWT CLIENT. This file's own header claims
  // "the fake records WHICH client made each call, so 'the JWT-scoped guard is engaged' is
  // proven, not assumed" — and that was true of exactly one call, `match_tenant_knowledge`. The
  // `get_paige_persona_context` call the entire safety-first gate rests on had no client-kind
  // assertion at all, so moving it to the SERVICE client was green. Under service-role
  // `auth.uid()` is NULL, which is the precise exemption the original defect turned on: the
  // resolver would stop resolving the caller and start resolving nobody.
  const jwtProbe = await drive({
    personaTenant: CHILD, personaSequence: [CHILD], memberships: [CHILD],
    chunkContent: "PRIVATE-KB-SOURCE-MARKER", provider: ["private-text"],
  });
  const personaCalls = jwtProbe.rec.rpc.filter((c) => c.name === "get_paige_persona_context");
  assert(
    "21.x CONTROL — the revalidation resolver is actually called on this turn",
    personaCalls.length >= 2,
    `persona calls: ${personaCalls.length}`,
  );
  assert(
    "21.x every persona-context resolution runs on the JWT client, never service-role",
    personaCalls.every((c) => c.client === "jwt"),
    JSON.stringify(personaCalls.map((c) => c.client)),
  );

  // 21.y — A RECEIPT-NAMED TOOL THAT COMES BACK WITH RECORDS. `crm_create_contact` is a receipt
  // on its success path — an id and an echo of the model's own arguments — and genuinely belongs
  // in the set for that. On its deduplication branch it returns `matches: [...]`: real contact
  // names, email addresses, phone numbers, lifecycle stages and creation dates, read out of the
  // tenant's book. A name-based classification cannot express "this tool sometimes reads", and
  // that is the second time the name half alone was wrong.
  const dedupOpts = {
    kbRejects: true,
    provider: ["dedup-contact", "private-text"],
    rpcExtras: {
      get_actor_access: { data: { tier: "tenant" }, error: null },
      resolve_tool_autonomy: { data: "auto", error: null },
      // The near-match the branch hands back instead of inserting.
      find_duplicate_contacts: { data: [{ id: "aaaa1111-2222-4333-8444-555566667777", first_name: "Ada", last_name: "Lovelace", email: "ada@example.test", phone: "+15550001111", lifecycle_stage: "client", source: "referral", created_at: "2026-01-01T00:00:00Z", email_exact: true }], error: null },
    },
    tableExtras: { user_roles: () => [{ role: "admin" }] },
    functionExtras: { "crm-command": { data: { ok: true, outcome: "succeeded", readback: { id: "aaaa1111-2222-4333-8444-555566667777", display_name: "PRIVATE-CONTACT-READBACK-MARKER" }, receipt_recorded: true }, error: null } },
  };
  const dedupClean = await drive({
    personaTenant: CHILD, personaSequence: [CHILD], memberships: [CHILD], ...dedupOpts,
  });
  assert(
    "21.y CONTROL — canonical contact creation handed durable readback to the model",
    dedupClean.providerCalls.some((c) => JSON.stringify(c).includes("PRIVATE-CONTACT-READBACK-MARKER")),
    JSON.stringify(dedupClean.providerCalls).slice(-300),
  );
  const dedupTotal = personaCallsOf(dedupClean);
  assert(
    "21.y a canonical CRM tool that returns durable readback protects the turn",
    dedupTotal > 1,
    `persona calls: ${dedupTotal} — 1 means the name alone decided it`,
  );
  const dedupAtGate = await drive({
    personaTenant: CHILD,
    personaSequence: Array(Math.max(dedupTotal - 1, 1)).fill(CHILD).concat([AGENCY]),
    memberships: [CHILD, AGENCY],
    ...dedupOpts,
  });
  assert(
    "21.y ...so a failed final check withholds the reply it grounded",
    !dedupAtGate.responseText.includes("CHILD-PRIVATE-MARKER"),
    dedupAtGate.responseText.slice(0, 300),
  );

  // 21.w2 — THE §52 OPERATOR BRIEFING, which 21.w's own comment and the README both claimed it
  // covered. It did not: `is_platform_operator` was never stubbed anywhere in this file, so
  // `loadOwnerContextBlock` was unreachable in all 320 checks and deleting its mark was free.
  // That is the sixth incomplete enumeration, and it was inside the test written to end them.
  //
  // The briefing carries `paige_owner_memory` rows and live platform metrics — read per turn,
  // for the operator, and reachable in production even though nothing here reached it.
  const briefingOpts = {
    kbRejects: true,
    provider: ["private-text"],
    rpcExtras: { is_platform_operator: { data: true, error: null } },
    tableExtras: {
      paige_owner_memory: () => [{
        memory_type: "priority", title: "Q3 focus",
        content: "PRIVATE-OWNERMEM-MARKER — ship the isolation work.",
        created_at: new Date().toISOString(),
      }],
    },
  };
  // TENANT-LESS, because the briefing is gated on `personaCtx.tenant_id == null` — it is the
  // operator's surface. That also makes it the ONLY protected source on the turn: a tenant-less
  // caller retrieves no Knowledge, so nothing else can be doing the work.
  const briefClean = await drive({
    personaTenant: null, personaSequence: [null], memberships: [], ...briefingOpts,
  });
  const briefReasons = briefClean.logged
    .filter((l) => /protected evidence reached the model/.test(l.msg))
    .map((l) => (l.msg.match(/"reason":"([^"]+)"/) ?? [])[1]).filter(Boolean);
  assert(
    "21.w2 CONTROL — the operator briefing is actually reached on an operator turn",
    briefReasons.includes("operator_context_block"),
    `saw: ${briefReasons.join(", ") || "(none)"}`,
  );
  const briefTotal = personaCallsOf(briefClean);
  assert(
    "21.w2 an operator-briefing turn is protected",
    briefTotal >= 2,
    `persona calls: ${briefTotal}`,
  );
  const briefAtGate = await drive({
    personaTenant: null,
    personaSequence: Array(Math.max(briefTotal - 1, 1)).fill(null).concat([AGENCY]),
    memberships: [AGENCY],
    ...briefingOpts,
  });
  assert(
    "21.w2 a failed final check withholds the operator-briefing reply",
    !briefAtGate.responseText.includes("CHILD-PRIVATE-MARKER"),
    briefAtGate.responseText.slice(0, 300),
  );
  assert(
    "21.w2 ...and no non-neutral frame survives",
    nonNeutralFrames(briefAtGate.responseText).length === 0,
    JSON.stringify(nonNeutralFrames(briefAtGate.responseText)).slice(0, 300),
  );

  // 21.aa — THE AGENTIC PATH'S TRANSCRIPT WRITE. Group 19 asserts `paige_chat_turn_append` on the
  // DOCUMENT path, with the comment "withholding a reply from the wire while saving it to the
  // database is not a refusal" — and the agentic twin of that property had zero assertions. The
  // code is correct; a two-line probe caught what 320 checks did not, which is the whole reason
  // this round exists. Correct-but-unmeasured is the standard thirteen rounds have turned on.
  const AGENTIC_THREAD = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const persistOpts = {
    chunkContent: "PRIVATE-KB-SOURCE-MARKER",
    provider: ["private-text"],
    bodyExtras: { threadId: AGENTIC_THREAD },
    tableExtras: { paige_chat_threads: () => [{ summary: null, studio_session_id: null }] },
  };
  const assistantAppends = (r) => r.rec.rpc.filter(
    (c) => c.name === "paige_chat_turn_append" && c.args?.p_role === "assistant");
  const persistClean = await drive({
    personaTenant: CHILD, personaSequence: [CHILD], memberships: [CHILD], ...persistOpts,
  });
  assert(
    "21.aa CONTROL — a clean agentic turn DOES persist its assistant reply",
    assistantAppends(persistClean).length > 0,
    JSON.stringify(persistClean.rec.rpc.map((c) => c.name)),
  );
  const persistTotal = personaCallsOf(persistClean);
  const persistAtGate = await drive({
    personaTenant: CHILD,
    personaSequence: Array(persistTotal - 1).fill(CHILD).concat([AGENCY]),
    memberships: [CHILD, AGENCY],
    ...persistOpts,
  });
  assert(
    "21.aa a refused agentic turn persists NO assistant reply to the thread",
    assistantAppends(persistAtGate).length === 0,
    JSON.stringify(assistantAppends(persistAtGate).map((c) => c.args?.p_content ?? "").join(" ").slice(0, 200)),
  );

  // 21.ab — A RESOLVER THAT THROWS, not one that returns an error. Every scenario drove
  // `{ data: null, error }`; a rejected `rpc()` — transport failure, a PostgREST 5xx — took the
  // catch, and nothing held that branch closed. The file claims "missing, changed, malformed, or
  // revoked scope fails closed before model egress"; a throw is "missing" and was untested.
  const thrower = () => { throw new Error("simulated resolver transport failure"); };
  const thrown = await drive({
    personaTenant: CHILD,
    personaSequence: [CHILD, thrower],
    memberships: [CHILD],
    chunkContent: "PRIVATE-KB-SOURCE-MARKER", provider: ["private-text"],
  });
  assert(
    "21.ab a resolver that THROWS fails closed, like one that errors",
    !thrown.responseText.includes("CHILD-PRIVATE-MARKER"),
    thrown.responseText.slice(0, 300),
  );
  assert(
    "21.ab ...and no non-neutral frame survives",
    nonNeutralFrames(thrown.responseText).length === 0,
    JSON.stringify(nonNeutralFrames(thrown.responseText)).slice(0, 300),
  );

  // 21.ac — TEXT FETCHED FROM A URL THIS TURN. The tenth entry-time source, missed by nine
  // sweeps because it is FETCHED rather than queried — and fetched with the CALLER'S auth
  // header, so a signed storage URL for a tenant document puts document-derived text straight
  // into the prompt.
  const urlOpts = {
    kbRejects: true,
    provider: ["private-text"],
    userMessage: "summarise https://example.test/doc for me",
    // The fetch is now TIER-GATED: a client-portal seat pasting a link no longer makes this server
    // fetch it. `getActorTier` fails closed to `client`, so without this stub the drive resolves to
    // a client seat, no fetch happens, and this group's own control fails — which is how the gate
    // proved load-bearing the moment it landed. An OWNER-tier caller is what these checks are about.
    rpcExtras: { get_actor_access: { data: { tier: "tenant" }, error: null } },
  };
  const urlClean = await drive({
    personaTenant: CHILD, personaSequence: [CHILD], memberships: [CHILD], ...urlOpts,
  });
  assert(
    "21.ac CONTROL — the fetched page body really did reach the model prompt",
    urlClean.providerCalls.some((c) => JSON.stringify(c).includes("PRIVATE-FETCHEDURL-MARKER")),
    JSON.stringify(urlClean.providerCalls).slice(0, 200),
  );
  // 21.ac2 — THE TIER GATE ON THE FETCH ITSELF.
  //
  // This ran BEFORE the tier was resolved, so it sat outside the client-seat tool allowlist
  // entirely: a portal client pasting a link made this server fetch it, on a seat permitted exactly
  // two tools, neither of which is this. The tier resolves before the fetch now.
  const urlAsClient = await drive({
    personaTenant: CHILD, personaSequence: [CHILD], memberships: [CHILD],
    kbRejects: true, provider: ["private-text"],
    userMessage: "summarise https://example.test/doc for me",
    rpcExtras: { get_actor_access: { data: { tier: "client" }, error: null } },
  });
  assert(
    "21.ac2 a CLIENT seat pasting a link triggers no server-side fetch",
    !urlAsClient.providerCalls.some((c) => JSON.stringify(c).includes("PRIVATE-FETCHEDURL-MARKER")),
    JSON.stringify(urlAsClient.providerCalls).slice(0, 200),
  );

  const urlTotal = personaCallsOf(urlClean);
  assert(
    "21.ac CONTROL — and such a turn is protected",
    urlTotal >= 2,
    `persona calls: ${urlTotal}`,
  );
  const urlAtGate = await drive({
    personaTenant: CHILD,
    personaSequence: Array(Math.max(urlTotal - 1, 1)).fill(CHILD).concat([AGENCY]),
    memberships: [CHILD, AGENCY],
    ...urlOpts,
  });
  assert(
    "21.ac a failed final check withholds a reply grounded in fetched URL text",
    !urlAtGate.responseText.includes("CHILD-PRIVATE-MARKER"),
    urlAtGate.responseText.slice(0, 300),
  );

  // 21.ad — THE CLIENT-SCOPE REFUSAL FRAME, whose two written promises had no test: "WITHOUT the
  // rejected id or any client field" and "never the rejected identifier". Exactly one drive
  // supplied a `clientId` and it was configured to SUCCEED, so `clientScopeDenied` was true in no
  // drive and no refusal frame was ever produced. Two classifier blind spots would also have
  // hidden a leaked id — the reason is checked only for type and a 64-char bound (a UUID is 36),
  // and the single-key check is top-level, so `{client_scope:{status,reason,id}}` is one key.
  //
  // §13 — WHICH OF THE EMITS THIS COVERS, because writing "the refusal frame" would imply all of
  // them. It covers the EARLY-RETURN one, on the refusal stream. There are FOUR sites in total,
  // not the three a previous version of this note counted: the refusal stream, the summary-mode
  // JSON response beside it, the agentic stream and the document stream. The miscount came from
  // counting only the SSE emits and forgetting that summary mode returns JSON rather than a
  // stream — in a note whose whole subject is not overstating what is covered.
  //
  // §13 — AND THE REACHABILITY CLAIM WAS ALSO WRONG, in the correction written to fix the count.
  // It said "the other three appear UNREACHABLE". The summary-mode JSON refusal is INSIDE the
  // choke-point block, above its return, and it fires: an independent reviewer drove it and got
  // `{"summary":"","client_scope":{"status":"refused",…}}` at status 200 with zero provider
  // calls, and `client-memory-authz` check 9.4 already asserts that exact response. So TWO of the
  // four sites are live (the refusal stream and the summary-mode JSON inside the same block) and
  // two are dead (the agentic and document stream emits, both below the return).
  //
  // The branch count was wrong in the other direction. LITERAL `if (clientScopeDenied)` statements
  // after the choke point: six. "Half a dozen" — the phrasing this comment replaced — was right,
  // and the correction replaced a correct number with a wrong one. Eleven is the count of ALL
  // `clientScopeDenied` REFERENCES after it, which includes the two dead emits, so writing "those
  // emits AND the eleven branches" asserted more dominated references than exist.
  //
  // Six dominated `if` statements; two dead emits among eleven dominated references. Counted by
  // grep, twice, in a note whose entire subject is having miscounted.
  //
  // Evidence rather than reading: planting the rejected id into the agentic emit and into the
  // document emit each left the suite at 335/0, while planting it here failed 2 checks. A
  // mutation that changes nothing observable in a suite that otherwise catches this exact leak
  // is what unreachable looks like from the outside. Filed separately; not claimed as covered.
  const FOREIGN_CLIENT = "cccccccc-1111-4ccc-8ccc-cccccccccccc";
  const denied = await drive({
    personaTenant: CHILD, personaSequence: [CHILD], memberships: [CHILD],
    kbRejects: true, provider: ["private-text"],
    bodyExtras: { clientId: FOREIGN_CLIENT },
    rpcExtras: { current_user_tenant_id: { data: CHILD, error: null }, is_platform_owner: { data: false, error: null } },
    // The client belongs to ANOTHER workspace, so authorization refuses.
    tableExtras: { clients: () => [{ id: FOREIGN_CLIENT, tenant_id: AGENCY, linked_user_id: USER, first_name: "Foreign", last_name: "Person" }] },
  });
  const scopeFrames = denied.responseText.split("\n").filter((l) => l.startsWith("data: ") && l.includes("client_scope"));
  // §13 — WHY THE CONTROL IS THREE ASSERTIONS AND NOT "a frame is present". An independent
  // reviewer deleted the §9 choke point outright (`if (clientScopeDenied)` → `if (false)`) and
  // this group stayed 335/0 — because the emit that is normally dead then becomes LIVE and
  // supplies exactly the frame a presence-check looks for. The transcript under that mutation
  // carried a full model round and the private marker on an unauthorized-client turn, and the
  // control could not tell that from a correct refusal. Presence of the frame was never the
  // property; the property is that the turn STOPS. So the control now asserts what stopping
  // looks like from outside: the refusal SENTENCE reaches the caller, and NO provider call is
  // made at all. Either one alone fails under that mutation.
  assert(
    "21.ad CONTROL — a foreign client id really does produce the refusal frame",
    scopeFrames.length > 0,
    denied.responseText.slice(0, 400),
  );
  assert(
    "21.ad CONTROL — the refusal SENTENCE reaches the caller, not just a status frame",
    denied.responseText.includes("I couldn't confirm that this client belongs to your workspace"),
    denied.responseText.slice(0, 400),
  );
  assert(
    "21.ad CONTROL — the turn ends BEFORE any model egress on an unauthorized client",
    denied.providerCalls.length === 0,
    `provider calls: ${denied.providerCalls.length}`,
  );
  assert(
    "21.ad the refusal frame never carries the rejected client id",
    !scopeFrames.join("").includes(FOREIGN_CLIENT),
    scopeFrames.join("").slice(0, 300),
  );
  assert(
    "21.ad ...and the whole transcript never carries it either",
    !denied.responseText.includes(FOREIGN_CLIENT),
    denied.responseText.slice(0, 300),
  );

  // 21.ae — A SMALL, FLAT TENANT READ-BACK. `deal_move_stage` returns `stage: stage.label`, read
  // out of `pipeline_stages` — not a list, well under the size bound, and therefore invisible to
  // both shape criteria. Third miss in a row on the same question, which is what established
  // that a heuristic about SHAPE was never going to answer it: a true receipt ECHOES, and a value in
  // the result that is not in the arguments came from storage.
  const dealOpts = {
    kbRejects: true,
    provider: ["deal-stage", "private-text"],
    rpcExtras: {
      get_actor_access: { data: { tier: "tenant" }, error: null },
      resolve_tool_autonomy: { data: "auto", error: null },
      current_user_tenant_id: { data: CHILD, error: null },
      is_platform_owner: { data: false, error: null },
    },
    functionExtras: { "crm-command": { data: { ok: true, outcome: "succeeded", readback: { id: "dddd2222-3333-4444-8555-666677778888", stage: "PRIVATE-STAGELABEL-MARKER" }, receipt_recorded: true }, error: null } },
    tableExtras: {
      user_roles: () => [{ role: "admin" }],
      // The label the model never supplied — the whole point of the case.
      pipeline_stages: () => [{ id: "eeee2222-3333-4444-8555-666677778888", label: "PRIVATE-STAGELABEL-MARKER", pipeline_id: "ffff2222-3333-4444-8555-666677778888" }],
      deals: () => [{ id: "dddd2222-3333-4444-8555-666677778888", tenant_id: CHILD, stage_id: "eeee2222-3333-4444-8555-666677778888" }],
    },
  };
  const dealClean = await drive({
    personaTenant: CHILD, personaSequence: [CHILD], memberships: [CHILD], ...dealOpts,
  });
  const dealTotal = personaCallsOf(dealClean);
  assert(
    "21.ae a canonical CRM tool returning an UNECHOED value protects the turn",
    dealTotal > 1,
    `persona calls: ${dealTotal} — 1 means a small flat read-back passed as a receipt`,
  );
  const dealAtGate = await drive({
    personaTenant: CHILD,
    personaSequence: Array(Math.max(dealTotal - 1, 1)).fill(CHILD).concat([AGENCY]),
    memberships: [CHILD, AGENCY],
    ...dealOpts,
  });
  assert(
    "21.ae ...so a failed final check withholds the reply it grounded",
    !dealAtGate.responseText.includes("CHILD-PRIVATE-MARKER"),
    dealAtGate.responseText.slice(0, 300),
  );
}

// ── 21z · The receipt set, asserted on its CONTENTS ──────────────────────────────
//
// Membership of `TOOL_RESULT_IS_RECEIPT` decides whether a tool result switches the turn onto
// the protected path, and only two tools in this whole file drive it — so adding a genuine READ
// tool to the set, or adding the generators the comment says "deliberately land" outside it, was
// free: both mutations left the suite fully green. Driving a fixture per tool is not realistic;
// asserting the SET is, and it catches exactly the drift the inverted design exists to prevent.
//
// Read from the handler's source rather than exported, because exporting it would change the
// shipped module's shape to suit a test.
group("the tool-result receipt set");
{
  const HANDLER_SRC = (await import("node:fs")).readFileSync(
    new URL("../../supabase/functions/paige-ai-chat/index.ts", import.meta.url), "utf8");
  const block = HANDLER_SRC.slice(
    HANDLER_SRC.indexOf("const TOOL_RESULT_IS_RECEIPT = new Set<string>(["),
    HANDLER_SRC.indexOf("const markProtectedLate"),
  );
  assert("21z.1 CONTROL — the receipt set literal was located in the handler",
    block.length > 100 && block.includes("new Set<string>(["), `block length ${block.length}`);
  // Tools whose result carries evidence — read back from tenant storage, generated from tenant
  // branding, or an unbounded spread of whatever an external system returned. None may be a
  // receipt. `draft_marketing_content` is here because it already shipped as a receipt once.
  for (const tool of [
    "draft_marketing_content", "growth_funnel_build",
    "n8n_run_workflow", "n8n_create_workflow", "n8n_update_workflow", "zapier_run_action",
    "crm_search_contacts", "crm_get_contact_summary", "crm_list_deals", "crm_list_tasks",
    "crm_pipeline_summary", "growth_list", "plan_list", "action_list", "action_get",
    "get_client_rail", "delegate_to_subagent", "deep_research", "web_fetch", "list_event_kinds",
    "crm_create_contact", "crm_update_contact", "deal_create", "deal_move_stage",
    "crm_create_task", "crm_log_activity",
  ]) {
    assert(`21z ${tool} is NOT classified as a write receipt`,
      !new RegExp(`"${tool}"`).test(block), `found "${tool}" inside the receipt set`);
  }
  // And the set must not be empty — an empty set makes every tool evidence, which is safe but
  // means the classification is doing nothing and the next reader will "restore" it blind.
  assert("21z.2 the receipt set is non-empty",
    (block.match(/"[a-z0-9_]+"/g) ?? []).length >= 20,
    `entries: ${(block.match(/"[a-z0-9_]+"/g) ?? []).length}`);
}

// ── 22 · The classifier itself ───────────────────────────────────────────────────
//
// EVERY CHECK IN GROUPS 20 AND 21 RESTS ON `nonNeutralFrames`, and until now NOTHING TESTED IT.
// An independent review deleted each of its six branches in turn and the whole suite stayed
// green — so the instrument the safety property is measured with was itself unmeasured. It is
// also the third place on this branch where the thing meant to catch a miss had the same miss
// inside it, which is why it now gets direct positive/negative fixtures instead of being trusted
// because the assertions built on it pass.
// ── 23 · TRACE ATTRIBUTION (§34 observability, §9 attribution) ───────────────────────────────
// `gatewayCompat` writes the prompt and the reply to `paige_llm_trace` on every call. On a
// protected turn those rows carry the Knowledge, the document text, the memory and the client
// file, so WHICH TENANT THEY ARE FILED UNDER is a scope question, not a telemetry one: an
// untenanted row is a PLATFORM row (`llm-trace.ts` `cleanTenantId`: "NULL = platform/system row"),
// i.e. tenant evidence sitting outside tenant scope entirely.
//
// WHY THIS GROUP EXISTS. Eight of the nine call sites passed no trace context for several
// releases while a comment asserted they were stamped. That was fixed — and the fix had NO test.
// An independent reviewer drove six mutations against it, including reverting the exact hazard the
// fix's own comment names (making `traceFor` take a definition-time snapshot, which re-freezes the
// nulls), and every one of them left the suite fully green. A repair with no pin is a repair that
// gets undone.
//
// The assertion is the exact MULTISET of (job_kind, attributed?) pairs, not a count and not "some
// row has a tenant". A count survives a site being mislabelled; "some row" survives seven of eight
// going null. The multiset fails on: the stamp being deleted, any single site reverting to
// unstamped, the snapshot regression, and a site being given the wrong job_kind.
group("every provider call files its trace row under the tenant whose evidence it carries");
{
  const traceRows = (r) => r.rec.inserts
    .filter((i) => i.table === "paige_llm_trace")
    .map((i) => `${i.row?.job_kind ?? "?"}:${i.row?.tenant_id ? "tenant" : "PLATFORM"}`)
    .sort();

  // A plain protected chat turn with a tool round: entry call, loop continuation, closing call.
  const chatTurn = await drive({
    personaTenant: CHILD, personaSequence: [CHILD], memberships: [CHILD],
    chunkContent: "CHILD-PRIVATE-MARKER",
    // TWO tool rounds then text, deliberately: a single round never reaches the CLOSING call, so
    // `["tool","text"]` pins only two of the three sites and would have let a `chat-close`
    // regression through. Measured, not assumed — driven across four shapes before choosing this
    // one, and the one-round shape really does produce only two rows.
    provider: ["tool", "tool", "text"],
    rpcExtras: {
      get_actor_access: { data: { tier: "tenant" }, error: null },
      resolve_tool_autonomy: { data: "auto", error: null },
    },
  });
  assert(
    "23.1 CONTROL — a protected chat turn really does write trace rows",
    traceRows(chatTurn).length > 0,
    JSON.stringify(chatTurn.rec.inserts.map((i) => i.table)),
  );
  assert(
    "23.2 every trace row on a resolved-tenant chat turn is ATTRIBUTED, and to the right job",
    // INT-334 R4 — a fresh chat turn also runs the turn classifier, after the account is verified, and
    // its row is attributed to the same tenant like every other call on the turn.
    JSON.stringify(traceRows(chatTurn)) === JSON.stringify(["chat-close:tenant", "chat-tool-loop:tenant", "chat:tenant", "turn-classify:tenant"]),
    JSON.stringify(traceRows(chatTurn)),
  );

  // A credit-report document turn: the read-check runs BEFORE persona resolution and is therefore
  // honestly a platform row; the chat call and the extraction run after it and must be attributed.
  // This pair is the whole point — it pins the split rather than asserting "all rows are stamped",
  // which would be false, or "some rows are stamped", which would be satisfied by the defect.
  const docTurn = await drive({
    personaTenant: CHILD, personaSequence: [CHILD], memberships: [CHILD],
    chunkContent: "PRIVATE-KB-SOURCE-MARKER",
    bodyExtras: { document: { fileName: "PRIVATE-PDFNAME-MARKER.pdf", mimeType: "application/pdf", kind: "pdf", base64: "AA==" } },
    provider: ["read-check", "private-text", "json-extraction"],
  });
  assert(
    "23.3 a document turn attributes the post-resolution calls and leaves ONLY the pre-resolution read-check on the platform",
    JSON.stringify(traceRows(docTurn)) === JSON.stringify(["chat:tenant", "credit-report-extraction:tenant", "document-read-check:PLATFORM"]),
    JSON.stringify(traceRows(docTurn)),
  );

  // #1255 Option A (Codex P2) — a GENERAL-document (docx) turn. Unlike the credit-report PDF above
  // it has NO pre-resolution read-check, so BOTH of its provider calls run post-resolution and BOTH
  // must be tenant-attributed by their OWN job_kind: the deferred structured-field extraction as
  // `general-document-extraction`, the streamed reply as `chat`. Before Option A the extraction ran
  // through gatewayCompat with no trace arg, so it booked as an unattributed `chat:PLATFORM` row and
  // its model spend was missing from tenant trace/budget accounting. This pins the split by job_kind
  // (not "some row has a tenant"): it fails if the extraction reverts to a platform/unattributed row
  // OR is given the wrong job_kind. (traceRows() sorts, so the order is alphabetical.)
  const generalDocTurn = await drive({
    personaTenant: CHILD, personaSequence: [CHILD], memberships: [CHILD],
    chunkContent: "PRIVATE-KB-SOURCE-MARKER",
    bodyExtras: { document: { fileName: "operating-notes.docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", kind: "docx", textContent: "PRIVATE-DOCTEXT-MARKER internal operating notes" } },
    provider: ["private-text", "private-text"],
  });
  assert(
    "23.4 a general-document turn attributes BOTH provider calls to the tenant by distinct job_kind — the deferred extraction is general-document-extraction:tenant, never an unattributed platform row",
    JSON.stringify(traceRows(generalDocTurn)) === JSON.stringify(["chat:tenant", "general-document-extraction:tenant"]),
    JSON.stringify(traceRows(generalDocTurn)),
  );
}

group("the neutral-frame classifier itself");
{
  const f = (o) => `data: ${JSON.stringify(o)}\n\n`;
  const isNeutral = (line) => nonNeutralFrames(line).length === 0;

  // The count is not pinned to a number: pinning it means every new fixture marker fails this
  // assertion and gets "fixed" by bumping a literal, which is how a self-maintaining list stops
  // maintaining itself. What is pinned is that discovery WORKS and that the markers the newest
  // sources depend on are actually in it — the two that were missing when this was hand-written.
  assert("22.1 marker discovery found every fixture marker in this file",
    DISCOVERED_MARKERS.length >= 6 &&
      ["CHILD-PRIVATE-MARKER", "PRIVATE-MEMORY-MARKER", "PRIVATE-PDF-MARKER", "PRIVATE-SUMMARY-MARKER"]
        .every((m) => DISCOVERED_MARKERS.includes(m)),
    DISCOVERED_MARKERS.join(", "));

  // Neutral, and must stay so — otherwise every "no non-neutral frame survives" assertion in
  // groups 20 and 21 would pass by classifying the whole transcript as a leak.
  assert("22.2 a plain action step is neutral",
    isNeutral(f({ paige_step: { kind: "action", label: "Working on that", detail: "3 found" } })), "");
  // C2b — a tool's START (and a START taken back) is the same fixed vocabulary: a present-tense label,
  // never a detail. Sent direct like any action step, so it must classify neutral.
  assert("22.2b a running action step with a fixed label, and its withdrawal, are neutral",
    isNeutral(f({ paige_step: { id: "0:0:0:toolu_1", round: 0, seq: 1, kind: "action", label: "Searching the web", group: "shared", status: "running", ts: 3 } }))
      && isNeutral(f({ paige_step: { id: "0:0:0:toolu_1", round: 0, seq: 1, kind: "action", label: "Searching the web", group: "shared", status: "withdrawn", ts: 9 } })), "");
  assert("22.3 a phase marker is neutral", isNeutral(f({ paige_phase: "writing" })), "");
  assert("22.4 a compaction frame is neutral", isNeutral(f({ paige_compacting: { state: "folding", pct: 42 } })), "");
  assert("22.5 the fixed client-scope category is neutral",
    isNeutral(f({ client_scope: { status: "refused", reason: "client_not_authorized" } })), "");
  assert("22.6 the refusal sentence is neutral",
    isNeutral(f({ choices: [{ delta: { content: "Your active workspace changed, so I stopped here." } }] })), "");
  assert("22.7 the [DONE] sentinel is neutral", isNeutral("data: [DONE]\n\n"), "");

  // Non-neutral. Each of these is a mutation an independent review actually ran against the
  // shipped code and watched survive 250/0.
  assert("22.8 a thought step is protected",
    !isNeutral(f({ paige_step: { kind: "thought", label: "Checking the note" } })), "");
  assert("22.9 evidence hidden in a phase frame is protected",
    !isNeutral(f({ paige_phase: "PRIVATE-MEMORY-MARKER" })), "");
  assert("22.10 evidence hidden in a client_scope reason is protected",
    !isNeutral(f({ client_scope: { status: "refused", reason: "PRIVATE-PDF-MARKER.pdf" } })), "");
  assert("22.11 evidence hidden in an action step LABEL is protected",
    !isNeutral(f({ paige_step: { kind: "action", label: "PRIVATE-MEMORY-MARKER EQ 712 EX 705 TU 698" } })), "");
  assert("22.12 evidence hidden in an action step DETAIL is protected",
    !isNeutral(f({ paige_step: { kind: "action", label: "Working on that", detail: "PRIVATE-MEMORY-MARKER EQ 712" } })), "");
  // ONLY the `choices` branch catches this: ordinary reply text, no marker, no refusal phrase.
  // 22.13 below is caught by the marker scan and 22.6 passes either way, so deleting that branch
  // — the one guarding the primary leak channel — was green until this case existed.
  assert("22.12b any reply content that is not the refusal sentence is protected",
    !isNeutral(f({ choices: [{ delta: { content: "Here is what I found in your file." } }] })), "");
  assert("22.13 evidence smuggled beside the refusal sentence is protected",
    !isNeutral(f({ choices: [{ delta: { content: "workspace changed PRIVATE-MEMORY-MARKER EQ 712" } }] })), "");
  // NO MARKER in this one, deliberately. With a marker the frame is caught by the marker scan
  // instead, and deleting the compaction shape check alone left the suite green — the assertion
  // passed without ever exercising the branch it names.
  assert("22.14 a compaction frame growing a third field is protected",
    !isNeutral(f({ paige_compacting: { state: "folding", pct: 1, note: "anything at all" } })), "");
  assert("22.15 a second key beside a neutral one is protected",
    !isNeutral(f({ paige_phase: "writing", choices: [{ delta: { content: "leak" } }] })), "");
  assert("22.16 an over-long action label is protected even with no marker",
    !isNeutral(f({ paige_step: { kind: "action", label: "x".repeat(61) } })), "");
  assert("22.17 an over-long action detail is protected even with no marker",
    !isNeutral(f({ paige_step: { kind: "action", label: "ok", detail: "y".repeat(41) } })), "");
  assert("22.18 an over-long phase value is protected even with no marker",
    !isNeutral(f({ paige_phase: "z".repeat(25) })), "");
  assert("22.19 an over-long client_scope reason is protected even with no marker",
    !isNeutral(f({ client_scope: { status: "refused", reason: "w".repeat(65) } })), "");
  assert("22.20 an unparseable data line is protected",
    !isNeutral("data: {not json\n\n"), "");
  assert("22.21 an unknown frame key is protected by default",
    !isNeutral(f({ some_new_frame: { title: "anything" } })), "");

  // The approval outcome: neutral in its exact shape, and protected the moment it carries anything
  // that is not a fingerprint, an outcome, or one of the server's own sentences.
  const outcome = (o) => f({ paige_approval_outcome: o });
  assert("22.22 an approval outcome in its own words is neutral",
    isNeutral(outcome({ note: "It didn't go through.", actions: [{ fingerprint: "a".repeat(16), outcome: "not_run" }] }))
      && isNeutral(outcome({ actions: [{ fingerprint: `${"b".repeat(16)}:11111111-1111-4111-8111-111111111111`, outcome: "ran" },
        { fingerprint: "c".repeat(16), outcome: "unconfirmed", note: "This may have gone through. Check before asking again, so it doesn't happen twice." }] })), "");
  assert("22.23 an approval outcome carrying words of its own is protected",
    !isNeutral(outcome({ note: "Here is what your file says.", actions: [{ fingerprint: "a".repeat(16), outcome: "not_run" }] }))
      && !isNeutral(outcome({ actions: [{ fingerprint: "a".repeat(16), outcome: "ran", note: "Done — your notes say the fee is $900." }] })), "");
  assert("22.24 an approval outcome growing a field, or naming something that is not a fingerprint, is protected",
    !isNeutral(outcome({ actions: [{ fingerprint: "a".repeat(16), outcome: "ran", summary: "Add Maya" }] }))
      && !isNeutral(outcome({ actions: [], title: "x" }))
      && !isNeutral(outcome({ actions: [{ fingerprint: "Add Maya Ortiz", outcome: "ran" }] }))
      && !isNeutral(outcome({ actions: [{ fingerprint: "a".repeat(16), outcome: "maybe" }] })), "");

  // The turn frame (docs/delivery/paige-conversational-loop-c1.md): sent DIRECT on every turn, so a
  // protected turn can say it started and how it ended. Neutral ONLY in its exact closed shape —
  // four keys, every value from the contract's enums — because the client-seat reader does not scan
  // it, so anything else riding on it would reach the wire unread.
  const turn = (o) => f({ paige_turn: o });
  assert("22.25 a turn frame in its closed shape is neutral (started, waiting, completed)",
    isNeutral(turn({ v: 1, event: "started", state: "WORKING", mode: "pending" }))
      && isNeutral(turn({ v: 1, event: "waiting", state: "WAIT_APPROVAL", mode: "action" }))
      && isNeutral(turn({ v: 1, event: "completed", state: "WITHHELD", mode: "fast_answer" })), "");
  assert("22.26 a turn frame growing a field is protected even with no marker",
    !isNeutral(turn({ v: 1, event: "completed", state: "FINAL", mode: "answer", summary: "Here is what I found." })), "");
  assert("22.27 a turn frame carrying a value outside the contract's enums is protected",
    !isNeutral(turn({ v: 1, event: "completed", state: "Here is what I found.", mode: "answer" }))
      && !isNeutral(turn({ v: 1, event: "finished", state: "FINAL", mode: "answer" }))
      && !isNeutral(turn({ v: 1, event: "completed", state: "FINAL", mode: "a free-text mode" })), "");
  assert("22.28 a turn frame of an unknown version, or missing a field, is protected",
    !isNeutral(turn({ v: 2, event: "completed", state: "FINAL", mode: "answer" }))
      && !isNeutral(turn({ v: 1, event: "completed", state: "FINAL" })), "");
  assert("22.28b a turn frame with a key renamed (still four keys) is protected",
    !isNeutral(turn({ v: 1, event: "completed", state: "FINAL", summary: "answer" })), "");
  assert("22.29 a turn frame that is not an object is protected",
    !isNeutral(turn("completed")) && !isNeutral(turn(["started"])) && !isNeutral(turn(null)), "");
}

group("a turn that stops on a changed workspace still says what became of each approval");
{
  // A protected turn (Knowledge evidence), an approval the person sent, and the workspace changing
  // at the tool-dispatch boundary: the turn ends on "your active workspace changed", which says
  // anything already finished is saved. The card that asked is owed the same — which of the
  // approvals that was — or it can only guess.
  const token = "e".repeat(16);
  const r = await drive({
    personaTenant: CHILD, personaSequence: [CHILD, CHILD, CHILD, AGENCY], memberships: [AGENCY, CHILD],
    chunkContent: "CHILD-PRIVATE-MARKER", provider: ["tool", "text"],
    bodyExtras: { approvedConfirmations: [token] },
  });
  const outcomes = r.responseText.split("\n").filter((l) => l.startsWith("data: ") && l !== "data: [DONE]")
    .map((l) => { try { return JSON.parse(l.slice(6)); } catch { return null; } })
    .filter((frame) => frame?.paige_approval_outcome).map((frame) => frame.paige_approval_outcome);
  assert("27.1 the turn ends on the changed-workspace sentence",
    r.responseText.includes("active workspace changed"), r.responseText.slice(0, 300));
  assert("27.2 …and still reports the approval, once, in the order it was sent",
    outcomes.length === 1 && outcomes[0].actions?.length === 1 && outcomes[0].actions[0].fingerprint === token,
    JSON.stringify(outcomes));
  assert("27.3 …as a frame that carries no evidence",
    outcomes.length === 1 && nonNeutralFrames(`data: ${JSON.stringify({ paige_approval_outcome: outcomes[0] })}\n\n`).length === 0,
    JSON.stringify(outcomes));
  // The turn frame on the same protected turn: it says it started, and its one terminal frame says
  // INTERRUPTED — never FINAL — and comes before the sentence. Without this the classifier cases in
  // group 22 would hold for a frame the server never sends.
  const turns = r.responseText.split("\n").filter((l) => l.startsWith("data: ") && l !== "data: [DONE]")
    .map((l) => { try { return JSON.parse(l.slice(6)); } catch { return null; } })
    .filter((frame) => frame?.paige_turn).map((frame) => frame.paige_turn);
  const terminals = turns.filter((t) => t.event === "completed" || t.event === "waiting");
  assert("27.4 …and the turn frame says it started, then INTERRUPTED once, before the sentence",
    turns[0]?.event === "started" && terminals.length === 1 && terminals[0].state === "INTERRUPTED"
      && r.responseText.indexOf('"INTERRUPTED"') < r.responseText.indexOf("active workspace changed"),
    JSON.stringify(turns));
}

// Fresh-main #591 gap: the resolver may keep its oldest-membership fallback
// after the caller clears their declared active workspace. Query-aware profile
// answers model that independent state, without changing persona call counts.
group("declared active workspace is rechecked after retrieval");
for (const [label, next] of [
  ["cleared", null], ["changed", AGENCY], ["malformed", 42],
  ["missing row", "missing"], ["read throws", "throws"],
]) {
  let reads = 0;
  const r = await drive({ personaTenant: CHILD, memberships: [CHILD, AGENCY],
    chunkContent: "DECLARED-SCOPE-PRIVATE-MARKER", tableExtras: { profiles: (filters) => {
      if (filters.some(([op, cols]) => op === "select" && cols === "active_tenant_id")) reads++;
      // reads <= 2: the FIRST declared read of the turn is INT-326's memory scope (the
      // declared-and-validated conjunction resolves before any memory work); the second is this
      // pathway's own initial declared check. Drift begins on the THIRD read — the
      // post-retrieval recheck this group exists to prove refuses the turn.
      if (reads <= 2) return [{ active_tenant_id: CHILD }];
      if (next === "throws") throw new Error("profile read unavailable");
      if (next === "missing") return [];
      return [{ active_tenant_id: next }];
    } },
  });
  assert(`28 ${label}: initial scoped retrieval occurred`, !!r.kbCall);
  assert(`28 ${label}: fallback cannot permit provider egress`, r.providerCalls.length === 0);
  assert(`28 ${label}: telemetry is suppressed`, !r.telemetry);
  assert(`28 ${label}: refusal is explicit`, r.status === 409 && JSON.parse(r.responseText).code === "ACTIVE_ACCOUNT_CHANGED");
}
{
  const r = await drive({ personaTenant: CHILD, memberships: [CHILD, AGENCY],
    chunkContent: "DECLARED-SCOPE-PRIVATE-MARKER", tableExtras: { profiles: () =>
      [{ active_tenant_id: providerCalls.length ? null : CHILD }],
    },
  });
  assert("28 late clear: one authorized initial provider call", r.providerCalls.length === 1);
  assert("28 late clear: buffered answer refused", r.responseText.includes("active workspace changed"));
  assert("28 late clear: no telemetry", !r.telemetry);
}

group("the turn frame on every stream this harness drove (paige-turn)");
{
  // An ORDINARY Studio question (no Knowledge hit, so nothing is held): the chips stream live, so the
  // terminal — ASK_USER, waiting on the person — has to precede them rather than wait for release.
  const plainChoice = await drive({
    personaTenant: CHILD, personaSequence: [CHILD], memberships: [CHILD], provider: ["ask-choices"],
    rpcExtras: { match_tenant_knowledge: { data: [], error: null } },
    bodyExtras: { threadId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd", requestIntentId: "77777777-7777-4777-8777-777777777777" },
    tableExtras: { paige_chat_threads: () => [{ summary: null, studio_session_id: "studio-sess-1" }] },
  });
  const plainTurns = plainChoice.responseText.split("\n").filter((l) => l.startsWith("data: ") && l.includes("paige_turn"));
  assert("29.0 an ordinary Studio question ends waiting ASK_USER, ahead of its chips",
    plainTurns.length === 2 && plainTurns[1].includes('"waiting"') && plainTurns[1].includes('"ASK_USER"')
      && plainChoice.responseText.indexOf('"ASK_USER"') < plainChoice.responseText.indexOf("paige_choices"),
    plainChoice.responseText.slice(0, 400));
  // A DOCUMENT STREAM THAT THROWS still closes. The Knowledge-telemetry write at the very end of the
  // document close-out is made to throw (not resolve an error), after the reply was released: the
  // stream must still end with its one terminal and a [DONE], and say why in the log — not error out
  // and leave the client with no [DONE] at all.
  const throwingDoc = await drive({
    personaTenant: CHILD, personaSequence: [CHILD], memberships: [CHILD], chunkContent: "PRIVATE-KB-SOURCE-MARKER",
    bodyExtras: { document: { fileName: "operating-notes.docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", kind: "docx", textContent: "internal operating notes" } },
    provider: ["private-text", "private-text"], insertThrows: ["kb_query_telemetry"],
  });
  const throwingTurns = throwingDoc.responseText.split("\n").filter((l) => l.startsWith("data: ") && l.includes('"paige_turn"'));
  assert("29.1 a document stream that throws in its close-out still ends with its one terminal and a [DONE]",
    !!throwingDoc.telemetry && throwingDoc.responseText.includes("CHILD-PRIVATE-MARKER")
      && throwingTurns.length === 2 && throwingDoc.responseText.trimEnd().endsWith("data: [DONE]")
      && throwingDoc.logged.some((l) => l.msg.includes("[paige] document stream failed")),
    JSON.stringify({ telemetryAttempted: !!throwingDoc.telemetry, turns: throwingTurns, tail: throwingDoc.responseText.slice(-200) }));

  // A PROVIDER STREAM THAT BREAKS. `_shared/claude.ts`'s translator ends a broken stream with the same
  // clean [DONE] as a finished one; the only difference is the finish_reason it never sent. Each turn
  // below would read FINAL without that check — on the wire, and (where there is text) in the record.
  const BREAK_THREAD = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
  const turnsIn = (text) => text.split("\n").filter((l) => l.startsWith("data: ") && l.includes('"paige_turn"'))
    .map((l) => JSON.parse(l.slice(6)).paige_turn);
  const terminalIn = (text) => turnsIn(text).filter((t) => t.event !== "started");
  const assistantRecords = (r) => r.rec.rpc.filter((c) => c.name === "paige_chat_turn_append" && c.args?.p_role === "assistant")
    .map((c) => ({ content: c.args.p_content, state: c.args.p_bundle_ref?.turn_state ?? null }));
  const ordinaryBreak = (provider) => drive({
    personaTenant: CHILD, personaSequence: [CHILD], memberships: [CHILD], provider,
    rpcExtras: { match_tenant_knowledge: { data: [], error: null } },
    bodyExtras: { threadId: BREAK_THREAD },
    tableExtras: { paige_chat_threads: () => [{ summary: null, studio_session_id: null }] },
  });
  // Before any text: the only round answered with nothing and no finish_reason. Nothing to persist
  // (the persist gate), so the wire is the whole record — and it must not say FINAL.
  const brokeEarly = await ordinaryBreak(["break-before-text"]);
  assert("29.2 an answer whose stream broke before any text ends INTERRUPTED on the wire, never FINAL, and persists nothing",
    brokeEarly.status === 200 && brokeEarly.providerCalls.length === 1
      && terminalIn(brokeEarly.responseText).length === 1 && terminalIn(brokeEarly.responseText)[0].state === "INTERRUPTED"
      && !brokeEarly.responseText.includes('"FINAL"') && assistantRecords(brokeEarly).length === 0,
    JSON.stringify({ status: brokeEarly.status, calls: brokeEarly.providerCalls.length, turns: turnsIn(brokeEarly.responseText), records: assistantRecords(brokeEarly) }));
  // Mid-answer (non-Live): the half-answer is replayed and saved as before — but both the wire terminal
  // and the record say INTERRUPTED, because the round is replayed whole after the terminal is decided.
  const brokeMid = await ordinaryBreak(["break-mid-text"]);
  const midRecords = assistantRecords(brokeMid);
  assert("29.3 an answer whose stream broke mid-answer ends INTERRUPTED on the wire and in the record, with the half-answer it got",
    brokeMid.responseText.includes(BROKEN_ANSWER) && terminalIn(brokeMid.responseText).length === 1
      && terminalIn(brokeMid.responseText)[0].state === "INTERRUPTED" && !brokeMid.responseText.includes('"FINAL"')
      && brokeMid.responseText.indexOf('"INTERRUPTED"') < brokeMid.responseText.indexOf(BROKEN_ANSWER)
      && midRecords.length === 1 && midRecords[0].content === BROKEN_ANSWER && midRecords[0].state?.state === "INTERRUPTED",
    JSON.stringify({ turns: turnsIn(brokeMid.responseText), records: midRecords }));
  // The DOCUMENT path reads its own stream. A DOCX turn makes two provider calls: the deferred
  // extraction first (not streamed), then the streamed reply — the one that breaks here. Every document turn is held, so its terminal goes out at release — after
  // the stream ended — and can say INTERRUPTED on the wire as well as in the record.
  const docBreak = await drive({
    personaTenant: CHILD, personaSequence: [CHILD], memberships: [CHILD],
    bodyExtras: { threadId: BREAK_THREAD, document: { fileName: "operating-notes.docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", kind: "docx", textContent: "internal operating notes" } },
    tableExtras: { paige_chat_threads: () => [{ summary: null, studio_session_id: null }] },
    provider: ["private-text", "break-mid-text"],
  });
  const docRecords = assistantRecords(docBreak);
  assert("29.4 a document answer whose stream broke mid-answer ends INTERRUPTED on the wire and in the record, never FINAL",
    docBreak.responseText.includes(BROKEN_ANSWER) && terminalIn(docBreak.responseText).length === 1
      && terminalIn(docBreak.responseText)[0].state === "INTERRUPTED" && !docBreak.responseText.includes('"FINAL"')
      && docRecords.length === 1 && docRecords[0].state?.state === "INTERRUPTED"
      && JSON.stringify(docBreak.providerCalls.map((c) => c.stream === true)) === "[false,true]",
    JSON.stringify({ calls: docBreak.providerCalls.map((c) => c.stream === true), turns: turnsIn(docBreak.responseText), records: docRecords }));

  // AN EMPTY ANSWER IS NOT A FINAL ONE. The provider FINISHED each reply below, so the finish_reason
  // check passes; what is missing is the answer. FINAL over an empty bubble tells the client the turn
  // answered when it said nothing, and with no text the persist gate writes no row, so the wire is
  // the only record there is.
  const endsOnDone = (text) => text.trimEnd().endsWith("data: [DONE]");
  const terminalBeforeDone = (text) => {
    const t = text.split("\n").findIndex((l) => l.includes('"paige_turn"') && !l.includes('"started"'));
    return t !== -1 && t < text.split("\n").lastIndexOf("data: [DONE]");
  };
  // The document path executes no tool, so a reply that is ONLY a tool call finishes (`tool_calls`)
  // with no text at all.
  const docToolOnly = await drive({
    personaTenant: CHILD, personaSequence: [CHILD], memberships: [CHILD],
    bodyExtras: { threadId: BREAK_THREAD, document: { fileName: "operating-notes.docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", kind: "docx", textContent: "internal operating notes" } },
    tableExtras: { paige_chat_threads: () => [{ summary: null, studio_session_id: null }] },
    provider: ["private-text", "action-file"],
  });
  assert("29.7 a document reply that is only a tool call (finished, no text) ends INTERRUPTED, never FINAL, with [DONE] last",
    docToolOnly.status === 200 && JSON.stringify(docToolOnly.providerCalls.map((c) => c.stream === true)) === "[false,true]"
      && terminalIn(docToolOnly.responseText).length === 1 && terminalIn(docToolOnly.responseText)[0].state === "INTERRUPTED"
      && !docToolOnly.responseText.includes('"FINAL"') && endsOnDone(docToolOnly.responseText)
      && terminalBeforeDone(docToolOnly.responseText) && assistantRecords(docToolOnly).length === 0,
    JSON.stringify({ calls: docToolOnly.providerCalls.map((c) => c.stream === true), turns: turnsIn(docToolOnly.responseText), records: assistantRecords(docToolOnly), tail: docToolOnly.responseText.slice(-200) }));
  // The agentic path: one round, finished cleanly, no text, no tool — the turn did nothing.
  const emptyClean = await ordinaryBreak(["empty-end"]);
  assert("29.8 an answer the provider finished cleanly with no text, after a turn that did no work, ends INTERRUPTED, never FINAL",
    emptyClean.status === 200 && emptyClean.providerCalls.length === 1
      && terminalIn(emptyClean.responseText).length === 1 && terminalIn(emptyClean.responseText)[0].state === "INTERRUPTED"
      && !emptyClean.responseText.includes('"FINAL"') && endsOnDone(emptyClean.responseText)
      && terminalBeforeDone(emptyClean.responseText) && assistantRecords(emptyClean).length === 0,
    JSON.stringify({ calls: emptyClean.providerCalls.length, turns: turnsIn(emptyClean.responseText), records: assistantRecords(emptyClean) }));
  // CONTROLS — the rule changes only an EMPTY FINAL with no work. The same turn answering text stays
  // FINAL; a turn whose tools RAN and then closed on an empty round keeps FINAL (the work is the answer).
  const textClean = await ordinaryBreak(["text"]);
  const workedEmpty = await ordinaryBreak(["two-tools", "empty-end"]);
  assert("29.9 CONTROL — a clean text answer stays FINAL, and a turn whose tools ran keeps FINAL over an empty closing round",
    terminalIn(textClean.responseText).length === 1 && terminalIn(textClean.responseText)[0].state === "FINAL"
      && endsOnDone(textClean.responseText)
      && workedEmpty.providerCalls.length === 2 && terminalIn(workedEmpty.responseText).length === 1
      && terminalIn(workedEmpty.responseText)[0].state === "FINAL" && endsOnDone(workedEmpty.responseText),
    JSON.stringify({ text: turnsIn(textClean.responseText), worked: turnsIn(workedEmpty.responseText), calls: workedEmpty.providerCalls.length }));

  // A WHITESPACE-ONLY answer is an empty one, on both paths: the rule reads the trimmed text.
  const wsAgentic = await ordinaryBreak(["ws-text"]);
  const genDoc = { fileName: "formation.docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", kind: "docx", textContent: "Certificate of Formation. Legal name: Acme Holdings LLC." };
  const wsDoc = await drive({
    personaTenant: CHILD, personaSequence: [CHILD], memberships: [CHILD],
    bodyExtras: { threadId: BREAK_THREAD, document: genDoc },
    tableExtras: { paige_chat_threads: () => [{ summary: null, studio_session_id: null }] },
    provider: ["private-text", "ws-text"],
  });
  assert("29.10 a whitespace-only answer is empty — INTERRUPTED, never FINAL — on the agentic and the document path",
    [wsAgentic, wsDoc].every((r) => r.status === 200 && terminalIn(r.responseText).length === 1
      && terminalIn(r.responseText)[0].state === "INTERRUPTED" && !r.responseText.includes('"FINAL"')
      && endsOnDone(r.responseText) && assistantRecords(r).length === 0),
    JSON.stringify({ agentic: turnsIn(wsAgentic.responseText), doc: turnsIn(wsDoc.responseText) }));
  // CONTROL — a document turn whose close-out handed the person a proposal card ANSWERED, through the
  // card, even when its reply text is empty: FINAL, the card on the wire, never INTERRUPTED beside it.
  const cardOnly = await drive({
    personaTenant: CHILD, personaSequence: [CHILD], memberships: [CHILD],
    bodyExtras: { threadId: BREAK_THREAD, document: genDoc },
    tableExtras: { paige_chat_threads: () => [{ summary: null, studio_session_id: null }] },
    provider: ["general-extraction", "action-file"],
  });
  const cardText = await drive({
    personaTenant: CHILD, personaSequence: [CHILD], memberships: [CHILD],
    bodyExtras: { threadId: BREAK_THREAD, document: genDoc },
    tableExtras: { paige_chat_threads: () => [{ summary: null, studio_session_id: null }] },
    provider: ["general-extraction", "private-text"],
  });
  assert("29.11 CONTROL — a document turn that delivered a proposal card stays FINAL with or without reply text",
    [cardOnly, cardText].every((r) => r.status === 200 && r.responseText.includes('"extraction_proposal"')
      && terminalIn(r.responseText).length === 1 && terminalIn(r.responseText)[0].state === "FINAL"
      && endsOnDone(r.responseText) && terminalBeforeDone(r.responseText)),
    JSON.stringify({ cardOnly: turnsIn(cardOnly.responseText), cardText: turnsIn(cardText.responseText), tail: cardOnly.responseText.slice(-200) }));
  // A LIMIT keeps its state over an empty closing round: a Studio turn that repeats a refused call is
  // stopped by the no-progress rule (LIMIT_REACHED), and the empty-answer rule reads only FINAL.
  const studioRepeat = await drive({
    personaTenant: CHILD, personaSequence: [CHILD], memberships: [CHILD],
    provider: ["action-file", "action-file", "empty-end"],
    rpcExtras: { match_tenant_knowledge: { data: [], error: null } },
    bodyExtras: { threadId: BREAK_THREAD },
    tableExtras: { paige_chat_threads: () => [{ summary: null, studio_session_id: "studio-sess-1" }] },
  });
  assert("29.12 a turn stopped at a limit keeps LIMIT_REACHED over an empty closing round, never INTERRUPTED",
    studioRepeat.status === 200 && terminalIn(studioRepeat.responseText).length === 1
      && terminalIn(studioRepeat.responseText)[0].state === "LIMIT_REACHED" && endsOnDone(studioRepeat.responseText),
    JSON.stringify({ calls: studioRepeat.providerCalls.length, turns: turnsIn(studioRepeat.responseText) }));

  // Every protected turn above — the final-gate refusals, the withheld turns, the Studio chips — is a
  // stream whose turn frame has to tell the truth about how it ended. Audited here, over all of them,
  // so the rule is held on the turns that exercise the gates rather than on a few written for it.
  // The structural rules come from the one shared auditor (scripts/lib/audit-turn-frames.mjs); this
  // harness adds its own: a turn stopped on a changed workspace ends INTERRUPTED.
  const { auditTurnStream, wireAnswerMatchesSaved } = await import("../lib/audit-turn-frames.mjs");
  const { isTurnFrame } = await import("../../supabase/functions/_shared/paige-turn/contract.ts");
  const violations = [];
  let audited = 0, interrupted = 0, withheld = 0;
  for (const { label, status, responseText } of drivenStreams) {
    if (status !== 200) continue;
    const audit = auditTurnStream(responseText, { isTurnFrame });
    if (!audit) continue;
    audited += 1;
    for (const why of audit.violations) violations.push(`${label}: ${why}`);
    if (!audit.terminal) continue;
    if (responseText.includes("active workspace changed")) {
      interrupted += 1;
      if (audit.terminal.t.state !== "INTERRUPTED") violations.push(`${label}: a turn stopped on a changed workspace ended ${audit.terminal.t.state}`);
    }
    if (audit.has("paige_withheld")) withheld += 1;
  }
  // The wire and the transcript carry the same answer (§13/§94): on a drive that saved one assistant
  // turn, what a reader got up to the first [DONE] is exactly the saved text, and nothing follows it.
  const answerMismatches = [];
  let answersCompared = 0;
  for (const { label, status, responseText, rec } of drivenStreams) {
    if (status !== 200) continue;
    const saved = rec.rpc.filter((c) => c.name === "paige_chat_turn_append" && c.args?.p_role === "assistant");
    if (saved.length !== 1) continue;
    answersCompared += 1;
    const why = wireAnswerMatchesSaved(responseText, saved[0].args?.p_content);
    if (why) answerMismatches.push(`${label}: ${why}`);
  }
  assert("29.5 every stream starts with `started` and has one terminal frame, ahead of its answer and [DONE]",
    audited >= 50 && violations.length === 0, JSON.stringify({ audited, violations: violations.slice(0, 6) }));
  assert("29.6 every turn stopped on a changed workspace — at the tool boundary or the final gate — ends INTERRUPTED, never FINAL",
    interrupted >= 10 && violations.length === 0, JSON.stringify({ interrupted, withheld }));
  assert("29.13 on every drive that saved an assistant turn, the answer a reader got up to [DONE] is exactly the saved text, and nothing follows [DONE]",
    answersCompared >= 10 && answerMismatches.length === 0, JSON.stringify({ answersCompared, mismatches: answerMismatches.slice(0, 6) }));
}

console.log(`\n${checks - failures} passed, ${failures} failed`);
process.exit(failures === 0 ? 0 : 1);
