import { commsProviderExecutionAllowed } from "../_shared/comms-provider-boundary.ts";
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.75.0";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface SMSRequest {
  to: string;
  message: string;
  userId?: string;
}

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { to, message, userId }: SMSRequest = await req.json();

    if (!to || !message || !userId) {
      throw new Error('Missing required fields: to, message, and userId');
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const authHeader = req.headers.get('Authorization') ?? '';
    const bearer = authHeader.replace(/^Bearer\s+/i, '').trim();
    if (!bearer) throw new Error('Unauthorized');
    if (bearer !== supabaseServiceKey) {
      const authed = createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY')!, {
        global: { headers: { Authorization: authHeader } },
      });
      const { data: { user }, error } = await authed.auth.getUser();
      if (error || !user) throw new Error('Unauthorized');
      if (user.id !== userId) throw new Error('Forbidden');
    }
    const admin = createClient(supabaseUrl, supabaseServiceKey);
    if (!await commsProviderExecutionAllowed(admin, { actorUserId: userId })) {
      return new Response(JSON.stringify({ error: 'COMMS_PROVIDER_EXECUTION_DISABLED' }), { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    const response = await fetch(`${supabaseUrl}/functions/v1/send-sms`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${supabaseServiceKey}`,
      },
      body: JSON.stringify({
        user_id: userId,
        message_type: 'service_notification',
        message_body: message,
        to_phone: to,
      }),
    });

    const result = await response.json();

    if (!response.ok) {
      throw new Error(result.error || 'Governed SMS send failed');
    }

    return new Response(
      JSON.stringify(result),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      }
    );
  } catch (error: any) {
    console.error('Error in send-sms-reminder:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      }
    );
  }
});
