import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const port = vi.hoisted(() => ({ tenant: '00000000-0000-4000-8000-000000000002' as string | null,
  actor: 'test-owner-a', turns: [] as Array<Record<string, unknown>>, history: vi.fn(), cura: vi.fn(), pending: vi.fn(), load: vi.fn() }));
vi.mock('@tanstack/react-query', () => ({ useQuery: () => ({ data: null }) }));
vi.mock('@/hooks/useTenantContext', () => ({ useTenantContext: () => ({ activeTenantId: port.tenant, activeTenant: { account_type: 'standalone', parent_tenant_id: null, account_number: 3855 } }) }));
vi.mock('@/hooks/useScopedUserId', () => ({ useScopedUserId: () => port.actor }));
vi.mock('@/lib/playbook', () => ({ usePlaybook: () => ({ persona: { name: 'PAIGE' } }) }));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock('@/components/voice/DictationMicButton', () => ({ DictationMicButton: () => null }));
vi.mock('@/components/paige/live/PaigeLiveConversation', () => ({ PaigeLiveConversation: () => null }));
vi.mock('@/components/chat/MessageAudioButton', () => ({ MessageAudioButton: () => null }));
vi.mock('@/hooks/useChatDocumentUpload', () => ({ useChatDocumentUpload: () => ({
  attachedDoc: null, isDragOver: false, fileInputRef: { current: null }, acceptString: '.pdf',
  handleFileSelect: vi.fn(), handleDragOver: vi.fn(), handleDragLeave: vi.fn(), handleDrop: vi.fn(),
  removeAttachment: vi.fn(), openFilePicker: vi.fn(), setAttachedDoc: vi.fn(),
}) }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: {
  auth: { getSession: vi.fn(async () => ({ data: { session: { access_token: 'synthetic-session' } } })) },
} }));
vi.mock('@/hooks/usePaigeThreads', () => ({ usePaigeThreads: () => ({
  threads: [], isLoading: false, isFetched: true, loadTurns: (...args: unknown[]) => port.load(...args),
  loadOriginalReminderHistory: (...args: unknown[]) => port.history(...args),
  loadOriginalCuraPreparationHistory: (...args: unknown[]) => port.cura(...args),
  loadApprovalRecovery: (...args: unknown[]) => port.pending(...args),
  ensureThread: vi.fn(), onTurnPersisted: vi.fn(), renameThread: vi.fn(), archiveThread: vi.fn(), deleteThread: vi.fn(),
}) }));
import { PaigeAIChat } from './PaigeAIChat';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const ids = { thread: '00000000-0000-4000-8000-000000000003', turn: '00000000-0000-4000-8000-000000000005',
  intent: '00000000-0000-4000-8000-000000000004', item: '00000000-0000-4000-8000-000000000006',
  receipt: '00000000-0000-4000-8000-000000000007' };
const original = () => ({ id: ids.turn, role: 'assistant', content: 'Review this information for CURA.',
  interactive_intent_id: ids.intent, interactive_terminal_state: 'WAIT_APPROVAL', bundle_ref: {
    turn_state: { v: 1, state: 'WAIT_APPROVAL', blocks: [], actions: [] },
    paige_confirm: [{ tool: 'save_to_knowledge_base', summary: 'Prepare approved FAQ for CURA', fingerprint: `1234567890abcdef:${ids.intent}` }],
  } });
const projection = () => ({ v: 1, status: 'recorded_preparation', thread_id: ids.thread, turn_id: ids.turn,
  origin_intent_id: ids.intent, tenant_id: port.tenant, historical: true, retry_authorized: false,
  confirmations_restored: false, new_effect_possible: false, settles_interrupted_turn: false,
  preparations: [{ tool: 'save_to_knowledge_base', preparation_recorded: true, work_id: ids.item, work_status: 'claimed',
    knowledge_doc_id: ids.receipt, current_document_revision: 1, work_updated_at: '2026-10-21T20:00:00Z' }] });
const flush = async () => { for (let i = 0; i < 25; i++) await Promise.resolve(); };
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; }


describe('CURA original preparation on the actual saved Chat surface', () => {
  let host: HTMLDivElement, root: Root;
  beforeEach(() => {
    port.tenant = '00000000-0000-4000-8000-000000000002'; port.actor = 'test-owner-a';
    port.turns = [original(), { id: 'later-user', role: 'user', content: 'Thanks.' },
      { id: 'later-assistant', role: 'assistant', content: 'The later conversation remains here.' }];
    port.cura.mockReset().mockResolvedValue(projection()); port.history.mockReset().mockResolvedValue(null);
    port.pending.mockReset().mockResolvedValue(null); port.load.mockReset().mockImplementation(async () => port.turns);
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('Unexpected effect/model transport'); }));
    window.localStorage.clear(); window.sessionStorage.clear();
    host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  });
  afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
  const render = async (thread = ids.thread, platform = false) => { await act(async () => {
    root.render(<PaigeAIChat hideHeader fill enableHistory soloTenantSafety platform={platform} liveConversation={false} activeThreadId={thread} />);
    await flush();
  }); };
  const control = () => Array.from(host.querySelectorAll('button')).find(button => /Check(ing)? original status/.test(button.textContent ?? ''))!;
  const check = async () => { await act(async () => { control().click(); await flush(); }); };
  const inert = (originalPendingReads = 0) => {
    expect(Array.from(host.querySelectorAll('button')).some(button => /^(Approve|Not now|Ask Paige again)$/.test(button.textContent ?? ''))).toBe(false);
    expect(fetch).not.toHaveBeenCalled(); expect(port.pending).toHaveBeenCalledTimes(originalPendingReads);
  };
  it('checks only on explicit request and opens the original source in the current workspace', async () => {
    await render(); expect(port.cura).not.toHaveBeenCalled(); control().focus(); expect(document.activeElement).toBe(control());
    await check(); expect(port.cura).toHaveBeenCalledTimes(1);
    expect(port.cura.mock.calls[0].slice(0, 3)).toEqual([ids.thread, ids.turn, ids.intent]);
    expect(port.cura.mock.calls[0][3]).toBeInstanceOf(AbortSignal);
    expect(host.textContent).toContain('Preparation recorded. Publishing and customer sharing are separate.');
    expect(host.textContent).not.toMatch(/CURA knows|successfully published|executing|queued/i);
    const link = host.querySelector('a'); expect(link?.textContent).toBe('Review CURA source');
    expect(link?.getAttribute('href')).toBe(`/solo/3855/clients/portal?view=knowledge&source=${ids.receipt}`);
    expect(host.textContent).toContain('The later conversation remains here.'); inert();
  });
  it.each(['null', 'throw', 'foreign business', 'foreign turn', 'private text', 'retry authority'])(
    'withholds %s evidence and never retries', async kind => {
      const value = projection();
      if (kind === 'throw') port.cura.mockRejectedValue(new Error('private native details'));
      else {
        if (kind === 'foreign business') value.tenant_id = '00000000-0000-4000-8000-000000000099';
        if (kind === 'foreign turn') value.turn_id = '00000000-0000-4000-8000-000000000099';
        if (kind === 'private text') Object.assign(value, { source_text: 'private source text' });
        if (kind === 'retry authority') value.retry_authorized = true;
        port.cura.mockResolvedValue(kind === 'null' ? null : value);
      }
      await render(); await check(); expect(host.textContent).toContain('The earlier result could not be verified here. Nothing was retried.');
      expect(host.querySelector('a')).toBeNull(); expect(host.textContent).not.toMatch(/private native details|private source text|Preparation recorded/);
      expect(port.cura).toHaveBeenCalledTimes(1); inert();
    });
  it('shows observed work without inventing a source link when source access was withheld', async () => {
    port.cura.mockResolvedValue({ ...projection(), preparations: [{ ...projection().preparations[0], knowledge_doc_id: null, current_document_revision: null }] });
    await render(); await check(); expect(host.textContent).toContain('Preparation recorded.'); expect(host.querySelector('a')).toBeNull(); inert();
  });
  it('physically aborts at the budget and suppresses a late result', async () => {
    vi.useFakeTimers(); const read = deferred<ReturnType<typeof projection>>(); port.cura.mockReturnValue(read.promise);
    await render(); control().focus(); await check(); expect(document.activeElement).toBe(control());
    await check(); expect(port.cura).toHaveBeenCalledTimes(1); expect(control().getAttribute('aria-disabled')).toBe('true'); const signal = port.cura.mock.calls[0][3] as AbortSignal;
    await act(async () => { await vi.advanceTimersByTimeAsync(10_001); await flush(); });
    expect(signal.aborted).toBe(true); expect(host.textContent).toContain('Nothing was retried.');
    await act(async () => { read.resolve(projection()); await flush(); });
    expect(host.querySelector('a')).toBeNull(); expect(port.cura).toHaveBeenCalledTimes(1); inert();
  });
  it.each(['thread', 'tenant', 'actor'])('aborts and rejects late %s A-B-A evidence', async boundary => {
    const read = deferred<ReturnType<typeof projection>>(); port.cura.mockReturnValueOnce(read.promise);
    await render(); await check(); const signal = port.cura.mock.calls[0][3] as AbortSignal; const firstTenant = port.tenant;
    if (boundary === 'tenant') port.tenant = '00000000-0000-4000-8000-000000000099';
    if (boundary === 'actor') port.actor = 'test-owner-b';
    await render(boundary === 'thread' ? '00000000-0000-4000-8000-000000000098' : ids.thread);
    port.tenant = firstTenant; port.actor = 'test-owner-a'; await render();
    await act(async () => { read.resolve(projection()); await flush(); });
    expect(signal.aborted).toBe(true); expect(host.querySelector('a')).toBeNull(); inert();
  });
  it('aborts on unmount and does not leak a result to a new mount', async () => {
    const read = deferred<ReturnType<typeof projection>>(); port.cura.mockReturnValueOnce(read.promise);
    await render(); await check(); const signal = port.cura.mock.calls[0][3] as AbortSignal;
    await act(async () => root.unmount()); expect(signal.aborted).toBe(true); root = createRoot(host); port.turns = []; await render();
    await act(async () => { read.resolve(projection()); await flush(); }); expect(host.querySelector('a')).toBeNull(); inert();
  });
  it.each(['unsealed', 'other tool', 'platform'])('never offers the check for %s history', async kind => {
    if (kind === 'unsealed') port.turns = [{ ...original(), interactive_terminal_state: 'FINAL' }];
    if (kind === 'other tool') port.turns = [{ ...original(), bundle_ref: { paige_confirm: [{ tool: 'unknown_tool', summary: 'Unrelated' }] } }];
    await render(ids.thread, kind === 'platform'); expect(control()).toBeUndefined(); expect(port.cura).not.toHaveBeenCalled(); inert(kind === 'other tool' ? 1 : 0);
  });
});
