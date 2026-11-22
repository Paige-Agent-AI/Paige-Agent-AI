// Original declared-handle form. The original native writer and session cleanup stay with its caller.
import React from "react";
import {Ic} from "./_shared";
import {SOCIAL_NETWORKS,toHandlePayload,type SocialHandle} from "./social-truth";
import type {SocialWriteResult} from "./useSocialCommand";
type RecordAccountsFormProps={
 handles:SocialHandle[];
 canManage:boolean;
 onSave:(draft:Record<string,string>)=>Promise<SocialWriteResult>;
 onClose:()=>void;
};

export function RecordAccountsForm({ handles, canManage, onSave, onClose }: RecordAccountsFormProps) {
  const initial = React.useMemo(() => {
    const seed: Record<string, string> = {};
    for (const network of SOCIAL_NETWORKS) {
      seed[network.key] = handles.find((h) => h.network === network.key)?.handle ?? "";
    }
    return seed;
  }, [handles]);
  const [draft, setDraft] = React.useState(initial);
  const [saving, setSaving] = React.useState(false);
  const [message, setMessage] = React.useState("");
  const firstField = React.useRef<HTMLInputElement | null>(null);
  const dialog = React.useRef<HTMLDivElement | null>(null);
  const mounted = React.useRef(false);

  React.useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  React.useEffect(() => { setDraft(initial); }, [initial]);
  React.useEffect(() => {
    firstField.current?.focus({ preventScroll: true });
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape" && !saving) { event.preventDefault(); onClose(); } };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, saving]);

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canManage || saving) return;
    setSaving(true);
    setMessage("");
    const result = await onSave(toHandlePayload(draft));
    if (!mounted.current) return;
    setSaving(false);
    if (result.ok) {
      // Reports the count the SERVER read back, not the length of what was typed.
      setMessage(
        result.recordedCount === 0
          ? "Saved. No account is on record now."
          : `Saved. ${result.recordedCount} account${result.recordedCount === 1 ? "" : "s"} on record.`,
      );
      return;
    }
    setMessage(result.message);
  };

  return (
    <>
      <div className="social-scrim" onClick={() => !saving && onClose()} />
      <div className="social-dialog" role="dialog" aria-modal="true" aria-labelledby="social-record-title" ref={dialog}>
        <header>
          <div>
            <span className="social-eyebrow">Marketing · Social</span>
            <h2 id="social-record-title">The accounts this business posts from</h2>
          </div>
          <button type="button" className="btn btn-s" onClick={onClose} disabled={saving}>
            <Ic.x size={13} />Close
          </button>
        </header>
        <form onSubmit={submit}>
          <p className="social-dialog-note">
            This tells PAIGE which accounts are yours. It does not connect them — nothing here can publish,
            schedule, or read a follower or engagement number for you. Clear a field to take that
            account off your record.
          </p>
          <div className="social-dialog-fields">
            {SOCIAL_NETWORKS.map((network, index) => (
              <label key={network.key}>
                <span>{network.label}</span>
                <input
                  ref={index === 0 ? firstField : undefined}
                  type="text"
                  value={draft[network.key] ?? ""}
                  placeholder={network.hint}
                  maxLength={120}
                  disabled={!canManage || saving}
                  onChange={(event) => setDraft({ ...draft, [network.key]: event.target.value })}
                />
              </label>
            ))}
          </div>
          {!canManage && (
            <p className="social-dialog-status" role="status">
              You can look, not change. An owner or admin of this workspace can record these.
            </p>
          )}
          {message && <p className="social-dialog-status" role="status">{message}</p>}
          <div className="social-dialog-actions">
            <button type="button" className="btn btn-s" onClick={onClose} disabled={saving}>Cancel</button>
            <button type="submit" className="btn btn-s btn-g" disabled={!canManage || saving}>
              <Ic.check size={13} />{saving ? "Saving…" : "Save to record"}
            </button>
          </div>
        </form>
      </div>
    </>
  );
}
