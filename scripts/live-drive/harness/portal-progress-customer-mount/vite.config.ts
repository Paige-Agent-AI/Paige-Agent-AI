import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";

// E09 Slice 3 — the CUSTOMER portal Progress page (/app/progress) rendered with the REAL Progress page
// inside the REAL customer chrome (AppNav) in AppShell's layout, plus the customer home's REAL tile grid.
// Only the data boundary is stubbed (stubs.ts): the Supabase transport (client_portal_progress,
// client_portal_self_profile + the paige_customer_actions read behind useMyActions, the brand/config
// reads, an empty client_portal_sessions for the home's Next session tile) and the DashboardMode
// context. useClientPortalProgress, usePortalProgressGlance, useMyActions, the brand/config readers,
// usePlaybook and NotificationBell are the real ones. Its own root: never part of the app build (§9).
//   /app/progress?state=populated|empty|alldone|loading|unavailable|multiple|error|hasmore&theme=light|dark
//   /app?state=home|home-empty|home-error&theme=light|dark
// HARNESS_PROGRESS_MUTANT=<name> (drive self-test only) swaps in harness-only CSS/markup defects through
// a transform (Progress.tsx, and EmptyTile.tsx for `tiletarget`); no product file is edited. See progress-drive.mjs --selftest.
const repo = path.resolve(import.meta.dirname, "../../../..");
const stubs = path.join(import.meta.dirname, "stubs.ts");
const mutant = process.env.HARNESS_PROGRESS_MUTANT ?? "";
export default defineConfig({
  root: import.meta.dirname,
  cacheDir: path.join(repo, `node_modules/.vite/harness-portal-progress-customer-mount${mutant ? `-${mutant}` : ""}`),
  css: { postcss: repo },
  plugins: [
    react(),
    {
      // Defects for the drive's own negative controls, injected into the served module only.
      name: "harness-progress-mutant",
      enforce: "pre",
      transform(code, id) {
        if (!mutant) return null;
        const swap = (from: string, to: string) => {
          if (!code.includes(from)) throw new Error(`harness mutant ${mutant}: anchor not found: ${from}`);
          return code.replace(from, to);
        };
        // The empty "Your next steps" tile's button without its invisible 44px extension (EmptyTile, P2-4).
        if (id.endsWith("/src/components/client/EmptyTile.tsx")) {
          return mutant === "tiletarget" ? swap(`after:absolute after:inset-x-0 after:-inset-y-1 after:content-['']`, ``) : null;
        }
        if (!id.endsWith("/src/pages/app/Progress.tsx")) return null;
        if (mutant === "tiletarget") return null;
        if (mutant === "gold") return swap(`"border-transparent bg-primary/10 text-foreground"`, `"border-accent bg-accent text-accent-foreground"`);
        if (mutant === "contrast") return swap(`<p className="mt-0.5 text-sm">`, `<p className="mt-0.5 text-sm opacity-40">`);
        // The headline back to round 1: no Next up block above the full list (P1-1).
        if (mutant === "nextup") return swap(`{nextUp.length > 0 && (`, `{false && nextUp.length > 0 && (`);
        if (mutant === "overflow") return swap(`<header className="space-y-1 pb-4">`, `<header className="space-y-1 pb-4"><div aria-hidden="true" style={{ width: 1600, height: 1 }} />`);
        if (mutant === "target") return swap(`const LINK_BUTTON = \`inline-flex min-h-[44px]`, `const LINK_BUTTON = \`inline-flex h-7`);
        if (mutant === "clip") return swap(`<Title className={\`break-words [text-wrap:pretty]`, `<Title className={\`truncate`);
        if (mutant === "complete") return swap(`{showState && <StatePill state={item.state} />}`, `{showState && <><StatePill state={item.state} /><button type="button">Mark done</button></>}`);
        throw new Error(`unknown harness mutant ${mutant}`);
      },
    },
  ],
  resolve: {
    alias: [
      { find: /^@\/integrations\/supabase\/client$/, replacement: stubs },
      { find: /^@\/contexts\/DashboardModeContext$/, replacement: stubs },
      { find: "@", replacement: path.join(repo, "src") },
    ],
  },
  define: {
    "import.meta.env.VITE_SUPABASE_URL": JSON.stringify("http://harness.invalid"),
    "import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY": JSON.stringify("harness-not-a-real-key"),
  },
  appType: "spa",
  server: { host: "127.0.0.1", port: 5244, strictPort: true },
});
