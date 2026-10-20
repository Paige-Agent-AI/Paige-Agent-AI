import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.75.0';
import { createOwnerTaskHistoryHandler } from '../_shared/paige-orchestration/owner-task-history-handler.ts';
import type { OwnerTaskHistoryClients } from '../_shared/paige-orchestration/owner-task-history.ts';

serve(createOwnerTaskHistoryHandler({
  // The domain exposes only these concrete read ports, not the SDK's recursive
  // schema generics. Keep construction uncontextualized before narrowing it to
  // that opaque read-only boundary; the original JWT client stays distinct.
  caller: authorization => {
    const client = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: authorization } }, auth: { persistSession: false, autoRefreshToken: false },
    });
    return client as unknown as OwnerTaskHistoryClients['caller'];
  },
  service: () => {
    const client = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    return client as unknown as OwnerTaskHistoryClients['service'];
  },
}));
