import { readFileSync } from "node:fs";
import ts from "typescript";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// E09 Slice 6 round 4 (verifier MEDIUM 1). A legacy invitation that Paige HOLDS (the client turned email
// off, the business's quiet hours, or the check could not run) must not leave its freshly minted token live:
// otherwise both owner surfaces read "Invite pending" / "Cancel pending invitation" for an email that never
// went. This drives the REAL send-portal-invite handler against one in-memory token store shared with the
// two real owner surfaces, so what staff see is whatever the handler actually left behind.
// Synthetic contact and business only (§63).

type Row = Record<string, unknown>;
const s = vi.hoisted(() => ({
  tables: {} as Record<string, Array<Record<string, unknown>>>,
  handler: undefined as undefined | ((request: Request) => Promise<Response>),
  preSend: { proceed: false, outcome: "blocked_suppressed", reason: "opted out", queueUntil: null } as Record<string, unknown> | "throw",
  context: {} as Record<string, unknown>,
  toast: { success: (() => undefined) as (...a: unknown[]) => void, error: (() => undefined) as (...a: unknown[]) => void },
}));
const TENANT = "e0960000-0000-4000-8000-00000000b011", CONTACT = "e0960000-0000-4000-8000-00000000d011";
const ACTOR = "e0960000-0000-4000-8000-00000000a011", EMAIL = "jordan.rivera@example.test";

// One filtered query over the shared store — the subset of the PostgREST builder the three callers use.
function query(table: string) {
  const filters: Array<(row: Row) => boolean> = [];
  let patch: Row | null = null, single = false;
  const rows = () => (s.tables[table] ??= []).filter((row) => filters.every((f) => f(row)));
  const settle = () => {
    const hit = rows();
    if (patch) { for (const row of hit) Object.assign(row, patch); return { data: hit.map((r) => ({ id: r.id })), error: null }; }
    return { data: single ? hit[0] ?? null : hit, error: null };
  };
  const q: Record<string, unknown> = {
    select: () => q, order: () => q, limit: () => q,
    eq: (c: string, v: unknown) => { filters.push((r) => r[c] === v); return q; },
    is: (c: string, v: unknown) => { filters.push((r) => (r[c] ?? null) === v); return q; },
    gt: (c: string, v: string) => { filters.push((r) => String(r[c]) > v); return q; },
    update: (value: Row) => { patch = value; return q; },
    insert: (value: Row) => { (s.tables[table] ??= []).push(value); return Promise.resolve({ error: null }); },
    maybeSingle: async () => { single = true; return settle(); },
    then: (done: (v: unknown) => unknown, failed?: (e: unknown) => unknown) => Promise.resolve(settle()).then(done, failed),
  };
  return q;
}

vi.mock("sonner", () => ({ toast: { success: (...a: unknown[]) => s.toast.success(...a), error: (...a: unknown[]) => s.toast.error(...a) } }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: { getUser: async () => ({ data: { user: { id: s.context.activeUserId } }, error: null }) },
    from: (table: string) => query(table),
    rpc: async (name: string, args: Row) => {
      if (name !== "create_tenant_invite_token") throw Error("Unexpected RPC " + name);
      const token = "synthetic-token-" + ((s.tables.tenant_invite_tokens ?? []).length + 1);
      (s.tables.tenant_invite_tokens ??= []).push({ id: "invite-" + token, token, tenant_id: args._tenant_id, contact_id: args._contact_id,
        email: args._email, kind: args._kind, expires_at: "2099-01-01T00:00:00Z", created_at: "2026-10-18T12:00:00Z",
        revoked_at: null, uses: 0, max_uses: 1, last_used_at: null });
      return { data: [{ token }], error: null };
    },
    functions: {
      invoke: async (name: string, input: { body: unknown }) => {
        if (name !== "send-portal-invite") throw Error("Unexpected function " + name);
        const response = await s.handler!(new Request("https://invite.tests.invalid", { method: "POST",
          headers: { Authorization: "Bearer synthetic-local-only", "Content-Type": "application/json" }, body: JSON.stringify(input.body) }));
        return response.ok ? { data: await response.json(), error: null } : { data: null, error: { message: "Edge Function returned a non-2xx status code", context: response } };
      },
    },
  },
}));
vi.mock("@/hooks/useTenantContext", () => ({ useTenantContext: () => s.context }));
vi.mock("@/hooks/useTierFeatures", () => ({ useTierFeatures: () => ({ has: () => true }) }));
vi.mock("@/lib/functions/adminAccountActions", () => ({ callAdminAccountAction: vi.fn() }));
vi.mock("@/components/tenant-relationships/PortalInvitationCommand", () => ({ PortalInvitationCommand: () => <button type="button">Review invitation</button> }));

const { ContactPortalPanel } = await import("@/components/admin/contacts/ContactPortalPanel");
const { PortalInvitationManager } = await import("@/components/tenant-relationships/PortalInvitationManager");
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// The real handler, with only its four module boundaries replaced (same pattern as portal-invitation-sender).
const source = readFileSync("supabase/functions/send-portal-invite/index.ts", "utf8");
if ((source.match(/^import .*;\r?$/gm) ?? []).length !== 4) throw Error("Review the changed invitation module boundary");
const javascript = ts.transpileModule(source.replace(/^import .*;\r?\n/gm, ""), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
const fakeClient = () => ({
  auth: { getUser: async () => ({ data: { user: { id: ACTOR } }, error: null }) },
  rpc: async (name: string) => ({ data: name === "is_tenant_admin" || name === "comms_provider_execution_allowed" ? true
    : name === "resolve_tenant_brand" ? [{ tenant_name: "Test business" }] : null, error: null }),
  from: (table: string) => query(table),
});
const sends: unknown[] = [];
new Function("createClient", "commsProviderExecutionAllowed", "handlePortalInvitationCommand", "runPreSend", "Deno", "fetch", "console", javascript)(
  fakeClient, async () => true, () => { throw Error("legacy cases never enter the canonical command"); },
  async () => { if (s.preSend === "throw") throw Error("synthetic pre-send read unavailable"); return s.preSend; },
  { env: { get: (k: string) => ({ SUPABASE_URL: "https://test.supabase.co", SUPABASE_ANON_KEY: "anon", SUPABASE_SERVICE_ROLE_KEY: "service", RESEND_API_KEY: "synthetic" } as Row)[k] ?? "" },
    serve: (h: typeof s.handler) => { s.handler = h; } },
  async (...args: unknown[]) => { sends.push(args); return new Response(JSON.stringify({ id: "m" }), { status: 200 }); },
  { error: () => undefined },
);

let root: Root, host: HTMLDivElement;
const toastError = vi.fn(), toastSuccess = vi.fn(), writeText = vi.fn(async () => undefined);
async function flush() { await act(async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); }); }
beforeEach(() => {
  s.tables = {
    clients: [{ id: CONTACT, tenant_id: TENANT, status: "active", merged_into_contact_id: null, do_not_contact: false, linked_user_id: null }],
    client_contact_methods: [{ client_id: CONTACT, tenant_id: TENANT, kind: "email", is_primary: true, value: EMAIL }],
    tenant_invite_tokens: [], paige_signature_envelopes: [], email_send_log: [],
  };
  s.preSend = { proceed: false, outcome: "blocked_suppressed", reason: "opted out", queueUntil: null };
  s.context = { activeUserId: ACTOR, activeTenantId: TENANT, accountContextStatus: "ready", accountContextLoading: false };
  toastError.mockReset(); toastSuccess.mockReset(); writeText.mockClear(); sends.length = 0;
  s.toast = { success: toastSuccess, error: toastError };
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); });

async function sendFromPanel() {
  act(() => root.render(<ContactPortalPanel contactId={CONTACT} email={EMAIL} linkedUserId={null} />));
  await flush();
  const button = Array.from(host.querySelectorAll("button")).find((b) => b.textContent?.includes("Send invite"))!;
  expect(button).toBeTruthy();
  act(() => button.click()); await flush();
}
const accessSwitch = () => host.querySelector('[aria-label="Toggle Paige AI platform access"]')!;

describe("a held legacy invitation leaves nothing pending", () => {
  it("ContactPortalPanel: staff see the held message, and no pending invite, switch or history row", async () => {
    await sendFromPanel();
    expect(sends).toHaveLength(0);
    expect(toastError).toHaveBeenCalledWith(`${EMAIL} has email turned off or on hold, so Paige didn't send the invitation.`);
    expect(toastSuccess).not.toHaveBeenCalled(); expect(writeText).not.toHaveBeenCalled();
    expect(s.tables.tenant_invite_tokens).toHaveLength(1);
    expect(s.tables.tenant_invite_tokens[0].revoked_at).toEqual(expect.any(String));
    expect(host.textContent).not.toContain("Invite pending");
    expect(host.textContent).not.toMatch(/pending/i);
    expect(accessSwitch().getAttribute("aria-checked")).toBe("false");
    expect(host.textContent).toContain("Send invite");
  });

  it("ContactPortalPanel: the business's own quiet hours are named as the cause, not the client", async () => {
    s.preSend = { proceed: false, outcome: "queued_tenant_dnd", reason: "Held until your team's quiet hours end.", queueUntil: "2099-01-01T00:00:00Z" };
    await sendFromPanel();
    expect(toastError).toHaveBeenCalledTimes(1);
    const text = String(toastError.mock.calls[0][0]);
    expect(text).toMatch(/quiet hours/);
    expect(text).not.toContain(`${EMAIL} has email turned off`);
    expect(host.textContent).not.toContain("Invite pending");
  });

  it("ContactPortalPanel: a check that could not run is not blamed on the client, and nothing is offered to send by hand", async () => {
    s.preSend = "throw";
    await sendFromPanel();
    expect(sends).toHaveLength(0);
    expect(toastError).toHaveBeenCalledTimes(1);
    const text = String(toastError.mock.calls[0][0]);
    expect(text).not.toMatch(/turned off|quiet hours/);
    expect(text).toMatch(/couldn't check/i);
    expect(toastSuccess).not.toHaveBeenCalled(); expect(writeText).not.toHaveBeenCalled();
    expect(host.textContent).not.toContain("Invite pending");
  });

  it("PortalInvitationManager: the row the held send leaves behind reads canceled, with no cancel control", async () => {
    await sendFromPanel();
    const row = s.tables.tenant_invite_tokens[0];
    act(() => root.render(<PortalInvitationManager tenantId={TENANT}
      person={{ id: CONTACT, name: "Jordan Rivera", email: EMAIL, linkedUserId: null, status: "active", doNotContact: false } as never}
      latest={{ id: String(row.id), contact_id: CONTACT, email: EMAIL, created_at: String(row.created_at), expires_at: String(row.expires_at),
        revoked_at: (row.revoked_at as string | null) ?? null, last_used_at: null }}
      onReadback={async () => undefined} />));
    await flush();
    expect(host.textContent).not.toContain("Cancel pending invitation");
    expect(host.textContent).not.toContain("Latest invitation: pending");
    expect(host.textContent).toContain("Latest invitation: canceled");
  });

  it("an emailed invitation is untouched: still pending until accepted", async () => {
    s.preSend = { proceed: true, outcome: "proceed", reason: null, queueUntil: null };
    await sendFromPanel();
    expect(sends).toHaveLength(1);
    expect(s.tables.tenant_invite_tokens[0].revoked_at).toBeNull();
    expect(host.textContent).toContain("Invite pending");
  });
});
