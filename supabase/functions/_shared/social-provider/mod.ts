/** Internal provider-neutral Social connection seam. Provider names never become customer copy. */
export type SocialConnectionStatus = "connected" | "needs_reauth";

/** The OAuth platforms every Social provider adapter must support — the customer catalogue
 *  (src/solo/social-platform-catalog.ts) is grounded in this list. Reddit is deliberately
 *  absent while providers report its OAuth path as unavailable. */
export const SOCIAL_OAUTH_PLATFORMS = [
  "tiktok", "instagram", "facebook", "linkedin", "youtube", "x", "threads",
  "pinterest", "google_business", "snapchat",
] as const;

/**
 * The platforms a workspace may CONNECT through the Social door — the OAuth list
 * plus the connection apps the provider exposes behind the same profile flow
 * (owner ruling 2026-11-05: the Platform Operator connects Gmail/Calendar,
 * Discord and Telegram here; docs-verified slugs and readback values).
 * Connection and publishing have separate allowlists.
 */
export const SOCIAL_CONNECTION_PLATFORMS = [
  ...SOCIAL_OAUTH_PLATFORMS,
  "google", "discord", "telegram",
] as const;

/**
 * The platforms a piece may be PUBLISHED to — the social set plus the provider's
 * documented messaging post targets (owner 2026-11-06: the Discord and Telegram
 * channels the platform and Solo accounts connect become usable for content).
 * Google is deliberately absent: Gmail/Calendar are connections, not post targets.
 */
export const SOCIAL_POST_PLATFORMS = [
  ...SOCIAL_OAUTH_PLATFORMS,
  "discord", "telegram",
] as const;
export type SocialConnectionPlatform = (typeof SOCIAL_CONNECTION_PLATFORMS)[number];

/** The areas a Google connect may request — the provider's own closed set
 *  (docs: scopes REQUIRED for google, subset of email/calendar/files/contacts). */
export const GOOGLE_CONNECT_AREAS = ["email", "calendar", "files", "contacts"] as const;

export interface SocialProviderAccount {
  platform: string;
  providerAccountId: string;
  handle: string | null;
  displayName: string | null;
  avatarUrl: string | null;
  status: SocialConnectionStatus;
  capabilities: string[];
}

export interface SocialProviderProfile {
  providerProfileKey: string;
  accounts: SocialProviderAccount[];
}

/** What one platform's publish attempt proved — the provider's own identifiers, verbatim. */
export interface SocialProviderPostResult {
  platform: string;
  success: boolean;
  postId: string | null;
  postUrl: string | null;
  error: string | null;
}

/** The provider's answer to one createPost call. */
export type SocialProviderPostOutcome =
  | { kind: "published"; results: SocialProviderPostResult[]; requestId?: string }
  /** The provider accepted the post for background processing and named it — the outcome is
   *  UNKNOWN until its status is reconciled; the requestId is the reconciliation handle. */
  | { kind: "processing"; requestId: string }
  /** The transport itself was uncertain (network failure after send, or an unusable answer).
   *  The post MAY exist; nothing here may be reported as either success or failure. */
  | { kind: "unknown"; requestId: string | null; reason: string };

export interface SocialPostAccount {
  providerProfileKey: string;
  platform: string;
  providerAccountId: string;
}

export interface SocialPostDestination {
  channelId: string | null;
  label: string;
}

export interface SocialPostInput extends SocialPostAccount {
  channelId: string | null;
  text: string;
  externalId: string;
}

export interface SocialProviderAdapter {
  readonly key: string;
  isConfigured(): boolean;
  createProfile(input: { providerProfileKey: string }): Promise<{ created: boolean }>;
  createConnectUrl(input: {
    providerProfileKey: string;
    redirectUrl: string;
    platform: string;
    /** Google requires its connect areas; other platforms ignore this (some reject scopes). */
    scopes?: readonly string[];
  }): Promise<{ url: string; expiresAt: string }>;
  readProfile(input: { providerProfileKey: string }): Promise<SocialProviderProfile>;
  deleteProfile(input: { providerProfileKey: string }): Promise<void>;
  readPostDestination(input: SocialPostAccount): Promise<SocialPostDestination>;
  /** One immediate text post to the approved account and channel. */
  createPost(input: SocialPostInput): Promise<SocialProviderPostOutcome>;
  /** Read the original provider attempt without dispatching another post. */
  readPost(input: SocialPostInput, providerPostId: string | null): Promise<SocialProviderPostOutcome>;
}

export class SocialProviderError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "SocialProviderError";
  }
}

// ── The provider-neutral plumbing every adapter's doors share ────────────────────────────────────
// Moved from the retired Upload-Post adapter (owner directive ANT-164 3f511055 + Nov 3 green
// light: Zernio is the sole social aggregator; the Upload-Post adapter is removed). These helpers
// were never Upload-Post's — the opaque ps_<hmac> profile key and the readback shape are the
// SEAM's contract, so their one home is here, beside the interface they serve.

const SOCIAL_PROFILE_KEY_PATTERN = /^ps_[a-f0-9]{40}$/;

function socialText(value: unknown, max = 240): string | null {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, max) : null;
}

function socialStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value
    .filter((item): item is string => typeof item === "string" && /^[a-z][a-z0-9_.:-]{0,79}$/.test(item.trim()))
    .map((item) => item.trim()))].slice(0, 64);
}

function socialSafeImage(value: unknown): string | null {
  const candidate = socialText(value, 2048);
  if (!candidate) return null;
  try {
    const url = new URL(candidate);
    return url.protocol === "https:" && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}

/** The opaque, tenant-scoped provider profile key (ps_<hmac>) the doors mint per connection.
 *  The provider knows it only as the profile's external id — never as a Paige tenant/customer id. */
export async function buildSocialProfileKey(tenantId: string, connectionId: string, signingSecret: string): Promise<string> {
  const bytes = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", bytes.encode(signingSecret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", key, bytes.encode(`${tenantId}:${connectionId}`)));
  return `ps_${Array.from(signature.slice(0, 20), (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

/** Normalize a provider profile readback into the seam's safe shape. Throws SocialProviderError
 *  when the readback cannot be verified — the doors treat that as a failed verification, never a
 *  guessed profile. */
export function normalizeSocialProfile(payload: unknown): SocialProviderProfile {
  const root = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
  const rawProfile = root.profile && typeof root.profile === "object"
    ? root.profile as Record<string, unknown>
    : Array.isArray(root.profiles) && root.profiles[0] && typeof root.profiles[0] === "object"
      ? root.profiles[0] as Record<string, unknown>
      : null;
  const providerProfileKey = socialText(rawProfile?.username);
  if (!rawProfile || !providerProfileKey || !SOCIAL_PROFILE_KEY_PATTERN.test(providerProfileKey)) {
    throw new SocialProviderError("invalid_profile_readback", 502, "Social profile readback could not be verified.");
  }
  const socialAccounts = rawProfile.social_accounts && typeof rawProfile.social_accounts === "object"
    ? rawProfile.social_accounts as Record<string, unknown>
    : {};
  const accounts: SocialProviderAccount[] = [];
  for (const [rawPlatform, rawAccount] of Object.entries(socialAccounts)) {
    if (!rawAccount || typeof rawAccount !== "object" || Array.isArray(rawAccount)) continue;
    const account = rawAccount as Record<string, unknown>;
    const providerAccountId = socialText(account.username);
    if (!providerAccountId) {
      throw new SocialProviderError("invalid_account_readback", 502, "Provider readback did not include a stable account identifier.");
    }
    const platform = rawPlatform.trim().toLowerCase().replace(/[^a-z0-9_]/g, "_");
    if (!/^[a-z][a-z0-9_]{1,31}$/.test(platform)) continue;
    accounts.push({
      platform,
      providerAccountId,
      handle: socialText(account.handle, 160),
      displayName: socialText(account.display_name, 200),
      avatarUrl: socialSafeImage(account.social_images),
      status: account.reauth_required === true ? "needs_reauth" : "connected",
      capabilities: socialStringList(account.capabilities),
    });
  }
  return { providerProfileKey, accounts };
}
