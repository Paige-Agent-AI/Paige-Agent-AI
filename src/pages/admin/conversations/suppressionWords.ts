// EXP03 (20271120120003, review M1/M-B): what a do-not-send row MEANS, in the owner's words, from its reason
// and how it is keyed. One home for the Conversations composer and the contact rail, so neither calls a bounce
// "opted out", and neither promises a fix that would not lift the hold.
//   bounce_hard on the ADDRESS (a governed email's hard bounce, keyed on the normalised address): the address
//                can't receive — check it, or use another address (a corrected address is not held).
//   bounce_hard on the CONTACT (the campaign applier and the Resend receipt path write those): changing the
//                address does NOT lift it; only the contact card's DND switch does (admin inbox), and the Solo
//                inbox has no such control, so it says so.
//   complaint    the person marked your email as spam.
//   anything else (an unsubscribe, a STOP, the contact's own portal choice, the business's own pause):
//                opted out, in the words the inbox already used.
import { CHANNEL_LABEL, type ChannelType, type Suppression } from "./inbox-shared";

export type SuppressionChannel = Suppression["channel"];
export type SuppressionKind = "reported" | "opted_out" | "bounced_contact" | "bounced";

export const BOUNCED_WORDS: Record<SuppressionChannel, { line: string; hint: string }> = {
  email: { line: "This email address bounced.", hint: "Check it, or use another address." },
  sms: { line: "This number couldn't receive texts.", hint: "Check it, or use another number." },
};
// A bounce kept on the contact. The hint names the real control on the rail: the Email / SMS switch in the
// contact card's DND tab (its writer, set_contact_channel_suppression, deletes rows keyed on the contact).
export const BOUNCED_CONTACT_WORDS: Record<SuppressionChannel, { line: string; hint: string; note: string; solo: string }> = {
  email: {
    line: "This contact's email bounced.", hint: "Fix their address, then turn off Email in the DND tab.",
    note: "Bounced. Fix their address, then turn this off.", solo: "Changing their address won't lift this hold.",
  },
  sms: {
    line: "This contact's number couldn't receive texts.", hint: "Fix their number, then turn off SMS in the DND tab.",
    note: "Couldn't receive texts. Fix their number, then turn this off.", solo: "Changing their number won't lift this hold.",
  },
};
export const REPORTED_WORDS: Record<SuppressionChannel, { line: string; hint: string }> = {
  email: { line: "Marked your email as spam", hint: "Paige won't send email." },
  sms: { line: "Reported your texts as spam", hint: "Paige won't text them." },
};

export function kindOf(row: Pick<Suppression, "reason" | "keyed">): SuppressionKind {
  if (row.reason === "bounce_hard") return row.keyed === "address" ? "bounced" : "bounced_contact";
  if (row.reason === "complaint") return "reported";
  return "opted_out";
}

/** The kinds held on a channel, strongest first: the person's own act, then a hold on the contact, then an address. */
export function kindsOn(rows: readonly Suppression[], channel: string): SuppressionKind[] {
  const present = new Set(rows.filter((r) => r.channel === channel).map((r) => kindOf(r)));
  return (["reported", "opted_out", "bounced_contact", "bounced"] as const).filter((k) => present.has(k));
}

/**
 * The sentence the composer shows (and the admin inbox toasts) when PAIGE won't send on `channel`, or null.
 * `canLiftHere`: this inbox shows the contact card with its DND tab (the admin inbox; the Solo inbox does not).
 */
export function composeSuppressionNotice(
  rows: readonly Suppression[], channel: ChannelType | "" | null | undefined, opts: { canLiftHere?: boolean } = {},
): string | null {
  if (channel !== "email" && channel !== "sms") return null;
  const kind = kindsOn(rows, channel)[0];
  if (!kind) return null;
  if (kind === "bounced") return `${BOUNCED_WORDS[channel].line} ${BOUNCED_WORDS[channel].hint}`;
  if (kind === "bounced_contact") {
    const w = BOUNCED_CONTACT_WORDS[channel];
    return opts.canLiftHere ? `${w.line} ${w.hint.replace(/\.$/, " of their card.")}` : `${w.line} ${w.solo}`;
  }
  if (kind === "reported") return channel === "email" ? "They marked your email as spam — Paige won't send email." : "They reported your texts as spam — Paige won't text them.";
  return `This contact opted out of ${CHANNEL_LABEL[channel]} — Paige won't send.`;
}

/** The rail's lines: opt-out channels grouped (as before), then one line per spam report and per bounce. */
export function railSuppressionLines(rows: readonly Suppression[]) {
  const channels = (kind: SuppressionKind) =>
    [...new Set(rows.filter((r) => kindOf(r) === kind).map((r) => r.channel))] as SuppressionChannel[];
  return {
    optedOut: channels("opted_out"), reported: channels("reported"),
    bouncedContact: channels("bounced_contact"), bounced: channels("bounced"),
  };
}

/** A row the rail's Do-not-contact switch can change: its writer lifts only rows keyed on the contact. */
export const switchable = (row: Suppression) => row.keyed !== "address";

/**
 * The address a suppression is keyed on, exactly as the writers normalise it (public._comms_normalize_address
 * for email, mirrored by pre-send-pipeline.ts normalizeEmail): trimmed, lower-cased, +tag folded.
 */
export function normalizeSuppressionEmail(addr: string): string {
  const lower = (addr ?? "").trim().toLowerCase();
  const at = lower.lastIndexOf("@");
  if (at <= 0) return lower;
  return `${lower.slice(0, at).split("+")[0]}@${lower.slice(at + 1)}`;
}
