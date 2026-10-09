import { Outcome, Status, type WriteState } from "./settings-primitives";
import type { CommsReadiness } from "./settings";

/**
 * INT-345 K-3 — the calling-setup card. FOUR facts, never conflated:
 * account connected / number bought / primary chosen / calling READY. The button
 * connects the ACCOUNT only (free, idempotent); buying happens in the search below;
 * the primary is chosen by the owner with "Send from this" under Communications.
 * Every state names its real next step — no dead ends, no collapsed copy.
 */
export function CallingSetupCard({ calling, settingUp, note, canManage, onRun }: CallingSetupCardProps) {
  if (calling === undefined) return null; // resolver still loading — paint nothing rather than guess
  const account = calling?.account ?? "absent";
  const stages: Array<[string, boolean]> = [
    ["Calling account", account === "configured"],
    ["A number for this business", calling?.number_assigned === true],
    ["Primary number chosen (\"Send from this\")", calling?.primary_selected === true],
    ["Calling READY", calling?.ready === true],
  ];
  return (
    <section className="ss-subsection" aria-label="Calling setup" style={{ marginBottom: 18 }}>
      <div className="ss-a2p-stage-list" aria-label="Calling readiness">
        {stages.map(([label, done]) => (
          <div key={label} className="ss-a2p-stage">
            <span aria-hidden>{done ? "✓" : "○"}</span>
            <strong>{label}</strong>
            <Status tone={done ? "ok" : "neutral"}>{done ? "Complete" : "Waiting"}</Status>
          </div>
        ))}
      </div>
      {canManage && account === "absent" && (
        <div className="ss-form-actions" style={{ marginTop: 10 }}>
          <button type="button" className="ss-btn" onClick={onRun} disabled={settingUp}>
            {settingUp ? "Connecting calling…" : "Set up calling"}
          </button>
        </div>
      )}
      {canManage && account === "incomplete" && (
        <div className="ss-form-actions" style={{ marginTop: 10 }}>
          <button type="button" className="ss-btn" onClick={onRun} disabled={settingUp}>
            {settingUp ? "Finishing calling setup…" : "Finish calling setup"}
          </button>
        </div>
      )}
      {note && <Outcome state={{ tone: note.tone, message: note.message }}/>}
    </section>
  );
}

export interface CallingSetupCardProps {
  calling: CommsReadiness["calling"];
  settingUp: boolean;
  note: WriteState;
  canManage: boolean;
  onRun: () => void;
}
