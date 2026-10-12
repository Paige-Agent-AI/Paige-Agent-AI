// @vitest-environment node
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(__dirname, "..", "..");
const src = readFileSync(join(root, "supabase/functions/paige-ai-chat/index.ts"), "utf8");

/** INT-1807 CL-8 — the gated model-emit write path for the Pipeline non-application
 *  observation. The pinned C4a resume was the only recorded path; this pins that a
 *  gate-resolved approved token for a re-emitted pipeline_configure call now reaches the
 *  recorder too, and that the recorder's token is server-resolved (never from args). */
describe("model-emit non-application recording (CL-8)", () => {
  it("the general gate captures the resolved approved token for pipeline_configure calls", () => {
    expect(src).toContain('if (approvedFingerprint && tc.function.name === "pipeline_configure") pipelineClaimToken.set(tc.id, approvedFingerprint);');
  });
  it("the recorder accepts the pinned OR the gate-claimed token — not a pin-only condition", () => {
    expect(src).toContain("const observedClaimToken = resumePin.get(tc.id) ?? pipelineClaimToken.get(tc.id);");
    expect(src).toContain("if (databaseAnswered(configureError) && interactive && observedClaimToken) {");
    expect(src).not.toContain("resumePin.has(tc.id)) {\n                    try {\n                      await admin.rpc(\"record_pipeline_metadata_non_application\"");
  });
  it("the token map is declared server-side beside the resume pin, never client-set", () => {
    expect(src).toContain("const pipelineClaimToken = new Map<string, string>();");
  });
});
