/**
 * Solo Campaigns → Sales — the contract for the Sales Command Desk.
 *
 * ─── WHY THIS FILE EXISTS (§58) ──────────────────────────────────────────────────────────────
 *
 * The Sales tab ships the platform's §38 money boundary and its only routed-capture read. Nothing
 * else pins them, so a rebuild could delete the surface's honesty and pass every other gate green.
 * This file is that guard: the §38/§59 boundary, the recorded-terms honesty, the readable-vs-none
 * distinction, and the no-summed-total rule are asserted here and must survive any rebuild.
 *
 * ─── WHAT CHANGED IN THE COMMAND-DESK REBUILD (Sales Command Desk, 2026-09-05) ────────────────
 *
 * The single-scroll workbench became FOUR views — Sales Command · Commercial Terms · Revenue &
 * Collections · Sales Scenarios — selected by a Sales-local `?view=` param (the shell six-tab nav
 * is untouched). Every honesty guard below is UNCHANGED in intent; each now renders the view that
 * owns its band. New positive coverage pins the new operating views (pulse evidence classes, the
 * unavailable Contract-pending stage, the tenant-level payment path, and the model-only Scenario
 * Lab). Nothing that shipped was dropped — the routed-capture read, its no-inference drawer, its
 * empty state and its phase-awareness moved INTO SalesOps and are still asserted here.
 *
 * ─── WHY IT IS NOT IN growth2.render.test.tsx ────────────────────────────────────────────────
 *
 * PR #706 (Solo Pipeline) currently owns `growth2.render.test.tsx`, `growth2.contract.test.tsx`,
 * `solo-campaigns.css` and the Pipeline block of `growth2.tsx`. This slice keeps its diff off all
 * four. A merge conflict in a test file is how a §58 pin gets "resolved" away.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GrowthHub } from "./growth2";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const ROUTED = {
  id: "submission-routed",
  source: "Discovery intake form",
  createdAt: "2026-08-28T12:00:00Z",
  contactId: "contact-1",
  dealId: null,
};
const UNROUTED = {
  id: "submission-unrouted",
  source: "Newsletter form",
  createdAt: "2026-08-27T12:00:00Z",
  contactId: null,
  dealId: null,
};

const harness = vi.hoisted(() => ({
  state: {} as Record<string, unknown>,
  offers: {} as Record<string, unknown>,
  sales: {} as Record<string, unknown>,
  agreements: {} as Record<string, unknown>,
  signings: {} as Record<string, unknown>,
  features: [] as string[],
}));

vi.mock("./useSocialCommand", () => ({
  useSocialCommand: () => ({
    tenantId: "tenant-1", phase: "ready", handles: [], canManage: true,
    recordChangedAt: null, notPermitted: false,
    recordHandles: async () => ({ ok: true, recordedCount: 0 }), retry() {},
  }),
}));
vi.mock("./data/useSoloPendingActions", () => ({
  useSoloPendingActions: () => ({ items: [], loading: false, error: null, refresh() {} }),
}));
vi.mock("./data/useSoloTrust", () => ({
  useSoloTrust: () => ({ loading: false, configured: true, departments: [], bySlug: {}, error: null }),
}));
vi.mock("./useSoloCampaigns", () => ({ useSoloCampaigns: () => harness.state }));
vi.mock("./useCatalogOffers", () => ({ useCatalogOffers: () => harness.offers }));
// Overview (the Campaign Command Desk) reads owner briefs through its own tenant-scoped adapter;
// this suite renders all six tabs, so stub the briefs read ready/empty (its own proof is in
// campaign-briefs.contract.test.tsx).
vi.mock("./useSoloCampaignBriefs", () => ({
  useSoloCampaignBriefs: () => ({
    tenantId: harness.state.tenantId, phase: "ready", briefs: [], archivedCount: 0, canManage: true,
    retry: () => {}, saveBrief: async () => ({ ok: true, message: "" }),
    transitionBrief: async () => ({ ok: true, message: "" }), archiveBrief: async () => ({ ok: true, message: "" }),
  }),
}));
// The Sales-operations adapter is mocked HERE so this file proves the SURFACE. What the adapter
// itself sends to the database — tenant scoping, fail-closed ordering, the refusal-only expected
// tenant — is proved separately in `useSoloSalesOps.adapter.test.tsx` against a recording client.
// Mocking it there too would prove nothing about either.
vi.mock("./useSoloSalesOps", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./useSoloSalesOps")>();
  return { ...actual, useSoloSalesOps: () => harness.sales };
});
vi.mock("./useSoloCommercialTerms", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./useSoloCommercialTerms")>();
  return { ...actual, useSoloCommercialTerms: () => harness.agreements };
});
// Same split as the sales adapter above: this file proves the SURFACE. What the signings adapter
// sends — the tenant filter, the refusal-only expected tenant, the "a promise without a token is
// not a link" rule — belongs to its own adapter proof, and mocking it in both places would prove
// nothing about either.
vi.mock("./useSoloAgreementSignings", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./useSoloAgreementSignings")>();
  return { ...actual, useSoloAgreementSignings: () => harness.signings };
});
// §60 — the surface asks the ONE tier home whether this account type gets documents. The real hook
// reads `useTenantContext`, which throws outside a provider, so the answer is supplied here and the
// feature list is a test fixture rather than an inline account-type compare.
vi.mock("@/hooks/useTierFeatures", () => ({
  useTierFeatures: () => ({
    has: (feature: string) => harness.features.includes(feature),
    tierKey: "solo", soloStandalone: true, loading: false,
  }),
}));

let host: HTMLDivElement;
let root: Root | null = null;

/* Where the app actually went. The router here is in-memory, so a navigation leaves no trace a
 * test can read — and asserting on a spied callback would only prove the handler was called, not
 * that it routed anywhere real. This records the live location instead. */
let lastLocation = "";
function LocationProbe() {
  const loc = useLocation();
  lastLocation = loc.pathname + loc.search;
  return null;
}

const appAt = (path: string) => (
  <MemoryRouter initialEntries={[path]}>
    <LocationProbe />
    <Routes><Route path="/solo/:account/*" element={<GrowthHub />} /></Routes>
  </MemoryRouter>
);

function renderAt(path: string) {
  if (root) act(() => root!.unmount());
  host?.remove();
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root!.render(appAt(path)));
}
// Each Sales view is a Sales-local `?view=` param; command is the bare default.
const salesPath = (view?: string) => `/solo/42/growth/sales${view ? `?view=${view}` : ""}`;
const render = (view?: string) => renderAt(salesPath(view));

beforeEach(() => {
  harness.state = {
    tenantId: "tenant-1",
    phase: "ready",
    campaigns: [],
    artifacts: [],
    submissions: [ROUTED, UNROUTED],
    pipelineWorkspace: { canManage: true, folders: [], pipelines: [], stages: [], deals: [] },
    pipelineAction: vi.fn(async () => ({ ok: true, message: "Saved" })),
    retry: vi.fn(),
  };
  harness.offers = {
    tenantId: "tenant-1", phase: "ready", offers: [], referencedOffers: [], canManage: true,
    authorityUnknown: false, fieldsUnavailable: false, hasMore: false, retry: vi.fn(),
    saveOffer: vi.fn(async () => ({ ok: true, result: {} })),
    setOfferStatus: vi.fn(async () => ({ ok: true, result: {} })),
  };
  harness.sales = {
    tenantId: "tenant-1", phase: "ready", processor: null, processorUnrecognised: false,
    methods: [], orders: [], ordersReadable: true, canManage: true, authorityUnknown: false,
    retry: vi.fn(), declarePaymentHandling: vi.fn(async () => ({ ok: true, result: {} })),
  };
  harness.agreements = {
    tenantId: "tenant-1", phase: "ready", agreements: [], clients: [], clientsReadable: true,
    agreementsReadable: true, canManage: true, authorityUnknown: false, retry: vi.fn(),
    saveAgreement: vi.fn(async () => ({ ok: true, result: {} })),
    setAgreementStatus: vi.fn(async () => ({ ok: true, result: {} })),
  };
  harness.features = ["growth"];
  harness.signings = {
    tenantId: "tenant-1", phase: "ready", signings: [], readable: true, canManage: true,
    authorityUnknown: false, retry: vi.fn(),
    uploadDocument: vi.fn(async () => ({ ok: true, path: "tenant-1/source/1-agreement.pdf" })),
    createSigning: vi.fn(async () => ({ ok: true, signingId: "signing-1", signatureState: "draft" })),
    sendForSignature: vi.fn(async () => ({ ok: true, sent: ["acme@example.com"], notDelivered: [] })),
    signingEvents: vi.fn(async () => ({ ok: true, events: [
      { id: "e2", type: "completed", actorKind: "signer", actorEmail: "dana@example.com", ip: "203.0.113.42", userAgent: "Safari on iPhone", at: "2026-09-22T16:12:00Z" },
      { id: "e1", type: "sent", actorKind: "owner", actorEmail: null, ip: null, userAgent: null, at: "2026-09-22T15:51:00Z" },
    ] })),
    issueLink: vi.fn(async () => ({ ok: true, token: "tok-abcdef", expiresAt: "2026-10-06T12:00:00Z" })),
    voidSigning: vi.fn(async () => ({ ok: true, signatureState: "voided" })),
    signedCopyUrl: vi.fn(async () => ({ ok: true, url: "https://storage.test/signed.pdf?token=x" })),
  };
});

afterEach(() => {
  if (root) act(() => root!.unmount());
  root = null;
  host?.remove();
});

const buttonSaying = (text: string) =>
  [...host.querySelectorAll("button")].find((b) => b.textContent?.includes(text)) as HTMLButtonElement | undefined;

/**
 * §58 RE-POINT — "Quick offer" moved, it did not go.
 *
 * It used to sit in the head of a "Find an offer" band on Commercial Terms. The owner deleted that
 * band (2026-09-22) and the act moved INSIDE the agreement editor, into the empty state of the
 * offer picker — the one moment a workspace with no catalog is actually blocked by not having one.
 * That is also its ONLY call site in the repo, so had it been dropped rather than moved, the whole
 * QuickOffer component would have become unreachable dead code and a new Solo workspace could no
 * longer create its first offer from Sales at all. Every test below that used to click it from the
 * band now walks this path instead; none of them was deleted.
 */
function openQuickOffer() {
  render("terms");
  act(() => (buttonSaying("New agreement") as HTMLButtonElement).click());
  act(() => (buttonSaying("Quick offer") as HTMLButtonElement).click());
}

describe("§58 — behaviour that shipped on Sales and must survive the command-desk rebuild", () => {
  it("keeps the owner-placed client-billing boundary, verbatim (Revenue view)", () => {
    render("revenue");
    const text = host.textContent ?? "";
    expect(text).not.toContain("Billing your own clients");
    act(() => (buttonSaying("Record it") as HTMLButtonElement).click());
    const payment = document.querySelector('[role="dialog"]')!.textContent;
    expect(payment).toContain("Paige is not merchant of record");
    expect(payment).toContain("Settings → Billing");
    expect(payment).toContain("does not connect an account");
  });

  it("keeps the routed-capture read, and still refuses to treat an unrouted submission as one", () => {
    render();
    const text = host.textContent ?? "";
    expect(text).toContain("Discovery intake form");
    expect(text).not.toContain("Newsletter form");
  });

  it("keeps the routed-capture detail drawer and its no-inference note", () => {
    render();
    const row = host.querySelector(".so-form-activity .campaigns-list-row") as HTMLButtonElement;
    expect(row).not.toBeNull();
    act(() => row.click());
    const drawer = document.querySelector('[role="dialog"]');
    const text = drawer?.textContent ?? "";
    expect(text).toContain("Source");
    expect(text).toContain("Contact reference");
    expect(text).toContain("Deal reference");
    expect(text).toContain("No monetary value or campaign attribution is inferred.");
  });

  it("keeps the routed-capture empty state when nothing is routed", () => {
    harness.state.submissions = [UNROUTED];
    render();
    const text = host.textContent ?? "";
    expect(text).toContain("No routed form activity");
    expect(text).toContain("a submission is not a sale");
  });

  it("keeps the routed capture phase-aware — a failed snapshot read is unknown, not empty", () => {
    harness.state.phase = "unavailable";
    render();
    expect(host.textContent).toContain("Campaigns needs a resolved workspace");

    harness.state.phase = "error";
    render();
    expect(host.textContent).toContain("Campaigns could not load");
    expect(buttonSaying("Retry")).toBeDefined();

    harness.state.phase = "loading";
    render();
    expect(host.querySelector(".campaigns-skeleton")).not.toBeNull();
  });

  it("keeps the six-tab strip in order, with Sales in place", () => {
    render();
    const tabs = [...host.querySelectorAll('[role="tablist"][aria-label="Campaigns views"] [role="tab"]')]
      .map((t) => t.textContent?.trim())
      .filter(Boolean);
    expect(tabs).toEqual(["Overview", "Catalog", "Sales", "Pipeline", "Social", "Performance"]);
  });

  it("keeps SalesOps' own four load phases distinct from the Campaigns snapshot's", () => {
    harness.sales.phase = "unavailable";
    render();
    expect(host.textContent).toContain("Sales needs a resolved workspace");

    harness.sales.phase = "error";
    render();
    expect(host.textContent).toContain("Sales operations could not load");
    expect(buttonSaying("Retry")).toBeDefined();

    harness.sales.phase = "loading";
    render();
    expect(host.querySelector(".campaigns-skeleton")).not.toBeNull();
  });

  it("survives the production loading-to-ready transition without changing hook order", () => {
    harness.sales.phase = "loading";
    render();
    expect(host.querySelector('[aria-label="Loading sales operations"]')).not.toBeNull();

    harness.sales.phase = "ready";
    expect(() => act(() => root!.render(appAt(salesPath())))).not.toThrow();
    expect(host.textContent).toContain("Turn agreed value into received value");
  });
});

describe("Sales Command — the operating desk (new)", () => {
  it("opens on Sales Command with an evidence-classed pulse and no representative-data claim", () => {
    render();
    const text = host.textContent ?? "";
    expect(text).toContain("Turn agreed value into received value");
    expect(text).toContain("Commercial Readiness Ladder");
    expect(text).toContain("Top Commercial Moves");
    expect(text).toContain("Open Commercial Work");
    // Production surface reads real data — it must never label itself a prototype.
    expect(text).not.toContain("Representative UI");
    // At least one evidence-class chip is rendered on the pulse.
    expect(host.querySelector(".so-ec")).not.toBeNull();
  });

  it("keeps Actual received honestly unavailable — never a summed forecast (§38)", () => {
    harness.sales.orders = [
      { id: "o1", productId: null, customerName: "A client", customerEmail: null,
        amountTotal: 500000, currency: "usd", status: "complete", createdAt: "2026-08-20T12:00:00Z" },
    ];
    render();
    const received = [...host.querySelectorAll(".so-pl")].find((t) => t.textContent?.includes("Actual received"));
    expect(received).not.toBeUndefined();
    expect(received?.textContent).toContain("Payment source needed");
    // The recorded receipt is never summed into the pulse figure.
    expect(received?.textContent).not.toContain("$5,000");
    expect(received?.querySelector(".so-ec-unknown")).not.toBeNull();
  });

  it("marks Contract pending UNAVAILABLE and Payment path as a tenant-level declaration", () => {
    render();
    const text = host.textContent ?? "";
    expect(text).toContain("Contract pending");
    expect(text).toContain("Contract records have no live backend yet");
    // Contract-pending column carries the honest 'No source' status pill.
    expect(host.querySelector(".so-lad-st-unavailable")).not.toBeNull();
    // Payment path (processor null) is not set up, and points at recording payment handling.
    expect(text).toContain("Record how clients pay you");
  });

  it("sums active one-time terms into Contracted and never annualizes recurring (§13)", () => {
    harness.agreements.clients = [{ id: "c1", name: "Acme" }, { id: "c2", name: "Bright" }];
    harness.agreements.agreements = [
      { id: "a1", contactId: "c1", offerId: "o1", status: "active", termKind: "one_time",
        agreedAmountMinor: 1200000, agreedCurrency: "usd", startsOn: null, renewsOn: null, endsOn: null },
      { id: "a2", contactId: "c2", offerId: "o2", status: "active", termKind: "recurring",
        billingInterval: "month", intervalCount: 1, agreedAmountMinor: 250000, agreedCurrency: "usd", startsOn: null, renewsOn: null, endsOn: null },
    ];
    render("revenue");
    const text = host.textContent ?? "";
    expect(text).toContain("$12,000");        // one-time active total
    expect(text).toContain("$2,500");         // recurring shown monthly
    expect(text).not.toContain("$14,400");    // NOT annualized
    expect(text).not.toContain("$144,000");
    expect(text).toContain("recurring shown monthly, never annualized");
  });

  it("a pure-recurring retainer renders Contracted as an em-dash, never 'Free' (§13 — money(0) is 'Free')", () => {
    harness.agreements.clients = [{ id: "c1", name: "Acme" }];
    harness.agreements.agreements = [
      { id: "a1", contactId: "c1", offerId: "o1", status: "active", termKind: "recurring",
        billingInterval: "month", intervalCount: 1, agreedAmountMinor: 250000, agreedCurrency: "usd",
        startsOn: null, renewsOn: null, endsOn: null },
    ];
    render("revenue");
    const text = host.textContent ?? "";
    expect(text).not.toContain("Free");          // a paid retainer is never labelled Free
    expect(text).toContain("$2,500");            // its recurring value still shows, monthly
    // the one-time headline is an em-dash with an honest note, not a zero
    expect(text).toContain("No one-time value");
  });

  it("deep-links each view through the Sales-local sub-nav", () => {
    render();
    const toTerms = [...host.querySelectorAll('.so-subnav [role="tab"]')].find((b) => b.textContent === "Commercial Terms") as HTMLButtonElement;
    expect(toTerms).not.toBeUndefined();
    act(() => toTerms.click());
    expect(host.textContent).toContain("Agreements and terms");
  });
});

describe("Sales Scenarios — a model, never an action", () => {
  it("refuses the Evidence-supported path without pipeline evidence and never enables Save", () => {
    render("scenarios");
    const text = host.textContent ?? "";
    expect(text).toContain("No historical evidence yet");
    expect(text).toContain("Ask Paige to prepare the test");
    const save = buttonSaying("Save scenario");
    expect(save).toBeDefined();
    expect(save?.disabled).toBe(true);
  });

  it("writes nothing — no offer, agreement, or payment mutation from the Scenario Lab", () => {
    harness.offers.offers = [{ id: "o1", name: "Program", availability: "active",
      prices: [{ id: "p1", unitAmount: 1200000, currency: "usd", billingInterval: "month", active: true }] }];
    render("scenarios");
    const proposed = document.querySelector('.so-lab input') as HTMLInputElement;
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(proposed, "650000");
      proposed.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(harness.offers.saveOffer).not.toHaveBeenCalled();
    expect(harness.agreements.saveAgreement).not.toHaveBeenCalled();
    expect(harness.sales.declarePaymentHandling).not.toHaveBeenCalled();
  });
});

describe("Sales operations — what an owner can actually do (§70.1)", () => {
  it("distinguishes 'you have none' from 'I could not look' on payments (Revenue)", () => {
    harness.sales.ordersReadable = false;
    render("revenue");
    expect(host.textContent).toContain("not readable at your access level");
  });

  it("reads the declared processor back as words, not as a stored token (Revenue)", () => {
    harness.sales.processor = "square";
    harness.sales.methods = ["cards", "ach"];
    render("revenue");
    const text = host.textContent ?? "";
    expect(text).toContain("Square");
    expect(text).toContain("Cards");
    expect(text).toContain("ACH");
    expect(text).not.toContain("bank_merchant");
    expect(text).not.toContain("payment_processor_declared");
  });

  it("lets an owner record how their clients pay them, and sends the real declaration", async () => {
    render("revenue");
    act(() => (buttonSaying("Record it") as HTMLButtonElement).click());
    const dialog = document.querySelector('[role="dialog"]');
    expect(dialog?.textContent).toContain("How your clients pay you");
    expect(dialog?.textContent).toContain("does not connect an account, move");
    const pick = (label: string) =>
      [...document.querySelectorAll('[role="dialog"] .so-pick button')]
        .find((b) => b.textContent === label) as HTMLButtonElement;
    act(() => pick("PayPal").click());
    act(() => pick("Cards").click());
    act(() => pick("Check").click());
    const save = [...document.querySelectorAll('[role="dialog"] button')]
      .find((b) => b.textContent === "Save") as HTMLButtonElement;
    await act(async () => { save.click(); });
    expect(harness.sales.declarePaymentHandling).toHaveBeenCalledWith("paypal", ["cards", "check"]);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it("keeps the payment form open on a refusal and says nothing changed", async () => {
    harness.sales.declarePaymentHandling = vi.fn(async () => ({
      ok: false,
      message: "your active workspace changed before this could save; nothing was written",
    }));
    render("revenue");
    act(() => (buttonSaying("Record it") as HTMLButtonElement).click());
    const pick = [...document.querySelectorAll('[role="dialog"] .so-pick button')]
      .find((b) => b.textContent === "Stripe") as HTMLButtonElement;
    act(() => pick.click());
    const save = [...document.querySelectorAll('[role="dialog"] button')]
      .find((b) => b.textContent === "Save") as HTMLButtonElement;
    await act(async () => { save.click(); });
    const dialog = document.querySelector('[role="dialog"]');
    expect(dialog).not.toBeNull();
    expect(dialog?.textContent).toContain("nothing was written");
  });

  it("creates a quick offer through the canonical Catalog seam, and never a second record (Terms)", async () => {
    openQuickOffer();
    const dialog = document.querySelector('[role="dialog"]');
    expect(dialog?.textContent).toContain("saves as a draft in Catalog");
    const nameInput = document.querySelector('[role="dialog"] input') as HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!;
    act(() => {
      setter.call(nameInput, "Monthly advisory retainer");
      nameInput.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const pick = (label: string) =>
      [...document.querySelectorAll('[role="dialog"] .so-pick button')]
        .find((b) => b.textContent === label) as HTMLButtonElement;
    act(() => pick("Service").click());
    act(() => pick("Monthly").click());
    const create = [...document.querySelectorAll('[role="dialog"] button')]
      .find((b) => b.textContent === "Create offer") as HTMLButtonElement;
    await act(async () => { create.click(); });
    expect(harness.offers.saveOffer).toHaveBeenCalledTimes(1);
    const sent = (harness.offers.saveOffer as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(sent.tenantId).toBe("tenant-1");
    expect(sent.id).toBeNull();
    expect(sent.name).toBe("Monthly advisory retainer");
    expect(sent.kind).toBe("service");
    expect(sent.priceInterval).toBe("month");
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it("converts a typed price to minor units using the currency's own exponent (Terms)", async () => {
    openQuickOffer();
    const inputs = [...document.querySelectorAll('[role="dialog"] input')] as HTMLInputElement[];
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!;
    const type = (el: HTMLInputElement, value: string) => act(() => {
      setter.call(el, value);
      el.dispatchEvent(new Event("input", { bubbles: true }));
    });
    type(inputs[0], "A day rate");
    type(inputs[2], "jpy");
    type(inputs[1], "500");
    const create = [...document.querySelectorAll('[role="dialog"] button')]
      .find((b) => b.textContent === "Create offer") as HTMLButtonElement;
    await act(async () => { create.click(); });
    const sent = (harness.offers.saveOffer as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(sent.priceAmount).toBe(500);
    expect(sent.priceCurrency).toBe("jpy");
  });

  it("tells the person when the server saved the definition but declined the price (Terms)", async () => {
    harness.offers.saveOffer = vi.fn(async () => ({
      ok: true,
      result: { id: "offer-1", price_note: "This price is connected to checkout, so it was left as it is." },
    }));
    openQuickOffer();
    const nameInput = document.querySelector('[role="dialog"] input') as HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!;
    act(() => {
      setter.call(nameInput, "Something");
      nameInput.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const create = [...document.querySelectorAll('[role="dialog"] button')]
      .find((b) => b.textContent === "Create offer") as HTMLButtonElement;
    await act(async () => { create.click(); });
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(host.textContent).toContain("Your Catalog draft was created. Review its price");
    expect(buttonSaying("Continue setup in Catalog")).toBeDefined();
    expect(harness.offers.saveOffer).toHaveBeenCalledTimes(1);
  });

  it("creates nothing when a quick offer is abandoned (Terms)", () => {
    openQuickOffer();
    const cancel = [...document.querySelectorAll('[role="dialog"] button')]
      .find((b) => b.textContent === "Cancel") as HTMLButtonElement;
    act(() => cancel.click());
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(harness.offers.saveOffer).not.toHaveBeenCalled();
  });

  /**
   * §58 RE-POINT — the offer SEARCH, its PAGER and its PRICE READING moved into the agreement
   * editor with the band; the offer DETAIL drawer was removed by owner ruling (2026-09-22) and is
   * deliberately NOT asserted here. What that drawer was actually needed for — seeing what an offer
   * costs while attaching it to somebody's agreement — now travels with the name in the picker, so
   * this test proves the price and the cadence are still readable at the moment they matter.
   */
  it("carries each offer's price and cadence into the picker, with its pager (Terms)", () => {
    harness.offers.offers = [{
      id: "offer-1", name: "Twelve-week program", summary: null, description: null,
      availability: "active", billingCadence: "recurring", kind: "service", deliveryShape: "program",
      pricePresentation: "fixed", customerAction: "apply", category: "Programs", imageUrl: null,
      updatedAt: "2026-08-28T12:00:00Z",
      prices: [{ id: "price-1", nickname: "Standard", unitAmount: 240000, currency: "usd",
                 billingInterval: "month", kind: "recurring", installmentsTotal: null, active: true }],
    }];
    render("terms");
    act(() => (buttonSaying("New agreement") as HTMLButtonElement).click());
    const dialog = document.querySelector('[role="dialog"]');
    const text = dialog?.textContent ?? "";
    expect(text).toContain("Search your Catalog");
    expect(text).toContain("Twelve-week program");
    expect(text).toContain("$2,400");
    expect(text).toContain("monthly");
    // The deleted band's own search input came with it.
    expect(dialog?.querySelector('input[placeholder="Search your Catalog…"]')).not.toBeNull();

    // The offer is a real ATTACH ROW now, not an <option> in a dropdown — §11 bans the native
    // control, and a dropdown hid every price behind a click at the one moment they matter.
    const rows = [...dialog!.querySelectorAll(".so-res")];
    expect(rows.map((r) => r.textContent)).toEqual([
      expect.stringContaining("No offer"),
      expect.stringContaining("Twelve-week program"),
    ]);
    // Exactly one thing is attached at a time, and the price sits in its own column beside it.
    expect(rows.filter((r) => r.getAttribute("aria-pressed") === "true")).toHaveLength(1);
    expect(rows[1].querySelector(".so-res-price")!.textContent).toBe("$2,400 · monthly");

    // §58 — THE PAGER SURVIVED the dropdown it used to sit under. It now renders only when it can
    // do something, so a single-page catalog correctly shows none: asserting its LABEL on one
    // offer, as this test used to, proved the label existed and never that paging worked.
    expect(text).not.toContain("Offer page");
    expect(buttonSaying("Next")).toBeUndefined();
  });

  it("shows the offer pager, and pages, once there is more than one page (Terms)", () => {
    harness.offers.offers = [{
      id: "offer-1", name: "Twelve-week program", availability: "active",
      prices: [{ id: "price-1", unitAmount: 240000, currency: "usd", billingInterval: "month", active: true }],
    }];
    harness.offers.hasMore = true;
    render("terms");
    act(() => (buttonSaying("New agreement") as HTMLButtonElement).click());
    expect(document.querySelector('[role="dialog"]')!.textContent).toContain("Offer page 1 · up to 5 offers");
    const next = buttonSaying("Next") as HTMLButtonElement;
    expect(next).toBeDefined();
    expect(next.disabled).toBe(false);
    act(() => next.click());
    // Paging is a real read against a new page, not a local slice of what was already fetched.
    expect(document.querySelector('[role="dialog"]')!.textContent).toContain("Offer page 2 · up to 5 offers");
  });

  /** §58 RE-POINT — the two smaller things the deleted band also did. */
  it("keeps the no-matching-offers reading and the unknown-offer-authority notice (Terms)", () => {
    harness.offers.authorityUnknown = true;
    render("terms");
    act(() => (buttonSaying("New agreement") as HTMLButtonElement).click());
    const dialog = document.querySelector('[role="dialog"]')!;
    expect(dialog.textContent).toContain("Offer editing access could not be confirmed");
    expect(buttonSaying("Retry offer access")).toBeDefined();
    const search = dialog.querySelector('input[placeholder="Search your Catalog…"]') as HTMLInputElement;
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(search, "nothing like this");
      search.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const after = document.querySelector('[role="dialog"]')!;
    expect(after.textContent).toContain("Nothing in your Catalog matches that.");
    // The two states stay DISTINCT: "nothing matches that word" must never render as "you have no
    // offers at all", or a reader goes looking in Catalog for something that was never there.
    expect(after.textContent).not.toContain("Nothing in your catalog yet");
    // The no-match state carries the two acts that resolve it, per the approved pack.
    expect(buttonSaying("Quick offer")).toBeDefined();
    expect(buttonSaying("Open Catalog")).toBeDefined();
  });

  it("renders recorded payments as recorded, and no total (Revenue)", () => {
    harness.sales.orders = [
      { id: "o1", productId: null, customerName: "A client", customerEmail: null,
        amountTotal: 45000, currency: "usd", status: "complete", createdAt: "2026-08-20T12:00:00Z" },
      { id: "o2", productId: null, customerName: null, customerEmail: "someone@example.com",
        amountTotal: null, currency: null, status: "pending", createdAt: null },
    ];
    render("revenue");
    const text = host.textContent ?? "";
    expect(text).toContain("A client");
    expect(text).toContain("$450");
    expect(text).toContain("Paid");
    expect(text).toContain("Awaiting payment");
    expect(text).not.toContain("$0");
    expect(text).toContain("Not recorded");
    expect(text).toContain("View 2 recent payment records");
    const table = host.querySelector('[aria-label="Commercial activity"]');
    expect(table).not.toBeNull();
    const tableText = table?.textContent ?? "";
    expect(tableText).not.toMatch(/total|revenue|forecast|projected|sum/i);
    expect((tableText.match(/\$[\d,]+/g) ?? [])).toEqual(["$450"]);
  });

  it("offers no controls to a member who may not manage, and says why (Revenue)", () => {
    harness.sales.canManage = false;
    harness.offers.canManage = false;
    harness.agreements.canManage = false;
    render("revenue");
    expect(host.textContent).toContain("An owner or admin records this");
    expect(buttonSaying("Record it")).toBeUndefined();
    render("terms");
    expect(buttonSaying("Quick offer")).toBeUndefined();
    expect(buttonSaying("New agreement")).toBeUndefined();
    // §58/§36: a read-only reader is told WHO may record, never left with a silently missing button.
    expect(host.textContent).toContain("An owner or admin records this");
  });

  /**
   * §58 RE-POINT of the same rule at its new home. The band that used to hide "Quick offer" from a
   * non-manager is gone, so the authority check moved with the act: someone who may record terms
   * but may NOT write the catalog opens the editor, finds it empty, and is offered Catalog — never
   * a create control their role cannot use.
   */
  it("hides Quick offer inside the editor from someone who may not write the catalog (Terms)", () => {
    harness.offers.canManage = false;
    render("terms");
    act(() => (buttonSaying("New agreement") as HTMLButtonElement).click());
    const dialog = document.querySelector('[role="dialog"]')!;
    expect(dialog.textContent).toContain("Nothing in your catalog yet");
    expect([...dialog.querySelectorAll("button")].some((b) => b.textContent === "Quick offer")).toBe(false);
    expect([...dialog.querySelectorAll("button")].some((b) => b.textContent?.includes("Go to Catalog"))).toBe(true);
  });

  it("says the authority read failed rather than asserting a refusal it did not prove (Revenue)", () => {
    harness.sales.canManage = false;
    harness.sales.authorityUnknown = true;
    render("revenue");
    expect(host.textContent).toContain("could not be read");
  });

  it("names an unreadable stored processor instead of calling it unstated (Revenue)", () => {
    harness.sales.processor = null;
    harness.sales.processorUnrecognised = true;
    render("revenue");
    expect(host.textContent).toContain("this version cannot read");
    expect(host.textContent).toContain("Not readable");
  });

  it("calls an unreadable Campaigns snapshot unknown, not empty", () => {
    harness.state.phase = "error";
    render();
    expect(host.textContent).toContain("Campaigns could not load");
    expect(host.textContent).not.toContain("No deals on the board yet");
  });

  it("now reads client terms, and still refuses to count retainers Command Center owns (Terms)", () => {
    render("terms");
    const text = host.textContent ?? "";
    expect(text).toContain("Agreements and terms");
    expect(text).not.toContain("This tab does not hold a per-client agreement record yet");
    expect(text).not.toContain("Not here");
    // RE-POINTED, and the reason is the defect this slice fixed. The old assertion passed on the
    // head PILL's "Nothing recorded yet" while the paragraph beside it simultaneously said "Add one
    // under Clients first" — two different answers to the same question, inches apart. This harness
    // has zero clients, so exactly one thing is true and the surface now says only that.
    expect(text).toContain("Add a client first");
    expect(text).not.toContain("Nothing recorded yet");
    expect(text).not.toMatch(/\d+\s+(active\s+)?retainers?/i);
  });

  it("says a member's unreadable client book is unknown, never zero (Terms)", () => {
    harness.agreements.agreementsReadable = false;
    harness.agreements.clientsReadable = false;
    harness.agreements.agreements = [];
    render("terms");
    const text = host.textContent ?? "";
    expect(text).toContain("not readable at your access level");
    expect(text).toContain("That is different from there being none");
    expect(text).not.toMatch(/Agreements and terms[\s\S]{0,80}Nothing recorded yet/);
  });

  it("keeps the money boundary on the terms band, and promises no billing (Terms)", () => {
    render("terms");
    const text = host.textContent ?? "";
    // §58 with an owner-ruled CHANGE, recorded rather than silently dropped: the band used to
    // promise "No legal document is generated, stored or signed here", which this slice makes
    // false — documents are exactly what it now records. The §38 promise underneath it is
    // unchanged and is what this asserts: sending one still moves no money.
    expect(text).toContain("Sending an agreement bills nobody and charges nothing");
    expect(text).not.toContain("No legal document is generated, stored or signed here");
    expect(text).not.toMatch(/\b(invoiced|charged|collected|paid in full)\b/i);
  });

  it("keeps the signature state and the engagement state apart (Terms)", () => {
    // The two states answer different questions and the owner ruled they stay separate.
    render("terms");
    const text = host.textContent ?? "";
    expect(text).toContain("This column tracks the");
    expect(text).toContain("signature");
    expect(text).toContain("separate state that starts once it is signed");
  });

  it("gives every view real headings, not bold text", () => {
    render();
    let headings = [...host.querySelectorAll("h1,h2,h3")].map((h) => h.textContent?.trim());
    expect(headings).toContain("Commercial Readiness Ladder");
    expect(headings).toContain("Top Commercial Moves");
    expect(headings).toContain("Open Commercial Work");
    render("terms");
    headings = [...host.querySelectorAll("h1,h2,h3")].map((h) => h.textContent?.trim());
    expect(headings).toContain("Agreements and terms");
    // §58 RE-POINT: "Find an offer" was the deleted band's heading. It is now the labelled search
    // step inside the editor, and the editor's own steps are real headings rather than bold text.
    act(() => (buttonSaying("New agreement") as HTMLButtonElement).click());
    const editorHeadings = [...document.querySelectorAll('[role="dialog"] h2, [role="dialog"] h3')]
      .map((h) => h.textContent?.trim());
    expect(editorHeadings).toContain("Where the document comes from");
    expect(editorHeadings).toContain("Who it is for");
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain("Search your Catalog");
    render("revenue");
    headings = [...host.querySelectorAll("h1,h2,h3")].map((h) => h.textContent?.trim());
    expect(headings).toContain("Actual received");
    expect(headings).toContain("Commercial activity");
  });

  it("makes its dialogs actually modal, not merely labelled so (Revenue)", () => {
    render("revenue");
    const opener = buttonSaying("Record it") as HTMLButtonElement;
    act(() => { opener.focus(); opener.click(); });
    const dialog = document.querySelector('[role="dialog"][aria-modal="true"]') as HTMLElement;
    expect(dialog).not.toBeNull();
    const shell = host.querySelector(".solo-campaigns > .campaigns-scroll");
    expect(shell?.hasAttribute("inert")).toBe(true);
    const focusable = [...dialog.querySelectorAll("button:not([disabled]), input")] as HTMLElement[];
    expect(focusable.length).toBeGreaterThan(1);
    const last = focusable[focusable.length - 1];
    act(() => last.focus());
    act(() => { window.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true })); });
    expect(document.activeElement).toBe(focusable[0]);
    const cancel = focusable.find((el) => el.textContent === "Cancel") as HTMLButtonElement;
    act(() => cancel.click());
    expect(shell?.hasAttribute("inert")).toBe(false);
    expect(document.activeElement).toBe(opener);
  });

  it("uses the shared pill primitive rather than a local fork", () => {
    render();
    expect(host.querySelector(".so-pill")).toBeNull();
    expect(host.querySelector(".pill")).not.toBeNull();
  });

  it("keeps our plumbing vocabulary out of what a person reads", () => {
    harness.sales.phase = "error";
    render();
    expect(host.textContent).toContain("Your records were not changed");
    expect(host.textContent).not.toContain("tenant-scoped read");
  });

  it("says the word Sales once on the command view, not three times down the page", () => {
    render();
    const saying = [...host.querySelectorAll("*")]
      .filter((el) => el.children.length === 0 && el.textContent?.trim() === "Sales");
    expect(saying).toHaveLength(1);
    expect(host.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toBe("Sales");
    const headings = [...host.querySelectorAll("h1,h2,h3")].map((h) => h.textContent ?? "");
    expect(headings.some((h) => /Sales/.test(h))).toBe(false);
  });

  it("renders no masthead above the work on any of the six tabs, and moves truth onto the desk", () => {
    for (const slug of ["overview", "catalog", "sales", "pipeline", "social", "performance"]) {
      renderAt(`/solo/42/growth/${slug}`);
      expect(host.querySelector(".pg-hd"), `masthead returned on ${slug}`).toBeNull();
    }
    render();
    expect(host.querySelector(".pg-hd")).toBeNull();
    // Owner ruling 2026-09-23: the capability truth labels come OFF the tenant surface entirely.
    // Asserted absent rather than deleted, so nothing quietly puts internal release vocabulary back
    // in front of a customer.
    expect(host.querySelector(".campaigns-truth")).toBeNull();
    expect(host.querySelector(".campaigns-truth-key")).toBeNull();
    expect(host.textContent ?? "").not.toMatch(/\b(PARTIAL|PROPOSED|UNAVAILABLE)\b/);
  });

  it("spends colour on meaning, not decoration", () => {
    // Empty terms read as an OPPORTUNITY (violet), never dead grey (§23); the act is the primary.
    // The violet now carries on the composed first-use mark instead of a pill that said in a badge
    // what the heading beside it already said in words.
    render("terms");
    expect(host.querySelector(".so-blank-mark")).not.toBeNull();
    expect(host.querySelector(".so-blank h4")).not.toBeNull();
    const act1 = [...host.querySelectorAll("button")].find((b) => b.textContent === "New agreement");
    expect(act1?.className).toContain("btn-p");
    // Money awaiting carries its own state colour so the figure and its pill cannot disagree.
    harness.sales.orders = [
      { id: "o1", productId: null, customerName: "A client", customerEmail: null,
        amountTotal: 45000, currency: "usd", status: "pending", createdAt: "2026-08-20T12:00:00Z" },
    ];
    render("revenue");
    expect(host.querySelector(".so-num--warn")).not.toBeNull();
    // The state-colour rules can actually WIN — a bare class loses to `.so-tr > span` (0,1,1).
    const sheet = readFileSync(resolve(process.cwd(), "src/solo/sales-ops.css"), "utf8");
    for (const tone of ["ok", "warn", "bad"]) {
      expect(sheet).toMatch(new RegExp(`\\.so-tr\\s*>\\s*span\\.so-num--${tone}`));
    }
    expect(sheet).toMatch(/\.so-tr\s*>\s*span\.so-num\b/);
    expect(sheet).toMatch(/\.so-tr\.so-th\s*>\s*span/);
    // Evidence chips never spend gold — gold stays on the act (§11).
    //
    // This used to read `/\.so-ec[\s\S]*?var\(--gold/`, which is not that rule: the lazy span runs
    // from the first `.so-ec` to the next `var(--gold` ANYWHERE later in the file, so it passed only
    // while no gold rule happened to be declared below the chips, and failed the moment one was —
    // on a surface that has nothing to do with chips. It now reads the chips' own declaration
    // blocks, which is what it always claimed to check.
    const chipBlocks = [...sheet.matchAll(/([^{}]*)\{([^{}]*)\}/g)]
      .filter(([, selector]) => /\.so-ec\b/.test(selector))
      .map(([, , body]) => body);
    expect(chipBlocks.length).toBeGreaterThan(5);
    for (const body of chipBlocks) expect(body).not.toMatch(/var\(--gold/);
  });
});

describe("Sales operations — the money boundary is structural, not a paragraph (§38)", () => {
  const at = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
  const source = at("src/solo/sales-ops.tsx");
  const hook = at("src/solo/useSoloSalesOps.ts");
  const derive = at("src/solo/sales/deriveSalesCommand.ts");
  const scenario = at("src/solo/sales/salesScenario.ts");
  const migration = at(
    "supabase/migrations/20261130000000_a_solo_owner_can_say_how_their_clients_pay_them.sql",
  );
  const strip = (text: string) =>
    text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*(\/\/|--).*$/gm, "");
  const code = strip(source);
  const hookCode = strip(hook);
  const deriveCode = strip(derive);
  const scenarioCode = strip(scenario);
  const migrationCode = strip(migration);

  it("never reaches the two functions that create external provider state", () => {
    for (const forbidden of ["tenant-checkout-session", "tenant-stripe-connect"]) {
      expect(code).not.toContain(forbidden);
      expect(hookCode).not.toContain(forbidden);
      expect(deriveCode).not.toContain(forbidden);
      expect(scenarioCode).not.toContain(forbidden);
    }
  });

  it("bakes in no processor — the allow-list is data, and one brand is one of seven", () => {
    expect(code).not.toMatch(/if\s*\(\s*[^)]*===\s*["']stripe["']/);
    expect(hookCode).not.toMatch(/if\s*\(\s*[^)]*===\s*["']stripe["']/);
    expect(hookCode).toContain("DECLARED_PROCESSORS");
  });

  it("the derivation and scenario model never move money or write anything", () => {
    // Pure read-model modules. No mutation, no rpc, no supabase, no fetch.
    for (const c of [deriveCode, scenarioCode]) {
      expect(c).not.toMatch(/\.(insert|update|upsert|delete)\(/);
      expect(c).not.toContain("supabase");
      expect(c).not.toContain(".rpc(");
      expect(c).not.toContain("fetch(");
    }
  });

  it("writes only through the declared-handling rpc, never a direct table write", () => {
    expect(hookCode).toContain("supabase.rpc(");
    expect(hookCode).toContain("declare_client_payment_handling");
    expect(hookCode).not.toMatch(/\.(insert|update|upsert|delete)\(/);
  });

  it("scopes every read to the resolved tenant and refuses to read before identity resolves", () => {
    const reads = hookCode.match(/\.from\(/g) ?? [];
    const scoped = (hookCode.match(/\.eq\("(tenant_id|id)", activeTenantId\)/g) ?? []).length;
    expect(reads.length).toBeGreaterThan(0);
    expect(scoped).toBeGreaterThanOrEqual(reads.length);
    expect(hookCode.indexOf("if (!activeTenantId)")).toBeGreaterThan(-1);
    expect(hookCode.indexOf("if (!activeTenantId)")).toBeLessThan(hookCode.indexOf(".from("));
  });

  it("sends the caller's own resolved tenant as the refusal-only expected tenant", () => {
    expect(hookCode).toContain("_expected_tenant_id: activeTenantId");
  });

  it("keeps the migration free of processor machinery and of network egress", () => {
    expect(migrationCode).not.toMatch(/stripe_|payment_intent|application_fee|charges_enabled|payouts_enabled/i);
    expect(migrationCode).not.toMatch(/pg_net|http_post|net\.http|extensions\.http/i);
  });

  it("re-enforces caller scope in the function body, never on the grant (§59)", () => {
    expect(migrationCode).toContain("SECURITY DEFINER");
    expect(migrationCode).toContain("auth.uid()");
    expect(migrationCode).toContain("public.current_user_tenant_id()");
    expect(migrationCode).toContain("public.is_tenant_admin(_tenant)");
    expect(migrationCode).toMatch(/_expected_tenant_id IS DISTINCT FROM _tenant/);
    expect(migrationCode).toMatch(/REVOKE ALL ON FUNCTION public\.declare_client_payment_handling[\s\S]*?FROM anon/);
    expect(migrationCode).toMatch(/GRANT EXECUTE ON FUNCTION public\.declare_client_payment_handling[\s\S]*?TO authenticated/);
  });

  it("keeps a pinned search_path on the definer function", () => {
    expect(migrationCode).toMatch(/SET search_path TO 'public', 'pg_temp'/);
  });
});

// Recorded agreement dates are calendar dates, not timestamp events. (Commercial Terms view.)
describe('agreement schedule detail', () => {
  afterEach(() => vi.restoreAllMocks());
  it.each([
    ['recurring', '2026-10-15', 'Oct 15, 2026'],
    ['recurring', null, 'Not stated'],
    ['one_time', null, 'Not applicable'],
  ])('shows dates for %s with renewal %s', (termKind, renewsOn, renewalText) => {
    const Formatter = Intl.DateTimeFormat;
    vi.spyOn(Intl, 'DateTimeFormat').mockImplementation(function (locale, options) { return new Formatter('en-US', { timeZone: 'America/Los_Angeles', ...options }); });
    harness.agreements.clients = [{ id: 'c1', name: 'Example client' }];
    harness.agreements.agreements = [{
      id: 'a1', contactId: 'c1', offerId: 'o1', status: 'draft', termKind,
      agreedAmountMinor: null, catalogSnapshotMinor: null,
      startsOn: '2026-09-15', renewsOn, endsOn: '2026-11-15',
    }];
    render('terms');
    const row = host.querySelector('[aria-label="Agreements and terms"] button') as HTMLButtonElement;
    act(() => row.click());
    const text = document.querySelector('[role="dialog"]')?.textContent ?? '';
    expect(text).toContain('Sep 15, 2026');
    expect(text).toContain('Nov 15, 2026');
    expect(text).toContain(`Renews${renewalText}`);
    expect(text).toContain('not an invoice, a charge, or a payment record');
    expect(harness.agreements.saveAgreement).not.toHaveBeenCalled();
    expect(harness.agreements.setAgreementStatus).not.toHaveBeenCalled();
    expect(harness.offers.saveOffer).not.toHaveBeenCalled();
  });
});

// jsdom does not enforce inert, so assert ancestry as well as dispatching actions.
describe("Sales usability repair", () => {
  const type = (input: HTMLInputElement, value: string) => act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  // Each control lives in the view that owns it: Record it → Revenue; Quick offer / Record terms → Terms.
  it.each([["Record it", "revenue"], ["New agreement", "terms"]] as const)(
    "keeps %s outside inert content and Cancel restores focus", (name, view) => {
      render(view);
      const opener = buttonSaying(name) as HTMLButtonElement;
      opener.focus(); act(() => opener.click());
      const dialog = document.querySelector('[role="dialog"]')!;
      expect(dialog.closest('[inert]')).toBeNull();
      const cancel = [...dialog.querySelectorAll('button')].find(b => b.textContent === 'Cancel')!;
      act(() => cancel.click());
      expect(document.querySelector('[role="dialog"]')).toBeNull();
      expect(document.activeElement).toBe(opener);
    });
  /**
   * §58 RE-POINT of the dropped it.each row. "Quick offer" keeps its focus-trap proof; it loses the
   * focus-RESTORE assertion for a structural reason worth writing down rather than hiding: the two
   * drawers cannot coexist, so opening Quick offer unmounts the agreement editor along with the
   * button that opened it. `useModalDialog` checks `isConnected` before restoring, so there is
   * nothing to restore to — and inventing somewhere for focus to land would be a worse answer than
   * this one.
   */
  it("opens Quick offer outside inert content from inside the editor, and Cancel closes it (Terms)", () => {
    openQuickOffer();
    const dialog = document.querySelector('[role="dialog"]')!;
    expect(dialog.textContent).toContain("saves as a draft in Catalog");
    expect(dialog.closest('[inert]')).toBeNull();
    const cancel = [...dialog.querySelectorAll('button')].find(b => b.textContent === 'Cancel')!;
    act(() => cancel.click());
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(harness.offers.saveOffer).not.toHaveBeenCalled();
  });
  it("protects dirty Quick Offer on Cancel and Escape without native confirm (Terms)", () => {
    openQuickOffer();
    const input = document.querySelector('[role="dialog"] input') as HTMLInputElement;
    type(input, "Keep this draft");
    act(() => (buttonSaying("Cancel") as HTMLButtonElement).click());
    expect(document.querySelector('[role="alertdialog"]')).not.toBeNull();
    act(() => (buttonSaying("Continue editing") as HTMLButtonElement).click());
    expect(input.value).toBe("Keep this draft");
    act(() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    act(() => (buttonSaying("Discard changes") as HTMLButtonElement).click());
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(harness.offers.saveOffer).not.toHaveBeenCalled();
  });
  it("edits a Catalog-basis record without repricing or dropping unedited fields (Terms)", async () => {
    harness.agreements.clients = [{ id: "c1", name: "Client" }];
    harness.offers.offers = [{ id: "o1", name: "Offer", prices: [], availability: "active" }];
    harness.agreements.agreements = [{ id: "a1", contactId: "c1", offerId: "o1", status: "active", termKind: "recurring", priceBasis: "catalog", agreedAmountMinor: 12500, agreedCurrency: "usd", catalogSnapshotMinor: 12500, catalogSnapshotAt: "2026-09-01", billingInterval: "month", intervalCount: 3, paymentSchedule: "custom", title: "Keep title", notes: "Original", updatedAt: "version-1" }];
    render("terms");
    act(() => (host.querySelector('[aria-label="Agreements and terms"] button') as HTMLButtonElement).click());
    act(() => (buttonSaying("Edit commercial terms") as HTMLButtonElement).click());
    const input = document.querySelector('input[placeholder="Anything you want to remember about this arrangement"]') as HTMLInputElement;
    act(() => (buttonSaying("What we agreed") as HTMLButtonElement).click());
    type(document.querySelector(".so-editor .so-money input") as HTMLInputElement, "-50");
    act(() => (buttonSaying("Your catalog price") as HTMLButtonElement).click());
    expect((document.querySelector(".so-editor .so-money input") as HTMLInputElement).value).toBe("125");
    type(input, "Updated note");
    await act(async () => (buttonSaying("Save changes") as HTMLButtonElement).click());
    expect(harness.agreements.saveAgreement).toHaveBeenCalledWith(expect.objectContaining({ agreedAmountMinor: 12500, agreedCurrency: "usd", catalogPriceId: null, intervalCount: 3, paymentSchedule: "custom", title: "Keep title", notes: "Updated note", expectedUpdatedAt: "version-1" }));
    expect(harness.offers.saveOffer).not.toHaveBeenCalled();
  });
});
describe("Commercial quote transitions (Terms)", () => {
  it.each([false, true])("clears amount for pending quote (existing=%s)", async existing => {
    harness.agreements.clients = [{ id: "c1", name: "Client" }];
    harness.offers.offers = [{ id: "o1", name: "Offer", prices: [{ id: "p1", unitAmount: 20000, currency: "usd", active: true }], availability: "active" }];
    if (existing) harness.agreements.agreements = [{ id: "a1", contactId: "c1", offerId: "o1", status: "draft", termKind: "one_time", priceBasis: "negotiated", agreedAmountMinor: 12500, agreedCurrency: "usd", catalogSnapshotMinor: null, catalogSnapshotAt: null, updatedAt: "v1" }];
    render("terms");
    if (existing) { act(() => (host.querySelector('[aria-label="Agreements and terms"] button') as HTMLButtonElement).click()); act(() => (buttonSaying("Edit commercial terms") as HTMLButtonElement).click()); expect(buttonSaying("Your catalog price")).toBeUndefined(); }
    else {
      act(() => (buttonSaying("New agreement") as HTMLButtonElement).click());
      // The client is still a select; the offer is now an attach row, so it is CLICKED rather
      // than assigned. Reaching it by its name and not by index keeps this test honest if the
      // list ever reorders.
      const clientSelect = document.querySelector('.so-editor select') as HTMLSelectElement;
      act(() => { clientSelect.value = "c1"; clientSelect.dispatchEvent(new Event('change', { bubbles: true })); });
      const offerRow = [...document.querySelectorAll('.so-editor .so-res')]
        .find((r) => r.textContent?.includes("Offer")) as HTMLButtonElement;
      act(() => offerRow.click());
      expect(offerRow.getAttribute("aria-pressed")).toBe("true");
      const input = document.querySelector('input[placeholder="Amount"]') as HTMLInputElement;
      act(() => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, '125'); input.dispatchEvent(new Event('input', { bubbles: true })); });
    }
    act(() => (buttonSaying("Not quoted yet") as HTMLButtonElement).click());
    const save = [...document.querySelectorAll('.so-editor button')].find(b => b.textContent === (existing ? 'Save changes' : 'Save as draft')) as HTMLButtonElement;
    await act(async () => save.click());
    expect(harness.agreements.saveAgreement).toHaveBeenCalledWith(expect.objectContaining({ priceBasis: 'quote_pending', termKind: 'custom_quote', agreedAmountMinor: null, agreedCurrency: null }));
  });
});

/**
 * The DOCUMENT half — what an owner can actually do with it (§70.1).
 *
 * Every test below drives the real control and asserts what was SENT, because "the handler is
 * bound" is not evidence that a person can finish the job.
 */
describe("Agreement documents — signature state, separate from commercial state", () => {
  const AGREEMENT = {
    id: "a1", contactId: "c1", offerId: "o1", status: "active", termKind: "one_time",
    priceBasis: "negotiated", agreedAmountMinor: 120000, agreedCurrency: "usd",
    catalogSnapshotMinor: null, catalogSnapshotAt: null, startsOn: null, renewsOn: null,
    endsOn: null, updatedAt: "v1",
  };
  const SIGNING = {
    id: "s1", contactId: "c1", agreementId: "a1", documentTitle: "Coaching agreement",
    documentSource: "tenant_upload", documentPath: "tenant-1/source/1-x.pdf",
    signatureState: "sent", displayState: "sent", expiresAt: "2026-10-06T12:00:00Z",
    sentAt: "2026-09-22T12:00:00Z", viewedAt: null, completedAt: null, declinedAt: null,
    voidedAt: null, declineReason: null, signerName: null, hasSealedCopy: false,
    createdAt: "2026-09-22T12:00:00Z", updatedAt: "2026-09-22T12:00:00Z",
  };

  /* ── retrieving the signed copy (§70) ────────────────────────────────────────────────────
   * An owner who can see that a client signed and cannot obtain the thing they signed has not
   * finished the job, which is the whole §70 test. These guard the act and its honest failures. */
  const COMPLETED = {
    ...SIGNING, signatureState: "completed", displayState: "completed",
    signerName: "Dana Reed", completedAt: "2026-09-22T13:00:00Z",
    hasSealedCopy: true,
  };
  const openCompleted = () => {
    harness.agreements.clients = [{ id: "c1", name: "Acme" }];
    harness.agreements.agreements = [AGREEMENT];
    harness.signings.signings = [COMPLETED];
    render("terms");
    act(() => (host.querySelector('[aria-label="Agreements and terms"] .so-row') as HTMLButtonElement).click());
    act(() => (buttonSaying("View the signed record") as HTMLButtonElement).click());
  };

  it("offers the signed copy on a completed document, and opens only what the server returned", async () => {
    const opened: string[] = [];
    const spy = vi.spyOn(window, "open").mockImplementation(((u: string) => { opened.push(u); return null; }) as never);
    openCompleted();
    const button = buttonSaying("Download the signed PDF") as HTMLButtonElement;
    expect(button).toBeDefined();
    await act(async () => { button.click(); });
    // RE-POINTED, not rewritten away: the sealed copy is now streamed by `agreement-document`,
    // which resolves the record itself, so the surface hands it the SIGNING ID and never an
    // object key. Passing the storage path here would be passing the thing the engine lane
    // refused to expose — the key discloses the tenant and agreement ids and keeps resolving
    // after a void.
    expect(harness.signings.signedCopyUrl).toHaveBeenCalledWith("s1", "tenant-1");
    expect(opened).toEqual(["https://storage.test/signed.pdf?token=x"]);
    spy.mockRestore();
  });

  it("opens nothing and says so when the signed copy could not be minted", async () => {
    const opened: string[] = [];
    const spy = vi.spyOn(window, "open").mockImplementation(((u: string) => { opened.push(u); return null; }) as never);
    harness.signings.signedCopyUrl = vi.fn(async () => ({ ok: false, message: "That signed copy could not be opened just now." }));
    openCompleted();
    await act(async () => { (buttonSaying("Download the signed PDF") as HTMLButtonElement).click(); });
    // §13: a request is not a link. Nothing is opened and the refusal is what the owner is told.
    expect(opened).toEqual([]);
    expect(host.textContent).toContain("That signed copy could not be opened just now.");
    spy.mockRestore();
  });

  it("says a completed document carries no sealed copy rather than offering a control that cannot work", () => {
    harness.agreements.clients = [{ id: "c1", name: "Acme" }];
    harness.agreements.agreements = [AGREEMENT];
    harness.signings.signings = [{ ...COMPLETED, hasSealedCopy: false }];
    render("terms");
    act(() => (host.querySelector('[aria-label="Agreements and terms"] .so-row') as HTMLButtonElement).click());
    // The record still opens — it is signed, and the trail of how it got there is the point of the
    // surface. What is absent is the DOWNLOAD, and the footer says why instead of offering a
    // control that cannot work (§70.1).
    act(() => (buttonSaying("View the signed record") as HTMLButtonElement).click());
    expect(buttonSaying("Download the signed PDF")).toBeUndefined();
    // Targeted by its OWN label: the grounded-detail drawer is also role="dialog", so a bare
    // querySelector returns whichever is first in the DOM rather than the one under test.
    expect(document.querySelector('[aria-labelledby="so-done-title"]')!.textContent).toContain("no sealed copy is recorded against it");
  });

  it("claims only what it knows about a completed agreement", async () => {
    // Two assertions in one sentence were not the surface's to make.
    openCompleted();
    await act(async () => {});
    const panel = document.querySelector('[aria-labelledby="so-done-title"]')!;
    const text = panel.textContent ?? "";

    // Signing completion does not touch the commercial row, and create-and-sign saves it DRAFT,
    // so the common case made this false — and it contradicted the closing note in the same dialog.
    expect(text).not.toContain("now active against their record");
    // The closing note, which states the distinction correctly, is still there.
    expect(text).toContain("is a separate state you control from here on");
    // With a sealed copy, the sentence may describe it.
    expect(text).toContain("The sealed PDF carries their signature");
  });

  it("does not describe a sealed PDF that is not recorded", async () => {
    harness.agreements.clients = [{ id: "c1", name: "Acme" }];
    harness.agreements.agreements = [AGREEMENT];
    harness.signings.signings = [{ ...COMPLETED, hasSealedCopy: false }];
    render("terms");
    act(() => (host.querySelector('[aria-label="Agreements and terms"] .so-row') as HTMLButtonElement).click());
    act(() => (buttonSaying("View the signed record") as HTMLButtonElement).click());
    await act(async () => {});
    const panel = document.querySelector('[aria-labelledby="so-done-title"]')!;
    // The footer already said no sealed copy is recorded; the summary must not argue with it.
    expect(panel.textContent).not.toContain("The sealed PDF carries their signature");
    expect(panel.textContent).toContain("No sealed copy is recorded against it yet");
    expect(buttonSaying("Download the signed PDF")).toBeUndefined();
  });

  it("says a successfully-read empty trail is empty, not unreadable", async () => {
    harness.signings.signingEvents = vi.fn(async () => ({ ok: true, events: [], truncated: false }));
    openCompleted();
    await act(async () => {});
    const panel = document.querySelector('[aria-labelledby="so-done-title"]')!;
    // `ready` PROVES the read completed, so offering "could not be read" collapsed the very
    // distinction this surface exists to draw.
    expect(panel.textContent).not.toContain("could not be read or was never written");
    expect(panel.textContent).toContain("read successfully and came back empty");
  });

  it("discloses a truncated audit trail instead of presenting it as the whole history", async () => {
    harness.signings.signingEvents = vi.fn(async () => ({
      ok: true, truncated: true,
      events: [{ id: "e1", type: "completed", actorKind: "signer", actorEmail: null, ip: null, userAgent: null, at: "2026-09-18T09:31:00Z" }],
    }));
    openCompleted();
    await act(async () => {});
    const panel = document.querySelector('[aria-labelledby="so-done-title"]')!;
    // The order is seq DESC, so a cap drops the OLDEST — creation and the original send. A panel
    // headed "What happened, and when" must not present that as complete.
    expect(panel.textContent).toContain("most recent events");
    expect(panel.textContent).toContain("recorded but not shown here");
  });

  it("opens the named client's record, not the general list", async () => {
    openCompleted();
    await act(async () => {});
    act(() => (buttonSaying("Open Acme\u2019s record") as HTMLButtonElement).click());
    // The clients workspace already reads `?person=` as its deep link; the control just never
    // sent one, so a button naming a person landed on everyone.
    // The clients workspace reads `?person=` as its deep link (TenantRelationshipsClientsWorkspace),
    // so this asserts the real destination rather than that a handler fired.
    expect(lastLocation).toContain("/clients/people");
    expect(lastLocation).toContain("person=c1");
  });

  it("never asks the database for a storage key or a document path", () => {
    // The sealed key is shaped `${tenant_id}/${agreement_id}/...`, so selecting it puts both ids
    // into every browser that opens this band. This lane removed that disclosure from the
    // RETRIEVAL path (adopting `agreement-document` over a signed URL) and left it standing in the
    // LIST path — the same leak arriving by a different door. The surface only ever asked "is
    // there a sealed copy?", and a CHECK in the engine's own schema
    // (20270401000000:124) makes `sealed_sha256` answer that identically while disclosing nothing.
    const hook = readFileSync(resolve(process.cwd(), "src/solo/useSoloAgreementSignings.ts"), "utf8");
    const selected = [...hook.matchAll(/"([a-z_,()]*(?:id|at|status|source|sha256|key|path)[a-z_,()]*)" \+/g)]
      .map(([, chunk]) => chunk).join(",");
    expect(selected).toContain("sealed_sha256");
    expect(selected).not.toContain("sealed_storage_key");
    expect(selected).not.toContain("document_path");
  });

  it("shows the recorded trail — what the engine logged, at minute resolution, in its order", async () => {
    openCompleted();
    // The trail is fetched, not derived from the row's four timestamps: those can say a document
    // was viewed, they cannot say by which address, from which device, or in what order.
    await act(async () => {});
    expect(harness.signings.signingEvents).toHaveBeenCalledWith("s1", "tenant-1");

    const panel = document.querySelector('[aria-labelledby="so-done-title"]')!;
    const rows = [...panel.querySelectorAll(".so-ev")];
    expect(rows).toHaveLength(2);

    // Newest first, exactly as the read returned it — never re-sorted into a guess.
    expect(rows[0].textContent).toContain("Signed and completed");
    expect(rows[1].textContent).toContain("Sent");
    // The recorded actor, address and device, and nothing invented to fill the gaps: the `sent`
    // event carries none of the three, so it falls back to who did it rather than a blank.
    expect(rows[0].textContent).toContain("dana@example.com");
    expect(rows[0].textContent).toContain("203.0.113.42");
    expect(rows[0].textContent).toContain("Safari on iPhone");
    expect(rows[1].textContent).toContain("by owner");
    // MINUTE resolution. Both events fall on the same day, so a date-only stamp would render them
    // identically and the ordering this surface exists to prove would be invisible.
    expect(rows[0].querySelector(".so-ev-when")!.textContent)
      .not.toEqual(rows[1].querySelector(".so-ev-when")!.textContent);
    // The event that CLOSES the ceremony carries the settled mark; the one in flight does not.
    expect(rows[0].className).toContain("is-done");
    expect(rows[1].className).not.toContain("is-done");

    // ONE title. The approved screen leads with the seal and says "Signed and completed" once;
    // a head row repeating it directly above is a stutter, and this is what keeps it gone.
    const headings = [...panel.querySelectorAll("h1, h2, h3")].map((h) => h.textContent);
    expect(headings).toEqual(["Signed and completed"]);
  });

  it("says so when the trail cannot be read, rather than showing an empty history", async () => {
    harness.signings.signingEvents = vi.fn(async () => ({ ok: false, message: "This document's history could not be read." }));
    openCompleted();
    await act(async () => {});
    const panel = document.querySelector('[aria-labelledby="so-done-title"]')!;
    // A failed READ and a document with no recorded history are not the same fact, and a trail
    // that renders empty for both tells the owner the wrong one (§13).
    expect(panel.textContent).toContain("This document's history could not be read.");
    expect(panel.querySelectorAll(".so-ev")).toHaveLength(0);
    // The rest of the record still stands: the seal and the sealed copy do not depend on the trail.
    expect(buttonSaying("Download the signed PDF")).toBeDefined();
  });

  it("lets a reader who cannot write still retrieve the signed copy", () => {
    // Reading the document is a READ; the storage policy decides it, not the write gate. Gating
    // this on canManage would hide a signed contract from someone entitled to read its record.
    harness.signings.canManage = false;
    openCompleted();
    expect(buttonSaying("Download the signed PDF")).toBeDefined();
    expect(buttonSaying("Send for signature")).toBeUndefined();
  });

  it("shows the signature state in its own column and never writes the commercial one", () => {
    harness.agreements.clients = [{ id: "c1", name: "Acme" }];
    harness.agreements.agreements = [AGREEMENT];
    harness.signings.signings = [SIGNING];
    render("terms");
    const table = host.querySelector('[aria-label="Agreements and terms"]');
    const text = table?.textContent ?? "";
    expect(text).toContain("Coaching agreement");
    expect(text).toContain("Sent");
    // The engagement's own word is still readable at a glance — it moved, it did not go (§58).
    expect(text).toContain("Active");
    expect(harness.agreements.setAgreementStatus).not.toHaveBeenCalled();
  });

  it("calls a sent link whose clock has run out expired, rather than claiming it still works", () => {
    harness.agreements.clients = [{ id: "c1", name: "Acme" }];
    harness.agreements.agreements = [AGREEMENT];
    harness.signings.signings = [{ ...SIGNING, displayState: "expired" }];
    render("terms");
    expect(host.querySelector('[aria-label="Agreements and terms"]')?.textContent).toContain("Link expired");
  });

  it("says the signature column is unknown, not empty, when documents cannot be read", () => {
    harness.agreements.clients = [{ id: "c1", name: "Acme" }];
    harness.agreements.agreements = [AGREEMENT];
    harness.signings.phase = "error";
    harness.signings.readable = false;
    harness.signings.signings = [];
    render("terms");
    const text = host.textContent ?? "";
    expect(text).toContain("Not readable");
    expect(text).not.toContain("No document");
    expect(text).toContain("could not be read, so the Signature column is unknown rather than empty");
  });

  it("shows a document with no offer and no price as a row of its own (owner ruling 3)", () => {
    harness.agreements.clients = [{ id: "c1", name: "Acme" }];
    harness.agreements.agreements = [];
    harness.signings.signings = [{ ...SIGNING, id: "s2", agreementId: null, documentTitle: "Mutual NDA" }];
    render("terms");
    const text = host.querySelector('[aria-label="Agreements and terms"]')?.textContent ?? "";
    expect(text).toContain("Mutual NDA");
    expect(text).toContain("No offer or price on this document");
  });

  it("records an uploaded contract and sends what the server needs, with no offer attached", async () => {
    harness.agreements.clients = [{ id: "c1", name: "Acme" }];
    render("terms");
    act(() => (buttonSaying("New agreement") as HTMLButtonElement).click());
    const dialog = document.querySelector('[role="dialog"]')!;
    const pick = (label: string) =>
      [...dialog.querySelectorAll('.so-src-card')].find((b) => b.textContent?.includes(label)) as HTMLButtonElement;
    act(() => pick("Upload a contract").click());

    const selects = dialog.querySelectorAll("select");
    act(() => {
      (selects[0] as HTMLSelectElement).value = "c1";
      selects[0].dispatchEvent(new Event("change", { bubbles: true }));
    });
    const fileInput = dialog.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(["contract"], "coaching.pdf", { type: "application/pdf" });
    Object.defineProperty(fileInput, "files", { value: [file], configurable: true });
    act(() => { fileInput.dispatchEvent(new Event("change", { bubbles: true })); });

    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
    const body = dialog.querySelector("textarea") as HTMLTextAreaElement;
    act(() => { setter.call(body, "These are the terms."); body.dispatchEvent(new Event("input", { bubbles: true })); });

    const save = [...dialog.querySelectorAll("button")].find((b) => b.textContent === "Review and send \u2192") as HTMLButtonElement;
    expect(save.disabled).toBe(false);
    await act(async () => { save.click(); });

    // No offer chosen, so NO commercial row is written — that is ruling 3, not an oversight.
    expect(harness.agreements.saveAgreement).not.toHaveBeenCalled();
    expect(harness.signings.uploadDocument).toHaveBeenCalledTimes(1);
    const sent = (harness.signings.createSigning as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(sent).toMatchObject({
      tenantId: "tenant-1", contactId: "c1", agreementId: null,
      documentTitle: "coaching", documentSource: "tenant_upload",
      documentBody: "These are the terms.", documentPath: "tenant-1/source/1-agreement.pdf",
    });
    // Straight into the send step rather than stopping at "saved".
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain("Send for signature");
  });

  it("issues a link only on a real acknowledgement, and says it is shown once", async () => {
    harness.agreements.clients = [{ id: "c1", name: "Acme" }];
    harness.agreements.agreements = [AGREEMENT];
    harness.signings.signings = [{ ...SIGNING, signatureState: "draft", displayState: "draft", sentAt: null, expiresAt: null }];
    render("terms");
    act(() => (host.querySelector('[aria-label="Agreements and terms"] button') as HTMLButtonElement).click());
    act(() => (buttonSaying("Send for signature") as HTMLButtonElement).click());
    const dialog = document.querySelector('[role="dialog"]')!;
    expect(dialog.textContent).toContain("Acme");
    expect(dialog.textContent).toContain("Coaching agreement");
    expect(dialog.textContent).toContain("$1,200");
    // RE-POINTED to the approved words (§28 screen 3). The §38 promise is not weakened — it is
    // stated more plainly, in the gold box the approved screen carries, and is still guarded here.
    expect(dialog.textContent).toContain("No money moves");
    expect(dialog.textContent).toContain("Nothing is charged, invoiced or collected at signature");
    // The approved primary act is the real SEND. Copying a link survives as a secondary route
    // (§58) and is now reached deliberately rather than being the only way through.
    const reveal = [...dialog.querySelectorAll("button")].find((b) => b.textContent === "Or copy a link to send yourself") as HTMLButtonElement;
    expect(reveal).toBeDefined();
    act(() => { reveal.click(); });
    const make = [...document.querySelector('[role="dialog"]')!.querySelectorAll("button")].find((b) => b.textContent === "Make the link") as HTMLButtonElement;
    await act(async () => { make.click(); });
    expect(harness.signings.issueLink).toHaveBeenCalledWith("s1", 14, "tenant-1");
    const after = document.querySelector('[role="dialog"]')!;
    expect((after.querySelector('input[aria-label="The signing link"]') as HTMLInputElement).value)
      .toContain("/sign/tok-abcdef");
    expect(after.textContent).toContain("This is the only time you will see it");
  });

  /* ── the approved act: a real send (§28 screen 3) ───────────────────────────────────────── */

  const openSender = () => {
    harness.agreements.clients = [{ id: "c1", name: "Acme Consulting" }];
    harness.agreements.agreements = [AGREEMENT];
    harness.signings.signings = [{ ...SIGNING, signatureState: "draft", displayState: "draft", sentAt: null, expiresAt: null }];
    render("terms");
    act(() => (host.querySelector('[aria-label="Agreements and terms"] button') as HTMLButtonElement).click());
    act(() => (buttonSaying("Send for signature") as HTMLButtonElement).click());
    return document.querySelector('[role="dialog"]')!;
  };

  it("commits on a real send, named for the person receiving it, and spends gold on it", async () => {
    const dialog = openSender();
    // The recap the approved screen carries — who, what, and the life of the link.
    expect(dialog.textContent).toContain("Acme Consulting");
    expect(dialog.textContent).toContain("Coaching agreement");
    expect(dialog.textContent).toContain("30 days after it is sent");

    const act1 = [...dialog.querySelectorAll("button")].find((b) => b.textContent === "Send it to Acme") as HTMLButtonElement;
    expect(act1).toBeDefined();
    // Gold is spent on exactly the acts that COMMIT (§11). This is one of them.
    expect(act1.className).toContain("btn-g");
    await act(async () => { act1.click(); });
    expect(harness.signings.sendForSignature).toHaveBeenCalledWith("s1", "tenant-1", false);
    expect(document.querySelector('[role="dialog"]')!.textContent).toContain("Sent.");
  });

  it("reports a refused send as a refusal, never as delivery (§13)", async () => {
    harness.signings.sendForSignature = vi.fn(async () => ({ ok: false, message: "No mail provider is configured, so nothing was sent." }));
    const dialog = openSender();
    const act1 = [...dialog.querySelectorAll("button")].find((b) => b.textContent === "Send it to Acme") as HTMLButtonElement;
    await act(async () => { act1.click(); });
    const after = document.querySelector('[role="dialog"]')!;
    expect(after.textContent).toContain("No mail provider is configured");
    expect(after.textContent).not.toContain("Sent.");
  });

  it("says plainly when an address did not receive it — a 200 is not a delivery", async () => {
    harness.signings.sendForSignature = vi.fn(async () => ({ ok: true, sent: [], notDelivered: ["bounced@example.com"] }));
    const dialog = openSender();
    const act1 = [...dialog.querySelectorAll("button")].find((b) => b.textContent === "Send it to Acme") as HTMLButtonElement;
    await act(async () => { act1.click(); });
    const after = document.querySelector('[role="dialog"]')!;
    expect(after.textContent).toContain("Nothing went out");
    expect(after.textContent).toContain("did not receive it");
  });

  it("refuses to claim a link when the server returned none (§13)", async () => {
    harness.agreements.clients = [{ id: "c1", name: "Acme" }];
    harness.agreements.agreements = [AGREEMENT];
    harness.signings.signings = [{ ...SIGNING, signatureState: "draft", displayState: "draft", sentAt: null, expiresAt: null }];
    harness.signings.issueLink = vi.fn(async () => ({ ok: false, message: "Documents are not available on this workspace yet, so nothing was recorded." }));
    render("terms");
    act(() => (host.querySelector('[aria-label="Agreements and terms"] button') as HTMLButtonElement).click());
    act(() => (buttonSaying("Send for signature") as HTMLButtonElement).click());
    // The copy-a-link route is secondary to the approved SEND now; reveal it, then drive it.
    act(() => ([...document.querySelectorAll('[role="dialog"] button')].find((b) => b.textContent === "Or copy a link to send yourself") as HTMLButtonElement).click());
    const make = [...document.querySelectorAll('[role="dialog"] button')].find((b) => b.textContent === "Make the link") as HTMLButtonElement;
    await act(async () => { make.click(); });
    const dialog = document.querySelector('[role="dialog"]')!;
    expect(dialog.querySelector('input[aria-label="The signing link"]')).toBeNull();
    expect(dialog.textContent).toContain("not available on this workspace yet");
  });

  it("offers no act on a document that is finished, and never a dead control (§70)", () => {
    harness.agreements.clients = [{ id: "c1", name: "Acme" }];
    harness.agreements.agreements = [AGREEMENT];
    harness.signings.signings = [{ ...SIGNING, signatureState: "completed", displayState: "completed", completedAt: "2026-09-23T09:00:00Z", signerName: "A Client", hasSealedCopy: true }];
    render("terms");
    act(() => (host.querySelector('[aria-label="Agreements and terms"] button') as HTMLButtonElement).click());
    expect(buttonSaying("Send for signature")).toBeUndefined();
    expect(buttonSaying("Manage the link")).toBeUndefined();
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain("A Client");
  });

  it("tells the truth about Paige drafting, and keeps the other two sources working (§70.1)", () => {
    harness.agreements.clients = [{ id: "c1", name: "Acme" }];
    render("terms");
    act(() => (buttonSaying("New agreement") as HTMLButtonElement).click());
    const dialog = document.querySelector('[role="dialog"]')!;
    const card = [...dialog.querySelectorAll(".so-src-card")]
      .find((b) => b.textContent?.includes("Paige drafts it")) as HTMLButtonElement;
    // Not a disabled "coming soon" control — it is operable and it explains itself.
    expect(card.hasAttribute("disabled")).toBe(false);
    act(() => card.click());
    const text = dialog.textContent ?? "";
    expect(text).toContain("Paige cannot draft a contract yet");
    expect(text).toContain("Upload a contract");
    expect(text).toContain("No document");
    expect(harness.signings.createSigning).not.toHaveBeenCalled();
  });
});

describe("No DocuSign vocabulary anywhere in the Sales document path", () => {
  const at = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
  it.each([
    "src/solo/sales-ops.tsx",
    "src/solo/useSoloAgreementSignings.ts",
    "src/solo/sales-ops.css",
  ])("keeps the banned product nouns out of %s", (path) => {
    const text = at(path).toLowerCase();
    for (const word of ["docusign", "envelope", "recipient", "anchor tag", "certificate of completion"]) {
      expect(text).not.toContain(word);
    }
  });
});
