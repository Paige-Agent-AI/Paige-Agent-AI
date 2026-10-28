// @vitest-environment node
// The hosting door's leaf parts, each pinned at unit level: the Cloudflare provider client
// (auth, refusal-vs-uncertain, no retry by construction), the REAL HTTPS verifier (exact-bytes
// comparison and every refusal reason), and the §17 meter writer (shape + never-throws).
import { describe, expect, it, vi } from "vitest";
import { deleteStaticSite, deployStaticSite, type ProviderConfig } from "../../supabase/functions/_shared/growth-hosting/provider.ts";
import { verifyHttpsDeployment } from "../../supabase/functions/_shared/growth-hosting/verify.ts";
import { meterHostingEvent } from "../../supabase/functions/_shared/growth-hosting/meter.ts";

const CONFIG: ProviderConfig = { accountId: "acct-1", apiToken: "tok-1" };
const FILES = [{ path: "index.html", contentType: "text/html; charset=utf-8", content: "<html></html>" }];

const cfFetch = (impl: (req: Request) => Promise<Response>) =>
  (async (input: RequestInfo | URL, init?: RequestInit) => impl(new Request(input, init))) as unknown as typeof fetch;

describe("provider client", () => {
  it("deploys with the account-scoped bearer token and returns the workers.dev URL", async () => {
    const seen: Array<{ method: string; url: string; auth: string }> = [];
    const r = await deployStaticSite(CONFIG, { name: "acme-spring-offer", files: FILES }, cfFetch(async (req) => {
      seen.push({ method: req.method, url: req.url, auth: req.headers.get("Authorization") ?? "" });
      return new Response(JSON.stringify({ success: true, errors: [], result: { subdomain: "paige.test-workers.dev" } }), { status: 200 });
    }));
    expect(r).toEqual({ ok: true, url: "https://acme-spring-offer.paige.test-workers.dev" });
    expect(seen[0]).toMatchObject({ method: "PUT", auth: "Bearer tok-1" });
    expect(seen[0].url).toContain("/accounts/acct-1/workers/scripts/acme-spring-offer");
  });
  it("a 4xx with a readable body is a REFUSAL, not an uncertain outcome", async () => {
    const r = await deployStaticSite(CONFIG, { name: "x", files: FILES }, cfFetch(async () =>
      new Response(JSON.stringify({ success: false, errors: [{ code: 10042, message: "bad script name" }] }), { status: 400 })));
    expect(r).toMatchObject({ ok: false, uncertain: false });
    expect(String(r.error)).toContain("bad script name");
  });
  it("a network throw is UNCERTAIN — the caller records it, never retries here", async () => {
    const r = await deployStaticSite(CONFIG, { name: "x", files: FILES }, cfFetch(async () => { throw new Error("network died"); }));
    expect(r).toMatchObject({ ok: false, uncertain: true });
    expect(String(r.error)).toContain("provider_unreachable");
  });
  it("an unreadable answer is uncertain (never a silent success)", async () => {
    const r = await deployStaticSite(CONFIG, { name: "x", files: FILES }, cfFetch(async () =>
      new Response("not json at all", { status: 502 })));
    expect(r).toMatchObject({ ok: false, uncertain: true });
  });
  it("delete converges on 404 (removing a removed deployment is ok)", async () => {
    const r = await deleteStaticSite(CONFIG, "x", cfFetch(async () =>
      new Response(JSON.stringify({ success: false, errors: [{ code: 10000 }] }), { status: 404 })));
    expect(r).toEqual({ ok: true });
  });
  it("delete propagates uncertainty on a network throw", async () => {
    const r = await deleteStaticSite(CONFIG, "x", cfFetch(async () => { throw new Error("boom"); }));
    expect(r).toMatchObject({ ok: false, uncertain: true });
  });
});

describe("REAL HTTPS verification", () => {
  const HTML = "<!doctype html><html><body>exact bytes</body></html>";
  it("verified only on exact byte equality over https", async () => {
    const r = await verifyHttpsDeployment("https://x.example/", HTML, (async () => new Response(HTML, { status: 200 })) as typeof fetch);
    expect(r.verified).toBe(true);
  });
  it("different bytes → content_mismatch, never verified", async () => {
    const r = await verifyHttpsDeployment("https://x.example/", HTML, (async () => new Response("other", { status: 200 })) as typeof fetch);
    expect(r).toMatchObject({ verified: false, reason: "content_mismatch" });
  });
  it("http error → http_error; unreachable → unreachable; non-https URL → not_https", async () => {
    expect((await verifyHttpsDeployment("https://x.example/", HTML, (async () => new Response("no", { status: 503 })) as typeof fetch)).reason).toBe("http_error");
    expect((await verifyHttpsDeployment("https://x.example/", HTML, (async () => { throw new Error("x"); }) as typeof fetch)).reason).toBe("unreachable");
    expect((await verifyHttpsDeployment("http://x.example/", HTML)).reason).toBe("not_https");
  });
});

describe("§17 meter writer", () => {
  const inserts: Array<Record<string, unknown>> = [];
  const admin = {
    from: () => ({
      insert: (row: Record<string, unknown>) => {
        inserts.push(row);
        return Promise.resolve({ data: [row], error: null });
      },
    }),
  };
  it("writes tenant-attributed rows with the event type and unit", async () => {
    await meterHostingEvent(admin as never, "t-1", "growth_hosting_deployment", { page_id: "p-1" });
    expect(inserts[0]).toMatchObject({ tenant_id: "t-1", event_type: "growth_hosting_deployment", quantity: 1, unit: "action" });
  });
  it("a NULL tenant is skipped honestly, never misattributed", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await meterHostingEvent(admin as never, null, "growth_hosting_verification", {});
    expect(inserts).toHaveLength(1); // unchanged
    expect(log.mock.calls[0]?.[0]).toContain("meter skipped");
    log.mockRestore();
  });
  it("an insert failure is logged and NEVER thrown into the request path", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const failing = { from: () => ({ insert: () => Promise.resolve({ data: null, error: { code: "X", message: "down" } }) }) };
    await expect(meterHostingEvent(failing as never, "t-1", "growth_hosting_recovery", {})).resolves.toBeUndefined();
    expect(err.mock.calls[0]?.[0]).toContain("meter insert failed");
    err.mockRestore();
  });
});
