import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
// The edge helper is pure (no Deno imports, the client is injected), so vitest exercises the
// real logic that every inbound channel now uses to recognise a contact.
import {
  addClientAddresses,
  CLIENT_CONTACT_METHODS_EMBED,
  clientAddresses,
  contactMethodMatchKey,
  findClientIdByAddress,
  findFirstClientByEmailAnyWorkspace,
  findSoleClientByEmailAnyWorkspace,
  createClientWithContactMethods,
  insertClientWithAddresses,
  isMatchableAddress,
  primaryContactMethod,
  withPrimaryAddresses,
} from "../../supabase/functions/_shared/contact-methods";
import {
  ContactMethodsWriteError,
  deleteUserContactMethods,
  phoneNotSavedMessage,
  phoneOrAddressText,
  primaryPhonesForUsers,
  setUserPrimaryAddress,
} from "../../supabase/functions/_shared/user-contact-methods";
import { upsertContactMirror } from "../../supabase/functions/paige-bridge/contact-mirror";

afterEach(() => vi.restoreAllMocks());

describe("contact-method match key", () => {
  it("matches the database's rule on the vectors its SQL proof uses", () => {
    // supabase/tests/contact_methods.sql asserts the same key for the same stored number.
    expect(contactMethodMatchKey("phone", "+1 (555) 010-0101")).toBe("5550100101");
    expect(contactMethodMatchKey("phone", "15550100101")).toBe("5550100101");
    expect(contactMethodMatchKey("email", " ADA@a.tests.invalid ")).toBe("ada@a.tests.invalid");
  });

  it("only looks up plausible addresses", () => {
    expect(isMatchableAddress("email", "person@example.test")).toBe(true);
    expect(isMatchableAddress("email", "not an email")).toBe(false);
    expect(isMatchableAddress("phone", "555-0101")).toBe(true);
    expect(isMatchableAddress("phone", "12")).toBe(false);
    expect(isMatchableAddress("email", null)).toBe(false);
  });

  it("reads the primary of a kind, and none when the contact holds none", () => {
    const methods = [
      { kind: "email" as const, value: "second@example.test", is_primary: false },
      { kind: "email" as const, value: "first@example.test", is_primary: true },
    ];
    expect(primaryContactMethod(methods, "email")).toBe("first@example.test");
    expect(primaryContactMethod(methods, "phone")).toBeNull();
    expect(primaryContactMethod(undefined, "email")).toBeNull();
  });
});

describe("finding a contact inside one workspace", () => {
  it("asks the database for the contact holding the address as ANY of its methods, as bound parameters", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: "contact-1", error: null });
    const id = await findClientIdByAddress({ rpc, from: vi.fn() }, "tenant-a", "email", "Second@Example.test", "test");
    expect(id).toBe("contact-1");
    expect(rpc).toHaveBeenCalledWith("client_id_for_address", {
      _tenant_id: "tenant-a", _kind: "email", _value: "Second@Example.test",
    });
  });

  it("never looks up without a workspace or with an unmatchable address", async () => {
    const rpc = vi.fn();
    expect(await findClientIdByAddress({ rpc, from: vi.fn() }, "", "email", "a@b.test", "test")).toBeNull();
    expect(await findClientIdByAddress({ rpc, from: vi.fn() }, "tenant-a", "phone", "12", "test")).toBeNull();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("reports a failed lookup loudly and treats it as no match, never as a match", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { code: "42501", message: "denied" } });
    expect(await findClientIdByAddress({ rpc, from: vi.fn() }, "tenant-a", "email", "a@b.test", "handle-inbound-email")).toBeNull();
    expect(error).toHaveBeenCalledWith("[handle-inbound-email] contact_address_lookup_failed", expect.objectContaining({ code: "42501" }));
  });
});

function methodsTable(rows: Array<{ client_id: string; tenant_id: string }>) {
  const calls: Array<[string, unknown]> = [];
  const chain = {
    select: (cols: string) => { calls.push(["select", cols]); return chain; },
    eq: (col: string, value: unknown) => { calls.push([col, value]); return chain; },
    limit: (n: number) => { calls.push(["limit", n]); return Promise.resolve({ data: rows.slice(0, n), error: null }); },
  };
  return { client: { rpc: vi.fn(), from: vi.fn(() => chain) }, calls };
}

describe("finding a contact when the caller knows no workspace (provider webhooks)", () => {
  it("matches on the address key, whichever of the contact's addresses it is", async () => {
    const { client, calls } = methodsTable([{ client_id: "c1", tenant_id: "t1" }]);
    expect(await findSoleClientByEmailAnyWorkspace(client, " Ada@Example.test", "test")).toEqual({ id: "c1", tenant_id: "t1" });
    expect(client.from).toHaveBeenCalledWith("client_contact_methods");
    expect(calls).toContainEqual(["kind", "email"]);
    expect(calls).toContainEqual(["match_key", "ada@example.test"]);
  });

  it("keeps the sole-match callers' rule: an address two contacts hold is no match", async () => {
    const { client } = methodsTable([{ client_id: "c1", tenant_id: "t1" }, { client_id: "c2", tenant_id: "t2" }]);
    expect(await findSoleClientByEmailAnyWorkspace(client, "ada@example.test", "test")).toBeNull();
  });

  it("keeps the first-match callers' rule", async () => {
    const { client } = methodsTable([{ client_id: "c1", tenant_id: "t1" }, { client_id: "c2", tenant_id: "t2" }]);
    expect(await findFirstClientByEmailAnyWorkspace(client, "ada@example.test", "test")).toEqual({ id: "c1", tenant_id: "t1" });
  });
});

// ── Reading a contact's addresses with the contact ───────────────────────────────────────────────

const embedded = {
  id: "c1",
  first_name: "Ada",
  client_contact_methods: [
    { kind: "phone", value: "555-0102", label: null, is_primary: false, position: 1 },
    { kind: "email", value: "second@example.test", label: "Work", is_primary: false, position: 1 },
    { kind: "phone", value: "555-0101", label: null, is_primary: true, position: 0 },
    { kind: "email", value: "first@example.test", label: null, is_primary: true, position: 0 },
  ],
};

describe("a contact read with its contact methods", () => {
  it("embeds the methods through the contact's own relationship", () => {
    expect(CLIENT_CONTACT_METHODS_EMBED).toBe("client_contact_methods(kind,value,label,is_primary,position)");
  });

  it("reads the PRIMARY of each kind, and every address in the owner's order", () => {
    expect(clientAddresses(embedded)).toEqual({
      email: "first@example.test",
      phone: "555-0101",
      emails: ["first@example.test", "second@example.test"],
      phones: ["555-0101", "555-0102"],
    });
    expect(clientAddresses({ client_contact_methods: [] })).toEqual({ email: null, phone: null, emails: [], phones: [] });
    expect(clientAddresses(null)).toEqual({ email: null, phone: null, emails: [], phones: [] });
  });

  it("hands single-address readers the primary as `email` / `phone`, without the embed", () => {
    expect(withPrimaryAddresses(embedded)).toEqual({
      id: "c1", first_name: "Ada", email: "first@example.test", phone: "555-0101",
    });
    expect(withPrimaryAddresses(null)).toBeNull();
  });
});

// ── Writing a contact's addresses ────────────────────────────────────────────────────────────────

describe("adding addresses to a contact", () => {
  it("sends every non-blank address to the append helper, trimmed, marking only what was asked", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: [], error: null });
    const out = await addClientAddresses({ rpc, from: vi.fn() }, "t1", "c1", [
      { kind: "email", value: " new@example.test " },
      { kind: "phone", value: "   " },
      { kind: "phone", value: null },
      { kind: "phone", value: "555-0103", is_primary: true },
    ], "test");
    expect(out).toEqual({ error: null });
    expect(rpc).toHaveBeenCalledWith("_add_client_contact_methods", {
      _tenant_id: "t1",
      _client_id: "c1",
      _methods: [
        { kind: "email", value: "new@example.test" },
        { kind: "phone", value: "555-0103", is_primary: true },
      ],
    });
  });

  it("does nothing when there is nothing to add", async () => {
    const rpc = vi.fn();
    expect(await addClientAddresses({ rpc, from: vi.fn() }, "t1", "c1", [{ kind: "email", value: "" }], "test")).toEqual({ error: null });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("reports a refused write loudly and returns it", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { code: "23505", message: "CONTACT_METHOD_TAKEN" } });
    const out = await addClientAddresses({ rpc, from: vi.fn() }, "t1", "c1", [{ kind: "email", value: "a@b.test" }], "growth-inbound");
    expect(out.error).toEqual({ code: "23505", message: "CONTACT_METHOD_TAKEN" });
    expect(log).toHaveBeenCalledWith("[growth-inbound] contact_address_write_failed", expect.objectContaining({ code: "23505" }));
  });
});

function clientsTable(opts: { insert?: { data: unknown; error: unknown }; undo?: { error: unknown } } = {}) {
  const calls: Array<[string, ...unknown[]]> = [];
  const from = vi.fn((table: string) => {
    const chain: Record<string, (...args: unknown[]) => unknown> = {};
    chain.insert = (row: unknown) => { calls.push(["insert", table, row]); return chain; };
    chain.select = (cols: unknown) => { calls.push(["select", cols]); return chain; };
    chain.single = () => Promise.resolve(opts.insert ?? { data: { id: "new-client" }, error: null });
    chain.delete = () => { calls.push(["delete", table]); return chain; };
    chain.eq = (col: unknown, value: unknown) => {
      calls.push(["eq", col, value]);
      return col === "tenant_id" ? Promise.resolve(opts.undo ?? { error: null }) : chain;
    };
    return chain;
  });
  return { from, calls };
}

describe("creating a contact from its first addresses", () => {
  const row = { tenant_id: "t1", created_by: "u1", first_name: "Ada", last_name: "", source: "inbound_email" };
  const { tenant_id: _t, ...fields } = row;

  it("creates the contact and its addresses in ONE database call, so a refused address leaves nothing behind", async () => {
    const { from, calls } = clientsTable();
    const rpc = vi.fn().mockResolvedValue({ data: "new-client", error: null });
    const out = await insertClientWithAddresses({ rpc, from }, row, { email: " ada@example.test ", phone: "555-0101" }, "test");
    expect(out).toEqual({ data: { id: "new-client" }, error: null });
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("_create_client_with_contact_methods", {
      _tenant_id: "t1",
      _client: fields,
      _methods: [{ kind: "email", value: "ada@example.test" }, { kind: "phone", value: "555-0101" }],
    });
    // No separate insert that commits (and fires contact.created) before the addresses exist, and
    // no delete to undo it.
    expect(from).not.toHaveBeenCalled();
    expect(calls).toEqual([]);
  });

  it("skips a blank address rather than sending it", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: "new-client", error: null });
    await insertClientWithAddresses({ rpc, from: vi.fn() }, row, { email: "ada@example.test", phone: "  " }, "test");
    expect(rpc.mock.calls[0][1]._methods).toEqual([{ kind: "email", value: "ada@example.test" }]);
  });

  it("refuses a row that still carries an address column", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const rpc = vi.fn();
    const out = await insertClientWithAddresses({ rpc, from: vi.fn() }, { ...row, email: "ada@example.test" }, {}, "test");
    expect(out.data).toBeNull();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("passes the database's refusal on unchanged, so a caller can tell a taken address from any other failure", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { code: "23505", message: "CONTACT_METHOD_TAKEN" } });
    const from = vi.fn();
    const out = await insertClientWithAddresses({ rpc, from }, row, { email: "ada@example.test" }, "public-booking");
    expect(out).toEqual({ data: null, error: { code: "23505", message: "CONTACT_METHOD_TAKEN" } });
    expect(from).not.toHaveBeenCalled();
  });

  it("reports a create that returned no id as a failure", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const rpc = vi.fn().mockResolvedValue({ data: null, error: null });
    const out = await insertClientWithAddresses({ rpc, from: vi.fn() }, row, { email: "ada@example.test" }, "test");
    expect(out.data).toBeNull();
    expect(out.error?.message).toMatch(/no id/);
  });

  it("creates a contact with a whole first list — labels, several of a kind, a marked primary — in the same one call", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: "new-client", error: null });
    const from = vi.fn();
    const list = [
      { kind: "email" as const, value: "ada@example.test", label: "Work" },
      { kind: "email" as const, value: "ada.home@example.test", label: "Home", is_primary: true },
      { kind: "phone" as const, value: "555-010-0101", label: null },
    ];
    const out = await createClientWithContactMethods({ rpc, from }, row, list, "test");
    expect(out).toEqual({ data: { id: "new-client" }, error: null });
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("_create_client_with_contact_methods", { _tenant_id: "t1", _client: fields, _methods: list });
    expect(from).not.toHaveBeenCalled();
  });
});

// ── Paige's MCP create_contact and the paige-bridge contact mirror ───────────────────────────────

describe("Paige's MCP create_contact creates a contact and its addresses together", () => {
  const source = readFileSync("supabase/functions/paige-mcp/index.ts", "utf8");
  const create = source.slice(source.indexOf('mcp.tool("create_contact"'), source.indexOf('mcp.tool("update_contact"'));

  it("goes through the one-transaction create, never an insert followed by an address write", () => {
    expect(create).toContain("await createClientWithContactMethods(");
    expect(create).toContain('admin, { ...row, tenant_id }, methods, "paige-mcp create_contact"');
    expect(create).not.toMatch(/from\("clients"\)\s*\.(insert|upsert)\(/);
    expect(create).not.toMatch(/_replace_client_contact_methods|_add_client_contact_methods/);
    // A contact that was never created is never reported as created-without-addresses.
    expect(create).not.toContain("CONTACT_CREATED_WITHOUT_ADDRESSES");
    // The row carries no workspace of its own: it is the resolved tenant, or no contact.
    expect(create).toContain('if (!tenant_id) return err("tenant_not_resolved");');
    expect(create.slice(create.indexOf("const row: Record<string, unknown> = {"), create.indexOf("createClientWithContactMethods("))).not.toMatch(/^\s*tenant_id,$/m);
  });
});

type MirrorCall = { table: string; op: string; payload?: unknown; filters: Array<[string, unknown]> };

// A stand-in for the service client paige-bridge holds: `clients` answers the ghl-id lookup,
// client_id_for_address answers the any-address lookup, and every write and rpc is recorded.
// `writeError` refuses the address-writing rpcs only.
function bridgeDb(opts: { byGhl?: string | null; byEmail?: string | null; writeError?: { code: string; message: string } | null } = {}) {
  const calls: MirrorCall[] = [];
  const rpc = vi.fn(async (fn: string, args: Record<string, unknown>) => {
    if (fn === "client_id_for_address") {
      calls.push({ table: fn, op: "lookup", payload: args, filters: [] });
      return { data: opts.byEmail ?? null, error: null };
    }
    calls.push({ table: fn, op: "rpc", payload: args, filters: [] });
    if (opts.writeError) return { data: null, error: opts.writeError };
    return { data: fn === "_create_client_with_contact_methods" ? "created-id" : null, error: null };
  });
  const from = vi.fn((table: string) => {
    const filters: Array<[string, unknown]> = [];
    let op = "select";
    let payload: unknown;
    const answer = () => {
      if (op !== "select") return { data: null, error: null };
      if (table === "clients") return { data: opts.byGhl ? { id: opts.byGhl } : null, error: null };
      return { data: null, error: null };
    };
    const q: Record<string, unknown> = {
      select: () => q, limit: () => q, order: () => q,
      eq: (c: string, v: unknown) => { filters.push([c, v]); return q; },
      in: (c: string, v: unknown) => { filters.push([c, v]); return q; },
      maybeSingle: () => Promise.resolve(answer()),
      insert: (p: unknown) => { op = "insert"; payload = p; calls.push({ table, op, payload, filters }); return q; },
      update: (p: unknown) => { op = "update"; payload = p; calls.push({ table, op, payload, filters }); return q; },
      upsert: (p: unknown) => { op = "upsert"; payload = p; calls.push({ table, op, payload, filters }); return q; },
      then: (res: (v: unknown) => unknown) => Promise.resolve(answer()).then(res),
    };
    return q;
  });
  return { db: { rpc, from }, calls };
}

describe("paige-bridge mirrors an external contact through its contact methods", () => {
  const base = {
    tenantId: "t1", ownerId: "owner-1", emailLower: "ada@example.test", first: "Ada", last: "Lovelace",
    phone: "555-010-0101", tier: "premium", ghlContactId: null, source: null, assignedUserId: "coach-1",
    nowIso: "2026-09-29T00:00:00.000Z",
  };

  it("creates a new contact with its email and phone in ONE call, never an email on the clients row", async () => {
    const { db, calls } = bridgeDb();
    const out = await upsertContactMirror(db, base);
    expect(out).toEqual({ client_id: "created-id", action: "created" });
    const create = calls.find((c) => c.table === "_create_client_with_contact_methods");
    expect(create?.payload).toEqual({
      _tenant_id: "t1",
      _client: {
        first_name: "Ada", last_name: "Lovelace", mirror_source: "mma_os", last_mirrored_at: base.nowIso, tier: "premium",
        created_by: "owner-1", status: "active", source: "mma_bridge", lifecycle_stage: "new_lead", created_by_channel_type: "import",
      },
      _methods: [{ kind: "email", value: "ada@example.test" }, { kind: "phone", value: "555-010-0101" }],
    });
    expect(calls.filter((c) => c.table === "clients" && c.op !== "select")).toEqual([]);
    // The coach is assigned to the contact that was created.
    expect(calls.find((c) => c.table === "paige_coach_assignments")).toMatchObject({
      op: "insert", payload: { contact_id: "created-id", assigned_role: "lead_owner", rep_user_id: "coach-1" },
    });
  });

  it("matches a contact by ANY email it holds, and updates it instead of creating a second", async () => {
    const { db, calls } = bridgeDb({ byEmail: "held-id" });
    const out = await upsertContactMirror(db, base);
    expect(out).toEqual({ client_id: "held-id", action: "updated" });
    expect(calls.some((c) => c.table === "_create_client_with_contact_methods")).toBe(false);
    // The phone goes to the contact's methods as primary, keeping what it holds.
    expect(calls.find((c) => c.table === "_add_client_contact_methods")?.payload).toEqual({
      _tenant_id: "t1", _client_id: "held-id", _methods: [{ kind: "phone", value: "555-010-0101", is_primary: true }],
    });
    const update = calls.find((c) => c.table === "clients" && c.op === "update");
    expect(update?.payload).not.toHaveProperty("phone");
    expect(update?.payload).not.toHaveProperty("email");
    expect(update?.filters).toEqual([["id", "held-id"], ["tenant_id", "t1"]]);
    expect(calls.find((c) => c.table === "paige_coach_assignments")).toMatchObject({ op: "upsert", payload: { contact_id: "held-id" } });
  });

  it("matches by the external CRM id first", async () => {
    const { db, calls } = bridgeDb({ byGhl: "ghl-match", byEmail: "other" });
    const out = await upsertContactMirror(db, { ...base, ghlContactId: "g-1", phone: null });
    expect(out).toEqual({ client_id: "ghl-match", action: "updated" });
    expect(calls.some((c) => c.op === "rpc" || c.op === "lookup")).toBe(false);
  });

  it("fails loudly, writing no contact update, when the phone is refused", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { db, calls } = bridgeDb({ byEmail: "held-id", writeError: { code: "22023", message: "CONTACT_METHOD_INVALID_PHONE" } });
    await expect(upsertContactMirror(db, { ...base, phone: "12" })).rejects.toThrow(/contact_phone_not_saved/);
    expect(calls.filter((c) => c.table === "clients" && c.op !== "select")).toEqual([]);
  });

  it("fails loudly when the create is refused, and assigns no coach to a contact that does not exist", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { db, calls } = bridgeDb({ writeError: { code: "23505", message: "CONTACT_METHOD_TAKEN" } });
    await expect(upsertContactMirror(db, base)).rejects.toThrow(/contact_create_failed: CONTACT_METHOD_TAKEN/);
    expect(calls.some((c) => c.table === "paige_coach_assignments")).toBe(false);
  });

  it("paige-bridge's upsert_contact_mirror verb runs through it", () => {
    const bridge = readFileSync("supabase/functions/paige-bridge/index.ts", "utf8");
    const verb = bridge.slice(bridge.indexOf('case "upsert_contact_mirror"'), bridge.indexOf('case "notify_admin"'));
    expect(verb).toContain("await upsertContactMirror(supabase, {");
    expect(verb).not.toMatch(/from\("clients"\)/);
  });
});

// ── A platform user's phone ──────────────────────────────────────────────────────────────────────

type UserRow = { id: string; user_id: string; kind: "email" | "phone"; value: string; label: string | null; is_primary: boolean; position: number };

// A stand-in for user_contact_methods that applies the filters it is sent and records every write.
function userMethods(rows: UserRow[]) {
  const writes: Array<{ op: string; payload?: unknown; options?: unknown; filters: Array<[string, unknown]> }> = [];
  const from = vi.fn((table: string) => {
    expect(table).toBe("user_contact_methods");
    let out = rows.slice();
    const filters: Array<[string, unknown]> = [];
    let write: (typeof writes)[number] | null = null;
    const q: Record<string, unknown> = {
      select: () => q,
      eq: (col: keyof UserRow, v: unknown) => { filters.push([col, v]); out = out.filter((r) => r[col] === v); return q; },
      in: (col: keyof UserRow, vs: unknown[]) => { filters.push([col, vs]); out = out.filter((r) => vs.includes(r[col])); return q; },
      insert: (payload: unknown) => { write = { op: "insert", payload, filters }; writes.push(write); return q; },
      update: (payload: unknown) => { write = { op: "update", payload, filters }; writes.push(write); return q; },
      upsert: (payload: unknown, options: unknown) => { write = { op: "upsert", payload, options, filters }; writes.push(write); return q; },
      delete: () => { write = { op: "delete", filters }; writes.push(write); return q; },
      then: (res: (v: unknown) => unknown) => Promise.resolve(write ? { data: null, error: null } : { data: out, error: null }).then(res),
    };
    return q;
  });
  return { db: { from }, writes };
}

const U = "00000000-0000-4000-8000-0000000000aa";
const phonesOfU: UserRow[] = [
  { id: "m1", user_id: U, kind: "phone", value: "(555) 010-0101", label: "Mobile", is_primary: true, position: 0 },
  { id: "m2", user_id: U, kind: "phone", value: "555-010-0102", label: null, is_primary: false, position: 1 },
  { id: "m3", user_id: U, kind: "email", value: "u@example.test", label: null, is_primary: true, position: 0 },
];

describe("a platform user's phone lives in user_contact_methods", () => {
  it("reads each user's PRIMARY phone", async () => {
    const { db } = userMethods(phonesOfU);
    expect(await primaryPhonesForUsers(db, [U, U, ""])).toEqual(new Map([[U, "(555) 010-0101"]]));
  });

  // The primary moves in ONE database call that reads the list under the person's lock
  // (supabase/tests/user_primary_address.sql proves what that call does to the list). The helper
  // never reads the list itself and writes back what it read: a relabel made in between was lost.
  it("moves the primary in one call to the locked seam, never a read and then a write", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: null });
    const from = vi.fn();
    await setUserPrimaryAddress({ rpc, from } as never, U, "phone", " 555-010-0199 ");
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("_set_user_primary_address", { _user_id: U, _kind: "phone", _value: "555-010-0199" });
    expect(from).not.toHaveBeenCalled();
    const helper = readFileSync("supabase/functions/_shared/user-contact-methods.ts", "utf8");
    const body = helper.slice(helper.indexOf("export async function setUserPrimaryAddress"), helper.indexOf("export async function deleteUserContactMethods"));
    expect(body).not.toMatch(/\.from\(|\.upsert\(|\.insert\(|\.update\(/);
  });

  it("the seam it calls takes the same per-person lock as a checked save of the whole list", () => {
    const migration = readFileSync("supabase/migrations/20270519005000_contact_create_with_methods.sql", "utf8");
    const fn = migration.slice(migration.indexOf("CREATE FUNCTION public._set_user_primary_address"));
    expect(fn).toContain("pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('user_contact_methods:' || _user_id::text, 0))");
    const concurrency = readFileSync("supabase/migrations/20270519000000_contact_methods_concurrency.sql", "utf8");
    expect(concurrency).toContain("pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('user_contact_methods:' || p_user_id::text, 0))");
    // The lock comes before the list is read.
    expect(fn.indexOf("pg_advisory_xact_lock")).toBeLessThan(fn.indexOf("SELECT m.id, m.is_primary INTO"));
    expect(migration).toContain("REVOKE ALL ON FUNCTION public._set_user_primary_address(uuid, text, text) FROM PUBLIC, anon, authenticated;");
    expect(migration).toContain("GRANT EXECUTE ON FUNCTION public._set_user_primary_address(uuid, text, text) TO service_role;");
  });

  it("writes a phone sent as a bare number as its digits (Paige's write-back schema accepts one)", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: null });
    await setUserPrimaryAddress({ rpc }, U, "phone", 5550100199);
    expect(rpc.mock.calls[0][1]).toEqual({ _user_id: U, _kind: "phone", _value: "5550100199" });
    expect(phoneOrAddressText(5550100199)).toBe("5550100199");
    expect(phoneOrAddressText(Number.NaN)).toBe("");
    expect(phoneOrAddressText(true)).toBe("");
    expect(phoneOrAddressText(" 555 ")).toBe("555");
  });

  it("tells an external caller whether a phone was refused, never the table or the database's text", () => {
    const refused = new ContactMethodsWriteError({ code: "22023", message: "CONTACT_METHOD_INVALID_PHONE: 12" });
    expect(refused.message).toContain("user_contact_methods");
    expect(phoneNotSavedMessage(refused)).toBe("The phone number was refused: it is not a valid phone number.");
    expect(phoneNotSavedMessage(new ContactMethodsWriteError({ code: "40001", message: "x" }))).toBe("The phone number could not be saved.");
    expect(phoneNotSavedMessage(new Error("user_contact_methods read failed"))).not.toMatch(/user_contact_methods/);
    // The provider webhooks answer with it, and write their audit row before saying the phone failed.
    for (const file of ["supabase/functions/webhook-inbound/index.ts", "supabase/functions/handle-inbound-webhook/index.ts"]) {
      const source = readFileSync(file, "utf8");
      expect(source, file).not.toMatch(/success:\s*false,\s*message:\s*\(e as Error\)\.message/);
      expect(source, file).toContain("phoneNotSavedMessage(");
    }
    const inbound = readFileSync("supabase/functions/webhook-inbound/index.ts", "utf8");
    expect(inbound.indexOf("updated_via_ghl_webhook")).toBeLessThan(inbound.indexOf("if (phoneError)"));
  });

  it("makes no call when no number, or no person, is given", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: null });
    await setUserPrimaryAddress({ rpc }, U, "phone", "  ");
    await setUserPrimaryAddress({ rpc }, U, "phone", null);
    await setUserPrimaryAddress({ rpc }, U, "phone", undefined);
    await setUserPrimaryAddress({ rpc }, "", "phone", "555-010-0101");
    expect(rpc).not.toHaveBeenCalled();
  });

  it("throws a refused write, keeping its code, rather than reporting success", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { code: "23514", message: "user_contact_methods_phone_shape" } });
    const failure = await setUserPrimaryAddress({ rpc }, U, "phone", "12345").catch((e: unknown) => e);
    expect(failure).toBeInstanceOf(ContactMethodsWriteError);
    expect((failure as ContactMethodsWriteError).code).toBe("23514");
    expect(phoneNotSavedMessage(failure)).toBe("The phone number was refused: it is not a valid phone number.");
  });

  it("erases every address a person holds on a data-deletion request", async () => {
    const { db, writes } = userMethods(phonesOfU);
    await deleteUserContactMethods(db, U);
    expect(writes).toEqual([{ op: "delete", filters: [["user_id", U]] }]);
  });
});

// ── Anti-regression: no edge function finds a contact by the old single columns ─────────────────
// A contact holds several addresses; a lookup on clients.email / clients.phone sees only the
// primary and silently misses a person writing from their second address. No exemptions: Paige's
// own tools (paige-ai-chat, paige-mcp) are held to it like every other function.

function edgeSources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return edgeSources(path);
    return /\.ts$/.test(name) && !/\.test\.ts$/.test(name) ? [path] : [];
  });
}

describe("edge functions recognise contacts by any address", () => {
  it("no edge function looks a contact up by the old email/phone columns", () => {
    const root = process.cwd();
    const offenders = edgeSources(join(root, "supabase/functions"))
      .map((file) => relative(root, file))
      .filter((file) => {
        const source = readFileSync(join(root, file), "utf8");
        // A lookup chain on `clients` filtered by email or phone…
        const chained = /from\(\s*["']clients["']\s*\)[^;]*?(\.(ilike|eq)\(\s*["'](email|phone)["']|["'`][^"'`]*\b(email|phone)\.(eq|ilike)\.)/s.test(source);
        // …or a PostgREST `email.eq.` / `phone.eq.` filter string built apart from the chain, in a
        // file that queries `clients` (the old voice lookup assembled its `.or()` operands first).
        const assembled = /from\(\s*["']clients["']\s*\)/.test(source)
          && /["'`][^"'`\n]*\b(email|phone)\.(eq|ilike)\./.test(source);
        return chained || assembled;
      });
    expect(offenders).toEqual([]);
  });
});

// ── Anti-regression: no edge function reads or writes the old single-address columns ─────────────
// clients.email / clients.phone / profiles.work_email / profiles.phone are a read-only mirror of the
// primary contact method, and a later change drops them. Every edge function reads an address from
// the contact methods and writes one through the contact-methods helpers. The functions still
// being moved by another lane are listed here and come off the list as that lane lands; the parked
// three are not.

const MOVED_BY_ANOTHER_LANE = [
  "supabase/functions/paige-mcp/",
  "supabase/functions/paige-ai-chat/",
  "supabase/functions/_shared/contact-search",
  "supabase/functions/_shared/skill-interpreter",
  "supabase/functions/_shared/calendar-link-tenant-brain",
  "supabase/functions/_shared/paige-mcp/",
];

const OLD_COLUMNS = new Set(["email", "phone", "work_email"]);

/** The text of the balanced {…} starting at `open` (an index of "{"), or "" when unbalanced. */
function balancedBraces(source: string, open: number): string {
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === "{") depth++;
    else if (source[i] === "}" && --depth === 0) return source.slice(open, i + 1);
  }
  return "";
}

/** The top-level column names of a PostgREST select list (embeds and interpolations removed). */
function selectedColumns(list: string): string[] {
  let flat = list.replace(/\$\{[^}]*\}/g, "");
  for (let prev = ""; prev !== flat;) { prev = flat; flat = flat.replace(/[\w!:.-]+\([^()]*\)/g, ""); }
  return flat.split(",")
    .map((token) => token.trim().replace(/::\w+$/, ""))
    .map((token) => token.slice(token.lastIndexOf(":") + 1).trim())
    .filter(Boolean);
}

const hasAddressKey = (objectText: string) => /(^|[{,\s])(email|phone|work_email)\s*[:,}]/.test(objectText);

/** Every use of an old address column in one edge source. */
function oldAddressColumnUses(raw: string): string[] {
  // Line comments go first: a `;` inside one would otherwise end a query chain early (a URL's
  // `://` is kept — its slashes follow a colon).
  const source = raw.replace(/(^|[^:"'`\\])\/\/[^\n]*/g, "$1");
  const uses: string[] = [];
  for (const m of source.matchAll(/\.from\(\s*["'](clients|profiles)["']\s*\)/g)) {
    const table = m[1];
    const end = source.indexOf(";", m.index);
    const chain = source.slice(m.index, end === -1 ? m.index + 1500 : end);
    for (const s of chain.matchAll(/\.select\(\s*(["'`])([\s\S]*?)\1/g)) {
      for (const column of selectedColumns(s[2])) if (OLD_COLUMNS.has(column)) uses.push(`${table} select ${column}`);
    }
    for (const w of chain.matchAll(/\.(insert|update|upsert)\(\s*(\[\s*)?(\{\s*\.\.\.\s*)?(\{|[A-Za-z_$][\w$]*)/g)) {
      if (w[4] === "{") {
        if (hasAddressKey(balancedBraces(chain, (w.index ?? 0) + w[0].length - 1))) uses.push(`${table} ${w[1]} literal`);
        continue;
      }
      const name = w[4];
      for (const d of source.matchAll(new RegExp(`(?:const|let|var)\\s+${name}\\b[^=;]*=\\s*\\{`, "g"))) {
        if (hasAddressKey(balancedBraces(source, (d.index ?? 0) + d[0].length - 1))) uses.push(`${table} ${w[1]} ${name}`);
      }
      if (new RegExp(`\\b${name}(\\.(email|phone|work_email)|\\[["'](email|phone|work_email)["']\\])\\s*=(?!=)`).test(source)) {
        uses.push(`${table} ${w[1]} ${name} assignment`);
      }
    }
  }
  for (const e of source.matchAll(/\b(clients|profiles)(![\w]+)?\(([^()]*)\)/g)) {
    for (const column of selectedColumns(e[3])) if (OLD_COLUMNS.has(column)) uses.push(`${e[1]} embed ${column}`);
  }
  if (/table:\s*["'](clients|profiles)["']\s*,\s*column:\s*["'](email|phone|work_email)["']/.test(source)) {
    uses.push("field map onto an address column");
  }
  return uses;
}

describe("edge functions keep no address in the old single columns", () => {
  it("the detector sees each way an old column was used, and passes the contact-methods forms", () => {
    const old = [
      `await admin.from("clients").select("id, email, first_name").eq("id", x);`,
      `await admin.from("clients").select(\`tenant_id, phone\`).eq("id", x);`,
      `await admin.from("profiles").select("full_name, phone").eq("user_id", u).single();`,
      `await admin.from("clients").insert({ tenant_id: t, email, phone: p }).select("id").single();`,
      `await admin.from("clients")\n  .insert({\n    tenant_id: t, // explicit; never inferred\n    email: fromEmail,\n  }).select("id").single();`,
      `await admin.from("profiles").update({ full_name: n, phone: phone || null }).eq("user_id", u);`,
      `const clientPatch = { first_name: f, email: e };\nawait admin.from("clients").update(clientPatch).eq("id", c);`,
      `const cPatch = {};\ncPatch.phone = p;\nawait admin.from("clients").update(cPatch).eq("id", c);`,
      `await admin.from("deals").select("id, clients(first_name, email)").eq("id", d);`,
      `const F = { "profile.phone": { table: "profiles", column: "phone", type: "string" } };`,
    ];
    for (const snippet of old) expect(oldAddressColumnUses(snippet), snippet).not.toEqual([]);

    const moved = [
      `await admin.from("clients").select(\`tenant_id, \${CLIENT_CONTACT_METHODS_EMBED}\`).eq("id", x);`,
      `await admin.from("clients").select("id, client_contact_methods(kind,value,label,is_primary,position)").eq("id", x);`,
      `await admin.from("clients").select("*").eq("id", x);`,
      `await insertClientWithAddresses(admin, { tenant_id: t, first_name: f }, { email, phone }, "x");`,
      `await admin.from("profiles").update({ full_name: n }).eq("user_id", u);`,
      `await admin.from("communications_consents").select("phone").eq("phone", p);`,
    ];
    for (const snippet of moved) expect(oldAddressColumnUses(snippet), snippet).toEqual([]);
  });

  it("no edge function outside the other lane's files reads or writes clients.email/phone or profiles.work_email/phone", () => {
    const root = process.cwd();
    const offenders = edgeSources(join(root, "supabase/functions"))
      .map((file) => relative(root, file).split("\\").join("/"))
      .filter((file) => !MOVED_BY_ANOTHER_LANE.some((prefix) => file.startsWith(prefix)))
      .map((file) => ({ file, uses: oldAddressColumnUses(readFileSync(join(root, file), "utf8")) }))
      .filter(({ uses }) => uses.length > 0);
    expect(offenders).toEqual([]);
  });

  // A contact inserted on its own commits (and fires contact.created) before any address exists,
  // and a refused address then leaves an event for a contact that is undone. A contact is created
  // with its addresses in one transaction, through insertClientWithAddresses.
  const insertsAContactDirectly = (raw: string) =>
    /\.from\(\s*["']clients["']\s*\)\s*\.(insert|upsert)\(/.test(raw.replace(/(^|[^:"'`\\])\/\/[^\n]*/g, "$1"));

  it("the direct-insert detector sees a split chain and ignores a comment", () => {
    expect(insertsAContactDirectly(`await admin.from("clients")\n  .insert({ tenant_id: t }).select("id").single();`)).toBe(true);
    expect(insertsAContactDirectly(`await admin.from('clients').upsert(row);`)).toBe(true);
    expect(insertsAContactDirectly(`// was: admin.from("clients").insert(row)\nawait insertClientWithAddresses(admin, row, {}, "x");`)).toBe(false);
    expect(insertsAContactDirectly(`await admin.from("clients").update(patch).eq("id", c);`)).toBe(false);
  });

  // No exemptions: Paige's MCP create_contact and paige-bridge create through the same seam.
  it("no edge function inserts a contact apart from its addresses", () => {
    const root = process.cwd();
    const offenders = edgeSources(join(root, "supabase/functions"))
      .map((file) => relative(root, file).split("\\").join("/"))
      .filter((file) => insertsAContactDirectly(readFileSync(join(root, file), "utf8")));
    expect(offenders).toEqual([]);
  });
});

describe("Paige's MCP update_contact never overwrites a list that changed", () => {
  const source = readFileSync("supabase/functions/paige-mcp/index.ts", "utf8");
  const tool = source.slice(source.indexOf('mcp.tool("update_contact"'), source.indexOf("mcp.tool(", source.indexOf('mcp.tool("update_contact"') + 10));

  it("replaces a list only through the checked helper, naming the list it read", () => {
    expect(tool).toContain('rpc("_replace_client_contact_methods_checked", { ...target, _expected: expected_contact_methods })');
    expect(tool).not.toMatch(/rpc\("_replace_client_contact_methods"/);
    expect(tool).toContain("if (contact_methods && !expected_contact_methods) return err(\"CONTACT_METHODS_EXPECTED_REQUIRED");
    // A list read with get_contact (unlabelled addresses come back as label: null) is accepted as sent.
    expect(source).toMatch(/const contactMethodInput = z\.object\(\{[\s\S]*?label: z\.string\(\)\.nullable\(\)\.optional\(\),/);
    // Adding keeps what is there, so it needs no expected list.
    expect(tool).toContain('await admin.rpc("_add_client_contact_methods", target)');
  });

  it("no edge function replaces an existing contact's list unchecked", () => {
    const hits: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) walk(path);
        else if (/\.ts$/.test(name) && readFileSync(path, "utf8").includes('"_replace_client_contact_methods"')) hits.push(relative(".", path));
      }
    };
    walk("supabase/functions");
    // create_contact writes its first list inside the one-transaction create, so nothing calls the
    // unchecked replace at all.
    expect(hits).toEqual([]);
  });
});

