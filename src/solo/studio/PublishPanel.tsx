// "Ready to go live?" — the readiness check and the one going-live act. Gold is spent here and
// nowhere else. The checks read the saved work, never a guess; the server re-checks on publish and
// its refusal is shown in its own words. A published result is reported only with the address the
// publish returned.
import React from "react";
import { Check, X, Circle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { plainError, publishArtifact, unpublishArtifact, type ArtifactKind } from "./studio-data";
import { artifactId, hasPendingChanges, isLive, type LoadedArtifact } from "./artifact-state";

interface CheckRow { ok: boolean | null; label: string; note?: string; blocking: boolean }

async function routeLabel(pipelineId: string | null, stageId: string | null): Promise<string | null> {
  if (!pipelineId) return null;
  const [{ data: p }, { data: s }] = await Promise.all([
    supabase.from("pipelines").select("name").eq("id", pipelineId).maybeSingle(),
    stageId ? supabase.from("pipeline_stages").select("label").eq("id", stageId).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const pn = (p as { name?: string } | null)?.name;
  const sn = (s as { label?: string } | null)?.label;
  return pn ? (sn ? `${pn} → ${sn}` : pn) : null;
}

function checksFor(a: LoadedArtifact, route: string | null): CheckRow[] {
  switch (a.kind) {
    case "form": {
      const f = a.form;
      return [
        { ok: f.fields.length > 0, label: f.fields.length > 0 ? `Has ${f.fields.length} question${f.fields.length === 1 ? "" : "s"}` : "Has no questions yet", blocking: true },
        { ok: f.fields.some((q) => q.key === "email"), label: f.fields.some((q) => q.key === "email") ? "Asks for an email, so each request becomes a contact" : "Doesn't ask for an email", note: f.fields.some((q) => q.key === "email") ? undefined : "Requests still arrive, but can't be matched to a contact.", blocking: false },
        { ok: f.routesToPipeline ? true : null, label: f.routesToPipeline ? `Requests go to ${route ?? "your pipeline"}` : "Requests aren't sent to a pipeline", note: f.routesToPipeline ? undefined : "Set this in Form settings.", blocking: false },
        { ok: f.notifyEmail ? true : null, label: f.notifyEmail ? `Each request emails ${f.notifyEmail}` : "No alert email", note: f.notifyEmail ? undefined : "Set one in Form settings, or see requests in Marketing › Lead capture.", blocking: false },
        { ok: f.thankYou ? true : null, label: f.thankYou ? "Thank-you message is written" : "No thank-you message", note: f.thankYou ? undefined : "Visitors see a plain confirmation.", blocking: false },
      ];
    }
    case "page":
      return [
        { ok: a.page.blocks.length > 0, label: a.page.blocks.length > 0 ? `Has ${a.page.blocks.length} section${a.page.blocks.length === 1 ? "" : "s"}` : "The page is empty", blocking: true },
        { ok: null, label: "Forms on this page go live with it", note: "Paige checks for unfinished text when you publish.", blocking: false },
      ];
    case "funnel":
      return [
        { ok: a.funnel.steps.length > 0, label: a.funnel.steps.length > 0 ? `Has ${a.funnel.steps.length} step${a.funnel.steps.length === 1 ? "" : "s"}` : "Has no steps yet", blocking: true },
        { ok: null, label: "Every page and form in it goes live together", blocking: false },
      ];
    default:
      if (a.image.contentKind !== "image") {
        return [{ ok: false, label: a.image.contentKind === "document" ? "Documents aren't published from the Studio" : "Copy isn't published from the Studio", note: "Use it in a page, an email or a post instead.", blocking: true }];
      }
      return [{ ok: !!a.image.imageUrl, label: a.image.imageUrl ? "The image file is ready" : "The image has no file yet", blocking: true }];
  }
}


export function PublishPanel({ artifact, onClose, onDone }: {
  artifact: LoadedArtifact;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const live = isLive(artifact);
  const pending = hasPendingChanges(artifact);
  const [route, setRoute] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [url, setUrl] = React.useState<string | null>(null);
  const firstRef = React.useRef<HTMLButtonElement | null>(null);

  React.useEffect(() => {
    if (artifact.kind === "form" && artifact.form.routesToPipeline) {
      void routeLabel(artifact.form.pipelineId, artifact.form.stageId).then(setRoute).catch(() => setRoute(null));
    }
  }, [artifact]);
  React.useEffect(() => { firstRef.current?.focus(); }, []);
  React.useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); onClose(); } };
    window.addEventListener("keydown", k, true);
    return () => window.removeEventListener("keydown", k, true);
  }, [onClose]);

  const checks = checksFor(artifact, route);
  const blocked = checks.some((c) => c.blocking && c.ok === false);
  const kind: ArtifactKind = artifact.kind;

  const publish = async () => {
    setBusy(true); setError(null);
    try {
      const res = await publishArtifact(kind, artifactId(artifact));
      const full = res.url ? (res.url.startsWith("http") ? res.url : `${window.location.origin}${res.url}`) : null;
      setUrl(full);
      onDone(full ? `Live at ${full}` : "Published.");
    } catch (e) {
      setError(plainError(e, "It didn't go live. Nothing changed; try again."));
    } finally {
      setBusy(false);
    }
  };
  const unpublish = async () => {
    setBusy(true); setError(null);
    try {
      await unpublishArtifact(kind, artifactId(artifact));
      onDone("Unpublished. It's back to a draft here in the Studio.");
      onClose();
    } catch (e) {
      setError(plainError(e, "It couldn't be taken down. It's still live."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="vs-pop" role="dialog" aria-label={live && !pending ? "This is live" : "Ready to go live?"}>
      {url ? (
        <>
          <h2>It's live</h2>
          <p>Anyone with the link can open it, and it's in Marketing › Lead capture.</p>
          <a href={url} target="_blank" rel="noreferrer" className="vs-link" style={{ wordBreak: "break-all" }}>{url}</a>
          <div className="vs-pop-foot"><button ref={firstRef} type="button" className="vs-btn" onClick={onClose}>Done</button></div>
        </>
      ) : live && !pending ? (
        <>
          <h2>This is live</h2>
          <p>Visitors see the published version. Unpublishing moves it back to a draft here; anything that depends on it stays as it is.</p>
          {kind === "funnel" && <p>Changed one of its pages or forms? Publish again to put every step's latest saved version live.</p>}
          {error && <p className="vs-alert" role="alert">{error}</p>}
          <div className="vs-pop-foot">
            <button ref={firstRef} type="button" className="vs-btn vs-btn-quiet" onClick={onClose}>Close</button>
            <button type="button" className="vs-btn vs-btn-danger" disabled={busy} onClick={unpublish}>{busy ? "Working…" : "Unpublish"}</button>
            {kind === "funnel" && <button type="button" className="vs-btn vs-btn-gold" disabled={busy} onClick={publish}>Publish again</button>}
          </div>
        </>
      ) : (
        <>
          <h2>{pending ? "Put your changes live?" : "Ready to go live?"}</h2>
          <p>{pending ? "Visitors keep seeing the current version until you do." : "It gets a public link and moves to Marketing › Lead capture."}</p>
          <ul className="vs-checks">
            {checks.map((c) => (
              <li key={c.label}>
                {c.ok === true ? <Check size={15} color="var(--vs-good)" aria-label="Done" /> : c.ok === false ? <X size={15} color="var(--vs-bad)" aria-label="Missing" /> : <Circle size={13} color="var(--vs-faint)" aria-label="Optional" />}
                <span>{c.label}{c.note && <small>{c.note}</small>}</span>
              </li>
            ))}
          </ul>
          {error && <p className="vs-alert" role="alert">{error}</p>}
          <div className="vs-pop-foot">
            {live && <button type="button" className="vs-btn vs-btn-danger" disabled={busy} onClick={unpublish}>Unpublish</button>}
            <button ref={firstRef} type="button" className="vs-btn vs-btn-quiet" onClick={onClose}>Not yet</button>
            <button type="button" className="vs-btn vs-btn-gold" disabled={busy || blocked} onClick={publish}>
              {busy ? "Publishing…" : pending ? "Publish changes" : "Publish now"}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
