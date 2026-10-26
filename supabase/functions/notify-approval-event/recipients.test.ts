// EXP08 stage 0 — a new approval is announced to ITS workspace, not to every global admin.
//
//   deno test --allow-read=supabase/functions --node-modules-dir=none --deny-net \
//     supabase/functions/notify-approval-event/recipients.test.ts
//
// Fictional ids. Workspace A has an owner and an admin; workspace B's owner holds the global
// `admin` row too (as every owner does) and must never hear about A's approvals.

import assert from "node:assert/strict";
import { approvalCreatedRecipients, type RecipientDeps, type Recipient } from "./recipients.ts";

const A = "aaaaaaaa-3333-4333-8333-33333333333a";
const B = "bbbbbbbb-4444-4444-8444-44444444444b";
const SEATS = [
  { tenant: A, user_id: "a-owner", role: "owner" },
  { tenant: A, user_id: "a-admin", role: "admin" },
  { tenant: A, user_id: "a-member", role: "member" },
  { tenant: B, user_id: "b-owner", role: "owner" },
];
const OPERATORS: Recipient[] = [
  { user_id: "op-super", role: "super_admin" },
  { user_id: "op-platform", role: "platform_admin" },
];

function deps(fail = false): RecipientDeps {
  return {
    seats: async (t, roles) => {
      if (fail) throw new Error("seat read failed");
      return SEATS.filter((s) => s.tenant === t && roles.includes(s.role)).map(({ user_id, role }) => ({ user_id, role }));
    },
    seatRole: async (t, u) => SEATS.find((s) => s.tenant === t && s.user_id === u)?.role ?? null,
    operators: async (roles) => OPERATORS.filter((o) => roles.includes(o.role)),
  };
}
const ids = (r: Recipient[]) => r.map((x) => x.user_id).sort();

Deno.test("unassigned: the approval's own workspace owners and admins — no other workspace, no member", async () => {
  const r = await approvalCreatedRecipients({ tenant_id: A, assigned_to_user_id: null, requires_role: null }, deps());
  assert.deepEqual(ids(r), ["a-admin", "a-owner"]);
  for (const role of ["any", "admin", "coach"]) {
    assert.deepEqual(ids(await approvalCreatedRecipients({ tenant_id: A, assigned_to_user_id: null, requires_role: role }, deps())),
      ["a-admin", "a-owner"], role);
  }
});

Deno.test("requires_role owner narrows to owners; an operator role goes to those operators only", async () => {
  assert.deepEqual(ids(await approvalCreatedRecipients({ tenant_id: A, assigned_to_user_id: null, requires_role: "owner" }, deps())), ["a-owner"]);
  assert.deepEqual(ids(await approvalCreatedRecipients({ tenant_id: A, assigned_to_user_id: null, requires_role: "super_admin" }, deps())), ["op-super"]);
});

Deno.test("assigned: the assignee when they hold a seat there or are an operator", async () => {
  assert.deepEqual(await approvalCreatedRecipients({ tenant_id: A, assigned_to_user_id: "a-member", requires_role: null }, deps()),
    [{ user_id: "a-member", role: "member" }]);
  assert.deepEqual(await approvalCreatedRecipients({ tenant_id: A, assigned_to_user_id: "op-platform", requires_role: null }, deps()),
    [{ user_id: "op-platform", role: "platform_admin" }]);
});

Deno.test("assigned to someone outside the workspace: they are dropped and the workspace is told", async () => {
  const r = await approvalCreatedRecipients({ tenant_id: A, assigned_to_user_id: "b-owner", requires_role: null }, deps());
  assert.deepEqual(ids(r), ["a-admin", "a-owner"]);
});

Deno.test("a workspace-less approval is operator work only", async () => {
  assert.deepEqual(ids(await approvalCreatedRecipients({ tenant_id: null, assigned_to_user_id: null, requires_role: null }, deps())),
    ["op-platform", "op-super"]);
  assert.deepEqual(ids(await approvalCreatedRecipients({ tenant_id: null, assigned_to_user_id: "a-owner", requires_role: null }, deps())),
    ["op-platform", "op-super"]);
});

Deno.test("a read error throws — never an empty or global audience", async () => {
  await assert.rejects(approvalCreatedRecipients({ tenant_id: A, assigned_to_user_id: null, requires_role: null }, deps(true)));
});

Deno.test("the handler uses this audience and no longer broadcasts on the global admin role", async () => {
  const src = await Deno.readTextFile(new URL("./index.ts", import.meta.url));
  assert.match(src, /await approvalCreatedRecipients\(/);
  assert.doesNotMatch(src, /: \['admin', 'super_admin'\]/);
  assert.match(src, /\.select\('id, tenant_id, category,/);
  assert.match(src, /\.from\('tenant_members'\)/);
  // The internal-caller gate still runs before the body is read (send-authority relay rule).
  assert.ok(src.indexOf("await isAuthorizedInternalCaller(req, adminClient())") < src.indexOf("await req.json()"));
});
