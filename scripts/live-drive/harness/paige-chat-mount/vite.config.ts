import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";

// The client portal's chat (`PaigeChat`, mounted by AppShell on /app) with its data hooks stubbed and
// the network answered in-page (main.tsx). The component, its children and the stylesheets are real.
const repo = path.resolve(import.meta.dirname, "../../../..");
export default defineConfig({
  root: import.meta.dirname,
  css: { postcss: repo },
  plugins: [react()],
  resolve: { alias: [
    { find: /^@\/integrations\/supabase\/client$/, replacement: path.join(import.meta.dirname, "stubs.ts") },
    { find: /^@\/hooks\/usePaigeMemory$/, replacement: path.join(import.meta.dirname, "stubs.ts") },
    { find: /^@\/hooks\/useChatDocumentUpload$/, replacement: path.join(import.meta.dirname, "stubs.ts") },
    { find: /^@\/hooks\/useClientChatContext$/, replacement: path.join(import.meta.dirname, "stubs.ts") },
    { find: /^@\/hooks\/useProfileSnapshot$/, replacement: path.join(import.meta.dirname, "stubs.ts") },
    { find: /^@\/hooks\/useClientPortalBrand$/, replacement: path.join(import.meta.dirname, "stubs.ts") },
    { find: /^@\/hooks\/useAnalytics$/, replacement: path.join(import.meta.dirname, "stubs.ts") },
    { find: /^@\/hooks\/useBeforeUnloadGuard$/, replacement: path.join(import.meta.dirname, "stubs.ts") },
    { find: /^@\/lib\/playbook$/, replacement: path.join(import.meta.dirname, "stubs.ts") },
    { find: "@", replacement: path.join(repo, "src") },
  ] },
  server: { host: "127.0.0.1", port: 5212, strictPort: true },
});
