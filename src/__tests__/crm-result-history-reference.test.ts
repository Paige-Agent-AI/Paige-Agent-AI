import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import ts from "typescript";
import { readRecordLinks } from "../../supabase/functions/_shared/paige-turn/record-links";
import { crmResultReferenceMetadata, crmResultRecordReference, readCrmResultMetadata } from "../../supabase/functions/_shared/paige-turn/crm-result-reference";

const ID = "e4000000-0000-4000-8000-0000000c0001";
const code = readFileSync("supabase/functions/paige-ai-chat/index.ts", "utf8");
const source = ts.createSourceFile("chat.ts", code, ts.ScriptTarget.Latest, true);
function metadata(result: Record<string, unknown>) {
  let expression = "";
  const walk = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === "assistantTurnMetadata") expression = node.initializer!.getText(source);
    ts.forEachChild(node, walk);
  };
  walk(source);
  expect(expression).toBeTruthy();
  const js = ts.transpileModule(`return (${expression})();`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  return new Function("stepTrace", "queuedApprovals", "confirmTrace", "crmResultTrace", "researchTrace", "readLinkTrace", "readRecordLinks", "interactiveEffects", "payloadRequestIntentId", "crmResultReferenceMetadata", js)([], [], [], [result], [], [], readRecordLinks, [], null, crmResultReferenceMetadata);
}

describe("actual assistant CRM history projection", () => {
  it.each(["contact.create", "contact.update"])("retains only a bounded native reference for %s", action => {
    const result = { action, outcome: "succeeded", receipt_recorded: true,
      readback: { id: ID, client_ref: "CLT-1234", email: "private@example.invalid", profile: { private: true } },
      record_locator: { record_id: ID, deep_link: `/solo/999/clients/people?person=${ID}`, surface_url: "/solo/999/clients/people" } };
    const saved = JSON.parse(JSON.stringify(metadata(result))).bundleRef.paige_crm_result[0];
    expect(saved).toEqual({ action, outcome: "succeeded", receipt_recorded: true,
      record_reference: { destination: "contacts", record_id: ID, subject: "CLT-1234" } });
    expect(JSON.stringify(saved)).not.toMatch(/private|example|readback|locator|solo\/999/);
  });
});

const native = () => ({ action: "contact.update", outcome: "succeeded", receipt_recorded: true,
  readback: { id: ID, client_ref: "CLT-1234" }, record_locator: { record_id: ID } });
describe("bounded CRM reference normalization", () => {
  it.each(["contact.create", "contact.update", "contact.archive", "contact.restore", "contact.link_company", "contact.unlink_company", "contact.assign_coach", "contact.assign_owner", "contact.merge"])("keeps a verified surviving contact for %s", action => {
    expect(crmResultRecordReference({ ...native(), action })).toEqual({ destination: "contacts", record_id: ID, subject: "CLT-1234" });
  });
  it.each(["contact.hard_delete", "contact.bulk_update", "contact.future", "company.create", "deal.move", "task.create", "activity.log", "invoice.create"])("does not invent an exact reference for %s", action => {
    expect(crmResultRecordReference({ ...native(), action })).toBeNull();
  });
  it.each([false, "true", null, undefined])("requires a recorded native receipt (%j)", receipt_recorded => {
    expect(crmResultRecordReference({ ...native(), receipt_recorded })).toBeNull();
  });
  it.each(["failed", "success", "unknown", "pending", undefined])("requires the native succeeded outcome (%j)", outcome => {
    expect(crmResultRecordReference({ ...native(), outcome })).toBeNull();
  });
  it.each(["not-a-uuid", "", "/solo/999/clients", 3, null])("rejects an invalid native record id (%j)", id => {
    expect(crmResultRecordReference({ ...native(), readback: { id }, record_locator: { record_id: id } })).toBeNull();
  });
  it("rejects mismatched IDs and a deleted native readback", () => {
    expect(crmResultRecordReference({ ...native(), record_locator: { record_id: "e4000000-0000-4000-8000-0000000c0002" } })).toBeNull();
    expect(crmResultRecordReference({ ...native(), readback: { id: ID, absent: true } })).toBeNull();
  });
  it("never substitutes a long name or profile for the opaque native CLT display reference", () => {
    const result = native();
    result.readback.client_ref = "CLT-1234\n" + "x".repeat(300);
    const ref = crmResultRecordReference(result)!;
    expect(ref.subject).toBeUndefined();
    expect(Object.keys(ref).sort()).toEqual(["destination", "record_id"]);
  });
  it.each([{ path: "/solo/999" }, { url: "https://example.invalid" }, { profile: { private: true } }, { subject: 3 }, { subject: "A person's name" }, { subject: "CLT-1234\nprivate" }, { subject: "CLT-" + "A".repeat(80) }, { record_id: null }, { destination: "sales_invoices" }])("rejects unsupported or extra persisted reference fields (%j)", extra => {
    expect(readCrmResultMetadata([{ action: "contact.update", outcome: "succeeded", receipt_recorded: true,
      record_reference: { destination: "contacts", record_id: ID, ...extra } }])[0].record_reference).toBeUndefined();
  });
  it("keeps old reduced rows generic and strips injected raw history payloads", () => {
    const reduced = { action: "contact.update", outcome: "succeeded", receipt_recorded: true };
    expect(readCrmResultMetadata([reduced])).toEqual([reduced]);
    expect(readCrmResultMetadata([{ ...native(), record_reference: { destination: "contacts", record_id: ID }, url: "/foreign", profile: "private" }])).toEqual([reduced]);
    expect(readCrmResultMetadata([{ ...reduced, record_reference: { destination: "contacts", record_id: ID }, profile: "private" }])).toEqual([reduced]);
    expect(readCrmResultMetadata([null, false, { action: {} }])).toEqual([]);
  });
});
