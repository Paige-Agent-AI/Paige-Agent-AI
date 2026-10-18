import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";

// E09 Slice 6 — "How {client} can be reached" inside the REAL Solo Clients workspace and client record
// (TenantRelationshipsClientsWorkspace, routeTier="solo"), mounted exactly as owner-shared-work mounts it (same
// aliases, same shell classes, same Slice 3 stubs for everything above the new section). Only the data boundary
// is stubbed (stubs.ts). Its own root: never in the app build.
//   /solo/42/clients/people?person=<id>&consent=mixed|paused|defaults|refused|error|loading&theme=light|dark
// HARNESS_REACH_MUTANT=<name> (drive self-test only) injects harness-only defects through a transform; no product
// file is edited. See reach-drive.mjs --selftest.
const repo = path.resolve(import.meta.dirname, "../../../..");
const stubs = path.join(import.meta.dirname, "stubs.ts");
const mutant = process.env.HARNESS_REACH_MUTANT ?? "";
export default defineConfig({
  root: import.meta.dirname,
  cacheDir: path.join(repo, `node_modules/.vite/harness-owner-consent-view${mutant ? `-${mutant}` : ""}`),
  css: { postcss: repo },
  plugins: [
    react(),
    {
      name: "harness-reach-mutant",
      enforce: "pre",
      transform(code, id) {
        if (!mutant) return null;
        const swap = (from: string, to: string) => {
          if (!code.includes(from)) throw new Error(`harness mutant ${mutant}: anchor not found: ${from}`);
          return code.replace(from, to);
        };
        if (id.endsWith("/client-communication-state.css")) {
          if (mutant === "gold") return swap(`.trc-reach-value svg { flex: none; width: 15px; height: 15px; margin-top: 2px; color: var(--pg-warning); }`, `.trc-reach-value { color: var(--pg-gold-fill) !important; } .trc-reach-value svg { color: var(--pg-gold-fill); }`);
          if (mutant === "contrast") return swap(`.trc-reach-by { color: var(--pg-muted);`, `.trc-reach-by { color: color-mix(in srgb, var(--pg-muted) 30%, transparent);`);
          if (mutant === "target") return swap(`.trc-reach .trc-reach-refresh, .trc-reach .trc-reach-quiet { display: inline-flex; width: max-content; min-height: 44px; min-width: 44px;`, `.trc-reach .trc-reach-refresh, .trc-reach .trc-reach-quiet { display: inline-flex; width: max-content; min-height: 20px; min-width: 20px;`);
          if (mutant === "overflow") return swap(`.trc-reach-value { display: inline-flex;`, `.trc-reach-value { white-space: nowrap; min-width: 900px; display: inline-flex;`);
          return code;
        }
        if (id.endsWith("/ClientCommunicationState.tsx") && mutant === "writable") {
          return swap(`<span className="trc-reach-value">`, `<input type="checkbox" aria-label="toggle" /><span className="trc-reach-value">`);
        }
        return null;
      },
    },
  ],
  resolve: {
    alias: [
      { find: /^@\/integrations\/supabase\/client$/, replacement: stubs },
      { find: /^@\/hooks\/useTenantContext$/, replacement: stubs },
      { find: /^@\/hooks\/useUserRoles$/, replacement: stubs },
      { find: /^\.\/useTenantRelationshipsData$/, replacement: stubs },
      { find: "@", replacement: path.join(repo, "src") },
    ],
  },
  define: {
    "import.meta.env.VITE_SUPABASE_URL": JSON.stringify("http://harness.invalid"),
    "import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY": JSON.stringify("harness-not-a-real-key"),
  },
  appType: "spa",
  server: { host: "127.0.0.1", port: 5362, strictPort: true },
});
