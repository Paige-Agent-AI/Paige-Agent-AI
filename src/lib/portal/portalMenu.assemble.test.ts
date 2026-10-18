import { describe, expect, it } from "vitest";
import { APPNAV_BEFORE_SLICE_M } from "./__fixtures__/appnav-before-slice-m";
import {
  PORTAL_MENU_ENTRIES, PORTAL_MENU_CONFIGURABLE_KEYS, assemblePortalNav, flattenPortalNav, portalMenuEditorEntries,
  type PortalViewer,
} from "./portalMenu";
import { generalDefault, fitnessCoach, businessConsultant, marketingAgency, RESOLVABLE_PLAYBOOKS } from "@/lib/playbook/presets";

// Slice M (E09) — the ONE assembly of the customer portal menu. The fixture is today's AppNav output,
// captured from the real component at 571ab923e BEFORE the refactor, per Playbook preset and viewer kind.
const funding = RESOLVABLE_PLAYBOOKS.find((p) => p.slug === "funding")!;
const catalogs = { generic: generalDefault, fitness: fitnessCoach, consultant: businessConsultant, agency: marketingAgency, funding };
const viewers: Record<string, PortalViewer> = {
  customer: { isStaff: false, isCustomer: true, brandResolved: true },
  staff: { isStaff: true, isCustomer: false, brandResolved: false },
  staffWithBrand: { isStaff: true, isCustomer: true, brandResolved: true },
  multiBusiness: { isStaff: false, isCustomer: false, brandResolved: false },
  noBrand: { isStaff: false, isCustomer: false, brandResolved: false },
  loading: { isStaff: false, isCustomer: false, brandResolved: false },
};
const CUSTOMER = viewers.customer;
const STAFF = viewers.staff;
const shape = (sections: ReturnType<typeof assemblePortalNav>) =>
  sections.map((s) => `${s.label ?? "top"}: ${s.items.map((i) => i.label).join(", ")}`);
const generic = generalDefault.portal.modules;
const set = (items: { href: string | null; label: string }[]) => items.map((i) => `${i.label}>${i.href}`).sort();

// The deliberate differences (§58, called out in the evidence records):
//   - ADDITION: Resources is core for customers, so a customer of one business has it on every Playbook — including
//     the ones whose catalog never listed it (fitness, consultant, agency, funding). Nobody loses it.
//   - ADDITION (Slice A, owner decision D-A1): Agreements is core for customers too — the customer's own Sales
//     Agreements — on every Playbook. Every other viewer keeps the catalog rule, as before Slice M (Slice M had held
//     it from every viewer who is not staff while its route was still the platform-terms page).
//   - ADDITION (E09 Slice 5): Payments is live. A customer of one business whose Playbook catalog lists `billing`
//     (every generic preset; not the funding preset) gains it, named Payments. Catalog-placed, never injected.
const AGREEMENTS = "/app/agreements";
const RESOURCES = { href: "/app/learn", label: "Resources" };
const AGREEMENTS_ITEM = { href: AGREEMENTS, label: "Agreements" };
const PAYMENTS = { href: "/app/billing", label: "Payments" };

describe("no overlay: the same destinations main renders today, per viewer kind (§58)", () => {
  for (const [cname, pb] of Object.entries(catalogs)) {
    for (const [vname, viewer] of Object.entries(viewers)) {
      it(`${cname} · ${vname}`, () => {
        const before = APPNAV_BEFORE_SLICE_M[cname][vname];
        const today = before;
        const gained = viewer.isCustomer
          ? [RESOURCES, AGREEMENTS_ITEM].filter((g) => !before.some((i) => i.href === g.href))
          : [];
        if (viewer.isCustomer && pb.portal.modules.some((m) => m.key === "billing")) gained.push(PAYMENTS);
        const now = flattenPortalNav(assemblePortalNav({ catalog: pb.portal.modules, viewer }));
        expect(set(now)).toEqual(set([...today, ...gained]));
        // Nothing main rendered before Slice M is missing (§58).
        for (const i of today) expect(now.map((n) => n.href), `${cname} · ${vname} lost ${i.href}`).toContain(i.href);
        // Every destination appears once.
        expect(new Set(now.map((i) => i.href)).size).toBe(now.length);
      });
    }
  }

  it("pins the grouped order a customer of one business sees on the generic Playbook", () => {
    expect(shape(assemblePortalNav({ catalog: generic, viewer: CUSTOMER }))).toEqual([
      "top: Home, Messages",
      "Your work: Progress, Action items, Sessions",
      "Paperwork: Documents, Agreements, Payments",
      "Learn: Resources",
    ]);
  });

  it("pins the grouped order for staff, a customer of several businesses, and an unresolved relationship", () => {
    expect(shape(assemblePortalNav({ catalog: generic, viewer: STAFF }))).toEqual(["top: Home", "Your work: Planning", "Learn: Resources"]);
    expect(shape(assemblePortalNav({ catalog: generic, viewer: viewers.multiBusiness }))).toEqual(["top: Home", "Your work: Action items", "Learn: Resources"]);
    expect(shape(assemblePortalNav({ catalog: generic, viewer: viewers.staffWithBrand }))).toEqual([
      "top: Home, Messages", "Your work: Progress, Sessions, Planning", "Paperwork: Documents, Agreements, Payments", "Learn: Resources",
    ]);
  });

  it("keeps the opt-in catalog's own entries, in catalog order, after the core items (§2)", () => {
    expect(shape(assemblePortalNav({ catalog: funding.portal.modules, viewer: CUSTOMER }))).toEqual([
      "top: Home, Messages",
      "Your work: Progress, Action items, Sessions, Funding Journey, Credit, Funding, Financial Profile, Business",
      "Paperwork: Documents, Agreements",
      "Learn: Resources",
    ]);
  });

  it("gives every customer of one business Resources whatever the catalog lists; everyone else keeps the catalog rule", () => {
    for (const [cname, pb] of Object.entries(catalogs)) {
      for (const [vname, viewer] of Object.entries(viewers)) {
        const hrefs = flattenPortalNav(assemblePortalNav({ catalog: pb.portal.modules, viewer })).map((i) => i.href);
        const listed = pb.portal.modules.some((m) => m.key === "resources" || m.key === "learn");
        expect(hrefs.includes("/app/learn"), `${cname} · ${vname}`).toBe(viewer.isCustomer || listed);
      }
    }
    // Only the owner's overlay hides it.
    const hidden = assemblePortalNav({ catalog: fitnessCoach.portal.modules, overlay: [{ key: "resources", visible: false }], viewer: CUSTOMER });
    expect(flattenPortalNav(hidden).map((i) => i.href)).not.toContain("/app/learn");
    const renamed = assemblePortalNav({ catalog: businessConsultant.portal.modules, overlay: [{ key: "resources", label: "Library" }], viewer: CUSTOMER });
    expect(shape(renamed).at(-1)).toBe("Learn: Library");
  });

  it("lets a catalog that lists only the learn alias speak for the route with its own name, once", () => {
    const catalog = [{ key: "home", label: "Home" }, { key: "learn", label: "Guides" }];
    const items = flattenPortalNav(assemblePortalNav({ catalog, viewer: CUSTOMER })).filter((i) => i.href === "/app/learn");
    expect(items.map((i) => [i.key, i.label])).toEqual([["learn", "Guides"]]);
    expect(portalMenuEditorEntries(catalog).filter((e) => e.group === "learn").map((e) => e.key)).toEqual(["learn"]);
  });

  it("gives every customer of one business Agreements whatever the catalog lists; everyone else keeps the catalog rule (D-A1, §58)", () => {
    for (const [cname, pb] of Object.entries(catalogs)) {
      for (const [vname, viewer] of Object.entries(viewers)) {
        const hrefs = flattenPortalNav(assemblePortalNav({ catalog: pb.portal.modules, viewer })).map((i) => i.href);
        const listed = pb.portal.modules.some((m) => m.key === "agreements");
        expect(hrefs.includes(AGREEMENTS), `${cname} · ${vname}`).toBe(viewer.isCustomer || listed);
      }
    }
    // Live for clients now: the owner's rename reaches the customer, and only the owner's overlay hides it.
    const renamed = assemblePortalNav({ catalog: generic, overlay: [{ key: "agreements", label: "Contracts" }], viewer: CUSTOMER });
    expect(shape(renamed)).toContain("Paperwork: Documents, Contracts, Payments");
    const hidden = assemblePortalNav({ catalog: funding.portal.modules, overlay: [{ key: "agreements", visible: false }], viewer: CUSTOMER });
    expect(flattenPortalNav(hidden).map((i) => i.href)).not.toContain(AGREEMENTS);
    expect(PORTAL_MENU_ENTRIES.find((e) => e.key === "agreements")?.clientsLive).not.toBe(false);
  });
});

describe("floors the overlay can never cross", () => {
  it("never reveals Messages, Sessions or Progress to staff, whatever the overlay says", () => {
    const overlay = ["messages", "sessions", "progress", "actions"].map((key) => ({ key, visible: true }));
    const hrefs = flattenPortalNav(assemblePortalNav({ catalog: generic, overlay, viewer: STAFF })).map((i) => i.href);
    expect(hrefs).not.toContain("/app/messages");
    expect(hrefs).not.toContain("/app/sessions");
    expect(hrefs).not.toContain("/app/progress");
    expect(hrefs).not.toContain("/app/actions");
  });

  it("never shows a catalog-only key the catalog does not list, even when the overlay names it", () => {
    const overlay = ["credit", "funding", "approvals", "business", "affiliate"].map((key) => ({ key, visible: true }));
    const hrefs = flattenPortalNav(assemblePortalNav({ catalog: generic, overlay, viewer: CUSTOMER })).map((i) => i.href);
    for (const h of ["/app/credit", "/app/funding", "/app/approvals", "/app/business", "/app/affiliate"]) expect(hrefs).not.toContain(h);
    // Agreements is not catalog-only for a customer (D-A1), but staff still need the catalog to list it.
    const staff = flattenPortalNav(assemblePortalNav({ catalog: generic, overlay: [{ key: "agreements", visible: true }], viewer: STAFF })).map((i) => i.href);
    expect(staff).not.toContain(AGREEMENTS);
  });

  it("renders Payments (live since E09 Slice 5) only to a customer of one business, renamable and hideable", () => {
    expect(PORTAL_MENU_ENTRIES.find((e) => e.key === "billing")?.live).toBe(true);
    const withPay = flattenPortalNav(assemblePortalNav({ catalog: generic, overlay: [{ key: "billing", label: "Pay" }], viewer: CUSTOMER }));
    expect(withPay.find((i) => i.href === "/app/billing")?.label).toBe("Pay");
    const hidden = flattenPortalNav(assemblePortalNav({ catalog: generic, overlay: [{ key: "billing", visible: false }], viewer: CUSTOMER }));
    expect(hidden.map((i) => i.href)).not.toContain("/app/billing");
    for (const viewer of [STAFF, viewers.multiBusiness, viewers.noBrand]) {
      const items = flattenPortalNav(assemblePortalNav({ catalog: generic, overlay: [{ key: "billing", visible: true }], viewer }));
      expect(items.map((i) => i.href)).not.toContain("/app/billing");
    }
    expect(portalMenuEditorEntries(generic).map((e) => e.key)).toContain("billing");
  });

  it("omits documents until a brand resolves", () => {
    const items = flattenPortalNav(assemblePortalNav({ catalog: generic, viewer: { isStaff: false, isCustomer: false, brandResolved: false } }));
    expect(items.map((i) => i.href)).not.toContain("/app/documents");
  });
});

describe("the overlay: hide, rename, reorder", () => {
  it("ignores hide and rename on the fixed entries", () => {
    const overlay = [{ key: "home", visible: false, label: "Start" }, { key: "messages", visible: false, label: "Inbox" }];
    const top = assemblePortalNav({ catalog: generic, overlay, viewer: CUSTOMER })[0];
    expect(top.items.map((i) => i.label)).toEqual(["Home", "Messages"]);
  });

  it("never lets a Playbook label rename Home or Messages either", () => {
    const catalog = [{ key: "home", label: "Start here" }, { key: "messages", label: "Inbox" }, ...generic.filter((m) => m.key !== "home")];
    for (const viewer of [CUSTOMER, STAFF]) {
      expect(assemblePortalNav({ catalog, viewer })[0].items[0].label).toBe("Home");
    }
    expect(assemblePortalNav({ catalog, viewer: CUSTOMER })[0].items.map((i) => i.label)).toEqual(["Home", "Messages"]);
  });

  it("hiding the row that speaks for a shared route hides the route, not just that key", () => {
    const catalog = [{ key: "home", label: "Home" }, { key: "learn", label: "Library" }, { key: "resources", label: "Resources" }];
    const rows = portalMenuEditorEntries(catalog).filter((e) => e.group === "learn");
    expect(rows.map((e) => e.key)).toEqual(["learn"]);
    const overlay = [{ key: "learn", visible: false }];
    const hrefs = flattenPortalNav(assemblePortalNav({ catalog, overlay, viewer: CUSTOMER })).map((i) => i.href);
    expect(hrefs).not.toContain("/app/learn");
    // A stale hide on an alias the catalog does not list leaves the listed key alone.
    const onlyResources = [{ key: "home", label: "Home" }, { key: "resources", label: "Resources" }];
    expect(flattenPortalNav(assemblePortalNav({ catalog: onlyResources, overlay, viewer: CUSTOMER })).map((i) => i.href)).toContain("/app/learn");
  });

  it("applies a label to a configurable entry and hides one", () => {
    const overlay = [{ key: "sessions", label: "Coaching calls" }, { key: "actions", visible: false }];
    expect(shape(assemblePortalNav({ catalog: generic, overlay, viewer: CUSTOMER }))[1]).toBe("Your work: Progress, Coaching calls");
  });

  it("orders within a group by the overlay, and never moves an entry to another group", () => {
    const overlay = [{ key: "sessions", order: 0 }, { key: "progress", order: 2 }, { key: "actions", order: 1 }, { key: "resources", order: -5 }];
    expect(shape(assemblePortalNav({ catalog: generic, overlay, viewer: CUSTOMER }))).toEqual([
      "top: Home, Messages", "Your work: Sessions, Action items, Progress", "Paperwork: Documents, Agreements, Payments", "Learn: Resources",
    ]);
  });

  it("omits a group whose items are all hidden", () => {
    const overlay = [{ key: "resources", visible: false }, { key: "documents", visible: false }, { key: "agreements", visible: false }, { key: "billing", visible: false }];
    expect(shape(assemblePortalNav({ catalog: generic, overlay, viewer: CUSTOMER }))).toEqual([
      "top: Home, Messages", "Your work: Progress, Action items, Sessions",
    ]);
  });

  it("dedupes two keys that share a route, the catalog's first one winning", () => {
    const catalog = [{ key: "home", label: "Home" }, { key: "learn", label: "Library" }, { key: "resources", label: "Resources" }];
    const items = flattenPortalNav(assemblePortalNav({ catalog, viewer: CUSTOMER }));
    expect(items.filter((i) => i.href === "/app/learn").map((i) => i.label)).toEqual(["Library"]);
  });
});

describe("the registry", () => {
  it("locks Home, Messages and nothing else as fixed customer entries, and groups the configurable ones as ruled", () => {
    const customerFacing = PORTAL_MENU_ENTRIES.filter((e) => e.floor !== "staff");
    expect(customerFacing.filter((e) => e.fixed).map((e) => e.key)).toEqual(["home", "messages"]);
    const core = (g: string) => PORTAL_MENU_ENTRIES.filter((e) => e.group === g && e.defaultVisibility === "shown" && !e.fixed).map((e) => e.key);
    expect(core("work")).toEqual(["progress", "actions", "sessions"]);
    expect(PORTAL_MENU_ENTRIES.filter((e) => e.group === "paperwork").map((e) => e.key)).toEqual(["documents", "agreements", "billing"]);
    expect(PORTAL_MENU_ENTRIES.find((e) => e.key === "billing")?.defaultLabel).toBe("Payments");
    expect(PORTAL_MENU_CONFIGURABLE_KEYS).toEqual(expect.arrayContaining(["progress", "actions", "sessions", "documents", "agreements", "billing", "resources"]));
    expect(PORTAL_MENU_CONFIGURABLE_KEYS).not.toContain("home");
    expect(PORTAL_MENU_CONFIGURABLE_KEYS).not.toContain("messages");
  });

  it("offers the owner one row per configurable live entry the catalog can show, never a funding key it does not list", () => {
    expect(portalMenuEditorEntries(generic).map((e) => e.key)).toEqual(["progress", "actions", "sessions", "documents", "agreements", "billing", "resources"]);
    expect(portalMenuEditorEntries(funding.portal.modules).map((e) => e.key)).toEqual([
      "progress", "actions", "sessions", "funding-journey", "credit", "funding", "financial-profile", "business", "documents", "agreements", "resources",
    ]);
    expect(portalMenuEditorEntries(businessConsultant.portal.modules).map((e) => e.key)).toEqual(["progress", "actions", "sessions", "documents", "agreements", "billing", "resources"]);
  });
});
