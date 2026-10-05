import { describe, expect, it } from 'vitest';
import { COMMS_EMAIL_TOOLS, COMMS_EMAIL_TOOL_NAMES, commsEmailChatSafeResult, commsEmailConfirmPreview, commsEmailOperationId, dispatchCommsEmailChat } from '../../supabase/functions/_shared/comms-email/chat.ts';
import { COMMS_EMAIL_SEND_CAPABILITY } from '../../supabase/functions/_shared/paige-spine/domains/comms.ts';

// INT-328 — the Chat half of comms.email_send. Exercises the real dispatch module with an injected
// approval store and an injected comms-email-command transport; no hosted Chat or provider drive.
const tenant = '11111111-1111-4111-8111-111111111111';
const contact = '22222222-2222-4222-8222-222222222222';
const operation = '33333333-3333-4333-8333-333333333333';
const connector = '44444444-4444-4444-8444-444444444444';
const fingerprint = 'abcdef0123456789';
const args = { contact_id: contact, subject: 'Thursday', body: 'Hi Dana,\n\nSee you Thursday.' };
const command = { action: 'comms.email_send', contact_id: contact, connector_id: connector, subject: 'Thursday', body: 'Hi Dana,\n\nSee you Thursday.' };
const turn = { thread_id: null, user_turn_ordinal: 1, user_turn: 'email Dana' };
const context = { tenantId: tenant, userId: 'actor', toolName: 'comms_send_email', args, approved: new Set<string>(), sameToolCalls: 1, turn };
const preview = { kind: 'email', to_name: 'Dana Reyes', to_address: 'dana@example.test', from_address: 'hello@business.test', subject: 'Thursday', body_text: 'Hi Dana,\n\nSee you Thursday.' };

function harness(rows: unknown[] = [], reply: unknown = { ok: false, outcome: 'approval_required', fingerprint, summary: 'Email Dana Reyes at dana@example.test from hello@business.test: "Thursday"', preview }) {
  const predicates: unknown[][] = [];
  const query: Record<string, unknown> = {};
  for (const name of ['select', 'eq', 'in', 'is', 'not', 'gt']) query[name] = (...a: unknown[]) => { predicates.push([name, ...a]); return query; };
  query.limit = async (...a: unknown[]) => { predicates.push(['limit', ...a]); return { data: rows, error: null }; };
  const calls: { name: string; options: { body: Record<string, unknown> } }[] = [];
  const deps = {
    admin: { from: (_name: string) => query },
    caller: { functions: { invoke: async (name: string, options: { body: Record<string, unknown> }): Promise<{ data: unknown; error: unknown }> => { calls.push({ name, options }); return { data: reply, error: null }; } } },
  };
  return { predicates, calls, deps };
}

describe('comms.email_send Chat tool declaration', () => {
  it('declares exactly one closed tool whose fields come from the Kit declaration', () => {
    expect(COMMS_EMAIL_TOOLS.map(t => t.function.name)).toEqual(['comms_send_email']);
    expect([...COMMS_EMAIL_TOOL_NAMES]).toEqual(['comms_send_email']);
    const parameters = COMMS_EMAIL_TOOLS[0].function.parameters;
    expect(parameters.required).toEqual(COMMS_EMAIL_SEND_CAPABILITY.input.required);
    expect(Object.keys(parameters.properties).sort()).toEqual(Object.keys(COMMS_EMAIL_SEND_CAPABILITY.input.properties).sort());
    expect(parameters.additionalProperties).toBe(false);
    for (const forbidden of ['action', 'operation_id', 'to', 'recipient', 'from_address', 'expected_tenant_id', 'approved_fingerprint', 'governance', 'html']) expect(parameters.properties).not.toHaveProperty(forbidden);
    const description = COMMS_EMAIL_TOOLS[0].function.description;
    expect(description).toMatch(/ONE existing contact/);
    expect(description).toMatch(/ask/i);
    expect(description).toMatch(/never for marketing/i);
  });
});

describe('comms.email_send Chat dispatch', () => {
  it('uses a stable turn + canonical command operation identity', async () => {
    const a = await commsEmailOperationId(tenant, 'actor', command, turn);
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(await commsEmailOperationId(tenant, 'actor', { body: command.body, subject: command.subject, connector_id: connector, contact_id: contact, action: 'comms.email_send' }, turn)).toBe(a);
    expect(await commsEmailOperationId(tenant, 'actor', command, { ...turn, user_turn_ordinal: 2 })).not.toBe(a);
    expect(await commsEmailOperationId(tenant, 'actor', { ...command, subject: 'Wednesday' }, turn)).not.toBe(a);
  });

  it('first call proposes through comms-email-command with a server-authored card and the email preview', async () => {
    const h = harness();
    const result = await dispatchCommsEmailChat(context, h.deps as never);
    expect(h.calls).toHaveLength(1);
    expect(h.calls[0].name).toBe('comms-email-command');
    expect(h.calls[0].options.body).toEqual({ expected_tenant_id: tenant, operation_id: await commsEmailOperationId(tenant, 'actor', { ...args, action: 'comms.email_send', connector_id: null }, turn), command: { action: 'comms.email_send', contact_id: contact, connector_id: null, subject: args.subject, body: args.body } });
    expect(result.content).toMatchObject({ success: false, needs_confirm: true, requires_operator_approval: true, confirm_fingerprint: fingerprint, confirm_summary: expect.stringContaining('Dana Reyes'), confirm_preview: preview });
    expect(String(result.content.note)).toMatch(/Nothing was sent/);
  });

  it('drops a malformed preview rather than forwarding unvalidated fields to the card', async () => {
    const h = harness([], { ok: false, outcome: 'approval_required', fingerprint, summary: 'Email', preview: { ...preview, kind: 'sms', access_token: 'private' } });
    const result = await dispatchCommsEmailChat(context, h.deps as never);
    expect(result.content.needs_confirm).toBe(true);
    expect(result.content).not.toHaveProperty('confirm_preview');
    expect(JSON.stringify(result)).not.toContain('private');
    expect(commsEmailConfirmPreview({ ...preview, extra: 'private' })).toEqual(preview);
    expect(commsEmailConfirmPreview({ ...preview, to_address: 42 })).toBeNull();
  });

  it('forwards the STORED approved command and operation, never the model re-emission', async () => {
    const stored = { expected_tenant_id: tenant, operation_id: operation, command, recipient: 'dana@example.test', from_address: 'hello@business.test', content_digest: 'f'.repeat(64) };
    const h = harness([{ fingerprint, args: stored }], { ok: true, outcome: 'provider_accepted', provider_receipt_available: true, delivery_confirmed: false, message_id: 'private-message', reconciled_operation_id: operation });
    const result = await dispatchCommsEmailChat({ ...context, args: { ...args, subject: 'Changed by the model', body: 'Different words' }, approved: new Set([fingerprint]) }, h.deps as never);
    expect(h.calls).toEqual([{ name: 'comms-email-command', options: { body: { expected_tenant_id: tenant, operation_id: operation, command, approved_fingerprint: fingerprint } } }]);
    for (const p of [['eq', 'tenant_id', tenant], ['eq', 'user_id', 'actor'], ['eq', 'tool_name', 'comms_send_email'], ['is', 'thread_id', null], ['is', 'scoped_client_id', null], ['is', 'consumed_at', null], ['not', 'server_issued_at', 'is', null], ['not', 'issued_in_request', 'is', null]]) expect(h.predicates).toContainEqual(p);
    expect(h.predicates.some(p => p[0] === 'gt' && p[1] === 'expires_at')).toBe(true);
    expect(result.content).toMatchObject({ success: true, outcome: 'provider_accepted', delivery_confirmed: false });
    expect(String(result.content.note)).toMatch(/not proof it was delivered/);
    expect(JSON.stringify(result)).not.toContain('private-message');
    expect(result.content).not.toHaveProperty('operation_id');
  });

  it('picks the stored proposal for the same contact when several are live', async () => {
    const other = '55555555-5555-4555-8555-555555555555';
    const rows = [
      { fingerprint: '0123456789abcdef', args: { expected_tenant_id: tenant, operation_id: '66666666-6666-4666-8666-666666666666', command: { ...command, contact_id: other } } },
      { fingerprint, args: { expected_tenant_id: tenant, operation_id: operation, command } },
    ];
    const h = harness(rows, { ok: true, outcome: 'provider_accepted', delivery_confirmed: false });
    await dispatchCommsEmailChat({ ...context, approved: new Set([fingerprint, '0123456789abcdef']) }, h.deps as never);
    expect(h.calls[0].options.body).toMatchObject({ operation_id: operation, approved_fingerprint: fingerprint });
  });

  it('refuses ambiguous approvals, scoped-token reuse, foreign stored scope and lookup failure without dispatch', async () => {
    const amb = harness([{ fingerprint, args: { command } }, { fingerprint: '0123456789abcdef', args: { command } }]);
    expect((await dispatchCommsEmailChat({ ...context, approved: new Set([fingerprint, '0123456789abcdef']) }, amb.deps as never)).refusal).toBe('ambiguous');
    expect(amb.calls).toHaveLength(0);
    const scoped = harness([{ fingerprint, args: { expected_tenant_id: tenant, operation_id: operation, command } }]);
    expect((await dispatchCommsEmailChat({ ...context, approved: new Set([`${fingerprint}:${contact}`]) }, scoped.deps as never)).refusal).toBe('unclaimable');
    expect(scoped.calls).toHaveLength(0);
    const foreign = harness([{ fingerprint, args: { expected_tenant_id: contact, operation_id: operation, command } }]);
    expect((await dispatchCommsEmailChat({ ...context, approved: new Set([fingerprint]) }, foreign.deps as never)).refusal).toBe('unclaimable');
    expect(foreign.calls).toHaveLength(0);
    const broken = harness(); broken.deps.admin.from = () => { throw new Error('down'); };
    expect((await dispatchCommsEmailChat({ ...context, approved: new Set([fingerprint]) }, broken.deps as never)).refusal).toBe('lookup_failed');
    expect(broken.calls).toHaveLength(0);
  });

  it('rejects action injection, model operation ids, recipient addresses and bad shapes before any dispatch', async () => {
    for (const bad of [null, [], { ...args, action: 'comms.email_send' }, { ...args, operation_id: operation }, { ...args, to: 'someone@example.test' }, { ...args, recipient: 'x@y.z' }, { ...args, html: '<p>x</p>' }, { ...args, contact_id: 'Dana' }, { ...args, subject: 'a\nBcc: x@y.z' }, { ...args, body: '' }, { ...args, connector_id: 'gmail' }]) {
      const h = harness();
      const result = await dispatchCommsEmailChat({ ...context, args: bad as never }, h.deps as never);
      expect(result.content.success).toBe(false);
      expect(h.calls).toHaveLength(0);
    }
    expect((await dispatchCommsEmailChat({ ...context, tenantId: null }, harness().deps as never)).content.success).toBe(false);
  });

  it('tolerates the compatibility confirm flag the gate advertises without letting it into the command', async () => {
    const h = harness();
    await dispatchCommsEmailChat({ ...context, args: { ...args, confirm: true } }, h.deps as never);
    expect(h.calls[0].options.body.command).not.toHaveProperty('confirm');
  });

  it('never reports an unanswered or unconfirmed send as sent, and never invites a resend', async () => {
    const h = harness(); h.deps.caller.functions.invoke = async () => { throw new Error('timeout'); };
    const thrown = await dispatchCommsEmailChat(context, h.deps as never);
    expect(thrown.content).toMatchObject({ success: false, outcome: 'outcome_unknown' });
    expect(String(thrown.content.note)).toMatch(/Do not resend/);
    expect(thrown.content).not.toHaveProperty('operation_id');
    for (const outcome of ['prepared', 'dispatching', 'unknown', 'outcome_unknown']) {
      const r = await dispatchCommsEmailChat(context, harness([], { ok: true, outcome, code: 'COMMS_EMAIL_RECONCILIATION_REQUIRED' }).deps as never);
      expect(r.content).toMatchObject({ success: false, outcome: 'outcome_unknown' });
      expect(String(r.content.note)).toMatch(/could not confirm/);
    }
  });

  it('reads the error body of a non-2xx door reply (needs_setup / sender choice) and keeps it plain', async () => {
    const senders = [{ connector_id: connector, from_address: 'hello@business.test' }, { connector_id: '77777777-7777-4777-8777-777777777777', from_address: 'billing@business.test', provider: 'private' }];
    const h = harness(); h.deps.caller.functions.invoke = async () => ({ data: null, error: { context: { json: async () => ({ ok: false, outcome: 'sender_choice_required', reason: 'SENDER_CHOICE_REQUIRED', senders }) } } });
    const choice = await dispatchCommsEmailChat(context, h.deps as never);
    expect(choice.content).toMatchObject({ success: false, outcome: 'sender_choice_required', senders: [{ connector_id: connector, from_address: 'hello@business.test' }, { connector_id: '77777777-7777-4777-8777-777777777777', from_address: 'billing@business.test' }] });
    expect(String(choice.content.note)).toMatch(/Ask the person which address/);
    expect(JSON.stringify(choice)).not.toContain('private');
    const setup = harness(); setup.deps.caller.functions.invoke = async () => ({ data: null, error: { context: { json: async () => ({ ok: false, outcome: 'needs_setup', reason: 'RECIPIENT_EMAIL_MISSING', provider_error: 'private' }) } } });
    const missing = await dispatchCommsEmailChat(context, setup.deps as never);
    expect(missing.content).toMatchObject({ success: false, outcome: 'needs_setup', reason: 'RECIPIENT_EMAIL_MISSING' });
    expect(String(missing.content.note)).toMatch(/no email address/);
    expect(JSON.stringify(missing)).not.toContain('private');
  });

  it('a refusal or failure says Not sent and is never success', async () => {
    for (const [outcome, reason] of [['refused', 'BLOCKED_SUPPRESSED'], ['failed', undefined], ['held', 'QUEUED_QUIET_HOURS'], ['refused', 'RECIPIENT_CHANGED']] as const) {
      const r = await dispatchCommsEmailChat(context, harness([], { ok: false, outcome, ...(reason ? { reason } : {}) }).deps as never);
      expect(r.content).toMatchObject({ success: false, outcome });
      expect(String(r.content.note)).toMatch(/^Not sent/);
    }
  });

  it('the unknown note promises no background check, only that an identical request checks the same send', async () => {
    const h = harness(); h.deps.caller.functions.invoke = async () => { throw new Error('timeout'); };
    for (const r of [await dispatchCommsEmailChat(context, h.deps as never), await dispatchCommsEmailChat(context, harness([], { ok: false, outcome: 'outcome_unknown', code: 'COMMS_EMAIL_RECONCILIATION_REQUIRED' }).deps as never)]) {
      expect(String(r.content.note)).toContain('Do not resend. Say you could not confirm whether it went out; asking for the same email again will check that send rather than send a second one.');
      expect(String(r.content.note)).not.toMatch(/keeps checking|will never send it twice/);
    }
  });

  it('only an unconfirmed outcome narrates "could not confirm"; a door refusal before any send says Not sent in plain words', async () => {
    const viaError = (body: unknown) => { const h = harness(); h.deps.caller.functions.invoke = async () => ({ data: null, error: { context: { json: async () => body } } }); return h; };
    for (const body of [
      { ok: false, code: 'WORKSPACE_CHANGED' }, { ok: false, code: 'COMMS_EMAIL_COMMAND_INVALID' }, { ok: false, code: 'UNAUTHENTICATED' },
      { ok: false, code: 'METHOD_NOT_ALLOWED' }, { ok: false, code: 'APPROVAL_STORE_UNAVAILABLE' },
      { ok: false, outcome: 'refused', code: 'WORKSPACE_CHANGED' }, { ok: false, outcome: 'refused', code: 'COMMS_EMAIL_FORBIDDEN' },
      { ok: false, outcome: 'refused', code: 'APPROVAL_CLAIM_INVALID' }, { ok: false, outcome: 'refused', reason: 'SEND_NO_LONGER_ELIGIBLE' },
    ]) {
      const r = await dispatchCommsEmailChat(context, viaError(body).deps as never);
      expect(r.content).toMatchObject({ success: false, outcome: 'refused' });
      expect(String(r.content.note)).toMatch(/^Not sent\./);
      expect(String(r.content.note)).not.toMatch(/could not confirm|Do not resend/);
    }
    // A reply that is not the door's own pre-send refusal (a gateway/runtime error body) proves
    // nothing about whether the door had already asked for the send: it stays unconfirmed.
    for (const body of [{ code: 'WORKER_ERROR', message: 'crashed' }, { ok: false }, { message: 'Internal' }]) {
      const r = await dispatchCommsEmailChat(context, viaError(body).deps as never);
      expect(r.content).toMatchObject({ success: false, outcome: 'outcome_unknown' });
      expect(String(r.content.note)).toMatch(/could not confirm/);
    }
  });

  it('a replayed result is narrated as the saved result of an earlier identical request', async () => {
    const note = 'This is the saved result of an earlier identical request; nothing new was sent.';
    const accepted = await dispatchCommsEmailChat(context, harness([], { ok: true, outcome: 'provider_accepted', replayed: true, delivery_confirmed: false }).deps as never);
    expect(accepted.content).toMatchObject({ success: true, replayed: true });
    expect(String(accepted.content.note)).toContain(note);
    const refused = await dispatchCommsEmailChat(context, harness([], { ok: false, outcome: 'refused', reason: 'BLOCKED_SUPPRESSED', replayed: true }).deps as never);
    expect(String(refused.content.note)).toMatch(/^Not sent/);
    expect(String(refused.content.note)).toContain(note);
    const fresh = await dispatchCommsEmailChat(context, harness([], { ok: true, outcome: 'provider_accepted', delivery_confirmed: false }).deps as never);
    expect(String(fresh.content.note)).not.toContain(note);
  });

  it('an identical email already in flight is narrated as unconfirmed, never as Not sent', async () => {
    const r = await dispatchCommsEmailChat(context, harness([], { ok: false, outcome: 'outcome_unknown', code: 'COMMS_EMAIL_IDENTICAL_IN_FLIGHT', reconciled_operation_id: '99999999-9999-4999-8999-999999999999' }).deps as never);
    expect(r.content).toMatchObject({ success: false, outcome: 'outcome_unknown', delivery_confirmed: false });
    expect(String(r.content.note)).toMatch(/already being sent/);
    expect(String(r.content.note)).not.toMatch(/Not sent/);
    expect(r.content.reconciled).toBeUndefined();
  });

  it('every reachable reason has a plain-language note and no note quotes an internal code', async () => {
    const reasons = ['RECIPIENT_EMAIL_MISSING', 'TENANT_EMAIL_SENDER_MISSING', 'EMAIL_PROVIDER_NOT_CONFIGURED', 'EMAIL_RECONNECT_REQUIRED', 'BLOCKED_SUPPRESSED', 'BLOCKED_CLIENT_DND', 'BLOCKED_NO_CONSENT',
      'QUEUED_TENANT_DND', 'QUEUED_QUIET_HOURS', 'RECIPIENT_PREFERENCES_UNVERIFIED', 'EMAIL_READINESS_UNVERIFIED', 'CONTACT_NOT_IN_WORKSPACE', 'RECIPIENT_CHANGED', 'SENDER_CHANGED', 'CONTENT_CHANGED',
      'SEND_NO_LONGER_ELIGIBLE', 'PRE_SEND_UNVERIFIED', 'PROVIDER_REJECTED', 'PROVIDER_NOT_ATTEMPTED', 'UNSPECIFIED', 'WORKSPACE_CHANGED', 'COMMS_EMAIL_RECONCILIATION_REQUIRED',
      'COMMS_EMAIL_INVALID', 'COMMS_EMAIL_AUTHORITY_UNAVAILABLE', 'COMMS_EMAIL_PREPARE_REFUSED', 'SEND_NOT_ADMITTED'];
    const codes = ['COMMS_EMAIL_COMMAND_INVALID', 'UNAUTHENTICATED', 'METHOD_NOT_ALLOWED', 'COMMS_EMAIL_FORBIDDEN', 'COMMS_EMAIL_REPLAY_UNAVAILABLE', 'COMMS_EMAIL_PARTIES_UNAVAILABLE',
      'COMMS_EMAIL_RECONCILIATION_UNVERIFIED', 'APPROVAL_STORE_UNAVAILABLE', 'APPROVAL_CYCLE_INVALID', 'APPROVAL_CLAIM_INVALID', 'COMMS_EMAIL_DECISION_RECEIPT_FAILED'];
    const notes = new Set<string>();
    const fallback = String((await dispatchCommsEmailChat(context, harness([], { ok: false, outcome: 'refused', reason: 'SOMETHING_NEW' }).deps as never)).content.note);
    for (const [key, value] of [...reasons.map(r => ['reason', r]), ...codes.map(c => ['code', c])]) {
      const outcome = key === 'reason' && value === 'COMMS_EMAIL_RECONCILIATION_REQUIRED' ? 'outcome_unknown' : 'refused';
      const r = await dispatchCommsEmailChat(context, harness([], { ok: false, outcome, [key]: value }).deps as never);
      const note = String(r.content.note);
      expect(note, value).not.toMatch(/Report this plainly/);
      expect(note, value).not.toBe(fallback);
      expect(note, value).not.toMatch(/\b[A-Z][A-Z0-9]*_[A-Z0-9_]+\b/);
      notes.add(note);
    }
    expect(notes.size).toBeGreaterThan(15);
    // An unrecognised code still gets a plain fallback, never the code itself.
    const odd = await dispatchCommsEmailChat(context, harness([], { ok: false, outcome: 'refused', reason: 'SOMETHING_NEW' }).deps as never);
    expect(String(odd.content.note)).toMatch(/^Not sent\./);
    expect(String(odd.content.note)).not.toContain('SOMETHING_NEW');
  });

  it('projects only closed, scalar result keys', () => {
    expect(commsEmailChatSafeResult({ ok: true, outcome: 'provider_accepted', provider_message_id: 'private', message_id: 'private', reason: 'lower case private', code: 'X', replayed: true, reconciled_operation_id: operation, headers: { k: 'private' } }))
      .toEqual({ ok: true, outcome: 'provider_accepted', code: 'X', replayed: true, reconciled: true });
  });
});

// The ACTUAL paige-ai-chat branch and confirm-trace line, executed with injected bindings (the same
// technique as sales-chat-cancellation.test.ts). Proves containment and the card's preview hand-off,
// not a hosted Chat drive.
import { readFileSync } from 'node:fs';
import { transpileModule, ModuleKind, ScriptTarget } from 'typescript';
const chatSource = readFileSync('supabase/functions/paige-ai-chat/index.ts', 'utf8');
const compile = (code: string) => transpileModule(code, { compilerOptions: { module: ModuleKind.None, target: ScriptTarget.ES2022 } }).outputText;
const branchStart = chatSource.indexOf('if (COMMS_EMAIL_TOOL_NAMES.has(tc.function.name)) {');
const branchEnd = chatSource.indexOf('// ── THE ONE PUBLISH DOOR', branchStart);
if (branchStart < 0 || branchEnd <= branchStart) throw Error('Actual comms email dispatch branch missing');
const branch = compile(`return (async()=>{for(const tc of toolCalls){${chatSource.slice(branchStart, branchEnd)}}return toolResults})()`);
async function chatBranch(cancellationsRecorded: boolean, current = true) {
  const calls: { ctx: Record<string, unknown>; deps: Record<string, unknown> }[] = [];
  const run = async (ctx: Record<string, unknown>, deps: Record<string, unknown>) => { calls.push({ ctx, deps }); return { content: { success: false, needs_confirm: true }, tokens: [fingerprint], refusal: undefined }; };
  const approvalTokenTool = new Map();
  const bindings = { cancellationsRecorded, revalidateProposalScope: async () => current, COMMS_EMAIL_TOOL_NAMES, toolCalls: [{ id: 'call-1', function: { name: 'comms_send_email', arguments: JSON.stringify(args) } }], toolResults: [], messages: [{ role: 'user', content: 'email Dana' }], personaCtx: { tenant_id: tenant }, user: { id: 'actor' }, approvedConfirmations: new Set([fingerprint]), payloadThreadId: 'thread', dispatchCommsEmailChat: run, supabaseClient: { caller: 'authenticated' }, supabaseUrl: 'test', supabaseServiceKey: 'fixture', createClient: () => ({ from: () => ({ select: () => ({}) }) }), approvalTokenTool, approvalRefusals: new Map() };
  const results = await new Function(...Object.keys(bindings), branch)(...Object.values(bindings)) as { content: string }[];
  return { calls, caller: bindings.supabaseClient, approvalTokenTool, result: JSON.parse(results[0].content) };
}
describe('actual paige-ai-chat comms email wiring', () => {
  it('an unrecorded decline or a changed workspace sends nothing', async () => {
    for (const [recorded, current] of [[false, true], [true, false]] as const) {
      const r = await chatBranch(recorded, current);
      expect(r.calls).toEqual([]);
      expect(r.result).toMatchObject({ success: false, not_applied: true, error: 'confirmation_context_unavailable' });
    }
  });
  it('dispatches through the caller JWT client with the turn, approvals and model args', async () => {
    const r = await chatBranch(true);
    expect(r.calls).toHaveLength(1);
    expect(r.calls[0].deps.caller).toBe(r.caller);
    expect(r.calls[0].ctx).toMatchObject({ tenantId: tenant, userId: 'actor', toolName: 'comms_send_email', args, sameToolCalls: 1, turn: { thread_id: 'thread', user_turn_ordinal: 1, user_turn: 'email Dana' } });
    expect(r.approvalTokenTool.get(fingerprint)).toBe('comms_send_email');
  });
  it('the card frame carries the validated email preview as paige_confirm.preview', () => {
    const line = chatSource.split('\n').find(l => l.includes('confirmTrace.push({ tool: parsed.tool'));
    if (!line) throw Error('confirmTrace push missing');
    const push = compile(`${line.trim()}\nreturn confirmTrace;`);
    const parsed = { needs_confirm: true, confirm_summary: 'Email Dana', confirm_fingerprint: fingerprint, confirm_preview: preview };
    const trace = new Function('confirmTrace', 'parsed', 'tc', push)([], parsed, { function: { name: 'comms_send_email' } }) as Record<string, unknown>[];
    expect(trace).toEqual([{ tool: 'comms_send_email', summary: 'Email Dana', fingerprint, preview }]);
    const without = new Function('confirmTrace', 'parsed', 'tc', push)([], { ...parsed, confirm_preview: ['x'] }, { function: { name: 'x' } }) as Record<string, unknown>[];
    expect(without[0]).not.toHaveProperty('preview');
    expect(chatSource).toContain('emitContent(controller, enc.encode(`data: ${JSON.stringify({ paige_confirm: c })}\\n\\n`))');
  });
  it('is not a resumable door tool: the door stores no thread, so a resume could never select it', () => {
    const line = chatSource.split('\n').find(l => l.includes('const doorTools = ['));
    if (!line) throw Error('doorTools list missing');
    expect(line).not.toContain('COMMS_EMAIL_TOOL_NAMES');
  });
  it('the standing honesty rule reports provider acceptance as "sent (accepted for delivery)", never received or delivered', () => {
    const rule = chatSource.split('\n').find(l => l.startsWith('2. CONFIRM THE RESULT'));
    if (!rule) throw Error('rule 2 missing');
    expect(rule).toContain('only say "sent" when delivered:true');
    expect(rule).toMatch(/provider_accepted[^.]*"sent \(accepted for delivery\)"/);
    expect(rule).toMatch(/never "received" or "delivered"/);
  });
  it('offers the tool from its domain module, exempts it from the legacy gate and records writes against messages', () => {
    expect(chatSource).toContain('toolDefs.push(...COMMS_EMAIL_TOOLS as any);');
    expect(chatSource).not.toMatch(/^\s*name: "comms_send_email",\s*$/m);
    expect(chatSource).toContain('comms_send_email: "messages"');
    expect(chatSource.indexOf('if (COMMS_EMAIL_TOOL_NAMES.has(tc.function.name)) {')).toBeLessThan(chatSource.indexOf('if (MUTATING_TOOLS.has(tc.function.name) && !CRM_COMMAND_TOOL_NAMES.has(tc.function.name as any)) {'));
  });
});
