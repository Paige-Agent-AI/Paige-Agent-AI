import path from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react-swc';

// Development-only data boundaries; this separate root cannot enter the app build.
const repo = path.resolve(import.meta.dirname, '../../../..');
const stubs = path.join(import.meta.dirname, 'stubs.tsx');
const shell = path.join(repo, 'scripts/live-drive/harness/executive-mount/stubs.tsx');
const route = path.join(import.meta.dirname, 'route-stubs.tsx');
export default defineConfig({
  root: import.meta.dirname, publicDir: path.join(repo, 'public'), css: { postcss: repo }, plugins: [react()],
  resolve: { alias: [
    { find: /^@\/(hooks\/(useTenantContext|usePendingApprovals|usePlanList)|components\/auth\/WorkspaceExitControl|lib\/voice\/VoiceDeviceProvider|components\/ui\/paige|components\/admin\/voice\/(DialPadSurface|IncomingCallOverlay|LiveTranscriptPanel)|components\/tenant-relationships\/TenantRelationshipsClientsWorkspace|components\/tenant-calendar\/TenantCanonicalCalendarWorkspace)$/, replacement: route },
    { find: /^\.\/(CommandCenter|SoloPaigeWorkspace|SoloSetupReadinessNotice|conversations|growth2|AdsWorkspace|SalesWorkspace|operations\/OperationsRoute|team-hub\/TeamHubWorkspace|marketplace|settings|vault\/useBusinessVault|vibe)$/, replacement: route },
    { find: /^\.\.\/data\/useBusinessReview$/, replacement: stubs },
    { find: /^\.\.\/sales\/performance\/useSalesPerformanceMetrics$/, replacement: stubs },
    { find: /^\.\/useFinanceInvoices$/, replacement: stubs },
    { find: /^@\/(integrations\/supabase\/client|hooks\/useTenantContext|hooks\/useTierFeatures|components\/ui\/paige|components\/admin\/voice\/DialPadTrigger)$/, replacement: shell },
    { find: '@', replacement: path.join(repo, 'src') },
  ] },
  define: { 'import.meta.env.VITE_SUPABASE_URL': JSON.stringify('https://harness.invalid'), 'import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY': JSON.stringify('synthetic-not-a-key') },
  server: { host: '127.0.0.1', port: 5214, strictPort: true },
});
