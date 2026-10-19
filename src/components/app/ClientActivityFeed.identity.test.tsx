import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { CustomerIdentityProvider } from "@/lib/portal/customerIdentity";

// Synthetic customer of a synthetic business (Jordan Rivera at Northwind Studio); never a real account.
const f = vi.hoisted(() => ({ events: [] as unknown[], status: "ready" }));
vi.mock("@/hooks/useMyContactId", () => ({ useMyContactId: () => ({ contactId: "c0000000-0000-4000-8000-000000000001", loading: false }) }));
vi.mock("@/hooks/useRailEvents", () => ({ useRailEvents: () => ({ events: f.events, connected: true, historyStatus: f.status }) }));
// The owner's Playbook persona is still PAIGE; the customer's strip must not read it.
vi.mock("@/lib/playbook", () => ({ usePlaybook: () => ({ persona: { name: "Paige" } }) }));
const { ClientActivityFeed } = await import("./ClientActivityFeed");
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ev = (id: string, kind: string) => ({ id, event_kind: kind, surface: "client_portal", actor_type: "agent", summary: null, occurred_at: new Date().toISOString() });
const frame = { brand: { tenant_name: "Northwind Studio" }, config: { assistant: { display_name: "Ava" } } } as never;
let root: Root, host: HTMLDivElement;
const render = async () => act(async () => root.render(
  <CustomerIdentityProvider state={{ frame, phase: "ready" }}><ClientActivityFeed /></CustomerIdentityProvider>,
));
beforeEach(() => { host = document.createElement("div"); document.body.append(host); root = createRoot(host); f.events = []; f.status = "ready"; });
afterEach(() => { act(() => root.unmount()); host.remove(); });

// Owner ruling 2026-10-19: Cura (or the business's own name for it) is the customer's agent; PAIGE is the owner's COO.
it("names the business for what it sent and the agent for what the customer asked, never PAIGE", async () => {
  f.events = [ev("1", "comms.outbound"), ev("2", "client.message"), ev("3", "system.update")];
  await render();
  expect(host.textContent).toContain("Northwind Studio sent you a message");
  expect(host.textContent).toContain("You messaged Ava");
  expect(host.textContent).toContain("Update from Northwind Studio");
  expect(host.textContent).not.toMatch(/paige/i);
});

it("an empty strip names the business, not an assistant", async () => {
  await render();
  expect(host.textContent).toContain("Updates from Northwind Studio will show up here as you work together.");
  expect(host.textContent).not.toMatch(/paige/i);
});

// Round 2 (verifier #7): with no business name the headline read "your team sent you a message".
it("starts a headline with a capital when the business name is not known yet", async () => {
  f.events = [ev("1", "comms.outbound"), ev("2", "system.update")];
  await act(async () => root.render(
    <CustomerIdentityProvider state={{ frame: null, phase: "loading" }}><ClientActivityFeed /></CustomerIdentityProvider>,
  ));
  expect(host.textContent).toContain("Your team sent you a message");
  expect(host.textContent).toContain("Update from your team");
});
