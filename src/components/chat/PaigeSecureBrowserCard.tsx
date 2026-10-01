import { useRef, useState, type FormEvent } from "react";
import { CircleAlert, Globe2, LoaderCircle, LockKeyhole, ShieldCheck, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import "./paige-secure-browser-card.css";

type SessionView = {
  id: string;
  threadId: string;
  purpose: string;
  targetDisplayHost: string;
  targetOrigin: string;
  authority: string;
  state: string;
  stateVersion: number;
  safeReason: string | null;
};

type RequestResult = {
  session?: SessionView;
  receiptId?: string;
  status?: string;
  reason?: string;
  railEvidence?: string;
  message?: string;
};

export function PaigeSecureBrowserCard({
  threadId,
  initialPurpose = "",
  initialTarget = "",
  onDismiss,
}: {
  threadId: string;
  initialPurpose?: string;
  initialTarget?: string;
  onDismiss?: () => void;
}) {
  const [purpose, setPurpose] = useState(initialPurpose);
  const [target, setTarget] = useState(initialTarget);
  const [state, setState] = useState<"review" | "resolving" | "result" | "failed" | "cancelled">("review");
  const [result, setResult] = useState<RequestResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const attempt = useRef(0);
  const idempotencyKey = useRef(crypto.randomUUID());

  async function request(event: FormEvent) {
    event.preventDefault();
    const currentAttempt = ++attempt.current;
    setState("resolving");
    setError(null);
    const normalized = target.trim().match(/^https?:\/\//i) ? target.trim() : `https://${target.trim()}`;
    const origin = (() => { try { return new URL(normalized).origin; } catch { return normalized; } })();
    const { data, error: invokeError } = await supabase.functions.invoke("browser-use", {
      body: {
        thread_id: threadId,
        purpose: purpose.trim(),
        target: normalized,
        idempotency_key: idempotencyKey.current,
        scope: {
          mode: "read_only",
          allowedOrigins: [origin],
          allowedReadKinds: ["status", "date", "document_list"],
          downloads: "quarantine_only",
          consequentialActions: "disabled",
        },
      },
    });
    if (attempt.current !== currentAttempt) return;
    if (invokeError) {
      setError("Paige could not verify this request. No browser session was opened.");
      setState("failed");
      return;
    }
    setResult((data || {}) as RequestResult);
    setState("result");
  }

  function cancel() {
    attempt.current += 1;
    setState("cancelled");
  }

  return (
    <section className="psb-card" aria-labelledby="psb-card-title">
      <header className="psb-card__head">
        <span className="psb-card__mark"><Globe2 size={18} /></span>
        <div><span>Paige capability</span><h3 id="psb-card-title">Paige Secure Browser</h3></div>
        {onDismiss && <button className="psb-card__icon" onClick={onDismiss} aria-label="Close Secure Browser card"><X size={17} /></button>}
      </header>

      {state === "review" && (
        <form className="psb-card__body" onSubmit={request}>
          <p>Review the purpose and target before Paige checks your workspace’s secure-browser access.</p>
          <label>Business purpose<textarea required minLength={3} maxLength={1000} value={purpose} onChange={(event) => setPurpose(event.target.value)} placeholder="Check the status of this month’s filing" /></label>
          <label>Target website<input required inputMode="url" value={target} onChange={(event) => setTarget(event.target.value)} placeholder="example.com" /></label>
          <dl className="psb-card__scope">
            <div><dt>Scope</dt><dd>Read status, dates, and document lists</dd></div>
            <div><dt>Actions</dt><dd>Disabled</dd></div>
            <div><dt>Downloads</dt><dd>Vault quarantine only</dd></div>
            <div><dt>Authority</dt><dd>Verified from this workspace</dd></div>
          </dl>
          <div className="psb-card__notice"><LockKeyhole size={16} /><span>Never enter a password or verification code in chat. Sign-in handoff is not available in this MVP.</span></div>
          <footer><button type="button" className="psb-button" onClick={onDismiss}>Cancel</button><button className="psb-button psb-button--primary" disabled={purpose.trim().length < 3 || !target.trim()}>Check availability</button></footer>
        </form>
      )}

      {state === "resolving" && (
        <div className="psb-card__state" aria-live="polite"><LoaderCircle className="psb-spin" size={24} /><h4>Checking secure access…</h4><p>No website or external account is being opened.</p><button className="psb-button" onClick={cancel}>Cancel</button></div>
      )}

      {state === "cancelled" && (
        <div className="psb-card__state"><ShieldCheck size={24} /><h4>Request closed</h4><p>No browser session was opened. You can start again when ready.</p><button className="psb-button" onClick={() => setState("review")}>Start again</button></div>
      )}

      {state === "failed" && (
        <div className="psb-card__state" role="alert"><CircleAlert size={24} /><h4>Availability check failed</h4><p>{error}</p><button className="psb-button" onClick={() => setState("review")}>Review and retry</button></div>
      )}

      {state === "result" && (
        <div className="psb-card__body psb-card__result" aria-live="polite">
          <span className="psb-pill">Unavailable</span>
          <h4>No live session exists</h4>
          <p>Paige Secure Browser is under setup for this workspace. No website, sign-in, account, or download was opened.</p>
          <dl className="psb-card__scope">
            <div><dt>Purpose</dt><dd>{result?.session?.purpose || purpose}</dd></div>
            <div><dt>Target</dt><dd>{result?.session?.targetDisplayHost || target}</dd></div>
            <div><dt>Authority</dt><dd>{result?.session?.authority || "Verified"}</dd></div>
            <div><dt>Evidence</dt><dd>{result?.receiptId ? "Request receipt recorded" : "Receipt unavailable"}</dd></div>
          </dl>
          <footer><button className="psb-button" onClick={onDismiss}>Close</button><button className="psb-button" onClick={() => { idempotencyKey.current = crypto.randomUUID(); setState("review"); }}>New request</button></footer>
        </div>
      )}
    </section>
  );
}
