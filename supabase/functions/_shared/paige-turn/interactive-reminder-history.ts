import { confirmFingerprint } from '../confirm-fingerprint.ts';
import { observeOriginalReminderOutcome } from '../planning/original-reminder-outcome.ts';
import type { ReminderExecutionPort, ReminderResolutionPort } from '../planning/approved-reminder.ts';
import type { ApprovalRecoveryDb } from './interactive-approval.ts';
import { parseScopedToken } from './resume.ts';

/** Read projection only. The original caller's native resolver/terminal receipt
 * owns authority. This reader never adopts, claims, executes a fresh action,
 * changes a hold, issues an approval or writes a replacement receipt. */
export async function readOriginalReminderApprovalHistory(input: {
  actorId: string; tenantId: string | null; threadId: string; intentId: string; turnId: string;
  caller: ApprovalRecoveryDb & ReminderResolutionPort & ReminderExecutionPort;
  service: ApprovalRecoveryDb;
  current(): boolean;
}) {
  const unavailable = () => ({ v: 1 as const, status: 'unavailable' as const });
  const uuid = (value: unknown): value is string => typeof value === 'string'
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
  const object = (value: unknown): value is Record<string, unknown> => !!value
    && typeof value === 'object' && !Array.isArray(value);
  const instant = (value: unknown) => typeof value === 'string' ? Date.parse(value) : NaN;
  const precise = (value: unknown) => {
    const match = typeof value === 'string'
      ? /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.(\d{1,6}))?(?:Z|[+-]\d{2}:\d{2})$/.exec(value) : null;
    return match && Number.isFinite(instant(value))
      ? [instant(value), Number((match[1] ?? '').padEnd(6, '0').slice(3))] : null;
  };
  const notAfter = (left: unknown, right: unknown) => {
    const a = precise(left), b = precise(right);
    return !!a && !!b && (a[0] < b[0] || a[0] === b[0] && a[1] <= b[1]);
  };
  const stable = (value: unknown): string => JSON.stringify(value, (_key, item) => object(item)
    ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
  // Snapshot request-owned ports and scope before the first await. Withdrawal is
  // sticky; browser generation/abort fencing remains the publication boundary.
  let withdrawn = false;
  try {
    const { actorId, tenantId, threadId, intentId, turnId, caller, service } = input;
    const currentCallback = input.current;
    const current = () => {
      try { withdrawn ||= currentCallback() !== true; } catch { withdrawn = true; }
      return !withdrawn;
    };
    if (![actorId, tenantId, threadId, intentId, turnId].every(uuid) || !current()) return unavailable();
    const readThread = () => caller.from('paige_chat_threads')
      .select('id,tenant_id,caller_user_id,audience,is_archived')
      .eq('id', threadId).eq('tenant_id', tenantId).eq('caller_user_id', actorId).maybeSingle();
    const readTurn = () => caller.from('paige_chat_turns')
      .select('id,thread_id,role,created_at,interactive_intent_id,interactive_actor_id,interactive_tenant_id,interactive_terminal_state,bundle_ref')
      .eq('id', turnId).eq('thread_id', threadId).eq('interactive_intent_id', intentId).maybeSingle();
    const ownedThread = (row: unknown) => object(row) && row.id === threadId && row.tenant_id === tenantId
      && row.caller_user_id === actorId && row.audience === 'workspace' && row.is_archived === false;
    const thread = await readThread();
    if (!current() || thread.error || !ownedThread(thread.data)) return unavailable();
    const receipt = await readTurn();
    const turn = receipt.data;
    if (!current() || receipt.error || !object(turn) || turn.id !== turnId || turn.thread_id !== threadId
      || turn.role !== 'assistant' || turn.interactive_intent_id !== intentId || turn.interactive_actor_id !== actorId
      || turn.interactive_tenant_id !== tenantId || turn.interactive_terminal_state !== 'WAIT_APPROVAL'
      || !Number.isFinite(instant(turn.created_at)) || !object(turn.bundle_ref)) return unavailable();
    const bundle = turn.bundle_ref;
    if (!object(bundle.turn_state) || bundle.turn_state.v !== 1 || bundle.turn_state.state !== 'WAIT_APPROVAL'
      || !object(bundle.interactive) || bundle.interactive.request_intent_id !== intentId
      || !Array.isArray(bundle.interactive.effects) || bundle.interactive.effects.length > 20
      || !Array.isArray(bundle.paige_confirm) || bundle.paige_confirm.length < 1 || bundle.paige_confirm.length > 10)
      return unavailable();
    const cards = bundle.paige_confirm.filter(card => object(card) && card.tool === 'plan_set_reminder');
    if (!cards.length) return unavailable();
    const seen = new Set<string>();
    const results: Array<{ tool: 'plan_set_reminder'; receipt_version: 1;
      original: { item_id: string; title: string; remind_at: string; source_version: string; receipt_run_id: string } }> = [];
    for (const card of cards) {
      if (!current() || !object(card) || typeof card.fingerprint !== 'string' || seen.has(card.fingerprint)) return unavailable();
      const parsed = parseScopedToken(card.fingerprint);
      if (!parsed || !bundle.interactive.effects.some(effect => object(effect)
        && effect.tool === 'plan_set_reminder' && effect.outcome === 'approval_required')) return unavailable();
      seen.add(card.fingerprint);
      const selected = await service.from('paige_pending_confirmations')
        .select('id,user_id,tenant_id,thread_id,scoped_client_id,tool_name,args,fingerprint,issued_in_request,server_issued_at,created_at,expires_at,consumed_at')
        .eq('user_id', actorId).eq('tenant_id', tenantId).eq('thread_id', threadId).is('scoped_client_id', null)
        .eq('tool_name', 'plan_set_reminder').eq('fingerprint', parsed.fingerprint).eq('issued_in_request', parsed.nonce)
        .not('server_issued_at', 'is', null).not('consumed_at', 'is', null).limit(2);
      if (!current() || selected.error || !Array.isArray(selected.data) || selected.data.length !== 1) return unavailable();
      const row = selected.data[0];
      if (!object(row) || !uuid(row.id) || row.user_id !== actorId || row.tenant_id !== tenantId || row.thread_id !== threadId
        || row.scoped_client_id !== null || row.tool_name !== 'plan_set_reminder' || row.fingerprint !== parsed.fingerprint
        || row.issued_in_request !== parsed.nonce || !object(row.args) || !precise(row.consumed_at)
        || !notAfter(row.server_issued_at, turn.created_at) || !notAfter(row.created_at, turn.created_at)) return unavailable();
      const intent = await confirmFingerprint('plan_set_reminder', row.args);
      const fingerprint = await confirmFingerprint('plan_set_reminder', {
        intent, tenant: tenantId, thread: threadId, client: null,
      });
      if (!current() || fingerprint !== parsed.fingerprint) return unavailable();
      const observed = await observeOriginalReminderOutcome({ caller,
        binding: { proposalId: row.id, actorId, tenantId: tenantId!, threadId, clientId: null }, current });
      if (!current() || observed.kind !== 'verified_original') return unavailable();
      results.push({ tool: 'plan_set_reminder', receipt_version: 1,
        original: { item_id: observed.originalReadback.item_id, title: observed.originalReadback.title,
          remind_at: observed.originalReadback.remind_at, source_version: observed.originalReadback.source_version,
          receipt_run_id: observed.originalResult.receipt_run_id } });
    }
    // The native terminal read above is the authority observation. These final
    // RLS reads prevent publishing a changed/archived origin; they grant no lease.
    const finalThread = await readThread();
    if (!current() || finalThread.error || !ownedThread(finalThread.data)) return unavailable();
    const finalTurn = await readTurn();
    if (!current() || finalTurn.error || stable(finalTurn.data) !== stable(turn)) return unavailable();
    return { v: 1 as const, status: 'verified_original' as const, thread_id: threadId, turn_id: turnId,
      origin_intent_id: intentId, tenant_id: tenantId!, historical: true as const, replayed: true as const, new_effect_possible: false as const,
      confirmations_restored: false as const, results };
  } catch { return unavailable(); }
}
