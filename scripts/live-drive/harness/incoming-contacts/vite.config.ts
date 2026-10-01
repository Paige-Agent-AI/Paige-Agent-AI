import path from "node:path";
import base from "../settings-mount/vite.config";

// Reuse the real Settings + tenant shell + PAIGE mount without editing its other lane's files.
// Only transport and caller context are synthetic. This configuration is not in the app build.
export default {
  ...base,
  resolve: { ...base.resolve, alias: [
    { find: /^@\/integrations\/supabase\/client$/, replacement: path.join(import.meta.dirname, "supabase-stub.ts") },
    { find: /^@\/hooks\/useTenantContext$/, replacement: path.join(import.meta.dirname, "tenant-context-stub.ts") },
    ...(Array.isArray(base.resolve?.alias) ? base.resolve.alias : []).filter(entry =>
      !String(entry.find).includes("supabase") && !String(entry.find).includes("useTenantContext")),
  ] },
  define: { ...base.define, "import.meta.env.VITE_SUPABASE_URL": JSON.stringify("http://127.0.0.1") },
  server: { ...base.server, host: "127.0.0.1", strictPort: true },
};
