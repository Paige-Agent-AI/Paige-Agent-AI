// INT-298 MBC 7a — the public visit rules (server) and the browser's visit module.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { notRecordedReason, parseVisitRequest, referrerHost, visitTokenOf } from "../../supabase/functions/_shared/growth-visit";

const TOKEN = "pv_" + "a".repeat(64);
const PAGE = "a2980700-0000-4000-8000-0000000007a1";
const CHROME = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36";

describe("which requests are never recorded", () => {
  it("a person's ordinary browser is recorded", () => {
    expect(notRecordedReason(new Headers({ "user-agent": CHROME }))).toBeNull();
  });
  it("Do Not Track and Global Privacy Control are honoured", () => {
    expect(notRecordedReason(new Headers({ "user-agent": CHROME, dnt: "1" }))).toBe("privacy_signal");
    expect(notRecordedReason(new Headers({ "user-agent": CHROME, "sec-gpc": "1" }))).toBe("privacy_signal");
    expect(notRecordedReason(new Headers({ "user-agent": CHROME, dnt: "0" }))).toBeNull();
  });
  it("automated agents, PAIGE's own screenshots included, are not visits", () => {
    for (const ua of ["Googlebot/2.1", "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/129.0 Safari/537.36",
      "facebookexternalhit/1.1", "curl/8.4.0", "python-requests/2.31", "Slackbot-LinkExpanding 1.0", ""]) {
      expect(notRecordedReason(new Headers({ "user-agent": ua }))).toBe("automated_agent");
    }
  });
});

describe("what a visit may carry", () => {
  it("keeps only the referring host", () => {
    expect(referrerHost("https://News.Example.com/story?id=7#x")).toBe("news.example.com");
    expect(referrerHost("http://example.org.")).toBe("example.org");
    for (const bad of ["javascript:alert(1)", "not a url", "", null, 7, "ftp://x.y"]) expect(referrerHost(bad)).toBeNull();
  });
  it("accepts only a known kind, a real id, and a server-made token", () => {
    expect(parseVisitRequest({ kind: "page", target_id: PAGE.toUpperCase(), token: TOKEN })).toEqual({ kind: "page", targetId: PAGE, token: TOKEN, step: 0 });
    expect(parseVisitRequest({ kind: "page", target_id: PAGE, token: "pv_forged" })?.token).toBeNull();
    for (const bad of [null, [], { kind: "video", target_id: PAGE }, { kind: "page", target_id: "1" }, { kind: "page" }]) expect(parseVisitRequest(bad)).toBeNull();
  });
  it("only a funnel has a step, and a step is a small whole number", () => {
    expect(parseVisitRequest({ kind: "funnel", target_id: PAGE, step: 3 })?.step).toBe(3);
    expect(parseVisitRequest({ kind: "page", target_id: PAGE, step: 3 })?.step).toBe(0);
    for (const step of [-1, 1.5, 1001, "2"]) expect(parseVisitRequest({ kind: "funnel", target_id: PAGE, step })?.step).toBe(0);
  });
  it("a submission hands back only a well-formed visit token", () => {
    expect(visitTokenOf(TOKEN)).toBe(TOKEN);
    for (const bad of ["pv_" + "a".repeat(63), "fs_" + "a".repeat(64), 1, null]) expect(visitTokenOf(bad)).toBeNull();
  });
});

const invoke = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({ supabase: { functions: { invoke: (...a: unknown[]) => invoke(...a) } } }));

describe("the browser records a visit, and nothing more", () => {
  beforeEach(() => {
    invoke.mockReset();
    sessionStorage.clear();
    Object.defineProperty(navigator, "doNotTrack", { value: null, configurable: true });
    Object.defineProperty(navigator, "globalPrivacyControl", { value: undefined, configurable: true });
  });
  afterEach(() => vi.useRealTimers());

  it("records once, keeps the token for this tab and hands it to the next submission", async () => {
    const { recordGrowthVisit, activeVisitToken } = await import("@/lib/growth-visit");
    invoke.mockResolvedValue({ data: { recorded: true, token: TOKEN }, error: null });
    expect(await recordGrowthVisit("page", PAGE, { utm: { utm_source: "news" } })).toBe(TOKEN);
    expect(invoke).toHaveBeenCalledWith("growth-public-visit", { body: expect.objectContaining({ kind: "page", target_id: PAGE, token: null, step: 0, utm: { utm_source: "news" } }) });
    expect(activeVisitToken()).toBe(TOKEN);
    await recordGrowthVisit("page", PAGE);
    expect(invoke.mock.calls[1][1].body.token).toBe(TOKEN);
  });

  it("an idle tab starts a new visit", async () => {
    const { recordGrowthVisit } = await import("@/lib/growth-visit");
    invoke.mockResolvedValue({ data: { recorded: true, token: TOKEN }, error: null });
    await recordGrowthVisit("form", PAGE);
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 31 * 60 * 1000);
    await recordGrowthVisit("form", PAGE);
    expect(invoke.mock.calls[1][1].body.token).toBeNull();
  });

  it("a browser that asked not to be tracked is never even asked about", async () => {
    const { recordGrowthVisit, activeVisitToken } = await import("@/lib/growth-visit");
    Object.defineProperty(navigator, "globalPrivacyControl", { value: true, configurable: true });
    expect(await recordGrowthVisit("page", PAGE)).toBeNull();
    expect(invoke).not.toHaveBeenCalled();
    expect(activeVisitToken()).toBeNull();
  });

  it("a visit the server did not record leaves nothing to link, and never throws", async () => {
    const { recordGrowthVisit, activeVisitToken, clearActiveVisit } = await import("@/lib/growth-visit");
    invoke.mockResolvedValue({ data: { recorded: true, token: TOKEN }, error: null });
    await recordGrowthVisit("page", PAGE);
    invoke.mockResolvedValue({ data: { recorded: false, reason: "automated_agent" }, error: null });
    expect(await recordGrowthVisit("page", PAGE)).toBeNull();
    expect(activeVisitToken()).toBeNull();
    invoke.mockRejectedValue(new Error("offline"));
    await expect(recordGrowthVisit("page", PAGE)).resolves.toBeNull();
    invoke.mockResolvedValue({ data: { recorded: true, token: TOKEN }, error: null });
    await recordGrowthVisit("page", PAGE);
    clearActiveVisit("pv_" + "b".repeat(64));
    expect(activeVisitToken()).toBe(TOKEN);
    clearActiveVisit(TOKEN);
    expect(activeVisitToken()).toBeNull();
  });

  it("a submission carries the active visit, and only then", async () => {
    const { recordGrowthVisit, clearActiveVisit } = await import("@/lib/growth-visit");
    const { submitGrowthForm } = await import("@/lib/growth");
    invoke.mockResolvedValue({ data: { submission_id: "s1" }, error: null });
    await submitGrowthForm({ formId: PAGE, answers: { a: 1 }, trap: "", startedAt: Date.now() - 5000 });
    expect(invoke.mock.calls.at(-1)[1].body.visit).toBeUndefined();
    invoke.mockResolvedValue({ data: { recorded: true, token: TOKEN }, error: null });
    await recordGrowthVisit("page", PAGE);
    invoke.mockResolvedValue({ data: { submission_id: "s2" }, error: null });
    await submitGrowthForm({ formId: PAGE, answers: { a: 1 }, trap: "", startedAt: Date.now() - 5000 });
    expect(invoke.mock.calls.at(-1)[1].body.visit).toBe(TOKEN);
    clearActiveVisit(TOKEN);
  });
});
