// E09 CURA round 2 (compliance #1): the bulk opt-out footer said "your Paige Agent AI updates" on a business's
// mail to its own client. A customer reads the business; the platform's own mail keeps the platform line.
import { assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { footerLine } from "./email-footer-line.ts";

Deno.test("a business's mail to its client names the business, never the platform's COO", () => {
  assertEquals(footerLine("Northwind Studio"), "You're receiving this as part of your updates from Northwind Studio.");
  assertEquals(/paige/i.test(footerLine("Northwind Studio")), false);
});
Deno.test("a customer-bound template with no business name still names nobody else", () => {
  assertEquals(footerLine(null), "You're receiving this because these updates are on for your email.");
  assertEquals(footerLine("   "), "You're receiving this because these updates are on for your email.");
});
Deno.test("the platform's own mail keeps the platform line", () => {
  assertStringIncludes(footerLine(), "Paige Agent AI");
});
