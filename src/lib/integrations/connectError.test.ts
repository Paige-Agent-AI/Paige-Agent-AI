import { describe, expect, it } from "vitest";
import { resolveFunctionError } from "./connectError";

/**
 * The point of a stable error code is that each one has a DIFFERENT next step. When
 * every code collapses into "please try again in a moment", the codes may as well not
 * exist — and for two of these, that generic line is not merely unhelpful but wrong:
 *
 *   • `number_unavailable` — retrying is the one thing that will never work.
 *   • `number_bought_but_record_failed` — the number WAS bought and IS being billed.
 *     "Didn't complete, try again" invites a second purchase of a second number.
 */
const invokeError = (status: number) =>
  Object.assign(new Error("Edge Function returned a non-2xx status code"), { status });
/** The REAL non-2xx transport: supabase-js puts the body on FunctionsHttpError.context. */
const httpError = (status: number, body: unknown) =>
  Object.assign(new Error("Edge Function returned a non-2xx status code"), {
    status, context: { json: async () => body },
  });

describe("structured errors reach their copy", () => {
  it.each([403, 503])("keeps an unconfirmed sending-domain attempt out of generic retry advice (%s)", async (status) => {
    const { code, message } = await resolveFunctionError({
      error: httpError(status, { error: "domain_operation_unconfirmed", operation_outcome: "unconfirmed", message: "untrusted server sentence" }),
      data: null, action: "remove your sending domain",
    });
    expect(code).toBe("domain_operation_unconfirmed");
    expect(message).toContain("Don’t repeat"); expect(message).toContain("workspace where you started");
    expect(message).toContain("current sending-domain state");
    expect(message).not.toContain("try again in a moment"); expect(message).not.toContain("untrusted server sentence");
  });
  it("reads a plain string code", async () => {
    const { code, message } = await resolveFunctionError({
      error: invokeError(409), data: { error: "number_unavailable" }, action: "buy that number",
    });
    expect(code).toBe("number_unavailable");
    expect(message).toContain("taken while you were looking at it");
    expect(message).not.toContain("try again in a moment");
  });

  it("reads a NESTED {code, message} code, which the A2P functions actually return", async () => {
    // This is the shape `comms-a2p-draft` and `comms-a2p-submit` document and emit.
    // Reading only the string form dropped every one of their refusals on the floor.
    const { code, message } = await resolveFunctionError({
      error: invokeError(422),
      data: { error: { code: "LEGAL_PROFILE_REQUIRED", message: "Add your legal business name first." } },
      action: "draft your registration",
    });
    expect(code).toBe("LEGAL_PROFILE_REQUIRED");
    expect(message).toContain("legal business name");
    expect(message).not.toContain("try again in a moment");
  });

  it("NEVER tells someone to retry a purchase that already charged them", async () => {
    const { message } = await resolveFunctionError({
      error: invokeError(500), data: { error: "number_bought_but_record_failed" }, action: "buy that number",
    });
    expect(message).toContain("being billed");
    expect(message).toContain("Don’t buy another");
    expect(message).not.toMatch(/try again/i);
  });

  it("still falls back generically for a code it has never seen", async () => {
    const { message } = await resolveFunctionError({
      error: invokeError(500), data: { error: "some_code_nobody_has_written_copy_for" }, action: "buy that number",
    });
    expect(message).toContain("try again in a moment");
  });

  it("does not surface the server's own sentence, only our copy", async () => {
    // Through the real non-2xx transport this time — `data` is null on a 422 and the
    // body arrives on the error's context. Covering only the parsed-onto-data shape
    // would prove nothing about the path production actually takes.
    const { message } = await resolveFunctionError({
      error: httpError(422, { error: { code: "MISSING_SAMPLES", message: "sample_messages[] must be non-empty (raw)" } }),
      data: null,
      action: "save your registration",
    });
    expect(message).not.toContain("sample_messages[]");
    expect(message).toContain("sample message");
  });
});
