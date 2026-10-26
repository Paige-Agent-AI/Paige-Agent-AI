import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { createClient } from '@supabase/supabase-js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useSoloAgreementSignings, type SigningsState } from './useSoloAgreementSignings';

const fixture = vi.hoisted(() => ({
  client: null as ReturnType<typeof createClient> | null,
  context: { activeTenantId: 'aaaaaaaa-0000-4000-8000-000000000001', activeUserId: 'bbbbbbbb-0000-4000-8000-000000000001', accountContextLoading: false },
}));
vi.mock('@/hooks/useTenantContext', () => ({ useTenantContext: () => fixture.context }));
// The original hook uses the real pinned query builder. Only Auth and HTTP are controlled.
vi.mock('@/integrations/supabase/client', () => ({ supabase: {
  auth: {
    getUser: async () => ({ data: { user: { id: fixture.context.activeUserId } }, error: null }),
    getSession: async () => ({ data: { session: { user: { id: fixture.context.activeUserId, is_anonymous: false }, access_token: 'controlled-session' } }, error: null }),
  },
  from: (table: string) => fixture.client!.from(table),
} }));

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const agreement = 'cccccccc-0000-4000-8000-000000000001';
let root: Root, host: HTMLDivElement, current: SigningsState;
let requests: URL[], refused: boolean;
const rows = Array.from({ length: 51 }, (_, index) => ({
  id: `controlled-event-${index}`, event_type: index === 0 ? 'edited' : index === 1 ? 'sent' : 'created',
  action: index === 0 ? 'prepared_signature_credentials_recorded' : index === 1 ? 'prepared_signature_request_recorded' : 'controlled private action',
  detail: { private: 'controlled full detail must not reach the display' },
  actor_kind: 'owner', actor_email: null, ip: null, user_agent: null, created_at: '2026-10-25T12:00:00Z', seq: 51 - index,
}));
function Probe() { current = useSoloAgreementSignings(); return null; }
beforeEach(async () => {
  requests = []; refused = false;
  fixture.client = createClient('https://workspace.example.test', 'controlled-public-key', {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: async input => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      requests.push(url);
      const history = url.pathname.endsWith('/paige_agreement_events');
      const data = history ? refused ? { code: '42501', message: 'controlled private refusal' } : rows
        : url.pathname.endsWith('/tenant_members') ? { role: 'owner' } : [];
      return new Response(JSON.stringify(data), { status: history && refused ? 403 : 200, headers: { 'Content-Type': 'application/json' } });
    } },
  });
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  await act(async () => { root.render(<Probe />); });
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });

it('uses the original SDK scoped scalar projection and preserves sequence, truncation and private-detail minimization', async () => {
  const result = await current.signingEvents(agreement, fixture.context.activeTenantId);
  const request = requests.find(url => url.pathname.endsWith('/paige_agreement_events'))!;
  expect(request.searchParams.get('select')?.split(',')).toContain('detail->>action');
  expect(request.searchParams.get('select')?.split(',')).not.toContain('detail');
  expect(request.searchParams.get('tenant_id')).toBe(`eq.${fixture.context.activeTenantId}`);
  expect(request.searchParams.get('agreement_id')).toBe(`eq.${agreement}`);
  expect(request.searchParams.get('order')).toBe('seq.desc');
  expect(request.searchParams.get('limit')).toBe('51');
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error('Controlled history should be readable');
  expect(result.truncated).toBe(true); expect(result.events).toHaveLength(50);
  expect(result.events[0].action).toBe('prepared_signature_credentials_recorded');
  expect(result.events[1].action).toBe('prepared_signature_request_recorded');
  expect(result.events[2].action).toBeNull();
  expect(JSON.stringify(result)).not.toMatch(/controlled private action|controlled full detail/);
});
it('keeps an original access refusal unreadable without publishing private response prose or partial activity', async () => {
  refused = true;
  const result = await current.signingEvents(agreement, fixture.context.activeTenantId);
  expect(result.ok).toBe(false);
  expect(JSON.stringify(result)).not.toContain('controlled private refusal');
  expect(result).not.toHaveProperty('events');
});
