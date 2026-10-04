/**
 * Media approval — the paige-media spend approval, built ON the one canonical approval store.
 *
 * WHY THIS FILE EXISTS (owner direction, Antonio Cook): "Fold the extra paige-media approval
 * layer into the canonical authority path rather than keeping stacked competing approval
 * systems." Until v2b a pending media job was approved by flipping `paige_media_jobs.approval_state`
 * on ANY tenant admin's say-so — no proposal, no fingerprint, no single-use claim. That was a
 * second approval channel beside `paige_pending_confirmations` (docs/doctrine/one-approval-gate.md).
 *
 * WHAT IT DOES NOW. A job that needs approval gets a SERVER-ISSUED, thread-less proposal in
 * `paige_pending_confirmations`, minted exactly the way `crm-command`, `sales-invoice-command`
 * and `paige-social` mint theirs: service role, bound to the requesting `user_id` and the
 * server-resolved tenant, `server_issued_at` + `issued_in_request` stamped, NULL thread/client
 * scope, fingerprint from the ONE fingerprint home (`_shared/confirm-fingerprint.ts`). The job's
 * `approval_state` stays as a PROJECTION of that decision — no migration.
 *
 * OWNER RULING 2026-10-04 — "Requester approves, any admin can decline." The proposal is
 * addressed to the person who asked (`user_id` = job.actor_id), so only they can redeem it. Any
 * owner/admin may decline or cancel; a decline retires the proposal so it can never be redeemed.
 *
 * THE TOOL KEY. The proposal's `tool_name` is the media capability key the Rail already uses for
 * this act (`vibe_media_image` / `vibe_media_video`), not the chat tool `generate_image`. Reason,
 * read from how the fingerprint is built: `confirmFingerprint(tool, args)` namespaces the proposal
 * by tool, and the chat gate claims `generate_image` rows and EXECUTES their stored args as a
 * `generate_image` call. These args are a job reference, not a `generate_image` argument set, and a
 * video job is not a `generate_image` act at all. Using the capability key keeps the proposal
 * redeemable only by this door — the `paige-social` precedent (`tool_name: input.capability`).
 *
 * Dependency-light (no Deno globals, no esm.sh) so vitest exercises it directly.
 */
import { confirmFingerprint } from "../confirm-fingerprint.ts";

/** The job lifetime the sweeper enforces (`mark_exhausted_media_jobs`: blocked + pending > 7 days → cancelled). */
export const MEDIA_APPROVAL_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;

export type MediaApprovalTool = "vibe_media_image" | "vibe_media_video";

// deno-lint-ignore no-explicit-any
type Db = { from: (table: string) => any };

/** The slice of a paige_media_jobs row this module reads. */
export interface MediaApprovalJob {
  id: string;
  tenant_id: string;
  actor_id: string | null;
  mode: string;
  model: string;
  estimated_cost_usd: number | string | null;
  video_seconds?: number | null;
  created_at?: string | null;
  params?: Record<string, unknown> | null;
}

export function mediaApprovalTool(mode: string): MediaApprovalTool {
  return mode === "video" ? "vibe_media_video" : "vibe_media_image";
}

/** The estimate exactly as stored on the job — the number the person is shown. */
function estimate(job: MediaApprovalJob): number {
  const n = Number(job.estimated_cost_usd);
  return Number.isFinite(n) ? n : 0;
}

/** What is approved: THIS job, at THIS estimate, on THIS model. The fingerprint is a hash of it. */
export function mediaApprovalArgs(job: MediaApprovalJob): Record<string, unknown> {
  return { job_id: job.id, mode: job.mode, model: job.model, estimated_cost_usd: estimate(job) };
}

export function mediaApprovalFingerprint(job: MediaApprovalJob): Promise<string> {
  return confirmFingerprint(mediaApprovalTool(job.mode), mediaApprovalArgs(job));
}

const money = (v: number) => (v >= 1 ? `$${v.toFixed(2)}` : `$${v.toFixed(3).replace(/0$/, "")}`);

/** The sentence the person reads — plain words, the estimate, and what they asked for. */
export function mediaApprovalSummary(job: MediaApprovalJob): string {
  const brief = String(job.params?.prompt ?? "").replace(/\s+/g, " ").trim();
  const quoted = brief ? ` — "${brief.length > 80 ? `${brief.slice(0, 79)}…` : brief}"` : "";
  const what = job.mode === "video"
    ? `a ${job.video_seconds ?? 5}-second video`
    : job.mode === "image_edit" ? "this image edit" : "this image";
  return `Spend about ${money(estimate(job))} to make ${what}${quoted}`;
}

/** When the proposal stops being redeemable: the end of the job's own lifetime. */
export function mediaApprovalExpiry(job: MediaApprovalJob, now = Date.now()): string | null {
  const created = job.created_at ? Date.parse(job.created_at) : now;
  const end = (Number.isFinite(created) ? created : now) + MEDIA_APPROVAL_LIFETIME_MS;
  return end > now ? new Date(end).toISOString() : null;
}

export type MediaProposal = { fingerprint: string; expires_at: string; summary: string };

/** The requester's live, server-issued proposal for this job, if one exists. */
export async function findLiveMediaProposal(db: Db, job: MediaApprovalJob): Promise<MediaProposal | null | "unavailable"> {
  if (!job.actor_id) return null;
  const { data, error } = await db.from("paige_pending_confirmations")
    .select("fingerprint,expires_at,summary")
    .eq("user_id", job.actor_id)
    .eq("tenant_id", job.tenant_id)
    .eq("tool_name", mediaApprovalTool(job.mode))
    .is("thread_id", null)
    .is("scoped_client_id", null)
    .is("consumed_at", null)
    .not("server_issued_at", "is", null)
    .not("issued_in_request", "is", null)
    .gt("expires_at", new Date().toISOString())
    .contains("args", { job_id: job.id })
    .order("server_issued_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) return "unavailable";
  return data && typeof data.fingerprint === "string"
    ? { fingerprint: data.fingerprint, expires_at: String(data.expires_at), summary: String(data.summary ?? "") }
    : null;
}

/**
 * Issue (or return the live) proposal for a job awaiting approval, addressed to its requester.
 * Mirrors the canonical mint: retire an exact expired row first (the live-row uniqueness predicate
 * includes expired-but-unconsumed rows), insert, and on a 23505 race read the winner back.
 */
export async function issueMediaProposal(
  db: Db,
  job: MediaApprovalJob,
  requestNonce: string,
): Promise<{ ok: true; proposal: MediaProposal } | { ok: false; reason: "no_requester" | "expired" | "store_unavailable" }> {
  if (!job.actor_id) return { ok: false, reason: "no_requester" };
  const expiresAt = mediaApprovalExpiry(job);
  if (!expiresAt) return { ok: false, reason: "expired" };
  const live = await findLiveMediaProposal(db, job);
  if (live === "unavailable") return { ok: false, reason: "store_unavailable" };
  if (live) return { ok: true, proposal: live };

  const tool = mediaApprovalTool(job.mode);
  const args = mediaApprovalArgs(job);
  const fingerprint = await confirmFingerprint(tool, args);
  const summary = mediaApprovalSummary(job);
  const now = new Date().toISOString();
  const scoped = (q: ReturnType<Db["from"]>) => q
    .eq("user_id", job.actor_id)
    .eq("tenant_id", job.tenant_id)
    .eq("tool_name", tool)
    .eq("fingerprint", fingerprint)
    .is("thread_id", null)
    .is("scoped_client_id", null)
    .is("consumed_at", null)
    .not("server_issued_at", "is", null);

  const { error: expiredError } = await scoped(db.from("paige_pending_confirmations").update({ consumed_at: now }))
    .not("issued_in_request", "is", null)
    .lte("expires_at", now);
  if (expiredError) return { ok: false, reason: "store_unavailable" };

  let { data, error } = await db.from("paige_pending_confirmations").insert({
    user_id: job.actor_id,
    tenant_id: job.tenant_id,
    thread_id: null,
    scoped_client_id: null,
    tool_name: tool,
    fingerprint,
    issued_in_request: requestNonce,
    server_issued_at: now,
    args,
    summary,
    expires_at: expiresAt,
  }).select("fingerprint,expires_at,summary").maybeSingle();
  if (error?.code === "23505") {
    const existing = await scoped(db.from("paige_pending_confirmations").select("fingerprint,expires_at,summary"))
      .gt("expires_at", new Date().toISOString())
      .maybeSingle();
    data = existing.data;
    error = existing.error;
  }
  if (error || !data) return { ok: false, reason: "store_unavailable" };
  return { ok: true, proposal: { fingerprint, expires_at: String(data.expires_at ?? expiresAt), summary: String(data.summary ?? summary) } };
}

/**
 * Redeem the requester's proposal — once. The same compare-and-set every canonical door uses:
 * bound to the CALLER (`user_id` — so only the person who asked can approve), the server-resolved
 * tenant, this capability, the echoed fingerprint, NULL thread/client scope, unconsumed, trusted
 * issuance, unexpired, and minted by an EARLIER request. The stored args must still name this job
 * at its current estimate, or nothing is approved.
 */
export async function claimMediaProposal(
  db: Db,
  input: { job: MediaApprovalJob; callerId: string; tenantId: string; fingerprint: string; requestNonce: string },
): Promise<"claimed" | "not_claimable" | "unavailable"> {
  const { job } = input;
  const { data, error } = await db.from("paige_pending_confirmations")
    .update({ consumed_at: new Date().toISOString() })
    .eq("user_id", input.callerId)
    .eq("tenant_id", input.tenantId)
    .eq("tool_name", mediaApprovalTool(job.mode))
    .eq("fingerprint", input.fingerprint)
    .is("thread_id", null)
    .is("scoped_client_id", null)
    .is("consumed_at", null)
    .not("server_issued_at", "is", null)
    .not("issued_in_request", "is", null)
    .neq("issued_in_request", input.requestNonce)
    .gt("expires_at", new Date().toISOString())
    .contains("args", { job_id: job.id })
    .select("args")
    .maybeSingle();
  if (error) return "unavailable";
  const stored = data?.args && typeof data.args === "object" ? data.args as Record<string, unknown> : null;
  if (!stored) return "not_claimable";
  const expected = mediaApprovalArgs(job);
  for (const key of Object.keys(expected)) {
    if (stored[key] !== expected[key]) return "not_claimable";
  }
  return "claimed";
}

/**
 * Retire every live proposal for a job that was declined or cancelled, so it can never be redeemed.
 * The decline is recorded the way the canonical decline records it — `consumed_at` — scoped to the
 * job's requester (read from the job row, never the request), its tenant and its capability.
 */
export async function retireMediaProposals(db: Db, job: MediaApprovalJob): Promise<boolean> {
  if (!job.actor_id) return true;
  const { error } = await db.from("paige_pending_confirmations")
    .update({ consumed_at: new Date().toISOString() })
    .eq("user_id", job.actor_id)
    .eq("tenant_id", job.tenant_id)
    .eq("tool_name", mediaApprovalTool(job.mode))
    .is("thread_id", null)
    .is("scoped_client_id", null)
    .is("consumed_at", null)
    .not("server_issued_at", "is", null)
    .contains("args", { job_id: job.id });
  return !error;
}

export const REQUESTER_ONLY_MESSAGE = (mode: string) =>
  `Only the person who asked for this ${mode === "video" ? "video" : "image"} can approve its cost. You can decline it.`;

/** What a caller may know about a pending approval. The fingerprint goes to the requester only. */
export type MediaApprovalView = {
  requested_by_you: boolean;
  requester_name: string | null;
  fingerprint?: string;
  expires_at?: string;
  summary?: string;
};

export function mediaApprovalView(
  job: MediaApprovalJob,
  callerId: string,
  requesterName: string | null,
  proposal: MediaProposal | null,
): MediaApprovalView {
  const mine = !!job.actor_id && job.actor_id === callerId;
  return {
    requested_by_you: mine,
    requester_name: mine ? null : requesterName,
    ...(mine && proposal ? { fingerprint: proposal.fingerprint, expires_at: proposal.expires_at, summary: proposal.summary } : {}),
  };
}
