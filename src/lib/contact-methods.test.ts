import { describe, expect, it } from "vitest";
import {
  addContactMethod,
  contactMethodErrorFor,
  contactMethodMatchKey,
  makePrimary,
  moveContactMethod,
  orderContactMethods,
  isContactMethodsStale,
  isOutdatedPage,
  primaryAddressesOf,
  primaryValue,
  rebaseContactMethods,
  withPrimaryAddress,
  withPrimaryAddresses,
  removeContactMethod,
  toContactMethodsPayload,
  toLoadedContactMethodsPayload,
  validateContactMethods,
  type ContactMethod,
} from "./contact-methods";

const m = (id: string, kind: "email" | "phone", value: string, isPrimary = false, label: string | null = null): ContactMethod => ({ id, kind, value, label, isPrimary });
const ids = (list: ContactMethod[]) => list.map((x) => `${x.id}${x.isPrimary ? "*" : ""}`).join(",");

const base = [
  m("e1", "email", "jordan@reyesbuild.co", true, "Work"),
  m("e2", "email", "jordan.home@fastmail.com", false, "Personal"),
  m("e3", "email", "accounts@reyesbuild.co", false, "Billing"),
  m("p1", "phone", "+1 (512) 555-0148", true, "Mobile"),
  m("p2", "phone", "(512) 555-0190", false, "Work"),
];

describe("contact methods model", () => {
  it("reads rows primary first, then the stored order, per kind", () => {
    const ordered = orderContactMethods([
      { id: "b", kind: "email", value: "b@x.co", label: null, is_primary: false, position: 2 },
      { id: "p", kind: "phone", value: "5125550100", label: null, is_primary: true, position: 0 },
      { id: "a", kind: "email", value: "a@x.co", label: null, is_primary: false, position: 1 },
      { id: "c", kind: "email", value: "c@x.co", label: null, is_primary: true, position: 0 },
      { id: "z", kind: "fax", value: "1", label: null, is_primary: true, position: 0 },
    ]);
    expect(ids(ordered)).toBe("c*,a,b,p*");
    expect(primaryValue(ordered, "email")).toBe("c@x.co");
    expect(primaryValue([], "phone")).toBeNull();
  });

  it("matches as the database does: emails case-insensitively, phones on their last ten digits", () => {
    expect(contactMethodMatchKey("email", "  Jordan@ReyesBuild.co ")).toBe("jordan@reyesbuild.co");
    expect(contactMethodMatchKey("phone", "+1 (512) 555-0148")).toBe("5125550148");
    expect(contactMethodMatchKey("phone", "512.555.0148")).toBe("5125550148");
  });

  it("making an address primary moves it to the top and steps the old primary down", () => {
    const next = makePrimary(base, "e3");
    expect(ids(next.filter((x) => x.kind === "email"))).toBe("e3*,e1,e2");
    expect(ids(next.filter((x) => x.kind === "phone"))).toBe("p1*,p2");
  });

  it("removing the primary promotes the next address of that kind; removing the last leaves none", () => {
    expect(ids(removeContactMethod(base, "e1").filter((x) => x.kind === "email"))).toBe("e2*,e3");
    expect(ids(removeContactMethod(removeContactMethod(base, "p1"), "p2").filter((x) => x.kind === "phone"))).toBe("");
    expect(ids(removeContactMethod(base, "e2").filter((x) => x.kind === "email"))).toBe("e1*,e3");
  });

  it("moves only secondaries, never above the primary or past the end", () => {
    expect(ids(moveContactMethod(base, "e3", -1).filter((x) => x.kind === "email"))).toBe("e1*,e3,e2");
    expect(ids(moveContactMethod(base, "e2", -1).filter((x) => x.kind === "email"))).toBe("e1*,e2,e3");
    expect(ids(moveContactMethod(base, "e3", 1).filter((x) => x.kind === "email"))).toBe("e1*,e2,e3");
    expect(ids(moveContactMethod(base, "e1", 1).filter((x) => x.kind === "email"))).toBe("e1*,e2,e3");
  });

  it("the first address of a kind is added as its primary; later ones are not", () => {
    const first = addContactMethod([], "phone");
    expect(first.methods).toEqual([expect.objectContaining({ id: first.id, kind: "phone", value: "", isPrimary: true, label: "Mobile" })]);
    const second = addContactMethod(base, "email");
    expect(second.methods.find((x) => x.id === second.id)).toMatchObject({ isPrimary: false, label: "Other" });
    expect(second.methods.filter((x) => x.kind === "email").at(-1)?.id).toBe(second.id);
  });

  it("flags on the row what the database would refuse", () => {
    const errors = validateContactMethods([
      m("a", "email", "", true),
      m("b", "email", "jordan@reyesbuild", false),
      m("c", "email", "Jordan@ReyesBuild.co", false),
      m("d", "email", "jordan@reyesbuild.co", false),
      m("e", "phone", "555-01", true),
      m("f", "phone", "+1 (512) 555-0148", false),
      m("g", "phone", "512.555.0148", false),
    ]);
    expect(errors).toEqual({
      a: "Enter an email address, or remove this row.",
      b: "That isn't a complete email address.",
      d: "Already listed above.",
      e: "A phone number needs 7 to 15 digits.",
      g: "Already listed above.",
    });
  });

  it("sends the complete ordered list, trimmed, with blank labels as null", () => {
    expect(toContactMethodsPayload([m("p", "phone", " 5125550100 ", true, " "), ...base.slice(0, 2)])).toEqual([
      { kind: "email", value: "jordan@reyesbuild.co", label: "Work", is_primary: true },
      { kind: "email", value: "jordan.home@fastmail.com", label: "Personal", is_primary: false },
      { kind: "phone", value: "5125550100", label: null, is_primary: true },
    ]);
  });

  it("puts a server refusal on the row it names", () => {
    expect(contactMethodErrorFor(base, "CONTACT_METHOD_TAKEN: Accounts@reyesbuild.co already belongs to another contact in this workspace"))
      .toEqual({ id: "e3", text: "Another contact in this workspace already uses this address. Remove it here, or remove it from that contact first." });
    expect(contactMethodErrorFor(base, "CONTACT_METHOD_INVALID_PHONE: (512) 555-0190")).toEqual({ id: "p2", text: "A phone number needs 7 to 15 digits." });
    expect(contactMethodErrorFor(base, "CONTACT_FORBIDDEN: admin or coach required")).toBeNull();
    expect(contactMethodErrorFor(base, "CONTACT_METHOD_TAKEN: nobody@else.co already belongs to another contact")).toBeNull();
  });

  it("after a stale refusal, keeps the stored list and carries over only what this person added", () => {
    // Loaded e1,e2,p1. Meanwhile someone else removed e2 and added e9. This person added n1 and
    // a phone already stored under different formatting.
    const loaded = [m("e1", "email", "a@x.co", true), m("e2", "email", "b@x.co"), m("p1", "phone", "512 555 0100", true)];
    const latest = [m("e1", "email", "a@x.co", true), m("e9", "email", "theirs@x.co"), m("p1", "phone", "512 555 0100", true)];
    const draft = [...loaded, m("n1", "email", "Mine@X.co"), m("n2", "phone", "(512) 555-0100")];
    const { methods, carried } = rebaseContactMethods(latest, loaded, draft);
    expect(ids(methods)).toBe("e1*,e9,n1,p1*");
    expect(carried).toBe(1);
  });

  it("an address added to an empty kind becomes that kind's primary when carried over", () => {
    const { methods } = rebaseContactMethods([m("e1", "email", "a@x.co", true)], [], [m("n1", "phone", "5125550100", true)]);
    expect(ids(methods)).toBe("e1*,n1*");
    const blank = rebaseContactMethods([], [], [m("n2", "email", "  ")]);
    expect(blank.carried).toBe(0);
  });

  it("names a loaded list exactly as it was read, untrimmed", () => {
    const loaded = [m("p1", "phone", "512 555 0100\u00a0", true, " Work "), m("e1", "email", "a@x.co", true)];
    expect(toLoadedContactMethodsPayload(loaded)).toEqual([
      { kind: "email", value: "a@x.co", label: null, is_primary: true },
      { kind: "phone", value: "512 555 0100\u00a0", label: " Work ", is_primary: true },
    ]);
    expect(isOutdatedPage("Could not find the function public.set_user_contact_methods(p_expected) in the schema cache")).toBe(true);
    expect(isOutdatedPage("CONTACT_METHODS_STALE")).toBe(false);
  });

  it("recognises the stale refusal", () => {
    expect(isContactMethodsStale("CONTACT_METHODS_STALE: this list changed since it was loaded")).toBe(true);
    expect(isContactMethodsStale("CONTACT_METHOD_TAKEN: a@x.co")).toBe(false);
  });
});

describe("a single Email / Phone field over a contact's methods", () => {
  const row = (id: string, kind: "email" | "phone", value: string, is_primary: boolean, position: number) =>
    ({ id, kind, value, label: null, is_primary, position });

  it("reads the PRIMARY email and phone off a record read with the embed; none when it has none", () => {
    const record = withPrimaryAddresses({
      id: "c1",
      email: "stale-column@example.test",
      client_contact_methods: [
        row("e2", "email", "second@example.test", false, 1),
        row("e1", "email", "first@example.test", true, 0),
        row("p1", "phone", "+1 202 555 0142", true, 0),
      ],
    });
    expect(record.email).toBe("first@example.test");
    expect(record.phone).toBe("+1 202 555 0142");
    expect(primaryAddressesOf([])).toEqual({ email: null, phone: null });
    expect(primaryAddressesOf(null)).toEqual({ email: null, phone: null });
  });

  it("replacing the primary keeps every other address", () => {
    const next = withPrimaryAddress(base, "email", "new@reyesbuild.co");
    expect(primaryValue(next, "email")).toBe("new@reyesbuild.co");
    expect(next.filter((x) => x.kind === "email").map((x) => x.value)).toEqual(["new@reyesbuild.co", "jordan.home@fastmail.com", "accounts@reyesbuild.co"]);
    expect(next.filter((x) => x.kind === "phone")).toEqual(base.filter((x) => x.kind === "phone"));
  });

  it("an address the contact already holds becomes the primary instead of a duplicate", () => {
    const next = withPrimaryAddress(base, "email", "  Accounts@ReyesBuild.co ");
    expect(ids(next.filter((x) => x.kind === "email"))).toBe("e3*,e1,e2");
    expect(primaryValue(next, "email")).toBe("Accounts@ReyesBuild.co");
    const phone = withPrimaryAddress(base, "phone", "512-555-0190");
    expect(ids(phone.filter((x) => x.kind === "phone"))).toBe("p2*,p1");
  });

  it("clearing the field removes the primary and the next address takes its place", () => {
    expect(ids(withPrimaryAddress(base, "email", "").filter((x) => x.kind === "email"))).toBe("e2*,e3");
    expect(withPrimaryAddress([m("e1", "email", "only@example.test", true)], "email", null)).toEqual([]);
  });

  it("with none of that kind yet, the value is added as the primary; an unchanged value changes nothing", () => {
    const added = withPrimaryAddress(base.filter((x) => x.kind === "email"), "phone", "+1 202 555 0142");
    expect(primaryValue(added, "phone")).toBe("+1 202 555 0142");
    expect(toContactMethodsPayload(withPrimaryAddress(base, "email", "jordan@reyesbuild.co"))).toEqual(toContactMethodsPayload(base));
  });
});
