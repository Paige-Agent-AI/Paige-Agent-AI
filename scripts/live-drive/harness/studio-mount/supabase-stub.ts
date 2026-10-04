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
// `?publish=` picks the publish door's answer (see `door` below): ready (default) · slow · blocked ·
// off · forbidden · no-workspace · refused (stale once, then fine) · notdone (503, nothing ran) · unverified ·
// noaddress · optional (unmet non-blocking checks) · live · live-blocked · unpublish-off (live; only unpublish off).
const publishMode = new URLSearchParams(window.location.search).get("publish") ?? "ready";
const startsLive = publishMode === "live" || publishMode === "live-blocked" || publishMode === "unpublish-off";
let form: Record<string, unknown> = { id: "f-1", name: "New client intake", slug: "new-client-intake", status: startsLive ? "active" : "draft", schema_json: FORM_SCHEMA, draft_schema_json: FORM_SCHEMA,
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
// The growth-publish-command door, in its contract: prepare (no fingerprint) → 202-style
// approval_required with the server's checks (fingerprint only when nothing blocks); redeem (with
// the fingerprint) → ok with the readback, unverified, or a refusal. Non-2xx bodies ride on the
// error's context Response, as supabase-js delivers them.
let prepares = 0;
let redeems = 0;
const httpError = (status: number, body: unknown) => ({ data: null, error: { name: "FunctionsHttpError", message: `Edge Function returned a non-2xx status code`, context: new Response(JSON.stringify(body), { status }) } });
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function door(b: Record<string, unknown>) {
  await wait(220); // a real round trip, so the "checking" state is on screen for a moment
  const kind = String(b.kind);
  const isPage = kind === "page";
  // Codes, statuses and check rows as growth-publish-command/door.ts and contract.ts send them.
  if (publishMode === "off") return httpError(403, { ok: false, refused: true, disabled: true, code: "autonomy_off", error: "Publishing is switched off for this workspace in your autonomy settings. Nothing changed." });
  if (publishMode === "unpublish-off" && b.action === "unpublish") return httpError(403, { ok: false, refused: true, disabled: true, code: "autonomy_off", error: "Unpublishing is switched off for this workspace in your autonomy settings. Nothing changed." });
  if (publishMode === "forbidden") return httpError(403, { ok: false, refused: true, forbidden: true, code: "NOT_ADMIN", error: "Only this workspace's owner or an admin can use the Studio." });
  if (publishMode === "no-workspace") return httpError(403, { ok: false, refused: true, forbidden: true, code: "NO_WORKSPACE", error: "Open one of your workspaces first, then try again." });
  if (!b.approved_fingerprint) {
    if (publishMode === "slow") await new Promise(() => {});
    prepares += 1;
    if (b.action === "unpublish") {
      const blockedOut = publishMode === "live-blocked";
      return { data: { ok: false, approval_required: true, ...(blockedOut ? {} : { fingerprint: `fp-out-${prepares}` }), preview: { kind, id: b.id, title: "New client intake", action: "unpublish",
        checks: [
          { key: "is_live", label: "This form is live now", ok: true, blocking: true },
          blockedOut
            ? { key: "not_in_use", label: "A live funnel collects through this form", ok: false, blocking: true, detail: "Take “Free strategy call” offline first, then unpublish this." }
            : { key: "not_in_use", label: "Nothing live depends on this form", ok: true, blocking: true },
        ] } }, error: null };
    }
    const blocked = publishMode === "blocked";
    const optional = publishMode === "optional";
    const checks = isPage
      ? [{ key: "has_sections", label: "Has 2 sections", ok: true, blocking: true }, { key: "no_placeholders", label: "No unfinished text", ok: true, blocking: true }]
      : [
        { key: "has_questions", label: blocked ? "Has no questions yet" : "Has 6 questions", ok: !blocked, blocking: true },
        { key: "asks_email", label: "Asks for an email, so each request becomes a contact", ok: true, blocking: false },
        { key: "routes_to_pipeline", label: "Requests go to your pipeline", ok: true, blocking: false },
        optional
          ? { key: "alert_email", label: "No alert email", ok: false, blocking: false, detail: "Set one in Form settings." }
          : { key: "alert_email", label: "Each request emails hello@northwind.example", ok: true, blocking: false },
        optional
          ? { key: "thank_you", label: "No thank-you message", ok: false, blocking: false, detail: "Visitors see a plain confirmation." }
          : { key: "thank_you", label: "Thank-you message is written", ok: true, blocking: false },
      ];
    return { data: { approval_required: true, ...(blocked ? {} : { fingerprint: `fp-${prepares}` }), preview: { kind, id: b.id, title: isPage ? "Referral workshop" : "New client intake", action: "publish",
      address: isPage ? "/p/northwind-studio/referral-workshop" : "/form/f-1", checks } }, error: null };
  }
  redeems += 1;
  if (publishMode === "refused" && redeems === 1) return httpError(409, { ok: false, refused: true, outcome: "refused", code: "APPROVAL_NOT_AVAILABLE", error: "That approval expired before it was used." });
  if (publishMode === "notdone") return httpError(503, { ok: false, code: "READINESS_UNAVAILABLE", error: "I couldn't check whether it's ready just now. Nothing changed. Try again." });
  if (publishMode === "unverified") return { data: { ok: false, outcome: "unverified", error: "The publish ran, but Paige couldn't confirm a public address, so it may not be live. Check the project before sharing a link." }, error: null };
  if (b.action === "unpublish") { form = { ...form, status: "draft" }; return { data: { ok: true, action: "unpublish", kind, id: b.id, status: "draft" }, error: null }; }
  if (!isPage) form = { ...form, status: "active" };
  return { data: { ok: true, action: "publish", kind, id: b.id, status: isPage ? "published" : "active", published_at: now,
    url: publishMode === "noaddress" ? null : isPage ? "/p/northwind-studio/referral-workshop" : "/form/f-1" }, error: null };
}

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
      // No publish/unpublish RPC is stubbed: since V2b the Studio publishes only through the
      // growth-publish-command door, so a direct call lands in `default` and the drive asserts none.
      case "growth_form_set_intake": form = { ...form, auto_create_deal: args.p_auto_create_deal, pipeline_id: args.p_pipeline_id, stage_id: args.p_stage_id, notify_email: args.p_notify_email }; return { data: form, error: null };
      default: return { data: null, error: { message: `unstubbed rpc ${fn}` } };
    }
  },
  auth: {
    getSession: async () => ({ data: { session: { access_token: "harness" } } }),
    getUser: async () => ({ data: { user: null }, error: null }),
    onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
  },
  functions: {
    invoke: async (fn: string, opts?: { body?: Record<string, unknown> }) => {
      window.__studioCalls.push({ fn: `invoke:${fn}`, args: opts?.body ?? null });
      if (fn !== "growth-publish-command") return { data: null, error: { message: "unstubbed" } };
      return door(opts?.body ?? {});
    },
  },
  channel: () => ({ on() { return this; }, subscribe() { return this; } }),
  removeChannel: () => {},
};
