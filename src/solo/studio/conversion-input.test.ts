import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CONVERSION_LIMITS,
  normalizeConversionDestination,
  type ConversionDestinationResult,
  type ConversionMode,
} from "../../../supabase/functions/_shared/growth/conversion-destination";
import { parseExternalConversionInput } from "./conversion-input";

const FORM_ID = "df2fd426-a23b-4b91-9dc8-123456789abc";
const JOTFORM = "https://form.jotform.com/123456789012345";
const CALENDLY = "https://calendly.com/example-studio/consultation";
const CALCOM = "https://cal.com/example-studio/consultation";
const GHL_FORM = "https://api.leadconnectorhq.com/widget/form/ExampleForm123";
const GHL_BOOKING = "https://api.leadconnectorhq.com/widget/bookings/example-studio";

function external(url: string, mode: "link" | "embed" = "embed", kind = "external_form") {
  return normalizeConversionDestination({ kind, mode, url });
}
function expectError(result: ConversionDestinationResult, code?: string) {
  expect(result.ok).toBe(false);
  if (result.ok === false) {
    if (code) expect(result.code).toBe(code);
    expect(result.message.length).toBeGreaterThan(10);
  }
}
function parse(input: string, kind: "external_form" | "external_booking" = "external_form", mode: "link" | "embed" = "embed") {
  return parseExternalConversionInput({ input, kind, mode });
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("canonical conversion destination (format admission, not ownership)", () => {
  it("normalizes a native form UUID without implying authorization", () => {
    expect(normalizeConversionDestination({ kind: "native_form", formId: FORM_ID.toUpperCase(), html: "<script>bad()</script>" }))
      .toEqual({ ok: true, destination: { kind: "native_form", formId: FORM_ID } });
  });
  it.each(["", "form-slug", "../private", "df2fd426-a23b-4b91-9dc8-123456789ab", 123, null])("rejects invalid native form ID %s", (formId) => {
    expectError(normalizeConversionDestination({ kind: "native_form", formId }), "invalid_form_id");
  });
  it("admits only a bounded native booking slug", () => {
    expect(normalizeConversionDestination({ kind: "native_booking", slug: "discovery-call-123" }))
      .toEqual({ ok: true, destination: { kind: "native_booking", slug: "discovery-call-123" } });
  });
  it.each(["", "../private", "a/b", "a?token=secret", "UPPERCASE", "a b", "a".repeat(129), null])("rejects invalid booking slug %s", (slug) => {
    expectError(normalizeConversionDestination({ kind: "native_booking", slug }), "invalid_booking_slug");
  });
  it.each([null, [], "https://example.com", {}, { kind: "iframe" }])("rejects unknown contracts %j", (input) => {
    expectError(normalizeConversionDestination(input), "invalid_kind");
  });
  it("requires an explicit external display mode", () => {
    expectError(normalizeConversionDestination({ kind: "external_form", url: JOTFORM }), "invalid_mode");
  });
  it.each([
    [JOTFORM, "external_form", "jotform"],
    [GHL_FORM, "external_form", "gohighlevel"],
    [GHL_BOOKING, "external_booking", "gohighlevel"],
    [CALENDLY, "external_booking", "calendly"],
    [CALCOM, "external_booking", "calcom"],
  ])("accepts documented public embed shape %s", (url, kind, provider) => {
    expect(external(url, "embed", kind)).toEqual({ ok: true, destination: { kind, mode: "embed", url, provider } });
  });
  it("derives provider identity from the destination instead of caller claims", () => {
    expect(normalizeConversionDestination({ kind: "external_booking", mode: "embed", url: CALENDLY, provider: "jotform" }))
      .toEqual({ ok: true, destination: { kind: "external_booking", mode: "embed", url: CALENDLY, provider: "calendly" } });
  });
  it("allows an unsupported provider as a public HTTPS link", () => {
    expect(external("https://forms.example.com/intake", "link"))
      .toEqual({ ok: true, destination: { kind: "external_form", mode: "link", url: "https://forms.example.com/intake", provider: "other" } });
  });
  it.each([
    "https://forms.example.com/intake",
    "https://form.jotform.com/jsform/123456789012345",
    "https://form.jotform.com/my-studio/intake",
    "https://api.leadconnectorhq.com/widget/booking/ExampleId123",
    "https://link.msgsndr.com/widget/form/ExampleId123",
    "https://calendly.com/app/admin",
    "https://cal.com/settings/profile",
    "https://calendly.com.evil.example.com/studio/intake",
    "https://evil-cal.com/studio/intake",
  ])("keeps unverified shapes link-only: %s", (url) => {
    const result = external(url);
    expectError(result, "unsupported_embed");
    if (result.ok === false) expect(result.canUseLink).toBe(true);
  });
  it("does not confuse a form widget with a booking widget", () => {
    expectError(external(JOTFORM, "embed", "external_booking"), "provider_kind_mismatch");
    expectError(external(CALENDLY, "embed", "external_form"), "provider_kind_mismatch");
  });
  it.each([
    "http://example.com/form", "//example.com/form", "javascript:alert(1)",
    "data:text/html,hi", "https://user:password@example.com/form", "https://user@example.com/form",
    "https://example.com:444/form", "https://example.com\\@localhost/form", "https://example.com/\nform",
    "https://example.com/%0d%0aform", "https://example.com/%250aform", "https://example.com/%5cform",
    "https://localhost/form", "https://localhost./form", "https://private.local/form", "https://intranet/form",
    "https://private.internal/form", "https://private.home.arpa/form", "https://127.0.0.1/form", "https://10.0.0.1/form",
    "https://192.168.1.1/form", "https://169.254.169.254/form", "https://2130706433/form", "https://0x7f000001/form",
    "https://[::1]/form", "https://[::ffff:127.0.0.1]/form", "https://8.8.8.8/form", "https://127.0.0.1.nip.io/form",
    "https://private.invalid/form", "https://private.example/form", "https://private.localhost/form",
    "https://127.0.0.1.sslip.io/form", "https://example.com/%", "https://example.com/%E2%80%AEform",
  ])("rejects unsafe or non-public input without a request: %s", (url) => {
    expectError(external(url, "link"));
  });
  it.each([
    "?api_key=secret", "?token=secret", "?access_token=secret", "?password=secret", "?email=person%40example.com",
    "?name=Someone", "?phone=1234567890", "?redirect=https%3A%2F%2Fexample.com", "?unknown=anything", "#access_token=secret", "#",
  ])("refuses credential, PII, redirect and unreviewed query/fragment fields %s", (suffix) => {
    expectError(external(JOTFORM + suffix, "link"), "unsafe_url_options");
  });
  it("preserves documented finite Calendly presentation options only", () => {
    const url = CALENDLY + "?hide_landing_page_details=1&hide_event_type_details=1";
    expect(external(url, "embed", "external_booking")).toEqual({ ok: true, destination: { kind: "external_booking", mode: "embed", url, provider: "calendly" } });
    expectError(external(CALENDLY + "?hide_event_type_details=person%40example.com", "embed", "external_booking"), "unsafe_url_options");
    expectError(external(CALENDLY + "?hide_event_type_details=1&hide_event_type_details=0", "embed", "external_booking"), "unsafe_url_options");
  });
  it("rejects excessive URLs rather than silently truncating them", () => {
    expectError(external("https://example.com/" + "a".repeat(CONVERSION_LIMITS.url), "link"), "input_too_long");
  });
  it("normalizes URL host case and standard HTTPS port", () => {
    expect(external("https://FORM.JOTFORM.COM:443/123456789012345"))
      .toEqual(external(JOTFORM));
  });
  it("never needs a browser DOM for the shared destination contract", () => {
    const createElement = vi.spyOn(document, "createElement");
    expect(external(JOTFORM).ok).toBe(true);
    expect(createElement).not.toHaveBeenCalled();
  });
});

describe("browser-only conversion paste parser", () => {
  it("accepts a plain public destination", () => {
    expect(parse(JOTFORM)).toEqual(external(JOTFORM));
  });
  it("rejects a runtime-invalid mode for pasted HTML too", () => {
    expectError(parseExternalConversionInput({
      kind: "external_form", mode: "script" as ConversionMode, input: `<iframe src="${JOTFORM}"></iframe>`,
    }), "invalid_mode");
  });
  it.each([
    [JOTFORM, "external_form"], [GHL_FORM, "external_form"], [GHL_BOOKING, "external_booking"],
    [CALENDLY, "external_booking"], [CALCOM, "external_booking"],
  ] as const)("extracts a single supported iframe URL %s", (url, kind) => {
    expect(parse(`<div><iframe src="${url}" style="height:900px" onload="bad()"></iframe></div><script>bad()</script>`, kind))
      .toEqual(external(url, "embed", kind));
  });
  it("decodes HTML attributes and retains only approved query options", () => {
    const url = CALENDLY + "?hide_landing_page_details=1&hide_event_type_details=1";
    expect(parse(`<iframe src="${url.replace("&", "&amp;")}"></iframe>`, "external_booking"))
      .toEqual(external(url, "embed", "external_booking"));
  });
  it("converts the canonical Jotform jsform script to its public form URL", () => {
    expect(parse('<script type="text/javascript" src="https://form.jotform.com/jsform/123456789012345"></script>'))
      .toEqual(external(JOTFORM));
  });
  it("does not retain HTML, handler attributes, inline scripts or styles", () => {
    const result = parse(`<style>body{display:none}</style><img src="https://example.com/tracker"><iframe src="${JOTFORM}" onload="fetch('/private')"></iframe><script>window.unsafeRan=true</script>`);
    expect(result).toEqual(external(JOTFORM));
    expect(JSON.stringify(result)).not.toMatch(/iframe|script|style|unsafeRan|onload|tracker|private/);
    expect(document.querySelector("iframe")).toBeNull();
    expect("unsafeRan" in window).toBe(false);
  });
  it.each([
    `<iframe src="${JOTFORM}"></iframe><iframe src="${JOTFORM}"></iframe>`,
    `<iframe src="${JOTFORM}"></iframe><iframe src="javascript:bad()"></iframe>`,
    `<iframe src="${JOTFORM}"></iframe><script src="https://form.jotform.com/jsform/123456789012345"></script>`,
    '<script src="https://form.jotform.com/jsform/123456789012345"></script><script src="https://form.jotform.com/jsform/123456789012346"></script>',
  ])("rejects ambiguous multiple destinations", (html) => {
    expectError(parse(html), "ambiguous_html");
  });
  it.each([
    `<iframe src="${JOTFORM}" srcdoc="<script>bad()</script>"></iframe>`,
    '<iframe srcdoc="hello"></iframe>',
    '<iframe></iframe>', '<iframe src="javascript:bad()"></iframe>',
    '<iframe src="https://localhost/form"></iframe>', '<iframe src="https://example.com/form"></iframe>',
    '<iframe src="https://form.jotform.com/123456789012345?token=secret"></iframe>',
    '<script>Calendly.initInlineWidget({url:"https://calendly.com/studio/call"})</script>',
    '<script src="https://evil.example/widget.js"></script>',
    '<script src="https://form.jotform.com.evil.example/jsform/123456789012345"></script>',
    '<div class="calendly-inline-widget" data-url="https://calendly.com/studio/call"></div>',
    '<object data="https://form.jotform.com/123456789012345"></object>',
    '<template><iframe src="https://form.jotform.com/123456789012345"></iframe></template>',
  ])("refuses unsupported or hostile HTML without executing it", (html) => {
    expectError(parse(html));
  });
  it("uses link mode for an unsupported plain URL but never promotes arbitrary HTML to a link", () => {
    expect(parse("https://forms.example.com/intake", "external_form", "link")).toEqual(external("https://forms.example.com/intake", "link"));
    expectError(parse('<iframe src="https://forms.example.com/intake"></iframe>', "external_form", "link"), "unsupported_embed");
  });
  it("rejects excessive input before parsing", () => {
    expectError(parse("<div>" + "a".repeat(CONVERSION_LIMITS.html) + "</div>"), "input_too_long");
  });
  it("does not silently truncate an excessive plain URL", () => {
    expectError(parse("https://example.com/" + "a".repeat(CONVERSION_LIMITS.url)), "input_too_long");
  });
  it("returns a typed error when a browser security policy blocks HTML inspection", () => {
    vi.spyOn(Element.prototype, "innerHTML", "set").mockImplementation(() => { throw new TypeError("Blocked HTML sink"); });
    expectError(parse(`<iframe src="${JOTFORM}"></iframe>`), "invalid_html");
  });
  it("requires the browser for HTML while keeping URL normalization DOM-free", () => {
    vi.stubGlobal("document", undefined);
    expectError(parse(`<iframe src="${JOTFORM}"></iframe>`), "browser_required");
    expect(parse(JOTFORM)).toEqual(external(JOTFORM));
  });
  it("performs no fetch, XHR or live DOM insertion", () => {
    const fetch = vi.spyOn(globalThis, "fetch");
    const xhr = vi.spyOn(XMLHttpRequest.prototype, "open");
    const append = vi.spyOn(document.body, "appendChild");
    expect(parse(`<iframe src="${JOTFORM}"></iframe><img src="https://example.com/a"><script src="https://example.com/b"></script>`).ok).toBe(true);
    expect(fetch).not.toHaveBeenCalled();
    expect(xhr).not.toHaveBeenCalled();
    expect(append).not.toHaveBeenCalled();
  });
});
