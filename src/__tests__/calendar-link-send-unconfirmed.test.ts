// Experience 03: every email now goes through SendGrid, which has no idempotent replay. When send-message
// answers an email outcome_unknown (its provider answer was lost), the booking-link share must report it as
// unconfirmed and tell Paige NOT to send it again — never "failed" and never "The link was NOT sent", which
// would invite a second email to the same client. The real module, with the database and send seam injected.
import { describe, expect, it } from "vitest";
import { mapSendOutcome, sendCalendarLink } from "../../supabase/functions/_shared/calendar-link-tenant-brain";

const T = "10000000-0000-4000-8000-000000000001";
const CAL = "20000000-0000-4000-8000-000000000002";
const C = "30000000-0000-4000-8000-000000000003";

function run(answer: Record<string, unknown>) {
  const sends: unknown[] = [];
  const caller = {
    rpc: async (name: string) => name === "current_user_tenant_id"
      ? { data: T, error: null }
      : { data: [{ shareable: true, reason: null, slug: "intro-call", title: "Intro call" }], error: null },
  };
  const q: Record<string, unknown> = {};
  q.select = () => q; q.eq = () => q;
  q.maybeSingle = async () => ({ data: { id: C, client_contact_methods: [{ kind: "email", value: "maya@example.test", is_primary: true }] }, error: null });
  const admin = { from: () => q, rpc: async () => ({ data: null, error: null }) };
  return sendCalendarLink({
    caller, admin: admin as never, expectedTenantId: T, calendarId: CAL, contactId: C, channel: "email", publicSiteUrl: "https://paige.example",
    sendMessage: async (i) => { sends.push(i); return { httpOk: true, ...answer } as never; },
  }).then((r) => ({ r, sends }));
}

describe("calendar link share: an unconfirmed send is never a failure", () => {
  it("maps outcome_unknown to outcome_unknown, not failed", () => {
    expect(mapSendOutcome({ httpOk: true, status: "failed", outcome: "outcome_unknown", reason: "delivery_unconfirmed: sendgrid_503" }))
      .toMatchObject({ success: false, outcome: "outcome_unknown" });
    expect(mapSendOutcome({ httpOk: true, status: "failed", outcome: "failed", reason: "sendgrid_400" }))
      .toMatchObject({ success: false, outcome: "failed" });
  });

  it("tells Paige it may have reached them and not to send it again", async () => {
    const { r, sends } = await run({ status: "failed", outcome: "outcome_unknown", reason: "delivery_unconfirmed: sendgrid_503" });
    expect(sends).toHaveLength(1);
    expect(r).toMatchObject({ success: false, outcome: "outcome_unknown" });
    expect(String(r.note)).toMatch(/Do NOT send it again/);
    expect(String(r.note)).not.toMatch(/was NOT sent/);
  });

  it("a definitive failure still says it was not sent (unchanged)", async () => {
    const { r } = await run({ status: "failed", outcome: "failed", reason: "sendgrid_400" });
    expect(r).toMatchObject({ success: false, outcome: "failed" });
    expect(String(r.note)).toMatch(/was NOT sent/);
  });
});
