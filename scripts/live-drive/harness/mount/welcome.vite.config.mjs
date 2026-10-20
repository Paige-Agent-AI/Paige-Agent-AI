import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "node:path";
import { fileURLToPath } from "node:url";
const mount = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(mount, "../../../..");
const fixture = path.join(mount, "welcome.fixture.ts");
export default defineConfig({
  root: mount, publicDir: path.join(repo, "public"), plugins: [react()],
  optimizeDeps: { entries: ["welcome.html"] },
  resolve: { alias: [
    { find: "@/integrations/supabase/client", replacement: fixture },
    { find: "@/hooks/useTenantContext", replacement: fixture },
    { find: "@", replacement: path.join(repo, "src") },
  ] },
  css: { postcss: repo },
  server: { host: "127.0.0.1", port: 5205, strictPort: true, fs: { allow: [repo] } },
});
