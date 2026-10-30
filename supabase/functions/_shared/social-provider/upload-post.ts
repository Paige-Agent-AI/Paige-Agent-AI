/**
 * Internal adapter for Paige's initial Social connection provider.
 * The platform key authenticates Paige's server only. Tenant identity is the
 * opaque provider profile key persisted by the canonical Social connection row.
 */
import { envKey } from "../env-key.ts";
import { NeedsConfigError } from "../provider-types.ts";
import type { SocialProviderPostOutcome, SocialProviderPostResult } from "./mod.ts";
import { safeFetch } from "../ssrfGuard.ts";
import {
  SOCIAL_OAUTH_PLATFORMS,
  SocialProviderError,
  type SocialProviderAccount,
  type SocialProviderAdapter,
  type SocialProviderProfile,
} from "./mod.ts";

const DEFAULT_API_BASE = "https://api.upload-post.com/api/uploadposts";
const PROFILE_KEY_PATTERN = /^ps_[a-f0-9]{40}$/;
export { SOCIAL_OAUTH_PLATFORMS };

const AUTHORIZATION_HOSTS: Readonly<Record<string, readonly string[]>> = {
  tiktok: ["tiktok.com"], instagram: ["instagram.com", "facebook.com"],
  facebook: ["facebook.com"], linkedin: ["linkedin.com"], youtube: ["google.com"],
  x: ["x.com", "twitter.com"], threads: ["threads.net", "facebook.com"],
  pinterest: ["pinterest.com"], google_business: ["google.com"],
  snapchat: ["snapchat.com"], internal_bounce: ["upload-post.com"],
};

function env(name: string): string | undefined {
  const deno = (globalThis as { Deno?: { env?: { get(key: string): string | undefined } } }).Deno;
  return deno?.env?.get(name);
}

function providerKey(): string {
  const key = envKey("UPLOAD_POST_API_KEY");
  if (!key) throw new NeedsConfigError("social");
  return key;
}

function apiBase(): string {
  return (env("UPLOAD_POST_API_BASE_URL") ?? DEFAULT_API_BASE).replace(/\/$/, "");
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
      Authorization: `Apikey ${providerKey()}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  }, { timeoutMs: 15_000, maxBytes: 262_144 });
  if (response.status < 200 || response.status >= 300) {
    let providerCode = "";
    try {
      const body = response.body ? JSON.parse(response.body) as Record<string, unknown> : {};
      providerCode = typeof body.error_code === "string" ? body.error_code.toUpperCase() : "";
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
  } catch {
    return null;
  }
}

export async function buildSocialProfileKey(tenantId: string, connectionId: string, signingSecret: string): Promise<string> {
  const bytes = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", bytes.encode(signingSecret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", key, bytes.encode(`${tenantId}:${connectionId}`)));
  return `ps_${Array.from(signature.slice(0, 20), (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

export function normalizeSocialProfile(payload: unknown): SocialProviderProfile {
  const root = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
  const rawProfile = root.profile && typeof root.profile === "object"
    ? root.profile as Record<string, unknown>
    : Array.isArray(root.profiles) && root.profiles[0] && typeof root.profiles[0] === "object"
      ? root.profiles[0] as Record<string, unknown>
      : null;
  const providerProfileKey = text(rawProfile?.username);
  if (!rawProfile || !providerProfileKey || !PROFILE_KEY_PATTERN.test(providerProfileKey)) {
    throw new SocialProviderError("invalid_profile_readback", 502, "Social profile readback could not be verified.");
  }
  const socialAccounts = rawProfile.social_accounts && typeof rawProfile.social_accounts === "object"
    ? rawProfile.social_accounts as Record<string, unknown>
    : {};
  const accounts: SocialProviderAccount[] = [];
  for (const [rawPlatform, rawAccount] of Object.entries(socialAccounts)) {
    if (!rawAccount || typeof rawAccount !== "object" || Array.isArray(rawAccount)) continue;
    const account = rawAccount as Record<string, unknown>;
    const providerAccountId = text(account.username);
    if (!providerAccountId) {
      throw new SocialProviderError("invalid_account_readback", 502, "Provider readback did not include a stable account identifier.");
    }
    const platform = rawPlatform.trim().toLowerCase().replace(/[^a-z0-9_]/g, "_");
    if (!/^[a-z][a-z0-9_]{1,31}$/.test(platform)) continue;
    accounts.push({
      platform,
      providerAccountId,
      handle: text(account.handle, 160),
      displayName: text(account.display_name, 200),
      avatarUrl: safeImage(account.social_images),
      status: account.reauth_required === true ? "needs_reauth" : "connected",
      capabilities: stringList(account.capabilities),
    });
  }
  return { providerProfileKey, accounts };
}

/** The content endpoints (/upload_text…) live at the API ROOT; the profile endpoints
 * (/users…) live under /uploadposts. The OpenAPI server is https://api.upload-post.com/api. */
async function requestRoot(path: string, init: RequestInit = {}): Promise<unknown> {
  return request(path.replace(/^\//, "../"), init);
}

function postResult(platform: string, raw: Record<string, unknown>): SocialProviderPostResult {
  const id = typeof raw.post_id === "string" && raw.post_id.trim() ? raw.post_id.trim() : null;
  const publishId = typeof raw.publish_id === "string" && raw.publish_id.trim() ? raw.publish_id.trim() : null;
  const url = typeof raw.url === "string" && /^https:\/\//.test(raw.url.trim()) ? raw.url.trim() : null;
  return {
    platform,
    success: raw.success === true,
    postId: id ?? publishId,
    postUrl: url,
    error: typeof raw.error === "string" && raw.error.trim() ? raw.error.trim().slice(0, 300) : null,
  };
}

export const uploadPostSocialAdapter: SocialProviderAdapter = {
  key: "upload_post",
  isConfigured: () => Boolean(envKey("UPLOAD_POST_API_KEY")),
  async createProfile({ providerProfileKey }) {
    assertProfileKey(providerProfileKey);
    try {
      await request("/users", { method: "POST", body: JSON.stringify({ username: providerProfileKey }) });
      return { created: true };
    } catch (error) {
      if (error instanceof SocialProviderError && error.code === "provider_profile_exists") return { created: false };
      throw error;
    }
  },
  async createConnectUrl({ providerProfileKey, redirectUrl, platform }) {
    assertProfileKey(providerProfileKey);
    const requested = connectPlatform(platform);
    const providerPath = requested === "google_business" ? "google-business" : requested;
    const payload = await request(`/oauth/${providerPath}/start`, {
      method: "POST",
      body: JSON.stringify({
        profile: providerProfileKey,
        redirect_url: redirectUrl,
      }),
    }) as Record<string, unknown>;
    const url = text(payload.authorize_url, 4096);
    let authorization: URL | null = null;
    try { authorization = url ? new URL(url) : null; } catch { authorization = null; }
    const expectedHosts = [...(AUTHORIZATION_HOSTS[requested] ?? []), ...AUTHORIZATION_HOSTS.internal_bounce];
    if (!authorization || authorization.protocol !== "https:" || authorization.username || authorization.password
        || !expectedHosts.some((host) => hostnameMatches(authorization!.hostname, host))) {
      throw new SocialProviderError("invalid_authorization_url", 502, "The Social provider did not return a secure authorization URL.");
    }
    const expiresIn = typeof payload.expires_in === "number" && payload.expires_in > 0 && payload.expires_in <= 900
      ? payload.expires_in : 900;
    return { url: authorization.href, expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString() };
  },
  async readProfile({ providerProfileKey }) {
    assertProfileKey(providerProfileKey);
    return normalizeSocialProfile(await request(`/users/${encodeURIComponent(providerProfileKey)}`));
  },
  async deleteProfile({ providerProfileKey }) {
    assertProfileKey(providerProfileKey);
    await request("/users", { method: "DELETE", body: JSON.stringify({ username: providerProfileKey }) });
  },
  async createPost({ providerProfileKey, platform, text, externalId }): Promise<SocialProviderPostOutcome> {
    assertProfileKey(providerProfileKey);
    const requested = connectPlatform(platform);
    try {
      const payload = await requestRoot("/upload_text", {
        method: "POST",
        body: JSON.stringify({
          user: providerProfileKey,
          platform: [requested],
          title: text,
          // external_id maps the provider's job back to our publication row — the reconciliation key.
          external_id: externalId,
          // Synchronous: we want the provider's per-platform result IN this answer. An async
          // accept comes back as { request_id } and is treated as processing/unknown below.
          async_upload: false,
        }),
      }) as Record<string, unknown>;
      if (typeof payload.request_id === "string" && payload.request_id.trim()) {
        return { kind: "processing", requestId: payload.request_id.trim().slice(0, 128) };
      }
      const results = payload.results;
      if (!results || typeof results !== "object" || Array.isArray(results)) {
        // A 2xx with no per-platform result and no request_id proves nothing either way.
        return { kind: "unknown", requestId: null, reason: "provider_answered_without_results" };
      }
      const perPlatform = Object.entries(results as Record<string, unknown>)
        .filter(([, v]) => v && typeof v === "object")
        .map(([key, v]) => postResult(key, v as Record<string, unknown>));
      if (perPlatform.length === 0) return { kind: "unknown", requestId: null, reason: "provider_answered_without_results" };
      return { kind: "published", results: perPlatform };
    } catch (error) {
      if (error instanceof SocialProviderError) throw error;
      // A transport failure AFTER the request was sent is an unknown outcome, never a failure:
      // the provider may have created the post. safeFetch aborts/throws land here.
      return { kind: "unknown", requestId: null, reason: error instanceof Error ? error.name : "transport_uncertain" };
    }
  },
};
