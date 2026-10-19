/** Presentation only. Cura is the Client Success agent PAIGE assigns to a business's customers;
 * PAIGE is the owner's COO and is never the name a customer reads (owner ruling, 2026-10-19).
 * A business may rename its agent, but a name that is PAIGE, or carries it in any spelling — wrapped
 * ("Paige AI", "Ask Paige"), joined ("AskPaige", "PaigeAgent", "Paiges"), spaced ("P a i g e"), hidden
 * with invisible characters ("Pa​ige") or written with look-alike letters — falls back to Cura.
 * "Paiget" is a different word and is kept. Custom business names grant no authority.
 */
// Zero-width, joiner, direction, variation-selector and soft-hyphen characters render as nothing.
const INVISIBLE = /[­͏؜ᅟᅠ឴឵᠋-᠏​-‏‪-‮⁠-⁯ㅤ︀-️﻿]/g;
// Look-alike letters that NFKC does not fold (Cyrillic, Greek, Latin dotless i, script g).
const CONFUSABLE: Readonly<Record<string, string>> = {
  "а": "a", "А": "a", "α": "a", "Α": "a", "е": "e", "Е": "e", "ε": "e", "Ε": "e",
  "і": "i", "І": "i", "ı": "i", "ι": "i", "Ι": "i", "р": "p", "Р": "p", "ρ": "p", "Ρ": "p",
  "ɡ": "g", "ǥ": "g", "ց": "g",
};

/** The name's letters only, folded the way a reader sees them, for the PAIGE check. */
function readAs(value: string): string {
  return Array.from(value.normalize("NFKC").replace(INVISIBLE, "").toLowerCase(), (c) => CONFUSABLE[c] ?? c)
    .join("").replace(/[^\p{L}]/gu, "");
}

export function customerAgentName(value: unknown): string {
  const name = typeof value === "string" ? value.replace(INVISIBLE, "").trim().slice(0, 80) : "";
  return !name || /paige(?!t)/.test(readAs(name)) ? "Cura" : name;
}

// A self-introduction in any case: "You are Paige", "you're paige", "Your name is Paige", "This is Paige AI".
const SELF_NAMED = /\b(you are|you're|i'm|i am|your name is|this is|call me|named)\s+paige\b(?:[ \t]+(?:ai|assistant|agent)\b)?/gi;
// "Paige here!" in any case.
const NAME_HERE = /\bpaige\b(?:[ \t]+(?:ai|assistant)\b)?(?=[ \t]+here\b)/gi;
// Every other capitalised mention ("Paige's Predictive Engine", "Ask PAIGE"). Lowercase prose and identifiers
// (paige_tasks_list, paige-ai-chat, PAIGE_VOICE_BLOCK, Paige-run) and the platform's legal name (PaigeAgent)
// are left alone.
const MENTION = /(?<![-_.\w])(?:Paige|PAIGE)\b(?:[ \t]+(?:AI|Assistant)\b)?(?![-_.]?\w)/g;

/**
 * A client seat's prompt, re-voiced as the customer's agent. The owner's prompt blocks introduce the
 * model as PAIGE ("You are Paige.", "you're Paige, an AI assistant", "I'm Paige —") and name PAIGE
 * throughout ("Paige's Predictive Engine"); a client of the business is never told that. Every
 * self-introduction and every capitalised mention becomes the agent's name, so the model has no PAIGE
 * to repeat. The instructions themselves are not rewritten, and the platform's legal name (PaigeAgent,
 * in referral disclosures) stays: it names the company, not the assistant. Best effort, not a fence:
 * a reply is not filtered. The native Customer Portal branch builds its own persona
 * (client-portal-persona.ts) and never needs this.
 */
export function customerSeatIdentity(text: string, name: string = customerAgentName(undefined)): string {
  return text
    .replace(SELF_NAMED, (_match, lead: string) => `${lead} ${name}`)
    .replace(NAME_HERE, name)
    .replace(MENTION, name);
}
