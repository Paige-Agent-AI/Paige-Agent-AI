import { useState } from "react";
import type { TeamMemberRecord } from "@/solo/team-workspace-contract";
import { OperationsDeliverablePreparation } from "./OperationsDeliverablePreparation";
import { OperationsStaffDeliveryReview } from "./OperationsStaffDeliveryReview";
import type { ReleaseItem } from "./operations-item-release";

/**
 * E09 Slice 4 (4B) — releasing finished work to a client, in the Operations work-item detail.
 *
 * Mounts the existing, until-now orphaned delivery controls unchanged: preparation (submit an exact Studio
 * text version and nominate a reviewer) and review (internal review, release to the client, and the
 * client's recorded decision). Their writers are the canonical operations_delivery_* RPCs, which accept only
 * standalone, top-level businesses (owner decision D3) and require a reviewer who is not the submitter.
 *
 * Owner decision D2: when nobody else on the team can review, say so plainly instead of offering a
 * reviewer picker with no one in it. The recorded state still shows, so a release made while a second
 * person was on the team is never hidden.
 */

export function OperationsItemRelease({ actorId, tenantId, item, members, peopleReady, theme }: {
  actorId: string; tenantId: string; item: ReleaseItem & { plan_id: string; contact_id: string; updated_at: string };
  members: TeamMemberRecord[]; peopleReady: boolean; theme: string;
}) {
  const scope = { actorId, tenantId, workItemId: item.id, planId: item.plan_id, clientId: item.contact_id, workUpdatedAt: item.updated_at };
  const reviewers = members.filter(member => member.status === "active" && member.user_id !== actorId);
  // A verified submission is read again by the review below (it owns its own readback; this only remounts it).
  const [submitted, setSubmitted] = useState(0);
  return (
    <section className="ops-item-release" aria-label="Release this work to the client">
      {!peopleReady ? (
        <p role="status">Checking who on your team can review this work…</p>
      ) : reviewers.length === 0 ? (
        <div className="ops-item-release-single" role="note">
          <h2>Release work to this client</h2>
          <p>Releasing work needs a second person on your team to review it.</p>
          <p>Until then, you can share a finished file with this client from their client record.</p>
        </div>
      ) : (
        <OperationsDeliverablePreparation key={`prepare:${JSON.stringify(scope)}`} scope={scope} members={members} theme={theme}
          onSubmitted={() => setSubmitted(n => n + 1)} />
      )}
      <OperationsStaffDeliveryReview key={`review:${JSON.stringify(scope)}:${submitted}`} scope={scope} members={members} theme={theme} />
    </section>
  );
}
