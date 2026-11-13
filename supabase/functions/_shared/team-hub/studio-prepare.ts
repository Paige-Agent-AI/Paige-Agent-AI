// Proposed text on the ORIGINAL accepted turn. Only a later explicit caller
// handoff can start the original Studio project; preparation never executes it.
import { UUID } from "../comms-email/contract.ts";
import { createWeeklyDraftDeadline } from "../paige-orchestration/weekly-draft-deadline.ts";

export type TeamHubStudioPreparation = Readonly<{ brief: string }>;
type Scope = Readonly<{ agent: string; where: string; turnId: string; tokenHash: string; privateFollowUp: boolean }>;
type Deps = Readonly<{
  service: { rpc(name: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: unknown }> };
  signal?: AbortSignal; timeoutMs?: number;
}>;
const object = (value: unknown): Record<string, unknown> | null => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;

export function parseTeamHubStudioPreparation(value: unknown): TeamHubStudioPreparation | null {
  const row = object(value);
  if (!row || Object.keys(row).length !== 1 || !Object.hasOwn(row, "brief") || typeof row.brief !== "string"
    || !row.brief.trim() || row.brief.length > 10000 || row.brief.includes("\0")) return null;
  return { brief: row.brief.trim() };
}
export const TEAM_HUB_STUDIO_PREPARATION_PROMPT = [
  "STUDIO BRIEF PREPARATION: For a Studio page/form/funnel request the person explicitly asks to prepare in this private DM, you may prepare a concise plain-text brief.",
  'Add only optional "studio_brief":{"brief":"..."} to the one answer JSON. Ask a useful missing question instead when the requested work is unclear.',
  "This prepares text only. You have NOT created a project, built a page, saved a version, published, approved or executed anything. Never claim those outcomes.",
  "The person reviews the brief, chooses the project target and context, and explicitly starts the original Studio project. Do not infer a workspace/client/prospect target from the conversation.",
  "Use at most 10000 characters. studio_brief contains ONLY brief: no project/session/thread/tenant/user/source IDs, URL metadata, navigation, approval, status or receipt fields.",
  "Include only the Studio brief the person requested. Never copy private transcripts, unrelated messages, hidden Knowledge or Memory into the brief. Do not invent facts or claim external submissions reach PAIGE CRM.",
].join("\n");

export function teamHubStudioPreparationFromAnswer(answer: string): TeamHubStudioPreparation | null | "invalid" {
  try {
    const row = object(JSON.parse(answer));
    if (!row || !Object.hasOwn(row, "studio_brief")) return null;
    return parseTeamHubStudioPreparation(row.studio_brief) ?? "invalid";
  } catch { return null; }
}

/** Native current/stage doors revalidate original actor, private DM, membership,
 * roster, accepted source and token. Any failure is sticky for this invocation. */
export function createTeamHubStudioPreparation(scope: Scope, deps: Deps) {
  const turnId = scope.turnId, tokenHash = scope.tokenHash, signal = deps.signal;
  const eligible = (scope.agent === "nexus" || scope.agent === "paige") && scope.where === "agent_dm"
    && scope.privateFollowUp === false && UUID.test(turnId) && /^[0-9a-f]{64}$/.test(tokenHash);
  const rpc: Deps["service"]["rpc"] = deps.service.rpc.bind(deps.service);
  let withdrawn = false;
  const live = () => eligible && !withdrawn && signal?.aborted !== true;
  const current = async (): Promise<boolean> => {
    if (!live()) return false;
    try {
      const result = await createWeeklyDraftDeadline(deps.timeoutMs ?? 5000, live)(() =>
        rpc("team_hub_studio_scope", { p_turn_id: turnId, p_token_hash: tokenHash }));
      if (result.error || object(result.data)?.ok !== true || !live()) { withdrawn = true; return false; }
      return true;
    } catch { withdrawn = true; return false; }
  };
  const stage = async (candidate: TeamHubStudioPreparation): Promise<boolean> => {
    const prepared = parseTeamHubStudioPreparation(candidate);
    if (!prepared || !await current()) return false;
    try {
      const result = await createWeeklyDraftDeadline(deps.timeoutMs ?? 5000, live)(() =>
        rpc("team_hub_stage_studio_brief", { p_turn_id: turnId, p_token_hash: tokenHash, p_brief: prepared.brief }));
      if (result.error || object(result.data)?.ok !== true || !live()) { withdrawn = true; return false; }
      return true;
    } catch { withdrawn = true; return false; }
  };
  return Object.freeze({ current, stage });
}
