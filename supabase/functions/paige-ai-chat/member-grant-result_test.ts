// EXP08 stage 0 — PAIGE's member_grant_role result must not claim access was given.
//
//   deno test --allow-read=supabase/functions --deny-net supabase/functions/paige-ai-chat/member-grant-result_test.ts
//
// grant_tenant_member_role now writes a platform-wide role only for a person already ACTIVE in the
// workspace; anyone else gets a pending seat and no access until they accept. The RPC returns nothing
// either way, so the tool result carries the sentence PAIGE must relay instead of a bare success (§13).

import assert from "node:assert/strict";

Deno.test("member_grant_role tells PAIGE a non-member only got a pending seat", async () => {
  const src = await Deno.readTextFile(new URL("./index.ts", import.meta.url));
  const at = src.indexOf('} else if (tc.function.name === "member_grant_role") {');
  assert.ok(at > 0, "the member_grant_role handler exists");
  const handler = src.slice(at, src.indexOf('} else if (tc.function.name === "member_revoke_role") {', at));
  assert.match(handler, /supabaseClient\.rpc\("grant_tenant_member_role"/, "the grant runs on the caller's own login");
  assert.match(handler, /_tenant_id: personaCtx\?\.tenant_id \?\? null/, "the grant is asked about the acting workspace");
  assert.match(handler, /note: "The role applies only if this person is already an active member of this workspace\./);
  assert.match(handler, /pending seat/);
  assert.match(handler, /do not say they have access/);
  assert.doesNotMatch(handler, /result = \{ success: true, user_id: args\.user_id, role: args\.role \};/,
    "a bare success would let PAIGE claim access that was never given");
});
