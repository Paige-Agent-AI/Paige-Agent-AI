import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
// The edge helper is pure (no Deno imports, the client is injected), so vitest exercises the
// real logic that every inbound channel now uses to recognise a contact.
import {
  contactMethodMatchKey,
  findClientIdByAddress,
  findFirstClientByEmailAnyWorkspace,
  findSoleClientByEmailAnyWorkspace,
  isMatchableAddress,
  primaryContactMethod,
} from "../../supabase/functions/_shared/contact-methods";

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

// ── Anti-regression: no edge function finds a contact by the old single columns ─────────────────
// A contact holds several addresses; a lookup on clients.email / clients.phone sees only the
// primary and silently misses a person writing from their second address. PAIGE's own tools are
// moved by the next slice of this lane; this list shrinks to empty there and is then deleted.
const NOT_YET_MOVED = new Set([
  "supabase/functions/paige-ai-chat/index.ts",
  "supabase/functions/paige-mcp/index.ts",
]);

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
      .filter((file) => !NOT_YET_MOVED.has(file))
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
