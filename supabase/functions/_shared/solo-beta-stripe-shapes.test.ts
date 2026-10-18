import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  readInvoiceSubscriptionId,
  readSubscriptionItemPeriod,
  safeStageCode,
} from "./solo-beta-stripe-shapes.ts";

Deno.test("reads Basil subscription periods from the subscription item", () => {
  assertEquals(readSubscriptionItemPeriod({
    current_period_start: 1_700_000_000,
    current_period_end: 1_702_592_000,
  }), {
    start: "2023-11-14T22:13:20.000Z",
    end: "2023-12-14T22:13:20.000Z",
  });
});

Deno.test("rejects missing or invalid subscription item periods", () => {
  assertEquals(readSubscriptionItemPeriod(null), null);
  assertEquals(readSubscriptionItemPeriod({ current_period_start: 10, current_period_end: 10 }), null);
  assertEquals(readSubscriptionItemPeriod({ current_period_start: 20, current_period_end: 10 }), null);
});

Deno.test("reads a Basil invoice subscription only from subscription_details", () => {
  assertEquals(readInvoiceSubscriptionId({
    parent: { type: "subscription_details", subscription_details: { subscription: "sub_test" } },
  }), "sub_test");
  assertEquals(readInvoiceSubscriptionId({
    parent: { type: "subscription_details", subscription_details: { subscription: { id: "sub_expanded" } } },
  }), "sub_expanded");
});

Deno.test("rejects invoices without a subscription parent", () => {
  assertEquals(readInvoiceSubscriptionId({ parent: { type: "quote_details" } }), null);
  assertEquals(readInvoiceSubscriptionId({}), null);
});

Deno.test("safeStageCode passes a Postgres raise name through verbatim", () => {
  assertEquals(
    safeStageCode("atomic_fulfillment_failed", new Error("solo_beta_provider_contract_mismatch")),
    "solo_beta_provider_contract_mismatch",
  );
  assertEquals(
    safeStageCode("event_claim_failed", new Error("solo_beta_checkout_fence_lost")),
    "solo_beta_checkout_fence_lost",
  );
});

Deno.test("safeStageCode falls back to the stage code for uninformative causes", () => {
  assertEquals(
    safeStageCode("atomic_fulfillment_failed", new Error("Failed to fetch")),
    "atomic_fulfillment_failed",
  );
  assertEquals(
    safeStageCode("atomic_fulfillment_failed", new Error("column x of relation y does not exist")),
    "atomic_fulfillment_failed",
  );
  assertEquals(safeStageCode("lifecycle_sync_failed", "not an error"), "lifecycle_sync_failed");
  assertEquals(safeStageCode("lifecycle_sync_failed", null), "lifecycle_sync_failed");
  assertEquals(
    safeStageCode("event_claim_failed", new Error("a".repeat(121))),
    "event_claim_failed",
  );
});
