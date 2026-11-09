// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { zernioSocialAdapter } from "../../supabase/functions/_shared/social-provider/zernio.ts";
import { NeedsConfigError } from "../../supabase/functions/_shared/provider-types.ts";

const KEY = "ps_0123456789abcdef0123456789abcdef01234567";

const stubEnv = (env: Record<string, string> = {}) => {
  vi.stubGlobal("Deno", {
    env: { get: (name: string) => env[name], toObject: () => env },
    resolveDns: vi.fn().mockResolvedValue(["8.8.8.8"]),
  });
};

afterEach(() => vi.unstubAllGlobals());

/** Serves the given Responses in order and records every request URL + method. */
function serve(bodies: Array<{ status?: number; body?: unknown }>) {
  const calls: Array<{ url: string; method: string; body: string | null; headers: Record<string, string> }> = [];
  let cursor = 0;
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(String(input), init);
    const headers: Record<string, string> = {};
    new Headers((input instanceof Request ? request.headers : init?.headers) ?? undefined).forEach((value, key) => { headers[key] = value; });
    calls.push({ url: request.url, method: request.method, body: init?.body ? String(init.body) : null, headers });
    const next = bodies[Math.min(cursor, bodies.length - 1)];
    cursor += 1;
    return new Response(next.body === undefined ? "{}" : JSON.stringify(next.body), {
      status: next.status ?? 200,
    });
  }));
  return calls;
}

describe("Zernio adapter configuration", () => {
  it("is dormant without a vaulted key and refuses before any provider call", async () => {
    stubEnv({});
    expect(zernioSocialAdapter.isConfigured()).toBe(false);
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    await expect(zernioSocialAdapter.createProfile({ providerProfileKey: KEY }))
      .rejects.toThrow(NeedsConfigError);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("Zernio profiles", () => {
  it("creates the profile keyed by the opaque external id and treats a 409 as idempotent", async () => {
    stubEnv({ ZERNIO_API_KEY: "zk_test" });
    const calls = serve([{ status: 201, body: { message: "created", profile: { _id: "zp_1", externalId: KEY } } }]);
    await expect(zernioSocialAdapter.createProfile({ providerProfileKey: KEY })).resolves.toEqual({ created: true });
    expect(calls[0].url).toContain("/v1/profiles");
    expect(calls[0].method).toBe("POST");
    expect(calls[0].body).toContain(`"externalId":"${KEY}"`);

    serve([{ status: 409, body: { error_code: "PROFILE_EXISTS", details: { existingProfileId: "zp_1" } } }]);
    await expect(zernioSocialAdapter.createProfile({ providerProfileKey: KEY })).resolves.toEqual({ created: false });
  });

  it("refuses a malformed profile key before any transport", async () => {
    stubEnv({ ZERNIO_API_KEY: "zk_test" });
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    await expect(zernioSocialAdapter.readProfile({ providerProfileKey: "not-a-key" }))
      .rejects.toMatchObject({ code: "invalid_profile_key" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("Zernio connect URL", () => {
  it("resolves the external id to the provider profile id and carries the secure return URL", async () => {
    stubEnv({ ZERNIO_API_KEY: "zk_test" });
    const calls = serve([
      { body: { data: [{ _id: "zp_9", externalId: KEY, name: KEY }] } },
      { body: { authUrl: "https://zernio.com/connect/launch?state=s1", state: "s1" } },
    ]);
    const authorization = await zernioSocialAdapter.createConnectUrl({
      providerProfileKey: KEY,
      redirectUrl: "https://paige.example/functions/v1/paige-social-callback?attempt=a&token=b",
      platform: "instagram",
    });
    expect(authorization.url).toBe("https://zernio.com/connect/launch?state=s1");
    expect(calls[0].url).toContain("/v1/profiles?limit=100");
    expect(calls[1].url).toContain("/v1/connect/instagram?");
    expect(calls[1].url).toContain("profileId=zp_9");
    expect(calls[1].url).toContain(`redirect_url=${encodeURIComponent("https://paige.example/functions/v1/paige-social-callback?attempt=a&token=b")}`);
  });

  it("sends the Google Business platform under its provider path", async () => {
    stubEnv({ ZERNIO_API_KEY: "zk_test" });
    const calls = serve([
      { body: [{ id: "zp_2", externalId: KEY }] },
      { body: { authUrl: "https://zernio.com/go" } },
    ]);
    await zernioSocialAdapter.createConnectUrl({ providerProfileKey: KEY, redirectUrl: "https://paige.example/cb", platform: "google_business" });
    expect(calls[1].url).toContain("/v1/connect/google-business?");
  });

  it("connects X under the provider's own slug (twitter) — the live 2026-11-06 failure", async () => {
    stubEnv({ ZERNIO_API_KEY: "zk_test" });
    const calls = serve([
      { body: [{ id: "zp_3", externalId: KEY }] },
      { body: { authUrl: "https://zernio.com/go" } },
    ]);
    await zernioSocialAdapter.createConnectUrl({ providerProfileKey: KEY, redirectUrl: "https://paige.example/cb", platform: "x" });
    expect(calls[1].url).toContain("/v1/connect/twitter?");
  });

  it("refuses an authorization URL that is not https or not on a consent host", async () => {
    stubEnv({ ZERNIO_API_KEY: "zk_test" });
    serve([
      { body: [{ _id: "zp_9", externalId: KEY }] },
      { body: { authUrl: "http://zernio.com/connect" } },
    ]);
    await expect(zernioSocialAdapter.createConnectUrl({ providerProfileKey: KEY, redirectUrl: "https://paige.example/cb", platform: "x" }))
      .rejects.toMatchObject({ code: "invalid_authorization_url" });

    serve([
      { body: [{ _id: "zp_9", externalId: KEY }] },
      { body: { authUrl: "https://evil.example/connect" } },
    ]);
    await expect(zernioSocialAdapter.createConnectUrl({ providerProfileKey: KEY, redirectUrl: "https://paige.example/cb", platform: "x" }))
      .rejects.toMatchObject({ code: "invalid_authorization_url" });
  });

  it("refuses a platform outside the OAuth catalogue before any transport", async () => {
    stubEnv({ ZERNIO_API_KEY: "zk_test" });
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    await expect(zernioSocialAdapter.createConnectUrl({ providerProfileKey: KEY, redirectUrl: "https://paige.example/cb", platform: "reddit" }))
      .rejects.toMatchObject({ code: "unsupported_oauth_platform" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("refuses honestly when the profile has not been created at the provider", async () => {
    stubEnv({ ZERNIO_API_KEY: "zk_test" });
    serve([{ body: [{ _id: "zp_other", externalId: "ps_ffffffffffffffffffffffffffffffffffffffff" }] }]);
    await expect(zernioSocialAdapter.createConnectUrl({ providerProfileKey: KEY, redirectUrl: "https://paige.example/cb", platform: "x" }))
      .rejects.toMatchObject({ code: "provider_profile_not_found" });
  });
});

describe("Zernio account readback", () => {
  it("maps provider rows onto the catalogue platform vocabulary with honest health states", async () => {
    stubEnv({ ZERNIO_API_KEY: "zk_test" });
    serve([
      { body: [{ _id: "zp_9", externalId: KEY }] },
      { body: { data: [
        { _id: "za_1", platform: "google-business", username: "@acme", displayName: "Acme", avatarUrl: "https://cdn.example/a.png", isActive: true, capabilities: ["comments", "profile_analytics"] },
        { accountId: "za_2", platform: "twitter", username: "@second", needsReconnect: true },
        { _id: "za_3", platform: "instagram", username: "@third", status: "error" },
      ] } },
    ]);
    const profile = await zernioSocialAdapter.readProfile({ providerProfileKey: KEY });
    expect(profile.providerProfileKey).toBe(KEY);
    expect(profile.accounts).toEqual([
      expect.objectContaining({ platform: "google_business", providerAccountId: "za_1", status: "connected", capabilities: ["comments", "profile_analytics"] }),
      expect.objectContaining({ platform: "x", providerAccountId: "za_2", status: "needs_reauth" }),
      expect.objectContaining({ platform: "instagram", providerAccountId: "za_3", status: "needs_reauth" }),
    ]);
  });

  it("refuses readback that lacks a stable account identifier", async () => {
    stubEnv({ ZERNIO_API_KEY: "zk_test" });
    serve([
      { body: [{ _id: "zp_9", externalId: KEY }] },
      { body: [{ platform: "instagram", displayName: "no stable id" }] },
    ]);
    await expect(zernioSocialAdapter.readProfile({ providerProfileKey: KEY }))
      .rejects.toMatchObject({ code: "invalid_account_readback" });
  });
});

describe("Zernio disconnect", () => {
  it("revokes each connected account, then removes the profile; a blocked empty profile is acceptable residue", async () => {
    stubEnv({ ZERNIO_API_KEY: "zk_test" });
    const calls = serve([
      { body: [{ _id: "zp_9", externalId: KEY }] },
      { body: [{ _id: "za_1", platform: "instagram" }, { _id: "za_2", platform: "x" }] },
      { status: 200, body: { gracePeriodEndsAt: "soon" } },
      { status: 200, body: { gracePeriodEndsAt: "soon" } },
      { status: 400, body: { error_code: "PROFILE_HAS_ACCOUNTS" } },
    ]);
    await expect(zernioSocialAdapter.deleteProfile({ providerProfileKey: KEY })).resolves.toBeUndefined();
    expect(calls.map((call) => `${call.method} ${call.url}`)).toEqual([
      `GET https://zernio.com/api/v1/profiles?limit=100`,
      `GET https://zernio.com/api/v1/accounts?profileId=zp_9&limit=100`,
      `DELETE https://zernio.com/api/v1/accounts/za_1`,
      `DELETE https://zernio.com/api/v1/accounts/za_2`,
      `DELETE https://zernio.com/api/v1/profiles/zp_9`,
    ]);
  });

  it("tolerates an account already gone at the provider and finishes the revocation", async () => {
    stubEnv({ ZERNIO_API_KEY: "zk_test" });
    serve([
      { body: [{ _id: "zp_9", externalId: KEY }] },
      { body: [{ _id: "za_gone", platform: "x" }] },
      { status: 404, body: {} },
      { status: 200, body: {} },
    ]);
    await expect(zernioSocialAdapter.deleteProfile({ providerProfileKey: KEY })).resolves.toBeUndefined();
  });
});

describe("Zernio publishing arm (owner-approved November 3)", () => {
  const PUB = "1a2b3c4d-0000-4000-8000-00000000f001";
  it("posts now with the publication UUID as the Idempotency-Key and the resolved profile", async () => {
    stubEnv({ ZERNIO_API_KEY: "zk_test" });
    const calls = serve([
      { body: [{ _id: "zp_9", externalId: KEY }] },
      { status: 207, body: { post: { id: "zp_post_1", status: "published" }, platformResults: [
        { platform: "google-business", status: "published", platformPostId: "gp_1", platformPostUrl: "https://plus.google.com/x" },
      ] } },
    ]);
    const outcome = await zernioSocialAdapter.createPost({ providerProfileKey: KEY, platform: "google_business", text: "Hello world", externalId: PUB });
    expect(outcome).toEqual({ kind: "published", results: [expect.objectContaining({ platform: "google_business", success: true, postId: "gp_1", postUrl: "https://plus.google.com/x" })] });
    expect(calls[1].url).toContain("/v1/posts");
    expect(calls[1].method).toBe("POST");
    expect(calls[1].body).toContain('"publishNow":true');
    expect(calls[1].body).toContain('"profileId":"zp_9"');
    expect(calls[1].body).toContain('"platforms":["google-business"]');
    expect(calls[1].headers["idempotency-key"]).toBe(PUB);
  });

  it("maps per-platform failures honestly inside a published outcome", async () => {
    stubEnv({ ZERNIO_API_KEY: "zk_test" });
    serve([
      { body: [{ _id: "zp_9", externalId: KEY }] },
      { status: 207, body: { post: { id: "zp_post_2", status: "partial" }, platformResults: [
        { platform: "x", status: "failed", error: "rate limited by platform" },
      ] } },
    ]);
    const outcome = await zernioSocialAdapter.createPost({ providerProfileKey: KEY, platform: "x", text: "Hi", externalId: PUB });
    expect(outcome).toEqual({ kind: "published", results: [expect.objectContaining({ platform: "x", success: false, error: "rate limited by platform", postUrl: null })] });
  });

  it("reports an accepted-but-unproven post as processing with the provider's own post id", async () => {
    stubEnv({ ZERNIO_API_KEY: "zk_test" });
    serve([
      { body: [{ _id: "zp_9", externalId: KEY }] },
      { status: 201, body: { message: "created", post: { id: "zp_post_3", status: "publishing" } } },
    ]);
    await expect(zernioSocialAdapter.createPost({ providerProfileKey: KEY, platform: "instagram", text: "Hi", externalId: PUB }))
      .resolves.toEqual({ kind: "processing", requestId: "zp_post_3" });
  });

  it("refuses to guess when the answer proves nothing", async () => {
    stubEnv({ ZERNIO_API_KEY: "zk_test" });
    serve([
      { body: [{ _id: "zp_9", externalId: KEY }] },
      { status: 201, body: { message: "created", post: { id: "zp_post_4" } } },
    ]);
    await expect(zernioSocialAdapter.createPost({ providerProfileKey: KEY, platform: "x", text: "Hi", externalId: PUB }))
      .resolves.toEqual({ kind: "unknown", requestId: "zp_post_4", reason: "provider_answered_without_results" });
  });

  it("treats a 409 as an uncertain outcome for reconciliation, never a clean failure", async () => {
    stubEnv({ ZERNIO_API_KEY: "zk_test" });
    serve([
      { body: [{ _id: "zp_9", externalId: KEY }] },
      { status: 409, body: { code: "idempotency_conflict" } },
    ]);
    await expect(zernioSocialAdapter.createPost({ providerProfileKey: KEY, platform: "x", text: "Hi", externalId: PUB }))
      .resolves.toEqual({ kind: "unknown", requestId: null, reason: "provider_idempotency_or_dedup_conflict" });
  });

  it("still throws the door's refusal families for provider authorization problems", async () => {
    stubEnv({ ZERNIO_API_KEY: "zk_test" });
    serve([
      { body: [{ _id: "zp_9", externalId: KEY }] },
      { status: 403, body: { code: "ACCOUNT_DISCONNECTED" } },
    ]);
    await expect(zernioSocialAdapter.createPost({ providerProfileKey: KEY, platform: "x", text: "Hi", externalId: PUB }))
      .rejects.toMatchObject({ code: "provider_authorization_rejected" });
  });

  it("refuses a non-UUID publication id before any transport (idempotency key integrity)", async () => {
    stubEnv({ ZERNIO_API_KEY: "zk_test" });
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    await expect(zernioSocialAdapter.createPost({ providerProfileKey: KEY, platform: "x", text: "Hi", externalId: "not-a-uuid" }))
      .rejects.toMatchObject({ code: "invalid_publication_id" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
