/**
 * The accept page says what the accept-invite function said.
 *
 * supabase.functions.invoke returns every non-2xx as { data: null, error } whose message is the
 * framework constant ("Edge Function returned a non-2xx status code"); the function's own body —
 * { ok: false, code, error } — is on error.context. Before EXP08 this page showed that constant for
 * every refusal, so a suspended teammate opening an old invitation (409 seat_not_active) was told
 * nothing. jsdom with the client mocked; the bodies are the ones supabase/functions/accept-invite
 * returns (team-seat.ts seatNotActiveMessage).
 */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { HelmetProvider } from "react-helmet-async";
import { beforeEach, describe, expect, it, vi } from "vitest";
import AcceptInvitePage from "./AcceptInvite";

const mocks = vi.hoisted(() => ({ invoke: vi.fn(), signIn: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { functions: { invoke: mocks.invoke }, auth: { signInWithPassword: mocks.signIn } },
}));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const httpError = (status: number, body: unknown) => ({
  name: "FunctionsHttpError", message: "Edge Function returned a non-2xx status code",
  context: { status, json: async () => body },
});
const SUSPENDED = "Your access to this workspace is on hold, and an invite can't lift it. Ask the workspace owner to reinstate you.";

async function render() {
  const host = document.createElement("div");
  document.body.append(host);
  await act(async () => createRoot(host).render(
    <HelmetProvider><MemoryRouter initialEntries={["/accept-invite?token=tok-1"]}><AcceptInvitePage /></MemoryRouter></HelmetProvider>,
  ));
  await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
  return host;
}
const setValue = (input: HTMLInputElement, value: string) => {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
};

beforeEach(() => {
  document.body.innerHTML = "";
  mocks.invoke.mockReset();
  mocks.signIn.mockReset();
});

describe("the accept page reports the function's own refusal", () => {
  it("shows a lookup refusal's sentence, never the framework constant", async () => {
    mocks.invoke.mockResolvedValue({ data: null, error: httpError(410, { ok: false, error: "This invite has expired" }) });
    const host = await render();
    expect(host.textContent).toContain("This invite has expired");
    expect(host.textContent).not.toMatch(/non-2xx/i);
  });

  it("shows the seat_not_active refusal when a suspended teammate tries an old invitation", async () => {
    mocks.invoke.mockImplementation(async (_fn: string, { body }: { body: { action: string } }) => body.action === "lookup"
      ? { data: { ok: true, type: "team", email: "lena@example.com", displayName: "Lena Ortiz", tenantName: "Northstar Studio" }, error: null }
      : { data: null, error: httpError(409, { ok: false, code: "seat_not_active", error: SUSPENDED }) });
    const host = await render();
    const inputs = Array.from(host.querySelectorAll<HTMLInputElement>('input[type="password"]'));
    expect(inputs.length, "the password fields render").toBeGreaterThanOrEqual(2);
    await act(async () => { setValue(inputs[0], "a-long-password"); setValue(inputs[1], "a-long-password"); });
    await act(async () => { host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    expect(host.textContent).toContain(SUSPENDED);
    expect(host.textContent).not.toMatch(/non-2xx|Activation failed/);
    expect(mocks.signIn, "a refused activation never signs anyone in").not.toHaveBeenCalled();
  });

  it("falls back to an honest sentence when the body carries none", async () => {
    mocks.invoke.mockResolvedValue({ data: null, error: httpError(500, "not json") });
    const host = await render();
    expect(host.textContent).toContain("Invite not found or no longer valid");
    expect(host.textContent).not.toMatch(/non-2xx/i);
  });
});
