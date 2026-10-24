import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { invokeOutcomeUnknown, OUTCOME_UNKNOWN_NOTE } from '../../supabase/functions/_shared/approval-outcome';

// Execute the actual native-door response statements, not a duplicate classifier.
const source = readFileSync('supabase/functions/paige-ai-chat/index.ts', 'utf8');
const ast = ts.createSourceFile('chat.ts', source, ts.ScriptTarget.Latest, true);
let branch: ts.Block | undefined;
function visit(node: ts.Node) {
  if (ts.isIfStatement(node) && node.expression.getText(ast).startsWith('CRM_COMMAND_TOOL_NAMES.has(') && ts.isBlock(node.thenStatement)
    && node.thenStatement.statements.some(s => ts.isVariableStatement(s) && s.declarationList.declarations.some(d => d.name.getText(ast) === 'crmBody'))) {
    if (branch) throw new Error('Ambiguous canonical CRM outcome branch');
    branch = node.thenStatement;
  }
  ts.forEachChild(node, visit);
}
visit(ast);
if (!branch) throw new Error('Canonical CRM Chat door missing');
const statements = branch.statements;
const start = statements.findIndex(s => ts.isVariableStatement(s) && s.declarationList.declarations.some(d => d.name.getText(ast) === 'crmBody'));
const end = statements.findIndex((s, i) => i > start && ts.isIfStatement(s) && s.expression.getText(ast) === 'doorPin');
if (start < 0 || end <= start) throw new Error('Canonical native acknowledgement statements missing');
const code = ts.transpileModule(`async function classify(crmData, crmError, action, canonicalCrmCommand, idempotencyKey, invokeOutcomeUnknown, OUTCOME_UNKNOWN_NOTE) {
${statements.slice(start, end).map(s => s.getText(ast)).join('\n')}
return crmContent;
}`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
const classify = new Function(`${code}; return classify;`)();
const command = { action: 'contact.create', name: 'Protected fixture' };
const map = (data: unknown, error: unknown = null, action = 'contact.create') =>
  classify(data, error, action, command, 'fixture-original-operation', invokeOutcomeUnknown, OUTCOME_UNKNOWN_NOTE);
const http = (status: number, body: unknown = {}) => ({ name: 'FunctionsHttpError', context: { status, json: async () => body } });

describe('CRM Chat requires an explicit native execution acknowledgement', () => {
  it.each(['contact.create', 'contact.update', 'contact.assign_owner', 'task.create', 'deal.create', 'deal.assign_contact'])('preserves the native successful %s result', async action => {
    const native = { ok: true, outcome: 'executed', record_id: 'fixture-record', receipt_id: 'fixture-receipt', replayed: false };
    expect(await map(native, null, action)).toEqual({ success: true, ...native });
  });
  it.each([null, undefined, {}, [], 'ok', 0, { ok: 'true' }, { success: true }, { ok: null }, { success: true, not_applied: true }, { ok: 'true', refused_before_run: true }])('does not claim execution or non-application for malformed native response %j', async data => {
    const out = await map(data);
    expect(out.success).toBe(false);
    expect(out.outcome_unknown).toBe(true);
    expect(out.not_applied).not.toBe(true);
    expect(out.refused_before_run).not.toBe(true);
    expect(out.note).toBe(OUTCOME_UNKNOWN_NOTE);
  });
  it('does not treat an error carrying contradictory ok=true as non-application', async () => {
    const out = await map(null, http(500, { ok: true, outcome: 'executed' }));
    expect(out.success).toBe(false);
    expect(out.outcome_unknown).toBe(true);
    expect(out.not_applied).not.toBe(true);
  });
  it.each([401, 404, 413, 429])('retains known pre-dispatch gateway refusal %i', async status => {
    const out = await map(null, http(status));
    expect(out.success).toBe(false);
    expect(out.not_applied).toBe(true);
    expect(out.outcome_unknown).not.toBe(true);
  });
  it.each([408, 500, 502, 504])('retains uncertainty for unanswered transport status %i', async status => {
    const out = await map(null, http(status));
    expect(out.success).toBe(false);
    expect(out.outcome_unknown).toBe(true);
    expect(out.not_applied).not.toBe(true);
  });
  it('preserves an explicit native refusal and its actionable reason', async () => {
    const native = { ok: false, code: 'CRM_PATCH_FIELDS_INVALID', message: 'Review the unsupported fields.', detail: ['fixture_field'], request_key: 'fixture-original-operation' };
    const out = await map(native);
    expect(out).toMatchObject({ ...native, success: false, not_applied: true });
    expect(out.outcome_unknown).not.toBe(true);
  });
  it('preserves native post-write uncertainty without inventing non-application', async () => {
    const out = await map({ ok: false, outcome_unknown: true, code: 'CRM_READBACK_UNKNOWN' });
    expect(out).toMatchObject({ success: false, outcome_unknown: true });
    expect(out.not_applied).not.toBe(true);
  });
  it('keeps the one native proposal and exact stored-command fields', async () => {
    const out = await map({ ok: false, outcome: 'approval_required', fingerprint: 'fixture-fingerprint', summary: 'Review the fixture.' });
    expect(out).toMatchObject({ success: false, needs_confirm: true, confirm_fingerprint: 'fixture-fingerprint', confirm_command: command, confirm_idempotency_key: 'fixture-original-operation' });
    expect(out.outcome_unknown).not.toBe(true);
  });
  it('keeps internal activity distinct from an external communication', async () => {
    const out = await map({ ok: true, outcome: 'executed' }, null, 'activity.log');
    expect(out.success).toBe(true);
    expect(out.external_effect).toBe(false);
    expect(out.note).toContain('No email or SMS was sent');
  });
});
