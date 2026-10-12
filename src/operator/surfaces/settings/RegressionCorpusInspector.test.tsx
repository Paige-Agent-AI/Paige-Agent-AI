import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, expect, it, vi } from 'vitest';
import { webcrypto } from 'node:crypto';
import canonical from '@/test/fixtures/canonical-regression-corpus.json';
import { parseRegressionCorpus, type RegressionCorpusRead } from '@/operator/data/regressionCorpusContract';
import { RegressionCorpusInspector } from './RegressionCorpusInspector';
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let root: Root; let host: HTMLDivElement; let read: RegressionCorpusRead;
beforeAll(() => Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true }));
async function mount() {
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  read = { cursor: null, pageOlder: vi.fn(), page: { data: await parseRegressionCorpus(canonical), loading: false, fetching: false, error: false, updatedAt: Date.now(), refresh: vi.fn() } };
  await act(async () => root.render(<RegressionCorpusInspector read={read} />));
}
async function click(label: string) { const button = Array.from(host.querySelectorAll('button')).find(b => b.textContent === label)!; await act(async () => button.click()); return button; }
afterEach(async () => { if (root) await act(async () => root.unmount()); host?.remove(); });
it('inspects genuine projected results with an explicitly expected controlled FAIL and expandable provenance', async () => {
  await mount(); await click('Inspect case'); expect(document.activeElement?.getAttribute('aria-label')).toBe('Regression case inspection');
  expect(host.textContent).toContain('Expected FAIL: the controlled regression-detection test caught the old defect');
  expect(host.textContent).toContain('This is not a current production failure'); expect(host.querySelector('details')?.open).toBe(false);
  expect(host.textContent).toContain(canonical.items[0].case_hash); expect(host.textContent).toContain('historical customer impact is UNKNOWN');
  expect(host.querySelector<HTMLButtonElement>('button[disabled]')?.disabled).toBe(true);
});
it.each(['Back', 'Escape'])('returns focus to the exact case opener through %s', async exit => {
  await mount(); const opener = await click('Inspect case');
  if (exit === 'Back') await click('Back to Improvement Studio');
  else await act(async () => document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
  expect(host.querySelector('[aria-label="Regression case inspection"]')).toBeNull(); expect(document.activeElement).toBe(opener);
});
it('clears selected history on a failed or in-flight refresh and never reopens it on retry', async () => {
  await mount(); await click('Inspect case');
  await act(async () => root.render(<RegressionCorpusInspector read={{ ...read, page: { ...read.page, fetching: true } }} />));
  expect(host.textContent).not.toContain('Expected FAIL:'); expect(document.activeElement?.id).toBe('intel-corpus-heading');
  await act(async () => root.render(<RegressionCorpusInspector read={read} />)); expect(host.querySelector('[aria-label="Regression case inspection"]')).toBeNull();
});
it('keeps missing corrected evidence indeterminate while showing separate frozen historical records', async () => {
  await mount(); const p = structuredClone(canonical); const row = p.items[0].history[1]; Object.assign(row, { result_ref: null, verdict: 'indeterminate', evidence_state: 'missing' }); p.items[0].latest_corrected_result = structuredClone(row);
  read.page.data = await parseRegressionCorpus(p); await act(async () => root.render(<RegressionCorpusInspector read={{ ...read }} />));
  await click('Inspect case'); expect(host.textContent).toContain('0 / 1 required check resolved'); expect(host.textContent).toContain('does not pass a required regression gate');
  expect(host.textContent).toContain('Expected FAIL:'); expect(host.textContent).not.toContain('Task completed');
});
it('hides cached case data on error and offers truthful unavailable state without executing replay', async () => {
  await mount(); read.page = { ...read.page, error: true, unavailable: true }; await act(async () => root.render(<RegressionCorpusInspector read={read} />));
  expect(host.textContent).toContain('Corpus reader unavailable'); expect(host.textContent).not.toContain('Credit-sync audit integrity');
  expect(host.textContent).not.toContain('Run replay');
});
