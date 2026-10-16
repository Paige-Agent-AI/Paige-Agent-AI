import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { validateCrmReadBindings, validatePipelinePreparationSql } from "./c0b-crm-read-binding.mjs";
const chat = readFileSync(new URL("../../supabase/functions/paige-ai-chat/index.ts", import.meta.url), "utf8");
const inBranch = (s, tool, from, to) => { const at = s.indexOf(`} else if (tc.function.name === "${tool}") {`); assert.ok(at > 0); return s.slice(0, at) + s.slice(at).replace(from, to); };
test("actual CRM service reads and Pipeline bindings are verified", () => {
  const proof = validateCrmReadBindings(chat); assert.deepEqual(proof.findings, []); assert.equal(proof.tools.size, 8);
});
for (const [label, mutate] of [
  ["CRM tenant comes from arguments", s => s.replace("const crmTenantId = personaCtx.tenant_id;", "const crmTenantId = args.tenant_id;")],
  ["CRM scope refusal removed", s => s.replace("const bindingRefusal = await crmWorkspaceBindingRefusal(crmTenantId);", "const bindingRefusal = null;")],
  ["CRM scope comparator weakened", s => s.replace("own.failed || !own.tenant || own.tenant !== crmTenantId", "false")],
  ["CRM scope memo no longer reset", s => s.replace("callerOwnTenantMemo = null;", "/* stale memo */")],
  ["missing tenant refusal removed", s => s.replace("CRM_SERVICE_TOOLS.has(tc.function.name) && !crmTenantId", "false")],
  ["deals tenant filter replaced", s => inBranch(s, "crm_list_deals", '.eq("tenant_id", crmTenantId)', '.eq("tenant_id", args.tenant_id)')],
  ["task write injected", s => inBranch(s, "crm_list_tasks", 'const limit =', 'await admin.from("tasks").delete(); const limit =')],
  ["provider call injected", s => inBranch(s, "crm_pipeline_summary", 'const sevenDaysAgo =', 'await fetch("https://invalid.local"); const sevenDaysAgo =')],
  ["parenthesized foreign receiver", s => inBranch(s, "crm_pipeline_summary", 'const sevenDaysAgo =', 'await (evil).find(() => 1); const sevenDaysAgo =')],
  ["service client shadowed", s => inBranch(s, "crm_list_deals", 'const limit =', 'const admin = evil; const limit =')],
  ["arbitrary administrative RPC", s => inBranch(s, "crm_list_deals", 'const limit =', 'await admin.rpc("write_deal"); const limit =')],
  ["unbounded deal columns", s => inBranch(s, "crm_list_deals", 'id, title, status, value_cents, currency, stage_id, expected_close_date, owner_user_id, contact_client_id, updated_at, pipeline_stages!inner(label)', '*')],
  ["summary contact pin absent", s => inBranch(s, "crm_get_contact_summary", '.eq("id", id).eq("tenant_id", crmTenantId)', '.eq("id", id)')],
  ["pipeline preview actor forged", s => inBranch(s, "pipeline_archive_preview", '_requested_by: user.id', '_requested_by: args.user_id')],
  ["folder preview tenant forged", s => inBranch(s, "pipeline_folder_archive_preview", '_tenant_id: tenantId', '_tenant_id: args.tenant_id')],
]) test(`rejects ${label}`, () => { const changed = mutate(chat); assert.notEqual(changed, chat); assert.ok(validateCrmReadBindings(changed).findings.length > 0); });
for (const [label, from, to] of [
  ["native task tenant pin", '.eq("tenant_id", crmTenantId).eq("deals.tenant_id", crmTenantId)', '.eq("deals.tenant_id", crmTenantId)'],
  ["native task parent tenant pin", '.eq("deals.tenant_id", crmTenantId)', '.eq("deals.tenant_id", args.tenant_id)'],
  ["native task contact pin", '.eq("deals.contact_client_id", id)', '.eq("deals.contact_client_id", args.contact_id)'],
  ["legacy business/contact substitution", '.eq("deals.contact_client_id", id)', '.eq("biz_id", id)'],
  ["native relationship inner join", 'deals!inner(id, tenant_id, contact_client_id)', 'deals(id, tenant_id, contact_client_id)'],
  ["native task status pin", '.in("status", ["pending", "in_progress"])', '.neq("status", "completed")'],
  ["native task version projection", 'track, updated_at, created_at, deals!inner', 'track, deals!inner'],
  ["native task read bound", '.order("id").limit(21)', '.order("id").limit(200)'],
  ["Planning caller RLS", 'supabaseClient.from("plan_items")', 'admin.from("plan_items")'],
  ["Planning contact pin", '.eq("contact_id", id)', '.eq("contact_id", args.contact_id)'],
  ["Planning tenant pin", '.eq("tenant_id", crmTenantId).eq("contact_id", id)', '.eq("contact_id", id)'],
  ["Planning native status pin", '.in("status", ["open", "in_progress", "blocked"])', '.neq("status", "cancelled")'],
  ["Planning explicit columns", 'id, tenant_id, contact_id, item_type, title, summary, status, due_at, remind_at, assigned_to_user_id, updated_at, created_at', '*'],
  ["Planning query errors", 'if (planningRes.error) throw planningRes.error;', '/* query error discarded */'],
  ["native query errors", 'if (tasksRes.error) throw tasksRes.error;', '/* query error discarded */'],
  ["activity query errors", 'if (activityError) throw activityError;', '/* query error discarded */'],
  ["communication query errors", 'if (commError) throw commError;', '/* query error discarded */'],
  ["unlinked query errors", 'if (unlinked.error) throw unlinked.error;', '/* query error discarded */'],
  ["final workspace comparator", 'currentScope.error || currentScope.data !== crmTenantId', 'false'],
  ["final workspace RPC", 'supabaseClient.rpc("current_user_tenant_id")', 'admin.rpc("current_user_tenant_id")'],
  ["resolved contact identity", 'const id = await resolveClientReference(admin, crmTenantId, args.client_ref);', 'const id = args.contact_id;'],
  ["activity parent identity", 'deals.data.slice(0, 20).map((d: any) => d.id)', 'args.deal_ids'],
  ["activity parent tenant pin", '.in("deal_id", dealIds).eq("deals.tenant_id", crmTenantId)', '.in("deal_id", dealIds)'],
  ["activity parent contact pin", '.in("deal_id", dealIds).eq("deals.tenant_id", crmTenantId).eq("deals.contact_client_id", id)', '.in("deal_id", dealIds).eq("deals.tenant_id", crmTenantId)'],
  ["communication tenant pin", '.select("channel, message_type, subject, preview, created_at").eq("tenant_id", crmTenantId)', '.select("channel, message_type, subject, preview, created_at")'],
  ["caller SDK shadow", 'const contact = id ?', 'const supabaseClient = admin; const contact = id ?'],
  ["caller effect injection", 'const contact = id ?', 'await supabaseClient.rpc("write_deal"); const contact = id ?'],
]) test(`summary rejects loss of ${label}`, () => {
  const changed = inBranch(chat, "crm_get_contact_summary", from, to);
  assert.notEqual(changed, chat);
  assert.ok(validateCrmReadBindings(changed).findings.length > 0);
});
test("summary caller must remain the authenticated JWT SDK instance", () => {
  const changed = chat.replace("const supabaseClient = createClient(supabaseUrl, supabaseKey,", "const supabaseClient = createClient(supabaseUrl, supabaseServiceKey,");
  assert.notEqual(changed, chat);
  assert.ok(validateCrmReadBindings(changed).findings.length > 0);
});
test("called helper cannot hide provider I/O", () => {
  const files = ["contact-search.ts", "client-ref.ts", "contact-methods.ts", "crm-command/deal-relationship-integrity.ts", "pipelineWorkspaceRead.ts"];
  const sources = Object.fromEntries(files.map(file => [file, readFileSync(new URL(`../../supabase/functions/_shared/${file}`, import.meta.url), "utf8")]));
  sources["contact-search.ts"] = sources["contact-search.ts"].replace('const byToken =', 'await fetch("https://invalid.local"); const byToken =');
  assert.ok(validateCrmReadBindings(chat, sources).findings.length > 0);
});
test("malformed binding source refuses safely", () => assert.ok(validateCrmReadBindings("const broken = (").findings.length));
const pipelineSql = readFileSync(new URL("../../supabase/migrations/20260901045935_pipeline_identity_catalogue.sql", import.meta.url), "utf8")
  + readFileSync(new URL("../../supabase/migrations/20260901144648_solo_pipeline_folders.sql", import.meta.url), "utf8");
test("incumbent archive preparations mint scoped expiring tokens, not approval or dispatch", () => assert.deepEqual(validatePipelinePreparationSql(pipelineSql), []));
for (const [label, mutate] of [
  ["service role refusal gone", s => s.replace("if auth.role()<>'service_role'", "if false")],
  ["requested actor substituted", s => s.replace("set_config('request.jwt.claim.sub',_requested_by::text,true)", "set_config('request.jwt.claim.sub',null,true)")],
  ["pipeline tenant pin gone", s => s.replace("p.tenant_id=_tenant_id and p.short_ref", "true and p.short_ref")],
  ["folder owner broadened", s => s.replace("t.owner_user_id=_requested_by", "true")],
  ["token scope columns changed", s => s.replace("pipeline_archive_confirmations(tenant_id,pipeline_id,short_ref,expected_version,expected_deal_count,requested_by)", "pipeline_archive_confirmations(tenant_id,pipeline_id,short_ref,expected_version,expected_deal_count)")],
  ["token expiry removed", s => s.replace("expires_at timestamptz not null default now()+interval '15 minutes'", "expires_at timestamptz")],
  ["browser execute granted", s => s.replace("grant execute on function public.prepare_pipeline_archive_as_paige(uuid,uuid,text) to service_role", "grant execute on function public.prepare_pipeline_archive_as_paige(uuid,uuid,text) to authenticated")],
]) test(`preparation SQL rejects ${label}`, () => { const changed = mutate(pipelineSql); assert.notEqual(changed, pipelineSql); assert.ok(validatePipelinePreparationSql(changed).length); });
