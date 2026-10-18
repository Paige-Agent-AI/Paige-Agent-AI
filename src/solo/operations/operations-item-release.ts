import type { PlanItem } from "@/hooks/usePlanList";
import type { TeamMemberRecord } from "@/solo/team-workspace-contract";

/**
 * E09 Slice 4 (4B) — the ONE gate for releasing work to a client, shared by the work item that releases it and
 * by every surface that talks about it (the Delivery "Client outcome" line), so nothing promises a release the
 * work item would not offer.
 *   1. the business is a standalone, top-level business (owner decision D3; the server refuses the rest);
 *   2. the work is client work inside a project, with a row version (canReleaseItem);
 *   3. someone other than the person releasing can review it (owner decision D2; the server refuses self-review).
 */
export type ReleaseItem = Pick<PlanItem, "id" | "plan_id" | "contact_id" | "updated_at">;

export function releasesAvailable(soloStandalone: boolean): boolean {
  return soloStandalone === true;
}

export function canReleaseItem(item: ReleaseItem | null | undefined): item is ReleaseItem & { plan_id: string; contact_id: string; updated_at: string } {
  return Boolean(item?.plan_id && item.contact_id && item.updated_at && Number.isFinite(Date.parse(item.updated_at)));
}

/** People who could review a release by this actor: active, and not the actor. */
export function releaseReviewers(members: TeamMemberRecord[], actorId: string | null | undefined): TeamMemberRecord[] {
  return members.filter(member => member.status === "active" && Boolean(actorId) && member.user_id !== actorId);
}
