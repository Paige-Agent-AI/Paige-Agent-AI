import { safeWebUrl } from "../../lib/safe-web-url";
import {
  CONVERSION_LIMITS,
  conversionInputError,
  normalizeConversionDestination,
  type ConversionDestinationResult,
  type ConversionMode,
  type ExternalConversionKind,
} from "../../../supabase/functions/_shared/growth/conversion-destination";

export interface ExternalConversionInput {
  kind: ExternalConversionKind;
  mode: ConversionMode;
  input: string;
}

export type StudioChatConversionPaste =
  | { matched: false }
  | { matched: true; input: string; kind: ExternalConversionKind | null; mode: ConversionMode; error?: string };

/** Recognizes a conversion handoff, not ordinary design/reference prose. The
 * original parser alone admits URLs/HTML; only its canonical URL is returned.
 * This neither writes a destination nor sends pasted markup to a model. */
export function parseStudioChatConversionPaste(text: string): StudioChatConversionPaste {
  if (typeof text !== "string" || !text.trim()) return { matched: false };
  const value = text.trim();
  const urls = value.match(/https?:\/\/[^\s<>"'`]+/gi) ?? [];
  const wholeUrl = /^https:\/\/[^\s<>"'`]+$/i.test(value);
  const markup = /<iframe\b/i.test(value) || /<script\b[\s\S]*jotform\.com\/jsform\//i.test(value);
  const tag = markup ? value.indexOf("<") : -1;
  const prose = tag >= 0 ? value.slice(0, tag) : value.replace(/https?:\/\/[^\s<>"'`]+/gi, "");
  const intent = /^(?:(?:please|can you|could you|would you)\s+)?(?:use|add|replace|set|change|connect|include|switch|embed|link|open|here(?:'s| is)|this is)\b/i.test(prose)
    && /\b(?:forms?|bookings?|calendars?|appointments?|embed|widgets?)\b/i.test(prose)
    && !/\b(?:references?|inspiration|inspired|examples?|articles?|competitors?)\b/i.test(prose);
  const html = markup && (value.startsWith("<") || intent);
  if (!wholeUrl && !html && (!intent || !urls.length)) return { matched: false };
  const mode: ConversionMode = html || intent && /\bembed\b/i.test(prose) ? "embed" : "link";
  const reject = (error: string): StudioChatConversionPaste => ({ matched: true, input: "", kind: null, mode, error });
  if (value.length > CONVERSION_LIMITS.html) return reject(`Paste at most ${CONVERSION_LIMITS.html} characters, or use the public URL directly.`);
  if (!html && urls.length !== 1) return reject("Paste one form or booking destination at a time.");
  const input = html ? value.slice(tag) : wholeUrl ? text : urls[0].replace(/[),.;!]+$/, "");
  const kinds: ExternalConversionKind[] = ["external_form", "external_booking"];
  const embeds = kinds.map(kind => parseExternalConversionInput({ kind, mode: "embed", input }));
  const admitted = embeds.flatMap(result => result.ok && (result.destination.kind === "external_form" || result.destination.kind === "external_booking") ? [result.destination] : []);
  if (admitted.length > 1) return reject("Choose one form or booking destination before saving.");
  if (mode === "embed") {
    if (admitted.length !== 1) {
      const failure = embeds.find(result => result.ok === false);
      return reject(failure?.ok === false ? failure.message : "Paste one supported public widget URL or iframe.");
    }
    return { matched: true, input: admitted[0].url, kind: admitted[0].kind, mode };
  }
  const kind = admitted[0]?.kind ?? null;
  const checked = parseExternalConversionInput({ kind: kind ?? "external_form", mode: "link", input });
  if (checked.ok === false) return reject(checked.message);
  if (checked.destination.kind !== "external_form" && checked.destination.kind !== "external_booking") return reject("Choose an external form or booking destination.");
  return { matched: true, input: checked.destination.url, kind, mode };
}

/**
 * Browser paste admission only. A detached template's contents are inert: no
 * scripts execute, no browsing contexts load and nothing is attached to the
 * live document. Markup, dimensions, styles and handler attributes are dropped.
 * Only the normalized destination can be persisted or passed to a renderer.
 * Never reuse pasted HTML as preview HTML or use this as a general sanitizer.
 */
export function parseExternalConversionInput({ kind, mode, input }: ExternalConversionInput): ConversionDestinationResult {
  if (typeof input !== "string" || !input.trim()) {
    return conversionInputError("invalid_url", "Paste a public HTTPS URL or one supported iframe embed code.");
  }
  if (input.length > CONVERSION_LIMITS.html) {
    return conversionInputError("input_too_long", `Paste at most ${CONVERSION_LIMITS.html} characters, or use the public URL directly.`);
  }
  const value = input.trim();
  if (!value.startsWith("<")) {
    // Reuse the app's public-link parser, then apply the stricter conversion
    // contract (HTTPS, no credentials/private hosts, bounded safe options).
    if (value.length <= CONVERSION_LIMITS.url && !safeWebUrl(value)) {
      return conversionInputError("invalid_url", "Paste a valid full public HTTPS URL or a supported iframe embed code.");
    }
    return normalizeConversionDestination({ kind, mode, url: input });
  }
  if (typeof document === "undefined") {
    return conversionInputError("browser_required", "Paste embed code in Studio in a browser, or use a public URL directly.");
  }
  const template = document.createElement("template");
  try {
    template.innerHTML = value;
  } catch {
    return conversionInputError("invalid_html", "This browser could not safely inspect the embed code. Paste the public HTTPS URL directly.");
  }
  const content = template.content;
  // Refuse nested inert payloads rather than guessing which hidden destination
  // a user intended; querySelectorAll does not traverse nested template contents.
  if (content.querySelector("template") || content.querySelector("iframe[srcdoc]")) {
    return conversionInputError("invalid_html", "Remove srcdoc or nested templates and paste one supported iframe with a public src URL.");
  }
  const frames = Array.from(content.querySelectorAll("iframe"));
  const jotformScripts = Array.from(content.querySelectorAll("script[src]")).flatMap((script) => {
    const src = script.getAttribute("src") ?? "";
    // Exact canonical external script only; never inspect or execute JS text.
    const match = /^https:\/\/form\.jotform\.com\/jsform\/([0-9]{5,32})$/.exec(src);
    return match ? [`https://form.jotform.com/${match[1]}`] : [];
  });
  if (frames.length + jotformScripts.length > 1) {
    return conversionInputError("ambiguous_html", "Paste exactly one destination: one iframe or one canonical Jotform jsform script.");
  }
  const url = frames[0]?.getAttribute("src") ?? jotformScripts[0];
  if (!url) {
    return conversionInputError("invalid_html", "No supported iframe src was found. Paste the public HTTPS URL, one iframe, or a canonical Jotform jsform script.");
  }
  // HTML can only select a documented embed shape, even when the desired output
  // is link mode. Unsupported arbitrary HTML is never promoted to a public link.
  const checked = normalizeConversionDestination({ kind, mode: "embed", url });
  if (checked.ok === false || checked.destination.kind === "native_form" || checked.destination.kind === "native_booking") return checked;
  return normalizeConversionDestination({ ...checked.destination, mode });
}
