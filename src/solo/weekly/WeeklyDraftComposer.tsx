import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { getScopedUserId } from "@/lib/scopedUser";
import { useWeeklyOwnerAudience } from "./useWeeklyResponsibility";
import { requestWeeklyDraft, type WeeklyDraftRequest, type WeeklyDraftResult, type WeeklyDraftState } from "./weekly-draft-command";
import type { WeeklyBrowserScope } from "./weekly-owner-read";
import { WeeklyDraftForm, WeeklyDraftReview } from "./WeeklyDraftReview";

/** Same owner surface in Chat and Calendar. No model offer or dispatch change. */
export function WeeklyDraftComposer({ businessZone, onSaved }: { businessZone: string | null; onSaved: () => void }) {
  const audience = useWeeklyOwnerAudience();
  if (!audience.eligible) return null;
  return <ScopedComposer key={audience.key} actor={audience.context.activeUserId!} tenant={audience.context.activeTenantId!}
    businessZone={businessZone} onSaved={onSaved} />;
}
function ScopedComposer({ actor, tenant, businessZone, onSaved }: {
  actor: string; tenant: string; businessZone: string | null; onSaved: () => void;
}) {
  const [requests, setRequests] = useState<WeeklyDraftState[]>([]), [selected, setSelected] = useState<WeeklyDraftState | null>(null);
  const [busy, setBusy] = useState(false), [loading, setLoading] = useState(true), [planning, setPlanning] = useState(false);
  const [message, setMessage] = useState(""), [unconfirmed, setUnconfirmed] = useState(false), [unavailable, setUnavailable] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const scope = useRef<WeeklyBrowserScope | null>({ actorId: actor, tenantId: tenant, epoch: 0 });
  const ticket = useRef(0), flight = useRef(false);
  const current = () => getScopedUserId() === null ? scope.current : null;
  const adopt = (result: WeeklyDraftResult) => {
    setLoading(false); setBusy(false); setUnavailable(false);
    if (result.kind === "refused") { setBlocked(true); setRequests([]); setSelected(null); setPlanning(false); setMessage("Current owner access could not be verified. Reopen this view after checking your workspace."); return; }
    if (result.kind === "invalid" || result.kind === "held") {
      setMessage(result.kind === "invalid" ? "Check the responsibility name, day, time and business time zone. Your proposal is still editable; no save was verified." : "Saving weekly drafts is currently held by your workspace permissions. No responsibility has been registered."); return;
    }
    if (result.kind === "unavailable" || result.kind === "unconfirmed") {
      setUnavailable(true); setUnconfirmed(previous => result.kind === "unconfirmed" || previous);
      setMessage(result.kind === "unconfirmed" ? "The response could not be verified. Read the original saved status before trying any action again." : "Draft status is unavailable. Your proposal has not been reported as saved."); return;
    }
    setMessage(""); setUnconfirmed(false);
    if (result.kind === "pending") { setRequests(result.requests); setHasMore(result.hasMore); setSelected(result.requests[0] ?? null); return; }
    if (result.kind !== "state") return;
    setSelected(result.state); setPlanning(false);
    setRequests(previous => [result.state, ...previous.filter(r => r.confirmationId !== result.state.confirmationId)]);
    if (result.state.phase === "saved" || result.state.phase === "changed") onSaved();
  };
  const command = async (request: WeeklyDraftRequest) => {
    if (flight.current || !scope.current) return;
    flight.current = true; const captured = scope.current, ownTicket = ++ticket.current;
    setBusy(true); setMessage("");
    const result = await requestWeeklyDraft(captured, supabase as unknown as Parameters<typeof requestWeeklyDraft>[1], current, request);
    if (ownTicket !== ticket.current || !current()) return;
    flight.current = false; adopt(result);
  };
  useEffect(() => {
    scope.current = { actorId: actor, tenantId: tenant, epoch: (scope.current?.epoch ?? 0) + 1 };
    void command({ action: "pending" });
    const { data } = supabase.auth.onAuthStateChange(event => {
      if (["SIGNED_IN", "SIGNED_OUT", "USER_UPDATED"].includes(event)) {
        ticket.current++; flight.current = false; scope.current = null;
        setBlocked(true); setRequests([]); setSelected(null); setPlanning(false); setBusy(false); setLoading(false);
        setMessage("Your session changed. Reopen this view to verify current owner access.");
      }
    });
    // This is an async generation counter, not a captured DOM reference: invalidate its current value.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    return () => { scope.current = null; ticket.current++; flight.current = false; data.subscription.unsubscribe(); };
    // The scope-keyed parent remounts on audience change. Never reissue on an object/callback render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [actor, tenant]);
  return <section className="e5-weekly-draft-composer" aria-label="Prepare and retrieve weekly drafts">
    {loading && <p role="status">Reading saved weekly proposals…</p>}
    {message && <p role="alert">{message}</p>}
    {!loading && !selected && <button type="button" onClick={() => void command({ action: "pending" })} disabled={busy || blocked}>Read saved proposals</button>}
    {requests.length > 1 && <label className="e5-weekly-draft-selector">Saved proposal<select disabled={busy} value={selected?.confirmationId ?? ""} onChange={e => {
      const value = requests.find(r => r.confirmationId === e.target.value); if (value) { setSelected(value); setPlanning(false); setUnavailable(true); setUnconfirmed(false); setMessage("Read this proposal’s current status before approving."); }
    }}>{requests.map(r => <option key={r.confirmationId} value={r.confirmationId}>{r.draft.name} · {r.phase.replace(/_/g, " ")}</option>)}</select></label>}
    {selected && <WeeklyDraftReview state={selected} busy={busy} unconfirmed={unconfirmed} unavailable={unavailable}
      onApprove={tokens => void command({ action: "commit", confirmation_id: selected.confirmationId, approvedConfirmations: tokens })}
      onDecline={tokens => void command({ action: "decline", confirmation_id: selected.confirmationId, declinedConfirmations: tokens })}
      onReadback={() => void command({ action: "status", confirmation_id: selected.confirmationId })} />}
    {hasMore && <p>Showing the latest 10 proposals. Calendar reads registered responsibilities separately.</p>}
    {planning ? <WeeklyDraftForm businessZone={businessZone} busy={busy} onPrepare={draft => void command({ action: "prepare", draft })} onCancel={() => setPlanning(false)} />
      : <button type="button" className="e5-weekly-primary" disabled={busy || loading || blocked || unconfirmed || selected?.phase === "unknown"}
        onClick={() => setPlanning(true)}>{selected ? "Prepare another responsibility" : "Prepare a weekly responsibility"}</button>}
  </section>;
}
