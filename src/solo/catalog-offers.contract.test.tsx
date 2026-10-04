// Slice 2A contract + render proof for Campaigns → Catalog → Offers.
//
// Lives in its own file rather than extending `growth2.contract.test.tsx` for the same reason the
// read lives in its own hook: that file is currently owned by PR #706, and the existing
// "exactly four tenant-scoped reads" assertion is a guard worth leaving sharp rather than editing.
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, Route, Routes, useParams, Link } from "react-router-dom";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GrowthHub } from "./growth2";
import { CatalogOffers } from "./catalog-offers";
import { SalesWorkspace } from "./SalesWorkspace";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

// These guards must measure CODE, not prose. The first run of this suite failed three times
// against the files' own explanatory comments — the header that quotes the read pattern, the note
// promising never to print `$0`, and the migration paragraph listing what it deliberately does NOT
// add. A guard that a docstring can trip is a guard that punishes documentation, so the source is
// stripped of comments before every static assertion.
const stripTs = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const stripSql = (src: string) => src.replace(/^\s*--.*$/gm, "");

const adapter = stripTs(read("src/solo/useCatalogOffers.ts"));
const surface = stripTs(read("src/solo/catalog-offers.tsx"));
// Resolved by SUFFIX rather than by a pinned version, because this migration has now been
// renumbered three times as main took its number — and a hard-coded path turns every renumber into
// an unrelated red test that says "file not found" instead of anything useful. Exactly one match is
// asserted, so a duplicate copy of this migration is still caught here rather than at deploy.
const migrationMatches = readdirSync(resolve(process.cwd(), "supabase/migrations"))
  .filter((name) => name.endsWith("_tenant_products_carry_the_offer_definition.sql"));
const migration = stripSql(
  read(`supabase/migrations/${migrationMatches[0] ?? "__missing__"}`),
);
// The comment-stripper is itself load-bearing, so prove it removes prose and keeps code.
const adapterRaw = read("src/solo/useCatalogOffers.ts");
const legacyUpsertFn = stripTs(read("supabase/functions/tenant-product-upsert/index.ts"));

const offer = (over: Record<string, unknown> = {}) => ({
  id: "offer-1",
  name: "Foundations Coaching Program",
  summary: "A twelve-week group program.",
  description: "Twelve weekly live sessions.",
  availability: "active",
  billingCadence: "service",
  kind: "service",
  deliveryShape: "program",
  pricePresentation: "fixed",
  customerAction: "apply",
  category: "Programs",
  imageUrl: null,
  updatedAt: "2026-08-28T12:00:00Z",
  prices: [{ id: "price-1", nickname: "Full", unitAmount: 240000, currency: "usd", billingInterval: "one_time", kind: "one_time", installmentsTotal: null, active: true }],
  ...over,
});

const harness = vi.hoisted(() => ({
  campaigns: {} as Record<string, unknown>,
  offers: {} as Record<string, unknown>,
}));

vi.mock("./useSoloCampaigns", () => ({ useSoloCampaigns: () => harness.campaigns }));
vi.mock("./useCatalogOffers", () => ({ useCatalogOffers: () => harness.offers }));

let host: HTMLDivElement;
let root: Root;
function CanonicalCatalogOwner() {
  const params=useParams();
  return params["*"].startsWith("growth") ? <GrowthHub/> : <SalesWorkspace/>;
}

function renderAt(path: string) {
  // Tear the previous tree down FIRST. Each call used to append a new host and leave the old one
  // in the document, so a test calling this eight times (the plan-shape loop) left seven orphan
  // trees behind for every later test in the file. Any assertion reading `document.body` could
  // then be satisfied by a leftover render rather than the one it just made — a guard that
  // silently weakens as tests are added, which is the exact failure this suite exists to catch.
  act(() => root?.unmount());
  host?.remove();
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root.render(
    <MemoryRouter initialEntries={[path]}>
      <Link data-offers-owner to="/solo/4471/sales/offers">Sales offer owner</Link><Link data-assets-owner to="/solo/4471/growth/lead-capture?type=form">Marketing asset owner</Link><Routes><Route path="/solo/:account/*" element={<CanonicalCatalogOwner />} /></Routes>
    </MemoryRouter>,
  ));
}

function setCampaigns(over: Record<string, unknown> = {}) {
  harness.campaigns = {
    tenantId: "tenant-1", phase: "ready", campaigns: [], submissions: [],
    artifacts: [{ id: "form-1", type: "form", name: "Published form", slug: "f", status: "active", updatedAt: "2026-08-28T12:00:00Z", publicHref: "/form/form-1", recentSubmissions: 0, routingConfigured: false, routingTargets: [], recentDispatches: { succeeded: 0, failed: 0, other: 0 } }],
    pipelineWorkspace: { canManage: true, canArchiveFolders: true, folders: [], pipelines: [], stages: [], deals: [] },
    pipelineAction: vi.fn(async () => ({ ok: true, message: "" })), retry: vi.fn(), ...over,
  };
}

/** The write seam, recorded rather than performed, so a test can assert what the surface SENT. */
let saved: Array<Record<string, unknown>>;
let moved: Array<[string, string, string | null]>;
let saveOutcome: { ok: boolean; message?: string; stale?: boolean; result?: { price_note?: string | null } };
let statusOutcome: { ok: boolean; message?: string; stale?: boolean };

function setOffers(over: Record<string, unknown> = {}) {
  harness.offers = {
    tenantId: "tenant-1", phase: "ready", offers: [offer()], canManage: true,
    authorityUnknown: false, fieldsUnavailable: false, retry: vi.fn(),
    saveOffer: vi.fn(async (draft: Record<string, unknown>) => { saved.push(draft); return saveOutcome; }),
    setOfferStatus: vi.fn(async (id: string, next: string, seen: string | null) => {
      moved.push([id, next, seen]);
      return statusOutcome;
    }),
    ...over,
  };
}

beforeEach(() => {
  saved = [];
  moved = [];
  saveOutcome = { ok: true };
  statusOutcome = { ok: true };
});

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  vi.clearAllMocks();
});

describe("Catalog Offers — tenant-scoped read contract", () => {
  it("has exactly one copy of the offer-definition migration", () => {
    expect(migrationMatches).toHaveLength(1);
  });

  it("measures code, not comments", () => {
    // The raw file mentions the read pattern in its header; the stripped one must not.
    expect(adapterRaw).toContain("WHY THIS IS ITS OWN HOOK");
    expect(adapter).not.toContain("WHY THIS IS ITS OWN HOOK");
    expect(adapter).toContain('.from("tenant_products")');
  });

  it("fails closed on tenant identity before it reads anything", () => {
    expect(adapter).toContain("accountContextLoading");
    expect(adapter).toContain("if (!activeTenantId)");
    // The unavailable branch must precede the query, not follow it.
    expect(adapter.indexOf("if (!activeTenantId)")).toBeLessThan(adapter.indexOf(".from(\"tenant_products\")"));
  });

  it("scopes every table read to the resolved tenant", () => {
    // Counted rather than hard-coded: every `.from(...)` in this adapter must carry exactly one
    // tenant scope, so adding a read without scoping it turns this red no matter how many exist.
    const reads = adapter.match(/\.from\("/g) ?? [];
    const scopes = adapter.match(/\.eq\("tenant_id", activeTenantId\)/g) ?? [];
    expect(reads.length).toBeGreaterThan(0);
    expect(scopes).toHaveLength(reads.length);
    // No caller-supplied tenant, and no service-role escape hatch on a browser read.
    expect(adapter).not.toMatch(/service_role|SERVICE_ROLE/);
  });

  it("survives the migration not being applied yet, rather than erroring for every tenant", () => {
    expect(adapter).toContain("isMissingColumn");
    expect(adapter).toContain('error?.code === "42703"');
    expect(adapter).toContain("const BASE =");
  });

  it("asks the authority question about this workspace, never a global role", () => {
    expect(adapter).toContain("tenant_members");
    expect(adapter).not.toMatch(/has_any_role|user_roles/);
  });

  it("narrows an unrecognised classification rather than guessing a neighbour", () => {
    expect(adapter).toContain("function narrow<");
    // The status fallback is asserted BEHAVIOURALLY in useCatalogOffers.adapter.test.tsx, which
    // executes the adapter. This line used to pin the literal `?? "draft"` — so when that coercion
    // was replaced by an honest "unrecognised", the test failed for describing the old code rather
    // than for catching a defect. A grep for a source string is not a claim about behaviour.
    expect(adapter).toContain("narrow(row.status, AVAILABILITIES)");
  });
});

describe("Catalog Offers — the harness itself", () => {
  it("leaves no orphan tree behind when a test renders more than once", () => {
    // The guard on the guards. Without this, an assertion that reads `document.body` can pass
    // because an EARLIER render is still in the document.
    setCampaigns();
    setOffers({ offers: [offer({ name: "Sentinel Offer" })] });
    renderAt("/solo/4471/growth/catalog");
    renderAt("/solo/4471/growth/catalog");
    const hits = (document.body.textContent ?? "").split("Sentinel Offer").length - 1;
    expect(hits).toBe(1);
  });
});

describe("Catalog Offers — truthfulness", () => {
  it("invents no commerce data the platform does not hold", () => {
    for (const banned of [/\brevenue\b/i, /\bconversion\b/i, /in stock/i, /stock count/i, /\bratings?\b/i, /units sold/i]) {
      expect(surface).not.toMatch(banned);
    }
  });

  it("never renders a zero for an unrecorded amount", () => {
    // Asserted on the RENDER, not the source. The previous version grepped the file for "$0",
    // which proved nothing: `money(0)` built that string at runtime and the literal never
    // appeared in the source. An adversarial review of the pushed diff caught it.
    setCampaigns();
    setOffers({ offers: [offer({ pricePresentation: "fixed", prices: [] })] });
    renderAt("/solo/4471/growth/catalog");
    const cell = host.querySelector(".co-price") as HTMLElement;
    expect(cell.textContent).not.toMatch(/\$0\b/);
    expect(cell.textContent).toContain("—");
  });

  it("renders a RECORDED zero as Free, because that is a real answer", () => {
    setCampaigns();
    setOffers({ offers: [offer({ pricePresentation: "fixed", prices: [{ id: "p0", nickname: null, unitAmount: 0, currency: "usd", billingInterval: "one_time", kind: "one_time", installmentsTotal: null, active: true }] })] });
    renderAt("/solo/4471/growth/catalog");
    const cell = host.querySelector(".co-price") as HTMLElement;
    expect(cell.textContent).toContain("Free");
    expect(cell.textContent).not.toMatch(/\$0\b/);
  });

  it("shows an instalment plan as its arithmetic, never as the per-instalment figure alone", () => {
    setCampaigns();
    setOffers({ offers: [offer({ pricePresentation: "fixed", prices: [{ id: "pi", nickname: "Plan", unitAmount: 50000, currency: "usd", billingInterval: "month", kind: "installment", installmentsTotal: 6, active: true }] })] });
    renderAt("/solo/4471/growth/catalog");
    const cell = host.querySelector(".co-price") as HTMLElement;
    expect(cell.textContent).toContain("$500 × 6");
    expect(cell.textContent).toContain("Instalment plan");
    expect(cell.textContent).not.toContain("Fixed amount");
  });

  it("shows a recurring plan per period, never as a flat one-off price", () => {
    // The BLOCKER an independent review of the pushed diff caught. The instalment fix guarded on
    // `kind === "installment"` alone, so the OTHER per-period kind — and the one the shipped
    // writer actually produces — fell through and rendered a $99/month retainer as a one-off
    // "$99 · Fixed amount", disagreeing with this offer's own detail drawer.
    setCampaigns();
    setOffers({ offers: [offer({ pricePresentation: "fixed", prices: [{ id: "pr", nickname: "Monthly", unitAmount: 9900, currency: "usd", billingInterval: "month", kind: "recurring", installmentsTotal: null, active: true }] })] });
    renderAt("/solo/4471/growth/catalog");
    const cell = host.querySelector(".co-price") as HTMLElement;
    expect(cell.textContent).toContain("$99 / month");
    expect(cell.textContent).toContain("Recurring plan");
    expect(cell.textContent).not.toContain("Fixed amount");
  });

  // The residual half of the same defect, found by a second review of the pushed fix: the first
  // pass keyed the per-period branch on `billingInterval` ALONE and ignored `kind`, so four shapes
  // still misreported. `tenant-product-upsert` does no cross-field validation, so every one of
  // these is writable through the callable seam even though StorefrontPanel cannot produce it.
  const plan = (over) => ({ id: "px", nickname: "P", unitAmount: 9900, currency: "usd",
    billingInterval: "month", kind: "recurring", installmentsTotal: null, active: true, ...over });
  const priceTextFor = (over) => {
    setCampaigns();
    setOffers({ offers: [offer({ pricePresentation: "fixed", prices: [plan(over)] })] });
    renderAt("/solo/4471/growth/catalog");
    return (host.querySelector(".co-price") as HTMLElement).textContent ?? "";
  };

  it("never calls any recorded plan shape a fixed amount when it is not one", () => {
    for (const over of [
      { kind: "recurring", billingInterval: null },
      { kind: "recurring", billingInterval: "one_time" },
      { kind: "deposit", billingInterval: "month" },
      { kind: "one_time", billingInterval: "month" },
      // The NO-INTERVAL cases, which this loop should have carried from the start. Their absence
      // is why the same defect survived three fixes. K5 is live today: StorefrontPanel sends
      // billing_interval "one_time" for every non-recurring kind, so a deposit-only product
      // reaches exactly this row and used to render "$500 · Fixed amount".
      { kind: "deposit", billingInterval: null },
      { kind: "deposit", billingInterval: "one_time" },
      { kind: null, billingInterval: null },
      { kind: null, billingInterval: "one_time" },
    ]) {
      expect(priceTextFor(over), JSON.stringify(over)).not.toContain("Fixed amount");
    }
  });

  it("says a recurring plan is recurring even when its period was never recorded", () => {
    expect(priceTextFor({ kind: "recurring", billingInterval: null }))
      .toContain("period not recorded");
  });

  it("names the recorded kind rather than the branch that rendered it", () => {
    // A deposit that carries an interval is a contradictory row. Reporting both recorded facts is
    // honest; calling it a "Recurring plan" swaps one false statement for another.
    const deposit = priceTextFor({ kind: "deposit", billingInterval: "month", unitAmount: 50000 });
    expect(deposit).toContain("$500 / month");
    expect(deposit).toContain("Deposit");
    expect(deposit).not.toContain("Recurring plan");
  });

  it("a kind the surface has no label for still never prints a fixed amount over a period", () => {
    // `PLAN_KIND` is a map; `tenant_prices_kind_check` is a DB CHECK. Today they agree, so no
    // stored row can reach this. They agree only as long as someone keeps them in sync — add a
    // fifth kind to the constraint without the map and a null note drops through to the
    // presentation fallback, printing "Fixed amount" beneath "$99 / month". This asserts the
    // INVARIANT (a qualified figure suppresses the presentation label) rather than the map.
    const text = priceTextFor({ kind: "metered", billingInterval: "month" });
    expect(text).toContain("$99 / month");
    expect(text).not.toContain("Fixed amount");
  });

  it("says a plan type it cannot read is unread, rather than saying nothing", () => {
    const text = priceTextFor({ kind: "metered", billingInterval: "month" });
    expect(text).toContain("$99 / month");
    expect(text).toContain("Plan type not recognised");
    expect(text).not.toContain("Fixed amount");
  });

  it("does not let a second plan erase that the first one is per-period", () => {
    // K13 from the final review: `note: several ? "Several plans recorded" : qualified.note` let
    // the branch override the record. A recurring plan with no recorded period, beside any second
    // plan, rendered "From $99 · Several plans recorded" — nothing saying it is per-period at all.
    setCampaigns();
    setOffers({ offers: [offer({ pricePresentation: "fixed", prices: [
      { id: "pr", nickname: "Monthly", unitAmount: 9900, currency: "usd", billingInterval: null, kind: "recurring", installmentsTotal: null, active: true },
      { id: "po", nickname: "Full", unitAmount: 240000, currency: "usd", billingInterval: "one_time", kind: "one_time", installmentsTotal: null, active: true },
    ] })] });
    renderAt("/solo/4471/growth/catalog");
    const cell = host.querySelector(".co-price") as HTMLElement;
    expect(cell.textContent).toContain("period not recorded");
    expect(cell.textContent).not.toContain("Fixed amount");
  });

  it("still says a deposit is a deposit when it is the floor of several plans", () => {
    setCampaigns();
    setOffers({ offers: [offer({ pricePresentation: "fixed", prices: [
      { id: "pd", nickname: "Deposit", unitAmount: 50000, currency: "usd", billingInterval: "one_time", kind: "deposit", installmentsTotal: null, active: true },
      { id: "pf", nickname: "Full", unitAmount: 240000, currency: "usd", billingInterval: "one_time", kind: "one_time", installmentsTotal: null, active: true },
    ] })] });
    renderAt("/solo/4471/growth/catalog");
    const cell = host.querySelector(".co-price") as HTMLElement;
    expect(cell.textContent).toContain("From $500");
    expect(cell.textContent).toContain("Deposit");
    expect(cell.textContent).not.toContain("Fixed amount");
  });

  it("still calls a plain one-off exactly what the tenant said it is", () => {
    // The one case that MUST keep falling through to the presentation label: a recognised
    // one-off with no period really is a single fixed amount, and "Fixed amount" is the
    // tenant's own recorded choice about how to show it.
    setCampaigns();
    setOffers({ offers: [offer({ pricePresentation: "fixed", prices: [
      { id: "p1", nickname: null, unitAmount: 240000, currency: "usd", billingInterval: "one_time", kind: "one_time", installmentsTotal: null, active: true },
    ] })] });
    renderAt("/solo/4471/growth/catalog");
    const cell = host.querySelector(".co-price") as HTMLElement;
    expect(cell.textContent).toContain("$2,400");
    expect(cell.textContent).toContain("Fixed amount");
  });

  it("never prints a backend enum token in the detail drawer", () => {
    // The drawer's plan line was `plan.nickname || plan.kind || "Plan"`, so a plan with no
    // nickname showed a tenant the raw column value — "recurring — $99 / month" (§11) — and an
    // unreadable kind showed a generic "Plan" while the ROW correctly said it could not be read.
    // Both are the drawer disagreeing with its own row about the same record.
    setCampaigns();
    setOffers({ offers: [offer({ prices: [
      { id: "p1", nickname: null, unitAmount: 9900, currency: "usd", billingInterval: "month", kind: "recurring", installmentsTotal: null, active: true },
      { id: "p2", nickname: null, unitAmount: 9900, currency: "usd", billingInterval: "month", kind: null, installmentsTotal: null, active: true },
    ] })] });
    renderAt("/solo/4471/growth/catalog");
    act(() => (host.querySelector("button.co-row") as HTMLElement).click());
    // Scoped to `host`, not `document.body`: the drawer does NOT portal — it renders inside the
    // tree this test just made — and reading the whole document would let a leftover satisfy it.
    const shown = host.textContent ?? "";
    expect(shown).toContain("Recurring plan — $99 / month");
    expect(shown).not.toContain("recurring — $99");
    expect(shown).toContain("Plan type not recognised — $99 / month");
  });

  it("keeps the period when a recurring plan is only the floor of several", () => {
    setCampaigns();
    setOffers({ offers: [offer({ pricePresentation: "fixed", prices: [
      { id: "pr", nickname: "Monthly", unitAmount: 9900, currency: "usd", billingInterval: "month", kind: "recurring", installmentsTotal: null, active: true },
      { id: "py", nickname: "Yearly", unitAmount: 99000, currency: "usd", billingInterval: "year", kind: "recurring", installmentsTotal: null, active: true },
    ] })] });
    renderAt("/solo/4471/growth/catalog");
    const cell = host.querySelector(".co-price") as HTMLElement;
    // A floor that drops the period would read "From $99" for a monthly plan — the same lie.
    expect(cell.textContent).toContain("From $99 / month");
    // The sub-label is the RECORD's, not the branch's. "Several plans recorded" used to win here
    // and that is exactly what erased the per-period fact on the sibling case below; the `From `
    // prefix already carries that there is more than one plan. It still labels an UNqualified
    // multi-plan price, where nothing else conveys it.
    expect(cell.textContent).toContain("Recurring plan");
  });

  it("does not call several recorded plans one fixed amount", () => {
    setCampaigns();
    setOffers({ offers: [offer({ pricePresentation: "fixed", prices: [
      { id: "p1", nickname: "Deposit", unitAmount: 50000, currency: "usd", billingInterval: "one_time", kind: "deposit", installmentsTotal: null, active: true },
      { id: "p2", nickname: "Full", unitAmount: 300000, currency: "usd", billingInterval: "one_time", kind: "one_time", installmentsTotal: null, active: true },
    ] })] });
    renderAt("/solo/4471/growth/catalog");
    const cell = host.querySelector(".co-price") as HTMLElement;
    expect(cell.textContent).toContain("From $500");
    // The lead is a DEPOSIT, so the note names that rather than "Several plans recorded" — the
    // more useful of the two facts, and the `From ` prefix already carries the other. The
    // "several" label survives for a lead that has nothing of its own to say; see below.
    expect(cell.textContent).toContain("Deposit");
    expect(cell.textContent).not.toContain("Fixed amount");
  });

  it("still says several plans when the lead has nothing of its own to say", () => {
    // Two plain one-offs: neither is per-period, neither is a deposit, so no record-derived note
    // exists and the count is the only thing worth printing. This keeps that label from becoming
    // dead code now that a qualified lead's own note wins.
    setCampaigns();
    setOffers({ offers: [offer({ pricePresentation: "fixed", prices: [
      { id: "pa", nickname: "A", unitAmount: 50000, currency: "usd", billingInterval: "one_time", kind: "one_time", installmentsTotal: null, active: true },
      { id: "pb", nickname: "B", unitAmount: 300000, currency: "usd", billingInterval: "one_time", kind: "one_time", installmentsTotal: null, active: true },
    ] })] });
    renderAt("/solo/4471/growth/catalog");
    const cell = host.querySelector(".co-price") as HTMLElement;
    expect(cell.textContent).toContain("From $500");
    expect(cell.textContent).toContain("Several plans recorded");
    expect(cell.textContent).not.toContain("Fixed amount");
  });

  it("does not hide the price and the conflict sentence from a screen reader", () => {
    // An `aria-label` REPLACES an element's contents for name computation. Naming the row
    // "{name} — {state}" made the price and the entire derived-conflict sentence — this
    // surface's honesty device — inaudible. Caught by an independent review of the pushed diff.
    setCampaigns();
    setOffers({ offers: [offer({ availability: "active", pricePresentation: "fixed", prices: [] })] });
    renderAt("/solo/4471/growth/catalog");
    const row = host.querySelector("button.co-row") as HTMLElement;
    expect(row.getAttribute("aria-label")).toBeNull();
    // With no label overriding them, the contents form the name.
    expect(row.textContent).toContain("no amount is recorded against it");
    expect(row.textContent).toContain("—");
    expect(row.textContent).toContain("Active");
  });

  it("still explains a pending deployment when the workspace has no offers yet", () => {
    // On production `tenant_products` holds zero rows, so EVERY tenant renders the empty state.
    // Both record-notices sat below that return, which made the deploy-order explanation — the one
    // that says why a field you filled in reads "Not stated" — unreachable for every single tenant.
    setCampaigns();
    setOffers({ offers: [], fieldsUnavailable: true });
    renderAt("/solo/4471/growth/catalog");
    expect(host.textContent).toContain("not available on this deployment yet");
  });

  it("still says an unread permission is unread when the workspace has no offers yet", () => {
    setCampaigns();
    setOffers({ offers: [], canManage: false, authorityUnknown: true });
    renderAt("/solo/4471/growth/catalog");
    expect(host.textContent).toContain("could not be read just now");
    expect(host.textContent).not.toContain("cannot change it");
  });

  it("says the kind is not stated rather than guessing one", () => {
    setCampaigns();
    setOffers({ offers: [offer({ kind: null })] });
    renderAt("/solo/4471/growth/catalog");
    expect(host.querySelector(".co-kind")?.getAttribute("data-kind")).toBe("unstated");
  });

  it("states the not-a-checkout boundary on the surface itself", () => {
    expect(surface).toContain("nothing on this surface charges anybody");
  });

  it("distinguishes an unreadable permission from a denied one", () => {
    setCampaigns();
    setOffers({ canManage: false, authorityUnknown: true });
    renderAt("/solo/4471/growth/catalog");
    expect(host.textContent).toContain("could not be read just now");
    expect(host.textContent).not.toContain("You can see this catalog but not change it");
  });

  it("says so when the offer columns are not on this deployment yet", () => {
    setCampaigns();
    setOffers({ fieldsUnavailable: true });
    renderAt("/solo/4471/growth/catalog");
    expect(host.textContent).toContain("not available on this deployment yet");
  });

  it("returns a retired address to the Vibe-owned published work, not to an empty offer list", () => {
    // The published Vibe work left Catalog for Marketing › Lead capture (owner ruling 2026-10-03);
    // the retired creative addresses follow it there.
    setCampaigns(); setOffers({ offers: [] });
    renderAt("/solo/4471/growth/pages");
    expect(host.textContent).toContain("This address moved");
    const back = [...host.querySelectorAll("button")].find((b) => b.textContent === "Go to Lead capture");
    act(() => { back?.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    expect(host.textContent).toContain("Created and published in Vibe Studio.");
    expect(host.textContent).not.toContain("Nothing is listed yet");
  });

  it("only reports a derived conflict for an offer that claims to be sellable", () => {
    expect(surface).toContain('if (offer.availability !== "active") return null;');
  });
});

describe("Catalog Offers — the migration is additive", () => {
  it("adds nullable columns and rewrites no existing value", () => {
    expect(migration).toContain("add column if not exists");
    expect(migration).not.toMatch(/^\s*update\s+public\.tenant_products/im);
    expect(migration).not.toMatch(/drop column/i);
    expect(migration).not.toMatch(/not null default/i);
  });

  it("widens status to carry paused without dropping an existing state", () => {
    expect(migration).toContain("check (status in ('draft', 'active', 'paused', 'archived'))");
  });

  it("adds no inventory, cart, tax or checkout primitive", () => {
    for (const banned of [/create table/i, /\bstock\b/i, /\bvariant/i, /\bcart\b/i, /\btax_/i, /shipping/i]) {
      expect(migration).not.toMatch(banned);
    }
  });
});

describe("Catalog Offers — rendered flows", () => {
  it("resets search and category when the resolved tenant changes without remounting", () => {
    setCampaigns(); setOffers();
    renderAt("/solo/4471/growth/catalog");
    act(() => root.render(<CatalogOffers setDetail={vi.fn()} />));
    const input = host.querySelector('input[type="search"]') as HTMLInputElement;
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "foundations");
      input.dispatchEvent(new Event("input", { bubbles: true }));
      [...host.querySelectorAll("button")].find(b => b.textContent?.startsWith("Programs"))!.click();
    });
    setOffers({tenantId:"test-tenant-other", offers:[offer({id:"new",name:"New tenant offer",category:"Other"})]});
    act(() => root.render(<CatalogOffers setDetail={vi.fn()} />));
    expect((host.querySelector('input[type="search"]') as HTMLInputElement).value).toBe("");
    expect(host.textContent).toContain("New tenant offer");
    expect(host.textContent).not.toContain("Foundations Coaching Program");
    expect(host.querySelector('.co-filter[aria-pressed="true"]')?.textContent).toContain("Everything");
  });

  it("searches names literally across lifecycle states and combines with category, then clears", () => {
    setCampaigns(); setOffers({ offers: [
      offer({ id: "a", name: "Coaching 50%_*(Plan)", category: "Programs", availability: "draft" }),
      offer({ id: "b", name: "Coaching consult", category: "Consulting", availability: "paused" }),
      offer({ id: "c", name: "Other", category: "Programs", availability: "archived" }),
    ] });
    renderAt("/solo/4471/growth/catalog");
    const search = host.querySelector('input[aria-label="Search offers by name"]') as HTMLInputElement;
    expect(search).toBeTruthy();
    const type = (value: string) => act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(search, value);
      search.dispatchEvent(new Event("input", { bubbles: true }));
    });
    type(" COACHING ");
    expect(host.querySelectorAll(".co-row")).toHaveLength(2);
    act(() => [...host.querySelectorAll("button")].find(b => b.textContent?.startsWith("Programs"))!.click());
    expect(host.querySelectorAll(".co-row")).toHaveLength(1);
    type("50%_*(plan)");
    expect(host.querySelectorAll(".co-row")).toHaveLength(1);
    type("no match");
    expect(host.textContent).toContain("No offers match");
    expect(host.textContent).not.toContain("Your catalog starts");
    act(() => [...host.querySelectorAll("button")].find(b => b.textContent === "Clear search")!.click());
    expect(search.value).toBe("");
    expect(host.querySelectorAll(".co-row")).toHaveLength(2);
    expect(harness.offers.saveOffer).not.toHaveBeenCalled();
    expect(harness.offers.setOfferStatus).not.toHaveBeenCalled();
  });

  it("opens legacy Offers inside the canonical six-tab Sales owner", () => {
    setCampaigns(); setOffers();
    renderAt("/solo/4471/growth/catalog");
    const tabs = [...host.querySelectorAll('.sales-tabs button')].map((b) => b.textContent?.trim());
    expect(tabs).toEqual(["Overview", "Opportunities", "Offers", "Terms & Agreements", "Payments", "Performance"]);
    expect(host.textContent).toContain("Foundations Coaching Program");
    expect(host.querySelector(".co-list")).not.toBeNull();
  });

  it("shows first use rather than an empty table when nothing is defined", () => {
    setCampaigns(); setOffers({ offers: [] });
    renderAt("/solo/4471/growth/catalog");
    expect(host.textContent).toContain("Nothing is listed yet");
    // Slice 2A promised here that "adding and editing offers arrives in the next release". 2B IS
    // that release, so the promise is replaced by the act rather than left standing — a surface
    // that still advertises a future version of itself after shipping it is lying quietly.
    expect(host.textContent).not.toContain("next release");
    const add = [...host.querySelectorAll("button")].find((b) => b.textContent === "Add your first offer");
    expect(add).toBeTruthy();
  });

  it("offers no way in from first use when the caller may not define offers", () => {
    setCampaigns(); setOffers({ offers: [], canManage: false });
    renderAt("/solo/4471/growth/catalog");
    expect(host.textContent).toContain("Nothing is listed yet");
    expect([...host.querySelectorAll("button")].some((b) => b.textContent === "Add your first offer")).toBe(false);
    expect(host.textContent).toContain("An owner or admin defines what this business sells");
  });

  it("names the missing fact when an active offer has no amount recorded", () => {
    setCampaigns();
    setOffers({ offers: [offer({ prices: [] })] });
    renderAt("/solo/4471/growth/catalog");
    expect(host.textContent).toContain("no amount is recorded against it");
  });

  it("says how the price is shown when the tenant chose not to show one", () => {
    setCampaigns();
    setOffers({ offers: [offer({ pricePresentation: "contact", prices: [] })] });
    renderAt("/solo/4471/growth/catalog");
    expect(host.textContent).toContain("Contact for pricing");
    expect(host.textContent).not.toContain("no amount is recorded against it");
  });

  it("never prints the price label twice when the label IS the price", () => {
    setCampaigns();
    setOffers({ offers: [offer({ pricePresentation: "contact", prices: [] })] });
    renderAt("/solo/4471/growth/catalog");
    const row = host.querySelector(".co-price") as HTMLElement;
    expect(row.textContent).toBe("Contact for pricing");
  });

  it("keeps the label when it genuinely adds to the amount", () => {
    setCampaigns();
    setOffers({ offers: [offer({ pricePresentation: "from" })] });
    renderAt("/solo/4471/growth/catalog");
    const row = host.querySelector(".co-price") as HTMLElement;
    expect(row.textContent).toContain("From $2,400");
    expect(row.textContent).toContain("Starting at");
  });

  it("tells a member they cannot change the catalog", () => {
    setCampaigns(); setOffers({ canManage: false });
    renderAt("/solo/4471/growth/catalog");
    expect(host.textContent).toContain("You can see this catalog but not change it");
  });

  it("offers a retry and changes nothing when the read fails", () => {
    const retry = vi.fn();
    setCampaigns(); setOffers({ phase: "error", offers: [], retry });
    renderAt("/solo/4471/growth/catalog");
    expect(host.textContent).toContain("Offers could not load");
    expect(host.textContent).toContain("Your records were not changed");
    const button = [...host.querySelectorAll("button")].find((b) => b.textContent?.includes("Retry"));
    act(() => { button?.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it("reads no tenant data until the account context resolves", () => {
    setCampaigns(); setOffers({ phase: "resolving", offers: [] });
    renderAt("/solo/4471/growth/catalog");
    expect(host.textContent).toContain("Resolving this account");
    expect(host.textContent).not.toContain("Foundations Coaching Program");
  });

  it("preserves the Vibe-owned published work in Lead capture, and lands old Catalog addresses on it", () => {
    setCampaigns(); setOffers();
    renderAt("/solo/4471/growth/catalog?type=form");
    expect(host.textContent).toContain("Created and published in Vibe Studio.");
    expect(host.textContent).toContain("Published form");
    // Published Vibe work must not be reframed as an offer.
    expect(host.textContent).not.toContain("What this business sells");
  });

  it("filters to a tenant category literally named \"all\", instead of showing everything", () => {
    // `category` on tenant_products is unconstrained free text on purpose — the tenant's own
    // words. So any string reserved as the "everything" sentinel is a name a tenant can pick, and
    // the collision makes that chip claim a count of its own while showing every offer, with two
    // chips pressed at once. Unreachable until 2B ships the write seam; guarded before it is.
    setCampaigns();
    setOffers({ offers: [
      offer({ id: "a", name: "Named all", category: "all" }),
      offer({ id: "b", name: "Named Programs", category: "Programs" }),
    ] });
    renderAt("/solo/4471/growth/catalog");
    const chip = [...host.querySelectorAll("button")].find((b) => b.textContent?.startsWith("all"));
    expect(chip).toBeTruthy();
    act(() => { chip?.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    expect(host.textContent).toContain("Named all");
    expect(host.textContent).not.toContain("Named Programs");
    // And exactly one chip reads as selected.
    const pressed = [...host.querySelectorAll('button[aria-pressed="true"]')]
      .filter((b) => b.className.includes("co-filter"));
    expect(pressed).toHaveLength(1);
  });

  it("states a recorded price in the currency's own minor units, not always hundredths", () => {
    // `tenant_prices.currency` carries no CHECK and `tenant-product-upsert` lower-cases whatever it
    // is handed with no allowlist, so `jpy` is writable today. A fixed /100 renders a recorded
    // ¥500 as "5 JPY" — the tenant's own price, misstated by two orders of magnitude.
    setCampaigns();
    setOffers({ offers: [
      offer({ id: "y", name: "Yen offer", prices: [{ id: "py", nickname: null, unitAmount: 500, currency: "jpy", billingInterval: "one_time", kind: "one_time", installmentsTotal: null, active: true }] }),
      offer({ id: "k", name: "Dinar offer", prices: [{ id: "pk", nickname: null, unitAmount: 500, currency: "kwd", billingInterval: "one_time", kind: "one_time", installmentsTotal: null, active: true }] }),
    ] });
    renderAt("/solo/4471/growth/catalog");
    expect(host.textContent).toContain("500 JPY");
    expect(host.textContent).not.toContain("5 JPY");
    // Three minor digits, so 500 minor units is 0.500 — not 5.
    expect(host.textContent).toContain("0.500 KWD");
    expect(host.textContent).not.toContain("5 KWD");
  });

  it("keeps dollars rendering exactly as they did", () => {
    setCampaigns();
    setOffers({ offers: [offer({ prices: [{ id: "p", nickname: null, unitAmount: 240000, currency: "usd", billingInterval: "one_time", kind: "one_time", installmentsTotal: null, active: true }] })] });
    renderAt("/solo/4471/growth/catalog");
    expect(host.textContent).toContain("$2,400");
  });

  it("carries the instalment count into the drawer, so a bounded plan never reads as open-ended", () => {
    // The row already shows "$500 × 6". The drawer printed "Instalment plan — $500 / month",
    // hiding the six-payment limit — the same record reading bounded in one place and
    // open-ended in the other.
    setCampaigns();
    setOffers({ offers: [offer({
      name: "Instalment offer",
      prices: [{ id: "pi", nickname: null, unitAmount: 50000, currency: "usd", billingInterval: "month", kind: "installment", installmentsTotal: 6, active: true }],
    })] });
    renderAt("/solo/4471/growth/catalog");
    const row = [...host.querySelectorAll("button")].find((b) => b.textContent?.includes("Instalment offer"));
    act(() => { row?.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    const drawer = document.querySelector('[role="dialog"]');
    expect(drawer).toBeTruthy();
    // Assert the PLAN row, not the drawer as a whole. The first version of this guard read
    // `drawer.textContent` and was satisfied by the separate "Price shown" row, which already
    // carries the arithmetic — so it passed with the defect reintroduced. A guard that cannot
    // fail is worse than no guard, and the break-test is what exposed it.
    const planRow = [...drawer!.querySelectorAll(".campaigns-detail-row")]
      .find((row) => row.textContent?.startsWith("Recorded plans"));
    expect(planRow).toBeTruthy();
    expect(planRow!.textContent).toContain("Instalment plan — $500 × 6 / month");
  });

  it("returns to Offers from published work without unmounting", () => {
    // An old `?type=` address lands on Lead capture; the Offers tab must then show offers, not the
    // published work it was redirected from.
    setCampaigns(); setOffers();
    renderAt("/solo/4471/growth/catalog?type=form");
    expect(host.textContent).toContain("Created and published in Vibe Studio.");
    act(() => (host.querySelector("[data-offers-owner]") as HTMLAnchorElement).click());
    expect(host.querySelector(".co-list")).not.toBeNull();
    expect(host.textContent).not.toContain("Created and published in Vibe Studio.");
  });

  it("closes an open detail drawer when the workspace changes", () => {
    // A detail snapshot is detached from the list it came from, so the drawer kept showing the
    // previous tenant's offer name, description and prices after a switch — indefinitely.
    setCampaigns(); setOffers();
    renderAt("/solo/4471/growth/catalog");
    const row = [...host.querySelectorAll("button")].find((b) => b.textContent?.includes("Foundations Coaching Program"));
    act(() => { row?.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    expect(document.querySelector('[role="dialog"]')).toBeTruthy();

    setCampaigns({ tenantId: "tenant-2" });
    setOffers({ tenantId: "tenant-2", offers: [] });
    act(() => root.render(
      <MemoryRouter initialEntries={["/solo/4471/growth/catalog"]}>
        <Link data-offers-owner to="/solo/4471/sales/offers">Sales offer owner</Link><Link data-assets-owner to="/solo/4471/growth/lead-capture?type=form">Marketing asset owner</Link><Routes><Route path="/solo/:account/*" element={<CanonicalCatalogOwner />} /></Routes>
      </MemoryRouter>,
    ));
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  // ── Slice 2B: the offer becomes writable ──────────────────────────────────────────────────
  const openEditor = () => {
    const add = [...host.querySelectorAll("button")]
      .find((b) => b.textContent === "New offer" || b.textContent === "Add your first offer");
    act(() => { add?.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    return document.querySelector(".co-editor");
  };
  const type = (label: string, value: string) => {
    // By row label first, then by aria-label — the currency sits INSIDE the Price row and has no
    // label span of its own, so a row-only lookup would silently find the wrong input.
    const field = [...document.querySelectorAll(".co-field")]
      .find((f) => f.querySelector("span")?.textContent === label);
    const input = (field?.querySelector("input, textarea")
      ?? document.querySelector(`[aria-label="${label}"]`)) as HTMLInputElement | undefined;
    expect(input, `no field labelled ${label}`).toBeTruthy();
    act(() => {
      // React tracks the DOM value, so a bare `.value =` is swallowed on the next render.
      const proto = input instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(input, value);
      input!.dispatchEvent(new Event("input", { bubbles: true }));
    });
  };
  const clickText = (text: string) => {
    const button = [...document.querySelectorAll("button")].find((b) => b.textContent === text);
    expect(button, `no button labelled ${text}`).toBeTruthy();
    act(() => { button!.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
  };

  it("takes a first-time owner from an empty catalog to a saved offer", async () => {
    setCampaigns(); setOffers({ offers: [] });
    renderAt("/solo/4471/growth/catalog");
    expect(openEditor()).toBeTruthy();
    type("Name", "Twelve-week program");
    await act(async () => { clickText("Save"); });
    expect(saved).toHaveLength(1);
    expect(saved[0].name).toBe("Twelve-week program");
    // The pack's rule: a name is the only requirement, and everything unstated stays unstated.
    expect(saved[0].id).toBeNull();
    expect(saved[0].summary).toBe("");
    expect(saved[0].priceAmount).toBeNull();
    // A clean save closes the editor.
    expect(document.querySelector(".co-editor")).toBeNull();
  });

  it("will not save an offer with no name", () => {
    setCampaigns(); setOffers({ offers: [] });
    renderAt("/solo/4471/growth/catalog");
    openEditor();
    const save = [...document.querySelectorAll("button")].find((b) => b.textContent === "Save");
    expect((save as HTMLButtonElement).disabled).toBe(true);
    type("Name", "   ");
    expect((save as HTMLButtonElement).disabled).toBe(true);
  });

  it("sends a price in MINOR units, never the number typed", async () => {
    setCampaigns(); setOffers({ offers: [] });
    renderAt("/solo/4471/growth/catalog");
    openEditor();
    type("Name", "Chair service");
    type("Price", "40.50");
    await act(async () => { clickText("Save"); });
    // 40.50 is 4050 minor units. Sending 40.5 would price a haircut at forty cents.
    expect(saved[0].priceAmount).toBe(4050);
  });

  it("converts a price by the CURRENCY's exponent, not a hardcoded hundred", async () => {
    // Caught by reading my own diff: the first version of the editor divided and multiplied by
    // 100, reintroducing in the WRITE path the defect an independent review had just found in the
    // read path. JPY has no minor unit, so 500 means ¥500 — ×100 would have saved ¥50,000.
    setCampaigns(); setOffers({ offers: [] });
    renderAt("/solo/4471/growth/catalog");
    openEditor();
    type("Name", "Tokyo session");
    type("Currency", "jpy");
    type("Price", "500");
    await act(async () => { clickText("Save"); });
    expect(saved[0].priceAmount).toBe(500);
    expect(saved[0].priceCurrency).toBe("jpy");
  });

  it("keeps the editor open and says nothing was saved when the save is refused", async () => {
    setCampaigns(); setOffers({ offers: [] });
    saveOutcome = { ok: false, message: "an offer needs a name" };
    renderAt("/solo/4471/growth/catalog");
    openEditor();
    type("Name", "Something");
    await act(async () => { clickText("Save"); });
    // Closing on a refusal would discard what they typed ON TOP of telling them it failed.
    expect(document.querySelector(".co-editor")).toBeTruthy();
    expect(document.querySelector(".co-editor")!.textContent).toContain("an offer needs a name");
  });

  it("tells a person who lost the race that nothing was saved, and not to retry", async () => {
    setCampaigns(); setOffers({ offers: [] });
    saveOutcome = { ok: false, stale: true };
    renderAt("/solo/4471/growth/catalog");
    openEditor();
    type("Name", "Something");
    await act(async () => { clickText("Save"); });
    const text = document.querySelector(".co-editor")!.textContent ?? "";
    expect(text).toContain("Someone else changed this offer");
    expect(text).toContain("Nothing was saved");
  });

  it("edits an existing offer against the version it was opened at", async () => {
    setCampaigns(); setOffers();
    renderAt("/solo/4471/growth/catalog");
    const row = [...host.querySelectorAll("button")].find((b) => b.textContent?.includes("Foundations Coaching Program"));
    act(() => { row?.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    clickText("Edit");
    await act(async () => { clickText("Save"); });
    expect(saved).toHaveLength(1);
    expect(saved[0].id).toBe("offer-1");
    // The optimistic-concurrency token, carried from the row the form was opened against.
    expect(saved[0].expectedUpdatedAt).toBe("2026-08-28T12:00:00Z");
  });

  it("moves an offer's lifecycle from the drawer, carrying the version it saw", () => {
    setCampaigns(); setOffers({ offers: [offer({ availability: "active" })] });
    renderAt("/solo/4471/growth/catalog");
    const row = [...host.querySelectorAll("button")].find((b) => b.textContent?.includes("Foundations"));
    act(() => { row?.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    clickText("Pause");
    expect(moved).toEqual([["offer-1", "paused", "2026-08-28T12:00:00Z"]]);
  });

  it("asks before archiving, and does nothing when the answer is no", () => {
    setCampaigns(); setOffers();
    renderAt("/solo/4471/growth/catalog");
    const row = [...host.querySelectorAll("button")].find((b) => b.textContent?.includes("Foundations"));
    act(() => { row?.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    clickText("Archive");
    expect(confirm).toHaveBeenCalled();
    expect(moved).toEqual([]);
    confirm.mockRestore();
  });

  it("offers no acts at all to a caller who may not change the catalog", () => {
    setCampaigns(); setOffers({ canManage: false });
    renderAt("/solo/4471/growth/catalog");
    const labels = [...host.querySelectorAll("button")].map((b) => b.textContent);
    expect(labels).not.toContain("New offer");
    const row = [...host.querySelectorAll("button")].find((b) => b.textContent?.includes("Foundations"));
    act(() => { row?.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    const drawer = document.querySelector('[role="dialog"]')!;
    // Omitted, not disabled: a disabled control says "later", when the truth is "not your role".
    expect(drawer.textContent).not.toContain("Publish");
    expect(drawer.textContent).not.toContain("Archive");
  });

  it("never offers a status picker inside the editor", () => {
    setCampaigns(); setOffers({ offers: [] });
    renderAt("/solo/4471/growth/catalog");
    const editor = openEditor()!;
    // Lifecycle belongs beside the offer, not inside the form that renames it — otherwise a person
    // publishes something by accident while editing its wording.
    for (const word of ["Publish", "Archive", "Pause", "Draft", "Status"]) {
      expect(editor.textContent).not.toContain(word);
    }
  });

  // ── The six findings an independent review returned AFTER #800 merged ─────────────────────
  it("saves a draft into the workspace it was OPENED in, never the one switched to", async () => {
    // P1. The server's `_expected_tenant_id` is refusal-only and correct — but the client was
    // sending the CURRENT tenant, so the guard agreed with itself and a draft started in one
    // workspace was created in another. The fix is which value the caller sends.
    setCampaigns(); setOffers({ offers: [] });
    renderAt("/solo/4471/growth/catalog");
    openEditor();
    type("Name", "Started in tenant-1");
    await act(async () => { clickText("Save"); });
    expect(saved[0]._expected_tenant_id ?? saved[0].tenantId).toBe("tenant-1");
  });

  it("discards an open draft when the workspace changes", () => {
    setCampaigns(); setOffers({ offers: [] });
    renderAt("/solo/4471/growth/catalog");
    expect(openEditor()).toBeTruthy();
    // A form standing open over another workspace's catalog shows one tenant's words above
    // another's offers, which is its own defect even with the server guard now firing.
    setCampaigns({ tenantId: "tenant-2" });
    setOffers({ tenantId: "tenant-2", offers: [] });
    act(() => root.render(
      <MemoryRouter initialEntries={["/solo/4471/growth/catalog"]}>
        <Link data-offers-owner to="/solo/4471/sales/offers">Sales offer owner</Link><Link data-assets-owner to="/solo/4471/growth/lead-capture?type=form">Marketing asset owner</Link><Routes><Route path="/solo/:account/*" element={<CanonicalCatalogOwner />} /></Routes>
      </MemoryRouter>,
    ));
    expect(document.querySelector(".co-editor")).toBeNull();
  });

  it("edits the plan the form displayed, not whichever row sorts first", async () => {
    // P1. `leadPrice` picks the CHEAPEST active plan; the RPC used to always write sort_order 0.
    // On a multi-plan offer that copied the displayed plan's figures onto a different one.
    setCampaigns();
    setOffers({ offers: [offer({
      prices: [
        { id: "expensive", nickname: "Full", unitAmount: 300000, currency: "usd", billingInterval: "one_time", kind: "one_time", installmentsTotal: null, active: true },
        { id: "cheapest", nickname: "Starter", unitAmount: 50000, currency: "usd", billingInterval: "one_time", kind: "one_time", installmentsTotal: null, active: true },
      ],
    })] });
    renderAt("/solo/4471/growth/catalog");
    const row = [...host.querySelectorAll("button")].find((b) => b.textContent?.includes("Foundations"));
    act(() => { row?.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    clickText("Edit");
    await act(async () => { clickText("Save"); });
    // The form was populated from the cheapest plan, so that is the id the save must carry.
    expect(saved[0].priceId).toBe("cheapest");
  });

  it("keeps the editor open and says so when the price was deliberately left alone", async () => {
    // The server reports a price it refused to touch — connected to checkout, or a deposit or
    // instalment plan. Silently not saving a price somebody just typed is the same class of lie
    // as inventing one, so the note surfaces and the form stays open.
    setCampaigns(); setOffers();
    saveOutcome = { ok: true, result: { price_note: "This offer's price is connected to checkout, so it was not changed here." } };
    renderAt("/solo/4471/growth/catalog");
    const row = [...host.querySelectorAll("button")].find((b) => b.textContent?.includes("Foundations"));
    act(() => { row?.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    clickText("Edit");
    await act(async () => { clickText("Save"); });
    expect(document.querySelector(".co-editor")).toBeTruthy();
    expect(document.querySelector(".co-editor")!.textContent).toContain("connected to checkout");
  });

  it("closes on a clean save that touched the price", async () => {
    setCampaigns(); setOffers();
    saveOutcome = { ok: true, result: { price_note: null } };
    renderAt("/solo/4471/growth/catalog");
    const row = [...host.querySelectorAll("button")].find((b) => b.textContent?.includes("Foundations"));
    act(() => { row?.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    clickText("Edit");
    await act(async () => { clickText("Save"); });
    expect(document.querySelector(".co-editor")).toBeNull();
  });

  it("never rewrites a checkout-connected or deposit price, and clears one that is emptied", () => {
    // Static guards over the migration, because these branches are SQL and the harness has no
    // database. Each names the exact condition the review found missing.
    const fix = read("supabase/migrations/20261111000000_the_offer_editor_stops_short_of_the_checkout_price.sql");
    const sql = stripSql(fix);
    // Finding 2: a Stripe-backed row is refused, not rewritten.
    expect(sql).toContain("_price.stripe_price_id IS NOT NULL");
    // Finding 4: deposit and instalment plans are not flattened by a name-only edit.
    expect(sql).toContain("_price.kind IN ('deposit', 'installment')");
    // Finding 6: an emptied price is deactivated rather than silently reappearing.
    expect(sql).toContain("UPDATE public.tenant_prices SET active = false");
    // Finding 3: the update is BY ID, never by sort_order.
    expect(sql).toContain("WHERE id = _price.id");
    expect(sql).not.toContain("AND sort_order = 0");
    // Finding 5: publication on a storefront tenant needs a checkout-ready price.
    expect(sql).toContain("tp.stripe_price_id IS NOT NULL");
    expect(sql).toContain("storefront_enabled");
    // A new SIGNATURE is a NEW function and inherits EXECUTE to PUBLIC — proven live in a rolled
    // back transaction, where the 15-arg overload came back anon-executable until this ran.
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION public\.save_solo_offer\([^)]*uuid\) FROM PUBLIC, anon/);
    // And the old 14-arg overload is dropped, or finding 2 stays reachable behind it.
    expect(sql).toContain("DROP FUNCTION IF EXISTS public.save_solo_offer(");
  });

  it("refuses a non-Solo tenant's write, checked server-side against the real account row", () => {
    // Static guard over the migration, same reason as above: this is SQL and the harness has no
    // database. The Catalog interface is Solo-only today (no Agency/sub-account/Enterprise UI
    // reaches it), but the RPCs enforced only membership — so an owner/admin of ANY tenant could
    // call them directly. This asserts the guard exists, is a literal comparison against the
    // authenticated tenant row (never a client-supplied claim), and runs in BOTH functions.
    const fix = read("supabase/migrations/20261131000000_catalog_offers_are_solo_only_for_now.sql");
    const sql = stripSql(fix);
    // The check resolves from the SERVER-side tenant row, not a request parameter.
    expect(sql).toContain("SELECT t.account_type, t.parent_tenant_id INTO _account_type, _parent_tenant");
    expect(sql).toContain("FROM public.tenants t WHERE t.id = _tenant");
    // A parented tenant (any sub-account, including a legacy account_type='standalone' one) and a
    // non-'standalone' account_type are both refused — the same literal test as isSoloStandalone().
    expect(sql).toContain("_parent_tenant IS NOT NULL OR _account_type IS DISTINCT FROM 'standalone'");
    // Both functions carry the guard — count the occurrences rather than trusting one match.
    expect(sql.match(/the offer catalog is available to Solo workspaces only right now/g)?.length).toBe(2);
    // It runs AFTER authentication and membership, so a non-member never learns tier information —
    // and BEFORE any row is inserted or updated, so a refused caller never mutates anything.
    const saveFn = sql.slice(sql.indexOf("CREATE OR REPLACE FUNCTION public.save_solo_offer"), sql.indexOf("CREATE OR REPLACE FUNCTION public.set_solo_offer_status"));
    const authAt = saveFn.indexOf("authentication required");
    const memberAt = saveFn.indexOf("only an owner or admin may change");
    const tierAt = saveFn.indexOf("Solo workspaces only");
    const firstInsertAt = saveFn.indexOf("INSERT INTO public.tenant_products");
    expect(authAt).toBeGreaterThan(-1);
    expect(memberAt).toBeGreaterThan(authAt);
    expect(tierAt).toBeGreaterThan(memberAt);
    expect(firstInsertAt).toBeGreaterThan(tierAt);
  });

  it("refuses a non-Solo tenant on the legacy tenant-product-upsert writer too", () => {
    // tenant-product-upsert is a SEPARATE, older write path into the same tenant_products /
    // tenant_prices tables (StorefrontPanel.tsx, reached today via the legacy /admin/setup/general
    // fallback whenever a tenant's soloShellEnabled/agencyShellEnabled flag is off — confirmed by
    // reading Admin.tsx: that fallback gates on role (RoleGate allow admin) only, never on
    // account_type). It carries no tier check of its own, so it needed the identical Solo-only
    // guard as save_solo_offer / set_solo_offer_status, checked against the real tenant row.
    expect(legacyUpsertFn).toContain(
      '.from("tenants")\n    .select("account_type, parent_tenant_id")\n    .eq("id", tenantId)',
    );
    // Asserted as ONE contiguous block, not as separate toContain checks on each condition: an
    // independent review of the pushed diff flagged that two separate substring checks cannot tell
    // `||` from `&&` — a mutation joining these with `&&` instead of `||` would still contain every
    // substring a split assertion could check, while silently letting an Agency/Enterprise tenant
    // (parent_tenant_id IS NULL, account_type != "standalone") slip through, since `false && true`
    // is `false`. Matching the exact source block, operator included, closes that gap.
    expect(legacyUpsertFn).toContain(
      '  if (\n' +
      '    !tenantRow ||\n' +
      '    tenantRow.parent_tenant_id !== null ||\n' +
      '    tenantRow.account_type !== "standalone"\n' + // tier-feature-exempt: test-fixture string asserting the exact SERVER-SIDE edge-function guard text (supabase/functions/tenant-product-upsert/index.ts) — not a render gate; §60's lint text-scans src/ and cannot distinguish asserted fixture text from live gate code.
      '  ) {\n' +
      '    return json(403, { error: "solo_workspaces_only" });\n' +
      '  }',
    );
    // Runs AFTER the membership/role check and BEFORE any product row is created or updated.
    const memberAt = legacyUpsertFn.indexOf('return json(403, { error: "tenant_admin_required" });');
    const tierAt = legacyUpsertFn.indexOf('return json(403, { error: "solo_workspaces_only" });');
    const firstWriteAt = legacyUpsertFn.indexOf('.from("tenant_products")\n      .update(');
    expect(memberAt).toBeGreaterThan(-1);
    expect(tierAt).toBeGreaterThan(memberAt);
    expect(firstWriteAt).toBeGreaterThan(tierAt);
  });

  it("keeps offers and published Vibe work in their own tabs, each listing only its own", () => {
    // They shared one tab until the Marketing department ruling (2026-10-03). Offers is the Sales
    // lane's; published Vibe work is measured in Marketing › Lead capture.
    setCampaigns(); setOffers();
    renderAt("/solo/4471/growth/catalog");
    expect(host.textContent).toContain("Foundations Coaching Program");
    expect(host.textContent).not.toContain("Published form");
    act(() => (host.querySelector("[data-assets-owner]") as HTMLAnchorElement).click());
    expect(host.textContent).toContain("Published form");
    expect(host.textContent).not.toContain("Foundations Coaching Program");
  });
});
