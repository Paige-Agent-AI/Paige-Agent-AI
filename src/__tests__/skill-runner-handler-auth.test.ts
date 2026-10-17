// @vitest-environment node
/** Actual incumbent handler + real authority/approval modules, with synthetic I/O ports only.
 * This is not hosted JWT cryptography, provider execution, or customer acceptance proof. */
import { webcrypto } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import ts from "typescript";
import * as governed from "../../supabase/functions/_shared/paige-skill/governed-adapter.ts";
import * as emailApproval from "../../supabase/functions/_shared/paige-skill/email-approval.ts";
import * as fingerprint from "../../supabase/functions/_shared/confirm-fingerprint.ts";
import * as browserAuthority from "../../supabase/functions/_shared/secure-browser-authority.ts";
import * as interpreterCore from "../../supabase/functions/_shared/skill-interpreter-core.ts";
import * as contactMethods from "../../supabase/functions/_shared/contact-methods.ts";
import * as businessVerify from "../../supabase/functions/_shared/business-verify-outcome.ts";

type Row = Record<string, unknown>;
const source = readFileSync("supabase/functions/skill-runner/index.ts", "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;

function fixture(options: { noWorkspace?: boolean; providerHeld?: boolean } = {}) {
  const writes: Array<{ table: string; operation: string; values: Row; filters: Row }> = [];
  const reads: Array<{ table: string; filters: Row }> = [];
  const decisions: governed.SkillGovernedInput[] = [];
  const tokens: string[] = [];
  let drafts = 0;
  let network = 0;
  let handler: ((req: Request) => Promise<Response>) | undefined;
  const contact = (id: string, tenant: string) => ({
    id, tenant_id: tenant, first_name: "Fixture", last_name: "Client",
    client_contact_methods: [{ kind: "email", value: "client@example.invalid", is_primary: true, position: 0 }],
  });
  const contacts = [contact("test-contact-a", "test-tenant-a"), contact("test-contact-b", "test-tenant-b")];
  const skill = { id: "test-skill", slug: "draft_and_email_document", status: "active", run_count: 0,
    success_count: 0, require_admin_confirm_first_n: 1, steps: [] };
  function from(table: string) {
    const filters: Row = {};
    let operation = "read";
    let values: Row = {};
    let result: Promise<{ data: Row | null; error: null }> | undefined;
    const perform = () => result ??= Promise.resolve().then(() => {
      if (operation !== "read") {
        writes.push({ table, operation, values, filters: { ...filters } });
        if (table === "paige_skill_runs" && operation === "insert") return { data: { id: "test-run" }, error: null };
        return { data: null, error: null };
      }
      reads.push({ table, filters: { ...filters } });
      if (table === "paige_skills") return { data: filters.slug === skill.slug ? skill : null, error: null };
      if (table === "profiles") return { data: filters.user_id === "test-owner-a"
        ? { active_tenant_id: options.noWorkspace ? null : "test-tenant-a" } : null, error: null };
      if (table === "clients") return { data: contacts.find(row => row.id === filters.id && row.tenant_id === filters.tenant_id) ?? null, error: null };
      throw new Error(`Unexpected fixture read ${table}`);
    });
    const query = {
      select: (_fields?: string) => query,
      eq: (key: string, value: unknown) => { filters[key] = value; return query; },
      is: (key: string, value: unknown) => { filters[key] = value; return query; },
      gt: (key: string, value: unknown) => { filters[`gt:${key}`] = value; return query; },
      not: (key: string, operator: string, value: unknown) => { filters[`not:${key}:${operator}`] = value; return query; },
      neq: (key: string, value: unknown) => { filters[`neq:${key}`] = value; return query; },
      insert: (row: Row) => { operation = "insert"; values = row; return query; },
      update: (row: Row) => { operation = "update"; values = row; return query; },
      maybeSingle: perform,
      single: perform,
      then: <T>(onfulfilled: (value: { data: Row | null; error: null }) => T) => perform().then(onfulfilled),
    };
    return query;
  }
  const admin = {
    from,
    auth: { getUser: async (token: string) => {
      tokens.push(token);
      return { data: { user: token === "test-owner-jwt" ? { id: "test-owner-a" } : null }, error: null };
    } },
    rpc: async (name: string, args: Row) => {
      if (name === "is_platform_owner" || name === "agency_can_manage_child") return { data: false, error: null };
      if (name === "is_tenant_admin_as") return { data: args._actor === "test-owner-a" && args._tenant === "test-tenant-a", error: null };
      if (name === "get_tenant_sender" && args._tenant_id === "test-tenant-a") return { data: { from_name: "Fixture Business", from_email: "sender@example.invalid" }, error: null };
      throw new Error(`Unexpected fixture RPC ${name}`);
    },
  };
  const forbidden = () => { throw new Error("Unexpected out-of-scope fixture path"); };
  const modules: Record<string, unknown> = {
    "https://esm.sh/@supabase/supabase-js@2.45.4": { createClient: () => admin },
    "../_shared/claude.ts": { gatewayCompat: async () => {
      drafts++;
      return Response.json({ choices: [{ message: { content: "<p>Protected offline draft</p>" } }] });
    } },
    "../_shared/comms-provider-boundary.ts": { commsProviderExecutionAllowed: async () => !options.providerHeld, COMMS_PROVIDER_EXECUTION_DISABLED: "COMMS_PROVIDER_EXECUTION_DISABLED" },
    "../_shared/platform-operator-tenant.ts": { platformOperatorTenantId: async () => null },
    "../_shared/prompt-forge.ts": { forge: forbidden },
    "../_shared/skill-interpreter.ts": { interpretSkill: forbidden },
    "../_shared/skill-interpreter-core.ts": interpreterCore,
    "../_shared/secure-browser-authority.ts": browserAuthority,
    "../_shared/paige-skill/governed-adapter.ts": { ...governed, decideSkillRun: (input: governed.SkillGovernedInput) => {
      decisions.push(input);
      return governed.decideSkillRun(input);
    } },
    "../_shared/paige-skill/email-approval.ts": emailApproval,
    "../_shared/confirm-fingerprint.ts": fingerprint,
    "../_shared/business-verify-outcome.ts": businessVerify,
    "../_shared/contact-methods.ts": contactMethods,
  };
  const load = (id: string) => {
    if (!(id in modules)) throw new Error(`Unexpected runtime import ${id}`);
    return modules[id];
  };
  const deno = {
    env: { get: (name: string) => ({ SUPABASE_URL: "https://fixture.invalid", SUPABASE_SERVICE_ROLE_KEY: "test-internal-service" } as Record<string, string>)[name] },
    serve: (fn: typeof handler) => { handler = fn; },
  };
  new Function("require", "exports", "Deno", "crypto", "fetch", compiled)(
    load, {}, deno, webcrypto, () => { network++; throw new Error("Network forbidden in protected handler fixture"); },
  );
  return {
    writes, reads, decisions, tokens,
    get drafts() { return drafts; },
    get network() { return network; },
    async invoke(token?: string, overrides: Row = {}) {
      if (!handler) throw new Error("Actual Deno.serve handler not captured");
      const response = await handler(new Request("https://fixture.invalid/functions/v1/skill-runner", {
        method: "POST", headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ skill_slug: skill.slug, contact_id: "test-contact-a", inputs: { doc_type: "summary", prompt: "Offline fixture" }, ...overrides }),
      }));
      return { status: response.status, body: await response.json() };
    },
  };
}

const effectWrites = (f: ReturnType<typeof fixture>) => f.writes.filter(w => w.table !== "paige_audit_log");

describe("skill-runner actual handler authentication ports (no provider effects)", () => {
  it.each([undefined, "forged-session", "expired-session"])("refuses absent/invalid credential %s before any proposal/run", async token => {
    const f = fixture();
    const result = await f.invoke(token, { tenant_id: "test-tenant-a", invoker_user_id: "test-owner-a", invoker_kind: "admin" });
    expect(result.status).toBe(403);
    expect(result.body).toMatchObject({ status: "refused", code: "unauthenticated" });
    expect(effectWrites(f)).toEqual([]);
    expect(f.drafts).toBe(0);
    expect(f.network).toBe(0);
  });

  it("ordinary authenticated owner reaches the existing exact-draft proposal through the real governed adapter", async () => {
    const f = fixture();
    const result = await f.invoke("test-owner-jwt");
    expect(result).toMatchObject({ status: 200, body: { status: "awaiting_confirm", requires_operator_approval: true, run_id: "test-run" } });
    expect(result.body.confirm_fingerprint).toMatch(/^[a-f0-9]{16}$/);
    expect(f.decisions[0]).toMatchObject({ authenticated: true, principal: "person", userId: "test-owner-a", tenantId: "test-tenant-a", autonomyLane: governed.SKILL_DEFAULT_LANE });
    expect(f.writes.find(w => w.table === "paige_pending_confirmations")?.values).toMatchObject({ user_id: "test-owner-a", tenant_id: "test-tenant-a", scoped_client_id: "test-contact-a", tool_name: "draft_and_email_document", fingerprint: result.body.confirm_fingerprint, args: { recipient: "client@example.invalid", fromHeader: "Fixture Business <sender@example.invalid>" } });
    expect(f.writes.find(w => w.table === "paige_skill_runs")?.values).toMatchObject({ status: "awaiting_confirm", invoker_user_id: "test-owner-a" });
    expect(f.writes.some(w => w.table === "communication_log")).toBe(false);
    expect(f.drafts).toBe(1);
    expect(f.network).toBe(0);
  });

  it("ignores body actor/workspace/admin claims and binds the proposal to verified identity", async () => {
    const f = fixture();
    const result = await f.invoke("test-owner-jwt", { tenant_id: "test-tenant-b", invoker_user_id: "test-owner-b", invoker_kind: "admin" });
    expect(result.body.status).toBe("awaiting_confirm");
    expect(f.decisions[0]).toMatchObject({ userId: "test-owner-a", tenantId: "test-tenant-a" });
    expect(f.writes.find(w => w.table === "paige_pending_confirmations")?.values).toMatchObject({ user_id: "test-owner-a", tenant_id: "test-tenant-a" });
    expect(f.network).toBe(0);
  });

  it("refuses a foreign contact before any draft/proposal/run, despite forged body authority", async () => {
    const f = fixture();
    const result = await f.invoke("test-owner-jwt", { contact_id: "test-contact-b", tenant_id: "test-tenant-b", invoker_user_id: "test-owner-b", invoker_kind: "admin" });
    expect(result).toMatchObject({ status: 403, body: { status: "refused", code: "contact_not_in_workspace" } });
    expect(f.reads.find(r => r.table === "clients")?.filters).toEqual({ id: "test-contact-b", tenant_id: "test-tenant-a" });
    expect(effectWrites(f)).toEqual([]);
    expect(f.drafts).toBe(0);
    expect(f.network).toBe(0);
  });

  it("refuses an unattended service credential even when it names an owner/admin", async () => {
    const f = fixture();
    const result = await f.invoke("test-internal-service", { tenant_id: "test-tenant-a", invoker_user_id: "test-owner-a", invoker_kind: "admin" });
    expect(result).toMatchObject({ status: 403, body: { status: "refused", code: "service_principal_may_not_mutate" } });
    expect(f.decisions[0]).toMatchObject({ principal: "service", authenticated: true });
    expect(f.tokens).toEqual([]);
    expect(effectWrites(f)).toEqual([]);
    expect(f.drafts).toBe(0);
    expect(f.network).toBe(0);
  });

  it("cannot select a workspace from the body when the verified account has none", async () => {
    const f = fixture({ noWorkspace: true });
    const result = await f.invoke("test-owner-jwt", { tenant_id: "test-tenant-a" });
    expect(result.body).toMatchObject({ status: "refused", code: "tenant_unresolved" });
    expect(effectWrites(f)).toEqual([]);
    expect(f.network).toBe(0);
  });

  it("preserves the existing provider refusal before drafting", async () => {
    const f = fixture({ providerHeld: true });
    const result = await f.invoke("test-owner-jwt");
    expect(result).toMatchObject({ status: 403, body: { status: "refused", code: "COMMS_PROVIDER_EXECUTION_DISABLED" } });
    expect(effectWrites(f)).toEqual([]);
    expect(f.drafts).toBe(0);
    expect(f.network).toBe(0);
  });

  it("a forged confirmation reaches the incumbent scoped CAS, never a provider send or receipt", async () => {
    const f = fixture();
    const result = await f.invoke("test-owner-jwt", { confirm_token: "forged-confirmation" });
    expect(result).toMatchObject({ status: 403, body: { status: "refused", code: "approval_not_valid" } });
    expect(f.writes).toContainEqual({ table: "paige_pending_confirmations", operation: "update", values: { consumed_at: expect.any(String) }, filters: {
      user_id: "test-owner-a", tenant_id: "test-tenant-a", fingerprint: "forged-confirmation",
      tool_name: "draft_and_email_document", consumed_at: null, "gt:expires_at": expect.any(String),
      "not:server_issued_at:is": null, "neq:issued_in_request": expect.any(String), "not:issued_in_request:is": null,
    } });
    expect(f.writes.some(w => w.table === "paige_skill_runs" || w.table === "communication_log")).toBe(false);
    expect(f.drafts).toBe(0);
    expect(f.network).toBe(0);
  });
});

describe("channel adapter type-only normalization", () => {
  it("preserves runtime when the actual attachment type import is normalized, without pinning unrelated future module behavior", () => {
    const path = "supabase/functions/_shared/channel-adapters.ts";
    const current = readFileSync(path, "utf8");
    const previousTypeSyntax = current
      .replace(/^import type \{ EmailAttachment \} from ["']\.\/email-attachments\.ts["'];\r?\n/m, "")
      .replace("serverAttachments?: EmailAttachment[];", "serverAttachments?: import('./email-attachments.ts').EmailAttachment[];");
    const emit = (text: string) => ts.transpileModule(text, {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, removeComments: true },
    }).outputText;
    expect(current).toMatch(/import type \{ EmailAttachment \} from ["']\.\/email-attachments\.ts["']/);
    expect(previousTypeSyntax).toContain("import('./email-attachments.ts').EmailAttachment");
    expect(emit(current)).toBe(emit(previousTypeSyntax));
    expect(emit(current)).not.toContain("email-attachments.ts");
    expect(emit("const runtime = import('./email-attachments.ts');")).toContain("import('./email-attachments.ts')");
  });
});
