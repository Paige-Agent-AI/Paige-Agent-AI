import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");

function identityMigration(): string {
  const dir = join(root, "supabase", "migrations");
  const name = readdirSync(dir).find((file) => file.endsWith("_client_identity_contract.sql"));
  expect(name, "client identity migration must exist").toBeTruthy();
  return readFileSync(join(dir, name!), "utf8");
}

describe("immutable tenant-scoped client identity contract", () => {
  it("fails closed on tenantless history and makes tenant/reference mandatory", () => {
    const sql = identityMigration();
    expect(sql).toMatch(/historical_client_missing_tenant/i);
    expect(sql).toMatch(/ALTER COLUMN tenant_id SET NOT NULL/i);
    expect(sql).toMatch(/ALTER COLUMN account_number SET NOT NULL/i);
  });

  it("allocates nonsequential CLT references and makes identity immutable", () => {
    const sql = identityMigration();
    expect(sql).toMatch(/CLT-/);
    expect(sql).toMatch(/gen_random_uuid\(\)/i);
    expect(sql).toMatch(/client_identity_immutable/i);
    expect(sql).toMatch(/OLD\.tenant_id IS DISTINCT FROM NEW\.tenant_id/i);
    expect(sql).toMatch(/OLD\.account_number IS DISTINCT FROM NEW\.account_number/i);
  });

  it("server-derives JWT tenant and scopes deduplication to that tenant", () => {
    const sql = identityMigration();
    expect(sql).toMatch(/CASE\s+WHEN auth\.uid\(\) IS NOT NULL[\s\S]*current_user_tenant_id\(\)/i);
    expect(sql).toMatch(/WHERE tenant_id = _tenant[\s\S]*lower\(email\)/i);
  });

  it("gives Paige safe references instead of raw client UUIDs", () => {
    const chat = read("supabase/functions/paige-ai-chat/index.ts");
    expect(chat).toContain("client_ref");
    expect(chat).toContain("resolveClientReference");
    expect(chat).not.toContain("Use to resolve names/emails to client_id");
    expect(chat).not.toMatch(/contacts:\s*data\s*\|\|\s*\[\]/);
  });

  it("keeps MCP contact reads tenant-scoped and metadata-limited", () => {
    const mcp = read("supabase/functions/paige-mcp/index.ts");
    expect(mcp).toContain("client_ref");
    // A contact's addresses are read through its contact methods, never the single legacy pair.
    expect(mcp).toContain(".select(`account_number, first_name, last_name, entity_name, lifecycle_stage, status, source, tags, last_contacted_at, created_at, updated_at, ${CONTACT_METHOD_SELECT}`)");
    expect(mcp).toContain('const CONTACT_METHOD_SELECT = "client_contact_methods(kind, value, label, is_primary, position)";');
  });

  it("routes authenticated manual creates through the server contract", () => {
    for (const file of [
      "src/components/admin/contacts/NewContactDialog.tsx",
      "src/components/dashboard/AddInternalClientDialog.tsx",
      "src/components/dashboard/ClientManagementDashboard.tsx",
    ]) {
      const source = read(file);
      expect(source, file).toContain('.rpc("create_contact"');
    }
  });
});

// ── Phase 2 · P2.1: the contact-create outcome signal (create_contact_v2) ──────────
// The §947 fix at its root: create_contact returns an EXISTING row id on an exact-email
// match WITHOUT inserting, indistinguishable (RETURNS uuid) from a genuine insert — so every
// downstream honesty surface (Rail, receipt, Paige's words) is forced to guess "created".
// create_contact_v2 returns was_created so the caller can classify truthfully; create_contact
// is reduced to a scalar shim delegating to it, so the other consumers stay byte-compatible.
function outcomeSignalMigration(): string {
  const dir = join(root, "supabase", "migrations");
  const name = readdirSync(dir).find((file) => file.endsWith("_contact_create_outcome_signal.sql"));
  expect(name, "contact-create outcome-signal migration must exist").toBeTruthy();
  return readFileSync(join(dir, name!), "utf8");
}

describe("contact-create outcome signal (create_contact_v2)", () => {
  it("defines create_contact_v2 returning an inserted-vs-existing signal", () => {
    const sql = outcomeSignalMigration();
    expect(sql).toMatch(/FUNCTION\s+public\.create_contact_v2\s*\(/i);
    // returns the signal + the public-safe reference, resolved inside the transaction
    expect(sql).toMatch(/RETURNS\s+TABLE\s*\([^)]*was_created\s+boolean/i);
    expect(sql).toMatch(/RETURNS\s+TABLE\s*\([^)]*client_ref\s+text/i);
  });

  it("keeps the §9 tenant derivation and tenant-scoped email dedup inside v2", () => {
    const sql = outcomeSignalMigration();
    expect(sql).toMatch(/CASE\s+WHEN auth\.uid\(\) IS NOT NULL[\s\S]*current_user_tenant_id\(\)/i);
    expect(sql).toMatch(/WHERE tenant_id = _tenant[\s\S]*lower\(email\)/i);
    // the role + active-membership gates survive the rewrite
    expect(sql).toMatch(/CONTACT_NO_OPERATOR/);
    expect(sql).toMatch(/CONTACT_NO_TENANT/);
    expect(sql).toMatch(/CONTACT_FORBIDDEN/);
  });

  it("classifies by what it POSITIVELY knows — existing ⇒ false, insert ⇒ true (#947)", () => {
    const sql = outcomeSignalMigration();
    // a resolved-existing row (short-circuit AND unique_violation fallback) is NOT a create
    expect(sql).toMatch(/was_created\s*:?=\s*false/i);
    // a genuine INSERT ... RETURNING path is the only true
    expect(sql).toMatch(/was_created\s*:?=\s*true/i);
    expect(sql).toMatch(/INSERT INTO public\.clients[\s\S]*RETURNING/i);
  });

  it("reduces create_contact to a scalar shim delegating to v2 (one home, byte-compatible)", () => {
    const sql = outcomeSignalMigration();
    expect(sql).toMatch(/FUNCTION\s+public\.create_contact\s*\([\s\S]*RETURNS\s+uuid/i);
    expect(sql).toMatch(/SELECT\s+contact_id\s+FROM\s+public\.create_contact_v2/i);
  });

  it("locks v2 grants to authenticated + service_role, never anon/PUBLIC (§9)", () => {
    const sql = outcomeSignalMigration();
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION public\.create_contact_v2[\s\S]*FROM PUBLIC, anon/i);
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION public\.create_contact_v2[\s\S]*TO authenticated, service_role/i);
  });
});
