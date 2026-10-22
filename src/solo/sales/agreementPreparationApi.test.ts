import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { rpc } }));
import { createAgreementDraft, readAgreementPreparation, recoverAgreementCreation } from './agreementPreparationApi';

const tenant = 'aaaaaaaa-0000-4000-8000-000000000001';
const id = 'bbbbbbbb-0000-4000-8000-000000000001';
const client = 'cccccccc-0000-4000-8000-000000000001';
const request = 'dddddddd-0000-4000-8000-000000000001';
const event = 'eeeeeeee-0000-4000-8000-000000000001';
const at = '2026-10-21T20:00:00.123456+00:00';
const receipt = () => ({ state: 'created', signing_id: id, signature_state: 'draft', version: 1, updated_at: at, creation_event_id: event });
const document = () => ({ agreement: {
  id, contact_id: client, offer_id: null, commercial_terms_id: null, title: 'Synthetic agreement',
  body_source: 'paige_draft', source_version_id: null, body_markdown: 'Retained original wording.',
  has_source_document: false, status: 'draft', version: 1, updated_at: at, expires_at: null, can_edit: true,
  content_sha256: null, sealed_sha256: null,
}, signers: [] });
beforeEach(() => { rpc.mockReset(); });
afterEach(() => vi.useRealTimers());

describe('native agreement preparation transport', () => {
  it('reads the selected original and captured business, including uppercase UUID references', async () => {
    rpc.mockResolvedValue({ data: document(), error: null });
    const result = await readAgreementPreparation(tenant, id.toUpperCase());
    expect(result.ok).toBe(true);
    expect(rpc).toHaveBeenCalledWith('read_paige_agreement_preparation', { _expected_tenant_id: tenant, _signing_id: id.toUpperCase() });
  });
  it('refuses a well-formed different record instead of relabelling it as the selection', async () => {
    const other = document(); other.agreement.id = request;
    rpc.mockResolvedValue({ data: other, error: null });
    expect(await readAgreementPreparation(tenant, id)).toMatchObject({ ok: false, reason: 'unconfirmed' });
  });
  it.each([null, {}, { agreement: document().agreement }, { ...document(), token: 'synthetic-private-value' }])('does not convert an incomplete or expanded readback into an empty/successful record: %j', async data => {
    rpc.mockResolvedValue({ data, error: null });
    const result = await readAgreementPreparation(tenant, id);
    expect(result).toMatchObject({ ok: false, reason: 'unconfirmed' });
    expect(JSON.stringify(result)).not.toContain('synthetic-private-value');
  });
  it('sends the exact draft source and stable request, then requires the native receipt', async () => {
    rpc.mockResolvedValue({ data: receipt(), error: null });
    const body = '  # Original author wording\n\n* Retain this clause.\n';
    const result = await createAgreementDraft({ tenantId: tenant, requestId: request, clientId: client, title: 'Scope', body });
    expect(result).toMatchObject({ ok: true, value: { state: 'created', signing_id: id, creation_event_id: event } });
    expect(rpc).toHaveBeenCalledWith('create_paige_agreement_draft_once', expect.objectContaining({
      _expected_tenant_id: tenant, _request_id: request, _contact_id: client, _title: 'Scope', _body_markdown: body,
      _offer_id: null, _commercial_terms_id: null, _body_source: 'paige_draft', _source_version_id: null, _document_path: null,
    }));
  });
  it.each([{ ...receipt(), creation_event_id: null }, { ...receipt(), state: 'sent' }, { ...receipt(), version: '1' }, { ok: true, signing_id: id }])('withholds creation confirmation without a valid original event/revision receipt: %j', async data => {
    rpc.mockResolvedValue({ data, error: null });
    expect(await createAgreementDraft({ tenantId: tenant, requestId: request, clientId: client, title: 'Scope', body: 'Original' })).toMatchObject({ ok: false, reason: 'unconfirmed' });
  });
  it('recovers current original metadata using only the opaque request ID', async () => {
    rpc.mockResolvedValue({ data: { ...receipt(), state: 'recovered', signature_state: 'sent', version: 2 }, error: null });
    expect(await recoverAgreementCreation(tenant, request)).toMatchObject({ ok: true, value: { state: 'recovered', signing_id: id, signature_state: 'sent', version: 2 } });
    expect(rpc).toHaveBeenCalledWith('recover_paige_agreement_draft_creation', { _expected_tenant_id: tenant, _request_id: request });
  });
  it('retains an absent original as unconfirmed and never calls creation', async () => {
    rpc.mockResolvedValue({ data: { state: 'unconfirmed' }, error: null });
    expect(await recoverAgreementCreation(tenant, request)).toEqual({ ok: true, value: { state: 'unconfirmed' } });
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc.mock.calls[0][0]).toBe('recover_paige_agreement_draft_creation');
  });
  it.each([['42501', 'refused'], ['40001', 'conflict'], ['23514', 'refused'], ['22023', 'refused'], ['unknown', 'unconfirmed']])('keeps %s distinct and never echoes raw domain errors', async (code, reason) => {
    rpc.mockResolvedValue({ data: receipt(), error: { code, message: 'synthetic private body from raw server error' } });
    const result = await recoverAgreementCreation(tenant, request);
    expect(result).toMatchObject({ ok: false, reason });
    expect(JSON.stringify(result)).not.toContain('synthetic private body');
  });
  it('does not claim rollback or success when the response is lost', async () => {
    rpc.mockRejectedValue(new Error('synthetic network failure'));
    expect(await createAgreementDraft({ tenantId: tenant, requestId: request, clientId: client, title: 'Scope', body: 'Original' })).toMatchObject({ ok: false, reason: 'unconfirmed' });
  });
  it('bounds a stalled wait as unconfirmed even if a successful response arrives later', async () => {
    vi.useFakeTimers();
    let complete!: (value: unknown) => void;
    rpc.mockReturnValue(new Promise(resolve => { complete = resolve; }));
    const waiting = createAgreementDraft({ tenantId: tenant, requestId: request, clientId: client, title: 'Scope', body: 'Original' });
    await vi.advanceTimersByTimeAsync(20_001);
    const result = await waiting;
    expect(result).toMatchObject({ ok: false, reason: 'unconfirmed' });
    complete({ data: receipt(), error: null });
    await Promise.resolve();
    expect(result).toMatchObject({ ok: false, reason: 'unconfirmed' });
    expect(vi.getTimerCount()).toBe(0);
  });
  it('does not issue any RPC for missing context or malformed identity', async () => {
    await readAgreementPreparation('', id);
    await recoverAgreementCreation(tenant, 'not-an-id');
    await createAgreementDraft({ tenantId: tenant, requestId: request, clientId: 'missing', title: 'Scope', body: 'Original' });
    expect(rpc).not.toHaveBeenCalled();
  });
});
