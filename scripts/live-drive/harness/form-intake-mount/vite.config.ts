import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";

// Structural harness for a form's intake drawer (Growth → Catalog → a form → Details). The Catalog
// and the drawer are the real components; the campaigns read, the offers read and the Supabase
// client are stubbed. NOT the live app.
const repo = path.resolve(import.meta.dirname, "../../../..");
const catalog = path.join(repo, "scripts/live-drive/harness/catalog-mount");
export default defineConfig({
  root: import.meta.dirname,
  css: { postcss: repo },
  plugins: [react()],
  resolve: {
    alias: [
      { find: "./useCatalogOffers", replacement: path.join(catalog, "useCatalogOffers-stub.ts") },
      { find: "./useSoloCampaigns", replacement: path.join(import.meta.dirname, "useSoloCampaigns-stub.ts") },
      { find: /^@\/integrations\/supabase\/client$/, replacement: path.join(import.meta.dirname, "supabase-stub.ts") },
      { find: "@", replacement: path.join(repo, "src") },
    ],
  },
  server: { host: "127.0.0.1", port: 5215, strictPort: true },
});
