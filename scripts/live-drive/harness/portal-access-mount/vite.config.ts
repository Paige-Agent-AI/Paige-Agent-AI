import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";

// E09 Slice 7 — the owner's "Portal access" card inside the REAL Solo client record
// (TenantRelationshipsClientsWorkspace, routeTier="solo"), and the customer's paused/ended page inside the
// REAL /app access gate (CustomerAccessGate → useClientPortalFrame). Only the data boundary is stubbed
// (stubs.ts): the session/tenant context, the People read, the role read and the Supabase transport, in the
// exact shapes the plan's server contract returns (read_client_portal_access, set_client_portal_access,
// client_portal_access_state, client_portal_frame). Its own root: never in the app build.
//   owner:    /solo/42/clients/people?person=<id>&state=joined|paused|ended|notjoined|loading|refused|error|
//             confirm-pause|confirm-end|confirm-restore|paused-done|changed|reinvite&theme=light|dark
//   customer: /app?surface=customer&state=paused|ended|midsession|paused-logo&theme=light|dark
//   panel:    /contact?surface=panel&state=joined|paused|ended|confirm-pause|confirm-end|confirm-restore — the
//             contact panel (inbox card rail, contact detail) on every tier customer_portal_invite reaches
//   invite:   /join/harness?surface=invite&state=paused|ended — the old invitation link after access changed
//   portal:   /solo/42/clients/portal?state=roster — the Portal dashboard rows (Access paused / Access ended)
// HARNESS_ACCESS_MUTANT=<name> (drive self-test only) injects harness-only defects; no product file is edited.
const repo = path.resolve(import.meta.dirname, "../../../..");
const stubs = path.join(import.meta.dirname, "stubs.ts");
const mutant = process.env.HARNESS_ACCESS_MUTANT ?? "";
export default defineConfig({
  root: import.meta.dirname,
  // The repo's own font files (public/fonts), so frames paint the real face with the network blocked.
  publicDir: path.join(repo, "public"),
  cacheDir: path.join(repo, `node_modules/.vite/harness-portal-access${mutant ? `-${mutant}` : ""}`),
  css: { postcss: repo },
  plugins: [
    react(),
    {
      name: "harness-access-mutant",
      enforce: "pre",
      transform(code, id) {
        if (!mutant) return null;
        const swap = (from: string, to: string) => {
          if (!code.includes(from)) throw new Error(`harness mutant ${mutant}: anchor not found: ${from}`);
          return code.replace(from, to);
        };
        // The real face withheld: every frame must then refuse itself (round 2, review 1).
        if (id.endsWith("/portal-access-mount/fonts.css") && mutant === "font") return "/* harness mutant: no @font-face */";
        if (id.endsWith("/client-portal-access.css")) {
          // Gold spent on Pause as well as Restore.
          if (mutant === "gold") return swap(`.trc-access-ink { border-color: transparent; background: var(--pg-ink);`, `.trc-access-ink { border-color: transparent; background: var(--pg-gold-fill);`);
          // The same stray gold as a GRADIENT fill (no background-color at all), like the shared gold Button.
          if (mutant === "gold-gradient") return swap(`.trc-access-ink { border-color: transparent; background: var(--pg-ink);`, `.trc-access-ink { border-color: transparent; background: var(--gradient-gold);`);
          if (mutant === "contrast") return swap(`.trc-access-heading p { margin: 0; max-width: 62ch; color: var(--pg-ink-2);`, `.trc-access-heading p { margin: 0; max-width: 62ch; color: color-mix(in srgb, var(--pg-ink-2) 30%, transparent);`);
          if (mutant === "target") return swap(`.trc-access-btn { display: inline-flex; min-height: 44px;`, `.trc-access-btn { display: inline-flex; min-height: 24px; height: 24px;`);
          if (mutant === "overflow") return swap(`.trc-access-facts dd { margin: 0;`, `.trc-access-facts dd { white-space: nowrap; min-width: 900px; margin: 0;`);
          return code;
        }
        if (id.endsWith("/ClientPortalAccess.tsx")) {
          // Success painted on the writer's acknowledgement alone (§70.1).
          if (mutant === "unconfirmed") return swap(`const fresh = await load();
      if (!alive.current) return;`, `const fresh = { ...seen, state: EXPECTED[action] } as OwnerPortalAccess;
      if (!alive.current) return;`);
        }
        if (id.endsWith("/CustomerAccessGate.tsx")) {
          // The platform shell shown to a paused customer.
          if (mutant === "shell") return swap(`if ((customer.phase === "paused" || customer.phase === "ended") && customer.access) {`, `if (false) {`);
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
  server: { host: "127.0.0.1", port: 5263, strictPort: true },
});
