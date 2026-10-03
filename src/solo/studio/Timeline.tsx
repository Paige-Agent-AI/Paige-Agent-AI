// The timeline: every saved version of the piece on the stage, newest last, read from the database
// (studio_artifact_versions) so a history can never live only in this tab. Going back writes the old
// version into the working copy; it never touches what is live until the owner publishes.
import React from "react";
import { listVersions, plainError, restoreVersion, type ArtifactKind, type StudioVersion } from "./studio-data";

const time = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
};

export function Timeline({ sessionId, target, refreshKey, building, onRestored }: {
  sessionId: string;
  target: { kind: ArtifactKind; id: string } | null;
  refreshKey: number;
  building: string | null;
  onRestored: (message: string) => void;
}) {
  const [versions, setVersions] = React.useState<StudioVersion[]>([]);
  const [selected, setSelected] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const rowRef = React.useRef<HTMLDivElement | null>(null);

  React.useEffect(() => {
    let live = true;
    setError(null);
    if (!target) { setVersions([]); return; }
    listVersions(sessionId, target.kind, target.id)
      .then((v) => { if (live) setVersions([...v].sort((a, b) => a.versionNo - b.versionNo)); })
      .catch(() => { if (live) setVersions([]); });
    return () => { live = false; };
  }, [sessionId, target, refreshKey]);

  React.useEffect(() => {
    rowRef.current?.scrollTo({ left: rowRef.current.scrollWidth });
  }, [versions.length, building]);

  const chosen = versions.find((v) => v.id === selected) ?? null;
  const restore = async () => {
    if (!chosen) return;
    setBusy(true); setError(null);
    try {
      await restoreVersion(chosen.id);
      setSelected(null);
      onRestored(`Went back to version ${chosen.versionNo}. It's your working copy now; publish to put it live.`);
    } catch (e) {
      setError(plainError(e, "That version couldn't be restored. Nothing changed."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="vs-timeline" aria-label="Timeline">
      <div className="vs-timeline-head">
        <b>Timeline</b>
        <span>Every saved version of this piece. Pick one to go back to it.</span>
      </div>
      <div className="vs-timeline-row" ref={rowRef}>
        {versions.length === 0 && !building && <span className="vs-version-actions">No versions yet. They appear here as Paige builds and as you change things.</span>}
        {versions.map((v) => (
          <button
            key={v.id}
            type="button"
            className={`vs-version${v.isCurrent ? " vs-version-live" : ""}`}
            aria-current={selected === v.id}
            onClick={() => setSelected((s) => (s === v.id ? null : v.id))}
          >
            <span><span>Version {v.versionNo}{v.isCurrent ? " · current" : ""}</span><time>{time(v.createdAt)}</time></span>
            <b className="vs-trunc">{v.title ?? "Saved"}</b>
          </button>
        ))}
        {building && (
          <div className="vs-version" aria-live="polite" style={{ borderStyle: "dashed", cursor: "default" }}>
            <span><span>Paige</span><time>now</time></span>
            <b className="vs-trunc">{building}</b>
          </div>
        )}
      </div>
      {chosen && (
        <div className="vs-version-actions">
          {chosen.isCurrent ? <span>This is the version you're working on.</span> : (
            <>
              <span>Go back to version {chosen.versionNo}? Newer versions stay in the timeline.</span>
              <button type="button" className="vs-btn vs-btn-violet" disabled={busy} onClick={restore}>{busy ? "Going back…" : "Go back to this version"}</button>
              <button type="button" className="vs-btn vs-btn-quiet" onClick={() => setSelected(null)}>Cancel</button>
            </>
          )}
        </div>
      )}
      {error && <p className="vs-alert" role="alert">{error}</p>}
    </section>
  );
}
