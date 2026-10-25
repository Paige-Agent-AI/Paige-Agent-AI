import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { validateStoredReadBindings } from "./c0b-stored-read-binding.mjs";
import { createHash } from "node:crypto";
import ts from "typescript";
const chat = readFileSync(new URL("../../supabase/functions/paige-ai-chat/index.ts", import.meta.url), "utf8");
const helper = readFileSync(new URL("../../supabase/functions/_shared/credit-extraction-payload.ts", import.meta.url), "utf8");
const automationList = readFileSync(new URL("../../supabase/functions/_shared/paige-orchestration/automation-list-read.ts", import.meta.url), "utf8");
test("the real handler's six original caller-JWT reads are proven", () => {
  const proof = validateStoredReadBindings(chat, helper, automationList);
  assert.deepEqual(proof.findings, []); assert.equal(proof.tools.size, 6);
});
for (const [label, mutate] of [
  ["client factory import replaced", (s) => s.replace('https://esm.sh/@supabase/supabase-js@2.75.0', './effectful-client.ts')],
  ["service key substitutes caller JWT", (s) => s.replace("createClient(supabaseUrl, supabaseKey, {", "createClient(supabaseUrl, supabaseServiceKey, {")],
  ["JWT header is removed", (s) => s.replace("Authorization: authHeader", "Authorization: 'service-key'")],
  ["dispatch selector no longer checks the tool", (s) => s.replace('tc.function.name === "document_pending_reviews"', 'true /* document_pending_reviews */')],
  ["document query uses the service client", (s) => s.replace('supabaseClient\n              .from("credit_report_uploads")', 'supabase\n              .from("credit_report_uploads")')],
  ["arbitrary RPC substitutes read-only autonomy resolution", (s) => s.replace('supabaseClient.rpc("resolve_automation_autonomy"', 'supabaseClient.rpc("write_automation_state"')],
  ["CRM tenant pin disappears", (s) => s.replace(/(tc\.function\.name === "crm_list_documents"[\s\S]*?)\.eq\("tenant_id", crmTenantId\)/, '$1.eq("tenant_id", args.tenant_id)')],
  ["file contents are exposed", (s) => s.replace('id, contact_id, original_filename, mime_type, size_bytes, visibility, description, created_at', 'id, storage_path, signed_url')],
  ["provider invocation is injected into a read", (s) => s.replace('} else if (tc.function.name === "automation_list") {', '} else if (tc.function.name === "automation_list") { await fetch("https://provider.invalid");')],
  ["write injected into exact read branch", (s) => s.replace('} else if (tc.function.name === "improvement_list") {', '} else if (tc.function.name === "improvement_list") { await supabaseClient.from("paige_improvement_proposals").update({status:"approved"});')],
  ["caller client shadowed in read branch", (s) => s.replace('} else if (tc.function.name === "automation_list") {', '} else if (tc.function.name === "automation_list") { const supabaseClient = supabase;')],
]) test(`fails closed: ${label}`, () => {
  const changed = mutate(chat); assert.notEqual(changed, chat, "mutation must reach actual source");
  assert.ok(validateStoredReadBindings(changed, helper, automationList).findings.length > 0);
});
test("proposal helper gains I/O", () => {
  assert.ok(validateStoredReadBindings(chat, `${helper}\nfetch('https://provider.invalid');`, automationList).findings.length > 0);
});
for (const [label, mutate] of [
  ["arbitrary RPC substitutes read-only autonomy resolution", s => s.replace('"resolve_automation_autonomy"', '"write_automation_state"')],
  ["caller client replaced", s => s.replace('deps.caller.from', 'deps.service.from')],
  ["selected tenant filter removed", s => s.replace('.eq("tenant_id", tenantId)', '.eq("tenant_id", "foreign")')],
  ["post-read authority removed", s => s.replace('await authority(); check();', 'check();')],
  ["deadline extended", s => s.replaceAll('8_000', '80_000')],
  ["fanout bound removed", s => s.replace('Math.min(4, rows.length)', 'rows.length')],
  ["raw resolver egress added", s => s.replace('readiness: ready ?', 'private_payload: reply.data, readiness: ready ?')],
  ["new provider call", s => s + '\nfetch("https://provider.invalid");'],
]) test(`bounded process read fails closed: ${label}`, () => {
  const changed = mutate(automationList); assert.notEqual(changed, automationList, "mutation reaches original helper");
  assert.ok(validateStoredReadBindings(chat, helper, changed).findings.length > 0);
});
test("missing or substituted bounded helper never receives read admission", () => {
  assert.ok(validateStoredReadBindings(chat, helper).findings.length > 0);
  const changed = chat.replace('../_shared/paige-orchestration/automation-list-read.ts', './foreign-helper.ts');
  assert.notEqual(changed, chat); assert.ok(validateStoredReadBindings(changed, helper, automationList).findings.length > 0);
});
test("the original non-tenant read is preserved as exact source rather than reassigned or weakened", () => {
  const ast = ts.createSourceFile("chat.ts", chat, ts.ScriptTarget.Latest, true); let branch;
  const walk = node => {
    if (ts.isIfStatement(node) && node.expression.getText(ast) === 'tc.function.name === "automation_list"') branch = node.thenStatement;
    ts.forEachChild(node, walk);
  }; walk(ast);
  const original = branch.statements.find(ts.isIfStatement);
  assert.equal(original.expression.getText(ast), 'callerTier !== "tenant"');
  const source = original.thenStatement.statements.find(ts.isTryStatement).getText(ast).replace(/\r\n/g, "\n");
  assert.equal(createHash("sha256").update(source).digest("hex"), "848f030704511f730766aaf8bdf8806cada6001e34f6be213b7091502d4fe67b");
});
