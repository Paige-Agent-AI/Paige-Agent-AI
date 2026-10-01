import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  path.join(process.cwd(), "supabase/migrations/20261046000000_solo_setup_persistence_repair.sql"),
  "utf8",
);
const rollbackProbe = readFileSync(
  path.join(process.cwd(), "supabase/tests/solo_setup_persistence_rollback_probe.sql"),
  "utf8",
);

describe("Solo Setup persistence repair migration", () => {
  it("repairs the enum/text rollback and returns a canonical durable readback", () => {
    expect(migration).toContain("m.role::text");
    expect(migration).toContain("get_solo_setup_context");
    expect(migration).toContain("save_solo_setup_context");
    expect(migration).toContain("This brief changed in another session");
    expect(migration).toContain("businessRegistrationNumberLast4");
  });

  it("stores business ownership separately from Team authority", () => {
    expect(migration).toContain("create table if not exists public.tenant_business_owners");
    expect(migration).toContain("create table if not exists public.tenant_business_representatives");
    expect(migration).toContain("create table if not exists public.tenant_setup_private_context");
    expect(migration).toContain("ownership_interest numeric(5,2)");
    expect(migration).toContain("representative_user_id uuid");
    expect(migration).toContain("every designated representative must be an active Team member");
    expect(migration).not.toContain("insert into public.tenant_members");
    expect(migration).not.toContain("update public.tenant_members");
  });

  it("enforces the Owner/Admin permission split and least privilege", () => {
    expect(migration).toContain("owner_full");
    expect(migration).toContain("admin_operational");
    expect(migration).toContain("read_only");
    expect(migration).toContain("only the workspace Owner can change legal identity or business ownership");
    expect(migration).toContain("only the workspace Owner can adopt or override protected identity facts");
    expect(migration).toContain("solo_setup.admin_operational_saved");
    expect(migration).toContain("solo_setup_can_read");
    expect(migration).toContain("revoke all on table public.tenant_business_owners from public, anon, authenticated");
    expect(migration).toContain("revoke all on table public.tenant_legal_profile from authenticated");
    expect(migration).toContain("grant select(tenant_id,legal_business_name,website_url)");
    expect(migration).toContain("tm.status='active'");
    expect(migration).toContain('drop policy if exists "Tenant owners/admins write own legal profile"');
    expect(migration).toContain("revoke all on function public.save_solo_business_brief(jsonb,text,uuid) from public, anon, authenticated");
    expect(migration).toContain("grant execute on function public.save_solo_setup_context");
  });

  it("fails closed around PAIGE context, concurrency, and protected identifiers", () => {
    expect(migration).toContain("_expected_updated_at is null");
    expect(migration).toContain("choose the registration identifier");
    expect(migration).toContain("vault.create_secret(v_registration_raw");
    expect(migration).toContain("'authorizedRepresentativeUserId','representativeUserIds'");
    expect(migration).not.toContain("create or replace function public.get_paige_persona_context()");
    expect(migration).toContain("setup_provenance");
  });

  it("checks in a real-caller rollback proof for the full permission and privacy matrix", () => {
    for (const marker of ["owner readback", "admin save", "member write", "anonymous read", "cross-tenant write", "missing version", "Vault exact value", "private PAIGE projection", "customer-bound draft", "confirmed in Setup", "sensitive legal SELECT", "direct legal UPDATE", "first-use private contact readback", "first-use legal name durable readback", "inactive member safe legal SELECT", "legacy direct save EXECUTE"]) {
      expect(rollbackProbe).toContain(marker);
    }
  });

  it("keeps sensitive and ownership details out of audit payloads", () => {
    expect(migration).toContain("registration_number_present");
    expect(migration).not.toContain("'ownership_interest', bo.ownership_interest");
    expect(migration).not.toContain("'legal_name', bo.legal_name");
    expect(migration).not.toContain("paige_rail");
  });
});
