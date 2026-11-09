/** Bounded model projection of the ORIGINAL Plan; not a new reader or authority. */
export function planningModelPlans(plans: unknown[]): unknown[] {
  return plans.map(raw => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return raw;
    const plan = raw as Record<string, unknown>;
    const metadata = plan.metadata as Record<string, unknown> | null;
    if (!metadata || typeof metadata !== "object" || !metadata.weekly_plan_review_v1) return raw;
    const saved = metadata.weekly_plan_review_v1 as { review?: { v?: unknown; included?: unknown } };
    const included = saved.review?.included;
    const { weekly_plan_review_v1: _privateReview, ...other } = metadata;
    if (saved.review?.v !== 1 || !Array.isArray(included) || included.length < 1 || included.length > 40 || new Set(included).size !== included.length || included.some(k => typeof k !== "string" || !/^(crm|planning):[0-9a-f-]{36}$/i.test(k))) return { ...plan, metadata: other, weekly_plan_review: { note: "Saved weekly review references are unverified. Inspect the original Plan; do not infer accepted work or execution." } };
    return { ...plan, metadata: other, weekly_plan_review: { original_work_references: included,
      note: "Owner-reviewed saved plan references, not executed work. Read the permitted original Tasks/Planning records to report current names/status; no copied source facts or free Calendar capacity are implied." } };
  });
}
export const WEEKLY_PLAN_REVIEW_NOTE = "To build or correct a source-backed weekly plan, use the Review and save weekly plan link in Operations. The owner confirms the goal, available net hours, effort and dependencies there before explicit Save. This read saved or changed nothing. A generic plan is not proof of a reviewed workload or executed work.";
