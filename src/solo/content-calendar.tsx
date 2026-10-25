// EXP07 row 8 — the content calendar: a dated, channel-specific PLAN for the workspace's content.
// It shows what should ship, where and when, from which saved piece — and it is a plan and nothing
// more: nothing here posts, sends, queues or schedules. Authorized scheduling (when it exists)
// belongs to EXP05's consequential-execution world and would consume this plan under its own
// approvals. The boundary is written on the surface, not just in the docs (§ scope-honesty rule).
//
// PLAN vs SCHEDULING, in the data: an entry is one row in content_plan_entries with a tz-aware
// planned_for instant, a channel, an optional link to a saved piece, and a plan status
// (planned/ready/cancelled). There is no execution state, no queue, no provider field, and no
// operation here creates anything but the next edit of the same row — cancel is a status, so an
// edited or cancelled plan can never duplicate a scheduled post (there is nothing to duplicate).
import React from "react";
import { useTenantRead, useLibraryAccess, AskPaigeButton, LIBRARY_DENIED, Frame, type Phase } from "./marketing-planned";
import { listPlanEntries, upsertPlanEntry, readAllPieces, planChannelLabel, PLAN_CHANNELS, type PlanEntry, type PlanChannel, type PlanStatus } from "./content-plan-data";
import { shortTitle } from "./marketing-content-model";
import "./marketing-overview.css";
import "./content-calendar.css";

const ASK_PROMPT = "Look at my saved content and help me plan the next two weeks: what should ship, on which channel, on which days. Ask me about my goals first. This is planning only — do not post, send or schedule anything.";

const dayFmt = new Intl.DateTimeFormat(undefined, { weekday: "long", month: "long", day: "numeric" });
const timeFmt = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });
const tzLabel = Intl.DateTimeFormat().resolvedOptions().timeZone || "your time zone";

const STATUS_LABEL: Record<PlanStatus, string> = { planned: "Planned", ready: "Ready to schedule", cancelled: "Cancelled" };

const toLocalInput = (iso: string): string => {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

type Draft = { id: string | null; contentId: string; channel: PlanChannel; when: string; note: string; status: Exclude<PlanStatus, "cancelled"> };

const emptyDraft = (): Draft => ({ id: null, contentId: "", channel: "social_post", when: "", note: "", status: "planned" });

export function ContentCalendar({ tenantId, onOpenPiece }: { tenantId: string | null; onOpenPiece: (id: string) => void }) {
  const access = useLibraryAccess();
  const plan = useTenantRead(tenantId, [] as PlanEntry[], listPlanEntries);
  const pieces = useTenantRead(tenantId, [], access === "allowed" ? readAllPieces : null);
  const phase: Phase = access === "checking" || plan.phase === "loading" ? "loading" : plan.phase;
  const entries = plan.rows;
  const [draft, setDraft] = React.useState<Draft | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const pieceTitle = (id: string | null): { text: string; gone: boolean } => {
    if (!id) return { text: "", gone: false };
    const piece = pieces.rows.find((p) => p.id === id);
    return piece ? { text: shortTitle(piece.title, 90).text, gone: false } : { text: "The linked piece is no longer in your library", gone: true };
  };

  // Entries grouped by their LOCAL day, soonest first — the plan reads as "what ships this week".
  const groups = React.useMemo(() => {
    const byDay = new Map<string, PlanEntry[]>();
    for (const e of entries) {
      const key = dayFmt.format(new Date(e.plannedFor));
      const list = byDay.get(key) ?? [];
      list.push(e);
      byDay.set(key, list);
    }
    return [...byDay.entries()];
  }, [entries]);

  const save = async () => {
    if (!draft || saving) return;
    if (!draft.when) { setError("Choose when this should ship."); return; }
    setSaving(true); setError(null);
    try {
      await upsertPlanEntry({
        id: draft.id, contentId: draft.contentId || null, channel: draft.channel,
        plannedFor: new Date(draft.when).toISOString(), note: draft.note.trim() || null, status: draft.status,
      });
      setDraft(null);
      plan.retry();
    } catch (e) {
      setError(e instanceof Error && /CONTENT_FORBIDDEN/.test(e.message) ? "Only this workspace's owner or an admin can change the plan." : "The plan change didn't save. Try again.");
    } finally { setSaving(false); }
  };

  const setStatus = async (entry: PlanEntry, status: PlanStatus) => {
    if (saving) return;
    setSaving(true); setError(null);
    try {
      await upsertPlanEntry({ id: entry.id, contentId: entry.contentId, channel: entry.channel, plannedFor: entry.plannedFor, note: entry.note, status });
      plan.retry();
    } catch (e) {
      setError(e instanceof Error && /CONTENT_FORBIDDEN/.test(e.message) ? "Only this workspace's owner or an admin can change the plan." : "The plan change didn't save. Try again.");
    } finally { setSaving(false); }
  };

  const edit = (e: PlanEntry) => setDraft({ id: e.id, contentId: e.contentId ?? "", channel: e.channel, when: toLocalInput(e.plannedFor), note: e.note ?? "", status: e.status === "ready" ? "ready" : "planned" });

  return <div className="mov cpc">
    <div className="mov-top">
      <p className="mov-sum" tabIndex={-1}>
        {phase === "loading" ? <>Reading your plan…</>
          : phase === "error" ? <>Your plan could not load.</>
          : entries.length === 0 ? <>Nothing planned yet. Say what should ship, where and when.</>
          : <><b>{entries.filter((e) => e.status !== "cancelled").length} {entries.filter((e) => e.status !== "cancelled").length === 1 ? "entry" : "entries"} planned</b>{entries.some((e) => e.status === "ready") ? `, ${entries.filter((e) => e.status === "ready").length} ready to schedule` : ""}{entries.some((e) => e.status === "cancelled") ? `, ${entries.filter((e) => e.status === "cancelled").length} cancelled` : ""}.</>}
      </p>
      <div className="mov-acts">
        <AskPaigeButton label="Ask PAIGE to plan" prompt={ASK_PROMPT}/>
        <button type="button" className="btn btn-s btn-p" disabled={access === "denied"} onClick={() => { setDraft(emptyDraft()); setError(null); }}>Add a plan entry</button>
      </div>
    </div>
    <p className="cpc-boundary">This is your plan — nothing here posts or schedules by itself. Times are shown in <b>{tzLabel}</b>; exact send times are set only if and when scheduling is connected.</p>
    {error && <p className="cpc-alert" role="alert">{error}</p>}

    {draft && (
      <form className="cpc-form" aria-label={draft.id ? "Edit plan entry" : "New plan entry"} onSubmit={(e) => { e.preventDefault(); void save(); }}>
        <label>Ships on
          <input type="datetime-local" value={draft.when} onChange={(e) => setDraft((d) => d ? { ...d, when: e.target.value } : d)} required/>
        </label>
        <label>Channel
          <select value={draft.channel} onChange={(e) => setDraft((d) => d ? { ...d, channel: e.target.value as PlanChannel } : d)}>
            {PLAN_CHANNELS.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
          </select>
        </label>
        <label>From a saved piece <small>(optional)</small>
          <select value={draft.contentId} onChange={(e) => setDraft((d) => d ? { ...d, contentId: e.target.value } : d)}>
            <option value="">— none —</option>
            {pieces.rows.map((p) => <option key={p.id} value={p.id}>{shortTitle(p.title, 60).text}</option>)}
          </select>
        </label>
        <label>Note <small>(optional)</small>
          <input type="text" value={draft.note} placeholder="e.g. Tie this to the workshop launch" onChange={(e) => setDraft((d) => d ? { ...d, note: e.target.value } : d)}/>
        </label>
        <label>Plan status
          <select value={draft.status} onChange={(e) => setDraft((d) => d ? { ...d, status: e.target.value === "ready" ? "ready" : "planned" } : d)}>
            <option value="planned">Planned</option>
            <option value="ready">Ready to schedule</option>
          </select>
        </label>
        <div className="cpc-form-acts">
          <button type="submit" className="btn btn-s btn-p" disabled={saving}>{saving ? "Saving…" : draft.id ? "Save changes" : "Add to plan"}</button>
          <button type="button" className="btn btn-s" onClick={() => setDraft(null)}>Done</button>
        </div>
      </form>
    )}

    <Frame phase={phase} retry={plan.retry} noun="plan">
      {access === "denied" ? <p className="cpc-note">{LIBRARY_DENIED}</p> : entries.length === 0 && !draft ? (
        <p className="cpc-note">Plan the next two weeks: which saved piece ships, on which channel, on which day. PAIGE can draft the plan with you — ask her above.</p>
      ) : groups.map(([day, dayEntries]) => (
        <section className="cpc-day" key={day}>
          <h3>{day}</h3>
          <ul>
            {dayEntries.map((e) => {
              const link = pieceTitle(e.contentId);
              return <li key={e.id} className="cpc-entry" data-status={e.status}>
                <span className="cpc-time">{timeFmt.format(new Date(e.plannedFor))}</span>
                <span className="cpc-channel">{planChannelLabel(e.channel)}</span>
                <span className="cpc-what">
                  {e.contentId ? (link.gone ? <em className="cpc-gone">{link.text}</em> : <button type="button" className="cpc-link" onClick={() => onOpenPiece(e.contentId!)}>{link.text}</button>) : <em>{e.note ?? "Unspecified piece"}</em>}
                  {e.contentId && e.note ? <small>{e.note}</small> : null}
                </span>
                <span className="cpc-status" data-status={e.status}>{STATUS_LABEL[e.status]}</span>
                <span className="cpc-acts">
                  <button type="button" className="cpc-act" disabled={saving} onClick={() => edit(e)}>Edit</button>
                  {e.status === "cancelled"
                    ? <button type="button" className="cpc-act" disabled={saving} onClick={() => void setStatus(e, "planned")}>Restore</button>
                    : <button type="button" className="cpc-act" disabled={saving} onClick={() => void setStatus(e, "cancelled")}>Cancel</button>}
                </span>
              </li>;
            })}
          </ul>
        </section>
      ))}
    </Frame>
  </div>;
}
