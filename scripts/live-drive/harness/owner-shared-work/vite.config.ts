import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";

// E09 Slice 3 — "Shared with {client}" inside the REAL Solo Clients workspace and client record
// (TenantRelationshipsClientsWorkspace, routeTier="solo"), mounted exactly as client-standing-mount mounts it
// (same aliases, same shell classes, same exp04 SQL-output fixture), so the section renders under "Where
// {client} stands" with the real CSS and pg tokens. Only the data boundary is stubbed (stubs.ts): the session/
// tenant context, the People read, the role read and the Supabase transport (read_client_engagement_status,
// plan_item_set_client_share, and the creator's team/plan/admin reads). Its own root: never in the app build.
//   /solo/42/clients/people?person=<id>&state=populated|connected|empty|loading|refused|error|pending|confirm|
//     confirm-joined|unshare|changed|addwork|filter-private&theme=light|dark
// HARNESS_SHARED_MUTANT=<name> (drive self-test only) injects harness-only defects through a transform; no
// product file is edited. See shared-work-drive.mjs --selftest.
const repo = path.resolve(import.meta.dirname, "../../../..");
const stubs = path.join(import.meta.dirname, "stubs.ts");
const mutant = process.env.HARNESS_SHARED_MUTANT ?? "";
export default defineConfig({
  root: import.meta.dirname,
  cacheDir: path.join(repo, `node_modules/.vite/harness-owner-shared-work${mutant ? `-${mutant}` : ""}`),
  css: { postcss: repo },
  plugins: [
    react(),
    {
      name: "harness-shared-mutant",
      enforce: "pre",
      transform(code, id) {
        if (!mutant) return null;
        const swap = (from: string, to: string) => {
          if (!code.includes(from)) throw new Error(`harness mutant ${mutant}: anchor not found: ${from}`);
          return code.replace(from, to);
        };
        if (id.endsWith("/client-shared-work.css")) {
          if (mutant === "gold") return swap(`border-color: var(--pg-violet); background: var(--pg-violet); }`, `border-color: var(--pg-gold-fill); background: var(--pg-gold-fill); }`);
          if (mutant === "contrast") return swap(`.trc-shared-item span { color: var(--pg-ink-2);`, `.trc-shared-item span { color: color-mix(in srgb, var(--pg-ink-2) 30%, transparent);`);
          if (mutant === "overflow") return swap(`.trc-shared-item strong { color: var(--pg-ink);`, `.trc-shared-item strong { white-space: nowrap; min-width: 900px; color: var(--pg-ink);`);
          if (mutant === "target") return swap(`min-height: 44px; padding: 0 2px 0 8px;`, `min-height: 20px; padding: 0 2px 0 8px;`);
          if (mutant === "clip") return swap(`.trc-shared-item strong { color: var(--pg-ink);`, `.trc-shared-item strong { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; color: var(--pg-ink);`);
          return code;
        }
        if (id.endsWith("/ClientSharedWork.tsx")) {
          // Success shown on the writer's acknowledgement alone, without the confirming re-read (§70.1).
          if (mutant === "unconfirmed") return swap(`try { fresh = await read.reload(); } catch {`, `try { fresh = { work: { items: [{ id: item.id, shared: next }] } } as unknown as ClientEngagementStatus; } catch {`);
          // Round 1 again: no "{first} sees:" line on shared rows (P1-2).
          if (mutant === "seesline") return swap(`{!cancelled && item.shared === true && <span className="trc-shared-quiet-line">`, `{false && <span className="trc-shared-quiet-line">`);
          // Round 1 again: "can see this in their portal" said to an owner whose client hasn't joined (P2-1).
          if (mutant === "joinedcopy") return swap("joined ? `Shared.", "true ? `Shared.");
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
  server: { host: "127.0.0.1", port: 5245, strictPort: true },
});
