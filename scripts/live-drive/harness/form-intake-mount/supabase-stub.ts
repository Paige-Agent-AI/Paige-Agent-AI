// Stubbed client for the form intake harness. growth_form_set_intake echoes what it was sent into
// window.__intakeSaves so a drive can assert the exact payload. Invented data only.
declare global { interface Window { __intakeSaves: unknown[] } }
window.__intakeSaves = [];
const SCHEMA = { sections: [{ title: "About you", fields: [
  { key: "full_name", label: "Your name", type: "text" }, { key: "email", label: "Work email", type: "email" },
  { key: "phone", label: "Phone", type: "tel" }, { key: "need", label: "What do you need help with?", type: "textarea" },
  { key: "size", label: "Team size", type: "select", options: [{ label: "6–20 people", value: "6-20" }] },
  { key: "heard", label: "How did you hear about us?", type: "text" } ] }] };
let form: Record<string, unknown> = { auto_create_deal: true, pipeline_id: "p-sales", stage_id: "s-new", notify_email: "hello@yourbusiness.example", schema_json: SCHEMA };
const subs = [
  { id: "s1", created_at: "2026-09-29T14:02:00Z", processing_state: "done", contact_id: "c-1", deal_id: "deal-1", alert_sent_at: "2026-09-29T14:02:05Z", alert_skipped_reason: null, payload_json: { full_name: "Jordan Ellis", email: "jordan@northbeam.example", phone: "(555) 014-2280", need: "We run three client teams and lose follow-ups between them.", size: "6-20" } },
  { id: "s2", created_at: "2026-09-29T09:41:00Z", processing_state: "done", contact_id: "c-2", deal_id: "deal-2", alert_sent_at: null, alert_skipped_reason: "form_hourly_cap", payload_json: { email: "priya@lanternworks.example", need: "Onboarding for new retainers." } },
  { id: "s3", created_at: "2026-09-28T16:10:00Z", processing_state: "pending", contact_id: null, deal_id: null, alert_sent_at: null, alert_skipped_reason: null, payload_json: { full_name: "Sam Okafor", email: "sam@okafor.example" } },
  { id: "s4", created_at: "2026-09-26T11:00:00Z", processing_state: "error", contact_id: "c-4", deal_id: null, alert_sent_at: "2026-09-26T11:00:04Z", alert_skipped_reason: null, payload_json: { full_name: "Morgan Hale", email: "morgan@halestudio.example", referral_code: "SPRING-24" } },
];
function from(table: string) {
  const chain = {
    select: () => chain, eq: () => chain, order: () => chain,
    maybeSingle: async () => ({ data: table === "growth_forms" ? form : null, error: null }),
    range: async (a: number, b: number) => ({ data: table === "growth_form_submissions" ? subs.slice(a, b + 1) : [], error: null }),
  };
  return chain;
}
export const supabase = {
  from,
  rpc: async (name: string, args: Record<string, unknown>) => {
    if (name === "growth_form_set_intake") {
      window.__intakeSaves.push(args);
      form = { ...form, auto_create_deal: args.p_auto_create_deal, pipeline_id: args.p_pipeline_id ?? form.pipeline_id, stage_id: args.p_stage_id ?? form.stage_id, notify_email: args.p_notify_email };
      return { data: form, error: null };
    }
    return { data: null, error: { message: `unstubbed rpc ${name}` } };
  },
  auth: { getUser: async () => ({ data: { user: null }, error: null }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }) },
  functions: { invoke: async () => ({ data: null, error: { message: "unstubbed" } }) },
  channel: () => ({ on() { return this; }, subscribe() { return this; } }),
  removeChannel: () => {},
};
