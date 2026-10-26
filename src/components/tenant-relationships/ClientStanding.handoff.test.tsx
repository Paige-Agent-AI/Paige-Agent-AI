import React, { act, useCallback, useEffect, useSyncExternalStore } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import source from '@/__tests__/fixtures/exp04-client-status-source.json';
import { mergeIntoDraft, subscribePaigePromptHandoff, takePendingPaigePrompt } from '@/lib/paigePromptHandoff';
import { clearComposerDraft, createComposerScopeIdentity, initialComposerConversation, readComposerDraft,
  resolveComposerScopeState, setComposerDraftSessionScope, useComposerDraft, type ComposerDraftHandle } from '@/lib/paigeComposerScopeState';
import { clearPaigeClientScope, getPaigeClientScope, setPaigeClientScope, subscribePaigeClientScope } from '@/solo/paigeClientScope';
import { clearPaigePublicPresenceScope } from '@/solo/paigePublicPresenceScope';

// Actual original Clients standing + SoloApp/shell + canonical scope/draft merger.
// Backend/other departments and the visual Chat port are controlled. No provider,
// production authorization, actual model execution or customer acceptance is proved.
const port = vi.hoisted(() => ({ expand: vi.fn(), rpc: vi.fn() }));
vi.mock('@/hooks/useTenantContext', () => ({ useTenantContext: () => ({ activeUserId: 'e0400000-0000-4000-8000-000000000001',
  activeTenantId: source.tenant_id, accountContextLoading: false, loading: false, accountContextStatus: 'ready', isPlatformStaff: false,
  activeTenant: { account_number: '123', name: 'Synthetic Services', account_type: 'standalone', features: { solo_setup_completed: true } } }) }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { rpc: (...args: unknown[]) => port.rpc(...args) } }));
vi.mock('@/hooks/usePlanList', () => ({ usePlanList: () => ({ plans: [], allItems: [], loading: false, error: null, forbidden: false, refresh: vi.fn() }) }));
vi.mock('next-themes', () => ({ useTheme: () => ({ resolvedTheme: 'dark', setTheme: vi.fn() }) }));
vi.mock('@/hooks/usePendingApprovals', () => ({ usePendingApprovals: () => ({ items: [] }) }));
vi.mock('@/components/auth/WorkspaceExitControl', () => ({ WorkspaceExitControl: () => null }));
vi.mock('@/components/admin/voice/DialPadTrigger', () => ({ DialPadTrigger: () => null }));
vi.mock('@/components/ui/paige', () => ({ AgentPresenceProvider: ({ children }: React.PropsWithChildren) => children,
  useAgentPresence: () => ({ expandRail: port.expand, railExpanded: true }) }));
vi.mock('@/lib/voice/VoiceDeviceProvider', () => ({ VoiceDeviceProvider: ({ children }: React.PropsWithChildren) => children }));
vi.mock('@/components/admin/voice/DialPadSurface', () => ({ DialPadSurface: () => null }));
vi.mock('@/components/admin/voice/IncomingCallOverlay', () => ({ IncomingCallOverlay: () => null }));
vi.mock('@/components/admin/voice/LiveTranscriptPanel', () => ({ LiveTranscriptPanel: () => null }));
vi.mock('@/solo/SoloSetupReadinessNotice', () => ({ SoloSetupReadinessNotice: () => null }));
vi.mock('@/solo/SoloPaigeWorkspace', () => ({ SoloPaigeWorkspace: ({ dockedTab }: { dockedTab: string }) => {
  const snapshot = useCallback(() => getPaigeClientScope(source.tenant_id), []);
  const scope = useSyncExternalStore(subscribePaigeClientScope, snapshot, () => null);
  const identity = createComposerScopeIdentity({ tenantId: source.tenant_id, userId: 'e0400000-0000-4000-8000-000000000001', focusedClientId: scope?.clientId });
  const state = resolveComposerScopeState({ currentIdentity: identity, displayedIdentity: identity,
    conversation: initialComposerConversation(false, 'c56-controlled-new'), busy: false });
  const { value, setValue } = useComposerDraft(state);
  useEffect(() => subscribePaigePromptHandoff(prompt => setValue(current => mergeIntoDraft(current, prompt, { preserveAddressee: true }))), [setValue]);
  return <section hidden={dockedTab !== 'chat'} data-controlled-chat-port>
    <output data-focused-client>{scope?.clientId ?? 'none'}</output>
    <textarea aria-label="Controlled unsent draft" value={value} onChange={event => setValue(event.target.value)} />
    <button onClick={() => setValue('Keep this original unsent note.')}>Seed current draft</button>
  </section>;
} }));
vi.mock('@/components/tenant-relationships/TenantRelationshipsClientsWorkspace', async () => {
  const { ClientStanding } = await import('./ClientStanding');
  return { TenantRelationshipsClientsWorkspace: ({ openPaige }: { openPaige: () => void }) =>
    <ClientStanding contactId={source.contact_id} clientName="Synthetic consulting client" account="123" openPaige={openPaige} /> };
});
vi.mock('@/solo/CommandCenter', () => ({ CommandHub: () => null }));
vi.mock('@/solo/operations/OperationsRoute', () => ({ OperationsRoute: () => null }));
vi.mock('@/solo/conversations', () => ({ ClientsHub: () => null }));
vi.mock('@/solo/growth2', () => ({ GrowthHub: () => null }));
vi.mock('@/solo/AdsWorkspace', () => ({ AdsWorkspace: () => null }));
vi.mock('@/solo/SalesWorkspace', () => ({ SalesWorkspace: () => null }));
vi.mock('@/solo/finance/FinanceWorkspace', () => ({ FinanceWorkspace: () => null }));
vi.mock('@/components/tenant-calendar/TenantCanonicalCalendarWorkspace', () => ({ TenantCanonicalCalendarWorkspace: () => null }));
vi.mock('@/solo/marketplace', () => ({ Marketplace: () => null }));
vi.mock('@/solo/settings', () => ({ SoloSettings: () => null }));
vi.mock('@/solo/vault/useBusinessVault', () => ({ useVaultAccess: () => ({}), canShowVaultNavigation: () => false }));
vi.mock('@/solo/vibe', () => ({ VibeStudio: () => null }));
import SoloApp from '@/solo/SoloApp';

let host: HTMLDivElement, root: Root;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const handle = (clientId?: string): ComposerDraftHandle => ({ ...createComposerScopeIdentity({
  tenantId: source.tenant_id, userId: 'e0400000-0000-4000-8000-000000000001', focusedClientId: clientId,
})!, conversationId: 'c56-controlled-new' });
beforeEach(() => {
  clearPaigeClientScope(); clearPaigePublicPresenceScope(); takePendingPaigePrompt();
  setComposerDraftSessionScope({ kind: 'clear' });
  setComposerDraftSessionScope({ kind: 'ready', tenantId: source.tenant_id, userId: 'e0400000-0000-4000-8000-000000000001' });
  clearComposerDraft(handle()); clearComposerDraft(handle(source.contact_id));
  port.expand.mockReset(); port.rpc.mockReset().mockImplementation(async name => name === 'read_client_engagement_status'
    ? { data: { ...structuredClone(source), receipt_id: undefined }, error: null } : { data: false, error: null });
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); clearPaigeClientScope(); clearPaigePublicPresenceScope();
  takePendingPaigePrompt(); setComposerDraftSessionScope({ kind: 'clear' }); });
async function mount() {
  await act(async () => root.render(<MemoryRouter initialEntries={['/solo/123/clients']}><Routes>
    <Route path="/solo/:account/*" element={<SoloApp />} /></Routes></MemoryRouter>));
  // Clients is route-lazy; inspect the actual loaded screen, not its fallback.
  await act(async () => { await vi.dynamicImportSettled(); });
}
async function click(text: string) {
  const matches = [...host.querySelectorAll<HTMLButtonElement>('button')].filter(button => button.textContent?.trim() === text);
  expect(matches).toHaveLength(1);
  await act(async () => matches[0].click());
}
it('prepares the selected client read in its own original scope without leaking or discarding the business draft', async () => {
  await mount(); await click('Seed current draft');
  expect(readComposerDraft(handle())).toBe('Keep this original unsent note.');
  const calls = port.rpc.mock.calls.length;
  await click('Ask PAIGE about Synthetic consulting client');
  expect(host.querySelector('[data-focused-client]')?.textContent).toBe(source.contact_id);
  const draft = host.querySelector<HTMLTextAreaElement>('textarea[aria-label="Controlled unsent draft"]')!;
  expect(draft.value).toMatch(/^MERIT,/i); expect(draft.value).toMatch(/read only|read-only/i);
  expect(draft.value).not.toContain('Keep this original');
  expect(readComposerDraft(handle())).toBe('Keep this original unsent note.');
  expect(port.rpc).toHaveBeenCalledTimes(calls);
  await act(async () => clearPaigeClientScope());
  expect(host.querySelector<HTMLTextAreaElement>('textarea')?.value).toBe('Keep this original unsent note.');
});
it('preserves same-client work and applies a repeated invitation once through the original merger', async () => {
  await mount(); await act(async () => setPaigeClientScope({ tenantId: source.tenant_id, clientId: source.contact_id, label: 'Synthetic consulting client' }));
  await click('Seed current draft');
  await click('Ask PAIGE about Synthetic consulting client');
  const first = host.querySelector<HTMLTextAreaElement>('textarea')!.value;
  expect(first).toContain('Keep this original unsent note.'); expect(first).toMatch(/^MERIT,/i);
  await click('Ask PAIGE about Synthetic consulting client');
  expect(host.querySelector<HTMLTextAreaElement>('textarea')!.value).toBe(first);
});
