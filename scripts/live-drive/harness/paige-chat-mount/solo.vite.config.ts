import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";

// C3a — the Solo PAIGE chat (`PaigeAIChat`) with its data hooks stubbed (solo-stubs.ts) and the
// network answered in-page by scripted SSE (solo-main.tsx). The chat, the status line, the cards and
// the stylesheets are the real ones. Open /solo.html.
const repo = path.resolve(import.meta.dirname, "../../../..");
const stubs = path.join(import.meta.dirname, "solo-stubs.ts");
export default defineConfig({
  root: import.meta.dirname,
  css: { postcss: repo },
  plugins: [react()],
  resolve: { alias: [
    { find: /^@\/integrations\/supabase\/client$/, replacement: stubs },
    { find: /^@\/hooks\/useTenantContext$/, replacement: stubs },
    { find: /^@\/hooks\/useScopedUserId$/, replacement: stubs },
    { find: /^@\/hooks\/usePaigeThreads$/, replacement: stubs },
    { find: /^@\/lib\/playbook$/, replacement: stubs },
    { find: "@", replacement: path.join(repo, "src") },
  ] },
  server: { host: "127.0.0.1", port: 5213, strictPort: true },
});
