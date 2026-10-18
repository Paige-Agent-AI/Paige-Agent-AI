// @vitest-environment node
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { classifyAction } from '../../supabase/functions/_shared/action-risk';
import { isKnowledgeCompletedUnrecorded } from '../../supabase/functions/_shared/approval-outcome';
const source = readFileSync('supabase/functions/paige-ai-chat/index.ts', 'utf8');
const ast = ts.createSourceFile('chat.ts', source, ts.ScriptTarget.Latest, true);
let declaration: ts.VariableDeclaration | undefined;
function visit(n: ts.Node) { if (ts.isVariableDeclaration(n) && n.name.getText(ast) === 'auditWriteForTool') declaration = n; ts.forEachChild(n, visit); }
visit(ast);
if (!declaration) throw new Error('Canonical attribution missing');
const code = ts.transpileModule(`const ${declaration.getText(ast)};`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
const create = new Function('classifyAction', 'N8N_MANAGEMENT_TOOL_NAMES', 'supabaseClient', 'personaCtx', 'user',
  'WRITE_TARGET', 'resolveWriteTargetId', 'approvalChannel', 'payloadThreadId', 'scopedClientId', `${code}; return auditWriteForTool;`);
async function drive(tool: string, result: unknown) {
  const rows: Array<{ payload: { outcome: string } }> = [];
  const audit = create(() => 'ordinary', new Set(['n8n_create_workflow']), { from(table: string) {
    expect(table).toBe('paige_audit_log'); return { insert(row: { payload: { outcome: string } }) { rows.push(row); return Promise.resolve({ error: null }); } };
  } }, { tenant_id: 'test-tenant-a' }, { id: 'test-actor' }, {}, () => null, new Map(), 'test-thread', null);
  audit({ id: 'test-call', function: { name: tool, arguments: '{}' } }, { content: JSON.stringify(result) });
  await Promise.resolve(); return rows;
}
describe('canonical write attribution preserves domain outcome evidence', () => {
  it.each(['plan_set_reminder', 'plan_create', 'save_to_knowledge_base', 'crm_create_task'])('keeps %s uncertainty instead of recording a known failure', async tool => {
    const rows = await drive(tool, { success: false, outcome_unknown: true, error: 'Not confirmed' });
    expect(rows).toHaveLength(1); expect(rows[0].payload.outcome).toBe('outcome_unknown');
  });
  it('keeps the incumbent n8n uncertainty contract', async () => {
    expect((await drive('n8n_create_workflow', { ok: false, error: 'outcome_unknown' }))[0].payload.outcome).toBe('outcome_unknown');
  });
  it.each(['outcome_unknown', 'capability_outcome_unknown'])('preserves the canonical %s outcome vocabulary', async outcome => {
    expect((await drive('plan_create', { success: false, outcome }))[0].payload.outcome).toBe('outcome_unknown');
  });
  it.each([[{ success: true }, 'succeeded'], [{ success: false, not_applied: true }, 'failed']])('preserves success and answered refusal: %j', async (result, outcome) => {
    expect((await drive('plan_create', result))[0].payload.outcome).toBe(outcome);
  });
  it('does not duplicate the canonical Knowledge SQL receipt or record a proposal as execution', async () => {
    expect(await drive('knowledge_update', { success: true })).toHaveLength(0);
    expect(await drive('plan_create', { needs_confirm: true })).toHaveLength(0);
    expect(await drive('plan_create', { success: false, not_applied: true, refused_before_run: true,
      error: 'prior_effect_reconciliation_required' })).toHaveLength(0);
  });
  it.each([
    { success: false, not_applied: true, refused_before_run: true, outcome_unknown: true },
    { success: false, not_applied: true, refused_before_run: true, error: 'outcome_unknown' },
  ])('does not hide contradictory uncertainty from the canonical receipt: %j', result => {
    // A genuine uncertain effect must continue to hold later execution.
    return import('../../supabase/functions/_shared/paige-turn/interactive').then(({ interactiveEffect }) => {
      expect(interactiveEffect('plan_create', result)?.outcome).toBe('outcome_unknown');
    });
  });
});

// Execute the actual target resolver beside the actual audit closure: a stand-in resolver
// cannot catch a native action receipt being attributed to its related contact instead.
const targetDeclarations: ts.VariableDeclaration[] = [];
function collectTargets(n: ts.Node) {
  if (ts.isVariableDeclaration(n)) targetDeclarations.push(n);
  ts.forEachChild(n, collectTargets);
}
collectTargets(ast);
const targetResolver = targetDeclarations.find(n => n.name.getText(ast) === 'resolveWriteTargetId');
if (!targetResolver) throw new Error('Canonical target resolver missing');
const targetCode = ts.transpileModule(['WRITE_TARGET', 'TARGET_ID_KEYS', 'UUID', 'resolveWriteTargetId'].map(name => {
  const matches = targetDeclarations.filter(n => n.name.getText(ast) === name && n.pos <= targetResolver.pos);
  const node = matches[matches.length - 1];
  if (!node) throw new Error(`Canonical target declaration missing: ${name}`);
  return `const ${node.getText(ast)};`;
}).join('\n'), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
const createCanonicalAudit = new Function('classifyAction', 'isKnowledgeCompletedUnrecorded', 'N8N_MANAGEMENT_TOOL_NAMES',
  'supabaseClient', 'personaCtx', 'user', 'approvalChannel', 'payloadThreadId', 'scopedClientId',
  `${targetCode}\n${code}\nreturn auditWriteForTool;`);
type TargetAuditRow = {
  tenant_id: string;
  actor_user_id: string;
  action: string;
  target_type: string;
  target_id: string | null;
  payload: { outcome: string; authorised_by: string; thread_id: string; scoped_client_id: string };
};
const ACTION = '10000000-0000-4000-8000-000000000001';
const CONTACT = '10000000-0000-4000-8000-000000000002';
const OTHER_ACTION = '10000000-0000-4000-8000-000000000003';
async function driveCanonicalTarget(tool: string, args: Record<string, unknown>, result: unknown) {
  const rows: TargetAuditRow[] = [];
  const audit = createCanonicalAudit(classifyAction, isKnowledgeCompletedUnrecorded, new Set(['n8n_create_workflow']), {
    from(table: string) {
      expect(table).toBe('paige_audit_log');
      return { insert(row: TargetAuditRow) { rows.push(row); return Promise.resolve({ error: null }); } };
    },
  }, { tenant_id: 'test-tenant-a' }, { id: 'test-actor' }, new Map([['test-call', 'operator_card']]), 'test-thread', CONTACT);
  audit({ id: 'test-call', function: { name: tool, arguments: JSON.stringify(args) } }, { content: JSON.stringify(result) });
  await Promise.resolve();
  return rows;
}

describe('canonical Action Bus filing attribution', () => {
  const args = { action_kind: 'client.followup', title: 'Follow-up draft', contact_id: CONTACT };
  const nativeResult = { success: true, ok: true, action_id: ACTION, status: 'filed' };

  it('names the native created action when the contact and action are both present', async () => {
    const rows = await driveCanonicalTarget('action_file', args, nativeResult);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ tenant_id: 'test-tenant-a', actor_user_id: 'test-actor', action: 'action_file',
      target_type: 'paige_actions', target_id: ACTION,
      payload: { outcome: 'succeeded', authorised_by: 'operator_card', thread_id: 'test-thread', scoped_client_id: CONTACT } });
  });

  it('accepts only the top-level native action, ahead of contact, argument and nested readback IDs', async () => {
    const rows = await driveCanonicalTarget('action_file', { ...args, action_id: OTHER_ACTION }, {
      ...nativeResult, contact_id: CONTACT, readback: { action_id: OTHER_ACTION, contact_id: CONTACT },
    });
    expect(rows[0].target_id).toBe(ACTION);
  });

  it('keeps the native ID for filing without a contact', async () => {
    expect((await driveCanonicalTarget('action_file', { action_kind: args.action_kind, title: args.title }, nativeResult))[0].target_id).toBe(ACTION);
  });

  it.each(['00000000-0000-0000-0000-000000000000', 'ABCDEFAB-1234-4000-8000-ABCDEFABCDEF'])(
    'preserves the incumbent UUID format convention for %s', async action_id => {
      expect((await driveCanonicalTarget('action_file', args, { ...nativeResult, action_id }))[0].target_id).toBe(action_id);
    });

  it.each([undefined, null, '', 'not-an-action-uuid', ACTION.slice(0, 8), ` ${ACTION}`, 7, true, [ACTION], { action_id: ACTION }])(
    'keeps a null supplementary locator for missing or malformed native action_id: %j', async action_id => {
      const rows = await driveCanonicalTarget('action_file', { ...args, action_id: OTHER_ACTION }, {
        success: true, ok: true, status: 'filed', action_id, readback: { action_id: OTHER_ACTION },
      });
      expect(rows).toHaveLength(1);
      expect(rows[0].target_id).toBeNull();
      expect(rows[0].payload.outcome).toBe('succeeded');
    });

  it.each([null, [], [{ action_id: ACTION }], { readback: { action_id: ACTION } },
    JSON.parse(`{"__proto__":{"action_id":"${ACTION}"}}`)])('does not find authority in a nested or non-object result: %j', async result => {
    const rows = await driveCanonicalTarget('action_file', { ...args, action_id: OTHER_ACTION }, result);
    expect(rows).toHaveLength(1);
    expect(rows[0].target_id).toBeNull();
  });

  it.each([
    [{ success: false, not_applied: true }, 'failed'],
    [{ success: false, outcome_unknown: true }, 'outcome_unknown'],
    [{ success: false, outcome: 'capability_outcome_unknown' }, 'outcome_unknown'],
  ] as const)('preserves actual outcome with no native locator: %j', async (result, outcome) => {
    const rows = await driveCanonicalTarget('action_file', args, result);
    expect(rows[0].target_id).toBeNull();
    expect(rows[0].payload.outcome).toBe(outcome);
  });

  it.each(['needs_confirm', 'disabled', 'refused_before_run'])('does not attribute an unexecuted %s result', async flag => {
    expect(await driveCanonicalTarget('action_file', args, { ...nativeResult, [flag]: true })).toHaveLength(0);
  });

  it('preserves the exact native dismissal ID and its failed-attempt argument fallback', async () => {
    const dismissed = await driveCanonicalTarget('action_advance', { action_id: ACTION, to_status: 'dismissed' }, {
      success: true, ok: true, action_id: ACTION, status: 'dismissed', approval_id: null, customer_action_id: null,
    });
    expect(dismissed[0]).toMatchObject({ target_type: 'paige_actions', target_id: ACTION, payload: { outcome: 'succeeded' } });
    const refused = await driveCanonicalTarget('action_advance', { action_id: ACTION, to_status: 'dismissed' }, { success: false, not_applied: true });
    expect(refused[0]).toMatchObject({ target_id: ACTION, payload: { outcome: 'failed' } });
  });

  it('preserves native action_advance output authority ahead of its argument ID', async () => {
    const rows = await driveCanonicalTarget('action_advance', { action_id: OTHER_ACTION, to_status: 'dismissed' }, {
      success: true, ok: true, action_id: ACTION, status: 'dismissed',
    });
    expect(rows[0].target_id).toBe(ACTION);
  });

  it.each([
    ['crm_update_contact', { contact_id: CONTACT }, { success: true }, 'clients', CONTACT],
    ['automation_draft', { contact_id: CONTACT }, { success: true, automation_id: ACTION }, 'paige_automations', ACTION],
    ['plan_create', { contact_id: CONTACT }, { success: true, verified_readback: true, record_locator: { table: 'plans', id: ACTION } }, 'plans', ACTION],
  ])('preserves the existing %s target contract', async (tool, toolArgs, result, target_type, target_id) => {
    const rows = await driveCanonicalTarget(String(tool), toolArgs as Record<string, unknown>, result);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ target_type, target_id, payload: { outcome: 'succeeded' } });
  });
});
