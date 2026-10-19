import { useCallback, useEffect, useId, useRef, useState } from "react";
import { KeyRound, PauseCircle, RefreshCw } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useTenantContext } from "@/hooks/useTenantContext";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  PORTAL_ACCESS_NOTE_MAX,
  PORTAL_ACCESS_REASONS_FOR,
  PORTAL_ACCESS_REASON_LABEL,
  fetchOwnerPortalAccess,
  portalAccessConfirmCopy,
  portalAccessRefusalCopy,
  restoreBlockedCopy,
  setPortalAccess,
  type OwnerPortalAccess,
  type PortalAccessAction,
  type PortalAccessReason,
  type PortalAccessStateName,
} from "@/lib/client-portal-access";
import type { RelationshipPerson } from "./useTenantRelationshipsData";
import { usePortalInvitations } from "./usePortalInvitations";
import { PortalInvitationManager } from "./PortalInvitationManager";
import { PortalConfigurationGate } from "./PortalConfigurationGate";
import "./owner-portal-dashboard.css";
import "./client-portal-access.css";

/**
 * E09 Slice 7 — "Portal access" on the Solo client record: pause, restore or end ONE joined client's
 * access to this business. One home (§18): the dashboard and the roster only report the state; this
 * card is where the owner changes it, and Paige uses the same writer from chat.
 *
 * Every state shown is the server's. A change is reported only after a fresh read shows it (§70.1);
 * the writer's acknowledgement alone never paints success. Restore is the one gold act (§11): Pause
 * is a quiet ink action and End is destructive. The confirm step is inline, not a modal.
 */
type Read =
  | { phase: "loading" }
  | { phase: "ready"; access: OwnerPortalAccess }
  | { phase: "refused" | "unavailable" | "not_found" | "error" | "no_workspace" };
type Note = { tone: "ok" | "warn" | "bad"; text: string };

const EXPECTED: Record<PortalAccessAction, PortalAccessStateName> = { pause: "paused", restore: "open", end: "ended" };

function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] || name;
}

function day(value: string | null): string | null {
  if (!value) return null;
  const at = Date.parse(value);
  return Number.isFinite(at) ? new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" }).format(at) : null;
}

export function ClientPortalAccess({ person, onAccessChange, onOpenPortal, onChanged }: {
  person: RelationshipPerson;
  onAccessChange?: (state: PortalAccessStateName, joined: boolean) => void;
  onOpenPortal?: () => void;
  /** After a confirmed change: the roster and the Portal dashboard re-read behind the card. */
  onChanged?: () => void;
}) {
  const { activeTenantId, activeUserId, activeTenant } = useTenantContext();
  const [read, setRead] = useState<Read>({ phase: "loading" });
  const [confirming, setConfirming] = useState<PortalAccessAction | null>(null);
  const [inviting, setInviting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<Note | null>(null);
  const alive = useRef(true);
  const request = useRef(0);
  const reportChange = useRef(onAccessChange);
  reportChange.current = onAccessChange;
  const name = person.name;
  const first = firstName(name);
  const business = activeTenant?.name?.trim() || "your business";

  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  /** The server's state for this contact in the workspace that is open. Returns it, or null. */
  const load = useCallback(async (): Promise<OwnerPortalAccess | null> => {
    const mine = ++request.current;
    const current = () => alive.current && request.current === mine;
    if (!activeTenantId) { setRead({ phase: "no_workspace" }); return null; }
    try {
      const result = await fetchOwnerPortalAccess(activeTenantId, person.id);
      if (!current()) return null;
      if (!result.ok || !result.access) {
        setRead({ phase: result.code === "REFUSED" ? "refused" : result.code === "UNAVAILABLE" ? "unavailable" : result.code === "NOT_FOUND" ? "not_found" : "error" });
        return null;
      }
      setRead({ phase: "ready", access: result.access });
      reportChange.current?.(result.access.state, result.access.joined);
      return result.access;
    } catch {
      if (current()) setRead({ phase: "error" });
      return null;
    }
  }, [activeTenantId, person.id]);

  useEffect(() => { setRead({ phase: "loading" }); setConfirming(null); setInviting(false); setNote(null); void load(); }, [load]);

  const run = async (action: PortalAccessAction, reason: PortalAccessReason | null, internalNote: string) => {
    if (busy || read.phase !== "ready") return;
    const seen = read.access;
    setBusy(true);
    setNote(null);
    try {
      const session = await supabase.auth.getSession();
      const actorId = session.data.session?.user.id ?? null;
      // The actor is the signed-in session; the workspace is the one this record was read for.
      if (session.error || !actorId || !activeTenantId || (activeUserId && actorId !== activeUserId)) {
        setNote({ tone: "bad", text: "Your account changed. Reopen this client in your current workspace." });
        return;
      }
      const result = await setPortalAccess({
        actorId, tenantId: activeTenantId, contactId: person.id, action, reason,
        note: internalNote, expectedChangedAt: seen.since,
      });
      if (!result.ok && result.code) {
        if (result.code === "INVALID_REQUEST") { setNote({ tone: "warn", text: portalAccessRefusalCopy(result.code, name) }); return; }
        if (result.code === "SCOPE_CHANGED") { setNote({ tone: "bad", text: portalAccessRefusalCopy(result.code, name) }); return; }
        const fresh = await load();
        setConfirming(null);
        setNote({
          tone: result.code === "UNCONFIRMED" ? "bad" : "warn",
          text: fresh || result.code === "UNCONFIRMED" ? portalAccessRefusalCopy(result.code, name, result.restoreBlockedBy)
            : `${portalAccessRefusalCopy(result.code, name, result.restoreBlockedBy)} Use Try again to see what’s current.`,
        });
        return;
      }
      // Success is what a fresh read says, not what the writer acknowledged (§70.1).
      const fresh = await load();
      if (!alive.current) return;
      setConfirming(null);
      if (fresh && fresh.state === EXPECTED[action]) {
        setNote({
          tone: "ok",
          text: action === "pause" ? `Paused. ${first} will see that their access is paused the next time they open your portal.`
            : action === "end" ? `Ended. ${first} will see that their access has ended.${fresh.can.invite ? " You can invite them again when you’re ready." : ""}`
              : `Restored. ${first} can open your portal again.`,
        });
        onChanged?.();
      } else {
        setNote({ tone: "bad", text: portalAccessRefusalCopy("UNCONFIRMED", name) });
      }
    } catch {
      setNote({ tone: "bad", text: portalAccessRefusalCopy("UNCONFIRMED", name) });
    } finally {
      if (alive.current) setBusy(false);
    }
  };

  const ready = read.phase === "ready" ? read.access : null;
  const label = !ready ? null : ready.state === "paused" ? "Access paused" : ready.state === "ended" ? "Access ended" : ready.joined ? "Joined" : "Not joined";
  const facts = ready && ready.state !== "open" ? [
    [ready.state === "paused" ? "Paused" : "Ended", day(ready.since)],
    ["By", ready.changedByName],
    ["Reason", ready.reason ? PORTAL_ACCESS_REASON_LABEL[ready.reason] : null],
    ["Team note", ready.note],
  ].filter((row): row is [string, string] => !!row[1]) : [];

  return (
    <section id="client-portal-access" className="trc-record-section trc-access" aria-labelledby="trc-access-title" aria-busy={read.phase === "loading" || busy || undefined}>
      <div className="trc-access-head">
        <div className="trc-access-heading">
          <h3 id="trc-access-title"><KeyRound aria-hidden />Portal access</h3>
          {ready && <p>{summary(ready, name, first)}</p>}
        </div>
        {label && (
          <span className="trc-access-state" data-state={ready!.state === "open" ? (ready!.joined ? "joined" : "not-joined") : ready!.state}>
            {ready!.state === "paused" && <PauseCircle aria-hidden />}{label}
          </span>
        )}
      </div>

      {read.phase === "loading" && (
        <div className="trc-access-body">
          <span className="sr-only" role="status">Checking {first}’s portal access…</span>
          <div className="trc-access-skeleton" aria-hidden="true"><b /><b /></div>
        </div>
      )}
      {read.phase === "refused" && <p className="trc-access-state-line" role="status">Only the business owner or an admin can manage {name}’s portal access.</p>}
      {read.phase === "unavailable" && <p className="trc-access-state-line" role="status">Client portal access isn’t managed from this account.</p>}
      {read.phase === "not_found" && <p className="trc-access-state-line" role="status">{name} isn’t a client in the workspace you have open.</p>}
      {read.phase === "no_workspace" && <p className="trc-access-state-line" role="status">Open a business workspace to manage this client’s portal access.</p>}
      {read.phase === "error" && (
        <div className="trc-access-state-line" role="alert">
          <p>We couldn’t check {name}’s portal access. Nothing has changed.</p>
          <button type="button" className="trc-access-quiet" onClick={() => { setRead({ phase: "loading" }); void load(); }}><RefreshCw aria-hidden />Try again</button>
        </div>
      )}

      {ready && (
        <div className="trc-access-body">
          {facts.length > 0 && (
            <dl className="trc-access-facts">
              {facts.map(([term, value]) => <div key={term} data-wide={term === "Team note" || undefined}><dt>{term}</dt><dd data-date={term === "Paused" || term === "Ended" || undefined}>{value}</dd></div>)}
            </dl>
          )}
          {ready.state === "paused" && !ready.can.restore && ready.restoreBlockedBy && (
            <p className="trc-access-hint">{restoreBlockedCopy(ready.restoreBlockedBy, name)}</p>
          )}

          {!confirming && !inviting && (
            <div className="trc-access-actions">
              {ready.state === "paused" && (
                <button type="button" data-gold className="trc-access-btn trc-access-gold" disabled={busy || !ready.can.restore} onClick={() => setConfirming("restore")}>Restore access</button>
              )}
              {ready.state === "open" && ready.joined && (
                <button type="button" className="trc-access-btn" disabled={busy || !ready.can.pause} onClick={() => setConfirming("pause")}>Pause access</button>
              )}
              {(ready.state === "paused" || (ready.state === "open" && ready.joined)) && (
                <button type="button" className="trc-access-btn trc-access-danger" disabled={busy || !ready.can.end} onClick={() => setConfirming("end")}>End access</button>
              )}
              {ready.state === "ended" && (
                <button type="button" className="trc-access-btn" disabled={busy} onClick={() => setInviting(true)}>Invite again</button>
              )}
              {ready.state === "open" && !ready.joined && onOpenPortal && (
                <button type="button" className="trc-access-btn" onClick={onOpenPortal}>Open Portal invitations</button>
              )}
            </div>
          )}

          {confirming && (
            <AccessConfirm key={confirming} action={confirming} name={name} first={first} business={business} busy={busy}
              onCancel={() => setConfirming(null)} onConfirm={(reason, text) => void run(confirming, reason, text)} />
          )}

          {inviting && activeTenantId && ready.state === "ended" && (
            <ReInvite tenantId={activeTenantId} person={person} onClose={() => setInviting(false)} />
          )}
        </div>
      )}

      {note && <p className="trc-access-note" data-tone={note.tone} role={note.tone === "ok" ? "status" : "alert"}>{note.text}</p>}
    </section>
  );
}

function summary(access: OwnerPortalAccess, name: string, first: string): string {
  // "When they open it": the client learns of the change on their next visit, not the moment it happens.
  if (access.state === "paused") return `When ${first} opens your portal, they see that their access is paused. Their portal messages and shared work are kept.`;
  if (access.state === "ended") return `When ${first} opens your portal, they see that their access has ended. Their history stays on this contact.`;
  if (access.joined) return `Joined. ${first} can open your portal.`;
  const invitation = access.invitation === "pending" ? " An invitation is waiting for them."
    : access.invitation === "expired" ? " Their last invitation expired."
      : access.invitation === "canceled" ? " Their last invitation was canceled."
        : access.invitation === "none" ? " No invitation has been sent." : "";
  return `${name} hasn’t joined your portal yet.${invitation}`;
}

/** The inline confirm: what happens, a reason (pause and end), an optional team note, then the act. */
function AccessConfirm({ action, name, first, business, busy, onCancel, onConfirm }: {
  action: PortalAccessAction; name: string; first: string; business: string; busy: boolean;
  onCancel: () => void; onConfirm: (reason: PortalAccessReason | null, note: string) => void;
}) {
  const id = useId();
  const copy = portalAccessConfirmCopy(action, name, business);
  const [reason, setReason] = useState<PortalAccessReason | null>(null);
  const [text, setText] = useState("");
  const heading = useRef<HTMLHeadingElement | null>(null);
  useEffect(() => { heading.current?.focus(); }, []);
  const needsReason = action !== "restore";
  const remaining = PORTAL_ACCESS_NOTE_MAX - text.length;
  return (
    <div className="trc-access-confirm" role="group" aria-labelledby={`${id}-title`} data-action={action}>
      <h4 id={`${id}-title`} ref={heading} tabIndex={-1}>{copy.title}</h4>
      <ul>{copy.lines.map((line) => <li key={line}>{line}</li>)}</ul>
      {needsReason && (
        <>
          <fieldset className="trc-access-reasons">
            <legend>Reason <span>(only your team sees it)</span></legend>
            <RadioGroup value={reason ?? ""} onValueChange={(value) => setReason(value as PortalAccessReason)} aria-label="Reason" className="trc-access-reason-list">
              {PORTAL_ACCESS_REASONS_FOR[action as "pause" | "end"].map((value) => (
                <label key={value} className="trc-access-reason" htmlFor={`${id}-${value}`}>
                  <RadioGroupItem id={`${id}-${value}`} value={value} className="trc-access-radio" />
                  <span>{PORTAL_ACCESS_REASON_LABEL[value]}</span>
                </label>
              ))}
            </RadioGroup>
          </fieldset>
          <div className="trc-access-field">
            <label htmlFor={`${id}-note`}>Note for your team <span>(optional)</span></label>
            <textarea id={`${id}-note`} value={text} maxLength={PORTAL_ACCESS_NOTE_MAX} rows={2} aria-describedby={`${id}-note-hint`}
              onChange={(event) => setText(event.target.value.slice(0, PORTAL_ACCESS_NOTE_MAX))} />
            <p id={`${id}-note-hint`}>Only your team sees this. {first} never does.{remaining < 60 ? ` ${remaining} characters left.` : ""}</p>
          </div>
        </>
      )}
      <div className="trc-access-actions">
        <button type="button" className="trc-access-btn trc-access-quiet-btn" disabled={busy} onClick={onCancel}>Cancel</button>
        <button type="button" disabled={busy || (needsReason && !reason)} onClick={() => onConfirm(reason, text)}
          {...(action === "restore" ? { "data-gold": "" } : {})}
          className={`trc-access-btn ${action === "restore" ? "trc-access-gold" : action === "end" ? "trc-access-danger-solid" : "trc-access-ink"}`}>
          {busy ? (action === "pause" ? "Pausing…" : action === "end" ? "Ending…" : "Restoring…") : copy.confirm}
        </button>
      </div>
    </div>
  );
}

/** "Invite again": the existing invitation command for this contact, unchanged (§18). */
function ReInvite({ tenantId, person, onClose }: { tenantId: string; person: RelationshipPerson; onClose: () => void }) {
  const invitations = usePortalInvitations(tenantId);
  const rows = !invitations.isError && !invitations.isLoading ? invitations.data : undefined;
  // The server cleared the link when access ended; a roster row read before that must not block the invitation.
  const unlinked: RelationshipPerson = { ...person, linkedUserId: null, portalAccess: "ended" };
  // The invitation they used to join is spent; "Latest invitation: accepted" under "Access ended" would
  // contradict the state above it (review 9). Only an invitation that could still matter is shown.
  const latest = rows?.find((row) => row.contact_id === person.id && !row.last_used_at);
  return (
    <div className="trc-access-reinvite">
      {/* Round 2 (compliance 5): the person who accepts may not be the one who left, so name all of it. */}
      <p>Whoever accepts sees what this client’s record holds in your portal: earlier messages, shared work and files, invoices issued to this client, and agreements that name them as a signer. Their earlier invitations no longer work.</p>
      {rows ? (
        <PortalConfigurationGate tenantId={tenantId}>
          <PortalInvitationManager tenantId={tenantId} person={unlinked} latest={latest} onReadback={() => invitations.invalidate()} />
        </PortalConfigurationGate>
      ) : invitations.isError ? (
        <p role="alert">Invitation history couldn’t be checked. Close this and try again.</p>
      ) : (
        <p role="status">Checking invitation history…</p>
      )}
      <button type="button" className="trc-access-btn trc-access-quiet-btn" onClick={onClose}>Close</button>
    </div>
  );
}
