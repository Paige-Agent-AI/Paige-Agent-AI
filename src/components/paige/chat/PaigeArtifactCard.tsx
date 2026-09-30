// #29/#104 — the shared "Paige made you a deliverable" handoff card. When Paige finishes a create tool
// in a non-Studio chat surface, the edge function streams an artifact frame ({ kind, id, title, url,
// artifactType }); this card is how that frame renders under her message — a compact, premium card (the
// Cowork "Created a file" bar) carrying a REAL thumbnail, the title + type, an Open that actually renders
// the artifact, and a host-delegated Send.
//
// WIRED TODAY (§13 honest — do not assume more): only PaigeAIChat (the dashboard admin/coach chat) renders
// this card. The prior plan to also render it in a FLOATING platform chat is RETIRED (owner decision
// 2026-09-06): there is no floating Paige chat anywhere in the authenticated platform, and FloatingChatbot
// was deleted. The card belongs to the DEDICATED Paige experience only. Extending it to ANOTHER dedicated
// surface (e.g. the dedicated BrokerPaigeSession page) would require that surface's backend to emit the
// `paige_artifact` frame first — `broker-paige-chat` re-emits only `{ delta }` and never emits the frame
// today — so it is a separate, backend-first future item, not a client-side insert. The client portal
// (PaigeChat) needs no wiring: document/image tools are admin/coach-gated, so it never emits a frame.
// StudioChat is unaffected — it consumes its own studioSessionId frame onto the canvas.
// UI delivery evidence: docs/evidence/ui-delivery/retire-floating-platform-chat.md
//
// ONE home (§18): this is the single artifact-handoff card for every regular chat surface. It REUSES
// the Studio renderer — loadDocument() hydrates a document and DocumentPreview draws it (both the full
// Open view and, CSS-scaled, the card thumbnail) — never a forked fetch or a forked block renderer, and
// never a glyph-in-a-box where the real artifact could show (§22 real thumbnails).
//
// §11/§22/§23 discipline:
//   • GOLD is spent on EXACTLY ONE thing — the primary act, Send. The card border, the thumbnail ring,
//     the focus rings, and Open are all neutral/indigo. No gold resting borders, no gold on Open.
//   • Send is host-delegated: the gold button renders ONLY when `onSend` is provided. A surface that
//     hasn't wired sending simply shows no button — never a dead/fake button (§13 no dead ends).
//   • Token-only (zero hardcoded hex), AA in BOTH themes, every animation guarded by useReducedMotion
//     (the hover lift and the skeleton shimmer both freeze under reduced motion).
//   • Honest degrade (§13): a document that won't hydrate falls back to a FileText glyph on the tile and
//     an honest empty state in Open — never a fabricated preview; an image that won't load falls back to
//     an image glyph, never a broken <img>.
import { useEffect, useState, type ReactNode } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { Eye, FileText, Image as ImageIcon, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/page";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { loadDocument } from "@/components/admin/studio/studio";
import { DocumentPreview } from "@/components/admin/studio/DocumentPreview";
import type { StudioDocType, StudioDocument } from "@/components/admin/studio/studio-types";

/** The artifact a chat surface hands to the card — the exact shape of the streamed artifact frame
 *  (kind→artifactType, id, title, url). `url` carries the image src for an image; a document hydrates
 *  from its id via loadDocument, so its url is optional/unused. */
export interface PaigeArtifact {
  id: string;
  title: string;
  url?: string;
  artifactType: "document" | "image";
  /** The exact tenant the row was saved under (stamped on the streamed frame by paige-ai-chat).
   *  The card's document hydrate must scope to THIS tenant, not the viewer's activeTenantId — when
   *  an operator manages another tenant the two diverge and the wrong-tenant query returns 0 rows. */
  tenantId?: string;
}

export interface PaigeArtifactCardProps {
  artifact: PaigeArtifact;
  /** Tenant scope for the RLS-safe document hydrate (§9). */
  tenantId: string;
  /** Host-delegated send. When provided, the gold Send button renders; when omitted, it does not
   *  (never a dead button — §13). Called on click; the card closes its Open dialog if one is open. */
  onSend?: () => void;
  className?: string;
}

const DOC_TYPE_LABEL: Record<StudioDocType, string> = {
  guide: "Guide",
  one_pager: "One-pager",
  ebook: "eBook",
  checklist: "Checklist",
  worksheet: "Worksheet",
  proposal: "Proposal",
  offer_letter: "Offer letter",
  sales_offer: "Sales offer",
  agreement_draft: "Agreement draft",
};

// Thumbnail geometry — the tile is a fixed 80×96px page; the scaled DocumentPreview renders at an
// explicit 800×960 (DocumentPreview is h-full, so the wrapper MUST carry a real height) and is shrunk
// by exactly 0.1 so 800→80 and 960→96 land the page in the tile with the cover leading. Deterministic
// numbers keep the scale exact (no measurement, no jitter).
const THUMB_CONTENT_W = 800;
const THUMB_CONTENT_H = 960;
const THUMB_SCALE = 0.1;

type DocState = "idle" | "loading" | "ready" | "failed";

/** The REAL document thumbnail — a CSS-scaled DocumentPreview (§22: the artifact itself, shrunk, not a
 *  glyph). pointer-events-none so the whole tile stays one click target; overflow-hidden (on the tile)
 *  crops to the page.
 *
 *  print:hidden is LOAD-BEARING (§39/§13): DocumentPreview renders a [data-paige-doc-sheet], and the
 *  global print rule (index.css `html.paige-doc-printing [data-paige-doc-sheet]`) unhides + stacks EVERY
 *  such sheet at the origin. Without this, printing an OPEN document card (or any Studio doc while a card
 *  is mounted) would drag every thumbnail's scaled sheet into the exported PDF — corrupting the #292/#119
 *  export. `display:none` removes the whole thumbnail subtree from print, so only the Open dialog's sheet
 *  (the intended target) prints. */
function DocThumbnail({ document }: { document: StudioDocument }) {
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden bg-card print:hidden" aria-hidden>
      <div
        className="origin-top-left"
        style={{ width: THUMB_CONTENT_W, height: THUMB_CONTENT_H, transform: `scale(${THUMB_SCALE})` }}
      >
        <DocumentPreview document={document} />
      </div>
    </div>
  );
}

/** A centered glyph — the honest fallback when a document won't hydrate or an image won't load (§13).
 *  Neutral/indigo only (muted-foreground), never gold. */
function GlyphTile({ icon: Icon }: { icon: typeof FileText }) {
  return (
    <div className="absolute inset-0 grid place-items-center bg-muted/40" aria-hidden>
      <Icon className="h-6 w-6 text-muted-foreground" />
    </div>
  );
}

export function PaigeArtifactCard({ artifact, tenantId, onSend, className }: PaigeArtifactCardProps) {
  const reduce = useReducedMotion();
  const isDoc = artifact.artifactType === "document";
  const imageUrl = artifact.artifactType === "image" ? artifact.url : undefined;

  const [open, setOpen] = useState(false);

  // Document hydrate (thumbnail + Open share it). loadDocument never throws — it returns null on a gone/
  // corrupt row — but we still catch to be safe and degrade to a glyph/empty (§13). Cancelled on unmount
  // or id change so a late resolve never lands on a stale card.
  const [doc, setDoc] = useState<StudioDocument | null>(null);
  const [docState, setDocState] = useState<DocState>(isDoc ? "loading" : "idle");
  useEffect(() => {
    if (!isDoc) {
      setDoc(null);
      setDocState("idle");
      return;
    }
    let cancelled = false;
    setDoc(null);
    setDocState("loading");
    loadDocument(tenantId, artifact.id)
      .then((d) => {
        if (cancelled) return;
        if (d) {
          setDoc(d);
          setDocState("ready");
        } else {
          setDocState("failed");
        }
      })
      .catch(() => {
        if (!cancelled) setDocState("failed");
      });
    return () => {
      cancelled = true;
    };
  }, [isDoc, tenantId, artifact.id]);

  // Image load state — Skeleton until the pixels arrive, glyph if the src is missing or errors.
  const [imgLoaded, setImgLoaded] = useState(false);
  const [imgFailed, setImgFailed] = useState(false);
  useEffect(() => {
    // Reset when the source changes (a reused card slot).
    setImgLoaded(false);
    setImgFailed(!imageUrl && !isDoc);
  }, [imageUrl, isDoc]);

  const TypeIcon = isDoc ? FileText : ImageIcon;
  const typeLine = isDoc
    ? doc
      ? `Document · ${DOC_TYPE_LABEL[doc.docType]}`
      : "Document"
    : "Image";

  // ── Thumbnail contents by type/state ──
  let thumb: ReactNode;
  if (isDoc) {
    if (docState === "ready" && doc) {
      thumb = <DocThumbnail document={doc} />;
    } else if (docState === "failed") {
      thumb = <GlyphTile icon={FileText} />;
    } else {
      thumb = <Skeleton className="absolute inset-0 rounded-none motion-reduce:animate-none" />;
    }
  } else if (imgFailed || !imageUrl) {
    thumb = <GlyphTile icon={ImageIcon} />;
  } else {
    thumb = (
      <>
        {!imgLoaded && <Skeleton className="absolute inset-0 rounded-none motion-reduce:animate-none" />}
        <img
          src={imageUrl}
          alt=""
          aria-hidden
          className={cn(
            "absolute inset-0 h-full w-full object-cover transition-opacity duration-200 motion-reduce:transition-none",
            !imgLoaded && "opacity-0",
          )}
          onLoad={() => setImgLoaded(true)}
          onError={() => setImgFailed(true)}
        />
      </>
    );
  }

  return (
    <motion.div
      className={cn(
        "w-full max-w-[24rem] overflow-hidden rounded-xl border border-border bg-card shadow-sm transition-shadow hover:shadow-md motion-reduce:transition-none",
        className,
      )}
      whileHover={reduce ? undefined : { y: -2 }}
      transition={{ type: "spring", stiffness: 400, damping: 30 }}
    >
      <div className="flex gap-3 p-3">
        {/* The tile doubles as an Open affordance. Indigo focus ring (never gold, §11). */}
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label={`Open ${artifact.title}`}
          className="relative h-24 w-20 shrink-0 overflow-hidden rounded-lg border border-border bg-muted/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card"
        >
          {thumb}
        </button>

        <div className="flex min-w-0 flex-1 flex-col">
          <p className="truncate text-sm font-medium text-foreground" title={artifact.title}>
            {artifact.title}
          </p>
          <p className="mt-0.5 flex items-center gap-1 text-[11px] text-muted-foreground">
            <TypeIcon className="h-3 w-3 shrink-0" aria-hidden />
            <span className="truncate">{typeLine}</span>
          </p>

          <div className="mt-auto flex items-center gap-2 pt-2.5">
            <Button variant="outline" size="sm" className="h-8 gap-1.5 px-3" onClick={() => setOpen(true)}>
              <Eye className="h-3.5 w-3.5" aria-hidden />
              Open
            </Button>
            {/* GOLD — the single act. Rendered only when the host wired sending (never a dead button). */}
            {onSend && (
              <Button
                variant="gold"
                size="sm"
                className="h-8 gap-1.5 px-3"
                onClick={() => {
                  onSend();
                  setOpen(false);
                }}
              >
                <Send className="h-3.5 w-3.5" aria-hidden />
                Send
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* Open — a real render of the artifact (§13 no dead ends): DocumentPreview for a document, the
          full image for an image. Both degrade to an honest empty state on failure. */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className={cn("gap-0 p-0", isDoc ? "max-w-4xl" : "max-w-3xl")}>
          <DialogHeader className="border-b border-border px-5 py-3 pr-12 text-left">
            <DialogTitle className="truncate text-base">{artifact.title}</DialogTitle>
            <DialogDescription className="flex items-center gap-1 text-xs">
              <TypeIcon className="h-3 w-3 shrink-0" aria-hidden />
              {typeLine}
            </DialogDescription>
          </DialogHeader>

          {isDoc ? (
            docState === "ready" && doc ? (
              // DocumentPreview owns its own scroll/print; give it a real height to fill.
              <div className="h-[72vh]">
                <DocumentPreview document={doc} />
              </div>
            ) : docState === "loading" ? (
              <div className="space-y-4 p-6">
                <Skeleton className="h-40 w-full motion-reduce:animate-none" />
                <Skeleton className="h-4 w-2/3 motion-reduce:animate-none" />
                <Skeleton className="h-4 w-1/2 motion-reduce:animate-none" />
              </div>
            ) : (
              <div className="p-10">
                <EmptyState
                  icon={FileText}
                  tone="brand"
                  title="Preview unavailable"
                  description="This document is filed to the project. Ask Paige to rebuild it and it appears here."
                />
              </div>
            )
          ) : imgFailed || !imageUrl ? (
            <div className="p-10">
              <EmptyState
                icon={ImageIcon}
                title="Image unavailable"
                description="This image is filed to the project, but it can’t be loaded right now."
              />
            </div>
          ) : (
            <div className="grid max-h-[78vh] place-items-center overflow-auto p-4">
              <img
                src={imageUrl}
                alt={artifact.title}
                className="max-h-[70vh] w-auto max-w-full rounded-lg object-contain"
                onError={() => setImgFailed(true)}
              />
            </div>
          )}

          {onSend && (
            <DialogFooter className="border-t border-border px-5 py-3">
              <Button
                variant="gold"
                className="gap-1.5"
                onClick={() => {
                  onSend();
                  setOpen(false);
                }}
              >
                <Send className="h-4 w-4" aria-hidden />
                Send
              </Button>
            </DialogFooter>
          )}
        </DialogContent>
      </Dialog>
    </motion.div>
  );
}

export default PaigeArtifactCard;
