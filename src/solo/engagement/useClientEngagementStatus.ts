import { useEffect, useRef, useState } from 'react';
import { useTenantContext } from '@/hooks/useTenantContext';
import { supabase } from '@/integrations/supabase/client';
import {
  composeClientEngagementStatus,
  parseClientEngagementSource,
  type ClientEngagementStatus,
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

export async function readClientEngagementStatus(tenantId: string, contactId: string): Promise<ClientEngagementStatus> {
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

export function useClientEngagementStatus(contactId: string | null) {
  const { activeTenantId, accountContextLoading } = useTenantContext();
  const [state, setState] = useState<State>({ phase: 'idle', status: null, error: '' });
  const [refresh, setRefresh] = useState(0);
  const generation = useRef(0);
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
  return { ...state, retry: () => setRefresh(n => n + 1) };
}
