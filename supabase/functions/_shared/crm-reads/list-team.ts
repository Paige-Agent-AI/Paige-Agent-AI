// THE TEAM ROSTER READ — one home for every Paige surface that lists who is on a workspace's team.
//
// EXP08 A2b (plan S2): moved out of paige-ai-chat's `crm_list_team` branch, byte for byte, so the
// Team Hub agent turn resolves "hand it to Priya" through the same read the chat uses (§18). The
// chat's behaviour is unchanged (§58): ./list-team.test.ts runs the code as it stood in the chat and
// this helper against the same fake and asserts the same request and the same result.
//
// Scope (§9/§59): the client is the CALLER'S own session, never the service role. The read is the
// SECURITY DEFINER `list_team_members`, which re-proves the caller's tenant in its own body and
// returns `user_id, name, role, status` only — no email (migration 20260711160000). `tenantId` is
// the server-derived workspace (or null, which the definer pins to the caller's own tenant).

/** The rpc subset this read uses. A supabase-js client satisfies it structurally. */
export interface CrmTeamListClient {
  rpc(name: string, args?: Record<string, unknown>): PromiseLike<{ data: unknown; error: unknown }>;
}

export type CrmTeamListResult = { success: true; count: number; members: unknown };

/** List the workspace's team. Throws the rpc's own error object, exactly as the chat branch did. */
export async function listCrmTeam(caller: CrmTeamListClient, tenantId: string | null): Promise<CrmTeamListResult> {
  const { data, error } = await caller.rpc("list_team_members", {
    p_tenant_id: tenantId,
  });
  if (error) throw error;
  // deno-lint-ignore no-explicit-any
  return { success: true, count: (data as any[])?.length ?? 0, members: data ?? [] };
}
