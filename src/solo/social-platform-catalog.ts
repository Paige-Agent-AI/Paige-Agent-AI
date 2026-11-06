export type SocialPlatformKey =
  | "tiktok" | "instagram" | "facebook" | "linkedin" | "youtube" | "x"
  | "threads" | "pinterest" | "google_business" | "snapchat" | "reddit";

export type SocialPlatformDefinition = {
  key: SocialPlatformKey;
  name: string;
  mark: string;
  oauthAvailable: boolean;
  connectionNote: string;
};

/**
 * The platform shape the connection DRAWERS read — structural, not catalogue
 * membership: social definitions (narrower literal key) widen into it, and the
 * provider's connection apps below fit without claiming to be social entries.
 */
export type SocialDrawerPlatform = {
  key: string;
  name: string;
  mark: string;
  oauthAvailable: boolean;
  connectionNote: string;
};

/** The section of the Integrations page a connection app renders under. */
export type SocialConnectionAppGroup = "collaboration" | "messaging" | "email-calendar";

/**
 * The provider's connection apps beyond Social (owner 2026-11-06: every account
 * connects what the platform account connects — "same fixed options"). ONE shared
 * definition serves BOTH the Solo page and the Platform Operator page, so the two
 * surfaces can never drift. Slugs and flows are docs-verified: google = one OAuth
 * covering areas (email/calendar to start), discord = OAuth bot install,
 * telegram = access code. `logoId` names the shared mark registry entry when one
 * exists; otherwise the surfaces render a brand-ground monogram (brandHex + mark).
 */
export type SocialConnectionApp = {
  key: string;
  name: string;
  kind: string;
  group: SocialConnectionAppGroup;
  logoId: string | null;
  brandHex: string;
  mark: string;
  oauthAvailable: boolean;
  connectionNote: string;
};

export const SOCIAL_CONNECTION_APPS: ReadonlyArray<SocialConnectionApp> = [
  { key: "google", name: "Google", kind: "Gmail, Calendar and more", group: "email-calendar",
    logoId: "google", brandHex: "#4285F4", mark: "G", oauthAvailable: true,
    connectionNote: "One Google sign-in covers Gmail and Google Calendar. The remaining Google areas — Drive files and Contacts — arrive in a later update." },
  { key: "discord", name: "Discord", kind: "Community chat", group: "collaboration",
    logoId: null, brandHex: "#5865F2", mark: "D", oauthAvailable: true,
    connectionNote: "The provider's bot joins your server through Discord's own consent — no app of ours to create. Server and channel selection happen at Discord." },
  { key: "telegram", name: "Telegram", kind: "Channel messaging", group: "messaging",
    logoId: null, brandHex: "#26A5E4", mark: "T", oauthAvailable: true,
    connectionNote: "Telegram connects with an access code, not a sign-in redirect: add the provider's bot as an administrator of your channel, then send it the code the link shows you. The card updates once the connection verifies." },
];

/** Connection apps reuse the Social drawer's machinery; this shim gives the drawer
 *  the platform shape it reads. */
export const connectionAppAsPlatform = (app: SocialConnectionApp): SocialDrawerPlatform =>
  ({ key: app.key, name: app.name, mark: app.mark, oauthAvailable: app.oauthAvailable, connectionNote: app.connectionNote });

/** Customer-visible catalogue grounded in the provider's Connect API. */
export const SOCIAL_PLATFORMS: ReadonlyArray<SocialPlatformDefinition> = [
  { key: "instagram", name: "Instagram", mark: "IG", oauthAvailable: true, connectionNote: "Business or Creator account required." },
  { key: "facebook", name: "Facebook", mark: "f", oauthAvailable: true, connectionNote: "Publishing targets an authorized Page, not a personal profile." },
  { key: "x", name: "X", mark: "X", oauthAvailable: true, connectionNote: "Account permissions are confirmed after connection." },
  { key: "tiktok", name: "TikTok", mark: "TT", oauthAvailable: true, connectionNote: "Available actions depend on the scopes granted by this account." },
  { key: "youtube", name: "YouTube", mark: "YT", oauthAvailable: true, connectionNote: "Connect the Google identity that owns the intended channel." },
  { key: "linkedin", name: "LinkedIn", mark: "in", oauthAvailable: true, connectionNote: "Profile and organization targets are resolved after connection." },
  { key: "threads", name: "Threads", mark: "Th", oauthAvailable: true, connectionNote: "Account permissions are confirmed after connection." },
  { key: "pinterest", name: "Pinterest", mark: "P", oauthAvailable: true, connectionNote: "Boards are selected only after provider discovery." },
  { key: "google_business", name: "Google Business Profile", mark: "G", oauthAvailable: true, connectionNote: "Locations are selected only after provider discovery." },
  { key: "snapchat", name: "Snapchat", mark: "S", oauthAvailable: true, connectionNote: "Connection currently proves basic profile access only; publishing is unavailable." },
  { key: "reddit", name: "Reddit", mark: "R", oauthAvailable: false, connectionNote: "OAuth is temporarily unavailable from the provider." },
] as const;

export function socialPlatform(key: string | null | undefined) {
  return SOCIAL_PLATFORMS.find((platform) => platform.key === key) ?? null;
}
