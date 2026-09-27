// @ts-nocheck
// Agency pack — the faithful shell chrome. Owner-locked port of the Claude Design
// "CRM agency mode" pack (§28/§63 — "We do not drift off this whatsoever"),
// mirroring src/solo/SoloApp.tsx (the Solo shell precedent) for the Agency design.
//
// Source of truth: "Agency Shell.dc.html" — the two-group Rail (MAIN + PLATFORM),
// the header identity/breadcrumb + account SWITCHER + account/profile MENU + theme
// toggle + Ask-Paige + Help + notifications, the acting-banner, and the FOUR remaining
// chrome pop-outs (switcher popover · account menu · 3-step provisioning wizard ·
// Help drawer). Ask Paige now expands the v3 shell's single PAIGE workspace. The
// DCLogic runtime is NOT ported — its markup,
// measurements, copy, and interaction are mirrored onto React + the ./_shared
// primitives (Modal/Popover/SlideOut carry portal/focus-trap/Esc/reduced-motion).
//
// THIS PASS mounts nothing (no Admin.tsx edit, no flag) and every SCREEN renders a
// faithful <Stub/> — the real screen modules (Command Center, Paige, Team, Setup, …)
// are later sub-passes wired into the same `screens` registry.
//
// §51 INVARIANT — a sub-account is NEVER the parent aggregate. In mode="subaccount"
// the switcher, the acting-banner, the "return to agency view" path, and the whole
// act-as machinery are STRUCTURALLY absent: `acting` can never leave null (no UI
// path sets it), and the switcher/banner branches are gated on `isAgency` so their
// code is unreachable. A sub-account owner sees only their own book.
import React from "react";
import { useNavigate, useParams } from "react-router-dom";
import { WorkspaceExitControl } from "@/components/auth/WorkspaceExitControl";
import { useTheme } from "next-themes";
import { performSignOut } from "@/lib/auth/signOut";
import { branchBySlug, branchByKey, branchPath, defaultBranchSlug } from "@/lib/routing/tierBranches";
import { useSubtabRoute } from "@/lib/routing/useSubtabRoute";
import { useTenantContext } from "@/hooks/useTenantContext";
import { supabase } from "@/integrations/supabase/client";
import "./agency-tokens.css";
import { Ic, Logo, Avatar, Wrap, PageHead, Modal, Popover, SlideOut, AV } from "./_shared";
import { tmInit } from "./TeamBlock";
import { GREEN, AMBER } from "./fixtures";
// §65 Option B (B1a) — real agency identity + real sub-account roster. These THIN
// adapters wrap the EXISTING RLS-safe seams (agency_portfolio_metrics /
// agency_list_my_subaccounts / agency_my_membership), session-scoped by auth.uid()
// — never a client-supplied tenant_id (§9/§51). The design markup is byte-identical
// (§28/§63): only the DATA source swaps from fixtures to these hooks.
import { useAgencyMetrics } from "./data/useAgencyMetrics";
import { useAgencyRoster } from "./data/useAgencyRoster";
// §18 one home — health-bucket→dot + the deterministic per-sub swatch are shared
// with the Clients-hub Directory (B1b) via ./data/rosterFormat, not re-derived here.
import { healthDot, swatchFor } from "./data/rosterFormat";
// ── Screen modules (Slice 1b-2 wired the first MAIN group; the rest land in
// 1b-3..5 into the same `screens` registry below) ───────────────────────────
import CommandCenter from "./CommandCenter";
import PaigeHub from "./paige";
import TrustCompass from "./compass";
import AutomationsHub from "./automations";
import { TenantRelationshipsClientsWorkspace } from "@/components/tenant-relationships/TenantRelationshipsClientsWorkspace";
import { isLegacyRelationshipOwner } from "@/components/tenant-relationships/workspaceModel";
import ClientsHub from "./clients";
import { TenantCanonicalCalendarWorkspace } from "@/components/tenant-calendar/TenantCanonicalCalendarWorkspace";
import ClientSupport from "./support";
import GrowthHub from "./growth";
import Analytics2 from "./analytics";
import Billing from "./billing";
import AgencyMarketplace from "./marketplace";
import TeamScreen from "./team";
import VaultHub from "./vault";
import SetupScreen from "./setup";
import IntegrationsHub from "./integrations";
import { TenantCommandCenterShell } from "@/components/tenant-shell/TenantCommandCenterShell";
import { resolveTenantAccountContext } from "@/components/tenant-shell/tenantShellRoutes";
import { AgentPresenceProvider, useAgentPresence } from "@/components/ui/paige";
import { VoiceDeviceProvider } from "@/lib/voice/VoiceDeviceProvider";
import { DialPadSurface } from "@/components/admin/voice/DialPadSurface";
import { IncomingCallOverlay } from "@/components/admin/voice/IncomingCallOverlay";
import { LiveTranscriptPanel } from "@/components/admin/voice/LiveTranscriptPanel";
import { rememberWorkspaceEntered } from "@/lib/auth/workspaceEntry";

// ── Nav (Agency Shell.dc.html:12587 navMain / 12599 navPlatform) ────────────
// [route, label, IconFn, badge(sub)] — badge is a fn of `sub` (presenting as a
// sub-account) so the design's isSub badge variants stay faithful. Icons map the
// design's glyphs onto the ./_shared SVG Ic set (the Agency-specific glyphs —
// Billing ◈, Client Support ◫ — were added to Ic for exactly this).
const NAV_MAIN = [
  ["command", "Command Center", () => <Ic.grid />, s => (s ? "6" : "3")],
  ["paige", "Paige", () => <Ic.spark />, () => ""],
  ["compass", "Trust Compass", () => <Ic.shield />, () => ""],
  ["autos", "Automations", () => <Ic.bolt />, () => "1"],
  ["fleet", "Clients", () => <Ic.users />, s => (s ? "" : "12")],
  ["calendar", "Calendar", () => <Ic.cal />, () => "3"],
  ["support", "Client Support", () => <Ic.support />, s => (s ? "2" : "4")],
  ["growth", "Growth", () => <Ic.trend />, () => ""],
  ["analytics", "Analytics", () => <Ic.chart />, () => ""],
  ["billing", "Billing", () => <Ic.card />, s => (s ? "" : "1")],
];
const NAV_PLATFORM = [
  ["market", "Marketplace", () => <Ic.store />],
  ["vault", "Business Vault", () => <Ic.vault />],
  ["integrations", "Integrations", () => <Ic.bolt />],
  ["team", "Team", () => <Ic.users />],
  ["setup", "Setup", () => <Ic.gear />],
];

// Route → crumb/title map (Agency Shell.dc.html:12610 crumb map + OTHER copy).
const TITLES = {
  command: ["Command Center", "The three decisions that carry your week, and the drafts waiting on you across the book."],
  paige: ["Paige", "Her ten departments, working both directions — your book and each sub-account."],
  compass: ["Trust Compass", "Ten department segments for the agency, plus the autonomy spread across your book."],
  autos: ["Automations", "The plays running across your book, and the ones drafted and waiting to go live."],
  fleet: ["Clients", "Every sub-account you run, ranked by what needs you — not alphabetically."],
  calendar: ["Calendar", "The agency's week and the sub-account calendars Paige keeps in sync."],
  support: ["Client Support", "Tickets across your book, most already drafted by Paige in the sender's voice."],
  growth: ["Growth", "The agency's own pipeline: prospects considering a sub-account, and what's bringing them in."],
  analytics: ["Analytics", "The agency's own numbers, plus an Across sub-accounts roll-up for portfolio profitability."],
  billing: ["Billing", "What each sub-account is billed, the agency's revenue, and your platform plan."],
  market: ["Marketplace", "Playbooks, automations, and skills you can install — or resell to your book for a cut."],
  vault: ["Business Vault", "The agency's obligations in six categories, plus what's coming due across your book."],
  integrations: ["Integrations", "The agency's own connections, and which tools each sub-account has handed to Paige."],
  team: ["Team", "Agency staff and the sub-accounts each of them services."],
  setup: ["Setup", "Agency profile, billing, brand cascade defaults, and provisioning defaults."],
};

// Help launcher quick-prompts (Agency Shell.dc.html:11475).
const HELP_PROMPTS = ["Something's not working", "Question about billing", "How do I…"];

// ── TopBar ───────────────────────────────────────────────────────────────────
// Identity/breadcrumb · account SWITCHER (agency only) · search · provider chip ·
// Help · Ask Paige · notifications · theme · account/profile MENU. The switcher and
// the acting crumb render only in agency mode — §51 keeps the parent-aggregate path
// out of a sub-account's chrome entirely.
const TopBar = ({ theme, setTheme, route, isAgency, acting, brand, openSwitcher, switcherOpen, switcherRef, openAcct, acctOpen, acctRef, openAsk, openHelp, sub, operatorName, providerLabel, onBackToAgency }) => {
  const crumb = (TITLES[route] || ["Command Center"])[0];
  return (
    <header className="row" style={{ height: 56, flex: "none", padding: "0 24px", background: "var(--canvas)", gap: 14, zIndex: 20 }}>
      <div className="row" style={{ gap: 9, fontSize: 13.5, color: "var(--ink-3)", flex: "0 1 auto", minWidth: 0, whiteSpace: "nowrap", overflow: "hidden" }}>
        <span className="trunc" style={{ fontWeight: 600, color: "var(--ink)" }}>{operatorName}</span>
        <Ic.chev size={13} />
        {isAgency && acting && <span className="row" style={{ gap: 7, flex: "none" }}>
          <span style={{ width: 7, height: 7, borderRadius: 2, background: acting.color }} />{acting.name.split(" ")[0]}<Ic.chev size={13} /></span>}
        <span className="trunc">{crumb}</span>
      </div>

      {/* §58 ESCAPE HATCH — the sub-account shell must not be a one-way door.
          THE BUG THIS FIXES (owner-reported P0, 2026-08-18): the switcher below is gated
          on `isAgency`, so /business/{n} renders NONE. AccountSwitcher lives only in
          AgencyLayout + AdminLayout, and /admin cannot rescue you either — Admin.tsx's
          Gate B redirects sub_account straight back to /business BEFORE AdminLayout (which
          holds the switcher) can render. An agency owner whose active tenant was a
          sub-account was therefore trapped with no navigable way back to their own agency.
          That trap came from the §65 Gate B work; this is its fix.

          Shown ONLY when the caller genuinely has somewhere to go: `ownAgencyTenant` is
          the agency/enterprise tenant in their OWN RLS-scoped tenant list, so a real
          sub-account-only owner (who has no agency) correctly sees nothing — no dead
          button promising a destination that does not exist for them (§13).

          Deliberately NOT the full switcher: this is one honest door back to the agency,
          not a cross-account picker on a surface that should stay scoped to one book (§9). */}
      {!isAgency && onBackToAgency && (
        <button
          onClick={onBackToAgency.go}
          title={"Back to " + (onBackToAgency.name || "your agency")}
          className="row"
          style={{ gap: 8, padding: "7px 12px", border: "1px solid var(--line)", borderRadius: 9, cursor: "pointer", background: "var(--surface)", fontSize: 12.5, fontWeight: 500, color: "var(--ink)", flex: "none" }}>
          <Ic.arrow size={13} style={{ transform: "rotate(180deg)", color: "var(--ink-3)" }} />
          <span className="trunc">Back to agency</span>
        </button>
      )}

      {isAgency && <div ref={switcherRef} style={{ position: "relative", flex: "none" }}>
        <button onClick={openSwitcher} aria-haspopup="menu" aria-expanded={switcherOpen} className="row"
          style={{ gap: 9, padding: "7px 12px", border: "1px solid var(--line)", borderRadius: 9, cursor: "pointer", background: "var(--surface)", fontSize: 12.5, fontWeight: 500, color: "var(--ink)" }}>
          <span style={{ width: 8, height: 8, borderRadius: 2, background: acting ? acting.color : "var(--gold-bright)" }} />
          <span>{acting ? "Sub-account: " + acting.name.split(" ")[0] : "Agency view"}</span>
          <span style={{ color: "var(--ink-3)", fontSize: 9 }}>▾</span>
        </button>
      </div>}

      <div className="row hide-1100" style={{ flex: "1 1 0", minWidth: 0, maxWidth: 420, gap: 9, padding: "0 13px", height: 34, border: "1px solid var(--line)", borderRadius: 10, background: "var(--surface)", color: "var(--ink-3)" }}>
        <Ic.search size={14} />
        <span className="trunc" style={{ fontSize: 12.8 }}>{sub ? "Search clients, threads, obligations" : "Search sub-accounts, threads, obligations"}</span>
        <span className="mono" style={{ marginLeft: "auto", fontSize: 11, color: "var(--ink-3)" }}>⌘K</span>
      </div>

      <div className="row" style={{ gap: 10, flex: "none", marginLeft: "auto" }}>
        {providerLabel && <span className="pill pill-n hide-1280" style={{ height: 28, padding: "0 13px", borderRadius: 20 }}>{providerLabel}</span>}
        <button onClick={openHelp} className="btn btn-s" style={{ height: 32, padding: "0 13px", borderRadius: 9, fontSize: 12.5, fontWeight: 600 }}>Help</button>
        <button onClick={openAsk} className="btn btn-s" title="Ask Paige" style={{ width: 32, height: 32, padding: 0, justifyContent: "center", borderRadius: 9 }}><Ic.spark size={15} /></button>
        <button className="btn btn-s" title="Notifications" style={{ width: 32, height: 32, padding: 0, justifyContent: "center", borderRadius: 9, position: "relative" }}>
          <Ic.bell size={15} /><span style={{ position: "absolute", top: 6, right: 7, width: 6, height: 6, borderRadius: "50%", background: "var(--bad)" }} /></button>
        <button onClick={() => setTheme(theme === "dark" ? "light" : "dark")} className="btn btn-s" title="Theme" style={{ width: 32, height: 32, padding: 0, justifyContent: "center", borderRadius: 9 }}>{theme === "dark" ? <Ic.sun size={15} /> : <Ic.moon size={15} />}</button>
        <div ref={acctRef} style={{ position: "relative", flex: "none" }}>
          <button onClick={openAcct} title={operatorName} aria-haspopup="menu" aria-expanded={acctOpen}
            style={{ padding: 0, border: "2px solid " + (acctOpen ? "var(--gold-bright)" : "transparent"), background: "transparent", cursor: "pointer", borderRadius: "50%", display: "flex", outline: "none" }}>
            <Avatar name={operatorName} size={30} tone="var(--rail-2)" /></button>
        </div>
      </div>
    </header>
  );
};

// ── Stub (this-pass screen placeholder — mirrors SoloApp's Stub) ─────────────
const Stub = ({ route }) => {
  const [title, sub] = TITLES[route] || ["Coming into view", ""];
  return (
    <Wrap max={900}>
      <PageHead eyebrow="Coming into view" title={title} sub={sub} />
      <div className="card" style={{ padding: "54px 30px", textAlign: "center" }}>
        <div className="tile" style={{ margin: "0 auto 14px", width: 44, height: 44, borderRadius: 15, background: "var(--violet-tint)", color: "var(--violet)" }}><Ic.spark size={22} /></div>
        <div style={{ fontWeight: 600, fontSize: 15 }}>This surface is next</div>
        <div className="sub" style={{ maxWidth: 400, margin: "6px auto 0" }}>The Agency shell chrome is designed. This screen is a later sub-pass — say the word and it's the one we build next.</div>
      </div>
    </Wrap>
  );
};

const AgencyClientsRoute = ({ tier, isAgency, acting, openAsk, enterSubaccount }) => {
  const [tab] = useSubtabRoute(tier, "clients", "people");
  if (isLegacyRelationshipOwner(tier, tab)) {
    return <ClientsHub isAgency={isAgency} acting={acting} openAsk={openAsk} enterSubaccount={enterSubaccount} />;
  }
  return <TenantRelationshipsClientsWorkspace routeTier={tier} openPaige={openAsk} />;
};

// ── AgencyApp (root) ─────────────────────────────────────────────────────────
const AgencyAppContent = ({ mode = "agency" }) => {
  const isAgency = mode === "agency";
  const { expandRail } = useAgentPresence();
  const { resolvedTheme, setTheme } = useTheme();

  // §65 URL-driven branch — every tab is its own deep-linkable route
  // (/agency/{account}/{branch} for agency mode, /business/{account}/{branch} for
  // subaccount mode, §65 R3c-i). The screen `route` is DERIVED from the URL slug
  // via the TIER_BRANCHES registry (tier-parameterized, §18 one shell for both
  // modes), and `go(k)` NAVIGATES rather than mutating local state.
  // DUAL-MODE (§58): when this shell is mounted INLINE without a :account param
  // (e.g. a stray legacy render), it falls back to local state so that path stays
  // byte-unchanged. `acting` (sub context, agency mode only) stays real per §65
  // Option B2 — its own actor-namespaced URL is unaffected by this slice.
  const params = useParams();
  const navigate = useNavigate();
  const urlAccount = params.account || null;
  // §65 R3c-i — the sub-account /business/{n} URL reuses this SAME derive/
  // navigate machinery as agency's /agency/{n} (§18: one shell, one routing
  // path, tier-parameterized rather than forking a parallel branch). urlDriven
  // now fires for BOTH modes whenever a :account param is present.
  const tier = isAgency ? "agency" : "sub_account";
  const urlDriven = !!urlAccount;
  // §65 Option B2 (owner-ruled actor namespacing) — an optional "sub/{childAccountNumber}"
  // PREFIX on the splat marks an act-as URL (/agency/{n}/sub/{subN}/{branch}/{subtab}).
  // Everything after the prefix (or the whole splat, if absent) is the ordinary
  // branch/subtab pair — unchanged from R0/Option A. §51 INVARIANT (R3c-i) —
  // gated on isAgency too: a sub-account has no children to act-as, so this must
  // never parse true in subaccount mode, even against a crafted URL. `acting`
  // stays provably null there, exactly as the file-header invariant promises.
  const splatParts = urlDriven ? (params["*"] || "").split("/") : [];
  const isSubPrefixed = urlDriven && isAgency && splatParts[0] === "sub" && /^\d+$/.test(splatParts[1] || "");
  const urlActingAccountNumber = isSubPrefixed ? Number(splatParts[1]) : null;
  const branchParts = isSubPrefixed ? splatParts.slice(2) : splatParts;
  const urlBranchSlug = urlDriven ? (branchParts[0] || defaultBranchSlug(tier)) : null;
  const [stateRoute, setStateRoute] = React.useState("command");
  const route = urlDriven ? (branchBySlug(tier, urlBranchSlug)?.key ?? "command") : stateRoute;
  // go(k) navigates within the CURRENT act-as scope — stays "inside" the acted-as
  // sub-account when one is active (preserves the sub/{n} prefix), drops back to
  // the plain agency/business path otherwise. Subaccount mode never has
  // isSubPrefixed=true (see above), so it always takes the plain branchPath(tier) leg.
  const go = k => {
    if (urlDriven) {
      const slug = branchByKey(tier, k)?.slug ?? defaultBranchSlug(tier);
      const path = isSubPrefixed
        ? "/agency/" + urlAccount + "/sub/" + urlActingAccountNumber + "/" + slug
        : branchPath(tier, urlAccount, slug);
      navigate(path);
    } else {
      setStateRoute(k);
    }
    setSwitcherOpen(false);
    setAcctOpen(false);
  };
  const [collapsed, setCollapsed] = React.useState(false);
  const theme = resolvedTheme === "light" ? "light" : "dark";

  // ── §65 Option B (B1a) — REAL agency identity + REAL sub-account roster ──────
  // The adapters read ONLY session-scoped seams (agency_portfolio_metrics /
  // agency_list_my_subaccounts, gated by auth.uid()); they never touch a
  // client-supplied tenant_id and RAISE-safe for non-agency callers (§9/§51).
  const { activeTenant, tenants, switchTenant, refresh: refreshTenants, isPlatformStaff } = useTenantContext();
  // §65 Option B2 — the caller's OWN agency/enterprise tenant, sourced independent of
  // `activeTenant` (which becomes the CHILD while acting). A caller's membership on
  // their own agency is never removed by entering a child (§37/§9), so this stays
  // stable through the whole act-as lifecycle — the correct "own number" for both the
  // top-level URL guard below and the act-as flow.
  // tier-feature-exempt: tier ROUTING (identifying which of the caller's own tenants
  // IS their agency/enterprise identity), not a §60 feature-availability decision.
  const managerTenants = (tenants || []).filter(t => t.account_type === "agency" || t.account_type === "enterprise");
  // tier-feature-exempt: authenticated account-owner routing, not feature availability.
  const ownAgencyTenant =
    (activeTenant?.account_type === "agency" || activeTenant?.account_type === "enterprise" ? activeTenant : null) ??
    (activeTenant?.parent_tenant_id
      ? managerTenants.find(t => t.id === activeTenant.parent_tenant_id) ?? null
      : null) ??
    (managerTenants.length === 1 ? managerTenants[0] : null);
  // §65 R3c-i — the sub-account's OWN address for the top-level ownership guard
  // below. In subaccount mode there is no "acting" concept, so activeTenant IS
  // the caller's own tenant (unlike agency mode, where activeTenant becomes the
  // CHILD while acting — hence agency mode uses ownAgencyTenant, not activeTenant).
  const ownAccountNumber = isAgency ? ownAgencyTenant?.account_number : activeTenant?.account_number;

  // ── §65 Option B2 — REAL act-as. `acting` is DERIVED, never a raw setState —
  // AGENCY MODE ONLY. isSubPrefixed is itself gated on isAgency (see above), so
  // it can never be true in subaccount mode, so acting is permanently null there:
  // the switcher, banner, and parent aggregate stay structurally unreachable
  // (§51 invariant), exactly as before. "Confirmed" means the SESSION (activeTenant, via useTenantContext) is
  // actually scoped to the child the URL names — agency_enter_subaccount sets that
  // server-side; the URL is an address, never a grant (§9, same pattern as the
  // top-level account-number guard below). Until confirmed, the shell shows a
  // syncing state rather than flash the PREVIOUS identity under a URL claiming a
  // different one (§13).
  const actingConfirmed = isSubPrefixed && activeTenant?.account_number === urlActingAccountNumber;
  const acting = actingConfirmed
    ? {
        id: activeTenant.id,
        name: activeTenant.name,
        accountNumber: activeTenant.account_number,
        color: swatchFor(activeTenant.id),
      }
    : null;
  const actingSyncing = isSubPrefixed && !actingConfirmed;

  // `sub` = presenting as a sub-account (standalone subaccount mode, or agency acting
  // into a sub). Drives the design's isSub nav/plan/label variants. Declared HERE —
  // immediately after `acting`, its only non-prop dependency — so the tier-correct
  // plan strings below can read it without a use-before-declare.
  const sub = mode === "subaccount" || !!acting;

  const shellCtx = { isAgency, acting };
  const metrics = useAgencyMetrics(shellCtx);
  const roster = useAgencyRoster(shellCtx);

  // Operator PERSON identity from the auth session (best-effort, §15 — never a
  // placeholder; falls back to the agency's own name, then a neutral label).
  const [op, setOp] = React.useState({ name: null, email: null });
  React.useEffect(() => {
    let live = true;
    void supabase.auth.getUser().then(({ data }) => {
      if (!live) return;
      const u = data?.user;
      const meta = (u?.user_metadata ?? {});
      setOp({ name: meta.full_name || meta.name || null, email: u?.email ?? null });
    }).catch(() => { /* auth read failed — keep honest fallbacks (§13) */ });
    return () => { live = false; };
  }, []);

  const agencyName = metrics.identity.name || activeTenant?.name || "Your agency";
  const operatorName = op.name || agencyName;
  const operatorEmail = op.email || "";
  const planLabel = metrics.identity.plan || "Agency plan";
  // Prefer the literal roster length; fall back to the portfolio count. Preview "—"
  // while it resolves (§13 — a number is shown only once a real seam returns it).
  // §13 — show a real count ONLY once the roster RPC has resolved; while it loads,
  // `available` is already true but `rows` is still [] (a fabricated 0), so gate on
  // `loading` and render "—" until the seam actually returns.
  // §39 defense-in-depth (peer-gate finding #5, §65 Option B2 hotfix) — `roster`
  // now fetches even while acting (so the switcher can show real siblings), so
  // `roster.available` alone no longer implies "safe to show the agency-wide
  // count." Gate explicitly on `!acting` here too — this value is currently only
  // ever rendered behind the Rail's own `sub`/`acting` ternary (never during
  // acting-state render paths), but computing it as agency-scope-only at the
  // SOURCE means a future caller can't accidentally pick up the sibling count by
  // reading `planLine`/`bookLine` without independently re-deriving that gate.
  const subCountReal = roster.available && !acting
    ? (roster.loading ? null : roster.rows.length)
    : (metrics.subCount ?? null);
  const subCountLabel = subCountReal == null ? "—" : String(subCountReal);
  const planLine = planLabel + " · " + subCountLabel + " sub-accounts";
  const bookLine = subCountReal == null
    ? "Your book, with ten departments running per sub-account."
    : subCountLabel + " sub-accounts on your book. Ten departments running per account.";
  // §13/§51/§65 — a sub-account is NOT Solo. In sub/acting mode `metrics.identity` is
  // CHILD-scoped (activeTenant IS the sub-account, per useAgencyMetrics), so its own
  // real `plan_offer` is the truth here; the port hardcoded "Solo plan" straight past
  // it. The fallback is the neutral, tier-TRUE "Sub-account" — never "Solo plan"
  // (wrong tier) and never `planLabel`'s "Agency plan" default (wrong tier the other
  // way); it asserts only what we actually know when no plan is on record.
  const subPlanLabel = metrics.identity.plan || "Sub-account";
  // Tier-correct strings resolved HERE so <Rail> renders what it's handed instead of
  // branching on tier itself. §13: the sub card carries NO second line — the "147
  // hours saved this month" sentence it used to render was fixture copy with no
  // backend (and contradicted the agency line's ten departments), so it is STRIPPED,
  // not replaced with another unsourced claim. A thinner card that is true beats a
  // fuller one that isn't.
  const railPlanLine = sub ? subPlanLabel : planLine;
  const railBookLine = sub ? null : bookLine;
  // Provider chip is an AGENCY-context concept ("provided by {agency}"). In sub-mode
  // the parent-agency name isn't wired yet, so we hide the chip rather than show the
  // sub's own name as its "provider" (which would be wrong). Sub-mode real identity
  // (incl. parent white-label) lands in a later slice.
  const providerLabel = isAgency ? agencyName : "";

  // §39 (task #171) — the /agency/{n} or /business/{n} address is NOT authority
  // (§9); RLS gates every read. Keep the URL honest: redirect a number that isn't
  // the caller's own account to their own, and canonicalize a bare root URL → its
  // default branch. Acts ONLY once the caller's own account_number is known, so a
  // mid-load null never bounces.
  // §65 Option B2 fix: agency mode compares against `ownAgencyTenant` (stable
  // through act-as), NOT `activeTenant` (which becomes the CHILD while acting —
  // comparing against it would wrongly bounce a valid sub/{n} URL using the
  // child's own number). §65 R3c-i: subaccount mode has no act-as, so
  // `ownAccountNumber` is simply `activeTenant`'s own number (derived above).
  const urlSplat = params["*"] || "";
  React.useEffect(() => {
    if (!urlDriven) return;
    const own = ownAccountNumber;
    if (own == null) return;
    if (String(own) !== String(urlAccount)) {
      navigate(branchPath(tier, String(own), defaultBranchSlug(tier)), { replace: true });
      return;
    }
    // The bare-URL canonicalize only applies to the plain (non-acting) shape —
    // a bare /agency/{n}/sub/{subN} (no branch yet) is handled by the resolving
    // effect below, which supplies its own default branch on first entry.
    if (!urlSplat && !isSubPrefixed) {
      navigate(branchPath(tier, urlAccount, defaultBranchSlug(tier)), { replace: true });
    }
  }, [urlDriven, urlAccount, urlSplat, isSubPrefixed, ownAccountNumber, navigate, tier]);

  // ── §65 Option B2 — act-as ACTIONS. Both real, both server-authorized. ──────
  const [switchBusy, setSwitchBusy] = React.useState(false);
  const [switchError, setSwitchError] = React.useState("");

  // syncIntoChild — the shared core: authorize + grant membership on the child
  // (agency_enter_subaccount, SECURITY DEFINER, RAISEs 42501 if unauthorized), then
  // sync the CLIENT's tenant scope via the SAME proven primitive the platform's own
  // tenant-switcher already uses (useTenantContext().switchTenant — sets local state
  // AND runs queryClient.invalidateQueries(), the established §9 cache-safety step;
  // see src/components/admin/TenantSwitcher.tsx). Never presented as done until the
  // RPC actually succeeds (§13) — callers must catch and surface `switchError`.
  // §39 fix (peer-gate finding #1) — `tenants` is only refetched on mount/auth
  // events, NEVER by switchTenant itself. On a FIRST-EVER entry into a child,
  // agency_enter_subaccount's membership grant is the only thing that makes the
  // child RLS-readable — the client's cached `tenants` list won't contain it yet,
  // so `activeTenant` would resolve to null/stale and `actingConfirmed` could
  // never become true (a permanently-stuck syncing screen). refresh() re-fetches
  // the tenant list under the NEW membership before we rely on activeTenant.
  const syncIntoChild = React.useCallback(async (childId) => {
    const { error } = await supabase.rpc("agency_enter_subaccount", { _child: childId });
    if (error) throw error;
    // Record the entry, same as the two producers that hand off to `/choose-account`
    // (AccountSwitcher, AgencyBoard). This path stays inside the agency shell, so
    // nothing breaks without it — but the operator's active context IS now the
    // child, and if they later open `/choose-account` the door would ask them to choose a
    // workspace they already deliberately entered. Completing the inventory here
    // costs a line; leaving one producer out is how the last two rounds went.
    rememberWorkspaceEntered(childId);
    await switchTenant(childId);
    await refreshTenants();
  }, [switchTenant, refreshTenants]);

  // enterSubaccount — the user-facing action (switcher row, Directory card, …).
  // Defensive: a fixture row (no real id/accountNumber) silently no-ops rather than
  // acting-as garbage (§13) — see CommandCenter's enterSub wiring below.
  const enterSubaccount = React.useCallback(async (child) => {
    if (!child?.id || child?.accountNumber == null) return;
    setSwitchBusy(true); setSwitchError("");
    try {
      await syncIntoChild(child.id);
      navigate("/agency/" + urlAccount + "/sub/" + child.accountNumber + "/command-center");
    } catch (e) {
      setSwitchError(e?.message || "Couldn't switch into that sub-account.");
    } finally {
      setSwitchBusy(false);
    }
  }, [syncIntoChild, navigate, urlAccount]);

  // exitSubaccount — "Return to agency view". agency_exit_subaccount() RE-DERIVES the
  // caller's agency server-side from their OWN tenant_members role (never trusts a
  // client-held id) and returns it; switchTenant syncs the client to that value.
  const exitSubaccount = React.useCallback(async () => {
    setSwitchBusy(true); setSwitchError("");
    try {
      const { data, error } = await supabase.rpc("agency_exit_subaccount");
      if (error) throw error;
      const agencyId = data?.active_tenant_id ?? ownAgencyTenant?.id ?? null;
      if (agencyId) await switchTenant(agencyId);
      const slug = branchByKey("agency", route)?.slug ?? defaultBranchSlug("agency");
      navigate(branchPath("agency", urlAccount, slug));
    } catch (e) {
      setSwitchError(e?.message || "Couldn't return to the agency view.");
    } finally {
      setSwitchBusy(false);
    }
  }, [switchTenant, navigate, urlAccount, route, ownAgencyTenant?.id]);

  // Deep-link / reload resolver — a bookmarked or freshly-loaded sub/{subN} URL whose
  // SESSION isn't yet scoped there. §39 forward-IDOR guard: subN is an ADDRESS, never
  // a grant — resolve it against the caller's OWN real roster (agency_list_my_subaccounts,
  // scoped by auth.uid() server-side) before ever calling the act-as RPC. A subN that
  // matches none of the caller's real children can never succeed (the RPC re-checks
  // authorization regardless) and self-heals back to the agency's own default view,
  // exactly like the top-level guard above — never a dead end, never a fake success.
  React.useEffect(() => {
    if (!isSubPrefixed || actingConfirmed || switchBusy) return;
    let cancelled = false;
    setSwitchBusy(true);
    (async () => {
      const { data, error } = await supabase.rpc("agency_list_my_subaccounts");
      if (cancelled) return;
      const rows = Array.isArray(data) ? data : [];
      const match = rows.find(r => Number(r.account_number) === urlActingAccountNumber);
      if (error || !match) {
        navigate(branchPath("agency", urlAccount, defaultBranchSlug("agency")), { replace: true });
        setSwitchBusy(false);
        return;
      }
      try {
        await syncIntoChild(match.id);
      } catch {
        navigate(branchPath("agency", urlAccount, defaultBranchSlug("agency")), { replace: true });
      } finally {
        if (!cancelled) setSwitchBusy(false);
      }
    })();
    return () => { cancelled = true; };
    // §39 fix (peer-gate finding #2) — `switchBusy` is set INSIDE this effect, so
    // listing it as a dep made the effect self-cancelling: setSwitchBusy(true)
    // changes a dep → React tears down (cancelled=true) and re-invokes before the
    // in-flight RPC resolves → the resolved call's `if (cancelled) return` skips
    // `setSwitchBusy(false)` on every path → stuck forever on the syncing screen.
    // The guard at the top of the effect body still reads the LATEST switchBusy/
    // navigate/syncIntoChild via closure on every real re-run; they intentionally
    // stay OUT of the deps array so the effect only re-runs on a genuine URL/
    // session change, never on a re-render that merely redefines a callback.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSubPrefixed, actingConfirmed, urlActingAccountNumber, urlAccount]);

  // Global chrome pop-out open-state (all held here, per the task).
  const [switcherOpen, setSwitcherOpen] = React.useState(false);
  const [acctOpen, setAcctOpen] = React.useState(false);
  const [helpOpen, setHelpOpen] = React.useState(false);
  const [helpSent, setHelpSent] = React.useState(false);
  const [provisionOpen, setProvisionOpen] = React.useState(false);
  const [provStep, setProvStep] = React.useState(1);
  const [feed, setFeed] = React.useState([]);
  const [scanDone, setScanDone] = React.useState(0);
  const [formName, setFormName] = React.useState("Sarah's Coaching Practice");
  const [formEmail, setFormEmail] = React.useState("sarah@sarahcoaching.example");
  const [formColor, setFormColor] = React.useState("#7C6CE0");
  const [tools, setTools] = React.useState({ Stripe: true, "Google Business": true, HubSpot: false, Calendar: true, "Meta Ads": false });
  const timer = React.useRef(null);
  const switcherRef = React.useRef(null);
  const acctRef = React.useRef(null);

  // Owner directive (2026-08-18) — the slide-in panel pops out from THIS launcher ONLY
  // (the TopBar spark / ⌘K). EVERY rail item, "Paige" included, navigates to its own URL
  // and nothing more; the rail is navigation, never a panel trigger.
  const openAsk = React.useCallback(() => {
    expandRail();
    setAcctOpen(false);
    setSwitcherOpen(false);
  }, [expandRail]);
  const openHelp = () => { setHelpOpen(true); setHelpSent(false); setAcctOpen(false); };
  // Provisioning is an AGENCY act — never offered in subaccount mode.
  const openProvision = () => { if (!isAgency) return; setProvisionOpen(true); setProvStep(1); setFeed([]); setSwitcherOpen(false); };
  const closeProvision = () => { if (timer.current) clearInterval(timer.current); setProvisionOpen(false); setProvStep(1); setFeed([]); };

  // ⌘K opens Ask Paige (the design's search-key → command surface).
  React.useEffect(() => {
    const h = e => { if ((e.metaKey || e.ctrlKey) && (e.key === "k" || e.key === "K")) { e.preventDefault(); openAsk(); } };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [openAsk]);
  React.useEffect(() => () => { if (timer.current) clearInterval(timer.current); }, []);

  // 3-step provisioning scan (Agency Shell.dc.html runScan) — streams the seven
  // real check lines, then resolves into the welcome step.
  const runScan = () => {
    if (!isAgency) return;
    const first = formName.split("'")[0];
    const lines = [
      { text: "Provisioning workspace…", mark: "✓", color: GREEN },
      { text: "Checking " + first + "'s website… 240ms, clean", mark: "✓", color: GREEN },
      { text: "Verifying her SSL… expires in 9 days, no auto-renew", mark: "⚠", color: AMBER },
      { text: "Looking at her Meta Pixel… fires twice on checkout", mark: "⚠", color: AMBER },
      { text: "Reading her booking flow… mobile drop-off at calendar", mark: "⚠", color: AMBER },
      { text: "Mapping her offers and pricing… 4 found", mark: "✓", color: GREEN },
      { text: "Setting up six departments… Paige is on shift", mark: "✓", color: GREEN },
    ];
    setFeed([]); setScanDone(0); setProvStep(2);
    if (timer.current) clearInterval(timer.current);
    let i = 0;
    timer.current = setInterval(() => {
      if (i >= lines.length) { clearInterval(timer.current); setProvStep(3); return; }
      const line = lines[i++];
      setFeed(f => f.concat([line])); setScanDone(i);
    }, 620);
  };
  // "Walk through them with me" — closes the wizard and returns to Command Center.
  // §13 honest: provisioning here is still the decorative demo wizard (no real
  // tenant is created), so this can no longer fake an act-as into SUBS[0] now that
  // `acting` is real (§65 Option B2) — it would desync the URL from the session.
  const enterNew = () => { if (timer.current) clearInterval(timer.current); setProvisionOpen(false); setProvStep(1); go("command"); };

  // Resolved workspace identity for the rail mark. §65 R3a-i fix (owner live-drive
  // 2026-08-17) — standalone subaccount mode used to lock to the SUBS[0] fixture
  // ("Sarah's Coaching Practice") regardless of which real tenant was logged in;
  // it now reads the REAL logged-in tenant via useTenantContext().activeTenant, the
  // same source AgencyApp already trusts for agencyName/operatorName. No real
  // per-tenant brand-color backend exists yet, so the mark color is a deterministic
  // swatch keyed on the tenant id (§13 — never a fabricated color, just a stable
  // decorative one) via the SAME swatchFor() the roster/switcher already use (§18).
  // Agency mode is unaffected — it still shows the agency mark unless acting into a sub.
  const accountContext = resolveTenantAccountContext(
    isAgency
      ? acting
        ? { accountName: acting.name, accountType: activeTenant?.account_type, parentTenantId: activeTenant?.parent_tenant_id }
        : { accountName: ownAgencyTenant?.name, accountType: ownAgencyTenant?.account_type }
      : { accountName: activeTenant?.name, accountType: activeTenant?.account_type, parentTenantId: activeTenant?.parent_tenant_id },
  );
  const ownName = accountContext.accountName;
  const brand = isAgency
    ? (acting ? { name: acting.name, initials: tmInit(acting.name), color: acting.color, isAgency: true, acting: true }
      : { name: agencyName, initials: tmInit(agencyName), color: "#C8A02E", isAgency: true, acting: false })
    : { name: ownName, initials: tmInit(ownName), color: activeTenant?.id ? swatchFor(activeTenant.id) : "#7C6CE0", isAgency: false, acting: false };

  // Real screen modules (MAIN group Slices 1b-2..1b-4 + PLATFORM group Slice 1b-5).
  // Each receives the shell context { isAgency, acting, openAsk }; CommandCenter also
  // takes enterSub (act-as jump, agency-only). Vibe Studio is NOT registered here —
  // GrowthHub owns its full lifecycle (opens VibeStudio inline from its own studioOpen
  // state). Every top-nav route now resolves to a real screen; Stub is the fallback.
  const screens = {
    command: <CommandCenter accountContext={accountContext} isAgency={isAgency} acting={acting} openAsk={openAsk} enterSub={enterSubaccount} />,
    paige: <PaigeHub isAgency={isAgency} acting={acting} openAsk={openAsk} />,
    compass: <TrustCompass isAgency={isAgency} acting={acting} openAsk={openAsk} />,
    autos: <AutomationsHub isAgency={isAgency} acting={acting} openAsk={openAsk} />,
    fleet: <AgencyClientsRoute tier={tier} isAgency={isAgency} acting={acting} openAsk={openAsk} enterSubaccount={enterSubaccount} />,
    calendar: <TenantCanonicalCalendarWorkspace tier="agency" openPaige={openAsk} />,
    support: <ClientSupport isAgency={isAgency} acting={acting} openAsk={openAsk} />,
    growth: <GrowthHub isAgency={isAgency} acting={acting} openAsk={openAsk} />,
    analytics: <Analytics2 isAgency={isAgency} acting={acting} openAsk={openAsk} />,
    billing: <Billing isAgency={isAgency} acting={acting} openAsk={openAsk} />,
    // PLATFORM group (Slice 1b-5) — the top-nav platform surfaces.
    market: <AgencyMarketplace isAgency={isAgency} acting={acting} openAsk={openAsk} />,
    team: <TeamScreen isAgency={isAgency} acting={acting} openAsk={openAsk} />,
    vault: <VaultHub isAgency={isAgency} acting={acting} openAsk={openAsk} />,
    integrations: <IntegrationsHub isAgency={isAgency} acting={acting} openAsk={openAsk} />,
    setup: <SetupScreen isAgency={isAgency} acting={acting} openAsk={openAsk} />,
  };
  // §65 Option B2 — while a sub/{n} URL's session scope is still resolving (a
  // bookmarked/reloaded deep link, or the brief window right after an act-as
  // click), show a lightweight syncing state INSTEAD of the shell — never flash
  // the previous identity under a URL that already claims a different one (§13).
  if (isSubPrefixed && (actingSyncing || switchBusy)) {
    return (
      <div className="paige-agency" data-theme={theme} style={{ height: "100vh", display: "grid", placeItems: "center" }}>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12 }}>
          <div className="tile" style={{ width: 40, height: 40, borderRadius: 14, background: "var(--gold-tint)", color: "var(--gold)" }}><Ic.spark size={19} /></div>
          <div style={{ fontSize: 13.5, color: "var(--ink-2)" }}>Switching into that sub-account…</div>
          {switchError && (
            <div style={{ fontSize: 12.5, color: "var(--bad)", maxWidth: 320, textAlign: "center" }}>{switchError}</div>
          )}
        </div>
      </div>
    );
  }

  const body = screens[route] || <Stub route={route} />;

  const swatches = ["#7C6CE0", "#3F7F5C", "#2F6FA8", "#C1652F", "#A8425A", "#B3932A"];

  return (
    <TenantCommandCenterShell
      accountName={accountContext.accountName}
      accountType={accountContext.accountType}
      providedBy={!isAgency ? ownAgencyTenant?.name : null}
      userRole="admin"
      // A platform operator reaches this shell only as an audited act-as on a sub-account (the
      // agency leg never mounts for them — AgencyEntry sends them to the console). Their way out
      // is the audited exit, not "Back to {agency}": that link leads into a route that bounces
      // operators and leaves the act-as open.
      accountControls={!isAgency && isPlatformStaff ? <WorkspaceExitControl /> : isAgency ? (
        <button ref={switcherRef} type="button" onClick={() => setSwitcherOpen(v => !v)} aria-expanded={switcherOpen}>
          {acting ? `Sub-account: ${acting.name}` : "Switch account"}
        </button>
      ) : ownAgencyTenant?.account_number != null ? (
        <button type="button" onClick={() => navigate(branchPath("agency", String(ownAgencyTenant.account_number), defaultBranchSlug("agency")))}>
          Back to {ownAgencyTenant.name || "agency"}
        </button>
      ) : null}
      onSignOut={() => void performSignOut({ redirectTo: "/" })}
    >
    <div className="paige-agency" data-theme={theme} style={{ height: "100%", minHeight: 0 }}>
      <div style={{ display: "flex", height: "100%", overflow: "hidden" }}>
        <div style={{ display: "flex", flexDirection: "column", flex: 1, minWidth: 0 }}>
          {/* Account SWITCHER popover — agency only (§51). */}
          {isAgency && (
            <div style={{ position: "absolute", top: 50, left: 300, zIndex: 60 }}>
              <div style={{ position: "relative" }}>
                <Popover open={switcherOpen} onClose={() => setSwitcherOpen(false)} anchorRef={switcherRef} align="left" width={348} top="0" pad={8}>
                  <button onClick={() => { setSwitcherOpen(false); if (acting) void exitSubaccount(); }} className="row" style={{ width: "100%", gap: 10, padding: "9px 10px", borderRadius: 8, background: "transparent", border: "none", cursor: "pointer", fontSize: 13.5, fontWeight: 600, color: "var(--ink)", textAlign: "left" }}
                    onMouseEnter={e => e.currentTarget.style.background = "var(--surface-sunk)"} onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                    <span style={{ width: 8, height: 8, borderRadius: 2, background: "var(--gold-bright)" }} />Agency view</button>
                  <div style={{ height: 1, background: "var(--line-soft)", margin: "6px 4px" }} />
                  <button onClick={() => go("fleet")} className="row" style={{ width: "100%", gap: 10, padding: "9px 10px", borderRadius: 8, background: "transparent", border: "none", cursor: "pointer", fontSize: 13.5, color: "var(--ink)", textAlign: "left" }}
                    onMouseEnter={e => e.currentTarget.style.background = "var(--surface-sunk)"} onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                    <span style={{ width: 17, textAlign: "center", color: "var(--ink-3)", fontSize: 12 }}>▥</span>All sub-accounts ({subCountLabel})</button>
                  <div style={{ height: 1, background: "var(--line-soft)", margin: "6px 4px" }} />
                  <div style={{ fontSize: 9.5, fontWeight: 600, letterSpacing: ".14em", color: "var(--ink-3)", padding: "6px 10px" }}>RECENT</div>
                  {/* B1a: REAL sub-accounts (agency_list_my_subaccounts). Clicking routes to
                      the Clients hub (honest LISTING); per-sub view-as ENTRY is B2. Client
                      count stands in for the design's per-sub "drafts" (no drafts backend, §13). */}
                  {roster.rows.slice(0, 5).map(r => (
                    <button key={r.id} onClick={() => { setSwitcherOpen(false); void enterSubaccount({ id: r.id, accountNumber: r.accountNumber }); }} className="row" style={{ width: "100%", gap: 10, padding: "8px 10px", borderRadius: 8, background: "transparent", border: "none", cursor: "pointer", textAlign: "left" }}
                      onMouseEnter={e => e.currentTarget.style.background = "var(--surface-sunk)"} onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                      <span style={{ width: 8, height: 8, borderRadius: 2, background: swatchFor(r.id), flex: "none" }} />
                      <span className="grow trunc" style={{ fontSize: 13, color: "var(--ink)" }}>{r.name}</span>
                      <span className="mono" style={{ fontSize: 11, color: "var(--ink-3)" }}>{r.clientCount != null ? r.clientCount + (r.clientCount === 1 ? " client" : " clients") : "—"}</span>
                      <span style={{ width: 8, height: 8, borderRadius: "50%", background: healthDot(r.health), flex: "none" }} />
                    </button>
                  ))}
                  {roster.rows.length === 0 && (
                    <div style={{ fontSize: 12, color: "var(--ink-3)", padding: "6px 10px" }}>{roster.loading ? "Loading your sub-accounts…" : "No sub-accounts yet."}</div>
                  )}
                  <div style={{ padding: "8px 6px 4px" }}>
                    <input placeholder="Search sub-accounts" style={{ width: "100%", padding: "9px 11px", borderRadius: 8, border: "1px solid var(--line)", background: "var(--surface-2)", color: "var(--ink)", fontSize: 12.5, fontFamily: "inherit", outline: "none" }} />
                  </div>
                  <button onClick={openProvision} className="row" style={{ width: "100%", gap: 8, padding: "9px 10px", marginTop: 2, borderRadius: 8, background: "transparent", border: "none", cursor: "pointer", fontSize: 13, fontWeight: 600, color: "var(--gold)", textAlign: "left" }}
                    onMouseEnter={e => e.currentTarget.style.background = "var(--surface-sunk)"} onMouseLeave={e => e.currentTarget.style.background = "transparent"}>+ Add a sub-account</button>
                </Popover>
              </div>
            </div>
          )}

          {/* Account / profile MENU popover (both modes). */}
          <div style={{ position: "absolute", top: 50, right: 16, zIndex: 70 }}>
            <div style={{ position: "relative" }}>
              <Popover open={acctOpen} onClose={() => setAcctOpen(false)} anchorRef={acctRef} align="right" width={308} top="0" pad={0}>
                <div className="row" style={{ gap: 11, padding: "14px 15px", background: "var(--surface-2)", borderBottom: "1px solid var(--line-soft)" }}>
                  <Avatar name={operatorName} size={38} tone="var(--rail-2)" />
                  <div style={{ minWidth: 0 }}>
                    <div className="trunc" style={{ fontSize: 13.5, fontWeight: 600, color: "var(--ink)" }}>{operatorName}</div>
                    {operatorEmail && <div className="trunc" style={{ fontSize: 11.5, color: "var(--ink-3)", marginTop: 2 }}>{operatorEmail}</div>}
                    <div className="row" style={{ gap: 7, marginTop: 6 }}>
                      <span className="pill pill-v" style={{ height: 18 }}>Owner · Admin</span>
                      <span className="trunc" style={{ fontSize: 10.5, color: "var(--ink-3)" }}>{sub ? subPlanLabel : planLabel}</span>
                    </div>
                  </div>
                </div>
                {isAgency && acting && (
                  <div className="row" style={{ gap: 8, padding: "8px 15px", background: "var(--gold-tint)", borderBottom: "1px solid var(--gold-line)" }}>
                    <span style={{ width: 8, height: 8, borderRadius: 2, background: acting.color, flex: "none" }} />
                    <div className="trunc" style={{ fontSize: 11.5, color: "var(--warn)" }}>Acting as {acting.name} — actions affect them</div>
                  </div>
                )}
                <div style={{ padding: "7px 6px", borderBottom: "1px solid var(--line-soft)" }}>
                  <div style={{ fontSize: 9, fontWeight: 600, letterSpacing: ".14em", color: "var(--ink-3)", padding: "5px 9px" }}>YOUR PREFERENCES</div>
                  <button onClick={() => setTheme(theme === "dark" ? "light" : "dark")} className="row" style={{ width: "100%", gap: 9, padding: "7px 9px", borderRadius: 8, background: "transparent", border: "none", cursor: "pointer", textAlign: "left" }}
                    onMouseEnter={e => e.currentTarget.style.background = "var(--surface-sunk)"} onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                    <span style={{ display: "flex", color: "var(--ink-3)" }}>{theme === "dark" ? <Ic.sun size={13} /> : <Ic.moon size={13} />}</span>
                    <span style={{ fontSize: 12, color: "var(--ink)" }}>Appearance</span>
                    <span style={{ marginLeft: "auto", fontSize: 11, color: "var(--ink-3)" }}>{theme === "dark" ? "Dark" : "Light"}</span></button>
                  <button onClick={() => go("setup")} className="row" style={{ width: "100%", gap: 9, padding: "7px 9px", borderRadius: 8, background: "transparent", border: "none", cursor: "pointer", textAlign: "left" }}
                    onMouseEnter={e => e.currentTarget.style.background = "var(--surface-sunk)"} onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                    <Ic.gear size={13} /><span style={{ fontSize: 12, color: "var(--ink)" }}>Your profile</span>
                    <span style={{ marginLeft: "auto", fontSize: 10.5, color: "var(--ink-3)" }}>Setup › Owner</span></button>
                </div>
                <div style={{ padding: "7px 6px" }}>
                  <button onClick={openHelp} className="row" style={{ width: "100%", gap: 9, padding: "7px 9px", borderRadius: 8, background: "transparent", border: "none", cursor: "pointer", textAlign: "left" }}
                    onMouseEnter={e => e.currentTarget.style.background = "var(--surface-sunk)"} onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                    <Ic.support size={13} /><span style={{ fontSize: 12, color: "var(--ink)" }}>Help and support</span></button>
                </div>
                <button onClick={() => { setAcctOpen(false); performSignOut({ redirectTo: "/" }); }} className="row" style={{ width: "100%", gap: 9, padding: "11px 15px", borderTop: "1px solid var(--line-soft)", background: "var(--surface-2)", border: "none", cursor: "pointer", textAlign: "left" }}
                  onMouseEnter={e => e.currentTarget.style.background = "var(--bad-tint)"} onMouseLeave={e => e.currentTarget.style.background = "var(--surface-2)"}>
                  <Ic.arrow size={13} style={{ color: "var(--bad)" }} /><span style={{ fontSize: 12.5, fontWeight: 600, color: "var(--bad)" }}>Sign out</span></button>
              </Popover>
            </div>
          </div>

          {/* §65 Option B2 — act-as error banner (a failed enter/exit RPC). Not gated
              on `sub` since exitSubaccount can fail while still acting, or
              enterSubaccount can fail before ever navigating. Dismissable. */}
          {switchError && (
            <div className="row" style={{ gap: 10, padding: "9px 26px", background: "var(--bad-tint)", borderTop: "1px solid var(--bad-line, var(--line))", borderBottom: "1px solid var(--bad-line, var(--line))" }}>
              <span style={{ fontSize: 12.5, color: "var(--bad)" }}>{switchError}</span>
              <button onClick={() => setSwitchError("")} className="row" style={{ marginLeft: "auto", background: "transparent", border: "none", cursor: "pointer", fontSize: 12, fontWeight: 600, color: "var(--bad)" }}>Dismiss</button>
            </div>
          )}

          {/* Acting-banner — agency mode acting into a sub ONLY (§51). */}
          {isAgency && acting && (
            <div className="row" style={{ gap: 12, padding: "9px 26px", background: "var(--gold-tint)", borderTop: "1px solid var(--gold-line)", borderBottom: "1px solid var(--gold-line)" }}>
              <span style={{ width: 9, height: 9, borderRadius: 2, background: acting.color }} />
              <span style={{ fontSize: 13, color: "var(--ink)" }}>Now viewing: <b style={{ fontWeight: 600 }}>{acting.name}</b></span>
              <span className="hide-1100" style={{ fontSize: 12.5, color: "var(--ink-3)" }}>Their workspace, exactly as they see it. Actions here affect them, not your agency.</span>
              <button onClick={() => void exitSubaccount()} className="row" style={{ marginLeft: "auto", gap: 6, background: "transparent", border: "none", cursor: "pointer", fontSize: 12.5, fontWeight: 600, color: "var(--gold)" }}>Return to agency view →</button>
            </div>
          )}

          <main key={route} style={{ flex: 1, overflow: "auto", minHeight: 0 }}>{body}</main>
        </div>

        {/* Provisioning wizard (agency only) — 3-step center Modal. */}
        {isAgency && (
          <Modal open={provisionOpen} onClose={closeProvision} size={640}
            title={provStep === 3 ? "Welcome your new sub-account" : "Add a sub-account"} sub={"Step " + provStep + " of 3"} accent="var(--gold-bright)"
            foot={provStep === 1 ? (
              <>
                <div style={{ fontSize: 12.5, color: "var(--ink-3)" }}>Paige scans her systems next — takes about two minutes.</div>
                <button onClick={runScan} className="row" style={{ marginLeft: "auto", gap: 6, padding: "10px 17px", borderRadius: 10, background: "var(--gold-bright)", color: "#241C05", fontSize: 13, fontWeight: 600, border: "none", cursor: "pointer" }}>Provision and scan</button>
              </>
            ) : null}>
            {provStep === 1 && (
              <div style={{ display: "flex", flexDirection: "column", gap: 17 }}>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 13 }}>
                  <div>
                    <div style={{ fontSize: 12, color: "var(--ink-3)", marginBottom: 7 }}>Sub-account name</div>
                    <input value={formName} onChange={e => setFormName(e.target.value)} style={{ width: "100%", padding: "10px 12px", borderRadius: 9, border: "1px solid var(--line)", background: "var(--surface-2)", color: "var(--ink)", fontSize: 13, fontFamily: "inherit", outline: "none" }} />
                  </div>
                  <div>
                    <div style={{ fontSize: 12, color: "var(--ink-3)", marginBottom: 7 }}>Owner email</div>
                    <input value={formEmail} onChange={e => setFormEmail(e.target.value)} style={{ width: "100%", padding: "10px 12px", borderRadius: 9, border: "1px solid var(--line)", background: "var(--surface-2)", color: "var(--ink)", fontSize: 13, fontFamily: "inherit", outline: "none" }} />
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: 12, color: "var(--ink-3)", marginBottom: 9 }}>Brand color — cascades into her portal and her Paige emails</div>
                  <div className="row" style={{ gap: 10 }}>
                    {swatches.map(c => (
                      <button key={c} onClick={() => setFormColor(c)} style={{ width: 32, height: 32, borderRadius: 9, cursor: "pointer", background: c, border: "none", boxShadow: formColor === c ? "0 0 0 2px var(--surface), 0 0 0 4px " + c : "none" }} />
                    ))}
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: 12, color: "var(--ink-3)", marginBottom: 9 }}>Connect her tools now (optional — she can do it later)</div>
                  <div className="row" style={{ gap: 9, flexWrap: "wrap" }}>
                    {Object.keys(tools).map(label => {
                      const on = tools[label];
                      return <button key={label} onClick={() => setTools(t => ({ ...t, [label]: !t[label] }))} style={{ padding: "8px 13px", borderRadius: 20, cursor: "pointer", fontSize: 12.5, border: "1px solid " + (on ? "var(--gold-line)" : "var(--line)"), background: on ? "var(--gold-tint)" : "var(--surface)", color: on ? "var(--gold)" : "var(--ink-2)" }}>{label}</button>;
                    })}
                  </div>
                </div>
                <div style={{ border: "1px solid var(--line-soft)", borderRadius: 11, padding: "13px 14px", background: "var(--surface-2)", fontSize: 13, lineHeight: 1.55, color: "var(--ink-2)" }}>She stays a sub-account, always. She owns her autonomy settings and her data — you can see, recommend, and work alongside her, not override her.</div>
              </div>
            )}
            {provStep === 2 && (
              <div style={{ display: "flex", flexDirection: "column", gap: 15 }}>
                <div className="row" style={{ gap: 11 }}>
                  <span style={{ width: 9, height: 9, borderRadius: "50%", background: "var(--gold-bright)" }} />
                  <div style={{ fontSize: 14, fontWeight: 600 }}>Paige is scanning {formName}</div>
                  <div className="mono" style={{ marginLeft: "auto", fontSize: 12, color: "var(--ink-3)" }}>{scanDone} of 7 checks</div>
                </div>
                <div className="mono" style={{ border: "1px solid var(--line-soft)", borderRadius: 11, background: "var(--surface-2)", padding: 15, minHeight: 236, fontSize: 12.5, display: "flex", flexDirection: "column", gap: 9 }}>
                  {feed.map((f, i) => (
                    <div key={i} className="fade-in row" style={{ gap: 10, alignItems: "flex-start" }}>
                      <span style={{ color: f.color, width: 14 }}>{f.mark}</span>
                      <span style={{ color: "var(--ink-2)" }}>{f.text}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {provStep === 3 && (
              <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                <div className="row" style={{ gap: 11 }}>
                  <div className="tile" style={{ width: 32, height: 32, borderRadius: "50%", background: "var(--ok-tint)", color: "var(--ok)" }}><Ic.check size={16} /></div>
                  <div style={{ fontSize: 15.5, fontWeight: 600 }}>{formName} is provisioned.</div>
                </div>
                <div style={{ fontSize: 13.5, lineHeight: 1.6, color: "var(--ink-2)" }}>I found 3 things that need attention: her Meta Pixel fires twice on checkout, her SSL renews in 9 days with no auto-renew, and her booking page drops mobile visitors at the calendar step. Want to walk through them now, or send her a welcome and let her handle them?</div>
                <div className="row" style={{ gap: 10 }}>
                  <button onClick={enterNew} className="row" style={{ gap: 6, padding: "10px 16px", borderRadius: 10, background: "var(--gold-bright)", color: "#241C05", fontSize: 13, fontWeight: 600, border: "none", cursor: "pointer" }}>Walk through them with me</button>
                  <button onClick={closeProvision} className="btn" style={{ height: 38, borderRadius: 10, fontSize: 13, color: "var(--ink-2)" }}>Send her the welcome</button>
                </div>
              </div>
            )}
          </Modal>
        )}

        {/* Help (both modes) — right drawer SlideOut → sendHelp → helpSent. */}
        <SlideOut open={helpOpen} onClose={() => setHelpOpen(false)} title="Help and support" sub="Tell me what's going on — I pull your account context in myself." icon={<Ic.spark size={15} />}
          foot={
            <>
              <input placeholder="Describe what's happening…" style={{ width: "100%", padding: "11px 13px", borderRadius: 10, border: "1px solid var(--line)", background: "var(--surface-2)", color: "var(--ink)", fontSize: 13, fontFamily: "inherit", outline: "none" }} />
              <div className="row" style={{ gap: 10, width: "100%" }}>
                <div style={{ fontSize: 12, color: "var(--ink-3)", cursor: "pointer" }}>＋ Attach a screenshot</div>
                <button onClick={() => setHelpSent(true)} className="row" style={{ marginLeft: "auto", gap: 6, padding: "9px 16px", borderRadius: 9, background: "var(--gold-bright)", color: "#241C05", fontSize: 13, fontWeight: 600, border: "none", cursor: "pointer" }}>Send to Paige</button>
              </div>
            </>
          }>
          {!helpSent ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <div style={{ fontSize: 13.5, lineHeight: 1.6, color: "var(--ink-2)" }}>Tell me what's going on in your own words. I'll pull your account context in myself — no ticket form.</div>
              <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
                {HELP_PROMPTS.map(p => (
                  <span key={p} className="pill pill-n" style={{ height: 30, padding: "0 12px", border: "1px solid var(--line)", background: "var(--surface)", color: "var(--ink-2)", cursor: "pointer" }}>{p}</span>
                ))}
              </div>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <div style={{ alignSelf: "flex-end", maxWidth: "86%", padding: "11px 14px", borderRadius: 12, background: "var(--surface-sunk)", fontSize: 13.5, lineHeight: 1.55 }}>Two of my sub-accounts' Stripe connections dropped overnight. Is this on your side?</div>
              <div style={{ fontSize: 11, color: "var(--ink-3)" }}>Paige Agent AI support · just now</div>
              <div style={{ maxWidth: "88%", padding: "12px 14px", borderRadius: 12, background: "var(--surface)", border: "1px solid var(--line)", fontSize: 13.5, lineHeight: 1.6, color: "var(--ink-2)" }}>Yes — a Stripe token rotation last night dropped connections for 41 workspaces, yours among them. Reconnection is automatic and both of yours are already back; no charges failed in the window. I'm holding this thread open until you confirm your dashboards agree.</div>
              <div className="row" style={{ gap: 9 }}>
                <span className="pill pill-ok" style={{ height: 24 }}>Response ready</span>
                <span style={{ fontSize: 12, color: "var(--ink-3)" }}>First response in 6 minutes</span>
              </div>
            </div>
          )}
        </SlideOut>
      </div>
    </div>
    </TenantCommandCenterShell>
  );
};

const AgencyApp = (props) => (
  <AgentPresenceProvider launcherEnabled={false} hasChatBody>
    <VoiceDeviceProvider>
      <DialPadSurface />
      <IncomingCallOverlay />
      <LiveTranscriptPanel />
      <AgencyAppContent {...props} />
    </VoiceDeviceProvider>
  </AgentPresenceProvider>
);

export default AgencyApp;
