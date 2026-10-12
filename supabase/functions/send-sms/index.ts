import { commsProviderExecutionAllowed } from "../_shared/comms-provider-boundary.ts";
// Sends an SMS via Twilio with preference checks and logging.
// Called by the notification dispatcher (send-notification) and triggers.
// Fails closed on Campaign class and durable platform consent, then applies the
// registered Paige Agent AI brand/link/HELP/STOP envelope.
import { createClient } from 'npm:@supabase/supabase-js@2'
import { formatPaigeAgentAiSms } from '../_shared/paige-agent-ai-sms.ts'
import { normalizePhone } from '../_shared/pre-send-pipeline.ts'
import { sendOperatorSms } from '../_shared/operator-twilio.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const MAX_BODY_LEN = 1600
const PLATFORM_ACCOUNT_NOTIFICATION_TYPES = new Set(['onboarding', 'account_status', 'service_notification'])

interface SmsRequest {
  user_id: string
  message_type: string // credit_alert | score_milestone | funding_alert | coaching_reminder | verification | onboarding | weekly_summary
  message_body: string
  to_phone?: string
  // Internal: may skip legacy preference checks, but never the Campaign or consent gates.
  skip_preference_check?: boolean
}

const PREF_FLAG_BY_TYPE: Record<string, string> = {
  credit_alert: 'sms_credit_alerts',
  funding_alert: 'sms_funding_alerts',
  score_milestone: 'sms_score_milestones',
  coaching_reminder: 'sms_coaching_reminders',
}

function jsonResp(data: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

async function logSms(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  user_id: string,
  message_type: string,
  body: string,
  status: 'sent' | 'failed' | 'unsubscribed' | 'suppressed',
  provider_message_id?: string,
  error_message?: string,
) {
  await supabase.from('communication_log').insert({
    user_id,
    channel: 'sms',
    message_type,
    preview: body.slice(0, 100),
    status,
    provider_message_id: provider_message_id ?? null,
    error_message: error_message ?? null,
  })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders })

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  let body: SmsRequest
  try {
    body = await req.json()
  } catch {
    return jsonResp({ error: 'Invalid JSON' }, 400)
  }

  if (!body.user_id || !body.message_type || !body.message_body) {
    return jsonResp({ error: 'user_id, message_type, message_body required' }, 400)
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey)

  // The gateway validates a JWT, but that alone does not prove the caller owns
  // the user_id in the body. Internal service-role callers may address a user;
  // a human caller may address only their own authenticated account.
  const authHeader = req.headers.get('Authorization') ?? ''
  const bearer = authHeader.replace(/^Bearer\s+/i, '').trim()
  if (!bearer) return jsonResp({ error: 'Unauthorized' }, 401)
  if (bearer !== supabaseServiceKey) {
    const authed = createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: authHeader } },
    })
    const { data: { user }, error: userError } = await authed.auth.getUser()
    if (userError || !user) return jsonResp({ error: 'Unauthorized' }, 401)
    if (user.id !== body.user_id) return jsonResp({ error: 'Forbidden' }, 403)
  }

  if (!await commsProviderExecutionAllowed(supabase, { actorUserId: body.user_id })) {
    return jsonResp({ error: 'COMMS_PROVIDER_EXECUTION_DISABLED' }, 403)
  }

  // Load preferences (always — needed to find phone if not provided)
  const { data: prefs } = await supabase
    .from('communication_preferences')
    .select('*')
    .eq('user_id', body.user_id)
    .maybeSingle()

  const toPhone = body.to_phone || prefs?.sms_phone_number
  if (!toPhone) {
    return jsonResp({ error: 'No phone number on file' }, 400)
  }

  // A Campaign registration is a traffic boundary, not a generic Twilio switch.
  // Until another Paige-operated use case is separately registered, unsupported
  // categories (including marketing, coaching, summaries, and verification) stop here.
  if (!PLATFORM_ACCOUNT_NOTIFICATION_TYPES.has(body.message_type)) {
    await logSms(supabase, body.user_id, body.message_type, body.message_body, 'suppressed', undefined, 'campaign_not_registered')
    return jsonResp({ success: false, reason: 'campaign_not_registered' }, 200)
  }

  const normalizedTo = normalizePhone(toPhone)
  const { data: consent, error: consentError } = await supabase
    .from('communications_consents')
    .select('id')
    .eq('user_id', body.user_id)
    .eq('phone', normalizedTo)
    .is('tenant_id', null)
    .is('contact_id', null)
    .not('consent_granted_at', 'is', null)
    .is('revoked_at', null)
    .is('withdrawn_at', null)
    .eq('sms_transactional', true)
    .limit(1)
    .maybeSingle()
  if (consentError || !consent) {
    await logSms(supabase, body.user_id, body.message_type, body.message_body, 'suppressed', undefined, consentError ? 'consent_check_failed' : 'platform_sms_consent_required')
    return jsonResp({ success: false, reason: consentError ? 'consent_check_failed' : 'platform_sms_consent_required' }, 200)
  }

  // Legacy preference checks. The durable consent gate above is never bypassed.
  if (!body.skip_preference_check) {
    if (!prefs) {
      return jsonResp({ success: false, reason: 'no_preferences' }, 200)
    }
    if (prefs.unsubscribed_all) {
      await logSms(supabase, body.user_id, body.message_type, body.message_body, 'unsubscribed')
      return jsonResp({ success: false, reason: 'unsubscribed_all' }, 200)
    }
    if (!prefs.sms_enabled) {
      return jsonResp({ success: false, reason: 'sms_disabled' }, 200)
    }
    if (!prefs.sms_phone_verified) {
      return jsonResp({ success: false, reason: 'phone_not_verified' }, 200)
    }
    const flag = PREF_FLAG_BY_TYPE[body.message_type]
    if (flag && prefs[flag] === false) {
      return jsonResp({ success: false, reason: 'category_disabled' }, 200)
    }
  }

  // Platform-account messages use the exact registered brand/link/HELP/STOP envelope.
  const finalBody = formatPaigeAgentAiSms({
    body: body.message_body,
    url: 'https://paigeagent.ai/auth?mode=login',
  })
  if (finalBody.length > MAX_BODY_LEN) {
    return jsonResp({ success: false, reason: 'body_too_long_max_1600' }, 200)
  }

  // Send only through the operator A2P Messaging Service. The shared seam fails
  // closed when its MG SID is absent; there is no raw From-number fallback.
  const twilio = await sendOperatorSms(normalizedTo, finalBody)
  if (!twilio.ok || !twilio.data) {
    const reason = twilio.error || 'Failed to send SMS'
    console.error('Twilio error', reason)
    await logSms(supabase, body.user_id, body.message_type, finalBody, 'failed', undefined, reason)
    return jsonResp({ error: reason, needs_config: twilio.needs_config === true }, twilio.needs_config ? 503 : 500)
  }

  const messageSid = (twilio.data as { sid?: string }).sid

  await logSms(supabase, body.user_id, body.message_type, finalBody, 'sent', messageSid)

  return jsonResp({ success: true, sid: messageSid })
})
