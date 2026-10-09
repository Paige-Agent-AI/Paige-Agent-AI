// #1140 two-mailbox pilot — the mailbox policy gates, pure and injected.
// Failing-first: written before policy.ts exists.
import { describe, expect, it } from "vitest";
import { decideContentRead, hasReadScope, hasOrganizeScope, type MailboxPolicyRow } from "./policy.ts";

const T1 = "10000000-0000-4000-8000-000000000001";
const T2 = "10000000-0000-4000-8000-000000000002";
const OWNER = "40000000-0000-4000-8000-000000000001";
const STAFF = "40000000-0000-4000-8000-000000000002";

const personal: MailboxPolicyRow = { mailbox_class: "personal", mailbox_owner_user_id: OWNER, status: "active", active: true, mailbox_scopes: ["https://www.googleapis.com/auth/gmail.modify"] };
const shared: MailboxPolicyRow = { mailbox_class: "shared_support", mailbox_owner_user_id: null, status: "active", active: true, mailbox_scopes: [] };

describe("decideContentRead — the private/shared boundary", () => {
  it("lets the granting owner read their own personal mailbox", () => {
    expect(decideContentRead({ callerUserId: OWNER, callerTenantId: T1, mailboxTenantId: T1, mailbox: personal }))
      .toEqual({ allowed: true, mailboxClass: "personal" });
  });

  it("refuses a same-tenant staff member on a personal mailbox (support roles see nothing)", () => {
    const d = decideContentRead({ callerUserId: STAFF, callerTenantId: T1, mailboxTenantId: T1, mailbox: personal });
    expect(d).toEqual({ allowed: false, code: "PERSONAL_MAILBOX_NOT_OWNER" });
  });

  it("refuses a foreign tenant on a personal mailbox", () => {
    const d = decideContentRead({ callerUserId: OWNER, callerTenantId: T2, mailboxTenantId: T1, mailbox: personal });
    expect(d).toEqual({ allowed: false, code: "FOREIGN_TENANT" });
  });

  it("refuses a foreign tenant on a shared mailbox", () => {
    const d = decideContentRead({ callerUserId: STAFF, callerTenantId: T2, mailboxTenantId: T1, mailbox: shared });
    expect(d).toEqual({ allowed: false, code: "FOREIGN_TENANT" });
  });

  it("lets tenant staff read the shared support mailbox", () => {
    expect(decideContentRead({ callerUserId: STAFF, callerTenantId: T1, mailboxTenantId: T1, mailbox: shared }))
      .toEqual({ allowed: true, mailboxClass: "shared_support" });
  });

  it("refuses everything when the connector is disabled (consent revoked)", () => {
    const revoked: MailboxPolicyRow = { ...personal, status: "disabled", active: false };
    expect(decideContentRead({ callerUserId: OWNER, callerTenantId: T1, mailboxTenantId: T1, mailbox: revoked }).code).toBe("MAILBOX_INACTIVE");
    expect(decideContentRead({ callerUserId: STAFF, callerTenantId: T1, mailboxTenantId: T1, mailbox: { ...shared, active: false } }).code).toBe("MAILBOX_INACTIVE");
  });

  it("refuses a personal mailbox with no bound owner, fail-closed", () => {
    const orphan: MailboxPolicyRow = { ...personal, mailbox_owner_user_id: null };
    expect(decideContentRead({ callerUserId: OWNER, callerTenantId: T1, mailboxTenantId: T1, mailbox: orphan }).code).toBe("PERSONAL_MAILBOX_NOT_OWNER");
  });

  it("refuses when the caller has no resolvable tenant", () => {
    expect(decideContentRead({ callerUserId: OWNER, callerTenantId: null, mailboxTenantId: T1, mailbox: shared }).code).toBe("NO_TENANT");
  });
});

describe("scope gates", () => {
  it("read accepts readonly or modify; organize requires modify only", () => {
    expect(hasReadScope({ ...personal, mailbox_scopes: ["https://www.googleapis.com/auth/gmail.readonly"] })).toBe(true);
    expect(hasReadScope(personal)).toBe(true);
    expect(hasReadScope({ ...personal, mailbox_scopes: ["https://www.googleapis.com/auth/gmail.send"] })).toBe(false);
    expect(hasReadScope({ ...personal, mailbox_scopes: [] })).toBe(false);
    expect(hasOrganizeScope(personal)).toBe(true);
    expect(hasOrganizeScope({ ...personal, mailbox_scopes: ["https://www.googleapis.com/auth/gmail.readonly"] })).toBe(false);
  });
});
