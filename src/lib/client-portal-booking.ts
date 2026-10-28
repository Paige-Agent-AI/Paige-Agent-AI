import { supabase } from "@/integrations/supabase/client";
import { captureClientPortalAuthorization, withClientPortalBusiness } from "@/lib/client-portal-scope";

/** Presentation scope only. The original Auth/CRM/native writers grant access. */
export type CustomerBookingScope = { actorId: string; tenantId: string; clientId: string; current: () => boolean };
export type CustomerBookingCalendar = { id: string; slug: string; title: string; description: string | null; durationMin: number; timezone: string };
export type CustomerBookingService = { id: string; name: string; duration_min: number };
export type CustomerBookingQuestion = { id: string; label: string; type: string; required: boolean; options: string[]; placeholder: string | null };
export type CustomerBookingAvailability = {
  slots: string[]; timezone: string; durationMin: number; horizonDays: number;
  services: CustomerBookingService[]; questions: CustomerBookingQuestion[]; locations: string[];
};
export type CustomerBookingInput = {
  calendar: CustomerBookingCalendar; start: string; appointmentTypeId: string | null;
  location: string | null; notes: string; answers: Record<string, string | string[]>;
};
export type CustomerBookingReceipt = { id: string; title: string; start_at: string; end_at: string; timezone: string; status: string };
export type CustomerBookingOutcome = { state: "saved"; booking: CustomerBookingReceipt }
  | { state: "refused"; code: string; message: string | null } | { state: "unverified" };
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const uuid = (v: unknown): v is string => typeof v === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(v);
const text = (v: unknown, max: number): v is string => typeof v === "string" && !!v.trim() && v.length <= max;
const zone = (v: unknown): v is string => {
  if (!text(v, 100)) return false;
  try { new Intl.DateTimeFormat(undefined, { timeZone: v }); return true; } catch { return false; }
};
const exact = (v: Record<string, unknown>, keys: string[]) => Object.keys(v).length === keys.length && keys.every(k => Object.prototype.hasOwnProperty.call(v, k));
const sameScope = (v: Record<string, unknown>, s: CustomerBookingScope) => v.tenant_id === s.tenantId && v.client_id === s.clientId;
const check = (s: CustomerBookingScope) => {
  if (!s.current() || ![s.actorId, s.tenantId, s.clientId].every(uuid)) throw new Error("Customer booking context changed");
};
async function bounded<T>(work: PromiseLike<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([Promise.resolve(work), new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("Booking request could not be verified")), 20_000);
    })]);
  } finally { if (timer) clearTimeout(timer); }
}
async function authorization(s: CustomerBookingScope): Promise<string> {
  check(s);
  return bounded(captureClientPortalAuthorization(supabase.auth, s.actorId, s.current));
}
async function verifyAfter(s: CustomerBookingScope): Promise<void> {
  check(s);
  const actual = await bounded(supabase.auth.getUser());
  check(s);
  if (actual.error || actual.data.user?.id !== s.actorId) throw new Error("Customer session changed");
}
async function invoke(s: CustomerBookingScope, body: Record<string, unknown>, bearer: string): Promise<unknown> {
  check(s);
  const result = await bounded(supabase.functions.invoke("public-booking", {
    headers: { Authorization: bearer, "x-client-portal-business": s.tenantId },
    body: { ...body, mode: "customer", tenant_id: s.tenantId, client_id: s.clientId },
  }));
  check(s);
  // HTTP refusals carry their original structured response. Transport failures
  // never prove that a dispatched create failed; its result must be reconciled.
  let data: unknown = result.data;
  if (result.error) {
    const context = (result.error as { context?: unknown }).context;
    if (!(context instanceof Response)) throw new Error("Booking response unavailable");
    data = await bounded(context.clone().json());
  }
  await verifyAfter(s);
  return data;
}
export function readCustomerBookingOutcome(value: unknown, scope: CustomerBookingScope, requestId: string): CustomerBookingOutcome {
  if (!record(value)) return { state: "unverified" };
  if (value.state === "refused" && text(value.code, 100)) {
    // A conflict can refer to earlier saved work; it is never permission to
    // discard the original marker and create another appointment.
    if (value.code === "REQUEST_ID_CONFLICT") return { state: "unverified" };
    return { state: "refused", code: value.code, message: text(value.error, 500) ? value.error : null };
  }
  const b = value.booking;
  if (value.state !== "saved" || value.ok !== true || !sameScope(value, scope) || value.request_id !== requestId
    || !record(b) || !exact(b, ["id", "title", "start_at", "end_at", "timezone", "status"])
    || !uuid(b.id) || !text(b.title, 500) || !zone(b.timezone) || !text(b.status, 40)
    || !text(b.start_at, 100) || !text(b.end_at, 100) || !Number.isFinite(Date.parse(b.start_at))
    || !Number.isFinite(Date.parse(b.end_at)) || Date.parse(b.end_at) <= Date.parse(b.start_at)) return { state: "unverified" };
  return { state: "saved", booking: { id: b.id, title: b.title, start_at: b.start_at, end_at: b.end_at, timezone: b.timezone, status: b.status } };
}
export async function readCustomerBookingCalendars(scope: CustomerBookingScope, after: string | null = null): Promise<{
  calendars: CustomerBookingCalendar[]; next: string | null;
}> {
  const bearer = await authorization(scope);
  const request = withClientPortalBusiness(supabase.rpc("client_portal_booking_calendars" as never, {
    p_tenant_id: scope.tenantId, p_expected_client_id: scope.clientId, p_after_slug: after, p_limit: 20,
  } as never).setHeader("Authorization", bearer), scope.tenantId);
  const reply = await bounded(request);
  const data: unknown = reply.data, error = reply.error;
  await verifyAfter(scope);
  if (error || !record(data) || !sameScope(data, scope) || !Array.isArray(data.calendars) || data.calendars.length > 20
    || typeof data.has_more !== "boolean" || (data.has_more ? !text(data.next_after_slug, 240) : data.next_after_slug !== null))
    throw new Error("Booking options could not be checked. Try again.");
  const calendars = data.calendars.map((v): CustomerBookingCalendar => {
    if (!record(v) || !exact(v, ["id", "slug", "title", "description", "duration_min", "timezone"])
      || !uuid(v.id) || !text(v.slug, 240) || !text(v.title, 500) || !zone(v.timezone)
      || (v.description !== null && (typeof v.description !== "string" || v.description.length > 1200))
      || typeof v.duration_min !== "number" || !Number.isFinite(v.duration_min) || v.duration_min < 5)
      throw new Error("Booking options could not be checked. Try again.");
    return { id: v.id, slug: v.slug, title: v.title, description: v.description as string | null, durationMin: v.duration_min, timezone: v.timezone };
  });
  if (new Set(calendars.map(v => v.id)).size !== calendars.length) throw new Error("Booking options could not be checked. Try again.");
  return { calendars, next: data.has_more ? data.next_after_slug as string : null };
}
export async function readCustomerBookingAvailability(scope: CustomerBookingScope, calendar: CustomerBookingCalendar,
  serviceId: string | null, from: string, to: string): Promise<CustomerBookingAvailability> {
  const bearer = await authorization(scope);
  const data = await invoke(scope, { action: "availability", calendar_id: calendar.id, slug: calendar.slug,
    appointmentTypeId: serviceId, from, to }, bearer);
  if (!record(data) || !record(data.calendar) || data.calendar.id !== calendar.id || data.calendar.slug !== calendar.slug
    || !zone(data.timezone) || typeof data.durationMin !== "number" || !Number.isFinite(data.durationMin) || data.durationMin < 5
    || !Array.isArray(data.slots) || data.slots.length > 10000 || !data.slots.every(v => typeof v === "string" && Number.isFinite(Date.parse(v)))
    || !Array.isArray(data.calendar.appointmentTypes) || !Array.isArray(data.calendar.intakeQuestions)
    || !Array.isArray(data.calendar.locationOptions) || typeof data.calendar.bookingHorizonDays !== "number"
    || !Number.isFinite(data.calendar.bookingHorizonDays) || data.calendar.bookingHorizonDays < 1) throw new Error("Available times could not be checked. Try again.");
  const services = data.calendar.appointmentTypes.map((v): CustomerBookingService => {
    if (!record(v) || !text(v.id, 100) || !text(v.name, 200) || typeof v.duration_min !== "number" || !Number.isFinite(v.duration_min) || v.duration_min < 5)
      throw new Error("Session types could not be checked.");
    return { id: v.id, name: v.name, duration_min: v.duration_min };
  });
  const questions = data.calendar.intakeQuestions.map((v): CustomerBookingQuestion => {
    if (!record(v) || !text(v.id, 64) || !text(v.label, 240) || !["text", "textarea", "select", "radio", "checkbox", "phone", "url", "number"].includes(String(v.type))
      || typeof v.required !== "boolean" || !Array.isArray(v.options) || v.options.length > 40 || !v.options.every(o => text(o, 200))
      || (v.placeholder !== null && typeof v.placeholder !== "string")) throw new Error("Session questions could not be checked.");
    return { id: v.id, label: v.label, type: String(v.type), required: v.required, options: [...v.options] as string[], placeholder: v.placeholder as string | null };
  });
  const locations = data.calendar.locationOptions.map(v => {
    if (!record(v) || !["zoom", "google_meet", "phone", "in_person", "custom"].includes(String(v.type))) throw new Error("Meeting options could not be checked.");
    return String(v.type);
  });
  return { slots: [...new Set(data.slots as string[])].sort((a, b) => Date.parse(a) - Date.parse(b)),
    timezone: data.timezone, durationMin: data.durationMin, horizonDays: data.calendar.bookingHorizonDays, services, questions, locations };
}
/** The UI must retain its original recovery marker BEFORE invoking this writer. */
export async function createCustomerBooking(scope: CustomerBookingScope, requestId: string, input: CustomerBookingInput): Promise<CustomerBookingOutcome> {
  let dispatched = false;
  try {
    if (!uuid(requestId)) return { state: "refused", code: "INVALID_BOOKING_REQUEST", message: null };
    // Snapshot the actual confirmation before Auth/network awaits. Editing a
    // draft during that wait must never silently change what gets booked.
    const body = { action: "create", request_id: requestId, calendar_id: input.calendar.id,
      slug: input.calendar.slug, start: input.start, appointmentTypeId: input.appointmentTypeId, location: input.location,
      notes: input.notes, answers: JSON.parse(JSON.stringify(input.answers)) as Record<string, string | string[]> };
    const bearer = await authorization(scope);
    check(scope);
    dispatched = true;
    const value = await invoke(scope, body, bearer);
    return readCustomerBookingOutcome(value, scope, requestId);
  } catch { return dispatched ? { state: "unverified" } : { state: "refused", code: "CUSTOMER_SESSION_UNVERIFIED", message: null }; }
}
/** A missing/uncertain original result never triggers another create. */
export async function reconcileCustomerBooking(scope: CustomerBookingScope, requestId: string): Promise<CustomerBookingOutcome> {
  try {
    if (!uuid(requestId)) return { state: "unverified" };
    const bearer = await authorization(scope);
    const result = readCustomerBookingOutcome(await invoke(scope, { action: "reconcile", request_id: requestId }, bearer), scope, requestId);
    return result.state === "saved" ? result : { state: "unverified" };
  } catch { return { state: "unverified" }; }
}
