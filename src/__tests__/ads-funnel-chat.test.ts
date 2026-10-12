// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import {
  ADS_FUNNEL_TOOLS, ADS_FUNNEL_TOOL_NAMES, defaultPipeline, dispatchAdsFunnelChat, projectFunnel, windowStart,
} from "../../supabase/functions/_shared/ads-funnel-chat.ts";
import {
  ADS_CAPABILITIES, ADS_CREATIVE_FEATURE_CAPABILITY, ADS_LEAD_FUNNEL_READ_CAPABILITY,
} from "../../supabase/functions/_shared/paige-spine/domains/ads.ts";
import { PAIGE_SPINE_CAPABILITIES } from "../../supabase/functions/_shared/paige-spine/registry.ts";
import { requiresWorkspaceAdmin, authorityAdmits } from "../../supabase/functions/_shared/workspace-authority.ts";
import { classifyAction, mutatingTools } from "../../supabase/functions/_shared/action-risk.ts";
import { STEP_START_LABELS } from "../../supabase/functions/_shared/paige-turn/step-start.ts";

const TENANT = "11111111-1111-4111-8111-111111111111";
const OTHER_TENANT = "99999999-9999-4999-8999-999999999999";
const DEFAULT_PIPE = "aaaaaaaa-0000-4000-8000-000000000001";
const OLDER_ARCHIVED_DEFAULT = "aaaaaaaa-0000-4000-8000-000000000002";
const SECOND_PIPE = "aaaaaaaa-0000-4000-8000-000000000003";
const FOREIGN_PIPE = "aaaaaaaa-0000-4000-8000-000000000004";
const STAGE_NEW = "bbbbbbbb-0000-4000-8000-000000000001";
const STAGE_WON = "bbbbbbbb-0000-4000-8000-000000000002";
const PICTURE = "cccccccc-0000-4000-8000-000000000001";
const ARCHIVED_PICTURE = "cccccccc-0000-4000-8000-000000000002";
const COPY = "cccccccc-0000-4000-8000-000000000003";
const FOREIGN_PICTURE = "cccccccc-0000-4000-8000-000000000004";
// 2026-10-12T15:30:00Z — a fixed clock, so the window is exact.
const NOW = Date.UTC(2026, 9, 12, 15, 30);

type Row = Record<string, unknown>;
type Opts = {
  active?: string | null | (() => string | null);
  pipelines?: Row[];
  funnel?: (args: Row) => { data: unknown; error: unknown };
  feature?: (args: Row) => { data: unknown; error: unknown } | "throw";
  /** What the picture reads as after the write; defaults to the write landing. */
  afterWrite?: (row: Row, featured: boolean) => Row;
};
const pipelinesFixture: Row[] = [
  { id: SECOND_PIPE, tenant_id: TENANT, name: "Partners", is_default: false, lifecycle_status: "active", created_at: "2026-02-01T00:00:00Z" },
  { id: DEFAULT_PIPE, tenant_id: TENANT, name: "Sales", is_default: true, lifecycle_status: "active", created_at: "2026-03-01T00:00:00Z" },
  { id: OLDER_ARCHIVED_DEFAULT, tenant_id: TENANT, name: "Old", is_default: true, lifecycle_status: "archived", created_at: "2026-01-01T00:00:00Z" },
  { id: FOREIGN_PIPE, tenant_id: OTHER_TENANT, name: "Theirs", is_default: true, lifecycle_status: "active", created_at: "2025-01-01T00:00:00Z" },
];
const FUNNEL = {
  pipeline: { id: DEFAULT_PIPE, name: "Sales", is_default: true }, stages_window: "current",
  stages: [{ id: STAGE_NEW, name: "New lead", order_index: 0, stage_type: "open", deals: 5 }, { id: STAGE_WON, name: "Won", order_index: 1, stage_type: "won", deals: 2 }],
  leads: { total: 9, tagged: 6, untagged: 3, unfiled: 1 },
  campaigns: [{ campaign: "Spring", leads: 6, open: 3, won: 2, lost: 0, by_stage: { [STAGE_NEW]: 3, [STAGE_WON]: 2, "deadbeef-0000-4000-8000-000000000000": 1 } }],
  ads: [{ ad: PICTURE, campaign: "Spring", content_id: PICTURE, kind: "image", image_url: "https://cdn.test/p.png", leads: 4, open: 2, won: 2, lost: 0 }],
  since: null,
};

/** A caller-session double: one RPC surface and two tables, filtered the way PostgREST filters them. */
function database(opts: Opts = {}) {
  const calls: { name: string; args: Row }[] = [];
  const reads: { table: string; filters: [string, unknown][] }[] = [];
  const content: Row[] = [
    { id: PICTURE, tenant_id: TENANT, title: "Spring hero", kind: "image", status: "active", meta: {} },
    { id: ARCHIVED_PICTURE, tenant_id: TENANT, title: "Old banner", kind: "image", status: "archived", meta: {} },
    { id: COPY, tenant_id: TENANT, title: "Ad words", kind: "text", status: "active", meta: {} },
    { id: FOREIGN_PICTURE, tenant_id: OTHER_TENANT, title: "Not yours", kind: "image", status: "active", meta: {} },
    ...[1, 2, 3, 4, 5, 6].map((n) => ({ id: `dddddddd-0000-4000-8000-00000000000${n}`, tenant_id: TENANT, title: `Featured ${n}`, kind: "image", status: "active", meta: { ads_featured: false } })),
  ];
  const tables: Record<string, Row[]> = { pipelines: opts.pipelines ?? pipelinesFixture, marketing_content: content };
  const from = (table: string) => ({
    select: (_columns: string) => {
      const filters: [string, unknown][] = [];
      let limit = Infinity;
      const q = {
        eq(column: string, value: unknown) { filters.push([column, value]); return q; },
        limit(n: number) { limit = n; return q; },
        then(resolve: (r: { data: unknown; error: unknown }) => unknown, reject?: (e: unknown) => unknown) {
          reads.push({ table, filters });
          const rows = (tables[table] ?? []).filter((row) => filters.every(([c, v]) => c === "meta->>ads_featured"
            ? String((row.meta as Row)?.ads_featured === true) === v : row[c] === v)).slice(0, limit);
          return Promise.resolve({ data: rows.map((r) => ({ ...r })), error: null }).then(resolve, reject);
        },
      };
      return q;
    },
  });
  const rpc = vi.fn(async (name: string, args: Row = {}) => {
    calls.push({ name, args });
    if (name === "current_user_tenant_id") {
      const active = typeof opts.active === "function" ? opts.active() : opts.active === undefined ? TENANT : opts.active;
      return { data: active, error: null };
    }
    if (name === "get_pipeline_lead_funnel") return (opts.funnel ?? (() => ({ data: FUNNEL, error: null })))(args) as { data: unknown; error: null };
    if (name === "set_ad_creative_featured") {
      const answer = opts.feature ? opts.feature(args) : null;
      if (answer === "throw") throw new Error("network");
      if (answer) return answer as { data: unknown; error: null };
      const row = content.find((r) => r.id === args.p_content_id)!;
      const next = opts.afterWrite ? opts.afterWrite(row, args.p_featured as boolean) : { ...row, meta: { ...(row.meta as Row), ads_featured: args.p_featured } };
      Object.assign(row, next);
      return { data: { id: row.id, featured: args.p_featured }, error: null };
    }
    throw new Error(`unexpected rpc ${name}`);
  });
  return { deps: { caller: { rpc, from } }, calls, reads, content, rpcNames: () => calls.map((c) => c.name) };
}
const run = (toolName: string, args: Row, db = database()) => dispatchAdsFunnelChat({ tenantId: TENANT, toolName, args }, db.deps, () => NOW);

describe("Ads chat tools — declaration and governance", () => {
  it("declares exactly the funnel read and the showroom feature, with the Kit's own input", () => {
    expect([...ADS_FUNNEL_TOOL_NAMES].sort()).toEqual(["get_pipeline_lead_funnel", "set_ad_creative_featured"]);
    const read = ADS_FUNNEL_TOOLS.find((t) => t.function.name === "get_pipeline_lead_funnel")!.function;
    expect(read.parameters).toBe(ADS_LEAD_FUNNEL_READ_CAPABILITY.input);
    const write = ADS_FUNNEL_TOOLS.find((t) => t.function.name === "set_ad_creative_featured")!.function;
    expect(write.parameters).toEqual(JSON.parse(JSON.stringify(ADS_CREATIVE_FEATURE_CAPABILITY.input)));
    expect([...ADS_CREATIVE_FEATURE_CAPABILITY.input.required]).toEqual(["content_id", "featured"]);
    for (const tool of ADS_FUNNEL_TOOLS) expect(tool.function.name).not.toMatch(/publish|launch|spend|activate|budget/);
  });

  it("tells PAIGE there is no ad-provider data, and how to find a picture's id", () => {
    const read = ADS_FUNNEL_TOOLS[0].function.description;
    expect(read).toMatch(/NO ad-platform data/);
    expect(read).toMatch(/no impressions, clicks, reach, spend, cost per lead or return on ad spend/);
    expect(read).toMatch(/unfiled counts leads in the window that reached no pipeline/);
    const write = ADS_FUNNEL_TOOLS[1].function.description;
    expect(write).toMatch(/ads\[\]\.content_id from get_pipeline_lead_funnel/);
    expect(write).toMatch(/No tool lists the whole library/);
    expect(write).toMatch(/publishes nothing, sends nothing and spends nothing/);
  });

  it("registers both in the Spine as workspace-admin, LIVE chat, PARTIAL maturity, on the real RPCs", () => {
    const funnel = PAIGE_SPINE_CAPABILITIES.find((c) => c.action?.chatTool === "get_pipeline_lead_funnel");
    expect(funnel).toMatchObject({ key: "ads.lead_funnel", domain: "ads", readiness: "none", chatBinding: "LIVE", maturity: "PARTIAL", mindBinding: "UNAVAILABLE",
      action: { classification: "read", executor: "public.get_pipeline_lead_funnel", seatAuthority: "workspace-admin", riskPolicyKey: "read_only", approvalAuthority: "none" } });
    const feature = PAIGE_SPINE_CAPABILITIES.find((c) => c.action?.chatTool === "set_ad_creative_featured");
    expect(feature).toMatchObject({ key: "ads.creative_feature", domain: "ads", readiness: "none", chatBinding: "LIVE", maturity: "PARTIAL",
      action: { classification: "mutate", executor: "public.set_ad_creative_featured", seatAuthority: "workspace-admin", riskPolicyKey: "ordinary", approvalAuthority: "chat-canonical" } });
    expect(ADS_CAPABILITIES).toHaveLength(2);
  });

  it("asks first by default: ordinary, governed, owner/admin (or agency, or platform owner) only", () => {
    expect(classifyAction("set_ad_creative_featured")).toBe("ordinary");
    expect(mutatingTools().has("set_ad_creative_featured")).toBe(true);
    expect(mutatingTools().has("get_pipeline_lead_funnel")).toBe(false);
    for (const tool of ADS_FUNNEL_TOOL_NAMES) {
      expect(requiresWorkspaceAdmin(tool, new Set())).toBe(true);
      expect(authorityAdmits(tool, { workspaceAdmin: false, seat: true, platformOperator: false }, new Set())).toBe(false);
      expect(authorityAdmits(tool, { workspaceAdmin: true, seat: false, platformOperator: false }, new Set())).toBe(true);
      expect(authorityAdmits(tool, { workspaceAdmin: false, seat: false, platformOperator: true }, new Set())).toBe(true);
      expect(typeof STEP_START_LABELS[tool]).toBe("string");
    }
  });

  it("is mounted for the tenant tier on the caller's own session, never the service role", () => {
    const chat = fs.readFileSync("supabase/functions/paige-ai-chat/index.ts", "utf8");
    expect(chat).toContain('if (callerTier === "tenant") toolDefs.push(...ADS_FUNNEL_TOOLS as any);');
    expect(chat).toContain("dispatchAdsFunnelChat({ tenantId: tid, toolName: tc.function.name, args: adsArgs }, { caller: supabaseClient })");
    expect(chat).not.toMatch(/dispatchAdsFunnelChat\([^)]*caller: supabase\b/);
    expect(chat).toMatch(/case "set_ad_creative_featured": \{[\s\S]{0,1400}Feature \$\{named\} in your Ads showroom/);
    expect(chat).toMatch(/set_ad_creative_featured: "marketing_content"/);
    const adapter = fs.readFileSync("supabase/functions/_shared/ads-funnel-chat.ts", "utf8");
    expect(adapter).not.toMatch(/service_role|SUPABASE_SERVICE_ROLE|createClient/);
  });

  it("catalogues the feature for Autonomy settings, forwarding every earlier row", () => {
    const sql = fs.readFileSync("supabase/migrations/20271021210000_ads_paige_chat_tools_catalogue.sql", "utf8");
    expect(sql).toMatch(/RETURN QUERY SELECT \* FROM public\._list_tool_autonomy_before_ads_chat\(_tenant_id\);/);
    expect(sql).toMatch(/\('set_ad_creative_featured','Feature a picture in your Ads showroom','Content'\)/);
    expect(sql).toMatch(/coalesce\(a\.mode,'confirm'\)/);
    expect(sql).not.toMatch(/get_pipeline_lead_funnel'/);
  });
});

describe("get_pipeline_lead_funnel from chat", () => {
  it("uses the default pipeline (oldest live default), all time, and projects stage names", async () => {
    const db = database();
    const result = await run("get_pipeline_lead_funnel", {}, db);
    expect(result.outcome).toBe("succeeded");
    const call = db.calls.find((c) => c.name === "get_pipeline_lead_funnel")!;
    expect(call.args).toEqual({ p_pipeline_id: DEFAULT_PIPE, p_since: null });
    const c = result.content as Row;
    expect(c.pipeline).toEqual({ id: DEFAULT_PIPE, name: "Sales", is_default: true });
    expect(c.window).toEqual({ days: null, since: null, all_time: true });
    expect(c.leads).toEqual({ total: 9, tagged: 6, untagged: 3, unfiled: 1 });
    expect((c.campaigns as Row[])[0].by_stage).toEqual({ "New lead": 3, Won: 2, "A stage no longer in use": 1 });
    expect((c.ads as Row[])[0]).toEqual({ ad: PICTURE, campaign: "Spring", content_id: PICTURE, kind: "image", leads: 4, open: 2, won: 2, lost: 0 });
    expect(JSON.stringify(c)).not.toContain("cdn.test");
    expect(c.other_pipelines).toEqual([{ id: SECOND_PIPE, name: "Partners" }]);
    expect(String(c.note)).toMatch(/no ad-platform data/);
    // The tenant's pipelines only, read on the caller's session; the active business checked before and after.
    expect(db.reads[0]).toEqual({ table: "pipelines", filters: [["tenant_id", TENANT]] });
    expect(db.rpcNames()).toEqual(["current_user_tenant_id", "get_pipeline_lead_funnel", "current_user_tenant_id"]);
  });

  it("counts leads from the start of the UTC day N-1 days ago", async () => {
    const db = database();
    await run("get_pipeline_lead_funnel", { days: 30 }, db);
    expect(db.calls.find((c) => c.name === "get_pipeline_lead_funnel")!.args.p_since).toBe("2026-09-13T00:00:00.000Z");
    expect(windowStart(7, NOW)).toBe("2026-10-06T00:00:00.000Z");
  });

  it("says plainly when the business has no Sales pipeline yet, and reads no funnel", async () => {
    const db = database({ pipelines: [] });
    const result = await run("get_pipeline_lead_funnel", {}, db);
    expect(result.outcome).toBe("succeeded");
    expect(result.content).toMatchObject({ success: true, no_pipeline: true });
    expect(String(result.content.message)).toMatch(/no Sales pipeline yet/);
    expect(db.rpcNames()).not.toContain("get_pipeline_lead_funnel");
  });

  it("asks which pipeline when there are several and none is default", async () => {
    const db = database({ pipelines: pipelinesFixture.filter((p) => p.id === SECOND_PIPE || p.id === OLDER_ARCHIVED_DEFAULT).concat([{ ...pipelinesFixture[1], is_default: false }]) });
    const result = await run("get_pipeline_lead_funnel", {}, db);
    expect(result.content).toMatchObject({ success: false, outcome: "needs_input" });
    expect((result.content.pipelines as Row[]).map((p) => p.name).sort()).toEqual(["Partners", "Sales"]);
    expect(db.rpcNames()).not.toContain("get_pipeline_lead_funnel");
  });

  it("refuses another business's pipeline before asking the database", async () => {
    const db = database();
    const result = await run("get_pipeline_lead_funnel", { pipeline_id: FOREIGN_PIPE }, db);
    expect(result).toMatchObject({ outcome: "refused", content: { code: "pipeline_not_found" } });
    expect(db.rpcNames()).not.toContain("get_pipeline_lead_funnel");
  });

  it("maps PIPELINE_FORBIDDEN to the owners-and-admins sentence", async () => {
    const db = database({ funnel: () => ({ data: null, error: { code: "42501", message: "PIPELINE_FORBIDDEN" } }) });
    const result = await run("get_pipeline_lead_funnel", { pipeline_id: SECOND_PIPE }, db);
    expect(result.outcome).toBe("refused");
    expect(result.content.error).toBe("Campaign results are for owners and admins of this business.");
  });

  it("refuses when the active business is not the chat's, and when it changes during the read", async () => {
    const away = database({ active: OTHER_TENANT });
    expect((await run("get_pipeline_lead_funnel", {}, away)).content.code).toBe("active_account_changed");
    expect(away.reads).toHaveLength(0);
    let n = 0;
    const switched = database({ active: () => (n++ === 0 ? TENANT : OTHER_TENANT) });
    const result = await run("get_pipeline_lead_funnel", {}, switched);
    expect(result).toMatchObject({ outcome: "refused", content: { code: "active_account_changed" } });
    expect(result.content).not.toHaveProperty("leads");
  });

  it("refuses malformed input and an unreadable answer without inventing figures", async () => {
    expect((await run("get_pipeline_lead_funnel", { days: 14 })).outcome).toBe("invalid");
    expect((await run("get_pipeline_lead_funnel", { pipeline_id: "Sales" })).outcome).toBe("invalid");
    expect((await run("get_pipeline_lead_funnel", { tenant_id: OTHER_TENANT })).outcome).toBe("invalid");
    const garbled = database({ funnel: () => ({ data: { pipeline: { id: DEFAULT_PIPE } }, error: null }) });
    expect((await run("get_pipeline_lead_funnel", {}, garbled)).outcome).toBe("failed");
    expect(projectFunnel({ ...FUNNEL, ads: "x" })).toBeNull();
    expect(defaultPipeline([])).toBeNull();
  });
});

describe("set_ad_creative_featured from chat", () => {
  it("features a picture and reports it only after reading it back", async () => {
    const db = database();
    const result = await run("set_ad_creative_featured", { content_id: PICTURE, featured: true, confirm: true }, db);
    expect(result.outcome).toBe("succeeded");
    expect(db.calls.find((c) => c.name === "set_ad_creative_featured")!.args).toEqual({ p_content_id: PICTURE, p_featured: true });
    expect(result.content).toMatchObject({ success: true, changed: true, content_id: PICTURE, title: "Spring hero", featured: true });
    expect(String(result.content.note)).toMatch(/"Spring hero" is now featured in the Ads showroom/);
    // Read before, write, read back — every read scoped to this business.
    expect(db.reads.filter((r) => r.table === "marketing_content").every((r) => r.filters.some(([c, v]) => c === "tenant_id" && v === TENANT))).toBe(true);
  });

  it("at the limit, says 'up to 6' and names what is featured now", async () => {
    const db = database({ feature: () => ({ data: null, error: { code: "22023", message: "AD_FEATURED_LIMIT" } }) });
    db.content.filter((r) => String(r.title).startsWith("Featured")).forEach((r) => { r.meta = { ads_featured: true }; });
    const result = await run("set_ad_creative_featured", { content_id: PICTURE, featured: true }, db);
    expect(result.outcome).toBe("refused");
    expect(result.content.error).toBe("You can feature up to 6; unfeature one first.");
    expect((result.content.featured_now as Row[]).map((r) => r.title)).toEqual(["Featured 1", "Featured 2", "Featured 3", "Featured 4", "Featured 5", "Featured 6"]);
  });

  it("refuses an archived picture, a non-picture and another business's picture before writing", async () => {
    for (const [id, code] of [[ARCHIVED_PICTURE, "content_archived"], [COPY, "content_not_picture"], [FOREIGN_PICTURE, "content_not_found"]] as const) {
      const db = database();
      const result = await run("set_ad_creative_featured", { content_id: id, featured: true }, db);
      expect(result).toMatchObject({ outcome: "refused", content: { code } });
      expect(db.rpcNames()).not.toContain("set_ad_creative_featured");
    }
  });

  it("writes nothing when the picture is already as asked", async () => {
    const db = database();
    const result = await run("set_ad_creative_featured", { content_id: PICTURE, featured: false }, db);
    expect(result).toMatchObject({ outcome: "unchanged", content: { success: true, changed: false } });
    expect(db.rpcNames()).not.toContain("set_ad_creative_featured");
  });

  it("maps the server's refusals to plain words", async () => {
    for (const [message, code] of [["AD_CREATIVE_FORBIDDEN", "feature_not_permitted"], ["AD_CREATIVE_ARCHIVED", "content_archived"], ["AD_CREATIVE_KIND_INVALID", "content_not_picture"]]) {
      const db = database({ feature: () => ({ data: null, error: { code: message === "AD_CREATIVE_FORBIDDEN" ? "42501" : "22023", message } }) });
      expect((await run("set_ad_creative_featured", { content_id: PICTURE, featured: true }, db)).content.code).toBe(code);
    }
  });

  it("never claims a change it cannot read back", async () => {
    const lost = database({ afterWrite: (row) => row });
    expect((await run("set_ad_creative_featured", { content_id: PICTURE, featured: true }, lost)).outcome).toBe("outcome_unknown");
    const thrown = database({ feature: () => "throw" });
    expect((await run("set_ad_creative_featured", { content_id: PICTURE, featured: true }, thrown)).outcome).toBe("outcome_unknown");
    const odd = database({ feature: () => ({ data: null, error: { code: "57014", message: "canceling statement" } }) });
    expect((await run("set_ad_creative_featured", { content_id: PICTURE, featured: true }, odd)).outcome).toBe("outcome_unknown");
  });

  it("refuses malformed input before reading anything", async () => {
    const db = database();
    for (const args of [{ content_id: PICTURE }, { content_id: PICTURE, featured: "true" }, { content_id: "spring", featured: true }, { content_id: PICTURE, featured: true, tenant_id: OTHER_TENANT }]) {
      expect((await run("set_ad_creative_featured", args, db)).outcome).toBe("invalid");
    }
    expect(db.calls).toHaveLength(0);
    expect((await dispatchAdsFunnelChat({ tenantId: null, toolName: "set_ad_creative_featured", args: { content_id: PICTURE, featured: true } }, db.deps)).outcome).toBe("invalid");
  });
});
