import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ClientHomeTiles } from "./ClientHomeTiles";

// Synthetic test tenant (Northwind Studio); never a real account.
const T = "e0923000-0000-0000-0000-000000000002";
const f = vi.hoisted(() => ({
  rpc: vi.fn(),
  applications: 0,
  brand: null as null | { tenant_id: string; tenant_name: string },
  brandLoading: false,
  multiple: false,
}));
vi.mock("@/integrations/supabase/client", () => {
  const counted = (table: string) => {
    const result = { count: table === "funding_journey_applications" ? f.applications : 0, error: null };
    const chain: Record<string, unknown> = {};
    chain.select = () => chain; chain.eq = () => chain; chain.neq = () => chain;
    chain.then = (resolve: (v: unknown) => unknown) => Promise.resolve(result).then(resolve);
    return chain;
  };
  return { supabase: { from: (t: string) => counted(t), rpc: (...a: unknown[]) => f.rpc(...a) } };
});
vi.mock("@/lib/playbook", () => ({ usePlaybook: () => ({ persona: { name: "Paige" }, quickActions: [] }) }));
vi.mock("@/hooks/useClientPortalBrand", () => ({
  useClientPortalBrandState: () => ({ brand: f.brand, loading: f.brandLoading, error: false, multipleBusinesses: f.multiple }),
}));
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const START = "2026-11-03T15:00:00.000Z";
const session = {
  id: "s1", title: "Strategy call", start_at: START, end_at: "2026-11-03T16:00:00.000Z", timezone: "UTC", status: "scheduled", kind: "single",
  location: { type: "zoom", label: "Zoom", join_url: null }, calendar: null,
  change: { can_cancel: false, can_reschedule: false, deadline: null, reason: "NO_CALENDAR" },
};

let root: Root, host: HTMLDivElement;
const render = async () => {
  await act(async () => root.render(
    <MemoryRouter initialEntries={["/app"]}>
      <Routes>
        <Route path="/app" element={<ClientHomeTiles userId="u1" />} />
        <Route path="/app/messages" element={<p>Messages page</p>} />
      </Routes>
    </MemoryRouter>,
  ));
  await act(async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); });
};
const sessionReads = () => f.rpc.mock.calls.filter(c => c[0] === "client_portal_sessions");

beforeEach(() => {
  vi.clearAllMocks();
  f.applications = 0; f.brandLoading = false; f.multiple = false;
  f.brand = { tenant_id: T, tenant_name: "Northwind Studio" };
  f.rpc.mockResolvedValue({ data: { tenant_id: T, server_now: "2026-10-17T12:00:00Z", sessions: [session], next_before: null }, error: null });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.useRealTimers(); });

it("shows the customer's next session and opens Sessions", async () => {
  await render();
  expect(sessionReads()[0][1]).toEqual({ p_tenant_id: null, p_window: "upcoming", p_before: null, p_limit: 1 });
  const tile = host.querySelector('a[href="/app/sessions"]');
  expect(tile?.textContent).toContain("Next session");
  expect(tile?.textContent).toContain("Strategy call");
  expect(tile?.querySelector("time")?.getAttribute("dateTime")).toBe(START);
});

/** The prompt the old "Book a session" tile handed Paige (playbook default when it sets none). */
const bookAsked = () => {
  const asked: string[] = [];
  const on = (e: Event) => asked.push((e as CustomEvent<{ prompt: string }>).detail.prompt);
  window.addEventListener("paige:prefill", on);
  return { asked, stop: () => window.removeEventListener("paige:prefill", on) };
};

it("keeps 'Book a session' on the Next session tile for a single-business customer, with the old tile's behaviour (§58)", async () => {
  await render();
  const tile = host.querySelector('a[href="/app/sessions"]')!.parentElement!;
  const book = Array.from(tile.querySelectorAll("button")).find(b => b.textContent?.trim() === "Book a session")!;
  expect(book).toBeDefined();
  // Never a button inside the link to Sessions.
  expect(book.closest("a")).toBeNull();
  const spy = bookAsked();
  await act(async () => book.click());
  spy.stop();
  expect(spy.asked).toEqual(["Help me schedule my next session"]);
  expect(host.textContent).not.toContain("Messages page");
});

it("keeps 'Book a session' when nothing is booked, beside messaging the business", async () => {
  f.rpc.mockResolvedValue({ data: { tenant_id: T, server_now: "2026-10-17T12:00:00Z", sessions: [], next_before: null }, error: null });
  await render();
  const book = Array.from(host.querySelectorAll("button")).find(b => b.textContent?.trim() === "Book a session")!;
  expect(book).toBeDefined();
  const spy = bookAsked();
  await act(async () => book.click());
  spy.stop();
  expect(spy.asked).toEqual(["Help me schedule my next session"]);
});

it("with nothing booked, says so and points to messaging the business by name", async () => {
  f.rpc.mockResolvedValue({ data: { tenant_id: T, server_now: "2026-10-17T12:00:00Z", sessions: [], next_before: null }, error: null });
  await render();
  expect(host.textContent).toContain("No upcoming sessions");
  expect(host.textContent).toContain("When Northwind Studio books a time with you");
  const action = Array.from(host.querySelectorAll("button")).find(b => b.textContent === "Message Northwind Studio")!;
  await act(async () => action.click());
  expect(host.textContent).toContain("Messages page");
});

it("never says 'your coach', and the Message Paige tile says only what its action does", async () => {
  await render();
  expect(host.textContent).not.toMatch(/your coach/i);
  // Its action puts a question in Paige's chat; it does not open a thread with the business.
  expect(host.textContent).toContain("Ask Paige a question anytime.");
  expect(host.textContent).not.toMatch(/start a thread with/i);
  const spy = bookAsked();
  const send = Array.from(host.querySelectorAll("button")).find(b => b.textContent === "Send your first message")!;
  await act(async () => send.click());
  spy.stop();
  expect(spy.asked).toEqual(["Hi Paige — I'd like to introduce myself."]);
});

it("does not read sessions for someone who is not a single-business customer, and keeps the old tile", async () => {
  f.brand = null;
  await render();
  expect(sessionReads()).toHaveLength(0);
  expect(host.textContent).toContain("Book a session");
  expect(host.textContent).not.toMatch(/your coach/i);
  f.multiple = true;
  await render();
  expect(sessionReads()).toHaveLength(0);
});

it("keeps the funding tile in the third slot for a client with funding applications", async () => {
  f.applications = 2;
  await render();
  expect(host.textContent).toContain("Funding");
  expect(host.querySelector('a[href="/app/sessions"]')).toBeNull();
});

/** Pin "now" (Date only; timers stay real) and serve one upcoming session starting `minutes` from it. */
const NOW = new Date(2026, 9, 19, 12, 0, 0).getTime();
const nextAt = (minutes: number, extra: Record<string, unknown> = {}) => {
  vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(NOW);
  const start = new Date(NOW + minutes * 60_000).toISOString();
  f.rpc.mockResolvedValue({ data: { tenant_id: T, server_now: new Date(NOW).toISOString(), sessions: [{
    ...session, start_at: start, end_at: new Date(NOW + (minutes + 60) * 60_000).toISOString(), ...extra,
  }], next_before: null }, error: null });
};
/** The tile reads once on mount; a fresh mount reads again. */
const remount = () => { act(() => root.unmount()); root = createRoot(host); };
const headline = () => host.querySelector('[data-testid="next-session-headline"]')?.textContent;

it("headlines the next session in the Sessions page's words: today with time left, tomorrow, happening now", async () => {
  nextAt(45);
  await render();
  expect(headline()).toBe("Today · in 45 min");
  // The headline already says the day, so the detail is the time alone, and the title has its own
  // line so a phone never cuts it off.
  const date = new Date(NOW + 45 * 60_000).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
  const when = host.querySelector('[data-testid="next-session-when"]')!;
  expect(when.textContent).not.toContain(date);
  const title = host.querySelector('[data-testid="next-session-title"]')!;
  expect(title.className).toContain("line-clamp-2");
  expect(title.className).not.toContain("truncate");
  expect(title.parentElement!.className).not.toContain("truncate");
  remount(); nextAt(24 * 60);
  await render();
  expect(headline()).toBe("Tomorrow");
  remount(); nextAt(-10);
  await render();
  expect(headline()).toBe("Happening now");
});

it("falls back to the date when the session is further out", async () => {
  nextAt(5 * 24 * 60);
  await render();
  const date = new Date(NOW + 5 * 24 * 60 * 60_000).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
  expect(headline()).toBe(date);
  // With no relative headline the detail line carries the date.
  expect(host.querySelector('[data-testid="next-session-when"]')!.textContent).toContain(`${date}, `);
});

it("says 'Changes closed' when the session's change window has closed, and nothing when it is open", async () => {
  nextAt(45, { change: { can_cancel: false, can_reschedule: false, deadline: new Date(NOW - 15 * 60_000).toISOString(), reason: "WINDOW_CLOSED" } });
  await render();
  expect(host.querySelector('[data-testid="next-session-closed"]')?.textContent?.trim()).toBe("Changes closed");
  remount(); nextAt(45, { change: { can_cancel: true, can_reschedule: true, deadline: new Date(NOW + 15 * 60_000).toISOString(), reason: null } });
  await render();
  expect(host.querySelector('[data-testid="next-session-closed"]')).toBeNull();
});

/** Light and dark contrast of the hover these tiles use, from the real tokens. */
const hoverContrast = () => {
  const css = readFileSync(resolve(process.cwd(), "src/index.css"), "utf8");
  const block = (sel: string) => { const i = css.indexOf(`${sel} {`); return css.slice(i, css.indexOf("}", i)); };
  const hsl = (b: string, n: string) => b.match(new RegExp(`--${n}:\\s*([\\d.]+)\\s+([\\d.]+)%\\s+([\\d.]+)%`))!.slice(1).map(Number);
  const lum = ([h, s0, l0]: number[]) => {
    const s1 = s0 / 100, l = l0 / 100, a = s1 * Math.min(l, 1 - l);
    const ch = (n: number) => { const k = (n + h / 30) % 12; return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)); };
    const [r, g, b] = [0, 8, 4].map(ch).map(c => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const ratio = (a: number[], b: number[]) => { const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); };
  return [":root", ".dark"].map(sel => ratio(hsl(block(sel), "foreground"), hsl(block(sel), "muted")));
};

it("hovers Book a session and Message to muted with a foreground label, 4.5:1 or better in both themes", async () => {
  f.rpc.mockResolvedValue({ data: { tenant_id: T, server_now: "2026-10-17T12:00:00Z", sessions: [], next_before: null }, error: null });
  await render();
  for (const label of ["Book a session", "Message Northwind Studio"]) {
    const b = Array.from(host.querySelectorAll("button")).find(x => x.textContent?.trim() === label)!;
    expect(b.className, label).toContain("hover:bg-muted");
    expect(b.className, label).toContain("hover:text-foreground");
    expect(b.className, label).not.toContain("hover:bg-secondary");
  }
  for (const r of hoverContrast()) expect(r).toBeGreaterThanOrEqual(4.5);
});

it("matches the neighbouring tiles' 36px buttons, with a 44px touch target", async () => {
  f.rpc.mockResolvedValue({ data: { tenant_id: T, server_now: "2026-10-17T12:00:00Z", sessions: [], next_before: null }, error: null });
  await render();
  const all = Array.from(host.querySelectorAll("button"));
  const neighbour = all.find(b => b.textContent === "Upload your first document")!;
  expect(neighbour.className).toMatch(/(^| )h-9( |$)/);
  for (const label of ["Book a session", "Message Northwind Studio"]) {
    const b = all.find(x => x.textContent?.trim() === label)!;
    expect(b.className, label).toMatch(/(^| )h-9( |$)/);
    expect(b.className, label).not.toContain("min-h-[44px]");
    // 36px + 4px above and below: a 44px target.
    expect(b.className, label).toContain("after:-inset-y-1");
    expect(b.className, label).toContain("relative");
  }
});

it("puts the Next session footer's button icon on the card's content edge", async () => {
  await render();
  const footer = host.querySelector('[data-testid="next-session-footer"]')!;
  // CardHeader / CardContent pad 24px; the footer's 12px plus the button's own 12px land on the same edge.
  expect(footer.className).toContain("px-3");
  expect(footer.className).not.toContain("px-4");
  expect(footer.querySelector("button")!.className).toContain("px-3");
});
