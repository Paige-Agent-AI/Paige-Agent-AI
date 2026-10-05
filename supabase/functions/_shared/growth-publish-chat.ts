// Chat's bridge to THE ONE PUBLISH DOOR (growth-publish-command, Vibe Studio V2b).
//
// Paige's three publish tools (growth_page_publish, growth_form_publish, growth_funnel_publish) no
// longer run their own RPC and readback. They are SELECTION ONLY, exactly like the sales-invoice and
// CRM chat doors: on a first call the door answers 202 with a server-issued proposal, which becomes
// the chat's Needs-your-OK card; when the operator approves that card, the echoed fingerprint selects
// the stored proposal and the door — the sole atomic claimer and executor — runs the STORED call,
// proves it and files the one receipt. The chat files none for these tools and runs no legacy gate.
//
// Pure apart from its two injected dependencies, so it is driven by tests directly.
import { CRM_APPROVAL_CANDIDATE_LIMIT, resolveCrmApprovedFingerprint } from './crm-command/approval-resolution.ts';
import { PUBLISH_DOOR_CHAT_TOOLS, PUBLISH_KEYS, UUID } from './growth-publish-command/contract.ts';
import { PUBLISH_UNVERIFIED_ERROR } from './artifact-receipt.ts';
import { unaddressableArgsRefusal } from './confirm-fingerprint.ts';

export const GROWTH_PUBLISH_DOOR_TOOL_NAMES: ReadonlySet<string> = new Set(Object.keys(PUBLISH_DOOR_CHAT_TOOLS));

export type GrowthPublishApprovalQuery = {
  eq(key: string, value: unknown): GrowthPublishApprovalQuery; in(key: string, values: string[]): GrowthPublishApprovalQuery;
  is(key: string, value: null): GrowthPublishApprovalQuery; not(key: string, operator: string, value: null): GrowthPublishApprovalQuery;
  gt(key: string, value: string): GrowthPublishApprovalQuery; limit(value: number): PromiseLike<{ data: { fingerprint?: unknown; args?: unknown }[] | null; error: unknown }>;
};
type Reply = { data: unknown; error: unknown };
export type GrowthPublishChatDeps = {
  admin: { from(name: string): { select(value: string): GrowthPublishApprovalQuery } };
  /** POST to growth-publish-command with the operator's own JWT. */
  invoke(body: Record<string, unknown>): Promise<Reply>;
};
/** C4b — `pinned`: the stored proposal the chat's approval resume carried forward, selected by the
 *  chat under the door's own claim scope (this user, this workspace, thread and client NULL). When set,
 *  this call redeems exactly that proposal: no lookup, no choosing between approvals, and never an
 *  unapproved request — the door still claims it (single claim site) and runs what it stored. */
type Context = { tenantId: string | null; userId: string; toolName: string; args: Record<string, unknown>; approved: Set<string>; sameToolCalls: number;
  pinned?: { fingerprint: string; args: unknown } };
type Refusal = 'ambiguous' | 'unclaimable' | 'lookup_failed';
export type GrowthPublishChatResult = {
  content: Record<string, unknown>;
  refusal?: Refusal;
  /** The operator's echoed approvals that belong to this tool, for the approval outcome. */
  tokens?: string[];
  /** The approval this call handed to the door to redeem. Its result is that approval's outcome. */
  spent?: string;
  /** The door found nothing to claim for the approval it was handed (APPROVAL_NOT_AVAILABLE: already
   *  used or expired). Not model-facing; the chat's approval resume reads it (C4b), because "nothing
   *  ran" is true of THIS call and may be false of the act — another request may have published it. */
  approvalUnavailable?: true;
};

const NOT_AGAIN = 'Do not call this tool again in this reply.';
function refusal(reason: Refusal, tokens: string[]): GrowthPublishChatResult {
  const message = reason === 'ambiguous' ? 'More than one publish approval could apply, so nothing was published.'
    : reason === 'lookup_failed' ? 'The publish approval could not be checked, so nothing was published.'
    : 'That approval no longer matches anything I can publish, so nothing was published.';
  return { refusal: reason, tokens, content: { success: false, not_applied: true, error: message,
    note: `Say this to the operator in one plain line and that they can ask again. Do not open a new approval card. ${NOT_AGAIN}` } };
}

/** Read the door's answer, whether it came back 2xx (data) or non-2xx (an error carrying the body). */
async function answerOf(reply: Reply): Promise<Record<string, unknown> | null> {
  let data = reply.data;
  if (reply.error) {
    const ctx = (reply.error as { context?: { json?: () => Promise<unknown> } }).context;
    if (!ctx || typeof ctx.json !== 'function') return null;
    try { data = await ctx.json(); } catch { return null; }
  }
  return data && typeof data === 'object' && !Array.isArray(data) ? data as Record<string, unknown> : null;
}

/** Selection only. growth-publish-command is the sole approval claimer and executor. */
export async function dispatchGrowthPublishChat(ctx: Context, deps: GrowthPublishChatDeps): Promise<GrowthPublishChatResult> {
  const spec = PUBLISH_DOOR_CHAT_TOOLS[ctx.toolName];
  if (!spec) return { content: { success: false, error: 'Publishing that is not available here.' } };
  if (!ctx.tenantId || !UUID.test(ctx.tenantId)) return { content: { success: false, not_applied: true, error: 'Open one of your workspaces first, then try again. Nothing was published.' } };
  const key = PUBLISH_KEYS.publish[spec.kind];
  const raw = ctx.args?.[spec.idArg];
  const requestedId = typeof raw === 'string' && UUID.test(raw) ? raw.toLowerCase() : null;

  const tokens: string[] = [];
  let approvedFingerprint: string | undefined;
  let storedId: string | undefined;
  if (ctx.pinned || ctx.approved.size) {
    try {
      let rows: { fingerprint?: unknown; args?: unknown }[];
      const approved = ctx.pinned ? new Set([ctx.pinned.fingerprint]) : ctx.approved;
      if (ctx.pinned) rows = [{ fingerprint: ctx.pinned.fingerprint, args: ctx.pinned.args }];
      else {
        const reply = await deps.admin.from('paige_pending_confirmations').select('fingerprint,args')
          .eq('tenant_id', ctx.tenantId).eq('user_id', ctx.userId).eq('tool_name', key)
          .in('fingerprint', [...ctx.approved].map((token) => token.split(':')[0]))
          .is('thread_id', null).is('scoped_client_id', null).is('consumed_at', null)
          .not('server_issued_at', 'is', null).not('issued_in_request', 'is', null)
          .gt('expires_at', new Date().toISOString()).limit(CRM_APPROVAL_CANDIDATE_LIMIT + 1);
        if (reply.error) return refusal('lookup_failed', tokens);
        rows = reply.data ?? [];
      }
      for (const row of rows) for (const token of approved) if (token.split(':')[0] === row.fingerprint) tokens.push(token);
      const subject = requestedId ? `publish:${spec.kind}:${requestedId}` : '';
      const selected = ctx.pinned ? { kind: 'claim' as const, fingerprint: ctx.pinned.fingerprint } : resolveCrmApprovedFingerprint(rows, subject, ctx.sameToolCalls);
      if (selected.kind === 'ambiguous') return refusal('ambiguous', tokens);
      if (selected.kind === 'claim') {
        // The WHOLE echoed token must be present, not only the bare prefix the search used.
        if (!approved.has(selected.fingerprint)) return refusal('unclaimable', tokens);
        const stored = rows.find((row) => row.fingerprint === selected.fingerprint)?.args as Record<string, unknown> | undefined;
        if (!stored || stored.action !== 'publish' || stored.kind !== spec.kind || typeof stored.id !== 'string' || !UUID.test(stored.id)
          || stored.expected_tenant_id !== ctx.tenantId) return refusal('unclaimable', tokens);
        approvedFingerprint = selected.fingerprint; storedId = stored.id;
      }
    } catch { return refusal('lookup_failed', tokens); }
  }

  const id = storedId ?? requestedId;
  if (!id) {
    // The one producer of this refusal (confirm-fingerprint.ts), so every door says the same thing.
    return { tokens, content: unaddressableArgsRefusal({ field: spec.idArg, required: true, problem: raw == null || raw === '' ? 'missing' : 'malformed' }, 'proposal') };
  }
  // chat_attempt: this is a person asking Paige to publish, so the door files a refusal on the Rail
  // (the panel's prepare-on-open does not). It changes nothing about what may run.
  const body: Record<string, unknown> = { action: 'publish', kind: spec.kind, id, expected_tenant_id: ctx.tenantId, chat_attempt: true,
    ...(approvedFingerprint ? { approved_fingerprint: approvedFingerprint } : {}) };
  const spent = approvedFingerprint;

  let answer: Record<string, unknown> | null = null;
  try { answer = await answerOf(await deps.invoke(body)); } catch { answer = null; }
  if (!answer) {
    // No answer from the door's own code: the request failed in transit or the platform cut it off.
    return { tokens, spent, content: { success: false, outcome_unknown: true,
      error: 'The publish answer never came back, so whether it went live is not known.',
      note: `Tell the operator you could not confirm whether it went live and that they should check the project before asking again. Do not claim it is live. ${NOT_AGAIN}` } };
  }
  if (answer.approval_required === true && typeof answer.fingerprint === 'string' && /^[0-9a-f]{16}$/.test(answer.fingerprint)) {
    return { tokens, content: { success: false, needs_confirm: true, requires_operator_approval: true,
      confirm_fingerprint: answer.fingerprint,
      confirm_summary: typeof answer.summary === 'string' ? answer.summary : `Publish this ${spec.kind}`,
      preview: answer.preview ?? null,
      note: 'Show the Needs your OK card. Nothing is live yet. Do not call this tool again until the person approves.' } };
  }
  if (answer.ok === true) {
    return { tokens, spent, content: { success: true, [spec.idArg]: answer.id, id: answer.id, status: answer.status,
      published_at: answer.published_at ?? null, url: answer.url ?? null,
      note: 'Report the address in url exactly as given; it is the real public link.' } };
  }
  const error = typeof answer.error === 'string' ? answer.error : 'It did not go live.';
  if (answer.outcome === 'unverified') {
    return { tokens, spent, content: { success: false, outcome: 'unverified', error: PUBLISH_UNVERIFIED_ERROR,
      ...(typeof answer.status === 'string' ? { status: answer.status } : {}) } };
  }
  if (answer.outcome === 'outcome_unknown' || answer.code === 'UNEXPECTED') {
    return { tokens, spent, content: { success: false, outcome_unknown: true, error,
      note: `Tell the operator you could not confirm whether it went live. Do not claim it is live. ${NOT_AGAIN}` } };
  }
  if (answer.disabled === true) return { tokens, spent, content: { success: false, disabled: true, error } };
  if (answer.outcome === 'not_ready') {
    const checks = (answer.preview as { checks?: Array<Record<string, unknown>> } | undefined)?.checks ?? [];
    return { tokens, spent, content: { success: false, not_applied: true, error,
      missing: checks.filter((c) => c.blocking === true && c.ok !== true).map((c) => c.label),
      note: 'Tell the operator what is missing in plain words and offer to fix it. Nothing went live.' } };
  }
  // Every other answer is the door refusing before or inside a single-statement publish: nothing applied.
  return { tokens, spent, ...(answer.code === 'APPROVAL_NOT_AVAILABLE' ? { approvalUnavailable: true as const } : {}), content: { success: false, not_applied: true, error,
    note: `Say what the door said, in one plain line. Nothing went live. ${NOT_AGAIN}` } };
}
