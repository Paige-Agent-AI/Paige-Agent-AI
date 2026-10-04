import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";

// Renders the REAL Solo Marketing hub (src/solo/growth2.tsx) with only its network reads replaced.
const repo = path.resolve(import.meta.dirname, "../../../..");
const here = import.meta.dirname;

export default defineConfig({
  root: here,
  css: { postcss: repo },
  plugins: [react(), {
    // Marketing's Planned tabs read Supabase directly; point only that module at fixed rows.
    name: "planned-tabs-supabase",
    enforce: "pre",
    resolveId(source, importer) {
      if (importer?.endsWith("marketing-planned.tsx") && source.endsWith("integrations/supabase/client")) return path.join(here, "planned-supabase-stub.ts");
      return null;
    },
  }],
  resolve: {
    alias: [
      { find: "./useSoloCampaigns", replacement: path.join(here, "stubs.ts") },
      { find: "./useSoloCampaignBriefs", replacement: path.join(here, "briefs-stub.ts") },
      { find: "./useCatalogOffers", replacement: path.join(here, "../catalog-mount/useCatalogOffers-stub.ts") },
      { find: "@", replacement: path.join(repo, "src") },
    ],
  },
  define: {
    "import.meta.env.VITE_SUPABASE_URL": JSON.stringify("http://harness.invalid"),
    "import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY": JSON.stringify("harness-not-a-real-key"),
  },
  server: { host: "127.0.0.1", port: 5224, strictPort: true },
});
