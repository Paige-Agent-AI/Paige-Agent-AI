import { useCallback, useEffect, useRef, useState } from 'react';
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
 * for the same workspace and client is joined, never repeated. The join lasts only until the current
 * task ends, so nothing is cached and a read that never settles can't capture a later one; a `fresh`
 * read (a confirm after a write) never joins at all.
 */
const sameTick = new Map<string, Promise<ClientEngagementStatus>>();

export function readClientEngagementStatus(tenantId: string, contactId: string, options: { fresh?: boolean } = {}): Promise<ClientEngagementStatus> {
  if (options.fresh) return readOnce(tenantId, contactId);
  const key = `${tenantId}:${contactId}`;
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

export function useClientEngagementStatus(contactId: string | null) {
  const { activeTenantId, accountContextLoading } = useTenantContext();
  const [state, setState] = useState<State>({ phase: 'idle', status: null, error: '' });
  const [refresh, setRefresh] = useState(0);
  const generation = useRef(0);
  const reloads = useRef(0);
  useEffect(() => {
    const opened = ++generation.current;
    if (accountContextLoading || !contactId) {
      setState({ phase: 'idle', status: null, error: '' });
      return;
    }
    // An operator or agency manager outside any workspace has no client book to read here.
    if (!activeTenantId) {
      setState({ phase: 'no_workspace', status: null, error: '' });
      return;
    }
    setState({ phase: 'loading', status: null, error: '' });
    readClientEngagementStatus(activeTenantId, contactId)
      .then(status => { if (generation.current === opened) setState({ phase: 'ready', status, error: '' }); })
      .catch((err: unknown) => {
        if (generation.current !== opened) return;
        if (err instanceof ClientStatusRefused) setState({ phase: 'refused', status: null, error: err.message });
        else setState({ phase: 'error', status: null, error: err instanceof Error ? err.message : UNREADABLE });
      });
  }, [activeTenantId, accountContextLoading, contactId, refresh]);
  /**
   * A fresh read that keeps the current answer on screen (no skeleton) and RESOLVES with what the
   * server says now, so a caller can confirm its own write against a read that started after it
   * (§70.1). A newer reload, or a change of client or workspace, wins over an older one.
   */
  const reload = useCallback(async (): Promise<ClientEngagementStatus> => {
    if (accountContextLoading || !activeTenantId || !contactId) throw new Error(UNREADABLE);
    const opened = generation.current, mine = ++reloads.current;
    const status = await readClientEngagementStatus(activeTenantId, contactId, { fresh: true });
    if (generation.current === opened && reloads.current === mine) setState({ phase: 'ready', status, error: '' });
    return status;
  }, [activeTenantId, accountContextLoading, contactId]);
  return { ...state, retry: () => setRefresh(n => n + 1), reload };
}
