// One-time admin-triggered fan-out: sends the Beta launch welcome email to
// every confirmed auth user. Per-recipient guards:
//   1. Skip if communication_preferences.unsubscribed_all = true
//   2. Skip if a communication_log row already exists with
//      message_type = 'beta_launch' for this user (prevents duplicate sends)
// Each send goes through the standard send-transactional-email function so
// suppression list, unsubscribe footer, and queue retries all apply.
//
// Supports two actions via request body:
//   { action: "count" } -> returns { eligible: number } without sending
//   { action: "send" }  -> performs the fan-out (default)

import { createClient } from 'npm:@supabase/supabase-js@2'
import { operatorUserId } from '../_shared/systems-check-http.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
}

interface CommPrefRow {
  user_id: string
  unsubscribed_all: boolean | null
}

interface CommLogRow {
  user_id: string
}

interface EligibleUser {
  user_id: string
  email: string
  full_name: string | null
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!supabaseUrl || !serviceKey) {
    return new Response(
      JSON.stringify({ error: 'Server configuration error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  }

  // Admin-only gate
  const authHeader = req.headers.get('Authorization') || ''
  const jwt = authHeader.replace(/^Bearer\s+/i, '')
  if (!jwt) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const adminClient = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const { data: userData, error: userErr } = await adminClient.auth.getUser(jwt)
  if (userErr || !userData?.user) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
  const callerId = userData.user.id

  // Platform operators only (super_admin / platform_admin, §53). This mails EVERY platform user, and
  // the global `admin` role it used to check is held by every tenant owner, so any account that
  // signed up could send it.
  if ((await operatorUserId(req)) !== callerId) {
    return new Response(JSON.stringify({ error: 'Platform operator required' }), {
      status: 403,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  // Parse action from body (defaults to "send" for backward compatibility)
  let action: 'count' | 'send' = 'send'
  try {
    const body = await req.json()
    if (body && body.action === 'count') action = 'count'
  } catch {
    // empty body -> default to send
  }

  // Page through auth.users via admin API
  const allAuthUsers: Array<{ id: string; email: string | null; user_metadata: Record<string, unknown> | null }> = []
  const perPage = 1000
  let page = 1
  // Hard cap to avoid runaway loops
  while (page <= 50) {
    const { data, error } = await adminClient.auth.admin.listUsers({ page, perPage })
    if (error) {
      return new Response(JSON.stringify({ error: `listUsers failed: ${error.message}` }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }
    const users = data?.users ?? []
    for (const u of users) {
      allAuthUsers.push({
        id: u.id,
        email: u.email ?? null,
        user_metadata: (u.user_metadata as Record<string, unknown> | null) ?? null,
      })
    }
    if (users.length < perPage) break
    page++
  }

  // Filter to users with an email
  const usersWithEmail = allAuthUsers.filter((u) => !!u.email) as Array<{
    id: string
    email: string
    user_metadata: Record<string, unknown> | null
  }>
  const userIds = usersWithEmail.map((u) => u.id)

  // Bulk pull communication_preferences (chunked to be safe with large IN())
  const prefsByUser = new Map<string, boolean>()
  const chunk = <T>(arr: T[], size: number): T[][] => {
    const out: T[][] = []
    for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
    return out
  }
  for (const ids of chunk(userIds, 500)) {
    if (ids.length === 0) continue
    const { data: prefs } = await adminClient
      .from('communication_preferences')
      .select('user_id, unsubscribed_all')
      .in('user_id', ids)
    for (const row of (prefs ?? []) as CommPrefRow[]) {
      prefsByUser.set(row.user_id, row.unsubscribed_all === true)
    }
  }

  // Bulk pull existing beta_launch communication_log entries to dedupe
  const alreadySent = new Set<string>()
  for (const ids of chunk(userIds, 500)) {
    if (ids.length === 0) continue
    const { data: sentRows } = await adminClient
      .from('communication_log')
      .select('user_id')
      .eq('message_type', 'beta_launch')
      .in('user_id', ids)
    for (const row of (sentRows ?? []) as CommLogRow[]) {
      alreadySent.add(row.user_id)
    }
  }

  // Pull profiles full_name in bulk for personalization (best effort)
  const nameByUser = new Map<string, string | null>()
  for (const ids of chunk(userIds, 500)) {
    if (ids.length === 0) continue
    const { data: profs } = await adminClient
      .from('profiles')
      .select('user_id, full_name')
      .in('user_id', ids)
    for (const row of (profs ?? []) as Array<{ user_id: string; full_name: string | null }>) {
      nameByUser.set(row.user_id, row.full_name)
    }
  }

  // Determine eligible users (with email, not unsubscribed, not previously sent)
  const eligible: EligibleUser[] = []
  for (const u of usersWithEmail) {
    if (alreadySent.has(u.id)) continue
    if (prefsByUser.get(u.id) === true) continue
    const metaName = (u.user_metadata?.full_name as string | undefined) ?? null
    eligible.push({
      user_id: u.id,
      email: u.email,
      full_name: nameByUser.get(u.id) ?? metaName,
    })
  }

  if (action === 'count') {
    return new Response(
      JSON.stringify({
        eligible: eligible.length,
        total_auth_users: allAuthUsers.length,
        with_email: usersWithEmail.length,
        already_sent: alreadySent.size,
        unsubscribed: Array.from(prefsByUser.values()).filter(Boolean).length,
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  }

  let sent = 0
  let failed = 0
  const skippedAlreadySent = alreadySent.size
  const skippedUnsubscribed = Array.from(prefsByUser.values()).filter(Boolean).length
  const errors: Array<{ user_id: string; error: string }> = []

  for (const user of eligible) {
    const firstName =
      user.full_name && user.full_name.trim().length > 0
        ? user.full_name.trim().split(/\s+/)[0]
        : undefined

    try {
      const resp = await fetch(`${supabaseUrl}/functions/v1/send-transactional-email`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${serviceKey}`,
        },
        body: JSON.stringify({
          templateName: 'beta-launch-welcome',
          recipientEmail: user.email,
          recipientUserId: user.user_id,
          idempotencyKey: `beta-launch-${user.user_id}`,
          templateData: { name: firstName },
        }),
      })

      if (!resp.ok) {
        const errText = await resp.text()
        failed++
        errors.push({ user_id: user.user_id, error: errText.slice(0, 200) })
        await adminClient.from('communication_log').insert({
          user_id: user.user_id,
          channel: 'email',
          message_type: 'beta_launch',
          status: 'failed',
          subject: 'You are in — PaigeAgent AI Beta is officially live 🎉',
          error_message: errText.slice(0, 500),
        })
        continue
      }

      sent++
      await adminClient.from('communication_log').insert({
        user_id: user.user_id,
        channel: 'email',
        message_type: 'beta_launch',
        status: 'queued',
        subject: 'You are in — PaigeAgent AI Beta is officially live 🎉',
        preview: 'Welcome to the PaigeAgent Beta — and thank you for being one of our founding members.',
      })
    } catch (err) {
      failed++
      const msg = err instanceof Error ? err.message : String(err)
      errors.push({ user_id: user.user_id, error: msg.slice(0, 200) })
    }
  }

  return new Response(
    JSON.stringify({
      success: true,
      total_profiles: usersWithEmail.length,
      total_auth_users: allAuthUsers.length,
      eligible: eligible.length,
      sent,
      skipped_already_sent: skippedAlreadySent,
      skipped_unsubscribed: skippedUnsubscribed,
      failed,
      errors: errors.slice(0, 20),
    }),
    { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
  )
})
