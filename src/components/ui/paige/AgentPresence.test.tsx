// §32.b render-across-tiers smoke for the Wave 4 Slice 4a.1 agent-presence chrome.
//
// The doctrine-load-bearing behavior this asserts:
//   • the rail RENDERS WITHOUT THROWING as each account type (spec §5a: Solo,
//     Sub-account, Agency, Super Admin) — the §32.b "renders correctly across the
//     four tenant-type surfaces" leg, headless;
//   • the Super Admin surface gets the DISTINCT "Paige Operator" identity + operator
//     chip and is never confused with a tenant's Paige (spec §5a);
//   • account-type derivation honors the §51 invariant (a parented tenant is NEVER
//     an agency, even if mislabeled account_type='agency');
//   • the persona seam is §2-clean (no finance/credit wording) and the VP binding is
//     left UNBOUND by default (open owner decision — persona.ts).
//
// Rendering uses react-dom/server (RTL is not installed — adding a dep is a §14
// proposal, not a reflex), matching the sibling PaigeAttribution.test.tsx. Static
// markup is enough to assert identity, the operator hint, and token/§2 discipline.
// The Studio-hidden + marketing-excluded legs are STRUCTURAL (the chrome is only
// mounted in AdminLayout, and there only when !isStudio) and are verified by reading
// the mount site, not driven here (see the PR body's §32.b table + §32.c owed drive).
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect, beforeAll, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { AgentPresenceProvider } from "./AgentPresenceContext";
import { AgentRail } from "./AgentRail";
import { AgentPresence } from "./AgentPresence";
import { resolveAgentPersona, type AgentAccountType } from "./persona";

// Mutable tenant-context mock (hoisted so vi.mock's factory can close over it).
// A single mock keeps ONE module graph → provider + consumer share one context
// instance (dynamic re-import would split the context and throw).
const tc = vi.hoisted(() => ({
  ctx: null as null | {
    isPlatformStaff: boolean;
    activeTenantId: string | null;
    activeTenant: { account_type: string; parent_tenant_id: string | null } | null;
  },
}));
vi.mock("@/hooks/useTenantContext", () => ({
  useTenantContext: () => ({
    loading: false,
    isPlatformOwner: tc.ctx?.isPlatformStaff ?? false,
    isPlatformStaff: tc.ctx?.isPlatformStaff ?? false,
    tenants: [],
    activeTenantId: tc.ctx?.activeTenantId ?? null,
    activeTenant: tc.ctx?.activeTenant ?? null,
    switchTenant: async () => true,
    refresh: async () => {},
  }),
}));

// jsdom doesn't implement matchMedia; framer-motion's useReducedMotion reads it.
// Stub it so the static render is deterministic (reduced-motion OFF).
beforeAll(() => {
  if (!window.matchMedia) {
    // @ts-expect-error test stub
    window.matchMedia = () => ({
      matches: false,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
    });
  }
});

const ACCOUNT_TYPES: AgentAccountType[] = ["solo", "sub_account", "agency", "platform_operator"];

// Render the rail in its EXPANDED panel state so identity/operator-chip/body
// assertions can read the expanded content. `hasChatBody` engages the onboarding
// docked-open (SESSION_COUNT starts at 0 in a static render — no useEffect runs to
// increment it — so priorCount 0 < 3 → expanded). See the separate default-collapsed
// test below for the no-chat-body (collapsed) default.
const railHtml = (t: AgentAccountType) =>
  renderToStaticMarkup(
    <AgentPresenceProvider hasChatBody>
      <AgentRail persona={resolveAgentPersona(t)} accountType={t} />
    </AgentPresenceProvider>,
  );

describe("resolveAgentPersona seam", () => {
  it("gives every tenant-facing type the neutral 'Paige' identity, VP UNBOUND (open decision)", () => {
    for (const t of ["solo", "sub_account", "agency"] as AgentAccountType[]) {
      const p = resolveAgentPersona(t);
      expect(p.label).toBe("Paige");
      expect(p.operator).toBeFalsy();
      // The VP-remit authority is unresolved — the default MUST NOT bind a VP.
      expect(p.vp).toBeUndefined();
    }
  });

  it("gives Super Admin the distinct 'Paige Operator' identity (spec §5a)", () => {
    const p = resolveAgentPersona("platform_operator");
    expect(p.label).toBe("Paige Operator");
    expect(p.operator).toBe(true);
    expect(p.vp).toBeUndefined();
  });

  it("carries no finance/credit wording in any default persona (§2)", () => {
    const banned = /credit|funding|lend|loan|financ|fico|lender/i;
    for (const t of ACCOUNT_TYPES) {
      const p = resolveAgentPersona(t);
      expect(banned.test(p.label)).toBe(false);
      expect(banned.test(p.tagline)).toBe(false);
    }
  });
});

describe("<AgentRail> renders across the four account-type surfaces (§32.b)", () => {
  it("renders without throwing as every account type", () => {
    for (const t of ACCOUNT_TYPES) {
      expect(() => railHtml(t)).not.toThrow();
      expect(railHtml(t).length).toBeGreaterThan(0);
    }
  });

  it("shows the tenant identity for Solo / Sub-account / Agency and NO operator chip", () => {
    for (const t of ["solo", "sub_account", "agency"] as AgentAccountType[]) {
      const out = railHtml(t);
      expect(out).toContain("Paige");
      expect(out).toContain("Your team, on call");
      // The accent-bordered "Operator" chip must NOT appear on a tenant surface.
      expect(out).not.toContain(">Operator<");
    }
  });

  it("shows the distinct 'Paige Operator' identity + operator chip for Super Admin (spec §5a)", () => {
    const out = railHtml("platform_operator");
    expect(out).toContain("Paige Operator");
    expect(out).toContain("Fleet-wide operations");
    expect(out).toContain(">Operator<");
  });

  it("renders a crafted presence body, never a raw blank (§11/§25)", () => {
    const out = railHtml("solo");
    expect(out).toContain("Your Paige team is on call");
  });
});

describe("<AgentPresence> account-type derivation across tiers (§51-aware)", () => {
  it("derives the right persona for each tier — and a parented tenant is NEVER an agency (§51)", async () => {
    // Mock the tenant context per tier and assert the rendered identity. This is the
    // derivation leg of §32.b: the same code path produces the correct surface for
    // God / Agency / Sub-account / Solo.
    const cases: Array<{
      name: string;
      ctx: {
        isPlatformStaff: boolean;
        activeTenantId: string | null;
        activeTenant: { account_type: string; parent_tenant_id: string | null } | null;
      };
      expectLabel: string;
      expectOperator: boolean;
    }> = [
      {
        name: "God / platform tier",
        ctx: { isPlatformStaff: true, activeTenantId: null, activeTenant: null },
        expectLabel: "Paige Operator",
        expectOperator: true,
      },
      {
        name: "Agency parent",
        ctx: {
          isPlatformStaff: false,
          activeTenantId: "t-agency",
          activeTenant: { account_type: "agency", parent_tenant_id: null },
        },
        expectLabel: "Paige",
        expectOperator: false,
      },
      {
        name: "Sub-account (mislabeled account_type='agency' but PARENTED → still sub_account, §51)",
        ctx: {
          isPlatformStaff: false,
          activeTenantId: "t-sub",
          activeTenant: { account_type: "agency", parent_tenant_id: "t-parent" },
        },
        expectLabel: "Paige",
        expectOperator: false,
      },
      {
        name: "Solo standalone",
        ctx: {
          isPlatformStaff: false,
          activeTenantId: "t-solo",
          activeTenant: { account_type: "standalone", parent_tenant_id: null },
        },
        expectLabel: "Paige",
        expectOperator: false,
      },
    ];

    for (const c of cases) {
      tc.ctx = c.ctx;
      // hasChatBody → expanded panel so the operator chip is in the markup to assert.
      // isPaigeActive → force the rail MOUNTED: hide-when-idle (owner ruling b) gates the
      // rail off when Paige is idle, so the persona-derivation assertions must render it
      // with active work present (the idle/hidden path is covered by the block below).
      const out = renderToStaticMarkup(
        <AgentPresenceProvider hasChatBody>
          <AgentPresence isPaigeActive />
        </AgentPresenceProvider>,
      );
      expect(out, c.name).toContain(c.expectLabel);
      expect(out.includes(">Operator<"), c.name).toBe(c.expectOperator);
    }
  });
});

describe("hide-when-idle: the rail mounts ONLY when Paige has active work (owner ruling b)", () => {
  it("renders NO rail (empty presence) when isPaigeActive is false — the ⌘K launcher stays", () => {
    // God tier so, if the rail DID mount, "Paige Operator" would appear — asserting its
    // ABSENCE proves the idle gate hides the whole rail (not just its content).
    tc.ctx = { isPlatformStaff: true, activeTenantId: null, activeTenant: null };
    const out = renderToStaticMarkup(
      <AgentPresenceProvider hasChatBody>
        <AgentPresence />
      </AgentPresenceProvider>,
    );
    expect(out).not.toContain("Paige Operator");
    expect(out).not.toContain("Your team, on call");
    // (⌘K launcher survival across idle is asserted structurally by the source-read test
    // below — it is never gated on presence, §58.)
  });

  it("renders the rail when isPaigeActive is true", () => {
    tc.ctx = { isPlatformStaff: true, activeTenantId: null, activeTenant: null };
    const out = renderToStaticMarkup(
      <AgentPresenceProvider hasChatBody>
        <AgentPresence isPaigeActive />
      </AgentPresenceProvider>,
    );
    expect(out).toContain("Paige Operator");
  });
});

describe("default-collapsed until a chat body is wired (§39 Compliance#1/Critic#2)", () => {
  it("renders the COLLAPSED presence tab (not the docked-open panel) with no chat body", () => {
    // Provider default hasChatBody=false → onboarding docked-open is gated OFF → the
    // rail must render the collapsed tab, never the expanded empty placeholder.
    const out = renderToStaticMarkup(
      <AgentPresenceProvider>
        <AgentRail persona={resolveAgentPersona("solo")} accountType="solo" />
      </AgentPresenceProvider>,
    );
    // Collapsed tab exposes aria-expanded="false" and the "Open …" affordance…
    expect(out).toContain('aria-expanded="false"');
    expect(out).toContain("Open Paige");
    // …and does NOT paint the expanded body placeholder (that only shows when open).
    expect(out).not.toContain("Your Paige team is on call");
  });

  it("DOES dock open once a chat body is present (onboarding window, §36)", () => {
    const out = renderToStaticMarkup(
      <AgentPresenceProvider hasChatBody>
        <AgentRail persona={resolveAgentPersona("solo")} accountType="solo" />
      </AgentPresenceProvider>,
    );
    expect(out).toContain("Your Paige team is on call");
  });
});

describe("⌘K is a single global owner — IntegrationsHub no longer registers one (§39 B1/§37)", () => {
  it("IntegrationsHub source registers NO global keydown listener (⌘K handed to the launcher)", () => {
    const src = readFileSync(
      resolve(process.cwd(), "src/pages/admin/IntegrationsHub.tsx"),
      "utf8",
    );
    // The hub's rival global ⌘K listener was removed (§18 one home). Assert there is no
    // window keydown registration left in the file — the palette is button-driven now.
    expect(src).not.toMatch(/addEventListener\(\s*["']keydown["']/);
    expect(src).not.toContain("setPaletteOpen((o) => !o)");
  });

  it("the universal launcher context owns exactly one ⌘K keydown handler", () => {
    const src = readFileSync(
      resolve(process.cwd(), "src/components/ui/paige/AgentPresenceContext.tsx"),
      "utf8",
    );
    const matches = src.match(/addEventListener\(\s*["']keydown["']/g) ?? [];
    expect(matches.length).toBe(1);
  });
});
