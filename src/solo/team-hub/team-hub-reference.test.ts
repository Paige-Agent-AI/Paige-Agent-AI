import { describe, expect, it } from "vitest";
import { parseTeamHubMessageReference, parseTeamHubReferenceSearch } from "./team-hub-contract";
import { readRecordLinks } from "../../../supabase/functions/_shared/paige-turn/record-links";
import { workspaceLinkTarget } from "@/lib/links/workspaceLinks";

const MESSAGE = "e8000000-0000-4000-8000-0000000a0001";
const ROOT = "e8000000-0000-4000-8000-0000000b0001";
const CHANNEL = "e8000000-0000-4000-8000-0000000c0001";
const CURSOR = "e8000000-0000-4000-8000-0000000a0002";
const TIME = "2026-10-20T09:10:11.123456+00:00";
const root = () => ({ ok: true, channel_id: CHANNEL, thread_root_id: MESSAGE, message_id: MESSAGE, cursor: null });
const reply = () => ({ ...root(), thread_root_id: ROOT, cursor: { id: CURSOR, created_at: TIME } });

describe("original Team Hub source references", () => {
  it("recognizes one UUID route reference and leaves ordinary Team Hub navigation alone", () => {
    expect(parseTeamHubReferenceSearch("?filter=mine")).toEqual({ kind: "none" });
    expect(parseTeamHubReferenceSearch(`?message=${MESSAGE.toUpperCase()}`)).toEqual({ kind: "reference", id: MESSAGE });
    for (const query of ["?message=", "?message=unknown", `?message=%20${MESSAGE}`, `?message=${MESSAGE}&message=${ROOT}`, "?message=https://foreign.invalid"]) {
      expect(parseTeamHubReferenceSearch(query)).toEqual({ kind: "invalid" });
    }
  });
  it("keeps only original message identity, never supplied address, account, private name or text", () => {
    const links = readRecordLinks([{ destination: "team_hub", record_id: MESSAGE, url: "https://foreign.invalid",
      account: 999, subject: "PRIVATE CHANNEL", body: "PRIVATE BODY" }]);
    expect(links).toEqual([{ destination: "team_hub", record_id: MESSAGE }]);
    for (const account_number of [42, 84]) {
      expect(workspaceLinkTarget(links[0], { account_type: "standalone", parent_tenant_id: null, account_number }))
        .toEqual({ label: "Open Team Hub", to: `/solo/${account_number}/team-hub?message=${MESSAGE}`, status: "exact" });
    }
  });
  it("drops malformed identities and inappropriate record kinds instead of offering a vague link", () => {
    for (const record_id of [null, "", "not-a-uuid", `${MESSAGE}&message=${ROOT}`]) {
      expect(readRecordLinks([{ destination: "team_hub", record_id }])).toEqual([]);
      expect(workspaceLinkTarget({ destination: "team_hub", record_id }, { account_type: "standalone", parent_tenant_id: null, account_number: 42 })).toBeNull();
    }
    expect(readRecordLinks([{ destination: "team_hub", record_id: MESSAGE, record_kind: "planning_item" }])).toEqual([]);
    for (const account_type of ["agency", "enterprise", "sub_account", "operator"]) {
      expect(workspaceLinkTarget({ destination: "team_hub", record_id: MESSAGE }, { account_type, parent_tenant_id: null, account_number: 42 })).toBeNull();
    }
  });
  it("accepts a root reference only for the requested original message and strips extra fields", () => {
    expect(parseTeamHubMessageReference({ ...root(), body: "PRIVATE BODY", tenant_id: "foreign" }, null, MESSAGE)).toEqual({
      kind: "ok", value: { channelId: CHANNEL, rootId: MESSAGE, messageId: MESSAGE, cursor: null },
    });
    expect(parseTeamHubMessageReference(root(), null, ROOT)).toEqual({ kind: "unavailable" });
  });
  it("preserves the native old-reply cursor including all six fractional digits", () => {
    expect(parseTeamHubMessageReference(reply(), null, MESSAGE)).toEqual({ kind: "ok", value: {
      channelId: CHANNEL, rootId: ROOT, messageId: MESSAGE, cursor: { id: CURSOR, created_at: TIME },
    } });
  });
  it("refuses malformed reference/cursor envelopes and distinguishes native denial from transport loss", () => {
    for (const data of [null, [], { ...root(), ok: "true" }, { ...root(), channel_id: "foreign" },
      { ...root(), cursor: {} }, { ...reply(), cursor: null }, { ...reply(), cursor: { id: "bad", created_at: TIME } },
      { ...reply(), cursor: { id: CURSOR, created_at: "1" } }, { ...reply(), cursor: { id: CURSOR, created_at: "not-time" } }]) {
      expect(parseTeamHubMessageReference(data, null, MESSAGE)).toEqual({ kind: "unavailable" });
    }
    expect(parseTeamHubMessageReference({ ok: false, code: "not_found", body: "PRIVATE" }, null, MESSAGE))
      .toEqual({ kind: "refused", code: "not_found" });
    expect(parseTeamHubMessageReference(root(), { message: "lost" }, MESSAGE)).toEqual({ kind: "unavailable" });
  });
});
