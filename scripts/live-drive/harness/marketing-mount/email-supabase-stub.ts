// The Supabase client as Marketing › Email (marketing-email.tsx, marketing-email-editor.tsx) sees it in the
// harness: fixed answers for each RPC by name, in the shape the database returns, chosen by `?mode=`.
// `?campaign=<id>` opens the editor on one of the campaigns below (draft, pending, sent, blocked).
import { mode } from "./mode";

type Answer = { data: unknown; error: unknown };
const iso = (daysAgo: number, hours = 0) => new Date(Date.now() - daysAgo * 86_400_000 - hours * 3_600_000).toISOString();
const dayKey = (daysAgo: number) => iso(daysAgo).slice(0, 10);

// Thirty days of sends: a newsletter, two campaigns and a re-engagement; days with nothing sent stay empty.
const SENT_ON: Record<number, [number, number, number]> = { 26: [212, 77, 14], 20: [180, 61, 11], 13: [391, 166, 32], 6: [203, 58, 8], 2: [148, 63, 15] };
const series = Array.from({ length: 30 }, (_, i) => {
  const ago = 29 - i;
  const [sent, opened, clicked] = SENT_ON[ago] ?? [0, 0, 0];
  return { day: dayKey(ago), sent, tracked: sent, opened, clicked };
});

const campaigns = [
  { id: "c-sent", name: "October newsletter", kind: "newsletter", status: "completed", blocked_reason: null, updated_at: iso(13), version_id: "v-sent", version_state: "sent", subject: "Three things we changed this month", scheduled_for: null, segment_name: null, conversion_goal: "booking", recipients: 391, first_sent_at: iso(13), last_sent_at: iso(13), sent: 391, tracked: 391, opened: 166, clicked: 32, failed: 0, not_confirmed: 0, skipped: 4, waiting: 0 },
  { id: "c-pending", name: "Spring workshop invite", kind: "standard", status: "pending_approval", blocked_reason: null, updated_at: iso(0, 2), version_id: "v-pending", version_state: "locked", subject: "Two seats left for Thursday", scheduled_for: null, segment_name: "Workshop leads", conversion_goal: "form_submission", recipients: 148, first_sent_at: null, last_sent_at: null, sent: 0, tracked: 0, opened: 0, clicked: 0, failed: 0, not_confirmed: 0, skipped: 0, waiting: 148 },
  { id: "c-reeng", name: "We miss you", kind: "reengagement", status: "partially_completed", blocked_reason: null, updated_at: iso(6), version_id: "v-reeng", version_state: "sent", subject: "Still here when you need us", scheduled_for: null, segment_name: null, conversion_goal: "none", recipients: 203, first_sent_at: iso(6), last_sent_at: iso(6), sent: 199, tracked: 199, opened: 58, clicked: 8, failed: 1, not_confirmed: 3, skipped: 0, waiting: 0 },
  { id: "c-blocked", name: "Client results roundup", kind: "standard", status: "blocked", blocked_reason: "sender_needs_attention", updated_at: iso(1), version_id: "v-blocked", version_state: "approved", subject: "What our clients finished this quarter", scheduled_for: null, segment_name: "Active clients", conversion_goal: "none", recipients: 64, first_sent_at: null, last_sent_at: null, sent: 0, tracked: 0, opened: 0, clicked: 0, failed: 0, not_confirmed: 0, skipped: 0, waiting: 64 },
  { id: "c-draft", name: "Welcome", kind: "welcome", status: "draft", blocked_reason: null, updated_at: iso(0, 5), version_id: "v-draft", version_state: "draft", subject: "", scheduled_for: null, segment_name: null, conversion_goal: "none", recipients: null, first_sent_at: null, last_sent_at: null, sent: 0, tracked: 0, opened: 0, clicked: 0, failed: 0, not_confirmed: 0, skipped: 0, waiting: 0 },
];

const segments = [
  { id: "s-1", name: "Workshop leads", rule: { tags: ["spring-webinar"] }, eligible: 148, matched: 161 },
  { id: "s-2", name: "Form submissions", rule: { sources: ["paige_form"] }, eligible: 312, matched: 340 },
  { id: "s-3", name: "Active clients", rule: { stages: ["client_active"] }, eligible: 64, matched: 66 },
  { id: "s-4", name: "Quiet for 90 days", rule: { inactive_days: 90 }, eligible: 203, matched: 231 },
  { id: "s-5", name: "Referrals", rule: { sources: ["referral"] }, eligible: 41, matched: 44 },
];

const dashboard = (days: number) => ({
  period_days: days, time_zone: "UTC", generated_at: iso(0),
  stats: { sent: 1134, sent_prev: 1012, tracked: 1134, tracked_prev: 1012, opened: 425, opened_prev: 344, clicked: 80, clicked_prev: 71, bounced: 6,
    conversions: 19, conversions_prev: 14, new_subscribers: 42, new_subscribers_prev: 31, unsubscribes: 7 },
  series: days === 30 ? series : series.slice(-days),
  campaign_count: campaigns.length, campaigns,
  audience: { contacts: 1284, with_email: 1196, new_leads: 312, customers: 428, inactive_90: 153, newsletter_subscribers: 391 },
  segment_count: segments.length, segments,
  activity: [
    { kind: "subscribed", at: iso(0, 3), detail: "paige_form" },
    { kind: "campaign_sent", at: iso(6), title: "We miss you", campaign_id: "c-reeng", detail: "partially_completed" },
    { kind: "unsubscribed", at: iso(7), detail: "unsubscribe_link" },
    { kind: "bounced", at: iso(9), detail: "bounce_hard" },
    { kind: "campaign_sent", at: iso(13), title: "October newsletter", campaign_id: "c-sent", detail: "completed" },
  ],
  sending: { daily_cap: 500, used_last_24h: 148, remaining_today: 352, postal_address_set: true },
});

const EMPTY = { period_days: 30, time_zone: "UTC", generated_at: iso(0),
  stats: { sent: 0, sent_prev: 0, tracked: 0, tracked_prev: 0, opened: 0, opened_prev: 0, clicked: 0, clicked_prev: 0, bounced: 0, conversions: 0, conversions_prev: 0, new_subscribers: 0, new_subscribers_prev: 0, unsubscribes: 0 },
  series: series.map((d) => ({ ...d, sent: 0, tracked: 0, opened: 0, clicked: 0 })), campaign_count: 0, campaigns: [],
  audience: { contacts: 6, with_email: 6, new_leads: 5, customers: 0, inactive_90: 0, newsletter_subscribers: 0 },
  segment_count: 0, segments: [], activity: [], sending: { daily_cap: 500, used_last_24h: 0, remaining_today: 500, postal_address_set: false } };

const choices = {
  stages: [{ key: "new_lead", count: 312 }, { key: "client_active", count: 428 }, { key: "qualified", count: 96 }, { key: "nurturing", count: 71 }, { key: "client_alumni", count: 58 }],
  sources: [{ key: "paige_form", count: 340 }, { key: "manual", count: 211 }, { key: "referral", count: 44 }, { key: "import", count: 402 }],
  tags: [{ key: "newsletter", count: 391 }, { key: "spring-webinar", count: 161 }, { key: "vip", count: 37 }, { key: "podcast", count: 22 }],
};
const body = "Hi there,\n\nThanks for joining us. Here is what happens next:\n\n- A short intro call to learn what you need\n- A plan for your first month\n- A check-in after two weeks\n\n[[Book your intro call|https://northfield.example/book]]\n\nTalk soon,\nDana";
const encoded = btoa(String.fromCharCode(...new TextEncoder().encode(body)));
const versionFor = (id: string) => {
  const c = campaigns.find((x) => x.id === id) ?? campaigns[4];
  const locked = c.status !== "draft";
  return {
    campaign: { id: c.id, name: c.name, kind: c.kind, status: c.status, blocked_reason: c.blocked_reason, updated_at: c.updated_at },
    version: { id: c.version_id, version_no: c.id === "c-draft" ? 2 : 1, state: c.version_state,
      subject: c.subject || "Welcome — here is what happens next", preheader: "Your first steps with Northfield",
      body_html: `<!--paige-src:${encoded}-->\n<p>${body}</p>`,
      sender: { mode: "connector", connector_id: "conn-1" }, sender_snapshot: locked ? { mode: "connector", from_address: "dana@northfield.example", from_name: "Dana at Northfield", ok: true } : null,
      audience: c.id === "c-draft" ? { stages: ["new_lead"] } : { tags: ["spring-webinar"] }, segment_id: null, scheduled_for: null,
      conversion_goal: c.conversion_goal, expected_recipients: c.recipients, cost_bound_usd: null, approval_id: locked ? "a-1" : null, approved_at: null },
    approval: c.status === "pending_approval" ? { status: "pending", source: "owner" } : null,
    last_declined: c.id === "c-draft" ? { reason: "Make the opening warmer and add the call link.", at: iso(0, 6), version_no: 1 } : null,
    progress: { total: c.recipients ?? 0, planned: c.waiting, sending: 0, sent: c.sent, failed: c.failed, not_confirmed: c.not_confirmed, skipped: c.skipped, cancelled: 0, tracked: c.tracked, opened: c.opened, clicked: c.clicked },
    senders: [
      { mode: "connector", connector_id: "conn-1", provider: "gmail", from_address: "dana@northfield.example", from_name: "Dana at Northfield", healthy: true },
      { mode: "connector", connector_id: "conn-2", provider: "smtp", from_address: "news@northfield.example", from_name: null, healthy: false },
    ],
    managed_sender: { ok: true, mode: "managed", provider: "resend", from_address: "northfield@mail.paigeagent.ai", from_name: "Northfield" },
    resolves: { ok: true, mode: "connector", from_address: "dana@northfield.example", from_name: "Dana at Northfield" },
    postal_address: "1200 Peachtree St NE, Suite 400, Atlanta, GA 30309, US", business_name: "Northfield Advisory",
    segments: segments.map(({ id, name, rule }) => ({ id, name, rule })), choices,
  };
};

// Email series (E3). `?series=<id>` opens the series view on one of these.
const seriesRows = [
  { id: "q-running", name: "Welcome series", kind: "welcome", status: "active", blocked_reason: null, emails: 3, entry_mode: "new_contacts", change_state: null, in_now: 18, entered: 64, sent_30d: 151, next_send_at: new Date(Date.now() + 3 * 3_600_000).toISOString(), activated_at: iso(21), updated_at: iso(0, 1) },
  { id: "q-blocked", name: "Win back quiet contacts", kind: "reengagement", status: "blocked", blocked_reason: "sender_needs_attention", emails: 3, entry_mode: "matching", change_state: null, in_now: 26, entered: 51, sent_30d: 97, next_send_at: null, activated_at: iso(14), updated_at: iso(0, 4) },
  { id: "q-draft", name: "Nurture leads", kind: "nurture", status: "draft", blocked_reason: null, emails: 4, entry_mode: "matching", change_state: null, in_now: 0, entered: 0, sent_30d: 0, next_send_at: null, activated_at: null, updated_at: iso(1) },
];
const md = (s: string) => `<!--paige-src:${btoa(String.fromCharCode(...new TextEncoder().encode(s)))}-->\n<p>${s}</p>`;
const seriesSteps = [
  { position: 1, delay_minutes: 0, subject: "Welcome to Northfield Advisory", preheader: "Here’s what happens next", body_html: md(body) },
  { position: 2, delay_minutes: 2880, subject: "How we work with clients", preheader: "Three things our clients count on", body_html: md("Hi again,\n\nEvery engagement starts with a 60-minute working session, a written plan within a week, and a check-in every week.") },
  { position: 3, delay_minutes: 7200, subject: "Ready to talk?", preheader: "Book a 20-minute call", body_html: md("If the timing is right, pick a time that suits you.\n\n[[Book a call|https://northfield.example/book]]") },
];
const seriesFor = (id: string) => {
  const status = ({ "q-running": "active", "q-paused": "paused", "q-blocked": "blocked", "q-pending": "pending_approval", "q-change": "active", "q-stopped": "stopped" } as Record<string, string>)[id] ?? "draft";
  const state = id === "q-pending" ? "locked" : id === "q-change" || id === "q-draft" ? "draft" : "approved";
  const live = !["q-draft", "q-pending"].includes(id);
  const nurture = id === "q-draft";
  return {
    sequence: { id, name: nurture ? "Nurture leads" : id === "q-blocked" ? "Win back quiet contacts" : "Welcome series", kind: nurture ? "nurture" : id === "q-blocked" ? "reengagement" : "welcome", status,
      blocked_reason: status === "blocked" ? "sender_needs_attention" : null, activated_at: live ? iso(21) : null, stopped_at: status === "stopped" ? iso(1) : null,
      created_at: iso(22), updated_at: iso(0, 1), live_version_id: live ? "v-live" : null },
    version: { id: `v-${id}`, version_no: id === "q-change" ? 2 : 1, state, entry_mode: id === "q-blocked" || nurture ? "matching" : "new_contacts",
      audience: id === "q-blocked" ? { inactive_days: 90 } : nurture ? { stages: ["qualified"] } : { stages: ["new_lead"] }, segment_id: null, segment_name: null,
      exit_on_goal: nurture ? "booking" : "none", exit_when_unmatched: id === "q-blocked", sender: { mode: "connector", connector_id: "conn-1" },
      sender_snapshot: state === "draft" ? null : { mode: "connector", from_address: "dana@northfield.example", from_name: "Dana at Northfield", ok: true },
      expected_entrants: id === "q-blocked" ? 46 : null, approval_id: state === "locked" ? "a-q" : null, approved_at: live ? iso(21) : null,
      steps: nurture ? [...seriesSteps, { position: 4, delay_minutes: 10080, subject: "", preheader: "", body_html: "" }] : seriesSteps },
    live: id === "q-change" ? { id: "v-live", version_no: 1, entry_mode: "new_contacts", steps: seriesSteps.map(({ position, delay_minutes, subject }) => ({ position, delay_minutes, subject })) } : null,
    approval: state === "locked" ? { status: "pending", source: "owner" } : null, last_declined: null,
    entry_preview: { matched: 31, eligible: 29, eligible_new: 29, no_address: 2, opted_out: 0, suppressed: 0 },
    emails: live ? [
      { position: 1, sent: 63, tracked: 63, opened: 39, clicked: 7, waiting: 0, next_at: null, not_delivered: 0, skipped: 1 },
      { position: 2, sent: 50, tracked: 50, opened: 27, clicked: 5, waiting: 11, next_at: new Date(Date.now() + 3 * 3_600_000).toISOString(), not_delivered: 0, skipped: 0 },
      { position: 3, sent: 38, tracked: 38, opened: 19, clicked: 6, waiting: 7, next_at: new Date(Date.now() + 26 * 3_600_000).toISOString(), not_delivered: 1, skipped: 0 },
    ] : [],
    people: live ? { in_now: 18, completed: 37, left: 9, by_email: { "2": 11, "3": 7 }, left_because: { reached_goal: 4, suppressed: 3, removed: 1, not_confirmed: 1 },
      recent: [
        { client_id: "k-1", name: "Maya Ortiz", email: "maya@example.com", status: "active", exit_reason: null, position: 2, entered_at: iso(2), last_sent_at: iso(2), finished_at: null },
        { client_id: "k-2", name: "Jon Bell", email: "jon@example.com", status: "completed", exit_reason: null, position: 3, entered_at: iso(9), last_sent_at: iso(2), finished_at: iso(2) },
        { client_id: "k-3", name: null, email: "pat@example.com", status: "exited", exit_reason: "reached_goal", position: 2, entered_at: iso(6), last_sent_at: iso(4), finished_at: iso(3) },
      ] } : { in_now: 0, completed: 0, left: 0, by_email: {}, left_because: {}, recent: [] },
    senders: [
      { mode: "connector", connector_id: "conn-1", provider: "gmail", from_address: "dana@northfield.example", from_name: "Dana at Northfield", healthy: true },
    ],
    managed_sender: { ok: true, mode: "managed", provider: "resend", from_address: "northfield@mail.paigeagent.ai", from_name: "Northfield" },
    resolves: { ok: true, mode: "connector", from_address: "dana@northfield.example", from_name: "Dana at Northfield" },
    postal_address: "1200 Peachtree St NE, Suite 400, Atlanta, GA 30309, US", business_name: "Northfield Advisory",
    segments: segments.map(({ id: sid, name, rule }) => ({ id: sid, name, rule })), choices,
    sending: { daily_cap: 500, used_last_24h: 148, remaining_today: 352 },
    waiting_to_enter: status === "paused" ? 6 : live && status !== "stopped" ? 0 : null,
  };
};

function answer(data: unknown): Promise<Answer> {
  if (mode === "loading") return new Promise(() => {});
  if (mode === "error") return Promise.resolve({ data: null, error: { message: "harness_read_failed" } });
  return Promise.resolve({ data, error: null });
}

function rpc(name: string, args: Record<string, unknown> = {}): Promise<Answer> {
  switch (name) {
    case "read_email_marketing_dashboard": return answer(mode === "first" ? EMPTY : dashboard(Number(args.p_days) || 30));
    case "read_email_campaign": return answer(versionFor(String(args.p_campaign_id)));
    case "read_email_rule_choices": return answer(choices);
    case "email_audience_preview": return answer({ matched: 161, eligible: 148, no_address: 9, opted_out: 3, suppressed: 1, no_consent: 0, daily_cap: 500, remaining_today: 352, postal_address_set: true });
    case "email_campaign_update_draft": return Promise.resolve({ data: "v-draft", error: null });
    case "read_email_sequences": return answer({ sequences: mode === "first" ? [] : seriesRows });
    case "read_email_sequence": return answer(seriesFor(String(args.p_sequence_id)));
    default: return Promise.resolve({ data: null, error: null });
  }
}

function from() {
  const chain: Record<string, unknown> = {};
  for (const method of ["select", "eq", "order", "limit"]) chain[method] = () => chain;
  chain.then = (resolve: (value: Answer) => unknown, reject: (reason: unknown) => unknown) =>
    answer(campaigns.map(({ id, name, kind, status, updated_at }) => ({ id, name, kind, status, updated_at }))).then(resolve, reject);
  return chain;
}

export const supabase = { rpc, from };
