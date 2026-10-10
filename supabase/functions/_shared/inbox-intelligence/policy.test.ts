// #1140 two-mailbox pilot — the mailbox policy gates, pure and injected.
// Failing-first: written before policy.ts existed. Deno-native (the ci.yml deno test step):
//   deno test --allow-import --node-modules-dir=none supabase/functions/_shared/inbox-intelligence/policy.test.ts
import { assertEquals } from "https://deno.land/std@0.190.0/testing/asserts.ts";
import { decideContentRead, hasReadScope, hasOrganizeScope, type MailboxPolicyRow } from "./policy.ts";

const T1 = "10000000-0000-4000-8000-000000000001";
const T2 = "10000000-0000-4000-8000-000000000002";
const OWNER = "40000000-0000-4000-8000-000000000001";
const STAFF = "40000000-0000-4000-8000-000000000002";

const personal: MailboxPolicyRow = { mailbox_class: "personal", mailbox_owner_user_id: OWNER, status: "active", active: true, mailbox_scopes: ["https://www.googleapis.com/auth/gmail.modify"] };
const shared: MailboxPolicyRow = { mailbox_class: "shared_support", mailbox_owner_user_id: null, status: "active", active: true, mailbox_scopes: [] };

Deno.test("content read: the granting owner reads their own personal mailbox", () => {
  assertEquals(decideContentRead({ callerUserId: OWNER, callerTenantId: T1, mailboxTenantId: T1, mailbox: personal }), { allowed: true, mailboxClass: "personal" });
});

Deno.test("content read: same-tenant staff are refused on a personal mailbox (support roles see nothing)", () => {
  assertEquals(decideContentRead({ callerUserId: STAFF, callerTenantId: T1, mailboxTenantId: T1, mailbox: personal }), { allowed: false, code: "PERSONAL_MAILBOX_NOT_OWNER" });
});

Deno.test("content read: a foreign tenant is refused on a personal mailbox", () => {
  assertEquals(decideContentRead({ callerUserId: OWNER, callerTenantId: T2, mailboxTenantId: T1, mailbox: personal }), { allowed: false, code: "FOREIGN_TENANT" });
});

Deno.test("content read: a foreign tenant is refused on a shared mailbox", () => {
  assertEquals(decideContentRead({ callerUserId: STAFF, callerTenantId: T2, mailboxTenantId: T1, mailbox: shared }), { allowed: false, code: "FOREIGN_TENANT" });
});

Deno.test("content read: tenant staff read the shared support mailbox", () => {
  assertEquals(decideContentRead({ callerUserId: STAFF, callerTenantId: T1, mailboxTenantId: T1, mailbox: shared }), { allowed: true, mailboxClass: "shared_support" });
});

Deno.test("content read: a disabled connector refuses everyone (consent revoked)", () => {
  const revoked: MailboxPolicyRow = { ...personal, status: "disabled", active: false };
  assertEquals(decideContentRead({ callerUserId: OWNER, callerTenantId: T1, mailboxTenantId: T1, mailbox: revoked }), { allowed: false, code: "MAILBOX_INACTIVE" });
  assertEquals(decideContentRead({ callerUserId: STAFF, callerTenantId: T1, mailboxTenantId: T1, mailbox: { ...shared, active: false } }), { allowed: false, code: "MAILBOX_INACTIVE" });
});

Deno.test("content read: a personal mailbox with no bound owner refuses, fail-closed", () => {
  const orphan: MailboxPolicyRow = { ...personal, mailbox_owner_user_id: null };
  assertEquals(decideContentRead({ callerUserId: OWNER, callerTenantId: T1, mailboxTenantId: T1, mailbox: orphan }), { allowed: false, code: "PERSONAL_MAILBOX_NOT_OWNER" });
});

Deno.test("content read: a caller with no resolvable tenant is refused", () => {
  assertEquals(decideContentRead({ callerUserId: OWNER, callerTenantId: null, mailboxTenantId: T1, mailbox: shared }), { allowed: false, code: "NO_TENANT" });
});

Deno.test("scopes: read accepts readonly or modify; organize requires modify only", () => {
  assertEquals(hasReadScope({ ...personal, mailbox_scopes: ["https://www.googleapis.com/auth/gmail.readonly"] }), true);
  assertEquals(hasReadScope(personal), true);
  assertEquals(hasReadScope({ ...personal, mailbox_scopes: ["https://www.googleapis.com/auth/gmail.send"] }), false);
  assertEquals(hasReadScope({ ...personal, mailbox_scopes: [] }), false);
  assertEquals(hasOrganizeScope(personal), true);
  assertEquals(hasOrganizeScope({ ...personal, mailbox_scopes: ["https://www.googleapis.com/auth/gmail.readonly"] }), false);
});
