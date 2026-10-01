/**
 * What became of the actions a person approved, as the chat holds it.
 *
 * The owner-approved recovery design (2026-09-26): pressing Approve no longer makes the card
 * vanish. The proposal settles into a quiet record where it was asked, and the approval turn
 * carries a card that says Running… and then reports each action as done, didn't run, or couldn't
 * confirm. The SERVER writes the sentences (`paige_approval_outcome`,
 * supabase/functions/_shared/approval-outcome.ts); this module only holds them, and adds the two
 * sentences the chat alone can know: the connection dropped, or no report ever came.
 *
 * Pure, so every rule the card depends on is unit-tested (approvalOutcome.test.ts).
 */
import type { ConfirmAction, ConfirmActionState } from "./PaigeConfirmCard";

export type ApprovalOutcomeKind = "ran" | "not_run" | "unconfirmed";

export type ApprovalOutcomeRow = {
  fingerprint: string;
  summary: string;
  /** The tool the proposal named, so a card can point at where to check. */
  tool: string;
  outcome?: ApprovalOutcomeKind;
  note?: string;
};

export type ApprovalOutcome = {
  /** Every action the person approved, in the order they sent them. */
  actions: ApprovalOutcomeRow[];
  /** The server's one sentence for the whole card, when every action ended the same way. */
  note?: string;
  /** True once the server has reported. Before that the card runs, and after the turn it can't confirm. */
  reported: boolean;
  /** The chat saw the stream fail before any report arrived. */
  dropped?: boolean;
};

type ConfirmLike = { tool: string; summary: string; fingerprint?: string };
type MessageLike = { role: string; confirm?: ConfirmLike[] };

/** The card to show the moment Approve is pressed: the approved summaries, nothing known yet. */
export function pendingApprovalOutcome(messages: MessageLike[], fingerprints: string[]): ApprovalOutcome {
  const offered = new Map<string, ConfirmLike>();
  for (let i = messages.length - 1; i >= 0 && offered.size === 0; i -= 1) {
    const confirm = messages[i].role === "assistant" ? messages[i].confirm : undefined;
    if (!confirm?.some((c) => c.fingerprint && fingerprints.includes(c.fingerprint))) continue;
    for (const c of confirm) if (c.fingerprint) offered.set(c.fingerprint, c);
  }
  return {
    reported: false,
    actions: fingerprints.map((fingerprint) => {
      const c = offered.get(fingerprint);
      return { fingerprint, summary: c?.summary ?? "An action you approved", tool: c?.tool ?? "" };
    }),
  };
}

const KINDS = new Set<ApprovalOutcomeKind>(["ran", "not_run", "unconfirmed"]);
const sentence = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim() !== "" ? value.trim().slice(0, 280) : undefined;

/**
 * Take the server's report. Anything malformed is ignored rather than guessed at: an action the
 * report does not account for stays unconfirmed, which is the one reading that can never claim a
 * change happened or did not.
 */
export function applyServerOutcome(outcome: ApprovalOutcome, frame: unknown): ApprovalOutcome {
  if (!frame || typeof frame !== "object" || !Array.isArray((frame as { actions?: unknown }).actions)) return outcome;
  const reported = new Map<string, { outcome: ApprovalOutcomeKind; note?: string }>();
  for (const raw of (frame as { actions: unknown[] }).actions) {
    if (!raw || typeof raw !== "object") continue;
    const { fingerprint, outcome: kind, note } = raw as Record<string, unknown>;
    if (typeof fingerprint !== "string" || !KINDS.has(kind as ApprovalOutcomeKind)) continue;
    reported.set(fingerprint, { outcome: kind as ApprovalOutcomeKind, note: sentence(note) });
  }
  return {
    ...outcome,
    reported: true,
    note: sentence((frame as { note?: unknown }).note),
    actions: outcome.actions.map((row) => {
      const r = reported.get(row.fingerprint);
      return { ...row, outcome: r?.outcome ?? "unconfirmed", note: r?.note };
    }),
  };
}

/** The chat's own sentences, for the two cases the server never got to report. */
const DROPPED = (many: boolean) =>
  `The connection dropped before Paige could report back, so ${many ? "these" : "this"} may have gone through. Check before asking again.`;
const SILENT = (many: boolean) =>
  `Paige couldn't report back, so ${many ? "these" : "this"} may have gone through. Check before asking again.`;

const ROW_STATE: Record<ApprovalOutcomeKind, ConfirmActionState> = {
  ran: "done",
  not_run: "failed",
  unconfirmed: "unconfirmed",
};

/**
 * What the card shows, derived when it renders. `streaming` is whether this turn is still running;
 * without a report, a turn that has stopped for any reason — finished, dropped, cancelled, timed
 * out, switched away — can only say it couldn't confirm. It never guesses done.
 */
export function outcomeCardView(outcome: ApprovalOutcome, streaming: boolean): { actions: ConfirmAction[]; note?: string } {
  if (!outcome.reported) {
    const many = outcome.actions.length > 1;
    return streaming
      ? { actions: outcome.actions.map(({ summary }) => ({ summary, state: "working" })) }
      : {
          actions: outcome.actions.map(({ summary }) => ({ summary, state: "unconfirmed" })),
          note: outcome.dropped ? DROPPED(many) : SILENT(many),
        };
  }
  return {
    note: outcome.note,
    actions: outcome.actions.map(({ summary, outcome: kind, note }) => ({
      summary,
      state: ROW_STATE[kind ?? "unconfirmed"],
      ...(note ? { note } : {}),
    })),
  };
}

/**
 * The request "Ask Paige again" sends: only the actions that did not run, so nothing that already
 * happened is asked for twice. Null when there is nothing to ask again for, or when any action
 * may have gone through — asking again then risks doing it twice, and the card says to check first.
 */
export function askAgainRequest(outcome: ApprovalOutcome): string | null {
  if (!outcome.reported || outcome.actions.some((row) => (row.outcome ?? "unconfirmed") === "unconfirmed")) return null;
  const again = outcome.actions.filter((row) => row.outcome === "not_run").map((row) => row.summary);
  return again.length ? `Try again: ${again.join("; ")}` : null;
}

const STATE_WORD: Record<ConfirmActionState, string> = {
  pending: "Couldn't confirm",
  working: "Couldn't confirm",
  unconfirmed: "Couldn't confirm",
  done: "Done",
  failed: "Didn't run",
};

/**
 * The words an approval turn carries into the next request when Paige said none of her own — the
 * connection dropped before her reply, say. The server refuses a message with no content, so an
 * empty turn kept on screen would make the person's NEXT message fail. Sending what the card
 * showed them is the truthful fill: it is exactly what was on screen for that turn, and it tells
 * the next reply that the change may already have happened.
 */
export function approvalOutcomeTranscript(outcome: ApprovalOutcome): string {
  const view = outcomeCardView(outcome, false);
  const lines = view.actions.map((a) => `${STATE_WORD[a.state ?? "unconfirmed"]}: ${a.summary}${a.note ? ` (${a.note})` : ""}`);
  return [...lines, ...(view.note ? [view.note] : [])].join("\n");
}

/** Where a person can see the result of a CRM action for themselves, on the Solo shell. */
export type CheckDestination = "contacts" | "pipeline" | "tasks";

const SOLO_CHECK: Record<CheckDestination, { path: string; label: string }> = {
  contacts: { path: "clients/people", label: "Open your clients" },
  pipeline: { path: "growth/pipeline", label: "Open your pipeline" },
  tasks: { path: "calendar/tasks", label: "Open your tasks" },
};

/**
 * The CRM tools and the surface each one's result lands on — the same split crm-command makes for
 * its own record link (deal.* to the pipeline, task.* to tasks, everything else to contacts), so a
 * check link and a receipt link for the same action can never point at different places. Tools
 * outside the CRM have no link: there is no one place to send a person, and a wrong one is worse.
 */
const CRM_CHECK_DESTINATION: Readonly<Record<string, CheckDestination>> = Object.freeze({
  crm_create_contact: "contacts", crm_update_contact: "contacts", crm_archive_contact: "contacts",
  crm_restore_contact: "contacts", crm_link_contact_company: "contacts", crm_unlink_contact_company: "contacts",
  crm_assign_coach: "contacts", crm_assign_contact_owner: "contacts", crm_merge_contacts: "contacts",
  crm_hard_delete_contact: "contacts", crm_bulk_update_contacts: "contacts",
  crm_create_company: "contacts", crm_update_company: "contacts", crm_archive_company: "contacts",
  crm_restore_company: "contacts", crm_log_activity: "contacts",
  crm_create_task: "tasks", crm_update_task: "tasks", crm_assign_task: "tasks", crm_reschedule_task: "tasks",
  crm_complete_task: "tasks", crm_reopen_task: "tasks", crm_cancel_task: "tasks", crm_delete_task: "tasks",
  deal_create: "pipeline", crm_update_deal: "pipeline", crm_assign_deal_owner: "pipeline",
  crm_assign_deal_contact: "pipeline", deal_move_stage: "pipeline", crm_close_deal: "pipeline",
  crm_reopen_deal: "pipeline", crm_delete_deal: "pipeline",
});

export const crmCheckDestination = (tool: string): CheckDestination | undefined => CRM_CHECK_DESTINATION[tool];

/** The Solo path for a check destination. An address, never authority: the shell resolves the rest. */
export const soloCheckPath = (account: string | number, destination: CheckDestination): string =>
  `/solo/${encodeURIComponent(String(account))}/${SOLO_CHECK[destination].path}`;

/**
 * The places to check, one per surface, for the actions that may have gone through. Empty when
 * nothing is unconfirmed, when there is no account address, or when no action is a CRM one.
 */
export function checkLinks(
  outcome: ApprovalOutcome,
  view: { actions: ConfirmAction[] },
  account: string | number | null | undefined,
): Array<{ label: string; to: string }> {
  if (account === null || account === undefined || String(account).trim() === "") return [];
  const seen = new Set<CheckDestination>();
  outcome.actions.forEach((row, i) => {
    const destination = view.actions[i]?.state === "unconfirmed" ? crmCheckDestination(row.tool) : undefined;
    if (destination) seen.add(destination);
  });
  return [...seen].map((destination) => ({ label: SOLO_CHECK[destination].label, to: soloCheckPath(account, destination) }));
}
