// An in-memory world for driving the REAL social publish door
// (supabase/functions/_shared/social-publish-command/door.ts). The door's own code makes every
// decision; only the two Supabase clients and the provider adapter are doubles. The approval
// store filters and claims like PostgREST would, so a dropped predicate fails a test rather than
// passing a fixture. This is NOT authenticated runtime proof against Supabase or the provider.
//
// The provider adapter double records every createPost call and answers from options — including
// the three outcome classes the real adapter can return (published / processing / unknown) and the
// thrown-error class (SocialProviderError).
import { handleSocialPublishCommand } from "../../supabase/functions/_shared/social-publish-command/door.ts";

export const USER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
export const OTHER_USER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
export const MINE = "11111111-1111-4111-8111-111111111111";
export const THEIRS = "22222222-2222-4222-8222-222222222222";
export const PIECE = "33333333-3333-4333-8333-333333333333";
export const FOREIGN_PIECE = "44444444-4444-4444-8444-444444444444";
export const CONNECTION = "55555555-5555-4555-8555-555555555555";

type Row = Record<string, unknown>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- filter args vary by operation
type Filter = any[];

export interface WorldOptions {
  user?: string | null;
  active?: string | null;
  admin?: boolean;
  manages?: boolean;
  lane?: string;
  laneError?: boolean;
  adapterConfigured?: boolean;
  /** The adapter's createPost answer, or a function of its input. */
  createPost?: (input: { providerProfileKey: string; platform: string; text: string; externalId: string }) =>
    | { kind: "published"; results: Array<{ platform: string; success: boolean; postId: string | null; postUrl: string | null; error: string | null }> }
    | { kind: "processing"; requestId: string }
    | { kind: "unknown"; requestId: string | null; reason: string };
  createPostThrows?: { code: string };
  tables?: Partial<Record<string, Row[]>>;
  /** Make the connection read answer a DIFFERENT status on the recheck (post-claim). */
  revokeAfterClaim?: boolean;
  /** Pending-reconcile answer. */
  pendingReconcile?: boolean;
}

export const connectedRow = (over: Row = {}): Row => ({
  id: CONNECTION, tenant_id: MINE, provider_key: "upload_post",
  provider_profile_key: "ps_aaaa000000000000000000000000000000000000",
  requested_platform: "instagram", status: "connected", label: "Northfield Coaching (main)",
  updated_at: "2026-10-20T10:00:00Z", ...over,
});

export const pieceRow = (over: Row = {}): Row => ({
  id: PIECE, tenant_id: MINE, title: "Spring workshop reminder", kind: "text", ...over,
});

export function world(o: WorldOptions = {}) {
  const tables: Record<string, Row[]> = {
    marketing_content: [
      pieceRow(),
      { id: FOREIGN_PIECE, tenant_id: THEIRS, title: "Their piece", kind: "text" },
    ],
    paige_social_connections: [connectedRow()],
    paige_pending_confirmations: [],
    content_publications: [],
    ...(o.tables as Record<string, Row[]>),
  };
  const seen = {
    rpc: [] as Array<{ fn: string; args?: Row; client: "caller" | "admin" }>,
    receipts: [] as Row[],
    reads: [] as Array<{ table: string; filters: Filter[] }>,
    createPost: [] as Array<{ providerProfileKey: string; platform: string; text: string; externalId: string }>,
  };
  let connectionReads = 0;

  const matches = (row: Row, filters: Filter[]) => filters.every(([op, col, value]) => {
    const v = row[col];
    switch (op) {
      case "eq": return v === value;
      case "neq": return v !== value;
      case "is": return value === null ? v == null : v === value;
      case "not": return v != null;
      case "gt": return v != null && String(v) > String(value);
      default: throw new Error(`unsupported filter ${op}`);
    }
  });

  const from = (table: string) => {
    const filters: Filter[] = [];
    let update: Row | null = null;
    let single = false;
    const run = () => {
      const rows = tables[table] ?? (tables[table] = []);
      seen.reads.push({ table, filters: [...filters] });
      const hit = rows.filter((r) => matches(r, filters));
      if (update) for (const r of hit) Object.assign(r, update);
      return { data: single ? hit[0] ?? null : hit, error: null };
    };
    const q: Record<string, unknown> = {
      select: () => q, order: () => q,
      eq: (c: string, v: unknown) => { filters.push(["eq", c, v]); return q; },
      neq: (c: string, v: unknown) => { filters.push(["neq", c, v]); return q; },
      is: (c: string, v: unknown) => { filters.push(["is", c, v]); return q; },
      not: (c: string, op: string, v: unknown) => { filters.push(["not", c, op, v]); return q; },
      gt: (c: string, v: unknown) => { filters.push(["gt", c, v]); return q; },
      update: (patch: Row) => { update = patch; return q; },
      maybeSingle: () => { single = true; return q; },
      then: (ok: (v: unknown) => unknown, bad: (e: unknown) => unknown) => Promise.resolve(run()).then(ok, bad),
    };
    return q;
  };

  const caller = {
    auth: { getUser: async () => (o.user === null ? { data: { user: null }, error: { message: "bad jwt" } } : { data: { user: { id: o.user ?? USER } }, error: null }) },
    rpc: async (fn: string, args?: Row) => {
      seen.rpc.push({ fn, args, client: "caller" });
      if (fn === "current_user_tenant_id") return { data: o.active === undefined ? MINE : o.active, error: null };
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
      if (fn === "content_publication_pending_reconcile") {
        return { data: o.pendingReconcile === true, error: null };
      }
      if (fn === "content_publication_record" || fn === "content_publication_bind") {
        return { data: { id: (args?.p_id as string) ?? "pub-1", tenant_id: args?.p_tenant_id, status: "ok" }, error: null };
      }
      return { data: null, error: { message: `unexpected admin rpc ${fn}` } };
    },
  };

  // The provider adapter double — records calls, answers from options.
  const adapter = {
    isConfigured: () => o.adapterConfigured !== false,
    createPost: async (input: { providerProfileKey: string; platform: string; text: string; externalId: string }) => {
      seen.createPost.push(input);
      if (o.createPostThrows) throw Object.assign(new Error("provider down"), { code: o.createPostThrows.code });
      if (o.createPost) return o.createPost(input);
      // Default: a successful single-platform result.
      return {
        kind: "published" as const,
        results: [{ platform: input.platform, success: true, postId: "up_123", postUrl: "https://instagram.com/p/abc123", error: null }],
      };
    },
  };

  const call = async (body: Row, method = "POST") => {
    const res = await handleSocialPublishCommand(new Request("https://edge.test/social-publish-command", {
      method, headers: { Authorization: "Bearer test" }, ...(method === "POST" ? { body: JSON.stringify(body) } : {}),
    }), { caller, admin, adapter });
    return { status: res.status, body: await res.json().catch(() => null) as Row };
  };

  // On the connection recheck (the second read of paige_social_connections with eq id), optionally
  // flip the status to simulate a post-claim revocation.
  const origFrom = from;
  const fromWrapped = (table: string) => {
    if (table === "paige_social_connections") {
      connectionReads += 1;
      if (o.revokeAfterClaim && connectionReads >= 3) {
        const row = tables.paige_social_connections[0];
        if (row) row.status = "needs_reauth";
      }
    }
    return origFrom(table);
  };
  admin.from = fromWrapped as typeof from;

  return { tables, seen, call };
}

/** The happy-path publish body. */
export const publishBody = (over: Row = {}): Row => ({ action: "publish", platform: "instagram", content_id: PIECE, ...over });
