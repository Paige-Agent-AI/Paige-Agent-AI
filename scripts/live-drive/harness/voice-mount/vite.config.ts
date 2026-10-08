/**
 * Vite config for the voice-readiness harness mount — SEPARATE from the app's,
 * so a dev-only unauthenticated mount of the dialer can never reach production
 * (§9). Its own `root` keeps this entry out of the app's build graph. The
 * tenant-context stub is the SAME FILE the other mounts alias (§18).
 */
import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";

const repo = path.resolve(import.meta.dirname, "../../../..");
const shared = path.resolve(import.meta.dirname, "../connections-mount");

export default defineConfig({
  root: import.meta.dirname,
  css: { postcss: repo },
  plugins: [react()],
  resolve: {
    alias: [
      // Must precede the generic "@" alias or neither ever matches.
      { find: /^@\/integrations\/supabase\/client$/, replacement: path.join(import.meta.dirname, "supabase-voice-stub.ts") },
      { find: /^@\/hooks\/useTenantContext$/, replacement: path.join(shared, "tenant-context-stub.ts") },
      { find: "@", replacement: path.join(repo, "src") },
    ],
  },
  define: {
    "import.meta.env.VITE_SUPABASE_URL": JSON.stringify("http://harness.invalid"),
    "import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY": JSON.stringify("harness-not-a-real-key"),
  },
  server: { host: "127.0.0.1", port: 5217, strictPort: true },
});
