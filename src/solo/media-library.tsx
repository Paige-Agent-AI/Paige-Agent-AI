// Marketing › Content › Videos (EXP07 media-library slice 3 — the tenant video library's surface).
//
// The customer outcome: the owner uploads a webinar/recording ONCE, watches it play, keeps or
// removes it — everything else (the provider slot, the one-time upload URL, the lifecycle) is
// the governed doors' job, never this file's. Every state here mirrors what the doors and the
// library rows actually said: uploading/processing say so honestly, ready plays, failed says
// the provider refused, outcome-unknown says it may exist and blocks re-registration, revoked
// is gone from the list. Nothing invented, nothing hidden.
//
// Reads: tenant_media_asset_list (member read, the same CONTENT-family authority the pieces
//        library uses). Writes: ONLY through stream-media-command (register/status/revoke).
import React from "react";
import { supabase } from "@/integrations/supabase/client";
import { readFunctionErrorBody } from "@/lib/integrations/connectError";
import "./marketing-overview.css";

export type MediaAsset = {
  id: string;
  title: string;
  kind: string;
  stream_uid: string;
  status: string;
  duration_seconds: number | null;
  created_at: string;
};

const STATUS_COPY: Record<string, string> = {
  uploading: "Waiting for the upload…",
  processing: "Processing — it plays when it's ready",
  ready: "Ready",
  failed: "Failed — nothing is playable",
  outcome_unknown: "Being checked — it may exist at the provider",
  revoked: "Removed",
};

type Upload =
  | { face: "idle" }
  | { face: "slot"; asset: MediaAsset; uploadUrl: string }
  | { face: "busy"; sentence: string };

const formatDuration = (seconds: number | null) => {
  if (!seconds || seconds <= 0) return null;
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
};

export function MediaLibrary({ tenantId }: { tenantId: string | null }) {
  const [assets, setAssets] = React.useState<MediaAsset[]>([]);
  const [phase, setPhase] = React.useState<"loading" | "ready" | "error">("loading");
  const [upload, setUpload] = React.useState<Upload>({ face: "idle" });
  const [note, setNote] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  const readAll = React.useCallback(async () => {
    if (!tenantId) return;
    const { data, error } = await supabase.rpc("tenant_media_asset_list" as never, {} as never);
    if (error) { setPhase("error"); return; }
    setAssets(((data ?? []) as unknown as Array<Record<string, unknown>>).map((row) => ({
      id: String(row.id),
      title: typeof row.title === "string" ? row.title : "Untitled video",
      kind: typeof row.kind === "string" ? row.kind : "video",
      stream_uid: String(row.stream_uid),
      status: String(row.status),
      duration_seconds: typeof row.duration_seconds === "number" ? row.duration_seconds : null,
      created_at: typeof row.created_at === "string" ? row.created_at : "",
    })));
    setPhase("ready");
  }, [tenantId]);

  React.useEffect(() => { void readAll(); }, [readAll]);

  const callDoor = async (body: Record<string, unknown>) => {
    const invoked = await supabase.functions.invoke("stream-media-command", { body: { ...body, expected_tenant_id: tenantId } });
    const errorBody = await readFunctionErrorBody(invoked.error, invoked.data);
    return { data: invoked.data as Record<string, unknown> | null, errorBody };
  };

  const register = async (title: string) => {
    if (busy) return;
    setBusy(true); setNote("");
    setUpload({ face: "busy", sentence: "Preparing an upload slot…" });
    const { data, errorBody } = await callDoor({ action: "register", title });
    if (!data?.ok) {
      const sentence = typeof errorBody?.error === "string" && !/non-2xx/i.test(errorBody.error) ? errorBody.error : "The upload couldn't be prepared. Nothing changed.";
      setNote(sentence); setUpload({ face: "idle" }); setBusy(false); return;
    }
    setUpload({ face: "slot", asset: (data.asset as unknown as MediaAsset), uploadUrl: String(data.upload_url) });
    setBusy(false); void readAll();
  };

  const sendFile = async (file: File) => {
    if (upload.face !== "slot") return;
    setBusy(true); setNote("Uploading…");
    try {
      const form = new FormData();
      form.append("file", file, file.name);
      const res = await fetch(upload.uploadUrl, { method: "POST", body: form });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setNote("Uploaded — processing now. This page updates as it becomes ready.");
    } catch {
      setNote("The upload didn't complete. Nothing was lost — you can start again.");
    }
    setUpload({ face: "idle" }); setBusy(false);
    void refresh(upload.asset.id);
  };

  const refresh = async (assetId: string) => {
    const { data, errorBody } = await callDoor({ action: "status", asset_id: assetId });
    const sentence = typeof errorBody?.error === "string" && !/non-2xx/i.test(errorBody.error) ? errorBody.error : "";
    if (!data?.ok && sentence) setNote(sentence);
    await readAll();
  };

  const revoke = async (assetId: string) => {
    if (busy) return;
    setBusy(true); setNote("");
    const { data, errorBody } = await callDoor({ action: "revoke", asset_id: assetId });
    if (!data?.ok) {
      setNote(typeof errorBody?.error === "string" && !/non-2xx/i.test(errorBody.error) ? errorBody.error : "It couldn't be removed.");
    } else {
      setNote("Removed from your library.");
    }
    setBusy(false); void readAll();
  };

  const live = assets.filter((a) => a.status !== "revoked");

  return <section className="mov-card mct-lib" aria-labelledby="mct-media-h">
    <header className="mov-head">
      <div><h2 id="mct-media-h">Videos</h2><p>Your uploaded videos live here, ready to play and reuse.</p></div>
    </header>
    <div className="mct-pubdoor" style={{ marginTop: 0 }}>
      <div className="mct-pubdoor-acts">
        <button type="button" className="btn btn-s" disabled={busy || upload.face === "slot"} onClick={() => void register("Untitled video")}>Add a video</button>
      </div>
      {upload.face === "slot" && (
        <label className="mct-media-drop">
          <input type="file" accept="video/*" disabled={busy} onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void sendFile(file);
          }}/>
          <span>Choose the video file (up to 200 MB) — it uploads once, directly.</span>
        </label>
      )}
      <p className="mct-act-note" role="status" aria-live="polite">{note}</p>
      {live.length === 0
        ? (phase === "loading" ? <p className="mct-pubdoor-state">Reading your videos…</p>
          : phase === "error" ? <p className="mct-pubdoor-state">Your videos couldn't be read. Nothing changed.</p>
          : <p className="mct-pubdoor-state">No videos yet. Add one and it stays in your library.</p>)
        : <ul className="mct-media-list">
            {live.map((asset) => <li key={asset.id}>
              <VideoCard asset={asset} busy={busy} onRefresh={() => void refresh(asset.id)} onRemove={() => void revoke(asset.id)} />
            </li>)}
          </ul>}
    </div>
  </section>;
}

function VideoCard({ asset, busy, onRefresh, onRemove }: { asset: MediaAsset; busy: boolean; onRefresh: () => void; onRemove: () => void }) {
  const [playback, setPlayback] = React.useState<{ hls: string | null } | null>(null);
  const [looking, setLooking] = React.useState(false);

  const play = async () => {
    if (asset.status !== "ready" || looking) return;
    setLooking(true);
    const invoked = await supabase.functions.invoke("stream-media-read", { body: { action: "video", uid: asset.stream_uid, expected_tenant_id: null } });
    const video = (invoked.data as { video?: { playback?: { hls?: string | null } } } | null)?.video;
    setPlayback({ hls: video?.playback?.hls ?? null });
    setLooking(false);
  };

  return <div className="mct-media-card">
    <div className="mct-media-info">
      <strong>{asset.title}</strong>
      <small>
        {STATUS_COPY[asset.status] ?? asset.status}
        {asset.status === "ready" && asset.duration_seconds ? ` · ${formatDuration(asset.duration_seconds)}` : ""}
      </small>
    </div>
    <div className="mct-pubdoor-acts">
      {asset.status === "ready" && (playback?.hls
        ? <video src={playback.hls} controls playsInline preload="metadata" aria-label={asset.title} className="mct-media-player"/>
        : <button type="button" className="btn btn-s" disabled={looking} onClick={() => void play()}>{looking ? "Opening…" : "Play"}</button>)}
      {(asset.status === "uploading" || asset.status === "processing" || asset.status === "outcome_unknown") && (
        <button type="button" className="btn btn-s" disabled={busy} onClick={onRefresh}>Check now</button>
      )}
      <button type="button" className="btn btn-s" disabled={busy} onClick={onRemove}>Remove</button>
    </div>
  </div>;
}
