// @vitest-environment node
// A Studio image lands on its session whichever provider made it: both completion paths call the
// same helper. It files the image on the session first and only then records a version, and a
// failure never throws (the image is already filed by then).
import { describe, expect, it, vi } from "vitest";
import { linkStudioArtifact } from "../../supabase/functions/_shared/media-provider/studio-link.ts";

function fakeAdmin(linkError: unknown = null) {
  const calls: string[] = [];
  return {
    calls,
    rpc: vi.fn(async (name: string) => {
      calls.push(name);
      return { error: name === "link_session_artifact" ? linkError : null };
    }),
  };
}

describe("linkStudioArtifact", () => {
  it("links, then versions, a job started in a Studio session", async () => {
    const admin = fakeAdmin();
    await linkStudioArtifact(admin, { tenant_id: "t1", params: { studio_session_id: "s1" } }, "c1");
    expect(admin.calls).toEqual(["link_session_artifact", "save_artifact_version"]);
  });

  it("does nothing for a job with no session, or no filed image", async () => {
    const a = fakeAdmin();
    await linkStudioArtifact(a, { tenant_id: "t1", params: {} }, "c1");
    await linkStudioArtifact(a, { tenant_id: "t1", params: { studio_session_id: "s1" } }, null);
    expect(a.calls).toEqual([]);
  });

  it("records no version when the link fails, and does not throw", async () => {
    const admin = fakeAdmin({ message: "nope" });
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(linkStudioArtifact(admin, { tenant_id: "t1", params: { studio_session_id: "s1" } }, "c1")).resolves.toBeUndefined();
    expect(admin.calls).toEqual(["link_session_artifact"]);
    err.mockRestore();
  });

  it("both completion paths use it", async () => {
    const { readFileSync } = await import("node:fs");
    const media = readFileSync("supabase/functions/paige-media/index.ts", "utf8");
    const complete = readFileSync("supabase/functions/_shared/media-provider/complete.ts", "utf8");
    expect(media).toMatch(/await linkStudioArtifact\(admin, job, result\.contentId\)/);
    expect(complete).toMatch(/await linkStudioArtifact\(admin, job,/);
  });
});

describe("a refine whose target can no longer take a version is filed, not lost", () => {
  it("both image paths fall back to a new image when the target is published or gone", async () => {
    const { readFileSync } = await import("node:fs");
    const complete = readFileSync("supabase/functions/_shared/media-provider/complete.ts", "utf8");
    const legacy = readFileSync("supabase/functions/generate-image/index.ts", "utf8");
    for (const src of [complete, legacy]) {
      expect(src).toMatch(/CONTENT_NOT_FOUND\|GROWTH_PUBLISH_STATE_GUARDED/);
    }
    expect(complete).toMatch(/save_marketing_content", \{ \.\.\.saveArgs, p_id: null \}/);
  });
});
