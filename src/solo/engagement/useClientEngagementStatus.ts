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
 * Not mounted in any shell yet: the Engagement panel waits on the owner's UI review.
 */
export async function readClientEngagementStatus(tenantId: string, contactId: string): Promise<ClientEngagementStatus> {
  const { data, error } = await supabase.rpc('read_client_engagement_status' as never,
    { _expected_tenant_id: tenantId, _contact_id: contactId } as never);
  if (error) throw new Error('This client’s status could not be read.');
  const source = parseClientEngagementSource(data);
  // The server answers for the session's workspace; a mismatch is refused, never displayed.
  if (source.tenant_id !== tenantId || source.contact_id !== contactId) {
    throw new Error('This client’s status could not be read.');
  }
  return composeClientEngagementStatus(source);
}

type State =
  | { phase: 'idle' | 'loading'; status: null; error: '' }
  | { phase: 'ready'; status: ClientEngagementStatus; error: '' }
  | { phase: 'error'; status: null; error: string };

export function useClientEngagementStatus(contactId: string | null) {
  const { activeTenantId, accountContextLoading } = useTenantContext();
  const [state, setState] = useState<State>({ phase: 'idle', status: null, error: '' });
  const [refresh, setRefresh] = useState(0);
  const generation = useRef(0);
  useEffect(() => {
    const opened = ++generation.current;
    if (!activeTenantId || accountContextLoading || !contactId) {
      setState({ phase: 'idle', status: null, error: '' });
      return;
    }
    setState({ phase: 'loading', status: null, error: '' });
    readClientEngagementStatus(activeTenantId, contactId)
      .then(status => { if (generation.current === opened) setState({ phase: 'ready', status, error: '' }); })
      .catch((err: unknown) => {
        if (generation.current === opened) {
          setState({ phase: 'error', status: null, error: err instanceof Error ? err.message : 'This client’s status could not be read.' });
        }
      });
  }, [activeTenantId, accountContextLoading, contactId, refresh]);
  return { ...state, retry: () => setRefresh(n => n + 1) };
}
