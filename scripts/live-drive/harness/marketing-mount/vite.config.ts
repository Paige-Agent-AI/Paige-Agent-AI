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
      if ((importer?.endsWith("marketing-planned.tsx") || importer?.endsWith("marketing-content.tsx") || importer?.endsWith("marketing-ads.tsx") || importer?.endsWith("marketing-audience.tsx")) && source.endsWith("integrations/supabase/client")) return path.join(here, "planned-supabase-stub.ts");
      if ((importer?.endsWith("marketing-email.tsx") || importer?.endsWith("marketing-email-editor.tsx") || importer?.endsWith("marketing-email-series.tsx") || importer?.endsWith("marketing-analytics-email.ts")) && source.endsWith("integrations/supabase/client")) return path.join(here, "email-supabase-stub.ts");
      if (importer?.endsWith("useCampaignAssets.ts") && source.endsWith("integrations/supabase/client")) return path.join(here, "assets-supabase-stub.ts");
      if (importer?.endsWith("marketing-analytics-metrics.ts") && source.endsWith("integrations/supabase/client")) return path.join(here, "metrics-supabase-stub.ts");
      return null;
    },
  }],
  resolve: {
    alias: [
      { find: "./useSoloCampaigns", replacement: path.join(here, "stubs.ts") },
      { find: "./useSoloCampaignBriefs", replacement: path.join(here, "briefs-stub.ts") },
      { find: "./useCatalogOffers", replacement: path.join(here, "../catalog-mount/useCatalogOffers-stub.ts") },
      { find: /^\.\/useFormIntake$/, replacement: path.join(here, "form-intake-stub.ts") },
      { find: "@", replacement: path.join(repo, "src") },
    ],
  },
  define: {
    "import.meta.env.VITE_SUPABASE_URL": JSON.stringify("http://harness.invalid"),
    "import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY": JSON.stringify("harness-not-a-real-key"),
  },
  server: { host: "127.0.0.1", port: 5224, strictPort: true },
});
