import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
const root = import.meta.dirname;
const harnessRepo = path.resolve(root, "../../../..");
const slice = process.env.E2_HARNESS_SLICE ?? "finance";
if (!["targets", "vera", "finance", "catalogue"].includes(slice)) throw Error("Unknown E02 harness slice");
const repo = slice === "finance" || slice === "catalogue" ? harnessRepo : path.resolve(harnessRepo, "../e2-" + slice);
const stubs = path.join(root, "stubs.tsx");
export default defineConfig({
  root, publicDir: path.join(repo, "public"), cacheDir: path.join(harnessRepo, "node_modules/.vite/harness-executive-" + slice), css: { postcss: repo }, plugins: [react()],
  resolve: { alias: [
    { find: /^@\/integrations\/supabase\/client$/, replacement: stubs },
    { find: /^@\/hooks\/useTenantContext$/, replacement: stubs },
    { find: /^@\/hooks\/useTierFeatures$/, replacement: stubs },
    { find: /^@\/components\/ui\/paige$/, replacement: stubs },
    { find: /^@\/components\/admin\/voice\/DialPadTrigger$/, replacement: stubs },
    { find: /^@\/components\/dashboard\/PaigeAIChat$/, replacement: stubs },
    { find: /^\.\/data\/(useBusinessReview|useSoloPendingActions|useSoloActivityFeed|useBusinessGamePlanMissions|useBusinessTimeZone|useSoloSkills)$/, replacement: stubs },
    { find: /^\.\/(SoloMindWorkspace|SoloSystemsCheckWorkspace|SoloGamePlanWorkspace|compass)$/, replacement: stubs },
    { find: "@", replacement: path.join(repo, "src") },
  ] },
  define: { "import.meta.env.E2_HARNESS_SLICE": JSON.stringify(slice), "import.meta.env.VITE_SUPABASE_URL": JSON.stringify("https://harness.invalid"), "import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY": JSON.stringify("synthetic-not-a-key") },
  appType: "spa", server: { host: "127.0.0.1", port: 5231, strictPort: true, fs: { allow: [repo, harnessRepo] } },
});
