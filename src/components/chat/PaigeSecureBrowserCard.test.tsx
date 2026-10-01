import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PaigeSecureBrowserCard } from "./PaigeSecureBrowserCard";

const api = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { functions: { invoke: api.invoke } },
}));

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  api.invoke.mockReset();
  document.body.innerHTML = "";
});

async function renderCard() {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(<PaigeSecureBrowserCard threadId="11111111-1111-4111-8111-111111111111" />);
  });
  return { host, root };
}

function setControl(control: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const proto = control instanceof HTMLTextAreaElement
    ? window.HTMLTextAreaElement.prototype
    : window.HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(control, value);
  control.dispatchEvent(new Event("input", { bubbles: true }));
}

describe("Paige Secure Browser owner card", () => {
  it("shows scope, secret handling, and no action path before a request", async () => {
    const { host, root } = await renderCard();
    expect(host.textContent).toContain("Paige Secure Browser");
    expect(host.textContent).toContain("ActionsDisabled");
    expect(host.textContent).toContain("Vault quarantine only");
    expect(host.textContent).toContain("Never enter a password or verification code in chat");
    await act(async () => root.unmount());
  });

  it("renders the durable unavailable result without claiming a session", async () => {
    api.invoke.mockResolvedValue({
      data: {
        status: "unavailable",
        reason: "worker_under_setup",
        receiptId: "22222222-2222-4222-8222-222222222222",
        session: {
          id: "33333333-3333-4333-8333-333333333333",
          threadId: "11111111-1111-4111-8111-111111111111",
          purpose: "Review insurance renewal",
          targetDisplayHost: "example.com",
          targetOrigin: "https://example.com",
          authority: "authorized",
          state: "unavailable",
          stateVersion: 1,
          safeReason: "worker_under_setup",
        },
      },
      error: null,
    });
    const { host, root } = await renderCard();
    await act(async () => {
      setControl(host.querySelector("textarea")!, "Review insurance renewal");
      setControl(host.querySelector("input")!, "example.com");
    });
    await act(async () => {
      host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(api.invoke).toHaveBeenCalledWith("browser-use", expect.objectContaining({
      body: expect.objectContaining({
        thread_id: "11111111-1111-4111-8111-111111111111",
        purpose: "Review insurance renewal",
        target: "https://example.com",
      }),
    }));
    expect(host.textContent).toContain("No live session exists");
    expect(host.textContent).toContain("Request receipt recorded");
    expect(host.textContent).toContain("No website, sign-in, account, or download was opened");
    await act(async () => root.unmount());
  });

  it("keeps a transport failure truthful and retryable", async () => {
    api.invoke.mockResolvedValue({ data: null, error: new Error("offline") });
    const { host, root } = await renderCard();
    await act(async () => {
      setControl(host.querySelector("textarea")!, "Review insurance renewal");
      setControl(host.querySelector("input")!, "example.com");
      host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(host.textContent).toContain("No browser session was opened");
    expect(host.textContent).toContain("Review and retry");
    await act(async () => root.unmount());
  });
});
