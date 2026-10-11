import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";

// Renders the REAL Solo tenant shell around the REAL Ads department, with only network reads replaced.
const marketing = path.resolve(import.meta.dirname, "../marketing-mount");
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
      if ((importer?.endsWith("marketing-planned.tsx") || importer?.endsWith("marketing-content.tsx") || importer?.endsWith("marketing-ads.tsx") || importer?.endsWith("marketing-audience.tsx")) && source.endsWith("integrations/supabase/client")) return path.join(marketing, "planned-supabase-stub.ts");
      if ((importer?.endsWith("marketing-email.tsx") || importer?.endsWith("marketing-email-editor.tsx") || importer?.endsWith("marketing-email-series.tsx") || importer?.endsWith("marketing-analytics-email.ts")) && source.endsWith("integrations/supabase/client")) return path.join(marketing, "email-supabase-stub.ts");
      return null;
    },
  }],
  resolve: {
    alias: [
      { find: "./useSoloCampaigns", replacement: path.join(marketing, "stubs.ts") },
      { find: "./useSoloCampaignBriefs", replacement: path.join(marketing, "briefs-stub.ts") },
      { find: "./useCatalogOffers", replacement: path.join(marketing, "../catalog-mount/useCatalogOffers-stub.ts") },
      { find: /^\.\/useFormIntake$/, replacement: path.join(marketing, "form-intake-stub.ts") },
      { find: "@/components/ui/paige", replacement: path.join(here, "stubs.tsx") },
      { find: "@/components/admin/voice/DialPadTrigger", replacement: path.join(here, "stubs.tsx") },
      { find: "@", replacement: path.join(repo, "src") },
    ],
  },
  define: {
    "import.meta.env.VITE_SUPABASE_URL": JSON.stringify("http://harness.invalid"),
    "import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY": JSON.stringify("harness-not-a-real-key"),
  },
  server: { host: "127.0.0.1", port: 5225, strictPort: true },
});
