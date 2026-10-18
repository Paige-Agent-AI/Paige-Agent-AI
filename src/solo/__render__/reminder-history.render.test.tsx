/** Actual PaigeAIChat DOM, synthetic read ports. This file never measures layout:
 * JSDOM is not browser geometry/pixels, and absent compiled CSS is not a skip. */
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { afterAll, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ turns: [] as Array<Record<string, unknown>>, history: vi.fn(), pending: vi.fn() }));
vi.mock('@tanstack/react-query', () => ({ useQuery: () => ({ data: null }) }));
vi.mock('@/hooks/useTenantContext', () => ({ useTenantContext: () => ({ activeTenantId: 'a2344000-0000-4000-8000-000000000001' }) }));
vi.mock('@/hooks/useScopedUserId', () => ({ useScopedUserId: () => 'a2344000-0000-4000-8000-000000000002' }));
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
  auth: { getSession: vi.fn(async () => ({ data: { session: { access_token: 'synthetic-render-session' } } })) },
} }));
vi.mock('@/hooks/usePaigeThreads', () => ({ usePaigeThreads: () => ({
  threads: [], isLoading: false, isFetched: true, loadTurns: async () => h.turns,
  loadOriginalReminderHistory: (...args: unknown[]) => h.history(...args),
  loadApprovalRecovery: (...args: unknown[]) => h.pending(...args),
  ensureThread: vi.fn(), onTurnPersisted: vi.fn(), renameThread: vi.fn(), archiveThread: vi.fn(), deleteThread: vi.fn(),
}) }));
import { PaigeAIChat } from '@/components/dashboard/PaigeAIChat';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const id = (n: number) => `a2344000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const ids = { tenant: id(1), thread: id(3), turn: id(4), intent: id(5), item: id(6), receipt: id(7) };
const title = 'Original service review';
const longTitle = 'LongOriginalReminder'.repeat(900).slice(0, 16384);
type State = 'checking' | 'unverified' | 'verified' | 'long-title';
type Fixture = { theme: 'light' | 'dark'; width: number; height: number; state: State;
  position: 'last' | 'nonlast'; mode: 'normal' | 'css-zoom-200' | 'reduced-motion' };
const scenes: State[] = ['checking', 'unverified', 'verified', 'long-title'];
const widths = [[390, 844], [900, 1000], [1024, 768], [1366, 768], [1536, 770], [1920, 1080], [3840, 2160]];
const full: Fixture[] = (['light', 'dark'] as const).flatMap(theme => scenes.flatMap(state =>
  (['last', 'nonlast'] as const).flatMap(position => [
    ...widths.map(([width, height]): Fixture => ({ theme, width, height, state, position, mode: 'normal' })),
    { theme, width: 390, height: 844, state, position, mode: 'css-zoom-200' },
    { theme, width: 390, height: 844, state, position, mode: 'reduced-motion' },
  ])));
const cases = process.env.ORIGINAL_REMINDER_RENDER_FULL === '1' ? full
  : full.filter(c => c.position === 'nonlast' && c.width === 900 && c.mode === 'normal');
const out = process.env.ORIGINAL_REMINDER_RENDER_DIR || 'work/original-reminder-render-successor';
mkdirSync(out, { recursive: true });
const digest = (v: string | Buffer) => createHash('sha256').update(v).digest('hex');
const sourcePaths = ['src/components/dashboard/PaigeAIChat.tsx', 'src/components/chat/reminderHistory.ts',
  'src/hooks/usePaigeThreads.ts', 'src/index.css', 'src/solo/solo-tokens.css',
  'src/solo/solo-paige-workspace.css', 'tailwind.config.ts',
  'public/fonts/schibsted-grotesk/schibsted-grotesk-latin-wght-normal.woff2'];
const sources = sourcePaths.map(path => ({ path, sha256: digest(readFileSync(path)) }));
const cssInputs = sourcePaths.filter(p => p.endsWith('.css'));
const assets = existsSync('dist/assets') ? readdirSync('dist/assets') : [];
const compiledPaths = ['main-', 'SoloEntry-', 'PaigeAIChat-'].map(prefix => {
  const name = assets.find(p => p.startsWith(prefix) && p.endsWith('.css'));
  return name ? `dist/assets/${name}` : null;
}).filter((p): p is string => p !== null);
const compiledReady = compiledPaths.length === 3;
const css = compiledReady ? [...compiledPaths, ...cssInputs.slice(1)].map(p => readFileSync(p, 'utf8')).join('\n') : '';
const cssClass = compiledReady ? 'COMPILED_LOCAL_ASSETS_NOT_PRODUCTION' : 'SOURCE_ONLY_NO_COMPILED_LAYOUT_PROOF';
const records: Array<Record<string, unknown>> = [];
const flush = async () => { for (let i = 0; i < 25; i++) await Promise.resolve(); };
function history(originalTitle: string) { return { v: 1, status: 'verified_original', thread_id: ids.thread,
  turn_id: ids.turn, origin_intent_id: ids.intent, tenant_id: ids.tenant, historical: true, replayed: true,
  new_effect_possible: false, confirmations_restored: false, results: [{ tool: 'plan_set_reminder', receipt_version: 1,
    original: { item_id: ids.item, title: originalTitle, remind_at: '2030-01-02T10:00:00Z',
      source_version: '2026-10-18T12:00:00.123456Z', receipt_run_id: ids.receipt } }] }; }
function page(html: string, fixture: Fixture) {
  const font = readFileSync(sourcePaths[sourcePaths.length - 1]).toString('base64');
  return `<!doctype html><html lang="en" class="${fixture.theme === 'dark' ? 'dark' : ''}" data-render-css="${cssClass}"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; font-src data:; img-src data:; connect-src 'none'">
<title>Original Reminder — local actual DOM only</title><style>@font-face{font-family:'Schibsted Grotesk';font-style:normal;font-weight:100 900;src:url(data:font/woff2;base64,${font}) format('woff2')} ${css}
html,body,#render-root{margin:0;height:100%;} #render-root{${fixture.mode === 'css-zoom-200' ? 'zoom:2;' : ''}}</style></head>
<body class="paige-solo" data-pg="${fixture.theme}" data-theme="${fixture.theme}"><div id="render-root">${html}</div></body></html>`;
}

describe('actual original Reminder history DOM render harness', () => {
  it.each(cases)('$theme $width x $height $state $position $mode', async fixture => {
    const previous = { width: window.innerWidth, height: window.innerHeight };
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: fixture.width });
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: fixture.height });
    const media = vi.fn((query: string) => ({ matches: fixture.mode === 'reduced-motion'
      && query === '(prefers-reduced-motion: reduce)', media: query, onchange: null, addListener: vi.fn(),
      removeListener: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn(), dispatchEvent: () => true }));
    vi.stubGlobal('matchMedia', media);
    const network = vi.spyOn(globalThis, 'fetch');
    const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
    h.turns = [{ id: ids.turn, role: 'assistant', content: 'Please review this reminder.',
      interactive_intent_id: ids.intent, interactive_terminal_state: 'WAIT_APPROVAL', bundle_ref: {
        turn_state: { v: 1, state: 'WAIT_APPROVAL', blocks: [], actions: [] },
        paige_confirm: [{ tool: 'plan_set_reminder', summary: 'Create the original reminder', fingerprint: `1234567890abcdef:${ids.intent}` }],
      } }];
    if (fixture.position === 'nonlast') h.turns.push({ id: id(20), role: 'user', content: 'Thanks.' },
      { id: id(21), role: 'assistant', content: 'The later conversation stays here.' });
    h.pending.mockReset().mockResolvedValue(null);
    h.history.mockReset();
    if (fixture.state === 'checking') h.history.mockReturnValue(new Promise(() => {}));
    else h.history.mockResolvedValue(fixture.state === 'unverified' ? null : history(fixture.state === 'long-title' ? longTitle : title));
    try {
      await act(async () => { root.render(<PaigeAIChat hideHeader fill enableHistory soloTenantSafety
        liveConversation={false} activeThreadId={ids.thread} />); await flush(); });
      const transcript = host.querySelector('#solo-paige-transcript'); expect(transcript).not.toBeNull();
      const card = transcript!.querySelector('[data-paige-original-reminder-result], [data-paige-original-reminder-status]');
      expect(card).not.toBeNull(); expect(card!.getAttribute('role')).toBe('status');
      expect(card!.classList.contains('break-words')).toBe(true);
      expect(card!.closest('[data-paige-message-id]')?.getAttribute('data-paige-message-id')).toBe(ids.turn);
      if (fixture.state === 'checking') expect(card!.textContent).toContain('Checking the earlier reminder');
      else if (fixture.state === 'unverified') expect(card!.textContent).toContain("earlier reminder outcome couldn't be verified");
      else {
        expect(card!.textContent).toContain(`Recorded earlier: ${fixture.state === 'long-title' ? longTitle : title}`);
        expect(card!.textContent).toContain('Originally scheduled for');
        expect(card!.getAttribute('data-paige-original-reminder-item')).toBe(ids.item);
        expect(card!.getAttribute('data-paige-original-reminder-receipt')).toBe(ids.receipt);
      }
      expect(card!.textContent).not.toMatch(/currently scheduled|delivered|sent successfully/i);
      expect(card!.querySelector('button,a,input,textarea')).toBeNull();
      expect(transcript!.querySelector('[data-paige-confirm-card] button')).toBeNull();
      expect(Array.from(transcript!.querySelectorAll('button')).some(b => /^(Approve|Not now|Ask Paige again)(?:\b|$)/i.test(b.textContent ?? ''))).toBe(false);
      if (fixture.position === 'nonlast') expect(transcript!.textContent).toContain('The later conversation stays here.');
      expect(h.history).toHaveBeenCalledTimes(1); expect(h.pending).not.toHaveBeenCalled(); expect(network).not.toHaveBeenCalled();
      const name = `reminder-${fixture.theme}-${fixture.width}x${fixture.height}-${fixture.state}-${fixture.position}-${fixture.mode}`;
      const dom = host.innerHTML, html = page(dom, fixture);
      writeFileSync(`${out}/${name}.dom.html`, dom); writeFileSync(`${out}/${name}.html`, html);
      records.push({ ...fixture, name, domSha256: digest(dom), htmlSha256: digest(html),
        statuses: Array.from(transcript!.querySelectorAll('[role="status"]')).map(e => e.textContent),
        historyCalls: 1, pendingCalls: 0, effects: 0, pixels: 'UNVERIFIED', layout: 'UNVERIFIED',
        zoom: fixture.mode === 'css-zoom-200' ? 'CSS_ZOOM_FIXTURE_ONLY_NOT_BROWSER_ZOOM' : 'NOT_MEASURED',
        reducedMotion: fixture.mode === 'reduced-motion' ? 'MATCH_MEDIA_INPUT_ONLY_NOT_ANIMATION_MEASUREMENT' : 'NOT_MEASURED' });
    } finally {
      await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); network.mockRestore();
      Object.defineProperty(window, 'innerWidth', { configurable: true, value: previous.width });
      Object.defineProperty(window, 'innerHeight', { configurable: true, value: previous.height });
    }
  });
});
afterAll(() => {
  for (const path of cssInputs) writeFileSync(`${out}/${path.replace(/\//g, '_')}.source.txt`, readFileSync(path));
  writeFileSync(`${out}/render-manifest.json`, JSON.stringify({ proofClass: 'ACTUAL_COMPONENT_DOM_SYNTHETIC_READ_PORTS',
    sources, cssClass, compiledReady, compiledPaths: compiledPaths.map(path => ({ path, sha256: digest(readFileSync(path)) })),
    cssSha256: compiledReady ? digest(css) : null, expectedRecords: cases.length, capturedRecords: records.length,
    layoutAndPixels: 'UNVERIFIED_NO_BROWSER_RUN', currentShellGeometry: 'NOT_MOUNTED_COMPONENT_ONLY',
    authenticatedQa: 'UNVERIFIED', records }, null, 2));
  expect(records).toHaveLength(cases.length);
});
