import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";

const repo = path.resolve(import.meta.dirname, "../../../..");
export default defineConfig({
  root: import.meta.dirname,
  // Its own dependency cache: harnesses served side by side otherwise invalidate each other's bundles.
  cacheDir: path.join(repo, "node_modules/.vite/harness-people-contact-methods-mount"),
  css: { postcss: repo },
  plugins: [react()],
  resolve: { alias: [
    { find: /^@\/integrations\/supabase\/client$/, replacement: path.join(import.meta.dirname, "supabase-stub.ts") },
    { find: "@", replacement: path.join(repo, "src") },
  ] },
  server: { host: "127.0.0.1", port: 5214, strictPort: true },
});
