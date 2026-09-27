// The retired title role grants nothing in the app. "Coach" is a title a business gives its people; a
// person holding the platform-wide `coach` role is not staff, gets no staff view, no plan bypass and no
// staff landing. Only the admin role (and the platform roles) count.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      getUser: () => Promise.resolve({ data: { user: { id: "u-titled" } } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
    },
    from: () => ({ select: () => ({ eq: () => Promise.resolve({ data: [{ role: "coach" }] }) }) }),
  },
}));

import { useUserRoles } from "@/hooks/useUserRoles";
import { PERSONA_PRECEDENCE, ROLE_TO_PERSONA, resolvePersona } from "@/lib/roleViews/commandCenterRegistry";

const read = (path: string) => readFileSync(resolve(__dirname, "../../..", path), "utf8");

describe("the retired coach role grants nothing in the shared auth hooks and contexts", () => {
  it("does not make a person staff", async () => {
    let seen: ReturnType<typeof useUserRoles> | null = null;
    function Harness() {
      seen = useUserRoles();
      return null;
    }
    const host = document.createElement("div");
    const root = createRoot(host);
    await act(async () => {
      root.render(createElement(Harness));
    });
    await act(async () => {
      await new Promise((settle) => setTimeout(settle, 0));
    });
    const state = seen as ReturnType<typeof useUserRoles> | null;
    expect(state?.loading).toBe(false);
    expect(state?.roles).toEqual(["coach"]);
    expect(state?.isStaff).toBe(false);
    expect(state).not.toHaveProperty("isCoach");
    act(() => root.unmount());
  });

  it("does not choose a command-center view", () => {
    expect(ROLE_TO_PERSONA).not.toHaveProperty("coach");
    expect(PERSONA_PRECEDENCE).not.toContain("coach");
    expect(resolvePersona(["coach"], false).id).toBe("viewer");
  });

  it("is read by none of the staff checks", () => {
    const files = [
      "src/hooks/useUserRoles.ts",
      "src/contexts/DashboardModeContext.tsx",
      "src/contexts/SubscriptionContext.tsx",
      "src/lib/auth/resolveLandingRoute.ts",
      "src/components/auth/ClientOnlyRouteGuard.tsx",
      "src/pages/GoogleCalendarCallback.tsx",
      "src/pages/admin/analytics/sections/PaigeContributionSection.tsx",
      "src/components/dashboard/PaigeAIChat.tsx",
      "src/components/app/AppNav.tsx",
    ];
    const offenders = files.filter((file) => /["']coach["']|isCoach/.test(read(file)));
    expect(offenders).toEqual([]);
  });
});
