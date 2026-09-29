// Ship #1 dispatcher.
// Receives a stage-change automation event from the on_deal_stage_change trigger,
// enforces §177 per-channel consent by mapping compose_intent → transactional|marketing,
// then POSTs a normalized payload to the tenant's (or platform's) webhook URL.
//
// compose_intent mapping (Option A — dispatcher translates):
//   transactional → transactional consent
//   notification  → transactional consent
//   marketing     → marketing consent
//   nurture       → marketing consent
//
// If consent required but missing, event status = 'skipped_no_consent' — never silent.

import { createClient } from "npm:@supabase/supabase-js@2";
import { emitAutomationRail } from "../_shared/railAutomation.ts";
import { CLIENT_CONTACT_METHODS_EMBED, clientAddresses } from "../_shared/contact-methods.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type Rule = {
  id: string;
  compose_intent: "transactional" | "marketing" | "nurture" | "notification";
  tone: string;
  template_hint: string | null;
  send_mode: "draft_for_review" | "auto_send";
};

interface Payload {
  event_id: string;
  webhook_url: string;
  tenant_id: string;
  deal_id: string | null;
  contact_id: string | null;
  from_stage_id: string | null;
  to_stage_id: string | null;
  rule: Rule;
}

const INTENT_TO_CONSENT: Record<Rule["compose_intent"], "transactional" | "marketing"> = {
  transactional: "transactional",
  notification: "transactional",
  marketing: "marketing",
  nurture: "marketing",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  let body: Payload;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "invalid_json" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const mark = async (status: string, extra: Record<string, unknown> = {}) => {
    await supabase
      .from("stage_automation_events")
      .update({ status, dispatched_at: new Date().toISOString(), ...extra })
      .eq("id", body.event_id);
  };

  try {
    // Consent gate (contact optional — only enforce when contact resolves to a real recipient)
    if (body.contact_id) {
      const { data: client } = await supabase
        .from("clients")
        .select(`linked_user_id, ${CLIENT_CONTACT_METHODS_EMBED}`)
        .eq("id", body.contact_id)
        .maybeSingle();

      // Consent is checked against the contact's PRIMARY email — the address a send goes to.
      const email = clientAddresses(client)?.email?.toLowerCase().trim();
      if (email) {
        const consentKind = INTENT_TO_CONSENT[body.rule.compose_intent];
        const rpc =
          consentKind === "marketing"
            ? "has_email_marketing_consent"
            : null; // transactional is universally allowed by relationship
        if (rpc) {
          const { data: hasConsent } = await supabase.rpc(rpc, { _email: email });
          if (hasConsent === false) {
            await mark("skipped_no_consent", { error: `${consentKind} consent missing` });
            return new Response(JSON.stringify({ status: "skipped_no_consent" }), {
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
          }
        }
      }
    }

    // Normalize payload for downstream (n8n / Zapier / Make / custom endpoint)
    const outbound = {
      event: "stage_change",
      event_id: body.event_id,
      tenant_id: body.tenant_id,
      deal_id: body.deal_id,
      contact_id: body.contact_id,
      from_stage_id: body.from_stage_id,
      to_stage_id: body.to_stage_id,
      rule: {
        id: body.rule.id,
        compose_intent: body.rule.compose_intent,
        consent_class: INTENT_TO_CONSENT[body.rule.compose_intent],
        tone: body.rule.tone,
        template_hint: body.rule.template_hint,
        send_mode: body.rule.send_mode,
      },
      dispatched_at: new Date().toISOString(),
    };

    const res = await fetch(body.webhook_url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(outbound),
    });

    const responseText = await res.text().catch(() => "");
    const parsed = safeJson(responseText);

    if (!res.ok) {
      await mark("failed", {
        webhook_response: parsed ?? { raw: responseText.slice(0, 500) },
        error: `webhook ${res.status}`,
      });
      return new Response(JSON.stringify({ status: "failed", http: res.status }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    await mark("dispatched", {
      webhook_response: parsed ?? { raw: responseText.slice(0, 500) },
    });

    // Rail (owner_ops) — the stage automation fired for this client. Fire-and-forget
    // to a downstream webhook, so completion isn't observable here → fired only.
    // Best-effort + non-blocking (§13); tenant + contact are explicit on the event.
    if (body.contact_id) {
      await emitAutomationRail(supabase, {
        tenantId: body.tenant_id,
        contactId: body.contact_id,
        workflowName: "stage change follow-up",
        phase: "fired",
        refTable: "stage_automation_events",
        refId: body.event_id,
      });
    }

    return new Response(JSON.stringify({ status: "dispatched" }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    await mark("failed", { error: String((err as Error).message ?? err) });
    return new Response(JSON.stringify({ error: String((err as Error).message ?? err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

function safeJson(text: string): Record<string, unknown> | null {
  try { return JSON.parse(text); } catch { return null; }
}
