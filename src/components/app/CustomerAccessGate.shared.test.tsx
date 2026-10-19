import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

/**
 * E09 Slice 7, review 7 — one reader per /app page. The gate reads the customer frame and the access
 * state once and provides it; the shell's home and its chat read that same answer instead of each
 * re-running both calls (three copies of the hook used to make three frame reads and three access
 * reads on every load and every window focus, and each could fail on its own).
 */
const f = vi.hoisted(() => ({ rpc: vi.fn(), getUser: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {
  rpc: (...a: unknown[]) => f.rpc(...a),
  auth: { getUser: () => f.getUser(), onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }) },
} }));
vi.mock("@/lib/auth/signOut", () => ({ performSignOut: vi.fn(), customerSignOutTarget: vi.fn() }));
import { CustomerAccessGate } from "./CustomerAccessGate";
import { useSharedClientPortalFrame } from "@/hooks/useClientPortalFrame";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const actor = "e0917000-0000-0000-0000-000000000001";
let host: HTMLDivElement, root: Root;
function Reader({ label, subject = actor }: { label: string; subject?: string }) {
  const frame = useSharedClientPortalFrame(subject);
  return <p data-reader={label}>{frame.phase}</p>;
}
const flush = () => act(async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); });
const calls = (name: string) => f.rpc.mock.calls.filter(([n]) => n === name).length;
beforeEach(() => {
  vi.clearAllMocks();
  f.getUser.mockResolvedValue({ data: { user: { id: actor } }, error: null });
  f.rpc.mockImplementation(async (name: string) => name === "client_portal_access_state"
    ? { data: { state: "none" }, error: null } : { data: null, error: null });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); });

it("the shell's home and chat share the gate's reading: one frame read and one access read per page", async () => {
  await act(async () => root.render(
    <CustomerAccessGate userId={actor} enabled><Reader label="home" /><Reader label="chat" /></CustomerAccessGate>,
  ));
  await flush();
  expect([...host.querySelectorAll("[data-reader]")].map((n) => n.textContent)).toEqual(["not-client", "not-client"]);
  expect(calls("client_portal_frame")).toBe(1);
  expect(calls("client_portal_access_state")).toBe(1);
  await act(async () => { window.dispatchEvent(new Event("focus")); }); await flush();
  expect(calls("client_portal_frame")).toBe(2);
});

it("a reader for someone else (staff viewing as a client) keeps its own read", async () => {
  await act(async () => root.render(
    <CustomerAccessGate userId={actor} enabled><Reader label="other" subject="e0917000-0000-0000-0000-000000000002" /></CustomerAccessGate>,
  ));
  await flush();
  // Its own reader checks its own subject (here: not the signed-in person, so refused), never the gate's answer.
  expect(host.querySelector('[data-reader="other"]')?.textContent).toBe("unavailable");
});
