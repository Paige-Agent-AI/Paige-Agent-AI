import { describe, expect, it, vi } from "vitest";
import {
  EMAIL_SERIES_TOOLS, EMAIL_SERIES_TOOL_NAMES, amountsIn, dispatchEmailSeriesChat, emailSeriesRequestKey, fillInsIn, linkKey, linksIn,
} from "../../supabase/functions/_shared/email-series-chat.ts";
import { EMAIL_CAMPAIGN_TOOL_NAMES } from "../../supabase/functions/_shared/email-campaign-chat.ts";
import { markupToHtml } from "../../supabase/functions/_shared/email-markup.ts";
import { requiresWorkspaceAdmin } from "../../supabase/functions/_shared/workspace-authority.ts";
import { NON_IDENTITY_ARGS } from "../../supabase/functions/_shared/confirm-fingerprint.ts";
import fs from "node:fs";

const TENANT = "11111111-1111-4111-8111-111111111111";
const ACTOR = "22222222-2222-4222-8222-222222222222";
const SERIES = "33333333-3333-4333-8333-333333333333";
const VERSION = "44444444-4444-4444-8444-444444444444";
const APPROVAL = "55555555-5555-4555-8555-555555555555";
const turn = { thread_id: null, user_turn_ordinal: 1, user_turn: "Write a welcome series" };
const SITE = "https://paigeagent.ai";

type Step = { position: number; delay_minutes: number; subject: string; preheader: string; body_html: string };
/** A database double that remembers what the series draft wrote, so the readback is real. */
function database(opts: {
  links?: Record<string, unknown>; existing?: Step[]; state?: string; draftError?: unknown; fileError?: unknown;
  approval?: string; readback?: (steps: Step[]) => Step[]; liveVersion?: boolean;
} = {}) {
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  let steps: Step[] = opts.existing ?? [];
  let version: Record<string, unknown> = { id: VERSION, version_no: 1, state: opts.state ?? "draft", entry_mode: "new_contacts",
    audience: { stages: ["new_lead", "lead"] }, segment_id: null, exit_on_goal: "none", exit_when_unmatched: false };
  let name = "Welcome series";
  const view = () => ({
    sequence: { id: SERIES, name, kind: "welcome", status: "draft", live_version_id: opts.liveVersion ? "66666666-6666-4666-8666-666666666666" : null },
    version: { ...version, steps: opts.readback ? opts.readback(steps) : steps },
    resolves: { ok: true, mode: "connector", from_address: "hello@acme.test", from_name: "Acme" },
    postal_address: "1 Main St", entry_preview: { matched: 4, eligible: 3, eligible_new: 3, no_address: 1, opted_out: 0, suppressed: 0 },
    sending: { daily_cap: 500, remaining_today: 480 }, approval: opts.approval ? { status: opts.approval } : null,
    people: { in_now: 0, completed: 0, left: 0, left_because: {} }, choices: { stages: [], sources: [], tags: [] }, segments: [],
    waiting_to_enter: null,
  });
  const rpc = vi.fn(async (fn: string, args: Record<string, unknown>) => {
    calls.push({ name: fn, args });
    if (fn === "read_email_series_links") return { data: opts.links ?? { paths: ["/book/acme-intro", "/p/acme/guide"], website: "https://acme.test", prices: [49700] }, error: null };
    if (fn === "read_email_series") return args.p_sequence_id ? { data: view(), error: null } : { data: { sequences: [] }, error: null };
    if (fn === "email_series_draft") {
      if (opts.draftError) return { data: null, error: opts.draftError };
      const given = args.p_steps as Omit<Step, "position">[] | null;
      if (given) steps = given.map((s, i) => ({ position: i + 1, ...s }));
      if (args.p_entry_mode) version = { ...version, entry_mode: args.p_entry_mode };
      if (args.p_exit_on_goal) version = { ...version, exit_on_goal: args.p_exit_on_goal };
      if (typeof args.p_name === "string") name = args.p_name;
      return { data: { sequence_id: SERIES, version_id: VERSION, version_no: 1, created: !args.p_sequence_id, replayed: false, changing_running: false }, error: null };
    }
    if (fn === "email_series_submit_for_approval") {
      if (opts.fileError) return { data: null, error: opts.fileError };
      version = { ...version, state: "locked" };
      return { data: { approval_id: APPROVAL, sequence_id: SERIES, version_id: VERSION, emails: steps.length, matching_now: null, from_address: "hello@acme.test", replayed: false }, error: null };
    }
    throw new Error(`unexpected rpc ${fn}`);
  });
  return { deps: { caller: { rpc } }, calls, writes: () => calls.filter((c) => c.name === "email_series_draft" || c.name === "email_series_submit_for_approval") };
}
const run = (toolName: string, args: Record<string, unknown>, db: ReturnType<typeof database>, ownerText = "Write a welcome series for new leads") =>
  dispatchEmailSeriesChat({ tenantId: TENANT, userId: ACTOR, toolName, args, turn, ownerText, publicSiteUrl: SITE }, db.deps);
const email = (over: Record<string, unknown> = {}) => ({ subject: "Welcome", body: "Glad you're here.", ...over });

describe("email series chat tools", () => {
  it("declares exactly three tools and never an approve, start, pause, stop or send tool", () => {
    expect([...EMAIL_SERIES_TOOL_NAMES].sort()).toEqual(["email_series_draft", "email_series_request_approval", "read_email_series"]);
    for (const tool of EMAIL_SERIES_TOOLS) expect(tool.function.name).not.toMatch(/approve$|send|start|pause|resume|stop|dispatch/);
    for (const name of EMAIL_SERIES_TOOL_NAMES) expect(EMAIL_CAMPAIGN_TOOL_NAMES.has(name)).toBe(false);
  });

  it("tells PAIGE not to invent facts and that approval is standing and bounded", () => {
    const draft = EMAIL_SERIES_TOOLS.find((t) => t.function.name === "email_series_draft")!.function.description;
    expect(draft).toMatch(/Never invent an offer, price, deadline, link, guarantee, client result/);
    const file = EMAIL_SERIES_TOOLS.find((t) => t.function.name === "email_series_request_approval")!.function.description;
    expect(file).toMatch(/does NOT approve, start or send/);
    expect(file).toMatch(/any later change needs a new approval/);
  });

  it("is an owner/admin tool, and a new series' create key is not part of what the owner approves", () => {
    for (const name of EMAIL_SERIES_TOOL_NAMES) expect(requiresWorkspaceAdmin(name, new Set())).toBe(true);
    const chat = fs.readFileSync("supabase/functions/paige-ai-chat/index.ts", "utf8");
    expect(chat).toMatch(/const DOOR_SEAT_TOOLS[\s\S]{0,600}\.\.\.EMAIL_SERIES_TOOL_NAMES/);
    expect(chat.match(/WORKSPACE_BUILD_TOOLS, EMAIL_MARKETING_TOOL_NAMES\)/g)).toHaveLength(2);
    expect(NON_IDENTITY_ARGS.email_series_draft).toEqual(["request_key"]);
  });

  it("writes a whole new series, waits in minutes, and confirms it by reading it back", async () => {
    const db = database();
    const result = await run("email_series_draft", { kind: "welcome", emails: [
      email({ subject: "Welcome to Acme", body: "Book a call: [[Book a call|https://paigeagent.ai/book/acme-intro]]" }),
      email({ subject: "Our guide", wait_days: 2, body: "Read [the guide](https://paigeagent.ai/p/acme/guide)." }),
      email({ subject: "Last note", wait_days: 5, wait_hours: 6, body: "Visit https://acme.test anytime." }),
    ] }, db);
    expect(result.outcome).toBe("succeeded");
    const write = db.writes()[0].args;
    expect(write.p_expected_tenant_id).toBe(TENANT);
    expect(write.p_kind).toBe("welcome");
    expect(typeof write.p_request_key).toBe("string");
    expect((write.p_steps as Step[]).map((s) => s.delay_minutes)).toEqual([0, 2880, 7560]);
    expect((write.p_steps as Step[])[0].body_html).toBe(markupToHtml("Book a call: [[Book a call|https://paigeagent.ai/book/acme-intro]]"));
    expect(result.runId).toBe(`create:${write.p_request_key}`);
    expect(result.content.emails).toHaveLength(3);
    expect(result.content.ready_to_file).toBe(true);
    expect(String(result.content.note)).toMatch(/Nothing was sent/);
  });

  it("derives the same create key for the same request, so a retry makes one series", async () => {
    const a = await emailSeriesRequestKey(TENANT, ACTOR, { kind: "welcome", emails: [email()] }, turn);
    const b = await emailSeriesRequestKey(TENANT, ACTOR, { emails: [email()], kind: "welcome" }, turn);
    expect(a).toBe(b);
    expect(await emailSeriesRequestKey(TENANT, ACTOR, { kind: "nurture", emails: [email()] }, turn)).not.toBe(a);
  });

  it("refuses a link nobody gave and writes nothing", async () => {
    const db = database();
    const result = await run("email_series_draft", { kind: "welcome", emails: [email({ body: "Claim it at https://acme.test/special-offer" })] }, db);
    expect(result.outcome).toBe("invalid");
    expect(result.content.outcome).toBe("needs_input");
    expect(String((result.content.needs as string[])[0])).toMatch(/Email 1: the real link for https:\/\/acme\.test\/special-offer/);
    expect(result.content.note).toMatch(/Nothing was changed/);
    expect(db.writes()).toHaveLength(0);
  });

  it("accepts a link the owner gave in the conversation, with or without https", async () => {
    const db = database();
    const result = await run("email_series_draft", { kind: "welcome", emails: [email({ body: "Start here: https://www.acme.test/start/" })] }, db,
      "Write a welcome series and send people to acme.test/start");
    expect(result.outcome).toBe("succeeded");
  });

  it("refuses a business path on a host that is not the business's", async () => {
    const db = database();
    const result = await run("email_series_draft", { kind: "welcome", emails: [email({ body: "https://evil.test/book/acme-intro" })] }, db);
    expect(result.content.outcome).toBe("needs_input");
  });

  it("refuses a price nobody gave, accepts a recorded price or one the owner wrote", async () => {
    let db = database();
    let result = await run("email_series_draft", { kind: "welcome", emails: [email({ body: "Only $297 this week." })] }, db);
    expect(result.content.outcome).toBe("needs_input");
    expect(String((result.content.needs as string[])[0])).toMatch(/\$297/);
    db = database();
    result = await run("email_series_draft", { kind: "welcome", emails: [email({ body: "The program is $497." })] }, db);
    expect(result.outcome).toBe("succeeded");
    db = database();
    result = await run("email_series_draft", { kind: "welcome", emails: [email({ body: "Only $1,997 for the year." })] }, db, "The yearly plan is 1,997.");
    expect(result.outcome).toBe("succeeded");
  });

  it("refuses fill-ins but not a link whose words read like one", async () => {
    expect(fillInsIn("Hi {{first_name}}, I'm [Your name].")).toEqual(expect.arrayContaining(["{{first_name}}", "[your name]"]));
    expect(fillInsIn("[Add to calendar](https://acme.test/cal) and [[Add me|https://acme.test]]")).toEqual([]);
    const db = database();
    const result = await run("email_series_draft", { kind: "welcome", emails: [email({ body: "Hi {{first_name}}" })] }, db);
    expect(result.content.outcome).toBe("needs_input");
    expect(db.writes()).toHaveLength(0);
  });

  it("keeps links and prices the series already carries when changing it", async () => {
    const db = database({ existing: [{ position: 1, delay_minutes: 0, subject: "Hi", preheader: "", body_html: markupToHtml("Our price is $150: https://acme.test/old") }] });
    const result = await run("email_series_draft", { series_id: SERIES, emails: [email({ body: "Still $150 at https://acme.test/old" })] }, db, "make it warmer");
    expect(result.outcome).toBe("succeeded");
    expect(db.writes()[0].args.p_request_key).toBeNull();
  });

  it("needs every email, a wait for each later one, and no kind when changing", async () => {
    const db = database();
    expect((await run("email_series_draft", { kind: "welcome" }, db)).outcome).toBe("invalid");
    expect((await run("email_series_draft", { kind: "welcome", emails: [email(), email()] }, db)).content.fix).toMatch(/email 2 waits/);
    expect((await run("email_series_draft", { series_id: SERIES, kind: "nurture" }, db)).content.fix).toMatch(/kind is chosen/);
    expect((await run("email_series_draft", { kind: "welcome", emails: [email({ wait_days: 91 })] }, db)).outcome).toBe("invalid");
    expect((await run("email_series_draft", { kind: "welcome", emails: [email({ subject: "" })] }, db)).outcome).toBe("invalid");
    expect(db.writes()).toHaveLength(0);
  });

  it("reports a refusal the database named, and says how a stopped series is replaced", async () => {
    let db = database({ draftError: { message: "series_awaiting_approval" } });
    let result = await run("email_series_draft", { series_id: SERIES, emails: [email()] }, db);
    expect(result.outcome).toBe("refused");
    expect(result.content.error).toMatch(/Make changes/);
    db = database({ draftError: { message: "series_stopped" } });
    result = await run("email_series_draft", { series_id: SERIES, emails: [email()] }, db);
    expect(result.content.error).toMatch(/Start a copy/);
    db = database({ draftError: { message: "active_account_changed" } });
    expect((await run("email_series_draft", { series_id: SERIES, emails: [email()] }, db)).content.code).toBe("active_account_changed");
  });

  it("does not claim a save the readback does not show", async () => {
    const db = database({ readback: (steps) => steps.map((s) => ({ ...s, subject: "something else" })) });
    const result = await run("email_series_draft", { kind: "welcome", emails: [email()] }, db);
    expect(result.outcome).toBe("outcome_unknown");
    expect(result.content.success).toBe(false);
  });

  it("an unexplained database error is outcome unknown, never success", async () => {
    const db = database({ draftError: { message: "connection reset by peer" } });
    expect((await run("email_series_draft", { kind: "welcome", emails: [email()] }, db)).outcome).toBe("outcome_unknown");
  });

  it("files for approval only when the readback shows the version locked and its approval waiting", async () => {
    let db = database({ existing: [{ position: 1, delay_minutes: 0, subject: "Hi", preheader: "", body_html: markupToHtml("Hello") }], approval: "pending" });
    let result = await run("email_series_request_approval", { series_id: SERIES }, db);
    expect(result.outcome).toBe("succeeded");
    expect(result.runId).toBe(APPROVAL);
    expect(result.content.note).toMatch(/you cannot approve it/);
    db = database({ approval: undefined });
    result = await run("email_series_request_approval", { series_id: SERIES }, db);
    expect(result.outcome).toBe("outcome_unknown");
    db = database({ fileError: { message: "postal_address_missing" } });
    result = await run("email_series_request_approval", { series_id: SERIES }, db);
    expect(result.content.code).toBe("postal_address_missing");
  });

  it("reads one series with its waits and the business's own links and prices", async () => {
    const db = database({ existing: [{ position: 2, delay_minutes: 2880 + 60, subject: "Two", preheader: "", body_html: markupToHtml("x") }] });
    const result = await run("read_email_series", { series_id: SERIES }, db);
    expect(result.outcome).toBe("succeeded");
    expect((result.content.emails as { wait: unknown }[])[0].wait).toEqual({ days: 2, hours: 1, minutes: 0 });
    expect(result.content.business_links).toEqual([`${SITE}/book/acme-intro`, `${SITE}/p/acme/guide`, "https://acme.test"]);
    expect(result.content.recorded_prices).toEqual(["$497"]);
  });

  it("reads links and amounts the way a reader sees them", () => {
    expect(linkKey("https://www.Acme.test/start/")).toBe("acme.test/start");
    expect(linkKey("acme.test/start?utm=x")).toBe("acme.test/start");
    expect(linksIn("[a](https://x.test/a) [[b|https://y.test/b]] http://z.test")).toEqual(["https://x.test/a", "https://y.test/b", "http://z.test"]);
    expect(amountsIn("$497, $1,997.50 and 300 USD")).toEqual([49700, 199750, 30000]);
  });
});

describe("E3c migration", () => {
  const sql = fs.readFileSync("supabase/migrations/20270595000000_marketing_email_series_paige_tools.sql", "utf8");
  it("names the business on every chat function and never adds an approve path", () => {
    for (const fn of ["read_email_series", "read_email_series_links", "email_series_draft", "email_series_submit_for_approval"]) {
      const body = sql.slice(sql.indexOf(`FUNCTION public.${fn}(`));
      expect(body.slice(0, 600)).toMatch(/_email_paige_tenant\(p_expected_tenant_id\)/);
    }
    expect(sql).not.toMatch(/email_sequence_approve\(/);
    expect(sql).toMatch(/email_sequence_request_approval\(s\.id, 'paige'\)/);
  });
  it("refuses to change a series awaiting approval instead of withdrawing the owner's decision", () => {
    expect(sql).toMatch(/IF cur\.state = 'locked' THEN RAISE EXCEPTION 'series_awaiting_approval'/);
  });
});
