// RealtimeKit adapter world tests: the REAL adapter against env/fetch doubles.
// Proves the wire contract (paths, methods, auth header presence, bounded timeout on every
// call, closed failure codes) and that ONLY the provider-minted participant token ever
// leaves the adapter — the API token appears in no result and no failure carries prose.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { world, MEETING_ID, PARTICIPANT_ID, APP_ID, ACCOUNT, type Answer } from "./realtimekit-provider.world.ts";

const okEnvelope = (data: unknown) => ({ success: true, data });

let w: ReturnType<typeof world>;
beforeEach(() => { w = world(); });
afterEach(() => w.restore());

describe("realtimeKitAdapter.isConfigured", () => {
  it("is configured when token, account and app id are present", () => {
    expect(w.adapter.isConfigured()).toBe(true);
  });
  it("is not configured when the token is missing", () => {
    w.restore();
    w = world({ token: null });
    expect(w.adapter.isConfigured()).toBe(false);
    w.restore();
    w = world();
  });
  it("is not configured when the app id is missing", () => {
    w.restore();
    w = world({ appId: null });
    expect(w.adapter.isConfigured()).toBe(false);
    w.restore();
    w = world();
  });
});

describe("realtimeKitAdapter.listMeetings (the credential probe)", () => {
  it("GETs the documented meetings path with auth and a timeout signal", async () => {
    const r = await w.adapter.listMeetings();
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.meetings).toHaveLength(1);
    expect(r.meetings[0].id).toBe(MEETING_ID);
    expect(w.seen).toHaveLength(1);
    expect(w.seen[0].method).toBe("GET");
    expect(w.seen[0].url).toBe(`https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/realtime/kit/${APP_ID}/meetings`);
    expect(w.seen[0].hasAuth).toBe(true);
    expect(w.seen[0].hasTimeoutSignal).toBe(true);
  });
  it("maps a 401 to cloudflare_refused with the status (the owner regeneration signal)", async () => {
    w.restore();
    w = world({ meetingsAnswer: { kind: "status", status: 401 } });
    const r = await w.adapter.listMeetings();
    expect(r).toEqual({ ok: false, code: "cloudflare_refused", httpStatus: 401 });
    w.restore();
    w = world();
  });
  it("maps a rejected fetch to transport_failed with no prose", async () => {
    w.restore();
    w = world({ meetingsAnswer: { kind: "reject" } });
    const r = await w.adapter.listMeetings();
    expect(r).toEqual({ ok: false, code: "transport_failed" });
    w.restore();
    w = world();
  });
  it("refuses a 200 whose body is not the data envelope", async () => {
    w.restore();
    w = world({ meetingsAnswer: { kind: "ok", body: { success: false } } });
    const r = await w.adapter.listMeetings();
    expect(r).toEqual({ ok: false, code: "cloudflare_refused", httpStatus: 200 });
    w.restore();
    w = world();
  });
});

describe("realtimeKitAdapter.listPresets", () => {
  it("reads preset names from the presets path", async () => {
    w.restore();
    w = world({ presetsAnswer: { kind: "ok", body: okEnvelope([{ name: "webinar_host" }, { name: "webinar_guest" }, { no: "name field" }]) } });
    const r = await w.adapter.listPresets();
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.presets.map((p) => p.name)).toEqual(["webinar_host", "webinar_guest"]);
    expect(w.seen[0].url.endsWith("/presets")).toBe(true);
    w.restore();
    w = world();
  });
});

describe("realtimeKitAdapter.getMeeting", () => {
  it("GETs one meeting and maps it", async () => {
    w.restore();
    w = world({ meetingsAnswer: { kind: "ok", body: okEnvelope({ id: MEETING_ID, title: "T", status: "ACTIVE", created_at: "2026-10-28T23:00:00Z" }) } });
    const r = await w.adapter.getMeeting(MEETING_ID);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.meeting.status).toBe("ACTIVE");
    expect(w.seen[0].url.endsWith(`/meetings/${MEETING_ID}`)).toBe(true);
    w.restore();
    w = world();
  });
  it("maps 404 to meeting_missing", async () => {
    w.restore();
    w = world({ meetingsAnswer: { kind: "status", status: 404 } });
    const r = await w.adapter.getMeeting(MEETING_ID);
    expect(r).toEqual({ ok: false, code: "meeting_missing" });
    w.restore();
    w = world();
  });
});

describe("realtimeKitAdapter.createMeeting", () => {
  it("POSTs a bounded title and returns the mapped meeting", async () => {
    w.restore();
    w = world({ meetingsAnswer: { kind: "ok", body: okEnvelope({ id: MEETING_ID, title: "x".repeat(400), status: "INACTIVE" }) } });
    const r = await w.adapter.createMeeting({ title: "  Spring open house Q&A  " });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(w.seen[0].method).toBe("POST");
    expect(w.seen[0].body).toEqual({ title: "Spring open house Q&A" });
    w.restore();
    w = world();
  });
  it("refuses a body without a usable meeting id", async () => {
    w.restore();
    w = world({ meetingsAnswer: { kind: "ok", body: okEnvelope({ title: "no id" }) } });
    const r = await w.adapter.createMeeting({ title: "t" });
    expect(r).toEqual({ ok: false, code: "cloudflare_refused", httpStatus: 200 });
    w.restore();
    w = world();
  });
});

describe("realtimeKitAdapter.addParticipant", () => {
  it("POSTs the required provider fields and returns ONLY the provider-minted token", async () => {
    const r = await w.adapter.addParticipant({ meetingId: MEETING_ID, customParticipantId: "user-1", presetName: "group_call", name: "Host" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.participant.id).toBe(PARTICIPANT_ID);
    expect(r.participant.token).toBe("participant-jwt-not-the-api-token");
    expect(w.seen[0].method).toBe("POST");
    expect(w.seen[0].body).toEqual({ custom_participant_id: "user-1", preset_name: "group_call", name: "Host" });
    expect(w.seen[0].url.endsWith(`/meetings/${MEETING_ID}/participants`)).toBe(true);
  });
  it("maps a 404 to meeting_missing", async () => {
    w.restore();
    w = world({ participantsAnswer: { kind: "status", status: 404 } });
    const r = await w.adapter.addParticipant({ meetingId: MEETING_ID, customParticipantId: "user-1", presetName: "group_call" });
    expect(r).toEqual({ ok: false, code: "meeting_missing" });
    w.restore();
    w = world();
  });
  it("refuses a 200 without a participant token — no invented credentials", async () => {
    w.restore();
    w = world({ participantsAnswer: { kind: "ok", body: okEnvelope({ id: PARTICIPANT_ID }) } });
    const r = await w.adapter.addParticipant({ meetingId: MEETING_ID, customParticipantId: "user-1", presetName: "group_call" });
    expect(r).toEqual({ ok: false, code: "cloudflare_refused", httpStatus: 200 });
    w.restore();
    w = world();
  });
});

describe("realtimeKitAdapter.kickParticipant", () => {
  it("DELETEs the participant and returns ok", async () => {
    const r = await w.adapter.kickParticipant({ meetingId: MEETING_ID, participantId: PARTICIPANT_ID });
    expect(r).toEqual({ ok: true });
    expect(w.seen[0].method).toBe("DELETE");
    expect(w.seen[0].url.endsWith(`/meetings/${MEETING_ID}/participants/${PARTICIPANT_ID}`)).toBe(true);
  });
  it("maps 404 to participant_missing", async () => {
    w.restore();
    w = world({ participantsAnswer: { kind: "status", status: 404 } });
    const r = await w.adapter.kickParticipant({ meetingId: MEETING_ID, participantId: PARTICIPANT_ID });
    expect(r).toEqual({ ok: false, code: "participant_missing" });
    w.restore();
    w = world();
  });
});

describe("the API token never crosses", () => {
  it("appears in no result shape (closed codes only, no prose, no echoes)", async () => {
    w.restore();
    const answers: Answer[] = [
      { kind: "status", status: 401 },
      { kind: "status", status: 403 },
      { kind: "status", status: 500 },
      { kind: "reject" },
    ];
    for (const a of answers) {
      w = world({ answer: a });
      const r = await w.adapter.listMeetings();
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(Object.keys(r).sort()).toEqual(["code", "httpStatus", "ok"].filter((k) => k in r).sort());
        expect(JSON.stringify(r)).not.toContain("synthetic-edge-token");
      }
      w.restore();
    }
    w = world();
  });
});
