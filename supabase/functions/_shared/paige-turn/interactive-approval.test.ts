import { assertEquals } from "https://deno.land/std@0.190.0/testing/asserts.ts";
import { selectPinnedPreviewRequest } from "./interactive-approval.ts";

Deno.test("INT-336 preview approval uses the canonical original validation request and exact stored authority", async () => {
  const command = { action: "deal.delete", deal_id: "deal-exact", expected_version: 4 };
  const card = { tool: "crm_delete_deal", fingerprint: "aaaaaaaaaaaaaaaa", command, idempotency_key: "exact-key" };
  const input = {
    tool: card.tool, fingerprint: card.fingerprint,
    storedArgs: { command: { action: command.action, preview_id: "00000000-0000-4000-8000-000000000001" }, idempotency_key: "exact-key", approval_subject: "deal-exact" },
    cards: [card], capabilities: { "deal.delete": card.tool }, subject: async (c: Record<string, unknown>) => String(c.deal_id),
  };
  assertEquals(await selectPinnedPreviewRequest(input), { command, idempotency_key: "exact-key" });
  for (const cards of [[], [card, card], [{ ...card, idempotency_key: "wrong" }],
    [{ ...card, command: { ...command, action: "deal.update" } }],
    [{ ...card, command: { ...command, deal_id: "another-deal" } }],
    [{ ...card, command: { ...command, preview_id: "00000000-0000-4000-8000-000000000002" } }]]) {
    assertEquals(await selectPinnedPreviewRequest({ ...input, cards }), null);
  }
  assertEquals(await selectPinnedPreviewRequest({ ...input, fingerprint: "bbbbbbbbbbbbbbbb" }), null);
});
