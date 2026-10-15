import { act, StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Outlet, Route, Routes, useLocation, useNavigate, type NavigateFunction } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ClientDeliveryReviewProvider } from './ClientDeliveryReviewProvider';
import { ClientReleasedWork } from './ClientReleasedWork';

const id = (n: number) => `ec040000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const actor = id(1), client = id(2), tenant = id(3), release = id(4), submission = id(5);
type AuthListener = (event: string, session: { user: { id: string } } | null) => void;
type Reply = { data: unknown; error: unknown };
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn(), user: vi.fn(), session: vi.fn(),
  subscribe: vi.fn(), preview: false, actor: '' as string | null, forcedTheme: undefined as string | undefined }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: {
  rpc: mocks.rpc, from: mocks.from,
  auth: { getUser: mocks.user, getSession: mocks.session, onAuthStateChange: mocks.subscribe },
} }));
vi.mock('@/contexts/ImpersonationContext', () => ({ useImpersonation: () => ({ isImpersonating: mocks.preview }) }));
vi.mock('@/contexts/DashboardModeContext', () => ({ useDashboardMode: () => ({ isAdmin: false, mode: 'client' }) }));
vi.mock('next-themes', () => ({ useTheme: () => ({ resolvedTheme: 'light', forcedTheme: mocks.forcedTheme }) }));
const base = { actor_id: actor, tenant_id: tenant, release_id: release, submission_id: submission,
  state: 'awaiting_client', revision_no: 2, artifact_digest: 'a'.repeat(64), title: 'Released service outcome',
  body: 'PRIVATE exact released outcome. <script>not executable</script>', updated_at: '2026-10-14T00:00:00.123456Z' };
let record: typeof base & { decision_by?: string; decision_at?: string; client_note?: string | null };
let rows: Array<{ id: string; tenant_id: string }>, listeners: Set<AuthListener>, allListeners: AuthListener[];
let discoveryError: unknown, exactError: unknown, hasMore: boolean, unavailable: number;
let writeMode: 'verified' | 'unknown' | 'pending', pendingWrite: ((reply: Reply) => void) | null;
let root: Root, host: HTMLDivElement, navigate: NavigateFunction;

const metadata = () => ({ release_id: record.release_id, submission_id: record.submission_id, state: record.state,
  revision_no: record.revision_no, artifact_digest: record.artifact_digest, title: record.title, updated_at: record.updated_at });
const saved = () => ({ ...record, state: 'accepted', decision_by: actor, decision_at: '2026-10-14T01:00:00.654321Z',
  client_note: null, updated_at: '2026-10-14T01:00:00.654321Z' });
function RouterProbe() { navigate = useNavigate(); return <p data-testid="route">{useLocation().pathname}</p>; }
function ClientLayout() { return <Outlet context={{ session: { user: { id: actor } } }} />; }
function scene(showList = true, strict = false) {
  const app = <MemoryRouter initialEntries={['/portal/test-studio', '/app/actions']} initialIndex={1}>
    <ClientDeliveryReviewProvider>
      <RouterProbe />
      <button type="button" onClick={() => { throw new Error('Underlying logout must remain unreachable while modal'); }}>Underlying sign out</button>
      <Routes>
        <Route path="/app" element={<ClientLayout />}>
          <Route path="actions" element={showList ? <ClientReleasedWork /> : <h1>Client home</h1>} />
          <Route path="settings" element={<h1>Client settings</h1>} />
        </Route>
        <Route path="/portal/test-studio" element={<h1>Portal sign in</h1>} />
      </Routes>
    </ClientDeliveryReviewProvider>
  </MemoryRouter>;
  return strict ? <StrictMode>{app}</StrictMode> : app;
}
const button = (text: string) => Array.from(document.querySelectorAll<HTMLButtonElement>('button')).find(b => b.textContent === text);
async function click(text: string) { const target = button(text); expect(target, `button ${text}`).toBeDefined(); await act(async () => target!.click()); }
async function show(showList = true, strict = false) { await act(async () => root.render(scene(showList, strict))); }
async function ready() { await vi.waitFor(() => expect(button('Review version 2')).toBeDefined()); }
async function open() { await ready(); await click('Review version 2'); await vi.waitFor(() => expect(document.querySelector('textarea')).not.toBeNull()); }
async function note(value: string) {
  const element = document.querySelector<HTMLTextAreaElement>('textarea')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(element, value);
    element.dispatchEvent(new Event('input', { bubbles: true }));
  });
  return element;
}
async function emit(next: string | null) {
  mocks.actor = next;
  await act(async () => { for (const listener of Array.from(listeners)) listener(next ? 'SIGNED_IN' : 'SIGNED_OUT', next ? { user: { id: next } } : null); });
}
async function focusWindow() { await act(async () => { window.dispatchEvent(new Event('focus')); }); }
const decisions = () => mocks.rpc.mock.calls.filter(call => call[0] === 'operations_delivery_client_decide_scoped');

beforeEach(() => {
  vi.clearAllMocks(); mocks.preview = false; mocks.actor = actor; mocks.forcedTheme = undefined; record = { ...base };
  rows = [{ id: client, tenant_id: tenant }]; listeners = new Set(); allListeners = [];
  discoveryError = null; exactError = null; hasMore = false; unavailable = 0; writeMode = 'verified'; pendingWrite = null;
  mocks.user.mockImplementation(async () => ({ data: { user: mocks.actor ? { id: mocks.actor } : null }, error: null }));
  mocks.session.mockImplementation(async () => ({ data: { session: mocks.actor ? { user: { id: mocks.actor } } : null }, error: null }));
  mocks.subscribe.mockImplementation((listener: AuthListener) => {
    listeners.add(listener); allListeners.push(listener);
    return { data: { subscription: { unsubscribe: () => listeners.delete(listener) } } };
  });
  mocks.from.mockImplementation(() => { throw Error('Raw CRM read unavailable'); });
  mocks.rpc.mockImplementation(async (name: string, args: Record<string, unknown>): Promise<Reply> => {
    if(name==='client_portal_self_profile'){
      expect(args).toEqual({});
      return rows.length>1?{data:null,error:{code:'42501'}}:{data:rows.length?{...rows[0],linked_user_id:actor}:null,error:null};
    }
    expect(args.p_expected_actor_id).toBe(actor); expect(args.p_expected_tenant_id).toBe(tenant);
    if (name === 'operations_delivery_client_reviews_scoped') return { data: discoveryError ? null : {
      actor_id: actor, tenant_id: tenant, releases: [metadata()], unavailable_count: unavailable, has_more: hasMore,
    }, error: discoveryError };
    if (name === 'operations_delivery_client_read_scoped') return { data: exactError ? null : record, error: exactError };
    if (name === 'operations_delivery_client_decide_scoped') {
      if (writeMode === 'pending') return new Promise(resolve => { pendingWrite = resolve; });
      if (writeMode === 'unknown') return { data: null, error: { code: '08006' } };
      record = { ...saved(), state: String(args.p_decision), client_note: args.p_note as string | null };
      return { data: record, error: null };
    }
    throw new Error(`Unexpected RPC ${name}`);
  });
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); });

it('does no client queries on global routes without a released-work consumer', async () => {
  await show(false); expect(mocks.rpc).not.toHaveBeenCalled(); expect(mocks.from).not.toHaveBeenCalled(); expect(mocks.user).not.toHaveBeenCalled();
});
it('refuses preview without inventing client authority or querying released work', async () => {
  mocks.preview = true; await show();
  expect(host.textContent).toContain('Open your own client session'); expect(mocks.rpc).not.toHaveBeenCalled();
});
it('keeps partial discovery visible and opens only through the exact reader', async () => {
  hasMore = true; unavailable = 1; await show(); await ready(); expect(host.textContent).toContain('This list is partial');
  await open(); expect(document.body.textContent).toContain(base.body); expect(document.querySelectorAll('script')).toHaveLength(0);
  expect(decisions()).toHaveLength(0); expect(mocks.rpc.mock.calls.filter(c => c[0] === 'operations_delivery_client_read_scoped')).toHaveLength(2);
});
it('honors the actual forced theme instead of the inactive resolved preference', async () => {
  mocks.forcedTheme = 'dark'; await show(); await open();
  expect(document.querySelector('[role="dialog"]')?.getAttribute('data-pg')).toBe('dark');
  expect(document.querySelector('[aria-label="Review released deliverable"]')?.getAttribute('data-theme')).toBe('dark');
});
it('does not turn a discovery failure or ambiguous link into an empty completed list', async () => {
  discoveryError = { code: '08006' }; await show();
  expect(host.textContent).toContain('could not be read'); expect(host.textContent).not.toContain('No work has been released');
  rows = [...rows, { id: id(8), tenant_id: id(9) }]; discoveryError = null;
  // The canonical producer refuses ambiguous relationships without returning
  // rows or a client-visible ambiguity reason. Do not invent one from 42501.
  await click('Check released work again'); expect(host.textContent).toContain('could not be read');
  expect(host.textContent).not.toContain('No work has been released');expect(mocks.from).not.toHaveBeenCalled();expect(decisions()).toHaveLength(0);
});
it('does not mount the artifact or a writer when selected access is refused', async () => {
  await show(); await ready(); exactError = { code: '42501' }; await click('Review version 2');
  expect(document.body.textContent).not.toContain(base.body); expect(document.querySelector('[role="dialog"]')).toBeNull(); expect(decisions()).toHaveLength(0);
});
it('retains dirty work across actual Router history outside app and refuses parent closure', async () => {
  await show(); await open(); const original = await note('Keep this private review note.');
  await act(async () => navigate(-1));
  expect(host.textContent).toContain('/portal/test-studio'); expect(document.querySelector('textarea')).toBe(original);
  await click('Close review'); expect(document.querySelector('textarea')).toBe(original); expect(original.value).toBe('Keep this private review note.');
  expect(decisions()).toHaveLength(0); await click('Clear review note'); await click('Close review');
  expect(document.querySelector('[role="dialog"]')).toBeNull();
});
it('nested confirmation cancellation restores its domain action and leaves the outer review open', async () => {
  await show(); await open(); const accept = button('Accept this version');
  await click('Accept this version'); expect(document.querySelector('[role="alertdialog"]')).not.toBeNull();
  await click('Keep reviewing'); await vi.waitFor(() => expect(document.activeElement).toBe(accept));
  expect(document.querySelector('[role="dialog"]')).not.toBeNull(); expect(decisions()).toHaveLength(0);
});
it('blank-note unknown outcome survives routing and allows close only after original source recovery', async () => {
  writeMode = 'unknown'; await show(); await open(); await click('Accept this version'); await click('Confirm acceptance');
  expect(button('Accept this version')?.disabled).toBe(true); await click('Close review');
  expect(document.querySelector('[role="dialog"]')).not.toBeNull(); await act(async () => navigate(-1));
  await click('Check recorded review'); await click('Close review'); expect(document.querySelector('[role="dialog"]')).not.toBeNull();
  record = saved(); await click('Check recorded review'); await click('Close review');
  expect(document.querySelector('[role="dialog"]')).toBeNull(); expect(decisions()).toHaveLength(1);
});
it('verified source remains recorded when only consumer metadata refresh fails', async () => {
  await show(); await open(); discoveryError = { code: '08006' };
  await click('Accept this version'); await click('Confirm acceptance');
  expect(document.body.textContent).toContain('Your acceptance is recorded');
  expect(document.body.textContent).toContain('Check released work again for the latest list');
  expect(document.body.textContent).not.toContain('Your decision could not be confirmed'); expect(decisions()).toHaveLength(1);
  await click('Close review'); expect(document.querySelector('[role="dialog"]')).toBeNull();
});
it('temporary access failure retains the original immutable review without replay; proven refusal scrubs nested portals', async () => {
  await show(); await open(); const original = await note('Unsaved exact-version note');
  exactError = { code: '08006' }; await focusWindow();
  expect(document.body.textContent).toContain('Access could not be checked'); expect(document.querySelector('textarea')).toBe(original);
  exactError = null; await click('Accept this version'); expect(document.querySelector('[role="alertdialog"]')).not.toBeNull();
  exactError = { code: '42501' }; await focusWindow();
  expect(document.querySelector('[role="alertdialog"]')).toBeNull(); expect(document.querySelector('[role="dialog"]')).toBeNull();
  expect(document.body.textContent).not.toContain(base.body); expect(decisions()).toHaveLength(0);
});
it('actual session loss scrubs dirty content without consulting a voluntary close guard', async () => {
  await show(); await open(); await note('Private unsaved note'); await emit(null);
  expect(document.body.textContent).not.toContain(base.body); expect(document.querySelector('textarea')).toBeNull(); expect(document.querySelector('[role="dialog"]')).toBeNull();
});
it('A-B-A cannot revive a retired in-flight save, callback or close guard', async () => {
  writeMode = 'pending'; await show(); await open(); await click('Accept this version'); await click('Confirm acceptance');
  expect(pendingWrite).not.toBeNull(); const resolve = pendingWrite!;
  await emit(id(9)); expect(document.querySelector('[role="dialog"]')).toBeNull(); await emit(actor); await ready(); await open();
  await act(async () => resolve({ data: saved(), error: null }));
  expect(document.body.textContent).not.toContain('Your acceptance is recorded'); expect(decisions()).toHaveLength(1);
  await click('Close review'); expect(document.querySelector('[role="dialog"]')).toBeNull();
});
it('retired auth subscription callbacks cannot scrub a current StrictMode instance', async () => {
  await show(true, true); await open(); expect(allListeners.length).toBeGreaterThan(1);
  const retired = allListeners.find(listener => !listeners.has(listener))!;
  expect(retired).toBeDefined(); await act(async () => retired('SIGNED_OUT', null));
  expect(document.body.textContent).toContain(base.body); expect(document.querySelector('[role="dialog"]')).not.toBeNull();
});
