// Extends the native form processor; writes only to the existing canonical Messages/Threads.
// These are labelledAnswers, not payload_json: the processor excludes sensitive field types.
export function formInquiryBody(answers: Array<{ label: string; value: string }>): string {
  const lines = answers.slice(0, 20).map(({ label, value }) =>
    `${label.replace(/[\r\n\u0000]/g, " ").slice(0, 200)}: ${value.replace(/\u0000/g, "").slice(0, 1000)}`);
  return ["Website form inquiry. The visitor's identity has not been verified.", ...lines].join("\n\n").slice(0, 10000);
}

type Admin = { rpc(name: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: unknown }> };
export async function recordFormInquiry(admin: Admin, input: {
  submissionId: string; submittedEmail: string | null; answers: Array<{ label: string; value: string }>;
}) {
  const result = await admin.rpc("growth_record_form_inquiry", {
    _submission_id: input.submissionId, _submitted_email: input.submittedEmail, _body_text: formInquiryBody(input.answers),
  });
  if (result.error) return { status: "error" as const, result: {}, error: "form_inquiry_record_failed" };
  const row = result.data && typeof result.data === "object" && !Array.isArray(result.data) ? result.data as Record<string, unknown> : null;
  if (row?.ok === true && typeof row.message_id === "string" && row.message_id) return { status: "done" as const, result: { message_id: row.message_id, replayed: row.replayed === true } };
  const skipped = new Set(["form_not_opted_in", "no_contact", "submitted_email_not_contact_email"]);
  if (row?.ok === false && typeof row.reason === "string" && skipped.has(row.reason)) return { status: "done" as const, result: { note: "form_inquiry_not_recorded", reason: row.reason } };
  return { status: "error" as const, result: {}, error: "form_inquiry_record_unconfirmed" };
}
