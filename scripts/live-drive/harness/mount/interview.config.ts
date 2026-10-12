// Extends the existing separate-root render harness. Never part of the app build.
import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
const repo = path.resolve(import.meta.dirname, "../../../..");
export default defineConfig({ root: import.meta.dirname, publicDir: path.join(repo, "public"), css: { postcss: repo }, plugins: [react()],
  optimizeDeps: { entries: ["interview.html"] },
  resolve: { alias: [
    { find: "./data/useSoloBusinessContext", replacement: path.join(import.meta.dirname, "interview.fixture.ts") },
    { find: "@/hooks/useTenantContext", replacement: path.join(import.meta.dirname, "interview.fixture.ts") },
    { find: "@/integrations/supabase/client", replacement: path.join(import.meta.dirname, "interview.fixture.ts") },
    { find: "@", replacement: path.join(repo, "src") },
  ] },
  define: { "import.meta.env.VITE_SUPABASE_URL": JSON.stringify("http://harness.invalid"), "import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY": JSON.stringify("synthetic-not-a-key") },
  server: { host: "127.0.0.1", port: 5204, strictPort: true },
});
