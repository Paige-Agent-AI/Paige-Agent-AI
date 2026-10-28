// @vitest-environment node
// The publish card's one sentence — pinned for the surfaces that render it verbatim: the Studio
// panel's own card AND the Team Hub approval card (EXP08 be5134d7). The sentence must carry
// typographic quotes and the ABSOLUTE public address, so it reads finished wherever it lands.
import { describe, expect, it } from "vitest";
import { previewSummary, type PublishPreview } from "../../supabase/functions/_shared/growth-publish-command/contract.ts";

const page = (over: Partial<PublishPreview> = {}): PublishPreview => ({
  kind: "page", id: "p-1", title: "Spring Open House", action: "publish",
  address: "/p/acme-coaching/spring-open-house",
  checks: [{ key: "public_address", label: "public address", ok: true, blocking: true }],
  ...over,
});

describe("the publish card's one sentence (EXP08 be5134d7)", () => {
  it("states the ABSOLUTE address, not a relative path", () => {
    const s = previewSummary(page());
    expect(s).toContain("https://paigeagent.ai/p/acme-coaching/spring-open-house");
    expect(s).not.toMatch(/\sat \/p\//);
  });

  it("wraps the title in typographic quotes (the CRM cards' convention)", () => {
    expect(previewSummary(page())).toContain("“Spring Open House”");
    expect(previewSummary(page({ action: "unpublish" }))).toContain("“Spring Open House”");
  });

  it("keeps the consequence sentences that follow", () => {
    expect(previewSummary(page())).toContain("Anyone with the link can open it. The forms on it go live too.");
    expect(previewSummary(page({ action: "unpublish" }))).toContain("It goes back to a draft in the Studio; the forms on it stay live.");
  });

  it("passes an already-absolute address through unchanged", () => {
    expect(previewSummary(page({ kind: "image", address: "https://cdn.test/a.png" })))
      .toContain("at https://cdn.test/a.png");
  });

  it("says nothing false when there is no address yet", () => {
    const s = previewSummary(page({ address: null }));
    expect(s).not.toContain(" at ");
    expect(s).toContain("“Spring Open House”.");
  });
});
