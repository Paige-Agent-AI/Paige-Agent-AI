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

export const CALENDAR_AGENDA_READ_CAPABILITY = defineCapability({
  identity: { id: "calendar.agenda_read", version: 1, domain: "calendar", owner: "calendar", humanSurface: "/solo/:account/calendar/week",
    description: "Inspect saved Calendar bookings over explicit-offset from/to timestamps, at most 32 elapsed days. Mine means the current actor's bookings; team requires current native admin authority. Clarify the business time zone and dates before interpreting this week. Results and title previews are bounded, never a complete or conflict-free agenda, provider sync or free capacity." },
  input: objectInputSchema({ properties: {
    from: { type: "string", maxLength: 40, description: "Inclusive RFC3339 window start with explicit UTC offset." },
    to: { type: "string", maxLength: 40, description: "Exclusive RFC3339 window end with explicit UTC offset, at most 32 elapsed days after from." },
    view: { type: "string", enum: ["mine", "team"], description: "Mine by default. Team requires fresh native admin authority, including empty reads." },
  }, required: ["from", "to"] }),
  effect: "read",
  governance: { actionRiskKey: null, risk: "read_only", approval: "none", requiredPermission: ownerGrantablePermission("calendar.booking.read") },
  tenantScope: { source: "server", tenantResolver: "current_user_tenant_id", actorResolver: "authenticated_user", revalidateAt: ["before_availability", "before_execution", "before_receipt"] },
  availability: { resolver: "paige-capability-status", states: ["live", "not_for_tier", "unavailable"] },
  providerBinding: { kind: "internal", operation: "public.list_team_bookings", connectionResolver: null },
  idempotency: { mode: "not_applicable" },
  receipt: { rail: true, recorder: "record_capability_run", redaction: "tenant_safe", visibility: "owner_internal" },
  outcome: { projector: "capability-record" },
});
export const CALENDAR_AGENDA_READ = {
  key: "calendar.agenda_read", domain: "calendar", owner: "calendar", humanSurface: "/solo/:account/calendar/week", readiness: "none",
  action: { classification: "read", executor: "public.list_team_bookings", chatTool: "read_calendar_agenda", seatAuthority: "member",
    riskPolicyKey: "read_only", approvalAuthority: "none",
    idempotency: "Original caller JWT; explicit bounded dates, own-host default, current native tenant/member/admin checks. No booking writer, provider call or action replay." },
  outcome: { kinds: ["available", "needs_input", "refused", "unavailable"], projector: "public.list_team_bookings",
    railVisibility: "One available lookup records a read receipt, never a booking/action/provider receipt. Bounded title previews and omitted rows are explicit. Calendar opens the department only." },
  chatBinding: "LIVE", mindBinding: "UNAVAILABLE", sharedPrimitiveChange: "NONE", maturity: "PARTIAL",
} as const satisfies SpineCapability;
export const CALENDAR_AGENDA_READ_TOOLS = [{ type: "function" as const, function: {
  name: "read_calendar_agenda", description: CALENDAR_AGENDA_READ_CAPABILITY.identity.description,
  parameters: CALENDAR_AGENDA_READ_CAPABILITY.input,
} }];
