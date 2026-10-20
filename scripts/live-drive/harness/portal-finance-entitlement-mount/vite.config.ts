import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";

// E09 F2 — the customer portal Home (welcome, Getting Started, the real tile grid) inside the REAL customer chrome
// (AppNav with its NotificationBell), for a business that is NOT finance-entitled and one that IS. Only the data
// boundary is stubbed (stubs.ts) and the DashboardMode context. Its own root: never part of the app build (§9).
//   /app?business=fresh|funding-off|funding-on&theme=light|dark
const repo = path.resolve(import.meta.dirname, "../../../..");
const stubs = path.join(import.meta.dirname, "stubs.ts");
export default defineConfig({
  root: import.meta.dirname,
  cacheDir: path.join(repo, "node_modules/.vite/harness-portal-finance-entitlement-mount"),
  css: { postcss: repo },
  plugins: [react()],
  resolve: {
    alias: [
      { find: /^@\/integrations\/supabase\/client$/, replacement: stubs },
      { find: /^@\/contexts\/DashboardModeContext$/, replacement: stubs },
      // Not F2 surfaces: the Documents tile's glance and the activity feed read contracts this harness does not
      // model, so they render their quiet, empty forms here instead of "couldn't check".
      { find: /^@\/hooks\/usePortalDocumentsGlance$/, replacement: stubs },
      { find: /^@\/components\/app\/ClientActivityFeed$/, replacement: stubs },
      { find: "@", replacement: path.join(repo, "src") },
    ],
  },
  define: {
    "import.meta.env.VITE_SUPABASE_URL": JSON.stringify("http://harness.invalid"),
    "import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY": JSON.stringify("harness-not-a-real-key"),
  },
  appType: "spa",
  server: { host: "127.0.0.1", port: 5251, strictPort: true },
});
