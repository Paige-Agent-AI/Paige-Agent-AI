// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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

describe("Zernio account-scoped publication", () => {
  const profileId = "66a1f0c2a4b9d3e8f1a2b3c4";
  const providerPostId = "65f1c0a9e2b5af0012ab34cd";
  const channelId = "1234567890123456789";
  const url = `https://discord.com/channels/1098765432109876543/${channelId}/4455667788990011223`;
  const target = {
    providerProfileKey: KEY, providerAccountId: "66b2e19d8c3f5a7e9d0b1c2d",
    platform: "discord", channelId, text: "Release 2.3 is live.", externalId: "77777777-7777-4777-8777-777777777777",
  };
  const account = {
    _id: target.providerAccountId, profileId, isActive: true, platform: "discord",
    displayName: "Test Guild · #announcements",
  };
  const discordSettings = { account: { _id: account._id, platform: "discord", channelId, displayName: account.displayName } };
  const profile = { body: { profiles: [{ _id: profileId, externalId: KEY }] } };
  const published = {
    _id: providerPostId, status: "published", metadata: { paigePublicationId: target.externalId },
    platforms: [{
      platform: "discord", accountId: { _id: target.providerAccountId }, status: "published",
      platformPostId: "4455667788990011223", platformPostUrl: url,
    }],
  };

  beforeEach(() => stubEnv({ ZERNIO_API_KEY: "zk_test" }));

  it("matches the exact active Discord account and channel in the tenant profile", async () => {
    const calls = serve([profile, { body: { accounts: [{ ...account, _id: "different-account" }, account] } }, { body: discordSettings }]);
    await expect(zernioSocialAdapter.readPostDestination(target)).resolves.toEqual({
      channelId, label: account.displayName,
    });
    expect(calls[1].url).toContain(`/accounts?profileId=${profileId}`);
    expect(calls[2].url).toContain(`/accounts/${account._id}/discord-settings`);
  });

  it.each([
    { profileId: "foreign-profile" }, { profileId: undefined }, { isActive: false }, { isActive: undefined }, { enabled: false },
  ])("refuses an unverified or disabled account before reading Discord settings (%j)", async (overrides) => {
    const calls = serve([profile, { body: { accounts: [{ ...account, ...overrides }] } }]);
    await expect(zernioSocialAdapter.readPostDestination(target)).rejects.toMatchObject({ status: 409 });
    expect(calls.every((call) => call.method === "GET")).toBe(true);
    expect(calls).toHaveLength(2);
  });

  it.each([{ _id: "another-account" }, { platform: "telegram" }, { channelId: undefined }])(
    "refuses settings that fail to confirm the exact Discord account and channel (%j)", async (overrides) => {
      serve([profile, { body: { accounts: [account] } }, { body: { account: { ...discordSettings.account, ...overrides } } }]);
      await expect(zernioSocialAdapter.readPostDestination(target)).rejects.toMatchObject({ code: "destination_unverified" });
    },
  );

  it("posts one account/channel object and reads the native post ID and link from post.platforms", async () => {
    const calls = serve([{ status: 201, body: { post: published } }]);
    const result = await zernioSocialAdapter.createPost(target);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toMatch(/\/posts$/);
    expect(calls[0].headers["idempotency-key"]).toBe(target.externalId);
    expect(JSON.parse(calls[0].body!)).toEqual({
      content: target.text, publishNow: true, metadata: { paigePublicationId: target.externalId },
      platforms: [{ platform: "discord", accountId: target.providerAccountId, platformSpecificData: { channelId } }],
    });
    expect(result).toMatchObject({
      kind: "published", requestId: providerPostId,
      results: [{ success: true, postId: "4455667788990011223", postUrl: url }],
    });
  });

  it("uses the Telegram account and posts literal approved text through its HTML parser", async () => {
    const calls = serve([{ status: 201, body: { post: { _id: providerPostId, status: "published", platforms: [
      { platform: "telegram", status: "published", platformPostUrl: "https://t.me/fixture/42" },
    ] } } }]);
    await expect(zernioSocialAdapter.createPost({ ...target, platform: "telegram", channelId: null, text: "A & <B>" }))
      .resolves.toMatchObject({ kind: "published", results: [{ success: true }] });
    expect(JSON.parse(calls[0].body!)).toMatchObject({
      content: "A &amp; &lt;B&gt;", platforms: [
        { platform: "telegram", accountId: target.providerAccountId, platformSpecificData: { parseMode: "HTML" } },
      ],
    });
  });

  it.each(["facebook", "linkedin", "google_business", "pinterest"])(
    "refuses to post to an unpinned provider default on %s", async (platform) => {
      const fetchSpy = vi.fn();
      vi.stubGlobal("fetch", fetchSpy);
      const input = { ...target, platform, channelId: null };
      await expect(zernioSocialAdapter.readPostDestination(input)).rejects.toMatchObject({ code: "destination_selection_unavailable" });
      await expect(zernioSocialAdapter.createPost(input)).rejects.toMatchObject({ code: "destination_selection_unavailable" });
      expect(fetchSpy).not.toHaveBeenCalled();
    },
  );

  it("keeps processing, per-target failure, malformed response and transport failure separate", async () => {
    serve([
      { status: 202, body: { post: { ...published, status: "publishing", platforms: [
        { ...published.platforms[0], status: "processing", platformPostUrl: null },
      ] } } },
      { status: 207, body: { post: { ...published, status: "failed", platforms: [
        { ...published.platforms[0], status: "failed", errorMessage: "Bot cannot post to this channel." },
      ] } } },
      { status: 403, body: { error: "account disconnected" } },
      { status: 409, body: { code: "idempotency_conflict" } },
      { status: 500 }, { status: 503 },
      { status: 200, body: { post: { id: providerPostId }, platformResults: published.platforms } },
    ]);
    await expect(zernioSocialAdapter.createPost(target)).resolves.toEqual({ kind: "processing", requestId: providerPostId });
    await expect(zernioSocialAdapter.createPost(target)).resolves.toMatchObject({ kind: "published", results: [{ success: false, error: "provider_rejected" }] });
    await expect(zernioSocialAdapter.createPost(target)).rejects.toMatchObject({ status: 403, code: "provider_authorization_rejected" });
    for (let i = 0; i < 4; i += 1) {
      await expect(zernioSocialAdapter.createPost(target)).resolves.toMatchObject({ kind: "unknown" });
    }
    vi.stubGlobal("fetch", vi.fn().mockRejectedValueOnce(new Error("Timed out")));
    await expect(zernioSocialAdapter.createPost(target)).resolves.toMatchObject({ kind: "unknown" });
  });

  it("reconciles a lost response by tenant profile, account and exact publication metadata with GET only", async () => {
    const calls = serve([
      profile,
      { body: { posts: [{ _id: "unrelated", metadata: {} }], pagination: { nextCursor: "next-page" } } },
      { body: { posts: [{ _id: providerPostId, metadata: published.metadata }] } },
      { body: { post: published } },
    ]);
    await expect(zernioSocialAdapter.readPost(target, null)).resolves.toMatchObject({ kind: "published", requestId: providerPostId });
    const list = new URL(calls[1].url);
    expect(list.searchParams.get("profileId")).toBe(profileId);
    expect(list.searchParams.get("accountId")).toBe(target.providerAccountId);
    expect(new URL(calls[2].url).searchParams.get("cursor")).toBe("next-page");
    expect(calls[3].url).toMatch(new RegExp(`/posts/${providerPostId}$`));
    expect(calls.every((call) => call.method === "GET")).toBe(true);
  });

  it("distinguishes a documented duplicate-content rejection from an idempotency conflict", async () => {
    const details = { accountId: target.providerAccountId, platform: target.platform, existingPostId: providerPostId };
    serve([
      { status: 409, body: { details } },
      { status: 409, body: { details, code: "idempotency_conflict" } },
      { status: 409, body: { details: { ...details, accountId: "unrelated-account" } } },
    ]);
    await expect(zernioSocialAdapter.createPost(target)).rejects.toMatchObject({ status: 409, code: "provider_duplicate_content" });
    await expect(zernioSocialAdapter.createPost(target)).resolves.toMatchObject({ kind: "unknown" });
    await expect(zernioSocialAdapter.createPost(target)).resolves.toMatchObject({ kind: "unknown" });
  });

  it.each([
    { ...published, metadata: { paigePublicationId: "other-attempt" } },
    { ...published, platforms: [{ ...published.platforms[0], accountId: "other-account" }] },
    { ...published, platforms: [{ ...published.platforms[0], platformPostUrl: url.replace(channelId, "2222222222222222222") }] },
    { ...published, platforms: [{ ...published.platforms[0], platformPostUrl: null }] },
  ])("never claims a receipt from another attempt, account or Discord channel", async (post) => {
    serve([{ body: { post } }]);
    await expect(zernioSocialAdapter.readPost(target, providerPostId)).resolves.toMatchObject({
      kind: "unknown", requestId: providerPostId,
    });
  });

  it("refuses non-UUID publication IDs and unsupported platforms before transport", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    await expect(zernioSocialAdapter.createPost({ ...target, externalId: "not-a-uuid" }))
      .rejects.toMatchObject({ code: "invalid_publication_id" });
    await expect(zernioSocialAdapter.createPost({ ...target, platform: "google" }))
      .rejects.toMatchObject({ code: "unsupported_post_platform" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
