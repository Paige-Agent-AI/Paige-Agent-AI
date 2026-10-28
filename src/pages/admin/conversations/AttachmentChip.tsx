// Staged-attachment chip — the ONE composer chip (§18), shared by the reply composer and
// the compose-new modal. Object-path only (private bucket): images preview via a short-lived
// signed URL; everything else shows a paperclip. Remove drops the staged entry (the caller's
// removeAttachment also deletes the object). Token-only, gold-free, motion-safe (§11).
import { useEffect, useState } from "react";
import { Paperclip, ImageIcon, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { type Attachment, COMMS_ATTACH_BUCKET, isImageMime } from "./inbox-shared";

export function AttachmentChip({ a, onRemove, disabled = false }: { a: Attachment; onRemove: () => void; disabled?: boolean }) {
  const [preview, setPreview] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    if (isImageMime(a.mime) && a.url) {
      supabase.storage
        .from(COMMS_ATTACH_BUCKET)
        .createSignedUrl(a.url, 300)
        .then(({ data }) => { if (alive) setPreview(data?.signedUrl ?? null); });
    }
    return () => { alive = false; };
  }, [a.url, a.mime]);
  return (
    <span className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-2 py-1 text-[11px] text-foreground">
      {preview ? (
        <img src={preview} alt="" className="h-5 w-5 rounded object-cover" />
      ) : isImageMime(a.mime) ? (
        <ImageIcon className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
      ) : (
        <Paperclip className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
      )}
      <span className="max-w-[140px] truncate">{a.name || "attachment"}</span>
      <button
        type="button"
        onClick={() => { if (!disabled) onRemove(); }}
        disabled={disabled}
        className="rounded p-0.5 text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))] disabled:cursor-not-allowed disabled:opacity-50"
        aria-label={`Remove ${a.name || "attachment"}`}
      >
        <X className="h-3 w-3" />
      </button>
    </span>
  );
}
