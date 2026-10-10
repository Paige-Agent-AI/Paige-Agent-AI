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
  ...sections.flatMap((title, i) => [{ type: "section-header", number: i + 1, title }, { type: "prose", markdown: `What ${title.toLowerCase()} covers, in plain words, with one example from a real engagement.` }]),
  { type: "cta", headline: "Ready to start?", action: "Book a call" },
] });
const content = [
  { id: "mc-1", kind: "image", channel: null, status: "published", title: "Spring workshop hero: a rising line over a city at dawn, warm light, room for a headline on the left", updated_at: day(1), image_url: "/samples/hero.svg", size: "3:2", body: null, brief: null },
  { id: "mc-2", kind: "text", channel: "email_campaign", status: "draft", title: "Workshop reminder: two days out", updated_at: day(2), body: "Subject: Two days to go\n\nHi {first name},\n\nThe spring workshop is this Thursday at 10am. Bring one goal for the quarter; we'll leave with a plan for it.\n\nSee you there." },
  { id: "mc-3", kind: "document", channel: null, status: "draft", title: "Client onboarding guide", updated_at: day(3), body: doc("guide", { eyebrow: "Northfield Studio", title: "Your first 30 days with us", subhead: "What happens each week, and what we need from you" }, ["Week one", "Your plan", "How we work together"]) },
  { id: "mc-4", kind: "text", channel: "social_post", status: "draft", title: "Three questions to ask before hiring help", updated_at: day(4), body: "## Before you hire help, ask three questions\n**1. What will be different in 90 days?**\n2. Who owns the result?\n3. How will we know it worked?\n\nIf you can't answer them yet, start there." },
  { id: "mc-5", kind: "text", channel: "ad_copy", status: "draft", title: "Free planning session, limited seats", updated_at: day(5), body: "**Headline:** Plan your quarter in 30 minutes\n**Primary text:** Your last workshop was the start. Book a free planning session and leave with a plan for the next 90 days.\n**CTA:** Book a session" },
  { id: "mc-8", kind: "text", channel: "ad_copy", status: "draft", title: "Scorecard: where does your week go?", updated_at: day(6), body: "**Headline:** Where does your week go?\n**Primary text:** Take the 3-minute scorecard and see where your business loses time.\n**CTA:** Take the scorecard" },
  { id: "mc-10", kind: "document", channel: null, status: "draft", title: "Spring advisory offer", updated_at: day(7), body: doc("sales_offer", { eyebrow: "A personal offer", title: "Spring advisory: a clear quarter", subhead: "Three months of weekly sessions, one fixed price" }, ["What you get", "How it runs", "Investment"]) },
  { id: "mc-9", kind: "text", channel: "ad_copy", status: "draft", title: "Retainer: keep the momentum", updated_at: day(9), body: "Monthly advisory at one fixed price, so the work keeps moving after the project ends." },
  { id: "mc-6", kind: "text", channel: "email_campaign", status: "draft", title: "Welcome to the list", updated_at: day(8), body: "Welcome aboard. Every other Tuesday you'll get one idea you can use that week, and nothing else." },
  { id: "mc-7", kind: "image", channel: null, status: "draft", title: "Testimonial card", updated_at: day(11), image_url: "/samples/card.svg", size: "square", body: null, brief: null },
  { id: "mc-11", kind: "image", channel: null, status: "draft", title: "Workshop announcement poster", updated_at: day(12), image_url: "/samples/event.svg", size: "portrait", body: null, brief: "A tall poster for the spring workshop: date, online, free" },
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

export const supabase = { from, rpc: () => answer(identity) };
