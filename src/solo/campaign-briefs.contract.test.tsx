// Contract for the Campaign BRIEF foundation (Campaigns → Overview). Guards the security + honesty
// invariants of the migration and the client seam as source-level assertions — the same idiom the
// pipeline/offers/social contracts use. The runtime RLS/RPC behaviour is proven separately by the
// throwaway-cluster SQL proof recorded in the UI evidence record; this locks the contract in CI.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(__dirname, "..", "..");
const migration = readFileSync(join(root, "supabase/migrations/20261225000000_solo_campaign_briefs_foundation.sql"), "utf8");
const hook = readFileSync(join(root, "src/solo/useSoloCampaignBriefs.ts"), "utf8");
const desk = readFileSync(join(root, "src/solo/campaign-desk.tsx"), "utf8");

describe("Campaign brief foundation — backend security contract", () => {
  it("resolves the tenant from auth and never trusts the arg (§9/§59)", () => {
    // Both callable functions coalesce the arg then require the resolved tenant to be the caller's
    // own (or platform owner) — the arg can never widen access.
    for (const fn of ["get_campaign_briefs", "configure_campaign_brief"]) {
      const body = migration.slice(migration.indexOf(`function public.${fn}`));
      expect(body).toContain("coalesce(_tenant_id, public.current_user_tenant_id())");
      expect(body).toMatch(/public\.is_platform_owner\(\) or _tenant = public\.current_user_tenant_id\(\)/);
    }
  });

  it("gates every write on tenant-admin/owner (§53) and is SECURITY DEFINER with a pinned search_path", () => {
    expect(migration).toMatch(/create or replace function public\.configure_campaign_brief[\s\S]*?language plpgsql security definer set search_path=public/);
    const write = migration.slice(migration.indexOf("function public.configure_campaign_brief"));
    expect(write).toMatch(/public\.is_platform_owner\(\) or public\.is_tenant_admin\(_tenant\)/);
  });

  it("is optimistic-concurrency safe and idempotent", () => {
    expect(migration).toContain("CAMPAIGN_BRIEF_VERSION_CONFLICT");
    expect(migration).toContain("expectedVersion");
    expect(migration).toContain("campaign_brief_command_results");
    expect(migration).toContain("CAMPAIGN_BRIEF_IDEMPOTENCY_REQUIRED");
    expect(migration).toContain("CAMPAIGN_BRIEF_IDEMPOTENCY_CONFLICT");
    // a version-bump trigger keeps `version` monotonic
    expect(migration).toMatch(/create trigger trg_campaign_brief_version before update on public\.campaign_briefs/);
  });

  it("tenant-validates the two cross-surface links so a brief can never point at another tenant (§9)", () => {
    expect(migration).toMatch(/tenant_products p where p\.id=_offer and p\.tenant_id=_tenant/);
    expect(migration).toContain("CAMPAIGN_BRIEF_OFFER_TENANT_MISMATCH");
    expect(migration).toMatch(/pipelines pl where pl\.id=_pipeline and pl\.tenant_id=_tenant/);
    expect(migration).toContain("CAMPAIGN_BRIEF_PIPELINE_TENANT_MISMATCH");
  });

  it("keeps RLS tenant-scoped and routes ALL writes through the definer RPC", () => {
    expect(migration).toMatch(/create policy campaign_briefs_tenant_read on public\.campaign_briefs for select to authenticated/);
    expect(migration).toMatch(/using \(public\.is_platform_owner\(\) or tenant_id = public\.current_user_tenant_id\(\)\)/);
    expect(migration).toMatch(/revoke insert, update, delete on public\.campaign_briefs from authenticated/);
    // the write function is granted to authenticated; nothing else lets a client mutate the table.
    expect(migration).toMatch(/grant execute on function public\.configure_campaign_brief\(uuid,jsonb,text,text\) to authenticated/);
  });

  it("reserves a Mission link without wiring it (the Mission System does not exist yet)", () => {
    expect(migration).toMatch(/mission_id uuid,/);
    // create/update never write mission_id — it is reserved, not accepted.
    const write = migration.slice(migration.indexOf("_action='create_brief'"), migration.indexOf("_action='update_brief'"));
    expect(write).not.toContain("missionId");
  });
});

describe("Campaign brief seam — client contract", () => {
  it("reads and writes ONLY through the governed RPCs (no direct table mutation)", () => {
    expect(hook).toContain('supabase.rpc(');
    expect(hook).toContain('"get_campaign_briefs"');
    expect(hook).toContain('"configure_campaign_brief"');
    expect(hook).not.toMatch(/\.from\(["']campaign_briefs["']\)\s*\.\s*(insert|update|delete|upsert)/);
    expect(desk).not.toMatch(/\.from\(["']campaign_briefs["']\)/);
  });

  it("maps EVERY error token the RPC can raise to a human sentence (parity)", () => {
    const tokens = [...new Set((migration.match(/CAMPAIGN_BRIEF_[A-Z_]+/g) || []))];
    expect(tokens.length).toBeGreaterThan(8);
    for (const token of tokens) expect(hook, `hook must handle ${token}`).toContain(token);
  });

  it("sends the four governed commands the desk needs", () => {
    for (const cmd of ["create_brief", "update_brief", "transition_brief", "archive_brief"]) {
      expect(hook.includes(cmd) || desk.includes(cmd)).toBe(true);
    }
  });

  it("fabricates no campaign metric — the only surfaced number is the server-resolved deal count (§13)", () => {
    // The one number the seam carries is the server-resolved deal count, read from the row (the RPC
    // computes it against `deals` for a LINKED pipeline), never invented client-side.
    expect(hook).toContain("pipeline_deal_count");
    expect(hook).toContain("typeof row.pipeline_deal_count === \"number\" ? row.pipeline_deal_count");
    // budget target is explicitly disclaimed as NOT actual spend on the surface.
    expect(desk).toContain("not</b> actual ad spend");
    expect(desk).toContain("Recorded outcome");
    expect(desk).toContain("No campaign attribution");
  });
});

// Regression lock for the §39 peer-gate findings, so a later edit cannot silently reintroduce them.
describe("Campaign desk — §39 peer-gate invariants", () => {
  it("portals the drawers so the focus-trap `inert` cannot make the drawer itself non-interactive (BLOCKER)", () => {
    // The desk renders inside `.campaigns-scroll`, which `useDrawerA11y` marks inert. Rendered inline
    // a drawer would inert itself; it must portal to `.solo-campaigns` (a sibling, still theme-scoped).
    expect(desk).toContain('import { createPortal } from "react-dom"');
    expect(desk).toContain('closest(".solo-campaigns")');
    expect((desk.match(/createPortal\(/g) || []).length).toBeGreaterThanOrEqual(2);
  });

  it("threads a stable idempotency key so a double-submit cannot double-create (MAJOR)", () => {
    // The hook must accept a caller key and only fall back to a random one — a per-call random key
    // makes the ledger dead. The builder mints one key per submit and a synchronous latch blocks a
    // second in-flight submit.
    expect(hook).toMatch(/saveBrief:\s*\(draft: BriefDraft, idempotencyKey\?: string\)/);
    expect(hook).toContain("idempotencyKey && idempotencyKey.trim() ? idempotencyKey : crypto.randomUUID()");
    expect(desk).toContain("submitting.current");
    expect(desk).toContain("idemRef.current");
  });

  it("links offers through a REAL Catalog picker, never a pasted UUID (MAJOR)", () => {
    expect(desk).toContain("useCatalogOffers");
    expect(desk).not.toContain("Paste a Catalog offer id");
  });

  it("derives the workspace-scope Offer state from a real read and never fakes Audience (MAJOR)", () => {
    // `offerSignal` comes from the Catalog read; audience has no segment source, so it is honestly setup.
    expect(desk).toContain("offerSignal");
    expect(desk).toMatch(/audience:\s*"setup"/);
    expect(desk).not.toMatch(/offer:\s*"partial",\s*\n\s*audience:\s*"partial"/);
  });

  it("reports honestly when a save persists but the review transition fails (MAJOR)", () => {
    expect(desk).toContain("could not be sent for review");
  });
});
