import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";

const repo = path.resolve(import.meta.dirname, "../../../..");

export default defineConfig({
  root: import.meta.dirname,
  css: { postcss: repo },
  plugins: [react()],
  resolve: {
    alias: [
      { find: /^@\/integrations\/supabase\/client$/, replacement: path.join(import.meta.dirname, "supabase-stub.ts") },
      { find: /^@\/lib\/auth\/resolveLandingRoute$/, replacement: path.join(import.meta.dirname, "landing-stub.ts") },
      { find: "@", replacement: path.join(repo, "src") },
    ],
  },
  // The drive maps tenant and hostile hostnames to loopback; the dev server must answer them.
  server: { host: "127.0.0.1", port: 5236, strictPort: true, allowedHosts: true },
});
