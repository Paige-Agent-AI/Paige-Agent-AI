// The contact helpers, EXECUTED against a client that records what it was asked for. A contact's
// email and phone live in `client_contact_methods` (20270515000000); `clients.email` / `.phone`
// are a read-only mirror a later migration drops. These prove every helper reads and writes the
// methods, matches an address the way the database does, and never touches the old columns.
import { beforeEach, describe, expect, it, vi } from "vitest";

type Call = { table: string; select: string; filters: Array<[string, string, unknown]>; update?: unknown };
const calls: Call[] = [];
const rpcs: Array<{ fn: string; args: Record<string, unknown> }> = [];
let answer: (call: Call) => { data: unknown; error: { message: string } | null } = () => ({ data: [], error: null });
let rpcAnswer: { data: unknown; error: { message: string } | null } = { data: "c1", error: null };

function chain(table: string) {
  const call: Call = { table, select: "", filters: [] };
  calls.push(call);
  const self: Record<string, unknown> = {};
  const filter = (op: string) => (column: string, value: unknown) => { call.filters.push([op, column, value]); return self; };
  self.select = (columns?: string) => { call.select = columns ?? "*"; return self; };
  self.update = (patch: unknown) => { call.update = patch; return self; };
  self.eq = filter("eq");
  self.neq = filter("neq");
  self.in = filter("in");
  self.ilike = filter("ilike");
  self.limit = () => self;
  self.order = () => self;
  self.maybeSingle = () => Promise.resolve(answer(call));
  self.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) => Promise.resolve(answer(call)).then(resolve, reject);
  return self;
}

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) => chain(table),
    rpc: (fn: string, args: Record<string, unknown>) => { rpcs.push({ fn, args }); return Promise.resolve(rpcAnswer); },
  },
}));

const {
  CONTACT_METHODS_CHANGED_MESSAGE, contactIdsWithAddress, findDuplicates, readUserPrimaryAddress, replaceContactMethods,
  setContactPrimaryAddresses, updateContact,
} = await import("./contacts");

const method = (id: string, kind: "email" | "phone", value: string, is_primary: boolean, position: number, label: string | null = null) =>
  ({ id, kind, value, label, is_primary, position });

const STORED = [
  method("e1", "email", "jordan@reyesbuild.co", true, 0, "Work"),
  method("e2", "email", "jordan.home@fastmail.com", false, 1, "Personal"),
  method("p1", "phone", "+1 (512) 555-0148", true, 0, "Mobile"),
];

const has = (call: Call | undefined, op: string, column: string, value?: unknown) =>
  Boolean(call?.filters.some(([o, c, v]) => o === op && c === column && (value === undefined || JSON.stringify(v) === JSON.stringify(value))));

beforeEach(() => {
  calls.length = 0;
  rpcs.length = 0;
  rpcAnswer = { data: "c1", error: null };
  answer = () => ({ data: [], error: null });
});

// The list exactly as STORED reads it back, in the shape a save names it.
const STORED_AS_LOADED = [
  { kind: "email", value: "jordan@reyesbuild.co", label: "Work", is_primary: true },
  { kind: "email", value: "jordan.home@fastmail.com", label: "Personal", is_primary: false },
  { kind: "phone", value: "+1 (512) 555-0148", label: "Mobile", is_primary: true },
];

describe("setting a contact's primary email / phone", () => {
  it("replaces only the primary, keeps every other address, and writes the whole list naming the list it read", async () => {
    answer = (call) => (call.table === "client_contact_methods" ? { data: STORED, error: null } : { data: [], error: null });
    await setContactPrimaryAddresses("c1", { email: "new@reyesbuild.co" }, { tenantId: "tenant-a" });

    // Read at save time (no loaded list was given), then read back after the write.
    expect(calls.map((c) => c.table)).toEqual(["client_contact_methods", "client_contact_methods"]);
    expect(has(calls[0], "eq", "client_id", "c1")).toBe(true);
    expect(rpcs).toEqual([{
      fn: "upsert_contact",
      args: {
        p_patch: {
          contact_methods: [
            { kind: "email", value: "new@reyesbuild.co", label: "Work", is_primary: true },
            { kind: "email", value: "jordan.home@fastmail.com", label: "Personal", is_primary: false },
            { kind: "phone", value: "+1 (512) 555-0148", label: "Mobile", is_primary: true },
          ],
          expected_contact_methods: STORED_AS_LOADED,
        },
        p_contact_id: "c1",
        p_tenant_id: "tenant-a",
        p_channel: "manual",
      },
    }]);
    // Nothing is written to the contact row, and no single email/phone key is sent.
    expect(calls.some((c) => c.table === "clients")).toBe(false);
    expect(JSON.stringify(rpcs[0].args.p_patch)).not.toMatch(/"(email|phone)":/);
  });

  it("builds on the list the page LOADED and names that one, so a change made since is refused, not overwritten", async () => {
    // The page read STORED. Since then someone else added a third email; the database holds that.
    const since = [...STORED, method("e3", "email", "theirs@reyesbuild.co", false, 2)];
    answer = () => ({ data: since, error: null });
    rpcAnswer = { data: null, error: { message: "CONTACT_METHODS_STALE: this list changed since it was loaded" } };

    await expect(setContactPrimaryAddresses("c1", { phone: "+1 512 555 0190" }, { tenantId: "tenant-a", loaded: STORED }))
      .rejects.toThrow(CONTACT_METHODS_CHANGED_MESSAGE);
    // It did not re-read and silently rebuild on the newer list: the write named what was shown.
    expect(calls).toEqual([]);
    expect(rpcs[0].args.p_patch).toMatchObject({ expected_contact_methods: STORED_AS_LOADED });
    expect((rpcs[0].args.p_patch as { contact_methods: unknown[] }).contact_methods).toHaveLength(3);
  });

  it("returns the list as stored after the write", async () => {
    const after = [method("n1", "email", "new@reyesbuild.co", true, 0, "Work"), STORED[1], STORED[2]];
    answer = () => ({ data: after, error: null });
    expect(await setContactPrimaryAddresses("c1", { email: "new@reyesbuild.co" }, { loaded: STORED })).toEqual(after);
  });

  it("writes nothing when the primaries already match", async () => {
    answer = () => ({ data: STORED, error: null });
    await setContactPrimaryAddresses("c1", { email: " jordan@reyesbuild.co ", phone: "+1 (512) 555-0148" });
    expect(rpcs).toEqual([]);
  });

  it("replacing a whole list names the list it was built on, in the contact's workspace", async () => {
    answer = () => ({ data: STORED, error: null });
    const list = [{ kind: "email" as const, value: "only@reyesbuild.co", label: null, is_primary: true }];
    await replaceContactMethods("c1", list, { expected: STORED_AS_LOADED, tenantId: "tenant-b" });
    expect(rpcs[0]).toEqual({
      fn: "upsert_contact",
      args: { p_patch: { contact_methods: list, expected_contact_methods: STORED_AS_LOADED }, p_contact_id: "c1", p_tenant_id: "tenant-b", p_channel: "manual" },
    });
  });

  it("surfaces the server's refusal instead of reporting a save", async () => {
    answer = () => ({ data: STORED, error: null });
    rpcAnswer = { data: null, error: { message: "CONTACT_METHOD_TAKEN: new@reyesbuild.co already belongs to another contact in this workspace" } };
    await expect(setContactPrimaryAddresses("c1", { email: "new@reyesbuild.co" })).rejects.toThrow(/CONTACT_METHOD_TAKEN/);
  });

  it("a direct contact-row update carries no address, whatever the caller passes", async () => {
    answer = () => ({ data: { id: "c1" }, error: null });
    await updateContact("c1", { tags: ["vip"] });
    expect(calls[0]).toMatchObject({ table: "clients", update: { tags: ["vip"] } });
  });
});

describe("finding contacts by an address", () => {
  it("matches ANY of a contact's addresses on the database's key, not the retired column", async () => {
    answer = (call) => (call.table === "client_contact_methods" ? { data: [{ client_id: "c7" }, { client_id: "c7" }], error: null } : { data: [], error: null });
    expect(await contactIdsWithAddress("email", "  Second@Example.TEST ")).toEqual(["c7"]);
    expect(calls[0].table).toBe("client_contact_methods");
    expect(has(calls[0], "eq", "kind", "email")).toBe(true);
    expect(has(calls[0], "eq", "match_key", "second@example.test")).toBe(true);

    calls.length = 0;
    await contactIdsWithAddress("phone", "+1 (512) 555-0190");
    expect(has(calls[0], "eq", "match_key", "5125550190")).toBe(true);
  });

  it("a phone of fewer than seven digits, or an empty address, identifies nobody and asks nothing", async () => {
    expect(await contactIdsWithAddress("phone", "555-01")).toEqual([]);
    expect(await contactIdsWithAddress("email", "   ")).toEqual([]);
    expect(calls).toEqual([]);
  });

  it("duplicates are other contacts sharing any address of this one, shown by their primaries", async () => {
    answer = (call) => {
      if (call.table === "client_contact_methods" && has(call, "eq", "client_id", "c1")) return { data: STORED, error: null };
      if (call.table === "client_contact_methods" && has(call, "eq", "kind", "email")) return { data: [{ client_id: "c2" }], error: null };
      if (call.table === "client_contact_methods") return { data: [{ client_id: "c3" }], error: null };
      return {
        data: [
          { id: "c2", first_name: "Jo", last_name: "R", entity_name: null, lifecycle_stage: "new_lead", created_at: "2026-01-01", client_contact_methods: [method("x", "email", "Jordan.Home@fastmail.com", true, 0)] },
          { id: "c3", first_name: "J", last_name: "Reyes", entity_name: null, lifecycle_stage: "new_lead", created_at: "2026-01-02", client_contact_methods: [] },
        ],
        error: null,
      };
    };
    const rows = await findDuplicates({ id: "c1" });

    const emailLookup = calls.find((c) => c.table === "client_contact_methods" && has(c, "eq", "kind", "email"));
    expect(has(emailLookup, "in", "match_key", ["jordan@reyesbuild.co", "jordan.home@fastmail.com"])).toBe(true);
    expect(has(emailLookup, "neq", "client_id", "c1")).toBe(true);
    const phoneLookup = calls.find((c) => c.table === "client_contact_methods" && has(c, "eq", "kind", "phone"));
    expect(has(phoneLookup, "in", "match_key", ["5125550148"])).toBe(true);

    const people = calls.find((c) => c.table === "clients");
    expect(has(people, "in", "id", ["c2", "c3"])).toBe(true);
    expect(people?.select).toContain("client_contact_methods(");
    expect(people?.select).not.toMatch(/(^|,)\s*(email|phone)\s*(,|$)/);
    expect(rows.map((r) => [r.id, r.email])).toEqual([["c2", "Jordan.Home@fastmail.com"], ["c3", null]]);
    expect(rows[0]).not.toHaveProperty("client_contact_methods");
  });
});

describe("a platform user's primary address", () => {
  it("reads user_contact_methods, never profiles.phone / work_email", async () => {
    answer = () => ({ data: [{ value: "+1 202 555 0142" }], error: null });
    expect(await readUserPrimaryAddress("u1", "phone")).toBe("+1 202 555 0142");
    expect(calls[0].table).toBe("user_contact_methods");
    expect(has(calls[0], "eq", "user_id", "u1")).toBe(true);
    expect(has(calls[0], "eq", "kind", "phone")).toBe(true);
    expect(has(calls[0], "eq", "is_primary", true)).toBe(true);
  });

  it("a read the caller may not make is no address, reported loudly", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    answer = () => ({ data: null, error: { message: "permission denied" } });
    expect(await readUserPrimaryAddress("u1", "email")).toBeNull();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
