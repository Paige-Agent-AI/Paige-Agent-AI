import { describe, expect, it } from "vitest";
import {
  buildGovernedReplyRequest, checkGovernedSendAt, classifyDoorAnswer, floorSendAtToMinute, governedReplyFiles,
  governedReplyScope, governedReplyText, readDoorAnswer, signaturePlainText, type GovernedReplyDraft,
} from "./governedReply";

const TENANT = "6f1a2b3c-4d5e-4f60-8a7b-9c0d1e2f3a4b";
const CONTACT = "0c1d2e3f-4a5b-4c6d-8e7f-a0b1c2d3e4f5";
const CONN = "1d2e3f4a-5b6c-4d7e-8f90-a1b2c3d4e5f6";
const OP = "5a6b7c8d-9e0f-4a1b-8c2d-3e4f5a6b7c8d";
const NOW = Date.parse("2026-10-27T15:00:00.000Z");
const draft = (over: Partial<GovernedReplyDraft> = {}): GovernedReplyDraft => ({ tenantId: TENANT, contactId: CONTACT, connectorId: CONN, subject: "Thursday", text: "Hello.", paths: [], ...over });
const request = (over: Partial<GovernedReplyDraft> = {}) => { const r = buildGovernedReplyRequest(draft(over), OP); if (!r.ok) throw new Error("bad"); return r.request; };
const ctx = { name: "Maya Ortiz", from: "jordan@northlight.example" };
const ready = (over: Record<string, unknown> = {}, preview: Record<string, unknown> = {}) => ({
  transport: false as const, status: 202,
  body: { ok: false, outcome: "approval_required", fingerprint: "0123456789abcdef", operation_id: OP, expires_at: new Date(NOW + 600_000).toISOString(),
    preview: { kind: "email", to_name: "Maya Ortiz", to_address: "maya@x.example", from_address: "jordan@northlight.example", subject: "Thursday", body_text: "Hello.", ...preview }, ...over },
});

describe("the words the governed email carries", () => {
  it("a signature is carried as plain text under a -- line; no signature, no line", () => {
    expect(signaturePlainText("<p>Jordan Lee</p><p>Northlight &amp; Co</p>")).toBe("Jordan Lee\nNorthlight & Co");
    expect(governedReplyText("  Hi Maya.  ", "<p>Jordan</p>")).toBe("Hi Maya.\n\n--\nJordan");
    expect(governedReplyText("Hi Maya.", null)).toBe("Hi Maya.");
    expect(governedReplyText("Hi Maya.", "<p> </p>")).toBe("Hi Maya.");
  });
  it("the door's own parser catches a subject over 200 and a body over 10,000 before any call", () => {
    expect(buildGovernedReplyRequest(draft({ subject: "x".repeat(201) }), OP)).toEqual({ ok: false, problem: "subject" });
    expect(buildGovernedReplyRequest(draft({ text: "x".repeat(10_001) }), OP)).toEqual({ ok: false, problem: "body" });
    expect(buildGovernedReplyRequest(draft({ contactId: "not-a-uuid" }), OP)).toEqual({ ok: false, problem: "contact" });
  });
  it("the request carries only the closed shape: send_at, files and the fingerprint only when present", () => {
    expect(request()).toEqual({ expected_tenant_id: TENANT, operation_id: OP, command: { action: "comms.email_send", contact_id: CONTACT, connector_id: CONN, subject: "Thursday", body: "Hello." } });
    const full = buildGovernedReplyRequest(draft({ sendAt: "2026-10-28T09:00:00.000Z", paths: ["a", "b"] }), OP, "0123456789abcdef");
    expect(full.ok && full.request).toMatchObject({ send_at: "2026-10-28T09:00:00.000Z", attachments: [{ path: "a" }, { path: "b" }], approved_fingerprint: "0123456789abcdef" });
  });
  it("the scope changes with every part of what would be sent", () => {
    const base = governedReplyScope(draft());
    for (const over of [{ subject: "Friday" }, { text: "Hi." }, { connectorId: "x" }, { sendAt: "2026-10-28T09:00:00.000Z" }, { paths: ["p"] }, { contactId: "y" }, { tenantId: "z" }]) {
      expect(governedReplyScope(draft(over))).not.toBe(base);
    }
    expect(governedReplyScope(draft())).toBe(base);
  });
});

describe("a signature as text", () => {
  it("keeps a link's target, decodes named and numeric entities, drops images", () => {
    expect(signaturePlainText('<p>Book a <a href="https://cal.example/jordan">call</a></p><p>&copy; 2026 Northlight &rsquo;s &mdash; &#8212; &#x2014; &amp;</p><img src="logo.png" alt="Logo">'))
      .toBe("Book a call (https://cal.example/jordan)\n© 2026 Northlight ’s — — — &");
    // A link whose text is its own address is not repeated; mailto reads as the address.
    expect(signaturePlainText('<a href="https://northlight.example">https://northlight.example</a><br><a href="mailto:j@n.example">Email me</a>'))
      .toBe("https://northlight.example\nEmail me (j@n.example)");
  });
});

describe("the sender id", () => {
  it("a sender the door cannot take is named as a sender problem", () => {
    expect(buildGovernedReplyRequest(draft({ connectorId: "conn-legacy" }), OP)).toEqual({ ok: false, problem: "sender" });
    expect(buildGovernedReplyRequest(draft({ contactId: "nope" }), OP)).toEqual({ ok: false, problem: "contact" });
  });
});

describe("a check's lifetime never trusts the browser clock against the server's", () => {
  it("with the server's Date, the lifetime is expires_at minus the server's now, counted from receipt", () => {
    const serverNow = NOW + 20 * 60_000; // the browser is 20 minutes behind
    const a = { ...ready({ expires_at: new Date(serverNow + 9 * 60_000).toISOString() }), serverNowMs: serverNow };
    const v = classifyDoorAnswer(a, "check", request(), ctx, NOW);
    expect(v.kind === "ready" && v.check.deadlineMs).toBe(NOW + 9 * 60_000);
  });
  it("without one, a browser clock running ahead never makes a live check look expired (bounded by the door's 10 minutes)", () => {
    const ahead = classifyDoorAnswer(ready({ expires_at: new Date(NOW - 5 * 60_000).toISOString() }), "check", request(), ctx, NOW);
    expect(ahead.kind === "ready" && ahead.check.deadlineMs).toBe(NOW + 10 * 60_000);
    const behind = classifyDoorAnswer(ready({ expires_at: new Date(NOW + 60 * 60_000).toISOString() }), "check", request(), ctx, NOW);
    expect(behind.kind === "ready" && behind.check.deadlineMs).toBe(NOW + 10 * 60_000);
  });
});

describe("the send time", () => {
  it("floors to the minute and keeps the door's 2-minute to 30-day window", () => {
    expect(floorSendAtToMinute("2026-10-27T15:10:37.500Z")).toBe("2026-10-27T15:10:00.000Z");
    expect(floorSendAtToMinute("nope")).toBeNull();
    expect(checkGovernedSendAt("2026-10-27T18:00:59.000Z", NOW)).toEqual({ ok: true, sendAt: "2026-10-27T18:00:00.000Z" });
    expect(checkGovernedSendAt("2026-10-27T15:01:30.000Z", NOW)).toEqual({ ok: false, why: "too_soon" });
    expect(checkGovernedSendAt("2026-12-27T15:00:00.000Z", NOW)).toEqual({ ok: false, why: "too_far" });
    expect(checkGovernedSendAt("soon", NOW)).toEqual({ ok: false, why: "invalid" });
  });
});

describe("the staged files", () => {
  const file = (name: string, size = 100) => ({ url: `${TENANT}/0b6d8c43-5a77-4f3b-9d0e-1c2f3a4b5c6d-${name}`, name, size });
  it("passes the composer's own paths, in order, and names any the door would refuse", () => {
    expect(governedReplyFiles(TENANT, [])).toEqual({ ok: true, paths: [] });
    expect(governedReplyFiles(TENANT, [file("a.pdf"), file("b.pdf")])).toEqual({ ok: true, paths: [file("a.pdf").url, file("b.pdf").url] });
    expect(governedReplyFiles(TENANT, [file("a.pdf"), { url: "other-tenant/x.pdf", name: "x.pdf", size: 1 }])).toEqual({ ok: false, refused: ["x.pdf"] });
  });
  it("refuses a total over the door's 10 MB", () => {
    expect(governedReplyFiles(TENANT, [file("a.pdf", 6 * 1024 * 1024), file("b.pdf", 5 * 1024 * 1024)])).toEqual({ ok: false, tooLarge: true });
  });
});

describe("reading the door's answer", () => {
  it("a 2xx body is read from data; a non-2xx body from error.context", async () => {
    expect(await readDoorAnswer({ data: { ok: true }, error: null, response: { status: 200 } })).toEqual({ transport: false, status: 200, body: { ok: true }, serverNowMs: null });
    expect(await readDoorAnswer({ data: null, error: { context: { status: 422, json: async () => ({ ok: false }) } } })).toEqual({ transport: false, status: 422, body: { ok: false }, serverNowMs: null });
    expect(await readDoorAnswer({ data: null, error: { context: { json: async () => ({ ok: false }) } } })).toEqual({ transport: false, status: null, body: { ok: false }, serverNowMs: null });
    // The server's own clock, when the response exposes its Date header.
    const dated = await readDoorAnswer({ data: { ok: true }, error: null, response: new Response("{}", { status: 202, headers: { date: "Tue, 27 Oct 2026 15:20:00 GMT" } }) });
    expect(dated).toMatchObject({ status: 202, serverNowMs: Date.parse("2026-10-27T15:20:00.000Z") });
  });
  it("no readable body is a lost answer, never a refusal", async () => {
    expect(await readDoorAnswer({ data: null, error: { context: new Error("network") } })).toEqual({ transport: true });
    expect(await readDoorAnswer({ data: null, error: { context: { json: async () => { throw new Error("html"); } } } })).toEqual({ transport: true });
    expect(await readDoorAnswer({ data: "text", error: null })).toEqual({ transport: true });
  });
});

describe("a 202 is trusted only for this exact call", () => {
  it("is ready when it matches", () => {
    const v = classifyDoorAnswer(ready(), "check", request(), ctx, NOW);
    expect(v.kind).toBe("ready");
  });
  it.each([
    ["another operation", ready({ operation_id: "8b7c6d5e-4f3a-4b2c-9d1e-0f9a8b7c6d5e" })],
    ["a bad fingerprint", ready({ fingerprint: "XYZ" })],
    ["no readable expiry", ready({ expires_at: "soon" })],
    ["other words", ready({}, { body_text: "Hello!" })],
    ["another subject", ready({}, { subject: "Friday" })],
    ["a time nobody asked for", ready({}, { send_at: "2026-10-28T09:00:00.000Z" })],
    ["files nobody asked for", ready({}, { attachments: [{ name: "a.pdf", size: 1, mime: "application/pdf" }] })],
    ["no preview", ready({ preview: null })],
  ])("is no check when it carries %s", (_name, a) => {
    const v = classifyDoorAnswer(a, "check", request(), ctx, NOW);
    expect(v.kind).toBe("cant");
    expect(v.kind === "cant" && v.head).toBe("Couldn't check just now.");
  });
  it("files: the count read must equal the count asked for; sizes are the server's, in words", () => {
    const req = request({ paths: [`${TENANT}/0b6d8c43-5a77-4f3b-9d0e-1c2f3a4b5c6d-a.pdf`] });
    const v = classifyDoorAnswer(ready({}, { attachments: [{ name: "a.pdf", size: 48_000, mime: "application/pdf" }] }), "check", req, ctx, NOW);
    expect(v.kind === "ready" && v.check.files).toEqual([{ name: "a.pdf", size: "47 KB" }]);
    expect(classifyDoorAnswer(ready(), "check", req, ctx, NOW).kind).toBe("cant");
  });
});

describe("holds", () => {
  const err = (status: number, body: Record<string, unknown>) => ({ transport: false as const, status, body });
  it("quiet hours never holds an email, so the strip never promises it does; business Do not disturb says schedule it", () => {
    const quiet = classifyDoorAnswer(err(422, { outcome: "held", reason: "QUEUED_QUIET_HOURS" }), "check", request(), ctx, NOW);
    expect(quiet.kind === "cant" && `${quiet.head} ${quiet.body ?? ""}`).not.toMatch(/quiet hours/i);
    const dnd = classifyDoorAnswer(err(422, { outcome: "held", reason: "QUEUED_TENANT_DND" }), "check", request(), ctx, NOW);
    expect(dnd.kind === "cant" && dnd.body).toBe("Schedule it for later.");
  });
});

describe("what settles the operation id", () => {
  const err = (status: number, body: Record<string, unknown>) => ({ transport: false as const, status, body });
  it("a fresh refusal on a check keeps it (asking again is the same request); a replay or any confirm answer spends it", () => {
    const fresh = classifyDoorAnswer(err(422, { outcome: "refused", reason: "BLOCKED_SUPPRESSED" }), "check", request(), ctx, NOW);
    expect(fresh.kind === "cant" && fresh.settle).toBe(false);
    const replay = classifyDoorAnswer(err(422, { outcome: "refused", reason: "BLOCKED_SUPPRESSED", replayed: true }), "check", request(), ctx, NOW);
    expect(replay.kind === "cant" && replay.settle).toBe(true);
    const confirm = classifyDoorAnswer(err(422, { outcome: "refused", reason: "RECIPIENT_CHANGED" }), "confirm", request(), ctx, NOW);
    expect(confirm.kind === "cant" && confirm.settle).toBe(true);
  });
  it("a lost confirm answer keeps it, so Check status asks about the same operation", () => {
    const v = classifyDoorAnswer({ transport: true }, "confirm", request(), ctx, NOW);
    expect(v).toMatchObject({ kind: "cant", action: "check_status", settle: false });
  });
  it("only a definite sent or scheduled answer is recorded; unknown and failed keep the words and the id", () => {
    expect(classifyDoorAnswer(err(200, { ok: true, outcome: "provider_accepted" }), "confirm", request(), ctx, NOW)).toMatchObject({ kind: "recorded", outcome: "provider_accepted", already: false });
    expect(classifyDoorAnswer(err(200, { ok: true, outcome: "scheduled", send_at: "2026-10-28T09:00:00.000Z" }), "confirm", request(), ctx, NOW)).toMatchObject({ kind: "recorded", outcome: "scheduled" });
    expect(classifyDoorAnswer(err(503, { ok: false, outcome: "outcome_unknown" }), "confirm", request(), ctx, NOW)).toMatchObject({ kind: "cant", action: "check_status", settle: false, keepId: true });
    expect(classifyDoorAnswer(err(422, { ok: false, outcome: "failed", reason: "X" }), "confirm", request(), ctx, NOW)).toMatchObject({ kind: "cant", settle: false, keepId: true });
    // Not the door's vocabulary: a lost answer, never a refusal.
    for (const body of [{ code: "WORKER_LIMIT" }, { ok: false }, { outcome: "maybe", reason: "BLOCKED_SUPPRESSED" }, { outcome: "provider_accepted" }]) {
      expect(classifyDoorAnswer(err(546, body), "confirm", request(), ctx, NOW)).toMatchObject({ kind: "cant", action: "check_status", settle: false, keepId: true });
    }
    // On a check, an unknown never clears the words: it is an earlier send, still settling.
    expect(classifyDoorAnswer(err(503, { ok: false, outcome: "outcome_unknown", code: "COMMS_EMAIL_REPLAY_UNAVAILABLE" }), "check", request(), ctx, NOW).kind).toBe("cant");
  });
});
