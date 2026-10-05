/**
 * Vite config for the brand-typeface harness mount — SEPARATE from the app's, so this dev-only,
 * unauthenticated mount of a tenant surface can never reach a production bundle (§9). Its own root and
 * port; the Supabase transport and the tenant context are the only stubs.
 */
import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";

const repo = path.resolve(import.meta.dirname, "../../../..");

export default defineConfig({
  root: import.meta.dirname,
  // Serve the repo's public/ so /fonts/brand/* resolves exactly as it does in production.
  publicDir: path.join(repo, "public"),
  css: { postcss: repo },
  plugins: [react()],
  resolve: {
    alias: [
      // Must precede the generic "@" alias or neither ever matches.
      { find: /^@\/integrations\/supabase\/client$/, replacement: path.join(import.meta.dirname, "supabase-stub.ts") },
      { find: /^@\/hooks\/useTenantContext$/, replacement: path.join(repo, "scripts/live-drive/harness/connections-mount/tenant-context-stub.ts") },
      { find: "@", replacement: path.join(repo, "src") },
    ],
  },
  define: {
    "import.meta.env.VITE_SUPABASE_URL": JSON.stringify("http://harness.invalid"),
    "import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY": JSON.stringify("harness-not-a-real-key"),
  },
  server: { host: "127.0.0.1", port: 5214, strictPort: true },
});
