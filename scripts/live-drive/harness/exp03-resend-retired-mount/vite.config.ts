import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";

// EXP03 (Resend retired) — the BUSINESS OWNER's canonical inbox (the REAL ClientsConversations) as the REAL
// Solo Clients workspace mounts it (TenantRelationshipsClientsWorkspace, routeTier="solo",
// /solo/42/clients/conversations), inside the real Solo shell CSS and pg tokens. Pattern copied from
// e09-portal-owner-inbox-mount. Only the data boundary is stubbed (stubs.ts): the session/tenant context,
// the role read, the relationship data hook and the Supabase transport — the inbox's own parsing
// (readSendResult, isUnconfirmedMessage, GOVERNED_SEND_COPY) runs as shipped. Its own root: never part of
// the app build (§9).
//   /solo/42/clients/conversations?state=thread|approve&theme=light|dark&paige=open|closed
const repo = path.resolve(import.meta.dirname, "../../../..");
const stubs = path.join(import.meta.dirname, "stubs.ts");
export default defineConfig({
  root: import.meta.dirname,
  publicDir: path.join(repo, "public"),
  cacheDir: path.join(repo, "node_modules/.vite/harness-exp03-resend-retired-mount"),
  css: { postcss: repo },
  plugins: [react()],
  resolve: {
    alias: [
      { find: /^@\/integrations\/supabase\/client$/, replacement: stubs },
      { find: /^@\/hooks\/useTenantContext$/, replacement: stubs },
      { find: /^@\/hooks\/useUserRoles$/, replacement: stubs },
      { find: /^\.\/useTenantRelationshipsData$/, replacement: stubs },
      // Negative control (§71.4): EXP03_BASE_SRC points the INBOX module (and, through its relative imports, its
      // conversations/* helpers) at another checkout's src — the base commit, where an unconfirmed email still read
      // "Failed". Everything else stays this tree's src. Unset, the harness renders this tree.
      ...(process.env.EXP03_BASE_SRC ? [{ find: /^@\/pages\/admin\/ClientsConversations$/, replacement: path.join(process.env.EXP03_BASE_SRC, "pages/admin/ClientsConversations.tsx") }] : []),
      { find: "@", replacement: path.join(repo, "src") },
    ],
  },
  define: {
    "import.meta.env.VITE_SUPABASE_URL": JSON.stringify("http://harness.invalid"),
    "import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY": JSON.stringify("harness-not-a-real-key"),
  },
  appType: "spa",
  server: { host: "127.0.0.1", port: 5199, strictPort: true, fs: { allow: [repo, ...(process.env.EXP03_BASE_SRC ? [path.dirname(process.env.EXP03_BASE_SRC)] : [])] } },
});
