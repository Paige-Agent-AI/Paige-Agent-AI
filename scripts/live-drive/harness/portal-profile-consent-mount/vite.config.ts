import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";

// E09 Slice 6 — the CUSTOMER's Your account page (/app/settings?view=client-account): the REAL ClientAccount
// (personal information with address editing, "How {Business} can reach you", "What {Business} can use") and
// the REAL Data & Privacy panel, inside the REAL customer chrome (AppNav) in AppShell's layout. Only the data
// boundary is stubbed (stubs.ts): the Supabase transport and the DashboardMode context. useClientAccount,
// useClientPortalPreferences (exact-key reader included), the brand reader and usePlaybook are the real ones.
// Its own root: never part of the app build (§9).
//   /app/settings?view=client-account&state=<see stubs.ts>&theme=light|dark
//   /app/privacy?state=default&theme=light|dark
// HARNESS_CONSENT_MUTANT=<name> (drive self-test only) swaps in harness-only defects through a transform; no
// product file is edited. See consent-drive.mjs --selftest.
const repo = path.resolve(import.meta.dirname, "../../../..");
const stubs = path.join(import.meta.dirname, "stubs.ts");
const mutant = process.env.HARNESS_CONSENT_MUTANT ?? "";
export default defineConfig({
  root: import.meta.dirname,
  cacheDir: path.join(repo, `node_modules/.vite/harness-portal-profile-consent${mutant ? `-${mutant}` : ""}`),
  css: { postcss: repo },
  plugins: [
    react(),
    {
      name: "harness-consent-mutant",
      enforce: "pre",
      transform(code, id) {
        if (!mutant) return null;
        const swap = (from: string, to: string) => {
          if (!code.includes(from)) throw new Error(`harness mutant ${mutant}: anchor not found: ${from}`);
          return code.replace(from, to);
        };
        // Round 2: the shared Switch's off state back to the old --input fill (1.53:1 light / 1.27:1 dark).
        if (id.endsWith("/src/components/ui/switch.tsx")) {
          if (mutant !== "switch-contrast") return null;
          return swap(`data-[state=unchecked]:border-muted-foreground data-[state=unchecked]:bg-background`, `data-[state=unchecked]:border-transparent data-[state=unchecked]:bg-input`)
            .replace(`data-[state=unchecked]:bg-muted-foreground`, `data-[state=unchecked]:bg-background`);
        }
        if (!id.endsWith("/src/components/client/ClientPreferences.tsx")) return null;
        if (mutant === "switch-contrast") return null;
        if (mutant === "gold") return swap(`className={SWITCH_TARGET}`, `className={\`\${SWITCH_TARGET} data-[state=checked]:bg-accent\`}`);
        if (mutant === "contrast") return swap(`className="max-w-prose text-sm text-muted-foreground" data-testid="pref-disclosure"`, `className="max-w-prose text-sm text-muted-foreground opacity-40" data-testid="pref-disclosure"`);
        if (mutant === "target") return swap(`const SWITCH_TARGET = "relative after:absolute after:inset-x-0 after:-inset-y-[12px] after:content-['']";`, `const SWITCH_TARGET = "";`);
        if (mutant === "overflow") return swap(`<p className="text-base font-medium [overflow-wrap:anywhere]" data-testid="pref-label">{card.label}</p>`, `<p className="text-base font-medium whitespace-nowrap" style={{ minWidth: 900 }} data-testid="pref-label">{card.label}</p>`);
        if (mutant === "reason") return swap(`{showReason && <p id={reasonId}`, `{false && <p id={reasonId}`);
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
  server: { host: "127.0.0.1", port: 5361, strictPort: true },
});
