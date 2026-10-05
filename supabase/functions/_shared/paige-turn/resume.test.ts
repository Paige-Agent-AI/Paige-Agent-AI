// deno test --allow-import --node-modules-dir=none supabase/functions/_shared/paige-turn/resume.test.ts
//
// C4a — the pure half of the approval resume (resume.ts). What these hold: the server rebuilds the
// approved act from its STORED row and nothing else; the id it runs under is deterministic per
// approval and inside the provider's id alphabet; only governed general-gate writes are carried
// forward; the per-act outcome uses the existing closed vocabulary and never reads optimism into a
// result; and the persisted record is closed enums plus the caller's own card tokens, read
// defensively. The handler's IO is driven end to end in scripts/client-memory-authz (group 39).
import { assert, assertEquals, assertThrows } from "https://deno.land/std@0.190.0/testing/asserts.ts";
import {
  actIdentityArgs,
  buildResumeCall,
  classifyResumedApproval,
  findSuspendedTurnId,
  isResumableTool,
  parseScopedToken,
  readResumeApprovalFrame,
  readResumeRecord,
  RESUME_ALREADY_HANDLED_RESULT,
  RESUME_CHECK_UNAVAILABLE_RESULT,
  RESUME_EXPIRED_RESULT,
  RESUME_KINDS,
  RESUME_LOST_RESULT,
  RESUME_TURN_NOTE,
  resumeCallId,
  resumeRecord,
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
