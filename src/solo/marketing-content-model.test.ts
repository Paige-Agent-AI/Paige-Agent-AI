import { describe, expect, it } from "vitest";
import { channelCounts, contentKindOf, copyParts, documentCover, downloadName, kindCounts, pieceKind, plainCopy, safeMediaUrl, shapeLabel, shortTitle } from "./marketing-content-model";
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
    expect(downloadName({ kind: "image", title: "Spring hero: final!", image_url: "https://x/y/hero.JPG?v=2" })).toBe("spring-hero-final.jpg");
    expect(downloadName({ kind: "image", title: null, image_url: "https://x/y/z" })).toBe("untitled.png");
    expect(downloadName({ kind: "video", title: "Promo", image_url: "https://x/y/promo.mp4" })).toBe("promo.mp4");
  });

  it("uses a stored media address only when it is https or this site", () => {
    expect(safeMediaUrl("https://x.supabase.co/storage/v1/object/public/a.png")).toBe("https://x.supabase.co/storage/v1/object/public/a.png");
    expect(safeMediaUrl("/samples/hero.svg")).toBe("/samples/hero.svg");
    expect([safeMediaUrl("javascript:alert(1)"), safeMediaUrl("data:image/png;base64,AA"), safeMediaUrl("http://x/a.png"), safeMediaUrl("//evil/a.png"), safeMediaUrl("  "), safeMediaUrl(null)]).toEqual([null, null, null, null, null, null]);
  });

  it("splits copy into its lead line and the rest, and counts copy by channel", () => {
    expect(copyParts("Subject: Two days to go\n\nSee you.", "email_campaign")).toEqual({ lead: "Two days to go", rest: "See you." });
    expect(copyParts("Subject: not an email", "social_post")).toEqual({ lead: null, rest: "Subject: not an email" });
    expect(copyParts("## **Big** news\nBody", "social_post")).toEqual({ lead: "Big news", rest: "Body" });
    expect(channelCounts([{ kind: "text", channel: "ad_copy" }, { kind: "text", channel: "ad_copy" }, { kind: "text", channel: "email_campaign" }, { kind: "image", channel: null }])).toEqual([{ label: "Ad copy", count: 2 }, { label: "Email", count: 1 }]);
  });
});
