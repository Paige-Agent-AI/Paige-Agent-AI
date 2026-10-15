/**
 * Command Center - Business Game Plan.
 * Plan in Motion reuses the canonical Mission/Rail contract; this surface owns
 * no strategy store, approval system, Mind, or Memory.
 */
import React, { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, ArrowRight, Check, Flag, Info, Pencil, RefreshCw, Scale, Sparkles, Target, X } from "lucide-react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { subtabPath } from "@/lib/routing/tierBranches";
import { resolveTenantAccountContext, type TenantAccountContext } from "@/components/tenant-shell/tenantShellRoutes";
import { useSoloGamePlan, type GamePlanDestination, type PlanBriefField } from "./data/useSoloGamePlan";
import { setPaigeBusinessPlanScope } from "./paigeClientScope";
import { clearPaigePublicPresenceScope } from "./paigePublicPresenceScope";
import { PlanInMotion } from "./PlanInMotion";
import { GamePlanApprovals } from "./GamePlanApprovals";
import "./solo-game-plan-workspace.css";

const SR_ONLY: React.CSSProperties = { position: "absolute", width: 1, height: 1, overflow: "hidden", clipPath: "inset(50%)" };
type Props = { accountContext?: TenantAccountContext | null; openPaige?: () => void; workspaceId?: string | null };
type OverlayKind = "edit" | "legend" | null;

export function SoloGamePlanWorkspace({ accountContext, openPaige, workspaceId }: Props = {}) {
  const account = useParams().account || "";
  const navigate = useNavigate();
  const location = useLocation();
  const play = new URLSearchParams(location.search).get('play');
  const selectedPlayId = play && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(play) ? play : null;
  const selectPlay = useCallback((id: string | null) => {
    const query = new URLSearchParams(location.search);
    if (id) query.set('play', id); else query.delete('play');
    navigate({ pathname: location.pathname, search: query.toString() ? '?' + query.toString() : '', hash: location.hash }, { replace: true });
  }, [location.pathname, location.search, location.hash, navigate]);
  const closePlay = useCallback(() => selectPlay(null), [selectPlay]);
  const plan = useSoloGamePlan(account, workspaceId);
  const resolvedAccount = resolveTenantAccountContext(accountContext);
  const [horizon, setHorizon] = useState<"annual" | "quarter">("quarter");
  const [overlay, setOverlay] = useState<OverlayKind>(null);
  const [draft, setDraft] = useState<Record<PlanBriefField, string> | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveErr, setSaveErr] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flash = useCallback((message: string) => {
    setNotice(message);
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    noticeTimer.current = setTimeout(() => setNotice(null), 4200);
  }, []);
  useEffect(() => () => { if (noticeTimer.current) clearTimeout(noticeTimer.current); }, []);

  const openPlanPaige = useCallback(() => {
    if (workspaceId) {
      clearPaigePublicPresenceScope();
      setPaigeBusinessPlanScope({ tenantId: workspaceId, surface: "business_game_plan", businessMissionId: null, label: "Business Game Plan" });
    }
    openPaige?.();
  }, [openPaige, workspaceId]);

  const go = (destination: GamePlanDestination) => {
    if (destination === "paige") { openPlanPaige(); return; }
    const route = destination === "setup" ? subtabPath("solo", account, "settings", "setup")
      : destination === "catalog" ? subtabPath("solo", account, "growth", "catalog")
      : destination === "connections" ? subtabPath("solo", account, "settings", "connections")
      : destination === "systems-check" ? subtabPath("solo", account, "command-center", "systems-check")
      : destination === "knowledge" ? subtabPath("solo", account, "paige", "knowledge")
      : destination === "clients" ? subtabPath("solo", account, "clients", "people") : null;
    if (route) navigate(route);
  };

  if (plan.loading) return <div className="gp" aria-busy="true"><div className="sd-top"><div className="sd-sk" style={{ height: 72, width: "68%" }} /><div className="sd-sk" style={{ height: 34, width: 160 }} /></div><div className="sd-field"><div className="sd-col"><div className="sd-sk" style={{ height: 300 }} /></div><div className="sd-rail"><div className="sd-sk" style={{ height: 360 }} /></div></div></div>;
  if (plan.error) return <div className="gp"><div className="sd-card"><div className="sd-errbox"><div className="ei"><AlertTriangle /></div><h3>Couldn't load your game plan</h3><p>No plan state is being assumed. Try the connected read again.</p><button className="sd-btn sd-btn-sm" onClick={plan.refresh}><RefreshCw /> Retry</button></div></div></div>;

  const brief = plan.planBrief;
  const fields = brief.fields;
  const direction = horizon === "annual" ? fields.annualDirection : fields.currentPriority || fields.goals90Day;
  const desiredOutcome = horizon === "annual" ? fields.successDefinition : fields.goals90Day;
  const openEdit = () => { setDraft({ ...fields }); setSaveErr(null); setOverlay("edit"); };
  const saveBrief = async () => {
    if (!draft || saving) return;
    setSaving(true); setSaveErr(null);
    try {
      const result = await brief.save(draft);
      if (result.ok) { setOverlay(null); setDraft(null); flash("Plan brief saved."); }
      else if (result.kind === "conflict" || result.kind === "stale") setSaveErr("This plan changed elsewhere. Close and reopen to edit the latest version.");
      else setSaveErr(("error" in result && result.error) || "Couldn't save just now.");
    } catch { setSaveErr("Couldn't save just now."); }
    finally { setSaving(false); }
  };

  return <div className="gp">
    <span style={SR_ONLY}><span data-tenant-account-name>{resolvedAccount.accountName}</span><span data-tenant-account-tier>{resolvedAccount.accountTypeLabel}</span></span>
    <div className="sd-top">
      <div><div className="sd-kicker">{resolvedAccount.accountName} - {resolvedAccount.accountTypeLabel} - {plan.greeting.dateLabel}</div><h1 className="sd-h1">{plan.greeting.salutation}, {plan.greeting.name}.</h1><p className="sd-sub">Set the direction, then keep each strategic play visible and governed as it moves.</p></div>
      <div className="sd-acts"><button className="sd-btn sd-btn-sm" onClick={plan.refresh}><RefreshCw /> Refresh</button><button className="sd-btn sd-act" onClick={openPlanPaige}><Sparkles /> Plan with Paige</button></div>
    </div>
    <div className="sd-horizon"><div className="sd-hz-strip" role="group" aria-label="Planning horizon">{plan.horizons.map((item) => <button key={item.id} className="sd-hz" aria-pressed={horizon === item.id} onClick={() => setHorizon(item.id)}><span className="hzt">{item.label}</span><span className="hzs">{item.sub}</span></button>)}</div><div className="sd-hz-meta"><span className="mlbl">Now:</span>{horizon === "annual" ? "Annual - this year" : "This quarter - 90 days"}</div></div>
    <div className="sd-field">
      <div className="sd-col">
        <section className="sd-card sd-brief"><div className="sd-brief-in">
          <div className="sd-brief-top"><span className="sd-eyebrow"><Flag /> Set your plan - {horizon === "annual" ? "Annual" : "This quarter"}</span>{brief.hasPlan && <span className="sd-approved"><Check /> Owner-set</span>}</div>
          <h2>{direction || "No direction set yet."}</h2>
          <div className="bd-outcome"><Target /><span>{desiredOutcome ? <><b>Desired outcome.</b> {desiredOutcome}</> : "Add the outcome that matters most."}</span></div>
          <div className="sd-bd-grid"><BriefCell label="Current-quarter focus" value={fields.currentPriority} /><BriefCell label="Success criteria" value={fields.successDefinition} /><BriefCell label="Constraints" value={fields.constraints} /><BriefCell label="How Paige should operate" value={fields.operatingPreferences} /><BriefCell label="What Paige must not assume" value={fields.doNotAssume} /></div>
          <div className="sd-detail-cta"><button className="sd-btn sd-btn-sm" disabled={!brief.canEdit} onClick={openEdit}><Pencil />{brief.hasPlan ? "Edit plan" : "Set your plan"}</button><button className="sd-btn sd-btn-sm sd-btn-quiet" onClick={() => setOverlay("legend")}><Info /> How this works</button></div>
          {brief.pendingProposal && <div className="sd-banner sd-banner-prop"><Sparkles /><span><b>Paige proposed a plan-brief change.</b> Review it before it becomes your direction.</span><button className="sd-btn sd-btn-sm" onClick={() => go("setup")}>Review <ArrowRight /></button></div>}
        </div></section>
        <section className="sd-card"><div className="sd-card-hd"><span className="sd-eyebrow"><Scale /> Decision &amp; opportunity desk</span></div>{plan.decisions.length === 0 ? <div className="sd-todo"><Info /><span>No owner decision is waiting right now.</span></div> : <div className="sd-list">{plan.decisions.slice(0, 4).map((item) => <button className="sd-row" key={item.id} onClick={() => go(item.destination)}><span className="sd-ic v"><Scale /></span><span className="sd-main"><span className="sd-title">{item.title}</span><span className="sd-note">{item.detail}</span></span><ArrowRight /></button>)}</div>}</section>
      </div>
      <div className="sd-rail"><GamePlanApprovals /><PlanInMotion workspaceId={workspaceId} openPaige={openPaige} onNotice={flash} selectedPlayId={selectedPlayId} onSelectPlay={selectPlay} onClosePlay={closePlay} /></div>
    </div>
    {overlay === "edit" && draft && <Overlay title={brief.hasPlan ? "Edit your plan" : "Set your plan"} onClose={() => setOverlay(null)}><div className="ov-body"><div className="ov-note"><Info /><span>This is your durable direction. Strategic plays remain separate, revisitable records in Plan in Motion.</span></div><EditField label="Annual direction" value={draft.annualDirection} onChange={(value) => setDraft({ ...draft, annualDirection: value })} /><EditField label="Current-quarter focus" value={draft.currentPriority} onChange={(value) => setDraft({ ...draft, currentPriority: value })} /><EditField label="Desired outcome" value={draft.goals90Day} onChange={(value) => setDraft({ ...draft, goals90Day: value })} /><EditField label="Success criteria" value={draft.successDefinition} onChange={(value) => setDraft({ ...draft, successDefinition: value })} /><EditField label="Constraints" value={draft.constraints} onChange={(value) => setDraft({ ...draft, constraints: value })} /><EditField label="How Paige should operate" value={draft.operatingPreferences} onChange={(value) => setDraft({ ...draft, operatingPreferences: value })} /><EditField label="What Paige must not assume" value={draft.doNotAssume} onChange={(value) => setDraft({ ...draft, doNotAssume: value })} />{saveErr && <div className="ov-err" role="alert">{saveErr}</div>}</div><div className="ov-foot"><button className="sd-btn sd-btn-sm" onClick={() => setOverlay(null)}>Cancel</button><button className="sd-btn sd-btn-sm sd-act" disabled={saving} onClick={() => void saveBrief()}><Check />{saving ? "Saving." : "Save plan"}</button></div></Overlay>}
    {overlay === "legend" && <Overlay title="How the Business Game Plan works" onClose={() => setOverlay(null)}><div className="ov-body"><div className="ov-note"><Info /><span>Set your plan holds annual and quarterly direction. Plan in Motion holds governed Strategic Plays. A play is shown as changed only after canonical readback; Rail evidence is emitted after that verification. Mind and durable Memory remain unavailable for these records.</span></div></div><div className="ov-foot"><button className="sd-btn sd-btn-sm" onClick={() => setOverlay(null)}>Close</button></div></Overlay>}
    {notice && <div className="sd-toast" role="status" aria-live="polite"><Info />{notice}</div>}
  </div>;
}
function BriefCell({ label, value }: { label: string; value: string }) { return <div className="bd-cell"><span className="bd-label">{label}</span><span className="bd-value">{value || "Not set"}</span></div>; }
function EditField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) { return <label className="ov-field"><span>{label}</span><textarea className="fin" value={value} onChange={(event) => onChange(event.target.value)} /></label>; }
function Overlay({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  const closeRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => { closeRef.current?.focus(); const key = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); }; window.addEventListener("keydown", key); return () => window.removeEventListener("keydown", key); }, [onClose]);
  return <div className="ov-scrim" data-kind="drawer" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><section className="ov-sheet" role="dialog" aria-modal="true" aria-label={title}><div className="ov-hd"><span className="oh-ic"><Flag /></span><h3>{title}</h3><button ref={closeRef} className="oh-x" aria-label="Close" onClick={onClose}><X /></button></div>{children}</section></div>;
}
export default SoloGamePlanWorkspace;
