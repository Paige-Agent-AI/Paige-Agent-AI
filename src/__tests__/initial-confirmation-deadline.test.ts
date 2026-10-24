// @vitest-environment node
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { expect, it } from 'vitest';

// Execute the actual closed metadata-writing helper. This synthetic no-I/O seam
// does not prove whole-handler admission, database/RLS or authenticated execution.
const source = readFileSync(new URL('../../supabase/functions/paige-ai-chat/index.ts', import.meta.url), 'utf8');
const tree = ts.createSourceFile('chat.ts', source, ts.ScriptTarget.Latest, true);
let initializer: string | undefined;
function visit(node: ts.Node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(tree) === 'recordConfirmation') initializer = node.initializer?.getText(tree);
  ts.forEachChild(node, visit);
}
visit(tree);
if (!initializer) throw new Error('Original confirmation writer missing');
const compiled = ts.transpileModule(`export const record = ${initializer};`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
const FP = 'aaaaaaaaaaaaaaaa', NONCE = '11111111-1111-4111-8111-111111111111';
const DEADLINE = '2030-01-02T03:04:05.000Z';

function actualRecord(existing: unknown[] = [], inserted: unknown = { expires_at: DEADLINE }) {
  const calls: Array<[string, unknown[]]> = [];
  const supabase = { from(table: string) {
    calls.push(['from', [table]]);
    let operation = 'read';
    const query = new Proxy({}, { get(_target, method: string) {
      if (method === 'then') return (resolve: (value: unknown) => void) => resolve({ data: operation === 'insert' ? inserted : operation === 'read' ? existing : null, error: null });
      return (...args: unknown[]) => {
        calls.push([method, args]);
        if (method === 'insert' || method === 'update') operation = method;
        return query;
      };
    } });
    return query;
  } };
  const dependencies = { supabase, revalidateProposalScope: async () => true, confirmationArgs: (a: unknown) => a,
    confirmFingerprint: async () => FP, confirmationToken: async () => `${FP}:${NONCE}`,
    personaCtx: { tenant_id: 'test-tenant-a' }, payloadThreadId: 'test-thread-a', scopedClientId: null,
    user: { id: 'test-owner-a' }, requestNonce: NONCE, requireRecoveryPermission: async () => {},
    scopedConfirmationFingerprint: async () => FP };
  const exports: { record?: (...a: unknown[]) => Promise<Record<string, unknown>> } = {};
  new Function('exports', ...Object.keys(dependencies), compiled)(exports, ...Object.values(dependencies));
  return { run: () => exports.record!(FP, 'delegate_to_subagent', { slug: 'zion', input: { request: 'Review current work' } }, 'Review the stored assignment'), calls };
}

it('returns the native inserted deadline rather than inventing a client or newly extended lifetime', async () => {
  const writer = actualRecord();
  expect(await writer.run()).toMatchObject({ state: 'created', fingerprint: `${FP}:${NONCE}`, expires_at: DEADLINE });
  expect(writer.calls).toContainEqual(['select', ['expires_at']]);
});
it('preserves the exact earlier deadline when the existing original proposal is reused', async () => {
  const earlier = '2029-06-01T08:00:00.000Z';
  const writer = actualRecord([{ fingerprint: FP, issued_in_request: NONCE, args: { slug: 'zion' }, summary: 'Original stored purpose', expires_at: earlier }]);
  expect(await writer.run()).toMatchObject({ state: 'exists', summary: 'Original stored purpose', expires_at: earlier });
  expect(writer.calls.some(([method]) => method === 'insert')).toBe(false);
  expect(writer.calls).toContainEqual(['eq', ['tenant_id', 'test-tenant-a']]);
  expect(writer.calls).toContainEqual(['eq', ['thread_id', 'test-thread-a']]);
});
it('never substitutes a fresh deadline when insertion did not return verified expiry metadata', async () => {
  const writer = actualRecord([], null);
  expect(await writer.run()).toMatchObject({ state: 'created', expires_at: null });
  expect(writer.calls.filter(([method]) => method === 'insert')).toHaveLength(1);
});
