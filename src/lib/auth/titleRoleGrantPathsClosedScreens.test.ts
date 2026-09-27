// The screens that hand out access no longer offer the retired title role, and the team screens
// no longer treat someone as special because they hold it. A person's clients are found by
// assignment, and their client-facing profile belongs to every member, not to a role. "Coach"
// stays available as a title a business gives its people; it never authorizes.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(resolve(__dirname, "../../..", path), "utf8");

const codeLines = (path: string) =>
  read(path)
    .split("\n")
    .filter((line) => !line.trim().startsWith("//") && !line.trim().startsWith("*") && !line.trim().startsWith("{/*"));

// The role offered as an option or default, listed, compared, typed, keyed or read.
const ROLE_USE = new RegExp(
  [
    String.raw`value=["']coach["']`,
    String.raw`value:\s*["']coach["']`,
    String.raw`useState(<[^>]*>)?\(\s*["']coach["']\s*\)`,
    String.raw`\?\s*["'][^"']*["']\s*:\s*["']coach["']`,
    String.raw`===?\s*["']coach["']`,
    String.raw`includes\(\s*["']coach["']\s*\)`,
    String.raw`\|\s*["']coach["']`,
    String.raw`["']coach["']\s*\|`,
    String.raw`[\[,]\s*["']coach["']\s*[,\]]`,
    String.raw`\[\s*["']coach["']\s*,\s*["']Coach["']\s*\]`,
    String.raw`^\s*coach:\s*["']`,
  ].join("|"),
);

const SCREENS = [
  "src/components/admin/ManageRolesDialog.tsx",
  "src/components/admin/InviteMemberDialog.tsx",
  "src/components/admin/WorkspaceSettingsPanel.tsx",
  "src/components/admin/MemberProfileDrawer.tsx",
  "src/components/dashboard/ClientManagementDashboard.tsx",
  "src/components/team/MembersRolesPanel.tsx",
  "src/agency/team.tsx",
  "src/agency/data/useAgencyPeople.ts",
];

describe("the screens that hand out access do not offer the retired title role", () => {
  it("no screen offers, lists, types or reads it", () => {
    const offenders = SCREENS.flatMap((path) =>
      codeLines(path)
        .filter((line) => ROLE_USE.test(line))
        .map((line) => `${path}: ${line.trim().slice(0, 100)}`),
    );
    expect(offenders).toEqual([]);
  });

  it("clients are reassigned before removal by assignment, whatever role the person holds", () => {
    const source = read("src/components/team/MembersRolesPanel.tsx");
    const guards = source.match(/\.eq\("assigned_coach_user_id", (revokeTarget|removeTarget)\.user_id\)/g) ?? [];
    expect(guards).toHaveLength(2);
    expect(source).not.toMatch(/roles\.includes\("coach"\)/);
  });
});
