import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useTenantContext } from '@/hooks/useTenantContext';
import { supabase } from '@/integrations/supabase/client';
import {
  composeClientEngagementStatus,
  parseClientEngagementSource,
  type ClientEngagementStatus,
  type SourceWorkItem,
} from '../../../supabase/functions/_shared/client-engagement/status';

/**
 * Experience 04 · E4-S1. Reads ONE client's status through the caller's own session
 * (public.read_client_engagement_status — owner/admin of the active workspace only) and composes
 * it with the shared composer. No provider call, no mutation, no inferred payment or signing state.
 * Mounted (E4-S3 PR beta) as "Where {client} stands", the first section of the Solo client record
 * (Clients › People › a client; src/components/tenant-relationships/ClientStanding.tsx). The read writes no
 * receipt (20271031005000), so opening a record leaves nothing on the Rail.
 */
const UNREADABLE = 'This client’s status could not be read.';

/** The server refused this person (not an owner/admin of the workspace, or a client outside it). */
export class ClientStatusRefused extends Error {
  constructor() { super('Only the business owner or an admin can see payments for this client.'); }
}

/**
 * E09 Slice 3: the client record mounts two sections on this one read ("Where {client} stands" and
 * "Shared with {client}"). Opening a record still reads ONCE: a read started in the same render pass
 * for the same authenticated actor, workspace and client is joined, never repeated. The join lasts only until the current
 * task ends, so nothing is cached and a read that never settles can't capture a later one; a `fresh`
 * read (a confirm after a write) never joins at all.
 */
const sameTick = new Map<string, Promise<ClientEngagementStatus>>();

export function readClientEngagementStatus(tenantId: string, contactId: string, options: { fresh?: boolean; actorId?: string } = {}): Promise<ClientEngagementStatus> {
  if (options.fresh) return readOnce(tenantId, contactId);
  // This partitions a transient join, not permission: the original RPC still resolves its own actor.
  const key = JSON.stringify([options.actorId ?? null, tenantId, contactId]);
  const joined = sameTick.get(key);
  if (joined) return joined;
  const started = readOnce(tenantId, contactId);
  sameTick.set(key, started);
  queueMicrotask(() => { if (sameTick.get(key) === started) sameTick.delete(key); });
  return started;
}

async function readOnce(tenantId: string, contactId: string): Promise<ClientEngagementStatus> {
  const { data, error } = await supabase.rpc('read_client_engagement_status' as never,
    { _expected_tenant_id: tenantId, _contact_id: contactId } as never);
  // 42501 is the read's own refusal: retrying cannot succeed, so it is a state, not an error.
  if (error) throw (error as { code?: string }).code === '42501' ? new ClientStatusRefused() : new Error(UNREADABLE);
  try {
    const source = parseClientEngagementSource(data);
    // The server answers for the session's workspace; a mismatch is refused, never displayed.
    if (source.tenant_id !== tenantId || source.contact_id !== contactId) throw new Error('CLIENT_STATUS_SCOPE_MISMATCH');
    return composeClientEngagementStatus(source);
  } catch (cause) {
    // The internal code is logged for diagnosis and never shown to the person (§11, §32).
    console.error('[client-engagement-status]', cause);
    throw new Error(UNREADABLE);
  }
}

type State =
  | { phase: 'idle' | 'loading' | 'no_workspace'; status: null; error: '' }
  | { phase: 'refused'; status: null; error: string }
  | { phase: 'ready'; status: ClientEngagementStatus; error: '' }
  | { phase: 'error'; status: null; error: string };

/**
 * E09 Slice 3: an item the owner can share with this client's portal. The reader carries `shared` and
 * the row version `updated_at` (20271110030000); an older reader omits both, and a malformed pair is
 * treated the same way. Such an item offers no share control rather than a guessed one. Reminders
 * never reach this list (the reader selects milestones and tasks only) and cancelled work cannot be
 * shared, so neither is shareable here either.
 */
export type ShareableWorkItem = SourceWorkItem & { shared: boolean; updated_at: string };
export function shareableWorkItem(item: SourceWorkItem): item is ShareableWorkItem {
  return typeof item.shared === 'boolean' && typeof item.updated_at === 'string'
    && Number.isFinite(Date.parse(item.updated_at))
    && (item.item_type === 'milestone' || item.item_type === 'task') && item.status !== 'cancelled';
}

/** A render lifetime only. The canonical context and native RPC retain all authorization. */
export function clientEngagementScopeKey(context: Pick<ReturnType<typeof useTenantContext>,
  'activeUserId' | 'activeTenantId' | 'accountContextLoading' | 'accountContextStatus'>, contactId: string | null): string {
  return JSON.stringify([context.activeUserId, context.activeTenantId, contactId, context.accountContextLoading, context.accountContextStatus]);
}

export function useClientEngagementStatus(contactId: string | null) {
  const context = useTenantContext();
  const { activeTenantId, activeUserId, accountContextLoading, accountContextStatus } = context;
  const identity = clientEngagementScopeKey(context, contactId);
  const current = useRef({ identity, mounted: false });
  // Retire BEFORE paint, including A → B → A. An effect-only reset exposes the preceding answer.
  if (current.current.identity !== identity) current.current = { identity, mounted: false };
  const frame = current.current;
  const [state, setState] = useState<{ frame: typeof frame; value: State } | null>(null);
  const [refresh, setRefresh] = useState(0);
  const generation = useRef(0);
  const reloads = useRef(0);
  const confirmedReads = useRef(0);
  const latestSuccessfulReload = useRef(0);
  // Keyed consumers unmount instead of rendering the next identity. Retire their callbacks in
  // commit, before a parent's layout work or a session continuation can start another request.
  useLayoutEffect(() => () => {
    frame.mounted = false;
    generation.current++;
  }, [frame]);
  const isCurrent = useCallback(() => current.current === frame && frame.mounted, [frame]);
  let blocked: State | null = null;
  if (accountContextLoading || accountContextStatus === 'resolving' || !contactId) blocked = { phase: 'idle', status: null, error: '' };
  else if (accountContextStatus !== 'ready' || !activeUserId) blocked = { phase: 'error', status: null, error: UNREADABLE };
  else if (!activeTenantId) blocked = { phase: 'no_workspace', status: null, error: '' };
  const blockedPhase = blocked?.phase;
  useEffect(() => {
    const opened = ++generation.current;
    const startedBeforeConfirmation = confirmedReads.current;
    frame.mounted = true;
    const cleanup = () => {
      frame.mounted = false;
      if (generation.current === opened) generation.current++;
    };
    const accepts = () => isCurrent() && generation.current === opened && confirmedReads.current === startedBeforeConfirmation;
    if (blockedPhase || !activeTenantId || !activeUserId || !contactId) return cleanup;
    setState({ frame, value: { phase: 'loading', status: null, error: '' } });
    readClientEngagementStatus(activeTenantId, contactId, { actorId: activeUserId })
      .then(status => { if (accepts()) setState({ frame, value: { phase: 'ready', status, error: '' } }); })
      .catch((err: unknown) => {
        if (!accepts()) return;
        const value: State = err instanceof ClientStatusRefused
          ? { phase: 'refused', status: null, error: err.message }
          : { phase: 'error', status: null, error: err instanceof Error ? err.message : UNREADABLE };
        setState({ frame, value });
      });
    return cleanup;
  }, [frame, isCurrent, blockedPhase, activeTenantId, activeUserId, contactId, refresh]);
  /**
   * A fresh read that keeps the current answer on screen (no skeleton) and RESOLVES with what the
   * server says now, so a caller can confirm its own write against a read that started after it
   * (§70.1). A retired or superseded answer REJECTS, so it cannot confirm a write in another scope.
   */
  const reload = useCallback(async (): Promise<ClientEngagementStatus> => {
    if (!isCurrent() || blockedPhase || !activeTenantId || !activeUserId || !contactId) throw new Error(UNREADABLE);
    const opened = generation.current, mine = ++reloads.current;
    let status: ClientEngagementStatus;
    try {
      status = await readClientEngagementStatus(activeTenantId, contactId, { fresh: true, actorId: activeUserId });
    } catch (error) {
      // A transient failure is not a confirmation and must not strand an otherwise valid refresh.
      // A real server refusal retires cached data unless a newer successful read re-proved access.
      if (error instanceof ClientStatusRefused && isCurrent() && generation.current === opened
        && mine > latestSuccessfulReload.current) {
        confirmedReads.current++;
        setState({ frame, value: { phase: 'refused', status: null, error: error.message } });
      }
      throw error;
    }
    if (!isCurrent() || generation.current !== opened || reloads.current !== mine) throw new Error(UNREADABLE);
    confirmedReads.current++;
    latestSuccessfulReload.current = mine;
    setState({ frame, value: { phase: 'ready', status, error: '' } });
    return status;
  }, [frame, isCurrent, blockedPhase, activeTenantId, activeUserId, contactId]);
  const visible = blocked ?? (state?.frame === frame ? state.value : { phase: 'loading', status: null, error: '' } as State);
  return { ...visible, retry: () => { if (isCurrent()) setRefresh(n => n + 1); }, reload, isCurrent };
}
