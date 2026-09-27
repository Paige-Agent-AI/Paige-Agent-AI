/* eslint-disable @typescript-eslint/no-explicit-any -- Executed edge helper loaded through a transpile port. */
// @vitest-environment node
//
// CAPABILITY SYSTEM · Doc-export MVP — turn a document a workspace already created into a real,
// DOWNLOADABLE file (pdf/docx/pptx/md) via the existing in-band doc-render lane + the model router's
// persist/sign path. This slice's NET-NEW render code is the `md` serializer (pdf/docx/pptx renderers
// already existed and are only newly REACHED). §32: the md serializer is pure (no Deno/npm import) so
// it is smoke-tested here headlessly — it must produce a real, non-empty .md file and never throw. The
// docx/pptx/pdf paths dynamic-import npm libs (Deno runtime) and stay PROOF-OWED until post-deploy, so
// they are covered by source contract, not executed here.
import { readFileSync } from "node:fs";
import ts from "typescript";
import { describe, it, expect } from "vitest";

// Load the edge module through a transpile port. Its ONLY top-level value import is NeedsConfigError
// from ./provider-types.ts; stub it. The npm doc libs are imported DYNAMICALLY inside the pdf/docx/pptx
// renderers, which the md path never touches — so loading + running renderDoc({format:"md"}) needs no lib.
function loadDocRender() {
  const src = readFileSync("supabase/functions/_shared/doc-render.ts", "utf8");
  const js = ts.transpileModule(src, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const out: any = {};
  const require = (k: string) => {
    if (k.includes("provider-types")) return { NeedsConfigError: class NeedsConfigError extends Error { tag?: string; constructor(tag?: string, m?: string) { super(m); this.tag = tag; } } };
    throw new Error(`unexpected runtime import: ${k}`);
  };
  new Function("require", "exports", js)(require, out);
  return out;
}

const { renderDoc, inlineMdToText, parseMarkdown, paginateSlideBody, wrapToWidth } = loadDocRender();
const dec = (u: Uint8Array) => new TextDecoder().decode(u);

describe("inlineMdToText — flatten markdown to clean text for BINARY renderers (Codex round-6/9)", () => {
  it("strips emphasis, keeps code + balanced-paren URLs verbatim, links → label (url)", () => {
    // This is the flattening the pdf/docx/pptx renderers apply (they can't parse markdown). The `.md`
    // exporter does NOT use it — md keeps raw markdown (asserted in the md-serializer suite below).
    expect(inlineMdToText("We use **three** campaigns")).toBe("We use three campaigns");     // bold stripped
    expect(inlineMdToText("a *little* thing")).toBe("a little thing");                        // italic stripped
    expect(inlineMdToText("Set `tenant_id_value` here")).toBe("Set tenant_id_value here");    // code VERBATIM (H2)
    expect(inlineMdToText("Run `a*b*c` now")).toBe("Run a*b*c now");                          // code metachars kept (H2)
    expect(inlineMdToText("see [x](https://ex.co/a_(b)?utm_source=s&utm_medium=m)"))
      .toBe("see x (https://ex.co/a_(b)?utm_source=s&utm_medium=m)");                          // balanced-paren URL whole (H3/G1)
    expect(inlineMdToText("![logo](https://ex.co/l.png) shown")).toBe("logo shown");          // image → alt, dest dropped
    // Codex round-11 M2 — a bare identifier/URL written DIRECTLY in prose (NOT a markdown link, so it is
    // never placeheld) keeps its underscores: CommonMark underscore emphasis needs a word boundary, so an
    // `_` flanked by an alphanumeric on its outer side is a literal character, not an emphasis marker.
    expect(inlineMdToText("Visit ?utm_source=x&utm_medium=y now")).toBe("Visit ?utm_source=x&utm_medium=y now"); // query underscores kept
    expect(inlineMdToText("The tenant_id_value field")).toBe("The tenant_id_value field");    // snake_case kept
    // …but genuine underscore emphasis AT a word boundary still strips (bold and italic both).
    expect(inlineMdToText("a _real_ emphasis")).toBe("a real emphasis");                       // word-boundary italic
    expect(inlineMdToText("this is __very__ bold")).toBe("this is very bold");                 // word-boundary bold
    // Codex round-12 — boundary-delimited emphasis WRAPPING a snake_case identifier flattens too: the
    // internal underscore is intraword (kept), only the outer delimiters strip. This is the case the
    // round-11 `[^_]` capture could not span; the `(?=\S)…(?<=\S)` anchors allow it without re-corrupting
    // the bare `utm_source` / `tenant_id_value` above.
    expect(inlineMdToText("see _tenant_id_ here")).toBe("see tenant_id here");                  // italic around snake_case
    expect(inlineMdToText("the __field_name__ column")).toBe("the field_name column");         // bold around snake_case
  });
});

describe("doc-render binary-path helpers (Codex round-12c)", () => {
  it("parseMarkdown captures a fenced code block as ONE raw paragraph — backticks are not mangled into inline spans", () => {
    const blocks = parseMarkdown("Intro line.\n\n```ts\nconst a = 1;\nif (a > 0) { a_b(); }\n```\n\nAfter.");
    const code = blocks.find((b: any) => b.raw === true);
    expect(code).toBeTruthy();
    expect(code.type).toBe("paragraph");
    // the fence content is preserved verbatim (newlines + the intraword `_` in a_b intact), WITHOUT the ``` markers
    expect(code.text).toBe("const a = 1;\nif (a > 0) { a_b(); }");
    // surrounding prose stays ordinary (non-raw) paragraphs
    expect(blocks.some((b: any) => b.type === "paragraph" && !b.raw && b.text === "Intro line.")).toBe(true);
    expect(blocks.some((b: any) => b.type === "paragraph" && !b.raw && b.text === "After.")).toBe(true);
  });

  it("parseMarkdown preserves indentation inside a fence and closes on the matching marker", () => {
    const blocks = parseMarkdown("```\n    indented();\nplain();\n```");
    const code = blocks.find((b: any) => b.raw === true);
    expect(code.text).toBe("    indented();\nplain();");   // leading 4 spaces kept
  });

  it("wrapToWidth hard-breaks an over-width token (a long URL) so nothing runs off the page (Codex round-12d J)", () => {
    const measure = (s: string) => s.length;   // 1 unit per char, injected in place of the pdf font metric
    expect(wrapToWidth("hello world foo", measure, 11)).toEqual(["hello world", "foo"]); // wraps at whitespace
    expect(wrapToWidth("", measure, 10)).toEqual([]);                                     // blank line → []
    // a long token with NO whitespace (a booking/tracking URL) is hard-broken into fitting pieces, no char lost
    const url = "https://ex.co/book/" + "x".repeat(40);
    const parts = wrapToWidth(url, measure, 12);
    expect(parts.every((p: string) => p.length <= 12)).toBe(true);
    expect(parts.join("")).toBe(url);
  });

  it("paginateSlideBody splits a long section, keeps a short one whole, and never drops content", () => {
    const many = Array.from({ length: 40 }, (_, i) => `Bullet ${i + 1}`);
    const pages = paginateSlideBody(many);
    expect(pages.length).toBeGreaterThan(1);                 // 40 short bullets overflow one slide's box
    expect(pages.flat()).toEqual(many);                      // every line survives, in order
    expect(paginateSlideBody(["one line"]).length).toBe(1);  // a short section stays one page
    expect(paginateSlideBody([])).toEqual([[]]);             // empty body → a single (empty) page
    const long = "x".repeat(500);
    expect(paginateSlideBody([long]).flat()).toEqual([long]); // one over-budget line still gets its own page
  });
});

describe("doc-render md serializer — a real, portable .md file (slice: doc export MVP)", () => {
  it("serializes title + headings + paragraphs + lists to clean markdown", async () => {
    const r = await renderDoc({
      format: "md",
      title: "Quarterly Plan",
      content: [
        { type: "heading", text: "Overview", level: 1 },
        { type: "paragraph", text: "Revenue is up 20% this quarter." },
        { type: "list", items: ["Ship export", "Tell the owner"], ordered: false },
        { type: "list", items: ["First", "Second"], ordered: true },
      ],
    });
    expect(r.ext).toBe("md");
    expect(r.mime).toMatch(/markdown/);
    const md = dec(r.bytes);
    expect(md).toContain("# Quarterly Plan");           // title is the H1
    expect(md).toContain("## Overview");                 // a block heading sits one level below the title
    expect(md).toContain("Revenue is up 20% this quarter.");
    expect(md).toContain("- Ship export");
    expect(md).toContain("1. First");
    expect(r.bytes.length).toBeGreaterThan(0);
  });

  it("accepts the {docType,title,blocks} wrapper document_generate saves (defensive unwrap)", async () => {
    const r = await renderDoc({ format: "md", title: "Wrapped", content: { docType: "guide", title: "Wrapped", blocks: [{ type: "paragraph", text: "Body." }] } });
    expect(dec(r.bytes)).toContain("Body.");
  });

  it("promotes a wrapper's title to the renderer with NO top-level title — a cover-only doc is not empty (Codex round-12d H)", async () => {
    // {title, blocks:[cover with the SAME title]} and NO input.title: coerceBlockArray dedups the cover title
    // against the wrapper title, so the title must be promoted to the renderer or it renders NOWHERE (empty file).
    const r = await renderDoc({ format: "md", content: { title: "Wrapped Plan", blocks: [{ type: "cover", title: "Wrapped Plan", subhead: "the sub" }] } });
    const md = dec(r.bytes);
    expect(md).toContain("# Wrapped Plan");   // the promoted wrapper title renders as the H1…
    expect(md).toContain("the sub");          // …and the cover subhead survives
    expect(r.bytes.length).toBeGreaterThan(0);
  });

  it("renders the REAL document_generate block schema (cover/section-header/prose/list/pricing-table/cta), not just the title", async () => {
    // Codex P1 regression: coerceBlockArray previously understood only heading/list/paragraph, so a real
    // generated proposal exported as basically its title while still returning success. This drives the
    // ACTUAL on-canvas block contract document_generate persists and asserts every block's content lands.
    const r = await renderDoc({
      format: "md",
      title: "Growth Proposal",
      content: [
        { type: "cover", eyebrow: "For Acme", title: "Growth Proposal", subhead: "A plan to scale" },
        { type: "section-header", title: "Scope" },
        { type: "prose", markdown: "We will run three campaigns." },
        { type: "callout", variant: "key-insight", body: "Focus on retention first." },
        { type: "list", style: "bullet", items: ["Audit", "Build", "Launch"] },
        { type: "pull-quote", quote: "This changed our business", attribution: "A client" },
        { type: "stat", value: "3x", label: "pipeline growth" },
        { type: "pricing-table", caption: "Investment", rows: [{ item: "Retainer", amount: "$2,500/mo" }], total: "$30,000/yr" },
        { type: "list", style: "checklist", items: ["Sign contract", "Kickoff call"] },
        { type: "worksheet-field", field: "lines", label: "Your top goal", lines: 2 },
        { type: "worksheet-field", field: "scale", label: "Confidence", scaleMin: 1, scaleMax: 5, minLabel: "Low", maxLabel: "High" },
        { type: "worksheet-field", field: "checkbox", label: "I agree to the terms" },
        { type: "cta", headline: "Ready to start?", action: "Approve & start" },
      ],
    });
    const md = dec(r.bytes);
    expect(md).toContain("A plan to scale");            // cover subhead
    // section-header → a REAL H2 line (below the H1 doc title). Line-anchored (^…$ /m) on purpose: a
    // plain toContain("## Scope") would also pass on "### Scope" (an offset substring), which is exactly
    // the false-green that hid a section rendering one level too deep. This asserts H2, never H3.
    expect(md).toMatch(/^## Scope$/m);
    expect(md).toContain("We will run three campaigns."); // prose markdown
    expect(md).toContain("Focus on retention first.");   // callout body
    expect(md).toContain("- Audit");                     // list
    expect(md).toContain("This changed our business");   // pull-quote
    expect(md).toContain("3x");                          // stat value
    expect(md).toContain("Retainer");                    // pricing-table row item
    expect(md).toContain("$2,500/mo");                   // pricing-table amount
    expect(md).toContain("Total: $30,000/yr");           // pricing-table total
    expect(md).toContain("Approve & start");             // cta action
    // Codex P2 — the cover's title equals the outer doc title, so it must render ONCE (as the H1), never
    // twice. Assert exactly one `# Growth Proposal` and NO `## Growth Proposal` duplicate heading.
    expect((md.match(/^# Growth Proposal$/gm) || []).length).toBe(1);
    expect(md).not.toContain("## Growth Proposal");
    // Codex P2 — a `checklist` list keeps its checkbox job as an ASCII `[ ]` (PDF-safe; a Unicode ☐ is
    // transcoded to `?` by the PDF WinAnsi sanitizer), never flattened to a plain bullet.
    expect(md).toContain("[ ] Sign contract");
    expect(md).not.toContain("☐");                       // the Unicode box must never reach the export
    // Codex P1 — a worksheet-field is a REAL printable blank: the prompt AND a place to write/rate/check.
    expect(md).toContain("Your top goal");               // lines field: prompt
    expect(md).toMatch(/_{10,}/);                        // lines field: an actual ruled write-line
    expect(md).toContain("Confidence");                  // scale field: prompt
    expect(md).toContain("1 — 2 — 3 — 4 — 5");           // scale field: the numbered rating
    expect(md).toContain("Low");                         // scale field: min anchor
    expect(md).toContain("High");                        // scale field: max anchor
    expect(md).toContain("I agree to the terms");        // checkbox field: prompt
  });

  it("preserves prose markdown structure/links, the CTA destination, a callout title, and TOC entries (Codex round-4 fidelity)", async () => {
    const r = await renderDoc({
      format: "md",
      title: "Fidelity",
      content: [
        { type: "toc", title: "Inside", entries: ["Overview", "Pricing"] },
        { type: "callout", variant: "key-insight", title: "The key point", body: "Retention beats acquisition." },
        { type: "prose", markdown: "## How it works\n\nWe use **three** campaigns and a [signup form](https://ex.co/x).\n\n- First\n- Second" },
        { type: "cta", headline: "Ready?", action: "Book a call", href: "https://ex.co/book" },
      ],
    });
    const md = dec(r.bytes);
    expect(md).toContain("Overview");                     // toc entries survive as content, not dropped
    expect(md).toContain("Pricing");
    expect(md).toContain("The key point");                // callout title is not lost to the body
    expect(md).toContain("Retention beats acquisition.");
    // Codex round-9 K3 / round-10 L2 — the `.md` exporter passes prose's RAW markdown through verbatim
    // (it IS markdown; parsing it would collapse code fences / tables). So the prose heading keeps its own
    // `##` level, and bold + links stay real markdown.
    expect(md).toMatch(/^## How it works$/m);             // prose heading kept at its source level, verbatim
    expect(md).toContain("We use **three** campaigns");   // bold markup preserved in the .md file
    expect(md).toContain("[signup form](https://ex.co/x)"); // link preserved as real markdown, not `label (url)`
    expect(md).toContain("- First");                      // prose list preserved verbatim
    expect(md).toContain("https://ex.co/book");           // the CTA destination is followable, not discarded
  });

  it("keeps underscores in a prose link URL intact and auto-derives an entries-less TOC (Codex round-5)", async () => {
    const r = await renderDoc({
      format: "md",
      title: "R5",
      content: [
        { type: "toc" },                                  // no entries — must auto-build from the sections below
        { type: "section-header", title: "Alpha" },
        { type: "prose", markdown: "See the [guide](https://ex.co/p?utm_source=email&utm_medium=doc)." },
        { type: "chapter-divider", title: "Beta" },
      ],
    });
    const md = dec(r.bytes);
    // G1 — a URL's underscores survive; the emphasis pass must not turn `utm_source` into `utmsource`.
    expect(md).toContain("https://ex.co/p?utm_source=email&utm_medium=doc");
    expect(md).not.toContain("utmsource");
    // G2 — an entries-less toc auto-builds from the section-header/chapter-divider titles (mirrors the canvas).
    expect(md).toContain("Contents");                     // toc default title
    // The canvas renders the toc as an ORDERED list (<ol>, numeric indices), so the export must number the
    // derived entries too — never bullets (Codex round-12h). Alpha (section-header) then Beta (chapter-divider).
    expect(md).toContain("1. Alpha");                     // derived TOC entry, numbered — not "- Alpha"
    expect(md).toContain("2. Beta");
    expect(md).not.toContain("- Alpha");                  // the old unordered form must be gone
  });

  it("exports a toc's explicit entries as a numbered list, matching the canvas <ol> (Codex round-12h)", async () => {
    // The canvas renders toc entries in an ordered list; the export must number them so numbered
    // cross-references to sections still line up with the contents page — never bullets.
    const r = await renderDoc({ format: "md", title: "Guide", content: [{ type: "toc", title: "Inside", entries: ["Overview", "Pricing", "Next steps"] }] });
    const md = dec(r.bytes);
    expect(md).toContain("1. Overview");
    expect(md).toContain("2. Pricing");
    expect(md).toContain("3. Next steps");
    expect(md).not.toContain("- Overview");               // the old unordered (bullet) form must be gone
  });

  it("PDF fails closed on a title-only Cyrillic document — the charset guard covers SHORT docs too (Codex round-7 I2)", async () => {
    // The guard runs BEFORE the pdf-lib import and throws a distinctly-tagged NeedsConfigError, so this
    // executes headlessly: a 6-char all-Cyrillic title is 100% unencodable and must degrade, not ship `?`.
    await expect(renderDoc({ format: "pdf", title: "Привет", content: [] }))
      .rejects.toMatchObject({ tag: "doc-render:pdf-charset" });
    // And a purely-Latin PDF does NOT trip the charset guard (it fails later on the lib import in this
    // headless port — a DIFFERENT tag — proving the Cyrillic rejection above is the charset guard, not the import).
    await expect(renderDoc({ format: "pdf", title: "Hello world", content: [{ type: "paragraph", text: "All ASCII here." }] }))
      .rejects.toMatchObject({ tag: "doc-render:pdf" });
  });

  it("PDF fails closed when a PRICE currency symbol would be corrupted, even in mostly-English text (Codex round-12)", async () => {
    // A single non-WinAnsi currency mark (₹/₽/₩) sits far below the 15% loss ratio, so the ratio guard alone
    // would let `₹10,000` ship as `?10,000` reported as success — a materially wrong price (§13). The
    // currency guard rejects any LOST `\p{Sc}` mark independent of the ratio.
    await expect(renderDoc({ format: "pdf", title: "Quote",
      content: [{ type: "paragraph", text: "Your total investment for the retainer engagement is ₹10,000 every month." }] }))
      .rejects.toMatchObject({ tag: "doc-render:pdf-charset" });
    // A Latin-currency price ($, WinAnsi-encodable) does NOT trip the currency guard — it fails later on the
    // headless lib import (a DIFFERENT tag), proving the ₹ rejection above is the currency guard, not the ratio.
    await expect(renderDoc({ format: "pdf", title: "Quote",
      content: [{ type: "paragraph", text: "Your total investment for the retainer engagement is $10,000 every month." }] }))
      .rejects.toMatchObject({ tag: "doc-render:pdf" });
  });

  it("md keeps prose's RAW markdown (code spans, links) and preserves Unicode (Codex round-6/9 K3)", async () => {
    const r = await renderDoc({
      format: "md",
      title: "R6",
      content: [
        { type: "prose", markdown: "Set `tenant_id_value` and `a*b*c`; see [x](https://ex.co/a_(b)?utm_source=s&utm_medium=m)." },
        { type: "paragraph", text: "Привет мир 你好" },
      ],
    });
    const md = dec(r.bytes);
    // K3 — the .md exporter preserves prose markdown verbatim: code spans keep their backticks, links stay
    // real markdown. (The flattening for binary renderers is proven by the inlineMdToText unit test above.)
    expect(md).toContain("`tenant_id_value`");
    expect(md).toContain("`a*b*c`");
    expect(md).toContain("[x](https://ex.co/a_(b)?utm_source=s&utm_medium=m)"); // full markdown link, URL intact
    expect(md).not.toContain("utmsource");
    // md keeps Unicode — only the PDF path has the WinAnsi (Latin-only) limit.
    expect(md).toContain("Привет мир 你好");
  });

  it("preserves section and chapter numbers in the exported heading (Codex round-8 J3)", async () => {
    const r = await renderDoc({
      format: "md",
      title: "Numbered",
      content: [
        { type: "section-header", number: 2, title: "Scope" },
        { type: "chapter-divider", number: 3, title: "Delivery" },
      ],
    });
    const md = dec(r.bytes);
    expect(md).toMatch(/^## 2\. Scope$/m);       // section number kept as content (→ H2 under the doc title)
    expect(md).toMatch(/^## 3\. Delivery$/m);    // chapter number kept
  });

  it("does NOT collapse blank runs inside a raw prose block — a fenced code block round-trips verbatim (Codex round-11 M3)", async () => {
    // A `prose` block is raw-markdown passthrough on the md path, so a fenced code block that carries two
    // consecutive blank lines must round-trip. A global `\n{3,}→\n\n` normalizer would silently eat one of
    // them, altering the code. Block separators are already exactly one blank line, so nothing legitimate
    // ever needed that collapse.
    const fence = "```\ncode line 1\n\n\ncode line 2\n```";
    const r = await renderDoc({ format: "md", title: "Code", content: [{ type: "prose", markdown: fence }] });
    const md = dec(r.bytes);
    expect(md).toContain("code line 1\n\n\ncode line 2");   // the two internal blank lines survive verbatim
  });

  it("passes a TOP-LEVEL raw markdown string through verbatim for md — a legacy string body is not re-parsed (Codex round-12)", async () => {
    // A legacy document whose `body` is raw markdown (a STRING, not a block array) must round-trip for md:
    // parseMarkdown would collapse the fenced code block and the table. The passthrough now covers the
    // top-level string / {markdown} / {text} shapes, not just an in-array `prose` block.
    const source = "## How it works\n\n```js\nconst a = 1;\n\n\nconst b = 2;\n```\n\n| Col A | Col B |\n| --- | --- |\n| 1 | 2 |";
    const asString = await renderDoc({ format: "md", title: "Legacy", content: source });
    const md1 = dec(asString.bytes);
    expect(md1).toContain("```js\nconst a = 1;\n\n\nconst b = 2;\n```"); // fence + its internal blank run survive
    expect(md1).toContain("| Col A | Col B |");                          // table row survives (parseMarkdown would drop the pipes)
    expect(md1).toContain("| --- | --- |");
    // The {markdown} wrapper shape (no block array) takes the same verbatim path.
    const asWrapper = await renderDoc({ format: "md", content: { markdown: source } });
    expect(dec(asWrapper.bytes)).toContain("```js\nconst a = 1;");
  });

  it("preserves LEADING indentation of a raw prose block — an indented code block round-trips for md (Codex round-12b)", async () => {
    // A prose block whose markdown IS an indented code block (4-space) must keep those 4 leading spaces on
    // md export: trimming both ends would demote the first line to prose while later lines stayed code.
    const r = await renderDoc({ format: "md", title: "Snippet", content: [{ type: "prose", markdown: "    const a = 1;\n    const b = 2;" }] });
    const md = dec(r.bytes);
    expect(md).toMatch(/^ {4}const a = 1;$/m);   // first line keeps its 4-space indent (still a code line)
    expect(md).toMatch(/^ {4}const b = 2;$/m);   // later lines unaffected
    expect(md).not.toMatch(/^const a = 1;$/m);   // …and it was NOT de-indented to prose
  });

  it("clamps a reversed / out-of-range worksheet scale to an ordered ≥2-tick scale, like the canvas (Codex round-12f)", async () => {
    // scaleMin 5 > scaleMax 1 previously produced an EMPTY scale (the ascending loop never ran), dropping the
    // rating affordance. Now clamped like DocumentPreview.tsx: lo=5, hi=max(lo+1, clamp(1))=6 → "5 — 6".
    const rev = await renderDoc({ format: "md", title: "W", content: [{ type: "worksheet-field", field: "scale", label: "Rate it", scaleMin: 5, scaleMax: 1 }] });
    expect(dec(rev.bytes)).toContain("5 — 6");                 // ordered, at least two ticks — never empty
    // an out-of-range max clamps to lo+10 at most and stays ordered from lo
    const big = await renderDoc({ format: "md", title: "W", content: [{ type: "worksheet-field", field: "scale", label: "Rate it", scaleMin: 0, scaleMax: 99 }] });
    expect(dec(big.bytes)).toContain("0 — 1 — 2");
  });

  it("truncates fractional scale endpoints like the canvas, not rounds them (Codex round-12g)", async () => {
    // The tool schema accepts any JSON number, so {1.9, 5.9} is reachable. The canvas (DocumentPreview.tsx)
    // coerces with Math.trunc → a 1–5 scale; the exporter must render the SAME 1–5 scale, never a rounded
    // 2–6 (which would silently change the worksheet's rating question). Assert the trunc result is present
    // and the rounded one is absent, in one shot.
    const frac = await renderDoc({ format: "md", title: "W", content: [{ type: "worksheet-field", field: "scale", label: "Rate it", scaleMin: 1.9, scaleMax: 5.9 }] });
    const out = dec(frac.bytes);
    expect(out).toContain("1 — 2 — 3 — 4 — 5");   // trunc(1.9)=1 … trunc(5.9)=5 — matches the canvas
    expect(out).not.toContain("2 — 3 — 4 — 5 — 6"); // the old Math.round behavior — must be gone
  });

  it("never throws and still produces a file for empty content (title-only)", async () => {
    const r = await renderDoc({ format: "md", title: "Only A Title", content: [] });
    expect(r.ext).toBe("md");
    expect(dec(r.bytes)).toContain("# Only A Title");
  });

  it("markdown output carries no forged trust markers by construction (it is the words, not a doc dressed up)", async () => {
    const r = await renderDoc({ format: "md", title: "T", content: [{ type: "paragraph", text: "plain" }] });
    expect(dec(r.bytes)).not.toContain("=== TENANT KNOWLEDGE ===");
  });
});

describe("doc-render binary-format guards (source contract — pdf/pptx use npm libs, PROOF-OWED)", () => {
  const SRC = readFileSync("supabase/functions/_shared/doc-render.ts", "utf8");

  it("PDF fails closed on non-WinAnsi content instead of shipping a `?`-corrupted file reported as success (§13/H1)", () => {
    // pdf-lib StandardFonts are Latin-only; a Cyrillic/CJK/Arabic doc would render `?`. The guard measures
    // the loss via the ONE sanitizer and degrades to needs_config so the caller reports honestly.
    expect(SRC).toContain("function winAnsiLoss");
    expect(SRC).toContain("winAnsiLoss(sample) / nonWs");
    expect(SRC).toContain('"doc-render:pdf-charset"');
    // Codex round-7 I2 — EVERY non-empty doc is checked (no `>= 8` floor exemption); short docs use a
    // majority threshold so a title-only Cyrillic doc still fails closed, one emoji in short English doesn't.
    expect(SRC).toContain("nonWs > 0");
    expect(SRC).toContain("nonWs >= 8 ? 0.15 : 0.5");
  });

  it("PPTX heads orphan content with a neutral 'Overview', never the doc title; nothing but the title rides the title slide (H4/I1/J2)", () => {
    // Codex round-8 J2 — the round-7 `lead → title slide` approach mis-classified intro prose and a first
    // section's kicker as cover copy. The fix drops lead entirely: orphan content opens an "Overview"
    // section, and the title slide carries the title ONLY, so no guess about cover metadata is needed.
    expect(SRC).toContain('{ heading: "Overview", body: [] }');
    expect(SRC).not.toContain('{ heading: title || "Overview", body: [] }'); // the duplicate-title default is gone
    expect(SRC).not.toContain("const lead: string[]");                        // no title-slide lead routing at all
    expect(SRC).not.toContain("sawHeading");
  });

  it("PPTX does not double-mark a pre-numbered list entry — bullets only un-numbered lines (Codex round-12f)", () => {
    // An ordered-list body line is already prefixed "1. …", so it must NOT also get a bullet or the slide
    // renders "• 1. First". The render guards the bullet on a leading number prefix; no unconditional bullet.
    expect(SRC).toContain("/^\\d+[.)]\\s/.test(t)");
    expect(SRC).not.toContain("options: { bullet: true }");
  });

  it("inline markdown protects code spans + link URLs before the emphasis passes (H2/H3)", () => {
    expect(SRC).toContain("@@CODE");
    expect(SRC).toContain("@@URL");
    expect(SRC).toContain("restore code verbatim");
  });

  it("Codex round-9 — kicker folded into the heading (K1), euro kept in WinAnsi (K2), md keeps raw markdown (K3)", () => {
    // K1 — a section/chapter kicker is part of the single heading block, not a separate pre-heading paragraph
    // that would attach to the previous pptx slide.
    expect(SRC).toContain("function headingWithKicker");
    expect(SRC).not.toContain("push(asText(b.kicker));"); // the old standalone-kicker paragraph is gone
    // K2 — the CP1252 euro (and other WinAnsi specials) are KEPT by sanitizeWinAnsi, not dropped to `?`.
    expect(SRC).toContain("\\u20AC");                     // euro is in the keep set
    // K3/L2 — flattening is threaded by format; md passes prose RAW markdown through verbatim (Codex L2 —
    // parsing it would collapse code fences/tables), binary parses + flattens (can't render markdown).
    expect(SRC).toContain("flattenInline");
    expect(SRC).toContain('String(input?.format).toLowerCase() !== "md"');
    expect(SRC).toContain("if (!flattenInline)");
    expect(SRC).toContain('out.push({ type: "paragraph", text: md })'); // md raw passthrough
  });
});

describe("export-document edge function — the callable seam (source contract)", () => {
  const SRC = readFileSync("supabase/functions/export-document/index.ts", "utf8");

  it("renders through the ONE doc-render lane + records via the service-role Rail recorder (§18)", () => {
    expect(SRC).toContain('import { callModel } from "../_shared/model-router.ts"');
    expect(SRC).toContain('import { recordCapabilityRun } from "../_shared/capability-record.ts"');
    expect(SRC).toContain('await callModel(');
    expect(SRC).toContain('"doc-render"');
  });

  it("authorizes ENTIRELY by tenant-scoped role (owner/admin) or operator — no coarse global gate (§9/§59/§70 source contract)", () => {
    expect(SRC).toContain('authed.auth.getUser()');
    // Codex round-8 J1 (§70) — the coarse `admin|coach` GLOBAL gate is GONE: it 403'd a freshly-provisioned
    // Solo owner (global role only `user`; authority is an owner membership is_tenant_admin recognizes)
    // before the tenant check ran, so they couldn't export their OWN document. Authorization is the
    // tenant-scoped check (below) or the operator role — nothing else.
    expect(SRC).not.toContain('"admin" || r === "super_admin" || r === "platform_admin" || r === "coach"');
    expect(SRC).not.toContain("Admin or coach access required.");
    expect(SRC).toContain('.from("marketing_content")');
    // the tenant the file is filed under is the row's tenant, never the request body
    expect(SRC).toContain("const tenantId = doc.tenant_id as string | null");
    expect(SRC).not.toContain("body?.tenant_id");
    expect(SRC).toContain('roles.some((r: string) => r === "super_admin" || r === "platform_admin")');
    // Codex round-10 L1 (§59) — marketing_content RLS refuses a fresh Solo OWNER (global role only `user`)
    // AND a platform_admin, so the row is read with the SERVICE-ROLE client (a privileged read) and the
    // tenant-scoped check below is the ONLY access decision. Reading via `authed` would 404 the owner.
    expect(SRC).toContain("await service");
    expect(SRC).not.toContain("const reader = isOperator ? service : authed");
    // Codex F2 / §59 global-role trap — the in-body gate requires a MANAGE role IN THE DOC'S TENANT
    // (owner/admin via is_tenant_admin), tenant-scoped — never is_tenant_member. The retired coach seat
    // grants nothing.
    expect(SRC).toContain('authed.rpc("is_tenant_admin", { _tenant: tenantId })');
    expect(SRC).not.toContain('_role: "coach"');
    expect(SRC).not.toContain('.rpc("is_tenant_member"'); // the any-role membership CALL was the F2 leak (a comment may still name it)
    // L1 — the privileged read means the auth failure must fail closed as a 404 (not 403), so a by-id caller
    // can't learn that an out-of-scope document exists.
    expect(SRC).not.toContain("You don't have manage access to that document's workspace.");
    // HONEST SCOPE (§32.c): this is a SOURCE contract that the in-body gate exists — a true multi-tenant
    // RLS/role drive proving the IDOR is closed needs a live DB and is owed to the authenticated post-deploy pass.
  });

  it("authorizes BEFORE any kind/tenant-shape response — the by-id endpoint is not a cross-tenant existence oracle (Codex round-11 M1/§9)", () => {
    // The service-role read can see EVERY tenant's row, so a `kind !== "document"` 400 or a null-tenant 422
    // emitted before the tenant-scoped authorization would let an authenticated caller probe another tenant's
    // marketing_content UUID and learn from the status code which rows exist and what kind they are. The
    // authorization branch must come FIRST — every kind/tenant response is reachable only by an authorized
    // caller. Assert the ordering positionally in the source.
    const authAt = SRC.indexOf('authed.rpc("is_tenant_admin"');
    const kindAt = SRC.indexOf('doc.kind !== "document"');
    const nullTenantAt = SRC.indexOf("has no workspace and cannot be exported");
    expect(authAt).toBeGreaterThan(-1);
    expect(kindAt).toBeGreaterThan(-1);
    expect(nullTenantAt).toBeGreaterThan(-1);
    expect(authAt).toBeLessThan(kindAt);          // authorize precedes the kind 400
    expect(authAt).toBeLessThan(nullTenantAt);    // authorize precedes the null-tenant 422
    // tenantId is resolved before the authorize block (the RPCs are keyed on it; a null tenant → both false → 404)
    expect(SRC.indexOf("const documentTenantId = doc.tenant_id")).toBeLessThan(authAt);
  });

  it("offers only the renderer's real formats and degrades honestly, never a fake link (§13)", () => {
    expect(SRC).toContain('new Set(["pdf", "docx", "pptx", "md"])');
    expect(SRC).toContain("rendered?.needs_config");
    expect(SRC).toContain('record("capability_succeeded")');
    expect(SRC).toContain('record("capability_failed")');
    expect(SRC).toContain('record("capability_outcome_unknown")');
    expect(SRC).toContain('capabilityKey: "document_export"');
  });

  it("records needs_config as a deterministic FAILED non-effect + header describes the privileged-read model (Codex round-12e)", () => {
    // O — needs_config is a pre-persistence deterministic non-effect (renderer lib missing / charset reject),
    // so it records capability_failed, NEVER capability_outcome_unknown (whose Rail copy says 'may have taken
    // effect' and prompts a needless check). Slice exactly the needs_config block (up to the next `const url`).
    const ncStart = SRC.indexOf("rendered?.needs_config");
    const ncBlock = SRC.slice(ncStart, SRC.indexOf("const url", ncStart));
    expect(ncBlock).toContain('record("capability_failed")');
    expect(ncBlock).not.toContain('record("capability_outcome_unknown")');
    // outcome_unknown survives ONLY for the genuinely-ambiguous "rendered but no URL" case.
    expect(SRC).toContain('record("capability_outcome_unknown")');
    // N — the file header describes the SERVICE-ROLE + in-body model, not the stale caller-JWT/RLS one.
    expect(SRC).toContain("read with the SERVICE-ROLE client");
    expect(SRC).not.toContain("read with the CALLER's JWT client, so RLS scopes");
  });
});

describe("document_generate keeps optional export outside durable authoring (source contract)", () => {
  const CHAT = readFileSync("supabase/functions/paige-ai-chat/index.ts", "utf8");
  const WORKER = readFileSync("supabase/functions/paige-document-worker/index.ts", "utf8");

  it("does not promise an export that lacks its own durable reconciliation path", () => {
    const tool = CHAT.slice(CHAT.indexOf('name: "document_generate"'), CHAT.indexOf('name: "growth_list"'));
    expect(tool).not.toContain("export_format");
    expect(WORKER).not.toContain("/functions/v1/export-document");
    expect(WORKER).not.toContain("attach_paige_document_export");
  });
});