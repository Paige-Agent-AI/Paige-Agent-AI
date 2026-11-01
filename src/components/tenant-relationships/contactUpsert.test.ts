import { beforeEach, describe, expect, it, vi } from "vitest";
import { upsertRelationshipContact } from "./contactUpsert";

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));

vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc } }));

describe("People contact upsert adapter", () => {
  beforeEach(() => rpc.mockReset());

  it("passes the server-resolved tenant separately from the allowlisted patch", async () => {
    rpc.mockResolvedValue({ data: "contact-1", error: null });
    await expect(upsertRelationshipContact({
      tenantId: "tenant-1",
      contactId: "contact-1",
      patch: { first_name: "Tashia", contact_methods: [{ kind: "email", value: "tashia@example.test", label: "Work", is_primary: true }], tags: ["hot lead"], do_not_contact: false },
    })).resolves.toBe("contact-1");
    expect(rpc).toHaveBeenCalledWith("upsert_contact", {
      p_patch: { first_name: "Tashia", contact_methods: [{ kind: "email", value: "tashia@example.test", label: "Work", is_primary: true }], tags: ["hot lead"], do_not_contact: false },
      p_contact_id: "contact-1",
      p_tenant_id: "tenant-1",
      p_channel: "manual",
    });
  });

  it("passes the original loaded zone, flag and exact version once without rewriting them", async () => {
    const patch = { timezone: "America/Chicago", timezone_verified: true, expected_timezone: "America/New_York", expected_timezone_verified: false, expected_updated_at: "2026-10-30T18:00:00.123456+00:00" };
    rpc.mockResolvedValue({ data: "contact-1", error: null });
    await upsertRelationshipContact({ tenantId: "tenant-1", contactId: "contact-1", patch });
    expect(rpc).toHaveBeenCalledExactlyOnceWith("upsert_contact", { p_patch: patch, p_contact_id: "contact-1", p_tenant_id: "tenant-1", p_channel: "manual" });
  });

  it("preserves a stale-version refusal without automatically replaying confirmation", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "CONTACT_TIMEZONE_STALE" } });
    await expect(upsertRelationshipContact({ tenantId: "tenant-1", contactId: "contact-1", patch: { timezone: "America/Chicago", timezone_verified: true, expected_timezone: "America/New_York", expected_timezone_verified: false, expected_updated_at: "2026-10-30T18:00:00.123456+00:00" } })).rejects.toThrow("CONTACT_TIMEZONE_STALE");
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("surfaces database authorization and validation failures", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "CONTACT_FORBIDDEN" } });
    await expect(upsertRelationshipContact({ tenantId: "tenant-1", patch: { first_name: "Nope" } }))
      .rejects.toThrow("CONTACT_FORBIDDEN");
  });
});
