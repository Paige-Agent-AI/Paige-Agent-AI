// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import source from "./fixtures/exp04-client-status-source.json";
import {
  AGREEMENT_TEXT,
  ATTENTION_DESTINATION,
  ATTENTION_TEXT,
  NOT_RECORDED_TEXT,
  PAYMENT_STATE_TEXT,
  standingRecordLinks,
} from "../../supabase/functions/_shared/client-engagement/labels";
import {
  composeClientEngagementStatus,
  type Attention,
  type ClientEngagementSource,
  type ClientEngagementStatus,
} from "../../supabase/functions/_shared/client-engagement/status";
import { READ_LINK_DESTINATIONS } from "../../supabase/functions/_shared/paige-turn/record-links";

// Experience 04 E4-S3 PR-0 — the client-engagement words live in ONE pure module, so the chat
// projection and (later) the client record say the same sentence and link to the same place.

const CLIENT = "e4000000-0000-4000-8000-0000000c0001";
const status = (mut?: (s: ClientEngagementSource) => void): ClientEngagementStatus => {
  const s = structuredClone(source) as ClientEngagementSource;
  mut?.(s);
  return composeClientEngagementStatus(s);
};

describe("labels.ts is the one home of the client-engagement words", () => {
  it("chat.ts imports the label maps and no longer declares its own", () => {
    const chat = readFileSync("supabase/functions/_shared/client-engagement/chat.ts", "utf8");
    expect(chat).toMatch(/from '\.\/labels\.ts'/);
    expect(chat).not.toMatch(/const (AGREEMENT|ATTENTION|PAYMENT_STATE)\s*:/);
  });

  it("labels.ts is pure: no Supabase, no Deno URL import", () => {
    const labels = readFileSync("supabase/functions/_shared/client-engagement/labels.ts", "utf8");
    expect(labels).not.toMatch(/supabase-js|https?:\/\/|Deno\./);
  });

  it("keeps today's sentences byte for byte", () => {
    expect(AGREEMENT_TEXT.none).toBe("no agreement has been sent");
    expect(ATTENTION_TEXT.business_time_zone_unset).toBe("The business time zone is not set, so due and overdue dates are on hold.");
    expect(ATTENTION_TEXT.payment_overdue).toBe("A payment is overdue.");
    expect(PAYMENT_STATE_TEXT.awaiting_confirmation).toBe("payment awaiting provider confirmation");
    expect(NOT_RECORDED_TEXT).toEqual({
      payment_disputes: "payment disputes",
      provider_refunds: "refunds made at your payment provider",
      terms_effective_transition: "when an agreement takes effect",
      installment_allocation: "which installment a payment paid",
    });
  });

  it("every attention key has a destination decision, and every destination is a read destination", () => {
    for (const key of Object.keys(ATTENTION_TEXT) as Attention[]) {
      expect(Object.prototype.hasOwnProperty.call(ATTENTION_DESTINATION, key), key).toBe(true);
      const d = ATTENTION_DESTINATION[key];
      if (d !== null) expect(READ_LINK_DESTINATIONS).toContain(d);
    }
    expect(ATTENTION_DESTINATION.business_time_zone_unset).toBe("business_time_zone");
    expect(ATTENTION_DESTINATION.agreement_not_signed).toBe("sales_agreements");
    expect(ATTENTION_DESTINATION.work_blocked).toBe("operations_work");
    expect(ATTENTION_DESTINATION.mixed_currency).toBeNull();
  });
});

describe("standingRecordLinks — which records a client-standing answer links to", () => {
  it("always the client, plus every record family the answer drew on", () => {
    const links = standingRecordLinks(status());
    expect(links[0]).toEqual({ destination: "contacts", record_id: CLIENT, subject: "Test Consulting Client" });
    const kinds = links.map((l) => l.destination);
    expect(kinds).toContain("sales_agreements");
    expect(kinds).toContain("sales_invoices");
    expect(kinds).toContain("operations_work");
    expect(links.length).toBeLessThanOrEqual(6);
    // References only — never an address.
    expect(JSON.stringify(links)).not.toMatch(/\/solo\/|https?:/);
  });

  it("links to the time zone setting while due dates are on hold", () => {
    const held = standingRecordLinks(status((s) => { s.business_time_zone = { state: "missing", zone: null }; }));
    expect(held.map((l) => l.destination)).toContain("business_time_zone");
  });

  it("an empty client links only to the client", () => {
    const empty = standingRecordLinks({
      ...status(),
      terms: null,
      agreement: { ...status().agreement, state: "none" },
      invoices: [],
      truncated: { terms: false, signings: false, invoices: false, work: false },
      work: { ...status().work, state: "none", total: 0 },
      time_zone: { state: "configured", zone: "America/New_York" },
    } as ClientEngagementStatus);
    expect(empty.map((l) => l.destination)).toEqual(["contacts"]);
  });
});
