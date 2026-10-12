// Campaigns › dossier: the leads a campaign brought in (Experience 03 S1d-1, the map's Brought in lane). Reads `get_campaign_brief_leads`
// (migration 20271025100000; journey docs/delivery/exp03-grow-my-business-journey.md §9): each lead was
// credited to its campaign once, when it arrived, through a form attached to the campaign, a link tagged with
// its reference, or both. A lead that fit more than one campaign was never guessed; the read counts those.
//
// TRUTH BOUNDARY (§13/§70). Counts are the server's, over every credited lead; the list is the newest 200.
// A lead's stage and status are Sales' own records, read as they are now. Nothing here sends, books or moves.
import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export type LeadAttribution = "form_and_tag" | "form_link" | "campaign_tag";
export type LeadStatus = "open" | "won" | "lost" | "waiting" | "failed" | "no_opportunity";

export type CampaignLead = {
  readonly id: string;
  readonly receivedAt: string | null;
  readonly attribution: LeadAttribution;
  /** Null for a member, who sees that a lead arrived but not who it is (§9). */
  readonly name: string | null;
  readonly formName: string | null;
  readonly pipelineName: string | null;
  readonly stageLabel: string | null;
  readonly status: LeadStatus;
};

export type CampaignLeadCounts = { readonly leads: number; readonly opportunities: number; readonly won: number; readonly lost: number; readonly waiting: number; readonly failed: number };

export type CampaignLeadsState = {
  readonly phase: "loading" | "ready" | "error";
  readonly canManage: boolean;
  readonly counts: CampaignLeadCounts;
  readonly leads: readonly CampaignLead[];
  /** Leads on this campaign's own forms that matched more than one campaign, so none was credited. */
  readonly uncredited: number;
  /** The forms attached to this campaign; `live` means it accepts submissions (status `active`). */
  readonly captureForms: readonly { readonly id: string; readonly name: string; readonly live: boolean }[];
  readonly truncated: boolean;
  readonly retry: () => void;
};

const EMPTY: CampaignLeadCounts = { leads: 0, opportunities: 0, won: 0, lost: 0, waiting: 0, failed: 0 };
const str = (value: unknown) => (typeof value === "string" && value.trim() ? value : null);
const num = (value: unknown) => (typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0);
const ATTRIBUTIONS: readonly LeadAttribution[] = ["form_and_tag", "form_link", "campaign_tag"];

/** Where a lead stands, from Sales' record first, then the processing it is still in. */
function statusOf(row: Record<string, unknown>): LeadStatus {
  const deal = str(row.deal_status);
  if (deal === "won" || deal === "lost" || deal === "open") return deal;
  const processing = str(row.processing_state);
  if (processing === "error") return "failed";
  if (processing === "pending" || processing === "claimed") return "waiting";
  return "no_opportunity";
}

/** Parses the read; anything malformed is dropped rather than drawn as a lead that isn't there. */
export function readCampaignLeads(data: unknown): Omit<CampaignLeadsState, "phase" | "retry"> {
  const payload = (data && typeof data === "object" ? data : {}) as Record<string, unknown>;
  const counts = (payload.counts && typeof payload.counts === "object" ? payload.counts : {}) as Record<string, unknown>;
  const leads = (Array.isArray(payload.leads) ? payload.leads : []).flatMap((raw): CampaignLead[] => {
    if (!raw || typeof raw !== "object") return [];
    const row = raw as Record<string, unknown>;
    const id = str(row.submission_id);
    const attribution = ATTRIBUTIONS.find((value) => value === row.attribution);
    if (!id || !attribution) return [];
    return [{
      id, attribution, receivedAt: str(row.received_at), name: str(row.contact_name), formName: str(row.form_name),
      pipelineName: str(row.pipeline_name), stageLabel: str(row.stage_label), status: statusOf(row),
    }];
  });
  const captureForms = (Array.isArray(payload.capture_forms) ? payload.capture_forms : []).flatMap((raw) => {
    const row = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
    const id = str(row.form_id);
    return id ? [{ id, name: str(row.name) ?? "Untitled form", live: row.status === "active" }] : [];
  });
  return {
    canManage: payload.can_manage === true,
    counts: {
      leads: num(counts.leads), opportunities: num(counts.with_opportunity), won: num(counts.won), lost: num(counts.lost),
      waiting: num(counts.waiting), failed: num(counts.failed),
    },
    leads, uncredited: num(payload.ambiguous_on_campaign_forms), captureForms, truncated: payload.truncated === true,
  };
}

type Rpc = (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message?: string } | null }>;
const rpc: Rpc = (fn, args) => (supabase as unknown as { rpc: Rpc }).rpc(fn, args);

/** One campaign's leads. Read only where it is shown: the open dossier. */
export function useCampaignLeads(tenantId: string | null, briefId: string | null): CampaignLeadsState {
  const [refreshKey, setRefreshKey] = useState(0);
  // `key` names the campaign the state belongs to, so another campaign's counts are never drawn, even for the
  // one render before the effect for the new campaign runs.
  const key = tenantId && briefId ? `${tenantId}:${briefId}` : null;
  const [state, setState] = useState<Omit<CampaignLeadsState, "retry"> & { key: string | null }>({ key: null, phase: "loading", canManage: false, counts: EMPTY, leads: [], uncredited: 0, captureForms: [], truncated: false });
  const retry = useCallback(() => setRefreshKey((key) => key + 1), []);
  // Only the newest read may draw, so a slow older read never replaces a newer one.
  const seq = useRef(0);

  useEffect(() => {
    if (!tenantId || !briefId) return;
    let live = true;
    const ticket = ++seq.current;
    setState((current) => ({ ...current, key: `${tenantId}:${briefId}`, phase: "loading" }));
    Promise.resolve(rpc("get_campaign_brief_leads", { _tenant_id: tenantId, _brief_id: briefId })).then(({ data, error }) => {
      if (!live || ticket !== seq.current) return;
      if (error) throw new Error(error.message ?? "read failed");
      setState({ key: `${tenantId}:${briefId}`, phase: "ready", ...readCampaignLeads(data) });
    }).catch((error: unknown) => {
      if (!live || ticket !== seq.current) return;
      console.error("[campaign-leads] read failed", error);
      setState({ key: `${tenantId}:${briefId}`, phase: "error", canManage: false, counts: EMPTY, leads: [], uncredited: 0, captureForms: [], truncated: false });
    });
    return () => { live = false; };
  }, [tenantId, briefId, refreshKey]);

  const { key: stateKey, ...rest } = state;
  return { ...rest, phase: !key ? "error" : stateKey === key ? rest.phase : "loading", retry };
}
