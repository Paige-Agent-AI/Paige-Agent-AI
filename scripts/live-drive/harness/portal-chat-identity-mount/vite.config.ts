import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";

// E09 CURA identity, round 2 — the customer /app home as AppShell lays it out: the REAL AppNav, the REAL
// PaigeChat (customer branch and the not-active status), the REAL AppDashboardHome (greeting card, tiles) and
// the REAL PushNotificationPrompt. Only the data boundary is stubbed (stubs.ts): the Supabase transport, the
// customer frame read, the staff-standing read, the chat history read, push support and the chat's local data
// hooks. Its own root: never part of the app build (§9).
//   /app?agent=Cura|Ava&access=ready|inactive&theme=light|dark&push=1
const repo = path.resolve(import.meta.dirname, "../../../..");
const stubs = path.join(import.meta.dirname, "stubs.ts");
const stub = (p: string) => ({ find: new RegExp(`^${p.replace(/[/@]/g, (c) => `\\${c}`)}$`), replacement: stubs });
export default defineConfig({
  root: import.meta.dirname,
  cacheDir: path.join(repo, "node_modules/.vite/harness-portal-chat-identity-mount"),
  css: { postcss: repo },
  plugins: [react()],
  resolve: {
    alias: [
      stub("@/integrations/supabase/client"),
      stub("@/contexts/DashboardModeContext"),
      stub("@/hooks/useClientPortalFrame"),
      stub("@/lib/portal/portalStaffStanding"),
      stub("@/lib/customer-chat"),
      stub("@/hooks/usePushNotifications"),
      stub("@/hooks/usePaigeMemory"),
      stub("@/hooks/useChatDocumentUpload"),
      stub("@/hooks/useClientChatContext"),
      stub("@/hooks/useProfileSnapshot"),
      stub("@/hooks/useAnalytics"),
      stub("@/hooks/useBeforeUnloadGuard"),
      { find: "@", replacement: path.join(repo, "src") },
    ],
  },
  define: {
    "import.meta.env.VITE_SUPABASE_URL": JSON.stringify("http://harness.invalid"),
    "import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY": JSON.stringify("harness-not-a-real-key"),
  },
  appType: "spa",
  server: { host: "127.0.0.1", port: 5251, strictPort: true },
});
