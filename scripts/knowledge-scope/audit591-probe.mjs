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
let syncCalls = [];
let syncThrows = false;
function embedCalls() { return embedCount; }
function resetEmbeds() { embedCount = 0; }
function resetProvider(plan = []) { providerPlan = [...plan]; providerCalls = []; syncCalls = []; }
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
    providerCalls.push(JSON.parse(String(init?.body ?? "{}")));
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
async function drive({ personaTenant, personaSequence = null, memberships, kbRejects = false, ragHits = false, bodyExtras = {}, noAuth = false, unauthenticated = false, chunkTitle = "PRIVATE-CHUNKTITLE-MARKER", chunkContent = "x", provider = ["text"], rpcExtras = {}, tableExtras = {}, functionExtras = {}, fundingEnabled = false, throwOnSync = false, activeTenantId = "__USE_PERSONA__", userMessage = "what does my onboarding process look like?" }) {
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
  return { rec, kbCall, memberReads, telemetry, logged, status, embeds: embedCalls(), providerCalls: [...providerCalls], responseText, syncCalls: [...syncCalls] };
}

for (const nextActive of [CHILD, null, AGENCY]) {
  let activeReads=0;
  const r=await drive({personaTenant:CHILD,memberships:[CHILD,AGENCY],chunkContent:"AUDIT591-PRIVATE-MARKER",tableExtras:{profiles:(filters)=>{
    const active=filters.some(([op,cols])=>op==="select" && cols==="active_tenant_id");
    if(active) activeReads++;
    return [{active_tenant_id:activeReads<=1?CHILD:nextActive}];
  }}});
  console.log(JSON.stringify({case:nextActive===CHILD?"control":nextActive===null?"cleared-active-same-resolver-fallback":"changed-active-same-resolver-fallback",activeReads,kb:!!r.kbCall,providers:r.providerCalls.length,privateEgress:r.providerCalls.some(x=>JSON.stringify(x).includes("AUDIT591-PRIVATE-MARKER")),scopeRefusal:r.responseText.includes("active workspace changed"),telemetry:!!r.telemetry}));
}
process.exit(0);