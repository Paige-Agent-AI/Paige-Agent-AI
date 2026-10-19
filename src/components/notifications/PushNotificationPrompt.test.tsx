import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { PushNotificationPrompt, pushTopicsSentence } from "./PushNotificationPrompt";

// D-QA1 / D-QA2 (live QA as a synthetic customer, 2026-10-19): every business's customers were told they would
// hear about "credit score changes, disputes … new funding matches", and the prompt opened on top of the
// required-consents wall.
const push = vi.hoisted(() => ({ shouldShowPrompt: vi.fn(async () => true) }));
vi.mock("@/hooks/usePushNotifications", () => ({ usePushNotifications: () => ({
  isSupported: true, isIOS: false, isPWAInstalled: false, subscribe: vi.fn(async () => true), dismissPrompt: vi.fn(async () => {}),
  shouldShowPrompt: push.shouldShowPrompt,
}) }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let root: Root, host: HTMLDivElement;
beforeEach(() => { vi.useFakeTimers(); host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); host.remove(); vi.useRealTimers(); });
const render = async (props: Parameters<typeof PushNotificationPrompt>[0]) => {
  await act(async () => root.render(<PushNotificationPrompt {...props} />));
};
const settle = async () => { await act(async () => { await vi.advanceTimersByTimeAsync(2000); }); };
const dialog = () => document.querySelector('[role="dialog"]');

it("names only the alerts that are actually sent, and nothing for a business without them", () => {
  expect(pushTopicsSentence({ creditAlerts: false })).toBeNull();
  const credit = pushTopicsSentence({ creditAlerts: true })!;
  expect(credit).toMatch(/credit scores changes|credit scores? change/);
  expect(credit).toMatch(/dispute/);
  // Funding matches are never sent with a business attached, so they are never promised.
  expect(credit).not.toMatch(/funding|match/i);
});

it("never asks a customer who will receive no push notifications", async () => {
  await render({ description: null });
  await settle();
  expect(dialog()).toBeNull();
});

it("says exactly what it was given", async () => {
  await render({ description: pushTopicsSentence({ creditAlerts: true }) });
  await settle();
  expect(dialog()?.textContent).toContain("one of your credit scores changes or a dispute is updated");
  expect(dialog()?.textContent).not.toMatch(/funding/i);
});

it("waits while another blocking dialog is up, and asks once it has closed", async () => {
  const description = pushTopicsSentence({ creditAlerts: true });
  await render({ description, suppressed: true });
  await settle();
  expect(dialog()).toBeNull();
  await render({ description, suppressed: false });
  await settle();
  expect(dialog()).not.toBeNull();
});
