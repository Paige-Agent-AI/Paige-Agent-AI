import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import Messages from "./Messages";
import { hasUnsavedWork } from "@/hooks/useBeforeUnloadGuard";
import type { ClientPortalMessagesState } from "@/hooks/useClientPortalMessages";

const T = "e0923000-0000-0000-0000-000000000001";
const f = vi.hoisted(() => ({
  state: null as unknown as ClientPortalMessagesState,
  modules: [{ key: "home", label: "Home" }, { key: "learn", label: "Resources" }],
}));
vi.mock("@/hooks/useClientPortalMessages", async (orig) => ({
  ...(await orig<typeof import("@/hooks/useClientPortalMessages")>()),
  useClientPortalMessages: () => f.state,
}));
vi.mock("@/hooks/useClientPortalBrand", () => ({
  useClientPortalBrand: () => ({ tenant_id: T, tenant_name: "Northwind Studio", primary_color: "#26483e", logo_url: null }),
}));
vi.mock("@/hooks/useClientPortalConfig", () => ({ useClientPortalConfigState: () => ({ config: {}, loading: false }) }));
vi.mock("@/lib/playbook", () => ({ usePlaybook: () => ({ portal: { modules: f.modules } }) }));
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let root: Root, host: HTMLDivElement;
const render = async (path = "/app/messages") => act(async () => root.render(
  <MemoryRouter initialEntries={[path]}>
    <Routes>
      <Route path="/app/messages" element={<Messages />} />
      <Route path="/app/learn" element={<p>Resources page</p>} />
    </Routes>
  </MemoryRouter>,
));
const button = (label: string) => Array.from(host.querySelectorAll("button"))
  .find(b => b.textContent?.trim() === label || b.getAttribute("aria-label") === label) as HTMLButtonElement;
async function type(value: string) {
  await act(async () => {
    const field = host.querySelector("textarea")!;
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(field, value);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  f.modules = [{ key: "home", label: "Home" }, { key: "learn", label: "Resources" }];
  f.state = {
    messages: [], outbox: [], loading: false, error: null, unavailable: false, multipleBusinesses: false,
    hasMore: false, loadingMore: false,
    tenantId: T, scopeEpoch: 0,
    refresh: vi.fn().mockResolvedValue(undefined), loadMore: vi.fn().mockResolvedValue(undefined),
    send: vi.fn().mockResolvedValue(true), retry: vi.fn().mockResolvedValue(true), discard: vi.fn(),
  };
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount()); host.remove();
  vi.restoreAllMocks();
  (window as { matchMedia?: unknown }).matchMedia = originalMatchMedia;
  expect(hasUnsavedWork()).toBe(false);
});
const originalMatchMedia = window.matchMedia;
const setCoarse = (coarse: boolean) => {
  window.matchMedia = ((q: string) => ({
    matches: coarse && q.includes("coarse"), media: q, addEventListener: vi.fn(), removeEventListener: vi.fn(),
  })) as unknown as typeof window.matchMedia;
};
const business = (id: string, body: string, at: string) => ({ id, author: "business" as const, kind: "message" as const, body, created_at: at });
const customer = (id: string, body: string, at: string) => ({ id, author: "customer" as const, kind: "message" as const, body, created_at: at });

it("invites the first message by the business's name on an empty, successful read", async () => {
  await render();
  expect(host.querySelector("h1")?.textContent).toBe("Messages");
  expect(host.textContent).toContain("Start a conversation with Northwind Studio");
  expect(button("Send message").disabled).toBe(true);
  expect(host.textContent).not.toMatch(/\bread\b|seen/i);
});

it("shows loading, not an empty state, while the first read is in flight", async () => {
  f.state.loading = true; f.state.tenantId = null;
  await render();
  expect(host.querySelector('[role="status"]')?.textContent).toContain("Loading your messages");
  expect(host.textContent).not.toContain("Start a conversation");
  expect(host.querySelector("textarea")?.disabled).toBe(true);
});

it("shows a read failure with retry and never the empty invitation", async () => {
  f.state.error = "We couldn't load your messages. Check your connection and try again.";
  await render();
  expect(host.querySelector('[role="alert"]')?.textContent).toContain("couldn't load");
  expect(host.textContent).not.toContain("Start a conversation");
  await act(async () => button("Try again").click());
  expect(f.state.refresh).toHaveBeenCalledOnce();
});

it("explains honestly when the account has no customer relationship", async () => {
  f.state.unavailable = true; f.state.tenantId = null;
  await render();
  expect(host.textContent).toContain("Messages aren't available on this account");
  expect(host.querySelector("textarea")).toBeNull();
});

it("renders customer and business messages with authors and no read receipts", async () => {
  f.state.messages = [
    { id: "a", author: "customer", kind: "message", body: "Hi, quick question", created_at: "2026-10-01T10:00:00Z" },
    { id: "b", author: "business", kind: "message", body: "Happy to help", created_at: "2026-10-01T10:05:00Z" },
  ];
  await render();
  const log = host.querySelector('[role="log"]')!;
  expect(log.getAttribute("aria-label")).toBe("Conversation with Northwind Studio");
  expect(log.textContent).toContain("You");
  expect(log.textContent).toContain("Northwind Studio");
  expect(log.textContent).not.toMatch(/\bread\b|seen|delivered/i);
});

it("sends with Enter as a normal message and clears the draft", async () => {
  await render();
  await type("  Can we move Thursday?  ");
  expect(hasUnsavedWork()).toBe(true);
  await act(async () => {
    host.querySelector("textarea")!.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  });
  expect(f.state.send).toHaveBeenCalledWith("  Can we move Thursday?  ", "message");
  expect(host.querySelector("textarea")!.value).toBe("");
});

it("help mode sends kind=help, explains who sees it, and links to resources when that nav exists", async () => {
  await render("/app/messages?topic=help");
  expect(host.querySelector("h1")?.textContent).toBe("Contact your team");
  expect(host.textContent).toContain("Your request goes to their inbox");
  expect(host.querySelector('a[href="/app/learn"]')).not.toBeNull();
  expect(host.querySelector('a[href="/app/messages"]')).not.toBeNull();
  expect(host.querySelector('a[href="/app/support"]')).toBeNull();
  await type("My login link expired");
  await act(async () => button("Send request").click());
  expect(f.state.send).toHaveBeenCalledWith("My login link expired", "help");
});

it("omits the resources link when the portal has no resources nav", async () => {
  f.modules = [{ key: "home", label: "Home" }];
  await render("/app/messages?topic=help");
  expect(host.querySelector('a[href="/app/learn"]')).toBeNull();
});

it("blocks a send over the 4,000 character limit with a visible reason", async () => {
  await render();
  await type("x".repeat(4005));
  expect(button("Send message").disabled).toBe(true);
  expect(host.textContent).toContain("5 characters over the 4,000 limit");
  await act(async () => { await type(""); });
});

it("offers a safe retry for an unconfirmed send and edit for a definite refusal", async () => {
  f.state.outbox = [
    { localId: "l1", requestId: "r1", body: "Lost in transit", kind: "message", status: "unconfirmed", error: null },
    { localId: "l2", requestId: "r2", body: "Rejected text", kind: "message", status: "failed", error: "REQUEST_ID_CONFLICT" },
  ];
  await render();
  expect(host.textContent).toContain("We couldn't confirm this was sent. Retrying won't send it twice.");
  await act(async () => button("Retry").click());
  expect(f.state.retry).toHaveBeenCalledWith("l1");
  await act(async () => button("Edit and resend").click());
  expect(f.state.discard).toHaveBeenCalledWith("l2");
  expect(host.querySelector("textarea")!.value).toBe("Rejected text");
  f.state.outbox = [];
  await type("");
  await render();
});

it("shows a sending message as pending, never as sent", async () => {
  f.state.outbox = [{ localId: "l1", requestId: "r1", body: "On its way", kind: "message", status: "sending", error: null }];
  await render();
  expect(host.textContent).toContain("Sending…");
  expect(host.textContent).not.toMatch(/Sent \d/);
  f.state.outbox = [];
  await render();
});

it("loads earlier messages when the server reports more", async () => {
  f.state.hasMore = true;
  f.state.messages = [{ id: "a", author: "business", kind: "message", body: "Welcome", created_at: "2026-10-01T10:00:00Z" }];
  await render();
  await act(async () => button("Load earlier messages").click());
  expect(f.state.loadMore).toHaveBeenCalledOnce();
});

it("Edit and resend never loses the failed message when a draft is already in the composer", async () => {
  f.state.outbox = [{ localId: "l2", requestId: "r2", body: "Rejected text", kind: "message", status: "failed", error: "REQUEST_ID_CONFLICT" }];
  await render();
  await type("Half-written draft");
  await act(async () => button("Edit and resend").click());
  const field = host.querySelector("textarea")!;
  expect(field.value).toBe("Half-written draft\n\nRejected text");
  expect(f.state.discard).toHaveBeenCalledWith("l2");
  expect(document.activeElement).toBe(field);
  f.state.outbox = [];
  await type("");
  await render();
});

it("uses a non-live log wrapper around a plain list and announces only new incoming replies", async () => {
  // The first page ends with a business reply: loading it must not read it aloud.
  f.state.messages = [customer("a", "Hi", "2026-10-01T10:00:00Z"), business("a2", "Hello again", "2026-10-01T10:30:00Z")];
  await render();
  const log = host.querySelector('[role="log"]')!;
  expect(log.tagName).toBe("DIV");
  expect(log.getAttribute("aria-live")).toBe("off");
  const list = log.querySelector("ol")!;
  expect(list.getAttribute("role")).toBeNull();
  expect(list.getAttribute("aria-live")).toBeNull();
  const status = () => Array.from(host.querySelectorAll('[role="status"]')).map(n => n.textContent).join("|");
  expect(status()).not.toContain("New message");
  // Loading history (prepend) is not announced.
  f.state.messages = [business("z", "Old welcome", "2026-09-01T10:00:00Z"), ...f.state.messages];
  await render();
  expect(status()).not.toContain("New message");
  // A new reply at the end is.
  f.state.messages = [...f.state.messages, business("b", "Thursday works", "2026-10-01T11:00:00Z")];
  await render();
  expect(status()).toContain("New message from Northwind Studio: Thursday works");
});

it("shows the Help request label at full opacity on the customer's own bubble", async () => {
  f.state.messages = [{ id: "h", author: "customer", kind: "help", body: "Locked out", created_at: "2026-10-01T10:00:00Z" }];
  await render();
  const label = Array.from(host.querySelectorAll("span")).find(n => n.textContent === "Help request")!;
  expect(label.className).toContain("text-primary-foreground");
  expect(label.className).not.toContain("/80");
});

it("explains the multi-business limit instead of offering a composer", async () => {
  f.state.multipleBusinesses = true; f.state.tenantId = null;
  await render();
  expect(host.textContent).toContain("Messaging for more than one business isn't available yet");
  expect(host.textContent).not.toContain("couldn't load");
  expect(host.querySelector("textarea")).toBeNull();
});

it("offers Try again (not edit) for a rate-limited send, with honest copy", async () => {
  f.state.outbox = [{ localId: "l3", requestId: "r3", body: "Another one", kind: "message", status: "failed", error: "RATE_LIMITED" }];
  await render();
  expect(host.textContent).toContain("You've sent a lot of messages in a short time. Wait a minute, then try again.");
  expect(button("Edit and resend")).toBeUndefined();
  await act(async () => button("Try again").click());
  expect(f.state.retry).toHaveBeenCalledWith("l3");
  f.state.outbox = [];
  await render();
});

it("on touch devices Enter makes a new line and the Shift+Enter hint is hidden", async () => {
  setCoarse(true);
  await render();
  expect(host.textContent).not.toContain("Shift+Enter");
  await type("Line one");
  await act(async () => {
    host.querySelector("textarea")!.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
  });
  expect(f.state.send).not.toHaveBeenCalled();
  await act(async () => button("Send message").click());
  expect(f.state.send).toHaveBeenCalledWith("Line one", "message");
});

it("help mode focuses the composer once the deferred first read makes it usable", async () => {
  f.state.loading = true; f.state.tenantId = null;
  await render("/app/messages?topic=help");
  expect(document.activeElement).not.toBe(host.querySelector("textarea"));
  f.state = { ...f.state, loading: false, tenantId: T };
  await render("/app/messages?topic=help");
  expect(document.activeElement).toBe(host.querySelector("textarea"));
});

it("keeps the tenant accent off the decorative empty-state icon", async () => {
  await render();
  const icon = host.querySelector("h2")!.previousElementSibling as HTMLElement;
  expect(icon.getAttribute("style")).toBeNull();
  expect(button("Send message").getAttribute("style")).toContain("background-color");
});

it("follows new replies only while the reader is near the bottom", async () => {
  const scroll = vi.fn();
  const original = Element.prototype.scrollIntoView;
  Element.prototype.scrollIntoView = scroll;
  f.state.messages = [customer("a", "Hi", "2026-10-01T10:00:00Z")];
  await render();
  // The reader scrolls up into history: the end of the thread is far below the viewport.
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue({ top: 5000 } as DOMRect);
  await act(async () => { document.dispatchEvent(new Event("scroll")); });
  scroll.mockClear();
  f.state.messages = [...f.state.messages, business("b", "Reply", "2026-10-01T11:00:00Z")];
  await render();
  expect(scroll).not.toHaveBeenCalled();
  // Their own message always brings them back down.
  f.state.messages = [...f.state.messages, customer("c", "Thanks", "2026-10-01T12:00:00Z")];
  await render();
  expect(scroll).toHaveBeenCalled();
  Element.prototype.scrollIntoView = original;
});

it("counts characters the way the server does, so 4,000 emoji are sendable", async () => {
  await render();
  // 4,000 emoji are 8,000 UTF-16 units but 4,000 characters to Postgres length().
  await type("🙂".repeat(4000));
  expect(button("Send message").disabled).toBe(false);
  expect(host.querySelector("textarea")!.hasAttribute("maxlength")).toBe(false);
  await type("🙂".repeat(4001));
  expect(button("Send message").disabled).toBe(true);
  expect(host.textContent).toContain("1 characters over the 4,000 limit");
  await type("");
});

it("a failed help request edited and resent from the plain thread is still a help request", async () => {
  f.state.outbox = [{ localId: "h1", requestId: "r1", body: "My login is broken", kind: "help", status: "failed", error: "REQUEST_ID_CONFLICT" }];
  await render();
  await act(async () => button("Edit and resend").click());
  expect(host.textContent).toContain("This goes to Northwind Studio as a help request.");
  f.state.outbox = [];
  await act(async () => button("Send message").click());
  expect(f.state.send).toHaveBeenCalledWith("My login is broken", "help");
  // The next, freshly typed message is an ordinary one again.
  await type("Thanks!");
  expect(host.textContent).not.toContain("as a help request");
  await act(async () => button("Send message").click());
  expect(f.state.send).toHaveBeenLastCalledWith("Thanks!", "message");
});

it("treats a new signed-in identity as a first load: nothing announced, scrolled to the end", async () => {
  const scroll = vi.fn();
  const original = Element.prototype.scrollIntoView;
  Element.prototype.scrollIntoView = scroll;
  const status = () => Array.from(host.querySelectorAll('[role="status"]')).map(n => n.textContent).join("|");
  f.state.messages = [customer("a", "Hi", "2026-10-01T10:00:00Z")];
  await render();
  // Another person signs in on this device: the hook clears, then loads THEIR thread.
  f.state = { ...f.state, scopeEpoch: 1, loading: true, messages: [] };
  await render();
  f.state = { ...f.state, loading: false, messages: [business("x", "Private to the second person", "2026-10-02T10:00:00Z")] };
  scroll.mockClear();
  await render();
  expect(status()).not.toContain("New message");
  expect(scroll).toHaveBeenCalled();
  Element.prototype.scrollIntoView = original;
});

it("going from Contact your team to all messages keeps the page and never asks to discard", async () => {
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
  f.state.outbox = [{ localId: "h1", requestId: "r1", body: "Login broken", kind: "help", status: "failed", error: "REQUEST_ID_CONFLICT" }];
  await render("/app/messages?topic=help");
  await type("Also the invoice link");
  const back = Array.from(host.querySelectorAll("a")).find(a => a.textContent?.includes("All messages"))!;
  await act(async () => back.click());
  expect(confirm).not.toHaveBeenCalled();
  expect(host.querySelector("h1")?.textContent).toBe("Messages");
  // The help text typed before switching is still a help request.
  expect(host.textContent).toContain("This goes to Northwind Studio as a help request.");
  f.state.outbox = [];
  await act(async () => button("Send message").click());
  expect(f.state.send).toHaveBeenCalledWith("Also the invoice link", "help");
});
