import { commsProviderExecutionAllowed } from "../_shared/comms-provider-boundary.ts";
// Generates a 6-digit code, stores HASHED in sms_verifications, sends plaintext via Twilio.
// Rate-limited: max 3 sends per phone per hour.
import { createClient } from 'npm:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function jsonResp(data: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

function generateCode(): string {
  const arr = new Uint32Array(1)
  crypto.getRandomValues(arr)
  return String(arr[0] % 1_000_000).padStart(6, '0')
}

async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input))
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders })

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

  const authHeader = req.headers.get('Authorization')
  if (!authHeader) return jsonResp({ error: 'Missing authorization' }, 401)

  const supabaseAuth = createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: authHeader } },
  })
  const { data: userData, error: userErr } = await supabaseAuth.auth.getUser()
  if (userErr || !userData.user) return jsonResp({ error: 'Unauthorized' }, 401)
  const userId = userData.user.id

  let body: { phone_number?: string }
  try {
    body = await req.json()
  } catch {
    return jsonResp({ error: 'Invalid JSON' }, 400)
  }

  if (!body.phone_number) return jsonResp({ error: 'phone_number required' }, 400)

  const phone = body.phone_number.startsWith('+')
    ? body.phone_number
    : `+1${body.phone_number.replace(/\D/g, '')}`

  if (!/^\+\d{10,15}$/.test(phone)) {
    return jsonResp({ error: 'Invalid phone format' }, 400)
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey)
  if (!await commsProviderExecutionAllowed(supabase, { actorUserId: userId })) {
    return new Response(JSON.stringify({ error: 'COMMS_PROVIDER_EXECUTION_DISABLED' }), { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  }

  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString()
  const { count } = await supabase
    .from('sms_verifications')
    .select('*', { count: 'exact', head: true })
    .eq('phone_number', phone)
    .gte('created_at', oneHourAgo)

  if ((count ?? 0) >= 3) {
    return jsonResp({ error: 'Too many verification attempts. Try again in an hour.' }, 429)
  }

  const code = generateCode()
  const codeHash = await sha256Hex(code)
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString()

  const { error: insertErr } = await supabase.from('sms_verifications').insert({
    user_id: userId,
    phone_number: phone,
    verification_code: codeHash,
    expires_at: expiresAt,
  })

  if (insertErr) {
    console.error('Insert verification failed', insertErr)
    return jsonResp({ error: 'Failed to create verification' }, 500)
  }

  await supabase
    .from('communication_preferences')
    .upsert(
      { user_id: userId, sms_phone_number: phone, sms_phone_verified: false },
      { onConflict: 'user_id' },
    )

  const sendRes = await fetch(`${supabaseUrl}/functions/v1/send-sms`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${supabaseServiceKey}`,
    },
    body: JSON.stringify({
      user_id: userId,
      message_type: 'verification',
      message_body: `Your PaigeAgent verification code is ${code}. Expires in 10 minutes.`,
      to_phone: phone,
      skip_preference_check: true,
    }),
  })

  if (!sendRes.ok) {
    const errText = await sendRes.text()
    console.error('send-sms failed', errText)
    return jsonResp({ error: 'Failed to send verification SMS' }, 500)
  }

  return jsonResp({ success: true, expires_at: expiresAt })
})
