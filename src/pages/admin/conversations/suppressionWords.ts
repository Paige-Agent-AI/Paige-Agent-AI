// EXP03 (20271120120003, review M1): what a do-not-send row MEANS, in the owner's words, from its reason.
// One home for the Conversations composer and the contact rail, so neither calls a bounce "opted out".
//   bounce_hard  the ADDRESS can't receive (a governed email's hard bounce, keyed on the normalised address,
//                or a campaign bounce on the contact): check it, or use another address.
//   complaint    the person marked your email as spam.
//   anything else (an unsubscribe, a STOP, the contact's own portal choice, the business's own pause):
//                opted out, in the words the inbox already used.
import { CHANNEL_LABEL, type ChannelType, type Suppression } from "./inbox-shared";

export type SuppressionChannel = Suppression["channel"];
export type SuppressionKind = "reported" | "opted_out" | "bounced";

export const BOUNCED_WORDS: Record<SuppressionChannel, { line: string; hint: string }> = {
  email: { line: "This email address bounced.", hint: "Check it, or use another address." },
  sms: { line: "This number couldn't receive texts.", hint: "Check it, or use another number." },
};
export const REPORTED_WORDS: Record<SuppressionChannel, { line: string; hint: string }> = {
  email: { line: "Marked your email as spam", hint: "Paige won't send email." },
  sms: { line: "Reported your texts as spam", hint: "Paige won't text them." },
};

export function kindOf(reason: string): SuppressionKind {
  if (reason === "bounce_hard") return "bounced";
  if (reason === "complaint") return "reported";
  return "opted_out";
}

/** The kinds held on a channel, strongest first: the person's own act (reported, opted out) before a bounce. */
export function kindsOn(rows: readonly Suppression[], channel: string): SuppressionKind[] {
  const present = new Set(rows.filter((r) => r.channel === channel).map((r) => kindOf(r.reason)));
  return (["reported", "opted_out", "bounced"] as const).filter((k) => present.has(k));
}

/** The sentence the composer shows (and the admin inbox toasts) when PAIGE won't send on `channel`, or null. */
export function composeSuppressionNotice(rows: readonly Suppression[], channel: ChannelType | "" | null | undefined): string | null {
  if (channel !== "email" && channel !== "sms") return null;
  const kind = kindsOn(rows, channel)[0];
  if (!kind) return null;
  if (kind === "bounced") return `${BOUNCED_WORDS[channel].line} ${BOUNCED_WORDS[channel].hint}`;
  if (kind === "reported") return channel === "email" ? "They marked your email as spam — Paige won't send email." : "They reported your texts as spam — Paige won't text them.";
  return `This contact opted out of ${CHANNEL_LABEL[channel]} — Paige won't send.`;
}

/** The rail's lines: opt-out channels grouped (as before), then one line per spam report and per bounce. */
export function railSuppressionLines(rows: readonly Suppression[]) {
  const channels = (kind: SuppressionKind) =>
    [...new Set(rows.filter((r) => kindOf(r.reason) === kind).map((r) => r.channel))] as SuppressionChannel[];
  return { optedOut: channels("opted_out"), reported: channels("reported"), bounced: channels("bounced") };
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
