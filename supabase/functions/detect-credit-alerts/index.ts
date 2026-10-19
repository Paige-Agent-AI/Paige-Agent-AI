import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.75.0";
import { handleDetectCreditAlerts } from "./handler.ts";

// Internal-only (E09 H0): the handler accepts the service-role bearer and nothing else.
serve((req) =>
  handleDetectCreditAlerts(req, {
    serviceKey: Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"),
    serviceClient: () => createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!),
  })
);
