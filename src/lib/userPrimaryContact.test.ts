import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ContactMethod } from "@/lib/contact-methods";

const state = vi.hoisted(() => ({
  rows: [] as Array<Record<string, unknown>>,
  readError: null as { message: string } | null,
  rpc: vi.fn(),
  reads: [] as Array<{ table: string; columns: string; eq: [string, unknown] }>,
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) => ({
      select: (columns: string) => ({
        eq: async (col: string, val: unknown) => {
          state.reads.push({ table, columns, eq: [col, val] });
          return { data: state.readError ? null : state.rows, error: state.readError };
        },
      }),
    }),
    rpc: (...args: unknown[]) => state.rpc(...args),
  },
}));

import { readUserPrimaryAddresses, saveUserPrimaryAddresses, withPrimaryAddress } from "./userPrimaryContact";

const m = (id: string, kind: "email" | "phone", value: string, isPrimary: boolean, label: string | null = null): ContactMethod => ({ id, kind, value, label, isPrimary });
const row = (id: string, kind: string, value: string, is_primary: boolean, position: number, label: string | null = null) => ({ id, user_id: "u1", kind, value, label, is_primary, position });

beforeEach(() => {
  state.rows = [];
  state.readError = null;
  state.reads = [];
  state.rpc.mockReset();
  state.rpc.mockImplementation(async (_name: string, args: { p_methods: Array<Record<string, unknown>> }) => ({
    data: args.p_methods.map((p, i) => ({ id: `s${i}`, position: i, ...p })),
    error: null,
  }));
});

describe("withPrimaryAddress — the rules the single profile column used to apply", () => {
  const base = [m("e1", "email", "a@x.co", true, "Work"), m("p1", "phone", "(404) 555-0100", true, "Mobile"), m("p2", "phone", "(404) 555-0199", false, "Home")];

  it("replaces the primary's value and keeps every other address", () => {
    const next = withPrimaryAddress(base, "phone", "(678) 555-0142");
    expect(next.filter((x) => x.kind === "phone").map((x) => [x.id, x.value, x.isPrimary])).toEqual([
      ["p1", "(678) 555-0142", true],
      ["p2", "(404) 555-0199", false],
    ]);
    expect(next.find((x) => x.id === "e1")?.value).toBe("a@x.co");
  });

  it("promotes an address the person already keeps instead of duplicating it", () => {
    const next = withPrimaryAddress(base, "phone", "404.555.0199");
    const phones = next.filter((x) => x.kind === "phone");
    expect(phones).toHaveLength(2);
    expect(phones.find((x) => x.isPrimary)).toMatchObject({ id: "p2", value: "404.555.0199" });
    expect(phones.find((x) => !x.isPrimary)).toMatchObject({ id: "p1", value: "(404) 555-0100" });
  });

  it("blank removes the primary and the next address of that kind becomes primary", () => {
    const next = withPrimaryAddress(base, "phone", "  ");
    expect(next.filter((x) => x.kind === "phone")).toEqual([{ ...base[2], isPrimary: true }]);
  });

  it("adds the first address of a kind as its primary", () => {
    const next = withPrimaryAddress([base[0]], "phone", " 404-555-0111 ");
    expect(next.filter((x) => x.kind === "phone")).toMatchObject([{ kind: "phone", value: "404-555-0111", isPrimary: true, label: null }]);
  });

  it("the same value changes nothing", () => {
    expect(withPrimaryAddress(base, "email", "a@x.co")).toEqual(base);
  });
});

describe("saveUserPrimaryAddresses", () => {
  it("reads the person's list and sends the FULL list back with only the intended entry changed", async () => {
    state.rows = [row("e1", "email", "a@x.co", true, 0, "Sign-in"), row("e2", "email", "b@x.co", false, 1, "Personal"), row("p1", "phone", "(404) 555-0100", true, 0, "Mobile")];
    const result = await saveUserPrimaryAddresses("u1", { phone: "(678) 555-0142" });
    expect(result.ok).toBe(true);
    expect(state.reads).toEqual([{ table: "user_contact_methods", columns: expect.stringContaining("is_primary"), eq: ["user_id", "u1"] }]);
    expect(state.rpc).toHaveBeenCalledTimes(1);
    expect(state.rpc).toHaveBeenCalledWith("set_user_contact_methods", {
      p_user_id: "u1",
      p_methods: [
        { kind: "email", value: "a@x.co", label: "Sign-in", is_primary: true },
        { kind: "email", value: "b@x.co", label: "Personal", is_primary: false },
        { kind: "phone", value: "(678) 555-0142", label: "Mobile", is_primary: true },
      ],
      // The list it read, named as the one it replaces: the server refuses if it changed since.
      p_expected: [
        { kind: "email", value: "a@x.co", label: "Sign-in", is_primary: true },
        { kind: "email", value: "b@x.co", label: "Personal", is_primary: false },
        { kind: "phone", value: "(404) 555-0100", label: "Mobile", is_primary: true },
      ],
    });
  });

  it("builds on the list the screen loaded, names it as the one replaced, and does not re-read", async () => {
    // The stored list has moved on since the screen read it; the save must not be built on the new one.
    state.rows = [row("p9", "phone", "(770) 555-0000", true, 0, "Mobile")];
    const loaded = [m("e1", "email", "a@x.co", true, "Sign-in"), m("p1", "phone", "(404) 555-0100 ", true, "Mobile")];
    const result = await saveUserPrimaryAddresses("u1", { phone: "(678) 555-0142" }, loaded);
    expect(result.ok).toBe(true);
    expect(state.reads).toEqual([]);
    expect(state.rpc).toHaveBeenCalledWith("set_user_contact_methods", {
      p_user_id: "u1",
      p_methods: [
        { kind: "email", value: "a@x.co", label: "Sign-in", is_primary: true },
        { kind: "phone", value: "(678) 555-0142", label: "Mobile", is_primary: true },
      ],
      // Exactly as read — untrimmed — so it compares with what the server stores.
      p_expected: [
        { kind: "email", value: "a@x.co", label: "Sign-in", is_primary: true },
        { kind: "phone", value: "(404) 555-0100 ", label: "Mobile", is_primary: true },
      ],
    });
  });

  it("passes the server's stale refusal back unchanged, so the screen can say someone else saved", async () => {
    state.rpc.mockResolvedValueOnce({ data: null, error: { message: "CONTACT_METHODS_STALE: this list changed since it was loaded" } });
    const result = await saveUserPrimaryAddresses("u1", { phone: "(678) 555-0142" }, [m("p1", "phone", "(404) 555-0100", true)]);
    expect(result).toEqual({ ok: false, error: "CONTACT_METHODS_STALE: this list changed since it was loaded" });
  });

  it("refuses an address that can't be saved before reading or writing anything", async () => {
    const result = await saveUserPrimaryAddresses("u1", { phone: "555" });
    expect(result).toEqual({ ok: false, error: "A phone number needs 7 to 15 digits." });
    expect(state.reads).toEqual([]);
    expect(state.rpc).not.toHaveBeenCalled();
  });

  it("writes nothing when the value is already the primary", async () => {
    state.rows = [row("p1", "phone", "(404) 555-0100", true, 0)];
    const result = await saveUserPrimaryAddresses("u1", { phone: "(404) 555-0100" });
    expect(result).toMatchObject({ ok: true, changed: false });
    expect(state.rpc).not.toHaveBeenCalled();
  });

  it("never writes a list built on a read that failed", async () => {
    state.readError = { message: "permission denied" };
    const result = await saveUserPrimaryAddresses("u1", { phone: "(404) 555-0100" });
    expect(result).toEqual({ ok: false, error: "permission denied" });
    expect(state.rpc).not.toHaveBeenCalled();
  });

  it("reports a refusal from the server", async () => {
    state.rpc.mockResolvedValueOnce({ data: null, error: { message: "USER_CONTACT_METHODS_FORBIDDEN" } });
    const result = await saveUserPrimaryAddresses("u1", { email: "c@x.co" });
    expect(result).toEqual({ ok: false, error: "USER_CONTACT_METHODS_FORBIDDEN" });
  });
});

describe("readUserPrimaryAddresses", () => {
  it("returns the primaries, whatever order the rows arrive in", async () => {
    state.rows = [row("p2", "phone", "(404) 555-0199", false, 1), row("e1", "email", "a@x.co", true, 0), row("p1", "phone", "(404) 555-0100", true, 0)];
    expect(await readUserPrimaryAddresses("u1")).toEqual({ email: "a@x.co", phone: "(404) 555-0100", error: null });
  });
});
