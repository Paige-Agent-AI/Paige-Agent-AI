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
import { isUsableMirroredPhone, upsertContactMirror } from "../../supabase/functions/paige-bridge/contact-mirror";

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
type HeldMethod = { kind: "email" | "phone"; value: string; label: string | null; is_primary: boolean; position: number };

// A stand-in for the service client paige-bridge holds: `clients` answers the ghl-id lookup,
// client_id_for_address answers the any-address lookup, `client_contact_methods` answers with the
// list the contact holds, and every write and rpc is recorded. `writeError` refuses the
// address-writing rpcs; `createError` refuses only the one-transaction create; `updateError`
// refuses the contact-row update; `undoError` refuses the checked replace that puts a list back
// (the second checked replace of a call). `byGhl` / `byEmail` may be a list: one answer per
// lookup, in order. `ghlElsewhere` answers whether another workspace holds the external id.
function bridgeDb(opts: {
  byGhl?: string | null | Array<string | null>;
  ghlElsewhere?: string | null;
  byEmail?: string | null | Array<string | null>;
  held?: HeldMethod[];
  writeError?: { code: string; message: string } | null;
  createError?: { code: string; message: string } | null;
  updateError?: { code?: string; message: string } | null;
  undoError?: { message: string } | null;
} = {}) {
  const calls: MirrorCall[] = [];
  let checkedReplaces = 0;
  let lookups = 0;
  let ghlLookups = 0;
  const rpc = vi.fn(async (fn: string, args: Record<string, unknown>) => {
    if (fn === "client_id_for_address") {
      calls.push({ table: fn, op: "lookup", payload: args, filters: [] });
      const answer = Array.isArray(opts.byEmail) ? opts.byEmail[lookups] : opts.byEmail;
      lookups += 1;
      return { data: answer ?? null, error: null };
    }
    calls.push({ table: fn, op: "rpc", payload: args, filters: [] });
    if (fn === "_replace_client_contact_methods_checked") {
      checkedReplaces += 1;
      if (checkedReplaces > 1 && opts.undoError) return { data: null, error: opts.undoError };
    }
    if (opts.writeError) return { data: null, error: opts.writeError };
    if (fn === "_create_client_with_contact_methods") {
      return opts.createError ? { data: null, error: opts.createError } : { data: "created-id", error: null };
    }
    if (fn === "_replace_client_contact_methods_checked") {
      const methods = args._methods as Array<Omit<HeldMethod, "position">>;
      return { data: methods.map((m, position) => ({ ...m, position })), error: null };
    }
    return { data: null, error: null };
  });
  const from = vi.fn((table: string) => {
    const filters: Array<[string, unknown]> = [];
    let op = "select";
    let payload: unknown;
    const answer = () => {
      if (op === "update" && table === "clients" && opts.updateError) return { data: null, error: opts.updateError };
      if (op !== "select") return { data: null, error: null };
      if (table === "clients" && filters.some(([c]) => c === "tenant_id!=")) {
        return { data: opts.ghlElsewhere ? { id: opts.ghlElsewhere } : null, error: null };
      }
      if (table === "clients") {
        const id = Array.isArray(opts.byGhl) ? opts.byGhl[ghlLookups] : opts.byGhl;
        ghlLookups += 1;
        return { data: id ? { id } : null, error: null };
      }
      if (table === "client_contact_methods") return { data: opts.held ?? [], error: null };
      return { data: null, error: null };
    };
    const q: Record<string, unknown> = {
      select: () => q, limit: () => q, order: () => q,
      eq: (c: string, v: unknown) => { filters.push([c, v]); return q; },
      neq: (c: string, v: unknown) => { filters.push([`${c}!=`, v]); return q; },
      in: (c: string, v: unknown) => { filters.push([c, v]); return q; },
      maybeSingle: () => Promise.resolve(answer()),
      insert: (p: unknown) => { op = "insert"; payload = p; calls.push({ table, op, payload, filters }); return q; },
      update: (p: unknown) => { op = "update"; payload = p; calls.push({ table, op, payload, filters }); return q; },
      upsert: (p: unknown) => { op = "upsert"; payload = p; calls.push({ table, op, payload, filters }); return q; },
      delete: () => { op = "delete"; calls.push({ table, op, filters }); return q; },
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
  const held: HeldMethod[] = [
    { kind: "email", value: "ada@example.test", label: null, is_primary: true, position: 0 },
    { kind: "phone", value: "555-000-0000", label: "work", is_primary: true, position: 0 },
    { kind: "phone", value: "555-999-9999", label: null, is_primary: false, position: 1 },
  ];

  it("creates a new contact with its email and phone in ONE call, never an email on the clients row", async () => {
    const { db, calls } = bridgeDb();
    const out = await upsertContactMirror(db, base);
    expect(out).toEqual({ ok: true, data: { client_id: "created-id", action: "created" } });
    const create = calls.find((c) => c.table === "_create_client_with_contact_methods");
    expect(create?.payload).toEqual({
      _tenant_id: "t1",
      _client: {
        first_name: "Ada", last_name: "Lovelace", mirror_source: "mma_os", last_mirrored_at: base.nowIso, tier: "premium",
        created_by: "owner-1", status: "active", source: "mma_bridge", lifecycle_stage: "new_lead", created_by_channel_type: "import",
      },
      _methods: [{ kind: "email", value: "ada@example.test" }, { kind: "phone", value: "555-010-0101" }],
    });
    // One create: no contact row written on its own, no address written after it.
    expect(calls.filter((c) => c.table === "clients" && c.op !== "select")).toEqual([]);
    expect(calls.filter((c) => c.op === "rpc").map((c) => c.table)).toEqual(["_create_client_with_contact_methods"]);
    // The coach is assigned to the contact that was created.
    expect(calls.find((c) => c.table === "paige_coach_assignments")).toMatchObject({
      op: "insert", payload: { contact_id: "created-id", assigned_role: "lead_owner", rep_user_id: "coach-1" },
    });
  });

  it("creates a new contact without an unusable phone, and says the phone was not saved", async () => {
    const { db, calls } = bridgeDb();
    const out = await upsertContactMirror(db, { ...base, phone: "12" });
    expect(out).toEqual({ ok: true, data: { client_id: "created-id", action: "created", phone_not_saved: "not a usable phone number" } });
    expect((calls.find((c) => c.table === "_create_client_with_contact_methods")?.payload as { _methods: unknown })._methods)
      .toEqual([{ kind: "email", value: "ada@example.test" }]);
  });

  it("matches a contact by ANY email it holds, and makes the phone its primary in place, keeping the rest", async () => {
    const { db, calls } = bridgeDb({ byEmail: "held-id", held });
    const out = await upsertContactMirror(db, base);
    expect(out).toEqual({ ok: true, data: { client_id: "held-id", action: "updated" } });
    expect(calls.some((c) => c.table === "_create_client_with_contact_methods")).toBe(false);
    // The new number takes the primary's place (and its label); the other number and the email
    // stay; the write names the list it was built on, so a concurrent change is never overwritten.
    expect(calls.find((c) => c.table === "_replace_client_contact_methods_checked")?.payload).toEqual({
      _tenant_id: "t1", _client_id: "held-id",
      _methods: [
        { kind: "email", value: "ada@example.test", label: null, is_primary: true },
        { kind: "phone", value: "555-010-0101", label: "work", is_primary: true },
        { kind: "phone", value: "555-999-9999", label: null, is_primary: false },
      ],
      _expected: held.map(({ position: _p, ...m }) => m),
    });
    expect(calls.some((c) => c.table === "_add_client_contact_methods")).toBe(false);
    const update = calls.find((c) => c.table === "clients" && c.op === "update");
    expect(update?.payload).not.toHaveProperty("phone");
    expect(update?.payload).not.toHaveProperty("email");
    expect(update?.filters).toEqual([["id", "held-id"], ["tenant_id", "t1"]]);
    expect(calls.find((c) => c.table === "paige_coach_assignments")).toMatchObject({ op: "upsert", payload: { contact_id: "held-id" } });
  });

  it("matches by the external CRM id first", async () => {
    const { db, calls } = bridgeDb({ byGhl: "ghl-match", byEmail: "other" });
    const out = await upsertContactMirror(db, { ...base, ghlContactId: "g-1", phone: null });
    expect(out).toEqual({ ok: true, data: { client_id: "ghl-match", action: "updated" } });
    expect(calls.some((c) => c.op === "rpc" || c.op === "lookup")).toBe(false);
  });

  it("still mirrors a held contact when its phone is unusable, writes no phone, and says so", async () => {
    const { db, calls } = bridgeDb({ byEmail: "held-id", held });
    const out = await upsertContactMirror(db, { ...base, phone: "12" });
    expect(out).toEqual({ ok: true, data: { client_id: "held-id", action: "updated", phone_not_saved: "not a usable phone number" } });
    expect(calls.some((c) => c.op === "rpc")).toBe(false);
    expect(calls.find((c) => c.table === "clients" && c.op === "update")).toBeDefined();
  });

  it("refuses, writing no contact update, when the database refuses a usable phone", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { db, calls } = bridgeDb({ byEmail: "held-id", held, writeError: { code: "23505", message: "CONTACT_METHOD_TAKEN" } });
    const out = await upsertContactMirror(db, base);
    expect(out).toEqual({ ok: false, error: "contact_methods_not_saved: CONTACT_METHOD_TAKEN" });
    expect(calls.filter((c) => c.table === "clients" && c.op !== "select")).toEqual([]);
  });

  it("puts the phone back when the contact-row update fails after it was written", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { db, calls } = bridgeDb({ byEmail: "held-id", held, updateError: { message: "row refused" } });
    await expect(upsertContactMirror(db, base)).rejects.toMatchObject({ message: "row refused" });
    const replaces = calls.filter((c) => c.table === "_replace_client_contact_methods_checked");
    expect(replaces).toHaveLength(2);
    const [write, undo] = replaces.map((c) => c.payload as { _methods: unknown; _expected: unknown });
    expect(undo._methods).toEqual(write._expected);
    expect(undo._expected).toEqual((write._methods as Array<Record<string, unknown>>).map((m) => ({ ...m })));
  });

  it("says the phone was saved when the row update fails and the phone cannot be put back", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { db } = bridgeDb({ byEmail: "held-id", held, updateError: { message: "row refused" }, undoError: { message: "CONTACT_METHODS_STALE" } });
    const out = await upsertContactMirror(db, base);
    expect(out).toEqual({ ok: false, error: "contact_update_failed_phone_saved: row refused", details: { client_id: "held-id" } });
  });

  // A refused create writes nothing: the create is the only write call, no contact-row update, and
  // no coach assignment.
  const wroteNothingButTheCreate = (calls: MirrorCall[]) => {
    expect(calls.filter((c) => c.op !== "select" && c.op !== "lookup").map((c) => c.table))
      .toEqual(["_create_client_with_contact_methods"]);
  };

  it("answers a create refused because an address is not a usable address as not saved (409), writing nothing else", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const message = "CONTACT_METHOD_INVALID_EMAIL: a@b";
    const { db, calls } = bridgeDb({ createError: { code: "22023", message } });
    const out = await upsertContactMirror(db, base);
    expect(out).toEqual({ ok: false, error: `contact_methods_not_saved: ${message}` });
    wroteNothingButTheCreate(calls);
  });

  it("updates the contact another writer created meanwhile when the create clashes on its email", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { db, calls } = bridgeDb({
      byEmail: [null, "raced-id"], held,
      createError: { code: "23505", message: "CONTACT_METHOD_TAKEN: ada@example.test already belongs to another contact in this workspace" },
    });
    const out = await upsertContactMirror(db, base);
    expect(out).toEqual({ ok: true, data: { client_id: "raced-id", action: "updated" } });
    // Looked up twice (before the create, and after its clash), then the update path ran.
    expect(calls.filter((c) => c.op === "lookup")).toHaveLength(2);
    expect(calls.find((c) => c.table === "_replace_client_contact_methods_checked")?.payload).toMatchObject({ _client_id: "raced-id" });
    expect(calls.find((c) => c.table === "clients" && c.op === "update")?.filters).toEqual([["id", "raced-id"], ["tenant_id", "t1"]]);
    expect(calls.find((c) => c.table === "paige_coach_assignments")).toMatchObject({ op: "upsert", payload: { contact_id: "raced-id" } });
  });

  const ghlClash = { code: "23505", message: 'duplicate key value violates unique constraint "clients_ghl_contact_id_uniq"' };

  it("updates the contact another writer created meanwhile when the create clashes on its external id", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { db, calls } = bridgeDb({ byGhl: [null, "raced-ghl"], held, createError: ghlClash });
    const out = await upsertContactMirror(db, { ...base, ghlContactId: "g-1" });
    expect(out).toEqual({ ok: true, data: { client_id: "raced-ghl", action: "updated" } });
    expect(calls.find((c) => c.table === "clients" && c.op === "update")?.filters).toEqual([["id", "raced-ghl"], ["tenant_id", "t1"]]);
  });

  it("answers 409 when another workspace's contact holds the external id — sending it again cannot succeed", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { db, calls } = bridgeDb({ ghlElsewhere: "other-workspace-contact", createError: ghlClash });
    const out = await upsertContactMirror(db, { ...base, ghlContactId: "g-elsewhere" });
    // Says which case, never which workspace or contact.
    expect(out).toEqual({ ok: false, error: "ghl_contact_id_held_elsewhere" });
    expect(calls.filter((c) => c.op === "lookup")).toHaveLength(2);
    wroteNothingButTheCreate(calls);
  });

  it("fails loudly (500, so the caller retries) when a unique clash finds no contact here and nothing holds the external id elsewhere", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const message = 'duplicate key value violates unique constraint "clients_tenant_account_number_uniq"';
    const { db, calls } = bridgeDb({ createError: { code: "23505", message } });
    await expect(upsertContactMirror(db, { ...base, ghlContactId: "g-1" })).rejects.toThrow(`contact_create_failed: ${message}`);
    // It did look again before giving up.
    expect(calls.filter((c) => c.op === "lookup")).toHaveLength(2);
    wroteNothingButTheCreate(calls);
  });

  it("answers 409 when updating a held contact clashes on an external id another workspace holds, and puts the phone back", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { db, calls } = bridgeDb({ byEmail: "held-id", held, ghlElsewhere: "other-workspace-contact", updateError: ghlClash });
    const out = await upsertContactMirror(db, { ...base, ghlContactId: "g-elsewhere" });
    expect(out).toEqual({ ok: false, error: "ghl_contact_id_held_elsewhere" });
    expect(calls.filter((c) => c.table === "_replace_client_contact_methods_checked")).toHaveLength(2);
  });

  it("fails loudly (500) when a held contact's phone loses the race twice over, writing no contact update", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { db, calls } = bridgeDb({ byEmail: "held-id", held, writeError: { code: "40001", message: "CONTACT_METHODS_STALE: the list changed" } });
    await expect(upsertContactMirror(db, base)).rejects.toThrow(/contact_methods_write_failed: CONTACT_METHODS_STALE/);
    expect(calls.filter((c) => c.table === "clients" && c.op !== "select")).toEqual([]);
  });

  it.each([
    ["a refusal that is not about an address", "22023", "CONTACT_NO_TENANT: no workspace"],
    ["a timeout", "57014", "canceling statement due to statement timeout"],
  ])("fails loudly on %s, writing nothing else and assigning no coach", async (_why, code, message) => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { db, calls } = bridgeDb({ createError: { code, message } });
    await expect(upsertContactMirror(db, base)).rejects.toThrow(`contact_create_failed: ${message}`);
    wroteNothingButTheCreate(calls);
  });

  it("paige-bridge's upsert_contact_mirror verb runs through it, and answers a refusal with 409", () => {
    const bridge = readFileSync("supabase/functions/paige-bridge/index.ts", "utf8");
    const verb = bridge.slice(bridge.indexOf('case "upsert_contact_mirror"'), bridge.indexOf('case "notify_admin"'));
    expect(verb).toContain("await upsertContactMirror(supabase, {");
    expect(verb).toContain("if (!mirrored.ok) return fail(verb, 409, mirrored.error, mirrored.details);");
    expect(verb).toContain("return ok(verb, mirrored.data);");
    expect(verb).not.toMatch(/from\("clients"\)/);
  });

  it("uses the database's own phone bounds to decide a phone is unusable", () => {
    for (const phone of ["555-0101", "+1 (555) 010-0101", "123456789012345"]) expect(isUsableMirroredPhone(phone), phone).toBe(true);
    for (const phone of [null, "12", "123456", "1234567890123456", `555-010-0101${" ".repeat(40)}`]) expect(isUsableMirroredPhone(phone), String(phone)).toBe(false);
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
// the contact methods and writes one through the contact-methods helpers. No exemptions: every
// file under supabase/functions is held to it, Paige's own tools (paige-mcp, paige-ai-chat,
// paige-bridge, their shared helpers) included.

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

  it("no edge function reads or writes clients.email/phone or profiles.work_email/phone", () => {
    const root = process.cwd();
    const offenders = edgeSources(join(root, "supabase/functions"))
      .map((file) => relative(root, file).split("\\").join("/"))
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

// ── Paige's own tools read and write a contact's addresses only through its contact methods ─────
// The single-address columns (clients.email / clients.phone, profiles.work_email / profiles.phone)
// are a read-only mirror of the primary that a later migration drops. Paige's tools must neither
// read them (a reader would see only the primary, and nothing once the columns go) nor write them
// (the write fails once the columns go). Extends the lookup guard above to every read and write in
// the Paige tool lane. (Top-level columns are read with selectedColumns above: embeds and
// interpolated embeds are dropped.)

const PAIGE_TOOL_FILES = [
  "supabase/functions/paige-mcp/index.ts",
  "supabase/functions/paige-ai-chat/index.ts",
  "supabase/functions/paige-bridge/index.ts",
  "supabase/functions/paige-bridge/contact-mirror.ts",
  "supabase/functions/_shared/contact-search.ts",
  "supabase/functions/_shared/skill-interpreter.ts",
  "supabase/functions/_shared/skill-interpreter-core.ts",
  "supabase/functions/_shared/calendar-link-tenant-brain.ts",
];

/** Every select on `table` in a source file, as [line, select string]. */
function selectsOn(source: string, table: string): Array<[number, string]> {
  const re = new RegExp(`from\\(\\s*["']${table}["']\\s*\\)\\s*\\.select\\(\\s*(["'\`])([\\s\\S]*?)\\1`, "g");
  return [...source.matchAll(re)].map((m) => [source.slice(0, m.index).split("\n").length, m[2]]);
}

describe("Paige's tools use contact methods for every address", () => {
  const sources = Object.fromEntries(PAIGE_TOOL_FILES.map((f) => [f, readFileSync(join(process.cwd(), f), "utf8")]));

  it("never select a contact's or a user's single-address columns, or every column of a contact", () => {
    const offenders: string[] = [];
    for (const [file, source] of Object.entries(sources)) {
      for (const [line, select] of selectsOn(source, "clients")) {
        if (selectedColumns(select).some((c) => c === "email" || c === "phone" || c === "*")) {
          offenders.push(`${file}:${line} clients.select(${select})`);
        }
      }
      for (const [line, select] of selectsOn(source, "profiles")) {
        if (selectedColumns(select).some((c) => c === "phone" || c === "work_email" || c === "*")) {
          offenders.push(`${file}:${line} profiles.select(${select})`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("never write an address onto the contact row", () => {
    const offenders: string[] = [];
    for (const [file, source] of Object.entries(sources)) {
      for (const m of source.matchAll(/from\(\s*["']clients["']\s*\)\s*\.(insert|update|upsert)\(\s*\{([\s\S]*?)\}\s*\)/g)) {
        if (/\b(email|phone)\s*:/.test(m[2])) offenders.push(`${file}: clients.${m[1]} with an address key`);
      }
      if (/\bsharedPatch\.(email|phone)\b/.test(source)) offenders.push(`${file}: an address on the contact patch`);
    }
    expect(offenders).toEqual([]);
  });

  it("never let a single email or phone through a field allowlist to the contact row", () => {
    const mcp = sources["supabase/functions/paige-mcp/index.ts"];
    const between = (text: string, from: string, to: string) => {
      const start = text.indexOf(from);
      return text.slice(start, text.indexOf(to, start));
    };
    const propose = between(mcp, 'mcp.tool("propose_client_update"', 'mcp.tool("ingest_credit_scores"');
    expect(propose).toContain("new Set(PROPOSABLE_CLIENT_FIELDS)");
    const edits = readFileSync(join(process.cwd(), "supabase/functions/_shared/paige-mcp/contact-method-edits.ts"), "utf8");
    expect(between(edits, "export const PROPOSABLE_CLIENT_FIELDS", "];")).not.toMatch(/"(email|phone)"/);
    const selfUpdate = between(mcp, 'mcp.tool("me_update_profile"', 'mcp.tool("me_list_businesses"');
    const columns = between(selfUpdate, "const COLUMNS", "};");
    expect(columns).not.toMatch(/"phone"/);
    // The funding goal input writes the column that exists (there is no funding_goal_amount column).
    expect(columns).toContain('funding_goal_amount: "funding_goal"');

    const chat = sources["supabase/functions/paige-ai-chat/index.ts"];
    const start = chat.lastIndexOf('} else if (tc.function.name === "crm_update_contact")');
    const handler = chat.slice(start, chat.indexOf('} else if (tc.function.name === "propose_business_brief_update")', start));
    expect(between(handler, "const fields = [", "];")).not.toMatch(/"(email|phone)"/);
    // An address change reaches upsert_contact only as the contact's complete list, and always
    // with the list it was built on, so upsert_contact can refuse it if that list changed.
    expect(handler).toContain("contactPatch.contact_methods");
    expect(handler.match(/contactPatch\.expected_contact_methods = /g)).toHaveLength(2);
  });
});

// ── An address change is applied to the list held when it is written, never a frozen copy ──────
// The confirmed defect: propose_client_update stored the contact's complete resulting list, and
// confirm_proposal wrote it back with an unchecked replace — deleting any address added between
// the two. Every writer of an EXISTING contact's list now goes through writeAddressIntent (add →
// _add_client_contact_methods; replace / new primary → _replace_client_contact_methods_checked).

describe("Paige's tools never overwrite an address list that changed", () => {
  const read = (f: string) => readFileSync(join(process.cwd(), f), "utf8");
  const mcp = read("supabase/functions/paige-mcp/index.ts");
  const slice = (text: string, from: string, to: string) => {
    const start = text.indexOf(from);
    return text.slice(start, text.indexOf(to, start + from.length));
  };

  it("proposes the change asked for, and the list it was built on — not a frozen resulting list", () => {
    const propose = slice(mcp, 'mcp.tool("propose_client_update"', 'mcp.tool("ingest_credit_scores"');
    expect(propose).toContain("address_intent: addressIntent.intent, contact_methods_built_on: builtOn");
    expect(propose).not.toMatch(/payload: \{[^}]*contact_methods: contactMethods/);
  });

  it("confirms by applying that change to the list held at confirm, checked, and all-or-nothing", () => {
    const apply = slice(mcp, "async function applyProposal(", 'case "ingest_credit_scores"');
    expect(apply).toContain("clientRowPatchProblem(updates)");
    expect(apply).toContain("writeAddressIntent(admin, owner.tenant_id, prop.client_id, intent, builtOn)");
    expect(apply).toContain("undoAddressWrite(admin, owner.tenant_id, prop.client_id, addressWrite)");
    expect(apply).not.toContain('rpc("_replace_client_contact_methods"');
    // A failed confirm records what landed.
    expect(slice(mcp, "async function applyProposal(", "// ---------- Pass 5")).toContain('audit("apply_proposal_failed"');
  });

  it("updates the caller's own phone the same way, and puts it back if the row update fails", () => {
    const selfUpdate = slice(mcp, 'mcp.tool("me_update_profile"', 'mcp.tool("me_list_businesses"');
    expect(selfUpdate).toContain('writeAddressIntent(admin, me.tenant_id, me.id, { op: "primary", values: { phone } }, null, 2)');
    expect(selfUpdate).toContain("undoAddressWrite(admin, me.tenant_id, me.id, addressWrite)");
    expect(selfUpdate).toContain("clientRowPatchProblem(clean)");
  });

  it("never uses the unchecked replace: a new contact gets its first list in the create transaction", () => {
    expect(mcp).not.toMatch(/rpc\("_replace_client_contact_methods"/);
    expect(slice(mcp, 'mcp.tool("create_contact"', 'mcp.tool("update_contact"')).toContain("await createClientWithContactMethods(");
  });

  it("mirrors an external CRM's contact without overwriting addresses, and creates no address-less contact", () => {
    const mirror = read("supabase/functions/paige-bridge/contact-mirror.ts");
    // An existing contact: the phone is written checked against the list held, and put back if the
    // contact-row update then fails.
    expect(mirror).toContain('writeAddressIntent(db, tenantId, existingId, { op: "primary", values: { phone } }, null, 2)');
    expect(mirror).toContain("undoAddressWrite(db, tenantId, existingId, addressWrite)");
    // A new contact: created WITH its addresses in one transaction — never inserted, then addressed,
    // then deleted again on a refusal.
    expect(mirror).toContain("await insertClientWithAddresses(");
    expect(mirror).not.toMatch(/from\("clients"\)\s*\.(insert|upsert|delete)\(/);
    expect(mirror).not.toContain("_replace_client_contact_methods\"");
    expect(mirror).not.toContain("addClientAddresses");
  });

  it("pins the address list, not a single email or phone, on a contact-edit approval", () => {
    const confirmation = read("supabase/functions/_shared/toolConfirmation.ts");
    const binding = slice(confirmation, "crm_update_contact:", "n8n_delete_workflow:");
    for (const field of ["contact_methods", "add_contact_methods", "expected_contact_methods"]) expect(binding).toContain(`"${field}"`);
    expect(binding).not.toMatch(/"(email|phone)"/);
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
