import { projectDurableContinuation, type ContinuationProjection } from './continuation.ts';
import { PAIGE_SPINE_CAPABILITIES } from '../paige-spine/registry.ts';
import { accruedSpendToday, enforceBudget, resolveCeiling, type BudgetDb } from '../router-budget/mod.ts';

/** The server adapter half of the C4d eligibility projection (INT-304 CL-3). The SQL half
 *  (`read_paige_durable_continuation`, migration 20270602000412) revalidates the frozen
 *  observation lineage — authenticated caller, owned active thread whose CURRENT intent is
 *  the work's conversational intent, caller-bound work row, document/research class,
 *  CURRENT owner/admin permission, exactly-one durable_accepted protected effect — and
 *  returns the envelope fields the pure projection pins. This adapter adds the identity
 *  re-read discipline of observation.ts and the CONTEXT booleans, each from a real source:
 *
 *  - authorized: the caller's own JWT re-read after the RPC (identity pin, like observation.ts);
 *  - budgetAllowed: the canonical router-budget ladder (resolveCeiling + accruedSpendToday +
 *    enforceBudget) over the admin client — the same seam the chat path enforces with;
 *  - capabilityAvailable: the Spine registry membership of the work's capability key;
 *  - approvalPending: the SQL's real derivation (blocked + approval_expired);
 *  - superseded/interrupted/alreadyContinued: false BY CONSTRUCTION AND SAID SO — the SQL
 *    refuses a superseded intent before returning, a stable status read carries no
 *    interruption brake, and no continuation-consumption seam exists yet (the gated C4d
 *    runtime); when one lands, alreadyContinued becomes its real signal.
 *
 *  Inert by construction: this reads and projects only. It never dispatches, wakes,
 *  settles, retries, approves or consumes anything, and the projection it returns is
 *  bounded terminal CONTEXT — never execution permission. */
export interface ContinuationReadCaller {
  auth: { getUser(): PromiseLike<{ data: { user: { id: string } | null }; error: unknown }> };
  rpc(name: string, args?: Record<string, unknown>): PromiseLike<{ data: unknown; error: unknown }>;
}
export interface DurableContinuationReference { threadId: string; intentId: string; workId: string }

const UUID = (v: unknown): v is string =>
  typeof v === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(v);
const text = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0;
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

export async function readDurableContinuation(
  reference: DurableContinuationReference,
  caller: ContinuationReadCaller,
  budgetDb: BudgetDb | null,
): Promise<ContinuationProjection | null> {
  try {
    if (!reference || ![reference.threadId, reference.intentId, reference.workId].every(UUID)) return null;
    const pin = Object.freeze({ ...reference });
    const auth = await caller.auth.getUser();
    if (auth.error || !UUID(auth.data.user?.id)) return null;
    const read = await caller.rpc('read_paige_durable_continuation', {
      _thread: pin.threadId, _intent: pin.intentId, _work: pin.workId,
    });
    if (read.error || !object(read.data)) return null;
    const r = read.data;
    if (r.actorId !== auth.data.user!.id || r.tenantId == null || !UUID(r.tenantId) ||
      r.workId !== pin.workId || r.threadId !== pin.threadId || r.intentId !== pin.intentId ||
      !UUID(r.workIntentId) || !text(r.scopeEpoch) || !text(r.capabilityKey) || !text(r.workKind) ||
      !text(r.status) || !text(r.canonicalObjective) ||
      ('settledAt' in r && r.settledAt != null && typeof r.settledAt !== 'string') ||
      ('terminalOutcome' in r && r.terminalOutcome != null && !object(r.terminalOutcome)) ||
      ('errorCode' in r && r.errorCode != null && typeof r.errorCode !== 'string') ||
      ('blockedReason' in r && r.blockedReason != null && typeof r.blockedReason !== 'string') ||
      typeof r.approvalPending !== 'boolean') return null;
    // Identity re-read: the projection is explained only if the caller is unchanged after
    // the awaited read (the same discipline the durable observation applies).
    const after = await caller.auth.getUser();
    if (after.error || after.data.user?.id !== auth.data.user!.id) return null;
    let budgetAllowed = false;
    if (budgetDb) {
      const tenantId = r.tenantId;
      const [ceiling, accrued] = [await resolveCeiling(budgetDb, tenantId), await accruedSpendToday(budgetDb, tenantId)];
      // Accrual unknown is NOT budget-allowed: the ladder's own conservative posture.
      budgetAllowed = accrued !== null &&
        enforceBudget({ accrued_usd: accrued, ceiling_usd: ceiling, band: 'sensitive' }).decision !== 'block';
    }
    // The envelope's capability_key is the chat-facing tool name; the registry carries it
    // as action.chatTool (keys are domain-namespaced, e.g. research_knowledge.document_generate;
    // entries without an action/chatTool binding are not continuable capabilities).
    const capabilityAvailable = PAIGE_SPINE_CAPABILITIES.some((c) => {
      const chatTool = (c.action as { chatTool?: unknown } | undefined)?.chatTool;
      return chatTool === r.capabilityKey;
    });
    const binding = {
      workId: pin.workId,
      tenantId: r.tenantId,
      actorId: r.actorId as string,
      threadId: r.threadId as string,
      intentId: r.workIntentId,
      scopeEpoch: r.scopeEpoch,
      capabilityKey: r.capabilityKey,
      workKind: r.workKind,
      // The projection pins the objective against the SAME frozen payload the SQL read —
      // tautological by design (both sides are the canonical record); said here so it is
      // never mistaken for an independent reconstruction check.
      originalObjective: r.canonicalObjective,
    };
    return projectDurableContinuation({
      work: {
        id: pin.workId,
        tenant_id: r.tenantId,
        initiating_user_id: r.actorId,
        thread_id: r.threadId,
        intent_id: r.workIntentId,
        scope_epoch: r.scopeEpoch,
        capability_key: r.capabilityKey,
        work_kind: r.workKind,
        status: r.status,
        settled_at: r.settledAt ?? null,
        terminal_outcome: r.terminalOutcome ?? null,
        error_code: r.errorCode ?? null,
      },
      binding,
      canonicalObjective: r.canonicalObjective,
      context: {
        authorized: true,
        budgetAllowed,
        capabilityAvailable,
        approvalPending: r.approvalPending === true,
        interrupted: false,
        superseded: false,
        alreadyContinued: false,
      },
      now: new Date().toISOString(),
    });
  } catch {
    return null;
  }
}
