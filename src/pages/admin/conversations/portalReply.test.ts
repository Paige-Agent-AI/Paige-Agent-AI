import { beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.hoisted(() => vi.fn());
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc } }));

import {
  PORTAL_BODY_MAX, createPortalRequestIds, isPortalHelpRequest, isPortalMessage, portalBodyError,
  portalBodyLength, portalReplyErrorCopy, portalRequestScope, portalSenderName, sendPortalReply,
} from "./portalReply";
import { CHANNEL_ICON, CHANNEL_LABEL } from "./inbox-shared";

beforeEach(() => rpc.mockReset());

describe("portal channel presentation", () => {
  it("is a first-class channel in the exhaustive records", () => {
    expect(CHANNEL_LABEL.portal).toBe("Portal");
    expect(CHANNEL_ICON.portal).toBeTruthy();
  });

  it("recognises portal rows and help requests from the server's shape", () => {
    expect(isPortalMessage({ channel_type: "portal" })).toBe(true);
    expect(isPortalMessage({ channel_type: "email" })).toBe(false);
    expect(isPortalHelpRequest({ channel_type: "portal", direction: "inbound", subject: "Help request" })).toBe(true);
    // An email titled "Help request" is not a portal help request; nor is a business reply.
    expect(isPortalHelpRequest({ channel_type: "email", direction: "inbound", subject: "Help request" })).toBe(false);
    expect(isPortalHelpRequest({ channel_type: "portal", direction: "outbound", subject: "Help request" })).toBe(false);
    expect(isPortalHelpRequest({ channel_type: "portal", direction: "inbound", subject: null })).toBe(false);
  });

  it("names the portal sender, falling back honestly when the server sent none", () => {
    expect(portalSenderName({ sender: { name: " Maya Ortiz " } })).toBe("Maya Ortiz");
    expect(portalSenderName({ sender: null })).toBe("Client");
  });

  it("mirrors the server's 1..4000 trimmed-body rule", () => {
    expect(portalBodyError("   ")).toBe("Write a message first.");
    expect(portalBodyError("x".repeat(PORTAL_BODY_MAX))).toBeNull();
    expect(portalBodyError(` ${"x".repeat(PORTAL_BODY_MAX)} `)).toBeNull();
    expect(portalBodyError("x".repeat(PORTAL_BODY_MAX + 1))).toContain("up to 4,000 characters");
  });

  it("counts Unicode code points like Postgres length(), not UTF-16 units", () => {
    const emoji = "\u{1F33F}"; // one code point, two UTF-16 units
    expect(emoji.length).toBe(2);
    expect(portalBodyLength(` ${emoji.repeat(3000)} `)).toBe(3000);
    // 3,000 emoji is 6,000 UTF-16 units but 3,000 characters to the server — sendable.
    expect(portalBodyError(emoji.repeat(3000))).toBeNull();
    expect(portalBodyError(emoji.repeat(PORTAL_BODY_MAX))).toBeNull();
    // 4,001 code points is over the server's limit, and the message says so in code points.
    expect(portalBodyError(emoji.repeat(PORTAL_BODY_MAX + 1))).toBe(
      "Portal messages can be up to 4,000 characters — this one is 4,001.",
    );
    expect(portalBodyError("x".repeat(3999) + emoji + emoji)).toContain("this one is 4,001");
  });
});

describe("request ids — one per message, reused on retry", () => {
  it("reuses the id for the same scope until settled, and mints a new one for new text", () => {
    let n = 0;
    const ids = createPortalRequestIds(() => `id-${++n}`);
    const a = portalRequestScope("t", "c", " Hello ");
    expect(a).toBe(portalRequestScope("t", "c", "Hello"));
    expect(ids.idFor(a)).toBe("id-1");
    expect(ids.idFor(a)).toBe("id-1"); // retry → same id (idempotent replay server-side)
    expect(ids.idFor(portalRequestScope("t", "c", "Hello, edited"))).toBe("id-2"); // edited → new message
    const b = portalRequestScope("t", "c", "Hello, edited");
    ids.settle(b);
    expect(ids.idFor(b)).toBe("id-3"); // posted → the next send is a new message
    ids.settle(portalRequestScope("t", "c", "something else")); // settling another scope is a no-op
    expect(ids.idFor(b)).toBe("id-3");
    ids.clear();
    expect(ids.idFor(b)).toBe("id-4");
  });
});

describe("sendPortalReply — the comms_portal_reply seam", () => {
  const args = { tenantId: "tenant-a", contactId: "contact-1", body: "On it.", requestId: "req-1" };

  it("calls only comms_portal_reply with the four named params", async () => {
    rpc.mockResolvedValue({ data: { ok: true, replayed: false, message_id: "m-9", created_at: "2026-10-17T00:00:00Z" }, error: null });
    await expect(sendPortalReply(args)).resolves.toEqual({ ok: true, replayed: false, messageId: "m-9", createdAt: "2026-10-17T00:00:00Z" });
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("comms_portal_reply", {
      p_tenant_id: "tenant-a", p_contact_id: "contact-1", p_body: "On it.", p_request_id: "req-1",
    });
  });

  it("reports a replay as success", async () => {
    rpc.mockResolvedValue({ data: { ok: true, replayed: true, message_id: "m-9", created_at: null }, error: null });
    await expect(sendPortalReply(args)).resolves.toMatchObject({ ok: true, replayed: true, messageId: "m-9" });
  });

  it.each(["REQUEST_ID_REQUIRED", "INVALID_BODY", "CONTACT_NOT_FOUND", "PORTAL_NOT_CONNECTED", "REQUEST_ID_CONFLICT",
    "WORKSPACE_INACTIVE"])(
    "passes the server's %s through",
    async (code) => {
      rpc.mockResolvedValue({ data: { ok: false, error: code }, error: null });
      await expect(sendPortalReply(args)).resolves.toEqual({ ok: false, code });
    },
  );

  it("maps 42501 to NOT_AUTHORIZED and any other failure or unreadable answer to UNCONFIRMED", async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { code: "42501", message: "not authorized for this business inbox" } });
    await expect(sendPortalReply(args)).resolves.toEqual({ ok: false, code: "NOT_AUTHORIZED" });
    // The same SQLSTATE for an expired session is not a role problem: it says to sign in again.
    rpc.mockResolvedValueOnce({ data: null, error: { code: "42501", message: "authentication required" } });
    await expect(sendPortalReply(args)).resolves.toEqual({ ok: false, code: "SIGNED_OUT" });
    rpc.mockResolvedValueOnce({ data: null, error: { code: "08006", message: "connection failure" } });
    await expect(sendPortalReply(args)).resolves.toEqual({ ok: false, code: "UNCONFIRMED" });
    rpc.mockResolvedValueOnce({ data: { ok: false, error: "SOMETHING_NEW" }, error: null });
    await expect(sendPortalReply(args)).resolves.toEqual({ ok: false, code: "UNCONFIRMED" });
    rpc.mockResolvedValueOnce({ data: { ok: true }, error: null }); // ok without an id is not proof of a post
    await expect(sendPortalReply(args)).resolves.toEqual({ ok: false, code: "UNCONFIRMED" });
  });
});

describe("plain error copy", () => {
  it("says the customer hasn't joined the portal yet, and what to do instead", () => {
    const copy = portalReplyErrorCopy("PORTAL_NOT_CONNECTED", "Maya Ortiz");
    expect(copy).toContain("Maya Ortiz hasn't joined your client portal yet");
    expect(copy).toContain("reply by email or SMS");
  });

  it("says plainly when the business workspace isn't active, and that nothing was posted", () => {
    const copy = portalReplyErrorCopy("WORKSPACE_INACTIVE", "Maya Ortiz");
    expect(copy).toContain("workspace isn't active");
    expect(copy).toContain("can't receive messages");
    expect(copy).toContain("Nothing was posted");
    expect(copy).not.toBe(portalReplyErrorCopy("UNCONFIRMED", "Maya Ortiz"));
  });

  it("never names a placeholder contact", () => {
    expect(portalReplyErrorCopy("CONTACT_NOT_FOUND", "Unknown contact")).toMatch(/^This client isn't an active client/);
  });

  it("covers every code with distinct, non-technical copy", () => {
    const codes = ["REQUEST_ID_REQUIRED", "INVALID_BODY", "CONTACT_NOT_FOUND", "PORTAL_NOT_CONNECTED",
      "REQUEST_ID_CONFLICT", "WORKSPACE_INACTIVE", "NOT_AUTHORIZED", "UNCONFIRMED"] as const;
    const copies = codes.map((code) => portalReplyErrorCopy(code, "Maya"));
    expect(new Set(copies).size).toBe(codes.length);
    for (const copy of copies) expect(copy).not.toMatch(/REQUEST_ID|PORTAL_NOT|WORKSPACE_INACTIVE|42501|rpc/);
    expect(portalReplyErrorCopy("UNCONFIRMED", "Maya")).toContain("won't post twice");
  });
});

// E09 Slice 7 (review HIGH-2): a paused client keeps their link, so a portal post would land and a
// notification would reach them. The server refuses with PORTAL_ACCESS_PAUSED; the owner is told why.
describe("portal reply to a paused client", () => {
  it("maps the server refusal and says how to fix it", async () => {
    rpc.mockResolvedValue({ data: { ok: false, error: "PORTAL_ACCESS_PAUSED" }, error: null });
    const r = await sendPortalReply({ tenantId: "t", contactId: "c", body: "Hello", requestId: "r" });
    expect(r).toEqual({ ok: false, code: "PORTAL_ACCESS_PAUSED" });
    expect(portalReplyErrorCopy("PORTAL_ACCESS_PAUSED", "Jordan Test")).toBe("Jordan Test’s portal access is paused. Restore their portal access to message them here, or reply by email or SMS.");
    expect(portalReplyErrorCopy("PORTAL_ACCESS_PAUSED", "Jordan Test")).not.toMatch(/client record/);
  });
});
