import { supabase } from "@/integrations/supabase/client";
export type DeliverySourceScope = { actorId: string; tenantId: string };
export type DeliverySourceCaller = { getActor: () => Promise<string | null>; getTenant: () => Promise<string | null>; rpc: (name: string, args: Record<string, unknown>) => PromiseLike<{data: unknown; error: unknown}> };
export type DeliverySourceSession = { id: string; title: string; artifacts: Array<{id: string; title: string}> };
export type DeliverySourceVersion = { id: string; versionNo: number; title: string; body: string; createdAt: string };
type Unavailable = {kind: "unavailable" | "refused" | "scope_changed"};
const uuid = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value);
const object = (value: unknown): Record<string, unknown> | null => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
const text = (value: unknown, limit: number): value is string => typeof value === "string" && value.length <= limit;
const validScope = (scope: DeliverySourceScope) => uuid(scope.actorId) && uuid(scope.tenantId);

/** Read existing Studio contracts as the real caller; do not turn a refusal into empty work. */
export async function readDeliverySourceSessions(caller: DeliverySourceCaller, scope: DeliverySourceScope, current: () => boolean): Promise<{kind:"ready";sessions:DeliverySourceSession[]} | Unavailable> {
  if (!current()) return {kind:"scope_changed"};
  if (!validScope(scope)) return {kind:"unavailable"};
  try {
    if (await caller.getActor() !== scope.actorId || await caller.getTenant() !== scope.tenantId) return {kind:"refused"};
    if (!current()) return {kind:"scope_changed"};
    const reply = await caller.rpc("list_studio_sessions", {p_filter:"recent",p_tenant_id:scope.tenantId,p_limit:40});
    if (!current()) return {kind:"scope_changed"};
    if (reply.error || !Array.isArray(reply.data)) return {kind:"unavailable"};
    const sessions: DeliverySourceSession[] = [], ids = new Set<string>();
    for (const value of reply.data) {
      const row = object(value);
      if (!row || !uuid(row.id) || row.tenant_id !== scope.tenantId || !text(row.title,2000) || !Array.isArray(row.artifact_refs) || ids.has(row.id)) return {kind:"unavailable"};
      ids.add(row.id);
      const artifacts: DeliverySourceSession["artifacts"] = [], refs = new Set<string>();
      for (const raw of row.artifact_refs) {
        const ref = object(raw);
        if (!ref || !uuid(ref.id) || typeof ref.kind !== "string" || !["page","form","funnel","content"].includes(ref.kind) || !text(ref.title,2000)) return {kind:"unavailable"};
        if (ref.kind !== "content") continue;
        if (refs.has(ref.id)) return {kind:"unavailable"};
        refs.add(ref.id); artifacts.push({id:ref.id,title:ref.title});
      }
      sessions.push({id:row.id,title:row.title,artifacts});
    }
    if (await caller.getActor() !== scope.actorId || await caller.getTenant() !== scope.tenantId) return {kind:"refused"};
    return current() ? {kind:"ready",sessions} : {kind:"scope_changed"};
  } catch { return {kind:current()?"unavailable":"scope_changed"}; }
}

/** Client projection supports text only. Other saved kinds stay visibly unsupported. */
export async function readDeliverySourceVersions(caller: DeliverySourceCaller, scope: DeliverySourceScope, sessionId: string, artifactId: string, current: () => boolean): Promise<{kind:"ready";versions:DeliverySourceVersion[];unsupportedCount:number} | Unavailable> {
  if (!current()) return {kind:"scope_changed"};
  if (!validScope(scope) || !uuid(sessionId) || !uuid(artifactId)) return {kind:"unavailable"};
  try {
    if (await caller.getActor() !== scope.actorId || await caller.getTenant() !== scope.tenantId) return {kind:"refused"};
    if (!current()) return {kind:"scope_changed"};
    const reply = await caller.rpc("list_artifact_versions", {p_session_id:sessionId,p_kind:"content",p_artifact_id:artifactId,p_tenant_id:scope.tenantId});
    if (!current()) return {kind:"scope_changed"};
    if (reply.error || !Array.isArray(reply.data)) return {kind:"unavailable"};
    const versions: DeliverySourceVersion[] = [], ids = new Set<string>(), numbers = new Set<number>();
    let unsupportedCount=0;
    for (const value of reply.data) {
      const row=object(value), snapshot=object(row?.snapshot);
      if (!row || !uuid(row.id) || row.tenant_id!==scope.tenantId || row.session_id!==sessionId || row.lineage_id!==artifactId || row.kind!=="content"
        || !Number.isSafeInteger(row.version_no) || Number(row.version_no)<1 || !text(row.created_at,80) || !Number.isFinite(Date.parse(row.created_at))
        || ids.has(row.id) || numbers.has(Number(row.version_no)) || !snapshot) return {kind:"unavailable"};
      ids.add(row.id); numbers.add(Number(row.version_no));
      if(snapshot.kind!=="text") {unsupportedCount++;continue;}
      if(!text(snapshot.title,2000) || !text(snapshot.body,200000)) return {kind:"unavailable"};
      versions.push({id:row.id,versionNo:Number(row.version_no),title:snapshot.title,body:snapshot.body,createdAt:row.created_at});
    }
    if (await caller.getActor()!==scope.actorId || await caller.getTenant()!==scope.tenantId) return {kind:"refused"};
    return current() ? {kind:"ready",versions:versions.sort((a,b)=>b.versionNo-a.versionNo),unsupportedCount} : {kind:"scope_changed"};
  } catch {return {kind:current()?"unavailable":"scope_changed"};}
}

export const deliverySourceCaller: DeliverySourceCaller = {
  getActor: async () => { const result=await supabase.auth.getSession(); return result.error?null:result.data.session?.user.id??null; },
  getTenant: async () => { const result=await supabase.rpc("current_user_tenant_id"); return !result.error&&typeof result.data==="string"?result.data:null; },
  rpc: (name,args) => (supabase as unknown as Pick<DeliverySourceCaller,"rpc">).rpc(name,args),
};
