/**
 * client-seat-reply — a client reads nothing from PAIGE that has not first been read for internal text
 * (R3). The ONE home (§18) for the decision and for the sentence a client reads instead.
 *
 * WHO. A client seat: the person a business serves, signed in to that business's portal
 * (`callerTier === "client"` in paige-ai-chat). An owner or a teammate is not a client seat; their
 * chat is R4's.
 *
 * WHAT IS READ. Everything on the turn a client can read that the model wrote: the answer, each
 * thought line, and the summary of any card asking them to confirm a change (built from the model's
 * own arguments). Action steps are not read. They go to the wire as they happen, and on a client seat
 * the only one that renders is the fixed label of the one write a client may make: every other tool
 * is refused before it runs and renders no step (paige-ai-chat `describeStep`). The vocabulary is derived from what the server sent the model on that turn
 * (`_shared/internal-vocabulary.ts`): the tool definitions, every tool result, and the text the caller
 * VOUCHES for as server-written end to end. Never the client's own words, and never the tenant's prose:
 * a tenant can write `"gold_tier": true` or a `VIP PLAN … END VIP PLAN` passage into their persona, and
 * their clients' ordinary answers must not be withheld for repeating it.
 *
 * WHAT HAPPENS ON A FINDING. The whole turn is withheld and the client reads `withheldReplyForClient`
 * instead. Not a trimmed answer: cutting the internal words out of a sentence leaves one that says
 * something the model did not, and a client cannot tell. Not a regenerated one: a second answer written
 * to avoid the first one's words is a plausible answer made up to cover a gap. The sentence says an
 * answer existed, was not sent, and why, and it offers the two things the client can do.
 *
 * THE HONEST LIMIT, inherited: a clean result means none of the KNOWN vocabulary, never "nothing
 * internal". A paraphrase passes.
 */
import {
  deriveInternalVocabulary,
  findInternalLeaks,
  type InternalLeak,
  type InternalLeakKind,
} from "./internal-vocabulary.ts";

export interface ClientSeatTurn {
  /** What the client would read from this turn, as written: the answer, then each thought line. */
  readable: readonly string[];
  /** The tool definitions sent to the model. */
  tools: readonly unknown[];
  /** Text the caller vouches for as server-written end to end, vouched where it was built. Never a block
   *  that pastes in tenant, client, uploaded or fetched prose, and never the client's own words. */
  vouchedTexts: readonly string[];
  /** Every tool result the model was sent on this turn. */
  toolResults: readonly string[];
}

/**
 * What a client would read from these SSE frames, exactly as they will be released: the answer's text,
 * each thought line, and each confirm card's summary. Read from the frames themselves rather than from a copy assembled beside them,
 * so nothing reaches the wire that the check did not see. Only the whole payload `[DONE]` is the
 * sentinel; a reply that contains that text is still text. A line the portal cannot parse is skipped
 * here as it is there.
 */
export function readableFromFrames(frames: string): string[] {
  const answer: string[] = [];
  const thoughts: string[] = [];
  for (const line of frames.split("\n")) {
    if (!line.startsWith("data: ")) continue;
    const payload = line.slice(6).trim();
    if (payload === "[DONE]") continue;
    let parsed: unknown;
    try { parsed = JSON.parse(payload); } catch { continue; }
    const frame = parsed as {
      choices?: Array<{ delta?: { content?: unknown } }>;
      paige_step?: { kind?: unknown; label?: unknown };
      paige_confirm?: { summary?: unknown };
    };
    const content = frame?.choices?.[0]?.delta?.content;
    if (typeof content === "string") answer.push(content);
    const step = frame?.paige_step;
    if (step?.kind === "thought" && typeof step.label === "string") thoughts.push(step.label);
    const summary = frame?.paige_confirm?.summary;
    if (typeof summary === "string") thoughts.push(summary);
  }
  return [answer.join(""), ...thoughts];
}

/** Held byte chunks as one string; a character split across two chunks is joined, not mangled. */
export function decodeChunks(chunks: readonly Uint8Array[]): string {
  const decoder = new TextDecoder();
  return chunks.map((chunk) => decoder.decode(chunk, { stream: true })).join("") + decoder.decode();
}

/** Every internal term a client would read on this turn, across everything readable. */
export function internalTextForClient(turn: ClientSeatTurn): InternalLeak[] {
  const vocabulary = deriveInternalVocabulary({
    tools: turn.tools,
    vouchedTexts: turn.vouchedTexts,
    toolResults: turn.toolResults,
  });
  // The same text read twice (the released answer and the saved one, when they agree) counts once.
  return [...new Set(turn.readable)].flatMap((text) => findInternalLeaks(text, vocabulary));
}

/** How many of each kind, for the log. Never the text itself: a finding is internal by definition. */
export function leakKindCounts(leaks: readonly InternalLeak[]): Partial<Record<InternalLeakKind, number>> {
  const counts: Partial<Record<InternalLeakKind, number>> = {};
  for (const leak of leaks) counts[leak.kind] = (counts[leak.kind] ?? 0) + 1;
  return counts;
}

/**
 * Whether one tool result says something was actually saved, by the tool's own report: it succeeded,
 * it is not waiting on an approval, and, where it reports item by item (the client-data write-back
 * answers `success: true` for the request and lists each field's own outcome), at least one item was
 * saved. A result that cannot be read says nothing was.
 */
export function resultSavedSomething(content: string): boolean {
  let parsed: unknown;
  try { parsed = JSON.parse(content); } catch { return false; }
  if (!parsed || typeof parsed !== "object") return false;
  const result = parsed as { success?: unknown; needs_confirm?: unknown; results?: unknown };
  if (result.needs_confirm === true || result.success !== true) return false;
  return Array.isArray(result.results)
    ? result.results.some((item) => !!item && typeof item === "object" && (item as { success?: unknown }).success === true)
    : true;
}

/**
 * What a client reads when their answer is withheld (owner-approved wording, 2026-09-27). It names the
 * business when the server knows it, so the client knows who to ask, and falls back to words that fit
 * any business when it does not. When something on the turn was saved, it says so, in the words the
 * platform already uses when a changed workspace stops a turn, and tells the client not to send it
 * again: "ask me another way" must not read as an invitation to repeat a save.
 *
 * Each variant is a whole sentence rather than one with a spliced-in fragment, so each reads (and
 * translates) as written.
 */
export function withheldReplyForClient(businessName?: string | null, options: { savedSomething?: boolean } = {}): string {
  const name = typeof businessName === "string" ? businessName.replace(/\s+/g, " ").trim().slice(0, 80) : "";
  if (options.savedSomething) {
    return name
      ? `I wrote an answer, but it included internal system details that aren't meant to be shared here, so I didn't send it. Anything I'd already finished is saved — you don't need to send it again. I won't guess at a different answer. You can ask me another way, or ask ${name} directly.`
      : "I wrote an answer, but it included internal system details that aren't meant to be shared here, so I didn't send it. Anything I'd already finished is saved — you don't need to send it again. I won't guess at a different answer. You can ask me another way, or ask the team you're working with directly.";
  }
  return name
    ? `I wrote an answer, but it included internal system details that aren't meant to be shared here, so I didn't send it. I won't guess at a different answer. You can ask me another way, or ask ${name} directly.`
    : "I wrote an answer, but it included internal system details that aren't meant to be shared here, so I didn't send it. I won't guess at a different answer. You can ask me another way, or ask the team you're working with directly.";
}

/** The frame a portal reads to know the answer on this turn was withheld, so it treats the sentence as
 *  what it is (not an account of a document, for instance). Carries no text of its own. */
export const WITHHELD_FRAME = `data: ${JSON.stringify({ paige_withheld: true })}\n\n`;
