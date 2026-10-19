/**
 * E09 Slice 6 — the customer's messaging preferences and data-sharing choice for ONE business, as the
 * server derives them (client_portal_communication_preferences, migration 20271110215000).
 *
 * There is no preference store here. The server reads the one consent ledger (paige_consent_events +
 * paige_suppressions, CLAUDE.md §18) through _client_communication_state, the same derivation the owner
 * read and Paige use, and returns what the business's sends will actually respect. This module only
 * checks the shape: an answer with a missing, extra or mistyped key is refused (null), so a widened or
 * drifted payload can never be painted as the customer's choice. An unknown state word is refused too —
 * showing the customer a state the server did not say is worse than showing nothing.
 */

import { customerAgentName } from "../../supabase/functions/_shared/client-portal-identity";

export type EmailState = "on" | "off" | "no_address";
export type SmsState = "on" | "off" | "not_set" | "no_number";
export type UpdatesState = "subscribed" | "not_subscribed" | "paused" | "no_address";
/**
 * Who made the deciding choice (_comms_set_by): the customer's portal account, the business, a STOP/START
 * reply, their emailed unsubscribe link, a hard bounce ("delivery"), the customer's own spam report
 * ("reported" — their act, which only they can undo, integrator default (owner may overrule), 2026-10-18), or a sign-up form.
 * Never an address, an id or staff identity.
 */
export type PreferenceSetBy = "you" | "business" | "reply" | "unsubscribe_link" | "delivery" | "reported" | "form";

export interface ChannelPreference<S extends string> {
  state: S;
  set_by: PreferenceSetBy | null;
  set_at: string | null;
  can_turn_on: boolean;
  can_turn_off: boolean;
}

export interface UpdatesPreference {
  state: UpdatesState;
  set_by: PreferenceSetBy | null;
  set_at: string | null;
  can_subscribe: boolean;
  can_unsubscribe: boolean;
}

export interface DataSharingPreference { allowed: boolean; updated_at: string | null }
/**
 * Texts are held overnight (start → end) by the pre-send check. `time_zone_known` is true only when the
 * customer's own stored zone is one the check can use; otherwise `fallback_time_zone` is the zone it
 * actually uses instead (the business's texting zone when that applies, else America/New_York), read from
 * the server, never assumed here. It is null whenever the customer's own zone is known.
 */
export interface QuietHours { start: string; end: string; time_zone_known: boolean; fallback_time_zone: string | null }

export interface ClientPortalPreferences {
  schema_version: 1;
  tenant_id: string;
  business_name: string | null;
  email: ChannelPreference<EmailState>;
  sms: ChannelPreference<SmsState>;
  updates: UpdatesPreference;
  data_sharing: DataSharingPreference;
  quiet_hours: QuietHours;
  read_at: string;
}

const ROOT_KEYS = ["schema_version", "tenant_id", "business_name", "email", "sms", "updates", "data_sharing", "quiet_hours", "read_at"];
const CHANNEL_KEYS = ["state", "set_by", "set_at", "can_turn_on", "can_turn_off"];
const UPDATES_KEYS = ["state", "set_by", "set_at", "can_subscribe", "can_unsubscribe"];
const SHARING_KEYS = ["allowed", "updated_at"];
const QUIET_KEYS = ["start", "end", "time_zone_known", "fallback_time_zone"];

const EMAIL_STATES: readonly EmailState[] = ["on", "off", "no_address"];
const SMS_STATES: readonly SmsState[] = ["on", "off", "not_set", "no_number"];
const UPDATES_STATES: readonly UpdatesState[] = ["subscribed", "not_subscribed", "paused", "no_address"];
const SET_BY: readonly PreferenceSetBy[] = ["you", "business", "reply", "unsubscribe_link", "delivery", "reported", "form"];

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === "object" && !Array.isArray(v);
const exactKeys = (v: Obj, keys: readonly string[]) => {
  const own = Object.keys(v);
  return own.length === keys.length && keys.every(k => Object.prototype.hasOwnProperty.call(v, k));
};
const isTime = (v: unknown): v is string => typeof v === "string" && Number.isFinite(Date.parse(v));
const optTime = (v: unknown) => v === null || isTime(v);

function readQuiet(quiet: unknown): QuietHours | null {
  if (!isObj(quiet) || !exactKeys(quiet, QUIET_KEYS)) return null;
  if (typeof quiet.start !== "string" || typeof quiet.end !== "string" || typeof quiet.time_zone_known !== "boolean") return null;
  const fallback = quiet.fallback_time_zone;
  if (quiet.time_zone_known ? fallback !== null : typeof fallback !== "string" || fallback.length === 0) return null;
  return { start: quiet.start, end: quiet.end, time_zone_known: quiet.time_zone_known, fallback_time_zone: fallback as string | null };
}

function readSetBy(v: unknown): PreferenceSetBy | null | undefined {
  if (v === null) return null;
  return typeof v === "string" && (SET_BY as readonly string[]).includes(v) ? (v as PreferenceSetBy) : undefined;
}

function readChannel<S extends string>(v: unknown, states: readonly S[], exact: boolean): ChannelPreference<S> | null {
  if (!isObj(v) || (exact ? !exactKeys(v, CHANNEL_KEYS) : !CHANNEL_KEYS.every(k => k in v))) return null;
  const setBy = readSetBy(v.set_by);
  if (typeof v.state !== "string" || !(states as readonly string[]).includes(v.state) || setBy === undefined
    || !optTime(v.set_at) || typeof v.can_turn_on !== "boolean" || typeof v.can_turn_off !== "boolean") return null;
  return { state: v.state as S, set_by: setBy, set_at: v.set_at as string | null, can_turn_on: v.can_turn_on, can_turn_off: v.can_turn_off };
}

function readUpdates(v: unknown, exact: boolean): UpdatesPreference | null {
  if (!isObj(v) || (exact ? !exactKeys(v, UPDATES_KEYS) : !UPDATES_KEYS.every(k => k in v))) return null;
  const setBy = readSetBy(v.set_by);
  if (typeof v.state !== "string" || !(UPDATES_STATES as readonly string[]).includes(v.state) || setBy === undefined
    || !optTime(v.set_at) || typeof v.can_subscribe !== "boolean" || typeof v.can_unsubscribe !== "boolean") return null;
  return { state: v.state as UpdatesState, set_by: setBy, set_at: v.set_at as string | null, can_subscribe: v.can_subscribe, can_unsubscribe: v.can_unsubscribe };
}

function readSharing(v: unknown, exact: boolean): DataSharingPreference | null {
  if (!isObj(v) || (exact ? !exactKeys(v, SHARING_KEYS) : !SHARING_KEYS.every(k => k in v))) return null;
  if (typeof v.allowed !== "boolean" || !optTime(v.updated_at)) return null;
  return { allowed: v.allowed, updated_at: v.updated_at as string | null };
}

/**
 * The customer read, exact-key at the root and in every card. `tenantId`, when given, is the business
 * this page is pinned to: an answer for any other business is refused.
 */
export function readClientPortalPreferences(data: unknown, tenantId?: string | null): ClientPortalPreferences | null {
  if (!isObj(data) || !exactKeys(data, ROOT_KEYS)) return null;
  if (data.schema_version !== 1 || typeof data.tenant_id !== "string" || !data.tenant_id) return null;
  if (tenantId && data.tenant_id !== tenantId) return null;
  if (data.business_name !== null && typeof data.business_name !== "string") return null;
  if (!isTime(data.read_at)) return null;
  const email = readChannel(data.email, EMAIL_STATES, true);
  const sms = readChannel(data.sms, SMS_STATES, true);
  const updates = readUpdates(data.updates, true);
  const sharing = readSharing(data.data_sharing, true);
  const quiet = readQuiet(data.quiet_hours);
  if (!email || !sms || !updates || !sharing || !quiet) return null;
  return {
    schema_version: 1, tenant_id: data.tenant_id, business_name: data.business_name as string | null,
    email, sms, updates, data_sharing: sharing,
    quiet_hours: quiet,
    read_at: data.read_at,
  };
}

/**
 * The owner read (read_client_communication_state): the same derived cards, plus whether the client has
 * joined the portal and the two record flags that also hold sends (do_not_contact for marketing email,
 * an active do-not-disturb hold for every send). Exact keys too, and pinned to the workspace and client
 * the record was opened for: an answer about anyone else is refused.
 */
export interface ClientCommunicationState {
  tenant_id: string;
  contact_id: string;
  email: ChannelPreference<EmailState>;
  sms: ChannelPreference<SmsState>;
  updates: UpdatesPreference;
  data_sharing: DataSharingPreference;
  quiet_hours: QuietHours;
  portal_joined: boolean;
  /**
   * E09 Slice 7: joined is the login link, which a paused client keeps and an ended one has lost; this says
   * which. NULL when the server predates the access state (the key is then absent) — read portal_joined alone.
   */
  portal_access: OwnerPortalAccess | null;
  do_not_contact: boolean;
  dnd_active: boolean;
  read_at: string;
}
export type OwnerPortalAccess = "open" | "paused" | "ended" | "not_joined";
const OWNER_PORTAL_ACCESS: readonly OwnerPortalAccess[] = ["open", "paused", "ended", "not_joined"];
const OWNER_KEYS = ["schema_version", "tenant_id", "contact_id", "email", "sms", "updates", "data_sharing", "quiet_hours",
  "portal_joined", "do_not_contact", "dnd_active", "read_at"];

export function readClientCommunicationState(data: unknown, expected: { tenantId: string; contactId: string }): ClientCommunicationState | null {
  // portal_access is the one key a reader may meet or not (it arrived with E09 Slice 7); every other key is exact.
  const hasAccess = isObj(data) && Object.prototype.hasOwnProperty.call(data, "portal_access");
  if (!isObj(data) || !exactKeys(data, hasAccess ? [...OWNER_KEYS, "portal_access"] : OWNER_KEYS) || data.schema_version !== 1) return null;
  if (hasAccess && !OWNER_PORTAL_ACCESS.includes(data.portal_access as OwnerPortalAccess)) return null;
  if (data.tenant_id !== expected.tenantId || data.contact_id !== expected.contactId || !isTime(data.read_at)) return null;
  const email = readChannel(data.email, EMAIL_STATES, true);
  const sms = readChannel(data.sms, SMS_STATES, true);
  const updates = readUpdates(data.updates, true);
  const sharing = readSharing(data.data_sharing, true);
  const quiet = readQuiet(data.quiet_hours);
  if (!email || !sms || !updates || !sharing || !quiet) return null;
  if (typeof data.portal_joined !== "boolean" || typeof data.do_not_contact !== "boolean" || typeof data.dnd_active !== "boolean") return null;
  return { tenant_id: expected.tenantId, contact_id: expected.contactId, email, sms, updates, data_sharing: sharing,
    quiet_hours: quiet,
    portal_joined: data.portal_joined, portal_access: hasAccess ? data.portal_access as OwnerPortalAccess : null,
    do_not_contact: data.do_not_contact, dnd_active: data.dnd_active, read_at: data.read_at };
}

/**
 * The sentences a customer reads at the moment of a choice, keyed by the disclosure id the server stores
 * with the evidence (`portal:<uid>:<id>:<md5 prefix of the sentence>`). The server holds the same text
 * (client_portal_consent_disclosure, latest in 20271110250000); the Vitest suite pins each sentence here to
 * that SQL literal byte for byte, so what the customer saw is what the evidence names (reviewer Minor 7).
 * Changing a sentence means a new id on both sides, never an edit of an old one. A superseded id stays here and
 * on the server, because evidence already written names it; the page shows only CURRENT_DISCLOSURE.
 * {business} is the business's name; {assistant} is the customer's agent (customerAgentName: never PAIGE).
 */
export const PORTAL_PREFERENCE_DISCLOSURES = {
  // Superseded 2026-10-18 (round 2): did not say email off also unsubscribes from updates, or name agreements.
  "email-pref:v1": "Email from {business}. When email is off, {business} won't email you through Paige. Confirmations for times you book, and changes you make to them, still arrive.", // customer-identity-exempt: superseded consent sentence, kept byte for byte because evidence already names it
  "email-pref:v2": "Email from {business}. When email is off, {business} won't email you through Paige, except booking confirmations and agreements you're asked to sign. Turning email off also unsubscribes you from updates and offers, and turning it back on doesn't subscribe you again.", // customer-identity-exempt: superseded consent sentence, kept byte for byte because evidence already names it
  // Superseded 2026-10-19 (owner ruling: PAIGE is the owner's COO, not part of the customer's portal): v1 and v2 said "through Paige".
  "email-pref:v3": "Email from {business}. When email is off, {business} won't email you, except booking confirmations and agreements you're asked to sign. Turning email off also unsubscribes you from updates and offers, and turning it back on doesn't subscribe you again.",
  // Superseded 2026-10-18 (round 2): repeated the row's own label.
  "updates-optin:v1": "Updates and offers: newsletters and automated marketing emails from {business}, sent through Paige. You can unsubscribe anytime.", // customer-identity-exempt: superseded consent sentence, kept byte for byte because evidence already names it
  "updates-optin:v2": "Newsletters and automated marketing emails from {business}, sent through Paige. You can unsubscribe anytime.", // customer-identity-exempt: superseded consent sentence, kept byte for byte because evidence already names it
  "updates-optin:v3": "Newsletters and automated marketing emails from {business}. You can unsubscribe anytime.",
  // Superseded 2026-10-18 (round 3): "again" was wrong for someone who never had texts, and it implied a text would come.
  "sms-pref:v1": "Texts from {business}. When texts are off, {business} can't text you through Paige. To get texts again, reply START to a text from {business}.", // customer-identity-exempt: superseded consent sentence, kept byte for byte because evidence already names it
  "sms-pref:v2": "Texts from {business}. When texts are off, {business} can't text you through Paige. To get texts, reply START to a text from {business} if you have one, or ask them.", // customer-identity-exempt: superseded consent sentence, kept byte for byte because evidence already names it
  "sms-pref:v3": "Texts from {business}. When texts are off, {business} can't text you. To get texts, reply START to a text from {business} if you have one, or ask them.",
  "data-sharing:v1": "Lets {business}'s Paige use your account details and portal activity when it prepares requests or suggestions for you. It has no effect yet, and you can turn it off anytime.", // customer-identity-exempt: superseded consent sentence, kept byte for byte because evidence already names it
  "data-sharing:v2": "Lets {assistant}, the AI client success agent for {business}, use your account details and portal activity when it prepares requests or suggestions for you. It has no effect yet, and you can turn it off anytime.",
} as const;
export type PortalDisclosureId = keyof typeof PORTAL_PREFERENCE_DISCLOSURES;

/** The sentence each card shows today; the writer records the same id with the customer's choice. */
export const CURRENT_DISCLOSURE = {
  email: "email-pref:v3", sms: "sms-pref:v3", updates: "updates-optin:v3", sharing: "data-sharing:v2",
} as const satisfies Record<string, PortalDisclosureId>;

export function disclosureText(id: PortalDisclosureId, business: string, assistant: string = customerAgentName(undefined)): string {
  return PORTAL_PREFERENCE_DISCLOSURES[id].split("{business}").join(business).split("{assistant}").join(assistant);
}

/** The server's named refusals. Codes never reach the screen; the component turns them into words. */
export type PreferenceRefusal =
  | "EMAIL_PAUSED_BY_BUSINESS" | "EMAIL_UNDELIVERABLE" | "EMAIL_OFF" | "NO_EMAIL_ADDRESS"
  | "SMS_OPT_IN_UNAVAILABLE" | "BAD_PREFERENCE";
// EMAIL_REPORTED was retired in round 2: the customer's own spam report is theirs to lift (integrator default (owner may overrule), 2026-10-18).
const REFUSALS: readonly PreferenceRefusal[] = ["EMAIL_PAUSED_BY_BUSINESS", "EMAIL_UNDELIVERABLE", "EMAIL_OFF", "NO_EMAIL_ADDRESS", "SMS_OPT_IN_UNAVAILABLE", "BAD_PREFERENCE"];

/** A refusal named in a writer's answer: `{ok:false, error:CODE, ...}`, or a raised message that starts with the code. */
export function preferenceRefusal(data: unknown, error: unknown): PreferenceRefusal | "OTHER" | null {
  if (isObj(data) && data.ok === false) {
    return typeof data.error === "string" && (REFUSALS as readonly string[]).includes(data.error) ? (data.error as PreferenceRefusal) : "OTHER";
  }
  if (isObj(error)) {
    const message = typeof error.message === "string" ? error.message : "";
    const named = REFUSALS.find(code => message.startsWith(code));
    if (named) return named;
    if (error.code === "22023") return "BAD_PREFERENCE";
  }
  return null;
}
