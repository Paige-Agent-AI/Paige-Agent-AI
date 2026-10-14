import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";

// E4-S3 — the Solo Trust Compass with its reads stubbed (stubs.ts). The component and the stylesheets
// are the real ones. Open /index.html?variant=limits|readonly&theme=light|dark.
const repo = path.resolve(import.meta.dirname, "../../../..");
const stubs = path.join(import.meta.dirname, "stubs.ts");
export default defineConfig({
  root: import.meta.dirname,
  css: { postcss: repo },
  plugins: [react()],
  resolve: {
    alias: [
      { find: "./data/useSoloToolGovernance", replacement: stubs },
      { find: "./data/useSoloTrust", replacement: stubs },
      { find: "./data/useSoloActivityFeed", replacement: stubs },
      { find: "./data/useSoloPendingActions", replacement: stubs },
      { find: /^@\/hooks\/usePaigeDeptStatus$/, replacement: stubs },
      { find: "@", replacement: path.join(repo, "src") },
    ],
  },
  define: {
    "import.meta.env.VITE_SUPABASE_URL": JSON.stringify("http://harness.invalid"),
    "import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY": JSON.stringify("harness-not-a-real-key"),
  },
  server: { host: "127.0.0.1", port: 5219, strictPort: true },
});
