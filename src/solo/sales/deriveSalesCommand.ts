// Sales Command Desk — the honest derivation (Campaigns → Sales).
//
// WHAT THIS IS. A PURE function that turns the four commercial reads a Solo workspace already has
// — recorded terms (`tenant_client_agreements`), recorded payments (`tenant_orders`), open pipeline
// deals, and the declared payment handling — into the Sales Command view-model: the Commercial
// Pulse, the Commercial Readiness Ladder, the Top Commercial Moves, and the Open Commercial Work.
//
// WHY IT IS PURE AND SEPARATE. Every figure on Sales Command is a claim about money or commitment,
// so every figure has to be traceable to a real record (§13/§38). Keeping the derivation out of the
// component makes each rule inspectable and unit-testable against fixtures, and makes it impossible
// for a figure to appear on the surface without a rule here that produced it from a real field.
//
// THE TRUTH BOUNDARY, ENCODED (owner build acceptance criteria, 2026-09-05):
//   - "Contracted" is the sum of RECORDED ACTIVE terms — never signed legal agreements. Recurring is
//     reported as a monthly-equivalent, NOT annualized into a single contracted figure it does not
//     prove.
//   - "Actual received" is NOT derived here at all. There is no connected payment source and
//     `tenant_orders` is never summed into revenue; the surface renders it unavailable.
//   - "Contract pending" and any deal↔term linkage are UNAVAILABLE — there is no contracts/Vault
//     foundation and no `deal_id` on an agreement. The ladder says so rather than fabricating a link.
//   - A pipeline deal carries NO monetary value (the mapped `PipelineDeal` has no amount), so no deal
//     value is ever shown.
//   - Deals and terms are NOT linked. The ladder is therefore a READINESS OVERVIEW drawn from three
//     independent record sources, not one opportunity threaded across six stages. The header copy
//     says this; the derivation never pretends a col-1 deal "becomes" a col-3 term.

import type { ClientAgreement, AgreementClient } from "../useSoloCommercialTerms";
import type { CommercialEvent, DeclaredProcessor } from "../useSoloSalesOps";
import type { CatalogOffer } from "../useCatalogOffers";
import type { PipelineDeal, PipelineStage } from "../useSoloCampaigns";

/** Where a Top Move or an Open-Work row points. Every one resolves to a real surface — no dead ends. */
export type SalesTarget =
  | { readonly kind: "view"; readonly view: "terms" | "revenue" | "command" | "scenarios" }
  | { readonly kind: "catalog" }
  | { readonly kind: "pipeline" }
  | { readonly kind: "clients" }
  | { readonly kind: "paige"; readonly prompt: string }
  | { readonly kind: "payment" };

export type EvidenceClass = "actual" | "contracted" | "dated" | "open" | "modeled" | "unknown";

export type PulseTile = {
  readonly key: "received" | "contracted" | "open" | "renewals" | "delivery";
  readonly label: string;
  /** Null renders as an em-dash. A figure is only ever a real count/sum or an honest absence. */
  readonly amountMinor: number | null;
  readonly currency: string | null;
  /** A non-money headline (e.g. "3 deals"). When set, it is shown instead of a formatted amount. */
  readonly count: number | null;
  readonly unit: string | null;
  readonly evidence: EvidenceClass;
  readonly sourceLabel: string;
  readonly sub: string;
  /** True when this tile has no real source in the current data (renders as em-dash + reason). */
  readonly unavailable: boolean;
};

export type LadderItem = {
  readonly id: string;
  readonly client: string;
  readonly offer: string | null;
  readonly flag: { readonly label: string; readonly tone: "ok" | "warn" | "bad" | "v" } | null;
  readonly target: SalesTarget;
};

export type LadderColumn = {
  readonly n: number;
  readonly name: string;
  readonly sub: string;
  /** live = real records back it · part = partial/tenant-level · unavailable = no backend yet. */
  readonly status: "live" | "part" | "unavailable";
  readonly sourceLabel: string;
  readonly items: readonly LadderItem[];
  /** Set only for the tenant-level Payment-path column, which is not a stack of deal cards. */
  readonly tenantLevel?: { readonly ready: boolean; readonly affectedCount: number };
  /** Shown when the column is honestly empty or unavailable. */
  readonly emptyNote: string;
};

export type CommercialMove = {
  readonly id: string;
  readonly icon: string;
  readonly title: string;
  readonly detail: string;
  readonly who: string;
  readonly sourceLabel: string;
  readonly target: SalesTarget;
  /** Higher first. Only used to order; never shown. */
  readonly priority: number;
};

export type OpenWorkRow = {
  readonly id: string;
  readonly client: string;
  readonly initials: string;
  readonly offer: string | null;
  readonly stateTone: "ok" | "warn" | "bad" | "opportunity" | "n";
  readonly stateLabel: string;
  readonly nextAction: string;
  readonly target: SalesTarget;
  readonly priority: number;
};

export type SalesCommandModel = {
  readonly pulse: readonly PulseTile[];
  readonly ladder: readonly LadderColumn[];
  readonly moves: readonly CommercialMove[];
  readonly openWork: readonly OpenWorkRow[];
  /** Small honest facts the surface can print without re-deriving them. */
  readonly facts: {
    readonly activeTermCount: number;
    readonly proposedTermCount: number;
    readonly openDealCount: number;
    readonly renewalsSoonCount: number;
    readonly paymentReady: boolean;
    readonly contractedOnceMinor: number;
    readonly contractedMrrMinor: number;
    readonly contractedCurrency: string | null;
    readonly mixedCurrency: boolean;
  };
};

export type SalesCommandInput = {
  readonly agreements: readonly ClientAgreement[];
  readonly clients: readonly AgreementClient[];
  readonly offers: readonly CatalogOffer[];
  readonly referencedOffers?: readonly CatalogOffer[];
  readonly orders: readonly CommercialEvent[];
  readonly ordersReadable: boolean;
  readonly deals: readonly PipelineDeal[];
  readonly stages: readonly PipelineStage[];
  readonly processor: DeclaredProcessor | null;
  readonly processorUnrecognised: boolean;
};

const DAY = 86_400_000;
const RENEWAL_WINDOW_DAYS = 60;
const DELIVERY_WINDOW_DAYS = 14;

/** A payment path is "ready" only when the workspace has DECLARED a real handling. `not_yet` and a
 *  never-answered column are both "not ready" — a declaration is not a connected processor, but it is
 *  the honest precondition for saying money can reach the owner. `unrecognised` is not ready either. */
export function paymentReady(processor: DeclaredProcessor | null, unrecognised: boolean): boolean {
  return !unrecognised && processor !== null && processor !== "not_yet";
}

/** Whole months a period spans, so a per-period amount can be reported as a monthly equivalent.
 *  Never annualized into a "contracted" figure — see the file header. */
function periodMonths(interval: string | null, intervalCount: number | null): number | null {
  const per = intervalCount && intervalCount > 0 ? intervalCount : 1;
  switch (interval) {
    case "month": return per;
    case "year": return per * 12;
    case "week": return per * (12 / 52);
    case "day": return per * (12 / 365);
    default: return null; // one_time or unknown → not a recurring cadence
  }
}

function toTime(value: string | null): number | null {
  if (!value) return null;
  const t = Date.parse(value);
  return Number.isNaN(t) ? null : t;
}

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "—";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/** The active-status set that carries a real commitment. `draft` is a recorded PROPOSAL (not yet
 *  agreed) and is treated separately; completed/cancelled/unrecognised are not live commitments. */
function isActive(a: ClientAgreement): boolean { return a.status === "active"; }
function isProposed(a: ClientAgreement): boolean { return a.status === "draft"; }

export function deriveSalesCommand(input: SalesCommandInput, now: Date = new Date()): SalesCommandModel {
  const nowT = now.getTime();
  const clientName = new Map(input.clients.map((c) => [c.id, c.name] as const));
  const offerName = new Map(
    [...input.offers, ...(input.referencedOffers ?? [])].map((o) => [o.id, o.name] as const),
  );
  const nameFor = (id: string) => clientName.get(id) ?? "A client";
  const offerFor = (id: string) => offerName.get(id) ?? null;

  const active = input.agreements.filter(isActive);
  const proposed = input.agreements.filter(isProposed);

  // ---- Contracted value (RECORDED ACTIVE terms only; recurring as monthly-equivalent) ----------
  const currencyTally = new Map<string, number>();
  for (const a of active) {
    const c = (a.agreedCurrency ?? "usd").toLowerCase();
    currencyTally.set(c, (currencyTally.get(c) ?? 0) + 1);
  }
  let contractedCurrency: string | null = null;
  let topCount = -1;
  for (const [c, n] of currencyTally) if (n > topCount) { topCount = n; contractedCurrency = c; }
  const mixedCurrency = currencyTally.size > 1;

  let contractedOnceMinor = 0;
  let contractedMrrMinor = 0;
  for (const a of active) {
    const cur = (a.agreedCurrency ?? "usd").toLowerCase();
    if (contractedCurrency && cur !== contractedCurrency) continue; // never sum across currencies
    if (a.agreedAmountMinor == null) continue;
    const months = a.termKind === "recurring" ? periodMonths(a.billingInterval, a.intervalCount) : null;
    if (months && months > 0) contractedMrrMinor += Math.round(a.agreedAmountMinor / months);
    else if (a.termKind !== "recurring") contractedOnceMinor += a.agreedAmountMinor;
    // A recurring term with an unreadable cadence contributes to NEITHER — it cannot be summed
    // honestly, and is surfaced as an item needing attention rather than folded into a figure.
  }

  // ---- Open opportunities (open-stage deals; deals carry no value, so this is a COUNT) ----------
  const stageById = new Map(input.stages.map((s) => [s.id, s] as const));
  const openStages = input.stages
    .filter((s) => s.stageType === "open" && !s.archivedAt)
    .sort((a, b) => a.orderIndex - b.orderIndex);
  const firstOpenOrder = openStages.length ? openStages[0].orderIndex : null;
  const openDeals = input.deals.filter((d) => {
    const s = stageById.get(d.stageId);
    return s ? s.stageType === "open" && !s.archivedAt : false;
  });

  // ---- Renewals soon / delivery starting (real dated reads on active terms) --------------------
  const renewalsSoon = active.filter((a) => {
    const t = toTime(a.renewsOn) ?? toTime(a.endsOn);
    return t != null && t >= nowT && t <= nowT + RENEWAL_WINDOW_DAYS * DAY;
  });
  // "Delivery starting" means starting AROUND NOW — within the window on either side — so a term
  // that began months ago (long since underway) is not miscounted as "starting". The col-6 flags
  // read the same window: just-started terms show "Underway", upcoming ones "Ready for onboarding".
  const deliveryStarting = active.filter((a) => {
    const t = toTime(a.startsOn);
    return t != null && t >= nowT - DELIVERY_WINDOW_DAYS * DAY && t <= nowT + DELIVERY_WINDOW_DAYS * DAY;
  });
  // "Terms agreed" carries active terms not yet delivering + proposed terms (flagged).
  const termsAgreed = [
    ...proposed,
    ...active.filter((a) => {
      const t = toTime(a.startsOn);
      return t == null || t > nowT + DELIVERY_WINDOW_DAYS * DAY;
    }),
  ];

  const ready = paymentReady(input.processor, input.processorUnrecognised);

  // ============================ PULSE ============================
  const pulse: PulseTile[] = [
    {
      key: "received", label: "Actual received", amountMinor: null, currency: null, count: null, unit: null,
      evidence: "unknown", unavailable: true,
      sourceLabel: ready ? "Declared handling · no processor connected" : "None",
      sub: ready ? "No verified receipts summed" : "Payment source needed",
    },
    {
      key: "contracted", label: "Contracted",
      // Only ever a POSITIVE one-time sum, else an em-dash. Zero is never shown as a figure —
      // `money(0)` renders the word "Free", which would mislabel a paid retainer whose value is
      // purely recurring (once-sum 0) or whose active terms have no summable amount yet.
      amountMinor: contractedOnceMinor > 0 ? contractedOnceMinor : null,
      currency: contractedCurrency, count: null, unit: null,
      evidence: active.length ? "contracted" : "unknown",
      unavailable: active.length === 0,
      sourceLabel: "Recorded terms",
      sub: active.length
        ? (contractedMrrMinor > 0 ? "Active terms · recurring shown monthly" : "On active terms")
        : "No active terms recorded",
    },
    {
      key: "open", label: "Open opportunities", amountMinor: null, currency: null,
      count: openDeals.length, unit: openDeals.length === 1 ? "deal" : "deals",
      evidence: openStages.length ? "open" : "unknown",
      unavailable: openStages.length === 0,
      sourceLabel: "Pipeline",
      sub: openStages.length ? "Undecided in the pipeline" : "No open pipeline stage",
    },
    {
      key: "renewals", label: "Renewals soon", amountMinor: null, currency: null,
      count: renewalsSoon.length, unit: null,
      evidence: "dated", unavailable: false,
      sourceLabel: "Renewal dates on terms",
      sub: `Next ${RENEWAL_WINDOW_DAYS} days`,
    },
    {
      key: "delivery", label: "Delivery starting", amountMinor: null, currency: null,
      count: deliveryStarting.length, unit: null,
      evidence: "dated", unavailable: false,
      sourceLabel: "Start dates on terms",
      sub: "Term start dates",
    },
  ];

  // ============================ LADDER ============================
  const offerLabelForDeal = (): string | null => null; // deals carry no offer link — never invented
  const dealItem = (d: PipelineDeal): LadderItem => ({
    id: `deal-${d.id}`, client: d.clientName || "A prospect", offer: offerLabelForDeal(),
    flag: null, target: { kind: "pipeline" },
  });
  const termItem = (a: ClientAgreement, flag: LadderItem["flag"]): LadderItem => ({
    id: `term-${a.id}`, client: nameFor(a.contactId), offer: offerFor(a.offerId), flag,
    target: { kind: "view", view: "terms" },
  });

  const col1 = openDeals.filter((d) => {
    const s = stageById.get(d.stageId);
    return s && firstOpenOrder != null && s.orderIndex === firstOpenOrder;
  });
  const col2 = openDeals.filter((d) => {
    const s = stageById.get(d.stageId);
    return s && firstOpenOrder != null && s.orderIndex > firstOpenOrder;
  });

  const ladder: LadderColumn[] = [
    {
      n: 1, name: "Offer selected", sub: "In the pipeline", status: "live", sourceLabel: "Pipeline",
      items: col1.map(dealItem), emptyNote: "Nothing here yet",
    },
    {
      n: 2, name: "Qualified", sub: "Later pipeline stage", status: "live", sourceLabel: "Pipeline stage order",
      items: col2.map(dealItem), emptyNote: "Nothing here yet",
    },
    {
      n: 3, name: "Terms agreed", sub: "Amount & cadence set", status: "live", sourceLabel: "Recorded terms",
      items: termsAgreed.map((a) => termItem(a, isProposed(a) ? { label: "Proposed", tone: "v" } : null)),
      emptyNote: "No agreed terms yet",
    },
    {
      n: 4, name: "Contract pending", sub: "Awaiting a record", status: "unavailable",
      sourceLabel: "No source", items: [],
      emptyNote: "Contract records have no live backend yet.",
    },
    {
      n: 5, name: "Payment path", sub: "Ready to be paid", status: ready ? "live" : "part",
      sourceLabel: "Declared handling",
      tenantLevel: { ready, affectedCount: ready ? 0 : active.length },
      items: [],
      emptyNote: ready
        ? "Payments reach you directly."
        : "Record how clients pay you so terms can be collected.",
    },
    {
      n: 6, name: "Delivery starts", sub: "Work can begin", status: "live", sourceLabel: "Start dates",
      items: deliveryStarting.map((a) => {
        const t = toTime(a.startsOn);
        const past = t != null && t <= nowT;
        return termItem(a, { label: past ? "Underway" : "Ready for onboarding", tone: "ok" });
      }),
      emptyNote: "No terms starting soon",
    },
  ];

  // ============================ MOVES ============================
  const moves: CommercialMove[] = [];
  if (!ready && active.length > 0) {
    moves.push({
      id: "confirm-payment", icon: "card", title: "Confirm payment path",
      detail: `${active.length} active term${active.length === 1 ? "" : "s"} can't be collected until you record how clients pay you.`,
      who: "Paige · propose", sourceLabel: "Declared handling", priority: 100,
      target: { kind: "payment" },
    });
  }
  for (const a of proposed.slice(0, 3)) {
    moves.push({
      id: `confirm-terms-${a.id}`, icon: "doc", title: "Confirm proposed terms",
      detail: `${nameFor(a.contactId)} — ${offerFor(a.offerId) ?? "an offer"} is recorded as proposed, not yet agreed.`,
      who: "Paige · propose", sourceLabel: "Recorded terms", priority: 80,
      target: { kind: "view", view: "terms" },
    });
  }
  for (const a of renewalsSoon.slice(0, 2)) {
    moves.push({
      id: `renewal-${a.id}`, icon: "refresh", title: "Prepare renewal conversation",
      detail: `${nameFor(a.contactId)} renews ${a.renewsOn ?? a.endsOn ?? "soon"} — review value delivered.`,
      who: "Paige · draft", sourceLabel: "Renewal dates", priority: 70,
      target: { kind: "view", view: "revenue" },
    });
  }
  for (const a of active.filter((x) => toTime(x.startsOn) == null).slice(0, 2)) {
    moves.push({
      id: `start-${a.id}`, icon: "doc", title: "Set a start date",
      detail: `${nameFor(a.contactId)} — terms agreed with no start date recorded.`,
      who: "Paige · propose", sourceLabel: "Recorded terms", priority: 60,
      target: { kind: "view", view: "terms" },
    });
  }
  const rankedMoves = [...moves].sort((a, b) => b.priority - a.priority).slice(0, 5);

  // ============================ OPEN WORK ============================
  const rows: OpenWorkRow[] = [];
  for (const a of input.agreements) {
    if (a.status === "completed" || a.status === "cancelled") continue;
    const client = nameFor(a.contactId);
    let tone: OpenWorkRow["stateTone"] = "ok";
    let label = "Terms agreed";
    let next = "Review terms";
    let priority = 40;
    if (a.status === "draft") { tone = "opportunity"; label = "Proposed"; next = "Confirm with the client"; priority = 75; }
    else if (a.status === "paused") { tone = "warn"; label = "Paused"; next = "Resume when ready"; priority = 50; }
    else if (a.status === "active" && !ready) { tone = "bad"; label = "Payment path missing"; next = "Record how they pay you"; priority = 90; }
    else if (a.status === "active" && toTime(a.startsOn) == null) { tone = "warn"; label = "No start date"; next = "Set a start date"; priority = 65; }
    else if (renewalsSoon.some((r) => r.id === a.id)) { tone = "opportunity"; label = "Renewal due"; next = "Prepare renewal conversation"; priority = 70; }
    rows.push({
      id: `agr-${a.id}`, client, initials: initialsOf(client), offer: offerFor(a.offerId),
      stateTone: tone, stateLabel: label, nextAction: next, priority,
      target: { kind: "view", view: "terms" },
    });
  }
  for (const d of openDeals) {
    // A deal with no recorded terms for this client is genuine open work. We cannot link deal→term,
    // so we only add a deal row when no agreement names the same client, to avoid double-listing.
    const hasTerm = input.agreements.some((a) => nameFor(a.contactId) === (d.clientName || ""));
    if (hasTerm) continue;
    const client = d.clientName || "A prospect";
    rows.push({
      id: `deal-${d.id}`, client, initials: initialsOf(client), offer: null,
      stateTone: "n", stateLabel: "In pipeline", nextAction: d.nextAction || "Qualify stakeholders",
      priority: 30, target: { kind: "pipeline" },
    });
  }
  const openWork = [...rows].sort((a, b) => b.priority - a.priority).slice(0, 8);

  return {
    pulse, ladder, moves: rankedMoves, openWork,
    facts: {
      activeTermCount: active.length,
      proposedTermCount: proposed.length,
      openDealCount: openDeals.length,
      renewalsSoonCount: renewalsSoon.length,
      paymentReady: ready,
      contractedOnceMinor,
      contractedMrrMinor,
      contractedCurrency,
      mixedCurrency,
    },
  };
}
