/** Presentation only. Cura is the Client Success agent PAIGE assigns to a business's customers;
 * PAIGE is the owner's COO and is never the name a customer reads (owner ruling, 2026-10-19).
 * A business may rename its agent, but a name that is PAIGE, or carries it in any spelling — wrapped
 * ("Paige AI", "Ask Paige", "Paige Team"), joined ("AskPaige", "PaigeTalk", "Paigeton", "Paiges"),
 * spaced ("P a i g e", "PAIGE-T"), hidden with invisible characters ("Pa\u200Bige", "Pa\uFFA0ige"), accented
 * ("Paigé"), marked ("Paige™"), raised or lowered ("Paigeᵗ", "ᴾᵃⁱᵍᵉ"), or written with the common look-alike letters
 * listed in CONFUSABLE below — falls back to Cura. The look-alike list covers common cases, not whole scripts: a
 * look-alike letter it does not list is read as itself. "Paiget" is a different word and is kept, but only when it
 * is typed literally as a word of its own: a superscript or look-alike t is not a T. Digit and symbol swaps ("Pa1ge",
 * "P@ige") are kept by design: they read as a different name, and chasing every leetspeak spelling would refuse
 * ordinary names. The rule errs the other way across word breaks ("Pai Genie" reads as Cura) because the letters
 * are read run together. Custom names grant no authority.
 */
// Zero-width, joiner, direction, variation-selector, Hangul filler and soft-hyphen characters render as nothing.
const INVISIBLE = /[\u00AD\u061C\u115F\u1160\u200B-\u200F\u202A-\u202E\u2060-\u206F\u3164\uFEFF\uFFA0]|\u034F|\u17B4|\u17B5|\u180B|\u180C|\u180D|\u180E|\u180F|[\uFE00-\uFE0F]/g;
// Negative circled (🅐–🅩) and negative squared (🅰–🆉) capital letters, which NFKC does not fold, read as a–z.
const NEGATIVE_LETTERS: Record<string, string> = Object.fromEntries(Array.from({ length: 26 }, (_, i) => [
  [String.fromCodePoint(0x1F150 + i), String.fromCharCode(97 + i)],
  [String.fromCodePoint(0x1F170 + i), String.fromCharCode(97 + i)],
]).flat());
// Common look-alike letters that NFKC does not fold. The map is read after lowercasing, so every key is lowercase.
// It includes: Cyrillic а е є і ӏ р ԍ ҽ; Greek α ε ι ρ; Latin dotless, turned, stroked and iota i (ı ᴉ ɨ ɩ), the
// dental click ǀ, open e ɛ, Latin and APL alpha (ɑ ⍺), script, stroked and hooked g (ɡ ǥ ꞡ ɠ), stroked and hooked p
// (ᵽ ƥ ꝑ); Armenian ց; small capitals ᴀ ᴇ ɪ ᴘ ɢ; Cherokee small letters ꭺ ꭵ ꭼ ꮐ ꮲ (the lowercase of Ꭺ Ꭵ Ꭼ Ꮐ Ꮲ);
// Lisu ꓑ ꓮ ꓲ ꓖ ꓰ; Coptic ⲁ ⲉ ⲓ ⲣ; and the negative circled and squared letters.
const CONFUSABLE: Readonly<Record<string, string>> = {
  "а": "a", "α": "a", "ɑ": "a", "⍺": "a", "ᴀ": "a", "ꭺ": "a", "ꓮ": "a", "ⲁ": "a",
  "е": "e", "ε": "e", "є": "e", "ᴇ": "e", "ҽ": "e", "ɛ": "e", "ꭼ": "e", "ꓰ": "e", "ⲉ": "e",
  "і": "i", "ı": "i", "ι": "i", "ӏ": "i", "ɪ": "i", "ᴉ": "i", "ꭵ": "i", "ǀ": "i", "ɨ": "i", "ɩ": "i", "ꓲ": "i", "ⲓ": "i",
  "р": "p", "ρ": "p", "ᴘ": "p", "ꮲ": "p", "ᵽ": "p", "ƥ": "p", "ꝑ": "p", "ꓑ": "p", "ⲣ": "p",
  "ɡ": "g", "ǥ": "g", "ց": "g", "ɢ": "g", "ԍ": "g", "ꞡ": "g", "ɠ": "g", "ꮐ": "g", "ꓖ": "g",
  ...NEGATIVE_LETTERS,
};
// "Paiget" typed literally as a word of its own, read on the name before any folding.
const PAIGET = /(?<![\p{L}\p{M}\p{N}])paiget(?![\p{L}\p{M}\p{N}])/giu;

/**
 * The name's words as a reader sees them: lowercase letters only, accents and look-alikes folded,
 * every other character a word break. A symbol that compatibility-folds into several letters
 * (™ → TM, ℠ → SM, ℡ → TEL) is a mark beside the name, not letters in it, so it is a break too.
 * Invisible characters are removed before folding and again after it, so a letter that folds into one
 * (U+FFA0 → U+1160) cannot hold the name apart.
 */
function readAs(value: string): string[] {
  let compat = "";
  for (const ch of value.replace(INVISIBLE, "")) {
    const folded = ch.normalize("NFKC");
    compat += /\p{S}/u.test(ch) && (folded.match(/\p{L}/gu)?.length ?? 0) > 1 ? " " : folded;
  }
  const bare = compat.replace(INVISIBLE, "").toLowerCase().normalize("NFKD").replace(/\p{M}/gu, "");
  return Array.from(bare, (c) => CONFUSABLE[c] ?? c).join("").split(/[^\p{L}]+/u).filter(Boolean);
}

/** True when the name says PAIGE in any spelling. Its letters are read run together, so spacing,
 * punctuation and joining never hide it. A literal, typed "Paiget" is set aside on the raw name first,
 * so a folded superscript or look-alike t can never borrow the exemption. */
function namesPaige(value: string): boolean {
  return readAs(value.replace(PAIGET, " ")).join("").includes("paige");
}

/** The name as a client would read it before the PAIGE rule: invisible characters removed, trimmed, at most
 * 80 characters. A difference between this and customerAgentName is the PAIGE rule and nothing else. */
export function agentNameAsTyped(value: unknown): string {
  return typeof value === "string" ? value.replace(INVISIBLE, "").trim().slice(0, 80) : "";
}

export function customerAgentName(value: unknown): string {
  const name = agentNameAsTyped(value);
  return !name || namesPaige(name) ? "Cura" : name;
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
    .replace(NAME_HERE, () => name)
    .replace(MENTION, () => name);
}
