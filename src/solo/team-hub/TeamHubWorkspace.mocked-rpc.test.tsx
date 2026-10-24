/**
 * Team Hub workspace states, driven against a MOCKED `supabase.rpc` layer.
 *
 * These are jsdom tests of the real workspace and hook with the Supabase client replaced by an
 * in-memory double shaped like the EXP08 increment-1 contract. They prove what the SCREEN does with
 * each documented answer — what renders, what is sent, what is refused before sending, where focus
 * goes. They prove nothing about the database: the SQL isolation proof is a separate suite, and
 * authenticated runtime stays UNVERIFIED until the owner-designated drive.
 */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TeamHubWorkspace } from "./TeamHubWorkspace";
import { REFRESH_INTERVAL_MS } from "./useTeamHub";

const TENANT = "tenant-a";
const ME = "u-me";

type Call = { name: string; params: Record<string, unknown> };
const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  tenantRefresh: vi.fn(),
  tenant: { id: "tenant-a" as string | null },
}));

vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: mocks.rpc } }));
vi.mock("@/hooks/useTenantContext", () => ({
  useTenantContext: () => ({
    activeTenant: mocks.tenant.id ? { id: mocks.tenant.id } : null,
    activeTenantId: mocks.tenant.id,
    activeUserId: "u-me",
    loading: false,
    accountContextStatus: "ready",
    refresh: mocks.tenantRefresh,
  }),
}));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const person = (user_id: string, display_name: string, title: string | null, permission = "member") => ({ user_id, display_name, title, permission });
const channel = (over: Record<string, unknown> = {}) => ({
  id: "c-general", kind: "channel", name: "general", visibility: "team", joined: true,
  member_count: null, member_ids: null, dm_user_id: null, unread: 0, last_message_at: null, ...over,
});
const msg = (over: Record<string, unknown> = {}) => ({
  id: "m-1", author_user_id: "u-dana", body: "Kickoff is Thursday.", created_at: new Date().toISOString(),
  parent_message_id: null, reply_count: 0, last_reply_at: null, mentions: [], ...over,
});

let db: {
  people: ReturnType<typeof person>[];
  conversations: ReturnType<typeof channel>[];
  messages: Record<string, ReturnType<typeof msg>[]>;
  /** Replies by root id, oldest → newest; the double answers newest-first like the server. */
  replies: Record<string, ReturnType<typeof msg>[]>;
  override: Record<string, (params: Record<string, unknown>) => unknown>;
};
let calls: Call[];

function backend(name: string, params: Record<string, unknown>) {
  calls.push({ name, params });
  if (db.override[name]) return db.override[name](params);
  switch (name) {
    case "team_hub_list_conversations":
      return { ok: true, tenant_id: TENANT, me: { user_id: ME }, people: db.people, conversations: db.conversations };
    case "team_hub_list_messages": {
      const conv = db.conversations.find((item) => item.id === params.p_channel_id);
      if (!conv) return { ok: false, code: "not_found" };
      const summary = { id: conv.id, kind: conv.kind, name: conv.name, visibility: conv.visibility, joined: conv.joined };
      // The compound cursor (A6): strictly older than (p_before, p_before_id), newest first.
      const page = (rows: ReturnType<typeof msg>[]) => {
        const older = rows.filter((row) => !params.p_before
          || row.created_at < String(params.p_before) || (row.created_at === params.p_before && row.id < String(params.p_before_id)));
        const newestFirst = [...older].sort((a, b) => b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id));
        const limit = Number(params.p_limit ?? 50);
        return { items: newestFirst.slice(0, limit), has_more: newestFirst.length > limit };
      };
      if (params.p_thread_root) {
        const root = (db.messages[conv.id as string] ?? []).find((item) => item.id === params.p_thread_root);
        if (!root) return { ok: false, code: "not_found" };
        const replies = page(db.replies[root.id as string] ?? []);
        return { ok: true, channel: summary, root, messages: replies.items, has_more: replies.has_more };
      }
      const top = page(db.messages[conv.id as string] ?? []);
      return { ok: true, channel: summary, messages: top.items, has_more: top.has_more };
    }
    case "team_hub_mark_read":
      return { ok: true };
    case "team_hub_post_message":
      return { ok: true, duplicate: false, message: msg({ id: `m-${calls.length}`, author_user_id: ME, body: String(params.p_body).trim(), mentions: params.p_mention_ids }) };
    default:
      return { ok: false, code: "invalid" };
  }
}

beforeEach(() => {
  document.body.innerHTML = "";
  calls = [];
  mocks.tenant.id = TENANT;
  mocks.tenantRefresh.mockReset();
  mocks.rpc.mockReset();
  mocks.rpc.mockImplementation(async (name: string, params: Record<string, unknown>) => ({ data: backend(name, params), error: null }));
  db = {
    people: [person(ME, "Morgan Hale", null, "owner"), person("u-dana", "Dana Reyes", "Client lead"),
      person("u-sam-d", "Sam Lee", "Designer"), person("u-sam-s", "Sam Lee", "Sales")],
    conversations: [channel()],
    messages: { "c-general": [msg()] },
    replies: {},
    override: {},
  };
  Object.defineProperty(navigator, "onLine", { configurable: true, get: () => true });
});

const mounted: Array<ReturnType<typeof createRoot>> = [];
afterEach(async () => {
  // Unmount every hub so its focus/online listeners and interval never leak into the next test.
  for (const root of mounted.splice(0)) await act(async () => root.unmount());
  vi.restoreAllMocks();
});

async function flush() {
  for (let index = 0; index < 6; index += 1) {
    await act(async () => { await Promise.resolve(); });
    await act(async () => { await new Promise((resolve) => window.requestAnimationFrame(() => resolve(undefined))); });
  }
}

async function mount(props: { onOpenTeamSettings?: () => void } = {}) {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  mounted.push(root);
  await act(async () => root.render(<TeamHubWorkspace {...props} />));
  await flush();
  return { host, root };
}

const composer = (host: HTMLElement) => host.querySelector<HTMLTextAreaElement>("textarea[role=combobox]")!;
const button = (host: HTMLElement, name: string | RegExp) => Array.from(host.querySelectorAll("button"))
  .find((item) => typeof name === "string" ? item.textContent?.trim() === name || item.getAttribute("aria-label") === name : name.test(item.textContent ?? ""));

async function type(element: HTMLTextAreaElement, value: string) {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
    setter.call(element, value);
    element.setSelectionRange(value.length, value.length);
    element.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function press(element: HTMLElement, key: string, init: KeyboardEventInit = {}) {
  await act(async () => { element.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init })); });
}

/** jsdom lays nothing out; give the hub a measured width (390 = a phone) for one-column tests. */
function hubWidth(width: number) {
  const real = HTMLElement.prototype.getBoundingClientRect;
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    return this.classList.contains("th-hub") ? ({ width, height: 800, top: 0, left: 0, right: width, bottom: 800, x: 0, y: 0, toJSON: () => ({}) } as DOMRect) : real.call(this);
  });
}
const marks = () => calls.filter((call) => call.name === "team_hub_mark_read");
const liveRegion = (host: HTMLElement) => host.querySelector<HTMLElement>("[aria-live=polite]")!;
const at = (minutesAgo: number) => new Date(Date.now() - minutesAgo * 60_000).toISOString();

describe("Team Hub workspace (mocked RPC)", () => {
  it("passes the active workspace as p_expected_tenant on every call", async () => {
    const { host } = await mount();
    expect(host.textContent).toContain("Kickoff is Thursday.");
    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) expect(call.params.p_expected_tenant).toBe(TENANT);
    expect(calls.map((call) => call.name)).toEqual(expect.arrayContaining(["team_hub_list_conversations", "team_hub_list_messages", "team_hub_mark_read"]));
  });

  it("first use shows one empty list, Create a channel, and invites only for an owner — nobody invented", async () => {
    db.conversations = [];
    db.people = [person(ME, "Morgan Hale", null, "owner")];
    const openSettings = vi.fn();
    const { host } = await mount({ onOpenTeamSettings: openSettings });
    expect(host.textContent).toContain("Your team's conversations start here");
    expect(host.textContent).toContain("No channels yet.");
    expect(host.textContent).toContain("Right now you're the only person here.");
    // No teammate exists, so the first-use "Message a teammate" action is not offered.
    expect(Array.from(host.querySelectorAll(".th-center button")).map((item) => item.textContent)).not.toContain("Message a teammate");
    await act(async () => button(host, "Invite people in Settings → Team")!.click());
    expect(openSettings).toHaveBeenCalledTimes(1);
    await act(async () => button(host, "Create a channel")!.click());
    await flush();
    expect(host.querySelector("form[aria-label='Create a channel']")).not.toBeNull();
  });

  it("does not offer the invite link to a member", async () => {
    db.conversations = [];
    db.people = [person(ME, "Morgan Hale", null, "member"), person("u-dana", "Dana Reyes", null)];
    const { host } = await mount({ onOpenTeamSettings: vi.fn() });
    expect(button(host, "Invite people in Settings → Team")).toBeUndefined();
  });

  it("replaces the whole hub when the caller is no longer a member", async () => {
    db.override.team_hub_list_conversations = () => ({ ok: false, code: "not_member" });
    const { host } = await mount();
    expect(host.textContent).toContain("You're no longer on this team");
    expect(host.querySelector("textarea")).toBeNull();
  });

  it("re-reads the workspace and asks again on scope_changed", async () => {
    let first = true;
    db.override.team_hub_list_conversations = () => {
      if (first) { first = false; return { ok: false, code: "scope_changed" }; }
      return { ok: true, tenant_id: TENANT, me: { user_id: ME }, people: db.people, conversations: db.conversations };
    };
    const { host } = await mount();
    expect(mocks.tenantRefresh).toHaveBeenCalledTimes(1);
    expect(calls.filter((call) => call.name === "team_hub_list_conversations").length).toBe(2);
    expect(host.textContent).toContain("Kickoff is Thursday.");
  });

  it("shows one neutral message for a conversation it can't see", async () => {
    db.override.team_hub_list_messages = () => ({ ok: false, code: "not_found" });
    const { host } = await mount();
    expect(host.textContent).toContain("This conversation isn't available to you");
    expect(host.textContent).not.toMatch(/private|member of/i);
  });

  it("shows one honest whole-hub state, with no controls, when the server says unavailable (A1) twice", async () => {
    db.override.team_hub_list_conversations = () => ({ ok: false, code: "unavailable" });
    const { host } = await mount({ onOpenTeamSettings: vi.fn() });
    expect(host.textContent).toContain("Team Hub isn't available for this account type yet.");
    expect(host.querySelectorAll("button, textarea, input")).toHaveLength(0);
    // The workspace context is re-read once and the list asked again, then the answer stands.
    expect(mocks.tenantRefresh).toHaveBeenCalledTimes(1);
    expect(calls.map((call) => call.name)).toEqual(["team_hub_list_conversations", "team_hub_list_conversations"]);
  });

  it("re-reads the workspace once on a first unavailable and opens the hub when the second answer is ok", async () => {
    let first = true;
    db.override.team_hub_list_conversations = () => {
      if (first) { first = false; return { ok: false, code: "unavailable" }; }
      return { ok: true, tenant_id: TENANT, me: { user_id: ME }, people: db.people, conversations: db.conversations };
    };
    const { host } = await mount();
    expect(mocks.tenantRefresh).toHaveBeenCalledTimes(1);
    expect(host.textContent).not.toContain("Team Hub isn't available");
    expect(host.textContent).toContain("Kickoff is Thursday.");
  });

  it("treats an unexpected answer as unavailable", async () => {
    db.override.team_hub_list_conversations = () => ({ ok: true, tenant_id: "tenant-b", me: { user_id: ME }, people: [], conversations: [] });
    const { host } = await mount();
    expect(host.textContent).toContain("Team Hub couldn't load");
  });
});

describe("sending (mocked RPC)", () => {
  it("sends on Enter with a client request id and reuses it on Retry", async () => {
    let attempt = 0;
    db.override.team_hub_post_message = (params) => {
      attempt += 1;
      if (attempt === 1) throw new Error("network down");
      return { ok: true, duplicate: true, message: msg({ id: "m-sent", author_user_id: ME, body: String(params.p_body) }) };
    };
    mocks.rpc.mockImplementation(async (name: string, params: Record<string, unknown>) => {
      try { return { data: backend(name, params), error: null }; } catch (error) { return { data: null, error }; }
    });
    const { host } = await mount();
    await type(composer(host), "Agenda is up");
    await press(composer(host), "Enter");
    await flush();
    expect(host.textContent).toContain("Not sent. Your message is kept here.");
    const posts = () => calls.filter((call) => call.name === "team_hub_post_message");
    const firstId = posts()[0].params.p_client_request_id;
    expect(typeof firstId).toBe("string");
    await act(async () => button(host, "Retry")!.click());
    await flush();
    expect(posts()).toHaveLength(2);
    expect(posts()[1].params.p_client_request_id).toBe(firstId);
    expect(host.textContent).not.toContain("Not sent.");
    expect(host.querySelectorAll("article").length).toBe(2);
  });

  it("Shift+Enter keeps writing instead of sending", async () => {
    const { host } = await mount();
    await type(composer(host), "line one");
    await press(composer(host), "Enter", { shiftKey: true });
    expect(calls.some((call) => call.name === "team_hub_post_message")).toBe(false);
  });

  it("deletes an unsent message without sending it", async () => {
    db.override.team_hub_post_message = () => { throw new Error("network down"); };
    mocks.rpc.mockImplementation(async (name: string, params: Record<string, unknown>) => {
      try { return { data: backend(name, params), error: null }; } catch (error) { return { data: null, error }; }
    });
    const { host } = await mount();
    await type(composer(host), "Draft that fails");
    await press(composer(host), "Enter");
    await flush();
    await act(async () => button(host, "Remove")!.click());
    await flush();
    expect(host.textContent).not.toContain("Draft that fails");
  });

  it("keeps the draft and disables Send while offline, with no queue", async () => {
    Object.defineProperty(navigator, "onLine", { configurable: true, get: () => false });
    const { host } = await mount();
    await type(composer(host), "Write this later");
    await press(composer(host), "Enter");
    expect(button(host, "Send")!.disabled).toBe(true);
    expect(composer(host).value).toBe("Write this later");
    expect(host.textContent).toContain("You're offline");
    expect(calls.some((call) => call.name === "team_hub_post_message")).toBe(false);
  });

  it("puts a refused message back in the composer and announces why exactly once", async () => {
    db.override.team_hub_post_message = () => ({ ok: false, code: "invalid" });
    const { host } = await mount();
    await type(composer(host), "Hello there");
    await press(composer(host), "Enter");
    await flush();
    expect(composer(host).value).toBe("Hello there");
    const shown = host.querySelector(".th-composer-wrap .th-error")!;
    expect(shown.textContent).toContain("Not sent");
    // Shown and tied to the field, announced by the live region only — never also role=alert.
    expect(shown.getAttribute("role")).toBeNull();
    expect(host.querySelector("[role=alert]")).toBeNull();
    expect(composer(host).getAttribute("aria-describedby")).toBe(shown.id);
    expect(liveRegion(host).textContent).toContain("Not sent");
  });
});

describe("mentions (mocked RPC)", () => {
  it("lists only active people who can see the channel, told apart by title, and sends picked ids", async () => {
    const { host } = await mount();
    await type(composer(host), "@sa");
    const listbox = host.querySelector("[role=listbox]")!;
    const options = Array.from(listbox.querySelectorAll("[role=option]")).map((option) => option.textContent);
    expect(options.some((text) => text?.includes("Sam Lee (Designer)"))).toBe(true);
    expect(options.some((text) => text?.includes("Sam Lee (Sales)"))).toBe(true);
    expect(options.some((text) => text?.includes("Morgan Hale"))).toBe(false);
    expect(composer(host).getAttribute("aria-expanded")).toBe("true");
    expect(composer(host).getAttribute("aria-activedescendant")).toBe(listbox.querySelector("[aria-selected=true]")!.id);
    await press(composer(host), "ArrowDown");
    await press(composer(host), "Enter");
    expect(composer(host).value).toBe("@Sam Lee (Sales) ");
    expect(host.querySelector("[role=listbox]")).toBeNull();
    await type(composer(host), "@Sam Lee (Sales) please review");
    await press(composer(host), "Enter");
    await flush();
    const post = calls.find((call) => call.name === "team_hub_post_message")!;
    expect(post.params.p_mention_ids).toEqual(["u-sam-s"]);
  });

  it("refuses a typed name that matches two people before anything is sent", async () => {
    const { host } = await mount();
    await type(composer(host), "@Sam Lee can you check?");
    await press(composer(host), "Escape");
    await press(composer(host), "Enter");
    await flush();
    expect(calls.some((call) => call.name === "team_hub_post_message")).toBe(false);
    expect(host.querySelector(".th-composer-wrap .th-error")?.textContent).toContain("More than one person is named Sam Lee");
    expect(liveRegion(host).textContent).toContain("More than one person is named Sam Lee");
    expect(composer(host).value).toBe("@Sam Lee can you check?");
  });

  it("offers only the private channel's members (member_ids), never the whole team", async () => {
    db.conversations = [channel({ id: "c-private", name: "leadership", visibility: "private", member_count: 2, member_ids: [ME, "u-sam-s"] })];
    db.messages = { "c-private": [] };
    const { host } = await mount();
    expect(button(host, "Mention someone")).toBeDefined();
    await type(composer(host), "@");
    const options = Array.from(host.querySelectorAll("[role=option]")).map((option) => option.textContent);
    expect(options).toHaveLength(1);
    expect(options[0]).toContain("Sam Lee (Sales)");
  });

  it("offers no mention list in a private channel with nobody else in it", async () => {
    db.conversations = [channel({ id: "c-private", name: "notes", visibility: "private", member_count: 1, member_ids: [ME] })];
    db.messages = { "c-private": [] };
    const { host } = await mount();
    expect(button(host, "Mention someone")).toBeUndefined();
    await type(composer(host), "@sa");
    expect(host.querySelector("[role=listbox]")).toBeNull();
  });

  it("offers only the other person in a direct message", async () => {
    db.conversations = [channel({ id: "c-dm", kind: "dm", name: null, visibility: "private", member_count: 2, member_ids: [ME, "u-dana"], dm_user_id: "u-dana" })];
    db.messages = { "c-dm": [] };
    const { host } = await mount();
    await type(composer(host), "@");
    const options = Array.from(host.querySelectorAll("[role=option]")).map((option) => option.textContent);
    expect(options).toHaveLength(1);
    expect(options[0]).toContain("Dana Reyes");
  });
});

describe("refresh cadence (mocked RPC)", () => {
  it("refreshes every 15 seconds while the tab is visible and stops on unmount", async () => {
    // jsdom drives animation frames from its own timers, so the interval is observed, not faked.
    const realSetInterval = window.setInterval.bind(window);
    const ticks = new Map<number, () => void>();
    vi.spyOn(window, "setInterval").mockImplementation(((handler: () => void, delay?: number) => {
      const id = realSetInterval(handler, delay);
      if (delay === REFRESH_INTERVAL_MS) ticks.set(id, handler);
      return id;
    }) as typeof window.setInterval);
    const cleared = vi.spyOn(window, "clearInterval");
    const { root } = await mount();
    expect(ticks.size).toBe(1);
    const [[id, tick]] = [...ticks.entries()];
    const lists = () => calls.filter((call) => call.name === "team_hub_list_conversations").length;
    const before = lists();
    await act(async () => tick());
    await flush();
    expect(lists()).toBe(before + 1);
    const visibility = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    await act(async () => tick());
    await flush();
    expect(lists()).toBe(before + 1);
    visibility.mockRestore();
    mounted.splice(mounted.indexOf(root), 1);
    await act(async () => root.unmount());
    expect(cleared).toHaveBeenCalledWith(id);
  });

  it("refreshes when the window regains focus or the browser comes back online", async () => {
    await mount();
    const lists = () => calls.filter((call) => call.name === "team_hub_list_conversations").length;
    const before = lists();
    await act(async () => { window.dispatchEvent(new Event("focus")); });
    await flush();
    await act(async () => { window.dispatchEvent(new Event("online")); });
    await flush();
    expect(lists()).toBe(before + 2);
  });
});

describe("unread integrity (mocked RPC)", () => {
  it("never calls team_hub_mark_read from the one-column list view", async () => {
    hubWidth(390);
    db.conversations = [channel({ unread: 2 }), channel({ id: "c-design", name: "design", unread: 1 })];
    db.messages = { "c-general": [msg({ created_at: at(5) })], "c-design": [msg({ id: "m-d", created_at: at(4) })] };
    const { host } = await mount();
    // Nothing is opened behind the list, so nothing is read or marked read.
    expect(calls.some((call) => call.name === "team_hub_list_messages")).toBe(false);
    await act(async () => { window.dispatchEvent(new Event("focus")); });
    await flush();
    expect(marks()).toHaveLength(0);
    expect(host.querySelector(".th-grid")!.getAttribute("data-view")).toBe("list");
    expect(host.querySelector("#th-conv-c-general .th-badge")!.textContent).toBe("2");
  });

  it("marks read when a conversation is opened on a phone, and not after going back to the list", async () => {
    hubWidth(390);
    db.conversations = [channel({ unread: 1 })];
    const { host } = await mount();
    await act(async () => host.querySelector<HTMLButtonElement>("#th-conv-c-general")!.click());
    await flush();
    expect(host.querySelector(".th-grid")!.getAttribute("data-view")).toBe("conv");
    expect(marks()).toHaveLength(1);
    await act(async () => button(host, "Back to conversations")!.click());
    await flush();
    // Someone writes while the conversation is open behind the list: the refresh reads it, the badge shows it.
    db.conversations = [channel({ unread: 1 })];
    db.messages["c-general"] = [...db.messages["c-general"], msg({ id: "m-new", body: "New one", created_at: at(0) })];
    await act(async () => { window.dispatchEvent(new Event("focus")); });
    await flush();
    expect(calls.filter((call) => call.name === "team_hub_list_messages").length).toBeGreaterThan(1);
    expect(marks()).toHaveLength(1);
    expect(host.querySelector("#th-conv-c-general .th-badge")!.textContent).toBe("1");
  });

  it("marks an on-screen conversation read on a background refresh in the wide layout", async () => {
    await mount();
    expect(marks()).toHaveLength(1);
    db.conversations = [channel({ unread: 1 })];
    await act(async () => { window.dispatchEvent(new Event("focus")); });
    await flush();
    expect(marks()).toHaveLength(2);
  });

  it("shows unread as visible digits with screen-reader words, not an aria-label", async () => {
    db.conversations = [channel(), channel({ id: "c-design", name: "design", unread: 3 })];
    db.messages["c-design"] = [];
    const { host } = await mount();
    const item = host.querySelector("#th-conv-c-design")!;
    const badge = item.querySelector(".th-badge")!;
    expect(badge.textContent).toBe("3");
    expect(badge.getAttribute("aria-label")).toBeNull();
    expect(item.textContent).toContain("3 unread");
  });
});

describe("one-column first use (mocked RPC)", () => {
  it("explains first use and offers its actions in the list view a phone shows", async () => {
    hubWidth(390);
    db.conversations = [];
    const { host } = await mount({ onOpenTeamSettings: vi.fn() });
    const list = host.querySelector(".th-list")!;
    expect(list.textContent).toContain("Your team's conversations start here");
    const actions = Array.from(list.querySelectorAll(".th-center button")).map((item) => item.textContent);
    expect(actions).toEqual(["Create a channel", "Message a teammate", "Invite people in Settings → Team"]);
    // The conversation pane carries no second copy.
    expect(host.querySelector(".th-conv")!.textContent).not.toContain("Your team's conversations start here");
    await act(async () => Array.from(list.querySelectorAll<HTMLButtonElement>(".th-center button"))[0].click());
    await flush();
    expect(list.querySelector("form[aria-label='Create a channel']")).not.toBeNull();
    expect(host.querySelector(".th-grid")!.getAttribute("data-view")).toBe("list");
  });
});

describe("paging (mocked RPC)", () => {
  it("loads earlier messages with the compound cursor: p_before AND p_before_id", async () => {
    const same = at(30);
    db.messages["c-general"] = Array.from({ length: 51 }, (_, index) => msg({ id: `m-${String(index).padStart(2, "0")}`, body: `Note ${index}`, created_at: index < 2 ? same : at(29 - index * 0.1) }));
    const { host } = await mount();
    const first = calls.find((call) => call.name === "team_hub_list_messages")!;
    expect(first.params).toMatchObject({ p_before: null, p_before_id: null });
    await act(async () => button(host, "Load earlier messages")!.click());
    await flush();
    const older = calls.filter((call) => call.name === "team_hub_list_messages").at(-1)!;
    // The oldest message shown was m-01 (tied on created_at with m-00): both halves are sent.
    expect(older.params).toMatchObject({ p_before: same, p_before_id: "m-01" });
    expect(host.textContent).toContain("Note 0");
    expect(button(host, "Load earlier messages")).toBeUndefined();
  });

  it("shows a thread's replies oldest first and pages back with Show earlier replies", async () => {
    db.messages["c-general"] = [msg({ id: "m-root", body: "Root post", reply_count: 52, created_at: at(90) })];
    db.replies["m-root"] = Array.from({ length: 52 }, (_, index) => msg({ id: `r-${String(index).padStart(2, "0")}`, parent_message_id: "m-root", body: `Reply ${index}`, created_at: at(80 - index) }));
    const { host } = await mount();
    await act(async () => button(host, /52 replies/)!.click());
    await flush();
    const drawer = host.querySelector("aside.th-thread")!;
    const shown = () => Array.from(drawer.querySelectorAll("article .th-text")).map((node) => node.textContent);
    // Root, then the newest 50 replies in reading order.
    expect(shown()[0]).toBe("Root post");
    expect(shown().slice(1, 3)).toEqual(["Reply 2", "Reply 3"]);
    expect(shown().at(-1)).toBe("Reply 51");
    await act(async () => button(host, "Show earlier replies")!.click());
    await flush();
    const older = calls.filter((call) => call.name === "team_hub_list_messages" && call.params.p_thread_root).at(-1)!;
    expect(older.params).toMatchObject({ p_thread_root: "m-root", p_before: db.replies["m-root"][2].created_at, p_before_id: "r-02" });
    expect(shown().slice(1, 3)).toEqual(["Reply 0", "Reply 1"]);
    expect(shown()).toHaveLength(53);
    expect(button(host, "Show earlier replies")).toBeUndefined();
  });
});

describe("threads (mocked RPC)", () => {
  it("moves focus to the reply box once the thread has loaded, and back to its trigger on Esc", async () => {
    db.messages["c-general"] = [msg({ id: "m-root", body: "Root post", reply_count: 1, created_at: at(10) })];
    db.replies["m-root"] = [msg({ id: "r-1", parent_message_id: "m-root", body: "A reply", created_at: at(5) })];
    const { host } = await mount();
    const trigger = button(host, /1 reply/)!;
    trigger.focus();
    await act(async () => trigger.click());
    await flush();
    expect(document.activeElement?.id).toBe("th-thread-reply");
    await press(document.activeElement as HTMLElement, "Escape");
    await flush();
    expect(host.querySelector("aside.th-thread")).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });
});

describe("channels (mocked RPC)", () => {
  it("offers visibility as pressed toggles", async () => {
    const { host } = await mount();
    await act(async () => button(host, "Create a channel")!.click());
    await flush();
    const group = host.querySelector("[role=group][aria-label='Who can see it']")!;
    const toggles = Array.from(group.querySelectorAll("button"));
    expect(toggles.map((item) => item.getAttribute("aria-pressed"))).toEqual(["true", "false"]);
    expect(group.querySelector("[role=radio]")).toBeNull();
    await act(async () => toggles[1].click());
    expect(toggles.map((item) => item.getAttribute("aria-pressed"))).toEqual(["false", "true"]);
  });

  it("keeps the Add people disclosure neutral and offers only teammates who aren't members", async () => {
    db.conversations = [channel({ id: "c-private", name: "leadership", visibility: "private", member_count: 2, member_ids: [ME, "u-dana"] })];
    db.messages = { "c-private": [] };
    db.override.team_hub_add_members = (params) => ({ ok: true, added: (params.p_user_ids as string[]).length });
    const { host } = await mount();
    expect(host.querySelector(".th-conv-head p")!.textContent).toBe("Private · 2 members");
    const toggle = host.querySelector<HTMLButtonElement>(".th-head-actions button")!;
    expect(toggle.textContent).toBe("Add people");
    expect(toggle.className).not.toContain("th-btn--act");
    await act(async () => toggle.click());
    const form = host.querySelector("form[aria-label='Add people to this channel']")!;
    const chips = Array.from(form.querySelectorAll<HTMLButtonElement>(".th-chip"));
    expect(chips.map((chip) => chip.textContent)).toEqual(["Sam Lee (Designer)", "Sam Lee (Sales)"]);
    await act(async () => chips[1].click());
    const submit = form.querySelector<HTMLButtonElement>("button[type=submit]")!;
    expect(submit.textContent).toBe("Add 1 person");
    expect(submit.className).toContain("th-btn--act");
    await act(async () => { form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
    await flush();
    const added = calls.find((call) => call.name === "team_hub_add_members")!;
    expect(added.params.p_user_ids).toEqual(["u-sam-s"]);
  });

  it("never invents a member count", async () => {
    db.conversations = [channel({ id: "c-private", name: "leadership", visibility: "private", member_count: 3, member_ids: [ME, "u-dana", "u-sam-s"] })];
    db.messages = { "c-private": [] };
    const { host } = await mount();
    expect(host.querySelector(".th-conv-head p")!.textContent).toBe("Private · 3 members");
    expect(host.textContent).not.toContain("?");
  });
});

/** Captures the hub's 15-second refresh tick so a test can fire it without faking every timer. */
function captureRefreshTick() {
  const realSetInterval = window.setInterval.bind(window);
  let tick: (() => void) | null = null;
  vi.spyOn(window, "setInterval").mockImplementation(((handler: () => void, delay?: number) => {
    if (delay === REFRESH_INTERVAL_MS) tick = handler;
    return realSetInterval(handler, delay);
  }) as typeof window.setInterval);
  return async () => { await act(async () => tick?.()); await flush(); };
}

async function typeInput(element: HTMLInputElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(element, value);
    element.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("refresh merging and announcements (mocked RPC)", () => {
  it("replaces the held stream and offers earlier messages when the newest page can't be joined to it", async () => {
    db.messages["c-general"] = [msg({ id: "m-old", body: "Held before the absence", created_at: at(600) })];
    const { host } = await mount();
    expect(host.textContent).toContain("Held before the absence");
    expect(button(host, "Load earlier messages")).toBeUndefined();
    // 60 messages arrive while away: the newest page (50) has more behind it, all newer than m-old.
    db.messages["c-general"].push(...Array.from({ length: 60 }, (_, index) => msg({ id: `m-n${String(index).padStart(2, "0")}`, body: `Away ${index}`, created_at: at(100 - index) })));
    await act(async () => { window.dispatchEvent(new Event("focus")); });
    await flush();
    // No silent hole: the page that couldn't be joined replaces the held list, and the gap is offered.
    expect(host.textContent).not.toContain("Held before the absence");
    expect(host.textContent).toContain("Away 59");
    expect(host.textContent).not.toContain("Away 9 ");
    expect(button(host, "Load earlier messages")).toBeDefined();
    expect(liveRegion(host).textContent).toBe("50 or more new messages");
    await act(async () => button(host, "Load earlier messages")!.click());
    await flush();
    const older = calls.filter((call) => call.name === "team_hub_list_messages").at(-1)!;
    expect(older.params).toMatchObject({ p_before_id: "m-n10" });
    expect(host.textContent).toContain("Away 0");
    expect(host.textContent).toContain("Held before the absence");
  });

  it("joins a refresh page that overlaps the held stream without offering earlier messages", async () => {
    const { host } = await mount();
    db.messages["c-general"].push(msg({ id: "m-2", body: "Second", created_at: at(-1) }));
    await act(async () => { window.dispatchEvent(new Event("focus")); });
    await flush();
    expect(host.textContent).toContain("Kickoff is Thursday.");
    expect(host.textContent).toContain("Second");
    expect(button(host, "Load earlier messages")).toBeUndefined();
  });

  it("replaces held thread replies the same way when the newest reply page can't be joined", async () => {
    db.messages["c-general"] = [msg({ id: "m-root", body: "Root post", reply_count: 1, created_at: at(900) })];
    db.replies["m-root"] = [msg({ id: "r-old", parent_message_id: "m-root", body: "Early reply", created_at: at(800) })];
    const { host } = await mount();
    await act(async () => button(host, /1 reply/)!.click());
    await flush();
    db.replies["m-root"].push(...Array.from({ length: 55 }, (_, index) => msg({ id: `r-n${String(index).padStart(2, "0")}`, author_user_id: "u-sam-d", parent_message_id: "m-root", body: `Later ${index}`, created_at: at(100 - index) })));
    await act(async () => { window.dispatchEvent(new Event("focus")); });
    await flush();
    const drawer = host.querySelector("aside.th-thread")!;
    expect(drawer.textContent).not.toContain("Early reply");
    expect(drawer.textContent).toContain("Later 54");
    expect(button(host, "Show earlier replies")).toBeDefined();
    expect(liveRegion(host).textContent).toBe("50 new replies in the thread");
  });

  it("announces new messages from others as a count through the hub's one live region, not a log", async () => {
    const { host } = await mount();
    const stream = host.querySelector(".th-stream")!;
    expect(stream.getAttribute("role")).toBe("region");
    expect(stream.getAttribute("aria-label")).toBe("Messages");
    expect(host.querySelector("[role=log]")).toBeNull();
    expect(host.querySelectorAll("[aria-live]")).toHaveLength(1);
    db.messages["c-general"].push(
      msg({ id: "m-2", body: "One", created_at: at(-1) }),
      msg({ id: "m-3", author_user_id: "u-sam-d", body: "Two", created_at: at(-2) }),
      msg({ id: "m-4", author_user_id: ME, body: "Mine from another tab", created_at: at(-3) }),
    );
    await act(async () => { window.dispatchEvent(new Event("focus")); });
    await flush();
    expect(host.textContent).toContain("Mine from another tab");
    // Two by others; the caller's own message is not news to them.
    expect(liveRegion(host).textContent).toBe("2 new messages");
  });
});

describe("Esc and the shell (mocked RPC)", () => {
  it("closes the thread inside React and marks Esc handled, so the shell's window Esc does not fold PAIGE", async () => {
    db.messages["c-general"] = [msg({ id: "m-root", body: "Root post", reply_count: 1, created_at: at(10) })];
    db.replies["m-root"] = [msg({ id: "r-1", parent_message_id: "m-root", body: "A reply", created_at: at(5) })];
    const { host } = await mount();
    await act(async () => button(host, /1 reply/)!.click());
    await flush();
    // Esc outside the hub is not the hub's: there is no window listener, so the thread stays open.
    await press(document.body, "Escape");
    await flush();
    expect(host.querySelector("aside.th-thread")).not.toBeNull();
    // A stand-in for the shell's window-level keydown listener.
    const seenByShell: boolean[] = [];
    const shell = (event: KeyboardEvent) => { if (event.key === "Escape") seenByShell.push(event.defaultPrevented); };
    window.addEventListener("keydown", shell);
    await press(host.querySelector<HTMLTextAreaElement>("#th-thread-reply")!, "Escape");
    await flush();
    window.removeEventListener("keydown", shell);
    expect(host.querySelector("aside.th-thread")).toBeNull();
    expect(seenByShell).toEqual([true]);
  });
});

describe("mark read through the newest displayed message (A8, mocked RPC)", () => {
  it("names the newest top-level message on screen as p_through_message_id", async () => {
    db.messages["c-general"] = [msg({ id: "m-a", created_at: at(9) }), msg({ id: "m-b", created_at: at(3) })];
    await mount();
    expect(marks()).toHaveLength(1);
    expect(marks()[0].params.p_through_message_id).toBe("m-b");
    db.conversations = [channel({ unread: 1 })];
    db.messages["c-general"].push(msg({ id: "m-c", body: "Arrived", created_at: at(1) }));
    await act(async () => { window.dispatchEvent(new Event("focus")); });
    await flush();
    expect(marks()).toHaveLength(2);
    expect(marks()[1].params.p_through_message_id).toBe("m-c");
  });

  it("does not mark read while a phone thread covers the stream, even after the 15-second refresh", async () => {
    hubWidth(390);
    const tick = captureRefreshTick();
    db.conversations = [channel({ unread: 1 })];
    db.messages["c-general"] = [msg({ id: "m-root", body: "Root post", reply_count: 1, created_at: at(10) })];
    db.replies["m-root"] = [msg({ id: "r-1", parent_message_id: "m-root", body: "A reply", created_at: at(5) })];
    const { host } = await mount();
    await act(async () => host.querySelector<HTMLButtonElement>("#th-conv-c-general")!.click());
    await flush();
    expect(marks()).toHaveLength(1);
    await act(async () => button(host, /1 reply/)!.click());
    await flush();
    expect(host.querySelector("aside.th-thread")).not.toBeNull();
    db.conversations = [channel({ unread: 1 })];
    db.messages["c-general"].push(msg({ id: "m-new", body: "Written while the thread is open", created_at: at(1) }));
    await tick();
    expect(calls.filter((call) => call.name === "team_hub_list_messages" && !call.params.p_thread_root).length).toBeGreaterThan(1);
    expect(marks()).toHaveLength(1);
    // Closing the thread puts the stream back on screen; only then is it marked read, through m-new.
    await act(async () => button(host, "Close thread")!.click());
    await flush();
    expect(marks()).toHaveLength(2);
    expect(marks()[1].params.p_through_message_id).toBe("m-new");
  });
});

describe("structure for assistive tech (mocked RPC)", () => {
  it("names the day, New and replies separators, since a separator's text is not read", async () => {
    db.conversations = [channel({ unread: 1 })];
    db.messages["c-general"] = [msg({ id: "m-root", reply_count: 2, created_at: at(10) })];
    db.replies["m-root"] = [msg({ id: "r-1", parent_message_id: "m-root", created_at: at(6) }), msg({ id: "r-2", parent_message_id: "m-root", created_at: at(5) })];
    const { host } = await mount();
    await act(async () => button(host, /2 replies/)!.click());
    await flush();
    const separators = Array.from(host.querySelectorAll("[role=separator]")).map((node) => [node.getAttribute("aria-label"), node.textContent]);
    expect(separators).toEqual([["Today", "Today"], ["New messages", "New"], ["2 replies", "2 replies"]]);
  });

  it("makes the panes under the thread drawer inert: the conversation when it overlays, and both in one column", async () => {
    db.messages["c-general"] = [msg({ id: "m-root", reply_count: 1, created_at: at(10) })];
    db.replies["m-root"] = [msg({ id: "r-1", parent_message_id: "m-root", created_at: at(5) })];
    const openThread = async (host: HTMLElement) => { await act(async () => button(host, /1 reply/)!.click()); await flush(); };
    // Wide (≥1150px): the drawer sits beside the conversation; nothing is covered.
    let { host } = await mount();
    await openThread(host);
    expect(host.querySelector(".th-conv")!.hasAttribute("inert")).toBe(false);
    expect(host.querySelector(".th-list")!.hasAttribute("inert")).toBe(false);
    for (const root of mounted.splice(0)) await act(async () => root.unmount());
    // Overlay (760–1149px): the drawer covers the conversation, not the list.
    hubWidth(900);
    ({ host } = await mount());
    await openThread(host);
    expect(host.querySelector(".th-conv")!.hasAttribute("inert")).toBe(true);
    expect(host.querySelector(".th-list")!.hasAttribute("inert")).toBe(false);
    await act(async () => button(host, "Close thread")!.click());
    await flush();
    expect(host.querySelector(".th-conv")!.hasAttribute("inert")).toBe(false);
    for (const root of mounted.splice(0)) await act(async () => root.unmount());
    vi.restoreAllMocks();
    // One column: the drawer covers everything else.
    hubWidth(390);
    ({ host } = await mount());
    await act(async () => host.querySelector<HTMLButtonElement>("#th-conv-c-general")!.click());
    await flush();
    await openThread(host);
    expect(host.querySelector(".th-conv")!.hasAttribute("inert")).toBe(true);
    expect(host.querySelector(".th-list")!.hasAttribute("inert")).toBe(true);
  });
});

describe("conversation actions (mocked RPC)", () => {
  it("creates a channel with the form's request id, then opens it", async () => {
    db.override.team_hub_create_channel = (params) => {
      db.conversations = [...db.conversations, channel({ id: "c-launch", name: String(params.p_name) })];
      db.messages["c-launch"] = [];
      return { ok: true, channel_id: "c-launch" };
    };
    const { host } = await mount();
    await act(async () => button(host, "Create a channel")!.click());
    await flush();
    const form = host.querySelector<HTMLFormElement>("form[aria-label='Create a channel']")!;
    await typeInput(form.querySelector("input")!, "Launch Week");
    expect(form.querySelector("input")!.value).toBe("launch-week");
    await act(async () => { form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
    await flush();
    const create = calls.find((call) => call.name === "team_hub_create_channel")!;
    expect(create.params).toMatchObject({ p_name: "launch-week", p_visibility: "team", p_member_ids: [] });
    expect(typeof create.params.p_client_request_id).toBe("string");
    expect(host.querySelector("form[aria-label='Create a channel']")).toBeNull();
    expect(host.querySelector("#th-conv-c-launch")!.getAttribute("aria-current")).toBe("page");
    expect(host.textContent).toContain("No messages in #launch-week yet.");
    expect(liveRegion(host).textContent).toBe("Channel created");
    expect(document.activeElement?.id).toBe("th-composer-c-launch");
  });

  it("sends the chosen people when creating a private channel", async () => {
    db.override.team_hub_create_channel = () => ({ ok: true, channel_id: "c-general" });
    const { host } = await mount();
    await act(async () => button(host, "Create a channel")!.click());
    await flush();
    const form = host.querySelector<HTMLFormElement>("form[aria-label='Create a channel']")!;
    await typeInput(form.querySelector("input")!, "leads");
    await act(async () => button(host, "Only people I add")!.click());
    await act(async () => Array.from(form.querySelectorAll<HTMLButtonElement>(".th-chip"))[0].click());
    await act(async () => { form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
    await flush();
    expect(calls.find((call) => call.name === "team_hub_create_channel")!.params).toMatchObject({ p_visibility: "private", p_member_ids: ["u-dana"] });
  });

  it("joins a team channel, then leaves it in one click", async () => {
    db.conversations = [channel({ joined: false })];
    db.override.team_hub_join_channel = () => { db.conversations = [channel({ joined: true })]; return { ok: true }; };
    db.override.team_hub_leave_channel = () => { db.conversations = [channel({ joined: false })]; return { ok: true }; };
    const { host } = await mount();
    expect(host.querySelector(".th-conv-head p")!.textContent).toBe("Everyone on the team · you haven't joined");
    await act(async () => button(host, "Join")!.click());
    await flush();
    expect(calls.find((call) => call.name === "team_hub_join_channel")!.params.p_channel_id).toBe("c-general");
    expect(liveRegion(host).textContent).toBe("Joined #general");
    expect(host.querySelector(".th-conv-head p")!.textContent).toBe("Everyone on the team");
    await act(async () => button(host, "Leave")!.click());
    await flush();
    // A team channel can be rejoined, so nothing asks first.
    expect(host.querySelector(".th-confirm")).toBeNull();
    expect(calls.find((call) => call.name === "team_hub_leave_channel")!.params.p_channel_id).toBe("c-general");
    expect(liveRegion(host).textContent).toBe("Left #general");
    expect(button(host, "Join")).toBeDefined();
  });

  it("asks before leaving a private channel, naming what is lost, and Stay leaves nothing", async () => {
    db.conversations = [channel({ id: "c-private", name: "leadership", visibility: "private", member_count: 2, member_ids: [ME, "u-dana"] })];
    db.messages = { "c-private": [] };
    const { host } = await mount();
    const leave = button(host, "Leave")!;
    await act(async () => leave.click());
    await flush();
    const confirm = host.querySelector(".th-confirm")!;
    expect(confirm.textContent).toContain("Leave #leadership?");
    expect(confirm.textContent).toContain("Someone still in the channel has to add you back.");
    expect(leave.getAttribute("aria-expanded")).toBe("true");
    expect(document.activeElement?.textContent).toBe("Stay");
    expect(calls.some((call) => call.name === "team_hub_leave_channel")).toBe(false);
    await act(async () => button(host, "Stay")!.click());
    await flush();
    expect(host.querySelector(".th-confirm")).toBeNull();
    expect(document.activeElement).toBe(leave);
    expect(calls.some((call) => call.name === "team_hub_leave_channel")).toBe(false);
  });

  it("says the channel and its messages will be archived when the last member leaves (A5)", async () => {
    db.conversations = [channel({ id: "c-private", name: "notes", visibility: "private", member_count: 1, member_ids: [ME] })];
    db.messages = { "c-private": [] };
    db.override.team_hub_leave_channel = () => { db.conversations = []; return { ok: true }; };
    const { host } = await mount();
    await act(async () => button(host, "Leave")!.click());
    await flush();
    expect(host.querySelector(".th-confirm")!.textContent).toContain("Leaving archives the channel and its messages");
    await act(async () => button(host, "Leave and archive")!.click());
    await flush();
    expect(calls.filter((call) => call.name === "team_hub_leave_channel")).toHaveLength(1);
    expect(host.querySelector("#th-conv-c-private")).toBeNull();
    expect(document.activeElement?.getAttribute("type")).toBe("search");
  });

  it("opens a new direct message through team_hub_open_dm", async () => {
    db.override.team_hub_open_dm = (params) => {
      db.conversations = [...db.conversations, channel({ id: "c-dm-dana", kind: "dm", name: null, visibility: "private", member_count: 2, member_ids: [ME, params.p_user_id], dm_user_id: params.p_user_id })];
      db.messages["c-dm-dana"] = [];
      return { ok: true, channel_id: "c-dm-dana" };
    };
    const { host } = await mount();
    await act(async () => button(host, "Message a teammate")!.click());
    await flush();
    const picker = host.querySelector("[role=group][aria-label='Message a teammate']")!;
    await act(async () => Array.from(picker.querySelectorAll<HTMLButtonElement>(".th-option")).find((item) => item.textContent?.includes("Dana Reyes"))!.click());
    await flush();
    expect(calls.find((call) => call.name === "team_hub_open_dm")!.params.p_user_id).toBe("u-dana");
    expect(host.querySelector("#th-conv-c-dm-dana")!.getAttribute("aria-current")).toBe("page");
    expect(host.textContent).toContain("This is the start of your conversation with Dana Reyes.");
  });

  it("opens an existing direct message without asking the server to create one", async () => {
    db.conversations = [channel(), channel({ id: "c-dm-dana", kind: "dm", name: null, visibility: "private", member_count: 2, member_ids: [ME, "u-dana"], dm_user_id: "u-dana" })];
    db.messages["c-dm-dana"] = [msg({ id: "m-dm", body: "Earlier DM" })];
    const { host } = await mount();
    await act(async () => button(host, "Message a teammate")!.click());
    await flush();
    const picker = host.querySelector("[role=group][aria-label='Message a teammate']")!;
    await act(async () => Array.from(picker.querySelectorAll<HTMLButtonElement>(".th-option")).find((item) => item.textContent?.includes("Dana Reyes"))!.click());
    await flush();
    expect(calls.some((call) => call.name === "team_hub_open_dm")).toBe(false);
    expect(host.querySelector("#th-conv-c-dm-dana")!.getAttribute("aria-current")).toBe("page");
    expect(host.textContent).toContain("Earlier DM");
  });

  it("filters the conversation list by search without asking the server", async () => {
    db.conversations = [channel(), channel({ id: "c-design", name: "design" }),
      channel({ id: "c-dm-dana", kind: "dm", name: null, visibility: "private", member_count: 2, member_ids: [ME, "u-dana"], dm_user_id: "u-dana" })];
    const { host } = await mount();
    const before = calls.length;
    await typeInput(host.querySelector<HTMLInputElement>("input[type=search]")!, "DES");
    const listed = () => Array.from(host.querySelectorAll(".th-list .th-conv-item")).map((item) => item.querySelector(".th-conv-name")!.textContent);
    expect(listed()).toEqual(["design"]);
    expect(host.querySelector(".th-list")!.textContent).toContain("No direct messages match.");
    await typeInput(host.querySelector<HTMLInputElement>("input[type=search]")!, "dana");
    expect(listed()).toEqual(["Dana Reyes"]);
    expect(host.querySelector(".th-list")!.textContent).toContain("No channels match.");
    expect(calls.length).toBe(before);
  });

  it("places the New divider above the oldest unread message by someone else", async () => {
    db.conversations = [channel({ unread: 2 })];
    db.messages["c-general"] = [
      msg({ id: "m-a", body: "Read already", created_at: at(10) }),
      msg({ id: "m-b", author_user_id: ME, body: "My own", created_at: at(8) }),
      msg({ id: "m-c", author_user_id: "u-sam-d", body: "First unread", created_at: at(5) }),
      msg({ id: "m-d", author_user_id: ME, body: "Mine again", created_at: at(4) }),
      msg({ id: "m-e", body: "Second unread", created_at: at(2) }),
    ];
    const { host } = await mount();
    const divider = host.querySelector("[data-new-divider]")!;
    expect(divider.getAttribute("aria-label")).toBe("New messages");
    expect(divider.nextElementSibling!.textContent).toContain("First unread");
    expect(host.querySelectorAll("[data-new-divider]")).toHaveLength(1);
  });
});
