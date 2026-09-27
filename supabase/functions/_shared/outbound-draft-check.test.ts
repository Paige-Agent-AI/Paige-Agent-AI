import { test } from "node:test";
import assert from "node:assert/strict";

import { customerBoundTexts, CUSTOMER_REACHING_EXECUTORS, draftRefusal, internalTextInDraft, OUTBOUND_DRAFT_TOOLS } from "./outbound-draft-check.ts";

const TOOLS = [
  { type: "function", function: { name: "update_client_data", description: "Update the client's own record.", parameters: { type: "object", properties: {} } } },
  { type: "function", function: { name: "propose_action", description: "Draft an outbound message.", parameters: { type: "object", properties: {} } } },
];
const TURN = { tools: TOOLS, vouchedTexts: [], toolResults: ['{"success":true,"approval_id":"x","next_step_hint":"none"}'] };
const RECORD = "5a5a5a5a-5a5a-4a5a-8a5a-5a5a5a5a5a5a";

test("each tool's customer-bound fields, and nothing else", () => {
  assert.deepEqual(customerBoundTexts("propose_action", { subject: "S", body: "B", summary: "owner line", to: "a@b.example", contact_id: RECORD }), ["S", "B"]);
  assert.deepEqual(customerBoundTexts("calendar_link_send", { subject: "S", message: "M", calendarId: RECORD, contactId: RECORD, channel: "email" }), ["S", "M"]);
  assert.deepEqual(customerBoundTexts("action_file", { action_kind: "client.portal_recommendation", title: "T", summary: "U", contact_id: RECORD }, { executor: "surface_to_client" }), ["T", "U"]);
  assert.deepEqual(customerBoundTexts("action_file", { title: "T", summary: "U" }, { executor: "record_only" }), []);
  assert.deepEqual(customerBoundTexts("action_file", { title: "T", summary: "U" }, { executor: "workflow" }), []);
  assert.deepEqual(customerBoundTexts("crm_create_task", { title: "T" }), []);
  // Blank and non-text values are not text anyone reads.
  assert.deepEqual(customerBoundTexts("propose_action", { subject: "  ", body: 42 }), []);
});

test("a list or an object is read string by string, the way the send path would join it", () => {
  assert.deepEqual(customerBoundTexts("propose_action", { subject: "S", body: ["Hi Dana,", "see you soon"] }), ["S", "Hi Dana,", "see you soon"]);
  assert.deepEqual(customerBoundTexts("calendar_link_send", { message: { text: "M" } }), ["M"]);
  assert.deepEqual(customerBoundTexts("action_file", { title: ["T1", "T2"] }, { executor: "surface_to_client" }), ["T1", "T2"]);
});

test("a follow-up action is read for what advance_action delivers for its kind", () => {
  const draft = { channel: "email", contact_id: RECORD, subject: "S", body: "B", parts: [{ text: "P" }], brief: "owner note" };
  const stored = { status: "filed", title: "T", summary: "U", draft_content: { subject: "OS", body: "OB" } };
  // The approval lane sends the subject and the body (or the message), when the action is drafted.
  assert.deepEqual(customerBoundTexts("action_advance", { to_status: "drafted", draft_content: draft }, { executor: "send_via_approval", stored }), ["S", "B"]);
  assert.deepEqual(customerBoundTexts("action_advance", { to_status: "drafted", draft_content: { message: "M" } }, { executor: "send_via_approval", stored }), ["M"]);
  assert.deepEqual(customerBoundTexts("action_advance", { to_status: "drafted" }, { executor: "send_via_approval", stored }), ["OS", "OB"]);
  assert.deepEqual(customerBoundTexts("action_advance", { to_status: "executing" }, { executor: "send_via_approval", stored }), []);
  // The client's portal shows the action's title and the draft's body, or its summary.
  assert.deepEqual(customerBoundTexts("action_advance", { to_status: "executing" }, { executor: "surface_to_client", stored }), ["T", "OB"]);
  assert.deepEqual(customerBoundTexts("action_advance", { to_status: "drafted", draft_content: draft }, { executor: "surface_to_client", stored }), ["T", "B"]);
  assert.deepEqual(customerBoundTexts("action_advance", { to_status: "executing" }, { executor: "surface_to_client", stored: { title: "T", summary: "U", draft_content: null } }), ["T", "U"]);
  // An owner-only or workflow kind delivers nothing to a customer, and neither do other statuses.
  assert.deepEqual(customerBoundTexts("action_advance", { to_status: "drafted", draft_content: draft }, { executor: "record_only", stored }), []);
  assert.deepEqual(customerBoundTexts("action_advance", { to_status: "drafted", draft_content: draft }, { executor: "workflow", stored }), []);
  assert.deepEqual(customerBoundTexts("action_advance", { to_status: "dismissed", draft_content: draft }, { executor: "surface_to_client", stored }), []);
  assert.deepEqual(customerBoundTexts("action_advance", { draft_content: draft }, { executor: "send_via_approval", stored: { ...stored, status: "assigned" } }), []);
  // A kind that could not be found out is read by every route; a draft that is not an object carries no message.
  assert.deepEqual(customerBoundTexts("action_advance", { to_status: "drafted", draft_content: draft }), ["S", "B"]);
  assert.deepEqual(customerBoundTexts("action_advance", { to_status: "drafted", draft_content: draft }, { stored }), ["S", "B", "T"]);
  assert.deepEqual(customerBoundTexts("action_advance", { draft_content: "not an object" }), []);
  assert.deepEqual(customerBoundTexts("action_advance", {}), []);
});

test("a value deeper than the bound is not walked", () => {
  const deep = { a: { b: { c: { d: { e: "too deep" } } } } };
  assert.deepEqual(customerBoundTexts("propose_action", { body: deep }), []);
  assert.deepEqual(customerBoundTexts("propose_action", { body: { a: { b: { c: { d: "deep enough" } } } } }), ["deep enough"]);
});

test("the executors that reach a customer are the registry's two", () => {
  assert.deepEqual([...CUSTOMER_REACHING_EXECUTORS].sort(), ["send_via_approval", "surface_to_client"]);
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
  const sending = draftRefusal(leaks, "sending");
  assert.match(String(sending.note), /^Nothing was sent\. .* offer to rewrite it for a fresh approval\.$/);
  // Its own keys are ordinary words, so the refusal adds nothing to the next read's vocabulary.
  assert.deepEqual(Object.keys(filing).filter((key) => key.includes("_")), []);
  const many = Array.from({ length: 14 }, (_, i) => ({ kind: "tool_name" as const, text: `tool_${i}`, index: i }));
  assert.equal((draftRefusal(many, "filing").found as string[]).length, 10);
});
