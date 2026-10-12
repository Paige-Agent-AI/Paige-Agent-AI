// Campaigns: what each campaign brief is made of (INT-298 MBC slice 3). Reads and writes the campaign ↔
// asset links through their governed RPCs (contract: docs/delivery/campaign-asset-links-contract.md):
// `get_campaign_brief_assets` for every live link on the workspace's briefs, plus what an owner/admin could
// attach, and `configure_campaign_brief_assets` to attach or detach one piece.
//
// TRUTH BOUNDARY (§13/§70). A link says "this piece is part of that campaign". It is never proof that
// anything was sent, published or seen. A write is reported done only after the re-read shows the link
// present (attach) or gone (detach); a write the read cannot confirm says so.
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export type CampaignAssetKind = "page" | "form" | "funnel" | "email_campaign" | "email_series" | "content" | "social_post";
export type LinkableKind = Exclude<CampaignAssetKind, "social_post">;

export type CampaignAssetLink = {
  readonly briefId: string;
  readonly kind: CampaignAssetKind;
  readonly id: string;
  /** Null when this viewer may not read the piece itself (a member, for emails and library pieces). */
  readonly name: string | null;
  readonly status: string | null;
  readonly channel: string | null;
  readonly createdThrough: string | null;
  readonly linkedAt: string | null;
  readonly detachable: boolean;
};
export type AttachableAsset = { readonly kind: LinkableKind; readonly id: string; readonly name: string; readonly status: string | null; readonly channel: string | null };

export type CampaignAssetsState = {
  readonly phase: "loading" | "ready" | "error";
  readonly canManage: boolean;
  readonly links: readonly CampaignAssetLink[];
  readonly available: readonly AttachableAsset[];
  readonly retry: () => void;
  readonly attach: (briefId: string, kind: LinkableKind, assetId: string) => Promise<{ ok: boolean; message: string }>;
  readonly detach: (briefId: string, kind: LinkableKind, assetId: string) => Promise<{ ok: boolean; message: string }>;
};

const KINDS: readonly CampaignAssetKind[] = ["page", "form", "funnel", "email_campaign", "email_series", "content", "social_post"];
const isKind = (value: unknown): value is CampaignAssetKind => typeof value === "string" && (KINDS as readonly string[]).includes(value);
const str = (value: unknown) => (typeof value === "string" && value.trim() ? value : null);

// How a piece and its state read to a person (the dossier, readiness and Paige say the same words).
export function kindLabel(kind: CampaignAssetKind, channel: string | null): string {
  switch (kind) {
    case "page": return "Page";
    case "form": return "Form";
    case "funnel": return "Funnel";
    case "email_campaign": return "Email";
    case "email_series": return "Email series";
    case "social_post": return "Social post";
    case "content": return channel === "ad_copy" ? "Ad copy" : "Library piece";
  }
}

const STATUS: Record<string, string> = {
  draft: "Draft", published: "Published", active: "Live", archived: "Archived",
  pending_approval: "Waiting for approval", scheduled: "Scheduled", sending: "Sending", completed: "Sent",
  partially_completed: "Partly sent", failed: "Failed", blocked: "Blocked", cancelled: "Cancelled",
  paused: "Paused", stopped: "Stopped", review_requested: "In review", approved: "Approved", abandoned: "Abandoned",
};
export function statusLabel(kind: CampaignAssetKind, status: string | null): string | null {
  if (!status) return null;
  if (kind === "email_series" && status === "active") return "Running";
  return STATUS[status] ?? null;
}

// pg-token parity: every token the writer raises reads as a sentence a person can act on.
export function assetMessageFor(detail: string): string {
  const has = (token: string) => detail.includes(token);
  if (has("CAMPAIGN_ASSET_NOT_FOUND")) return "That piece is no longer available in this workspace (it may have been archived). Nothing was changed.";
  if (has("CAMPAIGN_BRIEF_NOT_FOUND")) return "That campaign is no longer available in this workspace. Nothing was changed.";
  if (has("CAMPAIGN_BRIEF_FORBIDDEN")) return "Only owners and admins can change what a campaign uses, and the server refused the change.";
  if (has("CAMPAIGN_BRIEF_IDEMPOTENCY_CONFLICT")) return "That action was already recorded with different details. Reload and try again.";
  if (has("CAMPAIGN_ASSET_KIND_INVALID") || has("CAMPAIGN_ASSET_ARGUMENTS_INVALID") || has("CAMPAIGN_BRIEF_ACTION_INVALID")
    || has("CAMPAIGN_BRIEF_IDEMPOTENCY_REQUIRED") || has("CAMPAIGN_BRIEF_ACTOR_INVALID")) return "That change could not be saved. Nothing else was changed.";
  return "That change could not be saved. Nothing else was changed.";
}

type Payload = { can_manage?: unknown; links?: unknown; available?: unknown };
export function readAssets(data: unknown): Pick<CampaignAssetsState, "canManage" | "links" | "available"> {
  const payload = (data ?? {}) as Payload;
  const links = (Array.isArray(payload.links) ? payload.links : []).flatMap((row: Record<string, unknown>) => (
    isKind(row?.kind) && str(row.brief_id) && str(row.id) ? [{
      briefId: String(row.brief_id), kind: row.kind, id: String(row.id), name: str(row.name), status: str(row.status), channel: str(row.channel),
      createdThrough: str(row.created_through), linkedAt: str(row.linked_at), detachable: row.detachable === true,
    }] : []));
  const available = (Array.isArray(payload.available) ? payload.available : []).flatMap((row: Record<string, unknown>) => (
    isKind(row?.kind) && row.kind !== "social_post" && str(row.id) && str(row.name)
      ? [{ kind: row.kind as LinkableKind, id: String(row.id), name: String(row.name), status: str(row.status), channel: str(row.channel) }] : []));
  return { canManage: payload.can_manage === true, links, available };
}

type Rpc = (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message?: string } | null }>;
const rpc: Rpc = (fn, args) => (supabase as unknown as { rpc: Rpc }).rpc(fn, args);

export function useCampaignAssets(tenantId: string | null): CampaignAssetsState {
  const [refreshKey, setRefreshKey] = useState(0);
  const [state, setState] = useState<Pick<CampaignAssetsState, "phase" | "canManage" | "links" | "available">>({ phase: "loading", canManage: false, links: [], available: [] });
  const retry = useCallback(() => setRefreshKey((key) => key + 1), []);

  const read = useCallback(async () => {
    const { data, error } = await rpc("get_campaign_brief_assets", { _tenant_id: tenantId, _brief_id: null });
    if (error) throw new Error(error.message ?? "read failed");
    return readAssets(data);
  }, [tenantId]);

  useEffect(() => {
    if (!tenantId) return;
    let live = true;
    setState((current) => ({ ...current, phase: "loading" }));
    read().then((next) => { if (live) setState({ phase: "ready", ...next }); }, (error) => {
      if (!live) return;
      console.error("[campaign-assets] read failed", error);
      setState({ phase: "error", canManage: false, links: [], available: [] });
    });
    return () => { live = false; };
  }, [tenantId, refreshKey, read]);

  const write = useCallback(async (type: "attach_asset" | "detach_asset", briefId: string, kind: LinkableKind, assetId: string) => {
    if (!tenantId) return { ok: false, message: "This workspace could not be resolved, so nothing was saved." };
    const { data, error } = await rpc("configure_campaign_brief_assets", {
      _tenant_id: tenantId, _command: { type, briefId, assetKind: kind, assetId }, _idempotency_key: crypto.randomUUID(), _actor_kind: "human",
    });
    if (error) {
      console.error("[campaign-assets] write failed", { type, error });
      return { ok: false, message: assetMessageFor(String(error.message || "")) };
    }
    // Verified readback: the change counts only once the server's own read shows it.
    try {
      const next = await read();
      setState({ phase: "ready", ...next });
      const present = next.links.some((link) => link.briefId === briefId && link.kind === kind && link.id === assetId);
      if (present !== (type === "attach_asset")) return { ok: false, message: "The change was sent but the campaign doesn't show it yet. Reload to check." };
    } catch (readError) {
      console.error("[campaign-assets] readback failed", readError);
      return { ok: false, message: "The change was sent but couldn't be confirmed. Reload to check." };
    }
    const message = (data as { message?: unknown } | null)?.message;
    return { ok: true, message: typeof message === "string" ? message : "Saved." };
  }, [tenantId, read]);

  const attach = useCallback((briefId: string, kind: LinkableKind, assetId: string) => write("attach_asset", briefId, kind, assetId), [write]);
  const detach = useCallback((briefId: string, kind: LinkableKind, assetId: string) => write("detach_asset", briefId, kind, assetId), [write]);
  return { ...state, phase: tenantId ? state.phase : "loading", retry, attach, detach };
}
