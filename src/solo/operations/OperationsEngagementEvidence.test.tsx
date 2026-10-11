import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OperationsEngagementEvidence } from './OperationsEngagementEvidence';
const read = vi.hoisted(() => ({ evidence: null as unknown, loading: false, error: null as string | null, forbidden: false, refresh: vi.fn() }));
vi.mock('./useOperationsEngagementEvidence', () => ({ useOperationsEngagementEvidence: () => read }));
const props = { actorId: 'actor-a', tenantId: 'tenant-a', signingId: 'signing-a', contactId: 'client-a', commercialTermsId: 'terms-a', offerId: 'offer-a' };
const evidence = { tenantId: 'tenant-a', agreementId: 'signing-a', contactId: 'client-a', commercialTermsId: 'terms-a', offerId: 'offer-a', version: 3, status: 'completed', completedAt: '2026-10-09T12:00:00Z', contentSha256: 'a'.repeat(64), sealedSha256: 'b'.repeat(64), sealedCopyRecorded: true };
let host: HTMLDivElement; let root: Root;
beforeEach(() => { vi.clearAllMocks(); Object.assign(read, { evidence, loading: false, error: null, forbidden: false }); host = document.createElement('div'); document.body.append(host); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); host.remove(); });
async function render() { await act(async () => root.render(<OperationsEngagementEvidence {...props} />)); }
describe('frozen engagement inspection', () => {
  it('shows signed version without claiming handoff or acceptance', async () => {
    await render(); expect(host.textContent).toContain('Signed scope ready for review'); expect(host.textContent).toContain('Version 3');
    expect(host.textContent).toContain('No delivery project or client acceptance is confirmed'); expect(host.textContent).not.toContain('a'.repeat(64));
  });
  it('refuses mismatched client evidence', async () => {
    read.evidence = { ...evidence, contactId: 'other' }; await render(); expect(host.textContent).toContain('The signing does not match this engagement'); expect(host.textContent).not.toContain('Signed scope ready for review');
  });
  it('hides stale evidence while loading and offers same-source retry on refusal', async () => {
    read.loading = true; await render(); expect(host.textContent).toContain('Checking the signed scope…'); expect(host.textContent).not.toContain('Version 3');
    Object.assign(read, { evidence: null, loading: false, error: 'This agreement is unavailable in this workspace.', forbidden: true }); await render();
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('This agreement is unavailable'); await act(async () => host.querySelector<HTMLButtonElement>('button')!.click()); expect(read.refresh).toHaveBeenCalledOnce();
  });
  it('does not promote incomplete signing or missing sealed evidence', async () => {
    read.evidence = { ...evidence, status: 'sent' }; await render(); expect(host.textContent).toContain('Signing is still in progress');
    read.evidence = { ...evidence, sealedCopyRecorded: false }; await render(); expect(host.textContent).toContain('The sealed signing evidence is incomplete');
  });
});
