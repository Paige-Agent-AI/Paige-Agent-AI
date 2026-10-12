// Replaces only the Marketing Action read and writer (`get_campaign_brief_actions`,
// `configure_campaign_brief_actions`, INT-298 MBC 6b), in the shape the database returns, chosen by `?mode=`.
// A fictional business's steps (§63), one of every state the dossier draws. Writes change this page's copy,
// with the server's own rules: a result only over a proven finish, a judgement only over a result.
import { mode } from "./mode";

type Answer = { data: unknown; error: { message: string } | null };
const member = mode === "readonly";
const ago = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString();
const ahead = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString();
type Row = Record<string, unknown>;
// The bus status behind each lifecycle the read derives (20271022100000 get_campaign_brief_actions).
const STATUS: Record<string, string> = { planned: "filed", prepared: "drafted", approval_required: "pending_approval", scheduled: "approved", recorded: "done", completed: "done", evaluated: "done", outcome_observed: "done" };
const step = (action_id: string, tactic: string, family: string, lifecycle: string, title: string, extra: Row = {}): Row => ({
  brief_id: "b1", action_id, tactic, family, lifecycle, status: STATUS[lifecycle] ?? lifecycle, action_kind: "marketing.campaign_action", kind_label: "Carry out a campaign step",
  title: member ? null : title, summary: null,
  approval: { lane: "confirm", required: true, approval_id: null }, owner: { department: "marketing", specialist: null, person_assigned: false },
  due_at: null, depends_on_action_id: null, waiting_on_dependency: false, automation_id: null,
  expected_result: null, observed_result: null, observed_at: null, observed_through: null, evaluation: null, evaluated_at: null, evaluated_through: null,
  evidence: {}, created_through: "human", linked_at: ago(3), ...extra,
});
let actions: Row[] = mode === "first" ? [] : [
  step("a1", "Win-back email", "email", "evaluated", "Invite past clients to the spring intake", {
    expected_result: { summary: "Ten replies", target: 10 }, observed_result: { summary: "Twelve booked a call", value: 12 }, observed_through: "human",
    evaluation: { verdict: "met", note: "Above the aim" }, evidence: { basis: "approval" } }),
  step("a2", "Win-back email", "email", "approval_required", "Reminder to everyone who opened", { due_at: ahead(4), expected_result: { summary: "Five more calls" } }),
  step("a3", "Launch event", "event", "scheduled", "Host the open office hour", { due_at: ahead(9), created_through: "paige" }),
  step("a4", "Launch event", "outreach", "planned", "Personal note to three referral partners", { waiting_on_dependency: true }),
  // A row planted with a result over an unproven finish: the screen must still show none.
  step("a5", "Launch event", "social", "recorded", "Post the teaser", { evidence: { basis: "recorded" }, observed_result: { summary: "Planted result" } }),
  step("a6", "Win-back email", "email", "completed", "Thank-you note to everyone who booked", { evidence: { basis: "approval" }, expected_result: { summary: "Every booking thanked" } }),
  // A failed step that already carries a recorded result: it must still read as failed.
  step("a7", "Launch event", "outreach", "outcome_observed", "Invite the partner list", { status: "failed",
    evidence: member ? { basis: "workflow_run" } : { basis: "workflow_run", error: "The partner list was empty." },
    observed_result: { summary: "No invitations went out" }, observed_through: "human" }),
];

let counter = 0;
const find = (id: unknown) => actions.findIndex((row) => row.action_id === id);
function rpc(name: string, args: Record<string, unknown> = {}): Promise<Answer> {
  if (mode === "loading") return new Promise(() => {});
  if (mode === "error") return Promise.resolve({ data: null, error: { message: "harness_read_failed" } });
  if (name === "get_campaign_brief_actions") return Promise.resolve({ data: { can_manage: !member, briefs: [], actions }, error: null });
  if (name === "configure_campaign_brief_actions") {
    const c = args._command as Row;
    const at = find(c.actionId);
    if (c.type === "plan_action") {
      counter += 1;
      const id = `new-${counter}`;
      actions = [...actions, step(id, String(c.tactic), String(c.family), "planned", String(c.title), {
        due_at: c.dueAt ? new Date(String(c.dueAt)).toISOString() : null,
        expected_result: c.expectedResult ?? null })];
      return Promise.resolve({ data: { ok: true, outcome: "planned", action_id: id, message: "Planned. Nothing is drafted, sent or published; once prepared, it goes to you for approval." }, error: null });
    }
    if (c.type === "unlink_action") {
      actions = actions.filter((row) => row.action_id !== c.actionId);
      return Promise.resolve({ data: { ok: true, outcome: "unlinked", message: "Removed from the campaign. The action itself is unchanged." }, error: null });
    }
    if (c.type === "record_outcome") {
      const row = actions[at];
      if (row.lifecycle === "recorded") return Promise.resolve({ data: null, error: { message: "CAMPAIGN_ACTION_NOT_PROVEN" } });
      actions[at] = { ...row, lifecycle: "outcome_observed", observed_result: c.observed, observed_through: "human", observed_at: new Date().toISOString() };
      return Promise.resolve({ data: { ok: true, outcome: "outcome_recorded", lifecycle: "outcome_observed", message: "Outcome recorded, as stated. It is not counted as a measured figure." }, error: null });
    }
    if (c.type === "evaluate_outcome") {
      actions[at] = { ...actions[at], lifecycle: "evaluated", evaluation: { verdict: c.verdict, note: c.note ?? null }, evaluated_at: new Date().toISOString() };
      return Promise.resolve({ data: { ok: true, outcome: "evaluated", lifecycle: "evaluated", verdict: c.verdict, message: "Evaluation recorded." }, error: null });
    }
  }
  return Promise.resolve({ data: null, error: null });
}

export const supabase = { rpc };
