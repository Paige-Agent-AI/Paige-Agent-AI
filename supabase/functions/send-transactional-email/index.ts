import * as React from 'npm:react@18.3.1'
import { renderAsync } from 'npm:@react-email/components@0.0.22'
import { createClient } from 'npm:@supabase/supabase-js@2'
import { TEMPLATES } from '../_shared/transactional-email-templates/registry.ts'
import { resolveTenantEmailContext } from '../_shared/email/branding.ts'
import { decideSendAuthority } from '../_shared/email/send-authority.ts'
import { isAuthorizedInternalCaller, adminClient, operatorUserId } from '../_shared/systems-check-http.ts'
import { primaryEmailForUser } from '../_shared/user-contact-methods.ts'
import { overRateLimit } from '../_shared/rateLimit.ts'
import { createClient as createLimiterClient } from 'https://esm.sh/@supabase/supabase-js@2'

// The shared public rate limiter is typed against its own supabase-js build.
const limiterClient = () =>
  createLimiterClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false },
  })

// Configuration baked in at scaffold time — do NOT change these manually.
// To update, re-run the email domain setup flow.
const SITE_NAME = "Paige Agent AI"
// SENDER_DOMAIN is the verified sender subdomain FQDN (e.g., "notify.example.com").
// It MUST match the subdomain delegated to Lovable's nameservers — never the root domain.
// The email API looks up this exact domain; a mismatch causes "No email domain record found".
const SENDER_DOMAIN = "paigeagent.ai"
// FROM_DOMAIN is the domain shown in the From: header. It MUST align with SENDER_DOMAIN
// (same subdomain, or the SENDER_ROOT). A different subdomain (e.g., mail.example.com while
// SENDER_DOMAIN is notify.example.com) triggers a provider 400 sender_domain_mismatch.
// Tier 1 (#64): the domain VERIFIED in Resend for sending is the subdomain
// mail.paigeagent.ai — the bare apex is not a confirmed sending domain. The From:
// header + the no-tenant / unaligned fallbacks below must use the verified
// subdomain so Resend never rejects a fallback send. SENDER_DOMAIN/SENDER_ROOT
// stay the apex root so fromAddressAligns() still accepts any *.paigeagent.ai.
const FROM_DOMAIN = "mail.paigeagent.ai"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
}

// Generate a cryptographically random 32-byte hex token
function generateToken(): string {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input))
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

// Auth: the gateway's verify_jwt accepts ANY validly signed token, including the publishable key
// that ships in the public site, so it is not an authorization check. Every request is decided
// in-body by `decideSendAuthority` (_shared/email/send-authority.ts) before anything is rendered,
// logged or sent: internal platform callers may send any template; a verified person may send only
// the templates listed there, to a recipient bound on the server; everyone else is refused.

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

  if (!supabaseUrl || !supabaseServiceKey) {
    console.error('Missing required environment variables')
    return new Response(
      JSON.stringify({ error: 'Server configuration error' }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    )
  }

  // Parse request body
  let templateName: string
  let recipientEmail: string
  let recipientUserId: string | null = null
  let idempotencyKey: string
  let messageId: string
  let templateData: Record<string, any> = {}
  let tenantId: string | null = null
  let fromOverride: string | null = null
  let replyToOverride: string | null = null
  let soloFulfillmentEventId: string | null = null
  let relationshipId: string | null = null
  try {
    const body = await req.json()
    templateName = body.templateName || body.template_name
    recipientEmail = body.recipientEmail || body.recipient_email
    recipientUserId = body.recipientUserId || body.recipient_user_id || null
    messageId = crypto.randomUUID()
    idempotencyKey = body.idempotencyKey || body.idempotency_key || messageId
    if (body.templateData && typeof body.templateData === 'object') {
      templateData = body.templateData
    }
    tenantId = body.tenantId || body.tenant_id || null
    fromOverride = body.fromOverride || body.from_override || null
    replyToOverride = body.replyToOverride || body.reply_to_override || null
    soloFulfillmentEventId = body.fulfillmentEventId || body.fulfillment_event_id || null
    relationshipId = body.relationshipId || body.relationship_id || null
  } catch {
    return new Response(
      JSON.stringify({ error: 'Invalid JSON in request body' }),
      {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    )
  }

  const authority = await decideSendAuthority(
    { templateName, recipientEmail: recipientEmail || null, recipientUserId, relationshipId },
    {
      isInternalCaller: () => isAuthorizedInternalCaller(req, adminClient()),
      verifiedUserId: async () => {
        const authorization = req.headers.get('Authorization') ?? ''
        if (!authorization.startsWith('Bearer ')) return null
        const anonKey = Deno.env.get('SUPABASE_ANON_KEY')
        if (!anonKey) return null
        const caller = createClient(supabaseUrl, anonKey, {
          global: { headers: { Authorization: authorization } },
          auth: { persistSession: false },
        })
        const { data, error } = await caller.auth.getUser()
        return error ? null : data?.user?.id ?? null
      },
      callerIsOperator: async () => (await operatorUserId(req)) !== null,
      primaryEmail: (userId) => primaryEmailForUser(adminClient(), userId),
      brokerRelationship: async (id) => {
        // Read AS THE CALLER: row-level security on broker_client_relationships decides who may
        // see — and therefore write to — a client (the owning broker, their team, an operator).
        const caller = createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY') ?? '', {
          global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
          auth: { persistSession: false },
        })
        const { data: rel } = await caller
          .from('broker_client_relationships')
          .select('client_email, client_first_name, broker_id')
          .eq('id', id)
          .maybeSingle()
        const row = rel as { client_email?: string; client_first_name?: string | null; broker_id?: string } | null
        if (!row?.client_email || !row.broker_id) return null
        // The broker's profile and role are read with the service role: a broker profile is
        // self-serve, the `broker` role is granted only by a platform operator.
        const admin = adminClient()
        const { data: bp } = await admin
          .from('broker_profiles')
          .select('user_id, business_name, referral_code')
          .eq('id', row.broker_id)
          .maybeSingle()
        const profile = bp as { user_id?: string; business_name?: string | null; referral_code?: string | null } | null
        if (!profile?.user_id) return null
        const { data: granted } = await admin.rpc('has_role', { _user_id: profile.user_id, _role: 'broker' })
        return {
          clientEmail: row.client_email,
          clientFirstName: row.client_first_name ?? null,
          businessName: profile.business_name ?? null,
          referralCode: profile.referral_code ?? null,
          brokerIsGranted: granted === true,
        }
      },
      overHourlyLimit: (userId, template, max) =>
        overRateLimit(limiterClient(), `ste:${template}:${userId}`, max, 3600, true),
    },
  )
  if (!authority.ok) {
    return new Response(JSON.stringify({ error: authority.error }), {
      status: authority.status,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
  if (authority.kind === 'user') {
    // A person never chooses where the mail goes (beyond what their policy allows), who it claims
    // to be from, where replies land, or whose brand it wears.
    recipientEmail = authority.recipientEmail
    recipientUserId = authority.recipientUserId
    fromOverride = null
    replyToOverride = null
    tenantId = null
    if (authority.templateData) templateData = authority.templateData
  }

  // Solo Beta welcome is an internal mode of the existing transactional sender.
  // The caller supplies only the immutable event id; all authority is re-derived.
  if (templateName === 'solo-beta-welcome') {
    const authorization = req.headers.get('Authorization') ?? ''
    if (authorization !== 'Bearer ' + supabaseServiceKey || !soloFulfillmentEventId) {
      return new Response(JSON.stringify({ error: 'service_role_required' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }
    const admin = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { persistSession: false },
    })
    const { data: claimRows, error: claimError } = await admin.rpc('solo_beta_claim_welcome_delivery', {
      _event_id: soloFulfillmentEventId,
    })
    if (claimError) {
      console.error('Solo welcome claim failed', {
        code: 'welcome_claim_failed',
      })
      return new Response(JSON.stringify({ error: 'welcome_claim_failed' }), {
        status: 503,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }
    const claim = Array.isArray(claimRows) ? claimRows[0] : claimRows
    if (!claim?.claimed) {
      const ok = claim?.lifecycle_state === 'sent'
      return new Response(
        JSON.stringify({
          success: ok,
          sent: ok,
          duplicate: ok,
          state: claim?.lifecycle_state ?? 'unavailable',
        }),
        {
          status: ok ? 200 : 409,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        },
      )
    }
    const failClaim = async (code: string, ambiguous = false) => {
      await admin.rpc('solo_beta_fail_welcome_delivery', {
        _delivery_id: claim.delivery_id,
        _claim_token: claim.claim_token,
        _error_code: /^[a-z0-9_]{1,80}$/i.test(code) ? code : 'welcome_delivery_failed',
        _ambiguous: ambiguous,
      })
    }
    const template = TEMPLATES['solo-beta-welcome']
    const publicSite = (Deno.env.get('PUBLIC_SITE_URL') ?? 'https://paigeagent.ai').replace(/\/$/, '')
    const destination = publicSite + '/solo/' + claim.account_number + '/command-center'
    const renderData = {
      name: claim.recipient_name,
      destination,
      referenceId: claim.reference_id,
      subscriptionStatus: claim.subscription_status,
      trialEndsAt: claim.trial_ends_at,
    }
    const html = await renderAsync(React.createElement(template.component, renderData))
    const plainText = await renderAsync(React.createElement(template.component, renderData), { plainText: true })
    const messageId = claim.message_id as string

    const { data: priorSent } = await admin.from('email_send_log').select('message_id,metadata').eq('message_id', messageId).eq('status', 'sent').maybeSingle()
    if (priorSent) {
      const providerId = (priorSent.metadata as Record<string, unknown> | null)?.vendor_message_id
      const { error: completeError } = await admin.rpc('solo_beta_complete_welcome_delivery', {
        _delivery_id: claim.delivery_id,
        _claim_token: claim.claim_token,
        _provider_message_id: typeof providerId === 'string' ? providerId : 'provider-accepted',
      })
      if (completeError)
        return new Response(JSON.stringify({ error: 'welcome_receipt_failed' }), {
          status: 503,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      return new Response(JSON.stringify({ success: true, sent: true, duplicate: true }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const { data: suppressed, error: suppressionError } = await admin.from('suppressed_emails').select('id').eq('email', String(claim.recipient_email).toLowerCase()).or('reason.neq.unsubscribe,reason.is.null').maybeSingle()
    if (suppressionError || suppressed) {
      await failClaim(suppressionError ? 'suppression_check_failed' : 'recipient_suppressed')
      return new Response(JSON.stringify({ error: 'welcome_delivery_blocked' }), {
        status: suppressionError ? 503 : 409,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const resendKey = Deno.env.get('RESEND_API_KEY')
    if (!resendKey) {
      await failClaim('email_provider_unconfigured')
      return new Response(JSON.stringify({ error: 'email_provider_unconfigured' }), {
        status: 503,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const { error: pendingLogError } = await admin.from('email_send_log').upsert({
      message_id: messageId,
      template_name: 'solo-beta-welcome',
      recipient_email: claim.recipient_email,
      status: 'pending',
      tenant_id: claim.tenant_id,
      error_message: null,
      metadata: {
        reference_id: claim.reference_id,
        fulfillment_event_id: soloFulfillmentEventId,
      },
    }, { onConflict: 'message_id' })
    if (pendingLogError) {
      await failClaim('send_log_prepare_failed')
      return new Response(JSON.stringify({ error: 'welcome_receipt_failed' }), {
        status: 503,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    let response: Response
    try {
      response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + resendKey,
          'Content-Type': 'application/json',
          'Idempotency-Key': messageId,
        },
        body: JSON.stringify({
          from: SITE_NAME + ' <notifications@' + FROM_DOMAIN + '>',
          to: [claim.recipient_email],
          subject: typeof template.subject === 'function' ? template.subject(renderData) : template.subject,
          html,
          text: plainText,
        }),
      })
    } catch {
      await failClaim('provider_outcome_ambiguous', true)
      return new Response(JSON.stringify({ error: 'welcome_delivery_uncertain' }), {
        status: 503,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const providerBody = (await response.json().catch(() => ({}))) as {
      id?: string
    }
    if (!response.ok || !providerBody.id) {
      await admin
        .from('email_send_log')
        .update({
          status: 'failed',
          error_message: 'resend_' + response.status,
        })
        .eq('message_id', messageId)
        .eq('status', 'pending')
      await failClaim('provider_rejected')
      return new Response(JSON.stringify({ error: 'send_failed' }), {
        status: 502,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const { error: logError } = await admin
      .from('email_send_log')
      .update({
        status: 'sent',
        metadata: {
          reference_id: claim.reference_id,
          fulfillment_event_id: soloFulfillmentEventId,
          vendor_message_id: providerBody.id,
        },
      })
      .eq('message_id', messageId)
      .eq('status', 'pending')
    if (logError) {
      await failClaim('send_log_commit_failed', true)
      return new Response(JSON.stringify({ error: 'welcome_receipt_failed' }), {
        status: 503,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const { error: completeError } = await admin.rpc('solo_beta_complete_welcome_delivery', {
      _delivery_id: claim.delivery_id,
      _claim_token: claim.claim_token,
      _provider_message_id: providerBody.id,
    })
    if (completeError) {
      return new Response(JSON.stringify({ error: 'welcome_receipt_failed' }), {
        status: 503,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }
    return new Response(JSON.stringify({ success: true, sent: true }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
  if (!templateName) {
    return new Response(
      JSON.stringify({ error: 'templateName is required' }),
      {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    )
  }

  // 1. Look up template from registry (early — needed to resolve recipient)
  const template = TEMPLATES[templateName]

  if (!template) {
    console.error('Template not found in registry', { templateName })
    return new Response(
      JSON.stringify({
        error: `Template '${templateName}' not found. Available: ${Object.keys(TEMPLATES).join(', ')}`,
      }),
      {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    )
  }

  // Resolve effective recipient: template-level `to` takes precedence over
  // the caller-provided recipientEmail. This allows notification templates
  // to always send to a fixed address (e.g., site owner from env var).
  const effectiveRecipient = template.to || recipientEmail

  if (!effectiveRecipient) {
    return new Response(
      JSON.stringify({
        error: 'recipientEmail is required (unless the template defines a fixed recipient)',
      }),
      {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    )
  }

  // Create Supabase client with service role (bypasses RLS)
  const supabase = createClient(supabaseUrl, supabaseServiceKey)

  // 1b. Affiliate-program preference gate.
  // Only enforced when caller passed recipientUserId (e.g., approved/conversion/paid/monthly).
  // A confirmation for someone with no account yet (an affiliate application, sent by
  // affiliate-application-confirm on the applicant's behalf) skips it: there is no user to look up.
  const isAffiliateTemplate = templateName.startsWith('affiliate-') || templateName === 'elite-waitlist-confirmed'
  if (isAffiliateTemplate && recipientUserId) {
    try {
      const { data: prefs } = await supabase
        .from('communication_preferences')
        .select('email_enabled, email_affiliate_program, unsubscribed_all')
        .eq('user_id', recipientUserId)
        .maybeSingle()
      if (prefs && (prefs.unsubscribed_all || !prefs.email_enabled || prefs.email_affiliate_program === false)) {
        await supabase.from('email_send_log').insert({
          message_id: messageId,
          template_name: templateName,
          recipient_email: effectiveRecipient,
          status: 'suppressed',
          error_message: 'Affiliate program emails disabled by user preference',
        })
        return new Response(
          JSON.stringify({ success: false, reason: 'affiliate_emails_disabled' }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
        )
      }
    } catch (e) {
      console.warn('Affiliate prefs lookup failed (proceeding to send)', { error: String(e) })
    }
  }

  // 2. Check suppression list (fail-closed: if we can't verify, don't send).
  // Suppression is SCOPED BY CATEGORY: transactional/security mail (email OTP,
  // sign-out alerts, role/broker invites, approvals) must ALWAYS deliver, so a
  // user who opted out of BULK mail (reason='unsubscribe') is NOT suppressed for
  // transactional sends — only hard reasons (bounce/complaint, and any null-reason
  // row) block those. Bulk mail honors every suppression, unsubscribe included.
  // Without this, one bulk unsubscribe would silently kill a user's OTP/invite
  // mail and lock them out.
  let suppressionQuery = supabase
    .from('suppressed_emails')
    .select('id')
    .eq('email', effectiveRecipient.toLowerCase())
  if (template.category !== 'bulk') {
    suppressionQuery = suppressionQuery.or('reason.neq.unsubscribe,reason.is.null')
  }
  const { data: suppressed, error: suppressionError } = await suppressionQuery.maybeSingle()

  if (suppressionError) {
    console.error('Suppression check failed — refusing to send', {
      error: suppressionError,
      effectiveRecipient,
    })
    return new Response(
      JSON.stringify({ error: 'Failed to verify suppression status' }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    )
  }

  if (suppressed) {
    // Log the suppressed attempt
    await supabase.from('email_send_log').insert({
      message_id: messageId,
      template_name: templateName,
      recipient_email: effectiveRecipient,
      status: 'suppressed',
    })

    console.log('Email suppressed', { effectiveRecipient, templateName })
    return new Response(
      JSON.stringify({ success: false, reason: 'email_suppressed' }),
      {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    )
  }

  // 3. Generate fresh unsubscribe token (stored hashed; plaintext only sent in email)
  const normalizedEmail = effectiveRecipient.toLowerCase()
  const unsubscribeToken = generateToken()
  const unsubscribeTokenHash = await sha256Hex(unsubscribeToken)

  const { error: tokenError } = await supabase
    .from('email_unsubscribe_tokens')
    .upsert(
      { token_hash: unsubscribeTokenHash, email: normalizedEmail, used_at: null },
      { onConflict: 'email' }
    )

  if (tokenError) {
    console.error('Failed to upsert unsubscribe token hash', { error: tokenError })
    await supabase.from('email_send_log').insert({
      message_id: messageId,
      template_name: templateName,
      recipient_email: effectiveRecipient,
      status: 'failed',
      error_message: 'Failed to create unsubscribe token',
    })
    return new Response(
      JSON.stringify({ error: 'Failed to prepare email' }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    )
  }

  // 3b. Deliverability class + unsubscribe surfaces.
  // Only 'bulk' mail (notifications/marketing) gets an opt-out; 'transactional'
  // security/OTP/invite/receipt mail never does. The token is single-use and its
  // plaintext form is only ever surfaced here (the DB stores the SHA-256 hash).
  const isBulk = template.category === 'bulk'
  // Visible footer link → the SPA /unsubscribe page (validate-then-confirm flow),
  // on the platform-level public site, never a tenant domain (§2).
  const PUBLIC_SITE_URL = (Deno.env.get('PUBLIC_SITE_URL') ?? 'https://paigeagent.ai').replace(/\/$/, '')
  const unsubscribePageUrl = `${PUBLIC_SITE_URL}/unsubscribe?token=${unsubscribeToken}`
  // RFC 8058 one-click target → the edge function directly (verify_jwt=false so
  // Gmail's JWT-less POST reaches it), which performs the suppression on POST.
  const unsubscribeOneClickUrl = `${supabaseUrl}/functions/v1/handle-email-unsubscribe?token=${unsubscribeToken}`

  // Resolve the recipient's tenant so every email reflects THEIR brand, not the
  // shared Paige default (§6/§9). Caller-provided tenantId always wins; otherwise
  // resolve from the recipient's profile / active membership. Runs BEFORE the render
  // so the tenant brand can thread into the template props below.
  if (!tenantId) {
    try {
      let uid = recipientUserId
      if (!uid) {
        const { data: u } = await supabase
          .from('profiles')
          .select('id')
          .eq('email', effectiveRecipient)
          .maybeSingle()
        uid = (u as any)?.id ?? null
      }
      if (uid) {
        const { data: prof } = await supabase
          .from('profiles')
          .select('active_tenant_id')
          .eq('id', uid)
          .maybeSingle()
        tenantId = (prof as any)?.active_tenant_id ?? null
        if (!tenantId) {
          const { data: mem } = await supabase
            .from('tenant_members')
            .select('tenant_id')
            .eq('user_id', uid)
            .eq('status', 'active')
            .order('created_at', { ascending: true })
            .limit(1)
            .maybeSingle()
          tenantId = (mem as any)?.tenant_id ?? null
        }
      }
    } catch (e) {
      console.warn('tenant auto-resolve failed', e)
    }
  }

  // Resolve the tenant's email brand tokens (logo + name). Present-only: logoUrl is
  // null when unset (no Paige floor); brandName is the tenant's OWN name, else the
  // platform default. Opt-in templates (coaching-reminder, role-invitation) render
  // these; platform templates ignore them and keep their own Paige identity (§37).
  let brandProps: { brandLogoUrl: string | null; brandName: string } | null = null
  try {
    const { branding } = await resolveTenantEmailContext(supabase, tenantId)
    brandProps = { brandLogoUrl: branding.logoUrl, brandName: branding.brandName }
  } catch (e) {
    console.warn('tenant email brand resolve failed', e)
  }

  // Inject the visible opt-out link into the render props for bulk mail only, so
  // the shared EmailFooter renders it. Transactional templates never receive it.
  // brandProps spread FIRST so any explicit brand a caller passes in templateData
  // still wins (§37 backward-compat: unknown props are ignored by templates that
  // don't destructure them).
  const renderData = isBulk
    ? { ...brandProps, ...templateData, unsubscribeUrl: unsubscribePageUrl }
    : { ...brandProps, ...templateData }

  // 4. Render React Email template to HTML and plain text
  const html = await renderAsync(
    React.createElement(template.component, renderData)
  )
  const plainText = await renderAsync(
    React.createElement(template.component, renderData),
    { plainText: true }
  )

  // Resolve subject — supports static string or dynamic function
  const resolvedSubject =
    typeof template.subject === 'function'
      ? template.subject(templateData)
      : template.subject

  // 5. Resolve sender identity.
  // Default: shared Paige subdomain with the project's From name.
  // If a tenantId is provided, look up the tenant's sender identity so each
  // tenant's invites/notifications show their own name in the From header.
  // Explicit fromOverride / replyToOverride always win.
  //
  // SENDER-DOMAIN ALIGNMENT GUARD: the Lovable Email API rejects sends whose
  // From-address domain does not align with the verified sender_domain. A
  // tenant override pointing at an unregistered domain (e.g. portal.mogulmakeracademy.com
  // while sender_domain is paigeagent.ai) used to silently fail with
  // sender_domain_mismatch. We now validate alignment and fall back to the
  // safe default rather than enqueue a doomed send.
  const SENDER_ROOT = SENDER_DOMAIN.split('.').slice(-2).join('.') // paigeagent.ai -> paigeagent.ai
  const fromAddressAligns = (addr: string): boolean => {
    const m = addr.match(/<([^>]+)>|([^\s]+@[^\s]+)/)
    const email = (m?.[1] ?? m?.[2] ?? addr).trim()
    const domain = email.split('@')[1]?.toLowerCase() ?? ''
    if (!domain) return false
    return domain === SENDER_DOMAIN || domain === SENDER_ROOT || domain.endsWith('.' + SENDER_ROOT)
  }

  // tenantId is already resolved above (before the render, so its brand could thread
  // into the template). The sender-identity resolution below reuses it.
  let resolvedFrom = `${SITE_NAME} <notifications@${FROM_DOMAIN}>`
  let resolvedReplyTo: string | null = null
  if (tenantId) {
    const { data: senderRow } = await supabase.rpc('tenant_sender_identity', {
      _tenant_id: tenantId,
    })
    const sender = (senderRow ?? null) as
      | { from_name?: string; from_address?: string; reply_to?: string; tenant_name?: string }
      | null
    if (sender?.from_name && sender?.from_address) {
      const candidate = `${sender.from_name} <${sender.from_address}>`
      if (fromAddressAligns(candidate)) {
        resolvedFrom = candidate
        resolvedReplyTo = sender.reply_to ?? null
      } else {
        // Address domain isn't verified for sending, but we can still honor
        // the tenant's display name by swapping in the aligned fallback address.
        const displayName = sender.from_name || sender.tenant_name || SITE_NAME
        resolvedFrom = `${displayName} <notifications@${FROM_DOMAIN}>`
        resolvedReplyTo = sender.reply_to ?? null
        console.warn('tenant from-address unaligned — kept tenant display name with default address', {
          tenant_id: tenantId,
          tenant_from: sender.from_address,
          sender_domain: SENDER_DOMAIN,
        })
      }
    }
  }
  if (fromOverride && fromAddressAligns(fromOverride)) resolvedFrom = fromOverride
  if (replyToOverride) resolvedReplyTo = replyToOverride

  // 6. Send directly via Resend. The old async path (enqueue_email →
  // process-email-queue, which sent via Lovable) was never deployed, so
  // transactional email silently never left the building — "sent" only ever
  // meant "queued into a black hole." Send inline via Resend (same proven path
  // as send-message), record the REAL outcome, and retire the Lovable worker (#79).
  const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')

  // IDEMPOTENCY — PERSISTED, DELIBERATELY NOT ACTED ON, and that is the §37 answer rather than a
  // half-measure. The first version of this short-circuited on a prior `sent` row with the same key.
  // The producer inventory then found the key is not unique per intended send for callers that
  // already exist: `notify-team-event` falls back to `contact-${contact}-${coach}` with no event id,
  // so re-assigning a contact back to a coach suppresses the notice forever; `invite-affiliate` uses
  // `affiliate-invite-${affiliateId}` and deliberately REUSES the profile row, so re-inviting — the
  // normal repair path, which mints a fresh recovery link — silently drops the email and still
  // reports success. Scoping by recipient and template does not save the second one. A suppressed
  // legitimate email is far worse than a duplicate, so the key is stored for observability and the
  // dedup lands only when those callers carry keys that identify the send. Callers must not describe
  // this parameter as a guarantee.
  // Log the attempt up front so there's always a record.
  await supabase.from('email_send_log').insert({
    message_id: messageId,
    template_name: templateName,
    recipient_email: effectiveRecipient,
    status: 'pending',
    tenant_id: tenantId,
    idempotency_key: idempotencyKey,
    metadata: { from: resolvedFrom, reply_to: resolvedReplyTo },
  })

  if (!RESEND_API_KEY) {
    await supabase.from('email_send_log').update({ status: 'failed', error_message: 'RESEND_API_KEY not set' }).eq('message_id', messageId)
    return new Response(JSON.stringify({ error: 'email_provider_unconfigured' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  // List-Unsubscribe headers (RFC 2369 + RFC 8058 one-click). Attached to BULK
  // mail ONLY — never to transactional/security mail, which must not advertise an
  // opt-out. The mailto is a fixed platform mailbox, not a tenant address (§2).
  const listUnsubscribeHeaders = isBulk
    ? {
        'List-Unsubscribe': `<${unsubscribeOneClickUrl}>, <mailto:unsubscribe@mail.paigeagent.ai>`,
        'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
      }
    : undefined

  let sendOk = false
  let vendorId: string | null = null
  let sendError: string | null = null
  try {
    const resendResp = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: resolvedFrom,
        to: [effectiveRecipient],
        subject: resolvedSubject,
        html,
        text: plainText,
        ...(resolvedReplyTo ? { reply_to: resolvedReplyTo } : {}),
        ...(listUnsubscribeHeaders ? { headers: listUnsubscribeHeaders } : {}),
      }),
    })
    const resendJson: any = await resendResp.json().catch(() => ({}))
    if (resendResp.ok && resendJson?.id) {
      sendOk = true
      vendorId = resendJson.id
    } else {
      sendError = `resend_${resendResp.status}: ${JSON.stringify(resendJson).slice(0, 300)}`
    }
  } catch (e) {
    sendError = (e as Error).message?.slice(0, 300) ?? 'resend_request_failed'
  }

  await supabase.from('email_send_log').update({
    status: sendOk ? 'sent' : 'failed',
    error_message: sendError,
    metadata: { from: resolvedFrom, reply_to: resolvedReplyTo, vendor_message_id: vendorId },
  }).eq('message_id', messageId)

  if (!sendOk) {
    console.error('Transactional email send failed', { templateName, effectiveRecipient, sendError })
    return new Response(JSON.stringify({ error: 'send_failed', detail: sendError }), {
      status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  console.log('Transactional email sent via Resend', { templateName, effectiveRecipient, vendorId })
  return new Response(
    JSON.stringify({ success: true, sent: true, id: vendorId }),
    { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  )
})
