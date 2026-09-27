// The retired title role makes no one assignable. The contact, deal and reassignment pickers read the
// caller's own workspace roster through one helper, and offer only admins; nobody is listed because
// they hold the platform-wide `coach` role.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(resolve(__dirname, "../../..", path), "utf8");

const PICKERS = [
  "src/components/admin/contacts/NewContactDialog.tsx",
  "src/components/admin/pipeline/DealDrawer.tsx",
  "src/components/admin/pipeline/NewDealDialog.tsx",
  "src/components/admin/ReassignCoachDialog.tsx",
  "src/pages/admin/ContactsAdmin.tsx",
  "src/pages/admin/PipelineAdmin.tsx",
  "src/pages/admin/ContactDetail.tsx",
];

describe("the retired coach role makes no one assignable", () => {
  it("offers only admins from the workspace roster", async () => {
    // Resolved at run time so the other test still runs where the helper does not exist yet.
    const helperPath = resolve(__dirname, "../team/assignableStaff.ts");
    const helper = await import(/* @vite-ignore */ helperPath).catch(() => null);
    expect(helper, "the shared assignee helper exists").not.toBeNull();
    const { toAssignableStaff } = helper as typeof import("../team/assignableStaff");
    const staff = toAssignableStaff([
      { user_id: "a", full_name: "Avery", roles: ["admin"] },
      { user_id: "b", full_name: "Blake", roles: ["coach"] },
      { user_id: "c", full_name: null, roles: ["super_admin"] },
      { user_id: "d", full_name: "Dana", roles: null },
    ]);
    expect(staff).toEqual([
      { user_id: "a", name: "Avery" },
      { user_id: "c", name: "Unnamed member" },
    ]);
  });

  it("no picker lists people by the retired role", () => {
    const offenders = PICKERS.filter((path) => {
      const src = read(path);
      return /\.eq\(\s*["']role["'],\s*["']coach["']\s*\)/.test(src) || !src.includes("loadAssignableStaff()");
    });
    expect(offenders).toEqual([]);
  });
});
