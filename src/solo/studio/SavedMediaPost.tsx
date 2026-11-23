import React from "react";
import { supabase } from "@/integrations/supabase/client";
import { useTenantContext } from "@/hooks/useTenantContext";
import { type ContentPiece, safeMediaUrl } from "../marketing-content-model";
import { PublishPiece } from "../publish-piece";
import type { StudioSavedMediaHandoff } from "./saved-media-handoff";

const unavailable = "This saved media couldn’t be opened for a post. Return to Content and check the original file.";
const maxBytes = 25 * 1024 * 1024;
type VerifiedSource = { piece: ContentPiece; url: string; contentType: string; size: number; sha256: string };

function readSource(input: unknown, asset: StudioSavedMediaHandoff): VerifiedSource | null {
  if (!input || typeof input !== "object") return null;
  const result = input as { ok?: unknown; tenant_id?: unknown; piece?: Partial<ContentPiece>;
    media?: { content_type?: unknown; size?: unknown; sha256?: unknown } };
  const { piece, media } = result;
  if (result.ok !== true || result.tenant_id !== asset.expectedTenantId || !piece
    || piece.id !== asset.id || piece.kind !== asset.kind || typeof piece.status !== "string"
    || typeof piece.updated_at !== "string" || !Number.isFinite(Date.parse(piece.updated_at))) return null;
  const allowedTypes = asset.kind === "video" ? ["video/mp4"] : ["image/png", "image/jpeg"];
  if (!media || typeof media.content_type !== "string" || !allowedTypes.includes(media.content_type)
    || typeof media.size !== "number" || !Number.isSafeInteger(media.size) || media.size <= 0 || media.size > maxBytes
    || typeof media.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(media.sha256)) return null;
  const url = typeof piece.image_url === "string" ? safeMediaUrl(piece.image_url) : null;
  if (!url) return null;
  return {
    url, contentType: media.content_type, size: media.size, sha256: media.sha256,
    piece: { id: asset.id, kind: asset.kind, status: piece.status, updated_at: piece.updated_at,
      title: typeof piece.title === "string" ? piece.title : null,
      body: typeof piece.body === "string" ? piece.body : null,
      channel: null, image_url: url, size: null, brief: null },
  };
}

async function downloadVerifiedSource(source: VerifiedSource, signal: AbortSignal): Promise<Blob | null> {
  // The Storage path can change without changing the library row. Render only the bytes the Edge verified.
  const response = await fetch(source.url, { signal, cache: "no-store", credentials: "omit", redirect: "error" });
  if (!response.ok || !response.body) return null;
  const reader = response.body.getReader();
  const bytes = new Uint8Array(source.size);
  let offset = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (value.length > bytes.length - offset) return null;
      bytes.set(value, offset);
      offset += value.length;
    }
  } finally {
    void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  if (offset !== bytes.length) return null;
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const sha256 = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  return sha256 === source.sha256 ? new Blob([bytes], { type: source.contentType }) : null;
}

export function SavedMediaPost({ asset, onBack }: { asset: StudioSavedMediaHandoff; onBack: () => void }) {
  const { activeTenantId, activeUserId, loading, accountContextLoading } = useTenantContext();
  const pending = loading || accountContextLoading;
  const matches = Boolean(activeUserId && activeTenantId === asset.expectedTenantId);
  return (
    <section className="vs-saved-media" data-vibe-scroll-owner aria-labelledby="vs-saved-media-title">
      <header className="vs-saved-media-header">
        <button type="button" className="vs-btn" data-studio-handoff-back onClick={onBack}>Back to Content</button>
        <h1 id="vs-saved-media-title">Social post</h1>
      </header>
      {pending ? <p role="status">Checking the active workspace…</p>
        : matches ? <VerifiedMediaPost key={`${activeUserId}:${asset.expectedTenantId}:${asset.kind}:${asset.id}`} asset={asset} />
          : <p className="vs-alert" role="alert">The active workspace changed. Reopen the file from Content.</p>}
    </section>
  );
}

function VerifiedMediaPost({ asset }: { asset: StudioSavedMediaHandoff }) {
  const [result, setResult] = React.useState<{ piece: ContentPiece; previewUrl: string } | null | undefined>(undefined);
  const { expectedTenantId, id, kind } = asset;
  React.useEffect(() => {
    let current = true;
    let previewUrl: string | null = null;
    const controller = new AbortController();
    const load = async () => {
      try {
        const { data, error } = await supabase.functions.invoke("social-publish-command", {
          signal: controller.signal,
          body: { action: "preview_media", expected_tenant_id: expectedTenantId, content_id: id, kind },
        });
        if (!current) return;
        const source = error ? null : readSource(data, asset);
        if (!source) { setResult(null); return; }
        const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]);
        const file = await downloadVerifiedSource(source, signal);
        if (!current) return;
        if (!file) { setResult(null); return; }
        previewUrl = URL.createObjectURL(file);
        setResult({ piece: source.piece, previewUrl });
      } catch {
        if (current) setResult(null);
      }
    };
    void load();
    return () => {
      current = false;
      controller.abort();
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [asset, expectedTenantId, id, kind]);

  if (result === undefined) return <p role="status">Checking the original saved file…</p>;
  if (!result) return <p className="vs-alert" role="alert">{unavailable}</p>;
  const { piece, previewUrl } = result;
  const title = piece.title?.trim() || (kind === "image" ? "Saved image" : "Saved video");
  return <div className="vs-saved-media-post">
    <figure>
      {kind === "image"
        ? <img src={previewUrl} alt={title} onError={() => setResult(null)} />
        : <video src={previewUrl} controls playsInline preload="metadata" tabIndex={0} aria-label={title} onError={() => setResult(null)} />}
      <figcaption>{title}</figcaption>
    </figure>
    <PublishPiece tenantId={expectedTenantId} piece={piece} />
  </div>;
}
