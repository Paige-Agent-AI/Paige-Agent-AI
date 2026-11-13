import { afterEach, describe, expect, it, vi } from "vitest";
import { parseStudioChatConversionPaste } from "./conversion-input";

const JOTFORM = "https://form.jotform.com/123456789012345";
const CALENDLY = "https://calendly.com/example-studio/consultation";
const CALCOM = "https://cal.com/example-studio/consultation";
const GHL_FORM = "https://api.leadconnectorhq.com/widget/form/ExampleForm123";
const GHL_BOOKING = "https://api.leadconnectorhq.com/widget/bookings/example-studio";
afterEach(() => vi.restoreAllMocks());

describe("Studio Chat conversion paste recognition over the original canonical parser", () => {
  it.each([
    [JOTFORM, "external_form"], [GHL_FORM, "external_form"], [GHL_BOOKING, "external_booking"],
    [CALENDLY, "external_booking"], [CALCOM, "external_booking"],
  ])("recognizes a unique supported %s URL as link only", (input, kind) => {
    expect(parseStudioChatConversionPaste(input)).toEqual({ matched: true, input, kind, mode: "link" });
  });
  it("retains only canonical safe presentation switches", () => {
    const input = CALENDLY + "?hide_event_type_details=1";
    expect(parseStudioChatConversionPaste("Use this booking link: " + input)).toEqual({ matched: true, input, kind: "external_booking", mode: "link" });
  });
  it("unknown public destinations require explicit kind, even when prose calls them a form", () => {
    const input = "https://forms.example.com/intake";
    expect(parseStudioChatConversionPaste(input)).toEqual({ matched: true, input, kind: null, mode: "link" });
    expect(parseStudioChatConversionPaste("Use this form: " + input)).toEqual({ matched: true, input, kind: null, mode: "link" });
    expect(parseStudioChatConversionPaste("https://calendly.com/routing/unsupported")).toEqual({ matched: true, input: "https://calendly.com/routing/unsupported", kind: null, mode: "link" });
  });
  it("recognizes clear conversion intent without forwarding surrounding instructions", () => {
    expect(parseStudioChatConversionPaste("Please add this booking link to the page: " + CALENDLY)).toEqual({ matched: true, input: CALENDLY, kind: "external_booking", mode: "link" });
    expect(parseStudioChatConversionPaste("Can you embed this form: " + JOTFORM)).toEqual({ matched: true, input: JOTFORM, kind: "external_form", mode: "embed" });
  });
  it("extracts supported iframe destination without executing or retaining handlers/scripts/markup", () => {
    const fetch = vi.spyOn(globalThis, "fetch");
    const markup = `<iframe src="${GHL_BOOKING}" onload="window.pasteExecuted=true"></iframe><script>window.pasteExecuted=true</script>`;
    expect(parseStudioChatConversionPaste(markup)).toEqual({ matched: true, input: GHL_BOOKING, kind: "external_booking", mode: "embed" });
    expect(parseStudioChatConversionPaste("Embed this booking widget: " + markup)).toEqual({ matched: true, input: GHL_BOOKING, kind: "external_booking", mode: "embed" });
    expect(document.querySelector("iframe,script")).toBeNull(); expect(fetch).not.toHaveBeenCalled();
    expect((window as Window & { pasteExecuted?: boolean }).pasteExecuted).toBeUndefined();
  });
  it("turns only canonical Jotform script input into an inert public form destination", () => {
    expect(parseStudioChatConversionPaste('<script src="https://form.jotform.com/jsform/123456789012345"></script>'))
      .toEqual({ matched: true, input: JOTFORM, kind: "external_form", mode: "embed" });
  });
  it.each([
    "Design an editorial launch page with a useful next step.",
    "Use https://one.example.com and https://two.example.com as visual references.",
    "Use this form as inspiration: " + JOTFORM,
    "The booking page should feel like " + CALENDLY + " but use our own copy.",
    "Reference these forms: " + JOTFORM + " and " + GHL_FORM,
    "Here is an article about forms: https://articles.example.com/forms",
  ])("leaves ordinary brief/reference prose in the original Chat flow: %s", text => {
    expect(parseStudioChatConversionPaste(text)).toEqual({ matched: false });
  });
  it.each([
    JOTFORM + "?token=private-placeholder", CALENDLY + "?email=private-placeholder@example.com",
    "https://user:private-placeholder@forms.example.com/intake", "https://127.0.0.1/form", "https://localhost/form",
    '<iframe src="javascript:private-placeholder"></iframe>', '<iframe srcdoc="private-placeholder"></iframe>',
    '<iframe src="https://forms.example.com/intake"></iframe>',
    `<iframe src="${JOTFORM}"></iframe><iframe src="${CALENDLY}"></iframe>`,
    "Add this form: " + JOTFORM + " and " + CALENDLY,
    "Embed this form: https://forms.example.com/intake",
    "Add this form: http://forms.example.com/intake",
    '<iframe src="' + JOTFORM + '">' + " ".repeat(20001) + "</iframe>",
  ])("intercepts invalid/ambiguous conversion material with a safe non-echoing error %#", text => {
    const result = parseStudioChatConversionPaste(text);
    expect(result.matched).toBe(true);
    if (result.matched) { expect(result.error).toEqual(expect.any(String)); expect(result.input).toBe(""); }
    expect(JSON.stringify(result)).not.toContain("private-placeholder"); expect(JSON.stringify(result)).not.toContain("<iframe");
    expect(document.querySelector("iframe,script")).toBeNull();
  });
});
