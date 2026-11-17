/** Presentation of ORIGINAL saved references only; no execution/completion claim. */
export function weeklyPlanReferenceCount(plan: { metadata?: unknown }): number | null {
  const metadata = plan.metadata as { weekly_plan_review_v1?: { review?: { v?: unknown; included?: unknown } } } | null;
  const review = metadata?.weekly_plan_review_v1?.review;
  if (review?.v !== 1 || !Array.isArray(review.included) || review.included.length < 1 || review.included.length > 40
    || new Set(review.included).size !== review.included.length || review.included.some(key => typeof key !== "string" || !/^(crm|planning):[0-9a-f-]{36}$/i.test(key))) return null;
  return review.included.length;
}
