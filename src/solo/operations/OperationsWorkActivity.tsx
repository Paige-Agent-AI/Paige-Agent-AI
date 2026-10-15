import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { TeamMemberRecord } from "@/solo/team-workspace-contract";
import { OperationsAssignee } from "./OperationsAssignee";
import { workStatusLabel } from "./operations-presentation";

type Activity = { recorded_at: string; action: string; actor_id: string | null; status: string | null };
const LABELS: Record<string, string> = { plan_assign_task: "Task created", plan_add_milestone: "Milestone created",
  plan_set_reminder: "Reminder created", plan_update_item: "Work updated", plan_remove_item: "Work removed" };
export function OperationsWorkActivity({ actorId, tenantId, itemId, members, version }: {
  actorId: string; tenantId: string; itemId: string; members: TeamMemberRecord[]; version?: string;
}) {
  const [events, setEvents] = useState<Activity[]>([]); const [phase, setPhase] = useState<"loading" | "ready" | "unavailable">("loading");
  const [retry, setRetry] = useState(0); const seq = useRef(0);
  useEffect(() => {
    const request = ++seq.current; setEvents([]); setPhase("loading");
    void (async () => {
      try {
        const before = await supabase.auth.getSession();
        if (before.error || before.data.session?.user.id !== actorId) throw new Error("scope");
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- bounded scoped read awaits generated schema types
        const { data, error } = await (supabase as any).rpc("plan_item_activity_scoped", {
          p_item_id: itemId, p_expected_actor_id: actorId, p_expected_tenant_id: tenantId,
        });
        const after = await supabase.auth.getSession();
        if (request !== seq.current) return;
        if (error || after.error || after.data.session?.user.id !== actorId || data?.ok !== true
          || data.item_id !== itemId || data.tenant_id !== tenantId || data.actor_id !== actorId || !Array.isArray(data.events)
          || data.events.length > 25 || data.events.some((event: Activity) => !event || !LABELS[event.action]
            || !Number.isFinite(Date.parse(event.recorded_at)) || (event.actor_id !== null && typeof event.actor_id !== "string")
            || (event.status !== null && !["open", "in_progress", "blocked", "done", "cancelled"].includes(event.status)))) throw new Error("read");
        setEvents(data.events); setPhase("ready");
      } catch { if (request === seq.current) setPhase("unavailable"); }
    })();
    return () => { seq.current += 1; };
  }, [actorId, tenantId, itemId, version, retry]);
  return <section className="ops-work-activity" aria-label="Recorded work activity"><h2>Activity</h2>
    {phase === "loading" ? <p role="status">Loading recorded changes…</p> : phase === "unavailable" ? <p role="status">Activity couldn’t be read. <button type="button" onClick={() => setRetry(value => value + 1)}>Retry activity</button></p>
      : events.length ? <><ol>{events.map((event, index) => {
        const person = members.find(member => member.user_id === event.actor_id);
        return <li key={`${event.recorded_at}:${index}`}><strong>{LABELS[event.action]}{event.status ? ` · ${workStatusLabel(event.status)}` : ""}</strong>
          <time dateTime={event.recorded_at}>{new Date(event.recorded_at).toLocaleString()}</time>
          {person ? <OperationsAssignee member={person} /> : <span>Recorded actor unavailable</span>}</li>;
      })}</ol><p>Recent recorded activity. Older updates may omit the changed fields.</p></> : <p>No activity is recorded for this work.</p>}
  </section>;
}
