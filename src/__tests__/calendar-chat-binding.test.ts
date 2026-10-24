// @vitest-environment node
import { readFileSync } from "node:fs";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { PAIGE_SPINE_CAPABILITIES } from "../../supabase/functions/_shared/paige-spine/registry";
import { readRecordLinks } from "../../supabase/functions/_shared/paige-turn/record-links";
import { isSoloStandalone as uiSolo } from "../lib/tier/tierFeatures";
import { isSoloStandalone as canonicalSolo } from "../../supabase/functions/_shared/solo-classification";
import { workspaceLinkTarget } from "../lib/links/workspaceLinks";

const source = readFileSync("supabase/functions/paige-ai-chat/index.ts", "utf8");
const ast = ts.createSourceFile("chat.ts", source, ts.ScriptTarget.Latest, true);
const branches: ts.Block[] = [];
function visit(node: ts.Node) {
  if (ts.isIfStatement(node) && node.expression.getText(ast) === 'tc.function.name === "read_calendar_booking"' && ts.isBlock(node.thenStatement)) branches.push(node.thenStatement);
  ts.forEachChild(node, visit);
}
visit(ast);
describe("Calendar later-read shared integration", () => {
  it("the frontend keeps the exact canonical predicate binding and original UI semantics", () => {
    expect(uiSolo).toBe(canonicalSolo);
    expect(uiSolo({ account_type: "standalone", parent_tenant_id: null, isPlatformStaff: false })).toBe(true);
    expect(uiSolo({ account_type: "standalone", parent_tenant_id: "", isPlatformStaff: false })).toBe(true);
    expect(uiSolo({ account_type: null, parent_tenant_id: null, isPlatformStaff: false })).toBe(false);
    expect(uiSolo({ account_type: "standalone", parent_tenant_id: "neutral-parent", isPlatformStaff: false })).toBe(false);
  });
  it("registers exactly one read-only member capability over the canonical native reader", () => {
    const capabilities = PAIGE_SPINE_CAPABILITIES.filter(c => c.key === "calendar.booking_read");
    expect(capabilities).toHaveLength(1); expect(capabilities[0]).toMatchObject({ action: { chatTool: "read_calendar_booking", classification: "read", executor: "public.list_team_bookings", seatAuthority: "member", approvalAuthority: "none" } });
  });
  it("has exactly one real Chat dispatch branch consuming the shared reader", () => {
    expect(branches).toHaveLength(1); expect(branches[0].getText(ast)).toContain("readCalendarBooking(");
  });
  it("the existing reference grammar and route map retain a Calendar department link only", () => {
    const links = readRecordLinks([{ destination: "calendar", record_id: "00000000-0000-4000-8000-000000000003", url: "https://foreign.invalid" }]);
    expect(links).toEqual([{ destination: "calendar", record_id: null }]);
    expect(workspaceLinkTarget(links[0], { account_type: "standalone", parent_tenant_id: null, account_number: "7001" })).toEqual({ label: "Open Calendar", to: "/solo/7001/calendar/week", status: "surface_only" });
  });
});
