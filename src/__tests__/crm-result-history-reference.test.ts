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
  it.each(["contact.hard_delete", "contact.bulk_update", "contact.future", "company.create", "deal.delete", "task.delete", "activity.log", "invoice.create"])("does not invent an exact reference for %s", action => {
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

const OTHER_ID = "e4000000-0000-4000-8000-0000000c0002";
const taskActions = ["task.create", "task.update", "task.assign", "task.reschedule", "task.complete", "task.reopen", "task.cancel"];
const dealActions = ["deal.create", "deal.update", "deal.assign_owner", "deal.assign_contact", "deal.move", "deal.close", "deal.reopen"];
const nativeFamily = (family: "task" | "deal") => ({ action: `${family}.update`, outcome: "succeeded", receipt_recorded: true,
  readback: { id: ID, title: "Private title", metadata: { private: true } },
  record_locator: { record_id: ID, deep_link_status: family === "task" ? "surface_only" : "exact",
    surface_url: "/solo/999/foreign", deep_link: family === "deal" ? `/solo/999/growth/pipeline?deal=${ID}` : null } });
const familyReference = (family: "task" | "deal") => family === "task"
  ? { destination: "operations_work", record_id: null }
  : { destination: "pipeline", record_id: ID };

describe("recorded Task and Deal history uses only native receipt references", () => {
  it.each(taskActions)("keeps only a Work surface reference for %s", action => {
    expect(crmResultRecordReference({ ...nativeFamily("task"), action })).toEqual(familyReference("task"));
  });
  it.each(dealActions)("keeps the existing exact Pipeline reference for %s", action => {
    expect(crmResultRecordReference({ ...nativeFamily("deal"), action })).toEqual(familyReference("deal"));
  });
  it.each(["task", "deal"] as const)("persists and hydrates only the bounded %s projection through actual assistant metadata", family => {
    const saved = JSON.parse(JSON.stringify(metadata(nativeFamily(family)))).bundleRef.paige_crm_result[0];
    expect(saved).toEqual({ action: `${family}.update`, outcome: "succeeded", receipt_recorded: true, record_reference: familyReference(family) });
    expect(readCrmResultMetadata([saved])).toEqual([saved]);
    expect(JSON.stringify(saved)).not.toMatch(/Private|metadata|readback|locator|999|foreign/);
  });
  it.each(["task", "deal"] as const)("refuses missing, malformed, conflicting or removed native %s records", family => {
    const result = nativeFamily(family);
    for (const patch of [
      { readback: null }, { readback: { id: ID, absent: true } }, { readback: { id: "legacy-id" } },
      { record_locator: null }, { record_locator: { ...result.record_locator, record_id: null } },
      { record_locator: { ...result.record_locator, record_id: OTHER_ID } },
      { record_locator: { ...result.record_locator, deep_link_status: "unavailable" } },
      { record_locator: { ...result.record_locator, deep_link_status: family === "task" ? "exact" : "surface_only" } },
    ]) expect(crmResultRecordReference({ ...result, ...patch })).toBeNull();
  });
  it.each(["task", "deal"] as const)("requires true receipt and succeeded outcome for %s", family => {
    for (const receipt_recorded of [false, "true", 1, null, undefined]) expect(crmResultRecordReference({ ...nativeFamily(family), receipt_recorded })).toBeNull();
    for (const outcome of ["failed", "pending", "unknown", "success", undefined]) expect(crmResultRecordReference({ ...nativeFamily(family), outcome })).toBeNull();
  });
  it.each(["task.delete", "task.bulk_update", "task.future", "deal.delete", "deal.bulk_update", "deal.future"])("does not project deleted/bulk/unrecognized %s", action => {
    expect(crmResultRecordReference({ ...nativeFamily(action.startsWith("task.") ? "task" : "deal"), action })).toBeNull();
  });
  it.each(["task", "deal"] as const)("rejects malformed stored %s references, extra fields and raw history", family => {
    const row = { action: `${family}.update`, outcome: "succeeded", receipt_recorded: true };
    const reference = familyReference(family);
    for (const extra of [{ subject: "Private title" }, { subject: "CLT-1234" }, { path: "/foreign" }, { url: "https://example.invalid" },
      { destination: family === "task" ? "pipeline" : "operations_work" }, { record_id: family === "task" ? ID : null }, { record_id: "legacy-id" }, { record_id: undefined }]) {
      expect(readCrmResultMetadata([{ ...row, record_reference: { ...reference, ...extra } }])[0].record_reference).toBeUndefined();
    }
    expect(readCrmResultMetadata([nativeFamily(family)])).toEqual([row]);
    expect(readCrmResultMetadata([{ ...row, record_reference: reference, readback: { id: ID } }])).toEqual([row]);
    expect(readCrmResultMetadata([row])).toEqual([row]);
  });
  it("does not combine a stored projection with contradictory fresh evidence", () => {
    expect(crmResultRecordReference({ ...nativeFamily("deal"), record_reference: { destination: "pipeline", record_id: OTHER_ID } })).toBeNull();
    expect(crmResultRecordReference({ ...nativeFamily("task"), readback: { id: ID, absent: true }, record_reference: familyReference("task") })).toBeNull();
    expect(crmResultRecordReference({ ...nativeFamily("task"), record_locator: { record_id: OTHER_ID, deep_link_status: "surface_only" }, record_reference: familyReference("task") })).toBeNull();
  });
  it("normalizes matching native UUIDs without retaining task identity or deal subject", () => {
    for (const family of ["task", "deal"] as const) {
      const result = nativeFamily(family);
      expect(crmResultRecordReference({ ...result, readback: { id: ID.toUpperCase(), title: "Private title", client_ref: "CLT-1234" } })).toEqual(familyReference(family));
    }
  });
});
