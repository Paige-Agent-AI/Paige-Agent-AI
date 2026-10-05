// @vitest-environment jsdom
// Email series (E3), driven through the real dashboard and series view with only the Supabase client stubbed:
// which RPC each act calls, with what, and what the owner reads back. Nothing here reaches a database.
import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Call = { fn: string; args: Record<string, unknown> };
const calls: Call[] = [];
type Answer = { data: unknown; error: unknown };
const answers: Record<string, Answer | ((args: Record<string, unknown>) => Promise<Answer>)> = {};
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (fn: string, args: Record<string, unknown> = {}) => {
      calls.push({ fn, args });
      const a = answers[fn];
      return typeof a === "function" ? a(args) : Promise.resolve(a ?? { data: null, error: null });
    },
    from: () => { const c: Record<string, unknown> = {}; for (const m of ["select", "eq", "order", "limit"]) c[m] = () => c; c.then = (r: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(r); return c; },
  },
}));
vi.mock("./marketing-overview-charts", () => ({ EmailRatesChart: () => <div data-chart="rates"/> }));

import { MarketingEmail } from "./marketing-email";

const dashboard = {
  period_days: 30, time_zone: "UTC", generated_at: "2026-10-05T00:00:00Z",
  stats: { sent: 0, sent_prev: 0, tracked: 0, tracked_prev: 0, opened: 0, opened_prev: 0, clicked: 0, clicked_prev: 0, bounced: 0, conversions: 0, conversions_prev: 0, new_subscribers: 0, new_subscribers_prev: 0, unsubscribes: 0 },
  series: [], campaign_count: 0, campaigns: [],
  audience: { contacts: 10, with_email: 9, new_leads: 4, customers: 3, inactive_90: 1, newsletter_subscribers: 5 },
  segment_count: 0, segments: [], activity: [],
  sending: { daily_cap: 500, used_last_24h: 0, remaining_today: 500, postal_address_set: true },
};
const steps = [
  { position: 1, delay_minutes: 0, subject: "Welcome aboard", preheader: "Here is what happens next", body_html: "<p>Hi there,</p>" },
  { position: 2, delay_minutes: 2880, subject: "How we work", preheader: "", body_html: "<p>Every engagement starts with a session.</p>" },
  { position: 3, delay_minutes: 7200, subject: "", preheader: "", body_html: "" },
];
const seriesRead = (over: { status?: string; state?: string; live?: boolean; changing?: boolean; postal?: boolean; people?: Partial<{ in_now: number; completed: number; left: number }> } = {}) => {
  const status = over.status ?? "draft", state = over.state ?? "draft";
  return {
    sequence: { id: "q-1", name: "Welcome series", kind: "welcome", status, blocked_reason: status === "blocked" ? "sender_needs_attention" : null,
      activated_at: over.live ? "2026-10-01T00:00:00Z" : null, stopped_at: null, created_at: "2026-10-01T00:00:00Z", updated_at: "2026-10-05T00:00:00Z",
      live_version_id: over.live ? "v-live" : null },
    version: { id: "v-1", version_no: 1, state, entry_mode: "new_contacts", audience: { stages: ["new_lead", "lead"] }, segment_id: null, segment_name: null,
      exit_on_goal: "none", exit_when_unmatched: false, sender: { mode: "managed" }, sender_snapshot: state === "draft" ? null : { mode: "managed", from_address: "biz@mail.example", ok: true },
      expected_entrants: null, approval_id: state === "locked" ? "a-1" : null, approved_at: null, steps },
    live: over.changing ? { id: "v-live", version_no: 1, entry_mode: "new_contacts", steps: steps.map(({ position, delay_minutes, subject }) => ({ position, delay_minutes, subject })) } : null,
    approval: state === "locked" ? { status: "pending", source: "owner" } : null, last_declined: null,
    entry_preview: { matched: 7, eligible: 6, eligible_new: 6, no_address: 1, opted_out: 0, suppressed: 0 },
    emails: over.live ? [
      { position: 1, sent: 20, tracked: 20, opened: 10, clicked: 2, waiting: 0, next_at: null, not_delivered: 0, skipped: 0 },
      { position: 2, sent: 12, tracked: 12, opened: 6, clicked: 1, waiting: 5, next_at: "2099-01-01T15:00:00Z", not_delivered: 0, skipped: 0 },
    ] : [],
    people: { in_now: 8, completed: 9, left: 3, by_email: { "2": 5 }, left_because: { reached_goal: 2, suppressed: 1 }, recent: [], ...(over.people ?? {}) },
    senders: [], managed_sender: { ok: true, mode: "managed", from_address: "biz@mail.example", from_name: "Biz" },
    resolves: { ok: true, mode: "managed", from_address: "biz@mail.example" },
    postal_address: over.postal === false ? null : "1 Main St", business_name: "Biz", segments: [],
    choices: { stages: [{ key: "new_lead", count: 4 }, { key: "lead", count: 3 }], sources: [], tags: [] },
    sending: { daily_cap: 500, used_last_24h: 0, remaining_today: 500 },
  };
};

let host: HTMLDivElement;
let root: Root;
const flush = async (n = 10) => { await act(async () => { for (let i = 0; i < n; i++) await Promise.resolve(); }); };
const text = () => host.textContent ?? "";
const button = (label: string | RegExp) => Array.from(host.querySelectorAll("button")).find((b) => (typeof label === "string" ? b.textContent?.trim() === label : label.test(b.textContent ?? "")));
const mount = async () => { act(() => root.render(<MarketingEmail tenantId="t-1" onOpenAudience={() => {}} onOpenConnections={null} onOpenSettings={() => {}}/>)); await flush(); };
const openSeries = async (read: ReturnType<typeof seriesRead>) => {
  answers.read_email_sequence = { data: read, error: null };
  window.history.replaceState(null, "", "/solo/1/growth/email?series=q-1");
  await mount();
};
const type = async (el: HTMLInputElement | HTMLTextAreaElement, value: string) => {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(el, value);
  await act(async () => { el.dispatchEvent(new Event("input", { bubbles: true })); });
};
const labelled = (label: string) => Array.from(host.querySelectorAll("label")).find((l) => l.querySelector("span")?.textContent === label)?.querySelector("input,textarea") as HTMLInputElement | HTMLTextAreaElement;

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  calls.length = 0;
  for (const k of Object.keys(answers)) delete answers[k];
  answers.read_email_marketing_dashboard = { data: dashboard, error: null };
  answers.read_email_sequences = { data: { sequences: [] }, error: null };
  answers.email_audience_preview = { data: { matched: 7, eligible: 6, no_address: 1, opted_out: 0, suppressed: 0, no_consent: 0, daily_cap: 500, remaining_today: 500, postal_address_set: true }, error: null };
  window.history.replaceState(null, "", "/solo/1/growth/email");
  host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.useRealTimers(); vi.restoreAllMocks(); });

describe("Automations panel", () => {
  it("offers three series starters when there are none, and a starter creates the series and opens it", async () => {
    answers.email_sequence_create = { data: { sequence_id: "q-1", version_id: "v-1" }, error: null };
    answers.read_email_sequence = { data: seriesRead(), error: null };
    await mount();
    expect(text()).not.toContain("No automations yet");
    expect(text()).toContain("Email series that send by themselves once you approve them.");
    for (const t of ["Welcome new contacts", "Nurture leads", "Win back quiet contacts"]) expect(button(new RegExp(t))).toBeTruthy();
    await act(async () => { button(/Win back quiet contacts/)!.click(); });
    await flush();
    expect(calls.find((c) => c.fn === "email_sequence_create")?.args).toEqual({ p_kind: "reengagement" });
    expect(calls.find((c) => c.fn === "read_email_sequence")?.args).toEqual({ p_sequence_id: "q-1" });
    expect(new URL(window.location.href).searchParams.get("series")).toBe("q-1");
  });

  it("lists running series with what matters for each", async () => {
    answers.read_email_sequences = { data: { sequences: [
      { id: "q-1", name: "Welcome series", kind: "welcome", status: "active", blocked_reason: null, emails: 3, entry_mode: "new_contacts", change_state: null, in_now: 18, entered: 64, sent_30d: 151, next_send_at: null, activated_at: "2026-10-01T00:00:00Z", updated_at: "2026-10-05T00:00:00Z" },
      { id: "q-2", name: "Win back", kind: "reengagement", status: "blocked", blocked_reason: "postal_address_missing", emails: 3, entry_mode: "matching", change_state: null, in_now: 4, entered: 9, sent_30d: 2, next_send_at: null, activated_at: "2026-10-01T00:00:00Z", updated_at: "2026-10-04T00:00:00Z" },
    ] }, error: null };
    await mount();
    expect(text()).toContain("Running");
    expect(text()).toContain("18 in it now");
    expect(text()).toContain("151 sent in 30 days");
    expect(text()).toContain("Needs attention");
  });

  it("the nurture starter in Start creating makes a real series now", async () => {
    answers.email_sequence_create = { data: { sequence_id: "q-1", version_id: "v-1" }, error: null };
    answers.read_email_sequence = { data: seriesRead(), error: null };
    await mount();
    await act(async () => { button(/Plan a nurture series/)!.click(); });
    await flush();
    expect(calls.find((c) => c.fn === "email_sequence_create")?.args).toEqual({ p_kind: "nurture" });
    expect(text()).not.toContain("come later");
  });
});

describe("Series view", () => {
  it("shows each email with its wait in words and where it lands", async () => {
    await openSeries(seriesRead());
    expect(text()).toContain("Right away");
    expect(text()).toContain("2 days later");
    expect(text()).toContain("5 days later");
    expect(text()).toContain("about day 7");
    expect(text()).toContain("3 of up to 10");
    expect(text()).toContain("Starts empty. Contacts added from now on who match join it.");
  });

  it("saves an edited email through step_save with its position and the markup turned into HTML", async () => {
    await openSeries(seriesRead());
    vi.useFakeTimers();
    await act(async () => { (host.querySelector('[aria-label^="Email 2: How we work"]') as HTMLButtonElement).click(); });
    await type(labelled("Subject"), "How we work with clients");
    await act(async () => { vi.advanceTimersByTime(900); });
    vi.useRealTimers();
    await flush();
    const save = calls.find((c) => c.fn === "email_sequence_step_save");
    expect(save?.args).toMatchObject({ p_sequence_id: "q-1", p_position: 2, p_subject: "How we work with clients", p_delay_minutes: 2880 });
    expect(String(save?.args.p_body_html)).toContain("Every engagement starts with a session.");
    expect(calls.some((c) => c.fn === "email_sequence_update_draft")).toBe(false);
  });

  it("files the series for approval after saving what is pending, and says which email is incomplete", async () => {
    answers.email_sequence_request_approval = { data: null, error: { message: "step_incomplete", details: "Email 3 needs a subject and words." } };
    await openSeries(seriesRead());
    await act(async () => { button("Review and start")!.click(); });
    await flush();
    expect(calls.find((c) => c.fn === "email_sequence_request_approval")?.args).toEqual({ p_sequence_id: "q-1", p_source: "owner" });
    expect(text()).toContain("Email 3 needs a subject and words.");
  });

  it("cannot be filed without a postal address, and says where to add it", async () => {
    await openSeries(seriesRead({ postal: false }));
    expect(button("Review and start")!.disabled).toBe(true);
    expect(text()).toContain("Settings › Connections › Registration");
  });

  it("the one approval: Approve and start is the only gold button, and approves the filed version", async () => {
    answers.email_sequence_approve = { data: { status: "active" }, error: null };
    await openSeries(seriesRead({ status: "pending_approval", state: "locked" }));
    expect(text()).toContain("Ready to start");
    expect(text()).toContain("Start “Welcome series”: 3 emails to new contacts as they arrive.");
    expect(host.querySelectorAll(".btn-g")).toHaveLength(1);
    expect(button("Approve and start")!.className).toContain("btn-g");
    expect(button("Review and start")).toBeUndefined();
    await act(async () => { button("Approve and start")!.click(); });
    await flush();
    expect(calls.find((c) => c.fn === "email_sequence_approve")?.args).toEqual({ p_version_id: "v-1" });
  });

  it("Not now takes an optional note and returns the series to a draft", async () => {
    await openSeries(seriesRead({ status: "pending_approval", state: "locked" }));
    await act(async () => { button("Not now")!.click(); });
    await type(labelled("What should change? (optional)") as HTMLInputElement, "Shorter second email");
    await act(async () => { button("Not now, back to draft")!.click(); });
    await flush();
    expect(calls.find((c) => c.fn === "email_sequence_decline")?.args).toEqual({ p_version_id: "v-1", p_reason: "Shorter second email" });
  });

  it("a running series shows where people are and why they left, and pauses", async () => {
    await openSeries(seriesRead({ status: "active", state: "approved", live: true }));
    expect(text()).toContain("Running");
    expect(text()).toContain("In it now");
    expect(text()).toContain("Reached the goal");
    expect(text()).toContain("Finished every email");
    expect(text()).toContain("5 waiting for this email");
    expect(button("Review and start")).toBeUndefined();
    await act(async () => { button(/Pause/)!.click(); });
    await flush();
    expect(calls.find((c) => c.fn === "email_sequence_pause")?.args).toEqual({ p_sequence_id: "q-1" });
  });

  it("Stop asks first, and stops only when confirmed", async () => {
    await openSeries(seriesRead({ status: "active", state: "approved", live: true }));
    const confirm = vi.spyOn(window, "confirm").mockReturnValueOnce(false).mockReturnValueOnce(true);
    await act(async () => { button("Stop")!.click(); });
    await flush();
    expect(calls.some((c) => c.fn === "email_sequence_stop")).toBe(false);
    expect(confirm.mock.calls[0][0]).toContain("can’t be undone");
    await act(async () => { button("Stop")!.click(); });
    await flush();
    expect(calls.find((c) => c.fn === "email_sequence_stop")?.args).toEqual({ p_sequence_id: "q-1" });
  });

  it("Edit on a running series makes a new draft; the running one keeps sending", async () => {
    await openSeries(seriesRead({ status: "active", state: "approved", live: true }));
    await act(async () => { button(/Edit/)!.click(); });
    await flush();
    expect(calls.find((c) => c.fn === "email_sequence_edit")?.args).toEqual({ p_sequence_id: "q-1" });
    act(() => root.unmount()); root = createRoot(host);
    await openSeries(seriesRead({ status: "active", state: "draft", live: true, changing: true }));
    expect(text()).toContain("You’re editing a new version.");
    expect(text()).toContain("The running version keeps sending until you approve this one.");
    expect(button("Review changes")).toBeTruthy();
    expect(button("Discard changes")).toBeTruthy();
  });

  it("Add an email appends one through step_save and re-reads the series", async () => {
    answers.email_sequence_step_save = { data: { version_id: "v-1", position: 4, steps: 4 }, error: null };
    await openSeries(seriesRead());
    const reads = calls.filter((c) => c.fn === "read_email_sequence").length;
    await act(async () => { button(/Add an email/)!.click(); });
    await flush();
    expect(calls.find((c) => c.fn === "email_sequence_step_save")?.args).toEqual({ p_sequence_id: "q-1" });
    expect(calls.filter((c) => c.fn === "read_email_sequence").length).toBe(reads + 1);
  });

  it("a member or another business is refused in the owner's words", async () => {
    answers.read_email_sequence = { data: null, error: { message: "series_not_found" } };
    window.history.replaceState(null, "", "/solo/1/growth/email?series=q-9");
    await mount();
    expect(text()).toContain("This series no longer exists");
  });
});
