// @vitest-environment node
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { automationDraftSummary } from '../../supabase/functions/_shared/paige-orchestration/automation-draft-summary';

// Existing confirmation branch, without executing a command or inventing authority.
function actualSummary(a: unknown) {
  const source = readFileSync(new URL('../../supabase/functions/paige-ai-chat/index.ts', import.meta.url), 'utf8');
  const start = source.indexOf('const describeConfirm = async');
  const branch = source.slice(start).match(/case "automation_draft":\s*([\s\S]*?)\s*case "automation_set_grant"/)?.[1];
  if (start < 0 || !branch) throw new Error('Original automation confirmation branch missing');
  return new Function('a', 'automationDraftSummary', branch)(a, automationDraftSummary) as string;
}

const args = () => ({ name: 'Client kickoff', trigger_key: 'contact.created',
  steps: [{ action_kind: 'owner.task', config: { title: 'Prepare the kickoff agenda', description: 'Check the signed scope before assigning work.' } }] });

it('lets the owner review the actual internal task before saving its draft', () => {
  const summary = actualSummary(args());
  expect(summary).toContain('Prepare the kickoff agenda');
  expect(summary).toContain('Check the signed scope before assigning work.');
});
it('distinguishes the original contact trigger and draft save from future execution', () => {
  const summary = actualSummary(args());
  expect(summary).toContain('When a new contact is added');
  expect(summary).toContain('No task is created or process enabled by saving this draft.');
});
it('does not change the original stored arguments or grant an execution lane', () => {
  const a = args(), before = JSON.stringify(a);
  actualSummary(a);
  expect(JSON.stringify(a)).toBe(before);
  expect(a).not.toHaveProperty('confirm');
  expect(a).not.toHaveProperty('granted_lane');
});

it('preserves ordered original task purposes without inventing an assignee or due date', () => {
  const a = args();
  a.steps.push({ action_kind: 'owner.task', config: { title: 'Review delivery evidence', description: 'Ask the accountable reviewer.' } });
  const text = automationDraftSummary(a);
  expect(text.indexOf('1. Prepare an internal task: “Prepare the kickoff agenda”'))
    .toBeLessThan(text.indexOf('2. Prepare an internal task: “Review delivery evidence”'));
  expect(text).not.toMatch(/assigned to|due tomorrow|successfully saved|already enabled/i);
});
it('does not stringify unknown step configuration, credentials or provider readiness', () => {
  const text = automationDraftSummary({ name: 'Review process', trigger_key: 'business.event', steps: [
    { tool_key: 'comms_send_email', config: { token: 'private-token', recipient: 'private@example.invalid', html: '<script>private-body</script>' } },
  ] });
  expect(text).toContain('Configured trigger: business.event.');
  expect(text).toContain('Configured step: comms_send_email.');
  expect(text).toContain('Configuration and execution support are not verified');
  expect(text).not.toMatch(/private-token|private@example|private-body|connected sender/);
});
it('keeps malformed or conflicting step selectors visibly unverified', () => {
  const text = automationDraftSummary({ steps: [null, { action_kind: 'owner.task', tool_key: 'foreign', config: { title: 'Not a verified native task' } }] });
  expect(text).toContain('1. Step needs review.');
  expect(text).toContain('2. Configured step: foreign.');
  expect(text).not.toContain('Not a verified native task');
});
it('bounds long previews and marks omitted text without splitting Unicode characters', () => {
  const text = automationDraftSummary({ name: '😀'.repeat(1000), trigger_key: 'contact.created',
    steps: Array.from({ length: 21 }, () => ({ action_kind: 'owner.task', config: { title: '😀'.repeat(1000), description: '🧭'.repeat(2000) } })) });
  expect(text).toContain('Additional steps are not shown');
  expect(text).toContain('😀'.repeat(160) + '…');
  expect(text).toContain('🧭'.repeat(240) + '…');
  expect(text).not.toContain('21.');
  expect(text.length).toBeLessThan(18000);
  expect(text).not.toMatch(/[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/u);
});
it('removes display controls without mutating source bytes or exposing extra task settings', () => {
  const a = { name: 'Kick\n\u202eoff', trigger_key: 'contact.created', steps: [{ action_kind: 'owner.task', config: {
    title: 'Read\t\u2066the brief', description: 'Review\u0000 it', token: 'private-token', assignee: 'forged-owner',
  } }] };
  const before = JSON.stringify(a), text = automationDraftSummary(a);
  expect(text).toContain('Save draft “Kick off”.');
  expect(text).toContain('“Read the brief”');
  expect(text).toContain('Additional task settings are not shown');
  expect(text).not.toMatch(/private-token|forged-owner|\u202e|\u2066/);
  expect(JSON.stringify(a)).toBe(before);
});
it('keeps the bounded source-prefix cut well formed after hidden controls are removed', () => {
  // The 4096-unit CPU bound lands BETWEEN the two units of the final emoji.
  const edge = '\u202e'.repeat(4095) + '😀';
  const a = { name: edge, trigger_key: 'contact.created', steps: [{ action_kind: 'owner.task', config: {
    title: 'Review the brief', description: edge,
  } }] };
  const before = JSON.stringify(a), text = automationDraftSummary(a);
  expect(text).not.toMatch(/[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/u);
  expect(text).toContain('Review the brief');
  expect(JSON.stringify(a)).toBe(before);
});
it.each([null, [], true, 'not arguments'])('does not manufacture a process from malformed input: %j', value => {
  expect(automationDraftSummary(value)).toContain('No steps are available to review.');
});
