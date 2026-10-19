import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";

// E09 Slice 1 — the BUSINESS OWNER side of the portal conversation: the REAL canonical inbox
// (ClientsConversations) as the REAL Solo Clients workspace mounts it (TenantRelationshipsClientsWorkspace,
// routeTier="solo", /solo/42/clients/conversations), inside the real Solo shell CSS and pg tokens. Only the
// data boundary is stubbed (stubs.ts): the session/tenant context, the role read, the relationship data hook
// and the Supabase transport. Its own root: never part of the app build (§9).
//   /solo/42/clients/conversations?state=thread|help|notjoined|error&theme=light|dark&paige=open|closed
const repo = path.resolve(import.meta.dirname, "../../../..");
const stubs = path.join(import.meta.dirname, "stubs.ts");
export default defineConfig({
  root: import.meta.dirname,
  // The repo's own font files, so frames paint the real face with the network blocked (E09 Slice 7 round 2).
  publicDir: path.join(repo, "public"),
  cacheDir: path.join(repo, "node_modules/.vite/harness-e09-portal-owner-inbox-mount"),
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
