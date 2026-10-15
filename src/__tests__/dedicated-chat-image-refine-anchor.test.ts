// @vitest-environment node
//
// Task #15 — dedicated Paige chat in-place image refinement. Structural + safety-invariant guard on
// the server-owned refine anchor. The end-to-end runtime behavior (the model refining an image in
// place in an authenticated dedicated chat) is §32.c-owed to a browser-capable session; the SQL
// version-preservation + server-owned-anchor behavior is proven on real Postgres by
// scripts/marketing-content-refine-db-proof.mjs (12/12). This test locks the wiring + the OWNER SAFETY
// CONSTRAINTS into source so a refactor cannot silently regress them:
//   * the trust anchor is SERVER-OWNED — read from the thread row AND written only by the service-role
//     client behind a BEFORE UPDATE trigger that freezes client forge attempts (Codex P2/§59);
//   * reuse in the dedicated chat happens ONLY when the model echoes the exact server anchor id;
//   * the anchor ADVANCES on a genuine success with a FILED content_id and CLEARS on a failed/unfiled
//     generation (owner: clear on failed generation → never refine a stale older image, Codex P1);
//   * the Studio canvas clamp is untouched;
//   * the reuse UPDATE preserves prior versions (meta.versions snapshot before overwrite), tenant-scoped,
//     and normalizes scalar/array p_meta so the snapshot is never silently dropped (Codex P2).
import { readFileSync, existsSync } from "node:fs";
import { describe, it, expect } from "vitest";

const CHAT = "supabase/functions/paige-ai-chat/index.ts";
const ANCHOR_MIG = "supabase/migrations/20261228000000_thread_image_refine_anchor.sql";
const VERSION_MIG = "supabase/migrations/20261228000001_marketing_content_reuse_preserves_versions.sql";
const chat = readFileSync(CHAT, "utf8");

describe("Task #15 — migrations exist and carry the safety clauses", () => {
  it("the anchor migration adds tenant-safe, auto-clearing anchor columns on the thread row", () => {
    expect(existsSync(ANCHOR_MIG)).toBe(true);
    const m = readFileSync(ANCHOR_MIG, "utf8");
    expect(m).toMatch(/ADD COLUMN IF NOT EXISTS last_image_content_id uuid/);
    expect(m).toMatch(/REFERENCES public\.marketing_content\(id\) ON DELETE SET NULL/); // deleted image clears the anchor
    expect(m).toMatch(/ADD COLUMN IF NOT EXISTS last_image_anchor_at timestamptz/);
  });

  it("the anchor is SERVER-OWNED across the FULL client write surface: a BEFORE INSERT OR UPDATE trigger nulls a forged INSERT anchor and freezes non-null UPDATE writes (incl. timestamp-only bumps), but allows clear-to-NULL (Codex P2/§59)", () => {
    const m = readFileSync(ANCHOR_MIG, "utf8");
    // the trigger covers the WHOLE client write surface — INSERT (forge onto a new thread) AND UPDATE
    // (set/redirect/timestamp-bump). Covering only UPDATE left the INSERT forge path open (Codex round 3).
    expect(m).toMatch(/CREATE TRIGGER trg_paige_chat_threads_freeze_image_anchor\s+BEFORE INSERT OR UPDATE ON public\.paige_chat_threads/);
    // trusted server roles write freely; everyone else is constrained
    expect(m).toMatch(/current_user IN \('service_role', 'supabase_admin', 'postgres'\)/);
    // INSERT: a client-created thread can never carry an anchor → both columns forced NULL
    expect(m).toMatch(/TG_OP = 'INSERT' THEN\s*\n\s*[\s\S]{0,320}NEW\.last_image_content_id\s*:=\s*NULL;\s*\n\s*NEW\.last_image_anchor_at\s*:=\s*NULL;/);
    // UPDATE: freeze WHENEVER the row retains a non-null id (covers a timestamp-only bump), NOT only on
    // an id change → a transition TO NULL (FK cascade, expiry clear) still works. The old "id DISTINCT
    // FROM old" predicate the timestamp bump slipped through must be gone.
    expect(m).toMatch(/ELSIF NEW\.last_image_content_id IS NOT NULL THEN/);
    expect(m).not.toMatch(/IS DISTINCT FROM OLD\.last_image_content_id/);
    expect(m).toMatch(/NEW\.last_image_content_id\s*:=\s*OLD\.last_image_content_id/);
    expect(m).toMatch(/NEW\.last_image_anchor_at\s*:=\s*OLD\.last_image_anchor_at/);
    // INVOKER, not DEFINER — the trigger function must NOT declare SECURITY DEFINER (else current_user
    // would mask the connected role). Behaviorally proven by the db-proof's forge test; asserted here
    // only on the function definition, since the header comment legitimately names the phrase.
    expect(m).not.toMatch(/RETURNS trigger[\s\S]*?SECURITY DEFINER[\s\S]*?\$\$/);
  });

  it("the version-preservation migration snapshots the prior image before the tenant-scoped reuse UPDATE", () => {
    expect(existsSync(VERSION_MIG)).toBe(true);
    const m = readFileSync(VERSION_MIG, "utf8");
    // server-owned history based on the row's own meta, not caller p_meta
    expect(m).toMatch(/_versions\s*:=\s*_cur\.meta\s*->\s*'versions'/);
    // only snapshot when the image actually changes
    expect(m).toMatch(/_new_image IS NOT NULL AND _cur\.image_url IS NOT NULL AND _new_image <> _cur\.image_url/);
    // scalar/array p_meta is normalized to an object so versions can never be silently dropped (Codex P2)
    expect(m).toMatch(/jsonb_typeof\(_merged_meta\) <> 'object'/);
    // append prior image + cap
    expect(m).toMatch(/jsonb_set\(_merged_meta, '\{versions\}'/);
    expect(m).toMatch(/jsonb_array_length\(_versions\) > 20/);
    // §9 tenant scope on the reuse UPDATE is preserved
    expect(m).toMatch(/WHERE id = p_id AND tenant_id = _tenant/);
    // the INSERT branch strips caller-supplied meta.versions so fabricated history can't be planted (Codex P2)
    expect(m).toMatch(/jsonb_typeof\(_merged_meta\) = 'object'\s+THEN\s*\n\s*_merged_meta := _merged_meta - 'versions';/);
    expect(m).toMatch(/NULLIF\(btrim\(p_size\), ''\), p_brief, _merged_meta/);
  });
});

describe("Task #15 — the server-owned anchor is wired safely into paige-ai-chat", () => {
  it("declares the request-scoped anchor + recency window", () => {
    expect(chat).toMatch(/let refineImageAnchor:\s*\{\s*id:\s*string\s*\}\s*\|\s*null\s*=\s*null;/);
    expect(chat).toMatch(/const IMAGE_REFINE_ANCHOR_WINDOW_MS\s*=/);
  });

  it("reads the anchor from the caller's own thread row (RLS-scoped), not from client input", () => {
    // the anchor columns are selected on the same tenant/caller-scoped thread read
    expect(chat).toMatch(/select\("summary, studio_session_id, last_image_content_id, last_image_anchor_at"\)/);
    // resolved only OUTSIDE Studio, only within the recency window
    expect(chat).toMatch(/!th\?\.studio_session_id && canvasArtifact == null[\s\S]{0,160}IMAGE_REFINE_ANCHOR_WINDOW_MS/);
    expect(chat).toMatch(/refineImageAnchor = \{ id: String\(th\.last_image_content_id\) \}/);
  });

  it("reuses ONLY when the model echoes the EXACT server anchor id — never an arbitrary client id", () => {
    // the dedicated-chat clamp requires target_content_id === refineImageAnchor.id (server is authority)
    expect(chat).toMatch(/!canvasArtifact && refineImageAnchor && args\.target_content_id === refineImageAnchor\.id/);
    // and it reuses the SERVER anchor's id, not the model-supplied value
    expect(chat).toMatch(/\? refineImageAnchor\.id/);
  });

  it("CLEARS the anchor up-front (so a thrown/hard-failed generation can't leave a stale anchor) then ADVANCES only on a filed success, via the tenant-fenced SERVICE-ROLE writer, dedicated chat only", () => {
    // (Codex P2) pre-clear BEFORE the generate-image invoke, so a throw at the invoke guards can't
    // leave a stale anchor — sets both columns to null, tenant-fenced, service-role, logged
    expect(chat).toMatch(/refine anchor pre-clear/);
    expect(chat).toMatch(/\.update\(\{ last_image_content_id: null, last_image_anchor_at: null \}\)[\s\S]{0,200}\.eq\("caller_user_id", user\.id\)[\s\S]{0,80}\.eq\("tenant_id", personaCtx\.tenant_id\)/);
    // advance runs ONLY on a genuine success with a filed content_id (no clear-else — the pre-clear
    // already handled every non-filed path)
    expect(chat).toMatch(/personaCtx\?\.tenant_id\s*\n\s*&& \(result as any\)\?\.success === true\s*\n\s*&& artifactProduced\("saved_id", \(result as any\)\?\.content_id\)\) \{/);
    // server-owned: written through the service-role `supabase` client (never the JWT `supabaseClient`),
    // and fenced to caller AND active tenant (Codex P2 — no cross-workspace thread contamination)
    expect(chat).toMatch(/last_image_content_id: String\(\(result as any\)\.content_id\)[\s\S]{0,260}\.eq\("caller_user_id", user\.id\)\s*\n\s*\.eq\("tenant_id", personaCtx\.tenant_id\)/);
    // best-effort but LOGGED, never swallowed silently (§13/§32)
    expect(chat).toMatch(/refine anchor advance failed/);
    // the anchor write NEVER uses the JWT client for these columns (must be the service-role `supabase`)
    expect(chat).not.toMatch(/supabaseClient\.from\("paige_chat_threads"\)\s*\n\s*\.update\(\{ last_image_content_id/);
  });

  it("does NOT regress the Studio canvas clamp (still keyed on canvasArtifact)", () => {
    expect(chat).toMatch(/canvasArtifact\?\.kind === "content" && args\.target_content_id === canvasArtifact\.id/);
  });

  it("canvasArtifact is SERVER-GATED: it is a mutable client field neutralized for a dedicated (non-Studio) chat, so a forged canvas cannot drive reuse or suppress anchor maintenance (Codex P2)", () => {
    // canvasArtifact is declared mutable (let), sourced from the request, so it can be neutralized
    expect(chat).toMatch(/let canvasArtifact = validatedData\.canvasArtifact \?\? null;/);
    // neutralized whenever the SERVER-resolved studio state says this is not a Studio session
    expect(chat).toMatch(/if \(!studioSessionId\) canvasArtifact = null;/);
    // the anchor-maintenance guards key on the server-resolved studioSessionId, NOT the client field —
    // they must NOT re-introduce a `!canvasArtifact` gate that a client could flip
    expect(chat).not.toMatch(/!studioSessionId && !canvasArtifact/);
  });
});
