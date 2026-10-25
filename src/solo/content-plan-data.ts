// EXP07 row 8 — the content-calendar PLAN's one door to the backend (migration 20271113850000).
// Every call goes through the two governed RPCs (content_plan_upsert / content_plan_list), which
// carry the CONTENT family's authority: the caller's ACTIVE workspace only, owner/admin or the
// managing agency for writes, workspace membership for reads. This module never reports a result
// it did not read back, and nothing here schedules, queues or publishes anything — a plan entry
// is data, and the boundary line on the surface says so.
import { supabase } from "@/integrations/supabase/client";
import { LIBRARY_READ_LIMIT, PIECE_COLUMNS } from "./marketing-content";

type Rpc = (fn: string, args?: Record<string, unknown>) => Promise<{ data: unknown; error: { message?: string; code?: string } | null }>;
const rpc: Rpc = (fn, args) => (supabase.rpc as unknown as Rpc)(fn, args);

export type PlanStatus = "planned" | "ready" | "cancelled";
export type PlanChannel = "social_post" | "ad_copy" | "email_campaign" | "caption" | "blog_outline" | "sms_broadcast" | "site";

export interface PlanEntry {
  id: string;
  contentId: string | null;
  channel: PlanChannel;
  plannedFor: string;
  note: string | null;
  status: PlanStatus;
}

/** What a plan entry is for, in words — the same vocabulary the Content library labels use. */
export const PLAN_CHANNELS: ReadonlyArray<{ key: PlanChannel; label: string }> = [
  { key: "social_post", label: "Social post" },
  { key: "email_campaign", label: "Email" },
  { key: "ad_copy", label: "Ad copy" },
  { key: "caption", label: "Caption" },
  { key: "blog_outline", label: "Blog outline" },
  { key: "sms_broadcast", label: "Text message" },
  { key: "site", label: "Website update" },
];

export function planChannelLabel(channel: string): string {
  return PLAN_CHANNELS.find((c) => c.key === channel)?.label ?? channel;
}

function toEntry(row: Record<string, unknown>): PlanEntry {
  return {
    id: String(row.id),
    contentId: typeof row.content_id === "string" ? row.content_id : null,
    channel: String(row.channel) as PlanChannel,
    plannedFor: String(row.planned_for),
    note: typeof row.note === "string" && row.note.trim() ? row.note : null,
    status: (row.status === "ready" || row.status === "cancelled" ? row.status : "planned") as PlanStatus,
  };
}

/** The workspace's plan, soonest first. `from`/`to` bound the window (null = open). */
export async function listPlanEntries(tenantId: string, window?: { from?: string; to?: string }): Promise<PlanEntry[]> {
  void tenantId; // the RPC resolves the tenant from the session; the id is not trusted client-side
  const { data, error } = await rpc("content_plan_list", {
    p_from: window?.from ?? null, p_to: window?.to ?? null, p_tenant_id: null,
  });
  if (error) throw error;
  return ((data as Record<string, unknown>[] | null) ?? []).map(toEntry);
}

export interface PlanEntryInput {
  id: string | null;
  contentId: string | null;
  channel: PlanChannel;
  plannedFor: string;
  note: string | null;
  status: PlanStatus;
}

/** Creates (id null) or edits one entry. The server owns every rule; the returned row is truth. */
export async function upsertPlanEntry(entry: PlanEntryInput): Promise<PlanEntry> {
  const { data, error } = await rpc("content_plan_upsert", {
    p_id: entry.id, p_content_id: entry.contentId, p_channel: entry.channel,
    p_planned_for: entry.plannedFor, p_note: entry.note, p_status: entry.status, p_tenant_id: null,
  });
  if (error) throw error;
  const row = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | null;
  if (!row?.id) throw new Error("The plan change didn't save.");
  return toEntry(row);
}

/** The saved library (all kinds, newest first) — the plan labels its entries from the same read
 *  the Content tab uses, so a linked piece's title is never a second source of truth. */
export async function readAllPieces(tenantId: string): Promise<Array<{ id: string; title: string }>> {
  const { data, error } = await supabase.from("marketing_content" as never)
    .select(PIECE_COLUMNS).eq("tenant_id", tenantId).neq("status", "archived")
    .order("updated_at", { ascending: false }).limit(LIBRARY_READ_LIMIT);
  if (error) throw error;
  return ((data ?? []) as Array<{ id: string; title: string }>);
}
