/**
 * Package B — the archive that actually archives.
 *
 * Production repro (2026-10-01): the owner typed "yes" twice to archive PPL-MRBD9; the model
 * consumed the typed approval as authority, narrated "Done — archived", and the database showed
 * the pipeline still active — no card was ever minted, nothing executed. The governed pipeline
 * lane still depends on the model re-emitting the action after approval, the exact failure
 * class #1600 removed for the CRM lane.
 *
 * This suite pins the port: the approve click executes the STORED proposal for the pipeline
 * lane through the existing human door (`configure_tenant_pipeline`, granted to authenticated,
 * the same RPC the board calls), under the clicking user's own session. The model is never the
 * source of execution arguments; the stored row's idempotency key makes retries replays; and a
 * typed "yes" without a card fingerprint cannot reach the executor.
 *
 * The chat handler is NOT touched (Knowledge #1615 owns that seam): everything here lives in
 * the client, reading the existing approval store and the existing executor.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";

const root = join(__dirname, "..", "..");
const ui = readFileSync(join(root, "src/components/dashboard/PaigeAIChat.tsx"), "utf8");

const PIPELINE_TOOLS = /pipeline_configure/;

describe("the approved pipeline card executes its stored proposal", () => {
  it("reads the stored proposal by fingerprint from the approval store", () => {
    expect(ui).toMatch(/paige_pending_confirmations[\s\S]{0,200}(args|expires_at|tenant_id)/);
    expect(ui).toContain('.eq("fingerprint" as never, item.fingerprint.split(":")[0] as never)');
  });

  it("executes through the existing human door under the user's own session", () => {
    expect(ui).toContain('supabase.rpc("configure_tenant_pipeline"');
    expect(ui).toContain('_actor_kind: "human",');
    // The EXACT wiring lines: substituting re-emitted arguments for the stored row's turns
    // these red (mutation-proven load-bearing).
    expect(ui).toContain("_command: argsObj.command,");
    expect(ui).toContain("_idempotency_key: argsObj.idempotency_key,");
  });

  it("covers the governed pipeline mutations", () => {
    expect(ui).toMatch(PIPELINE_TOOLS);
  });

  it("looks the row up by the BARE fingerprint — the general gate's card token is scoped", () => {
    // The card carries fingerprint:requestNonce; the column is bare 16-hex. Without the split,
    // every pipeline approval refuses "could not be read" and strands (the review's P1).
    expect(ui).toContain('.eq("fingerprint" as never, item.fingerprint.split(":")[0] as never)');
    // ...and only the LIVE row: the server's claim path filters consumed twins the same way.
    expect(ui).toContain('.is("consumed_at" as never, null as never)');
  });

  it("strips executed pipeline fingerprints from the model echo — no re-emission", () => {
    // The exact stripping statement inside the pipeline block (the CRM block's own stripping
    // would satisfy a looser match).
    const pipeline = ui.slice(ui.indexOf("const pipelineItems:"), ui.indexOf("// The turn carries the card"));
    expect(pipeline).toContain("for (const item of pipelineItems)");
    expect(pipeline).toContain("echoFingerprints = echoFingerprints.filter((f) => !executed.has(f));");
  });

  it("classifies rpc failures by the answered-or-ambiguous rule", () => {
    expect(ui).toContain("status >= 400 && status < 500");
    expect(ui).toMatch(/ran = "unconfirmed"[\s\S]{0,200}note = typeof error\.message/);
  });

  it("refuses expired or unfetchable proposals honestly", () => {
    // The exact guard: hard-coding it false (the mutation) turns this red.
    expect(ui).toContain("const expired = !stored?.expires_at || new Date(String(stored.expires_at)).getTime() <= Date.now();");
    expect(ui).toMatch(/expired[\s\S]{0,120}approval expired/i);
  });

  it("never executes from prose — only from approved card fingerprints", () => {
    // The pipeline executor must be reachable ONLY inside the approvedFingerprints path of
    // handleSend, never from message text. Pin: its loop reads the approved set.
    // The pipeline collector lives inside the approvedFingerprints-guarded block and reads the
    // approved card confirmations, not message text.
    expect(ui).toMatch(/echoFingerprints\?\.length && !soloTenantSafety\) \{[\s\S]{0,1100}pipeline_configure[\s\S]{0,1100}paige_pending_confirmations/);
    expect(ui).toMatch(/for \(const m of messages\) \{[\s\S]{0,400}echoFingerprints\.includes\(c\.fingerprint\)/);
  });
});

describe("the CRM lane's stored-proposal execution is not regressed", () => {
  it("keeps the CRM direct invoke intact", () => {
    expect(ui).toContain('supabase.functions.invoke("crm-command"');
    expect(ui).toContain("approved_fingerprint: fingerprint");
  });
});
