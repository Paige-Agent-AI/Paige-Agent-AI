import { supabase } from "@/integrations/supabase/client";
import { normalizeHandoffAcknowledgement, type prepareEngagementHandoff } from "./operations-engagement-handoff";
type Request = NonNullable<ReturnType<typeof prepareEngagementHandoff>>;
export type HandoffWriteResult = { kind: "verified"; planId: string; milestoneIds: string[]; replayed: boolean }
  | { kind: "refused"; message: string } | { kind: "uncertain"; planId?: string; message: string };
const instantEqual = (a: unknown, b: string) => typeof a === "string" && Date.parse(a) === Date.parse(b);

/** Original frozen request only. No automatic retry, approval channel, provider or client acceptance. */
export async function writeEngagementHandoff(request: Request): Promise<HandoffWriteResult> {
  let planId: string | undefined;
  const uncertain = (): HandoffWriteResult => ({ kind: "uncertain", planId,
    message: "The handoff could not be confirmed. Inspect the original engagement and project before trying again." });
  try {
    const before = await supabase.auth.getSession();
    if (before.error || before.data.session?.user.id !== request.p_expected_actor_id) return {
      kind: "refused", message: "Your account changed. Review the commitment in your current workspace." };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- bounded new RPC awaits generated schema types
    const { data, error } = await (supabase as any).rpc("operations_engagement_handoff", request);
    if (error) return ["42501", "22023", "23514", "40001"].includes(error.code)
      ? { kind: "refused", message: "The source or reviewed scope changed, or this handoff is not allowed. Inspect current records." } : uncertain();
    const ack = normalizeHandoffAcknowledgement(data,request.p_expected_actor_id,request.p_expected_tenant_id,request.p_milestones.length);
    if (!ack) return uncertain();
    planId = ack.planId;
    const project = await supabase.from("plans").select("id,tenant_id,title,summary,owner_user_id,starts_on,ends_on,metadata")
      .eq("id",ack.planId).eq("tenant_id",request.p_expected_tenant_id).maybeSingle();
    const work = await supabase.from("plan_items").select("id,tenant_id,plan_id,item_type,title,summary,assigned_to_user_id,priority,due_at,contact_id,metadata")
      .eq("tenant_id",request.p_expected_tenant_id).eq("plan_id",ack.planId).in("id",ack.milestoneIds);
    const after = await supabase.auth.getSession();
    if (project.error || work.error || after.error || after.data.session?.user.id !== request.p_expected_actor_id
      || !project.data || !Array.isArray(work.data) || work.data.length !== ack.milestoneIds.length) return uncertain();
    const p = project.data;
    const source = p.metadata && typeof p.metadata === "object" && !Array.isArray(p.metadata)
      ? p.metadata.operations_engagement : null;
    if (!source || typeof source !== "object" || Array.isArray(source)
      || p.id !== ack.planId || p.tenant_id !== request.p_expected_tenant_id || p.title !== request.p_title
      || p.summary !== request.p_summary || p.owner_user_id !== request.p_owner_user_id
      || p.starts_on !== request.p_starts_on || p.ends_on !== request.p_ends_on
      || source.agreement_id !== request.p_agreement_id || source.version !== request.p_expected_version
      || source.request_id !== request.p_request_id || source.content_sha256 !== request.p_expected_content_sha256
      || source.sealed_sha256 !== request.p_expected_sealed_sha256
      || !instantEqual(source.terms_updated_at,request.p_expected_terms_updated_at)
      || source.contact_id !== request.p_expected_contact_id
      || source.commercial_terms_id !== request.p_expected_terms_id || source.offer_id !== request.p_expected_offer_id) return uncertain();
    for (let i = 0; i < ack.milestoneIds.length; i++) {
      const row = work.data.find(item => item.id === ack.milestoneIds[i]); const expected = request.p_milestones[i];
      const provenance = row?.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata)
        ? row.metadata.operations_engagement : null;
      if (!row || row.tenant_id !== request.p_expected_tenant_id || row.plan_id !== ack.planId || row.item_type !== "milestone"
        || row.title !== expected.title || row.summary !== expected.summary || row.assigned_to_user_id !== expected.assigned_to_user_id
        || row.priority !== expected.priority || row.contact_id !== source.contact_id
        || (expected.due_at === null ? row.due_at !== null : !instantEqual(row.due_at,expected.due_at))
        || !provenance || typeof provenance !== "object" || Array.isArray(provenance)
        || provenance.agreement_id !== request.p_agreement_id || provenance.version !== request.p_expected_version
        || provenance.commercial_terms_id !== source.commercial_terms_id) return uncertain();
    }
    return { kind: "verified", planId: ack.planId, milestoneIds: ack.milestoneIds, replayed: ack.replayed };
  } catch { return uncertain(); }
}
