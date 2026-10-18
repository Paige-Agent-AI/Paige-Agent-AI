/**
 * E09 Slice 6 — the customer's messaging preferences and data-sharing choice for ONE business, as the
 * server derives them (client_portal_communication_preferences, migration 20271110100000).
 *
 * There is no preference store here. The server reads the one consent ledger (paige_consent_events +
 * paige_suppressions, CLAUDE.md §18) through _client_communication_state, the same derivation the owner
 * read and Paige use, and returns what the business's sends will actually respect. This module only
 * checks the shape: an answer with a missing, extra or mistyped key is refused (null), so a widened or
 * drifted payload can never be painted as the customer's choice. An unknown state word is refused too —
 * showing the customer a state the server did not say is worse than showing nothing.
 */

export type EmailState = "on" | "off" | "no_address";
export type SmsState = "on" | "off" | "not_set" | "no_number";
export type UpdatesState = "subscribed" | "not_subscribed" | "paused" | "no_address";
/**
 * Who made the deciding choice (_comms_set_by): the customer's portal account, the business, a STOP/START
 * reply, their emailed unsubscribe link, delivery failures, or a sign-up form. Never an address, an id or
 * staff identity.
 */
export type PreferenceSetBy = "you" | "business" | "reply" | "unsubscribe_link" | "delivery" | "form";

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
export interface QuietHours { start: string; end: string; time_zone_known: boolean }

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
const QUIET_KEYS = ["start", "end", "time_zone_known"];
const EMAIL_STATES: readonly EmailState[] = ["on", "off", "no_address"];
const SMS_STATES: readonly SmsState[] = ["on", "off", "not_set", "no_number"];
const UPDATES_STATES: readonly UpdatesState[] = ["subscribed", "not_subscribed", "paused", "no_address"];
const SET_BY: readonly PreferenceSetBy[] = ["you", "business", "reply", "unsubscribe_link", "delivery", "form"];

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === "object" && !Array.isArray(v);
const exactKeys = (v: Obj, keys: readonly string[]) => {
  const own = Object.keys(v);
  return own.length === keys.length && keys.every(k => Object.prototype.hasOwnProperty.call(v, k));
};
const isTime = (v: unknown): v is string => typeof v === "string" && Number.isFinite(Date.parse(v));
const optTime = (v: unknown) => v === null || isTime(v);

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
  const quiet = data.quiet_hours;
  if (!email || !sms || !updates || !sharing || !isObj(quiet) || !exactKeys(quiet, QUIET_KEYS)) return null;
  if (typeof quiet.start !== "string" || typeof quiet.end !== "string" || typeof quiet.time_zone_known !== "boolean") return null;
  return {
    schema_version: 1, tenant_id: data.tenant_id, business_name: data.business_name as string | null,
    email, sms, updates, data_sharing: sharing,
    quiet_hours: { start: quiet.start, end: quiet.end, time_zone_known: quiet.time_zone_known },
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
  do_not_contact: boolean;
  dnd_active: boolean;
  read_at: string;
}
const OWNER_KEYS = ["schema_version", "tenant_id", "contact_id", "email", "sms", "updates", "data_sharing", "quiet_hours",
  "portal_joined", "do_not_contact", "dnd_active", "read_at"];

export function readClientCommunicationState(data: unknown, expected: { tenantId: string; contactId: string }): ClientCommunicationState | null {
  if (!isObj(data) || !exactKeys(data, OWNER_KEYS) || data.schema_version !== 1) return null;
  if (data.tenant_id !== expected.tenantId || data.contact_id !== expected.contactId || !isTime(data.read_at)) return null;
  const email = readChannel(data.email, EMAIL_STATES, true);
  const sms = readChannel(data.sms, SMS_STATES, true);
  const updates = readUpdates(data.updates, true);
  const sharing = readSharing(data.data_sharing, true);
  const quiet = data.quiet_hours;
  if (!email || !sms || !updates || !sharing || !isObj(quiet) || !exactKeys(quiet, QUIET_KEYS)) return null;
  if (typeof quiet.start !== "string" || typeof quiet.end !== "string" || typeof quiet.time_zone_known !== "boolean") return null;
  if (typeof data.portal_joined !== "boolean" || typeof data.do_not_contact !== "boolean" || typeof data.dnd_active !== "boolean") return null;
  return { tenant_id: expected.tenantId, contact_id: expected.contactId, email, sms, updates, data_sharing: sharing,
    quiet_hours: { start: quiet.start, end: quiet.end, time_zone_known: quiet.time_zone_known },
    portal_joined: data.portal_joined, do_not_contact: data.do_not_contact, dnd_active: data.dnd_active, read_at: data.read_at };
}

/**
 * The sentences a customer reads at the moment of a choice, keyed by the disclosure id the server stores
 * with the evidence (`portal:<uid>:<id>:<md5 prefix of the sentence>`). The server holds the same text
 * (client_portal_consent_disclosure, 20271110100000); the Vitest suite pins each sentence here to that
 * SQL literal byte for byte, so what the customer saw is what the evidence names (reviewer Minor 7).
 * Changing a sentence means a new id (v2) on both sides, never an edit of v1.
 */
export const PORTAL_PREFERENCE_DISCLOSURES = {
  "email-pref:v1": "Email from {business}. When email is off, {business} won't email you through Paige. Confirmations for times you book, and changes you make to them, still arrive.",
  "updates-optin:v1": "Updates and offers: newsletters and automated marketing emails from {business}, sent through Paige. You can unsubscribe anytime.",
  "sms-pref:v1": "Texts from {business}. When texts are off, {business} can't text you through Paige. To get texts again, reply START to a text from {business}.",
  "data-sharing:v1": "Lets {business}'s Paige use your account details and portal activity when it prepares requests or suggestions for you. It has no effect yet, and you can turn it off anytime.",
} as const;
export type PortalDisclosureId = keyof typeof PORTAL_PREFERENCE_DISCLOSURES;

export function disclosureText(id: PortalDisclosureId, business: string): string {
  return PORTAL_PREFERENCE_DISCLOSURES[id].split("{business}").join(business);
}

/** The server's named refusals. Codes never reach the screen; the component turns them into words. */
export type PreferenceRefusal =
  | "EMAIL_PAUSED_BY_BUSINESS" | "EMAIL_UNDELIVERABLE" | "EMAIL_REPORTED" | "EMAIL_OFF" | "NO_EMAIL_ADDRESS"
  | "SMS_OPT_IN_UNAVAILABLE" | "BAD_PREFERENCE";
const REFUSALS: readonly PreferenceRefusal[] = ["EMAIL_PAUSED_BY_BUSINESS", "EMAIL_UNDELIVERABLE", "EMAIL_REPORTED", "EMAIL_OFF", "NO_EMAIL_ADDRESS", "SMS_OPT_IN_UNAVAILABLE", "BAD_PREFERENCE"];

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
