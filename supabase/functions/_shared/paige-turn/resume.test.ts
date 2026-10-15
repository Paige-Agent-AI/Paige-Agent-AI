// deno test --allow-import --node-modules-dir=none supabase/functions/_shared/paige-turn/resume.test.ts
//
// C4a/C4b — the pure half of the approval resume (resume.ts). What these hold: the server rebuilds the
// approved act from its STORED row and nothing else; the id it runs under is deterministic per
// approval and inside the provider's id alphabet; only governed general-gate writes are carried
// forward; the per-act outcome uses the existing closed vocabulary and never reads optimism into a
// result; and the persisted record is closed enums plus the caller's own card tokens, read
// defensively. The handler's IO is driven end to end in scripts/client-memory-authz (group 39).
import { assert, assertEquals, assertThrows } from "https://deno.land/std@0.190.0/testing/asserts.ts";
import {
  actIdentityArgs,
  answerClaim,
  answerClaimBound,
  ANSWER_STRANDED_AFTER_MS,
  answerResumeKey,
  answerTurnNote,
  ASK_ALONGSIDE_CALLS_RESULT,
  askFrame,
  buildAskRecord,
  readAnswerClaim,
  readAskRecord,
  reopenAsk,
  resolveAskLiveness,
  buildResumeCall,
  classifyResumedApproval,
  doorResumeShape,
  findSuspendedTurnId,
  isResumableTool,
  parseDoorToken,
  parseScopedToken,
  readResumeApprovalFrame,
  readResumeRecord,
  RESUME_ALREADY_HANDLED_RESULT,
  RESUME_CHECK_UNAVAILABLE_RESULT,
  RESUME_DOOR_ALREADY_HANDLED_RESULT,
  RESUME_EXPIRED_RESULT,
  RESUME_KINDS,
  RESUME_LOST_RESULT,
  RESUME_TURN_NOTE,
  resumeCallId,
  resumeRecord,
  selectDoorRow,
  storedRowState,
} from "./resume.ts";
import { APPROVAL_OUTCOME_SENTENCES } from "../approval-outcome.ts";

const FP = "0123456789abcdef";
const NONCE = "11111111-2222-4333-8444-555555555555";
const TOKEN = `${FP}:${NONCE}`;
const TURN = "5a5a5a5a-5a5a-4a5a-8a5a-5a5a5a5a5a5a";

Deno.test("only a server-scoped card token is parsed; bare and malformed tokens are not resumed here", () => {
  assertEquals(parseScopedToken(TOKEN), { fingerprint: FP, nonce: NONCE });
  assertEquals(parseScopedToken(FP), null);
  assertEquals(parseScopedToken(`${FP}:not-a-uuid`), null);
  assertEquals(parseScopedToken(`${FP.toUpperCase()}:${NONCE}`), null);
  assertEquals(parseScopedToken(""), null);
});

Deno.test("the resumed call id is deterministic per approval and inside the provider id alphabet", () => {
  const id = resumeCallId(TOKEN);
  assertEquals(id, resumeCallId(TOKEN));
  assert(/^[A-Za-z0-9_-]+$/.test(id), id);
  assert(id !== resumeCallId(`${FP}:22222222-2222-4333-8444-555555555555`));
});

Deno.test("the synthetic call carries exactly the stored arguments under the stored tool", () => {
  const args = { client_id: "c1", updates: { goal: "stored" } };
  const call = buildResumeCall(TOKEN, { tool_name: "update_client_data", args });
  assertEquals(call, { id: resumeCallId(TOKEN), type: "function", function: { name: "update_client_data", arguments: JSON.stringify(args) } });
  // Nothing about the approval travels in the arguments: no flag, no token.
  assert(!call.function.arguments.includes("confirm") && !call.function.arguments.includes(FP));
});

Deno.test("only governed general-gate writes are carried forward; doors and non-writes keep their own path", () => {
  const sets = { mutating: new Set(["update_client_data", "crm_add_note", "deal_create"]), doorTools: [new Set(["deal_create"])] };
  assert(isResumableTool("update_client_data", sets));
  assert(!isResumableTool("deal_create", sets), "a door tool claims its own proposal (C4b)");
  assert(!isResumableTool("web_search", sets), "a non-write would skip the gate and run without spending the approval");
  assert(!isResumableTool(undefined, sets) && !isResumableTool("", sets));
});

Deno.test("act identity sets aside only the keys the gate settles and the confirm flag", () => {
  assertEquals(actIdentityArgs({ a: 1, confirm: true, confirm_token: "x", request_key: "k", idempotency_key: "i", b: { c: 2 } }), { a: 1, b: { c: 2 } });
  assertEquals(actIdentityArgs(null), {});
});

Deno.test("a resumed approval's outcome is read from its own result — never optimism", () => {
  assertEquals(classifyResumedApproval({ spent: true, spentContent: JSON.stringify({ success: true }) }).outcome, "ran");
  assertEquals(classifyResumedApproval({ spent: true, spentContent: JSON.stringify({ updated: true }) }).outcome, "unconfirmed",
    "a result that only fails to mention an error is not a success");
  assertEquals(classifyResumedApproval({ spent: true, spentContent: undefined }).outcome, "unconfirmed");
  assertEquals(classifyResumedApproval({ spent: true, spentContent: JSON.stringify({ success: false, not_applied: true }) }).outcome, "not_run");
});

Deno.test("an approval another request used reads can't-confirm; an expired one reads expired; a refusal reads not run", () => {
  const lost = classifyResumedApproval({ spent: false, lost: true });
  assertEquals(lost, { outcome: "unconfirmed", reason: "unusable" });
  assertEquals(classifyResumedApproval({ spent: false, expired: true }), { outcome: "not_run", reason: "expired" });
  assertEquals(classifyResumedApproval({ spent: false }), { outcome: "not_run", reason: "not_attempted" });
  assertEquals(classifyResumedApproval({ spent: false, refusal: "lookup_failed" }), { outcome: "not_run", reason: "lookup_failed" });
  // A tool this turn no longer offers: nothing ran, nothing spent — "no longer matches anything Paige can run".
  assertEquals(classifyResumedApproval({ spent: false, withheld: true }), { outcome: "not_run", reason: "unclaimable" });
});

Deno.test("a stored row reads live, expired (including the sweep's stamp) or used, from its own timestamps", () => {
  const now = Date.parse("2026-10-05T12:00:00Z");
  assertEquals(storedRowState({ consumed_at: null, expires_at: "2026-10-05T12:10:00Z" }, now), "live");
  assertEquals(storedRowState({ consumed_at: null, expires_at: "2026-10-05T11:59:59Z" }, now), "expired");
  assertEquals(storedRowState({ consumed_at: null, expires_at: "2026-10-05T12:00:00Z" }, now), "expired");
  // Claimed or declined inside its window: used (it may have run).
  assertEquals(storedRowState({ consumed_at: "2026-10-05T11:00:00Z", expires_at: "2026-10-05T12:10:00Z" }, now), "used");
  // Stamped at or after its window closed — only the expiry sweep writes that shape: expired.
  assertEquals(storedRowState({ consumed_at: "2026-10-05T12:10:00Z", expires_at: "2026-10-05T12:10:00Z" }, now), "expired");
  assertEquals(storedRowState({ consumed_at: "2026-10-05T12:11:00Z", expires_at: "2026-10-05T12:10:00Z" }, now), "expired");
  // Unreadable timestamps never read as live: consumed → used (check first); unconsumed → expired.
  assertEquals(storedRowState({ consumed_at: "garbage", expires_at: "2026-10-05T12:10:00Z" }, now), "used");
  assertEquals(storedRowState({ consumed_at: null, expires_at: null }, now), "expired");
});

Deno.test("the resume note claims no outcome and forbids re-running or re-asking", () => {
  assert(/may have run, been refused, or be impossible to confirm/.test(RESUME_TURN_NOTE), RESUME_TURN_NOTE);
  assert(/Do not call that action again/.test(RESUME_TURN_NOTE));
  assert(/do not assume/.test(RESUME_TURN_NOTE));
});

Deno.test("the record is closed enums, the caller's own tool names and card tokens, and closed sentences", () => {
  const sentence = [...APPROVAL_OUTCOME_SENTENCES][0];
  const rec = resumeRecord("approval", TURN, [{ tool: "update_client_data", outcome: "ran" }], { actions: [{ fingerprint: TOKEN, outcome: "ran" }], note: sentence });
  assertEquals(rec, { kind: "approval", from_turn_id: TURN, outcomes: [{ tool: "update_client_data", outcome: "ran" }], approval_outcome: { actions: [{ fingerprint: TOKEN, outcome: "ran" }], note: sentence } });
  assertEquals(readResumeRecord(JSON.parse(JSON.stringify(rec))), rec, "round-trips unchanged");
  assertEquals(resumeRecord("approval", null, []), { kind: "approval", from_turn_id: null, outcomes: [] });
  assertEquals([...RESUME_KINDS], ["approval", "answer", "work"]);
});

Deno.test("building a record outside the contract is a bug and throws", () => {
  assertThrows(() => resumeRecord("approved" as never, TURN, []));
  assertThrows(() => resumeRecord("approval", "not-a-turn", []));
  assertThrows(() => resumeRecord("approval", TURN, [{ tool: "Update Client", outcome: "ran" }]));
  assertThrows(() => resumeRecord("approval", TURN, [{ tool: "x", outcome: "done" as never }]));
  assertThrows(() => resumeRecord("approval", TURN, [], { actions: [{ fingerprint: TOKEN, outcome: "ran", note: "It worked great!" }] }));
});

Deno.test("a saved record is read defensively: anything outside the contract reads as none", () => {
  assertEquals(readResumeRecord(null), null);
  assertEquals(readResumeRecord({ kind: "approval", from_turn_id: TURN, outcomes: "ran" }), null);
  assertEquals(readResumeRecord({ kind: "nope", from_turn_id: null, outcomes: [] }), null);
  assertEquals(readResumeRecord({ kind: "approval", from_turn_id: "x", outcomes: [] }), null);
  assertEquals(readResumeRecord({ kind: "approval", from_turn_id: null, outcomes: [{ tool: "a", outcome: "maybe" }] }), null);
  assertEquals(readResumeRecord({ kind: "approval", from_turn_id: null, outcomes: [], approval_outcome: { actions: [{ fingerprint: "<script>", outcome: "ran" }] } }), null);
  assertEquals(readResumeApprovalFrame({ actions: [{ fingerprint: FP, outcome: "unconfirmed" }], note: "free text" }), null,
    "a note outside the closed sentence set is never trusted");
  assertEquals(readResumeApprovalFrame({ actions: [{ fingerprint: FP, outcome: "unconfirmed" }] }), { actions: [{ fingerprint: FP, outcome: "unconfirmed" }] });
});

Deno.test("the suspended turn is the latest assistant turn whose card carried an approved token", () => {
  const OLDER = "6b6b6b6b-6b6b-4b6b-8b6b-6b6b6b6b6b6b";
  const tokens = new Set([TOKEN]);
  const turns = [
    { id: "7c7c7c7c-7c7c-4c7c-8c7c-7c7c7c7c7c7c", role: "user", bundle_ref: { paige_confirm: [{ fingerprint: TOKEN }] } },
    { id: TURN, role: "assistant", bundle_ref: { paige_confirm: [{ fingerprint: TOKEN }] } },
    { id: OLDER, role: "assistant", bundle_ref: { paige_confirm: [{ fingerprint: TOKEN }] } },
  ];
  assertEquals(findSuspendedTurnId(turns, tokens), TURN);
  assertEquals(findSuspendedTurnId([{ id: TURN, role: "assistant", bundle_ref: { paige_confirm: [{ fingerprint: FP }] } }], tokens), null);
  assertEquals(findSuspendedTurnId([{ id: "not-a-uuid", role: "assistant", bundle_ref: { paige_confirm: [{ fingerprint: TOKEN }] } }], tokens), null);
});

Deno.test("the four refusals say nothing ran here and never invite a retry", () => {
  for (const r of [RESUME_LOST_RESULT, RESUME_CHECK_UNAVAILABLE_RESULT, RESUME_ALREADY_HANDLED_RESULT, RESUME_EXPIRED_RESULT]) {
    assertEquals(r.success, false);
    assertEquals(r.refused_before_run, true);
    assert(/do not call/i.test(r.note), r.note);
  }
});

// ── C4b — door proposals ─────────────────────────────────────────────────────────────────────────

const T = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const CATALOGS = {
  crmActionCapability: { "contact.create": "crm_create_contact", "deal.create": "deal_create", "deal.delete": "crm_delete_deal" },
  crmPreviewActions: new Set(["deal.delete"]),
  salesTools: new Set(["sales_void_invoice", "sales_record_manual_payment", "billing_send_invoice", "billing_create_invoice"]),
  publishTools: { growth_page_publish: { kind: "page", idArg: "page_id" } },
};

Deno.test("a door token is the bare server fingerprint only", () => {
  assertEquals(parseDoorToken(FP), FP);
  assertEquals(parseDoorToken(TOKEN), null);
  assertEquals(parseDoorToken(FP.toUpperCase()), null);
  assertEquals(parseDoorToken(42), null);
});

Deno.test("the live row wins; with none live the newest row speaks for the token; other fingerprints are ignored", () => {
  const now = Date.parse("2026-10-05T12:00:00Z");
  const old = { fingerprint: FP, tool_name: "deal_create", args: {}, consumed_at: "2026-10-05T10:01:00Z", expires_at: "2026-10-05T10:30:00Z", server_issued_at: "2026-10-05T10:00:00Z" };
  const live = { fingerprint: FP, tool_name: "deal_create", args: {}, consumed_at: null, expires_at: "2026-10-05T12:30:00Z", server_issued_at: "2026-10-05T11:59:00Z" };
  const swept = { fingerprint: FP, tool_name: "deal_create", args: {}, consumed_at: "2026-10-05T11:00:00Z", expires_at: "2026-10-05T10:59:00Z", server_issued_at: "2026-10-05T10:29:00Z" };
  const foreign = { ...live, fingerprint: "f".repeat(16) };
  assertEquals(selectDoorRow([old, live, foreign], FP, now), { row: live, state: "live" });
  assertEquals(selectDoorRow([live, old], FP, now)?.row, live);
  // None live: the newest (swept by its door's expiry retire) says expired, not "used".
  assertEquals(selectDoorRow([old, swept], FP, now), { row: swept, state: "expired" });
  assertEquals(selectDoorRow([old], FP, now), { row: old, state: "used" });
  assertEquals(selectDoorRow([foreign], FP, now), null);
  // The live row wins on liveness, not on recency: even a live row whose issue time cannot be read
  // (sorting it last) is preferred over an older used one.
  const liveUnknownIssue = { ...live, server_issued_at: null };
  assertEquals(selectDoorRow([old, liveUnknownIssue], FP, now), { row: liveUnknownIssue, state: "live" });
});

Deno.test("CRM: a full stored command is carried forward; a preview binding, a mismatched tool or a missing key is not", () => {
  const args = { command: { action: "contact.create", patch: { first_name: "D" } }, idempotency_key: "k", approval_subject: "s" };
  assertEquals(doorResumeShape("crm_create_contact", args, T, CATALOGS), { family: "crm", callArgs: { patch: { first_name: "D" } } });
  assertEquals(doorResumeShape("deal_create", args, T, CATALOGS), null);
  assertEquals(doorResumeShape("crm_delete_deal", { command: { action: "deal.delete", preview_id: NONCE }, idempotency_key: "k" }, T, CATALOGS), null);
  assertEquals(doorResumeShape("crm_create_contact", { ...args, idempotency_key: " " }, T, CATALOGS), null);
  assertEquals(doorResumeShape("crm_create_contact", { ...args, command: { ...args.command, preview_id: NONCE } }, T, CATALOGS), null);
});

Deno.test("Sales: the stored command must be bound to THIS workspace and a real operation; the call names the same action", () => {
  const args = { command: { action: "invoice.void", invoice_id: NONCE, expected_version: 2, reason: "r" }, operation_id: NONCE, expected_tenant_id: T };
  assertEquals(doorResumeShape("sales_void_invoice", args, T, CATALOGS), { family: "sales", callArgs: { invoice_id: NONCE, expected_version: 2, reason: "r" } });
  assertEquals(doorResumeShape("sales_void_invoice", { ...args, expected_tenant_id: NONCE }, T, CATALOGS), null);
  assertEquals(doorResumeShape("sales_void_invoice", { ...args, operation_id: "op" }, T, CATALOGS), null);
  // The two tools whose stored action the tool name alone does not say.
  assertEquals(doorResumeShape("sales_record_manual_payment", { ...args, command: { action: "collection.record_receipt", agreement_id: NONCE } }, T, CATALOGS)?.callArgs,
    { agreement_id: NONCE, record_kind: "imported" });
  assertEquals(doorResumeShape("billing_send_invoice", { ...args, command: { action: "invoice.sms_send", invoice_id: NONCE, expected_version: 1 } }, T, CATALOGS)?.callArgs,
    { invoice_id: NONCE, expected_version: 1, channel: "sms" });
  assertEquals(doorResumeShape("billing_create_invoice", { ...args, command: { action: "invoice.draft_create", draft: {}, catalog_prices: [] } }, T, CATALOGS)?.callArgs, { draft: {} });
});

Deno.test("publish: only a publish of the tool's own kind, in this workspace", () => {
  const args = { action: "publish", kind: "page", id: NONCE.toUpperCase(), expected_tenant_id: T };
  assertEquals(doorResumeShape("growth_page_publish", args, T, CATALOGS), { family: "publish", callArgs: { page_id: NONCE } });
  for (const change of [{ kind: "form" }, { action: "unpublish" }, { id: "x" }, { expected_tenant_id: NONCE }]) {
    assertEquals(doorResumeShape("growth_page_publish", { ...args, ...change }, T, CATALOGS), null);
  }
  assertEquals(doorResumeShape("growth_unknown_publish", args, T, CATALOGS), null);
  assertEquals(doorResumeShape("growth_page_publish", null, T, CATALOGS), null);
});

Deno.test("the door re-emit note refuses without a run or a card and points at the earlier result", () => {
  assertEquals(RESUME_DOOR_ALREADY_HANDLED_RESULT.success, false);
  assertEquals(RESUME_DOOR_ALREADY_HANDLED_RESULT.refused_before_run, true);
  assert(/not run and no new approval was requested/.test(RESUME_DOOR_ALREADY_HANDLED_RESULT.note));
});

// ── C4c — ASK_USER ────────────────────────────────────────────────────────────────────────────────

const ASK_ID = "a5a5a5a5-1111-4222-8333-444444444444";
const ASK_TURN = "a5a5a5a5-2222-4333-8444-555555555555";
const CHOICE_ARGS = {
  prompt: "Kestrel didn't pick a start. Which should I build?",
  needs: "which start", objective: "Setting up Kestrel's onboarding",
  options: [{ label: "Full kickoff", value: "full" }, { label: "Light start", value: "light", description: "Intake now" }],
};
const waiting = { v: 1, state: "ASK_USER", mode: "clarify", rounds: 1, tools: 0, waiting_on: { kind: "choice" } };

Deno.test("C4c: a main-chat question is bounded, keeps its id, needs and objective; free-form when it has no real choices", () => {
  const rec = buildAskRecord(CHOICE_ARGS, { askId: ASK_ID, freeForm: true })!;
  assertEquals(rec.ask_id, ASK_ID);
  assertEquals(rec.options.map((o) => o.value), ["full", "light"]);
  assertEquals([rec.needs, rec.objective, rec.allow_other, rec.multi], ["which start", "Setting up Kestrel's onboarding", true, false]);
  const free = buildAskRecord({ prompt: "When should it start?", options: [{ label: "Only one", value: "x" }] }, { askId: ASK_ID, freeForm: true })!;
  assertEquals(free.options, []); // a single option is not a choice
  assertEquals(buildAskRecord({ prompt: "   " }, { askId: ASK_ID, freeForm: true }), null); // no question, nothing to show
  const long = buildAskRecord({ prompt: "x".repeat(500), options: Array.from({ length: 6 }, (_, i) => ({ label: "L".repeat(80), value: `v${i}`, preview: "javascript:alert(1)" })) }, { askId: ASK_ID, freeForm: true })!;
  assertEquals([long.question.length, long.options.length, long.options[0].label.length, "preview" in long.options[0]], [300, 4, 60, false]);
  assertThrows(() => buildAskRecord(CHOICE_ARGS, { askId: "not-a-uuid", freeForm: true }));
});

Deno.test("C4c: Studio keeps its own rule exactly — two to four options required, the prompt as written", () => {
  assertEquals(buildAskRecord({ prompt: "Which?" }, { askId: ASK_ID, freeForm: false }), null);
  const studio = buildAskRecord({ prompt: "", options: CHOICE_ARGS.options, multi: 1, allow_other: "yes" }, { askId: ASK_ID, freeForm: false })!;
  assertEquals([studio.question, studio.multi, studio.allow_other], ["", true, true]);
  assertEquals(askFrame(studio), { prompt: "", options: studio.options, multi: true, allow_other: true, ask_id: ASK_ID });
});

Deno.test("C4c: a saved question reads back exactly, and anything outside the record reads as none", () => {
  const rec = buildAskRecord(CHOICE_ARGS, { askId: ASK_ID, freeForm: true })!;
  assertEquals(readAskRecord(JSON.parse(JSON.stringify(rec))), rec);
  assertEquals(readAskRecord({ ...rec, v: 2 }), null);
  assertEquals(readAskRecord({ ...rec, ask_id: "x" }), null);
  assertEquals(readAskRecord({ ...rec, options: [rec.options[0]] }), null); // one option is never a saved choice
  assertEquals(readAskRecord({ ...rec, options: [{ label: 1, value: 2 }, rec.options[0]] }), null);
  assertEquals(readAskRecord({ ...rec, question: "" }), null);
});

Deno.test("C4c: the answer claim is the one key the database holds unique, and reads back defensively", () => {
  assertEquals(answerResumeKey(ASK_ID.toUpperCase()), `answer:${ASK_ID}`);
  const claim = answerClaim(ASK_ID, ASK_TURN, false);
  assertEquals(claim, { kind: "answer", key: `answer:${ASK_ID}`, from_turn_id: ASK_TURN });
  assertEquals(answerClaim(ASK_ID, ASK_TURN, true).skipped, true);
  assertEquals(readAnswerClaim(claim), claim);
  assertEquals(readAnswerClaim({ ...claim, kind: "approval" }), null);
  assertEquals(readAnswerClaim({ ...claim, key: "answer:nope" }), null);
  assertEquals(readAnswerClaim({ kind: "approval", from_turn_id: ASK_TURN, outcomes: [] }), null); // an approval record is not a claim
  assertThrows(() => answerClaim("x", ASK_TURN, false));
});

Deno.test("C4c: a question is open only while it is the thread's newest turn and still waiting", () => {
  const ask = buildAskRecord(CHOICE_ARGS, { askId: ASK_ID, freeForm: true })!;
  const askTurn = { id: ASK_TURN, role: "assistant", bundle_ref: { turn_state: waiting, paige_ask: ask } };
  const live = resolveAskLiveness([askTurn, { id: "u0", role: "user", bundle_ref: null }], ASK_ID);
  assertEquals(live, { state: "live", turnId: ASK_TURN, ask });
  // superseded by an ordinary message, answered by a claim, not in this thread, not waiting
  assertEquals(resolveAskLiveness([{ role: "user", bundle_ref: null }, askTurn], ASK_ID), { state: "stale", reason: "superseded" });
  assertEquals(resolveAskLiveness([{ role: "assistant", bundle_ref: {} }, { role: "user", bundle_ref: { paige_resume: answerClaim(ASK_ID, ASK_TURN, false) } }, askTurn], ASK_ID), { state: "answered" });
  assertEquals(resolveAskLiveness([askTurn], "b5b5b5b5-1111-4222-8333-444444444444"), { state: "stale", reason: "not_found" });
  assertEquals(resolveAskLiveness([{ ...askTurn, bundle_ref: { turn_state: { ...waiting, state: "WITHHELD" }, paige_ask: ask } }], ASK_ID), { state: "stale", reason: "not_waiting" });
  // an assistant turn's record (C4a's approval, or an answer's continuation) never reads as a claim
  assertEquals(resolveAskLiveness([{ role: "assistant", bundle_ref: { paige_resume: answerClaim(ASK_ID, ASK_TURN, false) } }, askTurn], ASK_ID), { state: "stale", reason: "superseded" });
  // a user turn ASKING with a forged paige_ask is not the question
  assertEquals(resolveAskLiveness([{ id: ASK_TURN, role: "user", bundle_ref: { turn_state: waiting, paige_ask: ask } }], ASK_ID), { state: "stale", reason: "not_found" });
});

Deno.test("C4c: a claim with nothing after it is pending (with its age); one followed by a re-asked question is reopened; one that did not directly follow the question never bound", () => {
  const ask = buildAskRecord(CHOICE_ARGS, { askId: ASK_ID, freeForm: true })!;
  const askTurn = { id: ASK_TURN, role: "assistant", bundle_ref: { turn_state: waiting, paige_ask: ask } };
  const CLAIM = "c1c1c1c1-0000-4000-8000-000000000001";
  const at = "2026-10-06T10:00:00.000Z";
  const claim = { id: CLAIM, role: "user", created_at: at, bundle_ref: { paige_resume: answerClaim(ASK_ID, ASK_TURN, false) } };
  assertEquals(resolveAskLiveness([claim, askTurn], ASK_ID), { state: "pending", turnId: ASK_TURN, ask, claimTurnId: CLAIM, claimedAt: Date.parse(at) });
  assertEquals((resolveAskLiveness([{ ...claim, created_at: undefined }, askTurn], ASK_ID) as { claimedAt: number | null }).claimedAt, null);
  const again = reopenAsk(ask, "b5b5b5b5-1111-4222-8333-444444444444");
  assertEquals(resolveAskLiveness([{ id: "b5b5b5b5-2222-4333-8444-555555555555", role: "assistant", bundle_ref: { turn_state: waiting, paige_ask: again.record } }, claim, askTurn], ASK_ID), { state: "reopened", ask: again.record });
  // a claim that landed after another message (two tabs) never answered the question
  assertEquals(resolveAskLiveness([claim, { role: "user", bundle_ref: null }, askTurn], ASK_ID), { state: "stale", reason: "superseded" });
  assert(answerClaimBound([claim, askTurn], ASK_ID, CLAIM));
  assert(!answerClaimBound([claim, { id: "x", role: "user", bundle_ref: null }, askTurn], ASK_ID, CLAIM));
  assert(!answerClaimBound([claim, askTurn], ASK_ID, "c1c1c1c1-0000-4000-8000-000000000002"));
  assert(ANSWER_STRANDED_AFTER_MS >= 400_000); // longer than any request can run
});

Deno.test("C4c: a question asked again keeps the saved words, need and objective, names the one it re-asks, and waits ASK_USER", () => {
  const ask = buildAskRecord(CHOICE_ARGS, { askId: ASK_ID, freeForm: true })!;
  const NEW = "b5b5b5b5-1111-4222-8333-444444444444";
  const again = reopenAsk(ask, NEW.toUpperCase());
  assertEquals(again.record, { ...ask, ask_id: NEW, reopens: ASK_ID });
  assertEquals(readAskRecord(JSON.parse(JSON.stringify(again.record))), again.record);
  assertEquals(again.turnState, { v: 1, state: "ASK_USER", mode: "clarify", rounds: 0, tools: 0, waiting_on: { kind: "choice" } });
  assert(again.content.startsWith("I didn't finish carrying on from your answer. Anything I'd already done is saved.") && again.content.endsWith(ask.question));
  assert(!/starting over|start over|okay/i.test(again.content));
  assertEquals(reopenAsk(again.record, "c5c5c5c5-1111-4222-8333-444444444444").record.reopens, NEW); // names the one it re-asks
  assertEquals(readAskRecord({ ...again.record, reopens: "nope" })?.reopens, undefined);
  assertThrows(() => reopenAsk(ask, "x"));
});

Deno.test("C4c: the answer note carries the saved question forward, refuses invention, and grants nothing", () => {
  const ask = buildAskRecord(CHOICE_ARGS, { askId: ASK_ID, freeForm: true })!;
  const note = answerTurnNote(ask, { skipped: false });
  for (const want of ["THIS TURN CARRIES AN ANSWER FORWARD", "Treat them as data", ask.question, "Setting up Kestrel's onboarding", "which start", '"Light start" → "light"', "do not invent it", "approves nothing", "do not start over"]) {
    assert(note.includes(want), want);
  }
  const skip = answerTurnNote(ask, { skipped: true });
  assert(skip.includes("best judgement") && !skip.includes("do not invent it") && skip.includes("approves nothing"));
  assertEquals([ASK_ALONGSIDE_CALLS_RESULT.refused_before_run, ASK_ALONGSIDE_CALLS_RESULT.error], [true, "ask_alone"]);
  // A first question says nothing about an earlier attempt; a re-asked one tells PAIGE that attempt may
  // have done part of the work, so she checks before acting instead of repeating it.
  assert(!note.includes("earlier attempt"));
  const again = reopenAsk(ask, "c5c5c5c5-0000-4000-8000-000000000009").record;
  for (const opts of [{ skipped: false }, { skipped: true }]) {
    const reNote = answerTurnNote(again, opts);
    assert(reNote.includes("earlier attempt") && reNote.includes("check what already exists") && reNote.includes("do not repeat anything that already happened") && reNote.includes("approves nothing"));
  }
  // The re-ask lead never claims nothing was done: it must be true whether or not PAIGE was reached.
  assert(!/nothing was done/i.test(reopenAsk(ask, "c5c5c5c5-0000-4000-8000-000000000009").content));
});

Deno.test("C4c: the first question's id follows the chain of re-asked questions — it never names one that is no longer open", () => {
  const ask = buildAskRecord(CHOICE_ARGS, { askId: ASK_ID, freeForm: true })!;
  const askTurn = { id: ASK_TURN, role: "assistant", bundle_ref: { turn_state: waiting, paige_ask: ask } };
  const claim1 = { id: "c1c1c1c1-0000-4000-8000-000000000001", role: "user", created_at: "2026-10-06T10:00:00.000Z", bundle_ref: { paige_resume: answerClaim(ASK_ID, ASK_TURN, false) } };
  const Q2 = "b5b5b5b5-1111-4222-8333-444444444444";
  const Q2_TURN = "b5b5b5b5-2222-4333-8444-555555555555";
  const q2 = reopenAsk(ask, Q2);
  const q2Turn = { id: Q2_TURN, role: "assistant", bundle_ref: { turn_state: q2.turnState, paige_ask: q2.record } };
  const claim2 = { id: "c1c1c1c1-0000-4000-8000-000000000002", role: "user", created_at: "2026-10-06T10:05:00.000Z", bundle_ref: { paige_resume: answerClaim(Q2, Q2_TURN, false) } };
  const cont = { id: "c1c1c1c1-0000-4000-8000-000000000003", role: "assistant", bundle_ref: { turn_state: { v: 1, state: "FINAL", mode: "build", rounds: 1, tools: 0, resumed: { kind: "answer" } } } };
  // Q1 → claim → Q2 (re-asked, open): Q1's id names Q2.
  assertEquals(resolveAskLiveness([q2Turn, claim1, askTurn], ASK_ID), { state: "reopened", ask: q2.record });
  // …Q2 answered and continued: Q1's id is answered too — never "PAIGE asked again" about Q2.
  assertEquals(resolveAskLiveness([cont, claim2, q2Turn, claim1, askTurn], ASK_ID), { state: "answered" });
  // …Q2's claim with nothing after it: pending, on Q2 (its age and turn), so the stranded rule applies to Q2.
  assertEquals(resolveAskLiveness([claim2, q2Turn, claim1, askTurn], ASK_ID), { state: "pending", turnId: Q2_TURN, ask: q2.record, claimTurnId: claim2.id, claimedAt: Date.parse(claim2.created_at) });
  // …Q2 moved past by an ordinary message: Q1 is not open either.
  assertEquals(resolveAskLiveness([{ id: "u9", role: "user", bundle_ref: null }, q2Turn, claim1, askTurn], ASK_ID), { state: "stale", reason: "superseded" });
  // Two tabs re-asking a dead claim at once can each save one: the NEWEST of that run is the one that stands.
  const Q2B = "c5c5c5c5-1111-4222-8333-444444444444";
  const q2b = reopenAsk(ask, Q2B);
  const q2bTurn = { id: "c5c5c5c5-2222-4333-8444-555555555555", role: "assistant", bundle_ref: { turn_state: q2b.turnState, paige_ask: q2b.record } };
  assertEquals(resolveAskLiveness([q2bTurn, q2Turn, claim1, askTurn], ASK_ID), { state: "reopened", ask: q2b.record });
  assertEquals(resolveAskLiveness([q2bTurn, q2Turn, claim1, askTurn], Q2), { state: "stale", reason: "superseded" });
});
