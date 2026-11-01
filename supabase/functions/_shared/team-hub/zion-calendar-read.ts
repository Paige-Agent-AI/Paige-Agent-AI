// Server-only EXP05 composition, not native admission or a second Calendar reader.
// The original accepted-turn native stage MUST validate this proposed closed
// source binding before any result is eligible for model disclosure.
import { CALENDAR_AGENDA_READ_TOOLS } from "../paige-spine/domains/calendar_booking.ts";
import { readCalendarAgenda, calendarAgendaForModel, type CalendarBookingReadDeps } from "../calendar-booking-read.ts";
import type { ContextIdentity } from "../paige-context/mod.ts";
import { createWeeklyDraftDeadline } from "../paige-orchestration/weekly-draft-deadline.ts";

export type ZionCalendarScope = ContextIdentity & {
  readonly agent: "zion"; readonly where: "agent_dm"; readonly storedTools: readonly string[];
};
type CalendarModel = Extract<ReturnType<typeof calendarAgendaForModel>, { status: "available" }>;
/** Content observation, NOT a database row version, permission or approval. */
export type ZionCalendarSource = Readonly<{
  tool: "read_calendar_agenda"; version: 1;
  arguments: Readonly<{ from: string; to: string; view: "mine" | "team" }>;
  roster_tools: readonly string[];
  source: Readonly<Pick<CalendarModel, "source_shown_count" | "source_has_more" |
    "shown_count" | "omitted_from_model" | "has_more"> & {
      bookings: readonly Readonly<CalendarModel["bookings"][number]>[];
      // ALL original returned rows, including those omitted from the bounded
      // preview. References are not row versions or authority to disclose them.
      source_ids: readonly string[];
    }>;
}>;
export type ZionCalendarDeps = CalendarBookingReadDeps & {
  // Host proves original actor/business/DM/role/roster afresh, not model claims.
  isCurrent: (scope: Readonly<ZionCalendarScope>) => Promise<boolean>;
  // The SAME host-owned total budget used by other original ZION private reads.
  takeRead: () => boolean;
  recordRead: (tool: "read_calendar_agenda") => Promise<boolean>;
  // Original native integration port; a fake/absent stage is never authority.
  stageReadContext: (scope: Readonly<ZionCalendarScope>, source: ZionCalendarSource) => Promise<boolean | "context_limit">;
};
export type ZionCalendarRead = { model: Readonly<Record<string, unknown>>; revalidate: () => Promise<boolean> };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const identityKeys = ["actorId", "tenantId", "workspaceId", "role", "accountShape", "actAsClientId", "scopeEpoch"] as const;
const unavailable = (): ZionCalendarRead => ({ model: Object.freeze({ status: "unavailable",
  message: "The Calendar results could not be verified for this reply. Nothing was changed." }), revalidate: async () => false });
function dataObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))) return null;
  return Object.getOwnPropertySymbols(value).length || Object.values(Object.getOwnPropertyDescriptors(value)).some(d => !("value" in d))
    ? null : value as Record<string, unknown>;
}
function capture(scope: ZionCalendarScope): Readonly<ZionCalendarScope> | null {
  try {
    const s = dataObject(scope), tools = s?.storedTools;
    if (!s || s.agent !== "zion" || s.where !== "agent_dm" || typeof s.actorId !== "string" || !UUID.test(s.actorId) ||
      typeof s.tenantId !== "string" || !UUID.test(s.tenantId) || s.workspaceId !== s.tenantId ||
      typeof s.role !== "string" || !["owner", "admin"].includes(s.role) || s.accountShape !== "solo" || s.actAsClientId !== null ||
      !(typeof s.scopeEpoch === "string" && s.scopeEpoch.length > 0 && s.scopeEpoch.length <= 512 ||
        typeof s.scopeEpoch === "number" && Number.isFinite(s.scopeEpoch)) ||
      !Array.isArray(tools) || tools.length > 64 || Object.getOwnPropertySymbols(tools).length > 0 ||
      Object.values(Object.getOwnPropertyDescriptors(tools)).some(d => !("value" in d)) ||
      !tools.includes("read_calendar_agenda") ||
      Array.from(tools).some(t => typeof t !== "string" || !/^[a-z][a-z0-9_]{0,95}$/.test(t)) || new Set(tools).size !== tools.length) return null;
    return Object.freeze({ actorId: s.actorId as string, tenantId: s.tenantId, workspaceId: s.tenantId,
      role: s.role as string, accountShape: "solo", actAsClientId: null, scopeEpoch: s.scopeEpoch as number | string,
      agent: "zion", where: "agent_dm", storedTools: Object.freeze([...tools]) });
  } catch { return null; }
}
async function current(scope: Readonly<ZionCalendarScope>, deps: ZionCalendarDeps, within: ReturnType<typeof createWeeklyDraftDeadline>) {
  if (await within(() => deps.isCurrent(scope)) !== true) return false;
  const live = deps.currentIdentity();
  return live !== null && identityKeys.every(k => scope[k] === live[k]);
}
export async function zionCalendarReadTools(scope: ZionCalendarScope, deps: ZionCalendarDeps) {
  const snapshot = capture(scope); if (!snapshot || deps.signal?.aborted) return [];
  let retired = false;
  const within = createWeeklyDraftDeadline(5000, () => !retired && !deps.signal?.aborted);
  try { return await current(snapshot, deps, within) ? [...CALENDAR_AGENDA_READ_TOOLS] : []; }
  catch { return []; } finally { retired = true; }
}
function observe(scope: Readonly<ZionCalendarScope>, model: CalendarModel, sourceIds: readonly string[]): ZionCalendarSource {
  // Reuse the exact canonical preview and its disclosed omissions; no full title,
  // invented updated_at, provider availability or hidden source facts are added.
  const bookings = model.bookings.map(row => Object.freeze({ ...row }));
  return Object.freeze({ tool: "read_calendar_agenda", version: 1,
    arguments: Object.freeze({ ...model.window, view: model.view }), roster_tools: scope.storedTools,
    source: Object.freeze({ bookings: Object.freeze(bookings),
      source_ids: Object.freeze([...sourceIds]),
      source_shown_count: model.source_shown_count, source_has_more: model.source_has_more,
      shown_count: model.shown_count, omitted_from_model: model.omitted_from_model, has_more: model.has_more }) });
}

/** Original caller-JWT read -> original receipt -> native stage -> model data.
 * Revalidation inspects the SAME content without spending a new tool slot or
 * minting another receipt. Unknown or changed results never become empty/safe. */
export async function readZionCalendar(scope: ZionCalendarScope, deps: ZionCalendarDeps, name: string, input: unknown): Promise<ZionCalendarRead> {
  const snapshot = capture(scope); if (!snapshot || name !== "read_calendar_agenda" || deps.signal?.aborted) return unavailable();
  let args: Record<string, unknown>;
  try { const data = dataObject(input); if (!data) return unavailable(); args = Object.freeze({ ...data }); }
  catch { return unavailable(); }
  const inspect = async (initial: boolean, expected?: string) => {
    let retired = false;
    const abort = new AbortController(), stop = () => abort.abort();
    deps.signal?.addEventListener("abort", stop, { once: true }); if (deps.signal?.aborted) stop();
    const within = createWeeklyDraftDeadline(5000, () => !retired && !abort.signal.aborted);
    const isCurrent = () => current(snapshot, deps, within);
    try {
      if (!await isCurrent() || initial && deps.takeRead() !== true) return null;
      const result = await within(() => readCalendarAgenda(snapshot, { caller: deps.caller, currentIdentity: deps.currentIdentity,
        signal: abort.signal, revalidateScope: async () => await isCurrent() &&
          (!deps.revalidateScope || await within(deps.revalidateScope) === true) }, args));
      // Snapshot synchronously BEFORE any receipt/stage await can mutate input.
      const preview = calendarAgendaForModel(result);
      if (preview.status !== "available") return { model: preview, identity: null };
      const model = structuredClone(preview);
      // Capture synchronously before any receipt/stage await, preserving the
      // original reader's 50-row bound. The 51st has-more probe is not returned.
      const source = observe(snapshot, model, result.status === "available" ? result.bookings.map(row => String(row.id)) : []);
      const identity = JSON.stringify(source);
      if (expected !== undefined && identity !== expected || !await isCurrent()) return null;
      if (initial && await within(() => deps.recordRead("read_calendar_agenda")) !== true || !await isCurrent()) return null;
      const staged = await within(() => deps.stageReadContext(snapshot, source));
      if (!await isCurrent()) return null;
      // Only the native pre-update capacity refusal is recoverable here. It
      // guarantees the previous context was untouched; it releases no new facts.
      // An absent/refused/uncertain acknowledgment still retires the whole read.
      if (staged === "context_limit") return { model: Object.freeze({ status: "limited",
        message: "This review reached its saved source-context limit. No Calendar details were added. Keep only already verified results and ask for a narrower follow-up." }), identity: null };
      if (staged !== true) return null;
      return { model: Object.freeze({ ...model, window: Object.freeze({ ...model.window }), bookings: source.source.bookings }), identity };
    } catch { return null; }
    finally { retired = true; stop(); deps.signal?.removeEventListener("abort", stop); }
  };
  const first = await inspect(true); if (!first) return unavailable();
  if (first.identity === null) return { model: first.model, revalidate: async () => false };
  return { model: first.model, revalidate: async () => {
    const next = await inspect(false, first.identity!); return next !== null && next.identity === first.identity;
  } };
}
