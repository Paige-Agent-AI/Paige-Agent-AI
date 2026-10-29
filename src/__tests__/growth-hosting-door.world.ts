// An in-memory world for driving the REAL hosting door (supabase/functions/_shared/growth-hosting-command/door.ts).
// Mirrors growth-publish-door.world.ts: the door's own code makes every decision; only the two
// Supabase clients, the export builder, the provider and the network fetch are doubles. The
// approval store filters and claims like PostgREST would (every predicate the door sends is
// applied), so a dropped predicate fails a test rather than passing a fixture. This is not
// authenticated runtime proof against Supabase or Cloudflare.
import { handleGrowthHostingCommand, type HostingDoorDeps } from "../../supabase/functions/_shared/growth-hosting-command/door.ts";
import { decideDeclaredCapability } from "../../supabase/functions/_shared/capability-kit/decision.ts";
import { GROWTH_HOSTING_KIT_BY_ACTION } from "../../supabase/functions/_shared/paige-spine/domains/growth_hosting.ts";
import type { HostingExport } from "../../supabase/functions/_shared/growth-hosting-command/contract.ts";

/** The same binding index.ts makes — the real Kit gate over the real declaration map. */
export const realDecide = (key: string, input: Parameters<typeof decideDeclaredCapability>[1]) =>
  decideDeclaredCapability(GROWTH_HOSTING_KIT_BY_ACTION[key as keyof typeof GROWTH_HOSTING_KIT_BY_ACTION], input);

export const USER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
export const MINE = "11111111-1111-4111-8111-111111111111";
export const THEIRS = "22222222-2222-4222-8222-222222222222";
export const PAGE = "33333333-3333-4333-8333-333333333333";

/** The page row the door reads (PUBLISHED — the only status that may be hosted). */
export const publishedPage = (over: Row = {}): Row => ({
  id: PAGE, tenant_id: MINE, title: "Spring offer", slug: "spring-offer", status: "published",
  blocks_json: [{ type: "hero", title: "Get the weekends back" }], theme_json: null, seo_json: null,
  og_image_url: null, published_at: "2026-10-04T10:00:00Z", ...over,
});

/** The export the doubled builder produces — fixed bytes so verification is exact. */
export const EXPORT_HTML = "<!doctype html><html><body><h1>Spring offer</h1></body></html>";
export const EXPORT_SHA = "ab".repeat(32);

type Row = Record<string, unknown>;
type Filter = [string, string, unknown, unknown?];

export interface WorldOptions {
  user?: string | null;
  active?: string | null;
  admin?: boolean;
  manages?: boolean;
  lane?: string;
  laneError?: boolean;
  /** The provider configuration; null/absent = the DORMANT door (no token exists). */
  provider?: { accountId: string; apiToken: string } | null;
  /** What the doubled export builder returns for the page (null = "couldn't be built"). */
  exportResult?: HostingExport | null;
  /** Route every network call: the provider API (api.cloudflare.test) and the deployed address. */
  fetchImpl?: typeof fetch;
  /** Make the audit insert fail. */
  auditFails?: boolean;
}

export function world(o: WorldOptions = {}) {
  const tables: Record<string, Row[]> = {
    tenants: [{ id: MINE, slug: "acme" }, { id: THEIRS, slug: "other" }],
    growth_pages: [publishedPage()],
    growth_hosted_deployments: [],
    paige_pending_confirmations: [],
    paige_audit_log: [],
    platform_usage_events: [],
  };
  const seen = {
    rpc: [] as Array<{ fn: string; args?: Row; client: "caller" | "admin" }>,
    receipts: [] as Row[],
    fetches: [] as string[],
  };
  let tenantReads = 0;

  const matches = (row: Row, filters: Filter[]) => filters.every(([op, col, value]) => {
    const v = row[col];
    switch (op) {
      case "eq": return v === value;
      case "neq": return v !== value;
      case "is": return value === null ? v == null : v === value;
      case "not": return v != null;
      case "gt": return v != null && String(v) > String(value);
      case "lte": return v != null && String(v) <= String(value);
      case "in": return (value as unknown[]).includes(v);
      case "contains": return Object.entries(value as Row).every(([k, x]) => (v as Row | null)?.[k] === x);
      default: throw new Error(`unsupported filter ${op}`);
    }
  });

  const from = (table: string) => {
    const filters: Filter[] = [];
    let update: Row | null = null, insert: Row | null = null, upsert: Row | null = null, upsertKey: string[] | null = null, limit = Infinity;
    const run = () => {
      const rows = tables[table] ?? (tables[table] = []);
      if (upsert) {
        const key = upsertKey ?? ["id"];
        const existing = rows.find((r) => key.every((c) => r[c] === upsert![c]));
        if (existing) Object.assign(existing, upsert);
        else rows.push({ ...upsert });
        return { data: [upsert], error: null };
      }
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
      upsert: (row: Row, opts?: { onConflict?: string }) => { upsert = row; upsertKey = opts?.onConflict?.split(",") ?? null; return q; },
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
        return { data: o.active === undefined ? MINE : o.active, error: null };
      }
      if (fn === "is_tenant_admin") return { data: o.admin !== false, error: null };
      if (fn === "agency_can_manage_child") return { data: o.manages === true, error: null };
      if (fn === "resolve_tool_autonomy") return o.laneError ? { data: null, error: { message: "down" } } : { data: o.lane ?? "confirm", error: null };
      return { data: null, error: { code: "PGRST202", message: `no rpc ${fn}` } };
    },
  };
  const admin = {
    from,
    rpc: async (fn: string, args?: Row) => {
      seen.rpc.push({ fn, args, client: "admin" });
      if (fn === "record_capability_run") {
        seen.receipts.push(args ?? {});
        return { data: true, error: null };
      }
      return { data: null, error: { message: `unexpected admin rpc ${fn}` } };
    },
  };

  const exportResult: HostingExport | null = o.exportResult === undefined
    ? { html: EXPORT_HTML, fileName: "acme-spring-offer.html", sha256: EXPORT_SHA }
    : o.exportResult;
  const buildExport = async () => exportResult;

  const defaultFetch: typeof fetch = async (input, init) => {
    const url = String(input);
    const method = (init?.method ?? (typeof input === "object" && "method" in input ? String((input as Request).method) : "GET")).toUpperCase();
    seen.fetches.push(`${method} ${url}`);
    if (url.includes("api.cloudflare.")) {
      if (url.endsWith("/workers/scripts/acme-spring-offer") && method === "PUT") {
        return new Response(JSON.stringify({ success: true, errors: [], result: { subdomain: "paige.test-workers.dev" } }), { status: 200 });
      }
      if (url.endsWith("/workers/scripts/acme-spring-offer") && method === "DELETE") {
        return new Response(JSON.stringify({ success: true, errors: [] }), { status: 200 });
      }
      return new Response(JSON.stringify({ success: false, errors: [{ code: 10000, message: "not found" }] }), { status: 404 });
    }
    // The deployed address serves the export's exact bytes by default.
    return new Response(EXPORT_HTML, { status: 200 });
  };

  const deps = (): HostingDoorDeps => ({
    caller, admin,
    decide: realDecide,
    providerConfig: o.provider === undefined ? { accountId: "acct-1", apiToken: "tok" } : o.provider,
    buildExport,
    fetchImpl: (async (input: RequestInfo | URL, init?: RequestInit) => {
      if (o.fetchImpl) return o.fetchImpl(input as Parameters<typeof fetch>[0], init as Parameters<typeof fetch>[1]);
      return defaultFetch(input as Parameters<typeof fetch>[0], init as Parameters<typeof fetch>[1]);
    }) as typeof fetch,
  });

  const call = async (body: Row, method = "POST") => {
    const res = await handleGrowthHostingCommand(new Request("https://edge.test/growth-hosting-command", {
      method, headers: { Authorization: "Bearer test" }, ...(method === "POST" ? { body: JSON.stringify(body) } : {}),
    }), deps());
    return { status: res.status, body: await res.json().catch(() => null) as Row };
  };
  return { tables, seen, call };
}

/** Approve the door's 202 proposal: returns the fingerprint to redeem. */
export const fingerprintOf = (w: ReturnType<typeof world>): string => {
  const row = w.tables.paige_pending_confirmations.find((r) => r.consumed_at == null);
  if (!row || typeof row.fingerprint !== "string") throw new Error("no live proposal to approve");
  return row.fingerprint;
};

export const deploymentRow = (w: ReturnType<typeof world>): Row | undefined => w.tables.growth_hosted_deployments[0];
