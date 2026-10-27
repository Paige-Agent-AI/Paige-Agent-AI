import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const f = vi.hoisted(() => ({ identity: null as unknown, calendars: vi.fn(), availability: vi.fn(), create: vi.fn(), reconcile: vi.fn() }));
vi.mock("@/lib/portal/customerIdentity", () => ({ useCustomerIdentity: () => f.identity, useShellCustomerIdentity: () => f.identity }));
vi.mock("@/lib/client-portal-booking", () => ({ readCustomerBookingCalendars: f.calendars, readCustomerBookingAvailability: f.availability,
  createCustomerBooking: f.create, reconcileCustomerBooking: f.reconcile }));
import { CustomerBooking } from "./CustomerBooking";
import { customerBookingRecoveryKey } from "@/hooks/useClientPortalBooking";
const id = (n: number) => `e09b6000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const identity = (tenant = id(2), client = id(3)) => ({ viewer: "customer", phase: "ready", checking: false,
  businessName: "Harbor Lane Advisors", customerName: "Avery Example", frame: { actorId: id(1), profile: { tenant_id: tenant, id: client, email: "client@example.test" } } });
const calendar = { id: id(4), slug: "test-consultation", title: "Client check-in", description: "Review your next steps", durationMin: 30, timezone: "UTC" };
const slots = ["2026-11-09T10:00:00Z", "2026-11-09T11:00:00Z"];
const saved = { state: "saved", booking: { id: id(6), title: "Client check-in", start_at: slots[0], end_at: "2026-11-09T10:30:00Z", status: "scheduled", timezone: "UTC" } };
const key = customerBookingRecoveryKey(id(1), id(2), id(3));
let root: Root, host: HTMLDivElement, onSaved: ReturnType<typeof vi.fn>;
const flush = async () => { for (let i = 0; i < 25; i++) await Promise.resolve(); };
const render = async (value: unknown = identity()) => act(async () => { f.identity = value; root.render(<MemoryRouter><CustomerBooking onSaved={onSaved} /></MemoryRouter>); await flush(); });
const button = (text: string | RegExp) => [...document.querySelectorAll<HTMLButtonElement>("button")].find(b => typeof text === "string" ? b.textContent?.trim() === text : text.test(b.textContent ?? ""));
const click = async (text: string | RegExp) => act(async () => { const b = button(text); expect(b, `button ${text}`).toBeTruthy(); b!.click(); await flush(); });
const dialogText = () => document.querySelector('[role="dialog"]')?.textContent ?? "";
// Choose the first displayed time; the Portal correctly displays the viewer's
// zone, which can differ between the local machine and CI.
const chooseDetails = async () => { await click("Book a time"); await click(/^Client check-in/); await click(/Nov 9/); };
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
beforeEach(() => {
  vi.clearAllMocks(); localStorage.clear(); onSaved = vi.fn();
  f.calendars.mockResolvedValue({ calendars: [calendar], next: null });
  f.availability.mockResolvedValue({ slots, timezone: "UTC", durationMin: 30, horizonDays: 60, services: [], questions: [], locations: ["phone"] });
  f.create.mockResolvedValue(saved); f.reconcile.mockResolvedValue(saved);
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.restoreAllMocks(); });
it("chooses a real calendar/time and sends one explicit confirmation with canonical input", async () => {
  await render(); await chooseDetails(); expect(f.create).not.toHaveBeenCalled(); await click("Confirm booking");
  expect(f.create).toHaveBeenCalledTimes(1); expect(f.create.mock.calls[0][2]).toMatchObject({ calendar, start: slots[0], appointmentTypeId: null, location: "phone", answers: {} });
  expect(dialogText()).toContain("Your session is booked"); expect(onSaved).toHaveBeenCalledTimes(1); expect(localStorage.getItem(key)).toBeNull();
});
it("a lost response holds the original pointer and exposes only a status check", async () => {
  f.create.mockResolvedValue({ state: "unverified" }); await render(); await chooseDetails(); await click("Confirm booking");
  const marker = localStorage.getItem(key); expect(marker).toBeTruthy(); expect(dialogText()).toContain("Let’s check your booking"); expect(button("Confirm booking")).toBeUndefined();
  await click("Check booking"); expect(f.reconcile.mock.calls[0][1]).toBe(marker); expect(f.create).toHaveBeenCalledTimes(1); expect(dialogText()).toContain("Your session is booked");
});
it("an in-flight confirmation keeps the original request and removes repeated submit controls", async () => {
  let finish!: (value: unknown) => void; f.create.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  await render(); await chooseDetails(); await click("Confirm booking");
  expect(dialogText()).toContain("Checking your booking"); expect(button("Confirm booking")).toBeUndefined();
  expect(button("Checking…")?.disabled).toBe(true); expect(localStorage.getItem(key)).toBeTruthy();
  await act(async () => { finish(saved); await flush(); }); expect(dialogText()).toContain("Your session is booked");
});
it("returning with a held request cannot load a new booking or dispatch another create", async () => {
  localStorage.setItem(key, id(9)); await render(); await click("Review booking request");
  expect(dialogText()).toContain("Let’s check your booking"); expect(f.calendars).not.toHaveBeenCalled(); expect(f.create).not.toHaveBeenCalled();
});
it("empty published options retain a direct path to the business", async () => {
  f.calendars.mockResolvedValue({ calendars: [], next: null }); await render(); await click("Book a time");
  expect(dialogText()).toContain("There are no online booking options here yet"); expect(document.querySelector('a[href="/app/messages"]')).toBeTruthy(); expect(f.create).not.toHaveBeenCalled();
});
it("failed calendar reads recover through the same options action", async () => {
  f.calendars.mockRejectedValueOnce(new Error("Interrupted")); await render(); await click("Book a time");
  expect(dialogText()).toContain("Booking options couldn’t be checked"); await click("Try again"); expect(dialogText()).toContain("Client check-in"); expect(f.calendars).toHaveBeenCalledTimes(2);
});
it("required checkboxes refuse an incomplete form before dispatch", async () => {
  f.availability.mockResolvedValue({ slots, timezone: "UTC", durationMin: 30, horizonDays: 60, services: [], locations: ["phone"],
    questions: [{ id: "focus", label: "Choose your focus", type: "checkbox", required: true, options: ["Plan"], placeholder: null }] });
  await render(); await chooseDetails(); await click("Confirm booking");
  expect(dialogText()).toContain("Please complete the required session questions"); expect(f.create).not.toHaveBeenCalled();
  await act(async () => { document.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click(); await flush(); });
  await click("Confirm booking"); expect(f.create.mock.calls[0][2].answers).toEqual({ focus: ["Plan"] });
});
it("a missing canonical email points to the customer's profile and disables confirmation", async () => {
  const value = identity(); Object.assign(value.frame.profile, { email: null }); await render(value); await chooseDetails();
  expect(button("Confirm booking")?.disabled).toBe(true); expect(document.querySelector('a[href="/app/settings"]')).toBeTruthy(); expect(f.create).not.toHaveBeenCalled();
});
it("a cancelled original recovery is never called a newly booked session", async () => {
  f.reconcile.mockResolvedValue({ ...saved, booking: { ...saved.booking, status: "cancelled" } }); localStorage.setItem(key, id(9)); await render(); await click("Review booking request"); await click("Check booking");
  expect(dialogText()).toContain("Your booking was found"); expect(dialogText()).toContain("cancelled"); expect(dialogText()).not.toContain("Your session is booked");
});
it("revoked or inactive customer context immediately removes private booking controls and details", async () => {
  await render(); await chooseDetails(); await render({ ...identity(), viewer: "inactive", phase: "ended", frame: null });
  expect(document.querySelector('[role="dialog"]')).toBeNull(); expect(button("Book a time")).toBeUndefined(); expect(document.body.textContent).not.toContain("client@example.test");
});
it("switching the original customer relationship closes the old business draft", async () => {
  await render(); await chooseDetails(); await render(identity(id(20), id(30)));
  expect(document.querySelector('[role="dialog"]')).toBeNull(); expect(f.create).not.toHaveBeenCalled();
});
