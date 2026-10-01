// @ts-nocheck
// Agency pack — Team (TEAM nav) screen. Faithful port of the Claude Design "CRM
// agency mode" pack Team view (owner-locked handoff 2026-08-17, §28/§30/§31/§63 —
// "we do not drift off this whatsoever"), mirroring the Solo team precedent
// (src/solo/team.tsx + team-dir.tsx + team-roles.tsx) and the sibling agency
// modules (CommandCenter / TeamBlock / automations).
//
// Source of truth: "Agency Shell.dc.html" —
//   • the isTeamNav render block          → lines 3323–4182 (header eyebrow/title/
//     banner "!" + capacity pill + agency↔book↔sub ScopeSeg + "Her read" rail-cta +
//     Invite CTA + scopeNote + per-sub picker + center column + rail aside).
//   • the teamData view-builder            → lines 9522–9593 (tab/scope resolution,
//     TEAM_VIEW consumption, tmCenter trim/openAll, tmRail, banners, capacity copy).
//   • the two team pop-outs                → lines 6012–6041 (tmListOpen block-detail
//     modal + tmRailOpen "her read" modal).
//   • sub-tab strip                        → line 12674 (TEAM_TABS → the six tabs).
//
// This module is a consumer of the already-ported TeamBlock.tsx (default
// TeamBlock({block,gold,ask}) + TEAM_VIEW render-logic). It REUSES both — it does NOT
// re-implement team logic (§18 one home). All row/seat/roster/roledef/capacity/feed
// shaping stays inside TeamBlock; this file is the shell chrome (header, tabs, scope
// seg, picker, layout, pop-outs) around them.
//
// ── SLICE B WIRING (§28 — only the DATA SOURCE changes; the ported design is frozen,
//    layout/components/copy untouched, TeamBlock reused byte-for-byte) ──────────────
// The Roster / Directory / Roles-&-invites tabs at AGENCY scope now render the REAL
// team from `useAgencyPeople` (agency_list_team in agency-aggregate mode; the sub's
// OWN members via admin-list-users in own/acting mode — §51 session-derived, never a
// client tenant_id). Role / status / invite / remove are wired to the adapter's
// server-gated mutations via an additive "Your team" modal reached from the header
// Invite button (the same additive-modal pattern CommandCenter Slice A uses to carry
// its mutations — the frozen inline surface is untouched).
//
// HONEST PREVIEW (§13): Workload / Performance / Activity — and the cross-book Book /
// Per-sub-account scopes — have NO parentage-gated backend (utilization, hours,
// department output, the cross-book activity feed, and any cross-book roster roll-up
// would be the #86 leak). Those keep the frozen fixture TEAM_VIEW layout and are
// truthfully flagged with a PreviewPill; the design's own "!" stand-in banner already
// discloses the figures. No fixture value is ever shown as if it were live: on the
// REAL tabs every per-person utilization/hours/focus field is dropped (the adapter
// reports null for them), never fabricated.
//
// DCLogic→React notes (§13 honesty):
//  • The design drives compact/short off st.mainW/st.mainH probes on the shell's
//    main region. This module has no shell probe, so it measures ITS OWN root box
//    with a ResizeObserver (narrow = width<1000, short = height<620) — a faithful
//    reproduction of the same responsive logic, keyed to the same thresholds.
//  • Structural chrome is token-driven (var(--…)) so it themes light↔dark under
//    `.paige-agency[data-theme]` (§23). TeamBlock keeps its own literal palette per
//    the handoff — it is passed `gold=var(--gold-bright)` for its act-moment CTA fill.
//
// §51 tier gate: crossBook = isAgency && !acting. The agency↔book↔sub ScopeSeg, the
// Book/Per-sub-account scopes, the per-sub picker, and every cross-book aggregate
// render ONLY behind crossBook. A standalone sub-account (isAgency false) OR an
// agency acting-as a sub (acting != null) collapses to its OWN team only — scope is
// forced to "agency" (their own roster), no parent aggregate (§9/§51; the #86 leak
// class). §63: every fixture name is fictional.
import React from "react";
import { useSubtabRoute } from "@/lib/routing/useSubtabRoute";
import { ScopeSeg, Modal, TONE } from "./_shared";
import TeamBlock, { TEAM_VIEW, tmInit } from "./TeamBlock";
import { TEAM_TABS, TEAM_SUBS, TEAM_CAP } from "./fixtures";
import { useAgencyPeople } from "./data/useAgencyPeople";

const GOLD_BG = "var(--gold-bright)";
const GOLD_INK = "#241C05";
const BRAND = "#7C6CE0"; // the design's agency-team brand plate (hex — feeds AV()).
const noop = () => {};

// Tabs whose data has a REAL backend today (the sub-account's own team). Everything
// else is honest Preview (§13). Cross-book Book/Per-sub scopes are always Preview.
const REAL_TABS = new Set(["roster", "directory", "roles"]);

// Roles offered in the manage modal. Agency-team roles (setRole targets) vs invite
// default roles (create_tenant_invite_token `_default_role`). Kept here, not imported
// from the adapter, so the adapter stays a pure data seam.
const AGENCY_ROLES = [
  ["agency_owner", "Owner"], ["agency_admin", "Admin"], ["agency_manager", "Manager"],
  ["agency_biller", "Billing"], ["agency_specialist", "Specialist"], ["agency_viewer", "Viewer"],
];
const INVITE_ROLES = [["member", "Member"], ["admin", "Admin"], ["owner", "Owner"]];

const STATUS_META = {
  active: { label: "Live", tone: TONE.green, bg: "var(--ok-tint)" },
  invited: { label: "Invited", tone: TONE.amber, bg: "var(--warn-tint)" },
  suspended: { label: "Suspended", tone: TONE.red, bg: "var(--bad-tint)" },
};
const statusMeta = s => STATUS_META[s] || { label: s ? s[0].toUpperCase() + s.slice(1) : "—", tone: TONE.ink, bg: "var(--surface-sunk)" };

// Honest marker for surfaces the adapter reports NO backend for (§13). Mirrors the
// CommandCenter Slice-A PreviewPill (the `pill pill-n` chip) exactly.
const PreviewPill = () => (
  <span className="pill pill-n" title="Sample layout — not yet wired to your live data">Preview</span>
);

// ── REAL descriptor builder — the same block shapes/copy TEAM_VIEW ships, populated
//    from adapter data. No-backend per-person fields (utilization/hours/focus) are
//    dropped, never fabricated; the honest rail note says so. ──────────────────────
function buildRealView(tab, data) {
  const members = data.people;
  const invited = members.filter(m => m.status === "invited");
  const activeCount = members.filter(m => m.status === "active").length;
  const seats = data.seats;
  const roles = data.roles;
  const scopeNote = data.mode === "agency"
    ? "Your agency's own team. Each sub-account's team lives inside their workspace."
    : "Your team — everyone doing the work here.";

  const stats = items => ({ type: "stats", items });
  const rows = (title, sub, list) => ({ type: "rows", title, sub, list });
  const profiles = (title, sub, list) => ({ type: "profiles", title, sub, list });
  const roledef = o => ({ type: "roledef", ...o });
  const invites = o => ({ type: "invites", ...o });
  const note = (title, body, cta) => ({ type: "note", title, body, cta });

  if (tab === "roster") {
    return {
      title: "Roster", sub: "Everyone doing the work — the people you hired and the departments she runs.",
      scopeNote, banner: null,
      center: [
        stats([
          { label: "TEAM MEMBERS", value: String(members.length), note: activeCount + " active" },
          { label: "SEATS", value: seats.limit != null ? seats.used + "/" + seats.limit : String(seats.used), note: seats.available != null ? seats.available + " open" : "no seat cap set" },
          { label: "ROLES", value: String(roles.length), note: "defined on the team" },
          { label: "INVITED", value: String(invited.length), note: invited.length ? "awaiting acceptance" : "all onboarded", tone: invited.length ? TONE.amber : TONE.green },
        ]),
        rows("Who is carrying the work", "People and their roles — per-person utilization and capacity aren't wired to a backend yet.",
          members.map(m => {
            const st = statusMeta(m.status);
            return {
              name: m.name, color: BRAND, initials: tmInit(m.name),
              line: m.roleLabel + (m.email ? " · " + m.email : ""),
              value: st.label, meta: m.isYou ? "You" : "",
              dot: st.tone, pct: null, // no utilization backend — empty meter, not a fabricated %
              tail: m.scopedCount != null && m.scopedCount > 0
                ? m.scopedCount + (m.scopedCount === 1 ? " account" : " accounts") : null,
            };
          })),
      ],
      rail: [
        note("Utilization isn't wired yet",
          "The roster is live from your team records — names, roles, status and seat counts are real. Per-person utilization, hours booked and each person's current focus have no backend yet, so they're not shown here rather than filled with a stand-in.",
          null),
      ],
    };
  }

  if (tab === "directory") {
    return {
      title: "Directory", sub: "Team members only. Role, contact and status.",
      scopeNote, banner: null,
      center: [
        profiles("Team directory", "Team members — name, role, contact and status are live; photos aren't wired yet.",
          members.map(m => {
            const st = statusMeta(m.status);
            return {
              name: m.name, initials: tmInit(m.name), color: BRAND,
              role: m.roleLabel, mail: m.email || "No email on file", tz: "", photo: false,
              badges: [
                { label: m.roleLabel, kind: "role" },
                { label: st.label, kind: m.status === "active" ? "live" : "invited" },
              ],
              cta: data.canManage ? "Manage" : "View", dot: st.tone,
            };
          })),
      ],
      rail: [
        invites({
          title: "Team", sub: members.length + " members · " + invited.length + " invited",
          statLabel: "SEATS USED",
          statValue: seats.limit != null ? seats.used + " of " + seats.limit : String(seats.used),
          pct: seats.limit ? Math.min(100, Math.round((seats.used / seats.limit) * 100)) : 0,
          statNote: "Role and status are live. Contact photos and time zones aren't wired to a backend yet.",
          list: invited.slice(0, 4).map(m => ({
            name: m.name, initials: tmInit(m.name), color: BRAND,
            state: "Invite pending", cta: "Resend",
          })),
          foot: "Outside professionals — CPA, attorney, insurance broker, registered agent — are kept in Setup, not here.",
        }),
      ],
    };
  }

  // tab === "roles"
  const mgr = roles.find(r => r.isManager) || roles[0];
  return {
    title: "Roles & invites", sub: "What each role is responsible for, who holds it, and who can invite into it.",
    scopeNote, banner: null,
    center: [
      roledef({
        title: mgr ? mgr.label : "Owner", sub: "Role definition and who holds it",
        adminBadge: mgr && mgr.isManager ? "Admin role" : null,
        seatLine: mgr
          ? mgr.count + (mgr.count === 1 ? " member" : " members") + " · " + members.length + " on the team"
          : "No members yet",
        body: "Runs the business and answers for it. The only seat that can move autonomy or open sealed records.",
        editCta: "Edit role",
        inviteCta: data.canManage ? "Invite to this role" : null,
        responsibilities: [
          "Sets every department's autonomy level",
          "Approves anything she drafts above draft-only",
          "Owns pricing, contracts and repricing conversations",
          "Signs off on new seats and role changes",
          "Reads the books monthly",
        ],
        depts: ["All departments"],
        unlocks: [
          { label: "Change autonomy", val: "Yes" },
          { label: "Open sealed records", val: "Yes" },
          { label: "Export client data", val: "Yes" },
          { label: "Invite and remove seats", val: "Yes" },
        ],
      }),
    ],
    rail: [
      invites({
        title: "Roles", sub: roles.length + " defined · " + roles.filter(r => r.count > 0).length + " filled",
        roleList: roles.map(r => ({
          role: r.label,
          who: r.names.slice(0, 3).join(", ") + (r.names.length > 3 ? " +" + (r.names.length - 3) : ""),
          initials: (r.label || "?")[0], seats: String(r.count),
          admin: r.isManager ? "Admin" : null, color: BRAND,
        })),
        openTitle: "OPEN INVITES",
        list: invited.map(m => ({
          name: m.name, initials: tmInit(m.name), color: BRAND,
          state: m.roleLabel + " · pending", cta: "Resend",
        })),
        bigCta: data.canManage ? "Invite someone" : null,
      }),
    ],
  };
}

// Loading / error / empty scaffolds for the REAL center pane (§11 — never a bare
// "Loading…" / blank; §32 — a real error is loud, not swallowed).
const CenterSkeleton = () => (
  <>
    <div style={{ border: "1px solid var(--line)", borderRadius: 13, background: "var(--surface)", padding: 16, flex: "none" }}>
      <div style={{ height: 10, width: "38%", background: "var(--surface-sunk)", borderRadius: 4 }} />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4,minmax(0,1fr))", gap: 10, marginTop: 13 }}>
        {[0, 1, 2, 3].map(i => <div key={i} style={{ height: 52, background: "var(--surface-sunk)", borderRadius: 10 }} />)}
      </div>
    </div>
    <div style={{ border: "1px solid var(--line)", borderRadius: 13, background: "var(--surface)", padding: 16, display: "grid", gap: 10, flex: "none" }}>
      {[0, 1, 2, 3].map(i => <div key={i} style={{ height: 34, background: "var(--surface-sunk)", borderRadius: 8 }} />)}
    </div>
  </>
);

const TeamScreen = ({ isAgency = true, acting = null, openAsk = noop }) => {
  // §39 fix (peer-gate, R3c-i finding #1) — see CommandCenter.tsx for the full note.
  const [tab, setTab] = useSubtabRoute(isAgency ? "agency" : "sub_account", "team", "roster");            // roster|directory|roles|workload|performance|activity
  const [scopeState, setScopeState] = React.useState("agency"); // agency|book|sub
  const [tSub, setTSub] = React.useState(0);                 // picked sub-account index (observe-a-sub)
  // pop-out state (the two the design's team view owns)
  const [listIdx, setListIdx] = React.useState(null);        // center block index | null → tmListOpen
  const [railOpen, setRailOpen] = React.useState(false);     // → tmRailOpen ("her read")

  // ── Team data adapter (§51 scope spine — session-derived only) ──────────────
  const data = useAgencyPeople({ isAgency, acting });

  // manage-team modal (additive — the header Invite button opens it; carries the
  // role / status / invite / remove mutations. The frozen inline surface is untouched).
  const [manageOpen, setManageOpen] = React.useState(false);
  const [inviteEmail, setInviteEmail] = React.useState("");
  const [inviteRole, setInviteRole] = React.useState("member");
  const [roleMenu, setRoleMenu] = React.useState(null);      // userId whose role menu is open
  const [busy, setBusy] = React.useState(false);
  const [toast, setToast] = React.useState(null);
  const flash = msg => { setToast(msg); setTimeout(() => setToast(null), 3200); };

  const doInvite = async () => {
    setBusy(true);
    const r = await data.invite({ email: inviteEmail, role: inviteRole });
    setBusy(false);
    if (!r.ok) { flash(r.error || "That invite didn't go through."); return; }
    setInviteEmail("");
    flash(r.token ? "Invite created — the join link is ready." : "Invite sent.");
  };
  const doStatus = async (id, cur) => {
    const next = cur === "suspended" ? "active" : "suspended";
    setBusy(true);
    const r = await data.setStatus(id, next);
    setBusy(false);
    flash(r.ok ? (next === "active" ? "Reactivated." : "Suspended.") : (r.error || "Couldn't update status."));
  };
  const doRole = async (id, role) => {
    setRoleMenu(null);
    setBusy(true);
    const r = await data.setRole(id, role);
    setBusy(false);
    flash(r.ok ? "Role updated." : (r.error || "Couldn't update role."));
  };
  const doRemove = async id => {
    setBusy(true);
    const r = await data.remove(id);
    setBusy(false);
    flash(r.ok ? "Removed from the team." : (r.error || "Couldn't remove."));
  };

  // ── Responsive probe (design st.mainW / st.mainH) ───────────────────────────
  const boxRef = React.useRef(null);
  const [dims, setDims] = React.useState({ w: 1280, h: 820 });
  React.useEffect(() => {
    const el = boxRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(entries => {
      for (const e of entries) {
        const cr = e.contentRect;
        setDims({ w: cr.width, h: cr.height });
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const narrow = dims.w > 0 && dims.w < 1000;   // design: st.mainW < 1000
  const short = dims.h > 0 && dims.h < 620;      // design: st.mainH < 620

  // ── Tab / scope resolution (design teamData 9523–9534) ──────────────────────
  const tabDef = TEAM_TABS.find(t => t.key === tab) || TEAM_TABS[0];
  const avail = tabDef.scopes;
  // §51: cross-book scope exists only in agency mode and never while acting-as a sub.
  const crossBook = isAgency && !acting;
  const scopeRaw = crossBook ? scopeState : "agency";
  const scope = avail.indexOf(scopeRaw) < 0 ? "agency" : scopeRaw;
  const picked = TEAM_SUBS[tSub] || TEAM_SUBS[0];

  // REAL only for the sub-account's OWN team (agency-scope) on the three backed tabs.
  // Cross-book Book/Per-sub scopes + Workload/Performance/Activity → honest Preview.
  const realView = REAL_TABS.has(tab) && scope === "agency";
  const previewView = !realView;

  const built = realView
    ? buildRealView(tab, data)
    : TEAM_VIEW(tab, scope, picked, short, GOLD_BG);

  const showScopes = crossBook;          // tmShowScopes (§51-gated)
  const showPicker = scope === "sub";    // tmShowPicker (only reachable when crossBook)
  const showRail = !narrow;              // tmShowRail
  const railCta = narrow ? "Her read →" : null; // tmRailCta
  const inviteCta = narrow ? "+ Invite" : "+ Invite someone"; // tmInviteCta
  const showCap = !narrow;               // tmShowCap

  // Capacity pill copy. REAL view shows real seat capacity (never a fixture hours
  // figure); Preview view keeps the design's stand-in book/sub/agency copy (disclosed
  // by the PreviewPill + the "!" banner).
  const tmCapacity = realView
    ? (data.seats.limit != null ? data.seats.used + " of " + data.seats.limit + " seats" : data.seats.used + " on the team")
    : scope === "book"
      ? TEAM_SUBS.reduce((a, s) => a + s.booked, 0) + "h of " + TEAM_SUBS.reduce((a, s) => a + s.cap, 0) + "h booked"
      : scope === "sub" ? picked.booked + "h of " + picked.cap + "h booked" : TEAM_CAP.line;
  const tmCapNote = realView
    ? (data.seats.available != null ? data.seats.available + " seats open to invite" : "No seat limit set on this workspace")
    : scope === "book"
      ? "Across every team in the book."
      : scope === "sub" ? picked.name + "'s own team, " + picked.staff + " seats." : TEAM_CAP.note;

  // Scope segments (design tmScopes — a segment disabled when this tab can't take it).
  const scopeSegs = [["agency", "Agency"], ["book", "Book"], ["sub", "Per sub-account"]].map(([k, l]) => ({
    key: k, label: l, ok: avail.indexOf(k) >= 0,
    why: l + " · not meaningful for this tab"
  }));

  // ── Center block trimming (design teamData 9567–9578, verbatim mechanism) ────
  const tmCenter = built.center.map((b, i) => {
    const listy = b.type === "rows" || b.type === "feed" || b.type === "profiles";
    const tabley = b.type === "table" || b.type === "bars";
    const cap = !short ? 99 : 2;
    const full = listy ? (b.list || []) : tabley ? (b.rows || []) : [];
    const trim = (listy || tabley) && full.length > cap;
    const out = {
      ...b, compact: narrow, slim: short, tight: short && scope === "sub",
      more: trim ? "View all " + full.length + " →" : null,
      openAll: () => setListIdx(i)
    };
    if (b.type === "roledef" && short) out.more = "View the full role →";
    if (trim && listy) out.list = full.slice(0, cap);
    if (trim && tabley) out.rows = full.slice(0, cap);
    return out;
  });

  // tmListBlock — the full (untrimmed) block reopened in the detail modal.
  const listBlock = listIdx != null && built.center[listIdx]
    ? { ...built.center[listIdx], compact: narrow, slim: false, tight: false, more: null }
    : null;

  const tmRail = built.rail.map(b => ({ ...b, compact: narrow }));

  // tab switch (named handler so the strip reads cleanly). Reset the block-detail
  // pop-out so a stale center index can never surface on a different tab.
  const goTab = k => { setListIdx(null); setTab(k); };

  // ── REAL-center render state (§11/§32) ──────────────────────────────────────
  const showSkeleton = realView && data.loading;
  const showError = realView && !data.loading && data.isError;
  const showEmpty = realView && !data.loading && !data.isError && data.people.length === 0;

  return (
    <div ref={boxRef} style={{ display: "flex", flexDirection: "column", height: "100%", minWidth: 0 }}>
      {/* sub-tab strip (design 12674 — the six TEAM_TABS, gold underline active). */}
      <div className="row tabstrip" style={{ gap: 22, padding: "0 26px", borderBottom: "1px solid var(--line)", background: "var(--canvas)", flex: "none", overflowX: "auto" }}>
        {TEAM_TABS.map(t => {
          const on = tab === t.key;
          return (
            <button key={t.key} onClick={() => goTab(t.key)} className="row" style={{ gap: 8, padding: "12px 2px", whiteSpace: "nowrap", fontSize: 13.5, fontWeight: on ? 600 : 450, color: on ? "var(--ink)" : "var(--ink-3)", borderBottom: on ? "2px solid var(--gold)" : "2px solid transparent", flex: "none", background: "transparent", border: "none", cursor: "pointer" }}>
              <span style={{ display: "flex", fontSize: 13, opacity: .9, color: on ? "var(--gold)" : "inherit" }}>{t.icon}</span>{t.label}
            </button>
          );
        })}
      </div>

      <div key={tab + scope} className="fade-in" style={{ flex: 1, minHeight: 0, padding: "18px 26px 22px", display: "flex", flexDirection: "column", gap: short ? 9 : 12, overflow: "hidden" }}>
        {/* Header: eyebrow TEAM + title + Preview marker + banner "!" + capacity pill +
            scope seg + "Her read →" (narrow) + Invite CTA. (design 3325–3352) */}
        <div className="row" style={{ alignItems: "flex-start", gap: 12, flexWrap: "wrap", flex: "none" }}>
          <div style={{ minWidth: 0 }}>
            <div className="row" style={{ gap: 9 }}>
              <span className="eyebrow" style={{ fontSize: 9.5 }}>TEAM</span>
              <span style={{ fontSize: 21, fontWeight: 700, letterSpacing: "-.02em" }}>{built.title}</span>
              {previewView && <PreviewPill />}
              {built.banner && (
                <span title={built.banner} style={{ width: 19, height: 19, borderRadius: 6, background: "var(--gold-tint)", border: "1px solid var(--gold-line)", color: "var(--warn)", display: "grid", placeItems: "center", fontSize: 11, fontWeight: 700, cursor: "help", flex: "none" }}>!</span>
              )}
            </div>
            <div style={{ fontSize: 12.5, color: "var(--ink-2)", marginTop: 5 }}>{built.sub}</div>
          </div>
          <div className="row" style={{ marginLeft: "auto", gap: 9, flexWrap: "wrap", justifyContent: "flex-end", minWidth: 0 }}>
            {showCap && (
              <div title={tmCapNote} style={{ padding: "7px 13px", borderRadius: 20, background: "var(--surface-sunk)", border: "1px solid var(--line)", fontSize: 12, fontWeight: 600, color: "var(--ink)", whiteSpace: "nowrap", flex: "none" }}>{tmCapacity}</div>
            )}
            {showScopes && <ScopeSeg segs={scopeSegs} value={scope} onChange={setScopeState} />}
            {railCta && (
              <button onClick={() => setRailOpen(true)} className="row" style={{ gap: 4, padding: "8px 13px", borderRadius: 9, border: "1px solid var(--violet-line)", background: "var(--violet-tint)", fontSize: 12, fontWeight: 600, color: "var(--violet)", whiteSpace: "nowrap", flex: "none", cursor: "pointer" }}>{railCta}</button>
            )}
            <button onClick={() => setManageOpen(true)} style={{ padding: "8px 14px", borderRadius: 9, background: GOLD_BG, color: GOLD_INK, fontSize: 12.5, fontWeight: 600, border: "none", cursor: "pointer", whiteSpace: "nowrap", flex: "none" }}>{inviteCta}</button>
          </div>
        </div>

        {/* scopeNote row (design 3355–3357). */}
        <div className="row" style={{ gap: 9, flex: "none", minWidth: 0 }}>
          <span className="trunc" style={{ fontSize: 11.5, color: "var(--ink-3)", minWidth: 0 }}>{built.scopeNote}</span>
        </div>

        {/* Per-sub-account picker — observe-a-sub scope only (§51). (design 3359–3367) */}
        {showPicker && (
          <div className="row" style={{ gap: 7, flex: "none", overflowX: "auto", paddingBottom: 2 }}>
            {TEAM_SUBS.map((s, i) => {
              const on = tSub === i;
              return (
                <button key={s.name} onClick={() => setTSub(i)} className="row" style={{ gap: 7, padding: "6px 11px", borderRadius: 20, border: "1px solid " + (on ? s.color + "66" : "var(--line)"), background: on ? s.color + "1A" : "var(--surface)", fontSize: 12, fontWeight: on ? 600 : 500, whiteSpace: "nowrap", flex: "none", cursor: "pointer" }}>
                  <span style={{ width: 7, height: 7, borderRadius: 2, background: s.color, flex: "none" }} />{s.name}
                </button>
              );
            })}
          </div>
        )}

        {/* Center column + rail aside (design 3369–3383). */}
        <div style={{ flex: 1, minHeight: 0, display: "flex", gap: 13 }}>
          <div className="pane" style={{ flex: "1 1 0", minWidth: 0, minHeight: 0, display: "flex", flexDirection: "column", gap: short ? 9 : 12, overflowY: "auto", overflowX: "hidden", paddingRight: 2 }}>
            {showSkeleton ? (
              <CenterSkeleton />
            ) : showError ? (
              <div style={{ border: "1px solid var(--bad)", borderRadius: 13, background: "var(--bad-tint)", padding: "18px 20px", flex: "none" }}>
                <div style={{ fontWeight: 600, color: "var(--bad)" }}>Couldn't load your team</div>
                <div style={{ fontSize: 13, color: "var(--ink-2)", marginTop: 6, lineHeight: 1.5 }}>The team roster didn't load — this is a real error, not an empty team. Nothing was fabricated in its place.</div>
                <button onClick={() => data.refresh()} className="btn btn-s" style={{ marginTop: 12 }}>Try again</button>
              </div>
            ) : showEmpty ? (
              <div style={{ border: "1px solid var(--line)", borderRadius: 13, background: "var(--surface)", padding: "46px 20px", textAlign: "center", flex: "none" }}>
                <div style={{ fontWeight: 600 }}>No one on the team yet</div>
                <div style={{ fontSize: 13, color: "var(--ink-2)", marginTop: 6 }}>Invite your first teammate to get started.</div>
                <button onClick={() => setManageOpen(true)} style={{ marginTop: 14, padding: "8px 14px", borderRadius: 9, background: GOLD_BG, color: GOLD_INK, fontSize: 12.5, fontWeight: 600, border: "none", cursor: "pointer" }}>+ Invite someone</button>
              </div>
            ) : (
              tmCenter.map((b, i) => <TeamBlock key={tab + scope + "-c" + i} block={b} gold={GOLD_BG} ask={openAsk} />)
            )}
          </div>
          {showRail && (
            <aside style={{ width: 300, flex: "none", minHeight: 0, display: "flex", flexDirection: "column", gap: 11, overflowY: "auto", overflowX: "hidden" }}>
              {tmRail.map((b, i) => <TeamBlock key={tab + scope + "-r" + i} block={b} gold={GOLD_BG} ask={openAsk} />)}
            </aside>
          )}
        </div>
      </div>

      {/* ── tmListOpen — block-detail pop-out (design 6012–6023). Opened by a center
          block's "View all N →" / "View the full role →" more-link (short). ────── */}
      <Modal open={listIdx != null} onClose={() => setListIdx(null)} title={built.title} size={720}>
        {listBlock && <TeamBlock block={listBlock} gold={GOLD_BG} ask={openAsk} />}
      </Modal>

      {/* ── tmRailOpen — "her read" pop-out (design 6026–6041). Opened by the header
          "Her read →" button (narrow). Renders the same rail blocks. ──────────── */}
      <Modal open={railOpen} onClose={() => setRailOpen(false)} title={built.title + " · her read"} size={600}>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {tmRail.map((b, i) => <TeamBlock key={"rail-modal-" + i} block={b} gold={GOLD_BG} ask={openAsk} />)}
        </div>
      </Modal>

      {/* ── Manage team modal (additive) — the header Invite button opens it. Carries
          the adapter's server-gated role / status / invite / remove mutations. In own /
          acting mode (canManage false) member management rejects honestly, so only the
          invite form (valid in both modes) is offered. ─────────────────────────── */}
      <Modal open={manageOpen} onClose={() => setManageOpen(false)} size={640} title="Your team" sub="Invite teammates and manage who does the work.">
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div style={{ border: "1px solid var(--line-soft)", borderRadius: 12, background: "var(--surface-2)", padding: "13px 14px" }}>
            <div style={{ fontSize: 13.5, fontWeight: 600 }}>Invite someone</div>
            <div style={{ fontSize: 12, color: "var(--ink-2)", marginTop: 3 }}>They'll get a link to join {data.mode === "agency" ? "your agency team" : "your team"}.</div>
            <input value={inviteEmail} onChange={e => setInviteEmail(e.target.value)} placeholder="name@company.com" type="email"
              style={{ width: "100%", marginTop: 10, padding: "9px 11px", borderRadius: 9, border: "1px solid var(--line)", background: "var(--surface)", fontSize: 13, color: "var(--ink)", boxSizing: "border-box" }} />
            <div className="row" style={{ gap: 6, marginTop: 9, flexWrap: "wrap" }}>
              {INVITE_ROLES.map(([k, l]) => (
                <button key={k} onClick={() => setInviteRole(k)} style={{ padding: "6px 11px", borderRadius: 20, border: "1px solid " + (inviteRole === k ? "var(--gold-line)" : "var(--line)"), background: inviteRole === k ? "var(--gold-tint)" : "var(--surface)", fontSize: 12, fontWeight: inviteRole === k ? 600 : 500, color: "var(--ink)", cursor: "pointer" }}>{l}</button>
              ))}
            </div>
            <button disabled={busy || !inviteEmail.trim()} onClick={doInvite}
              style={{ marginTop: 11, padding: "9px 15px", borderRadius: 9, background: GOLD_BG, color: GOLD_INK, fontSize: 12.5, fontWeight: 600, border: "none", cursor: busy || !inviteEmail.trim() ? "default" : "pointer", opacity: busy || !inviteEmail.trim() ? .55 : 1 }}>{busy ? "Working…" : "Send invite"}</button>
          </div>

          <div>
            <div className="row" style={{ gap: 9 }}>
              <div style={{ fontSize: 13.5, fontWeight: 600 }}>Team</div>
              <span style={{ fontSize: 12, color: "var(--ink-3)" }}>{data.people.length} {data.people.length === 1 ? "member" : "members"}</span>
              {!data.canManage && <span style={{ fontSize: 11.5, color: "var(--ink-3)", marginLeft: "auto" }}>Role changes are managed from the agency workspace.</span>}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 9, marginTop: 11 }}>
              {data.loading ? (
                [0, 1, 2].map(i => <div key={i} style={{ height: 52, background: "var(--surface-sunk)", borderRadius: 11 }} />)
              ) : data.isError ? (
                <div style={{ fontSize: 12.5, color: "var(--bad)" }}>The team didn't load. <button onClick={() => data.refresh()} style={{ color: "var(--warn)", fontWeight: 600 }}>Try again</button></div>
              ) : data.people.length === 0 ? (
                <div style={{ fontSize: 12.5, color: "var(--ink-2)" }}>No one on the team yet — send the first invite above.</div>
              ) : (
                data.people.map(m => {
                  const st = statusMeta(m.status);
                  return (
                    <div key={m.userId} style={{ border: "1px solid var(--line-soft)", borderRadius: 11, padding: "11px 12px" }}>
                      <div className="row" style={{ gap: 10 }}>
                        <div style={{ width: 30, height: 30, borderRadius: "50%", background: "var(--rail-2)", color: "var(--ink-inv)", display: "grid", placeItems: "center", fontSize: 11, fontWeight: 600, flex: "none" }}>{tmInit(m.name)}</div>
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontSize: 13.5, fontWeight: 600 }}>{m.name}{m.isYou && <span style={{ fontSize: 11, color: "var(--ink-3)", marginLeft: 6, fontWeight: 500 }}>You</span>}</div>
                          <div style={{ fontSize: 11.5, color: "var(--ink-3)", marginTop: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{m.roleLabel}{m.email ? " · " + m.email : ""}</div>
                        </div>
                        <span className="pill" style={{ marginLeft: "auto", flex: "none", background: st.bg, color: st.tone }}>{st.label}</span>
                      </div>
                      {data.canManage && !m.isYou && (
                        <div className="row" style={{ gap: 8, marginTop: 10, flexWrap: "wrap" }}>
                          <button className="btn btn-s" disabled={busy} onClick={() => setRoleMenu(roleMenu === m.userId ? null : m.userId)}>Change role</button>
                          <button className="btn btn-s" disabled={busy} onClick={() => doStatus(m.userId, m.status)}>{m.status === "suspended" ? "Reactivate" : "Suspend"}</button>
                          <button className="btn btn-s" disabled={busy} onClick={() => doRemove(m.userId)} style={{ color: "var(--bad)" }}>Remove</button>
                        </div>
                      )}
                      {data.canManage && roleMenu === m.userId && (
                        <div className="row" style={{ gap: 6, marginTop: 8, flexWrap: "wrap" }}>
                          {AGENCY_ROLES.map(([k, l]) => (
                            <button key={k} className="btn btn-s" disabled={busy} onClick={() => doRole(m.userId, k)} style={{ fontWeight: m.role === k ? 600 : 400 }}>{l}</button>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      </Modal>

      {toast && <div className="fade-in" style={{ position: "fixed", bottom: 26, left: "50%", transform: "translateX(-50%)", background: "var(--rail)", color: "var(--ink-inv)", padding: "11px 18px", borderRadius: 12, fontSize: 13, boxShadow: "var(--sh-3)", zIndex: 130, maxWidth: "min(560px,90vw)" }}>{toast}</div>}
    </div>
  );
};

export default TeamScreen;
