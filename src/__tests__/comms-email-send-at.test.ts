// @vitest-environment node
// "Approve now, send later" — the pure send-time contract every seam agrees on: the door parses it,
// the stored call re-proves it, the database stores exactly its text, the card shows it.
import { describe, expect, it } from "vitest";
import {
  COMMS_EMAIL_SCHEDULED_RELEASE_GRACE_MS, COMMS_EMAIL_SEND_AT_MAX_LEAD_MS, COMMS_EMAIL_SEND_AT_MIN_LEAD_MS,
  canonicalCommsEmailSendAt, parseCommsEmailSendAt,
} from "../../supabase/functions/_shared/comms-email/contract";
import { parseCommsEmailStoredCall } from "../../supabase/functions/_shared/comms-email/adapter";
import { parseConfirmPreview } from "@/components/chat/confirmPreview";

const NOW = Date.parse("2026-11-02T14:00:20.000Z");
const TENANT = "10000000-0000-4000-8000-000000000001";
const OP = "20000000-0000-4000-8000-000000000001";
const stored = (extra: Record<string, unknown> = {}) => ({
  expected_tenant_id: TENANT, operation_id: OP,
  command: { action: "comms.email_send", contact_id: "30000000-0000-4000-8000-000000000001", connector_id: "50000000-0000-4000-8000-000000000001", subject: "Hi", body: "Hello" },
  recipient: "dana@x.test", from_address: "owner@biz.test", content_digest: "a".repeat(64), ...extra,
});

describe("canonicalCommsEmailSendAt", () => {
  it("renders exactly Date#toISOString, floored to the minute — the text the database stores", () => {
    expect(canonicalCommsEmailSendAt("2026-11-02T14:30:45.999Z")).toBe("2026-11-02T14:30:00.000Z");
    expect(canonicalCommsEmailSendAt("2026-11-02T14:30Z")).toBe("2026-11-02T14:30:00.000Z");
    expect(canonicalCommsEmailSendAt("2026-11-02T09:30:00-05:00")).toBe("2026-11-02T14:30:00.000Z");
    expect(canonicalCommsEmailSendAt("2026-11-03T01:00:00+10:30")).toBe("2026-11-02T14:30:00.000Z");
  });
  it("refuses a zone-less local time, a rolled-over calendar date and anything that is not an instant", () => {
    for (const bad of ["2026-11-02T14:30:00", "2026-02-30T10:00:00Z", "2026-13-01T10:00:00Z", "2026-11-02T24:00:00Z",
      "2026-11-02T10:00:60Z", "2026-11-02 14:30:00Z", "2026-11-02T14:30:00+15:00", "tomorrow", "", 1793664000000, null, undefined, {}]) {
      expect(() => canonicalCommsEmailSendAt(bad), String(bad)).toThrow("COMMS_EMAIL_SEND_AT_INVALID");
    }
  });
});

describe("parseCommsEmailSendAt", () => {
  it("accepts two minutes ahead up to thirty days ahead", () => {
    expect(parseCommsEmailSendAt("2026-11-02T14:03:00Z", NOW)).toBe("2026-11-02T14:03:00.000Z");
    expect(parseCommsEmailSendAt(new Date(NOW + COMMS_EMAIL_SEND_AT_MAX_LEAD_MS - 60_000).toISOString(), NOW)).toMatch(/:00\.000Z$/);
  });
  it("refuses a time in the past, one under two minutes away, and one more than thirty days out", () => {
    expect(() => parseCommsEmailSendAt("2026-11-02T13:59:00Z", NOW)).toThrow("COMMS_EMAIL_SEND_AT_INVALID");
    // 14:02:00 is 1m40s away once floored: under the two-minute floor.
    expect(() => parseCommsEmailSendAt("2026-11-02T14:02:59Z", NOW)).toThrow("COMMS_EMAIL_SEND_AT_INVALID");
    expect(() => parseCommsEmailSendAt(new Date(NOW + COMMS_EMAIL_SEND_AT_MAX_LEAD_MS + 120_000).toISOString(), NOW)).toThrow("COMMS_EMAIL_SEND_AT_INVALID");
    expect(() => parseCommsEmailSendAt("2026-11-02T15:00:00Z", Number.NaN)).toThrow("COMMS_EMAIL_SEND_AT_INVALID");
  });
  it("the window and the release grace are the agreed numbers", () => {
    expect(COMMS_EMAIL_SEND_AT_MIN_LEAD_MS).toBe(120_000);
    expect(COMMS_EMAIL_SEND_AT_MAX_LEAD_MS).toBe(30 * 86_400_000);
    expect(COMMS_EMAIL_SCHEDULED_RELEASE_GRACE_MS).toBe(15 * 60_000);
  });
});

describe("the stored approved call carries its send time", () => {
  it("absent stays absent (every immediate call is unchanged)", () => {
    const call = parseCommsEmailStoredCall(stored(), TENANT);
    expect(call).not.toBeNull();
    expect(call).not.toHaveProperty("sendAt");
  });
  it("a canonical send time is returned as sendAt", () => {
    expect(parseCommsEmailStoredCall(stored({ send_at: "2026-11-02T14:30:00.000Z" }), TENANT)?.sendAt).toBe("2026-11-02T14:30:00.000Z");
  });
  it("a non-canonical or malformed stored time is not the call that was approved", () => {
    for (const send_at of ["2026-11-02T14:30:00Z", "2026-11-02T14:30:45.000Z", "2026-11-02T09:30:00-05:00", "soon", 5, null]) {
      expect(parseCommsEmailStoredCall(stored({ send_at }), TENANT), String(send_at)).toBeNull();
    }
  });
});

describe("the confirm card's email preview", () => {
  const preview = { kind: "email", to_address: "dana@x.test", from_address: "owner@biz.test", subject: "Hi", body_text: "Hello" };
  it("passes a readable send time through, and leaves an immediate preview exactly as before", () => {
    expect(parseConfirmPreview({ ...preview, send_at: "2026-11-02T14:30:00.000Z" })?.send_at).toBe("2026-11-02T14:30:00.000Z");
    expect(parseConfirmPreview(preview)).toEqual(preview);
  });
  it("drops an unreadable time instead of showing it", () => {
    expect(parseConfirmPreview({ ...preview, send_at: "whenever" })).toEqual(preview);
    expect(parseConfirmPreview({ ...preview, send_at: 12 })).toEqual(preview);
  });
});
