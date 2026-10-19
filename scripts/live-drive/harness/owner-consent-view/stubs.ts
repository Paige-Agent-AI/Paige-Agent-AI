// Deterministic data boundary for the owner "How {client} can be reached" harness (E09 Slice 6).
// HARNESS RENDER · SYNTHETIC DATA · NOT LIVE. Same synthetic Northwind Studio / Jordan Rivera record as the Slice 3
// owner harness, whose stubs this re-uses for everything above the new section (standing, shared work, the
// People read, the tenant context). Only read_client_communication_state is answered here, in exactly the shape
// 20271110215000 §10 returns:
//   { schema_version:1, tenant_id, contact_id, email, sms, updates, data_sharing, quiet_hours, portal_joined,
//     do_not_contact, dnd_active, read_at }   — owner/admin of the current workspace only; else 42501.
//   ?consent=mixed|paused|reported|business|defaults|refused|error|loading   (the Slice 3 ?state= stays "populated")
//   reported: the client reported an email as spam (set_by 'reported'); business: texts on and updates
//   subscribed, both recorded by the business (D7).
import * as base from "../owner-shared-work/stubs";

export { TENANT, CLIENT, harness, useTenantContext, useUserRoles, useTenantRelationshipsData } from "../owner-shared-work/stubs";
export type { RelationshipWorkspaceVariant } from "../owner-shared-work/stubs";

const consent = new URLSearchParams(window.location.search).get("consent") ?? "mixed";
const DAY = 86_400_000;
const ago = (days: number) => new Date(Date.now() - days * DAY).toISOString();
const card = (state: string, o: Record<string, unknown> = {}) => ({ state, set_by: null, set_at: null, can_turn_on: false, can_turn_off: true, ...o });
const upd = (state: string, o: Record<string, unknown> = {}) => ({ state, set_by: null, set_at: null, can_subscribe: state === "not_subscribed", can_unsubscribe: state === "subscribed" || state === "paused", ...o });

let ownerReads = 0;
export const ownerHarness = { get reads() { return ownerReads; } };
(window as unknown as { __ownerHarness: typeof ownerHarness }).__ownerHarness = ownerHarness;

function answer() {
  const common = { schema_version: 1, tenant_id: base.TENANT, contact_id: base.CLIENT, quiet_hours: { start: "20:00", end: "08:00", time_zone_known: false, fallback_time_zone: "America/New_York" }, read_at: new Date().toISOString() };
  if (consent === "paused") {
    return { ...common, email: card("off", { set_by: "business", set_at: ago(3) }), sms: card("not_set"), updates: upd("paused", { set_by: "business", set_at: ago(3) }),
      data_sharing: { allowed: false, updated_at: null }, portal_joined: false, do_not_contact: true, dnd_active: false };
  }
  if (consent === "reported") {
    return { ...common, email: card("off", { set_by: "reported", set_at: ago(15), can_turn_on: true, can_turn_off: false }), sms: card("not_set"),
      updates: upd("not_subscribed", { set_by: "you", set_at: ago(15), can_subscribe: false }), data_sharing: { allowed: false, updated_at: null },
      portal_joined: true, do_not_contact: false, dnd_active: false };
  }
  if (consent === "business") {
    return { ...common, email: card("on"), sms: card("on", { set_by: "business", set_at: ago(20) }), updates: upd("subscribed", { set_by: "business", set_at: ago(20) }),
      data_sharing: { allowed: false, updated_at: null }, portal_joined: false, do_not_contact: false, dnd_active: false };
  }
  if (consent === "defaults") {
    return { ...common, email: card("on"), sms: card("no_number"), updates: upd("not_subscribed"), data_sharing: { allowed: false, updated_at: null },
      portal_joined: false, do_not_contact: false, dnd_active: false };
  }
  return { ...common,
    email: card("off", { set_by: "you", set_at: ago(6), can_turn_on: true, can_turn_off: false }),
    sms: card("on", { set_by: "reply", set_at: ago(9) }),
    updates: upd("not_subscribed", { set_by: "you", set_at: ago(6), can_subscribe: false }),
    data_sharing: { allowed: true, updated_at: ago(4) }, portal_joined: true, do_not_contact: false, dnd_active: true };
}

export const supabase = {
  ...base.supabase,
  rpc: async (name: string, args: Record<string, unknown> = {}) => {
    if (name !== "read_client_communication_state") return base.supabase.rpc(name, args);
    ownerReads += 1;
    if (consent === "loading") return new Promise(() => {});
    if (consent === "refused") return { data: null, error: { code: "42501", message: "Client unavailable" } };
    if (consent === "error") return { data: null, error: { code: "57014", message: "harness failure" } };
    if (args._expected_tenant_id !== base.TENANT || args._contact_id !== base.CLIENT) return { data: null, error: { code: "42501", message: "Client unavailable" } };
    return { data: answer(), error: null };
  },
};
