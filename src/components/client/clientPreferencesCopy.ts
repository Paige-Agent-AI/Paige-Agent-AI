import { CURRENT_DISCLOSURE, type ClientPortalPreferences, type PortalDisclosureId, type PreferenceRefusal } from "@/lib/client-portal-preferences";
import type { PreferenceKey, PreferenceOutcome } from "@/hooks/useClientPortalPreferences";

/**
 * E09 Slice 6 — the words on "How {Business} can reach you", derived from the server's state only.
 * Kept apart from the component so every sentence can be pinned by tests and read in one place.
 *
 * Each card leads with its disclosure sentence (the server-held text the evidence names), then the
 * state and who set it, then — only when it applies — the one extra line that explains a held state or
 * the real route to change it. A switch is offered only where the server says the change is possible
 * (can_turn_on / can_turn_off / can_subscribe / can_unsubscribe); a switch that is not offered always
 * carries its reason.
 */

const DATE = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" });
export function day(at: string | null): string | null {
  if (!at) return null;
  const t = Date.parse(at);
  return Number.isFinite(t) ? DATE.format(t) : null;
}
export const on = (date: string | null) => (date ? ` on ${date}` : "");

export type PreferenceCard = {
  key: PreferenceKey;
  label: string;
  /** The server-held sentence for this choice. Always shown, so the customer reads what the evidence names. */
  disclosure: PortalDisclosureId;
  state: string;
  paused?: boolean;
  /** One extra line, only when the state needs explaining. */
  detail?: string;
  /** The switch, when this choice has one. `reason` is shown whenever it is disabled. */
  control?: { checked: boolean; enabled: boolean; reason?: string; aria: string };
  /** A separate "keep it off" act: it is off already, but not by the customer's own choice. */
  keepOff?: { label: string; help: string };
  messageLink?: boolean;
};

/** "20:00" → "8pm", "08:30" → "8:30am": the quiet window the server reports, in the customer's words. */
export function clock(hhmm: string): string {
  const m = /^(\d{1,2}):(\d{2})/.exec(hhmm);
  if (!m) return hhmm;
  const h = Number(m[1]), min = m[2];
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}${min === "00" ? "" : `:${min}`}${h < 12 ? "am" : "pm"}`;
}

/** Who recorded a choice that is ON, when it was not the customer's own act (D7: a business record is labelled). */
function onBy(by: string | null, business: string, when: string): string {
  if (by === "business") return ` · set by ${business}${when}`;
  if (by === "form") return ` · from a sign-up form${when}`;
  return "";
}

export function preferenceCards(p: ClientPortalPreferences, business: string): PreferenceCard[] {
  const e = p.email, s = p.sms, u = p.updates;

  const email: PreferenceCard = { key: "email", label: "Email", disclosure: CURRENT_DISCLOSURE.email, state: "On" };
  if (e.state === "no_address") {
    Object.assign(email, { state: "No email address on file", detail: `${business} doesn't have an email address for you. Message them to add one.`, messageLink: true });
  } else if (e.state === "on") {
    Object.assign(email, {
      state: "On",
      control: { checked: true, enabled: e.can_turn_off, reason: e.can_turn_off ? undefined : `Ask ${business} to change this.`, aria: "Email" },
    });
  } else {
    const when = on(day(e.set_at));
    // The customer's own acts: their portal switch, their emailed unsubscribe link, their spam report.
    const mine = e.set_by === "you" || e.set_by === "unsubscribe_link" || e.set_by === "reported";
    const bothHold = !mine && !e.can_turn_off;
    let reason = `Ask ${business} to turn email back on.`;
    if (e.set_by === "business") {
      Object.assign(email, { state: `Paused by ${business}`, paused: true, messageLink: true });
      reason = `Only ${business} can resume email they paused.`;
    } else if (e.set_by === "delivery") {
      Object.assign(email, { state: "Off · emails to your address weren't being delivered", detail: `Ask ${business} to check the email address they have for you.`, messageLink: true });
      reason = `Only ${business} can turn email back on after a delivery problem.`;
    } else if (e.set_by === "reported") {
      email.state = `Off · you reported an email from ${business} as spam${when}`;
      if (e.can_turn_on) email.detail = "Turn email back on here if you want it again.";
    } else {
      email.state = e.set_by === "you" ? `Off · you turned email off${when}`
        : e.set_by === "unsubscribe_link" ? `Off · you unsubscribed using the link in an email${when}` : "Off";
    }
    // Held by both sides: one sentence that is true for both, never "only they can" next to "you did too" (Nice 1).
    if (bothHold) reason = `Email comes back only when you and ${business} both turn it back on.`;
    email.control = { checked: false, enabled: e.can_turn_on, aria: "Email", reason: e.can_turn_on ? undefined : reason };
    if (!mine && e.can_turn_off) {
      email.keepOff = { label: "Keep email off", help: `If ${business} resumes email, it stays off until you turn it back on.` };
    }
    if (!e.can_turn_on && !mine) email.messageLink = true;
  }

  // Texts: never turned on from here (D1). START is named once per row, by the disclosure sentence, and
  // nothing here suggests a text is on its way: the page does not know the business's texting number.
  const texts: PreferenceCard = { key: "sms", label: "Texts", disclosure: CURRENT_DISCLOSURE.sms, state: "" };
  const noOn = "Texts can't be turned on from your account.";
  if (s.state === "no_number") {
    Object.assign(texts, { state: "No phone number on file", detail: `${business} can't text you without a phone number.` });
  } else if (s.state === "on") {
    const when = on(day(s.set_at));
    const window = `${clock(p.quiet_hours.start)} to ${clock(p.quiet_hours.end)}`;
    Object.assign(texts, {
      state: s.set_by === "reply" ? `On · you replied START${when}` : `On${onBy(s.set_by, business, when)}`,
      // runPreSend holds texts overnight in the client's zone, or in Eastern time when it has none (safeTz).
      detail: p.quiet_hours.time_zone_known
        ? `Texts through Paige only arrive between ${clock(p.quiet_hours.end)} and ${clock(p.quiet_hours.start)} your time.`
        : `${business} doesn't have your time zone, so texts through Paige are held from ${window} Eastern time.`,
      control: { checked: true, enabled: s.can_turn_off, reason: s.can_turn_off ? undefined : `Ask ${business} to change this.`, aria: "Texts" },
    });
  } else {
    const when = on(day(s.set_at));
    const mine = s.set_by === "you" || (s.set_by === "reply" && s.state === "off");
    let reason = noOn;
    if (s.state === "not_set") {
      texts.state = "Not set up";
      if (s.can_turn_off) texts.keepOff = { label: "Don't text me", help: "Records that you don't want texts." };
    } else if (s.set_by === "business") {
      Object.assign(texts, { state: `Paused by ${business}`, paused: true, messageLink: true });
      if (s.can_turn_off) texts.keepOff = { label: "Keep texts off", help: `If ${business} resumes texts, they stay off.` };
      else reason = `You've turned texts off too, so they stay off if ${business} resumes them. ${noOn}`;
    } else {
      texts.state = s.set_by === "you" ? `Off · you turned texts off${when}`
        : s.set_by === "reply" ? `Off · you replied STOP${when}`
          : s.set_by === "delivery" ? "Off · texts to your number weren't being delivered" : "Off";
      if (!mine && s.can_turn_off) texts.keepOff = { label: "Keep texts off", help: "Records that you don't want texts." };
    }
    texts.control = { checked: false, enabled: false, reason, aria: "Texts" };
  }

  const updates: PreferenceCard = { key: "updates", label: "Updates and offers", disclosure: CURRENT_DISCLOSURE.updates, state: "" };
  if (u.state === "no_address") {
    Object.assign(updates, { state: "No email address on file", detail: `${business} needs an email address for you first.` });
  } else if (u.state === "subscribed") {
    const when = on(day(u.set_at));
    Object.assign(updates, {
      state: u.set_by === "you" ? `Subscribed${when}` : `Subscribed${onBy(u.set_by, business, when)}`,
      control: { checked: true, enabled: u.can_unsubscribe, reason: u.can_unsubscribe ? undefined : `Ask ${business} to change this.`, aria: "Updates and offers" },
    });
  } else if (u.state === "paused") {
    Object.assign(updates, {
      state: u.set_by === "business" ? `Paused by ${business}` : e.state !== "on" ? "Paused while email is off" : "Paused",
      paused: u.set_by === "business",
      control: { checked: false, enabled: false, aria: "Updates and offers",
        reason: e.state !== "on" ? "Turn on email first." : `Only ${business} can resume updates they paused.` },
    });
    if (u.can_unsubscribe) updates.keepOff = { label: "Unsubscribe", help: `You'll stop getting updates and offers, even if ${business} resumes them.` };
  } else {
    const when = on(day(u.set_at));
    Object.assign(updates, {
      state: u.set_by === "you" ? `Not subscribed · you unsubscribed${when}`
        : u.set_by === "unsubscribe_link" ? `Not subscribed · you unsubscribed using the link in an email${when}`
          : u.set_by === "business" ? `Not subscribed · set by ${business}${when}` : "Not subscribed",
      control: { checked: false, enabled: u.can_subscribe, aria: "Updates and offers",
        reason: u.can_subscribe ? undefined : e.state !== "on" ? "Turn on email first." : `Ask ${business} about updates and offers.` },
    });
  }
  return [email, texts, updates];
}

export function refusalText(code: PreferenceRefusal | "OTHER", business: string): string {
  switch (code) {
    case "EMAIL_PAUSED_BY_BUSINESS": return `${business} paused email to you, so it stays off. Ask them to resume it.`;
    case "EMAIL_UNDELIVERABLE": return `Emails to your address weren't being delivered, so email stays off. Ask ${business} to check your address.`;
    case "EMAIL_OFF": return "Turn on email first.";
    case "NO_EMAIL_ADDRESS": return `${business} needs an email address for you first.`;
    case "SMS_OPT_IN_UNAVAILABLE": return "Texts can't be turned on from your account.";
    case "BAD_PREFERENCE": return "That change isn't available. Reload the page and try again.";
    default: return "That change wasn't made. Try again.";
  }
}

const SAVED: Record<PreferenceKey, [string, string]> = {
  email: ["Email is on.", "Email is off."],
  sms: ["Texts are on.", "Texts are off."],
  updates: ["You're subscribed to updates and offers.", "You're unsubscribed from updates and offers."],
  sharing: ["Sharing is on.", "Sharing is off."],
};

export function outcomeText(o: PreferenceOutcome, business: string, stale: boolean): { text: string; alert: boolean } | null {
  if (o.kind === "saved") return { text: SAVED[o.key][o.enabled ? 0 : 1], alert: false };
  if (o.kind === "refused") return { text: refusalText(o.code, business), alert: true };
  if (o.kind === "unconfirmed") {
    return { text: stale
      ? "We couldn't confirm that change. Check your connection, then try again."
      : `We couldn't confirm that change. What you see here is what ${business} has on record.`, alert: true };
  }
  return null;
}
