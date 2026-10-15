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
      { find: "./useCatalogOffers", replacement: path.join(import.meta.dirname, "useCatalogOffers-stub.ts") },
      { find: "./useSoloCampaigns", replacement: path.join(import.meta.dirname, "useSoloCampaigns-stub.ts") },
      // Marketing › Overview reads campaign briefs, which needs the app's TenantProvider; reuse the
      // Marketing harness stub so the strip can mount.
      { find: "./useSoloCampaignBriefs", replacement: path.join(import.meta.dirname, "../marketing-mount/briefs-stub.ts") },
      { find: "@", replacement: path.join(repo, "src") },
    ],
  },
  define: {
    "import.meta.env.VITE_SUPABASE_URL": JSON.stringify("http://harness.invalid"),
    "import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY": JSON.stringify("harness-not-a-real-key"),
  },
  server: { host: "127.0.0.1", port: 5211, strictPort: true },
});
