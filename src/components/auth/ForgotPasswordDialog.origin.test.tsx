/** E09 Slice H: the account reset email always lands on an app origin, never on the request's host. */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ForgotPasswordDialog } from "./ForgotPasswordDialog";

const reset = vi.hoisted(() => vi.fn());
vi.mock("@/integrations/supabase/client", () => ({ supabase: { auth: { resetPasswordForEmail: (...a: unknown[]) => reset(...a) } } }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const dom = (globalThis as typeof globalThis & { jsdom: { reconfigure(o: { url: string }): void } }).jsdom;
const ORIGINAL_URL = window.location.href;
let host: HTMLDivElement, root: Root;
beforeEach(() => { reset.mockReset(); reset.mockResolvedValue({ error: null }); host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); host.remove(); dom.reconfigure({ url: ORIGINAL_URL }); });

async function requestReset() {
  await act(async () => root.render(<ForgotPasswordDialog open onOpenChange={() => {}} />));
  const input = document.querySelector<HTMLInputElement>("input[type=email]")!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "recipient@tests.invalid");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => { input.form!.requestSubmit(); });
}

it.each([
  ["https://paigeagent.ai/auth", "https://paigeagent.ai/reset-password"],
  ["https://app.paigeagent.ai/auth", "https://app.paigeagent.ai/reset-password"],
  ["https://evil.example/auth", "https://paigeagent.ai/reset-password"],
  ["https://acme.paigeagent.ai/auth", "https://paigeagent.ai/reset-password"],
])("on %s the reset email returns to %s", async (url, expected) => {
  dom.reconfigure({ url });
  await requestReset();
  expect(reset).toHaveBeenCalledWith("recipient@tests.invalid", { redirectTo: expected });
});
