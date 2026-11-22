/**
 * Pure stored-destination admission shared by Studio and the page contract.
 * Native IDs are checked for format only. The existing native resolver must
 * still check tenant ownership, publication and availability.
 *
 * This never resolves DNS or requests a destination. It is not an outbound
 * transport/SSRF guarantee: server-side requests still belong to safeFetch in
 * ../ssrfGuard.ts. IP literals are excluded entirely, not classified here.
 */
export const CONVERSION_LIMITS = { url: 2048, html: 20000, bookingSlug: 128 } as const;

export type ConversionMode = "link" | "embed";
export type ExternalConversionKind = "external_form" | "external_booking";
export type ConversionProvider = "jotform" | "gohighlevel" | "calendly" | "calcom" | "other";
export type ConversionDestination =
  | { kind: "native_form"; formId: string }
  | { kind: "native_booking"; slug: string }
  | { kind: ExternalConversionKind; mode: ConversionMode; url: string; provider: ConversionProvider };

export type ConversionErrorCode =
  | "invalid_kind" | "invalid_mode" | "invalid_form_id" | "invalid_booking_slug"
  | "invalid_url" | "unsafe_url" | "unsafe_url_options" | "input_too_long"
  | "unsupported_embed" | "provider_kind_mismatch"
  | "invalid_html" | "ambiguous_html" | "browser_required";
export type ConversionDestinationResult =
  | { ok: true; destination: ConversionDestination }
  | { ok: false; code: ConversionErrorCode; message: string; canUseLink?: boolean };

export function conversionInputError(
  code: ConversionErrorCode,
  message: string,
  canUseLink?: boolean,
): ConversionDestinationResult {
  return { ok: false, code, message, ...(canUseLink === undefined ? {} : { canUseLink }) };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// eslint-disable-next-line no-control-regex -- URL input must not contain control or direction-changing characters
const CONTROL = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/;
const PRIVATE_SUFFIXES = [
  "localhost", "local", "localdomain", "internal", "intranet", "lan", "home", "home.arpa",
  "corp", "test", "invalid", "example", "onion", "nip.io", "sslip.io", "localtest.me", "lvh.me",
];
const RESERVED_BOOKING_PATHS = new Set([
  "app", "api", "auth", "login", "logout", "signup", "settings", "admin", "account",
  "help", "docs", "blog", "pricing", "features", "integrations", "embed", "assets",
  "event_types", "scheduled_events", "routing", "workflows", "availability",
]);

/** Official source shapes checked 2026-11-13, without loading a customer widget:
 * Jotform public numeric ID + jsform: https://www.jotform.com/answers/1266599-how-can-i-get-the-embedding-code
 * HighLevel host: https://ideas.gohighlevel.com/changelog/book-a-call-button-for-ad-manager
 * HighLevel booking path: https://marketplace.gohighlevel.com/docs/ghl/calendars/get-calendar/
 * HighLevel form path: https://help.gohighlevel.com/support/solutions/articles/155000007783-how-to-create-rcs-snippets-and-send-rcs-messages
 * Calendly direct iframe: https://calendly.com/help/advanced-calendly-embed-for-developers
 * Cal.com direct iframe: https://cal.com/blog/use-cal-with-carrd
 *
 * This is deliberately a subset: branded domains, legacy booking-ID paths,
 * surveys, routing forms, script configuration and private/admin routes are
 * not inferred to be safe embeds. Public HTTPS link mode remains available.
 */
function widgetShape(url: URL): { provider: ConversionProvider; kind: ExternalConversionKind } | null {
  const host = url.hostname;
  const path = url.pathname;
  if (host === "form.jotform.com" && /^\/[0-9]{5,32}\/?$/.test(path)) {
    return { provider: "jotform", kind: "external_form" };
  }
  if (host === "api.leadconnectorhq.com") {
    if (/^\/widget\/form\/[a-zA-Z0-9_-]{1,128}\/?$/.test(path)) {
      return { provider: "gohighlevel", kind: "external_form" };
    }
    if (/^\/widget\/bookings\/[a-zA-Z0-9_-]{1,128}\/?$/.test(path)) {
      return { provider: "gohighlevel", kind: "external_booking" };
    }
  }
  if (host === "calendly.com" || host === "cal.com") {
    // Public personal/event links only; no team, routing or other guessed paths.
    const parts = path.replace(/\/$/, "").slice(1).split("/");
    if (parts.length >= 1 && parts.length <= 2 &&
      parts.every((part) => /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(part)) &&
      !RESERVED_BOOKING_PATHS.has(parts[0].toLowerCase())) {
      return { provider: host === "calendly.com" ? "calendly" : "calcom", kind: "external_booking" };
    }
  }
  return null;
}

function providerForHost(host: string): ConversionProvider {
  if (host === "form.jotform.com") return "jotform";
  if (host === "api.leadconnectorhq.com") return "gohighlevel";
  if (host === "calendly.com") return "calendly";
  if (host === "cal.com") return "calcom";
  return "other";
}

function safeOptions(url: URL): boolean {
  // WHATWG hash is empty for a trailing '#'; the authored URL still contains
  // a fragment delimiter. Keep the canonical browser/native no-fragment rule.
  if (url.href.includes("#")) return false;
  // Only these finite presentation switches are retained. No arbitrary tracking,
  // redirect, prefill, auth or custom question fields can carry visitor secrets.
  // https://developer.calendly.com/api-docs/overview/embedding/recipes
  const seen = new Set<string>();
  for (const [key, value] of url.searchParams) {
    if (seen.has(key)) return false;
    seen.add(key);
    if (url.hostname !== "calendly.com" ||
      (key !== "hide_landing_page_details" && key !== "hide_event_type_details") ||
      (value !== "0" && value !== "1")) return false;
  }
  return true;
}

function publicHttpsInput(raw: unknown): URL | ConversionDestinationResult {
  if (typeof raw !== "string" || !raw.trim()) {
    return conversionInputError("invalid_url", "Paste the full public HTTPS form or booking URL.");
  }
  if (raw.length > CONVERSION_LIMITS.url) {
    return conversionInputError("input_too_long", `Use a URL with at most ${CONVERSION_LIMITS.url} characters.`);
  }
  const value = raw.trim();
  if (CONTROL.test(raw) || /[\s\\<>]/.test(value) || !/^https:\/\//i.test(value)) {
    return conversionInputError("unsafe_url", "Use a full HTTPS URL without spaces, control characters or backslashes.");
  }
  try {
    // Detect escaped controls/backslashes too, including a second escaped layer.
    let decoded = value;
    for (let i = 0; i < 2; i++) {
      decoded = decodeURIComponent(decoded);
      if (CONTROL.test(decoded) || /[\\<>]/.test(decoded)) {
        return conversionInputError("unsafe_url", "Remove encoded control characters, markup or backslashes from the URL.");
      }
    }
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.port) {
      return conversionInputError("unsafe_url", "Use HTTPS without a username, password or custom port.");
    }
    const host = url.hostname.toLowerCase().replace(/\.$/, "");
    // WHATWG URL canonicalizes shorthand/hex/decimal IPv4 before this test.
    // Reject every address literal, including public ones, rather than forking
    // the canonical outbound numeric address classifier.
    if (host.includes(":") || /^[0-9.]+$/.test(host) || !host.includes(".") ||
      !host.split(".").every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label)) ||
      PRIVATE_SUFFIXES.some((suffix) => host === suffix || host.endsWith(`.${suffix}`))) {
      return conversionInputError("unsafe_url", "Use a public website hostname; local names and IP addresses are not supported.");
    }
    url.hostname = host;
    if (!safeOptions(url)) {
      return conversionInputError("unsafe_url_options", "Remove query or fragment fields. Only documented Calendly hide-details switches set to 0 or 1 are supported.");
    }
    return url;
  } catch {
    return conversionInputError("invalid_url", "Paste a valid full HTTPS URL with correctly encoded characters.");
  }
}

/** Only explicitly selected fields are emitted; supplied HTML/provider claims are never retained. */
export function normalizeConversionDestination(input: unknown): ConversionDestinationResult {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return conversionInputError("invalid_kind", "Choose a native form, native booking, external form or external booking destination.");
  }
  const record = input as Record<string, unknown>;
  if (record.kind === "native_form") {
    const formId = typeof record.formId === "string" ? record.formId.trim() : "";
    if (!UUID.test(formId)) return conversionInputError("invalid_form_id", "Choose a native PAIGE form with a valid form UUID.");
    return { ok: true, destination: { kind: "native_form", formId: formId.toLowerCase() } };
  }
  if (record.kind === "native_booking") {
    const slug = typeof record.slug === "string" ? record.slug.trim() : "";
    if (slug.length > CONVERSION_LIMITS.bookingSlug || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
      return conversionInputError("invalid_booking_slug", `Choose a native booking slug of at most ${CONVERSION_LIMITS.bookingSlug} lowercase letters, digits and separating hyphens.`);
    }
    return { ok: true, destination: { kind: "native_booking", slug } };
  }
  if (record.kind !== "external_form" && record.kind !== "external_booking") {
    return conversionInputError("invalid_kind", "Choose a native form, native booking, external form or external booking destination.");
  }
  if (record.mode !== "link" && record.mode !== "embed") {
    return conversionInputError("invalid_mode", "Choose whether the external destination opens as a link or an embedded widget.");
  }
  const url = publicHttpsInput(record.url);
  if (!(url instanceof URL)) return url;
  const shape = widgetShape(url);
  if (record.mode === "embed") {
    if (!shape) return conversionInputError("unsupported_embed", "This URL is not a supported public widget shape. Use its public HTTPS link, or copy a supported provider's iframe URL.", true);
    if (shape.kind !== record.kind) return conversionInputError("provider_kind_mismatch", `Choose an external ${shape.kind === "external_form" ? "form" : "booking"} block for this widget.`, true);
  }
  return {
    ok: true,
    destination: { kind: record.kind, mode: record.mode, url: url.href, provider: shape?.provider ?? providerForHost(url.hostname) },
  };
}
