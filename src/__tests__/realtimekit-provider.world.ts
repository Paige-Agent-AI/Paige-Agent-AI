// An in-memory world for driving the REAL RealtimeKit adapter
// (supabase/functions/_shared/realtimekit-provider/realtimekit.ts). The adapter's own code
// makes every decision; only the environment (Deno.env) and fetch are doubles. The fetch
// double records every call and answers from options — including every failure class the
// real provider can produce. This is NOT runtime proof against Cloudflare; the live probe
// (read-only listMeetings) is the credential proof, run post-deploy.
import { realtimeKitAdapter } from "../../supabase/functions/_shared/realtimekit-provider/realtimekit.ts";

export const ACCOUNT = "ba54ec3b1c0b5b0cb4a928d384aeda12";
export const APP_ID = "b96eaa3d-0450-414a-9155-0dffb4654433";
export const MEETING_ID = "11111111-2222-4333-8444-555555555555";
export const PARTICIPANT_ID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";

type Answer =
  | { kind: "ok"; body: unknown }
  | { kind: "status"; status: number }
  | { kind: "reject" };

export interface WorldOptions {
  token?: string | null;
  account?: string | null;
  appId?: string | null;
  /** Default answer for any endpoint; per-endpoint overrides below. */
  answer?: Answer;
  meetingsAnswer?: Answer;
  presetsAnswer?: Answer;
  participantsAnswer?: Answer;
}

export interface RecordedCall {
  url: string;
  method: string;
  hasAuth: boolean;
  hasTimeoutSignal: boolean;
  body: Record<string, unknown> | null;
}

const okEnvelope = (data: unknown) => ({ success: true, data });

export function world(o: WorldOptions = {}) {
  const seen: RecordedCall[] = [];
  const answerFor = (url: string): Answer => {
    if (url.includes("/presets")) return o.presetsAnswer ?? o.answer ?? { kind: "ok", body: okEnvelope([{ name: "group_call" }]) };
    if (url.includes("/participants")) return o.participantsAnswer ?? o.answer ?? { kind: "ok", body: okEnvelope({ id: PARTICIPANT_ID, token: "participant-jwt-not-the-api-token" }) };
    if (url.includes("/meetings")) return o.meetingsAnswer ?? o.answer ?? { kind: "ok", body: okEnvelope([{ id: MEETING_ID, title: "PAIGE live session", status: "ACTIVE", created_at: "2026-10-28T23:00:00Z" }]) };
    return o.answer ?? { kind: "ok", body: okEnvelope([]) };
  };

  const envVals: Record<string, string | undefined> = {
    CLOUDFLARE_REALTIMEKIT_API_TOKEN: o.token === undefined ? "synthetic-edge-token" : (o.token ?? undefined),
    CLOUDFLARE_ACCOUNT_ID: o.account === undefined ? ACCOUNT : (o.account ?? undefined),
    CLOUDFLARE_REALTIMEKIT_APP_ID: o.appId === undefined ? APP_ID : (o.appId ?? undefined),
  };

  const denoDouble = { env: { get: (key: string) => envVals[key] } };
  const realDeno = (globalThis as { Deno?: unknown }).Deno;
  const realFetch = globalThis.fetch;
  (globalThis as { Deno?: unknown }).Deno = denoDouble;
  globalThis.fetch = (async (input: unknown, init?: { method?: string; headers?: Record<string, string>; body?: string; signal?: unknown }) => {
    const url = String((input as { url?: string }).url ?? input);
    seen.push({
      url,
      method: init?.method ?? "GET",
      hasAuth: Boolean(init?.headers && ("Authorization" in init.headers)),
      hasTimeoutSignal: init?.signal instanceof AbortSignal,
      body: init?.body ? JSON.parse(init.body) as Record<string, unknown> : null,
    });
    const a = answerFor(url);
    if (a.kind === "reject") return Promise.reject(new Error("network down"));
    if (a.kind === "status") return Promise.resolve(new Response(null, { status: a.status }));
    return Promise.resolve(new Response(JSON.stringify(a.body), { status: 200, headers: { "Content-Type": "application/json" } }));
  }) as typeof fetch;

  return {
    adapter: realtimeKitAdapter,
    seen,
    restore() {
      (globalThis as { Deno?: unknown }).Deno = realDeno;
      globalThis.fetch = realFetch;
    },
  };
}
