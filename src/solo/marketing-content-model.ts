// Marketing › Content (INT-342 S1e, owner ask 2026-10-10: "before Campaigns we need to reimagine Content").
//
// The saved library (marketing_content, not archived) as a visual gallery: each piece is drawn from what
// it really is. An image shows its own picture (image_url, a public storage address), a document its own
// cover (the cover block of its structured body, the same body the Studio canvas renders), saved copy its
// own words. Nothing is invented: a piece with no picture or cover says so.
import { parseStudioDocument } from "@/components/admin/studio/studio-document";
import { STUDIO_DOC_TYPE_LABEL, type StudioDocument } from "@/components/admin/studio/studio-types";

export type ContentPiece = {
  id: string;
  kind: string;
  channel: string | null;
  status: string;
  title: string | null;
  body: string | null;
  image_url: string | null;
  size: string | null;
  brief: string | null;
  updated_at: string;
};

/** The four kinds the library holds. Copy is anything that isn't an image, a video or a document. */
export type PieceKind = "image" | "video" | "document" | "copy";
export const CONTENT_KINDS = [
  { key: "all", label: "All" },
  { key: "image", label: "Images" },
  { key: "document", label: "Documents" },
  { key: "copy", label: "Copy" },
  { key: "video", label: "Video" },
] as const;
export type ContentKindFilter = (typeof CONTENT_KINDS)[number]["key"];
export const contentKindOf = (value: string | null | undefined): ContentKindFilter =>
  CONTENT_KINDS.find((kind) => kind.key === value)?.key ?? "all";

export const pieceKind = (piece: Pick<ContentPiece, "kind">): PieceKind =>
  piece.kind === "image" || piece.kind === "video" || piece.kind === "document" ? piece.kind : "copy";

const CHANNEL_LABEL: Record<string, string> = {
  social_post: "Social post", ad_copy: "Ad copy", email_campaign: "Email", caption: "Caption", blog_outline: "Blog outline", sms_broadcast: "Text message",
};
const KIND_NOUN: Record<PieceKind, [string, string]> = {
  image: ["image", "images"], video: ["video", "videos"], document: ["document", "documents"], copy: ["piece of copy", "pieces of copy"],
};
export const kindNoun = (kind: PieceKind, count: number) => KIND_NOUN[kind][count === 1 ? 0 : 1];

/** What a piece is, in words: "Image", "Document · Sales offer", "Social post". */
export function pieceLabel(piece: Pick<ContentPiece, "kind" | "channel">, doc?: StudioDocument | null): string {
  const kind = pieceKind(piece);
  if (kind === "image") return "Image";
  if (kind === "video") return "Video";
  if (kind === "document") return doc ? `Document · ${STUDIO_DOC_TYPE_LABEL[doc.docType]}` : "Document";
  return (piece.channel && CHANNEL_LABEL[piece.channel]) || "Copy";
}

// Image shapes as the generators record them: a ratio ("1:1", "3:2") or a word ("square", "landscape").
const SHAPE: Record<string, string> = { "1:1": "Square", square: "Square", landscape: "Landscape", portrait: "Portrait", "16:9": "Wide", "9:16": "Tall", "4:5": "Portrait", "3:2": "Landscape", "2:3": "Portrait", "4:3": "Landscape", "3:4": "Portrait" };
export const shapeLabel = (size: string | null | undefined) => (size ? SHAPE[size.trim().toLowerCase()] ?? size : null);

/** A one-line title for a card. An image's title is usually the request PAIGE was given, so it is cut at
 *  its first line and at a word boundary; `full` says whether anything was cut. */
export function shortTitle(title: string | null | undefined, max = 90): { text: string; cut: boolean } {
  const raw = (title ?? "").trim();
  if (!raw) return { text: "Untitled", cut: false };
  const line = raw.split("\n")[0].trim();
  if (line.length <= max) return { text: line, cut: line !== raw };
  const head = line.slice(0, max);
  const at = head.lastIndexOf(" ");
  return { text: `${(at > max * 0.6 ? head.slice(0, at) : head).replace(/[\s,.;:–—-]+$/, "")}…`, cut: true };
}

/** A document's cover as its body draws it: the cover block if there is one, else its first heading. */
export type DocCover = { eyebrow: string | null; title: string; subhead: string | null; sections: number; type: string };
export function documentCover(doc: StudioDocument | null): DocCover | null {
  if (!doc) return null;
  const cover = doc.blocks.find((block) => block.type === "cover") as { eyebrow?: unknown; title?: unknown; subhead?: unknown } | undefined;
  const heading = doc.blocks.find((block) => block.type === "section-header" || block.type === "chapter-divider") as { title?: unknown } | undefined;
  const text = (value: unknown) => (typeof value === "string" && value.trim() ? value.trim() : null);
  return {
    eyebrow: text(cover?.eyebrow),
    title: text(cover?.title) ?? text(heading?.title) ?? doc.title,
    subhead: text(cover?.subhead),
    sections: doc.blocks.filter((block) => block.type === "section-header" || block.type === "chapter-divider").length,
    type: STUDIO_DOC_TYPE_LABEL[doc.docType],
  };
}

export const parsePieceDocument = (piece: ContentPiece) =>
  pieceKind(piece) === "document" ? parseStudioDocument(piece.id, piece.title, piece.body) : null;

/** Saved copy as plain words: markdown emphasis, heading marks and list bullets dropped, lines kept. */
export function plainCopy(body: string | null | undefined): string {
  return (body ?? "")
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => line.replace(/^\s*#+\s*/, "").replace(/^\s*[-*•]\s+/, "").replace(/(\*\*|__)(.+?)\1/g, "$2").replace(/(^|\W)[*_](\S.*?\S|\S)[*_](?=\W|$)/g, "$1$2").trimEnd())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** How many of each kind, in the order the filter shows them; kinds with none are left out. */
export function kindCounts(pieces: readonly Pick<ContentPiece, "kind">[]): { key: PieceKind; count: number }[] {
  const counts: Record<PieceKind, number> = { image: 0, document: 0, copy: 0, video: 0 };
  for (const piece of pieces) counts[pieceKind(piece)] += 1;
  return (["image", "document", "copy", "video"] as PieceKind[]).map((key) => ({ key, count: counts[key] })).filter((row) => row.count > 0);
}

/** A file name for a downloaded image: its short title and the extension its address carries. */
export function downloadName(piece: Pick<ContentPiece, "title" | "image_url">): string {
  const base = shortTitle(piece.title, 48).text.replace(/…$/, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "image";
  const ext = /\.(png|jpe?g|webp|gif)(?:\?|$)/i.exec(piece.image_url ?? "")?.[1]?.toLowerCase() ?? "png";
  return `${base}.${ext}`;
}
