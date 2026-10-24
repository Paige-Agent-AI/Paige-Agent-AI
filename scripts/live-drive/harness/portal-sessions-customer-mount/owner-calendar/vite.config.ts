import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";

// E09 Slice 2, OWNER side — the Solo calendar's "New appointment" drawer with its client picker (the D1 seam
// that links a booking to a client so the client can see it in their portal). The REAL SoloCalendarWorkspace,
// useSoloCalendar, useSoloDealClients and solo-calendar.css render; only the Supabase transport and the tenant
// context are stubbed (stub.ts / tenant-stub.ts). Own root and port: never part of the app build (§9).
const repo = path.resolve(import.meta.dirname, "../../../../..");
export default defineConfig({
  root: import.meta.dirname,
  cacheDir: path.join(repo, "node_modules/.vite/harness-portal-sessions-owner-calendar"),
  css: { postcss: repo },
  plugins: [react()],
  resolve: {
    alias: [
      { find: /^@\/integrations\/supabase\/client$/, replacement: path.join(import.meta.dirname, "stub.ts") },
      { find: /^@\/hooks\/useTenantContext$/, replacement: path.join(import.meta.dirname, "tenant-stub.ts") },
      { find: "@", replacement: path.join(repo, "src") },
    ],
  },
  define: {
    "import.meta.env.VITE_SUPABASE_URL": JSON.stringify("http://harness.invalid"),
    "import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY": JSON.stringify("harness-not-a-real-key"),
  },
  appType: "spa",
  server: { host: "127.0.0.1", port: 5243, strictPort: true },
});
