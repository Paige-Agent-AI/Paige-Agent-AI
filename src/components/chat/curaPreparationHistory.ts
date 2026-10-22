/** A projection of original native work, never approval or retry authority.
 * Populate only from the dedicated authenticated status response. */
export type OriginalPreparationScope = { threadId: string; turnId: string; intentId: string; tenantId: string };
export type PreparationWorkStatus = 'claimed' | 'blocked' | 'expired' | 'succeeded' | 'failed' | 'cancelled' | 'outcome_unknown';
export interface OriginalCuraPreparationHistory {
  v: 1; status: 'recorded_preparation'; thread_id: string; turn_id: string;
  origin_intent_id: string; tenant_id: string; historical: true; retry_authorized: false;
  confirmations_restored: false; new_effect_possible: false; settles_interrupted_turn: false;
  preparations: Array<{ tool: 'save_to_knowledge_base'; preparation_recorded: true; work_id: string;
    work_status: PreparationWorkStatus; knowledge_doc_id: string | null;
    current_document_revision: number | null; work_updated_at: string }>;
}

const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const closed = (v: Record<string, unknown>, keys: string[]) => Object.keys(v).length === keys.length
  && keys.every(key => Object.prototype.hasOwnProperty.call(v, key));
const uuid = (v: unknown): v is string => typeof v === 'string'
  && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
const statuses: ReadonlySet<string> = new Set(['claimed', 'blocked', 'expired', 'succeeded', 'failed', 'cancelled', 'outcome_unknown']);
const instant = (v: unknown): v is string => typeof v === 'string' && v.length <= 40
  && /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(v)
  && Number.isFinite(Date.parse(v));

export function readOriginalCuraPreparationHistory(raw: unknown, scope: OriginalPreparationScope): OriginalCuraPreparationHistory | null {
  if (![scope.threadId, scope.turnId, scope.intentId, scope.tenantId].every(uuid) || !object(raw)
    || !closed(raw, ['v', 'status', 'thread_id', 'turn_id', 'origin_intent_id', 'tenant_id', 'historical',
      'retry_authorized', 'confirmations_restored', 'new_effect_possible', 'settles_interrupted_turn', 'preparations'])
    || raw.v !== 1 || raw.status !== 'recorded_preparation' || raw.thread_id !== scope.threadId
    || raw.turn_id !== scope.turnId || raw.origin_intent_id !== scope.intentId || raw.tenant_id !== scope.tenantId
    || raw.historical !== true || raw.retry_authorized !== false || raw.confirmations_restored !== false
    || raw.new_effect_possible !== false || raw.settles_interrupted_turn !== false
    || !Array.isArray(raw.preparations) || raw.preparations.length < 1 || raw.preparations.length > 10) return null;
  const preparations: OriginalCuraPreparationHistory['preparations'] = [], seen = new Set<string>();
  for (const item of raw.preparations) {
    if (!object(item) || !closed(item, ['tool', 'preparation_recorded', 'work_id', 'work_status',
      'knowledge_doc_id', 'current_document_revision', 'work_updated_at'])
      || item.tool !== 'save_to_knowledge_base' || item.preparation_recorded !== true || !uuid(item.work_id)
      || seen.has(item.work_id.toLowerCase()) || typeof item.work_status !== 'string' || !statuses.has(item.work_status)
      || !instant(item.work_updated_at)
      || (item.knowledge_doc_id === null ? item.current_document_revision !== null
        : !uuid(item.knowledge_doc_id) || !Number.isSafeInteger(item.current_document_revision)
          || Number(item.current_document_revision) < 1)) return null;
    seen.add(item.work_id.toLowerCase());
    preparations.push({ tool: 'save_to_knowledge_base', preparation_recorded: true, work_id: item.work_id,
      work_status: item.work_status as PreparationWorkStatus, knowledge_doc_id: item.knowledge_doc_id as string | null,
      current_document_revision: item.current_document_revision as number | null, work_updated_at: item.work_updated_at });
  }
  return { v: 1, status: 'recorded_preparation', thread_id: scope.threadId, turn_id: scope.turnId,
    origin_intent_id: scope.intentId, tenant_id: scope.tenantId, historical: true, retry_authorized: false,
    confirmations_restored: false, new_effect_possible: false, settles_interrupted_turn: false, preparations };
}

/** A claimed work row proves recording, not that a worker is executing. */
export const preparationWorkLabel: Record<PreparationWorkStatus, string> = {
  claimed: 'Preparation recorded', blocked: 'Preparation needs attention', expired: 'Preparation expired',
  succeeded: 'Preparation completed', failed: 'Preparation failed', cancelled: 'Preparation cancelled',
  outcome_unknown: 'Preparation outcome is still unconfirmed',
};
