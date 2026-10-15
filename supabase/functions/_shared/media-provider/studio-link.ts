// Files a finished Studio media job onto its session. Pure of imports so both completion paths
// (and the tests) can load it.
/**
 * VIBE STUDIO: a job started from a Studio session lands on that session's canvas and timeline.
 * Shared by both completion paths (the fal webhook and the synchronous legacy providers), so an
 * image reaches the canvas whichever provider made it. The session was verified as this tenant's
 * at submit; the RPCs re-check it (the service path names the tenant). Non-fatal and logged: by
 * the time this runs the image is filed and the job has succeeded.
 */
// deno-lint-ignore no-explicit-any
export async function linkStudioArtifact(admin: any, job: { tenant_id?: unknown; params?: unknown }, contentId: string | null): Promise<void> {
  const params = (job.params ?? {}) as Record<string, unknown>;
  const studioSessionId = typeof params.studio_session_id === "string" ? params.studio_session_id : null;
  if (!studioSessionId || !contentId) return;
  try {
    const { error: linkErr } = await admin.rpc("link_session_artifact", {
      p_session_id: studioSessionId, p_kind: "content", p_artifact_id: contentId, p_tenant_id: job.tenant_id,
    });
    if (linkErr) { console.error("[media-complete] studio session link failed:", linkErr.message); return; }
    const { error: verErr } = await admin.rpc("save_artifact_version", {
      p_session_id: studioSessionId, p_kind: "content", p_artifact_id: contentId, p_tenant_id: job.tenant_id,
    });
    if (verErr) console.error("[media-complete] studio version save failed:", verErr.message);
  } catch (e) {
    console.error("[media-complete] studio session link threw:", e instanceof Error ? e.message : "unknown");
  }
}
