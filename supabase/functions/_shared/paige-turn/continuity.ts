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
  /\b(?:(?:do you )?want me to|would you like me to|should i|shall i|ready for me to|ok(?:ay)? (?:for me to|if i)|mind if i|can i go ahead|should we|shall we|(?<=^\s*)ready to(?=[^.!?]*\?)|say the word|just say (?:yes|go|the word)|say yes|give me the (?:word|nod|go-?ahead))\b/gi;
// "…, or not?" / "…or anything else?" do not make an offer a choice between actions.
const NOT_A_CHOICE = /\bor (?:not|no|is there (?:anything|something) else|anything else|something else)\b|\beither way\b|\binstead of\b|\b(?:one|two|three|a minute|a day|a week|an hour|a few|a couple) or (?:two|three|four|so|more)\b|\botherwise,? i'?ll (?:hold|wait|keep|leave)\b/gi;
// Words that put a second action beside the offered one. Read AFTER the offer phrase in its own
// sentence, and in every sentence of the message's tail around it — a choice laid out in the
// paragraph before ("Option A… Option B…", "I can send the card or build the invoice") counts too.
const ALTERNATIVE = /\b(?:or|alternatively|instead|or else|i (?:can|could) also|(?:happy|glad) to also|could also)\b|\beither\b[^.!?]*\bor\b/i;
// A message that lays out more than one path ("Two ways to do this:", "There are two paths here", "Options:")
// offers a choice whatever its closing words.
const MULTI_PATH = /\b(?:two|three|four|a couple of|both|several|multiple|a few)\s+(?:ways|paths|options|choices|approaches|routes|directions)\b|\boptions?\s*:/i;
const LEADS_WITH_ALTERNATIVE = /^(?:or|alternatively|option\s+[a-z0-9]+|either(?! way))\b/i;
// An offer that names no act of its own ("Want me to go ahead?") takes its act from what came before,
// so a choice in the paragraph before it is a choice in the offer.
const GENERIC_OFFER = /^(?:$|[?.!]|go ahead|start|get started|proceed|do (?:it|that|this|them|those|both)|kick (?:it|this|that) off|move forward|get going|take care of (?:it|that|this)|handle (?:it|that|this))/i;
const LIST_MARKER = /^\s*(?:[-*\u2022]|\d+[.)])\s+/;

// WHAT KIND OF STEP DID PAIGE OFFER? Three answers:
//  · "prose"   — the answer IS the reply: explain, summarise, suggest, a draft or rewrite for the person, with no
//                destination and nothing done after it. Not held: its prose stands as written.
//  · "act"     — a platform step: an act after the draft ("…and queue it"), a destination ("…to her record",
//                "…on the landing page", "…in Gmail"), or a known act verb.
//  · "unknown" — neither. Held exactly like an act.
// A held step ends in a tool, a card, an ask_choices question, or a stated impossibility. If it runs out of rounds,
// the handler KEEPS its last reply and adds NOTHING_RAN_NOTE — true whether that reply was an answer or a made-up
// result. No word list decides what the person is shown (review rounds 5–8 each found a list wrong both ways).
const DESTINATION = /\b(?:to|in|into|on|onto|under|from)\s+(?:[\w'-]+\s+){0,3}?(?:record|contact|profile|notes?|deal|task|portal|page|landing page|site|website|sequence|campaign|inbox|gmail|outlook|calendar|settings|automation|workflow|pipeline|crm|knowledge base|folder|file|board|list|queue|approvals?|thread|channel|doc)\b|\b(?:scheduled|recurring|each (?:day|week|monday|morning)|every (?:day|week|monday|morning))\b|\b(?:approval card|approval request|needs your ok|card)\b/i;
const THEN_ACTS = /\b(?:and|then)\s+(?:then\s+)?(?:re-?send|send|post|re-?publish|publish|schedule|book|queue|email|text (?:her|him|them|it)|get (?:it|that|them) (?:out|over|sent)|fire (?:it|that) off|deliver|share (?:it|that) with|save|attach|log|file|update|add (?:it|that|them) to|put (?:it|that|them) (?:on|in|into)|push|launch|go live|create|set (?:it |that |them )?up|import|go ahead|activate|run (?:it|them))\b/i;
// The answer is the reply itself.
const PROSE_LEAD = /^(?:(?:just|first|quickly|briefly)\s+)?(?:walk (?:you|them|her|him|us) through|explain|describe|detail|spell out|lay out|map out|sketch out|break (?:it |that |this |them |those |down )?(?:down)?|summari[sz]e|recap|outline|compare|tell you|go (?:over|through)|run (?:you )?through|unpack|clarify|expand on|elaborate|brainstorm|suggest|recommend|give you|share (?:a few|some|my|the|three|two) (?:ideas|thoughts|options|recommendations?|take|examples?|angles?)|come up with|talk(?: (?:about|through|it over|pricing|strategy|shop))?\b|discuss|chat about|dig into|look (?:at|into|over)|review|move on\b(?! to (?:the )?next (?:contact|deal|lead|client|record|stage))|offer (?:you|a few|some)|translate|point you|show you(?: how| what| where| an?)?|help (?:you )?(?:think|write|plan|decide|word|prep|prepare|draft|formali[sz]e|figure|work out|outline|sketch)|walk through|draw (?:it|this|that) out|think (?:it|this|that) through|prep (?:you|some|a few)|list (?:the options|out|a few|some|them|the (?:top|best|main|key|biggest|first|pros)\b[^?]{0,20})|start (?:with|by) (?:the |a |an )?(?:summary|explain\w*|outlin\w*|overview|recap|breakdown)|move on to (?:the )?next (?:question|point|section|idea|one)|keep going|continue (?:with )?(?:the )?(?:list|explanation|breakdown|draft)|save you (?:some )?time and (?:outline|summari[sz]e|draft|write)|post the summary here|answer (?:that|this|your) question)\b/i;
// A draft, rewrite or edit OF THE PROSE for the person: "make it warmer", "change the tone", "add a P.S.".
const PROSE_EDIT = /^(?:make (?:it|this|that|them) (?:\w+er|more \w+|less \w+|shorter|longer|punchier|warmer|friendlier|simpler|clearer)|draft|write(?: up)?|compose|pen|rewrite|reword|rephrase|redraft|tighten|shorten|lengthen|soften|sharpen|polish|proofread|email-proof|mark up|tweak|try (?:another|a different|a new|one more)|redo (?:it|the draft|that)|(?:add|update|change|create|make|put together|fix)\b[^?]{0,40}\b(?:draft|tone|wording|p\.?\s?s\b|subject lines?|ideas|outline|checklist|talking points|version|bullets?|examples?|options|questions|scripts?|templates?|captions?|headlines?|posts?|copy))\b/i;
const ANSWER_REACHES_OUT = /\bby (?:email|text|sms|message)\b|\b(?:access|permission)\b|\bset(?:ting)? (?:it |that |them )?up\b|\bwhen (?:she|he|they|it|\w+) (?:opens?|repl(?:y|ies)|signs?|pays?|books?|clicks?)\b|\bimport\b|\b(?:in|on|to) (?:her|his|their) (?:portal|record|thread|inbox)\b/i;
const RECORD_NOUN = /\b(?:agreements?|documents?|docs?|pdfs?|letters?|invoices?|contracts?|proposals?|quotes?|tasks?|deals?|payment links?|bookings?|meetings?|events?|refunds?|reminders?|tags?|stages?|contacts?|leads?|forms?|pages?|automations?|sequences?|campaigns?)\b/i;
// A verb that only a tool carries out.
const ACT_LEAD = /^(?:(?:just|now|go ahead and|quickly)\s+)*(?:link|unlink|send|re-?send|add|create|schedule|reschedule|book|move|bump|update|change|set|archive|delete|remove|invite|publish|re-?publish|post|assign|reassign|hand|tag|log|mark|enroll|unenroll|launch|email|text (?!you\b)|message|ping|notify|reach out|follow up|attach|connect|sync|cancel|start|kick off|spin up|file|save|record|note|apply|charge|refund|issue|process|generate|build|close|reopen|merge|convert|rename|import|upload|fire|queue|submit|confirm|finalize|activate|deactivate|turn (?:on|off)|pause|resume|retry|try again|redo|re-?raise|raise|tee up|push|pull the trigger|lock|pop|drop|put|get|take care|handle|clean up|do (?:it|that|this|so|both)|make (?:that|the|this|those|these) changes?|draft|prepare|write|rewrite|put together|reply|respond|activate|run (?:it|that|this)|try (?:it |that |this )?(?:again|once more|one more time)|knock (?:it |that |those |them )?out|test (?:it|that|this)|forward|unsubscribe|waive|fix|nudge|extend|rebook|share|loop|approve|restore|list (?:her|him|them|it|this|that) as|run (?:it|that|this|the (?:automation|sequence|workflow|campaign)))\b/i;

export type OfferKind = "act" | "prose" | "unknown";

/** What kind of step the offer PAIGE closed on is (see above). */
export function offerKind(offer: string): OfferKind {
  if (typeof offer !== "string") return "unknown";
  const sentence = strip(offer);
  OFFER_PHRASE.lastIndex = 0;
  const m = OFFER_PHRASE.exec(sentence);
  if (!m) return "unknown";
  const rest = sentence.slice(m.index + m[0].length).trim().replace(/^(?:and|then)\s+(?:i'?ll|i will|we'?ll|we will)\s+/i, "");
  if (THEN_ACTS.test(rest)) return "act";
  // A pure answer ("walk you through…", "show you what's in her pipeline") stays prose wherever it points, unless
  // it reaches outside the reply: by email, access, setting something up, telling you when something happens.
  if (PROSE_LEAD.test(rest) && !ANSWER_REACHES_OUT.test(rest)) return "prose";
  if (DESTINATION.test(rest)) return "act";
  // "draft the invoice", "create the follow-up task": an edit verb on a RECORD is an act.
  if (PROSE_EDIT.test(rest) && !RECORD_NOUN.test(rest)) return "prose";
  if (ACT_LEAD.test(rest) || GENERIC_OFFER.test(rest)) return "act";
  return "unknown";
}

/**
 * On an accepted PROSE offer (not held), a reply that reads as if it did something — "Done, I've moved Dana…",
 * "Updated it and sent it to her." — gets NOTHING_RAN_NOTE added, nothing else. A false match only adds a true
 * line under a true answer, so this list can be broad without costing anyone their answer.
 */
export function saysItWasDone(text: string): boolean {
  return typeof text === "string" && SAYS_DONE.test(strip(text));
}
const SAYS_DONE = /\b(?:all set|taken care of|it'?s handled|that'?s handled)\b|(?:^|[.!?:]\s+)(?:done|sorted|all done)(?=\s*[.!,—–-]|\s*$)|\bi'?ve (?:just |now |already |gone ahead and )?(?:linked|sent|re-?sent|added|created|updated|moved|scheduled|booked|queued|set (?:it |that |this )?up|tagged|enrolled|logged|saved|filed|posted|published|changed|assigned|marked|cancell?ed|fired|submitted|raised|attached|converted|merged|refunded|issued|texted|emailed|messaged|pinged|notified|imported|invited|connected|synced|launched|pushed|forwarded|shared|waived|extended|rebooked|unsubscribed|fixed|restored|approved)\b|\bi (?:just |already |went ahead and )?(?:sent|linked|added|moved|updated|forwarded|shared|waived|booked|scheduled|emailed|texted)\b|(?:^|[.!?:]\s+)(?:added|linked|sent|re-?sent|queued|moved|booked|scheduled|tagged|enrolled|posted|published|logged|filed|assigned|attached|submitted|texted|emailed|messaged|pinged|notified|imported|archived|refunded|charged|invited|forwarded|shared|waived|rebooked|unsubscribed|looped|updated|changed|saved|created)\b(?! by| below| above| version| draft below)|\b(?:sent|forwarded|emailed|texted|shared) (?:it|that|them|this) (?:to|over to|with)\b|\b(?:\w+ing)\b[^.!?\n]{0,25}\bnow\b(?![^.!?\n]*\?)/i;

/** The server's line after a held offer's last reply when no tool ran: true in every case. */
export const NOTHING_RAN_NOTE = "No tool ran in this reply, so nothing above was sent, saved or changed.";
// A reply that says it is done ("Done.", "Linked!", "Sorted.") cannot also be "the step can no longer be done".
const DONE_WORDS = /\b(?:done|all set|sorted|it'?s handled|that'?s handled|taken care of)\b|(?:^|[.!?:]\s+)(?:\w+ed|sent|done|set)!/i;

// On an accepted act, prose that says THE STEP ITSELF can no longer be done — the target is gone or changed,
// or it is already the case — is a terminal answer, unless the same reply claims it just happened (round 6:
// "Linked! There's nothing else you need to do." and "Done. She's already linked." must not end the turn).
const STEP_GONE = /\bno longer (?:exists?|there|available|possible|open|active|in (?:the|your) (?:pipeline|system|crm))\b|\b(?:was|were|has been|have been|got)\s+(?:deleted|removed|cancell?ed|merged into|closed out|closed as (?:lost|won))\b|\bthere(?:'s| is| are)\s+no(?: longer(?: a| an)?)?\s+(?:deal|contact|record|task|invoice|meeting|appointment|event|lead|stage|pipeline|card|such|one) (?:by|with|named|called|for|matching|under|left|anymore)\b|\balready (?:been )?(?:linked|sent|added|created|scheduled|booked|moved|paid|cancell?ed|archived)\b[^.!?\n]{0,30}\b(?:by (?:her|him|them|someone|\w+)|herself|himself|themselves|on (?:her|his|their) end|before (?:i|we) (?:could|got))\b|\b(?:herself|himself|themselves) already\b|\b(?:changed|moved|closed) since (?:i|we) (?:offered|asked|checked|looked)\b|\bsince then\b[^.!?\n]{0,40}\b(?:archived|deleted|closed|cancell?ed|merged)\b/i;
export const NO_LONGER_POSSIBLE = { test: (text: string) => typeof text === "string" && STEP_GONE.test(strip(text)) && !DONE_WORDS.test(strip(text)) };

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
    if (sentences[i].endsWith("?") || /\b(?:say the word|say yes|give me the (?:word|nod|go-?ahead))\b/i.test(sentences[i])) { closing = i; break; }
  }
  if (closing < 0 || closing < sentences.length - 2) return null;
  let sentence = sentences[closing];
  OFFER_PHRASE.lastIndex = 0;
  let first = OFFER_PHRASE.exec(sentence);
  // "Want me to create the deal? Or did you want him dropped straight into Proposal?" — the closing question is
  // the second option of an offer just before it: a choice, so it asks which (prod replay 2026-10-06).
  let trailingAlternative = false;
  // "Ready to archive it? Just say yes and I'll pull the trigger." / "Want me to send it? Say the word." — an
  // invitation to reply right after the offer question is that same offer, not a second one.
  const INVITE = /^(?:(?:just|simply)\s+)?(?:say the word|say yes|say go|give me the (?:word|nod|go-?ahead))\b/i;
  let invites = 0;
  for (let i = 1; i < sentences.length; i++) {
    OFFER_PHRASE.lastIndex = 0;
    if (INVITE.test(sentences[i]) && sentences[i - 1].endsWith("?") && OFFER_PHRASE.test(sentences[i - 1])) invites++;
  }
  OFFER_PHRASE.lastIndex = 0;
  if (INVITE.test(sentence) && closing > 0 && sentences[closing - 1].endsWith("?")) {
    const before = OFFER_PHRASE.exec(sentences[closing - 1]);
    if (before) { sentence = sentences[closing - 1]; first = before; }
  }
  if (!first && LEADS_WITH_ALTERNATIVE.test(sentence) && closing > 0) {
    OFFER_PHRASE.lastIndex = 0;
    const before = OFFER_PHRASE.exec(sentences[closing - 1]);
    if (before) { sentence = sentences[closing - 1]; first = before; trailingAlternative = true; }
  }
  if (!first) return null;
  // THE TAIL: the closing paragraph and the one before it. Two offers anywhere in it is a choice.
  const previous = paragraphs.length > 1 ? sentencesOfParagraph(paragraphs[paragraphs.length - 2]) : [];
  const offersIn = (xs: string[]) => xs.reduce((n, x) => n + (x.match(OFFER_PHRASE) ?? []).length, 0);
  const prevOffers = offersIn(previous);
  const count = offersIn(sentences) - invites + prevOffers;
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
    // a tail that lays out several paths AS A LIST — "Two ways to do this:" with its items in that
    // paragraph or the next (a bare "a few options" in prose is not a choice offered to the person)
    || paragraphs.slice(-3).some((x, i, tail) => MULTI_PATH.test(x)
      && [x, tail[i + 1] ?? ""].some((p) => p.split(/\n+/).filter((line) => LIST_MARKER.test(line)).length >= 2))
    // any offer in the paragraph before this one counts as a second option (it is not compared with this one)
    || prevOffers > 0
    || trailingAlternative
    // the choice can come BEFORE the offer phrase: "Can you check her file, or just give me the go-ahead to try it?"
    || /\bor\s+(?:just\s+|simply\s+)?$/i.test(sentence.slice(0, first.index));
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
export function acceptedOfferNote(offer: string, reply: string, opts: { kind?: OfferKind } = {}): string {
  const head = `THE PERSON IS ANSWERING YOUR OFFER. Your previous message ended: «${quote(offer, 400)}». They replied: «${quote(reply, 200)}» — that accepts it, so what you offered is this turn's task.`;
  const never = "Never say something was done, sent, added or queued unless a tool in this turn did it, and never say an approval card is coming, ready or sent unless a tool in this turn returned one. Their reply approves nothing by itself: the platform decides whether a step needs a card.";
  if (opts.kind === "prose") {
    return `${head} Give it now, in full, in this reply. If part of it needs a record changed or something sent, call that tool. ${never}`;
  }
  if (opts.kind === "unknown") {
    return `${head} If it is an answer, give it in full here. If it changes a record or sends something, call its tool now — when it needs their approval, the tool puts the card in front of them; if you need one fact first, ask it with ask_choices. ${never}`;
  }
  return `${head} Carry it out now by calling its tool, resolving anything it needs with current reads first. When the step needs their approval, calling the tool is what puts the approval card in front of them. If you offered a sequence, start with its first step. If you need one fact from them first, ask it with ask_choices — a question in prose leaves the step undone. If it can no longer be done as offered — the record changed or the tool refuses — say so plainly. ${never}`;
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

// Every rule below is LOCAL — it looks at the words next to the card, never a word anywhere in the clause —
// because each clause-wide exception tried in review traded one leak for another (round 3: "once you
// approve" excused "Sending the approval card now…"; "invoice" anywhere dropped "Sending the card for
// Dana's invoice now"). Assertions (sending, is up, I've put up) are claims whatever follows them; only a
// future or an offer can be excused by a condition.

// An approval card, by name; the approvals list; or a card in a sentence about approving.
const APPROVAL_CARD = /\b(?:approval card|approval request|needs your ok)\b/i;
const APPROVALS_LIST = /\b(?:approvals?|needs your ok) (?:tab|queue|list|page)\b/i;
const CARD_WORD = /\bcards?\b/i;
const APPROVE_WORD = /\bapprov/i;
// A card some other noun owns, named right next to it.
const NON_APPROVAL_CARD =
  /\b(?:credit|debit|payment|contact|business|report|lead|gift|loyalty|summary|outcome|choice|proposal|score)\s+cards?\b|\bscorecards?\b|\bcards?\s+(?:on file|ending|number|details|holder|reader|payments?)\b|\bcards?\b[^.!?]{0,30}\bin the\b[^.!?]{0,20}\b(?:column|board|lane|stage)\b|\bcards?\b[^.!?]{0,30}\bto stripe\b|\b(?:pay|paid|paying|charge[ds]?)\s+(?:by|with|via|on)\s+(?:a\s+)?card\b|\bcards?\s+(?:or|and)\s+(?:bank|ach|transfer)\b/i;
// ASSERTED — the card is there or on its way NOW. A condition does not excuse these.
const CARD_ASSERTED = [
  // ONE card, stated as there now: "the approval request is waiting for you", "You've got an approval card
  // waiting". Not plural or habitual ("approval requests waiting on you show up…") and not promised ("I'll make
  // sure the request is waiting…") — those carry a modal or a when/once and fall out below (round 6).
  /^(?![^.!?\n]*\b(?:will|'ll|would|make sure|ensure|when|once|if|whenever|any|every)\b)[^.!?\n]*\b(?:the|your|an?|this|that)\s+(?:approval (?:card|request)|needs your ok card)(?:'s| is)?\s+(?:now\s+)?(?:waiting|pending|sitting)\b/i,
  // A card re-sent or put back that no tool returned: "I've resent the approval card", "Approval card is back
  // in front of you".
  /\b(?:re-?sent|re-?sending|re-?raised|re-?queued)\s+(?:you\s+)?(?:the|a|an|your|that|this)\s+(?:approval\s+|needs your ok\s+)?(?:card|request)\b/i,
  /\b(?:approval|needs your ok) card(?:'s| is)\s+(?:now\s+)?back\s+(?:up|in front of you|in (?:your )?needs your ok|in (?:your )?approvals?)\b/i,
  /^(?:the |your |an? )?(?:approval |needs your ok )?card(?:'s| is| has been| was)? (?:now )?(?:sent|up|live|ready|created|queued|staged|on its way|waiting)\b/i,
  /\b(?:the|your|this|that|an?)\s+(?:approval\s+|needs your ok\s+)?card(?:'s| is| has been| was)? (?:now )?(?:sent|up|live|ready|created|queued|staged|on its way)\b/i,
  /\b(?:sent|created|staged|queued|raised|submitted|put up|teed up|pulled up|fired off)\s+(?:over\s+)?(?:you\s+)?(?:the|a|an|your|that|this)\s+(?:(?:new|second|another|next|fresh)\s+)?(?:approval\s+|needs your ok\s+)?(?:card|request)\b/i,
  /\bhere(?:'s| is| comes)\s+(?:the|your|an?)\s+(?:approval card|needs your ok card|approval request|card)\b/i,
  /\b(?:sending|putting up|staging|queuing|raising|firing off)\s+(?:over\s+)?(?:you\s+)?(?:the|a|an|your|that|this|another)\s+(?:(?:new|second|another|next|fresh)\s+)?(?:approval\s+|needs your ok\s+)?card\b/i,
  /\bcard\s+(?:is\s+|'s\s+)?(?:coming|on its way)\s+(?:now|right now|right up|your way)\b/i,
  /\b(?:put|putting|placed|added)\s+[^.!?]{0,30}?\bon\s+(?:a|an|the)\s+(?:approval\s+|needs your ok\s+)?card\b/i,
];
// ASSERTED in a sentence about approving: "The card for Dana's portal access is up — approve it when ready."
const ARRIVING_ASSERTED =
  /\b(?:popping up|(?:i'?ve|i have|it'?s|that'?s|has been|have been|just) (?:sent|put|staged|queued|filed|raised|created|teed up)|is (?:now )?(?:up|ready|out|live|on its way|in front of you|coming)|on (?:its|the) way|coming (?:up|your way)|look for|incoming|(?:right |just )?below|down below|in your (?:approvals?|needs your ok) (?:tab|queue|list|page))\b/i;
// FUTURE arrival: "You'll see a card", "The card should appear below". A condition excuses it ("…will appear
// once I propose the change").
const FUTURE_ARRIVAL =
  /\byou(?:'ll| will| should) (?:now )?(?:see|get|find)\b|\b(?:should|will) (?:now )?(?:appear|show up|pop up)\b/i;
// …and the card itself said to be about to appear: "The card should appear below."
const CARD_FUTURE = /\b(?:the|your)\s+(?:approval\s+|needs your ok\s+)?card\s+(?:should|will)\s+(?:now\s+)?(?:appear|show up|pop up)\b/i;
// Telling the person to approve on a card says it is there — unless it explains ("you'll need to hit Approve").
const APPROVE_ON_CARD = /\b(?:click|tap|hit|press)\s+(?:the\s+)?["“]?approve\b|\bapprove (?:it |this |that )?on the card\b/i;
const EXPLAINS = /\b(?:if|when|whenever) you\b|\b(?:need|needs|have|has) to\b/i;
// ANNOUNCED — "I'll send the approval card". A claim only when it is immediate or the sentence ends on the card.
const ANNOUNCE =
  /\b(?:i'?ll|i will|let me|i'?m going to|i am going to)\s+(?:go ahead and\s+)?(?:send|put|stage|raise|create|file|queue|pull up|get)\b[^.!?]{0,60}\b(?:approval card|needs your ok(?: card)?|approval request)\b/i;
const IMMEDIATE = /\b(?:now|right now|right away|immediately)\b/i;
const ENDS_ON_CARD = /\b(?:approval card|needs your ok(?: card)?|approval request)(?:\s+(?:over|across|up))?(?:\s+(?:to you|for you|your way))?\s*[.!]*$/i;
// Offers never claim; a condition excuses only a future or an announcement.
const OFFER = /\b(?:want me to|should i|shall i|would you like|do you want|say the word|let me know|ready to|if you(?:'d)? (?:want|like))\b/i;
const CONDITION = /\b(?:if|when|whenever|once|after|before|until|as soon as) (?:you|i)\b/i;
// A sentence that says the card is NOT there is the truth. The negation must LEAD — come before the card
// ("I didn't put up…", "No new approval card…", "I couldn't…") — or be a contrast tail about it ("…but it
// failed"). A purpose or result tail ("…so nothing runs until you approve") negates nothing about the card.
const NEG_TAIL = /\b(?:but|and)\s+(?:it|that|this|the (?:platform|server|request|card))\b[^.!?]{0,25}\b(?:failed|was blocked|blocked it|refused|rejected|didn'?t|did not|never|wasn'?t)\b/i;
const NEGATED = /\b(?:haven'?t|hasn'?t|didn'?t|don'?t|doesn'?t|isn'?t|aren'?t|wasn'?t|won'?t|couldn'?t|can'?t|cannot|unable to|wasn'?t able|tried to|blocked|failed|never|not yet|no (?:new )?(?:approval )?(?:card|cards|request)|nothing (?:is |was |has been )?(?:waiting|sent|up|queued|staged|pending)|nothing runs|not (?:sent|up|ready|created|queued|staged|waiting))\b/i;
// A card from before is not a new one — unless the clause also says it is being created now.
const EARLIER_CARD =
  /\b(?:above|earlier|still|previous|previously|yesterday|from before|last (?:one|card)|that card|approved|needs your ok list)\b/i;
const CREATED_NOW = /\b(?:i'?ve|i have|just)\b[^.!?]{0,30}\b(?:put|sent|added|queued|staged|filed|created|placed)\b|\bnow\b/i;
const NEW_CARD = /\b(?:new|second|another|next)\b/i;
const HABITUAL = /\b(?:whenever|every time|each time|any ?time|always|for anything|for every|for each|here'?s how (?:it|approvals?|this) works?|how (?:it|approvals?) works?|(?:is|that'?s|it'?s) how you)\b|^(?:when|if)\b/i;

// PAIGE deciding approval: guessing a setting that licenses an act, asking whether approvals are on, or
// offering a write that goes around the card.
const SELF = "(?:i can(?!'?t|not)|i could(?!n'?t)|i'?ll|i will(?! not)|i'?d|i would(?!n'?t)|we can(?!'?t|not)|we could(?!n'?t)|we'?ll|want me to|should i|let me|i'?m able to)";
// "I can't send it without your approval", "I'd never publish without approval" — the truth, not a bypass.
const NEGATED_ACT = /\b(?:can'?t|cannot|couldn'?t|won'?t|wouldn'?t|never|not|don'?t|doesn'?t)\b/i;
// A reassurance names the approval it keeps: "nothing goes out without your approval", "I'll send nothing
// without your OK". Only that exact shape is exempt — "…without your approval — nothing goes out late" is not.
const REASSURANCE = /\b(?:nothing (?:goes(?: out)?|moves|runs|gets (?:sent|done|changed)|is sent|ships|leaves|changes|happens)|(?:send|publish|do|run|move|change) nothing|make sure nothing\b[^.!?\n]{0,30})\s+(?:out\s+)?without (?:your|the|an?) (?:approval|ok|sign[- ]off|card)\b/gi;
const WRITE_VERB = "(?:send|publish|push|post|run|execute|apply|create|link|update|delete|email|text|launch|move|book|charge|enroll|archive|make|pull the trigger|go ahead)";
const AUTHORITY_CLAIM = [
  new RegExp(`\\bif (?:your |the )?(?:approvals?|approval (?:controls?|settings?|gate)|trust (?:compass|settings?|level))\\b[^.!?\\n]{0,40}\\b(?:off|disabled|turned off|switched off|not (?:on|enabled|required|needed|turned on))\\b[^.!?\\n]{0,40}(?:\\b${SELF}\\b|\\bjust say\\b|\\bsay the word\\b|\\b(?:running|run|doing|do) it directly\\b)`, "i"),
  new RegExp(`\\b(?:your |the )?approvals? (?:are|is|look|looks|seem|seems)\\s+(?:to be\\s+)?(?:off|disabled|turned off|switched off)\\b[^.!?\\n]{0,30}(?:\\b(?:so|then)\\s+|,\\s*)${SELF}\\b|\\b(?:since|because|as|now that|if you'?ve|if you have)\\b[^.!?\\n]{0,30}\\b(?:approvals?\\b[^.!?\\n]{0,15}\\b(?:off|disabled)|(?:disabled|turned off) (?:your )?approvals?)\\b[^.!?\\n]{0,30}${SELF}\\b`, "i"),
  // deciding a card is not needed, then acting on it: "This doesn't need a card, so I'll send it now."
  new RegExp(`\\b(?:this|that|it)\\s+(?:doesn'?t|does not|won'?t|will not)\\s+need\\s+(?:a|an|the|your|any)\\s+(?:approval card|card|approval|sign[- ]off)\\b[^.!?\\n]{0,20}(?:\\bso\\s+|,\\s*)${SELF}\\b`, "i"),
  // Asking whether approvals are on. Approval itself must carry the state — "approvals enabled", "approval
  // controls on?", "turn approvals off", "approval required for this?", "Trust Compass set to auto" — as the
  // state of THIS workspace: not a preposition ("approval on Dana's list", "approvals on your mind"), not a
  // third party's ("approval needed from her manager", "her company requires approval"), not a vague setting
  // ("set to the right setting"). Prod replay + review rounds 5 and 6.
  /^(?![^?]*\b(?:her|his|their|its|the client'?s|from (?:her|his|their|the|a|an|your (?:client|manager|boss|team|partner|lawyer))|by (?:her|his|their|the|a|an))\b[^?]*\bapprov)[^?]*\b(?:do(?:es)?|is|are|have|has)\b[^.!?\n]{0,60}?\b(?:approvals?(?:\s+(?:controls?|settings?|gate|requirements?))?|trust (?:compass|level|settings?))\s+(?:(?:is|are)\s+)?(?:still\s+|currently\s+|even\s+|now\s+)?(?:enabled|disabled|on|off|turned (?:on|off)|switched (?:on|off)|required|needed|set up|set to (?:auto\w*|manual|full|draft|observe|off|on|\d+))(?=\s*(?:\?|$|,|\bfor\b|\bin\b|\bon (?:your|the|this|my) (?:account|workspace|plan|business|side)\b|\bright now\b|\bat the moment\b|\bcurrently\b|\banymore\b|\bhere\b|\bthere\b|\bnow\b))[^.!?\n]*\?/i,
  new RegExp(`\\b${SELF}\\b[^.!?\\n]{0,60}(?<!\\b(?:the|a|an|this|that|your|his|her|their|my|our)\\s)\\b${WRITE_VERB}\\w*\\b[^.!?\\n]{0,50}\\b(?:without (?:the|a|an|any|your) (?:approval\\s+)?(?:card|approval|ok|sign[- ]off)|without approval|(?:no|without a) card needed|no approval (?:needed|required))\\b`, "i"),
  new RegExp(`\\b${SELF}\\s+(?:just\\s+)?(?:skip|bypass|go around|get around)\\s+(?:the |your )?(?:approvals?|cards?)\\b`, "i"),
];
// "Directly" is ordinary capability talk ("I can query it directly"); it is PAIGE going around approval only
// in a sentence about the card or approval, offered, not negated, and not "approve first, then directly"
// (prod replay 2026-10-06: 15 of 16 authority hits were the bare adverb in honest replies).
// Asking whether approvals are on and making the act depend on the answer: "Did you turn approvals off? If so
// I'll run it now." Read across the question mark, which splits the sentences.
const CONDITIONAL_ON_APPROVALS = /\b(?:approvals?(?:\s+(?:controls?|settings?|gate))?|trust (?:compass|level|settings?))\b[^.!?\n]{0,30}\b(?:on|off|enabled|disabled|required)\b[^.!?\n]{0,30}\?\s*(?:if (?:so|yes|they(?:'re| are)(?: off| on)?|it(?:'s| is)(?: off| on)?|you (?:have|did))|then)\b[^.!?\n]{0,20}\b(?:i'?ll|i will(?! not)|i can(?!'?t|not)|let me)\s+(?:just\s+|go ahead and\s+)?(?:send|run|publish|post|push|create|link|update|delete|move|launch|execute|do (?:it|that))\b/i;
// Navigation to the card is not a way around it ("I'll take you directly to the approval card"): that phrase is
// removed before the sentence is read, so a bypass elsewhere in the same sentence still counts.
const NAVIGATES = /\b(?:take|link|bring|point|jump|navigate|send)\s+you\s+(?:straight\s+|right\s+)?directly\b[^.!?\n,;]{0,40}|\bdirectly to (?:the|your|that|this) (?:approval card|card|approvals?|needs your ok)\b/gi;
const DIRECTLY_AROUND_APPROVAL = (sentence: string) => {
  const s = sentence.replace(NAVIGATES, " ");
  return new RegExp(`\\b${SELF}\\b[^.!?\\n]{0,50}\\bdirectly\\b`, "i").test(s)
    && /\b(?:approv\w*|card|sign[- ]off)\b/i.test(sentence)
    && !/\b(?:can'?t|cannot|won'?t|not|never|isn'?t|aren'?t)\b/i.test(s)
    && !new RegExp(`\\b${SELF}\\s+(?:just\\s+)?(?:read|look|see|check|view|pull|query|search|find|access|reach)\\b[^.!?\\n]{0,40}\\bdirectly\\b`, "i").test(s)
    && !/\b(?:once|after|when|as soon as) you approve\b|\bapprove (?:it|the card|that|this)?\s*(?:and|,)\s*(?:then\s+)?i'?ll\b/i.test(s);
};

const sentencesOf = (text: string) => strip(text).split(/(?<=[.!?])\s+|\n+/).map((x) => x.trim()).filter(Boolean);
const clausesOfSentence = (sentence: string) => sentence
  .split(/\s+[—–-]\s+|;\s+|,\s+(?=(?:and|but|then|so)\s)/).map((x) => x.trim()).filter(Boolean);

/**
 * A claim in PAIGE's reply that nothing in this turn backs. `cardMinted`: an approval card was created in
 * this turn. `standingCard`: her previous turn left one standing. Authority claims are never backed —
 * approval is the platform's decision, made when the tool is called.
 */
export function unbackedClaim(text: string, opts: { cardMinted: boolean; standingCard: boolean }): UnbackedClaim | null {
  if (typeof text !== "string" || !text.trim()) return null;
  const sentences = sentencesOf(text);
  // The last two rules are PAIGE offering to act without approval; a negated act or a reassurance is the truth.
  // A reassurance phrase is removed before they are read, so a bypass elsewhere in the same sentence still counts.
  const bypassRules = AUTHORITY_CLAIM.slice(-2);
  const readsAsAuthority = (s: string) => AUTHORITY_CLAIM.some((re) => {
    if (!bypassRules.includes(re)) return re.test(s);
    const rest = s.replace(REASSURANCE, " ");
    return re.test(rest) && !NEGATED_ACT.test(rest);
  }) || DIRECTLY_AROUND_APPROVAL(s);
  if (sentences.some(readsAsAuthority) || CONDITIONAL_ON_APPROVALS.test(strip(text))) return "authority";
  if (opts.cardMinted) return null;
  for (const sentence of sentences) {
    const asks = sentence.endsWith("?");
    const sentenceApproves = APPROVE_WORD.test(sentence);
    for (const c of clausesOfSentence(sentence)) {
      const mentioned = APPROVAL_CARD.test(c) || APPROVALS_LIST.test(c) || CARD_WORD.test(c);
      if (!mentioned) continue;
      const at = c.search(/\b(?:approval card|approval request|needs your ok|approvals? (?:tab|queue|list|page)|cards?)\b/i);
      const lead = at < 0 ? c : c.slice(0, at + 24);
      if (NEGATED.test(lead) || NEG_TAIL.test(c)) continue;
      if (!APPROVAL_CARD.test(c) && (NON_APPROVAL_CARD.test(c) || /\bstripe\b/i.test(sentence))) continue;
      // "From before" only when it sits right beside the card ("the card from earlier", "the card I sent
      // yesterday", "that card was approved") — not anywhere in the clause ("…the deal you approved earlier").
      const near = at < 0 ? c : c.slice(Math.max(0, at - 16), at + 30);
      if ((EARLIER_CARD.test(near) || APPROVALS_LIST.test(c)) && !CREATED_NOW.test(c)) continue;
      // Habit, not event: "You'll see an approval card whenever…", "An approval card is sent whenever I propose…"
      if (HABITUAL.test(c)) continue;
      if (opts.standingCard && !NEW_CARD.test(c)) continue;
      if (OFFER.test(c)) continue;
      const approvalContext = APPROVAL_CARD.test(c) || APPROVALS_LIST.test(c) || (CARD_WORD.test(c) && sentenceApproves);
      const conditioned = CONDITION.test(c);
      // Asserted: there now, whatever condition follows.
      if (CARD_ASSERTED.some((re) => re.test(c))) return "card";
      if (approvalContext && ARRIVING_ASSERTED.test(c) && !FUTURE_ARRIVAL.test(c)) return "card";
      if (APPROVE_ON_CARD.test(c) && !EXPLAINS.test(c)) return "card";
      // Future or announced: excused by a condition or a question.
      if (conditioned || asks) continue;
      if (ANNOUNCE.test(c) && (IMMEDIATE.test(c) || ENDS_ON_CARD.test(c))) return "card";
      if (CARD_FUTURE.test(c) || (approvalContext && FUTURE_ARRIVAL.test(c))) return "card";
    }
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
