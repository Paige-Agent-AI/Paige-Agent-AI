// ZION's server-only composition of the EXISTING Planning definition/executor.
// No host admission, new RPC, authorization store, model call or execution path.
// E04 owns native source staging/currentness/history; its forward contract is
// required before this preparation may publish a real ZION planning result.
import {
  mentorPlanReadTools, planReadArgumentsFor, readMentorPlan,
  type MentorPlanRead, type MentorPlanReadDeps, type MentorPlanScope,
} from "./mentor-plan-read.ts";
import { createWeeklyDraftDeadline } from "../paige-orchestration/weekly-draft-deadline.ts";

export type ZionPlanningScope = MentorPlanScope & { agent: "zion"; where: "agent_dm" };
export type ZionPlanningDeps = Omit<MentorPlanReadDeps, "isCurrent"> & {
  // The host must freshly prove the SAME DM, roster, actor, tenant and role.
  isCurrent: (scope: Readonly<ZionPlanningScope>) => Promise<boolean>;
  // Consume the host's ONE total private-read budget, never a per-tool reset.
  takeRead: () => boolean;
  // Same original accepted turn/token and service-only native stage. No rows,
  // credentials, private text or invented Work links belong in this callback.
  stageReadContext: (scope: Readonly<ZionPlanningScope>) => Promise<boolean>;
};

const unavailable = (): MentorPlanRead => ({
  model: { status: "unavailable", message: "The planning results could not be verified for this reply. Nothing was changed." },
  revalidate: async () => false,
});
function capture(scope: ZionPlanningScope): Readonly<ZionPlanningScope> | null {
  try {
    if (scope.agent !== "zion" || scope.where !== "agent_dm" || !Array.isArray(scope.storedTools)) return null;
    const snapshot = Object.freeze({ agent: scope.agent, where: scope.where, tenantId: scope.tenantId,
      actorId: scope.actorId, storedTools: Object.freeze([...scope.storedTools]) });
    return mentorPlanReadTools(snapshot).length ? snapshot : null;
  } catch { return null; }
}

export async function zionPlanReadTools(scope: ZionPlanningScope, deps: ZionPlanningDeps): Promise<ReturnType<typeof mentorPlanReadTools>> {
  const snapshot = capture(scope);
  if (!snapshot || deps.signal?.aborted) return [];
  let retired = false;
  const within = createWeeklyDraftDeadline(5000, () => !retired && !deps.signal?.aborted);
  try { return await within(() => deps.isCurrent(snapshot)) === true ? mentorPlanReadTools(snapshot) : []; }
  catch { return []; }
  finally { retired = true; }
}

/** The original caller-JWT reader, receipted before reading, with native stage
 * BEFORE rows can enter a provider request. A refusal/uncertain stage never
 * retries a read or returns its private result. Source readiness is not consent. */
export async function readZionPlans(scope: ZionPlanningScope, deps: ZionPlanningDeps, name: string, input: unknown): Promise<MentorPlanRead> {
  const snapshot = capture(scope);
  if (!snapshot || name !== "plan_list" || deps.signal?.aborted) return unavailable();
  let args: Record<string, unknown>;
  try {
    if (!input || typeof input !== "object" || Array.isArray(input)
      || ![Object.prototype, null].includes(Object.getPrototypeOf(input))) return unavailable();
    args = { ...input };
    if (!planReadArgumentsFor(args)) return {
      model: { status: "needs_input", message: "The planning request must match the supported plan_list arguments. Nothing was changed." },
      revalidate: async () => false,
    };
  } catch { return unavailable(); }
  // Same bounded original-reader recheck used by private MERIT/CURA reads.
  // This is a source observation, not a second Work operation or a new receipt.
  const inspect = async (initial: boolean) => {
    let retired = false;
    const within = createWeeklyDraftDeadline(5000, () => !retired && !deps.signal?.aborted);
    const current = () => within(() => deps.isCurrent(snapshot));
    let identity: string | null = null;
    try {
      if (await current() !== true || (initial && deps.takeRead() !== true)) return null;
      const read = await within(() => readMentorPlan(snapshot, {
        // One elapsed budget fences every continuation, including a late
        // revalidation: it cannot start a pin read or native stage afterward.
        caller: { rpc: (rpc, values) => within(async () => {
          const reply = await deps.caller.rpc(rpc, values);
          if (retired || deps.signal?.aborted) return { data: null, error: { code: "42501" } };
          if (rpc !== "plan_list" || reply.error) return reply;
          // Preserve raw source versions and all nested facts before any await
          // can let a caller reuse/mutate its response object.
          const data = structuredClone(reply.data);
          identity = JSON.stringify(data);
          return { ...reply, data };
        }) },
        isCurrent: current,
        recordRead: tool => within(() => deps.recordRead(tool)),
        signal: deps.signal,
      }, name, args));
      if (read.model.success !== true) return { model: read.model, identity: null };
      if (identity === null || await current() !== true
        || await within(() => deps.stageReadContext(snapshot)) !== true
        || await current() !== true) return null;
      return { model: read.model, identity };
    } catch { return null; }
    finally { retired = true; }
  };
  const first = await inspect(true);
  if (!first) return unavailable();
  if (first.model.success !== true) return { model: first.model, revalidate: async () => false };
  return { model: first.model, revalidate: async () => {
    const current = await inspect(false);
    return !!current && current.model.success === true && current.identity === first.identity;
  } };
}
