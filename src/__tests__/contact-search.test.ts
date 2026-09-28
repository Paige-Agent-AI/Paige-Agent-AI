import { describe, it, expect, vi } from "vitest";
// The CRM contact-search helper lives with the edge functions (it builds PostgREST
// .or() filters shared by every "look up a contact by name" tool). It is pure (no Deno
// imports), so vitest can exercise it here as the CI regression guard for hotfix #127 —
// the full-name false-negative the owner caught live ("Tashia Anderson" → 0 results).
import {
  contactSearchTokens,
  contactSearchOrGroup,
  applyContactSearchFilter,
  CONTACT_SEARCH_COLUMNS,
} from "../../supabase/functions/_shared/contact-search";

/** Minimal PostgREST-builder stand-in that records every `.or()` filter string. */
function mockBuilder() {
  const ors: string[] = [];
  const b = {
    ors,
    or(filter: string) {
      ors.push(filter);
      return b;
    },
  };
  return b;
}

describe("contactSearchTokens", () => {
  it("splits a full name into its parts (the bug: this used to be one phrase)", () => {
    expect(contactSearchTokens("Tashia Anderson")).toEqual(["Tashia", "Anderson"]);
  });
  it("keeps every word of a natural-language query", () => {
    expect(contactSearchTokens("Marcus from Atlanta")).toEqual(["Marcus", "from", "Atlanta"]);
  });
  it("collapses extra whitespace and drops empties", () => {
    expect(contactSearchTokens("  Tashia   Anderson  ")).toEqual(["Tashia", "Anderson"]);
  });
  it("strips PostgREST-grammar-significant chars (%, comma, parens) that would break .or()", () => {
    expect(contactSearchTokens("Tashia%,() Anderson")).toEqual(["Tashia", "Anderson"]);
  });
  it("returns no tokens for blank input", () => {
    expect(contactSearchTokens("   ")).toEqual([]);
    expect(contactSearchTokens("")).toEqual([]);
  });
  it("returns no tokens for an all-punctuation query (the fuzzy empty_query guard, §39 finding #2)", () => {
    // search_clients_fuzzy guards on contactSearchTokens(query).length===0, so these
    // must tokenize to [] (→ empty_query error) rather than a tokenless full-list fall-through.
    expect(contactSearchTokens("()")).toEqual([]);
    expect(contactSearchTokens("%%")).toEqual([]);
    expect(contactSearchTokens(",,")).toEqual([]);
  });
});

describe("contactSearchOrGroup", () => {
  it("ORs a token across the default columns", () => {
    expect(contactSearchOrGroup("Tashia")).toBe(
      "first_name.ilike.%Tashia%,last_name.ilike.%Tashia%,email.ilike.%Tashia%,entity_name.ilike.%Tashia%,phone.ilike.%Tashia%",
    );
  });
  it("honors a custom column list", () => {
    expect(contactSearchOrGroup("X", ["city"])).toBe("city.ilike.%X%");
  });
});

describe("applyContactSearchFilter — 'all' mode (strict by-name lookup)", () => {
  it("emits ONE or()-group PER token (AND-combined) so 'Tashia Anderson' matches first+last", () => {
    const b = mockBuilder();
    applyContactSearchFilter(b, "Tashia Anderson");
    expect(b.ors).toHaveLength(2);
    expect(b.ors[0]).toContain("first_name.ilike.%Tashia%");
    expect(b.ors[0]).toContain("last_name.ilike.%Tashia%");
    expect(b.ors[1]).toContain("first_name.ilike.%Anderson%");
    expect(b.ors[1]).toContain("last_name.ilike.%Anderson%");
  });
  it("a single token behaves exactly like the old single-group search (one or())", () => {
    const b = mockBuilder();
    applyContactSearchFilter(b, "Tashia");
    expect(b.ors).toHaveLength(1);
  });
  it("adds no filter for a blank query", () => {
    const b = mockBuilder();
    applyContactSearchFilter(b, "   ");
    expect(b.ors).toHaveLength(0);
  });
});

describe("applyContactSearchFilter — 'any' mode (fuzzy / natural-language)", () => {
  it("emits a SINGLE or() over every token × column, so stopwords don't zero the result", () => {
    const b = mockBuilder();
    applyContactSearchFilter(b, "Marcus from Atlanta", {
      mode: "any",
      columns: [...CONTACT_SEARCH_COLUMNS, "city"],
    });
    expect(b.ors).toHaveLength(1);
    const group = b.ors[0];
    // every token appears…
    expect(group).toContain("%Marcus%");
    expect(group).toContain("%from%");
    expect(group).toContain("%Atlanta%");
    // …and the city column is searchable (the "from <place>" pattern)
    expect(group).toContain("city.ilike.%Atlanta%");
    // a full name still resolves in any-mode (both tokens present in the OR)
    const b2 = mockBuilder();
    applyContactSearchFilter(b2, "Tashia Anderson", { mode: "any" });
    expect(b2.ors[0]).toContain("%Tashia%");
    expect(b2.ors[0]).toContain("%Anderson%");
  });
});

describe("searching a contact's addresses through its contact methods", () => {
  it("adds the contacts whose addresses match a token to that token's group", async () => {
    const { contactIdsByAddressToken, CONTACT_NAME_SEARCH_COLUMNS } = await import("../../supabase/functions/_shared/contact-search");
    const filters: string[] = [];
    const chain = {
      select: () => chain,
      eq: () => chain,
      or: (filter: string) => { filters.push(filter); return chain; },
      limit: async () => ({ data: [{ client_id: "c1" }, { client_id: "c1" }, { client_id: "c2" }], error: null }),
    };
    const matches = await contactIdsByAddressToken({ from: () => chain }, "tenant-a", "555-0101", "test");
    // A phone token also matches on its digits, so a differently formatted number is found.
    expect(filters[0]).toBe("value.ilike.%555-0101%,match_key.ilike.%5550101%");
    expect(matches.get("555-0101")).toEqual(["c1", "c2"]);

    const b = mockBuilder();
    applyContactSearchFilter(b, "Ada 555-0101", { columns: CONTACT_NAME_SEARCH_COLUMNS, addressMatches: matches });
    expect(b.ors).toEqual([
      "first_name.ilike.%Ada%,last_name.ilike.%Ada%,entity_name.ilike.%Ada%",
      "first_name.ilike.%555-0101%,last_name.ilike.%555-0101%,entity_name.ilike.%555-0101%,id.in.(c1,c2)",
    ]);
  });

  it("keeps searching names when the address lookup fails", async () => {
    const { contactIdsByAddressToken } = await import("../../supabase/functions/_shared/contact-search");
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const chain = { select: () => chain, eq: () => chain, or: () => chain, limit: async () => ({ data: null, error: { code: "42501", message: "denied" } }) };
    expect((await contactIdsByAddressToken({ from: () => chain }, "tenant-a", "ada@x.test", "test")).size).toBe(0);
    expect(error).toHaveBeenCalledWith("[test] contact_address_search_failed", expect.objectContaining({ code: "42501" }));
    error.mockRestore();
  });
});
