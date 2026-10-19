import { useMemo, useState } from "react";
import {
  FIRST_VALUE_LOGIC_VERSION,
  firstValueState,
  nextBestActions,
  type FirstValueAvailability,
  type FirstValueStatusSnapshot,
} from "./first-value-recommendation";
import type { useSoloBusinessContext } from "./data/useSoloBusinessContext";

/**
 * Grounded next steps — the ALG-02/ALG-13 surface of the interview panel.
 *
 * Everything rendered here is derived deterministically from owner-confirmed
 * Setup facts and canonical identity status. Nothing the inputs cannot prove
 * is shown as done; the first-action line explicitly stays open until its
 * receipt exists. Availability labels are the approved four-class contract.
 * A dismissed action hides for this visit only — the copy says so, and no new
 * preference store is invented for it.
 */

const AVAILABILITY_LABEL: Record<FirstValueAvailability, string> = {
  WORKING: "Ready now",
  NEEDS_SETUP: "Needs setup",
  NEEDS_CONNECTION: "Needs a connection",
  NOT_YET_AVAILABLE: "Not yet available",
};

type ContextLike = ReturnType<typeof useSoloBusinessContext>;

export function SoloFirstValue({ context, disabled }: { context: ContextLike; disabled: boolean }) {
  const [dismissed, setDismissed] = useState<string[]>([]);
  const confirmedEmail = context.primaryBusinessEmailProvenance?.source === "owner_confirmed";
  const snapshot: FirstValueStatusSnapshot = useMemo(
    () => ({
      managedEmailConfigured: Boolean(context.managedEmail?.address),
      businessEmailConfirmed: confirmedEmail,
      webIdentity: context.webIdentity ?? "unknown",
    }),
    [context.managedEmail, confirmedEmail, context.webIdentity],
  );
  const actions = useMemo(
    () => nextBestActions({ brief: context.brief, snapshot, snoozed: dismissed }),
    [context.brief, snapshot, dismissed],
  );
  const state = useMemo(() => firstValueState({ brief: context.brief, snapshot }), [context.brief, snapshot]);
  return <section className="sbi-first-value" aria-label="Grounded next steps" data-logic-version={FIRST_VALUE_LOGIC_VERSION}>
    <div className="sbi-fv-head"><strong>MENTOR · Where you actually are</strong><span>Assembled by MENTOR, PAIGE&rsquo;s discovery &amp; education specialist — derived only from what you confirmed and what exists, never padded. Ask PAIGE to go deeper any time.</span></div>
    {state.achieved.length > 0 && <ul className="sbi-fv-list" aria-label="Achieved, with evidence">
      {state.achieved.map(item => <li key={item.key} className="sbi-fv-done"><span aria-hidden="true">✓</span><div><strong>{ACHIEVED_TITLE[item.key] ?? item.key}</strong><small>{item.evidence}</small></div></li>)}
    </ul>}
    <ul className="sbi-fv-list" aria-label="Recommended next steps">
      {actions.map(action => <li key={action.key} className="sbi-fv-action">
        <div>
          <strong>{action.title}</strong>
          <small>{action.reason}{action.prerequisite ? ` · ${action.prerequisite}` : ""}</small>
          <span className="sbi-fv-availability" data-availability={action.availability}>{AVAILABILITY_LABEL[action.availability]}</span>
        </div>
        {action.availability !== "WORKING" && action.key !== "confirm-priority" && <button type="button" disabled={disabled} onClick={() => setDismissed(current => [...current, action.key])}>Not now</button>}
      </li>)}
    </ul>
    <p className="sbi-note">{state.friction.map(f => f.note).join(" ")}{dismissed.length > 0 ? " Dismissed suggestions return on your next visit." : ""}</p>
  </section>;
}

const ACHIEVED_TITLE: Record<string, string> = {
  profile: "Business profile",
  "comms-sender": "PAIGE email sender",
  "comms-email": "Business email",
  "web-identity": "Web address",
};
