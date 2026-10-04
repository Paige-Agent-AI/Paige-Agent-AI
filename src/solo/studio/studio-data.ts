// The Solo Vibe Studio's one door to the backend. Every call here goes through a server-authorized
// RPC (owner/admin of the ACTIVE workspace — migration 20270537000000) or an RLS-scoped read; the
// browser never names a tenant for a write and never writes a growth table directly (the publish
// guard refuses that). Nothing here reports a result it did not read back.
import { supabase } from "@/integrations/supabase/client";
import type { GrowthBlock, GrowthPageTheme } from "@/lib/growth";
import { buildGrowthBrandFloor } from "@/components/growth/growth-theme";

// Untyped rpc: several of these functions post-date the generated types.
type Rpc = (fn: string, args?: Record<string, unknown>) => Promise<{ data: unknown; error: { message?: string; code?: string } | null }>;
const rpc: Rpc = (fn, args) => (supabase.rpc as unknown as Rpc)(fn, args);

export type ArtifactKind = "page" | "form" | "funnel" | "content";

export interface ArtifactRef { kind: ArtifactKind; id: string; title: string }

export interface StudioSession {
  id: string;
  title: string;
  seedBrief: string | null;
  artifacts: ArtifactRef[];
  /** A real image of the work, when one exists (a page's share image or a made image). */
  thumbnailUrl: string | null;
  updatedAt: string;
}

export interface StudioVersion {
  id: string;
  versionNo: number;
  isCurrent: boolean;
  title: string | null;
  thumbnailUrl: string | null;
  createdAt: string;
  /** The saved row as it was at this version (to_jsonb of the form/page/funnel/image row). */
  snapshot: Record<string, unknown> | null;
}

/** A sentence written for the owner. plainError passes it through unchanged. */
export class Said extends Error {}
/** The publish call returned, but its readback did not prove a live public address. The server
 *  may already have changed the piece's state, so the caller re-reads it. */
export class PublishUnverified extends Said {}

/** A refusal the owner can read: our own sentence, or the server's without its machine code.
 *  Anything else (a dropped connection, a raw database message) becomes the fallback. */
export function plainError(err: unknown, fallback: string): string {
  if (err instanceof Said) return err.message;
  const msg = typeof err === "object" && err && "message" in err ? String((err as { message?: unknown }).message ?? "") : "";
  if (!msg) return fallback;
  const m = /^(?:GROWTH|CONTENT|STUDIO)_[A-Z_]+:\s*(.+)$/s.exec(msg.trim());
  if (m) {
    const code = msg.trim().slice(0, msg.trim().indexOf(":"));
    if (/_FORBIDDEN$/.test(code)) return "Only this workspace's owner or an admin can do that.";
    if (/_NO_TENANT$/.test(code)) return "Choose a workspace first, then try again.";
    return m[1].charAt(0).toUpperCase() + m[1].slice(1);
  }
  if (/permission denied|42501|forbidden/i.test(msg)) return "Only this workspace's owner or an admin can do that.";
  return fallback;
}

const KINDS = new Set<ArtifactKind>(["page", "form", "funnel", "content"]);
function parseRefs(raw: unknown): ArtifactRef[] {
  if (!Array.isArray(raw)) return [];
  const out: ArtifactRef[] = [];
  for (const r of raw) {
    if (!r || typeof r !== "object") continue;
    const o = r as Record<string, unknown>;
    const kind = String(o.kind ?? "") as ArtifactKind;
    if (!KINDS.has(kind) || typeof o.id !== "string") continue;
    out.push({ kind, id: o.id, title: typeof o.title === "string" && o.title ? o.title : "Untitled" });
  }
  return out;
}

function toSession(row: Record<string, unknown>): StudioSession {
  return {
    id: String(row.id),
    title: typeof row.title === "string" && row.title ? row.title : "Untitled project",
    seedBrief: typeof row.seed_brief === "string" ? row.seed_brief : null,
    artifacts: parseRefs(row.artifact_refs),
    thumbnailUrl: typeof row.thumbnail_url === "string" && row.thumbnail_url ? row.thumbnail_url : null,
    updatedAt: String(row.updated_at ?? row.created_at ?? ""),
  };
}

export async function listSessions(): Promise<StudioSession[]> {
  const { data, error } = await rpc("list_studio_sessions", { p_filter: "recent", p_tenant_id: null, p_limit: 40 });
  if (error) throw error;
  return ((data as Record<string, unknown>[] | null) ?? []).map(toSession);
}

export async function createSession(brief: string): Promise<StudioSession> {
  const title = brief.trim().replace(/\s+/g, " ").slice(0, 60);
  const { data, error } = await rpc("create_studio_session", {
    p_title: title || null, p_seed_brief: brief.trim() || null, p_transcript: [], p_is_template: false,
    p_tenant_id: null, p_owner_user_id: null,
  });
  if (error) throw error;
  const row = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | null;
  if (!row?.id) throw new Said("The project didn't save.");
  return toSession(row);
}

/** Opens a session: stamps recency server-side and returns its current manifest. */
export async function openSession(id: string): Promise<StudioSession> {
  const { data, error } = await rpc("touch_studio_session", { p_id: id, p_tenant_id: null });
  if (error) throw error;
  const row = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | null;
  if (!row?.id) throw new Said("That project isn't in this workspace.");
  return toSession(row);
}

/** Names the project. The server keeps it to the active workspace's owner/admin or the project's creator. */
export async function renameSession(id: string, title: string): Promise<void> {
  const t = title.trim().replace(/\s+/g, " ").slice(0, 80);
  if (!t) return;
  const { error } = await rpc("rename_studio_session", { p_id: id, p_title: t, p_tenant_id: null });
  if (error) throw error;
}

/** What to call a project: its name, or, until it has one, what was asked for. */
export function sessionName(s: { title: string | null; seedBrief: string | null }): string {
  if (!isUnnamed(s.title)) return String(s.title);
  return s.seedBrief ? s.seedBrief.replace(/\s+/g, " ").slice(0, 60) : "New project";
}

/** A project nobody has named yet. */
export function isUnnamed(title: string | null | undefined): boolean {
  return !title || !title.trim() || /^untitled( project)?$/i.test(title.trim());
}

// ── Chat thread ────────────────────────────────────────────────────────────────
export interface ChatTurn { role: "user" | "assistant"; content: string }

export async function ensureThread(sessionId: string): Promise<string> {
  const { data, error } = await rpc("paige_studio_thread_ensure", { p_session_id: sessionId });
  if (error) throw error;
  if (!data) throw new Said("This project's chat couldn't be opened.");
  return String(data);
}

export async function loadTurns(threadId: string): Promise<ChatTurn[]> {
  const { data, error } = await supabase
    .from("paige_chat_turns")
    .select("role, content, seq")
    .eq("thread_id", threadId)
    .in("role", ["user", "assistant"])
    .order("seq", { ascending: true });
  if (error) throw error;
  return ((data ?? []) as { role: "user" | "assistant"; content: string }[]).map((t) => ({ role: t.role, content: t.content }));
}

/** Approval cards the latest reply left waiting (its stored paige_confirm list), so a reload keeps
 *  them. Only the latest turn counts: any later message has already answered or passed them. The
 *  server still decides — an expired proposal comes back as "didn't run". */
export async function loadHeldConfirms(threadId: string): Promise<Array<{ tool: string; summary: string; fingerprint: string }>> {
  try {
    const { data } = await supabase
      .from("paige_chat_turns")
      .select("role, bundle_ref, seq")
      .eq("thread_id", threadId)
      .order("seq", { ascending: false })
      .limit(1);
    const last = ((data ?? []) as Array<{ role: string; bundle_ref: Record<string, unknown> | null }>)[0];
    if (!last || last.role !== "assistant") return [];
    const list = Array.isArray(last.bundle_ref?.paige_confirm) ? (last.bundle_ref!.paige_confirm as Array<Record<string, unknown>>) : [];
    return list
      .filter((c) => typeof c.summary === "string" && typeof c.fingerprint === "string")
      .map((c) => ({ tool: String(c.tool ?? "action"), summary: String(c.summary), fingerprint: String(c.fingerprint) }));
  } catch {
    return [];
  }
}

// ── Artifacts ──────────────────────────────────────────────────────────────────
export interface FormField {
  key: string;
  label: string;
  type: string;
  required: boolean;
  options: string[];
  placeholder?: string;
}

export interface StudioForm {
  id: string;
  name: string;
  slug: string;
  status: "draft" | "active" | "archived";
  live: boolean;
  /** The live form has saved changes that visitors don't see yet. */
  changesPending: boolean;
  intro: string;
  submitLabel: string;
  thankYou: string;
  fields: FormField[];
  routesToPipeline: boolean;
  pipelineId: string | null;
  stageId: string | null;
  notifyEmail: string | null;
}

function readFields(schema: unknown): { intro: string; submitLabel: string; fields: FormField[] } {
  const s = (schema && typeof schema === "object" ? schema : {}) as Record<string, unknown>;
  const sections = Array.isArray(s.sections) ? (s.sections as Record<string, unknown>[]) : [];
  const fields: FormField[] = [];
  let intro = "";
  for (const sec of sections) {
    if (!intro && typeof sec.description === "string") intro = sec.description;
    for (const f of Array.isArray(sec.fields) ? (sec.fields as Record<string, unknown>[]) : []) {
      if (typeof f.key !== "string") continue;
      fields.push({
        key: f.key,
        label: typeof f.label === "string" ? f.label : f.key,
        type: typeof f.type === "string" ? f.type : "text",
        required: f.required === true,
        options: Array.isArray(f.options) ? (f.options as unknown[]).filter((o): o is string => typeof o === "string") : [],
        placeholder: typeof f.placeholder === "string" ? f.placeholder : undefined,
      });
    }
  }
  return { intro, submitLabel: typeof s.submit_label === "string" && s.submit_label ? s.submit_label : "Send", fields };
}

export async function loadForm(id: string): Promise<StudioForm> {
  const { data, error } = await supabase
    .from("growth_forms")
    .select("id, name, slug, status, schema_json, draft_schema_json, success_action_json, draft_success_action_json, auto_create_deal, pipeline_id, stage_id, notify_email")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Said("That form isn't in this workspace.");
  return formFromRow(data as unknown as Record<string, unknown>);
}

/** A growth_forms row (live, or a version's snapshot) as the Studio shows it. */
export function formFromRow(r: Record<string, unknown>): StudioForm {
  const draft = r.draft_schema_json ?? r.schema_json;
  const success = (r.draft_success_action_json ?? r.success_action_json) as Record<string, unknown> | null;
  const read = readFields(draft);
  const live = r.status === "active";
  return {
    id: String(r.id),
    name: String(r.name ?? "Form"),
    slug: String(r.slug ?? ""),
    status: (r.status as StudioForm["status"]) ?? "draft",
    live,
    changesPending: live && (JSON.stringify(r.draft_schema_json ?? null) !== JSON.stringify(r.schema_json ?? null)
      || JSON.stringify(r.draft_success_action_json ?? null) !== JSON.stringify(r.success_action_json ?? null)),
    intro: read.intro,
    submitLabel: read.submitLabel,
    thankYou: success && typeof success.message === "string" ? success.message : "",
    fields: read.fields,
    routesToPipeline: r.auto_create_deal === true && !!r.pipeline_id,
    pipelineId: (r.pipeline_id as string | null) ?? null,
    stageId: (r.stage_id as string | null) ?? null,
    notifyEmail: (r.notify_email as string | null) ?? null,
  };
}

export interface StudioPage {
  id: string;
  title: string;
  slug: string;
  live: boolean;
  changesPending: boolean;
  blocks: GrowthBlock[];
  theme: GrowthPageTheme | null;
}

export async function loadPage(id: string): Promise<StudioPage> {
  const { data, error } = await supabase
    .from("growth_pages")
    .select("id, title, slug, status, blocks_json, draft_blocks_json, theme_json, draft_theme_json, seo_json, draft_seo_json")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Said("That page isn't in this workspace.");
  return pageFromRow(data as Record<string, unknown>);
}

/** A growth_pages row (live, or a version's snapshot) as the Studio shows it. */
export function pageFromRow(r: Record<string, unknown>): StudioPage {
  const live = r.status === "published";
  const blocks = (r.draft_blocks_json ?? r.blocks_json) as GrowthBlock[] | null;
  return {
    id: String(r.id), title: String(r.title ?? "Page"), slug: String(r.slug ?? ""), live,
    // Publishing a page puts its draft sections, theme and SEO live, so any of them differing is a change.
    changesPending: live && (["blocks", "theme", "seo"] as const).some((k) =>
      r[`draft_${k}_json`] != null && JSON.stringify(r[`draft_${k}_json`]) !== JSON.stringify(r[`${k}_json`])),
    blocks: Array.isArray(blocks) ? blocks : [],
    theme: ((r.draft_theme_json ?? r.theme_json) as GrowthPageTheme | null) ?? null,
  };
}

export interface FunnelStep { id: string; order: number; type: "page" | "form" | "payment" | "booking" | "thankyou"; pageId: string | null; formId: string | null }
export interface StudioFunnel { id: string; name: string; slug: string; live: boolean; steps: FunnelStep[] }

export async function loadFunnel(id: string): Promise<StudioFunnel> {
  const [{ data: f, error: fe }, { data: steps, error: se }] = await Promise.all([
    supabase.from("growth_funnels").select("id, name, slug, status").eq("id", id).maybeSingle(),
    supabase.from("growth_funnel_steps").select("id, order_index, step_type, page_id, form_id").eq("funnel_id", id).order("order_index"),
  ]);
  if (fe) throw fe;
  if (se) throw se;
  if (!f) throw new Said("That funnel isn't in this workspace.");
  const r = f as Record<string, unknown>;
  return {
    id: String(r.id), name: String(r.name ?? "Funnel"), slug: String(r.slug ?? ""), live: r.status === "active",
    steps: ((steps ?? []) as Record<string, unknown>[]).map((s) => ({
      id: String(s.id), order: Number(s.order_index ?? 0),
      type: (["form", "payment", "booking", "thankyou"].includes(String(s.step_type)) ? s.step_type : "page") as FunnelStep["type"],
      pageId: (s.page_id as string | null) ?? null, formId: (s.form_id as string | null) ?? null,
    })),
  };
}

/** A marketing_content piece linked to the project: an image Paige made, a document, or saved copy.
 *  Only an image is published from the Studio (studio_image_publish refuses anything else). */
export interface StudioImage {
  id: string;
  title: string;
  contentKind: "image" | "document" | "copy";
  imageUrl: string | null;
  body: string | null;
  live: boolean;
}

export async function loadImage(id: string): Promise<StudioImage> {
  const { data, error } = await supabase.from("marketing_content").select("id, title, kind, image_url, body, status").eq("id", id).maybeSingle();
  if (error) throw error;
  if (!data) throw new Said("That piece isn't in this workspace.");
  const r = data as Record<string, unknown>;
  const contentKind = r.kind === "image" ? "image" : r.kind === "document" ? "document" : "copy";
  return {
    id: String(r.id), title: String(r.title ?? (contentKind === "image" ? "Image" : "Untitled")), contentKind,
    imageUrl: (r.image_url as string | null) ?? null, body: (r.body as string | null) ?? null, live: r.status === "published",
  };
}

/** The tenant's brand floor, through the same anon-safe read the published pages use. */
export async function loadBrand(tenantSlug: string): Promise<{ floor: GrowthPageTheme; name: string | null; logoUrl: string | null }> {
  if (!tenantSlug) return { floor: buildGrowthBrandFloor(null), name: null, logoUrl: null };
  try {
    const { data, error } = await rpc("peek_tenant_portal_brand", { _slug: tenantSlug });
    if (error) throw error;
    const row = (Array.isArray(data) ? data[0] : data) as Record<string, string | null> | undefined;
    return { floor: buildGrowthBrandFloor(row ?? null), name: row?.tenant_name ?? null, logoUrl: row?.logo_url ?? null };
  } catch {
    return { floor: buildGrowthBrandFloor(null), name: null, logoUrl: null };
  }
}

// ── Versions ───────────────────────────────────────────────────────────────────
export async function listVersions(sessionId: string, kind: ArtifactKind, artifactId: string): Promise<StudioVersion[]> {
  const { data, error } = await rpc("list_artifact_versions", { p_session_id: sessionId, p_kind: kind, p_artifact_id: artifactId, p_tenant_id: null });
  if (error) throw error;
  return ((data as Record<string, unknown>[] | null) ?? []).map((v) => ({
    id: String(v.id), versionNo: Number(v.version_no ?? 0), isCurrent: v.is_current === true,
    title: (v.title as string | null) ?? null, thumbnailUrl: (v.thumbnail_url as string | null) ?? null, createdAt: String(v.created_at ?? ""),
    snapshot: v.snapshot && typeof v.snapshot === "object" ? (v.snapshot as Record<string, unknown>) : null,
  }));
}

export async function restoreVersion(versionId: string): Promise<void> {
  const { data, error } = await rpc("restore_artifact_version", { p_version_id: versionId, p_tenant_id: null });
  if (error) throw error;
  const row = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | null;
  if (!row?.id) throw new Said("That version couldn't be restored.");
}

// ── Publish ────────────────────────────────────────────────────────────────────
export interface PublishResult { url: string }

const PUBLISH_FN: Record<ArtifactKind, [string, string]> = {
  form: ["growth_form_publish", "growth_form_unpublish"],
  page: ["growth_page_publish", "growth_page_unpublish"],
  funnel: ["growth_funnel_publish", "growth_funnel_unpublish"],
  content: ["studio_image_publish", "studio_image_unpublish"],
};

// The live state each publish RPC reports (20270537000000): pages and images are `published`,
// forms and funnels `active`. Same rule as the chat's `publishVerified` (_shared/artifact-receipt.ts).
const LIVE_STATUS: Record<ArtifactKind, string> = { form: "active", page: "published", funnel: "active", content: "published" };

/** Live only on a readback that proves it: the live status, a publish time, and a public address.
 *  A return without an address (a workspace with no public slug) is never reported as published. */
export async function publishArtifact(kind: ArtifactKind, id: string): Promise<PublishResult> {
  const { data, error } = await rpc(PUBLISH_FN[kind][0], { p_tenant_id: null, p_id: id });
  if (error) throw error;
  const row = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | null;
  const url = row && typeof row.url === "string" ? row.url.trim() : "";
  const at = row && typeof row.published_at === "string" ? row.published_at.trim() : "";
  if (!row || row.status !== LIVE_STATUS[kind] || !at || !url) {
    throw new PublishUnverified("The publish didn't confirm a public address, so it may not be live. Check the project before sharing a link.");
  }
  return { url };
}

export async function unpublishArtifact(kind: ArtifactKind, id: string): Promise<void> {
  const { error } = await rpc(PUBLISH_FN[kind][1], { p_tenant_id: null, p_id: id });
  if (error) throw error;
}
