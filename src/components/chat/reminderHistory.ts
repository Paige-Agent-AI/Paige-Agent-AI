/** A historical read result has no approval, retry, live token or current-record
 * authority. Only the dedicated status response may populate this UI type. */
export interface OriginalReminderHistory {
  v: 1; status: 'verified_original'; thread_id: string; turn_id: string;
  origin_intent_id: string; tenant_id: string; historical: true; replayed: true;
  new_effect_possible: false; confirmations_restored: false;
  results: Array<{ tool: 'plan_set_reminder'; receipt_version: 1; original: {
    item_id: string; title: string; remind_at: string; source_version: string; receipt_run_id: string;
  } }>;
}

const object = (value: unknown): value is Record<string, unknown> => !!value
  && typeof value === 'object' && !Array.isArray(value);
const closed = (value: Record<string, unknown>, keys: string[]) => Object.keys(value).length === keys.length
  && keys.every(key => Object.prototype.hasOwnProperty.call(value, key));
const uuid = (value: unknown): value is string => typeof value === 'string'
  && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const instant = (value: unknown): value is string => {
  const parts = typeof value === 'string'
    ? /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.exec(value) : null;
  if (!parts || !Number.isFinite(Date.parse(value as string))) return false;
  const [, year, month, day, hour, minute, second] = parts.map(Number);
  const endOfMonth = new Date(0);
  endOfMonth.setUTCFullYear(year, month, 0);
  return month >= 1 && month <= 12 && day >= 1 && day <= endOfMonth.getUTCDate()
    && hour <= 23 && minute <= 59 && second <= 59;
};

export function readOriginalReminderHistory(raw: unknown, scope: {
  threadId: string; turnId: string; intentId: string; tenantId: string;
}): OriginalReminderHistory | null {
  if (![scope.threadId, scope.turnId, scope.intentId, scope.tenantId].every(uuid) || !object(raw)
    || !closed(raw, ['v', 'status', 'thread_id', 'turn_id', 'origin_intent_id', 'tenant_id',
      'historical', 'replayed', 'new_effect_possible', 'confirmations_restored', 'results'])
    || raw.v !== 1 || raw.status !== 'verified_original' || raw.thread_id !== scope.threadId
    || raw.turn_id !== scope.turnId || raw.origin_intent_id !== scope.intentId || raw.tenant_id !== scope.tenantId
    || raw.historical !== true || raw.replayed !== true || raw.new_effect_possible !== false
    || raw.confirmations_restored !== false || !Array.isArray(raw.results)
    || raw.results.length < 1 || raw.results.length > 10) return null;
  const results: OriginalReminderHistory['results'] = [];
  const seenItems = new Set<string>(), seenReceipts = new Set<string>();
  for (const result of raw.results) {
    if (!object(result) || !closed(result, ['tool', 'receipt_version', 'original'])
      || result.tool !== 'plan_set_reminder' || result.receipt_version !== 1 || !object(result.original)) return null;
    const original = result.original;
    if (!closed(original, ['item_id', 'title', 'remind_at', 'source_version', 'receipt_run_id'])
      || !uuid(original.item_id) || !uuid(original.receipt_run_id)
      || seenItems.has(original.item_id.toLowerCase()) || seenReceipts.has(original.receipt_run_id.toLowerCase())
      || typeof original.title !== 'string' || !original.title.trim() || original.title.length > 16384
      || !instant(original.remind_at) || !instant(original.source_version)) return null;
    seenItems.add(original.item_id.toLowerCase()); seenReceipts.add(original.receipt_run_id.toLowerCase());
    results.push({ tool: 'plan_set_reminder', receipt_version: 1, original: {
      item_id: original.item_id, title: original.title, remind_at: original.remind_at,
      source_version: original.source_version, receipt_run_id: original.receipt_run_id,
    } });
  }
  return { v: 1, status: 'verified_original', thread_id: scope.threadId, turn_id: scope.turnId,
    origin_intent_id: scope.intentId, tenant_id: scope.tenantId, historical: true, replayed: true,
    new_effect_possible: false, confirmations_restored: false, results };
}
