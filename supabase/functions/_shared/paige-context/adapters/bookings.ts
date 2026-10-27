import { readCalendarAgenda, calendarAgendaForModel, type CalendarBookingReadCaller } from '../../calendar-booking-read.ts';
import { contextAvailable, contextDegraded } from '../mod.ts';
import type { DomainSnapshot, DomainSnapshotAdapter } from '../snapshot.ts';
import type { BusinessReviewCaller } from './finance.ts';

/** Optional original SDK query port. Missing support is unavailable, never a service fallback. */
// The actual SDK's initial from() builder becomes awaitable after select().
// Require that real initial port, rather than pretending from() itself is a promise.
export type CalendarReviewCaller = BusinessReviewCaller & { readonly from?: (table: 'tenants') => unknown };
export const BOOKINGS_ADAPTER_ID = 'bookings.canonical_agenda.v1';
// eslint-disable-next-line no-control-regex -- the existing snapshot data fence requires one line
const line = (value: unknown) => String(value).replace(/[\s\u0000-\u001f\u007f-\u009f]+/g, ' ').trim();

/** A projection of the ORIGINAL Calendar reader. No copied booking/tenant query or new metric. */
export function createBookingsSnapshotAdapter(caller: CalendarReviewCaller, scope: { tenantId: string | null }): DomainSnapshotAdapter {
  return { domain: 'bookings', owner: 'calendar', async read(ctx) {
    const gap = (reason: string) => contextDegraded<DomainSnapshot>(reason);
    const tenant = scope.tenantId;
    const origin = { ...ctx.identity }, period = { ...ctx.period };
    if (!tenant || tenant !== ctx.identity.tenantId || tenant !== ctx.identity.workspaceId
      || ctx.identity.accountShape !== 'solo' || ctx.identity.actAsClientId !== null
      || !['owner', 'admin'].includes(ctx.identity.role ?? '') || ctx.signal?.aborted) return gap('calendar_review_not_authorized');
    const auth = caller.auth, from = caller.from;
    if (!auth || typeof from !== 'function') return gap('calendar_review_original_caller_unavailable');
    try {
      // Preserve the original SDK query/abort chain. The metric observing proxy intentionally
      // returns promises for scope reads, so it must not replace Calendar's existing query client.
      const nativeCaller: CalendarBookingReadCaller = {
        auth,
        from(table) {
          const builder = from.call(caller, table);
          if (!builder || typeof builder !== 'object' || !('select' in builder)
            || typeof builder.select !== 'function') throw new Error('original_calendar_builder_unavailable');
          // The incumbent Calendar port types the initial builder as an awaitable query;
          // its implementation correctly calls select() first. Pass the original builder
          // unchanged, not an async wrapper that would discard the SDK filter/abort chain.
          return builder as ReturnType<CalendarBookingReadCaller['from']>;
        },
        rpc(name, args) {
          const query = caller.rpc(name, args) as ReturnType<CalendarBookingReadCaller['rpc']>;
          if (typeof query?.abortSignal !== 'function') throw new Error('original_calendar_query_unavailable');
          return query;
        },
      };
      const original = await readCalendarAgenda(origin, { caller: nativeCaller,
        currentIdentity: () => ctx.identity, signal: ctx.signal }, { from: period.start, to: period.end, view: 'team' });
      if (ctx.signal?.aborted || scope.tenantId !== tenant
        || (Object.keys(origin) as (keyof typeof origin)[]).some(key => origin[key] !== ctx.identity[key])) return gap('calendar_review_scope_changed');
      if (original.status !== 'available') return gap(original.status === 'needs_input' ? 'calendar_review_requires_32_day_window'
        : original.status === 'refused' ? 'calendar_review_refused' : 'calendar_review_unavailable');
      const preview = calendarAgendaForModel(original);
      if (preview.status !== 'available') return gap('calendar_review_unavailable');
      // The original model preview owns title clipping/flags. Never present a clipped title as
      // a full original name, or reinterpret a scheduled/cancelled status as attendance/completion.
      const changes = preview.bookings.slice(0, 3).map(row => ({ summary:
        `Saved appointment ${line(row.start_at)} to ${line(row.end_at)} (${line(row.timezone)}), recorded status ${line(row.status)}; ${row.title_truncated ? 'title preview' : 'title'}: ${line(row.title_preview)}`,
      })).filter(row => row.summary.length <= 500);
      return contextAvailable<DomainSnapshot>({ domain: 'bookings', owner: 'calendar', period,
        as_of: original.read_at, freshness: 'live_read', coverage: 'partial',
        coverage_note: 'Up to 3 team Calendar title previews overlapping this period. Native sample omits class participant rows and may omit other records. Saved statuses do not prove attendance, completion, provider sync, free capacity or a conflict-free agenda.',
        headline: [], changes, outcomes: [], risks: [], upcoming: [], goal_links: [],
        sources: [{ system: 'calendar', adapter: BOOKINGS_ADAPTER_ID }],
      });
    } catch { return gap('calendar_review_unavailable'); }
  } };
}
