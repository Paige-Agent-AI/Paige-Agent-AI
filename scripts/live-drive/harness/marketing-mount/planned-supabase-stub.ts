// The Supabase client as Marketing's Planned tabs (src/solo/marketing-planned.tsx) see it in the harness:
// fixed rows for `clients`, `marketing_content` and the sending-identity RPC, chosen by `?mode=`.
// Only that module is pointed here (vite.config.ts), so every other reader keeps its own behaviour.
import { mode } from "./mode";

type Answer = { data: unknown; error: unknown };
const day = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();
const STAGES = ["new_lead", "new_lead", "new_lead", "new_lead", "qualified", "qualified", "nurturing", "hot_lead", "won", "client_active", "client_active", "client_active", "client_alumni"];
const SOURCES = ["paige_form", "paige_form", "paige_form", "paige_form", "paige_form", "manual", "manual", "paige", "paige", "conversations", "import", "paige_form", "manual"];
const TAGS = [["spring-webinar", "newsletter"], ["spring-webinar"], ["referral"], ["newsletter"], ["spring-webinar", "vip"], [], ["referral", "newsletter"], ["podcast"], ["vip"], ["newsletter"], [], ["spring-webinar"], ["podcast"]];
// Spread over the last 120 days so growth, "new" and the period switch all have something to show.
const AGES = [1, 2, 4, 6, 9, 12, 15, 19, 24, 33, 47, 70, 115];
const CONTACTED = [1, null, 5, null, 40, 2, null, 120, 8, null, 200, 3, null];
const clients = STAGES.map((lifecycle_stage, i) => ({
  id: `contact-${i + 1}`, lifecycle_stage, source: SOURCES[i], tags: TAGS[i], created_at: day(AGES[i]),
  last_contacted_at: CONTACTED[i] === null ? null : day(CONTACTED[i] as number), do_not_contact: i === 7, dnd_active: false, disqualified: false,
}));
// Contacts with an email or phone on record, as client_contact_methods holds them.
const methods = clients.filter((_, i) => i % 3 === 0 || i % 4 === 1 || i % 5 === 2).map((c) => ({ client_id: c.id }));
// Two documents in the Studio's block format, so Content draws their own covers.
const doc = (docType: string, cover: Record<string, string>, sections: string[]) => JSON.stringify({ docType, title: cover.title, blocks: [
  { type: "cover", ...cover },
  ...(sections.length > 3 ? [{ type: "callout", variant: "key-insight", title: "What changes", body: "By the end of the first month you have one plan, one weekly rhythm and one number to watch." }] : []),
  ...sections.flatMap((title, i) => [{ type: "section-header", number: i + 1, title }, ...Array.from({ length: sections.length > 3 ? 4 : 1 }, (_, n) => ({ type: "prose", markdown: `${n ? "And further:" : "In short:"} what ${title.toLowerCase()} covers, in plain words, with one example from a real engagement and the result it led to for the client, step by step, so nothing is left to guess when the work begins.` }))]),
  { type: "cta", headline: "Ready to start?", action: "Book a call" },
] });
const content = [
  // mc-1 carries the metadata a real generated image's completion records (EXP07 row 3):
  // served MIME, parsed pixel dimensions, the model, the license class. mc-7 (below) carries
  // none, so the contrast between recorded facts and honest absence is capturable in one drive.
  { id: "mc-1", kind: "image", channel: null, status: "published", title: "Spring workshop hero: a rising line over a city at dawn, warm light, room for a headline on the left", updated_at: day(1), image_url: "/samples/hero.svg", size: "3:2", body: null, brief: null,
    meta: { mime_type: "image/svg+xml", width: 1440, height: 960, model: "fal-ai/flux-pro", license_class: "provider_and_model_terms", mode: "image", review_state: "review_ready" } },
  { id: "mc-2", kind: "text", channel: "email_campaign", status: "draft", title: "Workshop reminder: two days out", updated_at: day(2), body: "Subject: Two days to go\n\nHi {first name},\n\nThe spring workshop is this Thursday at 10am. Bring one goal for the quarter; we'll leave with a plan for it.\n\nSee you there." },
  { id: "mc-3", kind: "document", channel: null, status: "draft", title: "Client onboarding guide", updated_at: day(3), body: doc("guide", { eyebrow: "Northfield Studio", title: "Your first 30 days with us", subhead: "What happens each week, and what we need from you" }, ["Week one", "Your plan", "How we work together"]) },
  { id: "mc-4", kind: "text", channel: "social_post", status: "draft", title: "Three questions to ask before hiring help", updated_at: day(4), body: "## Before you hire help, ask three questions\n**1. What will be different in 90 days?**\n2. Who owns the result?\n3. How will we know it worked?\n\nIf you can't answer them yet, start there." },
  { id: "mc-5", kind: "text", channel: "ad_copy", status: "draft", title: "Free planning session, limited seats", updated_at: day(5), body: "**Headline:** Plan your quarter in 30 minutes\n**Primary text:** Your last workshop was the start. Book a free planning session and leave with a plan for the next 90 days.\n**CTA:** Book a session" },
  { id: "mc-8", kind: "text", channel: "ad_copy", status: "draft", title: "Scorecard: where does your week go?", updated_at: day(6), body: "**Headline:** Where does your week go?\n**Primary text:** Take the 3-minute scorecard and see where your business loses time.\n**CTA:** Take the scorecard" },
  { id: "mc-10", kind: "document", channel: null, status: "draft", title: "Spring advisory offer", updated_at: day(7), body: doc("sales_offer", { eyebrow: "A personal offer", title: "Spring advisory: a clear quarter", subhead: "Three months of weekly sessions, one fixed price" }, ["What you get", "How it runs", "Your first month", "Your second month", "Your third month", "Investment"]) },
  { id: "mc-9", kind: "text", channel: "ad_copy", status: "draft", title: "Retainer: keep the momentum", updated_at: day(9), body: "Monthly advisory at one fixed price, so the work keeps moving after the project ends." },
  { id: "mc-6", kind: "text", channel: "email_campaign", status: "draft", title: "Welcome to the list", updated_at: day(8), body: "Welcome aboard. Every other Tuesday you'll get one idea you can use that week, and nothing else." },
  { id: "mc-7", kind: "image", channel: null, status: "draft", title: "Testimonial card", updated_at: day(11), image_url: "/samples/card.svg", size: "square", body: null, brief: null },
  { id: "mc-11", kind: "image", channel: null, status: "draft", title: "Workshop announcement poster", updated_at: day(12), image_url: "/samples/event.svg", size: "portrait", body: null, brief: "A tall poster for the spring workshop: date, online, free" },
];
// EXP07 row 8 — the content-calendar PLAN. Four entries across the next week: a ready email, a
// planned post, a site slot with no linked piece (the honest "unspecified" case), and a cancelled
// ad (strike-through state). `?plan=0` serves none (the empty state). Times are local-clock
// offsets so the day groupings read naturally in any timezone the drive runs from.
const hours = (n: number) => new Date(Date.now() + n * 3_600_000).toISOString();
const plan = new URLSearchParams(window.location.search).get("plan") === "0" ? [] : [
  { id: "cp-1", content_id: "mc-2", channel: "email_campaign", planned_for: hours(20), note: "Two days before the workshop", status: "ready" },
  { id: "cp-2", content_id: "mc-4", channel: "social_post", planned_for: hours(28), note: null, status: "planned" },
  { id: "cp-3", content_id: null, channel: "site", planned_for: hours(76), note: "Swap the hero to the workshop poster", status: "planned" },
  { id: "cp-4", content_id: "mc-5", channel: "ad_copy", planned_for: hours(120), note: null, status: "cancelled" },
];
declare global { interface Window { __planCalls: Array<{ fn: string; args: Record<string, unknown> }> } }
window.__planCalls = [];

// EXP07 row 9 — the presence read's rows, now carrying the connection lifecycle's readiness
// answer (get_social_presence_evidence' extended OUT columns). instagram: on record + connected
// (label + verified-at); x: on record + needs_reauth; facebook: on record with NO connection (the
// honest absence); the rest not_recorded. `?social=0` answers no rows at all (unreadable class).
const socialRows = new URLSearchParams(window.location.search).get("social") === "0" ? [] : [
  { network: "instagram", status: "on_record", handle: "@northfield-co", as_of: day(2), reason: null, tenant_id: "t-northfield",
    connection_status: "connected", connection_label: "Northfield Coaching (main)", connection_verified_at: "2026-10-20T10:00:00Z", connection_profiles: 1 },
  { network: "x", status: "on_record", handle: "@northfield", as_of: day(2), reason: null, tenant_id: "t-northfield",
    connection_status: "needs_reauth", connection_label: null, connection_verified_at: null, connection_profiles: null },
  { network: "facebook", status: "on_record", handle: "northfield-coaching", as_of: day(2), reason: null, tenant_id: "t-northfield",
    connection_status: null, connection_label: null, connection_verified_at: null, connection_profiles: null },
  { network: "linkedin", status: "not_recorded", handle: null, as_of: day(2), reason: null, tenant_id: "t-northfield",
    connection_status: null, connection_label: null, connection_verified_at: null, connection_profiles: null },
  { network: "youtube", status: "not_recorded", handle: null, as_of: day(2), reason: null, tenant_id: "t-northfield",
    connection_status: null, connection_label: null, connection_verified_at: null, connection_profiles: null },
  { network: "tiktok", status: "not_recorded", handle: null, as_of: day(2), reason: null, tenant_id: "t-northfield",
    connection_status: null, connection_label: null, connection_verified_at: null, connection_profiles: null },
];

const identity = [{ default_email_sender: "hello@northfield.example", default_email_domain: "northfield.example", default_email_status: "verified" }];

function answer(rows: unknown): Promise<Answer> {
  if (mode === "loading") return new Promise(() => {});
  if (mode === "error") return Promise.resolve({ data: null, error: { message: "Harness read failed" } });
  if (mode === "first") return Promise.resolve({ data: Array.isArray(rows) ? [] : null, error: null });
  return Promise.resolve({ data: rows, error: null });
}

function from(table: string) {
  let rows: Record<string, unknown>[] = table === "clients" ? clients : table === "marketing_content" ? content : table === "client_contact_methods" ? methods : [];
  const chain: Record<string, unknown> = {};
  for (const method of ["select", "order", "limit"]) chain[method] = () => chain;
  // Filters behave like the server's, so each tab shows only what its own query would return.
  chain.eq = (column: string, value: unknown) => { if (column !== "tenant_id") rows = rows.filter((row) => row[column] === value); return chain; };
  chain.neq = (column: string, value: unknown) => { rows = rows.filter((row) => row[column] !== value); return chain; };
  chain.is = () => chain;
  chain.in = () => chain;
  chain.not = (column: string, op: string, value: string) => { if (op === "in") { const out = value.replace(/[()]/g, "").split(","); rows = rows.filter((row) => !out.includes(String(row[column]))); } return chain; };
  chain.maybeSingle = () => answer(rows[0] ?? null);
  chain.range = () => answer(rows);
  chain.then = (resolve: (value: Answer) => unknown, reject: (reason: unknown) => unknown) => answer(rows).then(resolve, reject);
  return chain;
}

export const supabase = {
  auth: {
    getSession: async () => ({ data: { session: { access_token: "harness" } }, error: null }),
    getUser: async () => ({ data: { user: { id: "harness-user" } }, error: null }),
    onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
  },
  from, rpc: (fn: string, args: Record<string, unknown>) => {
    window.__planCalls.push({ fn, args });
    if (fn === "get_social_presence_evidence") return answer(socialRows);
    if (fn === "content_plan_list") return answer(plan);
    if (fn === "content_plan_upsert") {
      let row = plan.find((e) => e.id === args.p_id);
      if (!row) { row = { id: `cp-new-${plan.length + 1}`, content_id: null, channel: "social_post", planned_for: hours(24), note: null, status: "planned" }; plan.push(row); }
      row.content_id = (args.p_content_id as string | null) ?? null;
      row.channel = String(args.p_channel);
      row.planned_for = String(args.p_planned_for);
      row.note = (args.p_note as string | null) ?? null;
      row.status = String(args.p_status);
      return answer(row);
    }
    if (fn === "tenant_media_asset_list") {
      // EXP07 media library: one ready row with playback, one processing row.
      return answer([
        { id: "va-1", title: "Spring webinar recording", kind: "video", stream_uid: "650092261481ddfac3d4da12d3b9aff3", status: "ready", duration_seconds: 3540, created_at: day(1) },
        { id: "va-2", title: "Client intro (new upload)", kind: "video", stream_uid: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", status: "processing", duration_seconds: null, created_at: day(0) },
      ]);
    }
    if (fn === "content_publication_list") {
      // EXP07 row 10 — the receipts a piece already carries: one published (with its link) and
      // one outcome_unknown (the state that blocks a retry). Only rows for the asked piece.
      const asked = args.p_content_id as string | null;
      const receipts = [
        { id: "pub-1", platform: "instagram", status: "published", provider_post_url: "https://example.com/post/1", created_at: day(3) },
        { id: "pub-2", platform: "x", status: "outcome_unknown", provider_post_url: null, created_at: day(1) },
      ].filter((row) => !asked || (asked === "mc-4" && row.id === "pub-1") || (asked === "mc-2" && row.id === "pub-2"));
      return answer(receipts);
    }
    return answer(identity);
  },
  // EXP07 row 10 — the governed publish door as the harness answers it. `?door=` picks the
  // scenario; the FIRST publish call (no approved_fingerprint) always returns the door's own
  // 202 preview, and the approval call answers the scenario's truth. Non-2xx refusals ride the
  // same shape the real client produces: { data: null, error: { message, context: Response } }.
  functions: (() => {
    const scenario = new URLSearchParams(window.location.search).get("door") ?? "published";
    const invoke = async (_name: string, { body }: { body: Record<string, unknown> }) => {
      const ok = (data: Record<string, unknown>) => ({ data, error: null });
      const refused = (status: number, data: Record<string, unknown>) => ({
        data: null,
        error: { message: "Edge Function returned a non-2xx status code", context: new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } }) },
      });
      if (body.action === "decline") return ok({ ok: true, state: "declined" });
      // The REAL door requires content_id + platform on EVERY publish action and refuses 400
      // otherwise (independent-review P1: the UI once shipped a fingerprint-only approve that
      // could never succeed). The stub enforces the same contract so a regression fails here.
      if (body.action === "publish" && (!body.content_id || !body.platform)) {
        return refused(400, { ok: false, code: "REQUEST_INVALID", error: "Name the saved piece and the channel to publish to." });
      }
      // The door's PRE-approval refusals (the channel's own state, account setup, the retry
      // gate) happen on the FIRST call, exactly as the real door refuses before any approval.
      if (!body.approved_fingerprint) {
        if (scenario === "needs_reauth") return refused(409, { ok: false, code: "NEEDS_REAUTH", error: "That channel's connection needs you to sign in again before anything can post. Reconnect it in Settings → Integrations." });
        if (scenario === "no_connection") return refused(409, { ok: false, code: "NO_CONNECTION", error: "That channel isn't connected yet. Connect it in Settings → Integrations first." });
        if (scenario === "not_configured") return refused(503, { ok: false, code: "PUBLISHING_NOT_CONFIGURED", error: "Publishing isn't configured on this account yet. Nothing was published." });
        if (scenario === "retry_blocked") return refused(409, { ok: false, code: "RETRY_PENDING_RECONCILIATION", error: "A previous attempt to publish this piece to that channel never reported an outcome. Check the channel before publishing again — a duplicate post is worse than a delay." });
        return ok({
          ok: false, state: "approval_required",
          approval: { fingerprint: "a1b2c3d4e5f60718", summary: `Publish “${body.caption ?? "the piece"}” to instagram (Northfield Coaching (main)). Nothing else is included, and nothing is scheduled.`, expires_at: new Date(Date.now() + 600_000).toISOString() },
          preview: { piece_id: body.content_id, piece_title: "Three questions to ask before hiring help", platform: "instagram", channel_label: "Northfield Coaching (main)", caption: body.caption ?? "" },
        });
      }
      if (scenario === "outcome_unknown") return ok({ ok: false, state: "outcome_unknown", publication_id: "pub-4", request_id: "req-9", error: "The channel accepted the post but hasn't confirmed it. It may have posted — check the channel before trying again; this door will refuse a retry until it's reconciled." });
      if (scenario === "failed") return refused(502, { ok: false, state: "failed", code: "PROVIDER_REJECTED", error: "The channel refused the post. Nothing was published.", publication_id: "pub-5" });
      if (scenario === "refused") return refused(409, { ok: false, state: "refused", code: "connection_no_longer_connected", error: "That channel's connection changed before the post could go out. Reconnect it, then approve again. Nothing was published." });
      return ok({ ok: true, state: "published", platform: "instagram", post_url: "https://example.com/post/3", post_id: "p3", publication_id: "pub-3" });
    };
    return { invoke };
  })() };
