// Isolated fixture transport. No real Supabase client, auth session, provider or network call.
import { tenantId } from "./tenant-stub";
const contactId = "22222222-2222-4222-8222-222222222222";
const connectorId = "33333333-3333-4333-8333-333333333333";
const approvalId = "44444444-4444-4444-8444-444444444444";
const key = `contact:${tenantId}:${contactId}`;
const now = new Date().toISOString();
const contact = { id: contactId, first_name: "Test", last_name: "Lead", entity_name: null, status: "active", lifecycle_stage: "new_lead", source: "paige_form", tags: [], created_at: now, created_by_channel_type: "form", dnd_active: false, client_contact_methods: [{ kind: "email", value: "lead@example.test", is_primary: true, position: 0 }] };
const messages: Record<string, unknown>[] = [{ id: "55555555-5555-4555-8555-555555555555", tenant_id: tenantId, thread_key: key, contact_id: contactId, connector_id: null, channel_type: "form", direction: "inbound", status: "received", sender: { address: "lead@example.test", display_name: "Test Lead" }, recipients: [], subject: "Form inquiry: Website inquiry", body_text: "Website form inquiry. The visitor's identity has not been verified.\n\nQuestion: Could we arrange an introductory call?", attachments: [], sent_at: now, created_at: now, clients: contact }];
const connector = { id: connectorId, tenant_id: tenantId, channel_type: "email", provider: "sendgrid", display_name: "PAIGE email", from_address: "hello@business.example", status: "active", active: true };
let resolved = false;
export const fixtureLog: string[] = [];
const log = (entry: string) => { fixtureLog.push(entry); window.dispatchEvent(new Event("e03-fixture-log")); };
function from(table: string) {
  let filters: Array<[string, unknown]> = []; let head = false;
  const result = () => {
    let rows: Record<string, unknown>[] = table === "messages" ? messages
      : table === "threads" ? [{ id: "66666666-6666-4666-8666-666666666666", tenant_id: tenantId, thread_key: key, contact_id: contactId, archived_at: null, snoozed_until: null, labels: [], unread_count: 1, last_message_at: now, last_direction: "inbound", clients: contact }]
      : table === "channel_connectors" ? [connector]
      : table === "paige_approval_queue_v" && !resolved ? [{ id: approvalId, tenant_id: tenantId, contact_id: contactId, category: "owner.lead_followup", status: "pending", draft_content: { channel: "email", subject: "Your introductory call", body: "Thanks for your inquiry. What time works for a short introductory call?" }, sla_state: "on_track" }]
      : table === "clients" ? [contact] : [];
    rows = rows.filter((row) => filters.every(([field,value]) => field.includes("->") ? true : row[field] === value));
    return { data: head ? null : rows, error: null, count: rows.length };
  };
  const chain: Record<string, unknown> = {};
  chain.select = (_cols: string, opts?: { head?: boolean }) => { head = opts?.head === true; return chain; };
  chain.eq = (field: string, value: unknown) => { filters.push([field,value]); return chain; };
  for (const method of ["order","limit","range","is","not","gt","gte","lte","or","in"]) chain[method] = () => chain;
  chain.maybeSingle = async () => ({ ...result(), data: result().data?.[0] ?? null });
  chain.single = chain.maybeSingle;
  chain.then = (ok: (v: unknown) => unknown, fail: (v: unknown) => unknown) => Promise.resolve(result()).then(ok,fail);
  for (const method of ["update","insert","delete","upsert"]) chain[method] = () => { throw new Error("Fixture refuses unimplemented write"); };
  return chain;
}
export const supabase = {
  from,
  rpc: async (name: string) => ({ data: name === "current_user_tenant_id" ? tenantId : name === "is_tenant_admin" ? true : null, error: null }),
  channel: () => { const channel = { on: () => channel, subscribe: () => channel }; return channel; }, removeChannel: () => {},
  auth: { getUser: async () => ({ data: { user: { id: "77777777-7777-4777-8777-777777777777" } }, error: null }), getSession: async () => ({ data: { session: null } }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }) },
  functions: { invoke: async (name: string, options: { body: Record<string, any> }) => {
    if (name !== "comms-email-command") return { data: null, error: { message: "Fixture refuses unimplemented invocation" } };
    const call = options.body;
    log(call.approved_fingerprint ? "SIMULATED exact approval; no provider call" : "SIMULATED prepare; no send");
    if (!call.approved_fingerprint) return { data: { ok: false, outcome: "approval_required", operation_id: call.operation_id, fingerprint: "abcdef0123456789", summary: "Email Test Lead", expires_at: new Date(Date.now()+300000).toISOString(), preview: { kind: "email", from_address: connector.from_address, to_address: "lead@example.test", subject: call.command.subject, body_text: call.command.body } }, error: null };
    if (new URLSearchParams(location.search).get("case") === "unknown") return { data: null, error: { message: "Simulated interrupted response" } };
    resolved = true;
    messages.push({ id: crypto.randomUUID(), tenant_id: tenantId, contact_id: contactId, thread_key: key, channel_type: "email", direction: "outbound", status: "sent", body_text: call.command.body, subject: call.command.subject, recipients: [{ address: "lead@example.test" }], sender: { address: connector.from_address }, attachments: [], comms_email_operation: call.operation_id, comms_email_state: "provider_accepted", provider_message_id: "fixture-receipt", sent_at: new Date().toISOString(), created_at: new Date().toISOString(), clients: contact });
    return { data: { ok: true, outcome: "provider_accepted", operation_id: call.operation_id, provider_receipt_available: true }, error: null };
  } },
};
