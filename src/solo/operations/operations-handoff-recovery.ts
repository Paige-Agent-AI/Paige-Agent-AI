import { supabase } from "@/integrations/supabase/client";
import type { prepareEngagementHandoff } from "./operations-engagement-handoff";
type Request = NonNullable<ReturnType<typeof prepareEngagementHandoff>>;
export type HandoffRecovery = { kind: "verified"; planId: string; milestoneIds: string[] }
  | { kind: "not_found" | "refused" | "unavailable"; message: string };
const uuid = (s: unknown): s is string => typeof s === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
const sameInstant = (a: unknown,b: string) => typeof a === "string" && Date.parse(a) === Date.parse(b);

/** Read-only recovery of the original intent; never creates or replays work. */
export async function inspectOriginalHandoff(request: Request): Promise<HandoffRecovery> {
  const unavailable = (): HandoffRecovery => ({kind:"unavailable",message:"The original handoff could not be confirmed. Keep this request and inspect current work before retrying."});
  try {
    const before = await supabase.auth.getSession();
    if (before.error || before.data.session?.user.id !== request.p_expected_actor_id) return {kind:"refused",message:"Return to the original account to inspect this handoff."};
    const read = await supabase.from("plans").select("id,tenant_id,title,summary,owner_user_id,starts_on,ends_on,metadata")
      .eq("tenant_id",request.p_expected_tenant_id).contains("metadata",{operations_engagement:{request_id:request.p_request_id,agreement_id:request.p_agreement_id}}).maybeSingle();
    if (read.error) return unavailable();
    const p=read.data;
    if (!p) return {kind:"not_found",message:"No readable project confirms this original request. This does not establish that the earlier write failed; do not create a replacement."};
    const source = p.metadata && typeof p.metadata === "object" && !Array.isArray(p.metadata) ? p.metadata.operations_engagement : null;
    if (!uuid(p.id) || p.tenant_id !== request.p_expected_tenant_id || p.title !== request.p_title || p.summary !== request.p_summary
      || p.owner_user_id !== request.p_owner_user_id || p.starts_on !== request.p_starts_on || p.ends_on !== request.p_ends_on
      || !source || typeof source !== "object" || Array.isArray(source)
      || source.agreement_id !== request.p_agreement_id || source.request_id !== request.p_request_id
      || source.contact_id !== request.p_expected_contact_id || source.offer_id !== request.p_expected_offer_id
      || source.commercial_terms_id !== request.p_expected_terms_id || source.version !== request.p_expected_version
      || source.content_sha256 !== request.p_expected_content_sha256 || source.sealed_sha256 !== request.p_expected_sealed_sha256
      || !sameInstant(source.terms_updated_at,request.p_expected_terms_updated_at)
      || !Array.isArray(source.milestone_ids) || source.milestone_ids.length !== request.p_milestones.length
      || !source.milestone_ids.every(uuid) || new Set(source.milestone_ids).size !== request.p_milestones.length) return unavailable();
    const ids = source.milestone_ids as string[];
    const work = await supabase.from("plan_items").select("id,tenant_id,plan_id,item_type,title,summary,assigned_to_user_id,priority,due_at,contact_id,metadata")
      .eq("tenant_id",request.p_expected_tenant_id).eq("plan_id",p.id).in("id",ids);
    const after = await supabase.auth.getSession();
    if (work.error || after.error || after.data.session?.user.id !== request.p_expected_actor_id || !Array.isArray(work.data) || work.data.length !== ids.length) return unavailable();
    for(let i=0;i<ids.length;i++) {
      const row=work.data.find(item=>item.id===ids[i]);const expected=request.p_milestones[i];
      const provenance=row?.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata) ? row.metadata.operations_engagement : null;
      if (!row || row.tenant_id !== request.p_expected_tenant_id || row.plan_id !== p.id || row.item_type !== "milestone"
        || row.title !== expected.title || row.summary !== expected.summary || row.assigned_to_user_id !== expected.assigned_to_user_id
        || row.priority !== expected.priority || row.contact_id !== request.p_expected_contact_id
        || (expected.due_at===null ? row.due_at!==null : !sameInstant(row.due_at,expected.due_at))
        || !provenance || typeof provenance !== "object" || Array.isArray(provenance)
        || provenance.agreement_id !== request.p_agreement_id || provenance.commercial_terms_id !== request.p_expected_terms_id
        || provenance.version !== request.p_expected_version) return unavailable();
    }
    return {kind:"verified",planId:p.id,milestoneIds:ids};
  } catch {return unavailable();}
}
