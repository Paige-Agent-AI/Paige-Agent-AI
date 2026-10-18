import type { ClientPortalPreferences, PortalDisclosureId, PreferenceRefusal } from "@/lib/client-portal-preferences";
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

export function preferenceCards(p: ClientPortalPreferences, business: string): PreferenceCard[] {
  const e = p.email, s = p.sms, u = p.updates;

  const email: PreferenceCard = { key: "email", label: "Email", disclosure: "email-pref:v1", state: "On" };
  if (e.state === "no_address") {
    Object.assign(email, { state: "No email address on file", detail: `${business} doesn't have an email address for you. Message them to add one.`, messageLink: true });
  } else if (e.state === "on") {
    Object.assign(email, {
      state: "On",
      control: { checked: true, enabled: e.can_turn_off, reason: e.can_turn_off ? undefined : `Ask ${business} to change this.`, aria: "Email" },
    });
  } else {
    const when = on(day(e.set_at));
    const mine = e.set_by === "you" || e.set_by === "unsubscribe_link";
    if (e.set_by === "business") {
      Object.assign(email, { state: `Paused by ${business}`, paused: true, messageLink: true });
    } else if (e.set_by === "delivery") {
      Object.assign(email, { state: "Off · your email provider reported a problem with these messages", detail: `Ask ${business} to check the email address they have for you.`, messageLink: true });
    } else {
      email.state = e.set_by === "you" ? `Off · you turned email off${when}`
        : e.set_by === "unsubscribe_link" ? `Off · you unsubscribed using the link in an email${when}` : "Off";
    }
    email.control = { checked: false, enabled: e.can_turn_on, aria: "Email",
      reason: e.can_turn_on ? undefined : e.set_by === "business" ? `Only ${business} can resume email they paused.`
        : e.set_by === "delivery" ? `Only ${business} can turn email back on after a delivery problem.` : `Ask ${business} to turn email back on.` };
    if (!mine && e.can_turn_off) {
      email.keepOff = { label: "Keep email off", help: `If ${business} resumes email, it stays off until you turn it back on.` };
    } else if (!mine && !e.can_turn_off) {
      email.detail = [email.detail, `You've turned email off too, so it stays off if ${business} resumes it.`].filter(Boolean).join(" ");
    }
    if (!e.can_turn_on && !mine) email.messageLink = true;
  }

  const texts: PreferenceCard = { key: "sms", label: "Texts", disclosure: "sms-pref:v1", state: "" };
  if (s.state === "no_number") {
    Object.assign(texts, { state: "No phone number on file", detail: `Add your phone number above to choose how ${business} texts you.` });
  } else if (s.state === "on") {
    Object.assign(texts, {
      state: s.set_by === "reply" ? `On · you replied START${on(day(s.set_at))}` : "On",
      detail: p.quiet_hours.time_zone_known
        ? "Texts only arrive between 8am and 8pm your time."
        : `Texts are held overnight, 8pm to 8am. ${business} doesn't have your time zone, so those hours may not match yours.`,
      control: { checked: true, enabled: s.can_turn_off, reason: s.can_turn_off ? undefined : `Ask ${business} to change this.`, aria: "Texts" },
    });
  } else {
    const when = on(day(s.set_at));
    const startOnly = `Texts can only be turned on by replying START to a text from ${business}.`;
    const mine = s.set_by === "you" || (s.set_by === "reply" && s.state === "off");
    if (s.state === "not_set") {
      texts.state = "Not set up";
      if (s.can_turn_off) texts.keepOff = { label: "Don't text me", help: "Records that you don't want texts. Replying START later turns them on." };
    } else if (s.set_by === "business") {
      Object.assign(texts, { state: `Paused by ${business}`, paused: true, messageLink: true });
      if (s.can_turn_off) texts.keepOff = { label: "Keep texts off", help: `If ${business} resumes texts, they stay off until you reply START.` };
      else texts.detail = "You've turned texts off too, so they stay off until you reply START.";
    } else {
      texts.state = s.set_by === "you" ? `Off · you turned texts off${when}`
        : s.set_by === "reply" ? `Off · you replied STOP${when}`
          : s.set_by === "delivery" ? "Off · texts to your number weren't being delivered" : "Off";
      if (!mine && s.can_turn_off) texts.keepOff = { label: "Keep texts off", help: "Records that you don't want texts. Replying START later turns them on." };
    }
    texts.control = { checked: false, enabled: false, reason: startOnly, aria: "Texts" };
  }

  const updates: PreferenceCard = { key: "updates", label: "Updates and offers", disclosure: "updates-optin:v1", state: "" };
  if (u.state === "no_address") {
    Object.assign(updates, { state: "No email address on file", detail: `${business} needs an email address for you first.` });
  } else if (u.state === "subscribed") {
    Object.assign(updates, {
      state: u.set_by === "you" ? `Subscribed${on(day(u.set_at))}` : "Subscribed",
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
    Object.assign(updates, {
      state: "Not subscribed",
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
    case "EMAIL_REPORTED": return `An email from ${business} was reported as spam, so email stays off. Message ${business} if you want email again.`;
    case "EMAIL_OFF": return "Turn on email first.";
    case "NO_EMAIL_ADDRESS": return `${business} needs an email address for you first.`;
    case "SMS_OPT_IN_UNAVAILABLE": return `Texts can only be turned on by replying START to a text from ${business}.`;
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
