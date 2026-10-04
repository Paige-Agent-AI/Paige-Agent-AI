// The Supabase client as Marketing's Planned tabs (src/solo/marketing-planned.tsx) see it in the harness:
// fixed rows for `clients`, `marketing_content` and the sending-identity RPC, chosen by `?mode=`.
// Only that module is pointed here (vite.config.ts), so every other reader keeps its own behaviour.
import { mode } from "./mode";

type Answer = { data: unknown; error: unknown };
const day = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();
const STAGES = ["new_lead", "new_lead", "new_lead", "new_lead", "qualified", "qualified", "nurturing", "hot_lead", "won", "client_active", "client_active", "client_active", "client_alumni"];
const SOURCES = ["paige_form", "paige_form", "paige_form", "paige_form", "paige_form", "manual", "manual", "paige", "paige", "conversations", "import", "paige_form", "manual"];
const TAGS = [["spring-webinar", "newsletter"], ["spring-webinar"], ["referral"], ["newsletter"], ["spring-webinar", "vip"], [], ["referral", "newsletter"], ["podcast"], ["vip"], ["newsletter"], [], ["spring-webinar"], ["podcast"]];
const clients = STAGES.map((lifecycle_stage, i) => ({ lifecycle_stage, source: SOURCES[i], tags: TAGS[i] }));
const content = [
  { id: "mc-1", kind: "image", channel: null, title: "Spring workshop hero", updated_at: day(1) },
  { id: "mc-2", kind: "text", channel: "email_campaign", title: "Workshop reminder: two days out", updated_at: day(2) },
  { id: "mc-3", kind: "document", channel: null, title: "Client onboarding guide", updated_at: day(3) },
  { id: "mc-4", kind: "text", channel: "social_post", title: "Three questions to ask before hiring help", updated_at: day(4) },
  { id: "mc-5", kind: "text", channel: "ad_copy", title: "Free planning session, limited seats", updated_at: day(5) },
  { id: "mc-6", kind: "text", channel: "email_campaign", title: "Welcome to the list", updated_at: day(8) },
  { id: "mc-7", kind: "image", channel: null, title: "Testimonial card", updated_at: day(11) },
];
const identity = [{ default_email_sender: "hello@northfield.example", default_email_domain: "northfield.example", default_email_status: "verified" }];

function answer(rows: unknown): Promise<Answer> {
  if (mode === "loading") return new Promise(() => {});
  if (mode === "error") return Promise.resolve({ data: null, error: { message: "Harness read failed" } });
  if (mode === "first") return Promise.resolve({ data: Array.isArray(rows) ? [] : null, error: null });
  return Promise.resolve({ data: rows, error: null });
}

function from(table: string) {
  const rows = table === "clients" ? clients : table === "marketing_content" ? content : [];
  const chain: Record<string, unknown> = {};
  for (const method of ["select", "eq", "order", "limit"]) chain[method] = () => chain;
  chain.then = (resolve: (value: Answer) => unknown, reject: (reason: unknown) => unknown) => answer(rows).then(resolve, reject);
  return chain;
}

export const supabase = { from, rpc: () => answer(identity) };
