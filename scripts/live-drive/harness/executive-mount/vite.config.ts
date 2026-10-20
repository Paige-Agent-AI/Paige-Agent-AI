import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
const root = import.meta.dirname;
const repo = path.resolve(root, "../../../..");
const stubs = path.join(root, "stubs.tsx");
export default defineConfig({
  root, cacheDir: path.join(repo, "node_modules/.vite/harness-executive"), css: { postcss: repo }, plugins: [react()],
  resolve: { alias: [
    { find: /^@\/integrations\/supabase\/client$/, replacement: stubs },
    { find: /^@\/hooks\/useTenantContext$/, replacement: stubs },
    { find: /^@\/hooks\/useTierFeatures$/, replacement: stubs },
    { find: /^@\/components\/ui\/paige$/, replacement: stubs },
    { find: /^@\/components\/admin\/voice\/DialPadTrigger$/, replacement: stubs },
    { find: /^@\/components\/dashboard\/PaigeAIChat$/, replacement: stubs },
    { find: /^\.\/data\/(useBusinessReview|useSoloPendingActions|useSoloActivityFeed|useBusinessGamePlanMissions|useBusinessTimeZone)$/, replacement: stubs },
    { find: /^\.\/(SoloMindWorkspace|SoloSystemsCheckWorkspace|SoloGamePlanWorkspace|compass)$/, replacement: stubs },
    { find: "@", replacement: path.join(repo, "src") },
  ] },
  define: { "import.meta.env.VITE_SUPABASE_URL": JSON.stringify("https://harness.invalid"), "import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY": JSON.stringify("synthetic-not-a-key") },
  appType: "spa", server: { host: "127.0.0.1", port: 5231, strictPort: true },
});
