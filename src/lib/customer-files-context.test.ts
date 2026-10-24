import {strict as assert} from "node:assert";
import {test} from "vitest";
import {readCustomerFilesContext, customerFilesTerminalSource} from "../../supabase/functions/_shared/client-portal-files-context.ts";
import type {ClientPortalPersonaInput} from "../../supabase/functions/_shared/client-portal-persona.ts";

const id = (n: number) => `e0996100-0000-4000-8000-${String(n).padStart(12, "0")}`;
const actor = id(1), tenant = id(2), client = id(3), thread = id(4), intent = id(5);
const persona: ClientPortalPersonaInput = {binding: {actorId: actor, tenantId: tenant, clientId: client},
  enabled: true, businessName: "Test Practice", assistantName: "CURA", tone: "Clear", serviceScope: null,
  humanHandoff: null, tagline: null, supportEmail: null};
const now = "2026-10-24T10:00:00+00:00";
function fixture() {
  const fileIds = [id(6), id(7)];
  return {thread_id: thread, intent_id: intent, mode: "fresh",
    snapshot: {version: 1, kind: "customer_private_files", tenant_id: tenant, contact_id: client, thread_id: thread,
      file_ids: fileIds, source_fingerprint: "a".repeat(64)},
    files: fileIds.map(fileId => ({file: {id: fileId, tenant_id: tenant, contact_id: client, uploaded_by_user_id: actor,
      storage_path: `${tenant}/${client}/client_upload/${actor}/${fileId}`, original_filename: "Private notes.pdf",
      mime_type: "application/pdf", size_bytes: 4, visibility: "client_upload", upload_state: "ready",
      created_at: now, updated_at: now, customer_chat_thread_id: id(9)},
    object: {id: id(Number(fileId.slice(-12)) + 100), updated_at: now, version: null,
      metadata: {size: 4, mimetype: "application/pdf", other: "untrusted object metadata"}}}))};
}
const reader = (value: unknown, error: unknown = null) => ({rpc: async () => ({data: value, error})});
const read = (value: unknown, selection: unknown = [id(6), id(7)]) =>
  readCustomerFilesContext(reader(value), actor, thread, intent, persona, selection);

test("reads only the exact original native context and keeps arbitrary metadata out", async () => {
  const value = fixture(), calls: unknown[] = [];
  const result = await readCustomerFilesContext({rpc: async (...args) => {calls.push(args); return {data: value, error: null};}}, actor, thread, intent, persona, value.snapshot.file_ids);
  assert.equal(result.status, "available"); assert.equal(result.data?.files.length, 2);
  assert.deepEqual(calls, [["client_portal_assistant_files_context", {p_thread: thread, p_intent: intent, p_file_ids: [id(6), id(7)]}]]);
  assert.equal(JSON.stringify(result.data).includes("untrusted object metadata"), false);
  assert.deepEqual(result.data?.snapshot, value.snapshot);
  value.snapshot.file_ids.reverse(); value.files[0].file.original_filename = "Changed.pdf";
  assert.deepEqual(result.data?.snapshot?.file_ids, [id(6), id(7)]);
  assert.equal(result.data?.files[0].filename, "Private notes.pdf");
});
test("accepted replay reads the original selection without a body fallback", async () => {
  const value = fixture(); value.mode = "bound";
  assert.equal((await read(value, null)).status, "available");
  assert.equal((await read(value, [id(7), id(6)])).status, "degraded");
  assert.equal((await read(fixture(), null)).status, "degraded");
});
test("a genuine accepted legacy no-file intent cannot acquire new files", async () => {
  const value = {thread_id: thread, intent_id: intent, mode: "legacy", snapshot: null, files: []};
  const result = await read(value, null);
  assert.equal(result.status, "available"); assert.equal(result.data?.snapshot, null);
  assert.equal((await read(value)).status, "degraded");
  assert.equal((await read({...value, files: fixture().files}, null)).status, "degraded");
});
test("invalid selection or persona never calls the native source", async () => {
  let called = 0; const caller = {rpc: async () => {called++; return {data: fixture(), error: null};}};
  for (const selection of [[], [id(6), id(6)], [null], ["not-an-id"], Array.from({length: 6}, (_, n) => id(n + 10)), {path: "caller"}])
    assert.equal((await readCustomerFilesContext(caller, actor, thread, intent, persona, selection)).status, "degraded");
  for (const p of [{...persona, enabled: false}, {...persona, binding: {...persona.binding, actorId: id(99)}}])
    assert.equal((await readCustomerFilesContext(caller, actor, thread, intent, p)).status, "degraded");
  assert.equal(called, 0);
});
test("wrong native actor/business/client/thread/intent/order and extra authority fail closed", async () => {
  const cases: Array<(v: ReturnType<typeof fixture>) => void> = [
    v => {v.thread_id = id(88);}, v => {v.intent_id = id(88);}, v => {v.snapshot.tenant_id = id(88);},
    v => {v.snapshot.contact_id = id(88);}, v => {v.snapshot.thread_id = id(88);},
    v => {v.files[0].file.uploaded_by_user_id = id(88);}, v => {v.files[0].file.tenant_id = id(88);},
    v => {v.files[0].file.contact_id = id(88);}, v => {v.files.reverse();},
    v => {Object.assign(v, {owner_override: true});}, v => {Object.assign(v.snapshot, {owner_override: true});},
    v => {Object.assign(v.files[0].file, {content: "untrusted text"});}, v => {v.snapshot.source_fingerprint = "bad";},
  ];
  for (const mutate of cases) {const value = fixture(); mutate(value); assert.equal((await read(value)).status, "degraded");}
});
test("wrong or unverified original file/object metadata is never usable model input", async () => {
  const cases: Array<(v: ReturnType<typeof fixture>) => void> = [
    v => {v.files[0].file.storage_path += "/../other";}, v => {v.files[0].file.upload_state = "pending";},
    v => {v.files[0].file.visibility = "shared";}, v => {v.files[0].file.customer_chat_thread_id = "bad";},
    v => {v.files[0].file.original_filename = "../Private.pdf";}, v => {v.files[0].file.original_filename = "Private.docx";},
    v => {v.files[0].file.size_bytes = 0;}, v => {v.files[0].file.size_bytes = 20971521;},
    v => {v.files[0].object.metadata.size = 5;}, v => {v.files[0].object.metadata.mimetype = "text/html";},
    v => {v.files[0].object.updated_at = "bad";}, v => {v.files[0].object.id = "bad";},
  ];
  for (const mutate of cases) {const value = fixture(); mutate(value); assert.equal((await read(value)).status, "degraded");}
});
test("withdrawal and transport failures stay unavailable/degraded, never an empty successful list", async () => {
  assert.equal((await readCustomerFilesContext(reader(null, {code: "42501"}), actor, thread, intent, persona)).status, "unavailable");
  assert.equal((await readCustomerFilesContext(reader(null, {code: "500"}), actor, thread, intent, persona)).status, "degraded");
  assert.equal((await readCustomerFilesContext({rpc: () => {throw Error("private error");}}, actor, thread, intent, persona)).status, "degraded");
  assert.equal((await read(null)).status, "degraded");
});
test("timeout cannot promote a late native result", async () => {
  let finish!: (v: {data: unknown; error: null}) => void;
  const result = await readCustomerFilesContext({rpc: () => new Promise(resolve => {finish = resolve;})}, actor, thread, intent, persona, [id(6), id(7)], 5);
  assert.equal(result.status, "degraded"); finish({data: fixture(), error: null});
  await new Promise(resolve => setTimeout(resolve, 0)); assert.equal(result.status, "degraded");
});
test("accepted selection is captured before awaiting the native read", async () => {
  const selected = [id(6), id(7)]; let observed: Record<string, unknown> | undefined;
  const promise = readCustomerFilesContext({rpc: async (_name, args) => {observed = args; return {data: fixture(), error: null};}}, actor, thread, intent, persona, selected);
  selected.reverse(); assert.equal((await promise).status, "available"); assert.deepEqual(observed?.p_file_ids, [id(6), id(7)]);
});
test("original terminal metadata carries the exact native manifest and keeps empty cleanup possible", async () => {
  const result = await read(fixture()); assert.ok(result.data?.snapshot);
  const snapshot = result.data.snapshot;
  assert.deepEqual(customerFilesTerminalSource(snapshot, "Answer", {turn_state: {state: "FINAL"}}), {content: "Answer", metadata: {customer_files: snapshot}});
  for (const state of ["WITHHELD", "REFUSED", "INTERRUPTED"])
    assert.deepEqual(customerFilesTerminalSource(snapshot, "Must not escape", {turn_state: {state}}), {content: "", metadata: {}});
  assert.deepEqual(customerFilesTerminalSource(null, "Legacy", {}), {content: "Legacy", metadata: {}});
});
