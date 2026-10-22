import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgreementPreparation } from './agreementPreparationApi';
const fixtures = vi.hoisted(() => ({ context: {} as Record<string, unknown>, read: vi.fn(), recover: vi.fn(), create: vi.fn() }));
vi.mock('@/hooks/useTenantContext', () => ({ useTenantContext: () => fixtures.context }));
vi.mock('./agreementPreparationApi', () => ({ readAgreementPreparation: fixtures.read, recoverAgreementCreation: fixtures.recover, createAgreementDraft: fixtures.create }));
// Flow tests exercise real scope/receipt/leave state. The actual rich editor is
// verified by the separate framework-native browser drive, not this textarea.
vi.mock('./AgreementBodyEditor', () => ({ AgreementBodyEditor: ({ value, onChange, readOnly }: { value: string; onChange: (value: string) => void; readOnly: boolean }) => <label>Agreement content<textarea value={value} readOnly={readOnly} onChange={event => onChange(event.target.value)} /></label> }));
import { AgreementPreparationWorkspace } from './AgreementPreparationWorkspace';

// Use the repository's native React DOM test idiom; no extra test runtime.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement, root: Root;
function render(element: React.ReactNode) {
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  act(() => root.render(element));
  return { rerender: (next: React.ReactNode) => act(() => root.render(next)) };
}
const matches = (actual: string, expected: string | RegExp) => typeof expected === 'string' ? actual.trim() === expected : expected.test(actual);
function text(expected: string | RegExp) {
  return [...document.body.querySelectorAll<HTMLElement>('*')].find(node => matches(node.textContent ?? '', expected) && ![...node.children].some(child => matches(child.textContent ?? '', expected))) ?? null;
}
function required<T>(value: T | null): T { if (!value) throw new Error('Expected visible test element'); return value; }
function label(expected: string) {
  return [...document.querySelectorAll('label')].find(node => [...node.childNodes].filter(child => child.nodeType === Node.TEXT_NODE).map(child => child.textContent).join('').trim() === expected)?.control ?? null;
}
function role(expected: string, name?: string) {
  const selector = expected === 'button' ? 'button' : `[role="${expected}"]`;
  return [...document.querySelectorAll<HTMLElement>(selector)].find(node => !name || matches(node.getAttribute('aria-label') ?? node.textContent ?? '', name)) ?? null;
}
async function waitFor<T>(assertion: () => T): Promise<T> {
  const deadline = Date.now() + 1500;
  while (true) {
    try { return assertion(); } catch (error) {
      if (Date.now() >= deadline) throw error;
      await act(async () => { await new Promise(resolve => setTimeout(resolve, 5)); });
    }
  }
}
const screen = {
  getByLabelText: (name: string, _options?: unknown) => required(label(name)),
  queryByLabelText: (name: string) => label(name),
  getByRole: (name: string, options?: { name?: string }) => required(role(name, options?.name)),
  findByRole: (name: string, options?: { name?: string }) => waitFor(() => required(role(name, options?.name))),
  getByText: (name: string | RegExp) => required(text(name)),
  queryByText: (name: string | RegExp) => text(name),
  findByText: (name: string | RegExp) => waitFor(() => required(text(name))),
};
const fireEvent = {
  click: (node: HTMLElement) => act(() => node.click()),
  change: (node: HTMLElement, event: { target: { value: string } }) => act(() => {
    const prototype = node instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : node instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(node, event.target.value);
    node.dispatchEvent(new Event(node instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }));
  }),
};

const tenant = 'aaaaaaaa-0000-4000-8000-000000000001', other = 'aaaaaaaa-0000-4000-8000-000000000002';
const user = 'bbbbbbbb-0000-4000-8000-000000000001', client = 'cccccccc-0000-4000-8000-000000000001';
const id = 'dddddddd-0000-4000-8000-000000000001', request = 'eeeeeeee-0000-4000-8000-000000000001';
function original(): AgreementPreparation {
  return { agreement: { id, contact_id: client, offer_id: null, commercial_terms_id: null, title: 'Synthetic retained agreement', body_source: 'paige_draft', source_version_id: null, body_markdown: 'Original retained wording.', has_source_document: false, status: 'draft', version: 1, updated_at: '2026-10-21T20:00:00Z', expires_at: null, can_edit: true, content_sha256: null, sealed_sha256: null }, signers: [] };
}
const receipt = () => ({ state: 'created', signing_id: id, signature_state: 'draft', version: 1, updated_at: '2026-10-21T20:00:00Z', creation_event_id: 'ffffffff-0000-4000-8000-000000000001' });
function props() {
  return { tenantId: tenant, canManage: true, authorityUnknown: false, authorizationReady: true,
    clients: [{ id: client, name: 'Sample Client' }], clientsReady: true, clientsReadable: true,
    agreementId: 'new', requestId: request, requestTenantId: tenant, freshlyOpened: true, onDraftAttempted: vi.fn(),
    onOpenRecord: vi.fn(), onClose: vi.fn(), onOpenClients: vi.fn(), onRefresh: vi.fn(),
    signings: { signingEvents: vi.fn(async () => ({ ok: true, events: [], truncated: false } as const)), signedCopyUrl: vi.fn(async () => ({ ok: false, message: 'Synthetic unavailable copy' } as const)) } };
}
const fill = () => {
  fireEvent.change(screen.getByLabelText('Client', { exact: true }), { target: { value: client } });
  fireEvent.change(screen.getByLabelText('Agreement title'), { target: { value: 'New private wording' } });
  fireEvent.change(screen.getByLabelText('Agreement content'), { target: { value: 'Private draft body in RAM.' } });
};
const save = () => fireEvent.click(screen.getByRole('button', { name: 'Save agreement draft' }));
beforeEach(() => {
  fixtures.context = { accountContextStatus: 'ready', activeUserId: user, activeTenantId: tenant };
  fixtures.read.mockReset().mockResolvedValue({ ok: true, value: original() });
  fixtures.recover.mockReset().mockResolvedValue({ ok: true, value: { state: 'unconfirmed' } });
  fixtures.create.mockReset().mockResolvedValue({ ok: true, value: receipt() });
});
afterEach(() => { act(() => root?.unmount()); host?.remove(); vi.useRealTimers(); });

describe('native agreement preparation flow', () => {
  it('opens a fresh authoring request without a record or reconciliation write', () => {
    render(<AgreementPreparationWorkspace {...props()} />);
    expect(screen.getByLabelText('Agreement content')).toBeTruthy();
    expect(fixtures.read).not.toHaveBeenCalled(); expect(fixtures.create).not.toHaveBeenCalled(); expect(fixtures.recover).not.toHaveBeenCalled();
  });
  it('focuses each required missing field before issuing a request', () => {
    render(<AgreementPreparationWorkspace {...props()} />); save();
    expect(document.activeElement).toBe(screen.getByLabelText('Client', { exact: true }));
    fireEvent.change(screen.getByLabelText('Client', { exact: true }), { target: { value: client } }); save();
    expect(document.activeElement).toBe(screen.getByLabelText('Agreement title'));
    fireEvent.change(screen.getByLabelText('Agreement title'), { target: { value: 'Scope' } }); save();
    expect(document.activeElement).toBe(screen.getByLabelText('Agreement content')); expect(fixtures.create).not.toHaveBeenCalled();
  });
  it('saves one captured request and opens only its actual acknowledged record', async () => {
    const p = props(); render(<AgreementPreparationWorkspace {...p} />); fill(); save();
    await waitFor(() => expect(p.onOpenRecord).toHaveBeenCalledWith(id));
    expect(fixtures.create).toHaveBeenCalledWith({ tenantId: tenant, requestId: request, clientId: client, title: 'New private wording', body: 'Private draft body in RAM.' });
    expect(p.onDraftAttempted).toHaveBeenCalledWith(request);
  });
  it('reuses the same request after uncertainty without a read-then-create replacement', async () => {
    fixtures.create.mockResolvedValueOnce({ ok: false, reason: 'unconfirmed', message: 'Synthetic uncertain save' }).mockResolvedValueOnce({ ok: true, value: { ...receipt(), state: 'recovered' } });
    const p = props(); render(<AgreementPreparationWorkspace {...p} />); fill(); save();
    await screen.findByRole('button', { name: 'Continue this draft' }); fireEvent.click(screen.getByRole('button', { name: 'Continue this draft' }));
    expect((screen.getByLabelText('Agreement content') as HTMLTextAreaElement).value).toBe('Private draft body in RAM.'); save();
    await waitFor(() => expect(p.onOpenRecord).toHaveBeenCalledWith(id));
    expect(fixtures.create.mock.calls.map(call => call[0].requestId)).toEqual([request, request]); expect(fixtures.recover).not.toHaveBeenCalled();
  });
  it('recovers a reloaded original using only its opaque request, with no private browser payload', async () => {
    fixtures.recover.mockResolvedValue({ ok: true, value: { ...receipt(), state: 'recovered' } });
    const p = { ...props(), freshlyOpened: false }; render(<AgreementPreparationWorkspace {...p} />);
    await waitFor(() => expect(p.onOpenRecord).toHaveBeenCalledWith(id));
    expect(fixtures.recover).toHaveBeenCalledWith(tenant, request); expect(fixtures.create).not.toHaveBeenCalled();
  });
  it('does not call an unconfirmed original absent or silently create a new request', async () => {
    render(<AgreementPreparationWorkspace {...props()} freshlyOpened={false} />);
    await screen.findByText(/The original save is not confirmed yet/);
    expect(fixtures.create).not.toHaveBeenCalled(); expect(screen.queryByText('Nothing was saved')).toBeNull();
  });
  it('retains entered wording when reconciliation finds an original and requires an explicit leave decision', async () => {
    fixtures.create.mockResolvedValue({ ok: false, reason: 'unconfirmed', message: 'Synthetic uncertain save' });
    fixtures.recover.mockResolvedValue({ ok: true, value: { ...receipt(), state: 'recovered' } });
    const p = props(); render(<AgreementPreparationWorkspace {...p} />); fill(); save();
    await screen.findByRole('button', { name: 'Check original save' }); fireEvent.click(screen.getByRole('button', { name: 'Check original save' }));
    await screen.findByRole('button', { name: 'Open recorded draft' }); expect(p.onOpenRecord).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Open recorded draft' }));
    const dialog = await screen.findByRole('alertdialog'); expect(dialog.textContent).toContain('Leaving this editor does not apply its current wording');
    expect(dialog.textContent).not.toContain('Your changes have not been saved');
    fireEvent.click(screen.getByRole('button', { name: 'Leave current editor' })); expect(p.onOpenRecord).toHaveBeenCalledWith(id);
  });
  it('hides but preserves same-subject RAM work while authority is unknown', () => {
    const p = props(); const view = render(<AgreementPreparationWorkspace {...p} />); fill();
    view.rerender(<AgreementPreparationWorkspace {...p} authorizationReady={false} />);
    expect(screen.queryByLabelText('Agreement content')).toBeNull(); expect(screen.queryByText('Private draft body in RAM.')).toBeNull();
    view.rerender(<AgreementPreparationWorkspace {...p} />);
    expect((screen.getByLabelText('Agreement content') as HTMLTextAreaElement).value).toBe('Private draft body in RAM.');
  });
  it('retires private RAM wording after conclusive author revocation', async () => {
    const p = props(); const view = render(<AgreementPreparationWorkspace {...p} />); fill();
    view.rerender(<AgreementPreparationWorkspace {...p} canManage={false} />);
    expect(screen.queryByLabelText('Agreement content')).toBeNull();
    view.rerender(<AgreementPreparationWorkspace {...p} />);
    await waitFor(() => expect((screen.getByLabelText('Agreement content') as HTMLTextAreaElement).value).toBe(''));
  });
  it('never displays another business or subject draft during context changes', () => {
    const p = props(); const view = render(<AgreementPreparationWorkspace {...p} />); fill();
    fixtures.context = { ...fixtures.context, activeTenantId: other };
    view.rerender(<AgreementPreparationWorkspace {...p} />);
    expect(screen.queryByLabelText('Agreement content')).toBeNull(); expect(screen.queryByText('Sample Client')).toBeNull();
    fixtures.context = { ...fixtures.context, activeTenantId: tenant, activeUserId: 'bbbbbbbb-0000-4000-8000-000000000002' };
    view.rerender(<AgreementPreparationWorkspace {...p} />);
    expect((screen.getByLabelText('Agreement content') as HTMLTextAreaElement).value).toBe('');
  });
  it('does not open a late save after the authority frame retired', async () => {
    let finish!: (value: unknown) => void; fixtures.create.mockReturnValue(new Promise(resolve => { finish = resolve; }));
    const p = props(); const view = render(<AgreementPreparationWorkspace {...p} />); fill(); save();
    view.rerender(<AgreementPreparationWorkspace {...p} canManage={false} />);
    await act(async () => { finish({ ok: true, value: receipt() }); await Promise.resolve(); });
    expect(p.onOpenRecord).not.toHaveBeenCalled(); expect(screen.queryByLabelText('Agreement content')).toBeNull();
  });
  it('keeps an unfinished request bound to its original business when both ready ports switch', () => {
    const p = props(); const view = render(<AgreementPreparationWorkspace {...p} />); fill();
    fixtures.context = { ...fixtures.context, activeTenantId: other };
    view.rerender(<AgreementPreparationWorkspace {...p} tenantId={other} />);
    expect(screen.queryByLabelText('Agreement content')).toBeNull();
    expect(fixtures.recover).not.toHaveBeenCalled(); expect(fixtures.create).not.toHaveBeenCalled();
  });
  it('reopens the selected real wording and keeps signatures separate from payment/service completion', async () => {
    const p = { ...props(), agreementId: id, requestId: null, freshlyOpened: false };
    render(<AgreementPreparationWorkspace {...p} />);
    await screen.findByText('Original retained wording.');
    expect(fixtures.read).toHaveBeenCalledWith(tenant, id);
    expect(screen.getByText(/does not establish payment or completion/)).toBeTruthy();
  });
  it('does not label an unreadable selected agreement as a draft', async () => {
    fixtures.read.mockResolvedValue({ ok: false, reason: 'unconfirmed', message: 'Synthetic read failure' });
    render(<AgreementPreparationWorkspace {...props()} agreementId={id} requestId={null} freshlyOpened={false} />);
    await screen.findByText('Record unavailable'); expect(screen.queryByText('Draft preparation')).toBeNull();
  });
  it('reads audit activity through the existing scoped reader and handles a rejected read', async () => {
    const p = { ...props(), agreementId: id, requestId: null, freshlyOpened: false };
    p.signings.signingEvents.mockRejectedValue(new Error('Synthetic failure'));
    render(<AgreementPreparationWorkspace {...p} />); await screen.findByText('Original retained wording.');
    fireEvent.click(screen.getByRole('button', { name: 'View signing history' }));
    await screen.findByText('Agreement history could not be read. Try the original record again.');
    expect(p.signings.signingEvents).toHaveBeenCalledWith(id, tenant);
  });
});
