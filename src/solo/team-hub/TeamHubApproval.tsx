import { Check, TimerOff, X } from "lucide-react";
import { useId } from "react";
import { PaigeConfirmCard, type ConfirmAction } from "@/components/chat/PaigeConfirmCard";
import { agentName } from "./team-hub-agents";
import { AgentPlate } from "./TeamHubAgents";
import type { TeamHubAgentKey, TeamHubApproval } from "./team-hub-contract";

/**
 * EXP08 A2: the approval an agent's message carries, inside `.th-msg-body`.
 *
 * Every decision and every outcome the shared card has words for is the shared `PaigeConfirmCard`,
 * mounted as it is (contract A2: "do not fork it"): the asker's Approve / Not now, the teammate's
 * refusal (its `cannotApproveHere` state, in the contract's words), and Running / Done / Didn't run /
 * Couldn't confirm. Team Hub lays it out as a room card from its own stylesheet (team-hub.css, keyed on
 * the card's `data-confirm-part` regions): the strip says whose proposal it is, the summary is the
 * line that carries the weight, and the status sits in the footer beside the controls or the outcome.
 *
 * The only states the card has no words for are a room's Not now and Expired — "Morgan declined" is
 * not something a one-person chat ever says — so those two settle into a record of the same shape.
 * So does Standing (owner decision 1, ruled 2026-10-28; written by A2c, no backend writes it yet): a
 * receipt for an ordinary write the asker's standing permission covered, which ran without a click. It reads exactly like Done, says what the
 * permission covers under the line that ran, and gives the asker one quiet Pause. Never gold.
 *
 * Colour (contract A1 UI, v5 frozen): agent colour is in the strip only — a wash under half strength,
 * a 2px line in the agent's fill (PAIGE: her ring value, never a fill), the kind line in the agent's
 * ink and the plate. Never in the footer. The only gold fill is Approve.
 */
export type TeamHubApprovalAct =
  | { kind: "approve"; fingerprints: string[] }
  | { kind: "decline"; fingerprints: string[] }
  /** Standing: stop the permission this receipt ran under. Not an act on the record; there is no fingerprint. */
  | { kind: "pause" };

export function TeamHubApprovalCard({ approval, agent, meId, askerName, decidedLabel, online = true, onAct }: {
  approval: TeamHubApproval;
  agent: TeamHubAgentKey;
  meId: string;
  /** The asker's first name as the room reads it: the one person whose click decides. */
  askerName: string;
  /** decided_at, already formatted the way the stream formats times. */
  decidedLabel: string | null;
  online?: boolean;
  /** Absent when this surface holds no seam for the act: the card then refuses honestly (§70). */
  onAct?: (act: TeamHubApprovalAct) => void;
}) {
  const isAsker = approval.asker_user_id === meId;
  const settled = approval.state === "declined" || approval.state === "expired";
  return <section className="th-ap" data-ag={agent} data-ap-state={approval.state} data-ap-view={isAsker ? "asker" : "other"}
    aria-label={`${agentName(agent)} asks: ${approval.kind}`}>
    <div className="th-ap-strip">
      <AgentPlate agent={agent} size="sm" />
      <span className="th-ap-kind">{approval.kind}</span>
    </div>
    {approval.state === "standing" ? <Standing approval={approval} isAsker={isAsker} askerName={askerName} decidedLabel={decidedLabel} online={online} onAct={onAct} />
      : settled ? <Settled approval={approval} isAsker={isAsker} askerName={askerName} decidedLabel={decidedLabel} />
      : <Card approval={approval} isAsker={isAsker} askerName={askerName} decidedLabel={decidedLabel} online={online} onAct={onAct} />}
  </section>;
}

const REPORT_STATES = new Set(["working", "done", "failed", "unconfirmed"]);

function Card({ approval, isAsker, askerName, decidedLabel, online, onAct }: {
  approval: TeamHubApproval; isAsker: boolean; askerName: string; decidedLabel: string | null; online: boolean; onAct?: (act: TeamHubApprovalAct) => void;
}) {
  const state = approval.state;
  if (state === "waiting") {
    // Only the asker's card can carry a binding, and only where something can redeem it. Everyone else, and
    // the asker on a surface with no seam, reads the card's own refusal: a dead Approve is unrepresentable.
    const bind = isAsker && Boolean(onAct);
    const actions: ConfirmAction[] = approval.actions.map(({ summary, fingerprint, note }) => ({ summary, note, ...(bind && fingerprint ? { fingerprint } : {}) }));
    // The asker whose card cannot be approved here is never told "Needs your OK" either: the group's name
    // says what is true for them. Two different reasons, said apart: this surface holds no seam, or the
    // server sent the card without a binding (nothing the click could redeem).
    const bound = actions.some((action) => action.fingerprint);
    return <PaigeConfirmCard className="th-ap-card" actions={actions} disabled={!online}
      heading={!isAsker ? `Waiting on ${askerName}` : bound ? undefined : "Approval not available here"}
      cannotApproveHere={!isAsker
        ? `Waiting on ${askerName}. Only ${askerName} can approve this, because ${askerName} asked.`
        : onAct
          ? "This card can no longer be approved, so nothing has changed. Ask again for a fresh one."
          : "Approving from Team Hub isn't connected yet, so nothing has changed."}
      onApprove={(fingerprints) => onAct?.({ kind: "approve", fingerprints })}
      onDeny={(fingerprints) => onAct?.({ kind: "decline", fingerprints })} />;
  }
  const resumeFingerprint = approval.actions.length === 1 ? approval.actions[0].fingerprint : null;
  if (approval.can_resume === true && (state === "working" || state === "unconfirmed") && isAsker && onAct && resumeFingerprint) {
    return <>
      <PaigeConfirmCard mode="report" className="th-ap-card"
        heading="Approval ready to resume"
        actions={approval.actions.map(({ summary }) => ({ summary, state: "unconfirmed" as const }))}
        note="Your approval was recorded, but the action has not been claimed. Resume uses the same approval." />
      <div className="th-ap-foot"><button type="button" className="th-ap-pause" disabled={!online}
        aria-label="Resume this approved action" onClick={() => onAct({ kind: "approve", fingerprints: [resumeFingerprint] })}>Resume</button></div>
    </>;
  }
  const fallback = REPORT_STATES.has(state) ? state as ConfirmAction["state"] : undefined;
  const actions: ConfirmAction[] = approval.actions.map(({ summary, state: own, note }) => {
    const rowState = own ?? fallback;
    // Done: the server's note says what now exists, which is the proposal's sentence made true. Saying both
    // is the same fact twice, so the note takes the summary's place. Elsewhere the note is the reason.
    return rowState === "done" && note ? { summary: note, state: rowState } : { summary, note, state: rowState };
  });
  const by = isAsker ? "you" : askerName;
  return <PaigeConfirmCard mode="report" className="th-ap-card" actions={actions}
    heading={state === "unconfirmed" ? "Couldn't confirm it ran" : undefined}
    note={decidedLabel ? `Approved by ${by} · ${decidedLabel}` : undefined} />;
}

/** Not now, or nobody decided in time: the summary stays so the room can still read what was asked. */
function Settled({ approval, isAsker, askerName, decidedLabel }: {
  approval: TeamHubApproval; isAsker: boolean; askerName: string; decidedLabel: string | null;
}) {
  const declined = approval.state === "declined";
  const at = decidedLabel ? ` at ${decidedLabel}` : "";
  const outcome = declined
    ? `${isAsker ? "You chose Not now" : `${askerName} declined`}${at}. Nothing was changed.`
    : `Expired${at}. Nothing was changed.`;
  const Icon = declined ? X : TimerOff;
  return <div className="th-ap-rec" role="group" aria-label={declined ? "Declined" : "Expired"}>
    <ul className="th-ap-body">{approval.actions.map((action, index) => <li key={index} className="th-ap-sum">{action.summary}</li>)}</ul>
    <p className="th-ap-foot"><Icon aria-hidden="true" /><span>{outcome}</span></p>
  </div>;
}

/**
 * Standing: done without a click, under a permission the asker gave once. Same shape and weight as Done
 * (it did happen), plus the one thing Done never needs to say: what that permission covers. The asker can
 * Pause it from here; everyone else reads the same receipt in their own words and has nothing to press.
 * With no seam to redeem Pause, it is not drawn (a dead control is unrepresentable, §70).
 */
function Standing({ approval, isAsker, askerName, decidedLabel, online, onAct }: {
  approval: TeamHubApproval; isAsker: boolean; askerName: string; decidedLabel: string | null; online: boolean; onAct?: (act: TeamHubApprovalAct) => void;
}) {
  const coversId = useId();
  const under = `under ${isAsker ? "your" : `${askerName}'s`} standing permission`;
  return <div className="th-ap-rec th-ap-rec--standing" role="group" aria-label={`Done ${under}`} aria-describedby={coversId}>
    <div className="th-ap-body">
      {/* Done's rule: the server's note says what now exists, so it takes the proposal's place. */}
      <ul className="th-ap-list">{approval.actions.map((action, index) => <li key={index} className="th-ap-sum">{action.note ?? action.summary}</li>)}</ul>
      <p className="th-ap-covers" id={coversId}>Covers: {approval.covered_by}.</p>
    </div>
    <div className="th-ap-foot">
      <Check aria-hidden="true" className="th-ap-ok" />
      <p className="th-ap-said"><strong>Done</strong> {under}{decidedLabel ? ` \u00b7 ${decidedLabel}` : ""}</p>
      {isAsker && onAct && <button type="button" className="th-ap-pause" disabled={!online}
        aria-label="Pause this standing permission" onClick={() => onAct({ kind: "pause" })}>Pause</button>}
    </div>
  </div>;
}
