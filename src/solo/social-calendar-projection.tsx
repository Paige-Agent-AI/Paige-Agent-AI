import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import type { WorkspaceLinkTenant } from "@/lib/links/workspaceLinks";
import { socialPublicationTarget, type SocialPublicationReference } from "./social-publication-reference";
import { readSocialSchedule, storedSocialSchedule, socialScheduleLabel, type SocialSchedule } from "../../supabase/functions/_shared/social-publish-command/schedule";
import { readSocialPublicationReference } from "./social-publication-reference";

const object = (x: unknown): Record<string, unknown> | null => x && typeof x === "object" && !Array.isArray(x) ? x as Record<string, unknown> : null;
export type SocialCalendarItem = { reference: SocialPublicationReference; schedule: SocialSchedule; alternate?: SocialSchedule; destination: string; status: string };
/** Projection only: no calendar/booking row, capacity reservation or provider call. */
export function socialCalendarItems(tenantId: string, values: unknown, from: number, until: number): SocialCalendarItem[] {
  if (!Array.isArray(values)) throw Error("Marketing schedules could not be read.");
  const result: SocialCalendarItem[] = [];
  for (const value of values) {
    const row = object(value);
    if (!row || row.tenant_id !== tenantId) throw Error("Marketing schedule workspace changed.");
    if (!["scheduled", "schedule_changing", "outcome_unknown"].includes(String(row.status))) continue;
    const args = object(row.request_args), saved = object(object(row.provider_response)?.schedule);
    const schedule = readSocialSchedule(saved?.current) ?? storedSocialSchedule(args?.schedule);
    if (!schedule) continue; // An immediate or redacted receipt is never a calendar schedule.
    const reference = readSocialPublicationReference({ schema: 1, tenant_id: tenantId, content_id: row.content_id, content_revision: args?.content_revision, publication_id: row.id });
    if (!reference) throw Error("Marketing schedule identity could not be verified.");
    const instant = Date.parse(schedule.scheduled_for);
    const mutation=object(saved?.mutation),previous=readSocialSchedule(mutation?.previous_schedule),requested=readSocialSchedule(mutation?.next_schedule);
    const alternate=row.status!=="scheduled"?[previous,requested].find(value=>value&&value.scheduled_for!==schedule.scheduled_for):undefined;
    const alternateInstant=alternate?Date.parse(alternate.scheduled_for):NaN;
    if ((instant < from || instant >= until) && !(alternateInstant>=from&&alternateInstant<until)) continue;
    result.push({ reference, schedule, ...(alternate?{alternate}:{}),destination: typeof args?.channel_label === "string" ? args.channel_label : "Recorded destination", status: String(row.status) });
  }
  return result.sort((a, b) => Date.parse(a.schedule.scheduled_for) - Date.parse(b.schedule.scheduled_for));
}

export function SocialCalendarProjection({ tenantId, actorId, account, from, until }: {
  tenantId: string; actorId: string | null; account: WorkspaceLinkTenant | null; from: Date; until: Date;
}) {
  const [open, setOpen] = useState(false), [attempt, retry] = useState(0);
  const [read, setRead] = useState<{ identity: string; phase: "loading" | "ready" | "error" | "permission"; items: SocialCalendarItem[] }>({ identity: "", phase: "loading", items: [] });
  const start = from.getTime(), end = until.getTime(), identity = `${actorId}:${tenantId}:${start}:${end}`;
  useEffect(() => {
    if (!open) return;
    let live = true, busy = false;
    const load = async () => {
      if (busy || document.hidden || navigator.onLine === false) return;
      busy = true;
      setRead({ identity, phase: "loading", items: [] });
      try {
        const user = await supabase.auth.getUser();
        if (!actorId || user.error || user.data.user?.id !== actorId) throw Error("Session changed.");
        const permission = await supabase.rpc("is_tenant_admin", { _tenant: tenantId });
        if (permission.error) throw permission.error;
        if (permission.data !== true) { if (live) setRead({ identity, phase: "permission", items: [] }); return; }
        const rows = await supabase.rpc("content_publication_list" as never, { p_content_id: null, p_tenant_id: tenantId } as never);
        if (rows.error) throw rows.error;
        const items = socialCalendarItems(tenantId, rows.data, start, end);
        const current = await supabase.auth.getUser();
        if (current.error || current.data.user?.id !== actorId) throw Error("Session changed.");
        if (live) setRead({ identity, phase: "ready", items });
      } catch { if (live) setRead({ identity, phase: "error", items: [] }); }
      finally { busy = false; }
    };
    const resume = () => { void load(); };
    void load();
    window.addEventListener("focus", resume);
    window.addEventListener("online", resume);
    document.addEventListener("visibilitychange", resume);
    return () => { live = false; window.removeEventListener("focus", resume); window.removeEventListener("online", resume); document.removeEventListener("visibilitychange", resume); };
  }, [actorId, tenantId, identity, start, end, open, attempt]);
  const shown = read.identity === identity ? read : { phase: "loading", items: [] };
  return <details className="sc-marketing" open={open} onToggle={event => setOpen(event.currentTarget.open)}>
    <summary><span aria-hidden="true">{open?"−":"+"}</span>Marketing schedules <span>Optional view</span></summary>
    {open && <div className="sc-marketing-body">
      <p>Post schedules for this range. Appointments and availability stay separate.</p>
      {shown.phase === "loading" ? <p role="status">Reading original schedules…</p>
        : shown.phase === "permission" ? <p>Marketing schedules are available to the workspace owner and admins.</p>
        : shown.phase === "error" ? <p role="status">Marketing schedules could not be verified. <button className="sc-btn" onClick={() => retry(n => n + 1)}>Retry</button></p>
        : !shown.items.length ? <p>No recorded Marketing schedules in this range.</p>
        : <ul>{shown.items.map(item => {
          const href = socialPublicationTarget(item.reference, tenantId, account);
          return <li key={item.reference.publication_id}><div><time dateTime={item.schedule.scheduled_for}>{socialScheduleLabel(item.schedule)}</time><span>{item.destination} · {item.status === "scheduled" ? "Scheduled at provider" : "Needs original receipt check"}</span>{item.alternate&&<span>Unconfirmed time change: {socialScheduleLabel(item.alternate)}. Either time may still apply.</span>}</div>{href && <Link to={href}>Open post</Link>}</li>;
        })}</ul>}
      <small>These are the original receipts. Open a post to verify its latest provider result or change its schedule.</small>
    </div>}
  </details>;
}
