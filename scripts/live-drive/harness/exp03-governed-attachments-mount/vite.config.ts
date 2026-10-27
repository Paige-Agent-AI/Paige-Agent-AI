import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";

// EXP03 governed attachments — the REAL Solo PAIGE chat (`PaigeAIChat` with soloTenantSafety, as the tenant
// shell's PAIGE dock mounts it) answering one request with the email approval card the server writes for
// comms_send_email, carrying 0, 1, 3 or 10 files (main.tsx). Pattern copied from paige-chat-mount (solo.*):
// only the data hooks are stubbed (stubs.ts) and the network is answered in-page by scripted SSE frames; the
// chat, PaigeConfirmCard, confirmPreview's parser + formatFileSize and the stylesheets are real. Its own root:
// never part of the app build (§9).
//   /?files=0|1|3|10&theme=light|dark
const repo = path.resolve(import.meta.dirname, "../../../..");
const stubs = path.join(import.meta.dirname, "stubs.ts");
export default defineConfig({
  root: import.meta.dirname,
  publicDir: path.join(repo, "public"),
  css: { postcss: repo },
  plugins: [react()],
  resolve: { alias: [
    { find: /^@\/integrations\/supabase\/client$/, replacement: stubs },
    { find: /^@\/hooks\/useTenantContext$/, replacement: stubs },
    { find: /^@\/hooks\/useScopedUserId$/, replacement: stubs },
    { find: /^@\/hooks\/usePaigeThreads$/, replacement: stubs },
    { find: /^@\/hooks\/useChatDocumentUpload$/, replacement: stubs },
    { find: /^@\/lib\/playbook$/, replacement: stubs },
    { find: "@", replacement: path.join(repo, "src") },
  ] },
  appType: "spa",
  server: { host: "127.0.0.1", port: 5197, strictPort: true, fs: { allow: [repo] } },
});
