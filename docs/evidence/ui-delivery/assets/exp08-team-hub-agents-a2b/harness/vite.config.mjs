import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
// EXP08 Team Hub agents A2b harness (copied from A2's). Run from the repo root:
//   npx vite --config docs/evidence/ui-delivery/assets/exp08-team-hub-agents-a2b/harness/vite.config.mjs --host 127.0.0.1 --port 4793
// Only the Supabase transport and the tenant context are substituted; every Team Hub module is the real one.
const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "../../../../../..");
export default defineConfig({
  root: HERE,
  base: "/",
  publicDir: resolve(REPO, "public"),
  plugins: [react()],
  server: { host: "127.0.0.1", port: 4793, strictPort: true },
  resolve: { alias: [
    { find: "@/integrations/supabase/client", replacement: resolve(HERE, "src/mock-supabase.ts") },
    { find: "@/hooks/useTenantContext", replacement: resolve(HERE, "src/mock-tenant.ts") },
    { find: /^@\//, replacement: resolve(REPO, "src") + "/" },
  ] },
  build: { outDir: process.env.TEAM_HUB_HARNESS_DIST ?? "/tmp/team-hub-a2b-harness-dist", emptyOutDir: true },
});
