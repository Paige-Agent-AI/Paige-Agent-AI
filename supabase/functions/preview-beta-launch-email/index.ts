// Platform-Operator-only HTML preview of the beta-launch-welcome email template.
// Renders the same React Email component used by the live send pipeline,
// substituting a caller-provided sample recipient name so Antonio can
// review the final inbox-ready output before triggering the broadcast.

import * as React from 'npm:react@18.3.1'
import { renderAsync } from 'npm:@react-email/components@0.0.22'
import { requireOperator } from "../_shared/operatorAuth.ts";
import { TEMPLATES } from '../_shared/transactional-email-templates/registry.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
}

const TEMPLATE_NAME = 'beta-launch-welcome'

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

  // Platform Operator only (EXP08 stage 0, owner ruling 2026-10-26), from the VERIFIED JWT — the same
  // operator check send-beta-launch-email uses (systems-check-http operatorUserId). It used to admit
  // the global `admin` row, which an owner/admin seat in ANY workspace writes.
  const guard = await requireOperator(req)
  if (!guard.ok) return guard.response

  // Parse optional sample name from the body (POST) or query string (GET).
  let sampleName: string | undefined
  if (req.method === 'POST') {
    try {
      const body = await req.json()
      const raw = typeof body?.name === 'string' ? body.name.trim() : ''
      if (raw.length > 0 && raw.length <= 80) sampleName = raw
    } catch {
      // ignore — empty/invalid body just means render with no name
    }
  } else {
    const url = new URL(req.url)
    const raw = (url.searchParams.get('name') ?? '').trim()
    if (raw.length > 0 && raw.length <= 80) sampleName = raw
  }

  const entry = TEMPLATES[TEMPLATE_NAME]
  if (!entry) {
    return new Response(
      JSON.stringify({ error: `Template '${TEMPLATE_NAME}' is not registered` }),
      { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  }

  const previewProps = {
    ...(entry.previewData ?? {}),
    ...(sampleName ? { name: sampleName } : {}),
  }

  try {
    const html = await renderAsync(
      React.createElement(entry.component, previewProps),
    )
    const subject =
      typeof entry.subject === 'function' ? entry.subject(previewProps) : entry.subject

    return new Response(
      JSON.stringify({
        templateName: TEMPLATE_NAME,
        displayName: entry.displayName ?? TEMPLATE_NAME,
        subject,
        sampleName: sampleName ?? null,
        html,
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return new Response(
      JSON.stringify({ error: 'Render failed', message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  }
})
