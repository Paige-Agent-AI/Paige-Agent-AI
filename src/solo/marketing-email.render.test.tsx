// @vitest-environment jsdom
// Marketing › Email, driven through its real views with only the Supabase client stubbed: which RPC each
// act calls, with what, and what the owner reads back. Nothing here reaches a database.
import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Call = { fn: string; args: Record<string, unknown> };
const calls: Call[] = [];
const answers: Record<string, { data: unknown; error: unknown }> = {};
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (fn: string, args: Record<string, unknown> = {}) => { calls.push({ fn, args }); return Promise.resolve(answers[fn] ?? { data: null, error: null }); },
    from: () => { const c: Record<string, unknown> = {}; for (const m of ["select", "eq", "order", "limit"]) c[m] = () => c; c.then = (r: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(r); return c; },
  },
}));
// The chart is covered by the harness frames; here it would only need a layout engine.
vi.mock("./marketing-overview-charts", () => ({ EmailRatesChart: () => <div data-chart="rates"/> }));

import { MarketingEmail } from "./marketing-email";

const dashboard = {
  period_days: 30, time_zone: "UTC", generated_at: "2026-10-04T00:00:00Z",
  stats: { sent: 100, sent_prev: 0, tracked: 80, tracked_prev: 0, opened: 40, opened_prev: 0, clicked: 8, clicked_prev: 0, bounced: 0, conversions: 2, conversions_prev: 1, new_subscribers: 3, new_subscribers_prev: 0, unsubscribes: 0 },
  series: [{ day: "2026-10-03", sent: 100, tracked: 80, opened: 40, clicked: 8 }],
  campaign_count: 1,
  campaigns: [{ id: "c-1", name: "October news", kind: "newsletter", status: "completed", blocked_reason: null, updated_at: "2026-10-03T00:00:00Z", version_id: "v-1", version_state: "sent", subject: "Hello", scheduled_for: null, segment_name: null, conversion_goal: "none", recipients: 100, first_sent_at: "2026-10-03T00:00:00Z", last_sent_at: "2026-10-03T00:00:00Z", sent: 100, tracked: 80, opened: 40, clicked: 8, failed: 0, not_confirmed: 0, skipped: 0, waiting: 0 }],
  audience: { contacts: 10, with_email: 9, new_leads: 4, customers: 3, inactive_90: 1, newsletter_subscribers: 5 },
  segment_count: 0, segments: [], activity: [],
  sending: { daily_cap: 500, used_last_24h: 100, remaining_today: 400, postal_address_set: true },
};
const campaignRead = (status = "draft", state = "draft") => ({
  campaign: { id: "c-new", name: "Untitled campaign", kind: "standard", status, blocked_reason: null, updated_at: "2026-10-04T00:00:00Z" },
  version: { id: "v-new", version_no: 1, state, subject: "", preheader: "", body_html: "", sender: { mode: "managed" }, sender_snapshot: null,
    audience: {}, segment_id: null, scheduled_for: null, conversion_goal: "none", expected_recipients: state === "locked" ? 12 : null, cost_bound_usd: state === "locked" ? 0.0048 : null, approval_id: null, approved_at: null },
  approval: null, last_declined: null,
  progress: { total: 0, planned: 0, sending: 0, sent: 0, failed: 0, not_confirmed: 0, skipped: 0, cancelled: 0, tracked: 0, opened: 0, clicked: 0 },
  senders: [], managed_sender: { ok: true, mode: "managed", from_address: "biz@mail.example", from_name: "Biz" },
  resolves: { ok: true, mode: "managed", from_address: "biz@mail.example" },
  postal_address: "1 Main St", business_name: "Biz", segments: [], choices: { stages: [{ key: "new_lead", count: 4 }], sources: [], tags: [] },
});

let host: HTMLDivElement;
let root: Root;
const flush = async (n = 8) => { await act(async () => { for (let i = 0; i < n; i++) await Promise.resolve(); }); };
const text = () => host.textContent ?? "";
const button = (label: string | RegExp) => Array.from(host.querySelectorAll("button")).find((b) => (typeof label === "string" ? b.textContent?.trim() === label : label.test(b.textContent ?? "")));
const mount = async () => { act(() => root.render(<MarketingEmail tenantId="t-1" onOpenAudience={() => {}} onOpenConnections={null} onOpenSettings={null}/>)); await flush(); };
const type = async (el: HTMLInputElement | HTMLTextAreaElement, value: string) => {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(el, value);
  await act(async () => { el.dispatchEvent(new Event("input", { bubbles: true })); });
};

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  calls.length = 0;
  for (const k of Object.keys(answers)) delete answers[k];
  answers.read_email_marketing_dashboard = { data: dashboard, error: null };
  window.history.replaceState(null, "", "/solo/1/growth/email");
  host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.useRealTimers(); });

describe("Marketing › Email dashboard", () => {
  it("reads the dashboard for the chosen period in the viewer's time zone", async () => {
    await mount();
    const read = calls.find((c) => c.fn === "read_email_marketing_dashboard");
    expect(read?.args.p_days).toBe(30);
    expect(typeof read?.args.p_tz).toBe("string");
    expect(text()).toContain("50%"); // 40 opened of 80 tracked
    expect(text()).toContain("The 20 sent through your own mail server do not report opens or clicks");
    await act(async () => { button("Last 7 days")!.click(); });
    await flush();
    expect(calls.filter((c) => c.fn === "read_email_marketing_dashboard").map((c) => c.args.p_days)).toEqual([30, 7]);
  });

  it("Create a campaign makes a draft through the RPC and opens it", async () => {
    answers.email_campaign_create = { data: { campaign_id: "c-new", version_id: "v-new" }, error: null };
    answers.read_email_campaign = { data: campaignRead(), error: null };
    await mount();
    await act(async () => { button(/Create a campaign/)!.click(); });
    await flush();
    expect(calls.find((c) => c.fn === "email_campaign_create")?.args).toEqual({ p_kind: "standard", p_name: "Untitled campaign" });
    expect(window.location.search).toBe("?campaign=c-new");
    expect(calls.some((c) => c.fn === "read_email_campaign" && c.args.p_campaign_id === "c-new")).toBe(true);
    expect(text()).toContain("Review and send");
  });

  it("Re-engagement starts with contacts not reached in 90 days", async () => {
    answers.email_campaign_create = { data: { campaign_id: "c-new", version_id: "v-new" }, error: null };
    answers.read_email_campaign = { data: campaignRead(), error: null };
    await mount();
    await act(async () => { button(/Re-engagement campaign/)!.click(); });
    await flush();
    expect(calls.find((c) => c.fn === "email_campaign_update_draft")?.args).toMatchObject({ p_version_id: "v-new", p_audience: { inactive_days: 90 } });
  });

  it("a segment a campaign still uses is not deleted, and says why", async () => {
    answers.read_email_marketing_dashboard = { data: { ...dashboard, segment_count: 1, segments: [{ id: "s-1", name: "Leads", rule: { stages: ["new_lead"] }, eligible: 4, matched: 4 }] }, error: null };
    answers.email_segment_delete = { data: null, error: { message: "segment_in_use" } };
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    await mount();
    await act(async () => { host.querySelector<HTMLButtonElement>('button[aria-label^="Leads"]')!.click(); });
    await flush();
    await act(async () => { button("Delete")!.click(); });
    await flush();
    expect(calls.find((c) => c.fn === "email_segment_delete")?.args).toEqual({ p_id: "s-1" });
    expect(text()).toContain("A campaign uses this segment.");
    expect(host.querySelector('[role="dialog"]')).not.toBeNull();
    confirm.mockRestore();
  });

  it("the segment drawer keeps Tab inside it", async () => {
    await mount();
    await act(async () => { button(/New segment/)!.click(); });
    await flush();
    const dialog = host.querySelector<HTMLElement>('[role="dialog"]')!;
    const stops = Array.from(dialog.querySelectorAll<HTMLElement>("button, input")).filter((el) => !(el as HTMLButtonElement).disabled);
    stops.at(-1)!.focus();
    await act(async () => { dialog.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true })); });
    expect(document.activeElement).toBe(stops[0]);
    await act(async () => { dialog.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", shiftKey: true, bubbles: true, cancelable: true })); });
    expect(document.activeElement).toBe(stops.at(-1));
  });

  it("a refused create says why in plain words and opens nothing", async () => {
    answers.email_campaign_create = { data: null, error: { message: "not_permitted" } };
    await mount();
    await act(async () => { button(/Create a campaign/)!.click(); });
    await flush();
    expect(text()).toContain("Only an owner or admin of this business can create campaigns.");
    expect(window.location.search).toBe("");
  });
});

describe("Marketing › Email campaign editor", () => {
  it("saves what the owner writes, then Review and send saves first and requests the one approval", async () => {
    window.history.replaceState(null, "", "/solo/1/growth/email?campaign=c-new");
    answers.read_email_campaign = { data: campaignRead(), error: null };
    answers.email_audience_preview = { data: { matched: 4, eligible: 4, no_address: 0, opted_out: 0, suppressed: 0, no_consent: 0, daily_cap: 500, remaining_today: 400, postal_address_set: true }, error: null };
    vi.useFakeTimers({ shouldAdvanceTime: true });
    await mount();
    const subject = host.querySelector<HTMLInputElement>('input[placeholder="What the inbox shows first"]')!;
    await type(subject, "Spring news");
    const body = host.querySelector("textarea")!;
    await type(body, "Hi there\n\n[[Book|https://example.com/b]]");
    await act(async () => { vi.advanceTimersByTime(900); });
    await flush();
    const save = calls.filter((c) => c.fn === "email_campaign_update_draft").at(-1)!;
    expect(save.args).toMatchObject({ p_version_id: "v-new", p_subject: "Spring news", p_sender: { mode: "managed" } });
    expect(String(save.args.p_body_html)).toContain('href="https://example.com/b"');
    expect(text()).toContain("Saved");
    calls.length = 0;
    await act(async () => { button("Review and send")!.click(); });
    await flush();
    expect(calls.map((c) => c.fn)).toEqual(["email_campaign_update_draft", "email_campaign_request_approval", "read_email_campaign"]);
    expect(calls[1].args).toEqual({ p_version_id: "v-new", p_source: "owner" });
  });

  it("a version awaiting approval shows who, from and cost, and only Approve and send releases it", async () => {
    window.history.replaceState(null, "", "/solo/1/growth/email?campaign=c-new");
    answers.read_email_campaign = { data: campaignRead("pending_approval", "locked"), error: null };
    await mount();
    expect(text()).toContain("Ready to send");
    expect(text()).toContain("12 people");
    expect(text()).toContain("About less than $0.01 on PAIGE’s sender (an estimate)");
    expect(host.querySelector("textarea")?.disabled).toBe(true);
    await act(async () => { button("Approve and send")!.click(); });
    await flush();
    expect(calls.find((c) => c.fn === "email_campaign_approve")?.args).toEqual({ p_version_id: "v-new" });
    expect(button("Approve and send")!.className).toContain("btn-g");
  });

  it("Back saves an unsaved edit before leaving, and the browser asks before closing while it is unsaved", async () => {
    window.history.replaceState(null, "", "/solo/1/growth/email?campaign=c-new");
    answers.read_email_campaign = { data: campaignRead(), error: null };
    await mount();
    const subject = host.querySelector<HTMLInputElement>('input[placeholder="What the inbox shows first"]')!;
    await type(subject, "Typed then left at once");
    const ask = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(ask);
    expect(ask.defaultPrevented).toBe(true);
    calls.length = 0;
    await act(async () => { button(/^Email$/)!.click(); });
    await flush();
    expect(calls[0]).toMatchObject({ fn: "email_campaign_update_draft", args: { p_subject: "Typed then left at once" } });
    expect(window.location.search).toBe("");
    expect(calls.filter((c) => c.fn === "email_campaign_update_draft")).toHaveLength(1);
  });

  it("an edit still pending when the editor closes is saved, not dropped", async () => {
    window.history.replaceState(null, "", "/solo/1/growth/email?campaign=c-new");
    answers.read_email_campaign = { data: campaignRead(), error: null };
    await mount();
    await type(host.querySelector<HTMLInputElement>('input[placeholder="What the inbox shows first"]')!, "Closed mid-edit");
    calls.length = 0;
    act(() => root.unmount());
    root = createRoot(host);
    await flush();
    expect(calls.find((c) => c.fn === "email_campaign_update_draft")?.args).toMatchObject({ p_subject: "Closed mid-edit" });
  });

  it("the sender group is one tab stop and arrow keys choose the next sender", async () => {
    window.history.replaceState(null, "", "/solo/1/growth/email?campaign=c-new");
    const read = campaignRead();
    read.senders = [{ mode: "connector", connector_id: "g-1", provider: "gmail", from_address: "me@biz.example", from_name: null, healthy: true }] as never;
    answers.read_email_campaign = { data: read, error: null };
    await mount();
    const radios = Array.from(host.querySelectorAll<HTMLButtonElement>('[role="radio"]'));
    expect(radios.map((r) => r.tabIndex)).toEqual([-1, 0]); // managed is chosen
    radios[1].focus();
    await act(async () => { host.querySelector('[role="radiogroup"]')!.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true })); });
    expect(document.activeElement).toBe(radios[0]);
    expect(radios[0].getAttribute("aria-checked")).toBe("true");
  });

  it("a refusal from the database reads in the owner's words", async () => {
    window.history.replaceState(null, "", "/solo/1/growth/email?campaign=c-new");
    answers.read_email_campaign = { data: campaignRead(), error: null };
    answers.email_campaign_request_approval = { data: null, error: { message: "subject_required" } };
    await mount();
    await act(async () => { button("Review and send")!.click(); });
    await flush();
    expect(text()).toContain("Add a subject line first.");
  });
});
