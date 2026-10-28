// THE CRM TASK LIST READ — one home for every Paige surface that lists a workspace's tasks.
//
// EXP08 A2b (plan S2): moved out of paige-ai-chat's `crm_list_tasks` branch, byte for byte, so the
// Team Hub agent turn can answer "which task?" through the same read the chat uses instead of a
// second query that drifts from it (§18). The chat's behaviour is unchanged (§58): the parity test
// (./list-tasks.test.ts) runs the code as it stood in the chat and this helper against the same
// fake and asserts the same wire requests and the same result.
//
// What this does NOT do: resolve a person by email. The chat keeps its `assignee_email` lookup in
// paige-ai-chat/index.ts and passes the resolved id as `assigneeUserId`; a caller that cannot or
// must not list auth users (Team Hub, plan D15) simply omits it. No I/O beyond the one query, no
// Deno globals, no SDK import, so Node and Deno both run it and its test.
//
// Scope (§9): the client is the service role in the chat (it bypasses RLS), so `tenantId` MUST be
// the server-derived workspace. The chat only reaches this after its CRM_SERVICE_TOOLS fail-closed
// guard has refused a missing tenant.

/** The columns the list returns. No email, no owner PII beyond the assignee's user id. */
export const CRM_TASK_LIST_COLUMNS = "id, title, status, due_date, track, user_id, biz_id, deal_id, source_thread_id, updated_at, created_at";

/** The query builder subset this read uses. A supabase-js client satisfies it structurally. */
export interface CrmTaskListClient {
  // deno-lint-ignore no-explicit-any
  from(table: string): any;
}

export type CrmTaskListOptions = {
  /**
   * Filter to one assignee's tasks. The chat passes the id it resolved from `assignee_email`
   * (or the all-zero id when no user matched, so the filter matches nothing). Omit for no filter.
   */
  assigneeUserId?: string;
};

export type CrmTaskListResult = { success: true; count: number; tasks: unknown[] };

/**
 * List a workspace's tasks: open ones by default, newest-due first, at most 100.
 * Throws the query's own error object, exactly as the chat branch did, so the caller's catch
 * reports it the way it always has.
 */
// deno-lint-ignore no-explicit-any
export async function listCrmTasks(admin: CrmTaskListClient, tenantId: string, args: Record<string, any>, opts: CrmTaskListOptions = {}): Promise<CrmTaskListResult> {
  const limit = Math.min(Math.max(Number(args.limit) || 25, 1), 100);
  let q = admin.from("tasks").select(CRM_TASK_LIST_COLUMNS).eq("tenant_id", tenantId);
  if (args.status && args.status !== "all") q = q.eq("status", args.status);
  else if (!args.status) q = q.neq("status", "completed");
  if (opts.assigneeUserId !== undefined) q = q.eq("user_id", opts.assigneeUserId);
  const today = new Date().toISOString().slice(0, 10);
  if (args.overdue) q = q.lt("due_date", today);
  if (args.due_within_days) {
    const end = new Date(Date.now() + Number(args.due_within_days) * 86400000).toISOString().slice(0, 10);
    q = q.gte("due_date", today).lte("due_date", end);
  }
  const { data, error } = await q.order("due_date", { ascending: true, nullsFirst: false }).limit(limit);
  if (error) throw error;
  return { success: true, count: data?.length || 0, tasks: data || [] };
}
