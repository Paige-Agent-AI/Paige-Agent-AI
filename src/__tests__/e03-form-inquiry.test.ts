import { describe, expect, it, vi } from "vitest";
import { formInquiryBody, recordFormInquiry } from "../../supabase/functions/growth-process-submission/inquiry";

describe("native form inquiry consumer", () => {
  it("bounds labelled answers and identifies the visitor's unverified identity", () => {
    const body = formInquiryBody(Array.from({ length: 100 }, (_, i) => ({ label: `Question ${i}\n\0`, value: "x".repeat(2000) })));
    expect(body.length).toBeLessThanOrEqual(10000); expect(body).toContain("identity has not been verified"); expect(body).not.toContain("\0"); expect(body).not.toContain("Question 20");
  });
  it("uses the existing claimed submission, not browser-selected tenant/contact/connector or raw payload", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { ok: true, message_id: "message", replayed: true }, error: null });
    const result = await recordFormInquiry({ rpc }, { submissionId: "submission", submittedEmail: "lead@example.test", answers: [{ label: "Question", value: "When can we talk?" }] });
    expect(result).toEqual({ status: "done", result: { message_id: "message", replayed: true } });
    expect(rpc).toHaveBeenCalledWith("growth_record_form_inquiry", { _submission_id: "submission", _submitted_email: "lead@example.test", _body_text: expect.stringContaining("Question: When can we talk?") });
    expect(rpc.mock.calls[0][1]).not.toHaveProperty("tenant_id"); expect(rpc.mock.calls[0][1]).not.toHaveProperty("contact_id");
  });
  it.each(["form_not_opted_in", "no_contact", "submitted_email_not_contact_email"])("reports the actual skip %s without claiming a message exists", async (reason) => {
    const rpc = vi.fn().mockResolvedValue({ data: { ok: false, reason }, error: null });
    expect(await recordFormInquiry({ rpc }, { submissionId: "submission", submittedEmail: null, answers: [] })).toEqual({ status: "done", result: { note: "form_inquiry_not_recorded", reason } });
  });
  it.each([{ data: null, error: { message: "private detail" } }, { data: null, error: null }, { data: { ok: true }, error: null }, { data: { ok: false, reason: "unrecognized" }, error: null }])("does not complete the existing processor lifecycle without readback %j", async (response) => {
    const result = await recordFormInquiry({ rpc: vi.fn().mockResolvedValue(response) }, { submissionId: "submission", submittedEmail: null, answers: [] });
    expect(result.status).toBe("error"); expect(JSON.stringify(result)).not.toContain("private detail");
  });
});
