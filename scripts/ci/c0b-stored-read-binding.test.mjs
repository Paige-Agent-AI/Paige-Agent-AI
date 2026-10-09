import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { validateStoredReadBindings } from "./c0b-stored-read-binding.mjs";
const chat = readFileSync(new URL("../../supabase/functions/paige-ai-chat/index.ts", import.meta.url), "utf8");
const helper = readFileSync(new URL("../../supabase/functions/_shared/credit-extraction-payload.ts", import.meta.url), "utf8");
test("the real handler's six inline caller-JWT reads are proven", () => {
  const proof = validateStoredReadBindings(chat, helper);
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
  assert.ok(validateStoredReadBindings(changed, helper).findings.length > 0);
});
test("proposal helper gains I/O", () => {
  assert.ok(validateStoredReadBindings(chat, `${helper}\nfetch('https://provider.invalid');`).findings.length > 0);
});
