/** Internal provider-neutral Social connection seam. Provider names never become customer copy. */
export type SocialConnectionStatus = "connected" | "needs_reauth";

/** The OAuth platforms every Social provider adapter must support — the customer catalogue
 *  (src/solo/social-platform-catalog.ts) is grounded in this list. Reddit is deliberately
 *  absent while providers report its OAuth path as unavailable. */
export const SOCIAL_OAUTH_PLATFORMS = [
  "tiktok", "instagram", "facebook", "linkedin", "youtube", "x", "threads",
  "pinterest", "google_business", "snapchat",
] as const;

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
  | { kind: "published"; results: SocialProviderPostResult[] }
  /** The provider accepted the post for background processing and named it — the outcome is
   *  UNKNOWN until its status is reconciled; the requestId is the reconciliation handle. */
  | { kind: "processing"; requestId: string }
  /** The transport itself was uncertain (network failure after send, or an unusable answer).
   *  The post MAY exist; nothing here may be reported as either success or failure. */
  | { kind: "unknown"; requestId: string | null; reason: string };

export interface SocialProviderAdapter {
  readonly key: string;
  isConfigured(): boolean;
  createProfile(input: { providerProfileKey: string }): Promise<{ created: boolean }>;
  createConnectUrl(input: {
    providerProfileKey: string;
    redirectUrl: string;
    platform: string;
  }): Promise<{ url: string; expiresAt: string }>;
  readProfile(input: { providerProfileKey: string }): Promise<SocialProviderProfile>;
  deleteProfile(input: { providerProfileKey: string }): Promise<void>;
  /** Publish one text post to one platform under one provider profile. Never schedules, queues,
   *  or fans out — the door publishes exactly what one approval claimed, now. */
  createPost(input: {
    providerProfileKey: string;
    platform: string;
    text: string;
    externalId: string;
  }): Promise<SocialProviderPostOutcome>;
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
