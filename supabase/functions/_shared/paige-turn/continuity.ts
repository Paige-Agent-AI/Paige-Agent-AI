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
const strip = (s: string) => s.replace(/[\u2018\u2019]/g, "'").replace(MD, "").replace(/[ \t]+/g, " ").trim();

// An offer phrase: PAIGE proposing to do something herself, for the person to accept.
const OFFER_PHRASE =
  /\b(?:(?:do you )?want me to|would you like me to|should i|shall i|ready for me to|ok(?:ay)? (?:for me to|if i)|mind if i|can i go ahead|should we|shall we|say the word|just say (?:yes|go|the word))\b/gi;
// "…, or not?" / "…or anything else?" do not make an offer a choice between actions.
const NOT_A_CHOICE = /\bor (?:not|no|is there (?:anything|something) else|anything else|something else)\b|\beither way\b|\binstead of\b/gi;
// Words that put a second action beside the offered one. Read AFTER the offer phrase in its own
// sentence, and in every sentence of the message's tail around it — a choice laid out in the
// paragraph before ("Option A… Option B…", "I can send the card or build the invoice") counts too.
const ALTERNATIVE = /\b(?:or|alternatively|otherwise|instead|or else|i (?:can|could) also|(?:happy|glad) to also|could also)\b|\beither\b[^.!?]*\bor\b/i;
// A message that lays out more than one path ("Two ways to do this:", "There are two paths here", "Options:")
// offers a choice whatever its closing words.
const MULTI_PATH = /\b(?:two|three|four|a couple of|both|several|multiple|a few)\s+(?:ways|paths|options|choices|approaches|routes|directions)\b|\boptions?\s*:/i;
const LEADS_WITH_ALTERNATIVE = /^(?:or|alternatively|otherwise|option\s+[a-z0-9]+|either)\b/i;
// An offer that names no act of its own ("Want me to go ahead?") takes its act from what came before,
// so a choice in the paragraph before it is a choice in the offer.
const GENERIC_OFFER = /^(?:go ahead|start|get started|proceed|do (?:it|that|this|them|those|both)|kick (?:it|this|that) off|move forward|get going|take care of (?:it|that|this))\b/i;
const LIST_MARKER = /^\s*(?:[-*\u2022]|\d+[.)])\s+/;

const sentencesOfParagraph = (p: string) => p.split(/\n+/).flatMap((line) => line.replace(LIST_MARKER, "").split(/(?<=[.!?])\s+/))
  .map((x) => x.trim()).filter(Boolean);

/** The offer PAIGE closed her message with, if she closed it with one. */
export function closingOffer(text: string): { offer: string; count: number; alternatives: boolean } | null {
  if (typeof text !== "string" || !text.trim()) return null;
  const paragraphs = text.split(/\n\s*\n/).map((p) => strip(p)).filter(Boolean);
  const last = paragraphs.at(-1);
  if (!last) return null;
  const sentences = sentencesOfParagraph(last);
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
  // THE TAIL: the closing paragraph and the one before it. Two offers anywhere in it is a choice.
  const previous = paragraphs.length > 1 ? sentencesOfParagraph(paragraphs[paragraphs.length - 2]) : [];
  const offersIn = (xs: string[]) => xs.reduce((n, x) => n + (x.match(OFFER_PHRASE) ?? []).length, 0);
  const prevOffers = offersIn(previous);
  const count = offersIn(sentences) + prevOffers;
  const rest = sentence.slice(first.index + first[0].length).trim();
  const noChoiceWords = (x: string) => x.replace(NOT_A_CHOICE, "");
  const alternatives =
    // inside the offer itself, after its phrase: "send the card, or build the invoice?"
    ALTERNATIVE.test(noChoiceWords(rest))
    // any sentence in the tail that opens on another option: "Or should I…", "Option B: …"
    || [...previous, ...sentences].some((x) => LEADS_WITH_ALTERNATIVE.test(x))
    // anything said AFTER the offer that adds another action: "I can also…", "…instead."
    || sentences.slice(closing + 1).some((x) => ALTERNATIVE.test(noChoiceWords(x)))
    // a generic offer takes its act from what came before: a choice there is a choice here
    || (GENERIC_OFFER.test(rest) && [...previous, ...sentences.slice(0, closing)].some((x) => ALTERNATIVE.test(noChoiceWords(x))))
    // a tail that lays out several paths — a heading, its list, then the question: three paragraphs back
    || paragraphs.slice(-3).some((x) => MULTI_PATH.test(x))
    // any offer in the paragraph before this one counts as a second option (it is not compared with this one)
    || prevOffers > 0;
  return { offer: sentence.slice(0, 400), count, alternatives };
}

// A PLAIN ACCEPTANCE, read as a whitelist: the whole reply must be made of acceptance phrases and a few
// fillers — nothing else. Anything left over ("myself", "tomorrow", "got it", "what's the total", "I
// saw that", "to Dana instead") means it is not a bare yes to the offer; the ordinary path reads it.
const ACCEPT = [
  "yes please", "yes sir", "yessir", "yes", "yeah", "yea", "yep", "yup", "ya", "yah",
  "sure thing", "sure", "okay", "ok", "k", "alright", "all right", "absolutely", "definitely", "certainly",
  "of course", "please do", "please", "go ahead", "go for it", "go", "do it", "do that", "do this",
  "send it over", "send it", "ship it", "run it", "let's do it", "let's do that", "let's go", "lets do it",
  "lets do that", "lets go", "sounds good", "sounds great", "sounds right", "sounds perfect", "that works",
  "works for me", "perfect", "great", "correct", "exactly", "affirmative", "why not", "we may as well",
  "may as well", "might as well", "for sure", "totally", "proceed", "bet", "100%", "by all means",
  "make it happen", "let's", "lets",
];
// Polite on their own — "no worries" can as easily decline — so they ride beside an acceptance, never alone.
const SOFT = ["no problem", "no worries"];
const STRONG = new Set(["yes please", "yes sir", "yessir", "yes", "yeah", "yep", "yup", "sure", "sure thing", "please", "please do",
  "go ahead", "go for it", "do it", "absolutely", "definitely"]);
const FILLER = ["i mean", "uh", "um", "oh", "hey", "paige", "right now", "now", "then", "thanks", "thank you", "thx", "ty", "too", "we", "so", ...SOFT];
const PHRASES = [...ACCEPT.map((p) => ({ p, accept: true })), ...FILLER.map((p) => ({ p, accept: false }))]
  .sort((x, y) => y.p.length - x.p.length);
const EMOJI_ACCEPT = /[\u{1F44D}\u2705\u{1F44C}]/gu;

export function isAffirmativeReply(text: string): boolean {
  if (typeof text !== "string") return false;
  let t = text.trim().toLowerCase();
  if (!t || t.includes("?") || t.length > 120) return false;
  if (/[\u{1F44E}\u274C\u{1F6AB}\u270B]/u.test(t)) return false; // 👎 ❌ 🚫 ✋
  t = t.replace(EMOJI_ACCEPT, " yes ").replace(/[\u2019\u2018]/g, "'")
    .replace(/[\u{1F300}-\u{1FAFF}\u2600-\u27BF]/gu, " ")
    .replace(/[!.,;:\u2014\u2013\u2026"()\-]+/g, " ").replace(/\s+/g, " ").trim();
  if (!t || t.split(" ").length > 12) return false;
  // Every way of reading the reply as a run of known phrases (backtracking: "yes please do" is "yes please"
  // + "do"? no — "yes" + "please do"). One complete reading that holds an acceptance is enough.
  const readings = (rest: string): string[][] => {
    if (!rest) return [[]];
    const out: string[][] = [];
    for (const { p } of PHRASES) {
      if (rest === p || rest.startsWith(p + " ")) {
        for (const tail of readings(rest.slice(p.length).trim())) out.push([p, ...tail]);
      }
    }
    return out;
  };
  const accepts = new Set(ACCEPT);
  const thanksWord = /^(?:thanks|thank you|thx|ty)$/;
  return readings(t).some((parts) => {
    const seen = parts.filter((p) => accepts.has(p));
    if (seen.length === 0) return false;
    // "ok thanks" closes a conversation; "yes, thanks" still accepts.
    if (parts.some((p) => thanksWord.test(p)) && !seen.some((p) => STRONG.has(p))) return false;
    return true;
  });
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
//
// The guard runs on every ordinary chat turn, so it is built to stay QUIET on true sentences: a card is
// only an APPROVAL card (a payment card, a contact card, an outcome card are not), an explanation of how
// approvals work claims nothing, a card from earlier is not a new one, and a past fact ("it ran without a
// card since tasks don't need one") is not PAIGE deciding approval. It flags the shapes that put a card
// in front of the person that no tool created, and PAIGE guessing a setting or offering to go around one.

export type UnbackedClaim = "card" | "authority";

// An approval card, by name — or a card in a sentence about approving.
const APPROVAL_CARD = /\b(?:approval card|approval request|needs your ok)\b/i;
const CARD_WORD = /\bcards?\b/i;
const APPROVE_WORD = /\bapprov/i;
// R1 — a card arriving, present or just done: "Sending the approval card now", "You'll see a Needs your OK
// card", "The approval request is out".
const ARRIVING =
  /\b(?:sending|staging|queu(?:e|)ing|popping up|(?:i'?ve|i have|it'?s|that'?s|has been|have been|just) (?:sent|put|staged|queued|filed|raised|created|teed up)|you(?:'ll| will| should) (?:now )?(?:see|get|find)|(?:should|will) (?:now )?(?:appear|show up|pop up)|is (?:now )?(?:up|ready|out|live|on its way|in front of you|coming)|on (?:its|the) way|coming (?:up|your way)|look for)\b/i;
// R2 — the card itself named as sent/up/ready: "Card sent.", "I sent the card", "Here's the approval card".
const CARD_OBJECT = [
  /^(?:the |your |an? )?(?:approval |needs your ok )?card(?:'s| is| has been| was)? (?:now )?(?:sent|up|live|ready|created|queued|staged|on its way|waiting)\b/i,
  /\b(?:the|your|this|that|an?)\s+(?:approval\s+|needs your ok\s+)?card(?:'s| is| has been| was)? (?:now )?(?:sent|up|live|ready|created|queued|staged|on its way)\b/i,
  /\b(?:sent|created|staged|queued|raised|put up|teed up|pulled up)\s+(?:you\s+)?(?:the|a|an|your|that|this)\s+(?:approval\s+|needs your ok\s+)?card\b/i,
  /\bhere(?:'s| is| comes)\s+(?:the|your|an?)\s+(?:approval card|needs your ok card|approval request|card)\b/i,
  /\b(?:sending|putting up|staging|queuing|raising)\s+(?:you\s+)?(?:the|a|an|your|that|this)\s+(?:approval\s+|needs your ok\s+)?card\b/i,
  /\b(?:the|your)\s+(?:approval\s+|needs your ok\s+)?card\s+(?:should|will)\s+(?:now\s+)?(?:appear|show up|pop up)\b/i,
  /\bcard\s+(?:is\s+|'s\s+)?(?:coming|on its way)\s+(?:now|right now|right up|your way)\b/i,
  /\b(?:put|putting|placed|added)\s+(?:it|this|that|them)\s+on\s+(?:a|an|the)\s+(?:approval\s+|needs your ok\s+)?card\b/i,
];
// R3 — telling the person to approve on a card: it says the card is there.
const APPROVE_ON_CARD = /\b(?:click|tap|hit|press)\s+(?:the\s+)?["\u201c]?approve\b|\bapprove (?:it |this |that )?on the card\b/i;
// R4 — announcing the card as happening right now: "I'll send the approval card now."
// (Conditionals are excluded before this runs — "I'll send the approval card once you confirm" is an offer.)
const ANNOUNCE_NOW =
  /\b(?:i'?ll|i will|let me|i'?m going to|i am going to)\s+(?:go ahead and\s+)?(?:send|put|stage|raise|create|file|queue|pull up|get)\b[^.!?]{0,60}\b(?:approval card|needs your ok(?: card)?|approval request)\b/i;
// Offers, conditionals and explanations do not claim a card exists — checked before any card shape, so
// "Say the word and I'll put it on a card" stays an offer.
const OFFER_OR_CONDITION =
  /\b(?:want me to|should i|shall i|would you like|do you want|if (?:you|i)|when (?:you|i)|whenever|once (?:you|i)|after (?:you|i)|before (?:you|i)|until (?:you|i)|say the word|let me know|ready to)\b/i;
// A future ("I'll…", "I can…") claims nothing unless it announces the card as happening now (ANNOUNCE_NOW).
const FUTURE = /\bi(?:'ll| will| can| could| would)\b/i;
// A sentence that says a card does NOT exist is the truth, never a claim. The negation must govern the card
// ("didn't put a card", "no card yet", "nothing is waiting") — an aside like "no rush" negates nothing.
const NEGATED = /\b(?:haven'?t|hasn'?t|didn'?t|don'?t|doesn'?t|isn'?t|aren'?t|wasn'?t|won'?t|never|not yet|no (?:new |approval )?(?:card|cards|approval request)|nothing (?:is |was |has been )?(?:waiting|sent|up|queued|staged|pending)|nothing runs|not (?:sent|up|ready|created|queued|staged|waiting))\b/i;
// A card some other noun owns — payments, a lead in a column, a portal — is not an approval card, unless the
// sentence names one ("approval card", "Needs your OK").
const NON_APPROVAL_CARD = /\b(?:pay|payment|payments|paid|charge|charged|stripe|invoice|on file|credit|debit|wallet|column|board|lead|leads|portal|contact card|business card|report card|scorecard|summary|verification)\b/i;
// Words that say the card is being created now, so "already"/"approvals tab" in the clause is not "from before".
const CREATED_NOW = /\b(?:i'?ve|i have|just)\b[^.!?]{0,30}\b(?:put|sent|added|queued|staged|filed|created|placed)\b|\bnow\b/i;
// A card from before: from earlier, still waiting, in the approvals list — not a new one.
const EARLIER_CARD =
  /\b(?:above|earlier|already|still|previous|previously|yesterday|before|from before|last (?:one|card)|that card|approved|approvals? (?:tab|list|page|queue)|needs your ok list)\b/i;
// The claim is a card arriving now, below, or into the approvals list.
const ARRIVING_EXTRA = /\b(?:incoming|(?:right |just )?below|down below|in your (?:approvals?|needs your ok) (?:tab|queue|list|page))\b/i;
const NEW_CARD = /\b(?:new|second|another|next)\b/i;

// PAIGE deciding approval: guessing a setting, asking whether approvals are on, or offering a way around.
const AUTHORITY_CLAIM = [
  // a guessed setting that licenses an act: "If approvals are OFF in your workspace, then I can run this link…"
  /\bif (?:your |the )?(?:approvals?|approval (?:controls?|settings?|gate)|trust (?:compass|settings?|level))\b[^.!?\n]{0,40}\b(?:off|disabled|turned off|switched off|not (?:on|enabled|required|needed|turned on))\b[^.!?\n]{0,40}\b(?:i can|i could|i'?ll|i will|we can|just say|say the word)\b/i,
  /\b(?:do(?:es)?|is|are|have|has)\s+(?:you|your (?:workspace|account|business)|the workspace)\b[^.!?\n]{0,40}\bapprov\w*[^.!?\n]{0,40}\b(?:enabled|on|off|turned on|turned off|set up|required)\b[^.!?\n]*\?/i,
  /\b(?:i can|i could|i'?ll|i will|we can|we could|want me to|should i|let me|i'?m able to)\s+(?:just\s+)?(?!(?:look|read|research|search|check|find|view|draft|see|pull|review|summari[sz]e|explain|answer)\b)\w+[^.!?\n]{0,50}\b(?:without (?:the|a|an|any|your) (?:approval\s+)?(?:card|approval)|without approval|(?:no|without a) card needed)\b/i,
  /\b(?:i can|i could|i'?ll|i will|we can|we could|want me to|should i|let me)\s+(?:just\s+)?(?:skip|bypass|go around|get around)\s+(?:the |your )?(?:approval|card)\b/i,
];

// "Directly" is ordinary capability talk ("I can query it directly"); it is PAIGE going around approval only
// in a sentence about the card or approval, offered, and not negated (prod replay 2026-10-06: 15 of 16
// authority hits were the bare adverb in honest replies).
const DIRECTLY_AROUND_APPROVAL = (s: string) =>
  /\b(?:i can|i could|i'?ll|i will|we can|we could|want me to|should i|let me|i'?m able to)\b[^.!?\n]{0,50}\bdirectly\b/i.test(s)
  && /\b(?:approv\w*|card|sign[- ]off)\b/i.test(s)
  && !/\b(?:can'?t|cannot|won'?t|not|never|isn'?t|aren'?t)\b/i.test(s)
  // "Approve the card and I'll email it directly" / "once you approve, I'll send it directly" put approval first.
  && !/\b(?:once|after|when|as soon as) you approve\b|\bapprove (?:it|the card|that|this)?\s*(?:and|,)\s*(?:then\s+)?i'?ll\b|\bafter you approve\b/i.test(s);

const clausesOf = (text: string) => strip(text)
  .split(/(?<=[.!?])\s+|\n+/)
  .flatMap((sentence) => sentence.split(/\s+[\u2014\u2013-]\s+|;\s+|,\s+(?=(?:and|but|then|so)\s)/))
  .map((x) => x.trim()).filter(Boolean);

/**
 * A claim in PAIGE's reply that nothing in this turn backs. `cardMinted`: an approval card was created in
 * this turn. `standingCard`: her previous turn left one standing. Authority claims are never backed —
 * approval is the platform's decision, made when the tool is called.
 */
export function unbackedClaim(text: string, opts: { cardMinted: boolean; standingCard: boolean }): UnbackedClaim | null {
  if (typeof text !== "string" || !text.trim()) return null;
  const sentences = strip(text).split(/(?<=[.!?])\s+|\n+/).map((x) => x.trim()).filter(Boolean);
  if (sentences.some((s) => AUTHORITY_CLAIM.some((re) => re.test(s)) || DIRECTLY_AROUND_APPROVAL(s))) return "authority";
  if (opts.cardMinted) return null;
  for (const c of clausesOf(text)) {
    const approvalsList = /\b(?:approvals?|needs your ok) (?:tab|queue|list|page)\b/i.test(c);
    const approvalContext = APPROVAL_CARD.test(c) || approvalsList || (CARD_WORD.test(c) && APPROVE_WORD.test(c));
    const cardMentioned = APPROVAL_CARD.test(c) || CARD_WORD.test(c) || approvalsList;
    if (!cardMentioned) continue;
    if (NEGATED.test(c)) continue;
    if (EARLIER_CARD.test(c) && !CREATED_NOW.test(c)) continue;
    if (!APPROVAL_CARD.test(c) && NON_APPROVAL_CARD.test(c)) continue;
    if (opts.standingCard && !NEW_CARD.test(c)) continue;
    // "…you'll need to hit Approve on the card" explains how it will work; it does not say a card is there.
    if (APPROVE_ON_CARD.test(c) && !/\b(?:if|when|whenever) you\b|\b(?:need|needs|have|has) to\b/i.test(c)) return "card";
    if (OFFER_OR_CONDITION.test(c)) continue;
    if (ANNOUNCE_NOW.test(c)) return "card";
    if (CARD_OBJECT.some((re) => re.test(c))) return "card";
    if (c.endsWith("?") || FUTURE.test(c)) continue;
    if (approvalContext && (ARRIVING.test(c) || ARRIVING_EXTRA.test(c))) return "card";
  }
  return null;
}

/** What PAIGE is told, inside the turn, when her reply carried an unbacked claim. */
export const CLAIM_CORRECTION: Record<UnbackedClaim, string> = {
  card: "Correction: no approval card was created in this turn, so none is in front of the person. If you meant to propose an action, call its tool now — the platform creates the card when the act needs one. If you are not ready to, say plainly that you have not set anything up for their approval in this reply, and why. Do not describe a card that does not exist. Do not call a tool again for anything that already ran in this turn.",
  authority: "Correction: whether an act needs the person's approval is decided by the platform when its tool is called — from the act's risk, the workspace's Trust settings, the person's role and the workspace — never by you, and never from a setting you guess. Rewrite your reply without that: do not guess a setting, ask whether approvals are on, or offer to skip a card or run something directly. Say plainly what you actually did in this turn and what is waiting. Do not call a tool again for anything that already ran; if the person still wants an act that has not run, call its tool.",
};

/** What the person reads when the correction did not take: the server's own answer, which claims only
 *  what the server knows — nothing about cards from earlier turns, and nothing that hides work done. */
export function claimFallback(kind: UnbackedClaim, opts: { didWork: boolean }): string {
  const lead = kind === "card"
    ? "I didn't put a new approval card in front of you in this reply. Ask me and I'll set it up properly."
    : "Whether something needs your OK is decided by the platform when I go to do it — not by me, and not by a setting I guess.";
  return opts.didWork ? `${lead} Anything I did in this reply is shown above.` : lead;
}
