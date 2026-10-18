import { useState } from "react";
import type { TeamMemberRecord } from "@/solo/team-workspace-contract";
import { OperationsDeliverablePreparation } from "./OperationsDeliverablePreparation";
import { OperationsStaffDeliveryReview } from "./OperationsStaffDeliveryReview";
import { releaseReviewers, type ReleaseItem } from "./operations-item-release";

/**
 * E09 Slice 4 (4B) — releasing finished work to a client, in the Operations work-item detail.
 *
 * Mounts the existing delivery controls: preparation (submit an exact Studio text version and nominate a reviewer)
 * and review (internal review, release to the client, and the client's recorded decision). Their writers are the
 * canonical operations_delivery_* RPCs, which accept only standalone, top-level businesses (owner decision D3) and
 * require a reviewer who is not the submitter.
 *
 * One heading owns the whole flow, so the sheet reads as one step ("Release work to this client") with the
 * preparation and the review as its parts, not as two competing page-sized headings.
 *
 * Owner decision D2: when nobody else on the team can review, say so plainly instead of offering a reviewer picker
 * with no one in it — and don't follow it with "nominate a reviewer" advice that contradicts it. The recorded state
 * still shows whenever something IS recorded, so a release made while a second person was on the team is never
 * hidden.
 */

export function OperationsItemRelease({ actorId, tenantId, item, members, peopleReady, theme }: {
  actorId: string; tenantId: string; item: ReleaseItem & { plan_id: string; contact_id: string; updated_at: string };
  members: TeamMemberRecord[]; peopleReady: boolean; theme: string;
}) {
  const scope = { actorId, tenantId, workItemId: item.id, planId: item.plan_id, clientId: item.contact_id, workUpdatedAt: item.updated_at };
  const reviewers = releaseReviewers(members, actorId);
  // A verified submission is read again by the review below (it owns its own readback; this only remounts it).
  const [submitted, setSubmitted] = useState(0);
  const single = peopleReady && reviewers.length === 0;
  return (
    <section className="ops-item-release" aria-label="Release this work to the client" aria-busy={!peopleReady || undefined}>
      <div className="ops-item-release-head">
        <h2>Release work to this client</h2>
        {!single && <p>A teammate reviews the exact version first; then you release it and the client records their decision.</p>}
      </div>
      {!peopleReady ? (
        <>
          <span className="sr-only" role="status">Checking who on your team can review this work…</span>
          <div className="ops-item-release-skeleton" aria-hidden="true"><i /><i /><i /></div>
        </>
      ) : single ? (
        <div className="ops-item-release-single" role="note">
          <p>Releasing work needs a second person on your team to review it.</p>
          <p>Until then, you can share a finished file with this client from their client record.</p>
        </div>
      ) : (
        <OperationsDeliverablePreparation key={`prepare:${JSON.stringify(scope)}`} scope={scope} members={members} theme={theme}
          onSubmitted={() => setSubmitted(n => n + 1)} />
      )}
      {peopleReady && <OperationsStaffDeliveryReview key={`review:${JSON.stringify(scope)}:${submitted}`} scope={scope} members={members} theme={theme}
        recordedOnly={single} />}
    </section>
  );
}
