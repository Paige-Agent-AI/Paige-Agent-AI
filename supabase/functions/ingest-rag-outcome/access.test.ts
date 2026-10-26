// EXP08 stage 0 — who may publish an anonymized outcome about a person.
//
//   deno test --allow-read=supabase/functions --node-modules-dir=none --deny-net \
//     supabase/functions/ingest-rag-outcome/access.test.ts
//
// Fictional ids. The handler reads the person's identity with the service role, so a caller other
// than the person must be the Platform Operator — never the global `admin` row a workspace owner holds.

import assert from "node:assert/strict";
import { decideOutcomeIngestAccess, isServiceRoleBearer } from "./access.ts";

const PERSON = "5e5e5e5e-0000-4000-8000-000000000005";
const WORKSPACE_OWNER = "6f6f6f6f-0000-4000-8000-000000000006";
const OPERATOR = "7a7a7a7a-0000-4000-8000-000000000007";

Deno.test("the service-role bearer must EQUAL the key", () => {
  assert.equal(isServiceRoleBearer("Bearer svc-key", "svc-key"), true);
  assert.equal(isServiceRoleBearer("Bearer xx-svc-key-xx", "svc-key"), false, "a header that merely contains the key");
  assert.equal(isServiceRoleBearer("svc-key", "svc-key"), false);
  assert.equal(isServiceRoleBearer("Bearer anything", ""), false, "an empty configured key matches nothing");
  assert.equal(isServiceRoleBearer("Bearer ", ""), false);
  assert.equal(isServiceRoleBearer(null, undefined), false);
});

Deno.test("the person themselves may, without an operator check", async () => {
  let asked = 0;
  assert.equal(await decideOutcomeIngestAccess(PERSON, PERSON, async () => (asked++, false)), true);
  assert.equal(asked, 0);
});

Deno.test("a workspace owner/admin (global admin row) is refused for another person", async () => {
  assert.equal(await decideOutcomeIngestAccess(WORKSPACE_OWNER, PERSON, async () => false), false);
});

Deno.test("the Platform Operator may; no caller may not; an operator-check error is not a grant", async () => {
  assert.equal(await decideOutcomeIngestAccess(OPERATOR, PERSON, async () => true), true);
  assert.equal(await decideOutcomeIngestAccess(null, PERSON, async () => true), false);
  await assert.rejects(decideOutcomeIngestAccess(OPERATOR, PERSON, async () => { throw new Error("rpc down"); }));
});

Deno.test("the handler binds to this decision and no longer reads the global role", async () => {
  const src = await Deno.readTextFile(new URL("./index.ts", import.meta.url));
  assert.doesNotMatch(src, /from\("user_roles"\)/);
  assert.doesNotMatch(src, /authHeader\.includes\(/);
  assert.match(src, /isServiceRoleBearer\(authHeader, supabaseServiceKey\)/);
  assert.match(src, /decideOutcomeIngestAccess\(callerId, payload\.user_id,/);
  assert.match(src, /userClient\.rpc\("is_platform_operator"\)/);
  assert.ok(src.indexOf("decideOutcomeIngestAccess(") < src.indexOf("await loadIdentity(admin, payload.user_id)"));
});
