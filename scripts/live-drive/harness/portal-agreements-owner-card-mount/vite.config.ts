import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";

// E09 Slice A + Documents — the owner's Clients → Portal card ("Files and agreements") in the REAL
// TenantRelationshipsClientsWorkspace PortalView (non-Solo tiers). Reuses the client-standing harness's data
// boundary (stubs.ts there); only the transport and contexts are stubbed. Its own root: never in the app build.
//   /?tier=sub_account|agency|enterprise&theme=light|dark
const repo = path.resolve(import.meta.dirname, "../../../..");
const stubs = path.join(import.meta.dirname, "../client-standing-mount/stubs.ts");
export default defineConfig({
  root: import.meta.dirname,
  cacheDir: path.join(repo, "node_modules/.vite/harness-portal-agreements-owner-card-mount"),
  css: { postcss: repo },
  plugins: [react()],
  resolve: {
    alias: [
      { find: /^@\/integrations\/supabase\/client$/, replacement: stubs },
      { find: /^@\/hooks\/useTenantContext$/, replacement: stubs },
      { find: /^@\/hooks\/useUserRoles$/, replacement: stubs },
      { find: /^\.\/useTenantRelationshipsData$/, replacement: stubs },
      { find: "@", replacement: path.join(repo, "src") },
    ],
  },
  define: {
    "import.meta.env.VITE_SUPABASE_URL": JSON.stringify("http://harness.invalid"),
    "import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY": JSON.stringify("harness-not-a-real-key"),
  },
  appType: "spa",
  server: { host: "127.0.0.1", port: 5253, strictPort: true },
});
