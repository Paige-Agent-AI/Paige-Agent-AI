import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { operatorLandingFor } from "@/operator/actAs";

// The landing is decided before anything is recorded, so these are the cases where an act-as is
// allowed to begin at all.
describe("operatorLandingFor", () => {
  it("lands a standalone tenant in its Solo workspace", () => {
    expect(operatorLandingFor({ name: "Solo Co", account_type: "standalone", parent_tenant_id: null, account_number: 3855 }))
      .toEqual({ kind: "land", root: "/solo/3855/command-center" });
  });

  it("lands a sub-account in its business workspace", () => {
    expect(operatorLandingFor({ name: "Child", account_type: "sub_account", parent_tenant_id: "p", account_number: 41 }))
      .toEqual({ kind: "land", root: "/business/41/command-center" });
  });

  // The agency shell sends every operator back to the console, so an entry here would be
  // recorded for a workspace nobody could stand in.
  it.each(["agency", "enterprise"])("refuses an %s tenant before anything is recorded", (account_type) => {
    const landing = operatorLandingFor({ name: "Big Co", account_type, parent_tenant_id: null, account_number: 7 });
    expect(landing.kind).toBe("unavailable");
    if (landing.kind === "unavailable") {
      expect(landing.reason).toContain("Big Co");
      expect(landing.reason).toContain("Nothing was entered.");
    }
  });

  it("refuses a tenant whose address cannot be confirmed", () => {
    expect(operatorLandingFor({ name: "No Number", account_type: "standalone", parent_tenant_id: null, account_number: null }).kind)
      .toBe("unavailable");
    // An unknown account type would otherwise fail safe to Solo and be routed as one.
    expect(operatorLandingFor({ name: "Odd", account_type: null, parent_tenant_id: null, account_number: 9 }).kind)
      .toBe("unavailable");
  });

  it("refuses a tenant it cannot find", () => {
    expect(operatorLandingFor(null).kind).toBe("unavailable");
  });
});

// Structural pin, in the style of TenantCommandCenterShell.ownership.test.tsx (AgencyApp is not
// rendered in unit tests). The sub-account shell's only account control used to be "Back to
// {agency}", a link into a route that sends operators to the console while leaving the act-as
// open. An operator here must get the audited exit instead.
describe("the sub-account shell gives an acting operator the audited exit", () => {
  const source = readFileSync(join(__dirname, "../agency/AgencyApp.tsx"), "utf8");
  it("mounts the exit control for platform staff outside agency mode, ahead of the agency link", () => {
    expect(source).toContain('import { WorkspaceExitControl } from "@/components/auth/WorkspaceExitControl";');
    expect(source).toContain("accountControls={!isAgency && isPlatformStaff ? <WorkspaceExitControl /> : isAgency ? (");
  });
});
