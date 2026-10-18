// E09 Slice 6 — synthetic customer-preference payloads shaped exactly like
// client_portal_communication_preferences / read_client_communication_state (20271110100000).
// Synthetic tenant and client only (§63); never a real account.
export const PREF_TENANT = "e0960000-0000-4000-8000-00000000b001";
export const PREF_OTHER_TENANT = "e0960000-0000-4000-8000-00000000b002";
export const PREF_CONTACT = "e0960000-0000-4000-8000-00000000d001";
export const PREF_ACTOR = "e0960000-0000-4000-8000-00000000c001";

export const prefCard = (state: string, extra: Record<string, unknown> = {}) =>
  ({ state, set_by: null, set_at: null, can_turn_on: false, can_turn_off: true, ...extra });
export const prefUpdates = (state: string, extra: Record<string, unknown> = {}) =>
  ({ state, set_by: null, set_at: null, can_subscribe: state === "not_subscribed", can_unsubscribe: state === "subscribed" || state === "paused", ...extra });

/** Nothing on record: email on, texts not set up, not subscribed, sharing off. */
export const prefsPayload = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  schema_version: 1, tenant_id: PREF_TENANT, business_name: "Northwind Studio",
  email: prefCard("on"), sms: prefCard("not_set"), updates: prefUpdates("not_subscribed"),
  data_sharing: { allowed: false, updated_at: null },
  quiet_hours: { start: "20:00", end: "08:00", time_zone_known: false },
  read_at: "2026-10-18T12:00:00.000Z", ...over,
});

export const ownerStatePayload = (over: Record<string, unknown> = {}): Record<string, unknown> => {
  const { business_name: _ignored, ...rest } = prefsPayload();
  void _ignored;
  return { ...rest, contact_id: PREF_CONTACT, portal_joined: true, do_not_contact: false, dnd_active: false, ...over };
};
