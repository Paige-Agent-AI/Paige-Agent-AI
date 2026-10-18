import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// E09 Slice 6 (M2a, §37): the legacy invite path answers 409 INVITATION_POLICY_HELD when the client can't
// be emailed. The panel says so, copies no link, and never tells staff to send the link some other way.
// Synthetic contact only (§63).
const t = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast: { success: t.success, error: t.error } }));
const invoke = vi.fn();
const rpc = vi.fn();
vi.mock("@/integrations/supabase/client", () => {
  const proxy: unknown = new Proxy({}, { get: (_t, key) => key === "then" ? (ok: (v: unknown) => void) => ok({ data: null, error: null }) : () => proxy });
  return { supabase: { rpc: (n: string, a: unknown) => rpc(n, a), from: () => proxy, functions: { invoke: (n: string, a: unknown) => invoke(n, a) } } };
});
vi.mock("@/hooks/useTenantContext", () => ({ useTenantContext: () => ({ activeTenantId: "e0960000-0000-4000-8000-00000000b001" }) }));
vi.mock("@/hooks/useTierFeatures", () => ({ useTierFeatures: () => ({ has: () => true }) }));
vi.mock("@/lib/functions/adminAccountActions", () => ({ callAdminAccountAction: vi.fn() }));
const { ContactPortalPanel } = await import("./ContactPortalPanel");
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const EMAIL = "jordan.rivera@example.test";
const held = () => ({ data: null, error: { message: "Edge Function returned a non-2xx status code",
  context: { status: 409, json: async () => ({ ok: false, emailed: false, status: "held", code: "INVITATION_POLICY_HELD" }) } } });
let root: Root, host: HTMLDivElement;
const writeText = vi.fn(async () => undefined);
async function flush() { await act(async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); }); }
async function sendInvite() {
  act(() => root.render(<ContactPortalPanel contactId="e0960000-0000-4000-8000-00000000d001" email={EMAIL} linkedUserId={null} />));
  await flush();
  const button = Array.from(host.querySelectorAll("button")).find(b => b.textContent?.includes("Send invite"))!;
  act(() => button.click()); await flush();
}

beforeEach(() => {
  t.success.mockReset(); t.error.mockReset(); invoke.mockReset(); rpc.mockReset(); writeText.mockClear();
  rpc.mockResolvedValue({ data: [{ token: "synthetic-token" }], error: null });
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); });

describe("ContactPortalPanel — a held invitation", () => {
  it("says the client can't be emailed, copies no link, and offers no hand-off", async () => {
    invoke.mockResolvedValue(held());
    await sendInvite();
    expect(invoke).toHaveBeenCalledWith("send-portal-invite", { body: { token: "synthetic-token", email: EMAIL } });
    expect(t.error).toHaveBeenCalledWith(`${EMAIL} has email turned off or on hold, so Paige didn't send the invitation.`);
    expect(t.success).not.toHaveBeenCalled();
    expect(writeText).not.toHaveBeenCalled();
    expect(JSON.stringify(t.error.mock.calls)).not.toMatch(/send it to|copied|share/i);
  });

  it("an emailed invitation still reads as emailed", async () => {
    invoke.mockResolvedValue({ data: { ok: true, emailed: true }, error: null });
    await sendInvite();
    expect(t.success).toHaveBeenCalledWith(`Invite emailed to ${EMAIL} — link also copied`);
    expect(t.error).not.toHaveBeenCalled();
  });
});
