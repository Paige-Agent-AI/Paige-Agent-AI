import type { ClientCommunicationState as State, PreferenceSetBy } from "@/lib/client-portal-preferences";

/**
 * E09 Slice 6 — the owner's words for "How {client} can be reached", from the same derived state the
 * client's own account shows. Kept apart from the component so each sentence can be pinned by tests.
 */
const DATE = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" });
export function reachDay(at: string | null): string | null {
  if (!at) return null;
  const t = Date.parse(at);
  return Number.isFinite(t) ? DATE.format(t) : null;
}

/** Who made the deciding choice, in the owner's words. The client's name is never guessed. */
export function ownerSetBy(by: PreferenceSetBy | null, state: string): string | null {
  switch (by) {
    case "you": return "the client";
    // D7: anything the business recorded or paused is labelled as the business's, never as the client's.
    case "business": return "your business";
    case "reply": return state === "on" ? "their START reply" : "their STOP reply";
    case "unsubscribe_link": return "their unsubscribe link";
    case "delivery": return "delivery failures";
    case "reported": return "their spam report";
    case "form": return "a sign-up form";
    default: return null;
  }
}

/** `note` is one extra sentence, only where who may undo it is not obvious from the value. */
export type ReachRow = { label: string; value: string; by?: string | null; at?: string | null; paused?: boolean; note?: string };

export function communicationRows(s: State): ReachRow[] {
  const reported = s.email.state === "off" && s.email.set_by === "reported";
  const email: ReachRow = {
    label: "Email",
    value: s.email.state === "on" ? "On" : s.email.state === "no_address" ? "No email address on file"
      : s.email.set_by === "business" ? "Paused"
        // The client's own spam report: only they can lift it, from their portal (integrator default (owner may overrule), 2026-10-18).
        : reported ? "Off · they reported email as spam" : "Off",
    by: s.email.state === "no_address" || reported ? null : ownerSetBy(s.email.set_by, s.email.state), at: s.email.set_at,
    paused: s.email.state === "off" && s.email.set_by === "business",
    note: reported ? "Only they can turn it back on." : undefined,
  };
  const texts: ReachRow = {
    label: "Texts",
    value: s.sms.state === "on" ? "On" : s.sms.state === "no_number" ? "No phone number on file"
      : s.sms.state === "not_set" ? "Not set up · no START reply on record, so texts are held"
        : s.sms.set_by === "business" ? "Paused" : "Off",
    by: s.sms.state === "on" || s.sms.state === "off" ? ownerSetBy(s.sms.set_by, s.sms.state) : null, at: s.sms.set_at,
    paused: s.sms.state === "off" && s.sms.set_by === "business",
  };
  const updates: ReachRow = {
    label: "Updates and offers",
    value: s.updates.state === "subscribed" ? "Subscribed" : s.updates.state === "no_address" ? "No email address on file"
      : s.updates.state === "paused" ? (s.updates.set_by === "business" ? "Paused" : s.email.state !== "on" ? "Paused while email is off" : "Paused") : "Not subscribed",
    by: ownerSetBy(s.updates.set_by, s.updates.state), at: s.updates.set_at, paused: s.updates.state === "paused" && s.updates.set_by === "business",
  };
  return [
    email, texts, updates,
    // The switch exists and the client can turn it on, but nothing reads it yet (D2): say so, so nobody relies on it.
    { label: "Shared Paige context", value: s.data_sharing.allowed ? "Allowed by the client · it has no effect yet" : "Not allowed", at: s.data_sharing.allowed ? s.data_sharing.updated_at : null },
    // E09 Slice 7: "joined" is the login link, which a paused client keeps and an ended one has lost.
    { label: "Portal", value: s.portal_access === "paused" ? "Joined · access paused, so they can’t open the portal"
      : s.portal_access === "ended" ? "Access ended · they need a new invitation to come back"
        : s.portal_access === "not_joined" ? "Not joined yet"
          : s.portal_access === "open" || s.portal_joined ? "Joined" : "Not joined yet" },
    { label: "Do not contact (marketing)", value: s.do_not_contact ? "On · left out of marketing email" : "Off" },
    { label: "Do not disturb", value: s.dnd_active ? "On · Paige holds emails and texts while the hold lasts" : "Off" },
  ];
}
