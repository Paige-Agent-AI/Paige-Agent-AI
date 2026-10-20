// One projection of canonical owner-only process status for Chat and Calendar.
// No booking identity, duration, recurrence calculation, Planning write or receipt writer.
export type BusinessTimeZone = { state: "configured" | "missing" | "invalid"; zone: string | null };
export type WeeklySchedule = { weekday: number; local_time: string; timezone: string };
export type WeeklyRunStatus = "scheduled" | "running" | "completed" | "failed" | "unknown" | "cancelled" | "needs_approval" | "held" | "refused" | "skipped";
/** Private owner presentation only. Never copied into model context or shared Rail. */
export type WeeklySourceItem = {
  id: string; kind: "task" | "milestone" | "reminder"; title: string;
  status: "open" | "in_progress" | "blocked"; priority: "low" | "normal" | "high" | "urgent"; due_at: string | null;
};
export type VerifiedWeeklyRun = {
  event_id: string; act_id: string; receipt_id: string; observed_at: string; scheduled_for: string;
  schedule_revision: number; status: "completed"; truncated: boolean;
  counts: { open: number; blocked: number; overdue: number; due_next_week: number; undated: number };
  source_items?: WeeklySourceItem[] | null;
};
export type WeeklyRun = { event_id: string; act_id: string | null; scheduled_for: string; status: WeeklyRunStatus };
export type WeeklyCheck = {
  automation_id: string; name: string; revision: number; schedule_status: "requested" | "scheduled" | "paused" | "cancelled";
  schedule: WeeklySchedule; execution_availability: "ready" | "held"; execution_hold_reason: string | null;
  next_run_at: string | null; intended_next_run_at: string | null;
  last_run: WeeklyRun | null; last_verified_run: VerifiedWeeklyRun | null;
};
export type WeeklyCommitmentSnapshot = {
  source: "canonical_process_and_act_receipts"; read_at: string; business_time_zone: BusinessTimeZone;
  limit: number; has_more: boolean; checks: WeeklyCheck[];
};
const record = (v: unknown): Record<string, unknown> | null =>
  v !== null && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : null;
const uuid = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(v);
const instant = (v: unknown): v is string => typeof v === "string" && v.length <= 40 &&
  /^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(v) && Number.isFinite(Date.parse(v));
const integer = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v >= 0;
export function parseWeeklySourceItems(raw: unknown): WeeklySourceItem[] | null {
  if (!Array.isArray(raw) || raw.length > 50) return null;
  const items: WeeklySourceItem[] = [], ids = new Set<string>();
  for (const value of raw) {
    const item = record(value);
    if (!item || !uuid(item.id) || ids.has(item.id) || !["task", "milestone", "reminder"].includes(String(item.kind)) ||
      typeof item.title !== "string" || item.title.length > 320 || Array.from(item.title).length > 160 || !["open", "in_progress", "blocked"].includes(String(item.status)) ||
      !["low", "normal", "high", "urgent"].includes(String(item.priority)) || (item.due_at !== null && !instant(item.due_at))) return null;
    ids.add(item.id);
    items.push({ id: item.id, kind: item.kind as WeeklySourceItem["kind"], title: item.title,
      status: item.status as WeeklySourceItem["status"], priority: item.priority as WeeklySourceItem["priority"], due_at: item.due_at as string | null });
  }
  return items;
}
function zone(v: unknown): v is string {
  if (typeof v !== "string" || v.length > 80 || !/^(UTC|[A-Za-z]+\/[A-Za-z0-9_+/-]+)$/.test(v)) return false;
  try { new Intl.DateTimeFormat("en", { timeZone: v }).format(0); return true; } catch { return false; }
}
// The canonical PostgreSQL schedule validator also accepts names such as CET/GMT/EST.
// Preserve its approved value, including zones newer than the consumer's ICU database.
// Calendar formats the separately configured business zone and never computes recurrence.
const scheduleZone = (v: unknown): v is string => typeof v === "string" && v.length > 0 && v.length <= 128 &&
  /^[A-Za-z0-9_+./:-]+$/.test(v) && !/^(posix|right)\//.test(v);
const STATUSES = new Set<unknown>(["scheduled", "running", "completed", "failed", "unknown", "cancelled", "needs_approval", "held", "refused", "skipped"]);
function verified(raw: unknown, process: string, tenant: string, actor: string): VerifiedWeeklyRun | null {
  const run = record(raw), o = record(run?.observation);
  if (!run || run.status !== "completed" || !o || !uuid(run.event_id) || !uuid(run.act_id) ||
    o.tenant_id !== tenant || o.authorized_by !== actor || o.automation_id !== process ||
    o.event_id !== run.event_id || o.act_id !== run.act_id || typeof run.correlation_ref !== "string" ||
    run.correlation_ref.length === 0 || o.correlation_ref !== run.correlation_ref || !uuid(o.receipt_id) ||
    o.source !== "public.plan_items" || !instant(o.observed_at) || !instant(run.scheduled_for) ||
    !integer(o.schedule_revision) || o.schedule_revision < 1 || typeof o.truncated !== "boolean" ||
    ![o.open_count, o.blocked_count, o.overdue_count, o.due_next_week_count, o.undated_count].every(integer)) return null;
  return {
    event_id: run.event_id, act_id: run.act_id, receipt_id: o.receipt_id, observed_at: o.observed_at,
    scheduled_for: run.scheduled_for, schedule_revision: o.schedule_revision, status: "completed", truncated: o.truncated,
    counts: { open: Number(o.open_count), blocked: Number(o.blocked_count), overdue: Number(o.overdue_count),
      due_next_week: Number(o.due_next_week_count), undated: Number(o.undated_count) },
    source_items: parseWeeklySourceItems(o.items),
  };
}
/** Only called after the current caller/workspace/owner fences. Never exposes raw observations or errors. */
export function parseWeeklyCommitmentSnapshot(raw: unknown, tenant: string, actor: string): WeeklyCommitmentSnapshot | null {
  const body = record(raw), tz = record(body?.business_time_zone);
  if (!body || body.ok !== true || body.scope !== "personal_planning_commitments" || body.tenant_id !== tenant ||
    body.actor_id !== actor || !instant(body.read_at) || body.limit !== 50 || typeof body.has_more !== "boolean" ||
    !Array.isArray(body.checks) || body.checks.length > 50 || !tz ||
    !["configured", "missing", "invalid"].includes(String(tz.state)) ||
    (tz.state === "configured" ? !zone(tz.zone) : tz.zone !== null)) return null;
  const checks: WeeklyCheck[] = [], ids = new Set<string>();
  for (const rawCheck of body.checks) {
    const c = record(rawCheck), s = record(c?.schedule);
    if (!c || !uuid(c.automation_id) || ids.has(c.automation_id) || typeof c.name !== "string" ||
      !integer(c.revision) || c.revision < 1 || !["requested", "scheduled", "paused", "cancelled"].includes(String(c.schedule_status)) ||
      !s || !integer(s.weekday) || s.weekday < 1 || s.weekday > 7 || typeof s.local_time !== "string" ||
      !/^([01]\d|2[0-3]):[0-5]\d$/.test(s.local_time) || !scheduleZone(s.timezone) ||
      !["ready", "held"].includes(String(c.execution_availability)) ||
      (c.next_run_at !== null && !instant(c.next_run_at)) ||
      (c.intended_next_run_at !== null && !instant(c.intended_next_run_at)) ||
      (c.execution_availability === "held" && c.next_run_at !== null) ||
      (c.schedule_status !== "scheduled" && c.next_run_at !== null)) return null;
    ids.add(c.automation_id);
    let last: WeeklyRun | null = null;
    if (c.last_run !== null) {
      const r = record(c.last_run);
      if (!r || !uuid(r.event_id) || (r.act_id !== null && !uuid(r.act_id)) ||
        !instant(r.scheduled_for) || !STATUSES.has(r.status)) return null;
      const status = r.status === "completed" && !verified(r, c.automation_id, tenant, actor) ? "unknown" : r.status as WeeklyRunStatus;
      last = { event_id: r.event_id, act_id: r.act_id as string | null, scheduled_for: r.scheduled_for, status };
    }
    const past = c.last_verified_run === null ? null : verified(c.last_verified_run, c.automation_id, tenant, actor);
    if (c.last_verified_run !== null && !past) return null;
    checks.push({
      automation_id: c.automation_id, name: c.name.slice(0, 160), revision: c.revision,
      schedule_status: c.schedule_status as WeeklyCheck["schedule_status"],
      schedule: { weekday: s.weekday, local_time: s.local_time, timezone: s.timezone },
      execution_availability: c.execution_availability as WeeklyCheck["execution_availability"],
      execution_hold_reason: typeof c.execution_hold_reason === "string" ? c.execution_hold_reason.slice(0, 160) : null,
      next_run_at: c.next_run_at as string | null, intended_next_run_at: c.intended_next_run_at as string | null,
      last_run: last, last_verified_run: past,
    });
  }
  return { source: "canonical_process_and_act_receipts", read_at: body.read_at,
    business_time_zone: { state: tz.state as BusinessTimeZone["state"], zone: tz.zone as string | null },
    limit: 50, has_more: body.has_more, checks };
}
/** Calendar is a visibility consumer, never an event producer or time reservation. */
export function projectWeeklyCalendar(snapshot: WeeklyCommitmentSnapshot) {
  const timezone = snapshot.business_time_zone.state === "configured" ? snapshot.business_time_zone.zone : null;
  const definitions = snapshot.checks.map(c => ({
    ...c, latest_status: c.last_run?.status ?? c.schedule_status,
    // No ordinary appointment controls; a future caller opens the same canonical Chat process.
    control_target: { automation_id: c.automation_id, expected_revision: c.revision },
  }));
  const markers = definitions.flatMap(c => !c.next_run_at ? [] : [{
    kind: "weekly_commitment" as const, automation_id: c.automation_id, revision: c.revision, name: c.name,
    occurs_at: c.next_run_at, display_when: timezone ? new Intl.DateTimeFormat("en-US", {
      timeZone: timezone, weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short",
    }).format(new Date(c.next_run_at)) : null,
  }]);
  return { source: snapshot.source, read_at: snapshot.read_at, timezone, timezone_state: snapshot.business_time_zone.state,
    has_more: snapshot.has_more, markers, definitions };
}
/** Bounded data, not instructions; last verified history never replaces the latest unknown attempt. */
export function projectWeeklyCommitmentChat(snapshot: WeeklyCommitmentSnapshot): string {
  let included = Math.min(snapshot.checks.length, 10);
  for (;;) {
    const result = JSON.stringify({ source: snapshot.source, read_at: snapshot.read_at, business_time_zone: snapshot.business_time_zone,
      included_checks: included, has_more: snapshot.has_more || included < snapshot.checks.length,
      checks: snapshot.checks.slice(0, included).map(c => ({ ...c, last_verified_run: c.last_verified_run ? {
        event_id: c.last_verified_run.event_id, act_id: c.last_verified_run.act_id, receipt_id: c.last_verified_run.receipt_id,
        observed_at: c.last_verified_run.observed_at, scheduled_for: c.last_verified_run.scheduled_for,
        schedule_revision: c.last_verified_run.schedule_revision, status: c.last_verified_run.status,
        truncated: c.last_verified_run.truncated, counts: c.last_verified_run.counts,
      } : null })) });
    if (result.length <= 12000 || included === 0) return result;
    included--;
  }
}
