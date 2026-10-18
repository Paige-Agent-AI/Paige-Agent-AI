import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";

// E09 Slice 4 (4B) — releasing finished work to a client, inside the REAL Operations work-item detail sheet
// (OperationsWorkspace → OperationsItemRelease → OperationsDeliverablePreparation + OperationsStaffDeliveryReview),
// with the real CSS and pg tokens. Only the data boundary is stubbed (stubs.ts): the session/tenant context, the tier
// read, the Planning read, the Team read, the CRM task read and the Supabase transport (the operations_delivery_*
// RPCs, the Studio source reads, and the small admin/activity reads the sheet makes). Its own root: never in the app
// build.
//   /solo/42/operations/work?state=single|picker|confirm|submitted|in-review|approved|release-confirm|released|
//     accepted|client-changes|people-loading|reading|unavailable&theme=light|dark
// HARNESS_RELEASE_MUTANT=<name> (drive self-test only) injects harness-only defects through a transform; no product
// file is edited. See release-drive.mjs --selftest.
const repo = path.resolve(import.meta.dirname, "../../../..");
const stubs = path.join(import.meta.dirname, "stubs.ts");
const mutant = process.env.HARNESS_RELEASE_MUTANT ?? "";
export default defineConfig({
  root: import.meta.dirname,
  cacheDir: path.join(repo, `node_modules/.vite/harness-operations-release${mutant ? `-${mutant}` : ""}`),
  css: { postcss: repo },
  plugins: [
    react(),
    {
      name: "harness-release-mutant",
      enforce: "pre",
      transform(code, id) {
        if (!mutant) return null;
        const swap = (from: string, to: string) => {
          if (!code.includes(from)) throw new Error(`harness mutant ${mutant}: anchor not found: ${from}`);
          return code.replace(from, to);
        };
        if (id.endsWith("/operations-staff-delivery-review.css")) {
          // A recorded stage painted gold: gold spent on a resting state, not on the act.
          if (mutant === "gold") return swap(`.ops-staff-progression li[data-complete=true] svg{color:var(--pg-violet)}`, `.ops-staff-progression li[data-complete=true] svg{color:var(--pg-gold-fill)}`);
          if (mutant === "contrast") return swap(`.ops-staff-people span{color:var(--pg-muted);`, `.ops-staff-people span{color:color-mix(in srgb,var(--pg-muted) 25%,transparent);`);
          if (mutant === "target") return swap(`.ops-staff-review button{min-height:44px;background:var(--pg-surface);color:var(--pg-ink);border:1px solid var(--pg-line);border-radius:8px;padding:10px 14px}`, `.ops-staff-review button{min-height:20px;background:var(--pg-surface);color:var(--pg-ink);border:1px solid var(--pg-line);border-radius:8px;padding:1px 6px;line-height:1.1}`);
          if (mutant === "overflow") return swap(`.ops-staff-document{`, `.ops-staff-document{min-width:900px;white-space:pre;`);
          return code;
        }
        if (id.endsWith("/OperationsItemRelease.tsx")) {
          // The reviewer picker offered with nobody in it (owner decision D2 broken).
          if (mutant === "empty-picker") return swap(`const single = peopleReady && reviewers.length === 0;`, `const single = false;`);
        }
        return null;
      },
    },
  ],
  resolve: {
    alias: [
      { find: /^@\/integrations\/supabase\/client$/, replacement: stubs },
      { find: /^@\/hooks\/useTenantContext$/, replacement: stubs },
      { find: /^@\/hooks\/useTierFeatures$/, replacement: stubs },
      { find: /^@\/hooks\/usePlanList$/, replacement: stubs },
      { find: /^\.\/useOperationsPeople$/, replacement: stubs },
      { find: /^\.\/useOperationsCrmWork$/, replacement: stubs },
      { find: "@", replacement: path.join(repo, "src") },
    ],
  },
  define: {
    "import.meta.env.VITE_SUPABASE_URL": JSON.stringify("http://harness.invalid"),
    "import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY": JSON.stringify("harness-not-a-real-key"),
  },
  appType: "spa",
  server: { host: "127.0.0.1", port: 5273, strictPort: true },
});
