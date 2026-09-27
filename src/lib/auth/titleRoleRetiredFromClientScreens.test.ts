// The retired title role grants nothing in the client, team and relationship screens. A person holding
// the platform-wide `coach` role is not staff in the client dashboard, cannot create or edit contacts
// in the relationships workspace, does not manage team presence or reach the team floor through the
// role, and is not offered as an assignee for contacts or support tickets. The Solo shell names a
// non-owner a member, never a coach.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { soloShellRole } from "@/solo/shell-role";

const read = (path: string) => readFileSync(resolve(__dirname, "../../..", path), "utf8");

const FILES = [
  "src/components/tenant-relationships/TenantRelationshipsClientsWorkspace.tsx",
  "src/components/tenant-relationships/PeopleContactEditor.tsx",
  "src/components/dashboard/ClientManagementDashboard.tsx",
  "src/components/support/AdminTicketPanel.tsx",
  "src/components/tenant-shell/TenantCommandCenterShell.tsx",
  "src/pages/admin/TeamHub.tsx",
  "src/pages/admin/conversations/ContactCardRail.tsx",
  "src/solo/shell-role.ts",
];

// A gate, a staff check, an assignee filter or a role label that names the retired role.
const ROLE_READ = /includes\(\s*["']coach["']\s*\)|allow=\{\[[^\]]*["']coach["']|\[[^\]]*["']coach["'][^\]]*\]\.includes|new Set\(\[[^\]]*["']coach["']|\.in\(\s*["']role["'],\s*\[[^\]]*["']coach["']|\|\s*["']coach["']|return\s+["']coach["']|\?\s*["']admin["']\s*:\s*["']coach["']/;

// Data values, not authority: the contact-assignment seat named "coach" (a grant path, slice 3).
const EXEMPT = [/p_role: "coach"/];

describe("the retired coach role grants nothing in the client, team and relationship screens", () => {
  it("is read by none of the gates", () => {
    const offenders = FILES.flatMap((path) =>
      read(path)
        .split("\n")
        .map((line, i) => ({ line, at: `${path}:${i + 1}` }))
        .filter(({ line }) => !line.trim().startsWith("//") && !line.trim().startsWith("*"))
        .filter(({ line }) => ROLE_READ.test(line) && !EXEMPT.some((re) => re.test(line)))
        .map(({ at }) => at),
    );
    expect(offenders).toEqual([]);
  });

  it("names a non-owner a member in the Solo shell", () => {
    const active = { tenant: "t-1", user: "u-1", owner: false, admin: true };
    expect(soloShellRole(active, "t-1", "u-1")).toBe("member");
    expect(soloShellRole(null, "t-1", "u-1")).toBe("member");
    expect(soloShellRole({ ...active, owner: true }, "t-1", "u-1")).toBe("admin");
  });
});
