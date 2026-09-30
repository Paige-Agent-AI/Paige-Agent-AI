import { describe, expect, it } from "vitest";
// Pure edge modules (no Deno imports; any database client is injected): the address edits Paige's
// own tools (paige-mcp, paige-ai-chat, paige-bridge) turn into a contact's complete address list,
// and the address half of her contact search.
import {
  addedMethodsProblem,
  CLIENT_RECORD_COLUMNS,
  clientRowPatchProblem,
  CONTACT_METHODS_STALE,
  intentResult,
  planAddressWrite,
  proposedAddressIntent,
  storedAddressIntent,
  storedMethodList,
  undoAddressWrite,
  withAddedMethods,
  withPrimaryAddress,
  writeAddressIntent,
  type AddressIntent,
  type ContactMethodInput,
} from "../../supabase/functions/_shared/paige-mcp/contact-method-edits";
import {
  ADDRESS_MATCH_LIMIT,
  applyContactSearchFilter,
  contactIdsByAddressToken,
} from "../../supabase/functions/_shared/contact-search";

const ADA: ContactMethodInput[] = [
  { kind: "email", value: "ada@home.test", label: "Home", is_primary: true },
  { kind: "email", value: "ada@work.test", label: "Work", is_primary: false },
  { kind: "phone", value: "+1 555 010 0101", label: "Mobile", is_primary: true },
];

describe("making an address the primary (what writing the old single column did)", () => {
  it("takes the current primary's place and keeps its label, keeping every other address", () => {
    expect(withPrimaryAddress(ADA, "email", "ada@new.test")).toEqual([
      { kind: "email", value: "ada@new.test", label: "Home", is_primary: true },
      { kind: "email", value: "ada@work.test", label: "Work", is_primary: false },
      { kind: "phone", value: "+1 555 010 0101", label: "Mobile", is_primary: true },
    ]);
  });

  it("promotes an address the contact already holds instead of duplicating it", () => {
    const out = withPrimaryAddress(ADA, "email", "ADA@work.test");
    expect(out.filter((m) => m.kind === "email")).toEqual([
      { kind: "email", value: "ada@home.test", label: "Home", is_primary: false },
      { kind: "email", value: "ADA@work.test", label: "Work", is_primary: true },
    ]);
  });

  it("matches a phone on its digits, however it is formatted", () => {
    const out = withPrimaryAddress(ADA, "phone", "(555) 010-0101");
    expect(out.filter((m) => m.kind === "phone")).toEqual([
      { kind: "phone", value: "(555) 010-0101", label: "Mobile", is_primary: true },
    ]);
  });

  it("adds the first address of a kind as its primary", () => {
    const out = withPrimaryAddress([{ kind: "email", value: "bo@x.test", is_primary: true }], "phone", "+1 555 010 0199");
    expect(out).toEqual([
      { kind: "email", value: "bo@x.test", label: null, is_primary: true },
      { kind: "phone", value: "+1 555 010 0199", label: null, is_primary: true },
    ]);
  });

  it("removes the primary on null or blank and promotes the next address of that kind", () => {
    for (const blank of [null, "", "   "]) {
      expect(withPrimaryAddress(ADA, "email", blank).filter((m) => m.kind === "email")).toEqual([
        { kind: "email", value: "ada@work.test", label: "Work", is_primary: true },
      ]);
    }
    expect(withPrimaryAddress(ADA, "phone", null).filter((m) => m.kind === "phone")).toEqual([]);
  });

  it("leaves the list as it is when the address is already the primary", () => {
    expect(withPrimaryAddress(ADA, "email", "ada@home.test")).toEqual(
      ADA.map((m) => ({ ...m, label: m.label ?? null })),
    );
  });
});

describe("adding addresses (the rule of _add_client_contact_methods)", () => {
  it("keeps every address held and appends new ones as secondary", () => {
    const out = withAddedMethods(ADA, [{ kind: "email", value: "ada@other.test" }]);
    expect(out.filter((m) => m.kind === "email").map((m) => [m.value, m.is_primary])).toEqual([
      ["ada@home.test", true], ["ada@work.test", false], ["ada@other.test", false],
    ]);
  });

  it("makes a new address primary only when marked so, demoting the old primary", () => {
    const out = withAddedMethods(ADA, [{ kind: "phone", value: "+1 555 010 0102", is_primary: true }]);
    expect(out.filter((m) => m.kind === "phone").map((m) => [m.value, m.is_primary])).toEqual([
      ["+1 555 010 0101", false], ["+1 555 010 0102", true],
    ]);
  });

  it("never duplicates an address the contact holds; marking it primary promotes it", () => {
    const out = withAddedMethods(ADA, [{ kind: "email", value: "Ada@Work.test", is_primary: true }]);
    expect(out.filter((m) => m.kind === "email").map((m) => [m.value, m.is_primary])).toEqual([
      ["ada@home.test", false], ["ada@work.test", true],
    ]);
  });

  it("gives a kind the contact held none of its first new address as primary", () => {
    const out = withAddedMethods([{ kind: "email", value: "bo@x.test", is_primary: true }], [
      { kind: "phone", value: "+1 555 010 0111" }, { kind: "phone", value: "+1 555 010 0112" },
    ]);
    expect(out.filter((m) => m.kind === "phone").map((m) => [m.value, m.is_primary])).toEqual([
      ["+1 555 010 0111", true], ["+1 555 010 0112", false],
    ]);
  });
});

describe("the address change a free-form contact update proposes", () => {
  const intent = (updates: Record<string, unknown>) => {
    const out = proposedAddressIntent(updates);
    if ("error" in out) throw new Error(out.error);
    return out.intent;
  };

  it("proposes nothing when the update names no address", () => {
    expect(intent({ first_name: "Ada" })).toBeNull();
  });

  it("records WHAT was asked — make primary, add, or replace — never a frozen resulting list", () => {
    expect(intent({ email: "ada@new.test", phone: null })).toEqual({ op: "primary", values: { email: "ada@new.test", phone: null } });
    expect(intent({ add_contact_methods: [{ kind: "email", value: "x@y.test" }] }))
      .toEqual({ op: "add", methods: [{ kind: "email", value: "x@y.test" }] });
    expect(intent({ contact_methods: [{ kind: "email", value: "x@y.test", is_primary: true }] }))
      .toEqual({ op: "replace", methods: [{ kind: "email", value: "x@y.test", is_primary: true }] });
  });

  it("previews the list each intent leaves, for the diff the teammate confirms", () => {
    const next = intentResult(intent({ email: "ada@new.test", phone: "+1 555 010 0199" })!, ADA);
    expect(next.filter((m) => m.is_primary).map((m) => m.value)).toEqual(["ada@new.test", "+1 555 010 0199"]);
    expect(next.map((m) => m.value)).toContain("ada@work.test");
    expect(intentResult(intent({ add_contact_methods: [{ kind: "email", value: "x@y.test" }] })!, ADA)).toHaveLength(4);
  });

  it("refuses mixed spellings, malformed lists and additions the database would refuse, naming why", () => {
    expect(proposedAddressIntent({ email: "a@b.test", contact_methods: [] })).toEqual({ error: expect.stringContaining("CONTACT_METHODS_AMBIGUOUS") });
    expect(proposedAddressIntent({ add_contact_methods: [{ kind: "fax", value: "1" }] })).toEqual({ error: expect.stringContaining("CONTACT_METHODS_INVALID") });
    expect(proposedAddressIntent({ contact_methods: [{ kind: "email", value: "a@b.test", position: 0 }] })).toEqual({ error: expect.stringContaining("CONTACT_METHODS_INVALID") });
    expect(proposedAddressIntent({ phone: 5550100 })).toEqual({ error: expect.stringContaining("CONTACT_METHOD_VALUE_REQUIRED") });
    expect(proposedAddressIntent({ add_contact_methods: [] })).toEqual({ error: expect.stringContaining("CONTACT_METHODS_INVALID") });
    // The same address twice, and two primaries of one kind: _add_client_contact_methods refuses
    // both, so the proposal does too instead of silently collapsing them.
    expect(proposedAddressIntent({ add_contact_methods: [{ kind: "email", value: "x@y.test" }, { kind: "email", value: "X@Y.test" }] }))
      .toEqual({ error: expect.stringContaining("CONTACT_METHOD_DUPLICATE") });
    expect(proposedAddressIntent({ add_contact_methods: [
      { kind: "phone", value: "+1 555 010 0111", is_primary: true }, { kind: "phone", value: "+1 555 010 0112", is_primary: true },
    ] })).toEqual({ error: expect.stringContaining("CONTACT_METHOD_PRIMARY_CONFLICT") });
    expect(addedMethodsProblem([{ kind: "email", value: "a@b.test" }, { kind: "phone", value: "+1 555 010 0111" }])).toBeNull();
  });

  it("reads a stored intent back only when it is well formed", () => {
    expect(storedAddressIntent({ op: "primary", values: { email: "a@b.test" } })).toEqual({ op: "primary", values: { email: "a@b.test" } });
    expect(storedAddressIntent({ op: "add", methods: [{ kind: "email", value: "a@b.test" }] })).not.toBeNull();
    for (const bad of [null, [], { op: "drop" }, { op: "primary", values: {} }, { op: "primary", values: { fax: "1" } }, { op: "add", methods: [] }]) {
      expect(storedAddressIntent(bad)).toBeNull();
    }
  });

  it("carries a full list — up to 20 emails and 20 phones — as the list a change was built on", () => {
    const full: ContactMethodInput[] = [
      ...Array.from({ length: 20 }, (_, i) => ({ kind: "email" as const, value: `p${i}@x.test`, label: null, is_primary: i === 0 })),
      ...Array.from({ length: 5 }, (_, i) => ({ kind: "phone" as const, value: `+1 555 010 01${10 + i}`, label: null, is_primary: i === 0 })),
    ];
    expect(storedMethodList(full)).toHaveLength(25);
    expect(storedMethodList(undefined)).toBeNull();
  });
});

// ── Applying an address change to the list held NOW (the confirmed defect: a proposal froze the
//    complete list at propose time and confirm wrote it back, deleting anything added between) ──

const A: ContactMethodInput = { kind: "email", value: "a@x.test", label: null, is_primary: true };
const C: ContactMethodInput = { kind: "email", value: "c@x.test", label: null, is_primary: false };

const B: ContactMethodInput = { kind: "email", value: "b@x.test", label: null, is_primary: false };
const MAKE_B_PRIMARY: AddressIntent = { op: "primary", values: { email: "b@x.test" } };

describe("planning an address write against the list held at that moment", () => {
  // A proposed change is confirmed only against the very list its preview was built on — the
  // database's own rule (contact_methods_fingerprint). Anything else could write a result the
  // approver was never shown.
  it("refuses as stale when the target the preview promoted was removed before confirm", () => {
    // Held [a*, b]; the preview promotes b and KEEPS a. b is removed before confirm. Building on
    // [a*] would put b in a's place — deleting a, which the approver was shown kept.
    expect(intentResult(MAKE_B_PRIMARY, [A, B]).map((m) => [m.value, m.is_primary]))
      .toEqual([["a@x.test", false], ["b@x.test", true]]);
    expect(planAddressWrite(MAKE_B_PRIMARY, [A, B], [A])).toEqual({ stale: CONTACT_METHODS_STALE });
  });

  it("refuses as stale when the target was added before confirm, which would change what the preview showed", () => {
    // Proposed on [a*]: b takes a's place, a is removed. b arrives as a secondary before confirm;
    // building on [a*, b] would promote b and keep a instead.
    expect(planAddressWrite(MAKE_B_PRIMARY, [A], [A, B])).toEqual({ stale: CONTACT_METHODS_STALE });
  });

  it("refuses as stale when any address was added, removed, relabelled, reordered or promoted after the proposal", () => {
    expect(planAddressWrite(MAKE_B_PRIMARY, [A], [A, C])).toEqual({ stale: CONTACT_METHODS_STALE });
    expect(planAddressWrite(MAKE_B_PRIMARY, [A, C], [A])).toEqual({ stale: CONTACT_METHODS_STALE });
    expect(planAddressWrite(MAKE_B_PRIMARY, [A], [{ ...A, label: "Work" }])).toEqual({ stale: CONTACT_METHODS_STALE });
    const promoted: ContactMethodInput[] = [{ ...A, is_primary: false }, { ...C, is_primary: true }];
    expect(planAddressWrite(MAKE_B_PRIMARY, [A, C], promoted)).toEqual({ stale: CONTACT_METHODS_STALE });
    const D: ContactMethodInput = { kind: "email", value: "d@x.test", label: null, is_primary: false };
    expect(planAddressWrite(MAKE_B_PRIMARY, [A, C, D], [A, D, C])).toEqual({ stale: CONTACT_METHODS_STALE });
  });

  it("writes the approved preview when the list is unchanged, checked against the list it was built on", () => {
    const plan = planAddressWrite(MAKE_B_PRIMARY, [A, B, C], [A, B, C]);
    expect(plan).toEqual({
      rpc: "_replace_client_contact_methods_checked",
      methods: intentResult(MAKE_B_PRIMARY, [A, B, C]),
      expected: [A, B, C],
    });
  });

  it("compares lists as the database does: outer whitespace, blank labels, kind interleaving and an implied primary are not changes", () => {
    const P: ContactMethodInput = { kind: "phone", value: "+1 555 010 0101", label: "Mobile", is_primary: true };
    const builtOn: ContactMethodInput[] = [{ ...A, is_primary: false }, C, P];
    const heldNow: ContactMethodInput[] = [P, { ...A, value: "  a@x.test\u00a0\u200b", label: " ", is_primary: true }, C];
    expect(planAddressWrite(MAKE_B_PRIMARY, builtOn, heldNow)).toMatchObject({ rpc: "_replace_client_contact_methods_checked", expected: builtOn });
    // Case is a change: the database compares values as stored.
    expect(planAddressWrite(MAKE_B_PRIMARY, [A], [{ ...A, value: "A@x.test" }])).toEqual({ stale: CONTACT_METHODS_STALE });
  });

  it("adds through the database's own merge, which keeps every held address", () => {
    expect(planAddressWrite({ op: "add", methods: [{ kind: "email", value: "b@x.test" }] }, [A], [A, C]))
      .toEqual({ rpc: "_add_client_contact_methods", methods: [{ kind: "email", value: "b@x.test" }] });
  });

  it("replaces only against the list the replacement was built on", () => {
    const replace: AddressIntent = { op: "replace", methods: [{ kind: "email", value: "b@x.test", is_primary: true }] };
    expect(planAddressWrite(replace, [A], [A])).toEqual({ rpc: "_replace_client_contact_methods_checked", methods: replace.methods, expected: [A] });
    expect(planAddressWrite(replace, [A], [A, C])).toEqual({ stale: CONTACT_METHODS_STALE });
    // A change made right now is built on the list held now.
    expect(planAddressWrite(replace, null, [A, C])).toMatchObject({ expected: [A, C] });
  });
});

/** A fake service-role client: a client_contact_methods table read, and recorded rpc calls. */
function methodsDb(held: ContactMethodInput[][], rpcErrors: Array<string | null> = []) {
  const calls: Array<{ fn: string; args: Record<string, unknown> }> = [];
  let reads = 0;
  const client = {
    from: () => {
      const chain = {
        select: () => chain,
        eq: () => chain,
        then: (resolve: (v: unknown) => void) => {
          const rows = held[Math.min(reads, held.length - 1)].map((m, position) => ({ ...m, position }));
          reads += 1;
          resolve({ data: rows, error: null });
        },
      };
      return chain;
    },
    rpc: async (fn: string, args: Record<string, unknown>) => {
      calls.push({ fn, args });
      const message = rpcErrors[calls.length - 1] ?? null;
      if (message) return { data: null, error: { message } };
      return { data: (args._methods as ContactMethodInput[]).map((m, position) => ({ ...m, label: m.label ?? null, is_primary: m.is_primary === true, position })), error: null };
    },
  };
  return { client, calls };
}

describe("writing an address change (writeAddressIntent / undoAddressWrite)", () => {
  it("applies a confirmed new primary to the list it was built on, checked against it", async () => {
    const { client, calls } = methodsDb([[A, C]]);
    const out = await writeAddressIntent(client, "t1", "c1", MAKE_B_PRIMARY, [A, C]);
    expect(out.ok).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0].fn).toBe("_replace_client_contact_methods_checked");
    expect((calls[0].args._methods as ContactMethodInput[]).map((m) => m.value)).toEqual(["b@x.test", "c@x.test"]);
    expect(calls[0].args._expected).toEqual([A, C]);
  });

  it("writes nothing for a proposed change when the list held at confirm is not the one it was built on", async () => {
    const { client, calls } = methodsDb([[A]]);
    const out = await writeAddressIntent(client, "t1", "c1", MAKE_B_PRIMARY, [A, B], 3);
    expect(out).toEqual({ ok: false, error: CONTACT_METHODS_STALE, stale: true });
    expect(calls).toHaveLength(0);
  });

  it("never retries a proposed change the database refused as stale", async () => {
    const { client, calls } = methodsDb([[A]], ["CONTACT_METHODS_STALE: this list changed since it was loaded"]);
    const out = await writeAddressIntent(client, "t1", "c1", { op: "primary", values: { email: "b@x.test" } }, [A], 3);
    expect(out).toEqual({ ok: false, error: CONTACT_METHODS_STALE, stale: true });
    expect(calls).toHaveLength(1);
  });

  it("rebuilds a direct change on the new list after losing a race, then writes it", async () => {
    const { client, calls } = methodsDb([[A], [A, C]], ["CONTACT_METHODS_STALE: this list changed since it was loaded", null]);
    const out = await writeAddressIntent(client, "t1", "c1", { op: "primary", values: { email: "b@x.test" } }, null, 2);
    expect(out.ok).toBe(true);
    expect(calls).toHaveLength(2);
    expect((calls[1].args._methods as ContactMethodInput[]).map((m) => m.value)).toEqual(["b@x.test", "c@x.test"]);
    expect(calls[1].args._expected).toEqual([A, C]);
  });

  it("undoes exactly its own write, and only if the list is still what it left", async () => {
    const { client, calls } = methodsDb([[A]]);
    const written = await writeAddressIntent(client, "t1", "c1", { op: "add", methods: [{ kind: "email", value: "b@x.test" }] }, null);
    if (!written.ok) throw new Error("the write was refused");
    expect(await undoAddressWrite(client, "t1", "c1", written)).toBeNull();
    expect(calls[1]).toEqual({ fn: "_replace_client_contact_methods_checked", args: {
      _tenant_id: "t1", _client_id: "c1", _methods: written.before, _expected: written.after,
    } });
  });
});

describe("the contact-row half of a proposed update, checked before anything is written", () => {
  it("refuses what the contact row would refuse, so the row update is never the step that fails", () => {
    expect(clientRowPatchProblem({ first_name: "Ada", funding_goal: 5000, lifecycle_stage: "won", tier: null })).toBeNull();
    expect(clientRowPatchProblem({ funding_goal_amount: 5000 })).toContain("CONTACT_FIELD_FORBIDDEN");
    expect(clientRowPatchProblem({ email: "a@b.test" })).toContain("CONTACT_FIELD_FORBIDDEN");
    expect(clientRowPatchProblem({ lifecycle_stage: "bogus" })).toContain("CONTACT_FIELD_INVALID");
    expect(clientRowPatchProblem({ tier: "gold" })).toContain("CONTACT_FIELD_INVALID");
    expect(clientRowPatchProblem({ monthly_revenue: "lots" })).toContain("CONTACT_FIELD_INVALID");
    expect(clientRowPatchProblem({ first_name: " " })).toContain("CONTACT_FIELD_INVALID");
    expect(clientRowPatchProblem({ website: 42 })).toContain("CONTACT_FIELD_INVALID");
  });
});

describe("a whole contact record, read without the single-address columns", () => {
  it("names every column except email and phone, and never every column", () => {
    const cols = CLIENT_RECORD_COLUMNS.split(",").map((c) => c.trim());
    expect(cols).not.toContain("email");
    expect(cols).not.toContain("phone");
    expect(cols).not.toContain("*");
    for (const needed of ["id", "tenant_id", "account_number", "linked_user_id", "first_name", "current_notes"]) {
      expect(cols).toContain(needed);
    }
  });
});

describe("the address half of Paige's contact search", () => {
  function methodsTable() {
    const calls: Array<{ eq: Array<[string, unknown]>; or: string }> = [];
    const client = {
      from: () => {
        const call = { eq: [] as Array<[string, unknown]>, or: "" };
        calls.push(call);
        const chain = {
          select: () => chain,
          eq: (column: string, value: unknown) => { call.eq.push([column, value]); return chain; },
          or: (filter: string) => { call.or = filter; return chain; },
          limit: async () => ({ data: [{ client_id: "c1" }], error: null }),
        };
        return chain;
      },
    };
    return { client, calls };
  }

  it("searches one workspace by its id", async () => {
    const { client, calls } = methodsTable();
    await contactIdsByAddressToken(client, "tenant-a", "ada@x.test", "test");
    expect(calls[0].eq).toEqual([["tenant_id", "tenant-a"]]);
  });

  it("searches every workspace only when asked to by name, for the platform owner", async () => {
    const { client, calls } = methodsTable();
    const matches = await contactIdsByAddressToken(client, { anyWorkspace: true }, "ada@x.test", "test");
    expect(calls[0].eq).toEqual([]);
    expect(matches.get("ada@x.test")).toEqual(["c1"]);
  });

  it("searches nothing for an unresolved workspace, rather than every workspace", async () => {
    const { client, calls } = methodsTable();
    expect((await contactIdsByAddressToken(client, "", "ada@x.test", "test")).size).toBe(0);
    expect((await contactIdsByAddressToken(client, undefined as unknown as string, "ada@x.test", "test")).size).toBe(0);
    expect(calls).toHaveLength(0);
  });

  it("folds at most ADDRESS_MATCH_LIMIT contacts per token into the filter, however broad the reach", async () => {
    const many = Array.from({ length: ADDRESS_MATCH_LIMIT + 50 }, (_, i) => ({ client_id: `c${i}` }));
    let limitAsked = 0;
    const client = {
      from: () => {
        const chain = {
          select: () => chain,
          eq: () => chain,
          or: () => chain,
          limit: async (n: number) => { limitAsked = n; return { data: many.slice(0, n), error: null }; },
        };
        return chain;
      },
    };
    const matches = await contactIdsByAddressToken(client, { anyWorkspace: true }, "gmail", "test");
    expect(limitAsked).toBe(ADDRESS_MATCH_LIMIT + 1);
    expect(matches.get("gmail")).toHaveLength(ADDRESS_MATCH_LIMIT);
    let filter = "";
    applyContactSearchFilter({ or: (f: string) => { filter = f; } }, "gmail com", {
      mode: "any", addressMatches: new Map([["gmail", matches.get("gmail")!], ["com", many.map((r) => r.client_id)]]),
    });
    expect((filter.match(/id\.in\.\(([^)]*)\)/)?.[1] ?? "").split(",")).toHaveLength(ADDRESS_MATCH_LIMIT);
  });
});
