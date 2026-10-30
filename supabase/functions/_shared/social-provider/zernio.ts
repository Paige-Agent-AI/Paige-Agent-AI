/**
 * Zernio adapter — the Social connection provider Paige selected on 2026-10-29
 * (owner decision; API key vaulted by the owner as ZERNIO_API_KEY in Edge Secrets).
 *
 * It satisfies the same SocialProviderAdapter contract the Social doors were built
 * against, so paige-social and paige-social-callback select whichever provider is
 * configured. Tenant identity stays the opaque provider profile key
 * (ps_<hmac>) minted by the doors — Zernio knows it only as the profile's
 * externalId, never as a Paige tenant or customer id.
 *
 * Zernio's documented completion signal is readback (GET /accounts), not redirect
 * parameters: the callback therefore verifies Zernio rows by reading the profile
 * back and requiring the requested platform's account to be present.
 *
 * Publishing does not exist here yet — createPost always refuses. The publishing
 * arm ships as its own governed slice after connections are proven live.
 */
import { envKey } from "../env-key.ts";
import { NeedsConfigError } from "../provider-types.ts";
import { safeFetch } from "../ssrfGuard.ts";
import { SOCIAL_OAUTH_PLATFORMS } from "./mod.ts";
import {
  SocialProviderError,
  type SocialProviderAccount,
  type SocialProviderAdapter,
  type SocialProviderProfile,
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

function connectPlatform(value: string): typeof SOCIAL_OAUTH_PLATFORMS[number] {
  if (!SOCIAL_OAUTH_PLATFORMS.includes(value as typeof SOCIAL_OAUTH_PLATFORMS[number])) {
    throw new SocialProviderError("unsupported_oauth_platform", 400, "This Social OAuth platform is unavailable.");
  }
  return value as typeof SOCIAL_OAUTH_PLATFORMS[number];
}

const hostnameMatches = (hostname: string, expected: string) =>
  hostname === expected || hostname.endsWith(`.${expected}`);

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
    try {
      const body = response.body ? JSON.parse(response.body) as Record<string, unknown> : {};
      const raw = body.error_code ?? body.code;
      providerCode = typeof raw === "string" ? raw.toUpperCase() : "";
    } catch { providerCode = ""; }
    const code = providerCode === "PROFILE_LIMIT_REACHED" || providerCode === "PROFILE_BLOCKED"
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

function safeImage(value: unknown): string | null {
  const candidate = text(value, 2048);
  if (!candidate) return null;
  try {
    const url = new URL(candidate);
    return url.protocol === "https:" && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}

/** Zernio answers lists as bare arrays or wrapped ({data:[…]}, {profiles:[…]}, {accounts:[…]}). */
function listOf(payload: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(payload)) return payload.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item));
  if (payload && typeof payload === "object") {
    const root = payload as Record<string, unknown>;
    for (const wrapper of ["data", "profiles", "accounts", "items"]) {
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
      avatarUrl: safeImage(row.avatarUrl ?? row.avatar ?? row.social_images),
      status: needsReauth ? "needs_reauth" : "connected",
      capabilities: stringList(row.capabilities ?? row.permissions),
    });
  }
  return accounts;
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
  async createConnectUrl({ providerProfileKey, redirectUrl, platform }) {
    assertProfileKey(providerProfileKey);
    const requested = connectPlatform(platform);
    const callback = new URL(redirectUrl);
    if (callback.protocol !== "https:" || callback.username || callback.password) {
      throw new SocialProviderError("invalid_redirect_url", 400, "The Social return destination must be a secure URL.");
    }
    const profileId = await resolveProfileId(providerProfileKey);
    const providerPath = requested === "google_business" ? "google-business" : requested;
    const payload = await request(
      `/connect/${encodeURIComponent(providerPath)}?profileId=${encodeURIComponent(profileId)}&redirect_url=${encodeURIComponent(callback.href)}`,
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
  async createPost(): Promise<never> {
    // Publishing is its own governed slice; this arm refuses until that slice ships.
    throw new SocialProviderError("provider_publishing_unavailable", 501, "Social publishing is not enabled for this provider yet.");
  },
};
