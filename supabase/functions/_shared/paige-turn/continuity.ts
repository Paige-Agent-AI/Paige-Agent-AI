// INT-332 — ACTION CONTINUITY: an accepted offer is the task, and a card is never narrated into being.
//
// The production strand (2026-10-06, a long Solo thread): PAIGE ended a FINAL answer with "Want me to
// send that approval card now…?", the owner replied "Yes we may as well for sure", and PAIGE answered
// "Sending the approval card now…" — no tool, no card, no `paige_pending_confirmations` row. Two
// gates read only the person's literal words and both missed: the tier router (`substantiveTurnIntent`)
// sent the turn to the cheap tier (#34 already documents it dropping mutating tool calls), and C1's
// `isActionIntent` did not count it as action, so prose that claimed a card was accepted as FINAL.
// The next turn then invented an authority rule ("if approvals are OFF I can run it directly").
//
// This module is the pure half of the fix. The chat handler (`paige-ai-chat`) does the IO.
//
//  1. THE FOREGROUND OFFER. A short affirmative continues ONE unambiguous action that PAIGE herself
//     just placed in the conversational foreground: her immediately preceding turn, FINAL (not a
//     card, a question or work already standing), recent, ending in a single offer. Read from the
//     caller's own persisted thread — no new state is stored anywhere. It is NOT "yes = execute": it
//     routes the turn to the tier that reliably calls tools, tells PAIGE the offered step is the
//     task, and counts the turn as action for C1. The tool still goes through the gate, which alone
//     decides whether the act needs the person's approval. A reply that hedges, declines, modifies or
//     asks is not an acceptance; an offer that named alternatives asks which; anything else is the
//     ordinary path.
//
//  2. UNBACKED CLAIMS. A reply may not say an approval card is coming, ready or waiting unless a card
//     was created in this turn (or one is visibly standing from the turn before), and it may not
//     decide approval itself ("approvals are off", "I can run it directly", "without the card").
//     Such prose is never a terminal answer: it is corrected inside the turn, and if it still stands
//     the server answers truthfully instead.
//
// It grants nothing, reads no request field for authority, and writes nothing. Pure TypeScript with
// no runtime imports beyond the sibling contract, so Deno, Node (the authz harness) and vitest load it.

import { readTurnRecord } from "./contract.ts";

/** How long PAIGE's offer stays in the foreground. Older than this, a bare "yes" is not read as it. */
export const OFFER_FRESH_MS = 30 * 60 * 1000;

/** The turns the handler reads, newest first (role, content, created_at, bundle_ref). */
export type ForegroundTurn = { role?: unknown; content?: unknown; created_at?: unknown; bundle_ref?: unknown };

export type ForegroundOffer =
  | { kind: "accepted"; offer: string }
  | { kind: "ambiguous"; offer: string }
  | { kind: "none"; reason: ForegroundNoneReason };

export type ForegroundNoneReason =
  | "no_previous_turn"
  | "not_assistant"
  | "standing_wait"
  | "not_final"
  | "stale"
  | "no_offer"
  | "not_affirmative";

export type Foreground = {
  offer: ForegroundOffer;
  /** PAIGE's previous turn left an approval card standing (WAIT_APPROVAL, still recent). */
  standingCard: boolean;
};

const MD = /[*_`~>#]+/g;
const strip = (s: string) => s.replace(MD, "").replace(/[ \t]+/g, " ").trim();

// An offer phrase: PAIGE proposing to do something herself, for the person to accept.
const OFFER_PHRASE =
  /\b(?:(?:do you )?want me to|would you like me to|should i|shall i|ready for me to|ok(?:ay)? (?:for me to|if i)|mind if i|can i go ahead|should we|shall we|say the word|just say (?:yes|go|the word))\b/gi;
// "…, or not?" / "…or anything else?" do not make an offer a choice between actions.
const NOT_A_CHOICE = /\bor (?:not|no|is there (?:anything|something) else|anything else|something else)\b/gi;

/** The offer PAIGE closed her message with, if she closed it with one. */
export function closingOffer(text: string): { offer: string; count: number; alternatives: boolean } | null {
  if (typeof text !== "string" || !text.trim()) return null;
  const paragraphs = text.split(/\n\s*\n/).map((p) => strip(p)).filter(Boolean);
  const last = paragraphs.at(-1);
  if (!last) return null;
  const sentences = last.split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter(Boolean);
  // The sentence the message ends on as a request to the person: its last question, or a closing
  // "say the word…". One short trailing statement after it ("No rush.") is allowed; more than that,
  // and the message has moved on from its question.
  let closing = -1;
  for (let i = sentences.length - 1; i >= 0; i--) {
    if (sentences[i].endsWith("?") || /\bsay the word\b/i.test(sentences[i])) { closing = i; break; }
  }
  if (closing < 0 || closing < sentences.length - 2) return null;
  const sentence = sentences[closing];
  OFFER_PHRASE.lastIndex = 0;
  const first = OFFER_PHRASE.exec(sentence);
  if (!first) return null;
  // Count offer phrases across the whole closing paragraph: two offers is a choice, not an offer.
  const count = (last.match(OFFER_PHRASE) ?? []).length;
  const after = sentence.slice(first.index + first[0].length).replace(NOT_A_CHOICE, "");
  const alternatives = /\bor\b/i.test(after) || /\beither\b/i.test(after);
  return { offer: sentence.slice(0, 400), count, alternatives };
}

// A plain acceptance: short, no question, nothing that declines, defers, hedges or changes the offer.
const AFFIRM_START =
  /^(?:yes|yeah|yea|yep|yup|ya|yah|sure|ok(?:ay)?|k|alright|all right|absolutely|definitely|certainly|of course|please|go ahead|go for it|do it|do that|send it|ship it|run it|let'?s|sounds (?:good|great|perfect)|perfect|great|correct|exactly|affirmative|why not|(?:we |i )?(?:may|might) as well|for sure|totally|proceed)\b/;
const NOT_PLAIN =
  /\b(?:no|nope|nah|not|don'?t|do not|wait|hold|stop|cancel|later|never|instead|actually|but|except|unless|hmm|rather|change|make it|first)\b/;
const THANKS = /\b(?:thanks?|thank you|thx|ty)\b/;
const STRONG_ACCEPT = /^(?:yes|yeah|yep|yup|sure|please|go ahead|do it|absolutely|definitely)\b/;
const EMOJI_ACCEPT = /^(?:\u{1F44D}|✅|\u{1F44C})+$/u;

export function isAffirmativeReply(text: string): boolean {
  if (typeof text !== "string") return false;
  let t = text.trim().toLowerCase();
  if (!t || t.includes("?") || t.length > 120) return false;
  if (EMOJI_ACCEPT.test(t.replace(/\s+/g, ""))) return true;
  t = t.replace(/^(?:(?:hey|oh|ok so|so),?\s+)?paige[,!.:\s]+/, "").replace(/[\u{1F300}-\u{1FAFF}☀-➿]/gu, " ").trim();
  const words = t.split(/\s+/).filter(Boolean);
  if (words.length === 0 || words.length > 12) return false;
  if (!AFFIRM_START.test(t)) return false;
  if (NOT_PLAIN.test(t)) return false;
  if (THANKS.test(t) && !STRONG_ACCEPT.test(t)) return false;
  return true;
}

/**
 * Whether this reply continues an offer PAIGE herself just made. `turns` is the caller's own thread,
 * newest first, as the handler read it (the just-appended reply may already be at its head).
 */
export function readForeground(turns: ForegroundTurn[] | null | undefined, reply: string, nowMs: number): Foreground {
  const list = Array.isArray(turns) ? turns : [];
  let i = 0;
  const head = list[0];
  if (head && head.role === "user" && typeof head.content === "string" && head.content.trim() === String(reply ?? "").trim()) i = 1;
  const prev = list[i];
  if (!prev) return { offer: { kind: "none", reason: "no_previous_turn" }, standingCard: false };
  if (prev.role !== "assistant") return { offer: { kind: "none", reason: "not_assistant" }, standingCard: false };
  const created = typeof prev.created_at === "string" ? Date.parse(prev.created_at) : NaN;
  const fresh = Number.isFinite(created) && nowMs - created <= OFFER_FRESH_MS && nowMs - created >= -60_000;
  const bundle = prev.bundle_ref && typeof prev.bundle_ref === "object" ? prev.bundle_ref as Record<string, unknown> : {};
  const record = readTurnRecord(bundle.turn_state);
  const standingCard = fresh && (record?.state === "WAIT_APPROVAL"
    || (Array.isArray(bundle.paige_confirm) && bundle.paige_confirm.length > 0));
  if (record && (record.state === "WAIT_APPROVAL" || record.state === "ASK_USER" || record.state === "WAIT_WORK")) {
    return { offer: { kind: "none", reason: "standing_wait" }, standingCard };
  }
  if (bundle.paige_ask || (Array.isArray(bundle.paige_confirm) && bundle.paige_confirm.length > 0)) {
    return { offer: { kind: "none", reason: "standing_wait" }, standingCard };
  }
  // A turn with no record predates the turn contract; one with a record must have finished cleanly.
  if (record && record.state !== "FINAL") return { offer: { kind: "none", reason: "not_final" }, standingCard };
  if (!fresh) return { offer: { kind: "none", reason: "stale" }, standingCard };
  const closing = closingOffer(typeof prev.content === "string" ? prev.content : "");
  if (!closing) return { offer: { kind: "none", reason: "no_offer" }, standingCard };
  if (!isAffirmativeReply(reply)) return { offer: { kind: "none", reason: "not_affirmative" }, standingCard };
  if (closing.count > 1 || closing.alternatives) return { offer: { kind: "ambiguous", offer: closing.offer }, standingCard };
  return { offer: { kind: "accepted", offer: closing.offer }, standingCard };
}

const quote = (s: string, n: number) => s.replace(/[«»]/g, "").replace(/\s+/g, " ").trim().slice(0, n);

/** The note PAIGE reads on a turn that accepts her single offer. */
export function acceptedOfferNote(offer: string, reply: string): string {
  return `THE PERSON IS ANSWERING YOUR OFFER. Your previous message ended: «${quote(offer, 400)}». They replied: «${quote(reply, 200)}» — that accepts it, so the step you offered is this turn's task. Carry it out now by calling its tool, resolving anything it needs with current reads first. When the step needs their approval, calling the tool is what puts the approval card in front of them; describing a card does not create one, so never say a card is coming, ready or sent unless a tool in this turn returned one. If you offered a sequence, start with its first step. If it can no longer be done as offered — the record changed, the tool refuses, or a fact is missing — say so plainly or ask the one question you need. Their reply approves nothing by itself: the platform decides whether the step needs a card.`;
}

/** The note PAIGE reads when the offer she closed on named more than one action. */
export function ambiguousOfferNote(offer: string, reply: string): string {
  return `THE PERSON IS ANSWERING YOUR OFFER, BUT IT NAMED MORE THAN ONE THING. Your previous message ended: «${quote(offer, 400)}». They replied: «${quote(reply, 200)}». Do not pick one for them and do not act yet: ask which they mean, in one short question.`;
}

// ── UNBACKED CLAIMS ────────────────────────────────────────────────────────────────────────────

export type UnbackedClaim = "card" | "authority";

const CARD_NOUN = /\b(?:approval card|card|needs your ok|approval request)\b/i;
// Present/perfect claims that a card exists or is arriving now.
const CARD_CLAIM =
  /\b(?:sending|putting(?: up)?|staging|queu(?:e|)ing|filing|raising|pulling up|popping up|(?:i'?ve|i have|it'?s|that'?s|has been|have been|just) (?:sent|put|staged|queued|filed|raised|created|added)|here(?:'s| is| comes)|you(?:'ll| will| should) (?:now )?(?:see|get|find)|(?:should|will) (?:now )?(?:appear|show up|pop up)|is (?:now )?(?:up|ready|on its way|waiting(?: for you)?|in front of you|coming)|on (?:its|the) way|coming (?:up|your way))\b/i;
// "Once you click Approve on the card" asserts the card exists.
const CLICK_APPROVE = /\b(?:once|when|after) you (?:click|tap|hit|press) (?:the )?["“]?approve\b/i;
// Offers, futures and conditionals do not claim a card exists.
const NOT_A_CLAIM =
  /\?|\b(?:want me to|should i|shall i|would you like|i(?:'ll| will| can| could| would)|if you|say the word|let me know|ready to)\b/i;
// A sentence that says a card does NOT exist is the truth this guard wants, never a claim.
const NEGATED = /\b(?:haven'?t|hasn'?t|didn'?t|isn'?t|aren'?t|wasn'?t|no|nothing|not|never)\b/i;
// A sentence about a card that is already standing from before.
const EARLIER_CARD = /\b(?:above|earlier|already|still|previous|from before|last (?:one|card)|that card)\b/i;

// PAIGE deciding approval herself, or offering to go around it.
const AUTHORITY_CLAIM = [
  /\b(?:approvals?|approval (?:controls?|settings?|gate)|trust (?:compass|settings?))\b[^.!?\n]{0,50}\b(?:off|disabled|turned off|switched off|not (?:on|enabled|required|needed))\b/i,
  /\b(?:run|execute|do|apply|make|push) (?:it|this|that|the (?:link|change|update|action)) directly\b/i,
  /\bwithout (?:the|a|an|any) (?:approval )?card\b/i,
  /\bskip(?:ping)? (?:the |your )?(?:approval|card)\b/i,
  /\b(?:bypass|go around) (?:the |your )?(?:approval|card)\b/i,
];

const sentencesOf = (text: string) => strip(text).split(/(?<=[.!?])\s+|\n+/).map((s) => s.trim()).filter(Boolean);

/**
 * A claim in PAIGE's reply that nothing in this turn backs. `cardMinted`: an approval card was
 * created in this turn. `standingCard`: her previous turn left one standing. Authority claims are
 * never backed — approval is the platform's decision, made when the tool is called.
 */
export function unbackedClaim(text: string, opts: { cardMinted: boolean; standingCard: boolean }): UnbackedClaim | null {
  if (typeof text !== "string" || !text.trim()) return null;
  const sentences = sentencesOf(text);
  if (sentences.some((s) => AUTHORITY_CLAIM.some((re) => re.test(s)))) return "authority";
  if (opts.cardMinted) return null;
  for (const s of sentences) {
    if (!CARD_NOUN.test(s)) continue;
    if (opts.standingCard && EARLIER_CARD.test(s)) continue;
    if (CLICK_APPROVE.test(s)) {
      if (opts.standingCard) continue;
      return "card";
    }
    if (NOT_A_CLAIM.test(s) || NEGATED.test(s)) continue;
    if (CARD_CLAIM.test(s)) return "card";
  }
  return null;
}

/** What PAIGE is told, inside the turn, when her reply carried an unbacked claim. */
export const CLAIM_CORRECTION: Record<UnbackedClaim, string> = {
  card: "Correction: no approval card was created in this turn, so none is in front of the person. If you meant to propose an action, call its tool now — the platform creates the card when the act needs one. If you are not ready to, say plainly that nothing is waiting for their approval yet, and why. Do not describe a card that does not exist.",
  authority: "Correction: whether an act needs the person's approval is decided by the platform when you call its tool — from the act's risk, the workspace's Trust settings, the person's role and the workspace — never by you, and never from a setting you guess. Do not offer to skip a card, run something directly, or ask whether approvals are on. If the person wants the act, call its tool now; otherwise say plainly what is and isn't waiting.",
};

/** What the person reads when the correction did not take: the server's own truthful answer. */
export const CLAIM_FALLBACK: Record<UnbackedClaim, string> = {
  card: "I haven't put an approval card in front of you — nothing is waiting for your OK yet. Ask me again and I'll set it up properly.",
  authority: "Whether that needs your approval isn't mine to decide — the platform decides when I go to do it, and shows you a card if it needs one. Ask me again and I'll set it up.",
};
