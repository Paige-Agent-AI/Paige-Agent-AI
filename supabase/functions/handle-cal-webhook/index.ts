// Cal.com webhook receiver.
// Verifies X-Cal-Signature-256, upserts paige_bookings, fires booking_created.
import { adminClient, corsHeaders, jsonResponse } from "../_shared/adminAuth.ts";
import { verifyHmacSha256Hex } from "../_shared/webhookSig.ts";
import { fireAndForgetBridge } from "../_shared/mmaOsBridge.ts";
import { findSoleClientByEmailAnyWorkspace } from "../_shared/contact-methods.ts";

type EventTypeKey = "vip_intro" | "dfy_discovery" | "coffee_hour" | "workshop" | "other";

function statusFromTrigger(trigger: string): string {
  const t = trigger.toLowerCase();
  if (t.includes("cancel")) return "canceled";
  if (t.includes("reschedul")) return "rescheduled";
  if (t.includes("no_show") || t.includes("noshow")) return "no_show";
  if (t.includes("completed") || t.includes("ended")) return "completed";
  return "confirmed";
}

function classifyEventType(
  cal_event_type_id: string | null,
  title: string | null,
  map: Record<string, EventTypeKey>,
): EventTypeKey {
  if (cal_event_type_id && map[cal_event_type_id]) return map[cal_event_type_id];
  const t = (title ?? "").toLowerCase();
  if (t.includes("vip")) return "vip_intro";
  if (t.includes("dfy") || t.includes("discovery")) return "dfy_discovery";
  if (t.includes("coffee")) return "coffee_hour";
  if (t.includes("workshop")) return "workshop";
  return "other";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "method_not_allowed" }, 405);

  const raw = await req.text();
  const secret = Deno.env.get("CAL_WEBHOOK_SECRET");
  if (!secret) return jsonResponse({ error: "webhook_not_configured" }, 500);
  const sig = req.headers.get("x-cal-signature-256");
  const ok = await verifyHmacSha256Hex(secret, raw, sig);
  if (!ok) return jsonResponse({ error: "invalid_signature" }, 401);

  let payload: any;
  try { payload = JSON.parse(raw); } catch { return jsonResponse({ error: "invalid_json" }, 400); }

  const trigger = String(payload?.triggerEvent ?? payload?.event ?? "BOOKING_CREATED");
  const data = payload?.payload ?? payload;

  const calEventId = String(data?.uid ?? data?.id ?? data?.bookingId ?? "");
  if (!calEventId) return jsonResponse({ ok: true, skipped: "no_id" });

  const calEventTypeId = data?.eventTypeId ? String(data.eventTypeId) : null;
  const title: string | null = data?.title ?? data?.eventType?.title ?? null;
  const startTime: string = data?.startTime ?? data?.start ?? new Date().toISOString();
  const endTime: string | undefined = data?.endTime ?? data?.end;
  const durationMin = endTime
    ? Math.max(1, Math.round((new Date(endTime).getTime() - new Date(startTime).getTime()) / 60000))
    : data?.length ?? null;

  const attendee = Array.isArray(data?.attendees) ? data.attendees[0] : data?.attendee ?? {};
  const attendeeEmail: string | null = attendee?.email ?? null;
  const attendeeName: string | null = attendee?.name ?? null;
  const responses = data?.responses ?? data?.userFieldsResponses ?? {};

  const admin = adminClient();

  const { data: cfg } = await admin
    .from("paige_config")
    .select("cal_event_type_map")
    .eq("id", 1)
    .maybeSingle();
  const map = (cfg?.cal_event_type_map ?? {}) as Record<string, EventTypeKey>;
  const eventType = classifyEventType(calEventTypeId, title, map);

  // Match contact by any of its email addresses
  const contactId = (await findSoleClientByEmailAnyWorkspace(admin, attendeeEmail, "handle-cal-webhook"))?.id ?? null;

  const status = statusFromTrigger(trigger);

  const { error } = await admin.from("paige_bookings").upsert({
    cal_event_id: calEventId,
    contact_id: contactId,
    event_type: eventType,
    cal_event_type_id: calEventTypeId,
    title,
    scheduled_at: startTime,
    duration_min: durationMin,
    status,
    attendee_email: attendeeEmail,
    attendee_name: attendeeName,
    attendee_responses: responses,
    metadata: { trigger, raw: data },
  }, { onConflict: "cal_event_id" });

  if (error) return jsonResponse({ error: error.message }, 500);

  if (status === "confirmed") {
    fireAndForgetBridge("booking_created", {
      cal_event_id: calEventId,
      contact_id: contactId,
      event_type: eventType,
      scheduled_at: startTime,
      attendee_email: attendeeEmail,
    });
  }

  return jsonResponse({ ok: true });
});
