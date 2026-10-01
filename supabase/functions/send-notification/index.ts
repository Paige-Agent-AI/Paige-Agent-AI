// Unified notification dispatcher — checks preferences and routes to email + SMS.
// Triggers (DB hooks, cron, app code) call this single function.
import { createClient } from 'npm:@supabase/supabase-js@2'
import { isAuthorizedInternalCaller, adminClient } from '../_shared/systems-check-http.ts'

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

interface NotifyRequest {
  user_id: string
  message_type: 'credit_alert' | 'funding_alert' | 'score_milestone' | 'coaching_reminder' | 'weekly_summary' | 'onboarding'
  email_template?: string // template name in registry (optional — same as message_type by default)
  email_data?: Record<string, any>
  sms_body?: string // if omitted, no SMS will be sent
  channels?: ('email' | 'sms')[] // restrict to specific channels (default: both)
}

// credit_alert / funding_alert / score_milestone removed — those templates are
// archived to _shared/transactional-email-templates/_archive-mma/ (§2 + §9). Any
// legacy credit subsystem still emitting those types is MMA-only and handled in
// the broader credit-subsystem de-brand.
const EMAIL_TEMPLATE_BY_TYPE: Record<string, string> = {
  coaching_reminder: 'coaching-reminder',
  weekly_summary: 'weekly-summary',
  onboarding: 'onboarding-welcome',
}

const EMAIL_PREF_FLAG_BY_TYPE: Record<string, string> = {
  coaching_reminder: 'email_coaching_reminders',
  weekly_summary: 'email_weekly_summary',
  onboarding: 'email_onboarding',
}

async function logComm(
  supabase: ReturnType<typeof createClient>,
  user_id: string,
  channel: 'email' | 'sms',
  message_type: string,
  status: string,
  preview?: string,
  error_message?: string,
) {
  await supabase.from('communication_log').insert({
    user_id, channel, message_type, status,
    preview: preview?.slice(0, 100) ?? null,
    error_message: error_message ?? null,
  })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders })
  // Internal only. This function forwards to send-transactional-email (and, here, SMS) with the
  // service key, so an open door here was an open relay there: anyone holding the publishable key could pick the template, the content and the user. Its callers are the platform's
  // own crons and database triggers, which all send the service key.
  if (!(await isAuthorizedInternalCaller(req, adminClient()))) {
    return new Response(JSON.stringify({ error: 'forbidden' }), {
      status: 403,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

  let body: NotifyRequest
  try {
    body = await req.json()
  } catch {
    return jsonResp({ error: 'Invalid JSON' }, 400)
  }

  if (!body.user_id || !body.message_type) {
    return jsonResp({ error: 'user_id and message_type required' }, 400)
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey)
  const channels = body.channels ?? ['email', 'sms']

  // Load preferences
  const { data: prefs } = await supabase
    .from('communication_preferences')
    .select('*')
    .eq('user_id', body.user_id)
    .maybeSingle()

  // Auto-create defaults if missing
  let effectivePrefs = prefs
  if (!effectivePrefs) {
    const { data: created } = await supabase
      .from('communication_preferences')
      .insert({ user_id: body.user_id })
      .select('*')
      .maybeSingle()
    effectivePrefs = created
  }

  if (effectivePrefs?.unsubscribed_all) {
    return jsonResp({ success: false, reason: 'unsubscribed_all' })
  }

  // Resolve user email
  const { data: authUser } = await supabase.auth.admin.getUserById(body.user_id)
  const userEmail = authUser?.user?.email
  const results: Record<string, unknown> = {}

  // EMAIL
  if (channels.includes('email') && effectivePrefs?.email_enabled && userEmail) {
    const emailFlag = EMAIL_PREF_FLAG_BY_TYPE[body.message_type]
    if (emailFlag && effectivePrefs[emailFlag] !== false) {
      const templateName = body.email_template || EMAIL_TEMPLATE_BY_TYPE[body.message_type]
      if (templateName) {
        try {
          const emailRes = await fetch(`${supabaseUrl}/functions/v1/send-transactional-email`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${supabaseServiceKey}`,
            },
            body: JSON.stringify({
              templateName,
              recipientEmail: userEmail,
              idempotencyKey: `${body.message_type}-${body.user_id}-${Date.now()}`,
              templateData: body.email_data ?? {},
            }),
          })
          const emailJson = await emailRes.json()
          await logComm(
            supabase, body.user_id, 'email', body.message_type,
            emailRes.ok ? 'queued' : 'failed',
            JSON.stringify(body.email_data ?? {}),
            emailRes.ok ? undefined : (emailJson?.error || 'send-transactional-email failed'),
          )
          results.email = emailJson
        } catch (err: any) {
          await logComm(supabase, body.user_id, 'email', body.message_type, 'failed', undefined, err?.message)
          results.email = { error: err?.message }
        }
      }
    } else {
      results.email = { skipped: 'category_disabled' }
    }
  }

  // SMS
  if (channels.includes('sms') && body.sms_body && effectivePrefs?.sms_enabled && effectivePrefs?.sms_phone_verified) {
    try {
      const smsRes = await fetch(`${supabaseUrl}/functions/v1/send-sms`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${supabaseServiceKey}`,
        },
        body: JSON.stringify({
          user_id: body.user_id,
          message_type: body.message_type,
          message_body: body.sms_body,
        }),
      })
      results.sms = await smsRes.json()
    } catch (err: any) {
      results.sms = { error: err?.message }
    }
  } else if (channels.includes('sms') && body.sms_body) {
    results.sms = { skipped: 'sms_not_enabled_or_unverified' }
  }

  return jsonResp({ success: true, results })
})
