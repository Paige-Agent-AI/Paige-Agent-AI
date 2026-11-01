// @vitest-environment jsdom
import React, {act} from 'react';
import {createRoot, type Root} from 'react-dom/client';
import {afterEach, beforeEach, expect, it, vi} from 'vitest';
const api = vi.hoisted(() => ({prepare: vi.fn(), upload: vi.fn(), submit: vi.fn(), rpc: vi.fn(), from: vi.fn()}));
const identity = vi.hoisted(() => ({activeTenantId: '11111111-1111-4111-8111-111111111111', activeUserId: '22222222-2222-4222-8222-222222222222', loading: false, accountContextStatus: 'ready'}));
const tenant = '11111111-1111-4111-8111-111111111111', actor = '22222222-2222-4222-8222-222222222222';
vi.mock('@/hooks/useTenantContext', () => ({useTenantContext: () => identity}));
vi.mock('@/integrations/supabase/client', () => ({supabase: {rpc: api.rpc, storage: {from: api.from}}}));
vi.mock('@/lib/knowledge-extraction-service', async original => ({...await original<typeof import('@/lib/knowledge-extraction-service')>(), prepareKnowledgeUploadSelection: api.prepare, uploadKnowledgeFileOnce: api.upload, submitKnowledgeExtraction: api.submit}));
import {AddKnowledgeFlow} from '@/solo/knowledge/AddKnowledgeFlow';
import {Dialog} from '@/components/ui/dialog';
type Selection = {actorId: string; tenantId: string; files: readonly File[]; isCurrent: () => boolean};
let root: Root, host: HTMLDivElement;
const file = (name: string, bytes = [1, 2, 3]) => {
  const value = new File([new Uint8Array(bytes)], name, {type: name.endsWith('.docx') ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' : 'text/plain'});
  Object.defineProperty(value, 'arrayBuffer', {value: vi.fn(async () => new Uint8Array(bytes).buffer), configurable: true});
  return value;
};
const selection = (files = [file('Agreement.docx')]): Selection => ({actorId: actor, tenantId: tenant, files, isCurrent: () => true});
const render = async (attachedSelection: Selection) => {await act(async () => {root.render(<Dialog open><AddKnowledgeFlow tenantId={tenant} attachedSelection={attachedSelection} onClose={() => {}} /></Dialog>); await new Promise(r => setTimeout(r, 15));});};
const click = async (text: string) => {const button = [...document.body.querySelectorAll('button')].find(b => b.textContent === text); expect(button).toBeTruthy(); await act(async () => button!.click());};
beforeEach(() => {
  identity.activeTenantId = tenant; identity.activeUserId = actor;
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  api.from.mockReturnValue({});
  api.prepare.mockImplementation(async (_scope, _actor, inputs) => inputs.map((input: {name: string; mime: string; bytes: Uint8Array}, i: number) => ({phase: 'prepared', name: input.name, intentId: `intent-${i}`, source: {path: `${tenant}/original-${i}`, ...input}})));
  api.upload.mockImplementation(async (_c, _s, source) => ({phase: 'stored', path: source.path}));
  api.submit.mockResolvedValue({reference: {tenantId: tenant, documentId: 'doc', workId: 'work'}, status: 'claimed'});
});
afterEach(async () => {await act(async () => root.unmount()); host.remove(); vi.resetAllMocks();});
it('prepares the original attached file bytes without another chooser or automatic effect', async () => {
  const input = selection(); await render(input);
  expect(api.prepare).toHaveBeenCalledTimes(1);
  expect(api.prepare.mock.calls[0][1]).toBe(actor);
  expect(api.prepare.mock.calls[0][2]).toEqual([{name: 'Agreement.docx', mime: input.files[0].type, bytes: new Uint8Array([1, 2, 3])}]);
  expect(document.body.textContent).toContain('Agreement.docx');
  expect(document.body.querySelector<HTMLInputElement>('input[type=file]')?.disabled).toBe(true);
  expect(api.from).not.toHaveBeenCalled(); expect(api.upload).not.toHaveBeenCalled(); expect(api.submit).not.toHaveBeenCalled(); expect(api.rpc).not.toHaveBeenCalled();
});
it('prepares only once under StrictMode without any automatic transfer', async () => {
  const input = selection();
  await act(async () => {root.render(<React.StrictMode><Dialog open><AddKnowledgeFlow tenantId={tenant} attachedSelection={input} onClose={() => {}} /></Dialog></React.StrictMode>); await new Promise(r => setTimeout(r, 15));});
  expect(api.prepare).toHaveBeenCalledTimes(1); expect(api.from).not.toHaveBeenCalled(); expect(api.upload).not.toHaveBeenCalled(); expect(api.submit).not.toHaveBeenCalled();
});
it('uses the same per-file original transfer and extraction only after explicit upload', async () => {
  const input = selection([file('First.txt'), file('Second.txt', [4, 5])]); await render(input); await click('Upload and read files');
  expect(api.upload).toHaveBeenCalledTimes(2); expect(api.submit).toHaveBeenCalledTimes(2);
  expect(api.upload.mock.calls.map(c => c[2].bytes)).toEqual([new Uint8Array([1, 2, 3]), new Uint8Array([4, 5])]);
  expect(api.submit.mock.calls.map(c => c[2])).toEqual(input.files.map((f, i) => ({kind: 'file', intent_id: `intent-${i}`, title: f.name, path: `${tenant}/original-${i}`})));
});
it.each(['actorId', 'tenantId'] as const)('refuses a foreign attached %s before reading its local bytes', async key => {
  const input = {...selection(), [key]: '33333333-3333-4333-8333-333333333333'}; await render(input);
  expect(input.files[0].arrayBuffer).not.toHaveBeenCalled(); expect(api.prepare).not.toHaveBeenCalled(); expect(api.from).not.toHaveBeenCalled(); expect(document.body.textContent).not.toContain('Agreement.docx');
});
it('refuses a retired original Chat incarnation before preparing files', async () => {
  const input = {...selection(), isCurrent: () => false}; await render(input);
  expect(input.files[0].arrayBuffer).not.toHaveBeenCalled(); expect(api.prepare).not.toHaveBeenCalled(); expect(api.from).not.toHaveBeenCalled();
});
it('treats a failed source-incarnation check as refusal before reading files', async () => {
  const input = {...selection(), isCurrent: () => {throw new Error('scope unavailable');}}; await render(input);
  expect(input.files[0].arrayBuffer).not.toHaveBeenCalled(); expect(api.prepare).not.toHaveBeenCalled(); expect(api.from).not.toHaveBeenCalled();
});
it('closing during local preparation prevents late submission or transfer', async () => {
  let resolve!: (value: ArrayBuffer) => void; const input = selection();
  Object.defineProperty(input.files[0], 'arrayBuffer', {value: vi.fn(() => new Promise<ArrayBuffer>(r => {resolve = r;}))});
  await render(input); await click('Close'); await act(async () => resolve(new Uint8Array([1, 2, 3]).buffer));
  expect(api.prepare).not.toHaveBeenCalled(); expect(api.from).not.toHaveBeenCalled(); expect(api.submit).not.toHaveBeenCalled();
});
it('discards a late file read after source retirement, including an attempted return', async () => {
  let resolve!: (value: ArrayBuffer) => void, current = true;
  const input = {...selection(), isCurrent: () => current};
  Object.defineProperty(input.files[0], 'arrayBuffer', {value: vi.fn(() => new Promise<ArrayBuffer>(r => {resolve = r;}))});
  await render(input); expect(input.files[0].arrayBuffer).toHaveBeenCalledTimes(1);
  current = false; await act(async () => resolve(new Uint8Array([1, 2, 3]).buffer));
  current = true; await render(input);
  expect(api.prepare).not.toHaveBeenCalled(); expect(api.from).not.toHaveBeenCalled(); expect(document.body.textContent).not.toContain('Agreement.docx');
});
it('does not retarget an open review when the host supplies a different selection', async () => {
  const input = selection(); await render(input); const changed = selection([file('Replacement.txt')]); await render(changed);
  expect(api.prepare).toHaveBeenCalledTimes(1); expect(changed.files[0].arrayBuffer).not.toHaveBeenCalled(); expect(api.from).not.toHaveBeenCalled(); expect(document.body.textContent).not.toContain('Replacement.txt');
});
it.each(['activeTenantId', 'activeUserId'] as const)('does not revive an observed %s departure on return', async key => {
  const input = selection(); await render(input); const before = identity[key];
  identity[key] = '33333333-3333-4333-8333-333333333333'; await render(input);
  identity[key] = before; await render(input);
  expect(api.prepare).toHaveBeenCalledTimes(1); expect(api.from).not.toHaveBeenCalled();
  expect(document.body.textContent).not.toContain('Agreement.docx'); expect(document.body.textContent).toContain('Source changed');
});
it('snapshots the file list before the first await so host mutation cannot change it', async () => {
  let resolve!: (value: ArrayBuffer) => void;
  const files = [file('First.txt'), file('Second.txt')], input = selection(files);
  Object.defineProperty(files[0], 'arrayBuffer', {value: vi.fn(() => new Promise<ArrayBuffer>(r => {resolve = r;}))});
  await render(input); files[1] = file('Replacement.txt');
  await act(async () => resolve(new Uint8Array([1, 2, 3]).buffer));
  expect(api.prepare.mock.calls[0][2].map((f: {name: string}) => f.name)).toEqual(['First.txt', 'Second.txt']);
  expect(api.from).not.toHaveBeenCalled();
});
