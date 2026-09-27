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
  assert.deepEqual(customerBoundTexts("action_advance", { action_id: RECORD, to_status: "drafted", decision_rationale: "why", draft_content: { channel: "email", subject: "S", body: "B", parts: [{ text: "P" }] } }), ["email", "S", "B", "P"]);
  assert.deepEqual(customerBoundTexts("action_file", { action_kind: "client.portal_recommendation", title: "T", summary: "U", contact_id: RECORD }), ["T", "U"]);
  assert.deepEqual(customerBoundTexts("action_file", { title: "T", summary: "U" }, { kindReachesCustomer: false }), []);
  assert.deepEqual(customerBoundTexts("crm_create_task", { title: "T" }), []);
  // Blank and non-string values are not text anyone reads.
  assert.deepEqual(customerBoundTexts("propose_action", { subject: "  ", body: 42 }), []);
  assert.deepEqual(customerBoundTexts("action_advance", { draft_content: "not an object" }), ["not an object"]);
  assert.deepEqual(customerBoundTexts("action_advance", {}), []);
});

test("a draft deeper than the bound is not walked", () => {
  const deep = { a: { b: { c: { d: { e: "too deep" } } } } };
  assert.deepEqual(customerBoundTexts("action_advance", { draft_content: deep }), []);
  assert.deepEqual(customerBoundTexts("action_advance", { draft_content: { a: { b: { c: "deep enough" } } } }), ["deep enough"]);
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
