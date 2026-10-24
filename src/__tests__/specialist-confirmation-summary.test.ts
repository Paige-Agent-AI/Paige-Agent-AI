// @vitest-environment node
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import * as labels from '../../supabase/functions/_shared/paige-turn/specialist-step-label';

// Execute the actual production confirmation branch, not a copied formatter.
// This closed branch harness is not authentication or whole-handler proof.
function actualSummary(args: unknown, roster = [{ slug: 'zion', displayName: 'ZION' }]) {
  const source = readFileSync(new URL('../../supabase/functions/paige-ai-chat/index.ts', import.meta.url), 'utf8');
  const start = source.indexOf('const describeConfirm = async');
  const branch = source.slice(start).match(/case "delegate_to_subagent":\s*([\s\S]*?)\s*case "automation_draft"/)?.[1];
  if (start < 0 || !branch) throw new Error('Original confirmation branch missing');
  return new Function('a', 'specialistStepRoster', 'specialistAssignmentSummary', branch)(
    args, roster, Reflect.get(labels, 'specialistAssignmentSummary'),
  ) as string;
}

it('shows the current stored assignment purpose and scoped specialist name', () => {
  expect(actualSummary({ slug: 'zion', input: { request: 'Prepare a weekly planning draft.' } }))
    .toBe('Request an assignment from ZION: “Prepare a weekly planning draft.”');
});

it('prefers actual current slug and input over conflicting legacy fields', () => {
  expect(actualSummary({ slug: 'zion', subagent_slug: 'foreign', task: 'Wrong legacy brief', input: { request: 'Current brief' } }))
    .toBe('Request an assignment from ZION: “Current brief”');
});
it('preserves the original legacy task input when a modern brief is absent', () => {
  expect(actualSummary({ subagent_slug: 'zion', task: 'Inspect recorded deadlines' }))
    .toBe('Request an assignment from ZION: “Inspect recorded deadlines”');
});
it('does not turn an empty modern brief into unrelated legacy work', () => {
  expect(actualSummary({ slug: 'zion', task: 'Other work', input: { request: '  ' } }))
    .toBe('Request an assignment from ZION. Review its scope before approving.');
});
it('never takes a displayed name from arguments or an unknown registration', () => {
  const text = actualSummary({ slug: 'foreign', name: 'Private display name', input: { request: 'Review work' } });
  expect(text).toBe('Request an assignment from a specialist: “Review work”');
  expect(text).not.toContain('Private display name');
});
it('keeps dynamic scoped names rather than hardcoding a specialist or business', () => {
  expect(actualSummary({ slug: 'desk', input: { request: 'Review work' } }, [{ slug: 'desk', displayName: 'Operations desk' }]))
    .toBe('Request an assignment from Operations desk: “Review work”');
});
it('refuses ambiguous or markup-bearing scoped labels', () => {
  const a = { slug: 'zion', input: { request: 'Review work' } };
  expect(actualSummary(a, [{ slug: 'zion', displayName: 'One' }, { slug: 'zion', displayName: 'Two' }])).toContain('from a specialist:');
  expect(actualSummary(a, [{ slug: 'zion', displayName: '<script>label</script>' }])).toContain('from a specialist:');
});
it('does not stringify structured context, tokens or other input fields', () => {
  const text = actualSummary({ slug: 'zion', token: 'not-for-display', input: { request: {}, context: { secret: 'private-context' } } });
  expect(text).toBe('Request an assignment from ZION. Review its scope before approving.');
  expect(text).not.toMatch(/not-for-display|private-context|object Object/);
});
it.each([[null], [[]], [true], ['untrusted text']])('handles non-object arguments without manufacturing scope: %j', a => {
  expect(actualSummary(a)).toBe('Request an assignment from a specialist. Review its scope before approving.');
});
it('normalizes multiline and directional controls inside the quoted brief', () => {
  expect(actualSummary({ slug: 'zion', input: { request: '  Review\nwork\t\u202e now\u0000 ' } }))
    .toBe('Request an assignment from ZION: “Review work now”');
});
it('bounds the shown brief without splitting its Unicode characters', () => {
  const text = actualSummary({ slug: 'zion', input: { request: '😀'.repeat(2000) } });
  expect(text).toBe('Request an assignment from ZION: “' + '😀'.repeat(180) + '…”');
});
it('does not scan a distant hidden brief into the customer message', () => {
  expect(actualSummary({ slug: 'zion', input: { request: ' '.repeat(20000) + 'Hidden outside preview budget' } }))
    .toBe('Request an assignment from ZION. Review its scope before approving.');
});
it('does not infer planning-only authority from an argument or approve its own proposal', () => {
  const args = Object.freeze({ slug: 'zion', confirm: true, input: Object.freeze({ job_kind: 'plan', request: 'Review work' }) });
  const before = JSON.stringify(args);
  expect(actualSummary(args)).toBe('Request an assignment from ZION: “Review work”');
  expect(JSON.stringify(args)).toBe(before);
});
