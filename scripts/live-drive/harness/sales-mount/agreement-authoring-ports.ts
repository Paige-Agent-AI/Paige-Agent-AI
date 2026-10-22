// Synthetic ports for the incumbent Sales source-mount only. No production import.
import { useSyncExternalStore } from 'react';
import { useSoloCommercialTerms as incumbentTerms } from './useSoloCommercialTerms-stub';
import { useSoloAgreementSignings as incumbentSignings } from './useSoloAgreementSignings-stub';
export { TRAIL_LIMIT } from '@/solo/useSoloAgreementSignings';
export const tenant = 'aaaaaaaa-0000-4000-8000-000000000001';
export const client = 'cccccccc-0000-4000-8000-000000000001';
const listeners = new Set<() => void>();
let state = { activeTenantId: tenant, activeUserId: 'bbbbbbbb-0000-4000-8000-000000000001', accountContextStatus: 'ready', canManage: true, authorityUnknown: false, phase: 'ready' as 'ready' | 'loading', clientsReadable: true };
window.addEventListener('e04-authoring-port', event => { state = { ...state, ...(event as CustomEvent).detail }; listeners.forEach(listener => listener()); });
const subscribe = (listener: () => void) => { listeners.add(listener); return () => listeners.delete(listener); };
const snapshot = () => state;
export function useTenantContext() { return useSyncExternalStore(subscribe, snapshot, snapshot); }
export const useOptionalTenantContext = useTenantContext;
export function useSoloCommercialTerms() {
  const original = incumbentTerms(), current = useTenantContext();
  return { ...original, tenantId: current.activeTenantId, phase: current.phase, canManage: current.canManage,
    authorityUnknown: current.authorityUnknown, clientsReadable: current.clientsReadable,
    agreements: [], clients: [{ id: client, name: 'Sample Advisory Client', primaryEmail: 'client@example.test' }] };
}
export function useSoloAgreementSignings() {
  const original = incumbentSignings(), current = useTenantContext();
  return { ...original, tenantId: current.activeTenantId, phase: current.phase, signings: [],
    canManage: current.canManage, authorityUnknown: current.authorityUnknown,
    signingEvents: async () => ({ ok: true as const, events: [{ id: 'synthetic-created', type: 'created', actorKind: 'owner', actorEmail: null, at: '2026-10-21T20:00:00Z' }], truncated: false }) };
}
