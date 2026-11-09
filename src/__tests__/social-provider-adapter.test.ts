// @vitest-environment node
// The Social SEAM's provider-neutral plumbing (moved from the retired Upload-Post adapter —
// ANT-164 3f511055 + Nov 3 2026 green light: Zernio sole aggregator). The sole provider's own
// wire contract (dormancy, profile lifecycle, connect-URL security, readback mapping, publishing
// refusal) is pinned by zernio-social-provider.test.ts; this file pins what is NOT any one
// provider's: the opaque profile identity and the safe readback shape every adapter returns INTO.
import { describe, expect, it } from "vitest";
import {
  buildSocialProfileKey,
  normalizeSocialProfile,
} from "../../supabase/functions/_shared/social-provider/mod.ts";

describe("Social provider profile identity", () => {
  it("derives an opaque stable provider key without exposing tenant or connection ids", async () => {
    const key = await buildSocialProfileKey(
      "00000000-0000-4000-8000-000000000011",
      "00000000-0000-4000-8000-000000000022",
      "test-signing-secret",
    );
    expect(key).toMatch(/^ps_[a-f0-9]{40}$/);
    expect(key).not.toContain("00000000");
  });
});

describe("Social provider readback", () => {
  it("keeps only provider-confirmed accounts and preserves open capability lists", () => {
    const profile = normalizeSocialProfile({
      success: true,
      profile: {
        username: "ps_0123456789abcdef0123456789abcdef01234567",
        social_accounts: {
          instagram: null,
          tiktok: {
            username: "acct_01HZZZZZZZZZZZZZZZZZZZZZZZ",
            handle: "@example",
            display_name: "Example account",
            social_images: "https://cdn.example/avatar.png",
            capabilities: ["video", "comments", "future_capability"],
            reauth_required: true,
          },
        },
      },
    });
    expect(profile.accounts).toEqual([expect.objectContaining({
      platform: "tiktok",
      providerAccountId: "acct_01HZZZZZZZZZZZZZZZZZZZZZZZ",
      status: "needs_reauth",
      capabilities: ["video", "comments", "future_capability"],
    })]);
  });

  it("rejects an account object without a stable provider account id", () => {
    expect(() => normalizeSocialProfile({
      success: true,
      profile: { username: "ps_0123456789abcdef0123456789abcdef01234567", social_accounts: { instagram: { handle: "@only-a-label" } } },
    })).toThrow(/stable account identifier/i);
  });

  it("rejects a readback whose profile key is not the opaque seam shape", () => {
    expect(() => normalizeSocialProfile({
      success: true,
      profile: { username: "not-a-seam-key", social_accounts: {} },
    })).toThrow(/could not be verified/i);
  });
});
