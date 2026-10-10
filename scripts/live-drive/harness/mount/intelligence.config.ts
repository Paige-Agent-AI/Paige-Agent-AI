/** Separate local root: synthetic adapter is excluded from the production build. */
import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
const repo = path.resolve(import.meta.dirname, "../../../..");
export default defineConfig({
  root: import.meta.dirname, publicDir: path.join(repo, "public"), css: { postcss: repo }, plugins: [react()],
  resolve: { alias: [
    { find: "@/operator/data/useIntelligence", replacement: path.join(import.meta.dirname, "intelligence.fixture.ts") },
    { find: "@", replacement: path.join(repo, "src") },
  ] },
  define: {
    "import.meta.env.VITE_SUPABASE_URL": JSON.stringify("http://harness.invalid"),
    "import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY": JSON.stringify("harness-not-a-real-key"),
  },
  server: { host: "127.0.0.1", port: 5201, strictPort: true },
});
