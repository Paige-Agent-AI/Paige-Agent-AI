/**
 * client-seat-reply — what a client reads when an answer is withheld, and which of the turn's texts are
 * read. The detector itself is proven in internal-vocabulary.test.ts; this is the seam the chat handler
 * calls at both release points.
 *
 *   node --import ./scripts/client-memory-authz/register.mjs --test supabase/functions/_shared/client-seat-reply.test.ts
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { decodeChunks, internalTextForClient, leakKindCounts, readableFromFrames, resultSavedSomething, syncStatusForClient, WITHHELD_FRAME, withheldReplyForClient } from "./client-seat-reply.ts";

const TOOLS = [
  { type: "function", function: { name: "update_client_data", description: "Update the client's own record.", parameters: { type: "object", properties: {} } } },
];
const SYSTEM = [
  "=== CLIENT CONTEXT ===\n{\"portal_stage\": \"onboarding\"}\n=== END CLIENT CONTEXT ===",
  "Speak plainly. {\"tone_profile\": \"warm\"}",
];
const RESULTS = [JSON.stringify({ updated_fields: ["phone"], rows: [{ vendor_key: 1 }] })];
const turn = (readable: string[]) => ({ readable, tools: TOOLS, vouchedTexts: SYSTEM, toolResults: RESULTS });

test("reads every readable text, so a leak in a thought line counts as much as one in the answer", () => {
  const leaks = internalTextForClient(turn([
    "Your phone number is saved.",
    "Checking the CLIENT CONTEXT before I call update_client_data",
  ]));
  assert.deepEqual(leaks.map((leak) => `${leak.kind}:${leak.text}`), [
    "context_marker:CLIENT CONTEXT",
    "tool_name:update_client_data",
  ]);
});

test("the vocabulary is this turn's: server keys and the tool result's own envelope, never a fenced body or nested rows", () => {
  const leaks = internalTextForClient(turn([
    "Your portal_stage is onboarding, your tone_profile is warm, updated_fields lists phone, and vendor_key stays.",
  ]));
  // `portal_stage` is inside a fenced block, where a client's own data lives, so it is not vocabulary;
  // `vendor_key` is nested inside the tool result's rows, which a runner may have filled.
  assert.deepEqual(leaks.map((leak) => leak.text), ["tone_profile", "updated_fields"]);
});

test("an ordinary answer to a client passes clean", () => {
  const leaks = internalTextForClient(turn([
    "Thanks, Jordan. Your next session is Tuesday at 10am. Reply to coach@northside.example or call (415) 555-0132, and your booking link is https://book.example.test/s/intro_call.",
    "Your title on file is Operations Lead, you have 3 open tasks, and 2 clients referred you.",
  ]));
  assert.deepEqual(leaks, []);
});

test("nothing is read when there is nothing readable", () => {
  assert.deepEqual(internalTextForClient(turn([])), []);
  assert.deepEqual(internalTextForClient(turn([""])), []);
});

test("the log carries kinds and counts, never the text", () => {
  const leaks = internalTextForClient(turn([
    "update_client_data ran; update_client_data again; the CLIENT CONTEXT says so.",
  ]));
  const counts = leakKindCounts(leaks);
  assert.deepEqual(counts, { tool_name: 2, context_marker: 1 });
  assert.equal(JSON.stringify(counts).includes("update_client_data"), false);
});

test("only vouched text is read: a client's answer that repeats the tenant's own words is sent", () => {
  // A persona a tenant wrote, in the two shapes no syntax rule can tell from the server's own.
  const PERSONA = 'We offer basic, "gold_tier": true for premium customers.\nVIP PLAN\nMembers book first.\nEND VIP PLAN';
  const REPLY = "Your gold_tier plan includes early booking. That's part of the VIP PLAN.";
  assert.deepEqual(internalTextForClient(turn([REPLY])), []);
  // CONTROL: the same persona, wrongly vouched, would withhold that answer.
  const misvouched = internalTextForClient({ ...turn([REPLY]), vouchedTexts: [...SYSTEM, PERSONA] });
  assert.deepEqual(misvouched.map((leak) => leak.text).sort(), ["VIP PLAN", "gold_tier"]);
});

test("the withheld sentence says an answer existed, was not sent and why, offers what to do, and invents nothing", () => {
  const sentence = withheldReplyForClient("Northside Fitness");
  assert.equal(
    sentence,
    "I wrote an answer, but it included internal system details that aren't meant to be shared here, so I didn't send it. I won't guess at a different answer. You can ask me another way, or ask Northside Fitness directly.",
  );
  // It must itself pass the check it stands in for, with any vocabulary.
  assert.deepEqual(internalTextForClient(turn([sentence])), []);
});

test("without a business name it still tells the client who to ask", () => {
  for (const name of [null, undefined, "", "   "]) {
    assert.match(withheldReplyForClient(name), /ask the team you're working with directly\.$/);
  }
});

test("a business name is written tidily and bounded", () => {
  assert.match(withheldReplyForClient("  Northside\n  Fitness  "), /ask Northside Fitness directly\.$/);
  const long = withheldReplyForClient("N".repeat(200));
  assert.ok(long.includes(`ask ${"N".repeat(80)} directly.`));
});

test("reads the frames as they will be released: the answer across deltas, then each thought line and confirm summary", () => {
  const frame = (payload: unknown) => `data: ${JSON.stringify(payload)}\n\n`;
  const frames = [
    frame({ paige_step: { kind: "thought", label: "Checking your file" } }),
    frame({ paige_step: { kind: "action", label: "Looked up your record" } }),
    frame({ choices: [{ delta: { content: "Your next session " } }] }),
    frame({ choices: [{ delta: { content: "is Tuesday. Reply [DONE] when read." } }] }),
    "data: {not json\n\n",
    frame({ approval_queued: [{ id: "5a5a5a5a-5a5a-4a5a-8a5a-5a5a5a5a5a5a" }] }),
    frame({ paige_confirm: { tool: "update_client_data", summary: "Save 1 detail to your file (phone)." } }),
    "data: [DONE]\n\n",
  ].join("");
  assert.deepEqual(readableFromFrames(frames), [
    "Your next session is Tuesday. Reply [DONE] when read.",
    "Checking your file",
    "Save 1 detail to your file (phone).",
  ]);
  assert.deepEqual(readableFromFrames(""), [""]);
});

test("held chunks decode whole, even when a character is split between two of them", () => {
  const bytes = new TextEncoder().encode('data: {"choices":[{"delta":{"content":"café"}}]}\n\n');
  const at = bytes.indexOf(0xc3) + 1; // inside the two-byte "é"
  assert.deepEqual(readableFromFrames(decodeChunks([bytes.slice(0, at), bytes.slice(at)])), ["café"]);
});

test("the same text read twice counts once", () => {
  const text = "Done, I ran update_client_data.";
  assert.deepEqual(leakKindCounts(internalTextForClient(turn([text, text]))), { tool_name: 1 });
});

test("a save counts only by the write's own report: succeeded, not waiting on approval, and at least one item saved", () => {
  const saved = (value: unknown) => resultSavedSomething(JSON.stringify(value));
  assert.equal(saved({ success: true }), true);
  assert.equal(saved({ success: true, results: [{ field_path: "phone", success: false }, { field_path: "email", success: true }] }), true);
  // The client-data write-back answers success for the request and lists each field's own outcome.
  assert.equal(saved({ success: true, results: [{ field_path: "phone", success: false, error: "Field not in whitelist" }] }), false);
  assert.equal(saved({ success: true, results: [] }), false);
  assert.equal(saved({ success: false, needs_confirm: true }), false);
  assert.equal(saved({ success: true, needs_confirm: true }), false);
  assert.equal(saved({ success: false, error: "boom" }), false);
  assert.equal(saved({ success: "true" }), false);
  assert.equal(saved([{ success: true }]), false);
  assert.equal(resultSavedSomething("not json"), false);
});

test("when something was saved, the sentence says so in the platform's own words, and passes its own check", () => {
  const named = withheldReplyForClient("Northside Fitness", { savedSomething: true });
  assert.equal(
    named,
    "I wrote an answer, but it included internal system details that aren't meant to be shared here, so I didn't send it. Anything I'd already finished is saved — you don't need to send it again. I won't guess at a different answer. You can ask me another way, or ask Northside Fitness directly.",
  );
  assert.match(withheldReplyForClient(null, { savedSomething: true }), /Anything I'd already finished is saved — you don't need to send it again\. .*ask the team you're working with directly\.$/);
  // Without a save, the approved sentence stands word for word.
  assert.equal(withheldReplyForClient("Northside Fitness", { savedSomething: false }), withheldReplyForClient("Northside Fitness"));
  assert.deepEqual(internalTextForClient(turn([named])), []);
});

test("the withheld frame is one data line that carries no text", () => {
  assert.equal(WITHHELD_FRAME, 'data: {"paige_withheld":true}\n\n');
  assert.deepEqual(readableFromFrames(WITHHELD_FRAME), [""]);
});

const BEFORE_ANY_WRITE = "I read your report, but I couldn't pull out its details for you to review, and none of them were added to your profile. You can try uploading it again, or ask Northside Fitness to take a look.";
const DID_NOT_FINISH = "I read your report, but I couldn't finish pulling out its details for you to review. You can ask Northside Fitness to take a look.";

test("a credit-report sync failure reaches the uploader as a fixed sentence, never the pipeline's text or step (R3b)", () => {
  const raw = {
    success: false,
    error: "Validation failed: negative_items[0].account_type must be one of revolving, installment",
    step: "validation",
    validationErrors: ["negative_items[0].account_type"],
    negative_items_synced: 0,
  };
  const out = syncStatusForClient(raw, "  Northside   Fitness ");
  assert.deepEqual(out, { success: false, negative_items_synced: 0, uploader_sentence: true, error: BEFORE_ANY_WRITE });
  const text = JSON.stringify(out);
  for (const internal of ["validation", "negative_items[0]", "account_type", "step"]) assert.equal(text.includes(internal), false, internal);
  // An exception's own message is never passed either, and with no name the sentence still reads.
  assert.equal(syncStatusForClient({ success: false, error: "TypeError: cannot read properties of undefined (reading 'id')", step: "pipeline" })?.error,
    "I read your report, but I couldn't finish pulling out its details for you to review. You can ask the team you're working with to take a look.");
});

test("only a failure before the pipeline's first write says nothing was added (R3b)", () => {
  // The three steps that stop before the client memory row, the upload stamp or the proposal.
  for (const step of ["extraction", "extraction_parse", "validation"]) {
    assert.equal(syncStatusForClient({ success: false, error: "x", step }, "Northside Fitness")?.error, BEFORE_ANY_WRITE, step);
  }
  // Every other step may come after the client memory row was written, so none says nothing was
  // kept, and none suggests uploading again: a rejected upload stamp, an exception, a missing upload
  // record, a workspace that changed mid-way, the handler's own catch, and a step nobody has named yet.
  for (const step of ["write_rejected", "pipeline", "no_upload_record", "active_account_changed", "pipeline_exception", "something_new", undefined]) {
    const raw = { success: false, error: "That could not be saved", step, write: "credit_report_uploads" };
    const out = syncStatusForClient(raw, "Northside Fitness");
    assert.equal(out?.error, DID_NOT_FINISH, String(step));
    assert.equal(out?.uploader_sentence, true, String(step));
    assert.equal(/none of them were added|uploading it again|saved/.test(String(out?.error)), false, String(step));
    assert.equal(JSON.stringify(out).includes("credit_report_uploads"), false, String(step));
  }
});

test("each panel field passes only in its own type, and a raw error never passes (R3b)", () => {
  const waiting = { success: false, awaiting_review: true, nothing_to_propose: true, error: "I read the document, but nothing in it was clear enough to be worth saving to the profile.", step: "x" };
  // A report waiting on review carries its flags and no sentence: never the raw one, never a failure's.
  assert.deepEqual(syncStatusForClient(waiting), { success: false, awaiting_review: true, nothing_to_propose: true });
  const done = { success: true, scores_synced: { equifax: 700, experian: null, transunion: "700; DROP", vantage: 1 }, disputes_created: 2, negative_items_synced: "3 items", positive_accounts_synced: -1, credit_factors_recalculated: "yes", funding_readiness_recalculated: true, error: "should not pass", report_id: "5a5a5a5a-5a5a-4a5a-8a5a-5a5a5a5a5a5a", step: "done" };
  assert.deepEqual(syncStatusForClient(done), { success: true, disputes_created: 2, funding_readiness_recalculated: true, scores_synced: { equifax: 700, experian: null } });
  assert.deepEqual(syncStatusForClient({ success: "true" }), { success: false, uploader_sentence: true, error: "I read your report, but I couldn't finish pulling out its details for you to review. You can ask the team you're working with to take a look." });
  assert.equal(syncStatusForClient(null), null);
  assert.equal(syncStatusForClient("failed"), null);
});
