// #1140 two-mailbox pilot — the organize command contract: reversible by
// construction, approval-gated for every Gmail-side write, unsubscribe only to
// the address the message itself recorded. Deno-native (the ci.yml deno test step).
import { assertThrows } from "https://deno.land/std@0.190.0/testing/asserts.ts";
import { assertEquals } from "https://deno.land/std@0.190.0/testing/asserts.ts";
import { organizeRequiresApproval, organizeIsReversible, parseOrganizeCommand, undoKindFor, UNSUBSCRIBE_HTTPS_RE, unsubscribeHttpsTarget } from "./organize.ts";

const M = "60000000-0000-4000-8000-000000000001";

Deno.test("organize parse: parses each reversible kind", () => {
  assertEquals(parseOrganizeCommand({ kind: "label", message_id: M, label: "needs-reply" }), { kind: "label", message_id: M, label: "needs-reply" });
  assertEquals(parseOrganizeCommand({ kind: "archive", message_id: M }), { kind: "archive", message_id: M });
  assertEquals(parseOrganizeCommand({ kind: "unarchive", message_id: M }), { kind: "unarchive", message_id: M });
  assertEquals(parseOrganizeCommand({ kind: "trash", message_id: M }), { kind: "trash", message_id: M });
  assertEquals(parseOrganizeCommand({ kind: "untrash", message_id: M }), { kind: "untrash", message_id: M });
});

Deno.test("organize parse: refuses unknown kinds, extra keys, bad ids, bad labels", () => {
  assertThrows(() => parseOrganizeCommand({ kind: "delete", message_id: M }), TypeError, "MAILBOX_COMMAND_INVALID");
  assertThrows(() => parseOrganizeCommand({ kind: "archive", message_id: M, permanent: true }), TypeError, "MAILBOX_COMMAND_INVALID");
  assertThrows(() => parseOrganizeCommand({ kind: "archive", message_id: "not-a-uuid" }), TypeError, "MAILBOX_COMMAND_INVALID");
  assertThrows(() => parseOrganizeCommand({ kind: "label", message_id: M, label: "Bad Label!" }), TypeError, "MAILBOX_COMMAND_INVALID");
  assertThrows(() => parseOrganizeCommand({ kind: "label", message_id: M }), TypeError, "MAILBOX_COMMAND_INVALID");
});

Deno.test("organize: the MAILBOX kinds are reversible with exact undos; approval is required for every kind", () => {
  assertEquals(undoKindFor("archive"), "unarchive");
  assertEquals(undoKindFor("unarchive"), "archive");
  assertEquals(undoKindFor("trash"), "untrash");
  assertEquals(undoKindFor("untrash"), "trash");
  assertEquals(undoKindFor("label"), "unlabel");
  assertEquals(undoKindFor("unlabel"), "label");
  for (const kind of ["label", "unlabel", "archive", "unarchive", "trash", "untrash"] as const) {
    assertEquals(organizeIsReversible(kind), true);
  }
  for (const kind of ["label", "unlabel", "archive", "unarchive", "trash", "untrash", "unsubscribe_propose", "unsubscribe_send"] as const) {
    assertEquals(organizeRequiresApproval(kind), true);
  }
});

Deno.test("unsubscribe: accepts only https one-click targets, refusing http/mailto/javascript/userinfo/oversize", () => {
  assertEquals(unsubscribeHttpsTarget("https://localhost/u"), null);
  assertEquals(unsubscribeHttpsTarget("https://127.0.0.1/u"), null);
  assertEquals(unsubscribeHttpsTarget("https://192.168.1.5/u"), null);
  assertEquals(unsubscribeHttpsTarget("https://172.16.9.9/u"), null);
  assertEquals(unsubscribeHttpsTarget("https://172.20.0.5/u"), null);
  assertEquals(unsubscribeHttpsTarget("https://172.29.1.1/u"), null);
  assertEquals(unsubscribeHttpsTarget("https://169.254.1.1/u"), null);
  assertEquals(UNSUBSCRIBE_HTTPS_RE.test("https://news.vendor.test/u/abc"), true);
  assertEquals(UNSUBSCRIBE_HTTPS_RE.test("http://news.vendor.test/u/abc"), false);
  assertEquals(UNSUBSCRIBE_HTTPS_RE.test("mailto:unsub@vendor.test"), false);
  assertEquals(UNSUBSCRIBE_HTTPS_RE.test("javascript:alert(1)"), false);
  assertEquals(UNSUBSCRIBE_HTTPS_RE.test("https://user:pass@evil.test/u"), false);
  assertEquals(unsubscribeHttpsTarget("https://evil.test/u?x=" + "a".repeat(2500)), null);
});

// ── Owner addendum 6088460092: truthful unsubscribe semantics ──────────────────
// Failing-first: written against the pre-correction organize.ts (which claims
// every kind reversible and falls through to "unlabel" for the unsubscribe kinds).

Deno.test("unsubscribe kinds are NOT reversible (a delivered one-click request has no inverse)", () => {
  assertEquals(organizeIsReversible("label"), true);
  assertEquals(organizeIsReversible("archive"), true);
  assertEquals(organizeIsReversible("trash"), true);
  assertEquals(organizeIsReversible("unlabel"), true);
  assertEquals(organizeIsReversible("unarchive"), true);
  assertEquals(organizeIsReversible("untrash"), true);
  assertEquals(organizeIsReversible("unsubscribe_propose"), false);
  assertEquals(organizeIsReversible("unsubscribe_send"), false);
});

Deno.test("unsubscribe kinds have NO undo kind (undo of a proposal must never SEND)", () => {
  assertEquals(undoKindFor("unsubscribe_propose"), null);
  assertEquals(undoKindFor("unsubscribe_send"), null);
});
