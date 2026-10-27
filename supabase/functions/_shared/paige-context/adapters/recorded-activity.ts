import type { MetricCaller } from '../../analytics-metrics/read.ts';
import { contextAvailable, contextDegraded } from '../mod.ts';
import type { DomainSnapshot, DomainSnapshotAdapter } from '../snapshot.ts';

/** The original caller-JWT Rail read, not a service-role client or a new event reader. */
type ActivityCaller = MetricCaller & { readonly auth?: {
  getUser(): Promise<{ data: { user: { id: string } | null }; error: unknown }>;
} };
type Entry = { id: string; at: string; actor: string; title: string; summary: string };
const RPC = 'get_solo_rail_activity';
const LIMIT = 25;
export const RECORDED_ACTIVITY_ADAPTER_ID = 'outcomes.owner_activity.v1';
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const uuid = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(v);
const instant = (v: unknown): v is string => typeof v === 'string'
  && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)$/.test(v) && Number.isFinite(Date.parse(v));
// eslint-disable-next-line no-control-regex -- match the existing snapshot's single-line data fence
const line = (v: string) => v.replace(/[\s\u0000-\u001f\u007f-\u009f]+/g, ' ').trim();

function entries(value: unknown): Entry[] | null {
  if (!Array.isArray(value) || value.length > LIMIT) return null;
  const result: Entry[] = [], seen = new Set<string>();
  for (const row of value) {
    if (!object(row)) return null;
    // Inspect audience before content. Client-only and unrecognised classifications never enter
    // model context, even if a native source returns them to an otherwise authorised business owner.
    if (!['owner', 'both'].includes(String(row.audience))
      || !['owner_internal', 'client_visible'].includes(String(row.visibility))) continue;
    if (!uuid(row.id) || seen.has(row.id) || !instant(row.occurred_at)
      || typeof row.title !== 'string' || !row.title.trim()
      || !(row.summary === null || typeof row.summary === 'string')
      || !(row.actor_agent === null || typeof row.actor_agent === 'string')) return null;
    seen.add(row.id);
    const actor = row.actor_type === 'owner_staff' ? 'a person'
      : row.actor_type === 'paige_agent' && typeof row.actor_agent === 'string' && row.actor_agent.trim()
        ? line(row.actor_agent) : 'an unattributed actor';
    const title = line(row.title), summary = typeof row.summary === 'string' ? line(row.summary) : '';
    // Omit a whole oversized event; never invent a shortened original draft or result. The coverage
    // statement describes this bounded sample and never claims that an empty sample means no work.
    if (title.length + summary.length + actor.length > 410) continue;
    result.push({ id: row.id, at: row.occurred_at, actor, title, summary });
  }
  return result;
}

/** Original recorded facts only. A capability_succeeded read is NOT completed business work. */
export function createRecordedActivitySnapshotAdapter(
  caller: ActivityCaller, scope: { tenantId: string | null }, clock = Date.now,
): DomainSnapshotAdapter {
  return { domain: 'outcomes', owner: 'business', async read(ctx) {
    const gap = (reason: string) => contextDegraded<DomainSnapshot>(reason);
    const { actorId, scopeEpoch } = ctx.identity, tenantId = scope.tenantId;
    const allowed = () => !ctx.signal?.aborted && !!tenantId && scope.tenantId === tenantId && tenantId === ctx.identity.tenantId
      && ctx.identity.actorId === actorId && ctx.identity.scopeEpoch === scopeEpoch
      && ctx.identity.workspaceId === tenantId && ctx.identity.accountShape === 'solo'
      && !ctx.identity.actAsClientId && ['owner', 'admin'].includes(ctx.identity.role ?? '');
    if (!allowed()) return gap('recorded_activity_not_authorized');
    if (!caller.auth) return gap('recorded_activity_caller_auth_unavailable');
    const actorMatches = async () => {
      const result = await caller.auth!.getUser();
      return !result.error && result.data.user?.id === actorId;
    };
    const tenantMatches = async () => {
      const result = await caller.rpc('current_user_tenant_id');
      return !result.error && result.data === tenantId;
    };
    const read = async () => {
      const result = await caller.rpc(RPC, { p_limit: LIMIT });
      if (result.error) {
        const error: unknown = result.error;
        const refused = object(error) && (error.code === '42501'
          || typeof error.message === 'string' && error.message.includes('RAIL_FORBIDDEN'));
        throw new Error(refused ? 'refused' : 'unavailable');
      }
      const parsed = entries(result.data);
      if (!parsed) throw new Error('invalid');
      return parsed;
    };
    try {
      if (!await actorMatches() || !await tenantMatches() || !allowed()) return gap('recorded_activity_scope_changed');
      const initial = await read();
      if (!allowed()) return gap('recorded_activity_aborted');
      const start = Date.parse(ctx.period.start), end = Date.parse(ctx.period.end), observed = clock();
      if (![start, end, observed].every(Number.isFinite) || start >= end) return gap('recorded_activity_period_invalid');
      const selected = initial.filter(e => Date.parse(e.at) >= start && Date.parse(e.at) < end && Date.parse(e.at) <= observed)
        .sort((a, b) => Date.parse(b.at) - Date.parse(a.at) || a.id.localeCompare(b.id)).slice(0, 3);
      // Re-enter the SAME native owner/admin gate. Revoked access, changed attribution, removed
      // records, or records pushed outside the current bounded source invalidate the earlier read.
      const current = await read();
      if (selected.some(e => !current.some(c => JSON.stringify(c) === JSON.stringify(e)))) return gap('recorded_activity_source_changed');
      if (!await tenantMatches() || !await actorMatches() || !allowed()) return gap('recorded_activity_scope_changed');
      return contextAvailable<DomainSnapshot>({ domain: 'outcomes', owner: 'business', period: { ...ctx.period },
        as_of: new Date(observed).toISOString(), freshness: 'live_read', coverage: 'partial',
        coverage_note: 'Up to 3 readable events in this period from the latest 25 Rail records. Limited owner-visible sample; omitted or absent entries do not prove no activity. Recorded facts are not proof of approvals, completed business actions, receipts or improved results.',
        headline: [], changes: selected.map(e => ({ summary: `${e.at} · Recorded by ${e.actor}: ${e.title}${e.summary ? ` — ${e.summary}` : ''}` })),
        outcomes: [], risks: [], upcoming: [], goal_links: [],
        sources: [{ system: 'rail', adapter: RECORDED_ACTIVITY_ADAPTER_ID }],
      });
    } catch (error) {
      // No source rows, identifiers, provider diagnostics or exception prose reach the model.
      return gap(error instanceof Error && error.message === 'refused' ? 'recorded_activity_refused' : 'recorded_activity_unavailable');
    }
  } };
}
