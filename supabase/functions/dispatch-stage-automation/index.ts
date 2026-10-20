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
//
// Callers: only the on_deal_stage_change trigger, with the service-role key (#2087). Any other bearer is
// refused before the body is read: the body names the tenant, the contact and the webhook to call.
// Marketing consent is the business's own ledger (paige_consent_events via _shared/tenant-consent.ts):
// default-deny, and a ledger that cannot be read holds the event rather than sending.

// Contact opt-outs (E09 Slice 6): see gate.ts. A contact who turned a channel off themselves is skipped
// for every intent; channels the business has paused are named in the payload.

import { createClient } from "npm:@supabase/supabase-js@2";
import { emitAutomationRail } from "../_shared/railAutomation.ts";
import { INTENT_TO_CONSENT, stageAutomationGate } from "./gate.ts";

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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const bearer = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!serviceKey || bearer !== serviceKey) {
    return new Response(JSON.stringify({ error: "forbidden" }), {
      status: 403,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, serviceKey);

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
    // Opt-out gate, then the marketing consent gate (gate.ts). A skip is recorded, never silent.
    const gate = await stageAutomationGate(supabase, body);
    if (gate.kind === "skip") {
      await mark(gate.status, { error: gate.error });
      return new Response(JSON.stringify({ status: gate.status, reason: gate.reason }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
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
      // Channels this contact must not be messaged on (a business pause or a delivery block). The outside
      // sender never sees the suppression list, so it is told here.
      contact_opted_out_channels: gate.optedOutChannels,
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
