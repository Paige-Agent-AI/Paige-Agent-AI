// Ask PAIGE handoff: a surface's "Ask PAIGE" button puts a drafted question in PAIGE's composer.
//
// WHY THIS EXISTS. Surfaces across Solo dispatched `paige:open` with `detail.prompt`, but the shell's
// listener only opened the panel; nothing read the prompt, so every Ask PAIGE opened an empty
// composer. The client portal dispatched `paige:prefill`, which had no listener at all.
//
// WHAT IT DOES, AND DOES NOT. It PREFILLS the composer; it never sends. The owner reads the question
// and presses send, so authority stays with the person (§16 confirm lane) and anything a surface
// built into the text is visible before it reaches the model. A draft the person already typed is
// kept: ordinary questions append; an explicit specialist invitation can retain
// its leading addressee without dropping any typed work.
//
// THE PANEL MAY NOT BE MOUNTED YET. Opening PAIGE can mount the chat after the event fires, so the
// question waits here until a composer takes it; a mounted composer is also told immediately.

import { detectVpAddress } from "../../supabase/functions/_shared/paige-context/vp-address";

const EVENT = "paige:prefill";
const MAX = 4000;

let pending: string | null = null;

/** Strip control characters and cap the length; a handed-off question is plain text. */
export function cleanPaigePrompt(prompt: unknown): string | null {
  if (typeof prompt !== "string") return null;
  // eslint-disable-next-line no-control-regex -- removing control characters is the point
  const text = prompt.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "").trim();
  return text ? text.slice(0, MAX) : null;
}

/** Hand a question to PAIGE's composer: held until one takes it, and announced to any mounted one. */
export function handOffPaigePrompt(prompt: unknown): void {
  const text = cleanPaigePrompt(prompt);
  if (!text) return;
  pending = text;
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(EVENT, { detail: { prompt: text } }));
}

/** Take the waiting question, if any. It is handed out once. */
export function takePendingPaigePrompt(): string | null {
  const text = pending;
  pending = null;
  return text;
}

/** Default/recovery merges remain append-only. An explicit surface invitation may
 * keep its canonical specialist address leading, without discarding typed work.
 * Naming a specialist changes presentation, never tools or execution authority. */
export function mergeIntoDraft(current: string, prompt: string, options?: { preserveAddressee?: boolean }): string {
  if (!current.trim()) return prompt;
  const addressed = options?.preserveAddressee ? detectVpAddress(prompt) : null;
  if (!addressed) return `${current.replace(/\s+$/, "")}\n\n${prompt}`;
  const currentAddress = detectVpAddress(current);
  const same = currentAddress?.vp.slug === addressed.vp.slug;
  const original = current.replace(/\s+$/, "");
  const existingParagraphs = `\n\n${currentAddress?.rest.replace(/\r\n/g, "\n") ?? ""}\n\n`;
  const preparedParagraphs = `\n\n${addressed.rest.replace(/\r\n/g, "\n")}\n\n`;
  if (same && addressed.rest && existingParagraphs.includes(preparedParagraphs)) return original;
  return `${same ? original : `${addressed.vp.name}, ${original}`}${addressed.rest ? `\n\n${addressed.rest}` : ""}`;
}

/**
 * Subscribe a composer: applies a question waiting from before it mounted, then every later one.
 * Returns the unsubscribe function. `apply` receives cleaned text only.
 */
export function subscribePaigePromptHandoff(apply: (prompt: string) => void): () => void {
  const waiting = takePendingPaigePrompt();
  if (waiting) apply(waiting);
  if (typeof window === "undefined") return () => {};
  const listener = (event: Event) => {
    // A handoff from this module also set `pending`; take it so it is not applied twice later.
    const text = takePendingPaigePrompt() ?? cleanPaigePrompt((event as CustomEvent)?.detail?.prompt);
    if (text) apply(text);
  };
  window.addEventListener(EVENT, listener);
  return () => window.removeEventListener(EVENT, listener);
}
