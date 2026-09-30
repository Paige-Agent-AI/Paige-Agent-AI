import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useTenantContext } from "@/hooks/useTenantContext";
import type { UseMcpGateway } from "./data/useMcpGateway";
import type { ContactSyncRecord } from "./data/mcpContactSync";

type IncomingProps = {
  gw: UseMcpGateway;
  connectionId: string;
  connectionEnabled: boolean;
  uncertainGeneration: number | null;
  onUncertain: (id: string, generation: number | null) => void;
  onDirtyChange: (dirty: boolean) => void;
  onEditingChange: (editing: boolean) => void;
};

/** The existing drawer's incoming grant, not a provider probe or a second connection authority. */
export function IncomingContacts({ gw, connectionId, connectionEnabled, uncertainGeneration,
  onUncertain, onDirtyChange, onEditingChange }: IncomingProps) {
  const { activeTenant } = useTenantContext();
  const business = activeTenant?.name ?? "this business";
  const [record, setRecord] = useState<ContactSyncRecord | null>(null);
  const [mode, setMode] = useState<"view" | "edit" | "revoke" | "instructions">("view");
  const [reading, setReading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [credential, setCredential] = useState("");
  const [consent, setConsent] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [legacy, setLegacy] = useState(false);
  const [cancelRequested, setCancelRequested] = useState(false);
  const [recoveryRead, setRecoveryRead] = useState(false);
  const alive = useRef(false);
  const request = useRef(0);
  const section = useRef<HTMLElement>(null);
  const readRef = useRef(gw.readContactSync);
  const initialUncertainty = useRef(uncertainGeneration !== null);
  readRef.current = gw.readContactSync;
  const unresolved = uncertainGeneration !== null && (!record || record.generation <= uncertainGeneration);
  useLayoutEffect(() => {
    // Saving/recovery replaces controls. Keep a removed control's focus in this dialog before
    // another key can reach the shell; never steal focus from another surviving control.
    if (document.activeElement === document.body) section.current?.querySelector<HTMLElement>("h3")?.focus();
  });
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => { onDirtyChange(false); return () => onDirtyChange(false); }, [onDirtyChange]);
  useEffect(() => { onEditingChange(mode !== "view"); }, [mode, onEditingChange]);

  const read = async () => {
    const token = ++request.current;
    setReading(true); setMessage(null); setSaved(null);
    const result = await readRef.current(connectionId);
    if (!alive.current || token !== request.current || result.code === "MCP_STALE") return;
    setReading(false);
    if (!result.ok || !result.record) { setRecord(null); setMessage(result.message ?? "Incoming settings are unavailable."); return; }
    setRecord(result.record);
    setRecoveryRead(true);
    if (uncertainGeneration !== null && result.record.generation > uncertainGeneration) onUncertain(connectionId, null);
  };
  useEffect(() => {
    let current = true;
    void readRef.current(connectionId).then(result => {
      if (!current || result.code === "MCP_STALE") return;
      setReading(false);
      setRecord(result.record);
      if (initialUncertainty.current && result.ok) setRecoveryRead(true);
      if (!result.ok) setMessage(result.message ?? "Incoming settings are unavailable.");
    });
    return () => { current = false; };
  // The initial read belongs to this mount; later uncertainty is reconciled only by an explicit read.
  }, [connectionId]);

  const changeMode = (next: typeof mode) => {
    setCredential(""); setConsent(false); onDirtyChange(false); setMessage(null); setSaved(null); setMode(next);
    // The drawer remains the sole focus/scroll owner. Move focus into the new state, not to body.
    requestAnimationFrame(() => section.current?.querySelector<HTMLElement>('input, h3')?.focus());
  };
  const commit = async (enabled: boolean) => {
    if (!record || busy || gw.saving || unresolved || reading) return;
    if (enabled && (!consent || !/^\S{32,512}$/.test(credential))) return;
    const generation = record.generation;
    setBusy(true); setMessage(null); setSaved(null);
    setRecoveryRead(false);
    // Persist the unresolved generation in the scoped drawer owner BEFORE dispatch. Closing the
    // drawer does not cancel a committed/server-in-flight request or erase its recovery notice.
    onUncertain(connectionId, generation);
    const resultPromise = gw.setContactSync(connectionId, enabled, enabled ? credential : null, generation);
    // Write-only material is not kept for retry, readback, history, clipboard or logs.
    setCredential(""); setConsent(false); onDirtyChange(false);
    const result = await resultPromise;
    if (!alive.current || result.code === "MCP_STALE") return;
    setBusy(false);
    if (result.ok && result.record) {
      setRecord(result.record); setMode("view"); onUncertain(connectionId, null);
      setSaved(enabled ? "Saved · incoming permission confirmed. Sender setup is still required." : "Incoming access revoked · current settings confirmed.");
      requestAnimationFrame(() => section.current?.querySelector<HTMLElement>('h3')?.focus());
      return;
    }
    if (result.code === "MCP_CONTACT_OUTCOME_UNKNOWN") { onUncertain(connectionId, generation); setMode("view"); }
    else onUncertain(connectionId, null);
    if (result.code === "MCP_CONTACT_SYNC_STALE") { setRecord(null); setMode("view"); }
    if (result.code === "MCP_LEGACY_CONNECTION_READONLY") { setLegacy(true); setMode("view"); }
    setMessage(result.message ?? "No change was confirmed. Read the current settings before trying again.");
  };

  return <section ref={section} className="ig-incoming" aria-label="Incoming contacts">
    <h3 tabIndex={-1}>{mode === "edit" ? (record?.configuredEnabled ? "Replace sync credential" : "Enable incoming contacts")
      : mode === "revoke" ? "Revoke incoming access" : mode === "instructions" ? "Sender setup" : "Incoming contacts"}</h3>
    {saved && <p className="ig-gw-info" role="status">{saved}</p>}
    {message && <p className="ig-error" role="alert">{message}</p>}
    {reading ? <p role="status">Reading this connection’s settings…</p> : !record ? <>
      <p>No permission or configuration is assumed.</p>
      <button type="button" className="ig-btn" onClick={() => void read()}>Retry reading settings</button>
    </> : <>
      <dl className="ig-facts">
        <div><dt>Business</dt><dd>{business}</dd></div>
        <div><dt>Incoming contacts</dt><dd>{record.enabled ? "Enabled" : record.configuredEnabled ? "Access no longer active" : "Not enabled"}</dd></div>
        <div><dt>Sync credential</dt><dd>{record.credentialConfigured ? "On file · never shown" : "Not on file"}</dd></div>
        <div><dt>Saved version</dt><dd>{record.generation}</dd></div>
      </dl>
      <details><summary>Connection reference</summary><code className="ig-incoming-reference">{record.connectionId}</code></details>
      {busy ? <p role="status">Saving and confirming… You may close this drawer; an in-flight request still belongs to its original business.</p> : unresolved ? <>
        <p className="ig-gw-warn" role="alert">Save not confirmed. The request may still finish in its original business. Your entered credential has been cleared. Read the current settings before another change.</p>
        <button type="button" className="ig-btn" onClick={() => void read()}>Read current settings</button>
        <button type="button" className="ig-btn" disabled={!recoveryRead} onClick={() => {
          onUncertain(connectionId, null); setMode("view"); setSaved(null);
          setMessage("Review the current version before a new attempt. The earlier request is still unconfirmed; if it finishes first, a new save will be refused as out of date.");
        }}>Review a new attempt</button>
      </> : legacy ? <p className="ig-gw-warn">Keep your sender unchanged. Review its destination and existing contact mappings before adding an incoming contacts connection.</p>
      : mode === "edit" ? <>
        {cancelRequested && <div className="ig-confirm-close" role="alertdialog" aria-modal="true" aria-label="Discard incoming changes">
          <p>No new permission is granted by closing. Your entered credential will be cleared.</p>
          <button type="button" className="ig-btn" data-danger onClick={() => { setCancelRequested(false); changeMode("view"); }}>Discard changes</button>
          <button type="button" className="ig-btn" data-keep-editing autoFocus onClick={() => {
            setCancelRequested(false); requestAnimationFrame(() => section.current?.querySelector<HTMLInputElement>('input[type="password"]')?.focus());
          }}>Keep editing</button>
        </div>}
        <p>Allow this source to create and update contacts in <strong>{business}</strong>. It cannot delete contacts through this incoming path.</p>
        {record.configuredEnabled && <p className="ig-gw-warn">The current credential stops working when this saves. Pause your sender first; update its credential and saved version before resuming.</p>}
        <label className="ig-field"><span>{record.configuredEnabled ? "New sync credential" : "Incoming sync credential"}</span>
          <input type="password" autoComplete="new-password" spellCheck={false} maxLength={512} value={credential}
            disabled={busy} onChange={e => {
              // Close/keyboard handling must see unsaved input in this event, not after an effect.
              onDirtyChange(Boolean(e.target.value || consent)); setCredential(e.target.value);
            }} />
          <small>Use a strong, unique value of 32–512 characters, without spaces. Keep it in your password manager and sender. Paige never reads it back.</small>
        </label>
        <label className="ig-incoming-consent"><input type="checkbox" checked={consent} disabled={busy} onChange={e => {
          onDirtyChange(Boolean(credential || e.target.checked)); setConsent(e.target.checked);
        }} />
          <span>I allow this source to create and update contacts in {business}, and I will configure the sender with this connection’s details.</span></label>
        <div className="ig-actions ig-gw-actions">
          <button type="button" className="ig-btn" disabled={busy} onClick={() => credential || consent ? setCancelRequested(true) : changeMode("view")}>Cancel</button>
          <button type="button" className="ig-btn" data-primary disabled={busy || gw.saving || !consent || !/^\S{32,512}$/.test(credential)} onClick={() => void commit(true)}>
            {busy ? "Saving and confirming…" : record.configuredEnabled ? "Save replacement" : "Enable incoming contacts"}</button>
        </div>
      </> : mode === "revoke" ? <>
        <p>New incoming writes will stop when this saves. Contacts already received stay in Paige. Outbound tool approvals are unchanged.</p>
        <div className="ig-actions ig-gw-actions"><button type="button" className="ig-btn" disabled={busy} onClick={() => changeMode("view")}>Keep access</button>
          <button type="button" className="ig-btn" data-danger disabled={busy || gw.saving} onClick={() => void commit(false)}>{busy ? "Revoking and confirming…" : "Revoke access"}</button></div>
      </> : mode === "instructions" ? <SenderInstructions record={record} onBack={() => changeMode("view")} /> : <>
        <p>Incoming data belongs to <strong>{business}</strong>. Opening a different business will not redirect it. No outbound tool is approved here.</p>
        {record.configuredEnabled && !record.enabled && <p className="ig-gw-warn">The saved permission is not active. The connection or the person who enabled it no longer has the required access. A saved credential alone does not authorize new contacts.</p>}
        {!connectionEnabled && <p className="ig-gw-warn">This connection is turned off. Restore it through its existing setup before enabling incoming contacts.</p>}
        {record.enabled && <p className="ig-gw-info">Permission saved · sender setup still required. This does not prove that a sender is connected or that contacts arrived.</p>}
        {gw.canWrite && <div className="ig-actions ig-gw-actions">
          {record.enabled && <button type="button" className="ig-btn" data-primary onClick={() => changeMode("instructions")}>View sender setup</button>}
          {connectionEnabled && <button type="button" className="ig-btn" disabled={gw.saving} onClick={() => changeMode("edit")}>
            {record.configuredEnabled ? (record.enabled ? "Replace sync credential" : "Review and enable again") : "Set up incoming contacts"}</button>}
          {record.configuredEnabled && <button type="button" className="ig-btn" data-danger disabled={gw.saving} onClick={() => changeMode("revoke")}>Revoke incoming access</button>}
        </div>}
      </>}
    </>}
  </section>;
}

function SenderInstructions({ record, onBack }: { record: ContactSyncRecord; onBack: () => void }) {
  // Public project origin only; never read a key or derive a destination business from a URL.
  const base = import.meta.env.VITE_SUPABASE_URL;
  let receiver: string | null = null;
  try { const url = new URL(base); if (url.protocol === "https:" || url.hostname === "127.0.0.1" || url.hostname === "localhost") receiver = `${url.origin}/functions/v1/paige-bridge`; } catch { /* unavailable */ }
  const shape = JSON.stringify({ verb: "upsert_contact_mirror", payload: {
    connection_id: record.connectionId, generation: record.generation, event_id: "[stable event UUID]",
    external_id: "[source contact ID]", source_updated_at: "[source ISO timestamp]", email: "[contact email]",
  } }, null, 2);
  return <>
    <p>Configure your sender yourself. This screen does not log in to it or send a test contact.</p>
    <ol className="ig-incoming-steps">
      <li>Pause an existing sender before changing it. Review its external contact mappings; an email match alone does not prove source identity.</li>
      <li>Use this connection reference, saved version and your dedicated sync credential. No open-workspace or owner-email destination is accepted.</li>
      <li>Keep the same event ID and payload across retries. New content needs a new event ID; a lost reply does not.</li>
      <li>Confirm the committed contact reference in the response before resuming. Never guess success or resend with a new event ID.</li>
    </ol>
    {!receiver && <p className="ig-error" role="alert">The receiver address is unavailable in this environment. Do not configure your sender yet.</p>}
    <details><summary>Request shape · placeholders must be replaced</summary>
      <pre className="ig-incoming-code">{`POST ${receiver ?? "[receiver unavailable]"}\nAuthorization: Bearer [your sync credential]\nContent-Type: application/json\n\n${shape}`}</pre>
    </details>
    <p className="ig-gw-warn">Existing contact IDs are not automatically claimed by a new connection. Review the mapping and destination before moving an existing feed.</p>
    <button type="button" className="ig-btn" onClick={onBack}>Back to connection</button>
  </>;
}

export function CreateIncomingContacts({ gw, uncertain, onUncertain, onDirtyChange, onCreated, onClose }: {
  gw: UseMcpGateway; uncertain: boolean; onUncertain: (uncertain: boolean) => void; onDirtyChange: (dirty: boolean) => void;
  onCreated: (id: string) => void; onClose: () => void;
}) {
  const { activeTenant } = useTenantContext();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [separateSource, setSeparateSource] = useState(false);
  const alive = useRef(false);
  const heading = useRef<HTMLHeadingElement>(null);
  useLayoutEffect(() => {
    if (document.activeElement === document.body) heading.current?.focus();
  });
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => { onDirtyChange(false); return () => onDirtyChange(false); }, [onDirtyChange]);
  const create = async () => {
    if (busy || gw.saving || !name.trim() || uncertain) return;
    setBusy(true); setError(null);
    // Retained by the section even if this editor closes while the request is in flight.
    onUncertain(true);
    const result = await gw.createIncoming(name.trim());
    if (!alive.current || result.code === "MCP_STALE") return;
    setBusy(false);
    if (result.ok && result.record) { setName(""); onDirtyChange(false); onCreated(result.record.connectionId); return; }
    if (result.code === "MCP_CONTACT_OUTCOME_UNKNOWN") { setName(""); onDirtyChange(false); return; }
    onUncertain(false);
    setError(result.message ?? "No connection was confirmed. Try again when the settings are available.");
  };
  if (uncertain && !busy) return <>
    <h3 ref={heading} tabIndex={-1}>Creation not confirmed</h3><p className="ig-gw-warn" role="alert">The connection may have been created. Do not submit it again. Refresh the connection list and inspect its records; a matching name alone does not confirm this request.</p>
    <p>Opening a different business does not cancel a request already sent to the original business.</p>
    <button type="button" className="ig-btn" onClick={() => { gw.reload(); onClose(); }}>Back to Integrations</button>
    <label className="ig-incoming-consent"><input type="checkbox" checked={separateSource} onChange={e => setSeparateSource(e.target.checked)} />
      <span>I have reviewed the connection list. I want to add a separate source, not retry the unconfirmed creation.</span></label>
    <button type="button" className="ig-btn" disabled={!separateSource} onClick={() => {
      setName(""); onDirtyChange(false); setSeparateSource(false); onUncertain(false);
    }}>Start a separate connection</button>
  </>;
  return <>
    <h3 ref={heading} tabIndex={-1}>Add incoming contacts</h3><p>Use one connection for your external contact source. It will belong to <strong>{activeTenant?.name ?? "this business"}</strong>.</p>
    <label className="ig-field"><span>Connection name</span><input name="incoming-name" autoComplete="off" maxLength={120} value={name} disabled={busy} onChange={e => {
      onDirtyChange(Boolean(e.target.value)); setName(e.target.value);
    }} /></label>
    <p>This creates the connection only. Incoming contacts remain off until you explicitly enable them.</p>
    {error && <p className="ig-error" role="alert">{error}</p>}
    <div className="ig-actions ig-gw-actions">
      <button type="button" className="ig-btn" disabled={busy} onClick={onClose}>Cancel</button>
      <button type="button" className="ig-btn" data-primary disabled={busy || gw.saving || !name.trim()} onClick={() => void create()}>{busy ? "Saving and confirming…" : "Save connection"}</button>
    </div>
  </>;
}
