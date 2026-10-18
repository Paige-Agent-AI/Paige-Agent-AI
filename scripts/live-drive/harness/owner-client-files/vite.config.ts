import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";

// E09 Slice 4 — "Files for {client}" inside the REAL Solo Clients workspace and client record
// (TenantRelationshipsClientsWorkspace, routeTier="solo"), mounted exactly as owner-shared-work mounts it (same
// aliases, same shell classes, same exp04 standing fixture), so the section renders after "Shared with {client}"
// with the real CSS and pg tokens. Only the data boundary is stubbed (stubs.ts): the session/tenant context, the
// People read, the role read and the Supabase transport (the standing read, the work share writer, and the four
// owner file RPCs + Storage). Its own root: never in the app build.
//   /solo/42/clients/people?person=<id>&state=populated|connected|empty|loading|refused|unavailable|error|pending|
//     confirm|confirm-joined|unshare|changed|uploading|uncertain|saved|share-added|open|open-blocked|workspace-changed&theme=light|dark
// HARNESS_FILES_MUTANT=<name> (drive self-test only) injects harness-only defects through a transform; no
// product file is edited. See files-drive.mjs --selftest.
const repo = path.resolve(import.meta.dirname, "../../../..");
const stubs = path.join(import.meta.dirname, "stubs.ts");
const mutant = process.env.HARNESS_FILES_MUTANT ?? "";
export default defineConfig({
  root: import.meta.dirname,
  cacheDir: path.join(repo, `node_modules/.vite/harness-owner-client-files${mutant ? `-${mutant}` : ""}`),
  css: { postcss: repo },
  plugins: [
    react(),
    {
      name: "harness-files-mutant",
      enforce: "pre",
      transform(code, id) {
        if (!mutant) return null;
        const swap = (from: string, to: string) => {
          if (!code.includes(from)) throw new Error(`harness mutant ${mutant}: anchor not found: ${from}`);
          return code.replace(from, to);
        };
        if (id.endsWith("/client-files.css")) {
          if (mutant === "gold") return swap(`border-color: var(--pg-violet); background: var(--pg-violet); }`, `border-color: var(--pg-gold-fill); background: var(--pg-gold-fill); }`);
          if (mutant === "contrast") return swap(`.trc-files-item > span { color: var(--pg-ink-2);`, `.trc-files-item > span { color: color-mix(in srgb, var(--pg-ink-2) 30%, transparent);`);
          if (mutant === "overflow") return swap(`.trc-files-item strong { color: var(--pg-ink);`, `.trc-files-item strong { white-space: nowrap; min-width: 900px; color: var(--pg-ink);`);
          if (mutant === "target") return swap(`gap: 10px; min-height: 44px; padding: 0 2px 0 8px;`, `gap: 10px; min-height: 20px; padding: 0 2px 0 8px;`);
          if (mutant === "clip") return swap(`.trc-files-item strong { color: var(--pg-ink);`, `.trc-files-item strong { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; color: var(--pg-ink);`);
          return code;
        }
        if (id.endsWith("/useClientFilesOwner.ts")) {
          // Success reported from the writer's acknowledgement alone, without the confirming re-read (§70.1).
          if (mutant === "unconfirmed") return swap(`const fresh = await reload();
      const now = fresh.files.find(f => f.id === file.id);`, `const fresh = { files: [{ ...file, visibility: shared ? "shared" : "internal" }] };
      const now = fresh.files.find(f => f.id === file.id);`);
          // An upload that starts shared instead of private (owner decision D1).
          // A page cursor without the id tie-breaker: the next page would skip files saved in the boundary's instant.
          if (mutant === "tieskip") return swap(`p_before: after?.created_at ?? null, p_before_id: after?.id ?? null,`, `p_before: after?.created_at ?? null, p_before_id: null,`);
          if (mutant === "public") return swap(`p_filename: candidate.name, p_mime_type: candidate.mime, p_size_bytes: candidate.size,`, `p_filename: candidate.name, p_mime_type: candidate.mime, p_size_bytes: candidate.size, p_visibility: "shared",`);
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
  server: { host: "127.0.0.1", port: 5271, strictPort: true },
});
