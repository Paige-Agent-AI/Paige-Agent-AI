import { useRef, useState } from "react";
import { Plus, RefreshCw } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { supabase } from "@/integrations/supabase/client";
import { useTenantContext } from "@/hooks/useTenantContext";
import { usePlanList } from "@/hooks/usePlanList";
import {
  shareableWorkItem,
  useClientEngagementStatus,
  type ShareableWorkItem,
} from "@/solo/engagement/useClientEngagementStatus";
import { OperationsWorkCreator } from "@/solo/operations/OperationsWorkCreator";
import { useOperationsPeople } from "@/solo/operations/useOperationsPeople";
import { workStatusLabel } from "@/solo/operations/operations-presentation";
import {
  isProgressPastDue,
  progressDayKey,
  progressDayLabel,
  viewerTimeZone,
  type PortalProgressState,
} from "@/hooks/useClientPortalProgress";
import type { ClientEngagementStatus, SourceWorkItem } from "../../../supabase/functions/_shared/client-engagement/status";
import "@/solo/operations/operations-workspace.css";
import "./client-shared-work.css";

/**
 * E09 Slice 3 — "Shared with {client}", directly under "Where {client} stands" on the Solo client
 * record. The owner chooses, one item at a time, which of this client's milestones and tasks appear in
 * the client's portal (owner decision D2: sharing is always an explicit act, new work is private).
 *
 * The list is the SAME governed read the standing section and PAIGE use (read_client_engagement_status
 * → status.ts), so there is no second read path. The one writer is plan_item_set_client_share, sent
 * with the row version the owner is looking at; a share is reported only once a fresh read of that
 * same status shows the item in the asked state (§70.1) — an acknowledgement alone is not success.
 * Nothing here is an act of approval, so no gold: the switch is the record's indigo.
 */
type Props = { contactId: string; clientName: string; portalConnected: boolean };
type Note = { tone: "ok" | "warn" | "bad"; text: string };
type Filter = "all" | "shared" | "private";

/** How the owner refers to the client in a sentence about them: the first word of their name. */
function clientFirstName(name: string): string {
  return name.trim().split(/\s+/)[0] || name;
}

/**
 * The client's own words for an item's state — the SAME mapping the customer read projects
 * (20271110030000, read_customer_portal_progress: done → done, open → not_started, anything else
 * that is visible → in_progress; blocked reads as In progress, owner decision D3).
 */
function clientStateOf(status: string): PortalProgressState {
  return status === "done" ? "done" : status === "open" ? "not_started" : "in_progress";
}
const CLIENT_STATE_LABEL: Record<PortalProgressState, string> = { not_started: "Not started", in_progress: "In progress", done: "Done" };

/**
 * What the client's Progress page says about this item, as one line: their state word, then the
 * date the way their page writes it ("Due Mon, Oct 26", "Due today", "Finished Sat, Oct 10"), then
 * "Past due" when it is. Their page reads dates in their own zone, which the business can't know;
 * the business zone is the nearest honest stand-in, and the owner's own zone only when it isn't set.
 */
function clientSeesParts(item: SourceWorkItem, s: ClientEngagementStatus): string[] {
  const state = clientStateOf(item.status);
  const tz = s.time_zone.state === "configured" && s.time_zone.zone ? s.time_zone.zone : viewerTimeZone();
  const readAt = Date.parse(s.read_at);
  const nowMs = Number.isFinite(readAt) ? readAt : Date.now();
  const parts = [CLIENT_STATE_LABEL[state]];
  if (state === "done") {
    if (item.completed_at && Number.isFinite(Date.parse(item.completed_at))) parts.push(`Finished ${progressDayLabel(item.completed_at, tz, nowMs)}`);
  } else if (!item.due_at || !Number.isFinite(Date.parse(item.due_at))) {
    parts.push("No due date");
  } else {
    const due = Date.parse(item.due_at);
    // The same words, in the same order, as the client's own page (Progress DueLine):
    // "Past due · Sat, Oct 10", "Due today", "Due Mon, Oct 26".
    if (isProgressPastDue({ id: item.id, kind: item.item_type === "milestone" ? "milestone" : "task", title: "", state, due_at: item.due_at,
      completed_at: null, shared_at: "", parent_id: null }, nowMs)) parts.push("Past due", progressDayLabel(item.due_at, tz, nowMs));
    else parts.push(progressDayKey(due, tz) === progressDayKey(nowMs, tz) ? "Due today" : `Due ${progressDayLabel(item.due_at, tz, nowMs)}`);
  }
  return parts;
}

/** What a business date reads as. A timestamp is a business date only in the business's own zone. */
function dueLabel(value: string | null, s: ClientEngagementStatus): string {
  if (!value) return "No due date";
  const at = Date.parse(value);
  if (!Number.isFinite(at)) return "Due date unreadable";
  if (s.time_zone.state !== "configured" || !s.time_zone.zone) return "Due date not shown until the business time zone is set";
  return `Due ${new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: s.time_zone.zone }).format(at)}`;
}

/** The server's named refusals, in the owner's words. The internal code never reaches the screen. */
function refusalNote(code: unknown, name: string): { text: string; reread: boolean } {
  switch (code) {
    case "ITEM_CHANGED": return { text: "This item changed. Check it and share again.", reread: true };
    case "CLIENT_SHARE_UNAVAILABLE": return { text: "Sharing work with clients isn’t available for this account.", reread: false };
    case "ITEM_NOT_FOUND": return { text: "This item is no longer in your work.", reread: true };
    case "ITEM_NOT_CLIENT_LINKED": return { text: `This item is no longer linked to ${name}.`, reread: true };
    case "ITEM_NOT_SHAREABLE": return { text: "Cancelled work can’t be shared.", reread: true };
    case "CONTACT_NOT_FOUND": return { text: `${name}’s record isn’t active, so nothing can be shared with them.`, reread: false };
    default: return { text: "That change wasn’t made. Check the list and try again.", reread: true };
  }
}

export function ClientSharedWork({ contactId, clientName, portalConnected }: Props) {
  const read = useClientEngagementStatus(contactId);
  const { activeTenantId, activeUserId } = useTenantContext();
  const [pending, setPending] = useState<Record<string, boolean>>({});
  const [notes, setNotes] = useState<Record<string, Note>>({});
  const [connected, setConnected] = useState(portalConnected);
  const [creating, setCreating] = useState(false);
  const [filter, setFilter] = useState<Filter>("all");
  const first = clientFirstName(clientName);
  const invoker = useRef<HTMLButtonElement | null>(null);
  const section = useRef<HTMLElement | null>(null);
  const last = useRef<{ contactId: string; status: ClientEngagementStatus } | null>(null);
  if (read.phase === "ready") last.current = { contactId, status: read.status };
  const busy = read.phase === "loading" || read.phase === "idle";
  const shown = read.phase === "ready" ? read.status : busy && last.current?.contactId === contactId ? last.current.status : null;
  const items = shown?.work.items ?? [];
  // Cancelled work is never in the client's view, so it is not counted as shareable.
  const live = items.filter(item => item.status !== "cancelled");
  const sharedCount = live.filter(item => item.shared === true).length;
  const privateCount = live.length - sharedCount;
  const listed = filter === "all" ? items
    : live.filter(item => (item.shared === true) === (filter === "shared"));
  const theme = section.current?.closest<HTMLElement>("[data-pg]")?.getAttribute("data-pg") ?? "dark";

  const note = (id: string, value: Note | null) => setNotes(current => {
    const next = { ...current };
    if (value) next[id] = value; else delete next[id];
    return next;
  });

  /** Re-reads after a refusal so the row shows what is true now. A failed re-read is said, not hidden. */
  const recheck = async () => { try { await read.reload(); return true; } catch { return false; } };

  const share = async (item: ShareableWorkItem, next: boolean) => {
    if (pending[item.id]) return;
    setPending(current => ({ ...current, [item.id]: next }));
    note(item.id, null);
    try {
      const session = await supabase.auth.getSession();
      const actorId = session.data.session?.user.id ?? null;
      // The actor is the signed-in session; the workspace is the one this record was read for.
      if (session.error || !actorId || !activeTenantId || (activeUserId && actorId !== activeUserId)) {
        note(item.id, { tone: "bad", text: "Your account changed. Reopen this client in your current workspace." });
        return;
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- scoped RPC awaits generated schema types
      const { data, error } = await (supabase as any).rpc("plan_item_set_client_share", {
        p_expected_actor_id: actorId, p_expected_tenant_id: activeTenantId, p_item_id: item.id,
        p_shared: next, p_expected_updated_at: item.updated_at,
      });
      if (error) {
        note(item.id, (error as { code?: string }).code === "42501"
          ? { tone: "bad", text: "Your workspace or role changed. Reopen this client to share work." }
          : { tone: "bad", text: "We couldn’t confirm whether that changed. Refresh before trying again." });
        await recheck();
        return;
      }
      if (!data || data.ok !== true) {
        const refusal = refusalNote(data?.error, clientName);
        const reread = refusal.reread ? await recheck() : true;
        note(item.id, { tone: "warn", text: reread ? refusal.text : `${refusal.text} Use Refresh to see what’s current.` });
        return;
      }
      const joined = typeof data.portal_connected === "boolean" ? data.portal_connected : connected;
      if (typeof data.portal_connected === "boolean") setConnected(data.portal_connected);
      // Success is what a fresh read says, not what the writer acknowledged (§70.1).
      let fresh: ClientEngagementStatus;
      try { fresh = await read.reload(); } catch {
        note(item.id, { tone: "bad", text: "The change couldn’t be confirmed. Use Refresh before changing it again." });
        return;
      }
      const now = fresh.work.items.find(row => row.id === item.id);
      if (now?.shared === next) {
        note(item.id, { tone: "ok", text: !next ? `No longer shared with ${clientName}.`
          : joined ? `Shared. ${clientName} can see this in their portal.` : `Shared. ${first} will see this once they join your portal.` });
      } else {
        note(item.id, { tone: "bad", text: "The change couldn’t be confirmed. Use Refresh before changing it again." });
      }
    } catch {
      note(item.id, { tone: "bad", text: "We couldn’t confirm whether that changed. Refresh before trying again." });
    } finally {
      setPending(current => { const rest = { ...current }; delete rest[item.id]; return rest; });
    }
  };

  const addWork = (where: "head" | "empty") => (
    <button type="button" className="trc-shared-add" data-where={where} onClick={event => { invoker.current = event.currentTarget; setCreating(true); }}>
      <Plus aria-hidden />Add work for {clientName}
    </button>
  );

  return (
    <section ref={section} id="client-shared-work" className="trc-record-section trc-shared" aria-labelledby="trc-shared-title" aria-busy={busy || undefined}>
      <div className="trc-shared-head">
        <div className="trc-shared-heading">
          <h3 id="trc-shared-title">Shared with {clientName}</h3>
          <p>{clientName} sees only what you share here: title, status and due date. Notes, priority and who it’s assigned to stay private.</p>
        </div>
        <div className="trc-shared-meta">
          {shown && live.length > 0 && (
            <div className="trc-shared-filter" role="group" aria-label={`Show work ${first} can or can’t see`}>
              <FilterButton value="shared" label="Shared" count={sharedCount} filter={filter} onChange={setFilter} />
              <span aria-hidden="true">·</span>
              <FilterButton value="private" label="Private" count={privateCount} filter={filter} onChange={setFilter} />
            </div>
          )}
          <span className="sr-only" role="status">{busy && shown ? "Checking again…" : ""}</span>
          {read.phase !== "refused" && read.phase !== "no_workspace" && read.phase !== "error" && (
            <button type="button" className="trc-shared-refresh" onClick={() => { if (!busy) read.retry(); }} aria-disabled={busy || undefined}><RefreshCw aria-hidden />{busy && shown ? "Refreshing…" : "Refresh"}</button>
          )}
        </div>
      </div>

      {!connected && read.phase !== "refused" && read.phase !== "no_workspace" && (
        <p className="trc-shared-connect" role="note">{clientName} hasn’t joined your portal yet; shared items appear when they do.</p>
      )}

      <div className="trc-shared-content">
        {busy && !shown && (
          <>
            <span className="sr-only" role="status">Checking what {clientName} can see…</span>
            <ul className="trc-shared-rows" aria-hidden="true">
              {[0, 1, 2].map(i => <li key={i} className="trc-shared-row trc-shared-skeleton"><b /><b /><i /></li>)}
            </ul>
          </>
        )}
        {read.phase === "refused" && <p className="trc-shared-state" role="status">Only the business owner or an admin can choose what {clientName} sees in their portal.</p>}
        {read.phase === "no_workspace" && <p className="trc-shared-state" role="status">Open a business workspace to share work with this client.</p>}
        {read.phase === "error" && (
          <div className="trc-shared-state" role="alert">
            <p>We couldn’t check what {clientName} can see. Nothing has been shared or unshared.</p>
            <button type="button" className="trc-shared-quiet" onClick={read.retry}><RefreshCw aria-hidden />Try again</button>
          </div>
        )}
        {shown && items.length === 0 && (
          <div className="trc-shared-empty">
            <p><strong>No work is linked to {clientName} yet.</strong></p>
            <p>Add a task for {clientName}. It stays private until you share it here.</p>
            {addWork("empty")}
          </div>
        )}
        {shown && items.length > 0 && (
          <>
            {listed.length > 0 ? (
              <ul className="trc-shared-rows">
                {listed.map(item => <Row key={item.id} item={item} s={shown} name={clientName} first={first} pending={pending[item.id]} note={notes[item.id]} onShare={share} />)}
              </ul>
            ) : (
              <p className="trc-shared-state" role="status">
                {filter === "shared" ? `Nothing is shared with ${first} yet.` : `Everything open is shared with ${first}.`}
              </p>
            )}
            <div className="trc-shared-foot">
              {shown.truncated.work && <p>Showing the first {items.length} items. Earlier finished work isn’t listed here.</p>}
              {addWork("head")}
            </div>
          </>
        )}
      </div>

      {creating && activeTenantId && activeUserId && (
        <ClientWorkCreator actorId={activeUserId} tenantId={activeTenantId} theme={theme} invoker={invoker.current}
          contact={{ id: contactId, name: clientName, firstName: first }} onClose={() => setCreating(false)}
          refresh={async () => { await read.reload(); }} />
      )}
    </section>
  );
}

/** One half of the "Shared N · Private M" filter: pressing it narrows the list; pressing it again shows all. */
function FilterButton({ value, label, count, filter, onChange }: {
  value: Exclude<Filter, "all">; label: string; count: number; filter: Filter; onChange: (next: Filter) => void;
}) {
  const on = filter === value;
  return (
    <button type="button" className="trc-shared-filter-btn" aria-pressed={on} onClick={() => onChange(on ? "all" : value)}>
      {label} <span className="trc-shared-count">{count}</span>
    </button>
  );
}

function Row({ item, s, name, first, pending, note, onShare }: {
  item: SourceWorkItem; s: ClientEngagementStatus; name: string; first: string; pending: boolean | undefined; note: Note | undefined;
  onShare: (item: ShareableWorkItem, next: boolean) => void;
}) {
  // Cancelled work is never in the client's view, and cancelling unshares it, so a later reopening
  // never puts it back in front of the client without a fresh, explicit share (D2). No switch.
  const shareable = shareableWorkItem(item);
  const cancelled = item.status === "cancelled";
  const label = `${item.title ?? "Untitled"}`;
  const facts = [item.item_type === "milestone" ? "Milestone" : "Task", workStatusLabel(item.status), dueLabel(item.due_at, s)];
  const checked = pending !== undefined ? pending : item.shared === true;
  const switchId = `trc-share-${item.id}`;
  return (
    <li className="trc-shared-row" data-shared={(!cancelled && item.shared === true) || undefined} aria-busy={pending !== undefined || undefined}>
      <div className="trc-shared-item">
        <strong>{label}</strong>
        <span>{facts.map((fact, i) => <span key={fact} className="trc-shared-fact">{i > 0 && " · "}<span className="trc-shared-nowrap">{fact}</span></span>)}</span>
        {!cancelled && item.shared === true && (
          <span className="trc-shared-quiet-line">{first} sees: {clientSeesParts(item, s).map((part, i) => (
            <span key={part}>{i > 0 && " · "}<span className="trc-shared-nowrap">{part}</span></span>
          ))}</span>
        )}
      </div>
      <div className="trc-shared-control">
        {shareable ? (
          <label className="trc-shared-toggle" htmlFor={switchId}>
            <span>{pending === true ? "Sharing…" : pending === false ? "Stopping…" : checked ? "Shared" : "Private"}</span>
            <Switch id={switchId} className="trc-shared-switch" checked={checked} disabled={pending !== undefined}
              aria-label={`Share ${label} with ${name}`} onCheckedChange={next => onShare(item, next)} />
          </label>
        ) : (
          <span className="trc-shared-private">{cancelled ? `Cancelled · hidden from ${first}` : "Can’t be shared yet"}</span>
        )}
      </div>
      {note && <p className="trc-shared-note" data-tone={note.tone} role={note.tone === "ok" ? "status" : "alert"}>{note.text}</p>}
    </li>
  );
}

/** The existing Operations creator, opened for this client. Its people and projects load only while it is open. */
function ClientWorkCreator({ actorId, tenantId, theme, invoker, contact, onClose, refresh }: {
  actorId: string; tenantId: string; theme: string; invoker: HTMLElement | null;
  contact: { id: string; name: string; firstName: string }; onClose: () => void; refresh: () => Promise<void>;
}) {
  const people = useOperationsPeople();
  const source = usePlanList({ scope: "team", tenantScopeKey: `${actorId}:${tenantId}`, operationsActorId: actorId, operationsTenantId: tenantId });
  if (people.loading) return <p className="trc-shared-state" role="status">Opening task creation…</p>;
  if (people.error) return (
    <div className="trc-shared-state" role="alert">
      <p>{people.error}</p>
      <button type="button" className="trc-shared-quiet" onClick={onClose}>Close</button>
    </div>
  );
  return (
    <OperationsWorkCreator actorId={actorId} tenantId={tenantId} members={people.members}
      plans={source.forbidden || source.error ? [] : source.plans} theme={theme} invoker={invoker} contact={contact}
      onClose={onClose} onCreated={refresh} onRecover={async () => { await refresh(); }} />
  );
}
