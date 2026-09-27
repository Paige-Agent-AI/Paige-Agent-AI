import { AnimatePresence } from "framer-motion";
import { useTenantContext } from "@/hooks/useTenantContext";
import { canOwnSubaccounts } from "@/lib/agency/accountCapabilities";
import { AgentRail } from "./AgentRail";
import { CommandLauncher } from "./CommandLauncher";
import { resolveAgentPersona, type AgentAccountType, type AgentPersona } from "./persona";

/**
 * AgentPresence — the single integration point for the Paige presence chrome
 * (Wave 4 Slice 4a.1). Mounts the docked right-rail + the universal ⌘K launcher and
 * feeds them the account-type-aware persona (spec §5a). Host shells (AdminLayout
 * now; AgencyLayout in a fast-follow) render this once, inside
 * {@link AgentPresenceProvider}, on their AUTH-GATED, non-Studio surfaces.
 *
 * ACCOUNT-TYPE derivation is PRESENTATION-ONLY (§9): it never authorizes anything —
 * the real tenant/operator boundary is server-side (RLS + PlatformStaffOnly). It only
 * picks which chrome/identity the rail shows:
 *   • Platform operator, either tier, with no active tenant → platform_operator → "Paige Operator"
 *   • active tenant is a top-level agency/enterprise → agency (scope-switcher slot)
 *   • active tenant has a parent → sub_account (identical rail to solo, spec §5a)
 *   • otherwise → solo
 *
 * VP-persona binding is a SEAM (persona.ts): the default identity is resolved here;
 * a tenant-authored Playbook persona (§7) or a later VP binding overrides via props
 * with NO change to the rail.
 */

export interface AgentPresenceProps {
  /**
   * Override the resolved persona (e.g. a tenant-authored Playbook persona, §7).
   * Absent → the platform default for the derived account type (persona.ts seam).
   */
  persona?: AgentPersona;
  /** The chat "ask" seam handed to the launcher (spec §11 non-goal — wired later). */
  onAsk?: (text: string) => void;
  /**
   * Host top-bar height in rem, forwarded to the rail so it docks BELOW the host
   * header (no overlap / no z-fight, §39 S1). Default 0 = full-height for a host with
   * no top bar.
   */
  topOffsetRem?: number;
  /**
   * "Paige has active, open work right now" (from {@link useIsPaigeActive}). Gates
   * ONLY the docked rail: when false the rail is UNMOUNTED (hide-when-idle, owner
   * ruling b) via {@link AnimatePresence} so it gets a fade+slide exit; when true it
   * mounts with the matching enter. The universal ⌘K launcher is NEVER gated on this
   * — it stays reachable from every authenticated surface (§36/§58). Default false.
   */
  isPaigeActive?: boolean;
}

function deriveAccountType(args: {
  isPlatformStaff: boolean;
  activeTenantId: string | null;
  activeTenant: { account_type: string; parent_tenant_id: string | null } | null;
}): AgentAccountType {
  const { isPlatformStaff, activeTenantId, activeTenant } = args;
  // God/platform tier: platform staff operating with NO tenant selected (mirrors
  // AdminLayout's `godMode`). Presentation-only — server-side gates are authoritative.
  if (isPlatformStaff && activeTenantId === null) return "platform_operator";
  if (activeTenant) {
    // §51 invariant: a child (parent_tenant_id set) is NEVER an agency. Check parent first.
    if (activeTenant.parent_tenant_id) return "sub_account";
    // §18: parent-capable check via the ONE shared predicate (not a re-inlined literal).
    if (canOwnSubaccounts(activeTenant.account_type)) return "agency";
  }
  return "solo";
}

export function AgentPresence({ persona, onAsk, topOffsetRem, isPaigeActive = false }: AgentPresenceProps) {
  const { isPlatformStaff, activeTenantId, activeTenant } = useTenantContext();

  const accountType = deriveAccountType({ isPlatformStaff, activeTenantId, activeTenant });
  const resolvedPersona = persona ?? resolveAgentPersona(accountType);

  return (
    <>
      {/* Hide-when-idle (owner ruling b): the docked rail mounts ONLY when Paige has
          active work, so an idle surface is uncluttered (§36 — its absence genuinely
          means "Paige idle", the signal being real dept action state). AnimatePresence
          gives the mount/unmount a subtle enter/exit (the rail owns the actual
          fade+slide + reduced-motion guard — see AgentRail's motion.aside). The gutter
          reservation in the host shell is driven off the SAME `isPaigeActive` so mount
          and padding can never disagree. */}
      <AnimatePresence>
        {isPaigeActive && (
          <AgentRail
            key="agent-rail"
            persona={resolvedPersona}
            accountType={accountType}
            topRem={topOffsetRem}
            // Agency scope-switcher slot (spec §5a / owed-work #7) wires in a later slice.
            // Left undefined here so only agency-parent operators ever see the slot, and
            // the rail stays identical for solo/sub-account (spec §5a).
            scopeSwitcher={undefined}
          />
        )}
      </AnimatePresence>
      {/* The universal ⌘K launcher is NEVER gated on presence — it is reachable from
          every authenticated surface regardless of whether Paige has open work
          (§36 power-user pattern; gating it would be a §58 capability removal). */}
      <CommandLauncher persona={resolvedPersona} onAsk={onAsk} />
    </>
  );
}
