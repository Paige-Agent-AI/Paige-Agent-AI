import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
// Run from the repo root: npx vite build --config docs/evidence/ui-delivery/assets/e04-merit-team-hub/harness/vite.config.mjs
const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "../../../../../..");
export default defineConfig({
  root: HERE,
  base: "/",
  publicDir: resolve(REPO, "public"),
  plugins: [react()],
  resolve: { alias: [
    { find: "@/components/admin/voice/DialPadTrigger", replacement: resolve(HERE, "src/unused-dial-pad.tsx") },
    { find: "@/integrations/supabase/client", replacement: resolve(HERE, "src/mock-supabase.ts") },
    { find: "@/hooks/useTenantContext", replacement: resolve(HERE, "src/mock-tenant.tsx") },
    { find: /^@\//, replacement: resolve(REPO, "src") + "/" },
  ] },
  build: { outDir: process.env.TEAM_HUB_HARNESS_DIST ?? resolve(REPO, "dist/e04-merit-team-hub"), emptyOutDir: true },
});
