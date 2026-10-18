import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";

// E09 Slice M — the customer portal menu (real AppNav) and the owner's menu editor (real PortalStudio, embedded as
// Solo mounts it). Only the data boundary is stubbed (stubs.ts): the Supabase transport, the DashboardMode context
// and the tenant context. Its own root: never part of the app build (§9).
//   /?view=customer&variant=default|renamed|hidden|reordered|staff|multi|stored&theme=light|dark
//   /?view=owner&variant=default|saving|mismatch&theme=light|dark
// HARNESS_MENU_MUTANT=<name> (drive self-test only) swaps in harness-only defects through a transform; no product
// file is edited. See menu-drive.mjs --selftest.
const repo = path.resolve(import.meta.dirname, "../../../..");
const stubs = path.join(import.meta.dirname, "stubs.ts");
const mutant = process.env.HARNESS_MENU_MUTANT ?? "";
export default defineConfig({
  root: import.meta.dirname,
  cacheDir: path.join(repo, `node_modules/.vite/harness-portal-menu-mount${mutant ? `-${mutant}` : ""}`),
  css: { postcss: repo },
  plugins: [
    react(),
    {
      name: "harness-menu-mutant",
      enforce: "pre",
      transform(code, id) {
        if (!mutant) return null;
        const swap = (from: string, to: string) => {
          if (!code.includes(from)) throw new Error(`harness mutant ${mutant}: anchor not found: ${from}`);
          return code.replace(from, to);
        };
        if (id.endsWith("/portal-menu-mount/stubs.ts")) {
          // The stored menu no longer survives a reload: the persistence run must notice.
          if (mutant === "nopersist") return swap(`window.sessionStorage.setItem(STORE_KEY, JSON.stringify(next));`, `void next;`);
          return null;
        }
        if (id.endsWith("/src/components/app/AppNav.tsx")) {
          // Sign Out back on the plain destructive token: 1.2:1 on the dark-theme violet drawer.
          if (mutant === "signoutdark") return swap(`text-[hsl(var(--destructive-on-ink))]`, `text-destructive`);
          if (mutant === "navgold") return swap(`const DRAWER_ACTIVE = "bg-sidebar-accent text-primary-foreground font-medium";`, `const DRAWER_ACTIVE = "bg-sidebar-accent text-accent font-medium";`);
          // Inline styles, not new utility classes: Tailwind only generates classes it finds in the source on disk.
          if (mutant === "navtarget") return swap(`onClick={() => { go(item.href); setMobileMenuOpen(false); }}`, `style={{ minHeight: 0, height: 28, paddingTop: 0, paddingBottom: 0 }} onClick={() => { go(item.href); setMobileMenuOpen(false); }}`);
          return null;
        }
        if (id.endsWith("/src/pages/admin/PortalMenuEditor.tsx")) {
          if (mutant === "editorgold") return swap(`<Button type="button" variant="outline" className="h-[44px]" onClick={reset}`, `<Button type="button" variant="gold" className="h-[44px]" onClick={reset}`);
          if (mutant === "contrast") return swap(`<p data-menu-heading className="`, `<p data-menu-heading style={{ opacity: 0.3 }} className="`);
          if (mutant === "overflow") return swap(`<section aria-labelledby={headingId} data-testid="portal-menu-editor" className="space-y-4">`, `<section aria-labelledby={headingId} data-testid="portal-menu-editor" className="space-y-4"><div aria-hidden="true" style={{ width: 1900, height: 1 }} />`);
          if (mutant === "rowwrap") {
            const wrapped = swap(`className={cn("flex min-h-[56px] items-center gap-2 border-t border-border/60 px-3 py-2 transition-colors`, `className={cn("flex flex-wrap min-h-[56px] items-center gap-2 border-t border-border/60 px-3 py-2 transition-colors`);
            if (!wrapped.includes(`<div className="min-w-0 flex-1">`)) throw new Error("harness mutant rowwrap: name column anchor not found");
            return wrapped.replace(`<div className="min-w-0 flex-1">`, `<div className="min-w-0 flex-1" style={{ minWidth: 300 }}>`);
          }
          if (mutant === "target") return swap(`<button type="button" className={moveButton} aria-label={\`Move \${row.defaultLabel} up\`}`, `<button type="button" style={{ height: 24, width: 24 }} className={moveButton} aria-label={\`Move \${row.defaultLabel} up\`}`);
          return null;
        }
        return null;
      },
    },
  ],
  resolve: {
    alias: [
      { find: /^@\/integrations\/supabase\/client$/, replacement: stubs },
      { find: /^@\/contexts\/DashboardModeContext$/, replacement: stubs },
      { find: /^@\/hooks\/useTenantContext$/, replacement: stubs },
      { find: "@", replacement: path.join(repo, "src") },
    ],
  },
  define: {
    "import.meta.env.VITE_SUPABASE_URL": JSON.stringify("http://harness.invalid"),
    "import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY": JSON.stringify("harness-not-a-real-key"),
  },
  appType: "spa",
  server: { host: "127.0.0.1", port: 5246, strictPort: true },
});
