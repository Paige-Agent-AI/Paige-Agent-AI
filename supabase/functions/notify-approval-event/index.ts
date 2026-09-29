// Notify admins/submitters of approval events.
// Triggered by DB triggers on paige_pending_approvals (insert + update→changes_requested).
// Creates in-app notifications (paige_admin_notifications) and sends transactional emails.
import { createClient } from 'npm:@supabase/supabase-js@2'
import { isAuthorizedInternalCaller, adminClient } from '../_shared/systems-check-http.ts'
import { canonicalAppUrl, resolveCanonicalAppPath } from '../_shared/canonical-app-url.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface Payload {
  event: 'created' | 'changes_requested'
  approval_id: string
  rationale?: string | null
}

function json(data: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders })
  // Internal only. This function forwards to send-transactional-email with the
  // service key, so an open door here was an open relay there: anyone holding the publishable key and an approval id could put their own words in the email. Its callers are the platform's
  // own crons and database triggers, which all send the service key.
  if (!(await isAuthorizedInternalCaller(req, adminClient()))) {
    return new Response(JSON.stringify({ error: 'forbidden' }), {
      status: 403,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const supabase = createClient(supabaseUrl, serviceKey)

  let body: Payload
  try {
    body = await req.json()
  } catch {
    return json({ error: 'invalid json' }, 400)
  }
  if (!body.approval_id || !body.event) return json({ error: 'event and approval_id required' }, 400)

  // Load approval
  const { data: approval, error: aErr } = await supabase
    .from('paige_pending_approvals')
    .select('id, category, summary, priority, risk_level, contact_id, submitted_by_user_id, requires_role, assigned_to_user_id, status')
    .eq('id', body.approval_id)
    .maybeSingle()

  if (aErr || !approval) return json({ error: 'approval not found' }, 404)

  // Resolve client name (optional)
  let clientName: string | undefined
  if (approval.contact_id) {
    const { data: c } = await supabase
      .from('clients')
      .select('first_name, last_name, business_name')
      .eq('id', approval.contact_id)
      .maybeSingle()
    if (c) {
      const full = [c.first_name, c.last_name].filter(Boolean).join(' ').trim()
      clientName = full || c.business_name || undefined
    }
  }

  // Resolve submitter name
  let submittedByName: string | undefined
  let submitterEmail: string | undefined
  if (approval.submitted_by_user_id) {
    const { data: prof } = await supabase
      .from('profiles')
      .select('display_name, first_name, last_name')
      .eq('user_id', approval.submitted_by_user_id)
      .maybeSingle()
    if (prof) {
      submittedByName =
        prof.display_name || [prof.first_name, prof.last_name].filter(Boolean).join(' ').trim() || undefined
    }
    const { data: au } = await supabase.auth.admin.getUserById(approval.submitted_by_user_id)
    submitterEmail = au?.user?.email ?? undefined
  }

  // Determine recipients
  type Recipient = { user_id: string; email?: string; name?: string; role: string }
  const recipients: Recipient[] = []

  if (body.event === 'created') {
    // Target by assigned_to_user_id, else requires_role, else all admins+super_admins
    if (approval.assigned_to_user_id) {
      const { data: au } = await supabase.auth.admin.getUserById(approval.assigned_to_user_id)
      const { data: p } = await supabase
        .from('profiles')
        .select('display_name, first_name, last_name')
        .eq('user_id', approval.assigned_to_user_id)
        .maybeSingle()
      recipients.push({
        user_id: approval.assigned_to_user_id,
        email: au?.user?.email ?? undefined,
        name: p?.display_name || [p?.first_name, p?.last_name].filter(Boolean).join(' ').trim() || undefined,
        role: approval.requires_role ?? 'admin',
      })
    } else {
      const role = approval.requires_role && approval.requires_role !== 'any'
        ? [approval.requires_role]
        : ['admin', 'super_admin']
      const { data: roleRows } = await supabase
        .from('user_roles')
        .select('user_id, role')
        .in('role', role)
      const userIds = Array.from(new Set((roleRows ?? []).map((r) => r.user_id as string)))
      for (const uid of userIds) {
        const roleRow = (roleRows ?? []).find((row) => row.user_id === uid)
        const { data: au } = await supabase.auth.admin.getUserById(uid)
        const { data: p } = await supabase
          .from('profiles')
          .select('display_name, first_name, last_name')
          .eq('user_id', uid)
          .maybeSingle()
        recipients.push({
          user_id: uid,
          email: au?.user?.email ?? undefined,
          name: p?.display_name || [p?.first_name, p?.last_name].filter(Boolean).join(' ').trim() || undefined,
          role: String(roleRow?.role ?? 'admin'),
        })
      }
    }
  } else if (body.event === 'changes_requested') {
    // Notify the original submitter
    if (approval.submitted_by_user_id) {
      recipients.push({
        user_id: approval.submitted_by_user_id,
        email: submitterEmail,
        name: submittedByName,
        role: 'submitter',
      })
    }
  }

  // Insert in-app notifications
  const title =
    body.event === 'created'
      ? `New approval — ${approval.category ?? 'request'}`
      : `Changes requested on your approval`
  const bodyText =
    body.event === 'created'
      ? `${approval.summary ?? 'An approval is waiting for review.'}${clientName ? ` (Client: ${clientName})` : ''}`
      : `${body.rationale ? `Reviewer note: ${body.rationale}\n\n` : ''}${approval.summary ?? ''}`
  const severity =
    approval.risk_level === 'blocker' || approval.priority === 1
      ? 'urgent'
      : approval.risk_level === 'high' || approval.priority === 2
        ? 'warning'
        : 'info'

  const operatorApprovalPath = resolveCanonicalAppPath({
    actor: 'operator', tier: 'operator', destination: 'approvals',
  })
  const notifRows = recipients.map((r) => ({
    severity,
    title,
    body: bodyText,
    link_to: r.role === 'super_admin' || r.role === 'platform_admin'
      ? operatorApprovalPath
      : null,
    source_workflow_key: `approval.${body.event}`,
    contact_id: approval.contact_id ?? null,
    assigned_role: r.role === 'submitter' ? null : r.role,
    assigned_user_id: r.user_id,
    scope: r.role === 'submitter' ? 'user' : 'admin',
  }))
  if (notifRows.length) {
    const { error: nErr } = await supabase.from('paige_admin_notifications').insert(notifRows)
    if (nErr) console.error('notif insert error', nErr)
  }

  // Send emails (one per recipient, with idempotency on approval+event+user)
  const emailResults: unknown[] = []
  for (const r of recipients) {
    if (!r.email) continue
    const approvalUrl = r.role === 'super_admin' || r.role === 'platform_admin'
      ? canonicalAppUrl({ actor: 'operator', tier: 'operator', destination: 'approvals' })
      : null
    try {
      const res = await fetch(`${supabaseUrl}/functions/v1/send-transactional-email`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${serviceKey}`,
        },
        body: JSON.stringify({
          templateName: 'approval-notification',
          recipientEmail: r.email,
          idempotencyKey: `approval-${body.event}-${approval.id}-${r.user_id}`,
          templateData: {
            recipientName: r.name,
            eventType: body.event,
            category: approval.category,
            summary: approval.summary,
            priority: approval.priority,
            riskLevel: approval.risk_level,
            clientName,
            submittedBy: submittedByName,
            rationale: body.rationale ?? null,
            approvalUrl,
          },
        }),
      })
      emailResults.push({ to: r.email, status: res.status })
    } catch (err) {
      emailResults.push({ to: r.email, error: (err as Error).message })
    }
  }

  return json({ success: true, recipients: recipients.length, emails: emailResults })
})
