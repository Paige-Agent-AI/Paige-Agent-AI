// The Cloudflare RealtimeKit adapter — PAIGE's ONLY server-side arm for the shared account's
// live A/V layer (EXP07 broadcast; owner enablement 2026-10-28: one app `paige-production` on
// the SAME shared PAIGE Cloudflare account Stream uses, never per-tenant tokens, the token
// exists ONLY in the edge environment).
//
// Arms are deliberately narrow and split by trust:
//   - READ/probe arms (listMeetings, listPresets, getMeeting): the credential probe the door
//     runs first — a 200 here is the proof the stored token carries RealtimeKit permission;
//     a 401/403 is the exact regeneration signal back to the owner.
//   - SESSION arms (createMeeting, addParticipant, kickParticipant): the broadcast door's own
//     authority surface. Participants NEVER see the API token — addParticipant returns the
//     provider-minted per-participant authToken and that is all that crosses to a client.
//
// The API token never crosses this line in a response or log: failures map to closed codes
// (only the HTTP status crosses), mirroring stream-provider's adapter shape.
//
// Endpoint base (Cloudflare API docs, RealtimeKit meetings subresource):
//   /accounts/{account_id}/realtime/kit/{app_id}/meetings — the docs list this literal form;
//   if the live probe 404s on a known-good app, the apps-scoped variant
//   (/realtime/kit/apps/{app_id}/meetings) is the one-line fallback constant to flip.

export interface RealtimeKitMeeting {
  id: string;
  title: string | null;
  status: string | null;
  createdAt: string | null;
}

export interface RealtimeKitPreset {
  name: string;
}

export interface RealtimeKitParticipant {
  id: string;
  /** Per-participant authToken minted by the provider — the ONLY credential a client ever sees. */
  token: string;
}

type Refusal = { ok: false; code: "adapter_not_configured" | "cloudflare_refused" | "transport_failed" | "meeting_missing" | "participant_missing"; httpStatus?: number };

export interface RealtimeKitAdapter {
  isConfigured(): boolean;
  /** Credential probe + session list. Read-only. */
  listMeetings(): Promise<{ ok: true; meetings: RealtimeKitMeeting[] } | Refusal>;
  /** Preset names the app actually offers (createParticipant requires a live preset_name). */
  listPresets(): Promise<{ ok: true; presets: RealtimeKitPreset[] } | Refusal>;
  getMeeting(meetingId: string): Promise<{ ok: true; meeting: RealtimeKitMeeting } | Refusal>;
  createMeeting(input: { title: string }): Promise<{ ok: true; meeting: RealtimeKitMeeting } | Refusal>;
  addParticipant(input: { meetingId: string; customParticipantId: string; presetName: string; name?: string }): Promise<{ ok: true; participant: RealtimeKitParticipant } | Refusal>;
  kickParticipant(input: { meetingId: string; participantId: string }): Promise<{ ok: true } | Refusal>;
}

const API_ROOT = "https://api.cloudflare.com/client/v4/accounts";
/** Every provider call is bounded (the same independent-review P3 the Stream adapter took):
 *  a hung Cloudflare connection must never pin the edge worker. Fixed host, no SSRF surface. */
const RTK_TIMEOUT_MS = 10_000;

/** Bounded meeting title: the door's own label for the session, never free customer prose. */
function boundedTitle(raw: string): string {
  const t = typeof raw === "string" ? raw.trim().slice(0, 120) : "";
  return t || "PAIGE live session";
}

function mapMeeting(m: Record<string, unknown>): RealtimeKitMeeting {
  const str = (v: unknown) => typeof v === "string" && v.trim() ? v.trim() : null;
  return {
    id: str(m.id) ?? "",
    title: str(m.title),
    status: str(m.status),
    createdAt: str(m.created_at),
  };
}

/** The RealtimeKit envelope is { success, data } (Stream used { result }); absent or
 *  non-object data, or an explicit success:false, is a refusal — never invented fields. */
function dataOf(body: Record<string, unknown>): Record<string, unknown> | null {
  if (body.success === false) return null;
  const d = body.data;
  if (d && typeof d === "object" && !Array.isArray(d)) return d as Record<string, unknown>;
  return null;
}

function dataListOf(body: Record<string, unknown>): Record<string, unknown>[] | null {
  if (body.success === false) return null;
  const d = body.data;
  if (Array.isArray(d)) return d.filter((x): x is Record<string, unknown> => !!x && typeof x === "object" && !Array.isArray(x));
  return null;
}

// Deno's env is reached through globalThis (stream-provider's pattern) so the module
// type-checks and unit tests load it outside the Deno runtime. Read LAZILY at call time —
// a world double installed before a call is seen; the edge runtime sees the real env.
const env = (key: string) => (globalThis as { Deno?: { env?: { get(key: string): string | undefined } } }).Deno?.env?.get(key);

interface Creds { token: string; account: string; appId: string }
function creds(): Creds | null {
  const token = env("CLOUDFLARE_REALTIMEKIT_API_TOKEN");
  const account = env("CLOUDFLARE_ACCOUNT_ID");
  const appId = env("CLOUDFLARE_REALTIMEKIT_APP_ID");
  return token && account && appId ? { token, account, appId } : null;
}

async function call(c: Creds, path: string, init: { method: "GET" | "POST" | "DELETE"; body?: string }): Promise<{ ok: true; status: number; body: Record<string, unknown> } | { ok: false; code: "cloudflare_refused" | "transport_failed"; httpStatus?: number }> {
  try {
    const res = await fetch(`${API_ROOT}/${c.account}/realtime/kit/${c.appId}${path}`, {
      headers: { Authorization: `Bearer ${c.token}`, ...(init.body ? { "Content-Type": "application/json" } : {}) },
      method: init.method,
      body: init.body,
      signal: AbortSignal.timeout(RTK_TIMEOUT_MS),
    });
    // Only the HTTP status crosses on failure — never provider prose, never the credential.
    if (!res.ok) return { ok: false, code: "cloudflare_refused", httpStatus: res.status };
    const body = await res.json() as Record<string, unknown>;
    return { ok: true, status: res.status, body };
  } catch {
    return { ok: false, code: "transport_failed" };
  }
}

function refusal(status: number | undefined, missing: "meeting_missing" | "participant_missing"): Refusal {
  return status === 404 ? { ok: false, code: missing } : { ok: false, code: "cloudflare_refused", httpStatus: status };
}

/** The app project runs with `strict: false`, where the `ok` literal does NOT narrow the
 *  call union — this cast-through is the house pattern (explicit property casts, never
 *  a discriminated-union `as` on the whole value). */
function failureOf(r: object): { code: "cloudflare_refused" | "transport_failed"; httpStatus?: number } {
  const f = r as { code?: unknown; httpStatus?: unknown };
  return {
    code: f.code === "transport_failed" ? "transport_failed" : "cloudflare_refused",
    httpStatus: typeof f.httpStatus === "number" ? f.httpStatus : undefined,
  };
}

export const realtimeKitAdapter: RealtimeKitAdapter = {
  isConfigured() {
    return creds() !== null;
  },
  async listMeetings() {
    const c = creds();
    if (!c) return { ok: false as const, code: "adapter_not_configured" as const };
    const r = await call(c, "/meetings", { method: "GET" });
    if (!r.ok) { const f = failureOf(r); return { ok: false as const, code: f.code, httpStatus: f.httpStatus }; }
    const list = dataListOf(r.body);
    if (!list) return { ok: false as const, code: "cloudflare_refused" as const, httpStatus: r.status };
    return { ok: true as const, meetings: list.slice(0, 100).map(mapMeeting) };
  },
  async listPresets() {
    const c = creds();
    if (!c) return { ok: false as const, code: "adapter_not_configured" as const };
    const r = await call(c, "/presets", { method: "GET" });
    if (!r.ok) { const f = failureOf(r); return { ok: false as const, code: f.code, httpStatus: f.httpStatus }; }
    const list = dataListOf(r.body);
    if (!list) return { ok: false as const, code: "cloudflare_refused" as const, httpStatus: r.status };
    const presets = list
      .map((p) => typeof p.name === "string" ? p.name.trim() : "")
      .filter((name): name is string => Boolean(name))
      .map((name) => ({ name }));
    return { ok: true as const, presets };
  },
  async getMeeting(meetingId: string) {
    const c = creds();
    if (!c) return { ok: false as const, code: "adapter_not_configured" as const };
    const r = await call(c, `/meetings/${encodeURIComponent(meetingId)}`, { method: "GET" });
    if (!r.ok) return refusal(failureOf(r).httpStatus, "meeting_missing");
    const d = dataOf(r.body);
    if (!d) return { ok: false as const, code: "cloudflare_refused" as const, httpStatus: r.status };
    return { ok: true as const, meeting: mapMeeting(d) };
  },
  async createMeeting(input: { title: string }) {
    const c = creds();
    if (!c) return { ok: false as const, code: "adapter_not_configured" as const };
    const r = await call(c, "/meetings", { method: "POST", body: JSON.stringify({ title: boundedTitle(input.title) }) });
    if (!r.ok) { const f = failureOf(r); return { ok: false as const, code: f.code, httpStatus: f.httpStatus }; }
    const d = dataOf(r.body);
    if (!d || typeof d.id !== "string" || !d.id.trim()) return { ok: false as const, code: "cloudflare_refused" as const, httpStatus: r.status };
    return { ok: true as const, meeting: mapMeeting(d) };
  },
  async addParticipant(input: { meetingId: string; customParticipantId: string; presetName: string; name?: string }) {
    const c = creds();
    if (!c) return { ok: false as const, code: "adapter_not_configured" as const };
    const body: Record<string, string> = {
      custom_participant_id: input.customParticipantId,
      preset_name: input.presetName,
    };
    if (input.name) body.name = input.name;
    const r = await call(c, `/meetings/${encodeURIComponent(input.meetingId)}/participants`, { method: "POST", body: JSON.stringify(body) });
    if (!r.ok) return refusal(failureOf(r).httpStatus, "meeting_missing");
    const d = dataOf(r.body);
    const token = typeof d?.token === "string" ? d.token : "";
    const id = typeof d?.id === "string" ? d.id : "";
    if (!token || !id) return { ok: false as const, code: "cloudflare_refused" as const, httpStatus: r.status };
    return { ok: true as const, participant: { id, token } };
  },
  async kickParticipant(input: { meetingId: string; participantId: string }) {
    const c = creds();
    if (!c) return { ok: false as const, code: "adapter_not_configured" as const };
    const r = await call(c, `/meetings/${encodeURIComponent(input.meetingId)}/participants/${encodeURIComponent(input.participantId)}`, { method: "DELETE" });
    if (!r.ok) return refusal(failureOf(r).httpStatus, "participant_missing");
    return { ok: true as const };
  },
};
