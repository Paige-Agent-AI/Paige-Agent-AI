import { expect, it } from "vitest";
import { parseInvoicePage } from "./useClientPortalInvoices";
import { readCustomerPaymentRequest } from "@/solo/sales/customerPaymentRequest";
import captured from "./fixtures/client-portal-invoices.local-db.json";

// §37 consumer check: the payloads the Slice 5 SQL actually returns (captured from the local database with
// the pgTAP fixtures) parse through the exact-key readers this page uses. If the server's shape drifts, this
// fails here instead of the customer seeing "We couldn't load your invoices".
it("parses the real list and paged list the server returns", () => {
  const all = parseInvoicePage(captured.list)!;
  expect(all.invoices.length).toBe(captured.list.invoices.length);
  expect(all.open_count).toBe(captured.list.open_count);
  expect(all.has_more).toBe(false);
  const first = parseInvoicePage(captured.page1)!;
  expect(first.invoices).toHaveLength(1);
  expect(first.has_more).toBe(true);
  expect(first.next_cursor).toEqual(captured.page1.next_cursor);
});

it("reads the real payment request through the one existing parser", () => {
  const request = readCustomerPaymentRequest(captured.request, Date.parse(captured.list.read_at));
  expect(request?.url).toBe(captured.request.payment_request.provider_url);
  expect(request?.remainingMinor).toBe(captured.request.remaining_cents);
});
