import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useLeadReplyReview } from "./useLeadReplyReview";

const db = vi.hoisted(() => ({ invoke: vi.fn(), from: vi.fn(), row: null as Record<string, unknown> | null, filters: [] as unknown[][] }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { functions: { invoke: db.invoke }, from: db.from } }));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const tenant = "11111111-1111-4111-8111-111111111111";
const contact = "22222222-2222-4222-8222-222222222222";
const connector = "33333333-3333-4333-8333-333333333333";
const approval = "44444444-4444-4444-8444-444444444444";
const fingerprint = "abcdef0123456789";
const base = { tenantId: tenant, contactId: contact, threadKey: `contact:${tenant}:${contact}`, approvalId: approval, connectorId: connector, channel: "email", subject: "Your inquiry", body: "Thanks for asking. Here is the next step.", attachmentCount: 0, uploading: false, scheduledFor: null, signatureEnabled: false, disabled: false };
type Input = Parameters<typeof useLeadReplyReview>[0];
let host: HTMLDivElement;
let root: Root;
let props: Input;
let api: ReturnType<typeof useLeadReplyReview>;
const onAccepted = vi.fn();
function Harness({ input }: { input: Input }) { api = useLeadReplyReview(input, onAccepted); return <>{api.panel}</>; }
async function render(next: Partial<Input> = {}) { props = { ...props, ...next }; await act(async () => { root.render(<Harness input={props} />); }); }
async function prepare() { await act(async () => { await api.prepare(); }); }
async function click(text: string) {
  const button = [...host.querySelectorAll("button")].find((b) => b.textContent?.trim() === text);
  expect(button, `button ${text}`).toBeTruthy();
  await act(async () => { button!.click(); });
}
function proposal(call: Record<string, unknown>, override: Record<string, unknown> = {}) {
  return { data: { ok: false, outcome: "approval_required", operation_id: call.operation_id, fingerprint, summary: "Email this contact", expires_at: new Date(Date.now() + 60_000).toISOString(), preview: { kind: "email", to_address: "lead@example.test", from_address: "hello@business.example", subject: base.subject, body_text: base.body }, ...override }, error: null };
}
beforeEach(async () => {
  props = { ...base }; onAccepted.mockClear(); db.filters = []; db.row = null;
  db.invoke.mockReset(); db.invoke.mockImplementation(async (_name, options) => proposal(options.body));
  db.from.mockReset(); db.from.mockImplementation((table) => {
    db.filters.push(["table", table]);
    const query: Record<string, unknown> = {};
    for (const key of ["select", "eq", "limit"]) query[key] = (...args: unknown[]) => { db.filters.push([key, ...args]); return query; };
    query.maybeSingle = async () => ({ data: db.row, error: null });
    return query;
  });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  await render();
});
afterEach(async () => { await act(async () => { root.unmount(); }); host.remove(); });

describe("lead reply through the existing approval door", () => {
  it("reviews the server's exact envelope, then echoes the same operation, command and fingerprint", async () => {
    await prepare();
    expect(host.textContent).toContain("lead@example.test"); expect(host.textContent).toContain("hello@business.example");
    const call = db.invoke.mock.calls[0][1].body;
    expect(db.invoke.mock.calls[0][0]).toBe("comms-email-command");
    expect(call).toMatchObject({ expected_tenant_id: tenant, approval_id: approval, command: { action: "comms.email_send", contact_id: contact, connector_id: connector, subject: base.subject, body: base.body } });
    expect(call.command).not.toHaveProperty("to"); expect(call.command).not.toHaveProperty("from_address");
    db.invoke.mockResolvedValueOnce({ data: { ok: true, outcome: "provider_accepted", operation_id: call.operation_id, provider_receipt_available: true }, error: null });
    await click("Approve");
    expect(db.invoke.mock.calls[1][1].body).toEqual({ ...call, approved_fingerprint: fingerprint });
    expect(host.textContent).toContain("Delivery is not confirmed");
    expect([...host.querySelectorAll("button")].some((b) => b.textContent === "Approve")).toBe(false);
    expect(onAccepted).toHaveBeenCalledTimes(1);
  });
  it.each(["subject", "body", "connectorId", "approvalId", "channel", "attachmentCount", "scheduledFor", "signatureEnabled"] as const)("invalidates review when %s changes", async (field) => {
    await prepare();
    const value = field === "attachmentCount" ? 1 : field === "signatureEnabled" ? true : "changed";
    await render({ [field]: value });
    expect(host.textContent).toContain("draft changed");
    expect([...host.querySelectorAll("button")].some((b) => b.textContent === "Approve")).toBe(false);
    expect(db.invoke).toHaveBeenCalledTimes(1);
  });
  it("editing and restoring the original words still requires a fresh review", async () => {
    await prepare(); await render({ body: "Revised" }); await render({ body: base.body });
    expect(host.textContent).toContain("draft changed"); expect(host.querySelector("button")).toBeNull();
  });
  it("Not now keeps the caller's draft and spends no approval", async () => {
    await prepare(); await click("Not now"); expect(host.textContent).toBe(""); expect(props.body).toBe(base.body); expect(db.invoke).toHaveBeenCalledTimes(1);
  });
  it.each([
    { attachmentCount: 1 }, { uploading: true }, { scheduledFor: "2026-12-01T00:00:00Z" }, { signatureEnabled: true }, { channel: "sms" }, { approvalId: null }, { subject: "" }, { body: "" }, { subject: "x".repeat(201) }, { body: "x".repeat(10001) },
  ])("refuses unsupported or incomplete input before calling the door: %j", async (next) => {
    await render(next); await prepare(); expect(db.invoke).not.toHaveBeenCalled(); expect(host.querySelector('[role="alert"]')).not.toBeNull(); expect(props.body).toBe(next.body ?? base.body);
  });
  it("does not prepare when the current role or handling mode forbids it", async () => {
    await render({ disabled: true }); await prepare(); expect(db.invoke).not.toHaveBeenCalled();
  });
  it.each([
    { preview: null }, { fingerprint: "invalid" }, { operation_id: "different" }, { expires_at: "invalid" }, { expires_at: "2020-01-01T00:00:00Z" }, { summary: "" },
    { preview: { kind: "email", to_address: "lead@example.test", from_address: "hello@business.example", subject: base.subject, body_text: "Different" } },
  ])("rejects malformed, mismatched and expired server reviews: %j", async (override) => {
    db.invoke.mockImplementationOnce(async (_name, options) => proposal(options.body, override));
    await prepare(); expect(host.querySelector('[role="alert"]')).not.toBeNull(); expect(host.querySelector("button")).toBeNull();
  });
  it("re-checks expiry at the moment of approval", async () => {
    await prepare(); const clock = vi.spyOn(Date, "now").mockReturnValue(Date.now() + 120_000);
    await click("Approve"); clock.mockRestore(); expect(db.invoke).toHaveBeenCalledTimes(1); expect(host.textContent).toContain("expired");
  });
  it("locks repeated prepare and approve gestures synchronously", async () => {
    let resolve: (value: unknown) => void;
    db.invoke.mockImplementationOnce((_name, options) => new Promise((done) => { resolve = () => done(proposal(options.body)); }));
    let pending: Promise<void>;
    await act(async () => { pending = api.prepare(); void api.prepare(); });
    expect(db.invoke).toHaveBeenCalledTimes(1);
    await act(async () => { resolve!(null); await pending!; });
    db.invoke.mockImplementationOnce(() => new Promise(() => {}));
    const approve = [...host.querySelectorAll("button")].find((b) => b.textContent === "Approve")!;
    await act(async () => { approve.click(); approve.click(); });
    expect(db.invoke).toHaveBeenCalledTimes(2); expect(api.blocksSending).toBe(true);
  });
  it("discards a late review after an A to B to A workspace switch", async () => {
    let resolve: () => void;
    db.invoke.mockImplementationOnce((_name, options) => new Promise((done) => { resolve = () => done(proposal(options.body)); }));
    let pending: Promise<void>;
    await act(async () => { pending = api.prepare(); });
    await render({ tenantId: "55555555-5555-4555-8555-555555555555" }); await render({ tenantId: tenant });
    await act(async () => { resolve!(); await pending!; }); expect(host.textContent).toBe("");
  });
  it("never renders an old workspace's send completion or calls its reset callback", async () => {
    await prepare(); let resolve: (v: unknown) => void;
    db.invoke.mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
    await click("Approve"); await render({ tenantId: "55555555-5555-4555-8555-555555555555" });
    await act(async () => { resolve!({ data: { outcome: "provider_accepted", ok: true, provider_receipt_available: true }, error: null }); });
    expect(host.textContent).toBe(""); expect(onAccepted).not.toHaveBeenCalled();
  });
  it("a network error after approval stays unknown; status checks are tenant/contact/operation scoped reads only", async () => {
    await prepare(); const call = db.invoke.mock.calls[0][1].body;
    db.invoke.mockRejectedValueOnce(new Error("private provider payload")); await click("Approve");
    expect(host.textContent).toContain("Don't resend"); expect(host.textContent).not.toContain("private provider payload"); expect(api.blocksSending).toBe(true);
    await prepare(); expect(db.invoke).toHaveBeenCalledTimes(2);
    await click("Check sending status");
    expect(db.invoke).toHaveBeenCalledTimes(2); expect(db.filters).toContainEqual(["eq", "tenant_id", tenant]); expect(db.filters).toContainEqual(["eq", "contact_id", contact]); expect(db.filters).toContainEqual(["eq", "meta->comms_email_binding->>operation_id", call.operation_id]); expect(api.blocksSending).toBe(true);
  });
  it.each(["sent", "delivered"])("settles %s only from the same canonical bound message with a provider receipt", async (status) => {
    await prepare(); const call = db.invoke.mock.calls[0][1].body;
    db.invoke.mockResolvedValueOnce({ data: null, error: { message: "transport" } }); await click("Approve");
    db.row = { tenant_id: tenant, contact_id: contact, comms_email_operation: call.operation_id, comms_email_state: "provider_accepted", status, provider_message_id: "provider-receipt" };
    await click("Check sending status");
    expect(host.textContent).toContain(status === "delivered" ? "Delivery confirmed" : "Delivery is not confirmed"); expect(onAccepted).toHaveBeenCalledTimes(1); expect(db.invoke).toHaveBeenCalledTimes(2);
  });
  it("a foreign or unbound message cannot settle an unknown attempt", async () => {
    await prepare(); db.invoke.mockResolvedValueOnce({ data: null, error: null }); await click("Approve");
    db.row = { tenant_id: "foreign", contact_id: contact, comms_email_state: "provider_accepted", status: "delivered", provider_message_id: "receipt" };
    await click("Check sending status"); expect(api.blocksSending).toBe(true); expect(onAccepted).not.toHaveBeenCalled();
  });
  it("a held approval reports not sent and preserves the caller's draft", async () => {
    await prepare(); db.invoke.mockResolvedValueOnce({ data: { ok: false, outcome: "held" }, error: null }); await click("Approve");
    expect(host.textContent).toContain("Not sent"); expect(props.body).toBe(base.body); expect(onAccepted).not.toHaveBeenCalled(); expect(api.blocksSending).toBe(false);
  });
});
