// Deterministic LOCAL caller boundary only. No SDK credentials, backend or provider request.
import { useSyncExternalStore } from 'react';

const id = (n: number) => `ec040000-0000-4000-8000-${String(n).padStart(12, '0')}`;
export const actorId = id(1), tenantId = id(3);
type Reply = { data: unknown; error: unknown };
type Row = { actor_id: string; tenant_id: string; release_id: string; submission_id: string;
  state: 'awaiting_client' | 'accepted' | 'client_revision_requested'; revision_no: number;
  artifact_digest: string; title: string; body: string; updated_at: string;
  decision_by: string | null; decision_at: string | null; client_note: string | null };
const params = new URLSearchParams(location.search);
let scenario = params.get('scenario') || 'ready', actor: string | null = actorId, preview = false, linked = true;
let nextWrite: 'verified' | 'unknown' | 'pending' | 'refused' = 'verified', exactError: string | null = null;
let authError = false, logoutCalls = 0;
let resolveWrite: ((reply: Reply) => void) | null = null, pendingArgs: Record<string, unknown> | null = null;
const listeners = new Set<() => void>();
const authListeners = new Set<(event: string, session: { user: { id: string } } | null) => void>();
const calls: string[] = [];
const count = scenario === 'capped' ? 40 : 2;
const records: Row[] = Array.from({ length: count }, (_, i) => ({
  actor_id: actorId, tenant_id: tenantId, release_id: i ? id(100 + i) : id(4),
  submission_id: i ? id(200 + i) : id(5), state: 'awaiting_client', revision_no: i ? 1 : 3,
  artifact_digest: (i ? 'b' : 'a').repeat(64),
  title: i ? `Customer onboarding checklist ${i}` : scenario === 'long'
    ? 'Launch strategy and onboarding plan with the full agreed service scope, review requirements and delivery sequence '.repeat(4).trim()
    : 'Launch strategy brief',
  body: `Synthetic released version ${i + 1}\n\nPrepared for Test client\n\nScope\nThis released version includes the channel plan, launch asset outlines and measurement checklist.\n\nChannel plan\nUse the approved service positioning on the customer newsletter and the existing enquiry page.\n\nReview requirements\nCheck the inputs and service sequence. Describe any required changes before confirming your decision.\n\nDelivery checklist\nConfirm the source labels, handoff instructions and first delivery checkpoint.\n\n${'This is deterministic local content, not a customer record.\n'.repeat(scenario === 'long' ? 35 : 8)}`,
  updated_at: '2026-10-14T00:00:00.123456Z', decision_by: null, decision_at: null, client_note: null,
}));
if (params.get('record') === 'accepted') Object.assign(records[0], { state: 'accepted', decision_by: actorId,
  decision_at: '2026-10-14T01:00:00.654321Z', updated_at: '2026-10-14T01:00:00.654321Z' });
const notify = () => { for (const listener of listeners) listener(); };
export const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
export const useFixtureActor = () => useSyncExternalStore(subscribe, () => actor);
export const useImpersonation = () => ({ isImpersonating: useSyncExternalStore(subscribe, () => preview) });
export const useDashboardMode = () => ({ isAdmin: false, mode: 'client', loading: false });

function decide(args: Record<string, unknown>) {
  const row = records.find(r => r.release_id === args.p_release_id);
  if (!row || actor !== actorId || !linked || row.updated_at !== args.p_expected_updated_at
    || row.state !== 'awaiting_client') return { data: null, error: { code: '42501' } };
  Object.assign(row, { state: args.p_decision, decision_by: actorId, decision_at: '2026-10-14T01:00:00.654321Z',
    updated_at: '2026-10-14T01:00:00.654321Z', client_note: args.p_note });
  return { data: structuredClone(row), error: null };
}
export const supabase = {
  auth: {
    getUser: async () => ({ data: { user: actor ? { id: actor } : null }, error: authError ? { message: 'Synthetic auth read error' } : null }),
    getSession: async () => ({ data: { session: actor ? { user: { id: actor } } : null }, error: null }),
    onAuthStateChange: (listener: (event: string, session: { user: { id: string } } | null) => void) => {
      authListeners.add(listener);
      return { data: { subscription: { unsubscribe: () => { authListeners.delete(listener); } } } };
    },
  },
  from: (table: string) => {
    if (table !== 'clients') throw new Error('Unexpected local table');
    return { select: (columns: string) => {
      if (columns !== 'id,tenant_id') throw new Error('Unexpected local projection');
      return { eq: (column: string, requestedActor: string) => {
        if (column !== 'linked_user_id' || requestedActor !== actor) throw new Error('Unexpected local actor');
        return { is: (column: string, mergeValue: unknown) => {
          if (column !== 'merged_into_contact_id' || mergeValue !== null) throw new Error('Unexpected local predicate');
          return { limit: async (limit: number) => {
            if (limit !== 2) throw new Error('Unexpected local bound');
            const rows = !linked || scenario === 'unlinked' || requestedActor !== actorId ? [] : [{ id: id(2), tenant_id: tenantId }];
            if (scenario === 'ambiguous') rows.push({ id: id(8), tenant_id: id(9) });
            return { data: rows, error: null };
          } };
        } };
      } };
    } };
  },
  rpc: async (name: string, args: Record<string, unknown>): Promise<Reply> => {
    calls.push(name);
    if (args.p_expected_actor_id !== actorId || args.p_expected_tenant_id !== tenantId || actor !== actorId || !linked)
      return { data: null, error: { code: '42501' } };
    if (name === 'operations_delivery_client_reviews_scoped') {
      if (scenario === 'loading') return new Promise(() => {});
      if (['error', 'refused'].includes(scenario)) return { data: null, error: { code: scenario === 'refused' ? '42501' : '08006' } };
      return { data: { actor_id: actorId, tenant_id: scenario === 'foreign' ? id(9) : tenantId,
        releases: scenario === 'empty' ? [] : records.map(row => ({ release_id: row.release_id, submission_id: row.submission_id,
          state: row.state, revision_no: row.revision_no, artifact_digest: row.artifact_digest, title: row.title, updated_at: row.updated_at })),
        unavailable_count: scenario === 'partial' ? 1 : 0, has_more: ['partial', 'capped'].includes(scenario) }, error: null };
    }
    if (name === 'operations_delivery_client_read_scoped') return { data: exactError ? null : structuredClone(records.find(r => r.release_id === args.p_release_id) ?? null), error: exactError ? { code: exactError } : null };
    if (name === 'operations_delivery_client_decide_scoped') {
      if (nextWrite === 'unknown' || nextWrite === 'refused') return { data: null, error: { code: nextWrite === 'unknown' ? '08006' : '42501' } };
      if (nextWrite === 'pending') { pendingArgs = args; return new Promise(resolve => { resolveWrite = resolve; }); }
      return decide(args);
    }
    throw new Error(`Unexpected local RPC ${name}`);
  },
};
export const fixture = {
  snapshot: () => ({ actor, preview, linked, scenario, calls: [...calls], decisions: calls.filter(n => n === 'operations_delivery_client_decide_scoped').length, logoutCalls, pending: Boolean(resolveWrite) }),
  setWriteMode: (mode: typeof nextWrite) => { nextWrite = mode; },
  setExactError: (code: string | null) => { exactError = code; },
  setAuthError: (value: boolean) => { authError = value; },
  setLinked: (value: boolean) => { linked = value; notify(); },
  setPreview: (value: boolean) => { preview = value; notify(); },
  setScenario: (value: string) => { scenario = value; notify(); },
  setActor: (value: string | null) => {
    actor = value; for (const listener of authListeners) listener(value ? 'SIGNED_IN' : 'SIGNED_OUT', value ? { user: { id: value } } : null); notify();
  },
  resolvePending: () => { const resolve = resolveWrite, args = pendingArgs; resolveWrite = null; pendingArgs = null; if (resolve && args) resolve(decide(args)); },
  recoverOriginal: () => { Object.assign(records[0], { state: 'accepted', decision_by: actorId, decision_at: '2026-10-14T01:00:00.654321Z', updated_at: '2026-10-14T01:00:00.654321Z', client_note: null }); },
  logout: () => { logoutCalls++; fixture.setActor(null); },
};
(window as unknown as { e04ClientFixture: typeof fixture }).e04ClientFixture = fixture;
