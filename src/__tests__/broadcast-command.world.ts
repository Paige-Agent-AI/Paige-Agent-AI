// An in-memory world for driving the REAL broadcast-command door
// (supabase/functions/_shared/broadcast-command/command.ts). The door's own code decides
// everything; only the two Supabase clients and the RealtimeKit adapter are doubles. The
// admin double implements the three RPCs' OWN rules over an in-memory sessions table —
// one live per tenant (the open RPC returns null rather than overwrite), forward-only
// end — so a dropped predicate fails a test rather than passing a fixture. resolveStudioCaller
// is doubled exactly as the other door tests double it (Deno-runtime module proven in
// production by the growth-publish door).
import { handleBroadcastCommand } from "../../supabase/functions/_shared/broadcast-command/command.ts";
import type { RealtimeKitAdapter } from "../../supabase/functions/_shared/realtimekit-provider/realtimekit.ts";

export const USER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
export const MINE = "11111111-1111-4111-8111-111111111111";
export const THEIRS = "22222222-2222-4222-8222-222222222222";
export const SESSION_ID = "eeee0000-0000-4000-8000-00000000b001";
export const MEETING_ID = "11111111-2222-4333-8444-555555555555";
export const PARTICIPANT_ID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const FIXED_START = new Date(Date.now() - 30 * 60_000).toISOString(); // 30 minutes ago

type Row = Record<string, unknown>;

export interface WorldOptions {
  user?: string | null;
  active?: string | null;
  adapterConfigured?: boolean;
  createMeeting?: "ok" | "refused" | "transport";
  addParticipant?: "ok" | "refused";
  kick?: "ok" | "refused";
  /** A pre-seeded LIVE session row (owned by `seedTenant`). */
  seedLive?: boolean;
  seedTenant?: string;
  /** The seeded live session's participant count (the interactive cap is 8). */
  seedParticipants?: number;
  /** Pre-seeded recent rows for the anti-abuse count (owned by USER). */
  seedRecentCount?: number;
  meterInsertFails?: boolean;
}

export function world(o: WorldOptions = {}) {
  const seen = {
    createMeeting: [] as string[],
    addParticipant: [] as Row[],
    kick: [] as Row[],
    listMeetings: 0,
    rpc: [] as Array<{ fn: string; args: Row }>,
    meterInserts: [] as Row[],
    reads: [] as Array<{ table: string; filters: string[][] }>,
  };
  const sessions: Row[] = [];
  if (o.seedLive) {
    sessions.push({
      id: SESSION_ID, tenant_id: o.seedTenant ?? MINE, title: "Seeded live", status: "live",
      meeting_id: MEETING_ID, host_participant_id: PARTICIPANT_ID, created_by: USER,
      participant_count: o.seedParticipants ?? 1, created_at: FIXED_START, ended_at: null,
    });
  }
  for (let i = 0; i < (o.seedRecentCount ?? 0); i += 1) {
    sessions.push({
      id: `eeee0000-0000-4000-8000-${String(1_000 + i).padStart(12, "0")}`,
      tenant_id: MINE, title: `recent ${i}`, status: "ended", meeting_id: MEETING_ID,
      host_participant_id: null, created_by: USER, created_at: FIXED_START, ended_at: FIXED_START,
    });
  }

  const caller = {
    auth: {
      getUser: async () => o.user === null
        ? { data: { user: null }, error: { message: "no session" } }
        : { data: { user: { id: o.user ?? USER } }, error: null },
    },
    rpc: async (fn: string) => {
      if (fn === "current_user_tenant_id") return { data: o.active === null ? null : (o.active ?? MINE), error: null };
      return { data: null, error: { message: `unexpected rpc ${fn}` } };
    },
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- a PostgREST chain returns itself from every method; a loose record is the honest shape for a double
  const admin: any = {
    rpc: async (fn: string, args: Row = {}) => {
      seen.rpc.push({ fn, args });
      if (fn === "tenant_broadcast_session_active") {
        const row = sessions.find((s) => s.tenant_id === args.p_tenant_id && s.status === "live") ?? null;
        return { data: row ? { ...row } : null, error: null };
      }
      if (fn === "tenant_broadcast_session_open") {
        if (sessions.some((s) => s.tenant_id === args.p_tenant_id && s.status === "live")) {
          return { data: null, error: null }; // the one-live rule the database enforces
        }
        const row: Row = {
          id: SESSION_ID, tenant_id: args.p_tenant_id, title: args.p_title, status: "live",
          meeting_id: args.p_meeting_id, host_participant_id: args.p_host_participant_id,
          participant_count: 1, created_by: args.p_created_by, created_at: new Date().toISOString(), ended_at: null,
        };
        sessions.push(row);
        return { data: { ...row }, error: null };
      }
      if (fn === "tenant_broadcast_session_join") {
        const row = sessions.find((s) => s.tenant_id === args.p_tenant_id && s.status === "live");
        if (!row) return { data: null, error: null };
        if (Number(row.participant_count) >= 8) {
          return { data: null, error: { message: "BROADCAST_ROOM_FULL: the room is at its interactive cap" } };
        }
        row.participant_count = Number(row.participant_count) + 1;
        return { data: { ...row }, error: null };
      }
      if (fn === "tenant_broadcast_session_end") {
        const row = sessions.find((s) => s.id === args.p_id && s.tenant_id === args.p_tenant_id && s.status === "live");
        if (!row) return { data: null, error: null };
        row.status = "ended"; row.ended_at = new Date().toISOString();
        return { data: { ...row }, error: null };
      }
      return { data: null, error: { message: `unexpected rpc ${fn}` } };
    },
    from(table: string) {
      const filters: string[][] = [];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- see above
      const chain: any = {};
      const run = () => {
        seen.reads.push({ table, filters: [...filters] });
        let rows = table === "tenant_broadcast_sessions" ? [...sessions] : [];
        for (const [op, col, value] of filters) {
          if (op === "eq") rows = rows.filter((r) => r[col] === value);
          else if (op === "gte") rows = rows.filter((r) => String(r[col]) >= String(value));
        }
        return rows;
      };
      chain.select = (_sel: unknown, opts?: { count?: string; head?: boolean }) => {
        if (opts?.head && opts.count === "exact") {
          // Thenable like Postgrest: await resolves the count; .eq continues the chain.
          const counting = {
            eq: (c: string, v: unknown) => { filters.push(["eq", c, String(v)]); return counting; },
            gte: (c: string, v: unknown) => { filters.push(["gte", c, String(v)]); return counting; },
            then: (ok: (v: unknown) => unknown) => Promise.resolve({ data: null, error: null, count: run().length }).then(ok),
          };
          return counting;
        }
        return chain;
      };
      chain.eq = (col: string, value: unknown) => { filters.push(["eq", col, value]); return chain; };
      chain.gte = (col: string, value: unknown) => { filters.push(["gte", col, value]); return chain; };
      chain.maybeSingle = () => Promise.resolve({ data: null, error: null });
      chain.insert = (values: Row) => {
        if (table === "platform_usage_events") {
          if (o.meterInsertFails) return Promise.resolve({ error: { message: "meter refused" } });
          (Array.isArray(values) ? values : [values]).forEach((v) => seen.meterInserts.push(v));
          return Promise.resolve({ error: null });
        }
        return Promise.resolve({ error: { message: `unexpected insert ${table}` } });
      };
      return chain;
    },
  };

  const adapter: RealtimeKitAdapter = {
    isConfigured: () => o.adapterConfigured !== false,
    async listMeetings() { seen.listMeetings += 1; return { ok: true, meetings: [] }; },
    async listPresets() { return { ok: true, presets: [] }; },
    async getMeeting(meetingId: string) { return { ok: true as const, meeting: { id: meetingId, title: "t", status: "ACTIVE", createdAt: FIXED_START } }; },
    async createMeeting(input: { title: string }) {
      seen.createMeeting.push(input.title);
      if (o.createMeeting === "refused") return { ok: false, code: "cloudflare_refused" as const, httpStatus: 403 };
      if (o.createMeeting === "transport") return { ok: false, code: "transport_failed" as const };
      return { ok: true as const, meeting: { id: MEETING_ID, title: input.title, status: "ACTIVE", createdAt: new Date().toISOString() } };
    },
    async addParticipant(input: { meetingId: string; customParticipantId: string; presetName: string; name?: string }) {
      seen.addParticipant.push({ ...input });
      if (o.addParticipant === "refused") return { ok: false, code: "cloudflare_refused" as const, httpStatus: 403 };
      return { ok: true as const, participant: { id: PARTICIPANT_ID, token: "participant-jwt-not-the-platform-token" } };
    },
    async kickParticipant(input: { meetingId: string; participantId: string }) {
      seen.kick.push({ ...input });
      if (o.kick === "refused") return { ok: false, code: "participant_missing" as const };
      return { ok: true as const };
    },
  };

  const call = (payload: Row, init?: { method?: string; origin?: string }) => {
    const method = init?.method ?? "POST";
    const verbWithoutBody = method === "GET" || method === "HEAD" || method === "OPTIONS";
    return handleBroadcastCommand(new Request("https://edge.example/functions/v1/broadcast-command", {
      method,
      headers: { "Content-Type": "application/json", ...(init?.origin ? { Origin: init.origin } : {}) },
      ...(verbWithoutBody ? {} : { body: JSON.stringify(payload) }),
    }), { caller, admin, adapter });
  };

  return { call, seen, sessions };
}
