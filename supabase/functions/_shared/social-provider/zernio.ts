/**
 * Zernio adapter — the Social connection provider Paige selected on 2026-10-29
 * (owner decision; API key vaulted by the owner as ZERNIO_API_KEY in Edge Secrets).
 *
 * The Social doors use this adapter for the provider connection and publish paths.
 * Tenant identity stays the opaque provider profile key
 * (ps_<hmac>) minted by the doors — Zernio knows it only as the profile's
 * externalId, never as a Paige tenant or customer id.
 *
 * Zernio's documented completion signal is readback (GET /accounts), not redirect
 * parameters: the callback therefore verifies Zernio rows by reading the profile
 * back and requiring the requested platform's account to be present.
 *
 * Posting sends one account-scoped target with the publication row's UUID as its
 * idempotency key. The same UUID in Zernio metadata supports read-only reconciliation
 * if the response is lost.
 */
import { envKey } from "../env-key.ts";
import { NeedsConfigError } from "../provider-types.ts";
import { safeFetch } from "../ssrfGuard.ts";
import { GOOGLE_CONNECT_AREAS, SOCIAL_CONNECTION_PLATFORMS, SOCIAL_OAUTH_PLATFORMS, SOCIAL_POST_PLATFORMS } from "./mod.ts";
import {
  SocialProviderError,
  type SocialProviderAccount,
  type SocialProviderAdapter,
  type SocialProviderProfile,
  type SocialPostInput,
  type SocialProviderPostOutcome,
} from "./mod.ts";

const DEFAULT_API_BASE = "https://zernio.com/api/v1";
const PROFILE_KEY_PATTERN = /^ps_[a-f0-9]{40}$/;

/** Zernio hosts its own selection screens before the real platform consent, and the
 *  consent screens themselves live on the platforms. Both are accepted launch targets. */
const AUTHORIZATION_HOSTS: Readonly<Record<string, readonly string[]>> = {
  tiktok: ["tiktok.com"], instagram: ["instagram.com", "facebook.com"],
  facebook: ["facebook.com"], linkedin: ["linkedin.com"], youtube: ["google.com"],
  x: ["x.com", "twitter.com"], threads: ["threads.net", "facebook.com"],
  pinterest: ["pinterest.com"], google_business: ["google.com"],
  snapchat: ["snapchat.com"], internal_bounce: ["zernio.com"],
  // Connection apps (owner 2026-11-05): Google's consent lives on Google, Discord's on
  // Discord; Telegram has no OAuth redirect at all — its flow may hand back a Telegram
  // deep link or bounce through the provider, so both are accepted launch targets.
  google: ["google.com", "accounts.google.com"],
  discord: ["discord.com"],
  telegram: ["telegram.org", "t.me", "zernio.com"],
};

/** Paige's catalogue key -> the path/slug Zernio's API addresses that platform by.
 *  The docs' own pages name the endpoints: /connect/twitter (not x) and
 *  /connect/google-business (not google_business). Inbound account names fold back
 *  the other way through PLATFORM_ALIASES below. */
const PROVIDER_PATH: Readonly<Record<string, string>> = {
  google_business: "google-business",
  x: "twitter",
};

/** The platform names Zernio reports on accounts, folded into Paige's catalogue keys. */
const PLATFORM_ALIASES: Readonly<Record<string, string>> = {
  twitter: "x", x_twitter: "x", googlebusiness: "google_business",
  google_my_business: "google_business", gbp: "google_business",
  googlebusinessprofile: "google_business",
};

function env(name: string): string | undefined {
  const deno = (globalThis as { Deno?: { env?: { get(key: string): string | undefined } } }).Deno;
  return deno?.env?.get(name);
}

function providerKey(): string {
  const key = envKey("ZERNIO_API_KEY");
  if (!key) throw new NeedsConfigError("social");
  return key;
}

function apiBase(): string {
  return (env("ZERNIO_API_BASE_URL") ?? DEFAULT_API_BASE).replace(/\/$/, "");
}

function assertProfileKey(value: string): void {
  if (!PROFILE_KEY_PATTERN.test(value)) {
    throw new SocialProviderError("invalid_profile_key", 400, "The Social profile identifier is invalid.");
  }
}

function connectPlatform(value: string): typeof SOCIAL_CONNECTION_PLATFORMS[number] {
  if (!SOCIAL_CONNECTION_PLATFORMS.includes(value as typeof SOCIAL_CONNECTION_PLATFORMS[number])) {
    throw new SocialProviderError("unsupported_oauth_platform", 400, "This Social OAuth platform is unavailable.");
  }
  return value as typeof SOCIAL_CONNECTION_PLATFORMS[number];
}

/** Publishing rides the POST set: the social networks plus the provider's
 *  documented messaging targets (discord, telegram). A connectable app is still not
 *  automatically a publish target — google connects but does not receive posts. */
const PLATFORMS_WITH_MUTABLE_DESTINATIONS = new Set(["facebook", "linkedin", "google_business", "pinterest"]);

function postPlatform(value: string): typeof SOCIAL_POST_PLATFORMS[number] {
  if (!SOCIAL_POST_PLATFORMS.includes(value as typeof SOCIAL_POST_PLATFORMS[number])) {
    throw new SocialProviderError("unsupported_post_platform", 400, "This platform cannot be published to yet.");
  }
  if (PLATFORMS_WITH_MUTABLE_DESTINATIONS.has(value)) {
    throw new SocialProviderError("destination_selection_unavailable", 409, "This network needs a specific Page, organization, location or board before publishing.");
  }
  return value as typeof SOCIAL_POST_PLATFORMS[number];
}

const hostnameMatches = (hostname: string, expected: string) =>
  hostname === expected || hostname.endsWith(`.${expected}`);

function isDuplicatePost(payload: Record<string, unknown>, requestBody: unknown): boolean {
  const details = asRecord(payload.details) ?? payload;
  const requested = asRecord(requestBody);
  const target = Array.isArray(requested?.platforms) ? asRecord(requested.platforms[0]) : null;
  return typeof details.existingPostId === "string" && /^[a-f0-9]{24}$/i.test(details.existingPostId)
    && typeof target?.accountId === "string" && details.accountId === target.accountId
    && normalizePlatform(details.platform) === normalizePlatform(target.platform);
}

async function request(path: string, init: RequestInit = {}): Promise<unknown> {
  const response = await safeFetch(`${apiBase()}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${providerKey()}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  }, { timeoutMs: 15_000, maxBytes: 262_144 });
  if (response.status < 200 || response.status >= 300) {
    let providerCode = "";
    let duplicatePost = false;
    try {
      const body = response.body ? JSON.parse(response.body) as Record<string, unknown> : {};
      const raw = body.error_code ?? body.code;
      providerCode = typeof raw === "string" ? raw.toUpperCase() : "";
      duplicatePost = response.status === 409 && path === "/posts" && init.method === "POST"
        && providerCode !== "IDEMPOTENCY_CONFLICT" && typeof init.body === "string"
        && isDuplicatePost(body, JSON.parse(init.body));
    } catch { providerCode = ""; }
    const code = duplicatePost ? "provider_duplicate_content"
      : providerCode === "PROFILE_LIMIT_REACHED" || providerCode === "PROFILE_BLOCKED"
      ? "provider_profile_limit"
      : response.status === 401 || response.status === 403
      ? "provider_authorization_rejected"
      : response.status === 404
        ? "provider_profile_not_found"
        : response.status === 409
          ? "provider_profile_exists"
          : response.status === 429
            ? "provider_rate_limited"
            : "provider_request_failed";
    throw new SocialProviderError(code, response.status, "The Social provider request could not be completed.");
  }
  if (response.truncated) throw new SocialProviderError("provider_response_too_large", 502, "The Social provider response exceeded its safe limit.");
  try { return response.body ? JSON.parse(response.body) : {}; }
  catch { throw new SocialProviderError("invalid_provider_response", 502, "The Social provider returned an invalid response."); }
}

function text(value: unknown, max = 240): string | null {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, max) : null;
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value
    .filter((item): item is string => typeof item === "string" && /^[a-z][a-z0-9_.:-]{0,79}$/.test(item.trim()))
    .map((item) => item.trim()))].slice(0, 64);
}

function safeHttpsUrl(value: unknown): string | null {
  const candidate = text(value, 2048);
  if (!candidate) return null;
  try {
    const url = new URL(candidate);
    return url.protocol === "https:" && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

/** Zernio answers lists as bare arrays or wrapped ({data:[…]}, {profiles:[…]}, {accounts:[…]}). */
function listOf(payload: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(payload)) return payload.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item));
  if (payload && typeof payload === "object") {
    const root = payload as Record<string, unknown>;
    for (const wrapper of ["data", "profiles", "accounts", "items", "posts"]) {
      if (Array.isArray(root[wrapper])) return listOf(root[wrapper]);
    }
  }
  return [];
}

/** Zernio's connect/accounts endpoints key on the profile's own id. The doors persist
 *  only the opaque externalId, so every operation resolves it first — one read, and a
 *  missing profile refuses honestly instead of operating on a guess. */
async function resolveProfileId(providerProfileKey: string): Promise<string> {
  assertProfileKey(providerProfileKey);
  const profiles = listOf(await request(`/profiles?limit=100`));
  const match = profiles.find((profile) => text(profile.externalId, 200) === providerProfileKey);
  const id = text(match?._id ?? match?.id, 200);
  if (!match || !id) {
    throw new SocialProviderError("provider_profile_not_found", 404, "The Social provider profile was not found.");
  }
  return id;
}

function normalizePlatform(value: unknown): string | null {
  const raw = typeof value === "string" ? value.trim().toLowerCase().replace(/[^a-z0-9_]/g, "_").replace(/_+/g, "_") : "";
  if (!raw) return null;
  const aliased = PLATFORM_ALIASES[raw] ?? raw;
  // Single-letter keys are real ("x"); everything after the first letter is bounded.
  return /^[a-z][a-z0-9_]{0,31}$/.test(aliased) ? aliased : null;
}

export function normalizeZernioAccounts(payload: unknown): SocialProviderAccount[] {
  const accounts: SocialProviderAccount[] = [];
  for (const row of listOf(payload)) {
    const providerAccountId = text(row._id ?? row.accountId ?? row.id ?? row.username, 200);
    const platform = normalizePlatform(row.platform);
    if (!providerAccountId || !platform) {
      throw new SocialProviderError("invalid_account_readback", 502, "Provider readback did not include a stable account identifier.");
    }
    const health = typeof row.status === "string" ? row.status.toLowerCase() : "";
    const needsReauth = row.needsReconnect === true || row.isActive === false
      || health.includes("error") || health.includes("disconnect") || health.includes("reconnect");
    accounts.push({
      platform,
      providerAccountId,
      handle: text(row.handle ?? row.username, 160),
      displayName: text(row.displayName ?? row.name, 200),
      avatarUrl: safeHttpsUrl(row.avatarUrl ?? row.avatar ?? row.social_images),
      status: needsReauth ? "needs_reauth" : "connected",
      capabilities: stringList(row.capabilities ?? row.permissions),
    });
  }
  return accounts;
}

const POST_REJECTED_BEFORE_DISPATCH = new Set([400, 401, 402, 403, 404, 405, 413, 415, 429]);
const PUBLICATION_METADATA_KEY = "paigePublicationId";

/** Parse only evidence for the single approved target. Zernio's inline examples
 * sometimes omit accountId. A GET readback must explicitly name that account. */
function postOutcome(
  payload: unknown,
  target: SocialPostInput,
  lookupId?: string,
): SocialProviderPostOutcome {
  const envelope = asRecord(payload);
  const post = asRecord(envelope?.post);
  const requestId = text(post?._id, 128);
  const targets = Array.isArray(post?.platforms) ? post.platforms : [];
  const row = targets.length === 1 ? asRecord(targets[0]) : null;
  const accountId = text(asRecord(row?.accountId)?._id ?? row?.accountId, 200);
  const matches = requestId && (!lookupId || (requestId === lookupId
    && asRecord(post?.metadata)?.[PUBLICATION_METADATA_KEY] === target.externalId))
    && normalizePlatform(row?.platform) === target.platform
    && (accountId === target.providerAccountId || (!lookupId && row?.accountId == null));
  if (!matches) {
    return { kind: "unknown", requestId: lookupId ?? null, reason: "provider_target_unverified" };
  }
  const url = safeHttpsUrl(row?.platformPostUrl);
  const discordChannelMatches = target.platform !== "discord"
    || (url && new URL(url).hostname === "discord.com" && new URL(url).pathname.split("/")[3] === target.channelId);
  if (post?.status === "published" && row?.status === "published" && url && discordChannelMatches) {
    return { kind: "published", requestId, results: [{
      platform: target.platform, success: true, postId: text(row.platformPostId, 200) ?? requestId, postUrl: url, error: null,
    }] };
  }
  if (row?.status === "failed" && post?.status === "failed") {
    return { kind: "published", requestId, results: [{
      platform: target.platform, success: false, postId: requestId, postUrl: null, error: "provider_rejected",
    }] };
  }
  return { kind: "processing", requestId };
}

function authorizationUrl(raw: unknown, platform: string): string {
  const url = text(raw, 4096);
  let authorization: URL | null = null;
  try { authorization = url ? new URL(url) : null; } catch { authorization = null; }
  const expectedHosts = [...(AUTHORIZATION_HOSTS[platform] ?? []), ...AUTHORIZATION_HOSTS.internal_bounce];
  if (!authorization || authorization.protocol !== "https:" || authorization.username || authorization.password
      || !expectedHosts.some((host) => hostnameMatches(authorization!.hostname, host))) {
    throw new SocialProviderError("invalid_authorization_url", 502, "The Social provider did not return a secure authorization URL.");
  }
  return authorization.href;
}

function firstOf(payload: unknown, field: string): unknown {
  if (payload && typeof payload === "object" && !Array.isArray(payload)) {
    const root = payload as Record<string, unknown>;
    if (root[field] !== undefined) return root[field];
    for (const wrapper of ["data", "connect"]) {
      const inner = root[wrapper];
      if (inner && typeof inner === "object" && !Array.isArray(inner)) {
        const value = (inner as Record<string, unknown>)[field];
        if (value !== undefined) return value;
      }
    }
  }
  return undefined;
}

/** Operator-hub helpers — the ONLY code that may address a Zernio profile by the
 *  provider's own id. Tenant-facing adapter methods keep addressing profiles by the
 *  opaque ps_<hmac> key exclusively; PROFILE_KEY_PATTERN stays strict for tenants, and
 *  profiles whose externalId IS a tenant key are never offered for adoption. */
export type ZernioHubProfile = {
  profileId: string;
  name: string | null;
  accounts: SocialProviderAccount[];
};

const HUB_PROFILE_ID_PATTERN = /^[A-Za-z0-9_-]{6,64}$/;

function hubProfileRow(row: Record<string, unknown>): string | null {
  const id = text(row._id ?? row.id, 200);
  const externalId = text(row.externalId, 200);
  // Tenant-owned profiles (externalId is a ps_ key) are excluded from hub surfaces.
  if (!id || (externalId && PROFILE_KEY_PATTERN.test(externalId))) return null;
  return id;
}

/** Lists the workspace's non-tenant Zernio profiles with their connected accounts. */
export async function listZernioHubProfiles(): Promise<ZernioHubProfile[]> {
  const rows = listOf(await request("/profiles?limit=100"));
  const hubs: ZernioHubProfile[] = [];
  for (const row of rows) {
    const id = hubProfileRow(row);
    if (!id) continue;
    hubs.push({
      profileId: id,
      name: text(row.name, 160),
      accounts: normalizeZernioAccounts(await request("/accounts?profileId=" + encodeURIComponent(id) + "&limit=100")),
    });
  }
  return hubs;
}

/** Reads one hub profile by the provider's own id — adoption's readback truth. */
export async function readZernioHubProfile(profileId: string): Promise<ZernioHubProfile> {
  if (!HUB_PROFILE_ID_PATTERN.test(profileId)) {
    throw new SocialProviderError("invalid_hub_profile", 400, "The hub profile identifier is invalid.");
  }
  const rows = listOf(await request("/profiles?limit=100"));
  const match = rows.find((row) => hubProfileRow(row) === profileId);
  if (!match) {
    throw new SocialProviderError("provider_profile_not_found", 404, "The Social provider profile was not found.");
  }
  return {
    profileId,
    name: text(match.name, 160),
    accounts: normalizeZernioAccounts(await request("/accounts?profileId=" + encodeURIComponent(profileId) + "&limit=100")),
  };
}

export const zernioSocialAdapter: SocialProviderAdapter = {
  key: "zernio",
  isConfigured: () => Boolean(envKey("ZERNIO_API_KEY")),
  async createProfile({ providerProfileKey }) {
    assertProfileKey(providerProfileKey);
    try {
      await request("/profiles", {
        method: "POST",
        body: JSON.stringify({ name: providerProfileKey, externalId: providerProfileKey }),
      });
      return { created: true };
    } catch (error) {
      // externalId is unique per Zernio team: a retry that lands 409 means the profile
      // already exists — idempotent success, exactly like the other provider's contract.
      if (error instanceof SocialProviderError && error.code === "provider_profile_exists") return { created: false };
      throw error;
    }
  },
  async createConnectUrl({ providerProfileKey, redirectUrl, platform, scopes }) {
    assertProfileKey(providerProfileKey);
    const requested = connectPlatform(platform);
    const callback = new URL(redirectUrl);
    if (callback.protocol !== "https:" || callback.username || callback.password) {
      throw new SocialProviderError("invalid_redirect_url", 400, "The Social return destination must be a secure URL.");
    }
    // Google REQUIRES its areas on connect (the provider 400s without them); the other
    // platforms either ignore or actively reject a scopes parameter, so it goes only to
    // Google. Absent areas default to the owner's Gmail-and-Calendar starting set.
    let areaQuery = "";
    if (requested === "google") {
      const areas = (scopes === undefined || scopes.length === 0 ? ["email", "calendar"] : scopes)
        .filter((area): area is typeof GOOGLE_CONNECT_AREAS[number] =>
          (GOOGLE_CONNECT_AREAS as readonly string[]).includes(area));
      if (!areas.length) {
        throw new SocialProviderError("invalid_connect_areas", 400, "The Google connection needs at least one area.");
      }
      areaQuery = `&scopes=${encodeURIComponent(areas.join(","))}`;
    }
    const profileId = await resolveProfileId(providerProfileKey);
    const providerPath = PROVIDER_PATH[requested] ?? requested;
    const payload = await request(
      `/connect/${encodeURIComponent(providerPath)}?profileId=${encodeURIComponent(profileId)}&redirect_url=${encodeURIComponent(callback.href)}${areaQuery}`,
    );
    const url = authorizationUrl(firstOf(payload, "authUrl") ?? firstOf(payload, "url"), requested);
    return { url, expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString() };
  },
  async readProfile({ providerProfileKey }): Promise<SocialProviderProfile> {
    assertProfileKey(providerProfileKey);
    const profileId = await resolveProfileId(providerProfileKey);
    const accounts = normalizeZernioAccounts(await request(`/accounts?profileId=${encodeURIComponent(profileId)}&limit=100`));
    return { providerProfileKey, accounts };
  },
  async deleteProfile({ providerProfileKey }) {
    assertProfileKey(providerProfileKey);
    const profileId = await resolveProfileId(providerProfileKey);
    // Zernio's revocation unit is the account: tokens are revoked and metering stops
    // per account. A profile with active accounts cannot be deleted, so accounts go
    // first; a leftover empty profile keeps no tenant access and is provider residue.
    const accounts = listOf(await request(`/accounts?profileId=${encodeURIComponent(profileId)}&limit=100`));
    for (const row of accounts) {
      const accountId = text(row._id ?? row.accountId ?? row.id ?? row.username, 200);
      if (!accountId) continue;
      try {
        await request(`/accounts/${encodeURIComponent(accountId)}`, { method: "DELETE" });
      } catch (error) {
        // Already gone at the provider — the revocation this call exists for has happened.
        if (!(error instanceof SocialProviderError && error.code === "provider_profile_not_found")) throw error;
      }
    }
    try {
      await request(`/profiles/${encodeURIComponent(profileId)}`, { method: "DELETE" });
    } catch (error) {
      if (error instanceof SocialProviderError
        && (error.code === "provider_profile_not_found" || error.status === 400)) return;
      throw error;
    }
  },
  async readPostDestination(input) {
    const requested = postPlatform(input.platform);
    const profileId = await resolveProfileId(input.providerProfileKey);
    const accounts = listOf(await request(`/accounts?profileId=${encodeURIComponent(profileId)}&limit=100`));
    const row = accounts.find((account) =>
      text(account._id ?? account.accountId ?? account.id, 200) === input.providerAccountId
      && normalizePlatform(account.platform) === requested);
    const returnedProfile = text(asRecord(row?.profileId)?._id ?? row?.profileId, 200);
    if (!row || returnedProfile !== profileId || row.isActive !== true || row.enabled === false
        || normalizeZernioAccounts([row])[0]?.status !== "connected") {
      throw new SocialProviderError("destination_unavailable", 409, "The approved account is no longer connected.");
    }
    let details = row;
    let channelId: string | null = null;
    if (requested === "discord") {
      // The generic account list proves membership in the profile. Discord's
      // dedicated settings read supplies the channel that the POST must pin.
      const settings = asRecord(await request(`/accounts/${encodeURIComponent(input.providerAccountId)}/discord-settings`));
      const discord = asRecord(settings?.account);
      channelId = text(discord?.channelId, 32);
      if (!discord || discord._id !== input.providerAccountId || discord.platform !== "discord"
          || !channelId || !/^\d{16,22}$/.test(channelId)) {
        throw new SocialProviderError("destination_unverified", 409, "The Discord channel could not be verified.");
      }
      details = discord;
    }
    const name = text(details.displayName ?? details.name, 160);
    const handle = text(details.username ?? details.handle, 100);
    const channelName = text(details.channelName, 100);
    const identity = [...new Set([name, channelName, handle].filter(Boolean))].join(" · ");
    if (!identity) {
      throw new SocialProviderError("destination_unverified", 409, "The destination name could not be verified.");
    }
    return { channelId, label: identity };
  },
  async createPost(input) {
    assertProfileKey(input.providerProfileKey);
    const requested = postPlatform(input.platform);
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input.externalId)) {
      throw new SocialProviderError("invalid_publication_id", 400, "The publication identifier is invalid.");
    }
    if (!input.providerAccountId || (requested === "discord" && !input.channelId)) {
      throw new SocialProviderError("destination_unverified", 400, "The exact publishing destination is missing.");
    }
    // Telegram interprets HTML by default. Escape the approved plain text for literal delivery.
    const content = requested === "telegram"
      ? input.text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      : input.text;
    const platformSpecificData = requested === "discord" ? { channelId: input.channelId }
      : requested === "telegram" ? { parseMode: "HTML" } : undefined;
    try {
      const payload = await request("/posts", {
        method: "POST",
        headers: { "Idempotency-Key": input.externalId },
        body: JSON.stringify({
          content,
          platforms: [{ platform: PROVIDER_PATH[requested] ?? requested, accountId: input.providerAccountId, platformSpecificData }],
          publishNow: true,
          metadata: { [PUBLICATION_METADATA_KEY]: input.externalId },
        }),
      });
      return postOutcome(payload, input);
    } catch (error) {
      if (error instanceof SocialProviderError
          && (POST_REJECTED_BEFORE_DISPATCH.has(error.status) || error.code === "provider_duplicate_content")) throw error;
      // Conflicts, 5xx, malformed responses and transport errors may follow a real dispatch.
      return { kind: "unknown", requestId: null, reason: "provider_dispatch_unconfirmed" };
    }
  },
  async readPost(input, providerPostId) {
    let id = providerPostId;
    if (!id) {
      const profileId = await resolveProfileId(input.providerProfileKey);
      const query = new URLSearchParams({
        profileId, accountId: input.providerAccountId, limit: "25", fields: "metadata",
      });
      for (let page = 0; page < 3; page += 1) {
        const listed = await request(`/posts?${query}`);
        const candidates = listOf(listed).filter((post) =>
          asRecord(post.metadata)?.[PUBLICATION_METADATA_KEY] === input.externalId);
        if (candidates.length) {
          id = candidates.length === 1 ? text(candidates[0]._id, 128) : null;
          break;
        }
        const cursor = text(asRecord(asRecord(listed)?.pagination)?.nextCursor, 2048);
        if (!cursor || cursor === query.get("cursor")) break;
        query.set("cursor", cursor);
      }
    }
    if (!id) return { kind: "unknown", requestId: null, reason: "provider_attempt_not_found" };
    return postOutcome(await request(`/posts/${encodeURIComponent(id)}`), input, id);
  },
};
