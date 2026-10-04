import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";

// Structural harness for the Solo Vibe Studio (home + one project in layout C). The Studio, its
// stage, publish panel, form settings and timeline are the real components; the Supabase client,
// the workspace context, the media jobs hook and the chat stream are stubbed. NOT the live app.
const repo = path.resolve(import.meta.dirname, "../../../..");
export default defineConfig({
  root: import.meta.dirname,
  css: { postcss: repo },
  plugins: [react()],
  resolve: {
    alias: [
      { find: /^@\/integrations\/supabase\/client$/, replacement: path.join(import.meta.dirname, "supabase-stub.ts") },
      { find: /^@\/hooks\/useTenantContext$/, replacement: path.join(import.meta.dirname, "tenant-stub.ts") },
      { find: /^\.\.\/useMediaJobs$/, replacement: path.join(import.meta.dirname, "media-stub.ts") },
      { find: /^\.\/useMediaJobs$/, replacement: path.join(import.meta.dirname, "media-stub.ts") },
      { find: "@", replacement: path.join(repo, "src") },
    ],
  },
  define: { "import.meta.env.VITE_SUPABASE_URL": JSON.stringify("https://harness.invalid") },
  // STUDIO_HARNESS_PORT lets two worktrees drive the harness at once without one hitting the other.
  server: { host: "127.0.0.1", port: Number(process.env.STUDIO_HARNESS_PORT) || 5216, strictPort: true },
});
