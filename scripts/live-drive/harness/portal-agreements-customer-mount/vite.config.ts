import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";

// E09 Slice A — the CUSTOMER portal Agreements page (/app/agreements) rendered with the REAL Agreements page inside the
// REAL customer chrome (AppNav) in AppShell's layout, the customer home's REAL tile grid (for the agreements line), the
// REAL MyAgreements (the platform-terms fallback and /app/agreements/platform) and the REAL, FROZEN signing page
// (/sign/:token, §28). Only the data boundary is stubbed (stubs.ts): the Supabase transport and the DashboardMode
// context. Its own root: never part of the app build (§9).
//   /app/agreements?state=mixed|waiting|signed|empty|loading|staff|staff-error|multiple|error&open=ok|here|later|fail|pending&copy=ok|fail|pending&theme=light|dark
//   /app?state=home|home-none&theme=…    /app/agreements/platform?theme=…    /sign/<token>?theme=…
// HARNESS_AGREEMENTS_MUTANT=<name> (drive self-test only) swaps in harness-only defects through a transform on
// Agreements.tsx; no product file is edited. See agreements-drive.mjs --selftest.
const repo = path.resolve(import.meta.dirname, "../../../..");
const stubs = path.join(import.meta.dirname, "stubs.ts");
const mutant = process.env.HARNESS_AGREEMENTS_MUTANT ?? "";
export default defineConfig({
  root: import.meta.dirname,
  cacheDir: path.join(repo, `node_modules/.vite/harness-portal-agreements-customer-mount${mutant ? `-${mutant}` : ""}`),
  css: { postcss: repo },
  plugins: [
    react(),
    {
      name: "harness-agreements-mutant",
      enforce: "pre",
      transform(code, id) {
        if (!mutant || !id.endsWith("/src/pages/app/Agreements.tsx")) return null;
        const swap = (from: string, to: string) => {
          if (!code.includes(from)) throw new Error(`harness mutant ${mutant}: anchor not found: ${from}`);
          return code.replace(from, to);
        };
        // Every signable row gold, not only the first (§11's one act).
        if (mutant === "gold") return swap(`variant={gold ? "gold" : "outline"}`, `variant="gold"`);
        if (mutant === "contrast") return swap(`<p className="mt-0.5 text-sm text-muted-foreground">`, `<p className="mt-0.5 text-sm text-muted-foreground opacity-40">`);
        if (mutant === "overflow") return swap(`<header className="space-y-1 pb-4">`, `<header className="space-y-1 pb-4"><div aria-hidden="true" style={{ width: 1600, height: 1 }} />`);
        // An inline style, not a class: Tailwind only generates classes it finds on disk, never one a transform adds.
        if (mutant === "target") return swap(`className={LINK_BUTTON} data-testid="ask-new-link"`, `className={LINK_BUTTON} style={{ minHeight: 0, height: 28 }} data-testid="ask-new-link"`);
        if (mutant === "clip") return swap(`<h3 className="break-words text-sm font-medium [text-wrap:pretty]">`, `<h3 className="truncate text-sm font-medium">`);
        // "Review and sign" drawn without the server's can_sign (plan mutation g, in the rendered page).
        if (mutant === "cansign") return swap(`if (a.can_sign) {`, `if (a.can_sign || a.state === "awaiting_you") {`);
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
  server: { host: "127.0.0.1", port: 5251, strictPort: true },
});
