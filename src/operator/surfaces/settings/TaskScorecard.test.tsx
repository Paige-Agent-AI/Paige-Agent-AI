import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import canonical from '@/test/fixtures/canonical-task-scorecard.json';
import { parseTaskScorecard, type TaskScorecardRead } from '@/operator/data/taskScorecardContract';
import { TaskScorecard } from './TaskScorecard';
let root: Root; let host: HTMLDivElement;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
function source(): TaskScorecardRead { return { version: '1.1.0', page: { data: parseTaskScorecard(canonical.v2, '1.1.0'), loading: false, fetching: false, error: false, updatedAt: 0, refresh: vi.fn() }, selectVersion: vi.fn(), pageOlder: vi.fn(), evaluate: vi.fn(), stopWaiting: vi.fn(), action: { status: 'idle' } }; }
async function mount(read = source()) { host = document.createElement('div'); document.body.append(host); root = createRoot(host); await act(async () => root.render(<TaskScorecard read={read} work={{ id: canonical.v2.items[0].work_ref, category: 'document' }} onInspectTask={vi.fn()} onBrowseTasks={vi.fn()} />)); return read; }
async function click(text: string) { const button = [...host.querySelectorAll('button')].find(b => b.textContent === text)!; await act(async () => button.click()); return button; }
afterEach(async () => { if (root) await act(async () => root.unmount()); host?.remove(); });
it.each(['Older evaluations', 'Newest evaluations'])('clears inspection when paging through %s and never resurrects it on reload', async (pageButton) => {
  const read = source(); read.page.data!.next_cursor = { at: canonical.v2.items[0].created_at, id: canonical.v2.items[0].run_ref };
  await mount(read); await click('Inspect evaluation');
  const heading = host.querySelector('#intel-scorecard-heading');
  await click(pageButton);
  expect(read.pageOlder).toHaveBeenCalled();
  expect(host.querySelector('[aria-label="Task evaluation inspection"]')).toBeNull();
  expect(document.activeElement).toBe(heading);
  const render = async () => act(async () => root.render(<TaskScorecard read={{ ...read }} work={null} onInspectTask={vi.fn()} onBrowseTasks={vi.fn()} />));
  read.page.data = undefined; read.page.loading = true; await render();
  read.page.data = parseTaskScorecard(canonical.v2, '1.1.0'); read.page.loading = false; await render();
  expect(host.querySelector('[aria-label="Task evaluation inspection"]')).toBeNull();
  expect(document.activeElement).toBe(heading);
});
it('renders actual returned sample, all evidence states and unknown pass rate', async () => {
  await mount(); expect(host.textContent).toContain('37.5%'); expect(host.textContent).toContain('3 / 8 applicable checks resolved'); expect(host.textContent).toContain('criterion pass rate unavailable'); expect(host.textContent).toContain('Historical replay'); expect(host.textContent).not.toContain('75%');
});
it('inspects immutable historical identities and restores opener focus on Escape', async () => {
  await mount(); const button = await click('Inspect evaluation');
  expect(host.querySelector('[aria-label="Task evaluation inspection"]')).toBe(document.activeElement);
  expect(host.textContent).toContain('Definition hash'); expect(host.textContent).toContain(canonical.v2.items[0].input_hash);
  await act(async () => document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
  expect(document.activeElement).toBe(button); expect(host.querySelector('[aria-label="Task evaluation inspection"]')).toBeNull();
});
it('explicitly replays the selected prior run using the chosen set version', async () => {
  const read = await mount(); await click('Inspect evaluation'); await click('Replay stored evidence');
  expect(read.evaluate).toHaveBeenCalledWith({ version: '1.1.0', replayRunId: canonical.v2.items[0].run_ref });
});
it('evaluates only the selected canonical task and records no task execution', async () => {
  const read = await mount(); await click('Evaluate recorded evidence');
  expect(read.evaluate).toHaveBeenCalledWith({ version: '1.1.0', workId: canonical.v2.items[0].work_ref });
  expect(host.textContent).toContain('No task, approval, provider call or model configuration is changed');
});
it('suppresses stale evidence after read refusal and offers honest empty first use', async () => {
  const read = source(); read.page.error = true; await mount(read);
  expect(host.textContent).not.toContain(canonical.v2.items[0].work_ref + ' ·'); expect(host.querySelector('table')).toBeNull(); expect(host.textContent).toContain('No stale evidence is shown');
});
it('locks write/version controls for pending and unconfirmed results but keeps refresh recovery', async () => {
  const read = source(); read.action = { status: 'unconfirmed', message: 'Refresh recorded evaluations before trying again.' }; await mount(read);
  expect([...host.querySelectorAll('button')].find(b => b.textContent === 'Evaluate recorded evidence')?.disabled).toBe(true);
  expect(host.querySelector<HTMLButtonElement>('[role="combobox"]')?.disabled).toBe(true);
  expect([...host.querySelectorAll('button')].find(b => b.textContent === 'Refresh scorecard')?.disabled).toBe(false);
});
it('does not reopen an already recorded result on workspace remount, but inspects a newly recorded action', async () => {
  const read = source(); read.action = { status: 'recorded', item: read.page.data!.items[0] }; await mount(read);
  expect(host.querySelector('[aria-label="Task evaluation inspection"]')).toBeNull();
  read.action = { status: 'recorded', item: read.page.data!.items[1] };
  await act(async () => root.render(<TaskScorecard read={{ ...read }} work={null} onInspectTask={vi.fn()} onBrowseTasks={vi.fn()} />));
  expect(host.querySelector('[aria-label="Task evaluation inspection"]')).toBe(document.activeElement);
  await click('Close evaluation');
  await act(async () => root.render(<TaskScorecard read={{ ...read }} work={null} onInspectTask={vi.fn()} onBrowseTasks={vi.fn()} />));
  expect(host.querySelector('[aria-label="Task evaluation inspection"]')).toBeNull();
});
