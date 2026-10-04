// An image (or video) Paige started in this project that is waiting on its cost approval, shown in
// the project's chat. Owner ruling 2026-10-04 — "Requester approves, any admin can decline": the
// person who asked sees Approve and Decline; anyone else sees who asked and can only decline. The
// server enforces the same rule (paige-media approve refuses anyone but the requester), so this is
// the honest shape of what each person can do, not the guard.
import React from "react";
import type { MediaApprovalState, MediaJob } from "../useMediaJobs";

type MediaApprovalActions = {
  approve: (jobId: string) => Promise<boolean>;
  decline: (jobId: string) => Promise<boolean>;
  approvalFor: (job: MediaJob) => MediaApprovalState;
};

export function MediaApprovalCard({ job, media }: { job: MediaJob; media: MediaApprovalActions }) {
  const [busy, setBusy] = React.useState<"approve" | "decline" | null>(null);
  const { requestedByYou, requesterName } = media.approvalFor(job);
  const what = job.mode === "video" ? "video" : "image";
  const who = requesterName ?? "the person who asked";
  const prompt = String((job.params as Record<string, unknown> | null)?.prompt ?? "").slice(0, 90);

  const run = async (kind: "approve" | "decline") => {
    if (busy) return;
    setBusy(kind);
    try {
      await (kind === "approve" ? media.approve(job.id) : media.decline(job.id));
    } finally {
      setBusy(null);
    }
  };

  const heading = requestedByYou === true
    ? `${what === "video" ? "A video" : "An image"} needs your approval`
    : requestedByYou === false
      ? `Waiting for ${who} to approve`
      : `${what === "video" ? "A video" : "An image"} is waiting for approval`;

  return (
    <div
      className="vs-approval"
      role="group"
      data-approver={requestedByYou === true ? "you" : requestedByYou === false ? "someone-else" : "unknown"}
      aria-label={requestedByYou === true ? `${what === "video" ? "Video" : "Image"} waiting for your approval` : `${what === "video" ? "Video" : "Image"} waiting for approval`}
      aria-busy={busy !== null}
    >
      <b>{heading}</b>
      <span style={{ color: "var(--vs-dim)" }}>{prompt}</span>
      <span className="vs-approval-cost">About <strong>${Number(job.estimated_cost_usd ?? 0).toFixed(2)}</strong> to make</span>
      {requestedByYou !== true && (
        <span style={{ color: "var(--vs-dim)", lineHeight: 1.5 }}>
          {requestedByYou === false ? "Only they" : "Only the person who asked"} can approve the cost. You can decline it.
        </span>
      )}
      <div style={{ display: "flex", gap: 8 }}>
        {requestedByYou === true && (
          <button type="button" className="vs-btn vs-btn-gold" disabled={busy !== null} onClick={() => void run("approve")}>
            {busy === "approve" ? "Approving…" : "Approve and make it"}
          </button>
        )}
        <button
          type="button"
          className={requestedByYou === true ? "vs-btn vs-btn-quiet" : "vs-btn"}
          disabled={busy !== null}
          onClick={() => void run("decline")}
        >
          {busy === "decline" ? "Declining…" : "Decline"}
        </button>
      </div>
    </div>
  );
}
