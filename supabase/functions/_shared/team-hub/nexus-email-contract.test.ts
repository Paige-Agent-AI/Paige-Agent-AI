import { test } from "node:test";
import assert from "node:assert/strict";
import { parseNexusEmailDraft, parseNexusEmailDraftAnswer, parseNexusEmailDraftBatch, parseNexusEmailDraftRequest,
  parseNexusEmailPreparation, parseNexusEmailSavedReference } from "./nexus-email-contract.ts";
const ids = Array.from({ length: 8 }, (_, n) => `${String(n + 1).repeat(8)}-1111-4111-8111-111111111111`);
const [tenant, actor, turn, conversation, source, message, contact, connector] = ids;
const version = "2026-11-03T02:30:00.123456+00:00";
const reference = { message_id: source, updated_at: version, receipt_id: contact, operation_id: connector };
const raw = () => ({ ok: true, tenant_id: tenant, actor_id: actor, turn_id: turn, conversation_id: conversation,
  source_message_id: source, message_id: message, draft: { subject: "Project update", body: "Ready for review." } });
const expected = { tenantId: tenant, actorId: actor, messageIds: [message], conversationId: conversation };

test("browser save answers require an exact original reference and never accept authored Done", () => {
  const answer={ok:true,outcome:"saved",message_id:message,result:reference};
  assert.deepEqual(parseNexusEmailDraftAnswer(answer,message),answer);
  for(const extra of [{message_id:source},{result:{...reference,receipt_id:null}},{ok:false},{outcome:"done"},{senders:[]},{delivered:true}])
    assert.equal(parseNexusEmailDraftAnswer({...answer,...extra},message),null);
  for(const outcome of ["unknown","refused","unavailable"]){
    assert.deepEqual(parseNexusEmailDraftAnswer({ok:false,outcome},message),{ok:false,outcome});
    assert.equal(parseNexusEmailDraftAnswer({ok:false,outcome,result:reference},message),null);
  }
});
test("sender answers are closed permitted choices, not a provider credential or save receipt", () => {
  const sender={connector_id:connector,from_address:"business@tests.invalid"};
  const answer={ok:true,outcome:"available",message_id:message,senders:[sender]};
  assert.deepEqual(parseNexusEmailDraftAnswer(answer,message),answer);
  for(const extra of [{senders:[sender,sender]},{senders:[{...sender,token:"secret"}]},{senders:[{...sender,from_address:"invalid"}]},{message_id:source},{result:reference}])
    assert.equal(parseNexusEmailDraftAnswer({...answer,...extra},message),null);
});

test("a preparation is exact plain text, not a model-authored save/result/recipient", () => {
  assert.deepEqual(parseNexusEmailPreparation(raw().draft), raw().draft);
  for (const extra of [{ status: "saved" }, { contact_id: contact }, { receipt_id: contact }, { attachments: [] },
    { subject: "line\nbreak" }, { body: "\0" }, { body: " " }]) {
    assert.equal(parseNexusEmailPreparation({ ...raw().draft, ...extra }), null);
  }
});
test("native preparation read is bound to original current actor/workspace/conversation/message", () => {
  assert.equal(parseNexusEmailDraft(raw(), expected)?.preparation.body, "Ready for review.");
  for (const extra of [{ tenant_id: actor }, { actor_id: tenant }, { conversation_id: turn }, { message_id: turn },
    { turn_id: "bad" }, { ok: "true" }, { approval_id: connector }]) {
    assert.equal(parseNexusEmailDraft({ ...raw(), ...extra }, expected), null);
  }
});
test("saved references retain raw microseconds and require the complete original reference", () => {
  assert.deepEqual(parseNexusEmailSavedReference(reference), reference);
  for (const extra of [{ updated_at: null }, { receipt_id: "bad" }, { operation_id: null }, { provider_id: "invented" }]) {
    assert.equal(parseNexusEmailSavedReference({ ...reference, ...extra }), null);
  }
  const bound = { ...raw(), draft: { ...raw().draft, contact_id: contact, connector_id: connector, result: reference } };
  assert.equal(parseNexusEmailDraft(bound, expected)?.saved?.updated_at, version);
  assert.equal(parseNexusEmailDraft({ ...bound, draft: { ...raw().draft, result: reference } }, expected), null);
});
test("partial/invalid selected recipient or sender cannot become a saved card", () => {
  for (const extra of [{ contact_id: contact }, { connector_id: connector }, { contact_id: null, connector_id: connector },
    { contact_id: contact, connector_id: "bad" }, { contact_id: contact, connector_id: connector, result: null }]) {
    assert.equal(parseNexusEmailDraft({ ...raw(), draft: { ...raw().draft, ...extra } }, expected), null);
  }
});
test("batch fails closed on off-request, duplicate or malformed preparation", () => {
  assert.equal(parseNexusEmailDraftBatch({ ok: true, drafts: [raw()] }, expected)?.length, 1);
  for (const drafts of [[raw(), raw()], [{ ...raw(), message_id: source }], [null], Array(51).fill(raw())]) {
    assert.equal(parseNexusEmailDraftBatch({ ok: true, drafts }, expected), null);
  }
});
test("only an explicit browser Save selects recipient/sender; check/inspect grant no write", () => {
  const save = { messageId: message, intent: "save", contactId: contact, connectorId: connector };
  assert.deepEqual(parseNexusEmailDraftRequest({ teamHubEmailDraft: save }), save);
  for (const intent of ["check", "inspect"]) {
    assert.deepEqual(parseNexusEmailDraftRequest({ teamHubEmailDraft: { messageId: message, intent } }), { messageId: message, intent });
    assert.equal(parseNexusEmailDraftRequest({ teamHubEmailDraft: { ...save, intent } }), null);
  }
  for (const extra of [{ body: "model replacement" }, { expectedTenant: actor }, { approval: connector }, { intent: "send" }, { connectorId: undefined }]) {
    assert.equal(parseNexusEmailDraftRequest({ teamHubEmailDraft: { ...save, ...extra } }), null);
  }
  assert.equal(parseNexusEmailDraftRequest({ teamHubEmailDraft: save, messages: [] }), null);
});
