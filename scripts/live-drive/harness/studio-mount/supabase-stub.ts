// Stubbed client for the Studio harness. Synthetic, production-shaped rows only (§63). Publish and
// restore calls are recorded on window.__studioCalls so a drive can assert the exact payloads.
declare global { interface Window { __studioCalls: Array<{ fn: string; args: unknown }> } }
window.__studioCalls = [];
const now = "2026-10-03T12:00:00Z";
const ago = (m: number) => new Date(Date.parse(now) - m * 60000).toISOString();
const FORM_SCHEMA = { submit_label: "Request a call", sections: [{ title: "About you", description: "Tell us a little about your business and we'll come back within a day.", fields: [
  { key: "name", label: "Your name", type: "text", required: true },
  { key: "email", label: "Work email", type: "email", required: true },
  { key: "company", label: "Business name", type: "text" },
  { key: "goal", label: "What would you like help with?", type: "radio", options: ["Winning new clients", "Delivering the work", "Keeping clients longer"], required: true },
  { key: "size", label: "How many clients do you serve today?", type: "select", options: ["1–10", "11–50", "50+"] },
  { key: "notes", label: "Anything else we should know?", type: "textarea" },
] }] };
const PAGE_BLOCKS = [
  { type: "hero", eyebrow: "Live workshop · Nov 14", title: "Turn your next ten clients into a referral engine", subtitle: "Ninety minutes, one plan you can run on Monday.", cta_label: "Save my seat", cta_href: "#form" },
  { type: "feature_grid", title: "What you'll leave with", items: [
    { title: "A referral ask that lands", body: "The exact words, timed to the moment a client is happiest." },
    { title: "A follow-up rhythm", body: "Three touches that keep you top of mind without chasing." },
    { title: "A simple scorecard", body: "Know which clients refer, and why." },
  ] },
];
const sessions: Record<string, unknown>[] = [
  { id: "s-form", title: "New client intake", seed_brief: "An intake form for new clients", artifact_refs: [{ kind: "form", id: "f-1", title: "New client intake" }], updated_at: ago(8) },
  { id: "s-page", title: "Referral workshop page", seed_brief: "A landing page for my November workshop", artifact_refs: [{ kind: "page", id: "p-1", title: "Referral workshop" }], updated_at: ago(90) },
  { id: "s-blank", title: "Untitled project", seed_brief: "Design me a landing page for my referral workshop", artifact_refs: [], updated_at: ago(30) },
  { id: "s-funnel", title: "Free strategy call", seed_brief: "A funnel for a free consultation", artifact_refs: [], updated_at: ago(60 * 26) },
];
let form: Record<string, unknown> = { id: "f-1", name: "New client intake", slug: "new-client-intake", status: "draft", schema_json: FORM_SCHEMA, draft_schema_json: FORM_SCHEMA,
  success_action_json: { message: "Thanks — we'll be in touch within one business day." }, draft_success_action_json: { message: "Thanks — we'll be in touch within one business day." },
  auto_create_deal: true, pipeline_id: "pl-1", stage_id: "st-1", notify_email: "hello@northwind.example" };
const page = { id: "p-1", title: "Referral workshop", slug: "referral-workshop", status: "draft", blocks_json: PAGE_BLOCKS, draft_blocks_json: PAGE_BLOCKS, theme_json: null, draft_theme_json: null };
const turns: Record<string, Array<{ role: string; content: string; seq: number }>> = {
  "th-s-form": [
    { role: "user", content: "An intake form for new clients", seq: 1 },
    { role: "assistant", content: "Here's your intake form: six questions, email included so every request becomes a contact. New requests go to Sales → New lead and email hello@northwind.example.", seq: 2 },
  ],
  "th-s-page": [
    { role: "user", content: "A landing page for my November workshop", seq: 1 },
    { role: "assistant", content: "Your workshop page is drafted with a hero and what attendees leave with. Want a sign-up form under it?", seq: 2 },
  ],
};
const tables: Record<string, unknown[]> = {
  pipelines: [{ id: "pl-1", name: "Sales", tenant_id: "t-northwind" }],
  pipeline_stages: [{ id: "st-1", label: "New lead", pipeline_id: "pl-1", order_index: 0 }, { id: "st-2", label: "Call booked", pipeline_id: "pl-1", order_index: 1 }],
  growth_form_submissions: [],
};
function from(table: string) {
  const filters: Record<string, unknown> = {};
  const rows = () => {
    if (table === "growth_forms") return [form];
    if (table === "growth_pages") return [page];
    if (table === "paige_chat_turns") return turns[String(filters.thread_id)] ?? [];
    return tables[table] ?? [];
  };
  const chain: Record<string, unknown> = {
    select: () => chain, in: () => chain, order: () => chain,
    eq: (k: string, v: unknown) => { filters[k] = v; return chain; },
    maybeSingle: async () => ({ data: rows()[0] ?? null, error: null }),
    range: async () => ({ data: rows(), error: null }),
    then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve({ data: rows(), error: null }).then(res, rej),
  };
  return chain;
}
const versions = [
  { id: "v1", version_no: 1, is_current: false, title: "First draft · 4 questions", thumbnail_url: null, created_at: ago(40),
    snapshot: { id: "f-1", name: "New client intake", status: "draft", success_action_json: { message: "Thanks — we'll be in touch." },
      schema_json: { submit_label: "Send", sections: [{ description: "A few quick questions before we talk.", fields: FORM_SCHEMA.sections[0].fields.slice(0, 4) }] } } },
  { id: "v2", version_no: 2, is_current: false, title: "Added the goal question", thumbnail_url: null, created_at: ago(25) },
  { id: "v3", version_no: 3, is_current: true, title: "Routed to Sales → New lead", thumbnail_url: null, created_at: ago(8) },
];
export const supabase = {
  from,
  rpc: async (fn: string, args: Record<string, unknown>) => {
    window.__studioCalls.push({ fn, args });
    switch (fn) {
      case "list_studio_sessions": return { data: sessions, error: null };
      case "create_studio_session": { const s = { id: "s-new", title: String(args.p_title), seed_brief: args.p_seed_brief, artifact_refs: [], updated_at: now }; sessions.unshift(s); return { data: s, error: null }; }
      case "touch_studio_session": return { data: sessions.find((s) => s.id === args.p_id) ?? null, error: null };
      case "rename_studio_session": { const s = sessions.find((x) => x.id === args.p_id); if (s) s.title = String(args.p_title); return { data: s ?? null, error: null }; }
      case "paige_studio_thread_ensure": return { data: `th-${args.p_session_id}`, error: null };
      case "peek_tenant_portal_brand": return { data: [{ tenant_name: "Northwind Studio", primary_color: "#2F6B55", logo_url: null }], error: null };
      case "list_artifact_versions": return { data: args.p_kind === "form" ? versions : versions.slice(0, 1).map((v) => ({ ...v, is_current: true, title: "First draft" })), error: null };
      case "restore_artifact_version": return { data: { id: "f-1" }, error: null };
      case "is_tenant_admin": return { data: true, error: null };
      // The real RPC contract (20270537000000): id, status, published_at, url. `?publish=noaddress`
      // models a workspace with no public slug — the RPC answers url: null, and the panel must refuse.
      case "growth_form_publish": {
        form = { ...form, status: "active" };
        const noAddress = new URLSearchParams(window.location.search).get("publish") === "noaddress";
        return { data: { id: "f-1", url: noAddress ? null : "/form/f-1", status: "active", published_at: now }, error: null };
      }
      case "growth_page_publish": return { data: { id: "p-1", url: "/p/northwind-studio/referral-workshop", status: "published", published_at: now }, error: null };
      case "growth_form_set_intake": form = { ...form, auto_create_deal: args.p_auto_create_deal, pipeline_id: args.p_pipeline_id, stage_id: args.p_stage_id, notify_email: args.p_notify_email }; return { data: form, error: null };
      default: return { data: null, error: { message: `unstubbed rpc ${fn}` } };
    }
  },
  auth: {
    getSession: async () => ({ data: { session: { access_token: "harness" } } }),
    getUser: async () => ({ data: { user: null }, error: null }),
    onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
  },
  functions: { invoke: async () => ({ data: null, error: { message: "unstubbed" } }) },
  channel: () => ({ on() { return this; }, subscribe() { return this; } }),
  removeChannel: () => {},
};
