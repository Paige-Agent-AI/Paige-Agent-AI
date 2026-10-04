// THE ONE PUBLISH DOOR — its request contract, its readiness checks and its plain sentences.
//
// Vibe Studio V2b (owner ruling 2026-10-04): the Studio Publish panel and chat-driven publishing do
// not keep separate authority or execution paths. Both call `growth-publish-command`, which mirrors
// the established action-door pattern (sales-invoice-command, crm-command): server-derived tenant,
// owner/admin authority, the canonical autonomy lane, a server-issued proposal in
// paige_pending_confirmations, an atomic single-use claim that runs the STORED call, a readback that
// proves the result, and exactly one capability receipt.
//
// Pure: no I/O and no Deno globals, so the readiness checks and the sentence mapping are driven by
// tests directly. The executor lives in ./door.ts.

export const PUBLISH_ACTIONS = ["publish", "unpublish"] as const;
export const PUBLISH_KINDS = ["page", "form", "funnel", "image"] as const;
export type PublishAction = typeof PUBLISH_ACTIONS[number];
export type PublishKind = typeof PUBLISH_KINDS[number];

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const FINGERPRINT = /^[0-9a-f]{16}$/;

/** The tool / capability / receipt key for each act. One key names all three on purpose. */
export const PUBLISH_KEYS: Readonly<Record<PublishAction, Readonly<Record<PublishKind, string>>>> = Object.freeze({
  publish: Object.freeze({ page: "growth_page_publish", form: "growth_form_publish", funnel: "growth_funnel_publish", image: "studio_image_publish" }),
  unpublish: Object.freeze({ page: "growth_page_unpublish", form: "growth_form_unpublish", funnel: "growth_funnel_unpublish", image: "studio_image_unpublish" }),
});

/** Every key the door files a receipt under. */
export const PUBLISH_DOOR_KEYS: ReadonlySet<string> = new Set(
  PUBLISH_ACTIONS.flatMap((a) => PUBLISH_KINDS.map((k) => PUBLISH_KEYS[a][k])),
);

/** The chat tools that now redeem through the door instead of running their own RPC. The chat
 *  files no receipt for these: the door does, once. */
export const PUBLISH_DOOR_CHAT_TOOLS: Readonly<Record<string, { kind: PublishKind; idArg: string }>> = Object.freeze({
  growth_page_publish: { kind: "page", idArg: "page_id" },
  growth_form_publish: { kind: "form", idArg: "form_id" },
  growth_funnel_publish: { kind: "funnel", idArg: "funnel_id" },
});

/** The existing server-authorized RPC each act runs (migration 20270537000000). Their name equals the key. */
export function publishRpc(action: PublishAction, kind: PublishKind): string {
  return PUBLISH_KEYS[action][kind];
}

export interface PublishCommand {
  action: PublishAction;
  kind: PublishKind;
  id: string;
  approved_fingerprint?: string;
  expected_tenant_id?: string;
  /**
   * Set by Paige's chat bridge (growth-publish-chat.ts): this call is a person's ATTEMPT, so a refusal
   * before any proposal is filed on the Rail. The Studio panel prepares on every open and never sets
   * it, so opening the panel files nothing. It widens nothing: it decides only whether a refusal is
   * recorded, never whether anything runs.
   */
  chat_attempt?: boolean;
}

const BODY_KEYS = new Set(["action", "kind", "id", "approved_fingerprint", "expected_tenant_id", "chat_attempt"]);

/** Parse the request body, closed: an unknown key, a bad action/kind, or a malformed id refuses. */
export function parsePublishCommand(value: unknown): PublishCommand {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError("INVALID_BODY");
  const body = value as Record<string, unknown>;
  if (Object.keys(body).some((k) => !BODY_KEYS.has(k))) throw new TypeError("INVALID_BODY");
  if (!PUBLISH_ACTIONS.includes(body.action as PublishAction)) throw new TypeError("INVALID_ACTION");
  if (!PUBLISH_KINDS.includes(body.kind as PublishKind)) throw new TypeError("INVALID_KIND");
  if (typeof body.id !== "string" || !UUID.test(body.id)) throw new TypeError("INVALID_ID");
  if (body.approved_fingerprint !== undefined && (typeof body.approved_fingerprint !== "string" || !FINGERPRINT.test(body.approved_fingerprint))) {
    throw new TypeError("INVALID_FINGERPRINT");
  }
  if (body.expected_tenant_id !== undefined && (typeof body.expected_tenant_id !== "string" || !UUID.test(body.expected_tenant_id))) {
    throw new TypeError("INVALID_SCOPE");
  }
  if (body.chat_attempt !== undefined && typeof body.chat_attempt !== "boolean") throw new TypeError("INVALID_ORIGIN");
  return {
    action: body.action as PublishAction,
    kind: body.kind as PublishKind,
    id: body.id.toLowerCase(),
    ...(body.approved_fingerprint !== undefined ? { approved_fingerprint: body.approved_fingerprint as string } : {}),
    ...(body.expected_tenant_id !== undefined ? { expected_tenant_id: (body.expected_tenant_id as string).toLowerCase() } : {}),
    ...(body.chat_attempt === true ? { chat_attempt: true } : {}),
  };
}

/** What a person reads about the thing, by kind. */
export const KIND_NOUN: Readonly<Record<PublishKind, string>> = Object.freeze({ page: "page", form: "form", funnel: "funnel", image: "image" });

/** The live state each kind reports (mirrors artifact-receipt.ts LIVE_STATUS). */
export const LIVE_STATUS: Readonly<Record<PublishKind, string>> = Object.freeze({ page: "published", form: "active", funnel: "active", image: "published" });

export interface ReadinessCheck { key: string; label: string; ok: boolean; blocking: boolean; detail?: string }
export interface PublishPreview {
  kind: PublishKind;
  id: string;
  title: string;
  action: PublishAction;
  address: string | null;
  checks: ReadinessCheck[];
}

/** The rows the readiness check reads. Every one was selected by id AND the server-derived tenant. */
export interface ReadinessFacts {
  tenantSlug: string | null;
  page?: Record<string, unknown> | null;
  /** Forms on the page, by slug: whether a non-archived form with that slug exists in the tenant. */
  pageFormSlugs?: ReadonlySet<string>;
  form?: Record<string, unknown> | null;
  funnel?: Record<string, unknown> | null;
  funnelSteps?: ReadonlyArray<Record<string, unknown>>;
  image?: Record<string, unknown> | null;
  /** For an unpublish: the live pieces that would break if this came down (a live funnel using a
   *  page; a live page or funnel collecting through a form). Read only for a live page or form. */
  liveDependents?: ReadonlyArray<{ kind: "page" | "funnel"; name: string }>;
}

// The same two placeholder shapes the publish RPC refuses (_growth_page_go_live). Kept identical so
// the card never says "ready" for a page the server will then refuse.
//
// Tested against each STRING VALUE on its own, never the serialized JSON (Migration F, 2026-10-04).
// Serialized, a block array starts with its own "[", so the word pattern ran from that bracket to
// the first "]" and refused any page whose copy said "your", "add", "enter"… before it — "Get your
// weekends back" read as a placeholder. A real one ([ADD_WEBINAR_DATE], [Add your date]) sits
// inside a single string, so a per-string test still finds it. Object keys are structure, not copy,
// and are not tested.
const PLACEHOLDER_TOKEN = /\[[A-Za-z0-9]*_[A-Za-z0-9_]*\]/;
const PLACEHOLDER_WORD = /\[[^\]]*\b(add|paste|insert|enter|fill|tbd|placeholder|replace|example|your)\b[^\]]*\]/i;
export function hasPlaceholder(value: unknown): boolean {
  if (typeof value === "string") return PLACEHOLDER_TOKEN.test(value) || PLACEHOLDER_WORD.test(value);
  if (Array.isArray(value)) return value.some(hasPlaceholder);
  if (value !== null && typeof value === "object") return Object.values(value).some(hasPlaceholder);
  return false;
}

/** The blocks a publish would put live: the working copy, or a live page's own blocks. */
export function blocksToPublish(page: Record<string, unknown>): unknown[] | null {
  if (Array.isArray(page.draft_blocks_json)) return page.draft_blocks_json;
  if (page.status === "published" && Array.isArray(page.blocks_json)) return page.blocks_json;
  return null;
}

function formFieldCount(form: Record<string, unknown>): { fields: number; email: boolean } {
  const schema = form.draft_schema_json ?? form.schema_json;
  const sections = Array.isArray(schema) ? schema
    : schema && typeof schema === "object" && Array.isArray((schema as Record<string, unknown>).sections)
      ? (schema as Record<string, unknown>).sections as unknown[] : [];
  let fields = 0, email = false;
  for (const sec of sections) {
    const list = sec && typeof sec === "object" ? (sec as Record<string, unknown>).fields : null;
    for (const f of Array.isArray(list) ? list : []) {
      const key = f && typeof f === "object" ? (f as Record<string, unknown>).key : null;
      if (typeof key !== "string" || !key.trim()) continue;
      fields += 1;
      if (key === "email") email = true;
    }
  }
  return { fields, email };
}

function embeddedFormSlugs(blocks: unknown[]): { missing: boolean; slugs: string[] } {
  let missing = false;
  const slugs = new Set<string>();
  for (const b of blocks) {
    if (!b || typeof b !== "object" || (b as Record<string, unknown>).type !== "embedded_form") continue;
    const slug = (b as Record<string, unknown>).form_slug;
    if (typeof slug === "string" && slug.trim()) slugs.add(slug.trim());
    else missing = true;
  }
  return { missing, slugs: [...slugs] };
}

const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;

/** The form slugs a page's publish needs, so the door can look them up before computing checks. */
export function pageFormSlugsNeeded(page: Record<string, unknown> | null | undefined): string[] {
  if (!page) return [];
  const blocks = blocksToPublish(page);
  return blocks ? embeddedFormSlugs(blocks).slugs : [];
}

/** The public address a published artifact is reached at — the same paths the publish RPCs return. */
export function publicAddress(kind: PublishKind, facts: ReadinessFacts, id: string): string | null {
  const t = facts.tenantSlug && facts.tenantSlug.trim() ? facts.tenantSlug.trim() : null;
  if (kind === "page") { const s = facts.page?.slug; return t && typeof s === "string" && s ? `/p/${t}/${s}` : null; }
  if (kind === "funnel") { const s = facts.funnel?.slug; return t && typeof s === "string" && s ? `/f/${t}/${s}` : null; }
  if (kind === "form") return `/form/${id}`;
  const url = facts.image?.image_url;
  return typeof url === "string" && url.trim() ? url : null;
}

function rowFor(kind: PublishKind, facts: ReadinessFacts): Record<string, unknown> | null | undefined {
  return kind === "page" ? facts.page : kind === "form" ? facts.form : kind === "funnel" ? facts.funnel : facts.image;
}

/** The artifact's own title, for the card. */
export function artifactTitle(kind: PublishKind, row: Record<string, unknown>): string {
  const raw = kind === "page" || kind === "image" ? row.title : row.name;
  return typeof raw === "string" && raw.trim() ? raw.trim().slice(0, 120) : `Untitled ${KIND_NOUN[kind]}`;
}

/** True when the artifact is live now. */
export function isLiveRow(kind: PublishKind, row: Record<string, unknown>): boolean {
  return row.status === LIVE_STATUS[kind];
}

/**
 * The readiness checks for a publish or an unpublish — the server's version of what the Studio's
 * Publish panel computes client-side, plus the refusals the publish RPC would raise, so the operator
 * is never asked to approve something the server will then turn down. `blocking` checks that fail
 * mean there is nothing to approve. Null when the artifact is not in this workspace.
 */
export function buildPublishPreview(action: PublishAction, kind: PublishKind, id: string, facts: ReadinessFacts): PublishPreview | null {
  const row = rowFor(kind, facts);
  if (!row) return null;
  const title = artifactTitle(kind, row);
  const address = publicAddress(kind, facts, id);
  const checks: ReadinessCheck[] = [];
  const add = (key: string, ok: boolean, label: string, blocking: boolean, detail?: string) =>
    checks.push({ key, ok, label, blocking, ...(detail ? { detail } : {}) });

  if (action === "unpublish") {
    const live = isLiveRow(kind, row);
    add("is_live", live, live ? `This ${KIND_NOUN[kind]} is live now` : `This ${KIND_NOUN[kind]} isn't live, so there's nothing to take down`, true);
    // The same refusals the unpublish RPC raises (GROWTH_PAGE_IN_USE / GROWTH_FORM_IN_USE), asked
    // first so nobody approves taking down something the server will keep up.
    if (live && (kind === "page" || kind === "form")) {
      const first = (facts.liveDependents ?? [])[0];
      const noun = kind === "page" ? "page" : "form";
      add("not_in_use", !first,
        first ? `A live ${first.kind} ${kind === "page" ? "uses" : "collects through"} this ${noun}` : `Nothing live depends on this ${noun}`, true,
        first ? `Take “${first.name}” offline first, then unpublish this.` : undefined);
    }
    return { kind, id, title, action, address, checks };
  }

  add("not_archived", row.status !== "archived", row.status === "archived" ? `This ${KIND_NOUN[kind]} is archived` : `This ${KIND_NOUN[kind]} isn't archived`, true);
  if (kind !== "image") {
    const slug = !!(facts.tenantSlug && facts.tenantSlug.trim());
    add("public_address", slug, slug ? "Your workspace has a public address" : "Your workspace has no public address yet", true,
      slug ? undefined : "Set one in your business settings, then publish.");
  }

  if (kind === "page") {
    const blocks = blocksToPublish(row);
    const sections = blocks?.length ?? 0;
    add("has_sections", sections > 0, sections > 0 ? `Has ${plural(sections, "section")}` : blocks ? "The page is empty" : "Nothing saved to publish yet", true,
      blocks ? undefined : "Save the page first.");
    const unfinished = (blocks ? hasPlaceholder(blocks) : false) || hasPlaceholder(row.draft_seo_json);
    add("no_placeholders", !unfinished, unfinished ? "Some text still needs filling in" : "No unfinished text", true,
      unfinished ? "Replace every bracketed prompt, like [ADD_DATE], before publishing." : undefined);
    const embedded = blocks ? embeddedFormSlugs(blocks) : { missing: false, slugs: [] };
    add("signup_has_form", !embedded.missing, embedded.missing ? "A signup section has no form behind it" : "Every signup section has a form", true);
    const known = facts.pageFormSlugs ?? new Set<string>();
    const absent = embedded.slugs.filter((s) => !known.has(s));
    add("forms_exist", absent.length === 0, absent.length === 0
      ? (embedded.slugs.length ? `${plural(embedded.slugs.length, "form")} on this page go${embedded.slugs.length === 1 ? "es" : ""} live with it` : "No forms on this page")
      : "A signup form on this page doesn't exist yet", true, absent.length ? "Save the page again so its form is created." : undefined);
  } else if (kind === "form") {
    const { fields, email } = formFieldCount(row);
    add("has_questions", fields > 0, fields > 0 ? `Has ${plural(fields, "question")}` : "Has no questions yet", true);
    add("asks_email", email, email ? "Asks for an email, so each request becomes a contact" : "Doesn't ask for an email", false,
      email ? undefined : "Requests still arrive, but can't be matched to a contact.");
    const routes = row.auto_create_deal === true && !!row.pipeline_id;
    add("routes_to_pipeline", routes, routes ? "Requests go to your pipeline" : "Requests aren't sent to a pipeline", false, routes ? undefined : "Set this in Form settings.");
    const notify = typeof row.notify_email === "string" && row.notify_email.trim() ? row.notify_email.trim() : null;
    add("alert_email", !!notify, notify ? `Each request emails ${notify}` : "No alert email", false, notify ? undefined : "Set one in Form settings.");
    const success = (row.draft_success_action_json ?? row.success_action_json) as Record<string, unknown> | null;
    const thanks = !!(success && typeof success.message === "string" && success.message.trim());
    add("thank_you", thanks, thanks ? "Thank-you message is written" : "No thank-you message", false, thanks ? undefined : "Visitors see a plain confirmation.");
  } else if (kind === "funnel") {
    const steps = facts.funnelSteps ?? [];
    add("has_steps", steps.length > 0, steps.length > 0 ? `Has ${plural(steps.length, "step")}` : "Has no steps yet", true);
    const pageGap = steps.some((s) => s.step_type === "page" && !s.page_id);
    const formGap = steps.some((s) => s.step_type === "form" && !s.form_id);
    add("steps_complete", !pageGap && !formGap, pageGap ? "A page step has no page attached" : formGap ? "A form step has no form attached" : "Every step has its page or form", true);
  } else {
    const isImage = row.kind === "image";
    add("is_image", isImage, isImage ? "It's an image" : row.kind === "document" ? "Documents aren't published from the Studio" : "Copy isn't published from the Studio", true,
      isImage ? undefined : "Use it in a page, an email or a post instead.");
    const file = typeof row.image_url === "string" && !!row.image_url.trim();
    add("has_file", file, file ? "The image file is ready" : "The image has no file yet", true);
  }
  return { kind, id, title, action, address, checks };
}

/** True when nothing blocks the act, so there is something to approve. */
export function previewReady(preview: PublishPreview): boolean {
  return preview.checks.every((c) => c.ok || !c.blocking);
}

/** The card's one sentence. Names the thing and the consequence. */
export function previewSummary(preview: PublishPreview): string {
  const noun = KIND_NOUN[preview.kind];
  if (preview.action === "unpublish") {
    return `Take the ${noun} "${preview.title}" offline. It goes back to a draft in the Studio${preview.kind === "page" ? "; the forms on it stay live" : preview.kind === "funnel" ? "; its pages and forms stay live" : ""}.`;
  }
  const where = preview.address ? ` at ${preview.address}` : "";
  const carried = preview.kind === "page" ? " The forms on it go live too." : preview.kind === "funnel" ? " Every page and form in it goes live together." : "";
  return `Publish the ${noun} "${preview.title}"${where}. Anyone with the link can open it.${carried}`;
}

/** Postgres codes the publish RPCs raise when they refuse. */
export const REFUSAL_CODES: ReadonlySet<string> = new Set(["42501", "22023", "P0002", "23505"]);

/**
 * The server's refusal as a sentence a person can read: its own words without the machine code, or
 * a plain fallback. Never a GROWTH_ code, a SQLSTATE or a function name.
 */
export function plainRefusal(message: unknown, action: PublishAction): string {
  const fallback = action === "publish" ? "It didn't go live. Nothing changed." : "It couldn't be taken down. It's still live.";
  const msg = typeof message === "string" ? message.trim() : "";
  if (!msg) return fallback;
  const m = /^((?:GROWTH|CONTENT|STUDIO)_[A-Z_]+):\s*(.+)$/s.exec(msg);
  if (m) {
    if (/_FORBIDDEN$/.test(m[1])) return "Only this workspace's owner or an admin can do that.";
    if (/_NO_TENANT$/.test(m[1])) return "Choose a workspace first, then try again.";
    const text = m[2].trim();
    return `${text.charAt(0).toUpperCase()}${text.slice(1)}${/[.!?]$/.test(text) ? "" : "."}`;
  }
  if (/permission denied|forbidden/i.test(msg)) return "Only this workspace's owner or an admin can do that.";
  return fallback;
}

/** True only when an unpublish's return proves the artifact is no longer live. */
export function unpublishVerified(kind: PublishKind, id: string, value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const v = value as { id?: unknown; status?: unknown };
  return typeof v.id === "string" && v.id.toLowerCase() === id
    && typeof v.status === "string" && v.status !== "" && v.status !== LIVE_STATUS[kind];
}

/** Failure copy for an unpublish whose return could not prove the artifact came down. */
export const UNPUBLISH_UNVERIFIED_ERROR =
  "The unpublish finished but didn't confirm it came down, so it may still be live. Check the project's status.";
