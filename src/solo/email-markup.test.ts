// The preview is the email as sent: the editor's renderer must produce exactly what the dispatcher sends,
// and the owner's marks must survive a round trip without ever reaching a recipient.
import { describe, expect, it } from "vitest";
import { markupToHtml, previewDocument, renderCampaignEmail, safeUrl, sourceOf } from "./email-markup";

const worker = async () => (await import(/* @vite-ignore */ "../../supabase/functions/email-campaign-worker/logic.ts")) as {
  renderCampaignEmail: (input: { bodyHtml: string; preheader?: string | null; businessName?: string | null; postalAddress: string }) => string;
};

const SOURCE = "# Spring update\n\nHi there,\nThree things changed.\n\n- New hours\n- [Our blog](https://example.com/blog)\n\n[[Book a call|https://example.com/book]]\n\nThanks <3 & see you";

describe("email markup", () => {
  it("turns marks into email HTML and escapes everything else", () => {
    const html = markupToHtml(SOURCE);
    expect(html).toContain("<h2 ");
    expect(html).toContain(">Spring update</h2>");
    expect(html).toContain("Hi there,<br>Three things changed.");
    expect(html).toContain("<li>New hours</li>");
    expect(html).toContain('<a href="https://example.com/blog"');
    expect(html).toContain('href="https://example.com/book"');
    expect(html).toContain(">Book a call</a>");
    expect(html).toContain("Thanks &lt;3 &amp; see you");
    expect(html).not.toContain("<3");
  });

  it("keeps the owner's words for editing, and they round-trip exactly, including non-Latin text", () => {
    const text = `${SOURCE}\n\nÜber 中文 ✓`;
    expect(sourceOf(markupToHtml(text))).toBe(text);
  });

  it("an empty message is an empty body, and HTML written elsewhere has no marks to reopen", () => {
    expect(markupToHtml("   ")).toBe("");
    expect(sourceOf("")).toBe("");
    expect(sourceOf("<p>Written by PAIGE</p>")).toBeNull();
  });

  it("only http, https and mailto links become links", () => {
    expect(safeUrl("javascript:alert(1)")).toBeNull();
    expect(safeUrl("data:text/html,x")).toBeNull();
    expect(safeUrl("mailto:dana@example.com")).toBe("mailto:dana@example.com");
    const html = markupToHtml("[click](javascript:alert(1))\n[[Go|javascript:alert(1)]]");
    expect(html).not.toContain("href=\"javascript");
    expect(html).toContain("[click](javascript:alert(1))");
  });

  it("a long message encodes without overflowing", () => {
    const long = "word ".repeat(60_000);
    expect(sourceOf(markupToHtml(long))).toBe(long);
  });
});

describe("the preview is the email as sent", () => {
  it("renders exactly what the dispatcher renders, footer included", async () => {
    const { renderCampaignEmail: sent } = await worker();
    const cases = [
      { bodyHtml: markupToHtml(SOURCE), preheader: "Three things", businessName: "Northfield <Advisory>", postalAddress: "1 Main St, Atlanta" },
      { bodyHtml: "<p>open <!-- never closed", preheader: "", businessName: null, postalAddress: "PO Box 9" },
      { bodyHtml: "<p>HTML from PAIGE</p>", preheader: null, businessName: "  ", postalAddress: "  2 Elm  " },
    ];
    for (const input of cases) expect(renderCampaignEmail(input)).toBe(sent(input));
  });

  it("the owner's marks never reach a recipient", () => {
    const sent = renderCampaignEmail({ bodyHtml: markupToHtml(SOURCE), postalAddress: "1 Main St" });
    expect(sent).not.toContain("paige-src");
    expect(sent).toContain("{{unsubscribe_url}}");
  });

  it("the preview frame never links to a real unsubscribe address", () => {
    const doc = previewDocument(renderCampaignEmail({ bodyHtml: "<p>Hi</p>", postalAddress: "1 Main St" }));
    expect(doc).not.toContain("{{unsubscribe_url}}");
    expect(doc).toContain("#unsubscribe-preview");
  });
});
