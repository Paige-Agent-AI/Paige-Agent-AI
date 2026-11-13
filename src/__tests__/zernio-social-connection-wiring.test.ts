// @vitest-environment node
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(join(process.cwd(), rel), "utf8");
const endpoint = read("supabase/functions/paige-social/index.ts");
const callback = read("supabase/functions/paige-social-callback/index.ts");
const publisher = read("supabase/functions/social-publish-command/index.ts");
const adapter = read("supabase/functions/_shared/social-provider/zernio.ts");
const shared = read("supabase/functions/_shared/social-provider/mod.ts");

describe("Zernio provider wiring", () => {
  it("selects Zernio as the SOLE provider in both Social doors — no fallback, no second adapter", () => {
    // ANT-164 3f511055 (Nov 2 2026): Zernio sole social aggregator; the Upload-Post adapter and
    // its secret-driven fallback were retired. The doors bind Zernio unconditionally; an
    // unconfigured Zernio key fails closed through the honest unavailable path.
    expect(endpoint).toContain("const adapter = zernioSocialAdapter;");
    expect(callback).toContain("const adapter = zernioSocialAdapter;");
    expect(endpoint).toContain('from "../_shared/social-provider/zernio.ts"');
    expect(callback).toContain('from "../_shared/social-provider/zernio.ts"');
    for (const surface of [endpoint, callback, publisher]) {
      expect(surface).not.toContain("uploadPostSocialAdapter");
      expect(surface).not.toContain("upload-post.ts");
    }
  });

  it("the publisher injects the sole provider too — Upload-Post is out of the publish path", () => {
    expect(publisher).toContain("adapter: zernioSocialAdapter");
    // EXP07's posting arm (owner-approved November 3) replaced the honest 501 refusal:
    // publishing now goes through Zernio with publication-scoped idempotency (below).
    expect(adapter).not.toContain("provider_publishing_unavailable");
  });

  it("keeps the strict redirect-parameter contract and verifies Zernio by readback", () => {
    expect(callback).toContain('const readbackIsTruth = claim.provider_key === zernioSocialAdapter.key');
    expect(callback).toContain("const platformMismatch = !readbackIsTruth && returnedPlatform !== claim.requested_platform");
    // The readback itself stays the shared verification path.
    expect(callback.indexOf("adapter.readProfile")).toBeGreaterThan(-1);
    expect(callback).toContain('profile.accounts.filter((account) => account.platform === claim.requested_platform)');
  });

  it("keeps the OAuth platform catalogue and the profile plumbing provider-neutral and single-sourced", () => {
    expect(shared).toContain("export const SOCIAL_OAUTH_PLATFORMS");
    expect(shared).toContain("export async function buildSocialProfileKey");
    expect(shared).toContain("export function normalizeSocialProfile");
    expect(adapter).toContain('from "./mod.ts"');
    expect(endpoint).toContain('buildSocialProfileKey, GOOGLE_CONNECT_AREAS, SOCIAL_CONNECTION_PLATFORMS, SocialProviderError } from "../_shared/social-provider/mod.ts"');
  });

  it("carries the provider credential only in the Authorization header and never in a URL", () => {
    expect(adapter).toContain('Authorization: `Bearer ${providerKey()}`');
    expect(adapter).not.toMatch(/apiKey=|api_key=|\?key=/);
    expect(adapter).not.toContain("console.");
    expect(adapter).toContain('envKey("ZERNIO_API_KEY")');
  });

  it("publishes through the sole provider with publication-scoped idempotency (owner-approved November 3)", () => {
    expect(adapter).toContain('request("/posts"');
    expect(adapter).toContain('"Idempotency-Key": input.externalId');
    expect(adapter).toContain("publishNow: true");
    expect(adapter).toContain('"provider_dispatch_unconfirmed"');
    expect(adapter).not.toContain("provider_publishing_unavailable");
    // The publish door injects Zernio alone — no retired-provider fallback anywhere.
    const publishDoor = read("supabase/functions/social-publish-command/index.ts");
    expect(publishDoor).toContain("zernioSocialAdapter");
    expect(publishDoor).not.toContain("uploadPostSocialAdapter");
  });
});
