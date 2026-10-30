import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { parseCommsEmailDraftSource, commsEmailDraftSourcesEqual } from "./draft-source.ts";
const id = "11111111-AAAA-4111-8111-111111111111";
const source = { message_id: id, updated_at: "2026-10-30T20:00:00.123456+00:00" };
describe("original saved email draft identity and native version", () => {
  it("keeps the native version verbatim and canonicalizes only the message UUID", () => {
    const parsed = parseCommsEmailDraftSource(source);
    assert.equal(parsed.message_id, id.toLowerCase()); assert.equal(parsed.updated_at, source.updated_at);
    assert(Object.isFrozen(parsed)); assert.deepEqual(source, { message_id: id, updated_at: source.updated_at });
  });
  it("does not collapse two versions that JavaScript Date cannot distinguish", () => {
    const a = parseCommsEmailDraftSource(source), b = parseCommsEmailDraftSource({ ...source, updated_at: source.updated_at.replace("123456", "123457") });
    assert.equal(new Date(a.updated_at).getTime(), new Date(b.updated_at).getTime());
    assert.equal(commsEmailDraftSourcesEqual(a, b), false);
    assert.equal(commsEmailDraftSourcesEqual(a, parseCommsEmailDraftSource(source)), true);
  });
  it("does not swap a draft or make a legacy call refer to one", () => {
    const a = parseCommsEmailDraftSource(source);
    assert.equal(commsEmailDraftSourcesEqual(a, undefined), false);
    assert.equal(commsEmailDraftSourcesEqual(undefined, a), false);
    assert.equal(commsEmailDraftSourcesEqual(undefined, undefined), true);
    assert.equal(commsEmailDraftSourcesEqual(a, { ...a, message_id: "22222222-2222-4222-8222-222222222222" }), false);
  });
  for (const value of [null, [], "draft", {}, { message_id: id }, { updated_at: source.updated_at },
    { ...source, message_id: "not-an-id" }, { ...source, tenant_id: id }, { ...source, body_html: "<p>Untrusted</p>" },
    { ...source, updated_at: 1 }, { ...source, updated_at: "2026-10-30" }, { ...source, updated_at: "2026-10-30T20:00:00" },
    ...["2026-02-29T20:00:00Z", "2026-13-01T20:00:00Z", "2026-10-00T20:00:00Z", "2026-10-30T24:00:00Z",
      "2026-10-30T20:60:00Z", "2026-10-30T20:00:60Z", "2026-10-30T20:00:00.1234567Z", "2026-10-30T20:00:00+15:00",
      "2026-10-30T20:00:00+14:01", "2026-10-30T20:00:00Z "].map(updated_at => ({ ...source, updated_at })),
  ]) it(`refuses malformed or widened source ${JSON.stringify(value)}`, () => {
    assert.throws(() => parseCommsEmailDraftSource(value), /COMMS_EMAIL_DRAFT_SOURCE_INVALID/);
  });
  for (const updated_at of ["2024-02-29T20:00:00Z", "2026-10-30T20:00:00.1-04:00", "2026-10-30T20:00:00+14:00"]) {
    it(`retains a valid native version ${updated_at}`, () => assert.equal(parseCommsEmailDraftSource({ ...source, updated_at }).updated_at, updated_at));
  }
});
