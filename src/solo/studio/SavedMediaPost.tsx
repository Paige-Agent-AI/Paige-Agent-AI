import React from "react";
import { supabase } from "@/integrations/supabase/client";
import { useTenantContext } from "@/hooks/useTenantContext";
import { type ContentPiece, safeMediaUrl } from "../marketing-content-model";
import { PublishPiece } from "../publish-piece";
import type { StudioSavedMediaHandoff } from "./saved-media-handoff";

const unavailable = "This saved media couldn’t be opened for a post. Return to Content and check the original file.";

function readPiece(input: unknown, asset: StudioSavedMediaHandoff): ContentPiece | null {
  if (!input || typeof input !== "object") return null;
  const result = input as { ok?: unknown; tenant_id?: unknown; piece?: Partial<ContentPiece> };
  const piece = result.piece;
  if (result.ok !== true || result.tenant_id !== asset.expectedTenantId || !piece
    || piece.id !== asset.id || piece.kind !== asset.kind || typeof piece.status !== "string"
    || typeof piece.updated_at !== "string" || !Number.isFinite(Date.parse(piece.updated_at))) return null;
  const url = safeMediaUrl(piece.image_url);
  if (!url) return null;
  return { id: asset.id, kind: asset.kind, status: piece.status, updated_at: piece.updated_at,
    title: typeof piece.title === "string" ? piece.title : null,
    body: typeof piece.body === "string" ? piece.body : null,
    channel: null, image_url: url, size: null, brief: null };
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
  const [result, setResult] = React.useState<ContentPiece | null | undefined>(undefined);
  const { expectedTenantId, id, kind } = asset;
  React.useEffect(() => {
    let current = true;
    const load = async () => {
      try {
        const { data, error } = await supabase.functions.invoke("social-publish-command", { body: {
          action: "preview_media", expected_tenant_id: expectedTenantId, content_id: id, kind,
        } });
        if (current) setResult(error ? null : readPiece(data, asset));
      } catch {
        if (current) setResult(null);
      }
    };
    void load();
    return () => { current = false; };
  }, [asset, expectedTenantId, id, kind]);

  if (result === undefined) return <p role="status">Checking the original saved file…</p>;
  if (!result || !result.image_url) return <p className="vs-alert" role="alert">{unavailable}</p>;
  const title = result.title?.trim() || (kind === "image" ? "Saved image" : "Saved video");
  return <div className="vs-saved-media-post">
    <figure>
      {kind === "image"
        ? <img src={result.image_url} alt={title} onError={() => setResult(null)} />
        : <video src={result.image_url} controls playsInline preload="metadata" tabIndex={0} aria-label={title} onError={() => setResult(null)} />}
      <figcaption>{title}</figcaption>
    </figure>
    <PublishPiece tenantId={expectedTenantId} piece={result} />
  </div>;
}
