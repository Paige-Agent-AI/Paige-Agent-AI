import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { saveWeeklyPlanReview, type WeeklyPlanSaveResult } from "./operations-weekly-plan-save";
import { useTenantContext } from "@/hooks/useTenantContext";
import { workspaceLinkTarget } from "@/lib/links/workspaceLinks";
import { CheckLinks } from "@/components/chat/CheckLinks";
import { createWeeklyDraftDeadline } from "../../../supabase/functions/_shared/paige-orchestration/weekly-draft-deadline";
const uuid = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
/** Read only: the saved native identity, never approval or a create retry. */
export function OperationsWeeklyPlanReceipt({ actorId, tenantId, planId }: { actorId: string; tenantId: string; planId: string }) {
  const { activeTenant } = useTenantContext();
  const [state, setState] = useState<"reading" | "ordinary" | "unavailable" | "verified">("reading");
  const [result, setResult] = useState<Extract<WeeklyPlanSaveResult, { kind: "verified" }> | null>(null);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let current = true; setState("reading"); setResult(null);
    const stage = createWeeklyDraftDeadline(8000, () => current);
    void (async () => {
      const read = await stage(() => supabase.from("plans").select("id,tenant_id,created_by,metadata").eq("id", planId).eq("tenant_id", tenantId).maybeSingle());
      if (!current) return;
      if (read.error || !read.data || read.data.id !== planId || read.data.tenant_id !== tenantId) { setState("unavailable"); return; }
      const metadata = read.data.metadata as { weekly_plan_review_v1?: { request_id?: unknown } } | null;
      if (!metadata?.weekly_plan_review_v1) { setState("ordinary"); return; }
      if (!uuid(metadata.weekly_plan_review_v1.request_id) || read.data.created_by !== actorId) { setState("unavailable"); return; }
      const answer = await saveWeeklyPlanReview({ actorId, tenantId }, null, () => current, metadata.weekly_plan_review_v1.request_id);
      if (!current) return;
      if (answer.kind !== "verified" || answer.planId !== planId) { setState("unavailable"); return; }
      setResult(answer); setState("verified");
    })().catch(() => { if (current) setState("unavailable"); });
    return () => { current = false; };
  }, [actorId, tenantId, planId, retry]);
  if (state === "ordinary") return null;
  return <section className="ops-work-activity" aria-label="Original weekly plan receipt"><h2>Weekly plan receipt</h2>
    {state === "reading" ? <p role="status">Checking the original Planning receipt…</p> : state === "unavailable" ? <p role="status">This receipt could not be verified for your current identity. The saved plan is shown separately. <button type="button" onClick={() => setRetry(n => n + 1)}>Check receipt again</button></p>
      : <><p>Original Planning save verified. This records the accepted plan; it does not prove that its tasks were executed or Calendar time reserved.</p>
        <h3>Current original commitments</h3><ol>{result?.currentWork.map(row => {
          if (row.state === "unavailable") return <li key={row.key}>Original work is unavailable. No replacement has been created.</li>;
          const target = activeTenant?.id === tenantId ? workspaceLinkTarget({ destination: "operations_work", record_id: row.id, ...(row.source === "planning" ? { record_kind: "planning_item" as const } : {}) }, activeTenant) : null;
          return <li key={row.key}><strong>{row.title}</strong><p>{row.status.replace(/_/g, " ")}{row.dueAt ? ` · Current deadline ${new Date(row.dueAt).toLocaleString("en-US", { timeZone: result.reviewZone })} (${result.reviewZone})` : " · No current saved deadline"}</p>
            {row.changedSinceReview && <p>This work changed since the plan was saved. Inspect its current details before acting.</p>}
            {target && <CheckLinks links={[{ label: "Open original work", to: target.to }]} />}</li>;
        })}</ol>
        <details><summary>Receipt reference</summary><p>Planning receipt: {result?.receiptId}</p></details></>}
  </section>;
}
