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
