// An in-memory world for driving the REAL publish door (supabase/functions/_shared/growth-publish-command/door.ts).
// The door's own code makes every decision; only the two Supabase clients are doubles. The approval
// store filters and claims like PostgREST would (every predicate the door sends is applied), so a
// dropped predicate shows up as a failed test rather than a passing fixture. This is not
// authenticated runtime proof against Supabase.
import { handleGrowthPublishCommand } from "../../supabase/functions/_shared/growth-publish-command/door.ts";

export const USER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
export const OTHER_USER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
export const MINE = "11111111-1111-4111-8111-111111111111";
export const THEIRS = "22222222-2222-4222-8222-222222222222";
export const PAGE = "33333333-3333-4333-8333-333333333333";
export const FORM = "44444444-4444-4444-8444-444444444444";
export const FUNNEL = "55555555-5555-4555-8555-555555555555";
export const IMAGE = "66666666-6666-4666-8666-666666666666";

type Row = Record<string, unknown>;
type Filter = [string, string, unknown, unknown?];

export interface WorldOptions {
  user?: string | null;
  active?: string | null;
  admin?: boolean;
  manages?: boolean;
  lane?: string;
  laneError?: boolean;
  /** Answer for the publish/unpublish RPC, or a function of its args. */
  rpc?: (name: string, args: Row) => { data: unknown; error: unknown } | Promise<{ data: unknown; error: unknown }>;
  tables?: Partial<Record<string, Row[]>>;
  /** Make the active workspace change after N current_user_tenant_id reads. */
  switchAfter?: number;
  recordFails?: boolean;
  auditFails?: boolean;
}

export const livePage = (over: Row = {}): Row => ({
  id: PAGE, tenant_id: MINE, title: "Spring offer", slug: "spring-offer", status: "draft",
  blocks_json: null, draft_blocks_json: [{ type: "hero", title: "Get the weekends back" }], draft_seo_json: null, ...over,
});

export function world(o: WorldOptions = {}) {
  const tables: Record<string, Row[]> = {
    tenants: [{ id: MINE, slug: "acme" }, { id: THEIRS, slug: "other" }],
    growth_pages: [livePage()],
    growth_forms: [{ id: FORM, tenant_id: MINE, name: "Intake", slug: "intake", status: "draft",
      draft_schema_json: { sections: [{ fields: [{ key: "email", label: "Email", type: "email" }] }] }, schema_json: null,
      success_action_json: null, draft_success_action_json: { type: "thank_you", message: "Thanks!" },
      auto_create_deal: false, pipeline_id: null, notify_email: null }],
    growth_funnels: [{ id: FUNNEL, tenant_id: MINE, name: "Launch", slug: "launch", status: "draft" }],
    growth_funnel_steps: [{ funnel_id: FUNNEL, tenant_id: MINE, step_type: "page", page_id: PAGE, form_id: null }],
    marketing_content: [{ id: IMAGE, tenant_id: MINE, title: "Hero shot", kind: "image", image_url: "https://cdn.test/a.png", status: "draft" }],
    paige_pending_confirmations: [],
    paige_audit_log: [],
    ...(o.tables as Record<string, Row[]>),
  };
  const seen = {
    rpc: [] as Array<{ fn: string; args?: Row; client: "caller" | "admin" }>,
    receipts: [] as Row[],
    reads: [] as Array<{ table: string; filters: Filter[] }>,
  };
  let tenantReads = 0;

  const matches = (row: Row, filters: Filter[]) => filters.every(([op, col, value]) => {
    const v = row[col];
    switch (op) {
      case "eq": return v === value;
      case "neq": return v !== value;
      case "is": return value === null ? v == null : v === value;
      case "not": return v != null; // only ever `not(col, "is", null)` here
      case "gt": return v != null && String(v) > String(value);
      case "lte": return v != null && String(v) <= String(value);
      case "in": return (value as unknown[]).includes(v);
      case "contains": return Object.entries(value as Row).every(([k, x]) => (v as Row | null)?.[k] === x);
      default: throw new Error(`unsupported filter ${op}`);
    }
  });

  const from = (table: string) => {
    const filters: Filter[] = [];
    let update: Row | null = null, insert: Row | null = null, limit = Infinity;
    const run = () => {
      const rows = tables[table] ?? (tables[table] = []);
      seen.reads.push({ table, filters: [...filters] });
      if (insert) {
        if (table === "paige_audit_log" && o.auditFails) return { data: null, error: { message: "audit down" } };
        if (table === "paige_pending_confirmations" && rows.some((r) => r.consumed_at == null
          && r.user_id === insert!.user_id && r.tenant_id === insert!.tenant_id && r.tool_name === insert!.tool_name && r.fingerprint === insert!.fingerprint)) {
          return { data: null, error: { code: "23505", message: "duplicate" } };
        }
        const row = { consumed_at: null, ...insert };
        rows.push(row);
        return { data: [row], error: null };
      }
      const hit = rows.filter((r) => matches(r, filters)).slice(0, limit);
      if (update) for (const r of hit) Object.assign(r, update);
      return { data: hit, error: null };
    };
    const q: Record<string, unknown> = {
      select: () => q, order: () => q,
      eq: (c: string, v: unknown) => { filters.push(["eq", c, v]); return q; },
      neq: (c: string, v: unknown) => { filters.push(["neq", c, v]); return q; },
      is: (c: string, v: unknown) => { filters.push(["is", c, v]); return q; },
      not: (c: string, op: string, v: unknown) => { filters.push(["not", c, op, v]); return q; },
      gt: (c: string, v: unknown) => { filters.push(["gt", c, v]); return q; },
      lte: (c: string, v: unknown) => { filters.push(["lte", c, v]); return q; },
      in: (c: string, v: unknown) => { filters.push(["in", c, v]); return q; },
      contains: (c: string, v: unknown) => { filters.push(["contains", c, v]); return q; },
      limit: (n: number) => { limit = n; return q; },
      update: (patch: Row) => { update = patch; return q; },
      insert: (row: Row) => { insert = row; return q; },
      maybeSingle: async () => { const r = run(); return { data: Array.isArray(r.data) ? r.data[0] ?? null : r.data, error: r.error }; },
      then: (ok: (v: unknown) => unknown, bad: (e: unknown) => unknown) => Promise.resolve(run()).then(ok, bad),
    };
    return q;
  };

  const caller = {
    auth: { getUser: async () => (o.user === null ? { data: { user: null }, error: { message: "bad jwt" } } : { data: { user: { id: o.user ?? USER } }, error: null }) },
    rpc: async (fn: string, args?: Row) => {
      seen.rpc.push({ fn, args, client: "caller" });
      if (fn === "current_user_tenant_id") {
        tenantReads += 1;
        if (o.switchAfter !== undefined && tenantReads > o.switchAfter) return { data: THEIRS, error: null };
        return { data: o.active === undefined ? MINE : o.active, error: null };
      }
      if (fn === "is_tenant_admin") return { data: o.admin !== false, error: null };
      if (fn === "agency_can_manage_child") return { data: o.manages === true, error: null };
      if (fn === "resolve_tool_autonomy") return o.laneError ? { data: null, error: { message: "down" } } : { data: o.lane ?? "confirm", error: null };
      if (o.rpc) return await o.rpc(fn, args ?? {});
      return { data: null, error: { code: "PGRST202", message: `no rpc ${fn}` } };
    },
  };
  const admin = {
    from,
    rpc: async (fn: string, args?: Row) => {
      seen.rpc.push({ fn, args, client: "admin" });
      if (fn === "record_capability_run") {
        if (o.recordFails) return { data: null, error: { message: "permission denied" } };
        seen.receipts.push(args ?? {});
        return { data: true, error: null };
      }
      return { data: null, error: { message: `unexpected admin rpc ${fn}` } };
    },
  };

  const call = async (body: Row, method = "POST") => {
    const res = await handleGrowthPublishCommand(new Request("https://edge.test/growth-publish-command", {
      method, headers: { Authorization: "Bearer test" }, ...(method === "POST" ? { body: JSON.stringify(body) } : {}),
    }), { caller, admin });
    return { status: res.status, body: await res.json().catch(() => null) as Row };
  };
  const executorCalls = () => seen.rpc.filter((c) => c.client === "caller" && /_(un)?publish$/.test(c.fn));
  return { tables, seen, call, executorCalls };
}

/** A publish RPC that answers like the real one for a page. */
export const pagePublished = (_fn: string, args: Row) => ({
  data: { id: args.p_id, slug: "spring-offer", tenant_slug: "acme", status: "published", published_at: "2026-10-04T10:00:00Z", url: "/p/acme/spring-offer" },
  error: null,
});
