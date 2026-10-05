// E3: an email series' approval sits in the shared approvals queue (paige_approval_queue_v) as a campaign_send
// row carrying email_sequence_version_id. Approving it there must go through email_sequence_approve as the
// approving person; the generic acknowledge path is refused by the series' DB guard and would strand the claim.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const src = readFileSync(join(__dirname, "../../supabase/functions/execute-approval/index.ts"), "utf8");

describe("execute-approval: email series", () => {
  const branch = src.slice(src.indexOf("const sequenceVersionId"), src.indexOf("const sequenceVersionId") + 900);

  it("decides a series approval with email_sequence_approve, as the approving user", () => {
    expect(src).toContain("email_sequence_version_id");
    expect(branch).toMatch(/userClient\.rpc\("email_sequence_approve", \{ p_version_id: sequenceVersionId \}\)/);
  });

  it("releases the claim when the approval is refused, so a second press is not a false success", () => {
    expect(branch).toMatch(/if \(approveErr\) \{\s*await releaseClaim\(\);\s*return json\(200, \{ ok: false/);
  });

  it("runs before every generic path that would flip the row", () => {
    const at = src.indexOf("const sequenceVersionId");
    expect(at).toBeGreaterThan(src.indexOf("const releaseClaim"));
    expect(at).toBeLessThan(src.indexOf('(metaLc as any).source === "paige_orchestration"'));
    expect(at).toBeLessThan(src.indexOf('status: "approved"', src.indexOf("const releaseClaim")));
  });
});
