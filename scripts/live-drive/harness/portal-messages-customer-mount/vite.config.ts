import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";

// E09 Slice 1 — the CUSTOMER portal conversation (/app/messages, and ?topic=help for "Contact your team")
// rendered with the REAL Messages page inside the REAL customer chrome (AppNav) in AppShell's layout.
// Only the data boundary is stubbed (stubs.ts): the Supabase transport and the DashboardMode context.
// The hooks (useClientPortalMessages, brand/config readers, usePlaybook, NotificationBell) are the real
// ones. Its own root: never part of the app build (§9).
//   /app/messages?state=populated|empty|help|sending|failed|error|norelationship|multiple|loading&theme=light|dark
const repo = path.resolve(import.meta.dirname, "../../../..");
const stubs = path.join(import.meta.dirname, "stubs.ts");
export default defineConfig({
  root: import.meta.dirname,
  cacheDir: path.join(repo, "node_modules/.vite/harness-portal-messages-customer-mount"),
  css: { postcss: repo },
  plugins: [react()],
  resolve: {
    alias: [
      { find: /^@\/integrations\/supabase\/client$/, replacement: stubs },
      { find: /^@\/contexts\/DashboardModeContext$/, replacement: stubs },
      { find: "@", replacement: path.join(repo, "src") },
    ],
  },
  define: {
    "import.meta.env.VITE_SUPABASE_URL": JSON.stringify("http://harness.invalid"),
    "import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY": JSON.stringify("harness-not-a-real-key"),
  },
  appType: "spa",
  server: { host: "127.0.0.1", port: 5241, strictPort: true },
});
