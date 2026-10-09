// #1140 two-mailbox pilot — the organize command contract: reversible by
// construction, approval-gated for every Gmail-side write, unsubscribe only to
// the address the message itself recorded.
import { describe, expect, it } from "vitest";
import { organizeRequiresApproval, organizeIsReversible, parseOrganizeCommand, undoKindFor, UNSUBSCRIBE_HTTPS_RE, unsubscribeHttpsTarget } from "./organize.ts";

const M = "60000000-0000-4000-8000-000000000001";

describe("parseOrganizeCommand — closed union, strict fields", () => {
  it("parses each reversible kind", () => {
    expect(parseOrganizeCommand({ kind: "label", message_id: M, label: "needs-reply" })).toEqual({ kind: "label", message_id: M, label: "needs-reply" });
    expect(parseOrganizeCommand({ kind: "archive", message_id: M })).toEqual({ kind: "archive", message_id: M });
    expect(parseOrganizeCommand({ kind: "unarchive", message_id: M })).toEqual({ kind: "unarchive", message_id: M });
    expect(parseOrganizeCommand({ kind: "trash", message_id: M })).toEqual({ kind: "trash", message_id: M });
    expect(parseOrganizeCommand({ kind: "untrash", message_id: M })).toEqual({ kind: "untrash", message_id: M });
  });

  it("refuses unknown kinds, extra keys, bad ids, bad labels", () => {
    expect(() => parseOrganizeCommand({ kind: "delete", message_id: M })).toThrow();
    expect(() => parseOrganizeCommand({ kind: "archive", message_id: M, permanent: true })).toThrow();
    expect(() => parseOrganizeCommand({ kind: "archive", message_id: "not-a-uuid" })).toThrow();
    expect(() => parseOrganizeCommand({ kind: "label", message_id: M, label: "Bad Label!" })).toThrow();
    expect(() => parseOrganizeCommand({ kind: "label", message_id: M })).toThrow();
  });
});

describe("reversibility + approval", () => {
  it("every organize kind has an undo kind (never a one-way door)", () => {
    expect(undoKindFor("archive")).toBe("unarchive");
    expect(undoKindFor("unarchive")).toBe("archive");
    expect(undoKindFor("trash")).toBe("untrash");
    expect(undoKindFor("untrash")).toBe("trash");
    expect(undoKindFor("label")).toBe("unlabel");
    expect(undoKindFor("unlabel")).toBe("label");
    for (const kind of ["label", "unlabel", "archive", "unarchive", "trash", "untrash"] as const) {
      expect(organizeIsReversible(kind)).toBe(true);
    }
  });

  it("Gmail-side writes require the canonical approval; undo of a just-approved act rides the same approval window", () => {
    expect(organizeRequiresApproval("label")).toBe(true);
    expect(organizeRequiresApproval("archive")).toBe(true);
    expect(organizeRequiresApproval("trash")).toBe(true);
    expect(organizeRequiresApproval("unarchive")).toBe(true);
    expect(organizeRequiresApproval("untrash")).toBe(true);
  });
});

describe("unsubscribe target safety", () => {
  it("accepts only https one-click URLs (RFC 8058 shape), refusing http/mailto/javascript and hosts withuserinfo tricks", () => {
    expect(UNSUBSCRIBE_HTTPS_RE.test("https://news.vendor.test/u/abc")).toBe(true);
    expect(UNSUBSCRIBE_HTTPS_RE.test("http://news.vendor.test/u/abc")).toBe(false);
    expect(UNSUBSCRIBE_HTTPS_RE.test("mailto:unsub@vendor.test")).toBe(false);
    expect(UNSUBSCRIBE_HTTPS_RE.test("javascript:alert(1)")).toBe(false);
    expect(UNSUBSCRIBE_HTTPS_RE.test("https://user:pass@evil.test/u")).toBe(false);
    expect(unsubscribeHttpsTarget("https://evil.test/u?x=" + "a".repeat(2500))).toBeNull();
  });
});
