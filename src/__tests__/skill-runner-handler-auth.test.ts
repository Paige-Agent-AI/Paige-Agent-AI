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

function fixture(options: {
  noWorkspace?: boolean; providerHeld?: boolean; browser?: boolean; notMember?: boolean;
  authError?: boolean; authThrows?: boolean; revokedAfterFirstCheck?: boolean; roleRevokedAfterFirstCheck?: boolean;
  workspaceChangedAfterFirstCheck?: boolean; inactiveSkill?: boolean;
} = {}) {
  const writes: Array<{ table: string; operation: string; values: Row; filters: Row }> = [];
  const reads: Array<{ table: string; filters: Row }> = [];
  const decisions: governed.SkillGovernedInput[] = [];
  const tokens: string[] = [];
  const interpreterCalls: Array<Row> = [];
  let roleChecks = 0;
  let workspaceChecks = 0;
  let drafts = 0;
  let network = 0;
  let handler: ((req: Request) => Promise<Response>) | undefined;
  const contact = (id: string, tenant: string) => ({
    id, tenant_id: tenant, first_name: "Fixture", last_name: "Client",
    client_contact_methods: [{ kind: "email", value: "client@example.invalid", is_primary: true, position: 0 }],
  });
  const contacts = [contact("test-contact-a", "test-tenant-a"), contact("test-contact-b", "test-tenant-b")];
  const skill = { id: "test-skill", slug: options.browser ? "browse_public_url" : "draft_and_email_document", status: options.inactiveSkill ? "disabled" : "active", run_count: 0,
    success_count: 0, require_admin_confirm_first_n: 1,
    allowed_tools: options.browser ? ["browser"] : [], steps: options.browser ? [{ tool: "browser", mode: "public" }] : [] };
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
      if (table === "profiles") {
        workspaceChecks++;
        return { data: filters.user_id === "test-owner-a"
          ? { active_tenant_id: options.noWorkspace ? null
            : options.workspaceChangedAfterFirstCheck && workspaceChecks > 1 ? "test-tenant-b" : "test-tenant-a" } : null, error: null };
      }
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
      if (options.authThrows) throw new Error("Protected Auth port unavailable");
      const valid = token === "test-owner-jwt" && !(options.revokedAfterFirstCheck && tokens.length > 1);
      return { data: { user: valid ? { id: "test-owner-a" } : null }, error: options.authError ? { message: "Invalid session" } : null };
    } },
    rpc: async (name: string, args: Row) => {
      if (name === "is_platform_owner" || name === "agency_can_manage_child") return { data: false, error: null };
      if (name === "is_tenant_admin_as") {
        roleChecks++;
        return { data: !options.notMember && !(options.roleRevokedAfterFirstCheck && roleChecks > 1)
          && args._actor === "test-owner-a" && (args._tenant === "test-tenant-a"
            || options.workspaceChangedAfterFirstCheck && args._tenant === "test-tenant-b"), error: null };
      }
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
    "../_shared/skill-interpreter.ts": { interpretSkill: async (_deps: unknown, args: Row) => {
      if (!options.browser) return forbidden();
      interpreterCalls.push(args);
      // Strict port boundary: no browse/model/provider work. This is not native interpreter proof.
      return { status: "needs_config", outputs: {}, steps_log: [], error: "Protected fixture: browser execution held" };
    } },
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
    writes, reads, decisions, tokens, interpreterCalls,
    get drafts() { return drafts; },
    get network() { return network; },
    async invoke(token?: string, overrides: Row = {}, method = "POST") {
      if (!handler) throw new Error("Actual Deno.serve handler not captured");
      const response = await handler(new Request("https://fixture.invalid/functions/v1/skill-runner", {
        method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ skill_slug: skill.slug, contact_id: "test-contact-a", inputs: { doc_type: "summary", prompt: "Offline fixture" }, ...overrides }),
      }));
      return { status: response.status, body: method === "OPTIONS" ? await response.text() : await response.json() };
    },
  };
}

const effectWrites = (f: ReturnType<typeof fixture>) => f.writes.filter(w => w.table !== "paige_audit_log");

describe("skill-runner actual handler authentication ports (no provider effects)", () => {
  it.each([undefined, "forged-session", "expired-session"])("refuses absent/invalid credential %s before any proposal/run", async token => {
    const f = fixture();
    const result = await f.invoke(token, { tenant_id: "test-tenant-a", invoker_user_id: "test-owner-a", invoker_kind: "admin" });
    expect(result.status).toBe(401);
    expect(result.body).toMatchObject({ status: "refused", code: "unauthenticated" });
    expect(f.reads).toEqual([]);
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
    expect(f.decisions[0]).toMatchObject({ principal: "service", authenticated: true, userId: null });
    expect(f.writes.find(w => w.table === "paige_audit_log")?.values).toMatchObject({ actor_user_id: null });
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

describe("skill-runner browser-enabled actual handler authentication before privileged lookup", () => {
  it.each([undefined, "forged-session", "expired-session", "revoked-session", "test-internal-service-forged"])(
    "returns401 for credential %s before registry/contact/run/provider access", async token => {
      const f = fixture({ browser: true });
      const result = await f.invoke(token, { tenant_id: "test-tenant-a", invoker_user_id: "test-owner-a", invoker_kind: "admin" });
      expect(result).toMatchObject({ status: 401, body: { status: "refused", code: "unauthenticated" } });
      expect(f.reads).toEqual([]);
      expect(effectWrites(f)).toEqual([]);
      expect(f.interpreterCalls).toEqual([]);
      expect(f.drafts).toBe(0);
      expect(f.network).toBe(0);
    },
  );

  it.each([{ authError: true }, { authThrows: true }])("fails closed on Auth error %j even if a user field is present", async options => {
    const f = fixture({ browser: true, ...options });
    const result = await f.invoke("test-owner-jwt");
    expect(result).toMatchObject({ status: 401, body: { code: "unauthenticated" } });
    expect(f.reads).toEqual([]);
    expect(effectWrites(f)).toEqual([]);
    expect(f.interpreterCalls).toEqual([]);
    expect(f.network).toBe(0);
  });

  it("refuses the exact unattended service principal before browser resolution or registry access, despite owner labels", async () => {
    const f = fixture({ browser: true });
    const result = await f.invoke("test-internal-service", { tenant_id: "test-tenant-a", invoker_user_id: "test-owner-a", invoker_kind: "admin" });
    expect(result).toMatchObject({ status: 403, body: { code: "service_principal_may_not_mutate" } });
    expect(f.decisions[0]).toMatchObject({ principal: "service", authenticated: true, userId: null });
    expect(f.writes.find(w => w.table === "paige_audit_log")?.values).toMatchObject({ actor_user_id: null });
    expect(f.reads).toEqual([]);
    expect(f.tokens).toEqual([]);
    expect(effectWrites(f)).toEqual([]);
    expect(f.interpreterCalls).toEqual([]);
    expect(f.network).toBe(0);
  });

  it.each([{ notMember: true }, { roleRevokedAfterFirstCheck: true }])("refuses current nonmember/revoked browser authority %j before contact or effects", async options => {
    const f = fixture({ browser: true, ...options });
    const result = await f.invoke("test-owner-jwt", { invoker_kind: "admin", invoker_user_id: "test-owner-b" });
    expect(result).toMatchObject({ status: 403, body: { code: "browser_actor_not_authorized" } });
    expect(f.reads.some(r => r.table === "clients")).toBe(false);
    expect(effectWrites(f)).toEqual([]);
    expect(f.interpreterCalls).toEqual([]);
    expect(f.network).toBe(0);
  });

  it("returns401 if the verified session is revoked before the stricter browser authority resolves", async () => {
    const f = fixture({ browser: true, revokedAfterFirstCheck: true });
    const result = await f.invoke("test-owner-jwt");
    expect(result).toMatchObject({ status: 401, body: { code: "browser_session_invalid" } });
    expect(f.reads.some(r => r.table === "clients")).toBe(false);
    expect(effectWrites(f)).toEqual([]);
    expect(f.interpreterCalls).toEqual([]);
    expect(f.network).toBe(0);
  });

  it("valid ordinary owner reaches only the held interpreter port with server-derived workspace and actor", async () => {
    const f = fixture({ browser: true });
    const result = await f.invoke("test-owner-jwt", { tenant_id: "test-tenant-b", invoker_user_id: "test-owner-b", invoker_kind: "system" });
    expect(result).toMatchObject({ status: 200, body: { status: "cancelled", outputs: { interpreter_status: "needs_config" } } });
    expect(f.interpreterCalls).toHaveLength(1);
    expect(f.interpreterCalls[0]).toMatchObject({ actorUserId: "test-owner-a", tenantId: "test-tenant-a", actorRole: "admin" });
    expect(f.writes.find(w => w.table === "paige_skill_runs" && w.operation === "insert")?.values)
      .toMatchObject({ invoker_user_id: "test-owner-a", invoker_kind: "admin" });
    expect(f.drafts).toBe(0);
    expect(f.network).toBe(0);
  });

  it("cannot resolve a missing active workspace from a browser request body", async () => {
    const f = fixture({ browser: true, noWorkspace: true });
    const result = await f.invoke("test-owner-jwt", { tenant_id: "test-tenant-b" });
    expect(result).toMatchObject({ status: 403, body: { code: "tenant_unresolved" } });
    expect(f.reads.some(r => r.table === "paige_skills" || r.table === "clients")).toBe(false);
    expect(effectWrites(f)).toEqual([]);
    expect(f.interpreterCalls).toEqual([]);
    expect(f.network).toBe(0);
  });

  it("refuses a foreign browser contact using only the current server workspace", async () => {
    const f = fixture({ browser: true });
    const result = await f.invoke("test-owner-jwt", { contact_id: "test-contact-b", tenant_id: "test-tenant-b" });
    expect(result).toMatchObject({ status: 403, body: { code: "browser_contact_not_available" } });
    expect(f.reads.find(r => r.table === "clients")?.filters).toEqual({ id: "test-contact-b", tenant_id: "test-tenant-a" });
    expect(effectWrites(f)).toEqual([]);
    expect(f.interpreterCalls).toEqual([]);
    expect(f.network).toBe(0);
  });

  it("refuses a real workspace switch between credential and browser authority resolution, without replay", async () => {
    const f = fixture({ browser: true, workspaceChangedAfterFirstCheck: true });
    const result = await f.invoke("test-owner-jwt", { contact_id: undefined });
    expect(result).toMatchObject({ status: 403, body: { code: "browser_workspace_changed" } });
    expect(effectWrites(f)).toEqual([]);
    expect(f.interpreterCalls).toEqual([]);
    expect(f.network).toBe(0);
  });

  it("does not expose whether a requested skill exists before session authentication", async () => {
    const f = fixture({ browser: true });
    const result = await f.invoke("forged-session", { skill_slug: "unknown-synthetic-skill" });
    expect(result).toMatchObject({ status: 401, body: { code: "unauthenticated" } });
    expect(f.reads).toEqual([]);
    expect(effectWrites(f)).toEqual([]);
    expect(f.network).toBe(0);
  });

  it("keeps authenticated unknown and inactive skill responses, with no execution", async () => {
    const unknown = fixture({ browser: true });
    expect(await unknown.invoke("test-owner-jwt", { skill_slug: "unknown-synthetic-skill" }))
      .toMatchObject({ status: 404 });
    const inactive = fixture({ browser: true, inactiveSkill: true });
    expect(await inactive.invoke("test-owner-jwt")).toMatchObject({ status: 409 });
    for (const f of [unknown, inactive]) {
      expect(f.tokens).toEqual(["test-owner-jwt"]);
      expect(effectWrites(f)).toEqual([]);
      expect(f.interpreterCalls).toEqual([]);
      expect(f.network).toBe(0);
    }
  });

  it("preserves credential-free CORS preflight without privileged reads or effects", async () => {
    const f = fixture({ browser: true });
    expect(await f.invoke(undefined, {}, "OPTIONS")).toEqual({ status: 200, body: "ok" });
    expect(f.tokens).toEqual([]);
    expect(f.reads).toEqual([]);
    expect(f.writes).toEqual([]);
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
