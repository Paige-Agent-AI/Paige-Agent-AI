// @vitest-environment node
// The hosting door's contract (EXP06 WEB-05, owner direction 88b2f756: implementation within
// existing authority, provider activation HELD). Real handler; only the Supabase clients, the
// export builder, the provider and the network fetch are doubles (growth-hosting-door.world.ts).
// Each test names the protection it pins; every one fails with its protection removed.
import { describe, expect, it } from "vitest";
import { deploymentRow, fingerprintOf, EXPORT_HTML, MINE, PAGE, publishedPage, THEIRS, USER, world } from "./growth-hosting-door.world.ts";

const deploy = { action: "deploy", page_id: PAGE };

describe("1. the honest dormant state — no token configuration exists", () => {
  it("every deploy/recover path refuses HOSTING_NOT_ENABLED, disabled, with the product's copy", async () => {
    for (const action of ["deploy", "recover"] as const) {
      const w = world({ provider: null });
      const r = await w.call({ action, page_id: PAGE });
      expect(r.status).toBe(403);
      expect(r.body).toMatchObject({ ok: false, refused: true, disabled: true, code: "HOSTING_NOT_ENABLED" });
      expect(r.body.error).toContain("isn't switched on");
    }
  });
  it("NO approval card is ever minted while the service is dormant", async () => {
    const w = world({ provider: null });
    await w.call(deploy);
    await w.call({ ...deploy, approved_fingerprint: "pretend" });
    expect(w.tables.paige_pending_confirmations).toHaveLength(0);
  });
  it("an offered fingerprint against the dormant service is left unspent and refuses without consuming", async () => {
    const w = world({ provider: null });
    const r = await w.call({ ...deploy, approved_fingerprint: "pretend" });
    expect(r.body.code).toBe("HOSTING_NOT_ENABLED");
  });
});

describe("2. authority — the same walls the publish door holds", () => {
  it("an unauthenticated caller is refused", async () => {
    const w = world({ user: null });
    const r = await w.call(deploy);
    expect(r.status).toBe(401);
  });
  it("a plain member (not owner/admin) is forbidden, and nothing is read or minted", async () => {
    const w = world({ admin: false });
    const r = await w.call(deploy);
    expect(r.status).toBe(403);
    expect(r.body.forbidden).toBe(true);
    expect(w.tables.paige_pending_confirmations).toHaveLength(0);
  });
  it("a request naming another workspace refuses other_workspace and executes nothing", async () => {
    const w = world({ active: MINE });
    const first = await w.call(deploy);
    expect(first.status).toBe(202);
    const fp = fingerprintOf(w);
    const r = await w.call({ ...deploy, approved_fingerprint: fp, expected_tenant_id: THEIRS });
    expect(r.status).toBe(403);
    expect(r.body.code).toBe("OTHER_WORKSPACE");
    expect(w.tables.growth_hosted_deployments).toHaveLength(0);
    expect(w.seen.fetches).toHaveLength(0);
  });
  it("a lane switched off in autonomy settings refuses disabled, before any proposal", async () => {
    const w = world({ lane: "off" });
    const r = await w.call(deploy);
    expect(r.status).toBe(403);
    expect(r.body).toMatchObject({ disabled: true, code: "autonomy_off" });
    expect(w.tables.paige_pending_confirmations).toHaveLength(0);
  });
});

describe("3. readiness — only a PUBLISHED page with a buildable export can be hosted", () => {
  it("an unpublished page is not_ready with the blocking check named, and no card is minted", async () => {
    const w = world({});
    w.tables.growth_pages = [publishedPage({ status: "draft" })];
    const r = await w.call(deploy);
    expect(r.status).toBe(202);
    expect(r.body).toMatchObject({ ok: false, outcome: "not_ready" });
    expect(String(r.body.error)).toContain("published");
    expect(w.tables.paige_pending_confirmations).toHaveLength(0);
  });
  it("a page in another workspace is not found", async () => {
    const w = world({});
    w.tables.growth_pages = [publishedPage({ tenant_id: THEIRS })];
    const r = await w.call(deploy);
    expect(r.status).toBe(404);
    expect(r.body.code).toBe("ARTIFACT_NOT_FOUND");
  });
  it("a failed export build is an honest not_ready, never a deployment of nothing", async () => {
    const w = world({ exportResult: null });
    const r = await w.call(deploy);
    expect(r.body.outcome).toBe("not_ready");
    expect(String(r.body.error)).toContain("export");
    expect(w.tables.growth_hosted_deployments).toHaveLength(0);
  });
  it("recover with no hosted copy is not_ready (nothing to take down)", async () => {
    const w = world({});
    const r = await w.call({ action: "recover", page_id: PAGE });
    expect(r.body.outcome).toBe("not_ready");
  });
});

describe("4. the approval lane — one card, one fingerprint, single use", () => {
  it("prepare mints a 202 proposal with fingerprint + summary + preview; no deployment row exists yet", async () => {
    const w = world({});
    const r = await w.call(deploy);
    expect(r.status).toBe(202);
    expect(r.body).toMatchObject({ ok: false, approval_required: true, capability: "growth_hosting_deploy" });
    expect(typeof r.body.fingerprint).toBe("string");
    expect(w.tables.growth_hosted_deployments).toHaveLength(0);
    expect(w.seen.fetches).toHaveLength(0);
  });
  it("asking twice reuses the one live card (no second proposal row)", async () => {
    const w = world({});
    await w.call(deploy);
    await w.call(deploy);
    expect(w.tables.paige_pending_confirmations).toHaveLength(1);
  });
  it("redeeming the fingerprint deploys; the same fingerprint cannot run twice", async () => {
    const w = world({});
    const p = await w.call(deploy);
    const fp = String(p.body.fingerprint);
    const ok = await w.call({ ...deploy, approved_fingerprint: fp });
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ ok: true, deployed: true, verified: true, status: "live", url: "https://acme-spring-offer.paige.test-workers.dev" });
    const replay = await w.call({ ...deploy, approved_fingerprint: fp });
    expect(replay.status).toBe(409);
    expect(replay.body.code).toBe("APPROVAL_NOT_AVAILABLE");
    // one deployment, verified — and exactly one provider PUT happened
    const row = deploymentRow(w)!;
    expect(row.status).toBe("live");
    expect(row.export_sha256).toBe("ab".repeat(32));
    expect(w.seen.fetches.filter((u) => u.includes("/workers/scripts/") && u.includes("PUT") === false && u.startsWith("https://api.cloudflare"))).toHaveLength(0);
  });
  it("an approval for a different page does not execute (claim mismatch)", async () => {
    const w = world({});
    const p = await w.call(deploy);
    const r = await w.call({ action: "deploy", page_id: "99999999-9999-4999-8999-999999999999", approved_fingerprint: String(p.body.fingerprint) });
    expect(r.status).toBe(404); // the other page isn't in this workspace — refused before the claim could matter
  });
});

describe("5. REAL verification before any live claim", () => {
  it("a deployed address serving DIFFERENT bytes is verify_failed — never called live", async () => {
    const w = world({ fetchImpl: (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("api.cloudflare.")) return new Response(JSON.stringify({ success: true, errors: [], result: { subdomain: "paige.test-workers.dev" } }), { status: 200 });
      return new Response("<!doctype html><html><body>something else entirely</body></html>", { status: 200 });
    }) as typeof fetch });
    const p = await w.call(deploy);
    const r = await w.call({ ...deploy, approved_fingerprint: String(p.body.fingerprint) });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ ok: true, deployed: true, verified: false, status: "verify_failed" });
    expect(String(r.body.error)).toContain("NOT called live");
    expect(deploymentRow(w)!.status).toBe("verify_failed");
    expect(deploymentRow(w)!.verified_at).toBeNull();
  });
  it("a deployed address that does not answer leaves the row verify_failed, not live", async () => {
    const w = world({ fetchImpl: (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("api.cloudflare.")) return new Response(JSON.stringify({ success: true, errors: [], result: {} }), { status: 200 });
      return new Response("gone", { status: 503 });
    }) as typeof fetch });
    const p = await w.call(deploy);
    const r = await w.call({ ...deploy, approved_fingerprint: String(p.body.fingerprint) });
    expect(r.body.verified).toBe(false);
    expect(deploymentRow(w)!.status).toBe("verify_failed");
  });
});

describe("6. uncertain provider outcomes are never retried — a human decides", () => {
  it("a provider throw marks the row failed and answers outcome-unknown honestly", async () => {
    const w = world({ fetchImpl: (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("api.cloudflare.")) throw new Error("network died");
      return new Response(EXPORT_HTML, { status: 200 });
    }) as typeof fetch });
    const p = await w.call(deploy);
    const r = await w.call({ ...deploy, approved_fingerprint: String(p.body.fingerprint) });
    expect(r.status).toBe(503);
    expect(String(r.body.error)).toContain("can't say whether");
    expect(deploymentRow(w)!.status).toBe("failed");
    // exactly ONE provider call happened — no silent retry
    expect(w.seen.fetches.filter((u) => u.includes("api.cloudflare.")).length).toBeLessThanOrEqual(1);
  });
});

describe("7. recover — one step, and the page itself is untouched", () => {
  it("recover removes the deployment and records it removed", async () => {
    const w = world({});
    const p = await w.call({ action: "deploy", page_id: PAGE });
    await w.call({ ...deploy, approved_fingerprint: String(p.body.fingerprint) });
    const q = await w.call({ action: "recover", page_id: PAGE });
    expect(q.status).toBe(202);
    const r = await w.call({ action: "recover", page_id: PAGE, approved_fingerprint: String(q.body.fingerprint) });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ ok: true, removed: true, confirmed: true, status: "removed" });
    expect(deploymentRow(w)!.url).toBeNull();
    // the page row itself was never mutated by the hosting door
    expect(w.tables.growth_pages[0]).toMatchObject(publishedPage());
  });
  it("an unconfirmed removal records removed_unconfirmed — never silently re-fired", async () => {
    const w = world({ fetchImpl: (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("api.cloudflare.") && String(input).endsWith("/workers/scripts/acme-spring-offer")) throw new Error("network died");
      return new Response(EXPORT_HTML, { status: 200 });
    }) as typeof fetch });
    const p = await w.call({ action: "deploy", page_id: PAGE });
    await w.call({ ...deploy, approved_fingerprint: String(p.body.fingerprint) });
    const q = await w.call({ action: "recover", page_id: PAGE });
    const r = await w.call({ action: "recover", page_id: PAGE, approved_fingerprint: String(q.body.fingerprint) });
    expect(r.body).toMatchObject({ removed: true, confirmed: false, status: "removed_unconfirmed" });
    expect(String(r.body.error)).toContain("unconfirmed");
  });
});

describe("8. receipts and the §17 meter — one per executed or refused act, tenant-attributed", () => {
  it("a full deploy cycle writes the receipt and meters deployment + verification to the tenant", async () => {
    const w = world({});
    const p = await w.call(deploy);
    await w.call({ ...deploy, approved_fingerprint: String(p.body.fingerprint) });
    const executed = w.seen.receipts.find((r) => (r as Record<string, unknown>)._outcome === "capability_succeeded");
    expect(executed).toMatchObject({ _capability_key: "growth_hosting_deploy", _tenant_id: MINE, _actor_id: USER });
    const meter = w.tables.platform_usage_events;
    expect(meter.map((m) => m.event_type).sort()).toEqual(["growth_hosting_deployment", "growth_hosting_verification"]);
    expect(meter.every((m) => m.tenant_id === MINE && m.quantity === 1)).toBe(true);
  });
  it("the dormant refusal files no receipt for a panel prepare (it is someone opening the panel)", async () => {
    const w = world({ provider: null });
    await w.call(deploy);
    expect(w.seen.receipts).toHaveLength(0);
  });
});
