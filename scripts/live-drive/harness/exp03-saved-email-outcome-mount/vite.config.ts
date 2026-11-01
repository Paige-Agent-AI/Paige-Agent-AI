// Derived fixture only. Original mount/default fixtures unchanged.
import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";

// EXP03 O12 piece 3 — the email reply's inline check in the BUSINESS OWNER's canonical inbox (the REAL
// ClientsConversations) as the REAL Solo Clients workspace mounts it (TenantRelationshipsClientsWorkspace,
// routeTier="solo", /solo/42/clients/conversations), inside the real Solo shell CSS and pg tokens. Pattern copied
// from exp03-scheduled-send-mount. Only the data boundary is stubbed (stubs.ts): the session/tenant context, the
// role read, the relationship data hook and the Supabase transport (including comms-email-command, answered in the
// door's own shapes). The composer, the check strip, useGovernedEmailReply and classifyDoorAnswer run as shipped.
// Its own root: never part of the app build (§9).
//   /solo/42/clients/conversations?door=…&theme=light|dark&paige=open|closed
const repo = path.resolve(import.meta.dirname, "../../../..");
const stubs = path.join(import.meta.dirname, "stubs.ts");
export default defineConfig({
  root: import.meta.dirname,
  publicDir: path.join(repo, "public"),
  cacheDir: path.join(repo, "node_modules/.vite/harness-exp03-saved-email-outcome-mount"),
  css: { postcss: repo },
  plugins: [react()],
  resolve: {
    alias: [
      { find: /^@\/integrations\/supabase\/client$/, replacement: stubs },
      { find: /^@\/hooks\/useTenantContext$/, replacement: stubs },
      { find: /^@\/hooks\/useUserRoles$/, replacement: stubs },
      { find: /^\.\/useTenantRelationshipsData$/, replacement: stubs },
      { find: "@", replacement: path.join(repo, "src") },
    ],
  },
  define: {
    "import.meta.env.VITE_SUPABASE_URL": JSON.stringify("http://harness.invalid"),
    "import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY": JSON.stringify("harness-not-a-real-key"),
  },
  appType: "spa",
  server: { host: "127.0.0.1", port: 5227, strictPort: true, fs: { allow: [repo] } },
});
