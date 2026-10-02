import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";

const repo = path.resolve(import.meta.dirname, "../../../..");

export default defineConfig({
  root: import.meta.dirname,
  css: { postcss: repo },
  plugins: [react()],
  resolve: {
    alias: [
      { find: "./useSoloSalesOps", replacement: path.join(import.meta.dirname, "useSoloSalesOps-stub.ts") },
      { find: "./useSoloCommercialTerms", replacement: path.join(import.meta.dirname, "useSoloCommercialTerms-stub.ts") },
      { find: "./useSoloAgreementSignings", replacement: path.join(import.meta.dirname, "useSoloAgreementSignings-stub.ts") },
      { find: "./useCatalogOffers", replacement: path.join(import.meta.dirname, "useCatalogOffers-stub.ts") },
      { find: "./useSoloCampaigns", replacement: path.join(import.meta.dirname, "useSoloCampaigns-stub.ts") },
      // MORE SPECIFIC THAN "@" AND THEREFORE ABOVE IT — Vite takes the first matching alias.
      { find: "@/hooks/useTierFeatures", replacement: path.join(import.meta.dirname, "useTierFeatures-stub.ts") },
      { find: "@", replacement: path.join(repo, "src") },
    ],
  },
  define: {
    "import.meta.env.VITE_SUPABASE_URL": JSON.stringify("http://harness.invalid"),
    "import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY": JSON.stringify("harness-not-a-real-key"),
  },
  server: { host: "127.0.0.1", port: 5213, strictPort: true },
});
