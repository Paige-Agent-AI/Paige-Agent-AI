import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  PREF_ACTOR, PREF_OTHER_TENANT, PREF_TENANT, prefCard, prefUpdates, prefsPayload,
} from "@/test/fixtures/clientPortalPreferences";
import { PORTAL_PREFERENCE_DISCLOSURES, disclosureText, preferenceRefusal, type PortalDisclosureId } from "@/lib/client-portal-preferences";
import { refusalText } from "./clientPreferencesCopy";

// The page reads and writes only through the three E09 Slice 6 RPCs; raw tables are never touched.
type Result = { data: unknown; error: { code?: string; message?: string } | null };
let readQueue: Array<Result | Promise<Result>>, current: Record<string, unknown> | null, writeAnswer: (args: Record<string, unknown>) => Result | Promise<Result>;
let signedIn: string | null;
const rpc = vi.fn(), headers: Array<[string, string, string]> = [];
const raw = vi.fn(() => { throw new Error("no raw table access"); });
vi.mock("@/integrations/supabase/client", () => ({ supabase: {
  rpc: (name: string, args: Record<string, unknown>) => {
    const promise = Promise.resolve(rpc(name, args));
    return Object.assign(promise, { setHeader: (k: string, v: string) => { headers.push([name, k, v]); return promise; } });
  },
  from: () => raw(),
  auth: {
    getUser: async () => ({ data: { user: signedIn ? { id: signedIn } : null }, error: null }),
    getSession: async () => ({ data: { session: signedIn ? { user: { id: signedIn }, access_token: `token-${signedIn}` } : null }, error: null }),
  },
} }));
const { ClientPreferences } = await import("./ClientPreferences");
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let root: Root, host: HTMLDivElement;
const committed = vi.fn();
async function flush() { await act(async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); }); }
async function mount(payload: Record<string, unknown> | null = prefsPayload()) {
  current = payload;
  act(() => root.render(<MemoryRouter><ClientPreferences actorId={PREF_ACTOR} onCommitted={committed} /></MemoryRouter>));
  await flush();
}
const row = (key: string) => host.querySelector<HTMLElement>(`[data-testid="pref-${key}"]`)!;
const stateOf = (key: string) => row(key).querySelector('[data-testid="pref-state"]')!.textContent;
const switchOf = (key: string) => row(key).querySelector<HTMLButtonElement>('[role="switch"]');
const writes = () => rpc.mock.calls.filter(c => c[0] !== "client_portal_communication_preferences");
const reads = () => rpc.mock.calls.filter(c => c[0] === "client_portal_communication_preferences");
const button = (label: string) => Array.from(host.querySelectorAll("button")).find(b => b.textContent?.trim() === label);
function deferred<T>() { let resolve!: (v: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; }

beforeEach(() => {
  readQueue = []; signedIn = PREF_ACTOR; headers.length = 0; rpc.mockReset(); raw.mockClear(); committed.mockReset();
  writeAnswer = () => ({ data: { ok: true, replayed: false, preferences: current }, error: null });
  rpc.mockImplementation((name: string, args: Record<string, unknown>) => {
    if (name === "client_portal_communication_preferences") return readQueue.length ? readQueue.shift() : { data: current, error: null };
    if (name === "client_portal_set_communication_preference" || name === "client_portal_set_shared_context_consent") return writeAnswer(args);
    throw new Error(`unexpected contract ${name}`);
  });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); });

describe("How {Business} can reach you — what each state says", () => {
  it("nothing on record: email on, texts not set up, not subscribed, sharing not allowed", async () => {
    await mount();
    expect(host.textContent).toContain("How Northwind Studio can reach you");
    expect(host.textContent).toContain("What Northwind Studio can use");
    expect(stateOf("email")).toBe("On");
    expect(stateOf("sms")).toBe("Not set up");
    expect(switchOf("sms")?.disabled).toBe(true);
    expect(row("sms").querySelector('[data-testid="pref-reason"]')?.textContent).toBe("Texts can't be turned on from your account.");
    expect(button("Don't text me")).toBeTruthy();
    expect(stateOf("updates")).toBe("Not subscribed");
    expect(switchOf("updates")?.disabled).toBe(false);
    expect(stateOf("sharing")).toBe("Not allowed");
    expect(raw).not.toHaveBeenCalled();
  });

  it.each([
    ["email off by you", { email: prefCard("off", { set_by: "you", set_at: "2026-10-12T15:00:00Z", can_turn_on: true, can_turn_off: false }) }, "email", "Off · you turned email off on Oct 12, 2026"],
    ["email unsubscribed by link", { email: prefCard("off", { set_by: "unsubscribe_link", set_at: "2026-10-02T15:00:00Z", can_turn_on: true, can_turn_off: false }) }, "email", "Off · you unsubscribed using the link in an email on Oct 2, 2026"],
    ["email paused by the business", { email: prefCard("off", { set_by: "business", set_at: "2026-10-12T15:00:00Z" }) }, "email", "Paused by Northwind Studio"],
    ["email delivery problem", { email: prefCard("off", { set_by: "delivery", can_turn_off: false }) }, "email", "Off · emails to your address weren't being delivered"],
    ["email reported as spam by you", { email: prefCard("off", { set_by: "reported", set_at: "2026-10-03T15:00:00Z", can_turn_on: true, can_turn_off: false }) }, "email", "Off · you reported an email from Northwind Studio as spam on Oct 3, 2026"],
    ["texts on, recorded by the business (D7)", { sms: prefCard("on", { set_by: "business", set_at: "2026-10-10T15:00:00Z" }) }, "sms", "On · set by Northwind Studio on Oct 10, 2026"],
    ["texts on from a sign-up form", { sms: prefCard("on", { set_by: "form", set_at: "2026-10-10T15:00:00Z" }) }, "sms", "On · from a sign-up form on Oct 10, 2026"],
    ["subscribed, recorded by the business (D7)", { updates: prefUpdates("subscribed", { set_by: "business", set_at: "2026-10-09T15:00:00Z" }) }, "updates", "Subscribed · set by Northwind Studio on Oct 9, 2026"],
    ["subscribed from a sign-up form", { updates: prefUpdates("subscribed", { set_by: "form", set_at: "2026-10-09T15:00:00Z" }) }, "updates", "Subscribed · from a sign-up form on Oct 9, 2026"],
    ["unsubscribed by you", { updates: prefUpdates("not_subscribed", { set_by: "you", set_at: "2026-10-09T15:00:00Z" }) }, "updates", "Not subscribed · you unsubscribed on Oct 9, 2026"],
    ["no email address", { email: prefCard("no_address", { can_turn_off: false }), updates: prefUpdates("no_address", { can_subscribe: false }) }, "email", "No email address on file"],
    ["texts on by START", { sms: prefCard("on", { set_by: "reply", set_at: "2026-10-10T15:00:00Z" }) }, "sms", "On · you replied START on Oct 10, 2026"],
    ["texts off by STOP", { sms: prefCard("off", { set_by: "reply", set_at: "2026-10-11T15:00:00Z", can_turn_off: false }) }, "sms", "Off · you replied STOP on Oct 11, 2026"],
    ["texts off by you", { sms: prefCard("off", { set_by: "you", set_at: "2026-10-11T15:00:00Z", can_turn_off: false }) }, "sms", "Off · you turned texts off on Oct 11, 2026"],
    ["texts paused by the business", { sms: prefCard("off", { set_by: "business" }) }, "sms", "Paused by Northwind Studio"],
    ["no phone number", { sms: prefCard("no_number") }, "sms", "No phone number on file"],
    ["subscribed", { updates: prefUpdates("subscribed", { set_by: "you", set_at: "2026-10-09T15:00:00Z" }) }, "updates", "Subscribed on Oct 9, 2026"],
    ["updates paused by the business", { updates: prefUpdates("paused", { set_by: "business" }) }, "updates", "Paused by Northwind Studio"],
    ["sharing allowed", { data_sharing: { allowed: true, updated_at: "2026-10-08T15:00:00Z" } }, "sharing", "Allowed on Oct 8, 2026"],
  ])("%s", async (_label, over, key, expected) => {
    await mount(prefsPayload(over));
    expect(stateOf(key)).toBe(expected);
  });

  it("a business pause shows the warning icon, a Message link, the reason, and a Keep email off act (reviewer B2)", async () => {
    await mount(prefsPayload({ email: prefCard("off", { set_by: "business" }) }));
    expect(row("email").querySelector("svg.text-warning")).toBeTruthy();
    expect(row("email").querySelector('a[href="/app/messages"]')?.textContent).toContain("Message Northwind Studio");
    expect(row("email").querySelector('[data-testid="pref-reason"]')?.textContent).toBe("Only Northwind Studio can resume email they paused.");
    expect(button("Keep email off")).toBeTruthy();
  });

  it("once the customer has also turned it off under a business pause, says both must turn it on, once, without contradicting itself (Nice 1)", async () => {
    await mount(prefsPayload({ email: prefCard("off", { set_by: "business", can_turn_off: false }) }));
    expect(button("Keep email off")).toBeUndefined();
    expect(row("email").querySelector('[data-testid="pref-reason"]')?.textContent).toBe("Email comes back only when you and Northwind Studio both turn it back on.");
    expect(row("email").textContent).not.toContain("Only Northwind Studio can resume");
  });

  it("the customer's own spam report: their act, and they can turn email back on here (integrator default (owner may overrule))", async () => {
    await mount(prefsPayload({ email: prefCard("off", { set_by: "reported", set_at: "2026-10-03T15:00:00Z", can_turn_on: true, can_turn_off: false }) }));
    expect(switchOf("email")?.disabled).toBe(false);
    expect(row("email").querySelector('[data-testid="pref-detail"]')?.textContent).toBe("Turn email back on here if you want it again.");
    expect(row("email").textContent).not.toMatch(/delivery|provider|Message Northwind|Only Northwind/);
    expect(button("Keep email off")).toBeUndefined();
  });

  it("texts not set up: START is named once, by the disclosure, and nothing promises a text will come (should-fix 1)", async () => {
    await mount();
    expect(row("sms").textContent!.match(/START/g)).toHaveLength(1);
    expect(row("sms").textContent).toContain("reply START to a text from Northwind Studio if you have one, or ask them.");
    expect(row("sms").textContent).not.toMatch(/\bagain\b/);
  });

  it("no copy offers texts on: the no-number line only says why there are no texts (should-fix 6)", async () => {
    await mount(prefsPayload({ sms: prefCard("no_number") }));
    expect(row("sms").querySelector('[data-testid="pref-detail"]')?.textContent).toBe("Northwind Studio can't text you without a phone number.");
    expect(row("sms").textContent).not.toMatch(/choose how|turn texts on/i);
  });

  it("business-recorded consent is labelled as the business's on every channel (D7)", async () => {
    await mount(prefsPayload({ sms: prefCard("on", { set_by: "business" }), updates: prefUpdates("subscribed", { set_by: "business" }) }));
    expect(stateOf("sms")).toBe("On · set by Northwind Studio");
    expect(stateOf("updates")).toBe("Subscribed · set by Northwind Studio");
  });

  it("quiet hours copy depends on whether the business knows the customer's time zone (reviewer M3)", async () => {
    await mount(prefsPayload({ sms: prefCard("on", { set_by: "reply" }), quiet_hours: { start: "20:00", end: "08:00", time_zone_known: true, fallback_time_zone: null } }));
    expect(row("sms").textContent).toContain("Texts through Paige only arrive between 8am and 8pm your time.");
    act(() => root.unmount()); root = createRoot(host);
    await mount(prefsPayload({ sms: prefCard("on", { set_by: "reply" }) }));
    expect(row("sms").querySelector('[data-testid="pref-detail"]')?.textContent).toBe("Northwind Studio doesn't have your time zone, so texts through Paige are held from 8pm to 8am Eastern Time.");
    expect(row("sms").textContent).not.toContain("your time.");
    // The zone is the server's: the business's own texting zone when the send check would use it (minor 4).
    act(() => root.unmount()); root = createRoot(host);
    await mount(prefsPayload({ sms: prefCard("on", { set_by: "reply" }), quiet_hours: { start: "20:00", end: "08:00", time_zone_known: false, fallback_time_zone: "America/Chicago" } }));
    expect(row("sms").querySelector('[data-testid="pref-detail"]')?.textContent).toBe("Northwind Studio doesn't have your time zone, so texts through Paige are held from 8pm to 8am Central Time.");
  });

  it("Updates stays off while email is off, and says why", async () => {
    await mount(prefsPayload({ email: prefCard("off", { set_by: "you", can_turn_on: true, can_turn_off: false }), updates: prefUpdates("not_subscribed", { can_subscribe: false }) }));
    expect(switchOf("updates")?.disabled).toBe(true);
    expect(row("updates").querySelector('[data-testid="pref-reason"]')?.textContent).toBe("Turn on email first.");
  });

  it("every disabled switch carries a visible reason it is described by", async () => {
    const payloads = [
      prefsPayload(),
      prefsPayload({ email: prefCard("off", { set_by: "business" }), sms: prefCard("off", { set_by: "you", can_turn_off: false }), updates: prefUpdates("paused", { set_by: "business" }) }),
      prefsPayload({ email: prefCard("off", { set_by: "delivery", can_turn_off: false }), sms: prefCard("off", { set_by: "reply" }), updates: prefUpdates("not_subscribed", { can_subscribe: false }) }),
      prefsPayload({ email: prefCard("on", { can_turn_off: false }), sms: prefCard("on", { can_turn_off: false }), updates: prefUpdates("subscribed", { can_unsubscribe: false }) }),
    ];
    let checked = 0;
    for (const p of payloads) {
      act(() => root.unmount()); root = createRoot(host);
      await mount(p);
      for (const sw of host.querySelectorAll<HTMLButtonElement>('[role="switch"]')) {
        if (!sw.disabled) continue;
        const ids = (sw.getAttribute("aria-describedby") ?? "").split(" ");
        const reason = ids.map(id => document.getElementById(id)).find(el => el?.getAttribute("data-testid") === "pref-reason");
        expect(reason?.textContent?.trim(), `switch ${sw.getAttribute("aria-label")}`).toBeTruthy();
        checked++;
      }
    }
    expect(checked).toBeGreaterThanOrEqual(8);
  });

  it("shows each card's server-held disclosure sentence under its id", async () => {
    await mount();
    const shown = Array.from(host.querySelectorAll<HTMLElement>("[data-disclosure]")).map(el => [el.dataset.disclosure, el.textContent]);
    expect(shown).toEqual((["email-pref:v2", "sms-pref:v2", "updates-optin:v2", "data-sharing:v1"] as PortalDisclosureId[])
      .map(id => [id, disclosureText(id, "Northwind Studio")]));
    // v1 of email, updates and texts stay known (old evidence names them) but are never shown.
    expect(Object.keys(PORTAL_PREFERENCE_DISCLOSURES)).toHaveLength(7);
  });

  it("section headings sit visibly above row labels (should-fix 8)", async () => {
    await mount();
    const h2 = host.querySelector("#client-preferences-title")!;
    const label = row("email").querySelector('[data-testid="pref-label"]')!;
    expect(h2.className).toContain("text-lg");
    expect(label.className).not.toMatch(/text-lg|text-base font-semibold/);
  });

  it("spends no gold: nothing here is an act of approval (§11)", async () => {
    await mount(prefsPayload({ email: prefCard("off", { set_by: "business" }) }));
    expect(host.innerHTML).not.toMatch(/\bgold\b|bg-accent|text-accent|border-accent/);
  });
});

describe("changing a preference", () => {
  it("turns email off through the writer, pinned to the business and the verified token, and says so only after a fresh read shows it", async () => {
    await mount();
    const off = prefsPayload({ email: prefCard("off", { set_by: "you", set_at: "2026-10-18T12:01:00Z", can_turn_on: true, can_turn_off: false }) });
    writeAnswer = () => { current = off; return { data: { ok: true, replayed: false, preferences: off }, error: null }; };
    const before = reads().length;
    act(() => switchOf("email")!.click()); await flush();
    expect(writes()).toEqual([["client_portal_set_communication_preference", { p_channel: "email", p_topic: null, p_enabled: false, p_tenant_id: PREF_TENANT }]]);
    expect(headers).toContainEqual(["client_portal_set_communication_preference", "Authorization", `Bearer token-${PREF_ACTOR}`]);
    expect(reads().length).toBe(before + 1);
    expect(reads().at(-1)![1]).toEqual({ p_tenant_id: PREF_TENANT });
    expect(stateOf("email")).toBe("Off · you turned email off on Oct 18, 2026");
    expect(row("email").querySelector('[data-testid="pref-notice"]')?.textContent).toBe("Email is off.");
    expect(committed).toHaveBeenCalledWith("email");
  });

  it("an acknowledgement the fresh read does not bear out is never reported as saved (§70.1)", async () => {
    await mount();
    writeAnswer = () => ({ data: { ok: true, replayed: false, preferences: prefsPayload({ email: prefCard("off", { set_by: "you" }) }) }, error: null });
    act(() => switchOf("email")!.click()); await flush();
    expect(stateOf("email")).toBe("On");
    expect(row("email").querySelector('[data-testid="pref-notice"]')?.textContent).toContain("We couldn't confirm that change.");
    expect(committed).not.toHaveBeenCalled();
  });

  it("subscribes to Updates with the newsletter topic", async () => {
    await mount();
    const sub = prefsPayload({ updates: prefUpdates("subscribed", { set_by: "you", set_at: "2026-10-18T12:01:00Z" }) });
    writeAnswer = () => { current = sub; return { data: { ok: true, replayed: false, preferences: sub }, error: null }; };
    act(() => switchOf("updates")!.click()); await flush();
    expect(writes()[0]).toEqual(["client_portal_set_communication_preference", { p_channel: "email", p_topic: "newsletter", p_enabled: true, p_tenant_id: PREF_TENANT }]);
    expect(stateOf("updates")).toBe("Subscribed on Oct 18, 2026");
  });

  it("records texts off from the not-set-up state with Don't text me", async () => {
    await mount();
    const off = prefsPayload({ sms: prefCard("off", { set_by: "you", set_at: "2026-10-18T12:01:00Z", can_turn_off: false }) });
    writeAnswer = () => { current = off; return { data: { ok: true, replayed: false, preferences: off }, error: null }; };
    act(() => button("Don't text me")!.click()); await flush();
    expect(writes()[0]).toEqual(["client_portal_set_communication_preference", { p_channel: "sms", p_topic: null, p_enabled: false, p_tenant_id: PREF_TENANT }]);
    expect(stateOf("sms")).toBe("Off · you turned texts off on Oct 18, 2026");
  });

  it("names a refusal and repaints from what the server says now", async () => {
    await mount();
    const now = prefsPayload({ email: prefCard("off", { set_by: "business" }), updates: prefUpdates("not_subscribed", { can_subscribe: false }) });
    writeAnswer = () => { current = now; return { data: { ok: false, error: "EMAIL_OFF", preferences: now }, error: null }; };
    act(() => switchOf("updates")!.click()); await flush();
    expect(row("updates").querySelector('[data-testid="pref-notice"]')?.textContent).toBe("Turn on email first.");
    expect(stateOf("email")).toBe("Paused by Northwind Studio");
    expect(committed).not.toHaveBeenCalled();
  });

  it("a retired refusal code (EMAIL_REPORTED) is never named: it reads as an unknown refusal", () => {
    expect(preferenceRefusal({ ok: false, error: "EMAIL_REPORTED" }, null)).toBe("OTHER");
  });

  it.each([
    ["EMAIL_PAUSED_BY_BUSINESS", "Northwind Studio paused email to you, so it stays off. Ask them to resume it."],
    ["EMAIL_UNDELIVERABLE", "Emails to your address weren't being delivered, so email stays off. Ask Northwind Studio to check your address."],
    ["EMAIL_OFF", "Turn on email first."],
    ["NO_EMAIL_ADDRESS", "Northwind Studio needs an email address for you first."],
    ["SMS_OPT_IN_UNAVAILABLE", "Texts can't be turned on from your account."],
    ["BAD_PREFERENCE", "That change isn't available. Reload the page and try again."],
    ["OTHER", "That change wasn't made. Try again."],
  ] as const)("refusal %s reads in plain words", (code, text) => {
    expect(refusalText(code, "Northwind Studio")).toBe(text);
  });

  it("allows data sharing through its own writer", async () => {
    await mount();
    const on = prefsPayload({ data_sharing: { allowed: true, updated_at: "2026-10-18T12:01:00Z" } });
    writeAnswer = () => { current = on; return { data: { ok: true, replayed: false, preferences: on }, error: null }; };
    act(() => switchOf("sharing")!.click()); await flush();
    expect(writes()).toEqual([["client_portal_set_shared_context_consent", { p_allow: true, p_tenant_id: PREF_TENANT }]]);
    expect(stateOf("sharing")).toBe("Allowed on Oct 18, 2026");
    expect(committed).toHaveBeenCalledWith("sharing");
  });

  it("one change at a time: while a write is out, a second click dispatches nothing and the row says Saving", async () => {
    await mount();
    const pending = deferred<Result>();
    writeAnswer = () => pending.promise;
    act(() => switchOf("email")!.click()); await flush();
    expect(stateOf("email")).toBe("Saving…");
    expect(switchOf("updates")?.disabled).toBe(true);
    act(() => switchOf("email")!.click()); act(() => switchOf("sharing")!.click()); await flush();
    expect(writes()).toHaveLength(1);
    pending.resolve({ data: { ok: true, replayed: true, preferences: current }, error: null }); await flush();
  });

  it("never writes under another account's token", async () => {
    await mount();
    signedIn = "e0960000-0000-4000-8000-00000000c002";
    act(() => switchOf("email")!.click()); await flush();
    expect(writes()).toHaveLength(0);
    expect(host.textContent).toContain("Sign in with your invited account to see your preferences.");
  });
});

describe("reading", () => {
  it("loading, then ready", async () => {
    const slow = deferred<Result>(); readQueue = [slow.promise];
    await mount();
    expect(host.querySelector('[data-testid="preferences-loading"]')).toBeTruthy();
    slow.resolve({ data: prefsPayload(), error: null }); await flush();
    expect(stateOf("email")).toBe("On");
  });

  it.each([
    ["no relationship", { data: null, error: null }, "Your preferences aren't available for this business."],
    ["more than one business", { data: null, error: { code: "42501", message: "select an authorized customer relationship" } }, "Your account is linked to more than one business"],
    ["a widened answer", { data: { ...prefsPayload(), email_address: "jordan@example.test" }, error: null }, "Your preferences couldn't be loaded."],
    ["a network failure", { data: null, error: { code: "PGRST000", message: "network" } }, "Your preferences couldn't be loaded."],
  ])("%s", async (_label, answer, text) => {
    readQueue = [answer as Result];
    await mount();
    expect(host.textContent).toContain(text);
    expect(host.querySelector('[role="switch"]')).toBeNull();
    expect(host.textContent).not.toContain("jordan@example.test");
  });

  it("a different signed-in account never sees this one's preferences", async () => {
    signedIn = "e0960000-0000-4000-8000-00000000c002";
    await mount();
    expect(reads()).toHaveLength(0);
    expect(host.querySelector('[role="switch"]')).toBeNull();
  });

  it("re-reads on focus, pinned to the first business, and keeps the cards with a notice when the refresh fails", async () => {
    await mount();
    expect(reads()[0][1]).toEqual({});
    readQueue = [{ data: null, error: { code: "PGRST000", message: "network" } }];
    act(() => { window.dispatchEvent(new Event("focus")); }); await flush();
    expect(reads().at(-1)![1]).toEqual({ p_tenant_id: PREF_TENANT });
    expect(host.textContent).toContain("We couldn't refresh your preferences, so they may be out of date.");
    expect(stateOf("email")).toBe("On");
  });

  it("refuses an answer for another business after the page is pinned", async () => {
    await mount();
    readQueue = [{ data: prefsPayload({ tenant_id: PREF_OTHER_TENANT, business_name: "Other Co" }), error: null }];
    act(() => { window.dispatchEvent(new Event("focus")); }); await flush();
    expect(host.textContent).not.toContain("Other Co");
    expect(host.textContent).toContain("may be out of date");
  });
});
