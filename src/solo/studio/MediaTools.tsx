// Images & video — the Studio's direct media tools (moved here unchanged from the pre-session
// Studio surface, 2026-10-03): the server's own capability truth, credits and budget, a composer
// with model / shape / length and an estimate, the approval boundary, and the job rail. Every job
// still runs through paige-media; nothing here fabricates progress, spend or readiness.
import React from "react";
import { Ic, Logo } from "../_shared";
import { useMediaJobs, type MediaApprovalState, type MediaJob, type MediaModelInfo } from "../useMediaJobs";
import { VsStars } from "./VsStars";

const LINE = "rgba(255,255,255,.12)";
const TXT = "#EDEAF7";
const DIM = "#A49FC0";

// The 18 owner-required job states, rendered from the seam's own vocabulary. A pending approval
// reads as YOURS only for the person who asked (owner ruling 2026-10-04: requester approves).
function jobStateChip(job: MediaJob, approval?: MediaApprovalState): { label: string; tone: "gold" | "green" | "red" | "neutral" | "amber" } {
  if (job.state === "blocked" && job.approval_state === "pending") {
    return approval?.requestedByYou === true ? { label: "Needs your approval", tone: "gold" } : { label: "Awaiting approval", tone: "neutral" };
  }
  switch (job.state) {
    case "created": return { label: "Queued", tone: "neutral" };
    case "submitted": return { label: "At provider", tone: "amber" };
    case "processing": return { label: "Generating", tone: "amber" };
    case "succeeded": return { label: "Review ready", tone: "green" };
    case "failed": return { label: "Failed", tone: "red" };
    case "cancelled": return { label: "Cancelled", tone: "neutral" };
    case "outcome_unknown":
    case "expired": return { label: "Reconciling", tone: "amber" };
    default: return { label: job.state, tone: "neutral" };
  }
}

const TONE_BG: Record<string, string> = {
  gold: "rgba(245,194,102,.16)",
  green: "rgba(76,196,140,.14)",
  red: "rgba(235,87,107,.16)",
  amber: "rgba(94,153,255,.14)",
  neutral: "rgba(255,255,255,.1)",
};
const TONE_FG: Record<string, string> = {
  gold: "#F5C266",
  green: "#4CC48C",
  red: "#EB576B",
  amber: "#8FB4FF",
  neutral: DIM,
};

const Chip = ({ tone, children }: { tone: keyof typeof TONE_BG; children: React.ReactNode }) => (
  <span className="pill" style={{ background: TONE_BG[tone], color: TONE_FG[tone], fontSize: 10.5, fontWeight: 600, padding: "2px 9px", whiteSpace: "nowrap" }}>
    {children}
  </span>
);

const usd = (v: number | null | undefined) =>
  v == null ? "—" : v >= 1 ? `$${v.toFixed(2)}` : `$${v.toFixed(3)}`;

export const MediaTools = () => {
  const media = useMediaJobs();
  const [prompt, setPrompt] = React.useState("");
  const [modelId, setModelId] = React.useState<string>("");
  const [aspect, setAspect] = React.useState("1:1");
  const [videoSeconds, setVideoSeconds] = React.useState(5);
  const [referenceIds, setReferenceIds] = React.useState<string[]>([]);
  const [submitting, setSubmitting] = React.useState(false);
  const [outcome, setOutcome] = React.useState<{ ok: boolean; message: string } | null>(null);
  const textareaRef = React.useRef<HTMLTextAreaElement | null>(null);

  React.useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  // Model catalog from the server's capability truth (fal + configured legacy
  // providers). The default is the first STANDARD image model — a fresh user
  // types a brief and presses Generate; nothing is pre-classified.
  const models: MediaModelInfo[] = React.useMemo(() => {
    const list: MediaModelInfo[] = [];
    for (const p of media.capabilities?.providers ?? []) {
      if (!p.configured) continue;
      for (const m of p.models) {
        if (m.mode === "video" && !media.capabilities?.video.available) continue;
        list.push(m);
      }
    }
    return list;
  }, [media.capabilities]);

  React.useEffect(() => {
    if (!models.length) return;
    if (!models.some((m) => m.id === modelId)) {
      setModelId(models.find((m) => m.mode === "image" && m.tier === "standard")?.id ?? models[0].id);
      setReferenceIds([]);
    }
  }, [models, modelId]);

  const selected = models.find((m) => m.id === modelId);
  const isVideo = selected?.mode === "video";
  const isEdit = selected?.mode === "image_edit";

  // Client-side estimate preview from the same catalog the server prices from —
  // labeled ≈ everywhere; the server's estimate is authoritative at submit.
  const estimate = selected
    ? selected.unit === "second"
      ? selected.estCostPerUnitUsd * videoSeconds
      : selected.estCostPerUnitUsd
    : null;

  const anyProviderConfigured = (media.capabilities?.providers ?? []).some((p) => p.configured);
  const pendingJobs = media.jobs.filter((j) => j.state === "blocked" && j.approval_state === "pending");
  const [deciding, setDeciding] = React.useState<{ id: string; kind: "approve" | "decline" } | null>(null);
  const decideJob = async (id: string, kind: "approve" | "decline") => {
    if (deciding) return;
    setDeciding({ id, kind });
    try {
      await (kind === "approve" ? media.approve(id) : media.decline(id));
    } finally {
      setDeciding(null);
    }
  };
  const budget = media.capabilities?.budget;

  const generate = async () => {
    if (!selected || prompt.trim().length < 4 || submitting) return;
    setSubmitting(true);
    setOutcome(null);
    const res = await media.submit({
      prompt: prompt.trim(),
      model: selected.id,
      aspectRatio: aspect,
      videoSeconds: isVideo ? videoSeconds : undefined,
      referenceContentIds: isEdit ? referenceIds : undefined,
      requestId: crypto.randomUUID(),
    });
    setSubmitting(false);
    if (res.status === "ok") {
      setOutcome({ ok: true, message: res.awaitingApproval ? "Estimate ready — approve it below to run." : "Job started." });
      if (!res.awaitingApproval) setPrompt("");
    } else {
      setOutcome({ ok: false, message: res.message });
    }
  };

  const license = media.capabilities?.providers.find((p) => p.provider === "fal")?.license.disclosure
    ?? media.capabilities?.providers[0]?.license.disclosure;

  return (
    <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) 240px", minHeight: "100%" }}>
      <div style={{ minWidth: 0 }}>
        {/* Hero + composer */}
        <div
          style={{
            position: "relative", minHeight: "min(420px,60vh)", display: "grid", placeItems: "center", padding: "48px 28px",
            background: "radial-gradient(120% 90% at 50% 8%, #1B1740 0%, #0E0B23 45%, #070613 100%)",
            borderBottom: `1px solid ${LINE}`, overflow: "hidden",
          }}
        >
          <VsStars />
          <div style={{ position: "relative", width: "min(720px,100%)", textAlign: "center" }}>
            <div style={{ display: "grid", placeItems: "center", gap: 10 }}>
              <Logo size={36} />
              <div style={{ fontSize: 11, letterSpacing: ".32em", color: DIM, fontWeight: 600 }}>VIBE STUDIO</div>
            </div>
            <h1 style={{ fontSize: "clamp(24px,3.4vw,38px)", letterSpacing: "-.04em", marginTop: 14, color: "#fff" }}>What do you want to create?</h1>

            {!anyProviderConfigured ? (
              /* State 1: no provider configured — truthful, self-diagnosing. */
              <div style={{ marginTop: 20, background: "rgba(255,255,255,.05)", border: `1px solid ${LINE}`, borderRadius: 16, padding: "18px 20px", textAlign: "left" }}>
                <div className="row" style={{ gap: 9, marginBottom: 8 }}><Ic.bolt size={15} style={{ color: "#F5C266" }} /><span style={{ fontWeight: 600, fontSize: 13.5 }}>Media generation isn't switched on yet</span></div>
                <div style={{ fontSize: 12.8, color: DIM, lineHeight: 1.6 }}>
                  No media provider key is set. The owner adds the fal key as the <span className="mono">FAL_KEY</span> Edge Function secret, sets a prepaid provider ceiling, and a media budget — then this surface goes live. Existing chat image generation is unaffected.
                </div>
              </div>
            ) : (
              <>
                <div style={{ marginTop: 20, background: "rgba(255,255,255,.07)", border: `1px solid ${LINE}`, borderRadius: 18, padding: 14, backdropFilter: "blur(6px)", textAlign: "left" }}>
                  <textarea
                    ref={textareaRef}
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                    placeholder={isEdit ? "Describe the edit — e.g. make the background a warm sunset…" : isVideo ? "Describe the video — e.g. a 5-second cinematic pan across my offer…" : "Describe the image — e.g. a bold hero visual for my Q3 masterclass…"}
                    aria-label="Creative brief"
                    style={{ width: "100%", minHeight: 72, resize: "none", border: 0, outline: "none", background: "none", color: TXT, fontFamily: "var(--font)", fontSize: 14.5, lineHeight: 1.55 }}
                  />
                  <div className="row" style={{ gap: 10, flexWrap: "wrap", borderTop: `1px solid ${LINE}`, paddingTop: 11, alignItems: "center" }}>
                    <label className="row" style={{ gap: 6, fontSize: 12.3, color: DIM }}>
                      Model
                      <select
                        value={modelId}
                        onChange={(e) => { setModelId(e.target.value); setReferenceIds([]); }}
                        aria-label="Model"
                        style={{ background: "rgba(255,255,255,.06)", color: TXT, border: `1px solid ${LINE}`, borderRadius: 9, padding: "5px 9px", fontSize: 12.3, outline: "none" }}
                      >
                        {models.map((m) => (
                          <option key={m.id} value={m.id} style={{ background: "#141028", color: TXT }}>
                            {m.label}{m.tier === "premium" ? " · premium" : ""}{m.mode === "video" ? " · video" : m.mode === "image_edit" ? " · edit" : ""}
                          </option>
                        ))}
                      </select>
                    </label>
                    {isEdit && (
                      <span style={{ fontSize: 11.8, color: DIM }}>{referenceIds.length ? `${referenceIds.length} reference${referenceIds.length > 1 ? "s" : ""} selected below` : "Pick a finished asset below to edit"}</span>
                    )}
                    {isVideo && (
                      <label className="row" style={{ gap: 6, fontSize: 12.3, color: DIM }}>
                        Length
                        <select
                          value={String(videoSeconds)}
                          onChange={(e) => setVideoSeconds(Number(e.target.value))}
                          aria-label="Video length in seconds"
                          style={{ background: "rgba(255,255,255,.06)", color: TXT, border: `1px solid ${LINE}`, borderRadius: 9, padding: "5px 9px", fontSize: 12.3, outline: "none" }}
                        >
                          {[4, 5, 6, 8].map((s) => <option key={s} value={s} style={{ background: "#141028", color: TXT }}>{s}s</option>)}
                        </select>
                      </label>
                    )}
                    {!isVideo && !isEdit && (
                      <label className="row" style={{ gap: 6, fontSize: 12.3, color: DIM }}>
                        Shape
                        <select
                          value={aspect}
                          onChange={(e) => setAspect(e.target.value)}
                          aria-label="Aspect ratio"
                          style={{ background: "rgba(255,255,255,.06)", color: TXT, border: `1px solid ${LINE}`, borderRadius: 9, padding: "5px 9px", fontSize: 12.3, outline: "none" }}
                        >
                          <option value="1:1" style={{ background: "#141028", color: TXT }}>Square</option>
                          <option value="3:2" style={{ background: "#141028", color: TXT }}>Landscape</option>
                          <option value="2:3" style={{ background: "#141028", color: TXT }}>Portrait</option>
                        </select>
                      </label>
                    )}
                    <span className="mono" style={{ marginLeft: "auto", fontSize: 11.2, color: DIM }}>
                      ≈{usd(estimate)}{selected?.unit === "second" ? ` · ${videoSeconds}s` : ""}
                    </span>
                    <button
                      onClick={generate}
                      disabled={submitting || prompt.trim().length < 4 || (isEdit && referenceIds.length === 0)}
                      aria-label="Generate"
                      style={{ width: 34, height: 34, borderRadius: "50%", background: prompt.trim().length >= 4 && !(isEdit && referenceIds.length === 0) && !submitting ? "var(--gold-bright)" : "rgba(255,255,255,.14)", color: prompt.trim().length >= 4 ? "#2A1C00" : DIM, display: "grid", placeItems: "center", border: 0, cursor: "pointer" }}
                    >
                      <span style={{ transform: "rotate(-90deg)", display: "flex" }}><Ic.arrow size={16} style={{}} /></span>
                    </button>
                  </div>
                </div>
                {estimate != null && isVideo && (
                  <div style={{ marginTop: 10, fontSize: 11.3, color: DIM }}>
                    Video runs only after you approve its estimate. {media.capabilities?.video.note}
                  </div>
                )}
                {outcome && (
                  <div role="status" style={{ marginTop: 12, fontSize: 12.6, color: outcome.ok ? "#4CC48C" : "#EB576B", maxWidth: 640, marginInline: "auto" }}>
                    {outcome.message}
                  </div>
                )}
                {media.actionError && !outcome && (
                  <div role="alert" style={{ marginTop: 12, fontSize: 12.6, color: "#EB576B" }}>{media.actionError}</div>
                )}
              </>
            )}
          </div>
        </div>

        {/* Approval boundary — the server-held pending jobs, with the estimate
            and the commercial-use disclosure the owner's contract requires. */}
        {pendingJobs.length > 0 && (
          <section style={{ padding: "20px 28px 0" }} aria-label="Awaiting approval">
            {pendingJobs.map((job) => {
              const { requestedByYou, requesterName } = media.approvalFor(job);
              const mine = requestedByYou === true;
              const busy = deciding?.id === job.id ? deciding.kind : null;
              return (
                <div
                  key={job.id}
                  data-approver={mine ? "you" : requestedByYou === false ? "someone-else" : "unknown"}
                  aria-busy={busy !== null}
                  style={{ background: mine ? "rgba(245,194,102,.06)" : "rgba(255,255,255,.035)", border: `1px solid ${mine ? "rgba(245,194,102,.25)" : LINE}`, borderRadius: 16, padding: "15px 17px" }}
                >
                  <div className="row" style={{ gap: 10, marginBottom: 8, flexWrap: "wrap" }}>
                    <Chip tone={mine ? "gold" : "neutral"}>{mine ? "Needs your approval" : requestedByYou === false ? `Waiting for ${requesterName ?? "the person who asked"}` : "Awaiting approval"}</Chip>
                    <span style={{ fontSize: 13, fontWeight: 600 }}>{String(job.params?.prompt ?? "").slice(0, 70)}{String(job.params?.prompt ?? "").length > 70 ? "…" : ""}</span>
                    <span className="mono" style={{ marginLeft: "auto", fontSize: 12, color: mine ? "#F5C266" : TXT }}>≈{usd(job.estimated_cost_usd)}</span>
                  </div>
                  {!mine && (
                    <div style={{ fontSize: 12.3, color: TXT, lineHeight: 1.55, marginBottom: 6 }}>
                      {requestedByYou === false ? "Only they" : "Only the person who asked"} can approve the cost. You can decline it.
                    </div>
                  )}
                  {license && <div style={{ fontSize: 11.8, color: DIM, lineHeight: 1.55, marginBottom: 12 }}>{license}</div>}
                  <div className="row" style={{ gap: 10, marginTop: license ? 0 : 6 }}>
                    {mine && (
                      <button
                        onClick={() => void decideJob(job.id, "approve")}
                        disabled={busy !== null}
                        className="btn btn-s"
                        style={{ background: "var(--gold-bright)", borderColor: "var(--gold-bright)", color: "#2A1C00", fontWeight: 600 }}
                      >
                        {busy === "approve" ? "Approving…" : "Approve & run"}
                      </button>
                    )}
                    <button onClick={() => void decideJob(job.id, "decline")} disabled={busy !== null} className="btn btn-s" style={{ background: "transparent", borderColor: LINE, color: TXT }}>
                      {busy === "decline" ? "Declining…" : "Decline"}
                    </button>
                    <span style={{ fontSize: 11.3, color: DIM, marginLeft: 6 }}>
                      {job.mode === "video" ? `Video · ${job.video_seconds ?? "?"}s · ${job.model}` : job.model}
                    </span>
                  </div>
                </div>
              );
            })}
          </section>
        )}

        {/* Recent work — the job rail. Real states from the seam; real asset
            previews from the library; truthful disabled Social handoff. */}
        <section style={{ padding: "24px 28px 44px" }} aria-label="Recent work">
          <div className="row" style={{ alignItems: "baseline", gap: 12, marginBottom: 14 }}>
            <h2 style={{ fontSize: 19, letterSpacing: "-.03em", color: "#fff" }}>Recent work</h2>
            <span style={{ color: DIM, fontSize: 12.6 }}>{media.jobs.length} job{media.jobs.length === 1 ? "" : "s"}</span>
          </div>

          {media.loading ? (
            <div style={{ color: DIM, fontSize: 13, padding: "18px 4px" }} role="status">Loading your studio…</div>
          ) : media.jobs.length === 0 ? (
            <div style={{ border: `1px dashed ${LINE}`, borderRadius: "var(--r-l)", padding: "26px 22px", color: DIM, fontSize: 13, textAlign: "center", lineHeight: 1.6 }}>
              Nothing here yet. Describe what you want above — the estimate appears before anything runs, and every finished asset lands in your library.
            </div>
          ) : (
            <div style={{ display: "grid", gap: 10 }}>
              {media.jobs.map((job) => {
                const chip = jobStateChip(job, media.approvalFor(job));
                const asset = job.content_id ? media.assets[job.content_id] : undefined;
                const cancellable = !["succeeded", "failed", "cancelled"].includes(job.state) && job.approval_state !== "rejected";
                return (
                  <div key={job.id} style={{ border: `1px solid ${LINE}`, borderRadius: 14, background: "rgba(255,255,255,.03)", padding: "12px 14px", display: "flex", gap: 14, alignItems: "center" }}>
                    <div
                      aria-hidden="true"
                      style={{ width: 64, height: 46, borderRadius: 9, flex: "none", overflow: "hidden", border: `1px solid ${LINE}`, display: "grid", placeItems: "center", background: "radial-gradient(110% 100% at 30% 0%, #221C4A 0%, #100D26 100%)" }}
                    >
                      {asset?.image_url ? (
                        <img src={asset.image_url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                      ) : (
                        <Ic.spark size={15} style={{ color: job.state === "succeeded" ? "#4CC48C" : DIM }} />
                      )}
                    </div>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div className="row" style={{ gap: 9, flexWrap: "wrap" }}>
                        <Chip tone={chip.tone}>{chip.label}</Chip>
                        <span className="trunc" style={{ fontSize: 13, fontWeight: 550, maxWidth: 340 }}>
                          {String(job.params?.prompt ?? job.model).slice(0, 80)}
                        </span>
                      </div>
                      <div style={{ color: DIM, fontSize: 11.8, marginTop: 3 }}>
                        {job.mode === "image_edit" ? "Image edit" : job.mode === "video" ? `Video · ${job.video_seconds ?? "?"}s` : "Image"} · {job.model} · ≈{usd(job.estimated_cost_usd)}
                        {job.state === "failed" && job.error ? ` · ${job.error.slice(0, 120)}` : ""}
                        {job.state === "succeeded" && job.actual_cost_usd != null ? ` · actual ${usd(job.actual_cost_usd)}` : ""}
                      </div>
                    </div>
                    <div className="row" style={{ gap: 8, flex: "none" }}>
                      {job.state === "succeeded" && asset?.kind !== "video" && (
                        <>
                          <button
                            className="btn btn-s"
                            style={{ background: "rgba(255,255,255,.08)", borderColor: LINE, color: TXT }}
                            onClick={() => {
                              if (!job.content_id) return;
                              const editModel = models.find((m) => m.mode === "image_edit");
                              if (!editModel) return;
                              setModelId(editModel.id);
                              setReferenceIds([job.content_id as string]);
                              setPrompt("");
                              textareaRef.current?.focus();
                            }}
                            disabled={!models.some((m) => m.mode === "image_edit")}
                            title={models.some((m) => m.mode === "image_edit") ? "Use this asset as the edit reference" : "Editing needs the fal provider"}
                          >
                            Edit
                          </button>
                          <button
                            className="btn btn-s"
                            style={{ background: "transparent", borderColor: LINE, color: DIM }}
                            disabled
                            title="Social publishing becomes available after this account's Social connection and publishing path are verified."
                          >
                            Send to Social
                          </button>
                        </>
                      )}
                      {cancellable && (
                        <button className="btn btn-s" style={{ background: "transparent", borderColor: LINE, color: DIM }} onClick={() => void media.cancel(job.id)}>
                          Cancel
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          <div style={{ marginTop: 18, fontSize: 11.5, color: "#8B86AD", lineHeight: 1.6, maxWidth: 640 }}>
            Music generation is deferred from this release — no music provider is connected. {license}
          </div>
        </section>
      </div>
      <aside aria-label="Media status" style={{ borderLeft: `1px solid ${LINE}`, padding: "18px 14px", display: "flex", flexDirection: "column", gap: 14 }}>
        <div style={{ display: "grid", gap: 2 }} aria-label="Capabilities">
          {[
            { label: "Images", ok: anyProviderConfigured, note: anyProviderConfigured ? "live" : "needs provider key" },
            { label: "Image editing", ok: (media.capabilities?.providers ?? []).some((p) => p.provider === "fal" && p.configured), note: media.capabilities?.providers.some((p) => p.provider === "fal" && p.configured) ? "live" : "needs FAL_KEY" },
            { label: `Video (${media.capabilities?.video.completed_today ?? 0}/${media.capabilities?.video.daily_limit ?? 1} today)`, ok: !!media.capabilities?.video.available, note: media.capabilities?.video.enabled ? "approval-gated" : "off in beta" },
            { label: "Music", ok: false, note: "deferred" },
          ].map((row) => (
            <div key={row.label} className="row" style={{ gap: 10, padding: "8px 11px", borderRadius: 10, fontSize: 12.6, alignItems: "center" }}>
              <span style={{ width: 7, height: 7, borderRadius: "50%", flex: "none", background: row.ok ? "#4CC48C" : "#5A5578" }} aria-hidden="true" />
              <span style={{ color: row.ok ? TXT : DIM }}>{row.label}</span>
              <span style={{ marginLeft: "auto", fontSize: 10.5, color: DIM }}>{row.note}</span>
            </div>
          ))}
        </div>

        {media.capabilities?.credits?.readable && (
          <div style={{ display: "grid", gap: 2, fontSize: 11.8, color: DIM }} aria-label="Media credits">
            <div className="row" style={{ justifyContent: "space-between" }}>
              <span>Media credits</span>
              <span className="mono" style={{ color: TXT }}>
                {(media.capabilities.credits.total_remaining ?? 0).toLocaleString("en-US")}
              </span>
            </div>
            {typeof media.capabilities.credits.allowance_monthly === "number" && (
              <span style={{ fontSize: 10.5, lineHeight: 1.5, color: "#8B86AD" }}>
                {media.capabilities.credits.total_remaining === 0
                  ? "Allowance used — new requests show their cost and need credits."
                  : `of ${(media.capabilities.credits.allowance_monthly).toLocaleString("en-US")} included monthly${media.capabilities.credits.notice_band ? ` · ${media.capabilities.credits.notice_band}% band` : ""}`}
              </span>
            )}
          </div>
        )}
        {budget && (
          <div style={{ marginTop: "auto", display: "grid", gap: 4, borderTop: `1px solid ${LINE}`, paddingTop: 12, fontSize: 11.5, color: DIM }}>
            <div className="row" style={{ justifyContent: "space-between" }}>
              <span>Media spend today</span>
              <span className="mono" style={{ color: TXT }}>{usd(budget.accrued_today_usd)}</span>
            </div>
            <div className="row" style={{ justifyContent: "space-between" }}>
              <span>Daily ceiling</span>
              <span className="mono">{budget.ceiling_set ? usd(budget.ceiling_usd) : "not set"}</span>
            </div>
            {!budget.ceiling_set && (
              <span style={{ fontSize: 10.5, lineHeight: 1.5, color: "#8B86AD" }}>
                Generation stays off until the owner sets a media budget (media_budget_daily_usd).
              </span>
            )}
          </div>
        )}
      </aside>
    </div>
  );
};
