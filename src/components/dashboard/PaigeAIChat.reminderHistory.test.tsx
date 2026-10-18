import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const port = vi.hoisted(() => ({ tenant: '00000000-0000-4000-8000-000000000002' as string | null,
  actor: 'test-owner-a', turns: [] as Array<Record<string, unknown>>, history: vi.fn(), pending: vi.fn(), load: vi.fn() }));
vi.mock('@tanstack/react-query', () => ({ useQuery: () => ({ data: null }) }));
vi.mock('@/hooks/useTenantContext', () => ({ useTenantContext: () => ({ activeTenantId: port.tenant }) }));
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
  loadApprovalRecovery: (...args: unknown[]) => port.pending(...args),
  ensureThread: vi.fn(), onTurnPersisted: vi.fn(), renameThread: vi.fn(), archiveThread: vi.fn(), deleteThread: vi.fn(),
}) }));
import { PaigeAIChat } from './PaigeAIChat';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const ids = { thread: '00000000-0000-4000-8000-000000000003', turn: '00000000-0000-4000-8000-000000000005',
  intent: '00000000-0000-4000-8000-000000000004', item: '00000000-0000-4000-8000-000000000006',
  receipt: '00000000-0000-4000-8000-000000000007' };
const original = () => ({ id: ids.turn, role: 'assistant', content: 'Please review this reminder.',
  interactive_intent_id: ids.intent, interactive_terminal_state: 'WAIT_APPROVAL', bundle_ref: {
    turn_state: { v: 1, state: 'WAIT_APPROVAL', blocks: [], actions: [] },
    paige_confirm: [{ tool: 'plan_set_reminder', summary: 'Create the fixture reminder', fingerprint: `1234567890abcdef:${ids.intent}` }],
  } });
const projection = (title = 'Earlier fixture reminder') => ({ v: 1, status: 'verified_original', thread_id: ids.thread,
  turn_id: ids.turn, origin_intent_id: ids.intent, tenant_id: port.tenant, historical: true, replayed: true,
  new_effect_possible: false, confirmations_restored: false, results: [{ tool: 'plan_set_reminder', receipt_version: 1,
    original: { item_id: ids.item, title, remind_at: '2026-10-20T14:00:00Z', source_version: '2026-10-18T12:00:00.123456Z',
      receipt_run_id: ids.receipt } }] });
const flush = async () => { for (let i = 0; i < 25; i++) await Promise.resolve(); };
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; }

describe('original reminder recovery on the actual saved Chat surface', () => {
  let host: HTMLDivElement, root: Root;
  beforeEach(() => {
    port.tenant = '00000000-0000-4000-8000-000000000002'; port.actor = 'test-owner-a';
    port.turns = [original(), { id: 'later-user', role: 'user', content: 'Thanks.' },
      { id: 'later-assistant', role: 'assistant', content: 'The later conversation remains here.' }];
    port.history.mockReset().mockResolvedValue(projection()); port.pending.mockReset().mockResolvedValue(null);
    port.load.mockReset().mockImplementation(async () => port.turns);
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('Unexpected effect/model transport'); }));
    host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  });
  afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
  const render = async (thread = ids.thread) => { await act(async () => {
    root.render(<PaigeAIChat hideHeader fill enableHistory soloTenantSafety liveConversation={false} activeThreadId={thread} />);
    await flush();
  }); };
  const inert = () => {
    expect(host.querySelector('[data-paige-confirm-card] button')).toBeNull();
    expect(Array.from(host.querySelectorAll('button')).some(button => /^(Approve|Not now|Ask Paige again)$/.test(button.textContent ?? ''))).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
  };
  it('shows the original result for a non-last card without restoring approval or invoking the model', async () => {
    await render();
    expect(port.history).toHaveBeenCalledTimes(1);
    expect(port.history.mock.calls[0].slice(0, 3)).toEqual([ids.thread, ids.turn, ids.intent]);
    expect(port.history.mock.calls[0][3]).toBeInstanceOf(AbortSignal);
    expect(host.textContent).toContain('Recorded earlier: Earlier fixture reminder');
    expect(host.textContent).toContain('Originally scheduled for');
    expect(host.textContent).not.toMatch(/delivered|sent successfully|currently scheduled/i);
    expect(host.querySelector('[data-paige-original-reminder-item]')?.getAttribute('data-paige-original-reminder-item')).toBe(ids.item);
    expect(host.querySelector('[data-paige-original-reminder-receipt]')?.getAttribute('data-paige-original-reminder-receipt')).toBe(ids.receipt);
    expect(port.pending).not.toHaveBeenCalled(); inert();
  });
  it('keeps the latest reminder card outside live CRM recovery', async () => {
    port.turns = [original()]; await render();
    expect(port.pending).not.toHaveBeenCalled(); expect(port.history).toHaveBeenCalledTimes(1); inert();
  });
  it('bounds a transcript to its newest original reminder card instead of reading every earlier one', async () => {
    port.turns.unshift({ ...original(), id: '00000000-0000-4000-8000-000000000099' });
    await render(); expect(port.history).toHaveBeenCalledTimes(1);
    expect(port.history.mock.calls[0][1]).toBe(ids.turn); inert();
  });
  it.each(['null', 'throw', 'foreign tenant', 'foreign turn', 'extra approval', 'fresh result'])(
    'keeps %s evidence unverified without a retry action', async kind => {
      const value = projection();
      if (kind === 'throw') port.history.mockRejectedValue(new Error('private provider detail'));
      else {
        if (kind === 'foreign tenant') value.tenant_id = '00000000-0000-4000-8000-000000000099';
        if (kind === 'foreign turn') value.turn_id = '00000000-0000-4000-8000-000000000099';
        if (kind === 'extra approval') Object.assign(value, { confirmations: [{ fingerprint: 'untrusted' }] });
        if (kind === 'fresh result') value.historical = false;
        port.history.mockResolvedValue(kind === 'null' ? null : value);
      }
      await render();
      expect(host.textContent).toContain("earlier reminder outcome couldn't be verified");
      expect(host.textContent).not.toMatch(/Recorded earlier|private provider detail|Earlier fixture reminder/);
      expect(port.history).toHaveBeenCalledTimes(1); inert();
    });
  it('physically aborts a hung read at its budget and suppresses late success without retry', async () => {
    vi.useFakeTimers(); const read = deferred<ReturnType<typeof projection>>(); port.history.mockReturnValue(read.promise);
    await render(); expect(host.textContent).toContain('Checking the earlier reminder');
    const signal = port.history.mock.calls[0][3] as AbortSignal;
    await act(async () => { await vi.advanceTimersByTimeAsync(10_001); await flush(); });
    expect(signal.aborted).toBe(true); expect(host.textContent).toContain("couldn't be verified");
    await act(async () => { read.resolve(projection('Late old reminder')); await flush(); });
    expect(host.textContent).not.toContain('Late old reminder'); expect(port.history).toHaveBeenCalledTimes(1); inert();
  });
  it.each(['thread', 'tenant', 'actor'])('rejects and aborts a late %s A→B→A result', async boundary => {
    const read = deferred<ReturnType<typeof projection>>();
    port.history.mockReturnValueOnce(read.promise).mockImplementation(async () => projection('Current history'));
    await render(); const signal = port.history.mock.calls[0][3] as AbortSignal; const firstTenant = port.tenant;
    if (boundary === 'tenant') port.tenant = '00000000-0000-4000-8000-000000000099';
    if (boundary === 'actor') port.actor = 'test-owner-b';
    await render(boundary === 'thread' ? '00000000-0000-4000-8000-000000000098' : ids.thread);
    port.tenant = firstTenant; port.actor = 'test-owner-a'; await render();
    await act(async () => { read.resolve(projection('Stale original result')); await flush(); });
    expect(signal.aborted).toBe(true); expect(host.textContent).not.toContain('Stale original result'); inert();
  });
  it('aborts on unmount and cannot publish into a later mount', async () => {
    const read = deferred<ReturnType<typeof projection>>(); port.history.mockReturnValueOnce(read.promise);
    await render(); const signal = port.history.mock.calls[0][3] as AbortSignal;
    await act(async () => root.unmount()); expect(signal.aborted).toBe(true);
    root = createRoot(host); port.turns = []; await render();
    await act(async () => { read.resolve(projection('Unmounted result')); await flush(); });
    expect(host.textContent).not.toContain('Unmounted result'); inert();
  });
  it('does not read non-reminder or unsealed card history', async () => {
    port.turns = [{ ...original(), interactive_terminal_state: 'FINAL' }]; await render();
    expect(port.history).not.toHaveBeenCalled(); inert();
  });
});
