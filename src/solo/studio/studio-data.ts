// The Solo Vibe Studio's one door to the backend. Every call here goes through a server-authorized
// RPC (owner/admin of the ACTIVE workspace — migration 20270537000000), an RLS-scoped read, or (for
// going live and coming down) the growth-publish-command door; the browser never names a tenant for
// a write and never writes a growth table directly (the publish guard refuses that). Nothing here
// reports a result it did not read back.
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
/** The publish door answered without proving the outcome (`outcome: "unverified"`, no public
 *  address, or no readable reply). The server may already have changed the piece's state, so the
 *  caller re-reads it. */
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
 *  Only an image is published from the Studio (the publish door refuses anything else). */
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
// One door for going live and coming down: the growth-publish-command edge function, the same
// executor chat publishing uses, so a panel publish and a chat publish carry the same authority
// check, receipt and Rail record. The panel never calls a publish RPC itself. Two calls: prepare
// (no fingerprint) returns the server's own readiness checks and, when nothing blocks, a
// fingerprint; the owner's click redeems it. The door's readback is the only success reported.
export const PUBLISH_DOOR = "growth-publish-command";

export type PublishAction = "publish" | "unpublish";
export type DoorKind = "page" | "form" | "funnel" | "image";
/** The Studio calls a made image "content"; the door calls it "image". */
export const doorKind = (kind: ArtifactKind): DoorKind => (kind === "content" ? "image" : kind);

export interface PublishCheck { key: string; label: string; ok: boolean; detail?: string }
export interface PublishPreview { title: string | null; address: string | null; checks: PublishCheck[] }

export type Prepared =
  /** Nothing blocks: the owner's click redeems this fingerprint. */
  | { state: "ready"; fingerprint: string; preview: PublishPreview }
  /** A check failed, so the server issued no fingerprint. */
  | { state: "blocked"; preview: PublishPreview }
  /** Publishing is switched off in Paige's autonomy settings. */
  | { state: "disabled"; message: string }
  /** The signed-in person isn't this workspace's owner or an admin. */
  | { state: "forbidden"; message: string }
  /** The server refused outright (not publishable, not found…), in its own words. */
  | { state: "refused"; message: string };

export interface PublicationResult { action: PublishAction; status: string | null; publishedAt: string | null; url: string | null }

/** The door refused the redeem, often because the fingerprint went stale. The panel re-prepares once. */
export class PublishRefused extends Said {}
/** Publishing is switched off in Paige's autonomy settings. */
export class PublishOff extends Said {}

const OFF_FALLBACK = "Publishing is switched off in Paige's Trust Compass, so nothing goes live from here. Turn it on in Command Center › Trust Compass.";
const FORBIDDEN_FALLBACK = "Only this workspace's owner or an admin can publish.";
const CHECK_FAILED = "Paige couldn't check this just now. Try again in a moment.";
const unverifiedFallback = (action: PublishAction) => action === "publish"
  ? "The publish didn't confirm a public address, so it may not be live. Check the project before sharing a link."
  : "Taking it offline didn't confirm, so it may still be live. Check the project before you rely on it.";

/** A server sentence as the owner reads it: trimmed, any machine-code prefix dropped. */
function serverSentence(raw: unknown, fallback: string): string {
  if (typeof raw !== "string" || !raw.trim()) return fallback;
  const t = raw.trim().replace(/^[A-Z][A-Z0-9_]{2,}:\s*/, "");
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : fallback;
}
const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);

type DoorReply = { data: Record<string, unknown> | null; transport: boolean };
/** Calls the door and reads its body whatever the status: a non-2xx body lives on the error's
 *  context Response. A reply with no readable body (a dropped connection) is `transport`. */
async function callDoor(body: Record<string, unknown>): Promise<DoorReply> {
  const { data, error } = await supabase.functions.invoke(PUBLISH_DOOR, { body });
  if (!error) return data && typeof data === "object" ? { data: data as Record<string, unknown>, transport: false } : { data: null, transport: true };
  const ctx = (error as { context?: { json?: () => Promise<unknown> } }).context;
  if (ctx && typeof ctx.json === "function") {
    try {
      const parsed = await ctx.json();
      if (parsed && typeof parsed === "object") return { data: parsed as Record<string, unknown>, transport: false };
    } catch { /* no readable body */ }
  }
  return { data: null, transport: true };
}

function readPreview(raw: unknown): PublishPreview {
  const p = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const checks: PublishCheck[] = [];
  for (const c of Array.isArray(p.checks) ? (p.checks as unknown[]) : []) {
    if (!c || typeof c !== "object") continue;
    const o = c as Record<string, unknown>;
    const label = str(o.label);
    if (!label) continue;
    checks.push({ key: str(o.key) ?? label, label, ok: o.ok === true, detail: str(o.detail) ?? undefined });
  }
  return { title: str(p.title), address: str(p.address), checks };
}

/** Asks the door to prepare a publish or an unpublish. It never sends a fingerprint, so it never
 *  executes. Throws Said when the door can't be read, and PublishUnverified if the door answers as
 *  though it acted (it must not: the owner's click is the approval). */
export async function preparePublication(kind: ArtifactKind, id: string, action: PublishAction): Promise<Prepared> {
  const { data, transport } = await callDoor({ action, kind: doorKind(kind), id });
  if (transport || !data) throw new Said(CHECK_FAILED);
  if (data.disabled === true) return { state: "disabled", message: serverSentence(data.error, OFF_FALLBACK) };
  if (data.forbidden === true) return { state: "forbidden", message: serverSentence(data.error, FORBIDDEN_FALLBACK) };
  if (data.approval_required === true) {
    const preview = readPreview(data.preview);
    const fingerprint = str(data.fingerprint);
    return fingerprint ? { state: "ready", fingerprint, preview } : { state: "blocked", preview };
  }
  if (data.ok === true || data.outcome === "unverified") {
    throw new PublishUnverified("Paige answered without waiting for your click, so this panel can't confirm what happened. Check the project before sharing a link.");
  }
  if (data.refused === true || typeof data.error === "string") {
    return { state: "refused", message: serverSentence(data.error, "Paige can't do that for this piece.") };
  }
  throw new Said(CHECK_FAILED);
}

/** Redeems a prepared fingerprint: the owner's click. Returns only on the door's verified
 *  readback, and a publish is never reported without a public address. */
export async function confirmPublication(kind: ArtifactKind, id: string, action: PublishAction, fingerprint: string): Promise<PublicationResult> {
  const { data, transport } = await callDoor({ action, kind: doorKind(kind), id, approved_fingerprint: fingerprint });
  // No readable answer after the request left: it may have run, so claim neither outcome.
  if (transport || !data) throw new PublishUnverified(unverifiedFallback(action));
  if (data.ok === true) {
    const url = str(data.url);
    if (action === "publish" && !url) throw new PublishUnverified(unverifiedFallback(action));
    return { action, status: str(data.status), publishedAt: str(data.published_at), url };
  }
  if (data.outcome === "unverified") throw new PublishUnverified(serverSentence(data.error, unverifiedFallback(action)));
  if (data.disabled === true) throw new PublishOff(serverSentence(data.error, OFF_FALLBACK));
  if (data.forbidden === true) throw new Said(serverSentence(data.error, FORBIDDEN_FALLBACK));
  // A fresh proposal in reply means the fingerprint no longer matched what is saved.
  if (data.refused === true || data.approval_required === true) {
    throw new PublishRefused(serverSentence(data.error, "Something changed since this opened."));
  }
  throw new PublishUnverified(serverSentence(data.error, unverifiedFallback(action)));
}
