/**
 * Vite config for the Team Hub real-shell mount — its own root, so this unauthenticated dev mount can never
 * enter the app build (§9). Two seams aliased and no others: the Supabase transport and the tenant context.
 */
import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";

const repo = path.resolve(import.meta.dirname, "../../../..");
export default defineConfig({
  root: import.meta.dirname,
  publicDir: path.join(repo, "public"),
  cacheDir: process.env.HARNESS_CACHE_DIR ?? path.join(repo, "node_modules/.vite/harness-team-hub-shell"),
  css: { postcss: repo },
  plugins: [react()],
  appType: "spa",
  resolve: {
    alias: [
      { find: /^@\/integrations\/supabase\/client$/, replacement: path.join(import.meta.dirname, "supabase-stub.ts") },
      { find: /^@\/hooks\/useTenantContext$/, replacement: path.join(import.meta.dirname, "tenant-context-stub.ts") },
      { find: "@", replacement: path.join(repo, "src") },
    ],
  },
  define: {
    "import.meta.env.VITE_SUPABASE_URL": JSON.stringify("http://harness.invalid"),
    "import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY": JSON.stringify("harness-not-a-real-key"),
  },
  server: { host: "127.0.0.1", port: 5297, strictPort: true },
});
