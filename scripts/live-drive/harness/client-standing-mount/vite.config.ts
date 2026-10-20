import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";

// Experience 04 E4-S3 PR beta — the REAL Solo Clients workspace (TenantRelationshipsClientsWorkspace,
// routeTier="solo") with a client open, so "Where {client} stands" renders inside the real record, real
// CSS and real pg tokens. Only the data boundary is stubbed (stubs.ts): the session/tenant context, the
// People read, the role read and the Supabase transport. Its own root: never part of the app build (§9).
//   /solo/42/clients/people?person=<id>&state=populated|empty|nozone|refused|error|loading&theme=light|dark
const repo = path.resolve(import.meta.dirname, "../../../..");
const stubs = path.join(import.meta.dirname, "stubs.ts");
export default defineConfig({
  root: import.meta.dirname,
  cacheDir: path.join(repo, "node_modules/.vite/harness-client-standing-mount"),
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
  server: { host: "127.0.0.1", port: 5227, strictPort: true },
});
