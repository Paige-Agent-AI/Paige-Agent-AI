// DEVELOPMENT ONLY: actual SoloApp/Finance route composition, synthetic account
// context and source transports. No customer authentication or business effects.
import { HarnessPresence, useAgentPresence } from '../executive-mount/stubs';
import { TEST_REVIEW_TENANT } from '@/test/fixtures/business-review';
import { SECOND_REVIEW_TENANT } from '../executive-mount/slice-fixtures';
export { useAgentPresence };
export const AgentPresenceProvider = HarnessPresence;
export const VoiceDeviceProvider = ({ children }: { children: React.ReactNode }) => children;
export const useVoiceDevice = () => null;
const initialQuery = new URLSearchParams(window.location.search);
export function useTenantContext() {
  const p = initialQuery;
  return { activeUserId: 'synthetic-owner', activeTenantId: p.get('workspace') === 'b' ? SECOND_REVIEW_TENANT : TEST_REVIEW_TENANT,
    loading: false, accountContextStatus: 'ready', isPlatformStaff: false,
    activeTenant: { account_number: '1234567', name: 'SYNTHETIC / Example Services', account_type: 'standalone', features: { solo_setup_completed: true } } };
}
export const useOptionalTenantContext = useTenantContext;
export const usePendingApprovals = () => ({ items: [] });
export const usePlanList = () => ({ plans: [], allItems: [], loading: false, refresh: () => {} });
export const useVaultAccess = () => ({});
export const canShowVaultNavigation = () => false;
export const DialPadSurface = () => null;
export const IncomingCallOverlay = () => null;
export const LiveTranscriptPanel = () => null;
export const WorkspaceExitControl = () => null;
export const SoloSetupReadinessNotice = () => null;
const UnmountedDepartment = () => <p>Outside this synthetic Finance proof.</p>;
export const CommandHub = UnmountedDepartment;
export const ClientsHub = UnmountedDepartment;
export const GrowthHub = UnmountedDepartment;
export const AdsWorkspace = UnmountedDepartment;
export const SalesWorkspace = UnmountedDepartment;
export const OperationsRoute = UnmountedDepartment;
export const TeamHubWorkspace = UnmountedDepartment;
export const TenantRelationshipsClientsWorkspace = UnmountedDepartment;
export const TenantCanonicalCalendarWorkspace = UnmountedDepartment;
export const Marketplace = UnmountedDepartment;
export const SoloSettings = UnmountedDepartment;
export const VibeStudio = UnmountedDepartment;
export const SoloPaigeWorkspace = () => <label style={{ display: 'grid', gap: 8, padding: 20 }}>Synthetic unsent discussion<textarea aria-label="Synthetic conversation draft" defaultValue="Keep this discussion while I review Finance." style={{ minHeight: 100, background: 'var(--pg-surface)', color: 'var(--pg-ink)' }} /></label>;
