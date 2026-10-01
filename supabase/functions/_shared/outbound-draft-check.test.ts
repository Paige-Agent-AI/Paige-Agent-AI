import { test } from "node:test";
import assert from "node:assert/strict";

import { customerBoundTexts, draftRefusal, internalTextInDraft, OUTBOUND_DRAFT_TOOLS, PORTAL_EXECUTOR } from "./outbound-draft-check.ts";

const TOOLS = [
  { type: "function", function: { name: "update_client_data", description: "Update the client's own record.", parameters: { type: "object", properties: {} } } },
  { type: "function", function: { name: "propose_action", description: "Draft an outbound message.", parameters: { type: "object", properties: {} } } },
];
const TURN = { tools: TOOLS, vouchedTexts: [], toolResults: ['{"success":true,"approval_id":"x","next_step_hint":"none"}'] };
const RECORD = "5a5a5a5a-5a5a-4a5a-8a5a-5a5a5a5a5a5a";

test("each tool's customer-bound fields, and nothing else", () => {
  assert.deepEqual(customerBoundTexts("propose_action", { subject: "S", body: "B", summary: "owner line", to: "a@b.example", contact_id: RECORD }), ["S", "B"]);
  // A text carries no subject, so an SMS draft's subject is never read.
  assert.deepEqual(customerBoundTexts("propose_action", { action_type: "SMS", subject: "S", body: "B" }), ["B"]);
  assert.deepEqual(customerBoundTexts("calendar_link_send", { subject: "S", message: "M", calendarId: RECORD, contactId: RECORD, channel: "email" }), ["S", "M"]);
  assert.deepEqual(customerBoundTexts("calendar_link_send", { subject: "S", message: "M", channel: "sms" }), ["M"]);
  // The portal shows a filed action's title and summary; another executor's are the owner's.
  assert.deepEqual(customerBoundTexts("action_file", { action_kind: "client.portal_recommendation", title: "T", summary: "U", contact_id: RECORD }, { executor: "surface_to_client" }), ["T", "U"]);
  for (const executor of ["send_via_approval", "record_only", "workflow"]) {
    assert.deepEqual(customerBoundTexts("action_file", { title: "T", summary: "U" }, { executor }), []);
  }
  assert.deepEqual(customerBoundTexts("action_file", { title: "T", summary: "U" }), ["T", "U"]);
  assert.deepEqual(customerBoundTexts("crm_create_task", { title: "T" }), []);
  // Blank and non-text values are not text anyone reads.
  assert.deepEqual(customerBoundTexts("propose_action", { subject: "  ", body: 42 }), []);
});

test("a list or an object is read for everything a send path could make of it: its strings and its keys", () => {
  assert.deepEqual(customerBoundTexts("propose_action", { subject: "S", body: ["Hi Dana,", "see you soon"] }), ["S", "Hi Dana,", "see you soon"]);
  // Postgres's ->> writes an object out whole, keys and all, so a key is text a customer can read.
  assert.deepEqual(customerBoundTexts("calendar_link_send", { message: { text: "M" } }), ["text", "M"]);
  assert.deepEqual(customerBoundTexts("action_file", { title: ["T1", "T2"] }, { executor: "surface_to_client" }), ["T1", "T2"]);
});

test("depth is no way past: String() flattens any nesting, and ->> writes every level", () => {
  let deep: unknown = "update_client_data";
  for (let i = 0; i < 64; i += 1) deep = [deep];
  assert.deepEqual(customerBoundTexts("propose_action", { body: deep }), ["update_client_data"]);
  let keyed: unknown = "B";
  for (let i = 0; i < 6; i += 1) keyed = { [`k${i}`]: keyed };
  assert.deepEqual(customerBoundTexts("propose_action", { body: keyed }), ["k5", "k4", "k3", "k2", "k1", "k0", "B"]);
  // A portal action's stored body as an object: its keys are what the portal would show.
  const stored = { status: "drafted", title: "T", draft_content: { body: { update_client_data: "Book" } } };
  assert.deepEqual(customerBoundTexts("action_advance", { to_status: "executing" }, { executor: "surface_to_client", requiresApproval: false, stored }),
    ["T", "update_client_data", "Book"]);
  // A value nested far deeper than any stack would allow by recursion still reads.
  let huge: unknown = "end";
  for (let i = 0; i < 100_000; i += 1) huge = [huge];
  assert.deepEqual(customerBoundTexts("propose_action", { body: huge }), ["end"]);
});

test("a follow-up action is read for what advance_action delivers", () => {
  const draft = { channel: "email", contact_id: RECORD, subject: "S", body: "B", parts: [{ text: "P" }], brief: "owner note" };
  const stored = { status: "filed", title: "T", summary: "U", draft_content: { subject: "OS", body: "OB" } };
  const read = (args: Record<string, unknown>, context: Record<string, unknown>) => customerBoundTexts("action_advance", args, context);
  // Drafted, for a kind that requires approval, WHATEVER its executor: the approval lane sends the draft's
  // subject and body (or message) — the one attached, else the stored one.
  for (const executor of ["send_via_approval", "record_only", "surface_to_client", "workflow"]) {
    assert.deepEqual(read({ to_status: "drafted", draft_content: draft }, { executor, requiresApproval: true, stored }), ["S", "B"], executor);
  }
  assert.deepEqual(read({ to_status: "drafted", draft_content: { message: "M" } }, { executor: "record_only", requiresApproval: true, stored }), ["M"]);
  assert.deepEqual(read({ to_status: "drafted" }, { executor: "send_via_approval", requiresApproval: true, stored }), ["OS", "OB"]);
  // Drafted, for a kind that needs no approval: nothing is sent, except that a workflow kind in the auto lane
  // runs at once and can file its STORED draft for approval.
  assert.deepEqual(read({ to_status: "drafted", draft_content: draft }, { executor: "record_only", requiresApproval: false, stored }), []);
  assert.deepEqual(read({ to_status: "drafted", draft_content: draft }, { executor: "surface_to_client", requiresApproval: false, stored }), []);
  assert.deepEqual(read({ to_status: "drafted", draft_content: draft }, { executor: "workflow", requiresApproval: false, stored }), ["OS", "OB"]);
  // Executing: a portal kind shows its stored title and the stored draft's body, or its summary; a workflow
  // kind can file its stored draft; a record-only kind and a send-via-approval kind deliver nothing.
  assert.deepEqual(read({ to_status: "executing" }, { executor: "surface_to_client", stored }), ["T", "OB"]);
  assert.deepEqual(read({ to_status: "executing" }, { executor: "surface_to_client", stored: { title: "T", summary: "U", draft_content: null } }), ["T", "U"]);
  assert.deepEqual(read({ to_status: "executing" }, { executor: "workflow", stored }), ["OS", "OB"]);
  assert.deepEqual(read({ to_status: "executing" }, { executor: "record_only", stored }), []);
  assert.deepEqual(read({ to_status: "executing" }, { executor: "send_via_approval", stored }), []);
  // Other statuses deliver nothing; with no status, the stored one is re-run.
  assert.deepEqual(read({ to_status: "dismissed", draft_content: draft }, { executor: "surface_to_client", requiresApproval: true, stored }), []);
  assert.deepEqual(read({ draft_content: draft }, { executor: "send_via_approval", requiresApproval: true, stored: { ...stored, status: "assigned" } }), []);
  // What could not be found out is read by every route; a draft that is not an object carries no message.
  assert.deepEqual(read({ to_status: "drafted", draft_content: draft }, {}), ["S", "B"]);
  assert.deepEqual(read({ to_status: "drafted", draft_content: draft }, { stored }), ["S", "B", "OS", "OB"]);
  assert.deepEqual(read({ to_status: "executing" }, { stored }), ["T", "OB", "OS"]);
  assert.deepEqual(read({ to_status: "executing" }, {}), []);
  assert.deepEqual(read({ draft_content: "not an object" }, {}), []);
  assert.deepEqual(read({}, {}), []);
});

test("the portal executor is the registry's own value", () => {
  assert.equal(PORTAL_EXECUTOR, "surface_to_client");
  assert.deepEqual([...OUTBOUND_DRAFT_TOOLS].sort(), ["action_advance", "action_file", "calendar_link_send", "propose_action"]);
});

test("internal text in a draft is found against this turn's vocabulary", () => {
  const kinds = (text: string) => internalTextInDraft([text], TURN).map((leak) => leak.kind);
  assert.deepEqual(kinds("I ran update_client_data for you."), ["tool_name"]);
  assert.deepEqual(kinds(`Your file is ${RECORD}.`), ["record_id"]);
  assert.deepEqual(kinds("Your next_step_hint is ready."), ["internal_key"]);
  assert.deepEqual(kinds('new row violates row-level security policy for table "clients"').length, 1);
  // Ordinary customer text: a link, an address, a phone number, a merge tag, words that are also keys.
  assert.deepEqual(internalTextInDraft(["Hi {{first_name}}, book at https://paigeagent.ai/book/intro or write to desk@northside.example, (415) 555-0132. Your title and tasks are set."], TURN), []);
  assert.deepEqual(internalTextInDraft([], TURN), []);
});

test("the refusal lists what matched, once each, and says what to do at each stage", () => {
  const leaks = internalTextInDraft(["update_client_data then update_client_data", `and ${RECORD}`], TURN);
  const filing = draftRefusal(leaks, "filing");
  assert.equal(filing.success, false);
  assert.equal(filing.error, "internal_text_in_draft");
  assert.deepEqual(filing.found, ["update_client_data", RECORD]);
  assert.match(String(filing.note), /^Nothing was filed\. .* Rewrite it in plain words/);
  const approved = draftRefusal(leaks, "approved");
  assert.match(String(approved.note), /^Nothing went ahead\. .* offer to rewrite it for a fresh approval\.$/);
  // Its own keys are ordinary words, so the refusal adds nothing to the next read's vocabulary.
  assert.deepEqual(Object.keys(filing).filter((key) => key.includes("_")), []);
  const many = Array.from({ length: 14 }, (_, i) => ({ kind: "tool_name" as const, text: `tool_${i}`, index: i }));
  assert.equal((draftRefusal(many, "filing").found as string[]).length, 10);
});
