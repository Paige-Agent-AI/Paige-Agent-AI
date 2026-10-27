// node --test supabase/functions/_shared/team-hub/agent-turn-wiring.test.ts
// EXP08 Team Hub agents A1b — how paige-ai-chat hands an agent turn to its module (contract section 7).
// EVIDENCE CLASS, stated plainly: a STRUCTURAL test over the handler's source, not a run of the Deno
// handler. It pins where the seam sits and exactly what it hands over, so moving it above the verified
// actor or the ingress rate limit, or handing the module the wrong client, fails here.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const CHAT = readFileSync(fileURLToPath(new URL("../../paige-ai-chat/index.ts", import.meta.url)), "utf8");
const at = (needle: string): number => {
  const i = CHAT.indexOf(needle);
  assert.ok(i >= 0, `missing: ${needle}`);
  assert.equal(CHAT.indexOf(needle, i + needle.length), -1, `not unique: ${needle}`);
  return i;
};
const SEAM = "    if (isTeamHubAgentTurnRequest(rawData)) {\n"
  + "      const agentTurn = await runTeamHubAgentTurn({ caller: supabaseClient, service: supabase, userId: user.id,\n"
  + "        complete: fabricCompletion, signal: req.signal, controlHint }, rawData);\n"
  + "      return new Response(JSON.stringify(agentTurn.body),\n"
  + "        { status: agentTurn.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });\n"
  + "    }\n";

describe("the agent-turn seam in paige-ai-chat", () => {
  it("imports the module once, from its one home", () => {
    at("import { isTeamHubAgentTurnRequest, runTeamHubAgentTurn } from '../_shared/team-hub/agent-turn.ts';");
  });
  it("hands over exactly the asker's session, the service role, the verified actor, the one model seam and the request's signal", () => {
    at(SEAM);
  });
  it("runs after the verified actor and the ingress rate limit, and before the chat schema or anything else", () => {
    const seam = at(SEAM);
    assert.ok(at("const { data: { user }, error: authError } = await supabaseClient.auth.getUser();") < seam);
    assert.ok(at("if (authError || !user) {") < seam);
    assert.ok(at("const supabase = createClient(supabaseUrl, supabaseServiceKey);") < seam);
    assert.ok(at("if (rateLimitCheck === false) {") < seam);
    assert.ok(at("      } else rawData = await req.json();") < seam);
    assert.ok(seam < at("      validatedData = messageSchema.parse(rawData);"));
    assert.ok(seam < at('const { data: pc, error: pcErr } = await supabaseClient.rpc("get_paige_persona_context");'));
  });
  it("hands over the request's own control hint, read before the ingress limit chose its quota, so a hinted turn is refused (S2)", () => {
    const seam = at(SEAM);
    const hint = at("    const controlHint = req.headers.get(CHAT_CONTROL_HEADER);\n    const ingress = chatIngressPolicy(controlHint);\n");
    assert.ok(hint < seam);
    // Nothing between the header read and the seam reassigns it.
    assert.equal(/controlHint\s*=(?!=)/.test(CHAT.slice(hint + 60, seam)), false);
  });
  it("uses the handler's own model seam, the one the chat imports", () => {
    at('import { describeAttempts, fabricChatStream, fabricCompletion, type FabricStream } from "../_shared/model-fabric.ts";');
  });
});
