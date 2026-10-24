import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { handOffPaigePrompt, mergeIntoDraft, subscribePaigePromptHandoff, takePendingPaigePrompt } from '@/lib/paigePromptHandoff';

// Actual SoloApp and shell; unrelated departments/backend and workspace view are ports.
// The workspace port uses the real handoff merger, and exposes the host's controlled tab.
const port = vi.hoisted(() => ({ expand: vi.fn() }));
vi.mock('@/hooks/useTenantContext', () => ({ useTenantContext: () => ({ activeUserId: 'test-owner', activeTenantId: 'test-tenant-a', loading: false,
  accountContextStatus: 'ready', isPlatformStaff: false, activeTenant: { account_number: '123', name: 'Example Services', account_type: 'standalone', features: { solo_setup_completed: true } } }) }));
vi.mock('@/hooks/usePlanList', () => ({ usePlanList: () => ({ plans: [], allItems: [], loading: false, error: null, forbidden: false, refresh: vi.fn() }) }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { rpc: vi.fn(async () => ({ data: false, error: null })) } }));
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
vi.mock('./SoloSetupReadinessNotice', () => ({ SoloSetupReadinessNotice: () => null }));
vi.mock('./SoloPaigeWorkspace', () => ({ SoloPaigeWorkspace: ({ dockedTab, onDockedTabChange }: { dockedTab: string; onDockedTabChange: (tab: string) => void }) => {
  const [draft, setDraft] = React.useState('Keep my existing draft');
  React.useEffect(() => subscribePaigePromptHandoff(prompt => setDraft(current => mergeIntoDraft(current, prompt))), []);
  return <div data-existing-thread="test-thread"><button onClick={() => onDockedTabChange('capabilities')}>Choose Capabilities</button>
    <output data-selected-tab>{dockedTab}</output><section hidden={dockedTab !== 'chat'}><textarea aria-label="Existing unsent draft" value={draft} readOnly /></section></div>;
} }));
vi.mock('./CommandCenter', () => ({ CommandHub: ({ openPaige }: { openPaige: () => void }) => <button onClick={() => {
  handOffPaigePrompt('VERA, review the permitted monthly evidence. Do not take an action.'); openPaige();
}}>Ask VERA</button> }));
vi.mock('./operations/OperationsRoute', () => ({ OperationsRoute: () => null }));
vi.mock('./conversations', () => ({ ClientsHub: () => null }));
vi.mock('@/components/tenant-relationships/TenantRelationshipsClientsWorkspace', () => ({ TenantRelationshipsClientsWorkspace: () => null }));
vi.mock('./growth2', () => ({ GrowthHub: () => null }));
vi.mock('./AdsWorkspace', () => ({ AdsWorkspace: () => null }));
vi.mock('./SalesWorkspace', () => ({ SalesWorkspace: () => null }));
vi.mock('./finance/FinanceWorkspace', () => ({ FinanceWorkspace: () => null }));
vi.mock('@/components/tenant-calendar/TenantCanonicalCalendarWorkspace', () => ({ TenantCanonicalCalendarWorkspace: () => null }));
vi.mock('./marketplace', () => ({ Marketplace: () => null }));
vi.mock('./settings', () => ({ SoloSettings: () => null }));
vi.mock('./vault/useBusinessVault', () => ({ useVaultAccess: () => ({}), canShowVaultNavigation: () => false }));
vi.mock('./vibe', () => ({ VibeStudio: () => null }));
import SoloApp from './SoloApp';

let host: HTMLDivElement, root: Root;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
beforeEach(() => { port.expand.mockReset(); takePendingPaigePrompt(); host = document.createElement('div'); document.body.append(host); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); host.remove(); takePendingPaigePrompt(); });
async function click(text: string) { await act(async () => [...host.querySelectorAll('button')].find(button => button.textContent === text)!.click()); }
async function mount() {
  await act(async () => root.render(<MemoryRouter initialEntries={['/solo/123/command-center/executive']}><Routes><Route path="/solo/:account/*" element={<SoloApp />} /></Routes></MemoryRouter>));
  await click('Choose Capabilities');
  expect(host.querySelector('[data-selected-tab]')?.textContent).toBe('capabilities');
}
it.each(['callback', 'event'])('reveals the unsent question from %s without replacing the existing composer or thread', async mode => {
  await mount();
  const composer = host.querySelector<HTMLTextAreaElement>('textarea')!, thread = host.querySelector('[data-existing-thread]');
  if (mode === 'callback') await click('Ask VERA');
  else await act(async () => window.dispatchEvent(new CustomEvent('paige:open', { detail: { prompt: 'Read permitted source evidence only.' } })));
  expect(host.querySelector('[data-selected-tab]')?.textContent).toBe('chat');
  expect(host.querySelector('textarea')).toBe(composer);
  expect(host.querySelector('[data-existing-thread]')).toBe(thread);
  expect(composer.closest('[hidden]')).toBeNull();
  expect(composer.value).toContain('Keep my existing draft\n\n');
  expect(composer.value).toContain(mode === 'callback' ? 'VERA, review' : 'Read permitted source');
  expect(takePendingPaigePrompt()).toBeNull();
  expect(port.expand).toHaveBeenCalledOnce();
});
it.each([undefined, { prompt: '\u0000   ' }, { prompt: { unsafe: true } }])('preserves the selected panel for a generic open with no valid question %#', async detail => {
  await mount(); await act(async () => window.dispatchEvent(new CustomEvent('paige:open', { detail })));
  expect(host.querySelector('[data-selected-tab]')?.textContent).toBe('capabilities');
  expect(host.querySelector<HTMLTextAreaElement>('textarea')?.value).toBe('Keep my existing draft');
  expect(port.expand).toHaveBeenCalledOnce();
});
