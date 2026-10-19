import type { SpineCapability } from "../contracts.ts";
import { defineCapability, objectInputSchema, ownerGrantablePermission } from "../../capability-kit/mod.ts";

// Existing Calendar reader, original caller JWT. No booking mutation or provider call.
export const CALENDAR_BOOKING_READ_CAPABILITY = defineCapability({
  identity: { id: "calendar.booking_read", version: 1, domain: "calendar", owner: "calendar", humanSurface: "/solo/:account/calendar/week",
    description: "Read one saved booking by its exact ID, within the current person's native Calendar visibility. A Calendar record is not evidence of provider synchronization." },
  input: objectInputSchema({ properties: {
    booking_id: { type: "string", format: "uuid", maxLength: 36, description: "Exact saved booking UUID from the earlier booking result. No actor, tenant or date-range arguments." },
  }, required: ["booking_id"] }),
  effect: "read",
  governance: { actionRiskKey: null, risk: "read_only", approval: "none", requiredPermission: ownerGrantablePermission("calendar.booking.read") },
  tenantScope: { source: "server", tenantResolver: "current_user_tenant_id", actorResolver: "authenticated_user", revalidateAt: ["before_availability", "before_execution", "before_receipt"] },
  availability: { resolver: "paige-capability-status", states: ["live", "not_for_tier", "unavailable"] },
  providerBinding: { kind: "internal", operation: "public.list_team_bookings", connectionResolver: null },
  idempotency: { mode: "not_applicable" },
  receipt: { rail: true, recorder: "record_capability_run", redaction: "tenant_safe", visibility: "owner_internal" },
  outcome: { projector: "capability-record" },
});

export const CALENDAR_BOOKING_READ = {
  key: "calendar.booking_read", domain: "calendar", owner: "calendar", humanSurface: "/solo/:account/calendar/week", readiness: "none",
  action: { classification: "read", executor: "public.list_team_bookings", chatTool: "read_calendar_booking", seatAuthority: "member",
    riskPolicyKey: "read_only", approvalAuthority: "none",
    idempotency: "Original caller JWT; exact saved booking ID, current native tenant/member/admin-or-own-host checks, one bounded read. No booking writer, provider call or action replay." },
  outcome: { kinds: ["available", "needs_input", "refused", "unavailable"], projector: "public.list_team_bookings",
    railVisibility: "One available Chat read records a capability receipt, not a booking creation or provider receipt. Calendar navigation opens the department, not an exact-record route." },
  chatBinding: "LIVE", mindBinding: "UNAVAILABLE", sharedPrimitiveChange: "NONE", maturity: "PARTIAL",
} as const satisfies SpineCapability;

export const CALENDAR_BOOKING_READ_TOOLS = [{ type: "function" as const, function: {
  name: "read_calendar_booking", description: CALENDAR_BOOKING_READ_CAPABILITY.identity.description,
  parameters: CALENDAR_BOOKING_READ_CAPABILITY.input,
} }];
