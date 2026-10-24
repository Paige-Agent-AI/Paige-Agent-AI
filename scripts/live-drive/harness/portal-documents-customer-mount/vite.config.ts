import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";

// E09 Slice 4 — the CUSTOMER portal Documents page (/app/documents) rendered with the REAL ClientDocuments page
// (and its REAL "Work for your review" section and the REAL Operations review dialog) inside the REAL customer
// chrome (AppNav) in AppShell's layout, plus the customer home's REAL tile grid. Only the data boundary is
// stubbed (stubs.ts): the Supabase transport (client_portal_self_profile, client_portal_documents, the release
// reads/decide, Storage signing, the brand/config reads, empty progress/sessions for the home) and the
// DashboardMode context. useClientDocuments, useClientPortalReleasedWork, usePortalDocumentsGlance and every
// exact-key validator are the real ones. Its own root: never part of the app build (§9).
//   /app/documents?state=populated|empty|loading|pending|released|accepted|release-unavailable|unavailable|
//     multiple|sign-error&theme=light|dark
//   /app?state=home|home-empty&theme=light|dark
// HARNESS_DOCUMENTS_MUTANT=<name> (drive self-test only) swaps in harness-only defects through a transform; no
// product file is edited. See documents-drive.mjs --selftest.
const repo = path.resolve(import.meta.dirname, "../../../..");
const stubs = path.join(import.meta.dirname, "stubs.ts");
const mutant = process.env.HARNESS_DOCUMENTS_MUTANT ?? "";
export default defineConfig({
  root: import.meta.dirname,
  cacheDir: path.join(repo, `node_modules/.vite/harness-portal-documents-customer-mount${mutant ? `-${mutant}` : ""}`),
  css: { postcss: repo },
  plugins: [
    react(),
    {
      // Defects for the drive's own negative controls, injected into the served module only.
      name: "harness-documents-mutant",
      enforce: "pre",
      transform(code, id) {
        if (!mutant) return null;
        const swap = (from: string, to: string) => {
          if (!code.includes(from)) throw new Error(`harness mutant ${mutant}: anchor not found: ${from}`);
          return code.replace(from, to);
        };
        if (id.endsWith("/src/pages/app/ClientDocuments.tsx")) {
          if (mutant === "contrast") return swap(`<p className="mt-1 text-sm text-muted-foreground">{size(row.size_bytes)}`, `<p className="mt-1 text-sm text-muted-foreground opacity-40">{size(row.size_bytes)}`);
          if (mutant === "overflow") return swap(`<div className="space-y-4"><div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-base font-semibold">Your library</h2>`, `<div className="space-y-4"><div aria-hidden="true" style={{ width: 1600, height: 1 }} /><div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-base font-semibold">Your library</h2>`);
          if (mutant === "clip") return swap(`<h3 className="line-clamp-2 break-words text-sm font-medium" title={row.filename}>`, `<h3 className="truncate text-sm font-medium" title={row.filename}>`);
          if (mutant === "target") return swap(`[&_button]:min-h-[44px] [&_input]:min-h-[44px]`, `[&_button]:min-h-0 [&_button]:h-7 [&_input]:min-h-[44px]`);
          // A business file labelled as the customer's own (the round of "Customer upload" again).
          if (mutant === "label") return swap("row.source === \"business\" ? `Shared by ${business}` : \"Your upload\"", "\"Your upload\"");
        }
        if (id.endsWith("/src/components/client/ClientReleasedWork.tsx")) {
          if (mutant === "gold") return swap(`style={release.state === "awaiting_client" ? accentStyle : undefined}`, `style={release.state === "awaiting_client" ? { background: "hsl(var(--accent))", color: "hsl(var(--accent-foreground))" } : undefined}`);
        }
        return null;
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
  server: { host: "127.0.0.1", port: 5272, strictPort: true },
});
