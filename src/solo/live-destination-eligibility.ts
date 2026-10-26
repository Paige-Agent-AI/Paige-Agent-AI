/**
 * Live-destination eligibility — EXP10's broadcast-support slice (owner directive
 * 2026-10-25; checkpoint reply §4): the honest per-platform answer to "can a broadcast
 * go live on this destination?" kept strictly SEPARATE from connection state.
 *
 * THE CARDINAL RULE (the owner's own words): a connected social account does NOT
 * automatically authorize live broadcasting. Connection (OAuth done) and eligibility
 * (the platform's live API reachable with permissions we hold) are different facts, so
 * they are different fields here — never derived from one another.
 *
 * GROUNDING: each row names the platform's live mechanism, the permissions REQUIRED
 * BEYOND the connection's current OAuth scopes, and the honest state. States:
 *   - "supported"     — a real API path exists; PAIGE must still hold the named
 *                        permissions and prove a live proof before any Live claim.
 *   - "restricted"    — the API exists but is approval/partner-gated per account.
 *   - "unavailable"   — no applicable live API exists for our shape.
 *   - "proof_owed"    — a path is plausible but PAIGE has not verified it end-to-end.
 * Every "supported" row is still PROOF_OWED at the EXPERIENCE level until a real
 * broadcast proof lands (EXP07's acceptance matrix owns that proof).
 *
 * Vimeo and PAIGE-hosted playback are PLAYBACK requirements (owner-confirmed), NOT
 * broadcast destinations — they appear in PLAYBACK_SUPPORT, not in the live table.
 * Embedding a video is distinct from connecting an account or broadcasting to it.
 */

export type LiveEligibilityState = "supported" | "restricted" | "unavailable" | "proof_owed";

export type LiveDestinationEligibility = {
  platform: string;
  state: LiveEligibilityState;
  /** The platform's actual live mechanism, named for traceability. */
  mechanism: string;
  /** Permissions REQUIRED BEYOND the connection's current OAuth scopes. */
  additionalRequirements: string[];
  /** The honest customer-facing sentence. Never implies live ability from connection. */
  note: string;
};

export const LIVE_DESTINATION_ELIGIBILITY: ReadonlyArray<LiveDestinationEligibility> = [
  {
    platform: "facebook",
    state: "proof_owed",
    mechanism: "Facebook Live Video API (RTMP ingest on a Page)",
    additionalRequirements: [
      "publish_video permission + Live Video API access on the app",
      "The broadcast targets an authorized Page the connection already manages",
    ],
    note: "Facebook Pages accept live video through their API once the connection's app holds live permission. That permission is not part of the current connection — live eligibility is proven after the app-level grant, never from the connection alone.",
  },
  {
    platform: "youtube",
    state: "proof_owed",
    mechanism: "YouTube Live Streaming API (Data API v3 broadcasts.insert + RTMP ingest)",
    additionalRequirements: [
      "youtube.force-ssl (or the full youtube) OAuth grant — the current upload scope cannot call the Live Streaming API",
      "The channel must be live-enabled by YouTube (no recent strikes; >24h age for new API keys)",
    ],
    note: "YouTube has a complete live API, but it needs a live-capable grant such as youtube.force-ssl — a deliberate additional authorization on top of the connected account — plus a channel YouTube itself has enabled for live.",
  },
  {
    platform: "twitch",
    state: "proof_owed",
    mechanism: "Custom RTMP ingest to the channel's stream key",
    additionalRequirements: [
      "The channel's stream key (a Twitch credential, separate from any PAIGE connection)",
    ],
    note: "Twitch accepts any RTMP feed with the channel's stream key. PAIGE does not currently connect Twitch accounts, so the key would be provided per broadcast and stored vaulted per session.",
  },
  {
    platform: "linkedin",
    state: "restricted",
    mechanism: "LinkedIn Live Video API",
    additionalRequirements: [
      "LinkedIn-approved live access (application review; organization-level)",
    ],
    note: "LinkedIn's live API requires per-application approval from LinkedIn. Until that review is granted, no connected LinkedIn account can go live through PAIGE.",
  },
  {
    platform: "tiktok",
    state: "restricted",
    mechanism: "TikTok LIVE (Live Membership / partner program)",
    additionalRequirements: [
      "Partner-program access granted by TikTok",
    ],
    note: "TikTok's live API is restricted to approved partners. A connected TikTok account cannot broadcast through PAIGE today.",
  },
  {
    platform: "instagram",
    state: "restricted",
    mechanism: "Instagram Live via the Graph API",
    additionalRequirements: [
      "Business-partner access granted by Meta for Instagram live publishing",
    ],
    note: "Instagram live publishing through the API is business-partner gated. A connected Instagram account cannot broadcast through PAIGE today.",
  },
] as const;

export type PlaybackSupport = {
  surface: string;
  state: LiveEligibilityState;
  note: string;
};

/** PLAYBACK is not broadcasting: these are where an approved stream or recording can be
 *  WATCHED. Embedding (EXP06) consumes the same authorized stream. */
export const PLAYBACK_SUPPORT: ReadonlyArray<PlaybackSupport> = [
  {
    surface: "PAIGE-hosted player",
    state: "proof_owed",
    note: "Cloudflare Stream's signed/player delivery inside PAIGE surfaces. Backend API access is verified (bounded, test video); customer playback proof lands with EXP07's first end-to-end broadcast.",
  },
  {
    surface: "Customer website / page embed (EXP06)",
    state: "proof_owed",
    note: "The same authorized stream embedded on an owner site with audience access enforced. Distinct from connecting an account or broadcasting anywhere.",
  },
  {
    surface: "YouTube playback (owner-confirmed requirement)",
    state: "proof_owed",
    note: "Watching on YouTube is a DESTINATION outcome (the broadcast row above) — listed here for completeness because the owner named YouTube playback explicitly: watching, embedding and broadcasting are three different authorizations.",
  },
  {
    surface: "Vimeo playback (owner-confirmed requirement)",
    state: "proof_owed",
    note: "Vimeo is a PLAYBACK surface requirement, not a Stream simulcast destination. Serving approved recordings through Vimeo would need its own provider assessment and connection — deliberately not started here.",
  },
] as const;

export function liveEligibility(platform: string | null | undefined): LiveDestinationEligibility | null {
  return LIVE_DESTINATION_ELIGIBILITY.find(row => row.platform === platform) ?? null;
}
