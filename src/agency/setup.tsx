// @ts-nocheck
// Agency pack — Setup (SETUP nav) screen. Faithful port of the Claude Design "CRM
// agency mode" pack Setup view (owner-locked handoff 2026-08-17, §28/§30/§31/§63 —
// "we do not drift off this whatsoever"), mirroring the Solo setup precedent
// (the former src/solo/setup.tsx, since deleted — the SlideOut/EditDrawer pop-out idiom) and the sibling
// agency modules (team.tsx / SetupCard.tsx / fixtures.ts).
//
// Source of truth: "Agency Shell.dc.html" —
//   • the isSetup render block          → lines 4428–4456 (SETUP eyebrow/title/sub +
//     "Saved automatically" + "⚿ Encrypted" chips + suScopeNote + the 2-col grid of
//     <dc-import name="Setup Card" card="{{c}}"> cards, line 4452).
//   • the setup view-builder            → lines 12525–12579 (SETUP_VIEW(tab,gold)
//     consumption, per-card compact/rowCap/tighter + openExpand/openEdit wiring,
//     the suPop expand + suEdit derivations, suEditGroups field-shaping, suEditFoot).
//   • the two setup pop-outs            → lines 5930–6009 (suEditOpen right-slide
//     EDIT drawer + suPopOpen center EXPAND modal re-rendering the full Setup Card).
//   • sub-tab strip                     → line 12680 (SETUP_TABS → the seven tabs,
//     "business" → the default tab).
//
// This module REUSES the already-ported SetupCard.tsx (default SetupCard({card}) +
// its SETUP_VIEW render-logic builder) — it does NOT re-implement card layout or the
// view descriptor (§18 one home). SetupCard EMITS trigger callbacks (openExpand /
// openEdit(mode)); this file authors the pop-out / edit chrome the design puts AROUND
// the grid (the <dc-import> at 4452 renders the card; 4452's parent shell owns the
// suPop/suEdit pop-outs at 5930–6009). Field definitions come from SU_FIELDS
// (config-as-data, fixtures.ts) — imported, never redefined.
//
// DCLogic→React notes (§13 honesty):
//  • The design drives compact/short off st.mainH (short = mainH<620) on the shell's
//    main region. This module has no shell probe, so it measures ITS OWN root box with
//    a ResizeObserver (short = height<620) — a faithful reproduction of the same
//    responsive logic, keyed to the same threshold. Nothing is stubbed: both pop-outs
//    render the FULL ported content (the expand modal re-mounts SetupCard at full
//    fidelity; the edit drawer renders every SU_FIELDS group/row).
//  • Structural chrome (header, tabs, scope note, the edit-drawer field rows) is
//    token-driven (var(--…)) so it themes light↔dark under `.paige-agency[data-theme]`
//    (§23). SetupCard itself keeps its own literal warm palette per the handoff (it is
//    Claude Design's card, not a token re-skin); the r.swatch brand-colour chip is real
//    data and stays its literal value.
//  • The design's suEdit is a right-slide drawer and suPop a center modal — ported onto
//    the shared _shared primitives (SlideOut / Modal), exactly as team.tsx reuses Modal.
//
// §9 / §51 seam: agency Setup is the AGENCY's OWN configuration ONLY. There is NO
// cross-sub aggregate, NO Book/Per-sub-account scope segment, and NO sub-account picker
// anywhere in Setup — SETUP_VIEW always builds this one workspace's own config, so there
// is nothing to gate behind crossBook and nothing that could leak a sub's records (the
// #86 class cannot arise here). What the seam DOES require is the scope note making the
// boundary explicit: from the agency's own view it reads "Each sub-account's Setup lives
// inside their workspace" (never edit a sub's setup from here); a standalone sub-account
// (isAgency false) or an agency acting-as a sub (acting != null) sees the own-workspace
// variant. `crossBook = isAgency && !acting` is computed and used to select that note.
// §63: every fixture name (Cook & Co, Antonio Cook, Dolores Ruiz …) is fictional.
import React from "react";
import { useSubtabRoute } from "@/lib/routing/useSubtabRoute";
import { SlideOut, Modal } from "./_shared";
import SetupCard, { SETUP_VIEW } from "./SetupCard";
import { SETUP_TABS, SU_FIELDS } from "./fixtures";
// Slice C — the §51-safe, session-derived contacts/owner adapter. REAL own-book:
// the Owner-profile card (own `profiles` row via the shipped useSoloOwner seam).
// PREVIEW (never fabricated): signature + banking (no storage in this schema, §38).
import { useAgencyContacts } from "./data/useAgencyContacts";

const GOLD_BG = "var(--gold-bright)";
const GOLD_INK = "#241C05";
const noop = () => {};

// Honest marker for surfaces with no live backend (§13) — mirrors Solo/CommandCenter.
const PreviewPill = () => (
  <span className="pill pill-n" title="Sample layout — not yet wired to your live data">Preview</span>
);

// Two-letter initials from a display name (the person-card avatar glyph).
const initialsOf = (name) =>
  (name || "").split(" ").filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase() || "—";

// suEditGroups — faithful port of the design's field-shaping (Agency Shell.dc.html
// 12554–12576). Given the open card title + mode, resolves SU_FIELDS[card] (config-
// as-data) into render-ready groups/rows carrying the sealed/readonly/caret/swatch/
// file affordances the drawer draws. `adding` blanks values and swaps placeholders.
function buildEditGroups(card, mode) {
  const groups = SU_FIELDS[card] || [
    { group: card, rows: [{ label: "Not configured yet", value: "", kind: "text" }] },
  ];
  const adding = mode === "Add";
  return groups.map((g) => ({
    group: g.group,
    sealedNote: g.sealed
      ? "Sealed — she references these but never shows them in a draft."
      : null,
    rows: g.rows.map((r) => ({
      label: r.label,
      value: adding ? "" : r.value,
      placeholder: adding ? "Add " + r.label.toLowerCase() : "Empty",
      empty: !(adding ? "" : r.value),
      sealed: r.kind === "sealed",
      readonly: r.kind === "readonly",
      caret: ["select", "date"].indexOf(r.kind) >= 0 ? "▾" : null,
      swatch: r.kind === "color" ? (adding ? null : r.value) : null,
      fileCta: r.kind === "file" ? "Replace" : null,
    })),
  }));
}

const SU_EDIT_FOOT =
  "She only uses what you put here. Nothing is inferred and nothing is shared between sub-accounts.";

// Props from the AgencyApp shell: { isAgency, acting, openAsk }.
const SetupScreen = ({ isAgency = true, acting = null, openAsk = noop }) => {
  // §39 fix (peer-gate, R3c-i finding #1) — see CommandCenter.tsx for the full note.
  const [tab, setTab] = useSubtabRoute(isAgency ? "agency" : "sub_account", "setup", "business"); // business|presence|owner|contacts|people|banking|comms
  const [suCard, setSuCard] = React.useState(null); // expanded card index | null → suPop
  const [suEdit, setSuEdit] = React.useState(null); // { card, mode } | null → suEdit drawer

  // §51 scope spine — session-derived only (own-book RLS reads; no client tenant_id).
  // REAL: owner profile (name/email via the own `profiles` row). The own-book contacts
  // query also fires here (§51-safe) but the frozen Setup has no clients surface, so it
  // is not displayed — it is never faked into the professional-bench card (§13).
  const contactsAdapter = useAgencyContacts({ isAgency, acting });
  const owner = contactsAdapter.owner;

  // ── Responsive probe (design st.mainH; short = mainH < 620) ─────────────────
  const boxRef = React.useRef(null);
  const [dims, setDims] = React.useState({ h: 820 });
  React.useEffect(() => {
    const el = boxRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) setDims({ h: e.contentRect.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const short = dims.h > 0 && dims.h < 620; // design: st.mainH < 620

  // ── §9/§51 seam: agency-own view vs own-workspace (standalone sub / acting-as) ─
  // crossBook is the tier signal; Setup has no cross-sub surface to gate, so it only
  // selects the scope-note copy. Both notes assert the same boundary: config stays in
  // its own workspace, a sub's Setup is never edited from here.
  const crossBook = isAgency && !acting;
  const suScopeNote = crossBook
    ? "Your agency's own configuration. Each sub-account's Setup lives inside their workspace."
    : "This workspace's own configuration — it stays inside this workspace.";

  // ── Tab resolution + view build (design 12526–12528) ────────────────────────
  const tabKey = SETUP_TABS.find((t) => t.key === tab) ? tab : "business";
  const built = SETUP_VIEW(tabKey, GOLD_BG);

  // ── Per-card descriptors: compact/rowCap/tighter + openExpand/openEdit wiring
  //    (design 12534–12543). ────────────────────────────────────────────────────
  // REAL owner overlay (§13) — swap the Owner-profile person card to the caller's own
  // profile (name/email) where the adapter sourced it; fall back to the frozen sample
  // until it loads, so the layout stays byte-identical (§28) and nothing is fabricated.
  const withRealOwner = (c) => {
    if (tabKey !== "owner" || c.type !== "person" || !owner || !owner.name) return c;
    return {
      ...c,
      person: {
        ...(c.person || {}),
        name: owner.name,
        initials: initialsOf(owner.name),
        mail: owner.email || (c.person && c.person.mail) || "",
      },
    };
  };

  const suCards = built.cards.map(withRealOwner).map((c, i) => ({
    ...c,
    compact: short,
    rowCap: short ? (tabKey === "people" ? 1 : 2) : 99,
    tighter: short && ["contacts", "banking", "people"].indexOf(tabKey) >= 0,
    openExpand: () => setSuCard(i),
    openEdit: (mode) => setSuEdit({ card: c.title, mode: mode || "Edit" }),
  }));

  // suPopCard — the full (un-trimmed, action-less) card re-rendered in the expand
  // modal (design 12548). ──────────────────────────────────────────────────────
  const suPopCard =
    suCard == null
      ? null
      : { ...withRealOwner(built.cards[suCard]), compact: false, rowCap: 99, actions: [] };

  // suEdit derivations (design 12549–12577). ───────────────────────────────────
  const suEditMode = suEdit ? (suEdit.mode === "Add" ? "Add new" : "Editing") : "";
  const suEditSaveCta =
    suEdit && suEdit.mode === "Add" ? "Create" : "Save changes";
  const suEditGroups = suEdit ? buildEditGroups(suEdit.card, suEdit.mode) : [];

  // tab switch — reset the expand pop-out so a stale card index can't surface on a
  // different tab (openAsk kept in the mounting contract; Setup's cards carry Paige's
  // "her read" as static foot copy, not an interactive ask trigger, per the source).
  const goTab = (k) => {
    setSuCard(null);
    setTab(k);
  };
  void openAsk;

  return (
    <div ref={boxRef} style={{ display: "flex", flexDirection: "column", height: "100%", minWidth: 0 }}>
      {/* sub-tab strip (design 12680 — the seven SETUP_TABS, gold underline active). */}
      <div className="row tabstrip" style={{ gap: 22, padding: "0 26px", borderBottom: "1px solid var(--line)", background: "var(--canvas)", flex: "none", overflowX: "auto" }}>
        {SETUP_TABS.map((t) => {
          const on = tab === t.key;
          return (
            <button key={t.key} onClick={() => goTab(t.key)} className="row" style={{ gap: 8, padding: "12px 2px", whiteSpace: "nowrap", fontSize: 13.5, fontWeight: on ? 600 : 450, color: on ? "var(--ink)" : "var(--ink-3)", borderBottom: on ? "2px solid var(--gold)" : "2px solid transparent", flex: "none", background: "transparent", border: "none", cursor: "pointer" }}>
              <span style={{ display: "flex", fontSize: 13, opacity: 0.9, color: on ? "var(--gold)" : "inherit" }}>{t.icon}</span>
              {t.label}
            </button>
          );
        })}
      </div>

      {/* Setup content (design isSetup block 4429–4455). ─────────────────────── */}
      <div key={tabKey} className="fade-in" style={{ flex: 1, minHeight: 0, padding: "18px 26px 22px", display: "flex", flexDirection: "column", gap: 11, overflow: "hidden" }}>
        {/* Header: SETUP eyebrow + title + sub, and the Saved/Encrypted chips. */}
        <div className="row" style={{ alignItems: "flex-start", gap: 12, flexWrap: "wrap", flex: "none" }}>
          <div style={{ minWidth: 0 }}>
            <div className="row" style={{ gap: 9 }}>
              <span className="eyebrow" style={{ fontSize: 9.5 }}>SETUP</span>
              <span style={{ fontSize: 21, fontWeight: 700, letterSpacing: "-.02em" }}>{built.title}</span>
              {/* §13/§38 — signature + banking have no storage in this schema; the
                  Owner tab's profile is REAL, so it carries no pill. */}
              {tabKey === "banking" && <PreviewPill />}
            </div>
            <div style={{ fontSize: 12.5, color: "var(--ink-2)", marginTop: 5 }}>{built.sub}</div>
          </div>
          <div className="row" style={{ marginLeft: "auto", gap: 8, flexWrap: "wrap", justifyContent: "flex-end", minWidth: 0 }}>
            <div className="row" style={{ gap: 7, padding: "6px 12px", borderRadius: 20, background: "var(--ok-tint)", fontSize: 11.5, fontWeight: 600, color: "var(--ok)", whiteSpace: "nowrap", flex: "none" }}>
              <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--ok)" }} />
              Saved automatically
            </div>
            <div className="row" style={{ gap: 7, padding: "6px 12px", borderRadius: 20, background: "var(--surface-sunk)", fontSize: 11.5, fontWeight: 600, color: "var(--ink-2)", whiteSpace: "nowrap", flex: "none" }}>
              <span style={{ fontSize: 10 }}>⚿</span>
              Encrypted
            </div>
          </div>
        </div>

        {/* §9/§51 scope note (design 4443). */}
        <div className="trunc" style={{ fontSize: 11.5, color: "var(--ink-3)", flex: "none", minWidth: 0 }}>{suScopeNote}</div>

        {/* Card grid — always 2 columns (design suCols "repeat(2,minmax(0,1fr))"). */}
        <div style={{ flex: 1, minHeight: 0, overflowY: "auto", overflowX: "hidden", display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))", gap: 12, alignContent: "start", paddingRight: 2 }}>
          {suCards.map((c, i) => (
            <SetupCard key={tabKey + "-" + i} card={c} />
          ))}
        </div>
      </div>

      {/* ── suEditOpen — EDIT drawer (design 5930–6008). Opened by a card's Edit/Add
          action (SetupCard → openEdit(mode)). Right-slide, field groups from
          SU_FIELDS, Save/Cancel foot. Reuses the shared SlideOut. ─────────────── */}
      <SlideOut
        open={!!suEdit}
        onClose={() => setSuEdit(null)}
        title={suEdit ? suEdit.card : ""}
        sub={suEditMode}
        icon={<span style={{ fontSize: 14 }}>✎</span>}
        foot={
          <>
            <button onClick={() => setSuEdit(null)} className="row" style={{ gap: 8, padding: "10px 18px", borderRadius: 10, background: GOLD_BG, color: GOLD_INK, fontSize: 13.5, fontWeight: 600, border: "none", cursor: "pointer" }}>
              <span style={{ fontSize: 11 }}>✓</span>
              {suEditSaveCta}
            </button>
            <button onClick={() => setSuEdit(null)} style={{ padding: "10px 16px", borderRadius: 10, border: "1px solid var(--line)", background: "var(--surface)", fontSize: 13.5, color: "var(--ink-2)", cursor: "pointer" }}>Cancel</button>
            <div className="row" style={{ marginLeft: "auto", gap: 7, fontSize: 11.5, color: "var(--ink-3)", flex: "none" }}>
              <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--ok)" }} />
              Saved automatically
            </div>
          </>
        }
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {suEditGroups.map((g, gi) => (
            <div key={gi} style={{ minWidth: 0 }}>
              <div style={{ fontSize: 9.5, fontWeight: 600, letterSpacing: ".13em", color: "var(--ink-3)" }}>{g.group}</div>
              {g.sealedNote && (
                <div className="row" style={{ alignItems: "flex-start", gap: 8, marginTop: 7, padding: "9px 11px", border: "1px solid var(--line)", borderRadius: 10, background: "var(--surface-sunk)" }}>
                  <span style={{ color: "var(--ink-3)", fontSize: 11, flex: "none" }}>⚿</span>
                  <span style={{ fontSize: 11.5, lineHeight: 1.5, color: "var(--ink-2)" }}>{g.sealedNote}</span>
                </div>
              )}
              <div style={{ display: "flex", flexDirection: "column", gap: 9, marginTop: 10 }}>
                {g.rows.map((r, ri) => (
                  <div key={ri} style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 11.5, fontWeight: 600, color: "var(--ink-2)" }}>{r.label}</div>
                    <div className="row" style={{ gap: 9, marginTop: 5, padding: "9px 11px", border: "1px solid var(--line)", borderRadius: 10, background: r.readonly ? "var(--surface-sunk)" : "var(--surface)", minWidth: 0 }}>
                      {r.sealed && <span style={{ color: "var(--ink-3)", fontSize: 11, flex: "none" }}>⚿</span>}
                      {r.swatch && <span style={{ width: 16, height: 16, borderRadius: 5, background: r.swatch, border: "1px solid rgba(0,0,0,.08)", flex: "none" }} />}
                      {r.empty ? (
                        <span className="trunc" style={{ fontSize: 13, color: "var(--ink-3)", minWidth: 0 }}>{r.placeholder}</span>
                      ) : (
                        <span className="trunc" style={{ fontSize: 13, color: r.readonly ? "var(--ink-3)" : "var(--ink)", minWidth: 0 }}>{r.value}</span>
                      )}
                      {r.sealed && <span style={{ marginLeft: "auto", padding: "4px 10px", borderRadius: 8, border: "1px solid var(--line)", background: "var(--surface)", fontSize: 11, fontWeight: 600, color: "var(--ink-2)", cursor: "pointer", flex: "none" }}>Reveal</span>}
                      {r.fileCta && <span style={{ marginLeft: "auto", padding: "4px 10px", borderRadius: 8, border: "1px solid var(--line)", background: "var(--surface)", fontSize: 11, fontWeight: 600, color: "var(--ink-2)", cursor: "pointer", flex: "none" }}>{r.fileCta}</span>}
                      {r.caret && <span style={{ marginLeft: "auto", fontSize: 10, color: "var(--ink-3)", flex: "none" }}>{r.caret}</span>}
                      {r.readonly && <span style={{ marginLeft: "auto", fontSize: 10, color: "var(--ink-3)", flex: "none" }}>⚿ managed</span>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
          <div style={{ fontSize: 11.5, lineHeight: 1.55, color: "var(--ink-2)", paddingTop: 4 }}>{SU_EDIT_FOOT}</div>
        </div>
      </SlideOut>

      {/* ── suPopOpen — EXPAND modal (design 5998–6009). Opened by a card's Expand
          action / "View all N →" more-link (SetupCard → openExpand). Re-renders the
          full Setup Card at full fidelity. Reuses the shared Modal. ───────────── */}
      <Modal open={suCard != null} onClose={() => setSuCard(null)} title={built.title} size={680}>
        {suPopCard && <SetupCard card={suPopCard} />}
      </Modal>
    </div>
  );
};

export default SetupScreen;
