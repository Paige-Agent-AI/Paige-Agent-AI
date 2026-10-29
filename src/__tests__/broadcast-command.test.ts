// broadcast-command — the REAL admission door for live broadcasting, driven through an
// in-memory world whose admin double enforces the RPCs' own rules (one live session per
// tenant, forward-only end). What these tests pin is the door's HONESTY: dormant means
// unavailable with ZERO rooms minted; open mints exactly one room + one row and hands the
// browser ONLY the provider-minted host pass; end is the row's truth with the kick as
// best-effort hygiene; usage meters exactly-once into the platform's existing ledger; and
// the platform credential never has a field to appear in.
import { describe, expect, it, vi } from "vitest";
import { MINE, THEIRS, SESSION_ID, MEETING_ID, PARTICIPANT_ID, USER, world } from "./broadcast-command.world";

vi.mock("../../supabase/functions/_shared/studio-caller.ts", () => ({
  resolveStudioCaller: vi.fn(async (caller: { rpc: (fn: string, args?: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }> }, requestedTenant: unknown) => {
    const { data: active } = await caller.rpc("current_user_tenant_id");
    if (typeof active !== "string" || !active) return { ok: false, status: 403, error: "Open one of your workspaces first.", reason: "no_workspace" };
    if (requestedTenant != null && requestedTenant !== "" && String(requestedTenant).toLowerCase() !== active) {
      return { ok: false, status: 403, error: "That isn't the workspace you're signed in to.", reason: "other_workspace" };
    }
    return { ok: true, tenantId: active, role: "owner" };
  }),
}));

const body = async (res: Response) => res.json() as Promise<Record<string, unknown>>;

describe("broadcast-command — verbs and identity", () => {
  it("OPTIONS is open; other verbs are refused without touching anything", async () => {
    const w = world();
    expect((await w.call({}, { method: "OPTIONS" } as never)).status).toBe(204);
    const res = await w.call({}, { method: "GET" });
    expect(res.status).toBe(405);
    expect(w.seen.rpc).toHaveLength(0);
  });

  it("an unauthenticated caller is refused before the provider or any row is touched", async () => {
    const w = world({ user: null });
    const res = await w.call({ action: "open" });
    expect(res.status).toBe(401);
    expect(w.seen.createMeeting).toHaveLength(0);
    expect(w.seen.rpc).toHaveLength(0);
  });
});

describe("broadcast-command — dormant means dormant (fail-closed)", () => {
  it("status honestly answers unavailable and open/probe mint NOTHING while unconfigured", async () => {
    const w = world({ adapterConfigured: false });
    const status = await body(await w.call({ action: "status" }));
    expect(status).toEqual({ ok: true, state: "unavailable" });
    expect((await w.call({ action: "open", title: "x" })).status).toBe(503);
    expect((await w.call({ action: "probe" })).status).toBe(503);
    expect(w.seen.createMeeting).toHaveLength(0);
    expect(w.seen.listMeetings).toBe(0);
    expect(w.sessions).toHaveLength(0);
  });
});

describe("broadcast-command — status is the panel's truth", () => {
  it("ready when configured with no live session; NO provider call on this path", async () => {
    const w = world();
    const status = await body(await w.call({ action: "status" }));
    expect(status).toEqual({ ok: true, state: "ready" });
    expect(w.seen.createMeeting).toHaveLength(0);
    expect(w.seen.listMeetings).toBe(0);
  });

  it("live carries ONLY the session's own facts, with the guest link on the /live route", async () => {
    const w = world({ seedLive: true });
    const status = await body(await w.call({ action: "status" }, { origin: "https://paigeagent.ai" }));
    expect(status.state).toBe("live");
    const session = status.session as Record<string, unknown>;
    expect(session.title).toBe("Seeded live");
    expect(session.guest_url).toBe(`https://paigeagent.ai/live/${SESSION_ID}`);
  });

  it("another workspace's live session is not mine — the door is tenant-scoped", async () => {
    const w = world({ seedLive: true, seedTenant: THEIRS });
    const status = await body(await w.call({ action: "status" }));
    expect(status).toEqual({ ok: true, state: "ready" });
  });
});

describe("broadcast-command — open: one room, one host pass, one row", () => {
  it("mints the room, admits the host, writes ONE row, and hands the browser only the host pass", async () => {
    const w = world();
    const res = await w.call({ action: "open", title: "  Spring open house  " }, { origin: "https://paigeagent.ai" });
    expect(res.status).toBe(200);
    const parsed = await body(res);
    expect(parsed.ok).toBe(true);
    expect(w.seen.createMeeting).toEqual(["Spring open house"]);
    expect(w.seen.addParticipant[0]).toMatchObject({ meetingId: MEETING_ID, customParticipantId: USER, presetName: "group_call" });
    const open = w.seen.rpc.find((r) => r.fn === "tenant_broadcast_session_open");
    expect(open?.args.p_title).toBe("Spring open house");
    const host = parsed.host as Record<string, unknown>;
    expect(host).toMatchObject({ meeting_id: MEETING_ID, participant_id: PARTICIPANT_ID });
    expect(String(host.token)).toBe("participant-jwt-not-the-platform-token");
    // The platform credential never has a field to appear in.
    expect(JSON.stringify(parsed)).not.toMatch(/Bearer|CLOUDFLARE_REALTIMEKIT_API_TOKEN|synthetic-edge-token/i);
  });

  it("bounds and defaults the title the way the surface promises", async () => {
    const w = world();
    const parsed = await body(await w.call({ action: "open", title: "   " }));
    expect(w.seen.createMeeting).toEqual(["Live from my business"]);
    expect((parsed.session as Record<string, unknown>).title).toBe("Live from my business");
  });

  it("refuses honestly when the workspace is already live — no second room minted", async () => {
    const w = world({ seedLive: true });
    const res = await w.call({ action: "open" });
    expect(res.status).toBe(409);
    expect((await body(res)).code).toBe("BROADCAST_ALREADY_LIVE");
    expect(w.seen.createMeeting).toHaveLength(0);
  });

  it("a refused room or host admission leaves NO row and reports the honest code", async () => {
    for (const [opt, code] of [["createMeeting", "BROADCAST_ROOM_REFUSED"], ["addParticipant", "BROADCAST_HOST_REFUSED"]] as const) {
      const w = world({ [opt]: "refused" });
      const res = await w.call({ action: "open" });
      expect(res.status).toBe(502);
      expect((await body(res)).code).toBe(code);
      expect(w.sessions).toHaveLength(0);
    }
  });

  it("anti-abuse: too many rooms in one hour is refused without touching the provider", async () => {
    const w = world({ seedRecentCount: 10 });
    const res = await w.call({ action: "open" });
    expect(res.status).toBe(429);
    expect(w.seen.createMeeting).toHaveLength(0);
  });
});

describe("broadcast-command — end: the row is the truth", () => {
  it("kicks the host, walks the row to ended, and meters exactly-once into the platform ledger", async () => {
    const w = world({ seedLive: true });
    const res = await w.call({ action: "end" });
    expect(res.status).toBe(200);
    const parsed = await body(res);
    expect(parsed.state).toBe("ended");
    expect(w.seen.kick[0]).toMatchObject({ meetingId: MEETING_ID, participantId: PARTICIPANT_ID });
    expect(w.seen.meterInserts).toHaveLength(1);
    const meter = w.seen.meterInserts[0];
    expect(meter).toMatchObject({ tenant_id: MINE, event_type: "media_usd", unit: "usd" });
    expect(meter.metadata).toMatchObject({ job_id: `broadcast:${SESSION_ID}`, host_kick_ok: true });
    // 30 minutes × 1 host × $0.002 = $0.06 at the documented list estimate.
    expect(Number(meter.quantity)).toBeCloseTo(0.06, 3);
  });

  it("a refused kick does NOT block the end — the outcome is recorded, never hidden", async () => {
    const w = world({ seedLive: true, kick: "refused" });
    const res = await w.call({ action: "end" });
    expect(res.status).toBe(200);
    expect(w.seen.meterInserts[0].metadata).toMatchObject({ host_kick_ok: false });
  });

  it("a failed meter insert is NAMED, never a silent ledger gap", async () => {
    const w = world({ seedLive: true, meterInsertFails: true });
    const parsed = await body(await w.call({ action: "end" }));
    expect(parsed.ok).toBe(true);
    expect(parsed.note).toBe("meter_pending");
  });

  it("ending with nothing live is the honest 404", async () => {
    const w = world();
    const res = await w.call({ action: "end" });
    expect(res.status).toBe(404);
    expect((await body(res)).code).toBe("BROADCAST_NOT_LIVE");
  });
});

describe("broadcast-command — join: a member's seat in their own workspace's room", () => {
  it("seats a signed-in member and hands them their OWN pass — never the platform token", async () => {
    const w = world({ seedLive: true });
    const res = await w.call({ action: "join" });
    expect(res.status).toBe(200);
    const parsed = await body(res);
    const join = parsed.join as Record<string, unknown>;
    expect(join).toMatchObject({ meeting_id: MEETING_ID, participant_id: PARTICIPANT_ID });
    expect(String(join.token)).toBe("participant-jwt-not-the-platform-token");
    expect(w.seen.addParticipant[0]).toMatchObject({ meetingId: MEETING_ID, customParticipantId: USER, name: "Guest" });
    expect((parsed.session as Record<string, unknown>).id).toBe(SESSION_ID);
    expect(JSON.stringify(parsed)).not.toMatch(/Bearer|CLOUDFLARE_REALTIMEKIT_API_TOKEN|synthetic-edge-token/i);
  });

  it("another workspace's live room is not joinable — the seat is tenant-scoped", async () => {
    const w = world({ seedLive: true, seedTenant: THEIRS });
    const res = await w.call({ action: "join" });
    expect(res.status).toBe(404);
    expect(w.seen.addParticipant).toHaveLength(0);
  });

  it("refuses honestly at the interactive cap without minting a pass", async () => {
    const w = world({ seedLive: true, seedParticipants: 8 });
    const res = await w.call({ action: "join" });
    expect(res.status).toBe(409);
    expect((await body(res)).code).toBe("BROADCAST_ROOM_FULL");
    expect(w.seen.addParticipant).toHaveLength(0);
  });

  it("a refused admission reports the honest code — the seat is a bound, not a bill", async () => {
    const w = world({ seedLive: true, addParticipant: "refused" });
    const res = await w.call({ action: "join" });
    expect(res.status).toBe(502);
    expect((await body(res)).code).toBe("BROADCAST_JOIN_REFUSED");
  });

  it("meters EVERY seated participant at end — one join then end = two people's minutes", async () => {
    const w = world({ seedLive: true });
    await w.call({ action: "join" });
    await w.call({ action: "end" });
    const meter = w.seen.meterInserts.at(-1);
    // 30 minutes × 2 participants × $0.002 = $0.12 at the documented list estimate.
    expect(Number(meter?.quantity)).toBeCloseTo(0.12, 3);
    expect(meter?.metadata).toMatchObject({ participants: 2, participant_minutes: 60 });
  });
});

describe("broadcast-command — probe: the read-only credential proof", () => {
  it("answers reachable on a 200 without creating anything", async () => {
    const w = world();
    const parsed = await body(await w.call({ action: "probe" }));
    expect(parsed).toEqual({ ok: true, probe: "reachable", meetings: 0 });
    expect(w.seen.listMeetings).toBe(1);
    expect(w.sessions).toHaveLength(0);
  });
});
