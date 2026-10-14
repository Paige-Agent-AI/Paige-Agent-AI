import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
const repo = path.resolve(import.meta.dirname, "../../../..");
export default defineConfig({
  root: import.meta.dirname, css: { postcss: repo }, plugins: [react()],
  resolve: { alias: [
    { find: /^@\/integrations\/supabase\/client$/, replacement: path.join(import.meta.dirname, "supabase-stub.ts") },
    { find: /^@\/hooks\/useTenantContext$/, replacement: path.join(import.meta.dirname, "tenant-stub.ts") },
    { find: /^@\/lib\/voice\/VoiceDeviceProvider$/, replacement: path.join(import.meta.dirname, "voice-stub.ts") },
    { find: /^@\/components\/ui\/paige$/, replacement: path.join(import.meta.dirname, "presence-stub.ts") },
    { find: "@", replacement: path.join(repo, "src") },
  ] },
  define: { "import.meta.env.VITE_SUPABASE_URL": JSON.stringify("https://harness.invalid"), "import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY": JSON.stringify("fixture-only") },
  server: { host: "127.0.0.1", port: 8784, strictPort: true, headers: { "Content-Security-Policy": "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self' ws://127.0.0.1:8784; img-src 'self' data:; font-src 'self' data:; form-action 'none'" } },
});
