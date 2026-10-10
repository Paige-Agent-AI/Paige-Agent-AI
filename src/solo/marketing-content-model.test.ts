import { describe, expect, it } from "vitest";
import { contentKindOf, documentCover, downloadName, kindCounts, pieceKind, plainCopy, shapeLabel, shortTitle } from "./marketing-content-model";
import { parseStudioDocument } from "@/components/admin/studio/studio-document";

describe("Marketing › Content model", () => {
  it("cuts a long title at a word and says it was cut; keeps a short one whole", () => {
    expect(shortTitle("Spring hero")).toEqual({ text: "Spring hero", cut: false });
    expect(shortTitle("  ")).toEqual({ text: "Untitled", cut: false });
    expect(shortTitle("First line\nSecond line")).toEqual({ text: "First line", cut: true });
    const long = shortTitle("Professional business formation stage. Confident entrepreneur at a desk reviewing documents with a calm, focused expression", 60);
    expect(long.cut).toBe(true);
    expect(long.text).toBe("Professional business formation stage. Confident…");
  });

  it("names image shapes from either a ratio or a word, and leaves an unknown one as written", () => {
    expect([shapeLabel("1:1"), shapeLabel("square"), shapeLabel("3:2"), shapeLabel("portrait"), shapeLabel("7:5"), shapeLabel(null)]).toEqual(["Square", "Square", "Landscape", "Portrait", "7:5", null]);
  });

  it("reads saved copy as plain words without markdown, keeping its lines", () => {
    expect(plainCopy("## Title\n**Bold** and *soft* and __strong__\n- one\n• two\n\n\n\nend")).toBe("Title\nBold and soft and strong\none\ntwo\n\nend");
    expect(plainCopy("2 * 3 = 6 and file_name_here")).toBe("2 * 3 = 6 and file_name_here");
    expect(plainCopy(null)).toBe("");
  });

  it("draws a document's cover from its cover block, else its first heading, and counts sections", () => {
    const withCover = parseStudioDocument("d1", "Offer", JSON.stringify({ docType: "proposal", blocks: [{ type: "cover", title: "Plan", eyebrow: "For you" }, { type: "chapter-divider", title: "One" }, { type: "section-header", title: "Two" }] }));
    expect(documentCover(withCover)).toEqual({ eyebrow: "For you", title: "Plan", subhead: null, sections: 2, type: "Proposal" });
    const noCover = parseStudioDocument("d2", "Guide", JSON.stringify({ docType: "unknown", blocks: [{ type: "section-header", title: "Start here" }, { type: "prose", markdown: "x" }] }));
    expect(documentCover(noCover)).toEqual({ eyebrow: null, title: "Start here", subhead: null, sections: 1, type: "Guide" });
    expect(documentCover(parseStudioDocument("d3", "x", "{bad"))).toBeNull();
  });

  it("sorts pieces into four kinds and counts only the ones present", () => {
    expect([pieceKind({ kind: "image" }), pieceKind({ kind: "document" }), pieceKind({ kind: "text" }), pieceKind({ kind: "video" })]).toEqual(["image", "document", "copy", "video"]);
    expect(kindCounts([{ kind: "text" }, { kind: "image" }, { kind: "image" }])).toEqual([{ key: "image", count: 2 }, { key: "copy", count: 1 }]);
    expect([contentKindOf("document"), contentKindOf("nope"), contentKindOf(null)]).toEqual(["document", "all", "all"]);
  });

  it("names a download from its title and its address's extension", () => {
    expect(downloadName({ title: "Spring hero: final!", image_url: "https://x/y/hero.JPG?v=2" })).toBe("spring-hero-final.jpg");
    expect(downloadName({ title: null, image_url: "https://x/y/z" })).toBe("untitled.png");
  });
});
