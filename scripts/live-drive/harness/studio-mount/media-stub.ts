// Media jobs double: one image in this project waiting for approval when ?approval=1|mine|theirs|theirs-unnamed.
// `1`/`mine`: the viewer asked for it (Approve + Decline). `theirs`: another admin asked (Decline only,
// named). `theirs-unnamed`: another admin asked and has no profile name.
const approvalParam = new URLSearchParams(window.location.search).get("approval");
const approval = !!approvalParam;
const jobs = approval ? [{
  id: "job-1", mode: "image", provider: "fal", model: "auto", state: "blocked", approval_state: "pending",
  params: { prompt: "A warm, bright workspace photo for the intake form header", studio_session_id: "s-form" },
  estimated_cost_usd: 0.04, actual_cost_usd: null, error: null, content_id: null, video_seconds: null,
  created_at: "2026-10-03T12:00:00Z", completed_at: null,
}] : [];
const approvalState = approvalParam === "theirs"
  ? { requestedByYou: false, requesterName: "Dana Reyes" }
  : approvalParam === "theirs-unnamed" ? { requestedByYou: false, requesterName: null }
  : { requestedByYou: true, requesterName: null };
export function useMediaJobs() {
  return {
    capabilities: { providers: [], music: { available: false, status: "unavailable", note: "" }, video: { available: false, enabled: false, provider_configured: false, provider_ceiling_set: false, completed_today: 0, daily_limit: 0, note: "" }, budget: { ceiling_set: false, ceiling_usd: 0, accrued_today_usd: 0, draft_allowance_usd: 0 } },
    jobs, assets: {}, loading: false, actionError: null,
    submit: async () => ({ status: "error", message: "harness" }),
    decide: async () => true, approve: async () => true, decline: async () => true,
    approvalFor: () => approvalState,
    cancel: async () => true, refreshCapabilities: async () => {},
  };
}
