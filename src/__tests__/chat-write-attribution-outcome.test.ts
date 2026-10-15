// @vitest-environment node
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
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
