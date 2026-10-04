/**
 * Vibe Studio V2b — the Publish panel goes through the one publish door.
 *
 * Owner direction (2026-10-04): panel publish and chat publish must not be separate authority or
 * execution doors; the panel's direct browser mutation goes away. These pins prove the Studio side:
 *  - STATIC: neither the panel nor its data layer names a publish/unpublish RPC, and the panel
 *    imports no Supabase client; the only publish call is `functions.invoke("growth-publish-command")`.
 *  - BEHAVIOURAL: preparePublication / confirmPublication (the real functions) against a stubbed
 *    `functions.invoke` answering in the door's contract (202 approval_required, 403 disabled /
 *    forbidden, 200 ok / unverified, 4xx refused). Non-2xx bodies are read from the error's context.
 * EVIDENCE CLASS: automated, against a test double of the door. Whether the deployed door answers
 * so is owed to Builder A's door tests and an authenticated drive.
 */
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({ supabase: { functions: { invoke: (...a: unknown[]) => invoke(...a) } } }));

const ok = (data: unknown) => ({ data, error: null });
const http = (status: number, body: unknown) => ({ data: null, error: { name: "FunctionsHttpError", message: `status ${status}`, context: new Response(JSON.stringify(body), { status }) } });
const PUBLISH_RPCS = /growth_(page|form|funnel)_(un)?publish|studio_image_(un)?publish/;

describe("static: no direct publish path from the Studio panel", () => {
  const panel = readFileSync("src/solo/studio/PublishPanel.tsx", "utf8");
  const data = readFileSync("src/solo/studio/studio-data.ts", "utf8");
  it("names no publish or unpublish RPC", () => {
    expect(panel).not.toMatch(PUBLISH_RPCS);
    expect(data).not.toMatch(PUBLISH_RPCS);
  });
  it("the panel holds no Supabase client; the data layer's only publish call is the door", () => {
    expect(panel).not.toContain("@/integrations/supabase/client");
    expect(data).toContain('export const PUBLISH_DOOR = "growth-publish-command";');
    expect(data).toContain("supabase.functions.invoke(PUBLISH_DOOR, { body })");
    // The panel's two acts are the two door calls.
    expect(panel).toContain("preparePublication(kind, id, action)");
    expect(panel).toContain("confirmPublication(kind, id, action, p.fingerprint)");
  });
});

describe("preparePublication — opening the panel asks, never acts", () => {
  beforeEach(() => invoke.mockReset());
  it("sends no fingerprint, maps the Studio's content kind to the door's image kind, and returns the server's checks", async () => {
    invoke.mockResolvedValue(ok({ approval_required: true, fingerprint: "fp-1", preview: { kind: "image", id: "c-1", title: "Hero", action: "publish", address: "https://cdn.example/h.png", checks: [{ key: "file", label: "The image file is ready", ok: true }] } }));
    const { preparePublication } = await import("./studio-data");
    await expect(preparePublication("content", "c-1", "publish")).resolves.toEqual({
      state: "ready", fingerprint: "fp-1",
      preview: { title: "Hero", address: "https://cdn.example/h.png", checks: [{ key: "file", label: "The image file is ready", ok: true, blocking: true, detail: undefined }] },
    });
    expect(invoke).toHaveBeenCalledWith("growth-publish-command", { body: { action: "publish", kind: "image", id: "c-1" } });
  });
  it("a failed check comes back blocked (no fingerprint)", async () => {
    invoke.mockResolvedValue(ok({ approval_required: true, preview: { checks: [{ key: "slug", label: "No public address", ok: false, detail: "Set your workspace address first." }] } }));
    const { preparePublication } = await import("./studio-data");
    const r = await preparePublication("page", "p-1", "publish");
    expect(r.state).toBe("blocked");
  });
  it("reads 403 disabled / forbidden and a refusal from the error's context body", async () => {
    const { preparePublication } = await import("./studio-data");
    invoke.mockResolvedValueOnce(http(403, { error: "Publishing is off.", disabled: true }));
    await expect(preparePublication("form", "f-1", "publish")).resolves.toEqual({ state: "disabled", message: "Publishing is off." });
    invoke.mockResolvedValueOnce(http(403, { error: "Owners and admins only.", forbidden: true }));
    await expect(preparePublication("form", "f-1", "publish")).resolves.toEqual({ state: "forbidden", reason: "not_admin", message: "Owners and admins only." });
    invoke.mockResolvedValueOnce(http(404, { ok: false, refused: true, error: "GROWTH_NOT_FOUND: that form isn't in this workspace" }));
    await expect(preparePublication("form", "f-1", "publish")).resolves.toEqual({ state: "refused", message: "That form isn't in this workspace" });
  });
  it("a dropped connection is a plain 'couldn't check', and a door that acted without a click is never success", async () => {
    const { preparePublication, PublishUnverified } = await import("./studio-data");
    invoke.mockResolvedValueOnce({ data: null, error: { name: "FunctionsFetchError", message: "Failed to send a request" } });
    await expect(preparePublication("form", "f-1", "publish")).rejects.toThrow(/couldn't check this just now/);
    invoke.mockResolvedValueOnce(ok({ ok: true, action: "publish", url: "/form/f-1" }));
    await expect(preparePublication("form", "f-1", "publish")).rejects.toBeInstanceOf(PublishUnverified);
  });
});

describe("confirmPublication — the click redeems; live only on the door's readback", () => {
  beforeEach(() => invoke.mockReset());
  it("sends the fingerprint and returns the address the door read back", async () => {
    invoke.mockResolvedValue(ok({ ok: true, action: "publish", kind: "page", id: "p-1", status: "published", published_at: "2026-10-04T10:00:00Z", url: "/p/acme/offer" }));
    const { confirmPublication } = await import("./studio-data");
    await expect(confirmPublication("page", "p-1", "publish", "fp-1")).resolves.toEqual({ action: "publish", status: "published", publishedAt: "2026-10-04T10:00:00Z", url: "/p/acme/offer" });
    expect(invoke).toHaveBeenCalledWith("growth-publish-command", { body: { action: "publish", kind: "page", id: "p-1", approved_fingerprint: "fp-1" } });
  });
  it("an ok publish with no address, an unverified outcome, and a dropped reply are all PublishUnverified", async () => {
    const { confirmPublication, PublishUnverified } = await import("./studio-data");
    invoke.mockResolvedValueOnce(ok({ ok: true, action: "publish", status: "published", url: null }));
    await expect(confirmPublication("page", "p-1", "publish", "fp")).rejects.toThrow(/didn't confirm a public address/);
    invoke.mockResolvedValueOnce(ok({ ok: false, outcome: "unverified", error: "It ran, but the readback had no address." }));
    await expect(confirmPublication("page", "p-1", "publish", "fp")).rejects.toThrow("It ran, but the readback had no address.");
    invoke.mockResolvedValueOnce({ data: null, error: { name: "FunctionsFetchError", message: "Failed to send a request" } });
    await expect(confirmPublication("page", "p-1", "publish", "fp")).rejects.toBeInstanceOf(PublishUnverified);
  });
  it("a refusal (or a fresh proposal) is PublishRefused; switched off is PublishOff", async () => {
    const { confirmPublication, PublishRefused, PublishOff } = await import("./studio-data");
    invoke.mockResolvedValueOnce(http(409, { ok: false, refused: true, error: "That approval has expired." }));
    await expect(confirmPublication("form", "f-1", "publish", "fp")).rejects.toBeInstanceOf(PublishRefused);
    invoke.mockResolvedValueOnce(ok({ approval_required: true, fingerprint: "fp-2", preview: { checks: [] } }));
    await expect(confirmPublication("form", "f-1", "publish", "fp")).rejects.toBeInstanceOf(PublishRefused);
    invoke.mockResolvedValueOnce(http(403, { error: "Publishing is off.", disabled: true }));
    await expect(confirmPublication("form", "f-1", "publish", "fp")).rejects.toBeInstanceOf(PublishOff);
  });
  it("an unpublish succeeds without an address", async () => {
    invoke.mockResolvedValue(ok({ ok: true, action: "unpublish", kind: "funnel", id: "u-1", status: "draft" }));
    const { confirmPublication } = await import("./studio-data");
    await expect(confirmPublication("funnel", "u-1", "unpublish", "fp")).resolves.toMatchObject({ action: "unpublish", status: "draft", url: null });
  });
});

describe("review fixes — the door's own codes read truthfully (growth-publish-command/door.ts)", () => {
  beforeEach(() => invoke.mockReset());
  it("carries each check's blocking flag; a check the door didn't mark stays blocking", async () => {
    invoke.mockResolvedValue(ok({ approval_required: true, fingerprint: "0123456789abcdef", preview: { checks: [
      { key: "has_questions", label: "Has 3 questions", ok: true, blocking: true },
      { key: "alert_email", label: "No alert email", ok: false, blocking: false },
      { key: "legacy", label: "Unmarked", ok: false },
    ] } }));
    const { preparePublication } = await import("./studio-data");
    const r = await preparePublication("form", "f-1", "publish");
    expect(r.state === "ready" && r.preview.checks.map((c) => [c.key, c.blocking])).toEqual([["has_questions", true], ["alert_email", false], ["legacy", true]]);
  });
  it("names the forbidden reason on prepare and redeem", async () => {
    const { preparePublication, confirmPublication, PublishForbidden } = await import("./studio-data");
    for (const [code, reason] of [["NO_WORKSPACE", "no_workspace"], ["OTHER_WORKSPACE", "other_workspace"], ["NOT_ADMIN", "not_admin"], [undefined, "not_admin"]] as const) {
      invoke.mockResolvedValueOnce(http(403, { ok: false, refused: true, forbidden: true, code, error: "x" }));
      await expect(preparePublication("form", "f-1", "publish")).resolves.toMatchObject({ state: "forbidden", reason });
      invoke.mockResolvedValueOnce(http(403, { ok: false, refused: true, forbidden: true, code, error: "x" }));
      const e = await confirmPublication("form", "f-1", "publish", "fp").catch((x) => x);
      expect(e).toBeInstanceOf(PublishForbidden);
      expect(e.reason).toBe(reason);
    }
  });
  it("a redeem the door says never ran is PublishNotDone, not PublishUnverified", async () => {
    const { confirmPublication, PublishNotDone } = await import("./studio-data");
    for (const reply of [
      http(503, { ok: false, code: "READINESS_UNAVAILABLE", error: "I couldn't check whether it's ready just now. Nothing changed. Try again." }),
      http(503, { ok: false, code: "APPROVAL_STORE_UNAVAILABLE", error: "I couldn't check that approval just now. Nothing changed." }),
      http(503, { ok: false, code: "DECISION_RECEIPT_FAILED", error: "I couldn't record this decision, so I didn't go ahead. Nothing changed." }),
      http(503, { ok: false, refused: true, code: "CAPABILITY_NOT_GOVERNED", error: "This can't be done from here yet. Nothing changed." }),
      http(500, { ok: false, outcome: "failed", error: "It didn't go live. Nothing changed." }),
    ]) {
      invoke.mockResolvedValueOnce(reply);
      await expect(confirmPublication("page", "p-1", "publish", "fp")).rejects.toBeInstanceOf(PublishNotDone);
    }
  });
  it("only a lost answer, an unreadable reply, unverified, or the door's catch-all may say 'may not be live'", async () => {
    const { confirmPublication, PublishUnverified } = await import("./studio-data");
    for (const reply of [
      http(503, { ok: false, outcome: "outcome_unknown", error: "The answer never came back." }),
      ok({ ok: false, outcome: "unverified", error: "It ran, unconfirmed." }),
      http(500, { ok: false, code: "UNEXPECTED", error: "Something went wrong on our side. Check the project before trying again." }),
      { data: null, error: { name: "FunctionsFetchError", message: "Failed to send a request" } },
    ]) {
      invoke.mockResolvedValueOnce(reply);
      await expect(confirmPublication("page", "p-1", "publish", "fp")).rejects.toBeInstanceOf(PublishUnverified);
    }
  });
});
