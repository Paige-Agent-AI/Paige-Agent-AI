// Replaces only the campaign leads read (`get_campaign_brief_leads`, Experience 03 S1d), in the shape the
// database returns, chosen by `?mode=` (`?leads=empty` / `?leads=noform` for the two empty states, `?leads=error` for a failed read
// of this section alone, with the rest of the dossier loaded). A fictional
// business's leads (§63), one of every state the dossier draws: open at a stage, won, lost, being filed,
// couldn't be filed, each kind of credit, plus leads that fit two campaigns and so were not credited.
import { mode } from "./mode";

type Answer = { data: unknown; error: { message: string } | null };
const member = mode === "readonly";
const leadsMode = new URLSearchParams(window.location.search).get("leads");
const noForm = leadsMode === "noform";
const ago = (days: number, hours = 0) => new Date(Date.now() - days * 86_400_000 - hours * 3_600_000).toISOString();

type Row = Record<string, unknown>;
const lead = (id: string, received: string, attribution: string, name: string, extra: Row = {}): Row => ({
  submission_id: id, received_at: received, attribution, processing_state: "done", form_id: "f-spring", form_name: "Discovery call request",
  contact_id: member ? null : `c-${id}`, contact_name: member ? null : name, has_contact: true,
  deal_id: member ? null : `d-${id}`, deal_title: member ? null : `${name} — discovery`, deal_status: "open",
  pipeline_name: "Client pipeline", stage_label: "Discovery booked", stage_type: "open", ...extra,
});

const LEADS: Row[] = [
  lead("l1", ago(0, 3), "form_and_tag", "Renée Okafor", { stage_label: "New enquiry" }),
  lead("l2", ago(1), "form_link", "Marcus Lindqvist"),
  lead("l3", ago(2), "campaign_tag", "Priya Raman", { form_name: "Newsletter sign-up", stage_label: "Proposal sent" }),
  lead("l4", ago(4), "form_and_tag", "Tomás Herrera", { deal_status: "won", stage_label: "Signed", stage_type: "won" }),
  lead("l5", ago(6), "form_link", "Hannah Becker", { deal_status: "lost", stage_label: "Not a fit", stage_type: "lost" }),
  lead("l6", ago(0, 0.1), "form_link", "Jordan Ellis", { processing_state: "claimed", contact_id: null, contact_name: null, has_contact: false, deal_id: null, deal_title: null, deal_status: null, pipeline_name: null, stage_label: null, stage_type: null }),
  lead("l7", ago(3), "campaign_tag", "Sam Whitfield", { processing_state: "error", form_name: "Newsletter sign-up", deal_id: null, deal_title: null, deal_status: null, pipeline_name: null, stage_label: null, stage_type: null }),
];

function answer(): Row {
  const empty = mode === "first" || noForm || leadsMode === "empty";
  const rows = empty ? [] : [...LEADS].sort((a, b) => String(b.received_at).localeCompare(String(a.received_at)));
  const count = (fn: (row: Row) => boolean) => rows.filter(fn).length;
  return {
    brief_id: "b1", can_manage: !member,
    counts: {
      leads: rows.length, with_contact: count((r) => r.has_contact === true), with_opportunity: count((r) => r.deal_status !== null),
      open: count((r) => r.deal_status === "open"), won: count((r) => r.deal_status === "won"), lost: count((r) => r.deal_status === "lost"),
      waiting: count((r) => r.processing_state === "claimed" || r.processing_state === "pending"), failed: count((r) => r.processing_state === "error"),
      first_at: rows.length ? rows[rows.length - 1].received_at : null, last_at: rows.length ? rows[0].received_at : null,
    },
    ambiguous_on_campaign_forms: empty ? 0 : 2,
    capture_forms: noForm ? [] : [{ form_id: "f-spring", name: "Discovery call request", status: "active" }, { form_id: "f-news", name: "Newsletter sign-up", status: "active" }],
    leads: rows, truncated: false,
  };
}

function rpc(name: string): Promise<Answer> {
  if (mode === "loading") return new Promise(() => {});
  if (mode === "error" || leadsMode === "error") return Promise.resolve({ data: null, error: { message: "harness_read_failed" } });
  if (name === "get_campaign_brief_leads") return Promise.resolve({ data: answer(), error: null });
  return Promise.resolve({ data: null, error: null });
}

export const supabase = { rpc };
