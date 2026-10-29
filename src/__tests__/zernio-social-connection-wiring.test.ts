// @vitest-environment node
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(join(process.cwd(), rel), "utf8");
const endpoint = read("supabase/functions/paige-social/index.ts");
const callback = read("supabase/functions/paige-social-callback/index.ts");
const adapter = read("supabase/functions/_shared/social-provider/zernio.ts");
const shared = read("supabase/functions/_shared/social-provider/mod.ts");
const uploadPost = read("supabase/functions/_shared/social-provider/upload-post.ts");

describe("Zernio provider wiring", () => {
  it("selects the configured provider in both Social doors without any second surface", () => {
    const selection = "zernioSocialAdapter.isConfigured() ? zernioSocialAdapter : uploadPostSocialAdapter";
    expect(endpoint).toContain(selection);
    expect(callback).toContain(selection);
    expect(endpoint).toContain('from "../_shared/social-provider/zernio.ts"');
    expect(callback).toContain('from "../_shared/social-provider/zernio.ts"');
  });

  it("keeps the strict redirect-parameter contract for the other provider and verifies Zernio by readback", () => {
    expect(callback).toContain('const readbackIsTruth = claim.provider_key === zernioSocialAdapter.key');
    expect(callback).toContain("const platformMismatch = !readbackIsTruth && returnedPlatform !== claim.requested_platform");
    // The readback itself stays the shared verification path for both providers.
    expect(callback.indexOf("adapter.readProfile")).toBeGreaterThan(-1);
    expect(callback).toContain('profile.accounts.filter((account) => account.platform === claim.requested_platform)');
  });

  it("keeps the OAuth platform catalogue provider-neutral and single-sourced", () => {
    expect(shared).toContain("export const SOCIAL_OAUTH_PLATFORMS");
    expect(uploadPost).not.toContain("export const SOCIAL_OAUTH_PLATFORMS = [");
    expect(adapter).toContain('from "./mod.ts"');
  });

  it("carries the provider credential only in the Authorization header and never in a URL", () => {
    expect(adapter).toContain('Authorization: `Bearer ${providerKey()}`');
    expect(adapter).not.toMatch(/apiKey=|api_key=|\?key=/);
    expect(adapter).not.toContain("console.");
    expect(adapter).toContain('envKey("ZERNIO_API_KEY")');
  });

  it("refuses publishing until its own governed slice ships", () => {
    expect(adapter).toContain("provider_publishing_unavailable");
    expect(adapter).not.toContain("/posts");
  });
});
