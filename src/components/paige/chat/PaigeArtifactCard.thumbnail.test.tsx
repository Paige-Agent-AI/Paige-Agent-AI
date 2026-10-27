import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PaigeArtifactCard } from './PaigeArtifactCard';
import { parseStudioDocument } from '@/components/admin/studio/studio-document';

const load = vi.hoisted(() => vi.fn());
vi.mock('@/components/admin/studio/studio', () => ({ loadDocument: load }));
// Keep the REAL original DocumentPreview and its paged controls. The earlier
// lightweight context fixture cannot expose invalid nested native buttons.
const artifact = { id: 'test-original-report', title: 'Original report', artifactType: 'document' as const };
const report = parseStudioDocument(artifact.id, artifact.title, JSON.stringify({ docType: 'business_review', blocks: [
  { type: 'cover', title: artifact.title },
  { type: 'chapter-divider', title: 'Original source notes' },
  { type: 'callout', variant: 'definition', body: 'Historical source evidence; read current information before a decision.' },
] }));
let host: HTMLDivElement, root: Root;
beforeEach(() => { load.mockReset(); load.mockResolvedValue(report); host = document.createElement('div'); document.body.append(host); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });

describe('original artifact thumbnail native control semantics', () => {
  it('keeps real document page controls outside the native Open button', async () => {
    await act(async () => root.render(<PaigeArtifactCard artifact={artifact} tenantId="test-workspace" />));
    const open = host.querySelector<HTMLButtonElement>('button[aria-label="Open Original report"]');
    expect(open).toBeTruthy();
    expect(host.querySelector('[inert][aria-hidden="true"] button')).toBeTruthy();
    expect(open!.querySelector('button')).toBeNull();
    expect(host.querySelector('button button')).toBeNull();
    expect(load.mock.calls).toEqual([['test-workspace', artifact.id]]);
  });
  it('opens the same original document without invoking the delegated send', async () => {
    const send = vi.fn();
    await act(async () => root.render(<PaigeArtifactCard artifact={artifact} tenantId="test-workspace" onSend={send} />));
    const open = host.querySelector<HTMLButtonElement>('button[aria-label="Open Original report"]')!;
    await act(async () => open.click());
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain('Historical source evidence');
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain('Print / Save as PDF');
    expect(load.mock.calls).toEqual([['test-workspace', artifact.id]]);
    expect(send).not.toHaveBeenCalled();
  });
  it('retains a native image Open affordance without a document read or implicit send', async () => {
    const send = vi.fn();
    await act(async () => root.render(<PaigeArtifactCard artifact={{ id: 'test-image', title: 'Original image', artifactType: 'image' }} tenantId="test-workspace" onSend={send} />));
    const open = host.querySelector<HTMLButtonElement>('button[aria-label="Open Original image"]')!;
    expect(open.type).toBe('button');
    expect(host.querySelector('button button')).toBeNull();
    await act(async () => open.click());
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain('Image unavailable');
    expect(load).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });
});
