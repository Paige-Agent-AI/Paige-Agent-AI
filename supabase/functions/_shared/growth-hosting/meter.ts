// §17 METER — hosting usage to platform_usage_events, the canonical LAYER-1 tenant→Paige usage
// meter (the same pattern paige-tts/paige-stt write with event_type/unit). There is no second
// ledger; a deployment per tenant is attribution, NOT metering (owner review 80189cce) — this
// writer is the meter.
//
// Semantics copied from paige-tts: service-role insert, tenant-scoped; a metering failure is
// logged and NEVER thrown into the request path; a NULL tenantId is the operator/platform-owner
// path — we skip the meter honestly rather than misattribute or FK-violate on a fabricated
// sentinel.

// deno-lint-ignore no-explicit-any
type Client = any;

export type HostingMeterEvent =
  | "growth_hosting_deployment"
  | "growth_hosting_verification"
  | "growth_hosting_recovery";

export async function meterHostingEvent(
  admin: Client,
  tenantId: string | null,
  event: HostingMeterEvent,
  metadata: Record<string, unknown>,
): Promise<void> {
  if (!tenantId) {
    console.log("[growth-hosting] operator/platform path — tenant meter skipped (not a billable tenant, §9/§13)", { event, ...metadata });
    return;
  }
  const unit = event === "growth_hosting_verification" ? "verification" : "action";
  try {
    const { error } = await admin.from("platform_usage_events").insert({
      tenant_id: tenantId,
      event_type: event,
      quantity: 1,
      unit,
      metadata,
    });
    if (error) console.error("[growth-hosting] meter insert failed", { code: error.code, message: error.message, tenantId, event });
  } catch (e) {
    console.error("[growth-hosting] meter insert threw", (e as Error)?.message);
  }
}
