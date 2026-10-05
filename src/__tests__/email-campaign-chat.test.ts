import { describe, expect, it, vi } from "vitest";
import {
  EMAIL_CAMPAIGN_TOOLS, EMAIL_CAMPAIGN_TOOL_NAMES, dispatchEmailCampaignChat, emailCampaignRequestKey,
} from "../../supabase/functions/_shared/email-campaign-chat.ts";
import { markupToHtml, sourceOf } from "../../supabase/functions/_shared/email-markup.ts";
import { NO_WORKSPACE_AUTHORITY, authorityAdmits, requiresWorkspaceAdmin } from "../../supabase/functions/_shared/workspace-authority.ts";
import fs from "node:fs";

const TENANT = "11111111-1111-4111-8111-111111111111";
const ACTOR = "22222222-2222-4222-8222-222222222222";
const CAMPAIGN = "33333333-3333-4333-8333-333333333333";
const VERSION = "44444444-4444-4444-8444-444444444444";
const APPROVAL = "55555555-5555-4555-8555-555555555555";
const turn = { thread_id: null, user_turn_ordinal: 1, user_turn: "Write a spring promotion email" };

type Answer = { data?: unknown; error?: unknown } | ((args: Record<string, unknown>) => { data?: unknown; error?: unknown });
function caller(answers: Record<string, Answer | Answer[]>) {
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  const queue: Record<string, Answer[]> = Object.fromEntries(Object.entries(answers).map(([k, v]) => [k, Array.isArray(v) ? [...v] : [v]]));
  const rpc = vi.fn(async (name: string, args: Record<string, unknown>) => {
    calls.push({ name, args });
    const list = queue[name];
    if (!list?.length) throw new Error(`unexpected rpc ${name}`);
    const next = list.length > 1 ? list.shift()! : list[0];
    const value = typeof next === "function" ? next(args) : next;
    return { data: value.data ?? null, error: value.error ?? null };
  });
  return { deps: { caller: { rpc } }, calls };
}
const run = (toolName: string, args: Record<string, unknown>, deps: Parameters<typeof dispatchEmailCampaignChat>[1], tenantId: string | null = TENANT) =>
  dispatchEmailCampaignChat({ tenantId, userId: ACTOR, toolName, args, turn }, deps);
const draftRead = (over: Record<string, unknown> = {}) => ({ data: {
  campaign: { id: CAMPAIGN, name: "Spring", kind: "promotion", status: "draft" },
  version: { id: VERSION, version_no: 1, state: "draft", subject: "Spring is here", body_html: markupToHtml("Hello"), audience: {}, ...over },
  approval_status: null, segments: [], choices: { stages: [{ key: "lead", count: 4 }], sources: [], tags: [] },
} });

describe("email campaign chat tools", () => {
  it("declares exactly the four tools and never an approve or send tool", () => {
    expect([...EMAIL_CAMPAIGN_TOOL_NAMES].sort()).toEqual(["email_campaign_draft", "email_campaign_request_approval", "read_email_campaign_audience", "read_email_campaigns"]);
    for (const tool of EMAIL_CAMPAIGN_TOOLS) expect(tool.function.name).not.toMatch(/approve$|send$|dispatch/);
    const filing = EMAIL_CAMPAIGN_TOOLS.find((t) => t.function.name === "email_campaign_request_approval")!;
    expect(filing.function.description).toMatch(/does NOT approve or send/);
  });

  it("creates a draft from marks the editor can reopen, keyed so a retry cannot make a second campaign", async () => {
    const body = "# Spring\nOur doors open Monday.\n[[Book a call|https://example.com/book]]";
    const { deps, calls } = caller({
      email_campaign_draft: (args) => ({ data: { campaign_id: CAMPAIGN, version_id: VERSION, version_no: 1, created: true, replayed: false, echo: args } }),
      read_email_campaigns: draftRead({ subject: "Spring is here", body_html: markupToHtml(body), audience: { stages: ["lead"] } }),
    });
    const result = await run("email_campaign_draft", { name: "Spring", kind: "promotion", subject: "Spring is here", body, audience: { stages: ["lead"] } }, deps);
    expect(result.outcome).toBe("succeeded");
    expect(result.content).toMatchObject({ success: true, campaign_id: CAMPAIGN, created: true });
    expect(String(result.content.note)).toMatch(/Nothing was sent/);
    const sent = calls[0].args;
    expect(sent.p_expected_tenant_id).toBe(TENANT);
    expect(sent.p_campaign_id).toBeNull();
    expect(sent.p_request_key).toBe(await emailCampaignRequestKey(TENANT, ACTOR, { name: "Spring", kind: "promotion", subject: "Spring is here", body, audience: { stages: ["lead"] } }, turn));
    expect(sourceOf(String(sent.p_body_html))).toBe(body);
    expect(sent.p_audience).toEqual({ stages: ["lead"] });
    expect(sent.p_clear_segment).toBe(true);
    expect(calls.some((c) => /approve|send/.test(c.name) && c.name !== "email_campaign_draft")).toBe(false);
  });

  it("changes an existing draft without a request key and leaves unset fields alone", async () => {
    const { deps, calls } = caller({
      email_campaign_draft: { data: { campaign_id: CAMPAIGN, version_id: VERSION, version_no: 2, created: false, replayed: false } },
      read_email_campaigns: draftRead({ version_no: 2, subject: "New subject" }),
    });
    const result = await run("email_campaign_draft", { campaign_id: CAMPAIGN, subject: "New subject" }, deps);
    expect(result.outcome).toBe("succeeded");
    const sent = calls[0].args;
    expect(sent.p_request_key).toBeNull();
    expect(sent.p_body_html).toBeNull();
    expect(sent.p_audience).toBeNull();
    expect(sent.p_clear_segment).toBe(false);
    expect(sent.p_clear_schedule).toBe(false);
  });

  it("does not report a draft as saved when the read-back disagrees", async () => {
    const { deps } = caller({
      email_campaign_draft: { data: { campaign_id: CAMPAIGN, version_id: VERSION, created: false } },
      read_email_campaigns: draftRead({ subject: "Something else" }),
    });
    const result = await run("email_campaign_draft", { campaign_id: CAMPAIGN, subject: "New subject" }, deps);
    expect(result.outcome).toBe("outcome_unknown");
    expect(result.content.success).toBe(false);
  });

  it("refuses to change a campaign awaiting approval, with the editor's way out", async () => {
    const { deps } = caller({ email_campaign_draft: { error: { message: "campaign_awaiting_approval" } } });
    const result = await run("email_campaign_draft", { campaign_id: CAMPAIGN, subject: "x" }, deps);
    expect(result.outcome).toBe("refused");
    expect(String(result.content.error)).toMatch(/Make changes/);
  });

  it("treats an unexplained failure on a write as unknown, never as nothing happened", async () => {
    const { deps } = caller({ email_campaign_draft: { error: { message: "fetch failed: connection reset" } } });
    const result = await run("email_campaign_draft", { subject: "x" }, deps);
    expect(result.outcome).toBe("outcome_unknown");
    expect(String(result.content.note)).toMatch(/do not say it was saved/);
  });

  it("rejects fields the tool does not take, before any database call", async () => {
    const { deps, calls } = caller({});
    for (const args of [{ subject: "x", sender: { mode: "managed" } }, { audience: { everyone: true } }, { kind: "blast" }, { campaign_id: "not-an-id" }, { send_at: "tomorrow-ish" }, { send_at: "2026-10-10T09:00" }]) {
      const result = await run("email_campaign_draft", args, deps);
      expect(result.outcome).toBe("invalid");
      expect(String(result.content.error)).not.toMatch(/_id|send_at|campaign_|segment/);
    }
    expect(calls).toHaveLength(0);
  });

  it("needs an active business", async () => {
    const { deps, calls } = caller({});
    const result = await run("read_email_campaigns", {}, deps, null);
    expect(result.outcome).toBe("invalid");
    expect(calls).toHaveLength(0);
  });

  it("files for approval as PAIGE and says plainly that only a person approves and sends", async () => {
    const { deps, calls } = caller({
      email_campaign_submit_for_approval: { data: { approval_id: APPROVAL, version_id: VERSION, recipients: 42, cost_bound_usd: 0.0168, from_address: "hello@northfield.example", replayed: false } },
      read_email_campaigns: draftRead({ state: "locked", expected_recipients: 42 }),
    });
    const locked = { ...draftRead({ state: "locked" }).data, approval_status: "pending" };
    (deps.caller.rpc as ReturnType<typeof vi.fn>).mockImplementation(async (name: string, args: Record<string, unknown>) => {
      calls.push({ name, args });
      return name === "read_email_campaigns" ? { data: locked, error: null }
        : { data: { approval_id: APPROVAL, version_id: VERSION, recipients: 42, cost_bound_usd: 0.0168, from_address: "hello@northfield.example", replayed: false }, error: null };
    });
    const result = await run("email_campaign_request_approval", { campaign_id: CAMPAIGN }, deps);
    expect(result.outcome).toBe("succeeded");
    expect(result.content).toMatchObject({ success: true, waiting_for_approval: true, recipients: 42 });
    expect(String(result.content.note)).toMatch(/cannot approve or send/);
    expect(calls[0]).toEqual({ name: "email_campaign_submit_for_approval", args: { p_expected_tenant_id: TENANT, p_campaign_id: CAMPAIGN } });
    expect(calls.map((c) => c.name)).not.toContain("email_campaign_approve");
  });

  it("does not claim a filing the read-back cannot see waiting", async () => {
    const { deps } = caller({
      email_campaign_submit_for_approval: { data: { approval_id: APPROVAL, version_id: VERSION, recipients: 3 } },
      read_email_campaigns: draftRead({ state: "draft" }),
    });
    const result = await run("email_campaign_request_approval", { campaign_id: CAMPAIGN }, deps);
    expect(result.outcome).toBe("outcome_unknown");
  });

  it("names the missing postal address instead of filing", async () => {
    const { deps } = caller({ email_campaign_submit_for_approval: { error: { message: "postal_address_missing" } } });
    const result = await run("email_campaign_request_approval", { campaign_id: CAMPAIGN }, deps);
    expect(result.outcome).toBe("refused");
    expect(String(result.content.error)).toMatch(/postal address/);
  });

  it("reports the audience as counts only", async () => {
    const { deps } = caller({ read_email_campaign_audience: { data: {
      campaign_id: CAMPAIGN, version_no: 1, state: "draft", matched: 10, eligible: 7, no_address: 1, opted_out: 1, suppressed: 0, no_consent: 1,
      daily_cap: 500, used_last_24h: 20, remaining_today: 480, postal_address_set: true, newsletter_subscribers_only: false,
    } } });
    const result = await run("read_email_campaign_audience", { campaign_id: CAMPAIGN }, deps);
    expect(result.content).toMatchObject({ success: true, can_receive_today: 7, matched: 10, remaining_today: 480 });
    expect(JSON.stringify(result.content)).not.toMatch(/@/);
  });

  it("gives PAIGE the words a campaign was written in, so her change keeps it editable", async () => {
    const body = "Hello\n- one\n- two";
    const { deps } = caller({ read_email_campaigns: draftRead({ body_html: markupToHtml(body) }) });
    const result = await run("read_email_campaigns", { campaign_id: CAMPAIGN }, deps);
    expect((result.content.version as Record<string, unknown>).body).toBe(body);
    expect(result.content.audience_choices).toEqual({ stages: [{ key: "lead", contacts: 4 }], sources: [], tags: [] });
  });

  it("uses the key the chat settled before approval, and ignores the chat's confirm field", async () => {
    const settled = "66666666-6666-4666-8666-666666666666";
    const { deps, calls } = caller({
      email_campaign_draft: { data: { campaign_id: CAMPAIGN, version_id: VERSION, version_no: 1, created: true } },
      read_email_campaigns: draftRead({ subject: "Hi" }),
    });
    const result = await run("email_campaign_draft", { request_key: settled, confirm: true, subject: "Hi" }, deps);
    expect(result.outcome).toBe("succeeded");
    expect(calls[0].args.p_request_key).toBe(settled);
    const bad = await run("email_campaign_draft", { request_key: "nope", subject: "Hi" }, deps);
    expect(bad.outcome).toBe("invalid");
  });

  it("offers write tools a schema the chat can extend, and read tools their declared input", () => {
    for (const tool of EMAIL_CAMPAIGN_TOOLS) {
      const params = tool.function.parameters as { properties: Record<string, unknown> };
      if (tool.function.name.startsWith("read_")) expect(Object.isFrozen(params)).toBe(true);
      else { expect(Object.isFrozen(params.properties)).toBe(false); params.properties.confirm = { type: "boolean" }; }
    }
  });

  it("accepts a send time only with the owner's offset, and passes it on unchanged in meaning", async () => {
    const { deps, calls } = caller({
      email_campaign_draft: { data: { campaign_id: CAMPAIGN, version_id: VERSION, created: false } },
      read_email_campaigns: draftRead(),
    });
    await run("email_campaign_draft", { campaign_id: CAMPAIGN, send_at: "2030-10-10T09:00:00-05:00" }, deps);
    expect(calls[0].args.p_scheduled_for).toBe("2030-10-10T14:00:00.000Z");
  });

  it("refuses an agency account in the owner's words, and tells PAIGE before replacing an HTML email", async () => {
    const { deps } = caller({ read_email_campaigns: [{ error: { message: "not_for_this_account" } }, draftRead({ body_html: "<table><tr><td>Hi</td></tr></table>" })] });
    const refusal = await run("read_email_campaigns", {}, deps);
    expect(String(refusal.content.error)).toMatch(/inside each business/);
    const read = await run("read_email_campaigns", { campaign_id: CAMPAIGN }, deps);
    expect(String((read.content.version as Record<string, unknown>).body_note)).toMatch(/ask the owner first/);
  });

  it("does not count a draft saved when a field it set reads back different", async () => {
    const { deps } = caller({
      email_campaign_draft: { data: { campaign_id: CAMPAIGN, version_id: VERSION, created: false } },
      read_email_campaigns: draftRead({ audience: { stages: ["customer"] } }),
    });
    const result = await run("email_campaign_draft", { campaign_id: CAMPAIGN, audience: { stages: ["lead"] } }, deps);
    expect(result.outcome).toBe("outcome_unknown");
  });

  it("reads a size limit the database enforced as a refusal, and a replayed create as nothing new", async () => {
    const { deps } = caller({ email_campaign_draft: [{ error: { code: "23514", message: "new row violates check constraint" } },
      { data: { campaign_id: CAMPAIGN, version_id: VERSION, created: true, replayed: true } }], read_email_campaigns: draftRead({ subject: "Hi" }) });
    const refused = await run("email_campaign_draft", { subject: "x" }, deps);
    expect(refused.outcome).toBe("refused");
    expect(String(refused.content.error)).toMatch(/more than an email campaign can hold/);
    const replay = await run("email_campaign_draft", { subject: "Hi" }, deps);
    expect(replay.content).toMatchObject({ success: true, created: false, replayed: true });
    expect(String(replay.content.note)).toMatch(/already saved from the same request/);
  });

  it("admits only an owner/admin seat of the business, never an agency manager or the operator acting as it", () => {
    const seat = { ...NO_WORKSPACE_AUTHORITY, seat: true, workspaceAdmin: true };
    const manager = { ...NO_WORKSPACE_AUTHORITY, seat: false, workspaceAdmin: true };
    const operator = { ...NO_WORKSPACE_AUTHORITY, seat: false, platformOperator: true };
    for (const tool of EMAIL_CAMPAIGN_TOOL_NAMES) {
      expect(requiresWorkspaceAdmin(tool, new Set())).toBe(true);
      expect(authorityAdmits(tool, seat, new Set(), EMAIL_CAMPAIGN_TOOL_NAMES)).toBe(true);
      expect(authorityAdmits(tool, manager, new Set(), EMAIL_CAMPAIGN_TOOL_NAMES)).toBe(false);
      expect(authorityAdmits(tool, operator, new Set(), EMAIL_CAMPAIGN_TOOL_NAMES)).toBe(false);
    }
    const chat = fs.readFileSync("supabase/functions/paige-ai-chat/index.ts", "utf8");
    expect(chat).toContain("authorityAdmits(tc.function.name, await authorityForCall(tc.id), WORKSPACE_BUILD_TOOLS, EMAIL_CAMPAIGN_TOOL_NAMES)");
    expect(chat).toMatch(/const DOOR_SEAT_TOOLS[\s\S]{0,600}\.\.\.EMAIL_CAMPAIGN_TOOL_NAMES/);
  });
});
