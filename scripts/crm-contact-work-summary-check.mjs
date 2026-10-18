import assert from "node:assert/strict";
import { setScenario } from "./client-memory-authz/fake-supabase.mjs";
import { capturedHandler } from "./client-memory-authz/stub-serve.mjs";

// Existing real Chat handler and recording SDK boundary. No provider/network or live records.
globalThis.Deno = { env: { get: key => ({ SUPABASE_URL: "https://test.supabase.co",
  SUPABASE_ANON_KEY: "test-anon", SUPABASE_SERVICE_ROLE_KEY: "test-service", ANTHROPIC_API_KEY: "test-model" })[key] ?? "" } };
await import("../supabase/functions/paige-ai-chat/index.ts");
const handler = capturedHandler();
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const actor = id(1), tenant = id(2), contactId = id(3), thread = id(4), intent = id(5);
const stamp = "2026-10-15T12:00:00.123456Z";
const contact = { id: contactId, tenant_id: tenant, account_number: "TEST-CONTACT", first_name: "Test", last_name: "Contact", linked_user_id: id(6), client_contact_methods: [] };
const deal = (n, scope = tenant, client = contactId) => ({ id: id(n), tenant_id: scope, contact_client_id: client, title: `Fixture deal ${n}`, status: "open", updated_at: stamp });
const deals = [deal(10), deal(11, id(99)), deal(12, tenant, id(98))];
const native = (n, dealId = id(10), scope = tenant, status = "pending") => ({ id: id(n), tenant_id: scope, deal_id: dealId, title: `Fixture CRM task ${n}`, status,
  user_id: actor, biz_id: null, due_date: null, track: null, updated_at: stamp, created_at: stamp,
  deals: deals.find(row => row.id === dealId) ?? null, private_metadata: "never selected" });
const planning = (n, scope = tenant, client = contactId, status = "open") => ({ id: id(n), tenant_id: scope, contact_id: client,
  title: `Fixture Planning item ${n}`, item_type: "task", status, summary: null, due_at: null, remind_at: null,
  assigned_to_user_id: actor, updated_at: stamp, created_at: stamp, private_metadata: "never selected" });
let config, modelBodies, rec;
function columns(text) {
  let depth = 0, start = 0;
  const out = [];
  for (let index = 0; index < text.length; index++) {
    if (text[index] === "(") depth++;
    if (text[index] === ")") depth--;
    if (text[index] === "," && depth === 0) { out.push(text.slice(start, index).trim()); start = index + 1; }
  }
  out.push(text.slice(start).trim());
  return out;
}
function project(row, selection) {
  assert.ok(selection && selection !== "*", "closed selected columns are required");
  return Object.fromEntries(columns(selection).map(column => {
    const nested = /^(\w+)(?:![\w]+)*\((.*)\)$/.exec(column);
    return nested ? [nested[1], row[nested[1]] ? project(row[nested[1]], nested[2]) : null] : [column, row[column]];
  }));
}
const valueAt = (row, key) => key.split(".").reduce((value, part) => value?.[part], row);
function selected(rows, filters, bypass = false) {
  const selection = filters.find(([op]) => op === "select")?.[1];
  const limited = filters.find(([op]) => op === "limit")?.[1] ?? rows.length;
  return rows.filter(row => bypass || filters.every(([op, key, value]) => op === "eq" ? valueAt(row, key) === value
    : op === "neq" ? valueAt(row, key) !== value : op === "in" ? value.includes(valueAt(row, key))
      : op === "is" ? (valueAt(row, key) ?? null) === value : true))
    .slice(0, limited).map(row => project(row, selection));
}
function toolResponse() {
  const events = [{ type: "message_start", message: { usage: { input_tokens: 1 } } },
    { type: "content_block_start", index: 0, content_block: { type: "tool_use", id: "read-contact", name: "crm_get_contact_summary" } },
    { type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: JSON.stringify({ client_ref: "TEST-CONTACT" }) } },
    { type: "message_delta", delta: { stop_reason: "tool_use" }, usage: { output_tokens: 1 } }, { type: "message_stop" }];
  return new Response(events.map(event => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(""));
}
globalThis.fetch = async (url, options) => {
  assert.ok(String(url).startsWith("https://api.anthropic.com/"), "non-model egress is refused");
  const body = JSON.parse(options.body);
  if (body.system?.startsWith("You label one message sent to PAIGE")) return Response.json({ content: [{ type: "text", text: JSON.stringify({
    intent: "answer", research: "none", difficulty: "routine", image: "none", needs_workspace_data: true, confidence: .9 }) }], usage: { input_tokens: 1, output_tokens: 1 } });
  modelBodies.push(body);
  if (modelBodies.length === 1) return toolResponse();
  return new Response('event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"The actual contact read is available."}}\n\nevent: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"}}\n\n');
};
async function run(options = {}) {
  config = options; modelBodies = [];
  let executor = null, planningRead = false;
  const turns = [];
  const nativeRows = [native(20), native(21, id(10), id(99)), native(22, id(11)), native(23, id(12)),
    { ...native(24, null), biz_id: contactId }, { ...native(25, null), biz_id: id(77) },
    native(26, id(10), tenant, "completed"), native(27, id(10), tenant, "cancelled"), native(28, id(10), tenant, "in_progress")];
  const planningRows = [planning(30), planning(31, id(99)), planning(32, tenant, id(98)),
    planning(33, tenant, contactId, "done"), planning(34, tenant, contactId, "cancelled"), planning(35, tenant, contactId, "blocked"),
    { ...planning(36), item_type: "reminder", remind_at: stamp }];
  const dealRows = [...deals];
  if (config.lateParent) {
    for (let n = 300; n < 325; n++) dealRows.push(deal(n));
    const late = dealRows.at(-1);
    nativeRows.unshift({ ...native(92, late.id), deals: late });
  }
  if (config.legacy) nativeRows[0].updated_at = null;
  if (config.missingVersions) { nativeRows[0].updated_at = null; nativeRows[0].created_at = null; }
  if (config.truncated) {
    for (let n = 100; n < 125; n++) { nativeRows.push(native(n)); planningRows.push(planning(n + 100)); }
  }
  if (config.injectNative) nativeRows.unshift(native(90, id(11)));
  if (config.injectPlanning) planningRows.unshift(planning(91, tenant, id(98)));
  if (config.missingTaskId) nativeRows[0].id = undefined;
  if (config.missingPlanningVersion) planningRows[0].updated_at = undefined;
  rec = setScenario({ authUser: { id: actor },
    tableErrors: config.queryError ? { [config.queryError]: { code: "42501", message: "Protected read unavailable" } }
      : config.unlinkedError ? { deals: ({ filters }) => filters.some(([op, field]) => op === "is" && field === "contact_client_id") ? { code: "42501", message: "Protected relationship read unavailable" } : null } : {},
    tables: {
      profiles: [{ active_tenant_id: tenant }], user_roles: [{ role: "admin" }],
      tenant_members: [{ tenant_id: tenant, user_id: actor, role: config.denied ? "member" : "owner", status: "active" }],
      tenants: [{ id: tenant, account_number: 101, account_type: "standalone", parent_tenant_id: null }],
      clients: filters => config.missingReference ? [] : config.missingContact && filters.some(([op, field]) => op === "select" && field !== "id") ? [] : selected([contact], filters),
      deals: filters => selected(config.noDeals ? [] : dealRows, filters),
      tasks: filters => selected(config.noDeals ? nativeRows.map(row => ({ ...row, deals: null })) : nativeRows, filters, config.injectNative),
      plan_items: filters => { planningRead = true; return selected(planningRows, filters, config.injectPlanning); },
      deal_activities: [], communication_log: [],
      paige_chat_threads: [{ id: thread, tenant_id: tenant, caller_user_id: actor, audience: 'workspace', interactive_recovery_hold: null }],
      paige_chat_turns: filters => filters.some(([op]) => op === "contains") ? [] : turns,
    },
    rpcs: {
      current_user_tenant_id: () => ({ data: config.workspaceChanged || config.changeDuringRead && planningRead ? id(99) : tenant, error: null }),
      is_tenant_admin_as: { data: !config.denied, error: null }, is_platform_owner: { data: false, error: null },
      agency_can_manage_child: { data: false, error: null }, get_actor_access: { data: { tier: "tenant" }, error: null },
      paige_chat_interactive_protocol: { data: { version: 2, active: true }, error: null }, check_rate_limit: { data: true, error: null },
      resolve_tool_autonomy: { data: "auto", error: null }, resolve_tool_autonomy_detail: { data: { ceiling_allows_auto: true }, error: null },
      resolve_tool_autonomy_many: { data: [], error: null },
      get_paige_persona_context: { data: [{ tenant_id: tenant, tenant_name: null, funding_enabled: false, brand: null }], error: null },
      paige_chat_interactive_begin_v2: { data: { status: "accepted", turn_id: id(7) }, error: null },
      paige_chat_interactive_executor_v2: args => {
        if (args.p_operation === "acquire") executor = intent;
        if (args.p_operation === "release") executor = null;
        return { data: { latest: intent, executor, acquired: true, terminal: turns.length > 0 }, error: null };
      },
      paige_chat_interactive_settle: args => { turns.push({ role: "assistant", content: args.p_content, bundle_ref: args.p_bundle_ref }); return { data: id(8), error: null }; },
    },
  });
  const response = await handler(new Request("https://test.supabase.co/functions/v1/paige-ai-chat", {
    method: "POST", headers: { Authorization: "Bearer test-fixture", "Content-Type": "application/json" },
    body: JSON.stringify({ messages: [{ role: "user", content: "Show this contact's actual open tasks and Planning work." }],
      threadId: thread, requestIntentId: intent, interactive: { kind: "message" } }),
  }));
  const wire = await response.text();
  assert.equal(response.status, 200, wire.slice(0, 300));
  const results = modelBodies.flatMap(body => body.messages.flatMap(message => Array.isArray(message.content) ? message.content : []))
    .filter(part => part.type === "tool_result").flatMap(part => { try { return [JSON.parse(part.content)]; } catch { return []; } });
  const result = results.at(-1);
  assert.ok(result, "the actual handler must return a tool result");
  assert.equal(rec.functions.length, 0, "summary reading must not dispatch a business action");
  assert.equal(rec.rpc.filter(call => ["execute_crm_command", "plan_assign_task", "plan_update_item"].includes(call.name)).length, 0);
  return { result, rec, wire };
}

let checks = 0;
async function check(name, options, verify) {
  const result = await run(options); verify(result); checks++;
  console.log(`PASS ${name}`);
}
await check("native task read follows the exact deal/contact relationship", {}, ({ result }) => {
  assert.equal(result.success, true);
  assert.deepEqual(result.open_tasks.map(row => row.id), [id(20), id(28)]);
  assert.equal(result.open_tasks[0].deal_id, id(10));
  assert.equal(result.open_tasks[0].updated_at, stamp);
  assert.equal(result.open_tasks[0].status, "pending");
  assert.equal(result.open_tasks[0].source, "crm");
  assert.equal(result.open_tasks[0].record_kind, "task");
});
await check("direct Planning contact work retains its own identity and status", {}, ({ result, rec }) => {
  assert.deepEqual(result.planning_work.map(row => row.id), [id(30), id(35), id(36)]);
  assert.equal(result.planning_work[0].status, "open");
  assert.equal(result.planning_work[1].status, "blocked");
  assert.equal(result.planning_work[2].item_type, "reminder");
  assert.equal(result.planning_work[0].updated_at, stamp);
  assert.equal(result.planning_work[0].source, "planning");
  assert.equal(result.planning_work[0].record_kind, "planning_item");
  const read = rec.from.find(call => call.table === "plan_items");
  assert.equal(read?.client, "jwt", "Planning RLS must use the actual caller client");
  assert.equal(result.task_relationships.direct_crm_contact_link, "unavailable");
});
for (const [label, options] of [["legacy version", { legacy: true }], ["missing version", { missingVersions: true }]]) {
  await check(label, options, ({ result }) => {
    assert.equal(result.open_tasks[0].updated_at, null);
    assert.equal(result.open_tasks[0].created_at, options.missingVersions ? null : stamp);
    assert.equal(result.open_tasks[0].private_metadata, undefined);
  });
}
for (const queryError of ["tasks", "plan_items", "deals", "deal_activities", "communication_log"]) {
  await check(`query failure ${queryError} is not a successful empty summary`, { queryError }, ({ result }) => {
    assert.equal(result.success, false);
    assert.equal(result.open_tasks, undefined);
    assert.equal(result.planning_work, undefined);
  });
}
for (const [label, options] of [["foreign native parent response", { injectNative: true }], ["foreign Planning contact response", { injectPlanning: true }]]) {
  await check(label, options, ({ result }) => { assert.equal(result.success, false); assert.equal(result.open_tasks, undefined); });
}
for (const options of [{ missingReference: true }, { missingContact: true }, { denied: true }, { workspaceChanged: true }]) {
  await check(`missing/denied scope ${JSON.stringify(options)}`, options, ({ result, rec }) => {
    assert.notEqual(result.success, true);
    const childReads = rec.from.filter(call => call.table === "plan_items" || call.table === "tasks"
      && call.filters.some(([op, field]) => op === "select" && field.includes("deal_id")));
    assert.equal(childReads.length, 0, JSON.stringify({ options, childReads }));
  });
}
await check("bounded reads explicitly report more records", { truncated: true }, ({ result }) => {
  assert.equal(result.open_tasks.length, 20);
  assert.equal(result.planning_work.length, 20);
  assert.equal(result.task_relationships.native_has_more, true);
  assert.equal(result.task_relationships.planning_has_more, true);
});
await check("no linked deals never attributes company or assignee tasks to this contact", { noDeals: true }, ({ result }) => {
  assert.deepEqual(result.open_tasks, []);
  assert.equal(result.planning_work.length, 3);
});
await check("task relation is not limited to the first displayed deals", { lateParent: true }, ({ result }) => {
  assert.equal(result.deals.length, 20);
  assert.equal(result.deals_has_more, true);
  assert.ok(result.open_tasks.some(row => row.id === id(92) && row.deal_id === id(324)));
});
for (const options of [{ missingTaskId: true }, { missingPlanningVersion: true }, { changeDuringRead: true }, { noDeals: true, unlinkedError: true }]) {
  await check(`incomplete or retired read ${JSON.stringify(options)}`, options, ({ result }) => {
    assert.equal(result.success, false);
    assert.equal(result.open_tasks, undefined);
    assert.equal(result.planning_work, undefined);
  });
}
console.log(`PASS ${checks} actual-handler contact-work summary checks; database/RLS boundary remains a protected fixture`);
