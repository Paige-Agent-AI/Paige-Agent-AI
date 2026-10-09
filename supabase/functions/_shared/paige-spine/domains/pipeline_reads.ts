import type { SpineCapability } from "../contracts.ts";

/** Incumbent Pipeline-owned catalogue and archive preparations. Legacy sales
 * discovery family is preserved. Preparation tokens are preconditions, not approval.
 * Callable metadata does not establish authenticated acceptance or activate dispatch.
 */
export const PIPELINE_READ_CAPABILITIES = [
  { key: "sales.pipeline_catalogue", tool: "pipeline_catalogue", executor: "public.get_pipeline_catalogue", selfDescribe: true,
    idempotency: "Existing caller-JWT catalogue read; exact selection also uses readPipelineWorkspace/current_user_tenant_id/get_pipeline_workspace with before/after scope checks. No writes; reads are not an atomic snapshot." },
  { key: "sales.pipeline_archive_preview", tool: "pipeline_archive_preview", executor: "public.prepare_pipeline_archive_as_paige", selfDescribe: false,
    idempotency: "NOT zero-persistence or idempotent: service-only RPC inserts a fresh tenant/pipeline/version/deal-count/requested-by confirmation token expiring in 15 minutes. Rechecks requested actor tenant-admin authority; creates no approval and does not archive or dispatch." },
  { key: "sales.pipeline_folder_archive_preview", tool: "pipeline_folder_archive_preview", executor: "public.prepare_pipeline_folder_archive_as_paige", selfDescribe: false,
    idempotency: "NOT zero-persistence or idempotent: service-only RPC inserts a fresh tenant/folder/version/pipeline-count/requested-by confirmation token expiring in 15 minutes. Rechecks platform-owner or tenant-owner authority; creates no approval and does not archive or dispatch." },
].map(({ key, tool, executor, selfDescribe, idempotency }) => ({
  key, domain: "sales", owner: "solo-pipeline", humanSurface: "PAIGE workspace", readiness: "none", selfDescribe,
  action: { classification: "read", executor, chatTool: tool, seatAuthority: "workspace-admin",
    idempotency, riskPolicyKey: "read_only", approvalAuthority: "none" },
  chatBinding: "LIVE", mindBinding: "UNAVAILABLE", sharedPrimitiveChange: "NONE", maturity: "PARTIAL",
} as const satisfies SpineCapability));
