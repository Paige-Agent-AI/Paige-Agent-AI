import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PaigeArtifactCard } from './PaigeArtifactCard';
const state = vi.hoisted(() => ({ load: vi.fn(), scope: 'initial', rendered: [] as Array<{ scope: string; title: string }> }));
vi.mock('@/components/admin/studio/studio', () => ({ loadDocument: state.load }));
vi.mock('@/components/admin/studio/DocumentPreview', () => ({ DocumentPreview: ({ document, toolbar = true }: { document: { title: string }; toolbar?: boolean }) => {
  state.rendered.push({ scope: state.scope, title: document.title });
  return <>{toolbar && <button type="button">Print / Save as PDF</button>}<p>{document.title}</p></>;
} }));
const artifact = { id: 'test-original-record', title: 'Original review', artifactType: 'document' as const };
const doc = { id: artifact.id, title: 'Recorded source facts', docType: 'business_review', blocks: [{ type: 'prose', markdown: 'Recorded source facts' }] };
let host: HTMLDivElement, root: Root;
beforeEach(() => { state.load.mockReset(); state.scope = 'initial'; state.rendered = []; host = document.createElement('div'); document.body.append(host); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
const paint = async (tenantId = 'test-workspace-one', selected = artifact) => { await act(async () => root.render(<PaigeArtifactCard artifact={selected} tenantId={tenantId} />)); };
const originalOpen = () => Array.from(host.querySelectorAll('button')).find(button => button.textContent?.trim() === 'Open')!;
const click = async (button: HTMLElement) => { await act(async () => { button.click(); await new Promise(resolve => setTimeout(resolve, 0)); }); };
describe('original artifact review context and return', () => {
  it('returns keyboard focus to the exact control that opened the original review', async () => {
    state.load.mockResolvedValue(doc); await paint();
    expect(host.textContent).toContain('Document · Business review');
    const open = originalOpen(); open.focus(); await click(open);
    expect(document.querySelector('[role="dialog"]')).toBeTruthy();
    await act(async () => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true })); await new Promise(resolve => setTimeout(resolve, 0)); });
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    // Radix dispatches its real unmount-auto-focus event after the close commit.
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
    expect(document.activeElement).toBe(open);
  });
  it('withholds the previous document on the first render of a different workspace', async () => {
    state.load.mockResolvedValueOnce(doc).mockImplementation(() => new Promise(() => {}));
    await paint(); expect(host.textContent).toContain('Document · Business review');
    state.rendered = []; state.scope = 'next';
    await paint('test-workspace-two');
    expect(state.rendered.filter(row => row.scope === 'next')).toEqual([]);
    expect(host.textContent).not.toContain('Recorded source facts');
  });
  it('discards a late original read after the artifact changes', async () => {
    let finish!: (value: typeof doc) => void;
    state.load.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; })).mockResolvedValueOnce(null);
    await paint();
    await paint('test-workspace-one', { ...artifact, id: 'test-next-record' });
    await act(async () => finish(doc));
    expect(host.textContent).not.toContain('Recorded source facts');
  });
  it('does not invent a filed document or offer execution after the original read is refused', async () => {
    state.load.mockResolvedValue(null); await paint(); await click(originalOpen());
    const dialog = document.querySelector('[role="dialog"]')!;
    expect(dialog.textContent).toContain('Preview unavailable');
    expect(dialog.textContent).not.toMatch(/filed to the project/i);
    expect(Array.from(dialog.querySelectorAll('button')).some(button => button.textContent?.trim() === 'Send')).toBe(false);
  });
  it('retries only the same original read and focuses its recovered preview', async () => {
    state.load.mockResolvedValueOnce(null).mockResolvedValueOnce(doc);
    await paint(); await click(originalOpen());
    const retry = Array.from(document.querySelectorAll('[role="dialog"] button')).find(button => button.textContent?.trim() === 'Retry preview');
    expect(retry).toBeTruthy(); await click(retry as HTMLElement);
    expect(state.load.mock.calls).toEqual([['test-workspace-one', artifact.id], ['test-workspace-one', artifact.id]]);
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain('Recorded source facts');
    expect(document.activeElement?.textContent).toBe('Print / Save as PDF');
  });
  it('keeps the decorative thumbnail out of keyboard interaction', async () => {
    state.load.mockResolvedValue(doc); await paint();
    const thumbnail = host.querySelector('button[aria-label="Open Original review"]')!;
    expect(thumbnail.querySelector('[inert][aria-hidden="true"]')).toBeTruthy();
    expect(Array.from(thumbnail.querySelectorAll('button')).some(button => button.textContent?.includes('Print'))).toBe(false);
  });
});
