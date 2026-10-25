import { useState } from "react";
import type { TeamMemberRecord } from "@/solo/team-workspace-contract";
import { OperationsDeliveryInspection } from "./OperationsDeliveryInspection";
import { OperationsStaffDeliveryReview } from "./OperationsStaffDeliveryReview";
import { releaseReviewers, type ReleaseItem } from "./operations-item-release";

/** The original work-item delivery inspection: active canonical owner review or a nominated teammate,
 * then separate client release and decision. Native Operations writers remain authoritative. */

export function OperationsItemRelease({ actorId, tenantId, item, members, peopleReady, theme, registerCloseGuard, onSubmitted }: {
  actorId: string; tenantId: string; item: ReleaseItem & { plan_id: string; contact_id: string; updated_at: string };
  members: TeamMemberRecord[]; peopleReady: boolean; theme: string;
  registerCloseGuard?:(guard:(showNotice?:boolean)=>boolean)=>()=>void; onSubmitted?:()=>void;
}) {
  const scope = { actorId, tenantId, workItemId: item.id, planId: item.plan_id, clientId: item.contact_id, workUpdatedAt: item.updated_at };
  const reviewers = releaseReviewers(members, actorId);
  const ownerReviewAvailable = reviewers.some(member => member.user_id === actorId && member.is_owner === true);
  // A verified submission is read again by the review below (it owns its own readback; this only remounts it).
  const [submitted, setSubmitted] = useState(0);
  const single = peopleReady && reviewers.length === 0;
  return (
    <section className="ops-item-release" aria-label="Release this work to the client" aria-busy={!peopleReady || undefined}>
      <div className="ops-item-release-head">
        <h2>Release work to this client</h2>
        {!single && <p>{ownerReviewAvailable?"Review the exact version yourself or choose a teammate; then release it for the client’s separate decision.":"A teammate reviews the exact version first; then you release it and the client records their decision."}</p>}
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
        <OperationsDeliveryInspection key={`inspection:${JSON.stringify(scope)}:${submitted}`} scope={scope} members={members} theme={theme}
          initialMode="preparation" registerCloseGuard={registerCloseGuard}
          onSubmitted={() => { setSubmitted(n => n + 1); onSubmitted?.(); }} />
      )}
      {peopleReady && single && <OperationsStaffDeliveryReview key={`review:${JSON.stringify(scope)}:${submitted}`} scope={scope} members={members} theme={theme}
        recordedOnly registerCloseGuard={registerCloseGuard} />}
    </section>
  );
}
