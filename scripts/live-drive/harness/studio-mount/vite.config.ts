import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import tailwindcss from "tailwindcss";
import autoprefixer from "autoprefixer";

// Structural harness for the Solo Vibe Studio (home + one project in layout C). The Studio, its
// stage, publish panel, form settings and timeline are the real components; the Supabase client,
// the workspace context, the media jobs hook and the chat stream are stubbed. NOT the live app.
const repo = path.resolve(import.meta.dirname, "../../../..");
export default defineConfig({
  root: import.meta.dirname,
  // Tailwind's postcss plugin auto-resolves its config from process.cwd(); started from the
  // harness directory that resolution silently falls back to a default theme missing the
  // shadcn utilities (@apply border-border fails). Pin both plugins to the repo's config so
  // the harness serves identically from any cwd.
  css: {
    postcss: {
      plugins: [
        tailwindcss({ config: path.join(repo, "tailwind.config.ts") }),
        autoprefixer(),
      ],
    },
  },
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
