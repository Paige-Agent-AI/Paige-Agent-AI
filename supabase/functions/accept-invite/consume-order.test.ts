// accept-invite — the consume path's ORDER (EXP08 lifecycle, B3). team-seat.test.ts proves what
// team-seat.ts writes; this proves index.ts calls it at the right moments: the seat check before ANY
// write (the password included), its refusal returned, the grant before the invitation is marked
// accepted, its failure returned, and no seat or global-role write left in the team path itself.
//
// Run: deno test --allow-import=deno.land --allow-read=supabase/functions/accept-invite --node-modules-dir=none --deny-net \
//        --deny-env --deny-write --deny-run --deny-ffi --deny-sys supabase/functions/accept-invite/consume-order.test.ts

import { assert } from "https://deno.land/std@0.224.0/assert/mod.ts";

const source = Deno.readTextFileSync(new URL("./index.ts", import.meta.url));
const team = source.slice(source.indexOf("// ---- Try internal team invite ----"));
const consume = team.slice(team.indexOf('if (action === "consume")'));
const at = (needle: string | RegExp) => (typeof needle === "string" ? consume.indexOf(needle) : consume.search(needle));

Deno.test("the team consume path is where this test looks", () => {
  assert(source.includes("// ---- Try internal team invite ----"));
  assert(at("updateUserById(") > 0);
});

Deno.test("the seat check runs before any write, the password included, and its refusal is returned", () => {
  const check = at("await checkTeamSeat(admin,");
  assert(check > 0, "checkTeamSeat is called");
  for (const write of ["updateUserById(", '.from("profiles")', '.from("invitations")', "grantTeamSeat("]) {
    assert(check < at(write), `checkTeamSeat precedes ${write}`);
  }
  assert(/if \(!seatCheck\.ok\) \{[\s\S]{0,600}?return json\(seatCheck\.status,/.test(consume), "the refusal is returned");
});

Deno.test("the grant runs before the invitation is marked accepted, and its failure is returned", () => {
  const grant = at("await grantTeamSeat(admin,");
  assert(grant > 0);
  assert(grant < at(/\.from\("invitations"\)\s*\.update\(\{ accepted_at/));
  assert(/if \(!grant\.ok\) \{[\s\S]{0,700}?return json\(grant\.status,/.test(consume), "the failure is returned");
  assert(/existing: seatCheck\.existing/.test(consume), "the grant is given what the check read");
});

// The white-label client path above it grants 'client' itself; it seats nobody in tenant_members.
Deno.test("the team path writes no seat and no global role itself", () => {
  assert(!/\.from\("user_roles"\)/.test(team));
  assert(!/\.from\("tenant_members"\)/.test(team));
  assert(!/\.from\("tenant_members"\)/.test(source));
});
