// EXP08 Team Hub: the scheduled stale-file sweep, as a pure loop over an injected client so it can be
// tested without a server. The edge function team-hub-file-sweep authorizes the caller and calls
// runTeamHubFileSweep with the service-role client. Contract:
// docs/delivery/exp08-team-hub-increment3-attachments-contract.md §4–§5.
//   1. team_hub_stale_file_uploaders: the uploaders with sweep work now (service role only).
//   2. For each, the unchanged increment-3 door team_hub_claim_stale_files.
//   3. Removal of only canonical <tenant>/team-hub/<file> paths, at most 100 per storage call.
// A removal that fails is offered again by the next sweep (the claim re-offers stored objects).
import { stalePaths, TEAM_HUB_PATH } from "./file-paths.ts";

export const TEAM_HUB_FILE_BUCKET = "comms-attachments";
export const SWEEP_UPLOADERS_PER_RUN = 50;
export const SWEEP_REMOVE_BATCH = 100;
// Stop starting new uploaders after this long; the rest wait for the next hourly run.
export const SWEEP_RUN_BUDGET_MS = 40_000;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type RpcResult = { data: unknown; error: { code?: string; message?: string } | null };

/** The two calls the sweep makes, as the supabase-js service-role client exposes them. */
export type TeamHubSweepClient = {
  rpc(fn: string, args: Record<string, unknown>): PromiseLike<RpcResult>;
  storage: { from(bucket: string): { remove(paths: string[]): PromiseLike<{ data?: unknown; error: unknown }> } };
};

export type TeamHubSweepSummary = {
  ok: boolean;
  code?: "list_failed";
  uploaders: number;
  swept: number;
  /** Objects storage reports it deleted (a path whose object was already gone is not counted). */
  removed: number;
  /** Paths in a removal call that failed; the next run offers them again. */
  failed_removals: number;
  failed_claims: number;
  deferred: number;
};

const record = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;

/** The uploader ids from team_hub_stale_file_uploaders, or null when the answer is not a success. */
export function uploaderIds(value: unknown): string[] | null {
  const body = record(value);
  if (!body || body.ok !== true || !Array.isArray(body.uploaders)) return null;
  return body.uploaders.filter((id): id is string => typeof id === "string" && UUID.test(id));
}

export async function runTeamHubFileSweep(
  admin: TeamHubSweepClient,
  clock: () => number = Date.now,
): Promise<TeamHubSweepSummary> {
  const started = clock();
  const summary: TeamHubSweepSummary = {
    ok: true, uploaders: 0, swept: 0, removed: 0, failed_removals: 0, failed_claims: 0, deferred: 0,
  };
  let listed: RpcResult;
  try {
    listed = await admin.rpc("team_hub_stale_file_uploaders", { p_limit: SWEEP_UPLOADERS_PER_RUN });
  } catch {
    return { ...summary, ok: false, code: "list_failed" };
  }
  const uploaders = listed.error ? null : uploaderIds(listed.data);
  if (!uploaders) return { ...summary, ok: false, code: "list_failed" };
  summary.uploaders = uploaders.length;

  for (let index = 0; index < uploaders.length; index++) {
    if (clock() - started > SWEEP_RUN_BUDGET_MS) {
      summary.deferred = uploaders.length - index;
      break;
    }
    let claimed: RpcResult;
    try {
      claimed = await admin.rpc("team_hub_claim_stale_files", { p_uploader: uploaders[index] });
    } catch {
      summary.failed_claims += 1;
      continue;
    }
    if (claimed.error || record(claimed.data)?.ok !== true) {
      summary.failed_claims += 1;
      continue;
    }
    summary.swept += 1;
    const paths = stalePaths(claimed.data).filter((path) => TEAM_HUB_PATH.test(path));
    for (let at = 0; at < paths.length; at += SWEEP_REMOVE_BATCH) {
      const batch = paths.slice(at, at + SWEEP_REMOVE_BATCH);
      try {
        const { data, error } = await admin.storage.from(TEAM_HUB_FILE_BUCKET).remove(batch);
        if (error) summary.failed_removals += batch.length;
        else summary.removed += Array.isArray(data) ? data.length : 0;
      } catch {
        summary.failed_removals += batch.length;
      }
    }
  }
  // ok only when every claim and every removal this run attempted succeeded; a partial run says so.
  summary.ok = summary.failed_claims === 0 && summary.failed_removals === 0;
  return summary;
}
