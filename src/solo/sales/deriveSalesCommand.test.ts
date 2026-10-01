// The honest-derivation contract for Sales Command. Every assertion here defends a truth-boundary
// rule from the owner's build acceptance criteria (2026-09-05): recorded terms vs signed agreements,
// no summed "actual received", no fabricated contract linkage, no deal value, recurring never
// annualized, and honest emptiness under no data.
import { describe, it, expect } from "vitest";
import { deriveSalesCommand, paymentReady, type SalesCommandInput } from "./deriveSalesCommand";
import type { ClientAgreement } from "../useSoloCommercialTerms";
import type { PipelineDeal, PipelineStage } from "../useSoloCampaigns";

const NOW = new Date("2026-09-05T00:00:00Z");
const day = (n: number) => new Date(NOW.getTime() + n * 86_400_000).toISOString().slice(0, 10);

function agreement(over: Partial<ClientAgreement>): ClientAgreement {
  return {
    id: "a1", contactId: "c1", offerId: "o1", title: null, notes: null,
    termKind: "one_time", billingInterval: null, intervalCount: null, installmentsTotal: null,
    paymentSchedule: null, priceBasis: "catalog", agreedAmountMinor: null, agreedCurrency: "usd",
    catalogSnapshotMinor: null, catalogSnapshotCurrency: null, catalogSnapshotAt: null,
    startsOn: null, renewsOn: null, endsOn: null, status: "active", updatedAt: null, ...over,
  };
}
function stage(over: Partial<PipelineStage>): PipelineStage {
  return { id: "s1", pipelineId: "p1", label: "Stage", description: "", orderIndex: 0, archivedAt: null, movePolicy: "direct", stageType: "open", version: 1, ...over };
}
function deal(over: Partial<PipelineDeal>): PipelineDeal {
  return { id: "d1", title: "Deal", pipelineId: "p1", stageId: "s1", clientId: null, clientName: "Prospect Co", owner: "", status: "open", source: "", nextAction: "", tags: [], notes: "", createdAt: NOW.toISOString(), actualCloseDate: null, lostReason: null, outcomes: [], updatedAt: NOW.toISOString(), version: 1, history: [], ...over };
}
function base(over: Partial<SalesCommandInput> = {}): SalesCommandInput {
  return {
    agreements: [], clients: [], offers: [], referencedOffers: [], orders: [], ordersReadable: true,
    deals: [], stages: [], processor: "stripe", processorUnrecognised: false, ...over,
  };
}

describe("paymentReady", () => {
  it("is false for null, not_yet, and unrecognised; true for a declared processor", () => {
    expect(paymentReady(null, false)).toBe(false);
    expect(paymentReady("not_yet", false)).toBe(false);
    expect(paymentReady("stripe", true)).toBe(false);
    expect(paymentReady("stripe", false)).toBe(true);
    expect(paymentReady("manual", false)).toBe(true);
  });
});

describe("deriveSalesCommand — Commercial Pulse truth", () => {
  it("Actual received is ALWAYS unavailable and never a summed figure", () => {
    const m = deriveSalesCommand(base({
      orders: [{ id: "o", productId: null, customerName: "X", customerEmail: null, amountTotal: 500000, currency: "usd", status: "complete", createdAt: NOW.toISOString() }],
    }), NOW);
    const received = m.pulse.find((t) => t.key === "received")!;
    expect(received.amountMinor).toBeNull();
    expect(received.unavailable).toBe(true);
    expect(received.evidence).toBe("unknown");
    expect(received.sourceLabel).not.toMatch(/\$|500/);
  });

  it("Contracted sums active ONE-TIME terms and never annualizes recurring", () => {
    const m = deriveSalesCommand(base({
      agreements: [
        agreement({ id: "a1", termKind: "one_time", agreedAmountMinor: 1_200_000, status: "active" }),
        agreement({ id: "a2", termKind: "recurring", billingInterval: "month", intervalCount: 1, agreedAmountMinor: 250_000, status: "active" }),
        agreement({ id: "a3", termKind: "one_time", agreedAmountMinor: 999_999, status: "completed" }), // not active → excluded
      ],
    }), NOW);
    expect(m.facts.contractedOnceMinor).toBe(1_200_000);
    expect(m.facts.contractedMrrMinor).toBe(250_000); // monthly-equiv, NOT ×12
    const contracted = m.pulse.find((t) => t.key === "contracted")!;
    expect(contracted.amountMinor).toBe(1_200_000);
    expect(contracted.evidence).toBe("contracted");
    expect(contracted.sourceLabel).toBe("Recorded terms");
  });

  it("Contracted tile shows an em-dash (null), never a zero, for a pure-recurring retainer — a paid retainer must never read 'Free' (§13)", () => {
    const m = deriveSalesCommand(base({
      agreements: [agreement({ termKind: "recurring", billingInterval: "month", intervalCount: 1, agreedAmountMinor: 250_000, status: "active" })],
    }), NOW);
    expect(m.facts.contractedOnceMinor).toBe(0);
    expect(m.facts.contractedMrrMinor).toBe(250_000);
    const contracted = m.pulse.find((t) => t.key === "contracted")!;
    expect(contracted.amountMinor).toBeNull();   // NOT 0 — 0 would render money(0) === "Free"
    expect(contracted.unavailable).toBe(false);  // active terms DO exist; it is not "unavailable"
  });

  it("Contracted tile is an em-dash when active terms exist but none is summable (unreadable cadence) — never a zero/'Free'", () => {
    const m = deriveSalesCommand(base({
      // recurring with an unparseable cadence contributes to neither once nor mrr (see derive header)
      agreements: [agreement({ termKind: "recurring", billingInterval: null, intervalCount: null, agreedAmountMinor: 250_000, status: "active" })],
    }), NOW);
    expect(m.facts.contractedOnceMinor).toBe(0);
    expect(m.facts.contractedMrrMinor).toBe(0);
    const contracted = m.pulse.find((t) => t.key === "contracted")!;
    expect(contracted.amountMinor).toBeNull();   // NOT 0 → the surface renders "—", never "Free"
  });

  it("Open-work rows use Pill-compatible tones ('opportunity', never 'v') so emphasis is not silently dropped", () => {
    const m = deriveSalesCommand(base({
      clients: [{ id: "c1", name: "Jordan" }],
      agreements: [agreement({ id: "a1", contactId: "c1", status: "draft" })], // proposed
    }), NOW);
    const row = m.openWork.find((r) => r.id === "agr-a1")!;
    expect(row.stateLabel).toBe("Proposed");
    expect(row.stateTone).toBe("opportunity"); // Pill maps this to pill-v; "v" would fall to neutral
    expect(["ok", "warn", "bad", "opportunity", "n"]).toContain(row.stateTone);
  });

  it("Delivery starting counts starts AROUND now — a term begun long ago is not miscounted as 'starting'", () => {
    const m = deriveSalesCommand(base({
      agreements: [
        agreement({ id: "soon", status: "active", startsOn: day(7) }),   // starting soon → counts
        agreement({ id: "old", status: "active", startsOn: day(-120) }), // underway for months → not "starting"
      ],
    }), NOW);
    expect(m.pulse.find((t) => t.key === "delivery")!.count).toBe(1);
  });

  it("annualizes nothing — a yearly term reports 1/12 as monthly-equivalent", () => {
    const m = deriveSalesCommand(base({
      agreements: [agreement({ termKind: "recurring", billingInterval: "year", intervalCount: 1, agreedAmountMinor: 1_200_000, status: "active" })],
    }), NOW);
    expect(m.facts.contractedMrrMinor).toBe(100_000);
  });

  it("never sums across currencies", () => {
    const m = deriveSalesCommand(base({
      agreements: [
        agreement({ id: "a1", agreedAmountMinor: 100_000, agreedCurrency: "usd", status: "active" }),
        agreement({ id: "a2", agreedAmountMinor: 200_000, agreedCurrency: "usd", status: "active" }),
        agreement({ id: "a3", agreedAmountMinor: 999_999, agreedCurrency: "gbp", status: "active" }),
      ],
    }), NOW);
    expect(m.facts.contractedCurrency).toBe("usd"); // the majority currency
    expect(m.facts.contractedOnceMinor).toBe(300_000); // gbp NOT added
    expect(m.facts.mixedCurrency).toBe(true);
  });

  it("Open opportunities counts only OPEN-stage deals, and shows no deal value", () => {
    const m = deriveSalesCommand(base({
      stages: [stage({ id: "open1", stageType: "open", orderIndex: 0 }), stage({ id: "won1", stageType: "won", orderIndex: 1 })],
      deals: [deal({ id: "d1", stageId: "open1" }), deal({ id: "d2", stageId: "open1" }), deal({ id: "d3", stageId: "won1" })],
    }), NOW);
    const open = m.pulse.find((t) => t.key === "open")!;
    expect(open.count).toBe(2);
    expect(open.amountMinor).toBeNull(); // deals carry no value, ever
    expect(m.facts.openDealCount).toBe(2);
  });

  it("Renewals soon counts dated renew/end within 60 days; delivery within 14", () => {
    const m = deriveSalesCommand(base({
      agreements: [
        agreement({ id: "r1", status: "active", renewsOn: day(30) }),
        agreement({ id: "r2", status: "active", endsOn: day(120) }), // outside window
        agreement({ id: "s1", status: "active", startsOn: day(7) }), // delivery starting
        agreement({ id: "s2", status: "active", startsOn: day(90) }), // terms agreed, not starting
      ],
    }), NOW);
    expect(m.pulse.find((t) => t.key === "renewals")!.count).toBe(1);
    expect(m.pulse.find((t) => t.key === "renewals")!.evidence).toBe("dated");
    expect(m.pulse.find((t) => t.key === "delivery")!.count).toBe(1);
  });
});

describe("deriveSalesCommand — Readiness Ladder truth", () => {
  it("Contract pending is ALWAYS unavailable with no items (no contracts backend)", () => {
    const m = deriveSalesCommand(base({ agreements: [agreement({ status: "active" })] }), NOW);
    const contractPending = m.ladder.find((c) => c.n === 4)!;
    expect(contractPending.status).toBe("unavailable");
    expect(contractPending.items).toHaveLength(0);
    expect(contractPending.sourceLabel).toBe("No source");
  });

  it("Payment path is tenant-level and flags affected active terms when not ready", () => {
    const notReady = deriveSalesCommand(base({ processor: "not_yet", agreements: [agreement({ status: "active" }), agreement({ id: "a2", status: "active" })] }), NOW);
    const col = notReady.ladder.find((c) => c.n === 5)!;
    expect(col.status).toBe("part");
    expect(col.tenantLevel).toEqual({ ready: false, affectedCount: 2 });

    const ready = deriveSalesCommand(base({ processor: "stripe", agreements: [agreement({ status: "active" })] }), NOW);
    expect(ready.ladder.find((c) => c.n === 5)!.tenantLevel).toEqual({ ready: true, affectedCount: 0 });
  });

  it("splits open deals into Offer selected (earliest open stage) vs Qualified (later)", () => {
    const m = deriveSalesCommand(base({
      stages: [stage({ id: "early", orderIndex: 0, stageType: "open" }), stage({ id: "late", orderIndex: 1, stageType: "open" })],
      deals: [deal({ id: "d1", stageId: "early", clientName: "Early Co" }), deal({ id: "d2", stageId: "late", clientName: "Late Co" })],
    }), NOW);
    expect(m.ladder.find((c) => c.n === 1)!.items.map((i) => i.client)).toEqual(["Early Co"]);
    expect(m.ladder.find((c) => c.n === 2)!.items.map((i) => i.client)).toEqual(["Late Co"]);
  });

  it("no ladder item ever carries a monetary amount", () => {
    const m = deriveSalesCommand(base({
      agreements: [agreement({ status: "active", agreedAmountMinor: 500000, startsOn: day(2) })],
      stages: [stage({ id: "open1", stageType: "open" })],
      deals: [deal({ stageId: "open1" })],
    }), NOW);
    for (const col of m.ladder) for (const item of col.items) {
      expect(item).not.toHaveProperty("amountMinor");
    }
  });
});

describe("deriveSalesCommand — Moves and Open Work", () => {
  it("surfaces a payment-path move when a processor is not ready and active terms exist", () => {
    const m = deriveSalesCommand(base({ processor: null, agreements: [agreement({ status: "active" })] }), NOW);
    const move = m.moves.find((x) => x.id === "confirm-payment");
    expect(move).toBeTruthy();
    expect(move!.target).toEqual({ kind: "payment" });
    expect(m.moves[0].id).toBe("confirm-payment"); // highest priority, ranked first
  });

  it("ranks a payment-path-missing active term to the top of Open Work", () => {
    const m = deriveSalesCommand(base({
      processor: "not_yet",
      agreements: [agreement({ id: "a1", status: "active" }), agreement({ id: "a2", status: "completed" })],
      clients: [{ id: "c1", name: "Acme Co" }],
    }), NOW);
    expect(m.openWork[0].stateLabel).toBe("Payment path missing");
    expect(m.openWork[0].client).toBe("Acme Co");
    // completed agreement is not open work
    expect(m.openWork.some((r) => r.id === "agr-a2")).toBe(false);
  });
});

describe("deriveSalesCommand — empty and honest", () => {
  it("produces a full, non-crashing model with no data and marks tiles unavailable", () => {
    const m = deriveSalesCommand(base(), NOW);
    expect(m.pulse).toHaveLength(5);
    expect(m.ladder).toHaveLength(6);
    expect(m.pulse.find((t) => t.key === "contracted")!.unavailable).toBe(true);
    expect(m.pulse.find((t) => t.key === "open")!.unavailable).toBe(true); // no open stage
    expect(m.moves).toHaveLength(0);
    expect(m.openWork).toHaveLength(0);
  });
});
