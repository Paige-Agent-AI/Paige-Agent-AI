import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "../../../../../..");
export default defineConfig({
  root: HERE, base: "/", publicDir: resolve(REPO, "public"), plugins: [react()],
  css: { postcss: resolve(REPO, "postcss.config.js") },
  resolve: { alias: [
    { find: "@/integrations/supabase/client", replacement: resolve(HERE, "src/mock-supabase.ts") },
    { find: "@/hooks/useTenantContext", replacement: resolve(HERE, "src/mock-tenant.ts") },
    { find: /^@\//, replacement: resolve(REPO, "src") + "/" },
  ] },
  build: { outDir: process.env.SETTINGS_TEAM_HARNESS_DIST ?? "/tmp/settings-team-harness-dist", emptyOutDir: true },
});
