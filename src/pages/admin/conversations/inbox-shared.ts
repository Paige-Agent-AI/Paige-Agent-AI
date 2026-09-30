// Shared substrate for the C-1 / C-1.5 inbox (§18 one home, §12 organized).
// The real public.messages row + the C-1.5 public.threads aggregate + tenant-authored
// label vocabulary + snooze presets. Queried via `supabase as any` (house pattern —
// threads/messages are not in generated types yet, #234/#470).
import { useCallback, useRef, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import {
  Mail, MessageSquare, MessageCircle, Instagram, Facebook, Phone,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { CLIENT_CONTACT_METHODS_EMBED, primaryAddressesOf, type WithClientContactMethods } from "@/lib/contact-methods";

// ── message substrate (locked columns from public.messages) ────────────────────────
export type ChannelType = "email" | "sms" | "whatsapp" | "instagram" | "facebook" | "voice";
export type Direction = "inbound" | "outbound";
export type MsgStatus = "draft" | "queued" | "sent" | "delivered" | "failed" | "received" | "read";

export interface MessageParty { address?: string; display_name?: string }
export interface Attachment { url?: string; mime?: string; name?: string; size?: number }
export interface ClientJoin {
  first_name: string | null;
  last_name: string | null;
  entity_name: string | null;
  email: string | null;
}
export interface MessageRow {
  id: string;
  thread_key: string;
  contact_id: string | null;
  connector_id: string | null;
  channel_type: ChannelType;
  direction: Direction;
  status: MsgStatus;
  sender: MessageParty | null;
  recipients: MessageParty[] | null;
  subject: string | null;
  body_text: string | null;
  body_html: string | null;
  attachments: Attachment[] | null;
  provider_message_id: string | null;
  in_reply_to_provider_id: string | null;
  action_id: string | null;
  error: string | null;
  scheduled_for: string | null; // R7 — queued outbound release instant (drives scheduled view/pill/cancel)
  sent_at: string | null;
  created_at: string;
  // Phase-4 call fields (schema-present on public.messages; a voice row is channel_type='voice').
  // Nullable — null for non-voice rows and calls with no recording/transcript/completed duration (§13).
  call_duration_seconds: number | null;
  recording_url: string | null;
  transcript: string | null;
  clients: ClientJoin | null;
}

export const MESSAGE_COLS =
  "id, thread_key, contact_id, connector_id, channel_type, direction, status, sender, recipients, " +
  "subject, body_text, body_html, attachments, provider_message_id, in_reply_to_provider_id, " +
  "action_id, error, scheduled_for, sent_at, created_at, call_duration_seconds, recording_url, transcript, " +
  `clients(first_name, last_name, entity_name, ${CLIENT_CONTACT_METHODS_EMBED})`;

/**
 * A `messages` pull as the inbox reads it: the joined contact's `email` is its PRIMARY address,
 * taken from its contact methods (MESSAGE_COLS embeds them). Every inbox consumer reads
 * `clients.email`, so it is set here, once, where the rows arrive.
 */
export function messageRowsFromDb(rows: unknown): MessageRow[] {
  return ((rows ?? []) as Array<Omit<MessageRow, "clients"> & { clients: (Omit<ClientJoin, "email"> & WithClientContactMethods) | null }>)
    .map((row) => {
      if (!row.clients) return { ...row, clients: null };
      const { client_contact_methods: methods, ...client } = row.clients;
      return { ...row, clients: { ...client, email: primaryAddressesOf(methods).email } };
    });
}

// ── C-1.5 threads aggregate (source of truth for order/unread/snooze/archive/labels) ─
export type ThreadFilter = "active" | "snoozed" | "archived" | "all";
export type LabelColor = "indigo" | "sky" | "violet" | "slate"; // token-only, NEVER gold (§11)
export interface Label { id: string; name: string; color: LabelColor }

export interface ClientContact {
  id: string;
  first_name: string | null;
  last_name: string | null;
  entity_name: string | null;
  email: string | null;
  phone: string | null;
  status: string | null;
  timezone: string | null;
  created_at: string | null;
  // #10 (staff half) — the user who created this contact record, resolved to a member name in the
  // rail (never a raw uuid, §13). Additive read from the same clients row, no extra query.
  created_by: string | null;
  // #10 (channel half) — the bounded channel this contact first entered through (email/form/import/
  // api/manual/signup/invite/…). NULL for pre-#10 rows (§13, never guessed). Rendered as
  // "[channel] ([staff])" in the rail; NULL channel gracefully degrades to just the staff name.
  created_by_channel_type: string | null;
  // #482 Phase-2 — relationship facts pulled from the same clients row (self-contained, no extra query).
  lifecycle_stage: string | null;
  entity_type: string | null;
  title: string | null;
  source: string | null;
  tags: string[] | null;
  last_contacted_at: string | null;
  // Ownership — assigned_coach is the contact's primary "Owner" (the Conversations rail's
  // Owner picker, written via assign_contact). The clients row also carries Sales (lead_owner)
  // + Client-Success (cs_primary) owners, but the rail renders Owner ONLY today, so they are
  // not fetched here — no dead columns (§13). Re-add them WITH the team-on-contact display.
  assigned_coach_user_id: string | null;
  // #121 — the portal fold-out reuses ContactPortalPanel, which needs the linked auth user
  // (its invite/agreement/impersonate flow keys off it). Pulled from the same clients row,
  // no extra query.
  linked_user_id: string | null;
  // C-2 suppression / DND surfaced on the contact card (§ read-only signal)
  dnd_active: boolean | null;
  dnd_reason: string | null;
  dnd_until: string | null;
}
export interface DbThread {
  id: string;
  thread_key: string;
  contact_id: string | null;
  snoozed_until: string | null;
  archived_at: string | null;
  labels: Label[] | null;
  unread_count: number;
  last_message_at: string | null;
  last_direction: Direction | null;
  clients: ClientContact | null; // joined
}
export interface Suppression { channel: "sms" | "email"; reason: string }

// #482 Phase-2 — the Agents' log reads Paige's action-bus registry per contact for REAL
// attribution. RLS on paige_actions pins an authenticated coach/admin to their OWN tenant
// (tenant_id = current_user_tenant_id()), so the client read is honest + tenant-isolated (§9).
// §13 note: paige_llm_trace exists (shipped #489) but is task/agent/tenant-scoped with NO
// contact_id column, so it cannot power a per-CONTACT log — paige_actions.contact_id is the
// correct source; folding trace-level attribution in later is a tracked follow-up.
export interface PaigeActionRow {
  id: string; action_kind: string; title: string; summary: string | null;
  status: string; autonomy_lane: string; from_department: string; to_department: string;
  created_by_agent: string | null; assigned_subagent_slug: string | null;
  filed_at: string; drafted_at: string | null; executed_at: string | null;
  resolved_at: string | null; error: string | null;
}
export const PAIGE_ACTION_COLS =
  "id, action_kind, title, summary, status, autonomy_lane, from_department, to_department, " +
  "created_by_agent, assigned_subagent_slug, filed_at, drafted_at, executed_at, resolved_at, error";

// clients join carries dnd_* so the contact card reads the opt-out signal with NO extra fetch.
export const THREAD_COLS =
  "id, thread_key, contact_id, snoozed_until, archived_at, labels, unread_count, " +
  "last_message_at, last_direction, " +
  "clients:contact_id(id, first_name, last_name, entity_name, entity_type, title, status, " +
  "lifecycle_stage, source, tags, last_contacted_at, assigned_coach_user_id, linked_user_id, " +
  "timezone, created_at, created_by, created_by_channel_type, dnd_active, dnd_reason, dnd_until, " +
  `${CLIENT_CONTACT_METHODS_EMBED})`;

/**
 * A `threads` pull as the inbox reads it: the joined contact's `email` / `phone` are its PRIMARY
 * addresses, taken from its contact methods (THREAD_COLS embeds them). The contact card, the
 * composer's To, the call button and the portal invite all read these two fields.
 */
export function threadsFromDb(rows: unknown): DbThread[] {
  return ((rows ?? []) as Array<Omit<DbThread, "clients"> & { clients: (Omit<ClientContact, "email" | "phone"> & WithClientContactMethods) | null }>)
    .map((row) => {
      if (!row.clients) return { ...row, clients: null };
      const { client_contact_methods: methods, ...client } = row.clients;
      return { ...row, clients: { ...client, ...primaryAddressesOf(methods) } };
    });
}

// ── selected-view shape (R1): the DbThread + its loaded messages + all the fields the
//    composer / approve / signature seams read. Typed once here, consumed in the page. ─
export interface SelectedView {
  key: string;
  dbThread: DbThread;
  messages: MessageRow[];
  channel: ChannelType;
  name: string;
  hasDraft: boolean;
  contactId: string | null;
  connectorId: string | null;
  toAddress: string;
}

// ── channel presentation ────────────────────────────────────────────────────────────
export const CHANNEL_ICON: Record<ChannelType, LucideIcon> = {
  email: Mail, sms: MessageSquare, whatsapp: MessageCircle,
  instagram: Instagram, facebook: Facebook, voice: Phone,
};
export const CHANNEL_LABEL: Record<ChannelType, string> = {
  email: "Email", sms: "SMS", whatsapp: "WhatsApp",
  instagram: "Instagram", facebook: "Facebook", voice: "Voice",
};

// #10 channel-of-origin — human label for clients.created_by_channel_type (a BROADER vocabulary
// than ChannelType: message-channels + creation-specific origins). Used by the contact rail's
// "Created by" row. An unmapped/NULL value falls back to just the staff name (§13, never "null (…)").
export const CREATED_VIA_LABEL: Record<string, string> = {
  email: "Email", sms: "SMS", whatsapp: "WhatsApp",
  instagram: "Instagram", facebook: "Facebook", voice: "Voice",
  manual: "Manual", form: "Form", import: "Import", api: "Paige",
  seed: "System", signup: "Sign-up", invite: "Invite",
};

// ── label color tokens (token-only, non-gold, AA both themes §11/§23) ────────────────
export const LABEL_COLOR: Record<LabelColor, string> = {
  indigo: "border-[hsl(var(--primary)/0.45)] bg-[hsl(var(--primary)/0.10)] text-[hsl(var(--primary))]",
  sky:    "border-[hsl(var(--info)/0.45)] bg-[hsl(var(--info)/0.10)] text-[hsl(var(--info))]",
  violet: "border-[hsl(var(--primary-light)/0.5)] bg-[hsl(var(--primary-light)/0.12)] text-[hsl(var(--primary-light))]",
  slate:  "border-border bg-muted text-muted-foreground",
};
export const LABEL_DOT: Record<LabelColor, string> = {
  indigo: "bg-[hsl(var(--primary))]",
  sky:    "bg-[hsl(var(--info))]",
  violet: "bg-[hsl(var(--primary-light))]",
  slate:  "bg-muted-foreground",
};
export const LABEL_COLORS: LabelColor[] = ["indigo", "sky", "violet", "slate"];

// ── inbox view vocabulary (R3/R-B1): the four state filters PLUS the four derived
//    views the Command-Center tiles deep-link into (?filter=drafts|awaiting-reply|
//    waking-today|scheduled). A derived view rides on a base ThreadFilter server query
//    and narrows client-side via a predicate. Unknown slug → keep the default. ────────
export type InboxView = ThreadFilter | "attention" | "unread" | "drafts" | "awaiting-reply" | "waking-today" | "scheduled";
export const INBOX_VIEWS: InboxView[] = [
  "active", "attention", "unread", "snoozed", "archived", "all", "drafts", "awaiting-reply", "waking-today", "scheduled",
];
export const FILTER_LABEL: Record<InboxView, string> = {
  active: "Active", attention: "Needs attention", unread: "Unread", snoozed: "Snoozed", archived: "Archived", all: "All",
  drafts: "Drafts", "awaiting-reply": "Awaiting reply", "waking-today": "Waking today",
  scheduled: "Scheduled",
};
/** End of the caller's local day, as an absolute epoch-ms instant. */
export const endOfTodayMs = () => {
  const d = new Date();
  d.setHours(23, 59, 59, 999);
  return d.getTime();
};

// ── derivations ─────────────────────────────────────────────────────────────────────
export const partyLabel = (p?: MessageParty | null) =>
  p?.display_name?.trim() || p?.address?.trim() || "";
export const msgTime = (m: MessageRow) => new Date(m.sent_at ?? m.created_at).getTime();
export const bodyPreview = (m: MessageRow) =>
  (m.body_text || (m.body_html ? m.body_html.replace(/<[^>]+>/g, " ") : "") || "")
    .replace(/\s+/g, " ").trim();

/** person-first display name (#175): first_name last_name wins; entity_name (business)
 *  is the fallback — matches the canonical getClientDisplayInfo hierarchy (person → entity). */
export function contactNameFromClient(c: ClientContact | ClientJoin | null): string {
  const named = [c?.first_name, c?.last_name].filter(Boolean).join(" ").trim() || c?.entity_name?.trim();
  return named || "";
}

// ── #121 GHL-parity list UX: density · sort · avatars ───────────────────────────────
//    Token-only, non-gold (§11); no fabricated photos — INITIALS only (§13).

/** Row density. Persisted to localStorage so a coach's choice survives reloads. */
export type Density = "comfortable" | "compact";
export const DENSITY_STORAGE_KEY = "conv.density";
export const readDensity = (): Density => {
  // localStorage ACCESS can throw (SecurityError) in sandboxed / privacy-blocked contexts, not
  // just be undefined — and this runs in a useState initializer, so an uncaught throw fails the
  // whole Conversations render. Catch it and fall back to comfortable (§13/§32 — never crash).
  try {
    return localStorage.getItem(DENSITY_STORAGE_KEY) === "compact" ? "compact" : "comfortable";
  } catch {
    return "comfortable";
  }
};

/** Client-side sort of the ALREADY-loaded, ALREADY-filtered rail (composes AFTER the
 *  server state filter + client view/label/search filters — pure, no new query §9). */
export type ThreadSort = "recent" | "unread" | "name";
export const THREAD_SORTS: ThreadSort[] = ["recent", "unread", "name"];
export const SORT_LABEL: Record<ThreadSort, string> = {
  recent: "Most recent",
  unread: "Unread first",
  name: "Name (A–Z)",
};
const threadTs = (t: DbThread) => (t.last_message_at ? new Date(t.last_message_at).getTime() : 0);
/** Stable sort (Array.sort is stable in modern engines → equal keys keep incoming order).
 *  `nameOf` lets the caller pass the SAME display-name fallback ThreadRow renders (contact name,
 *  else the preview party's name/address) so Name (A–Z) alphabetizes by what the user actually
 *  sees — not an empty string for threads whose client join is null (§13). Defaults to the
 *  contact name alone for callers that don't have preview data. */
export function sortThreads(
  threads: DbThread[],
  mode: ThreadSort,
  nameOf: (t: DbThread) => string = (t) => contactNameFromClient(t.clients),
): DbThread[] {
  const arr = [...threads];
  switch (mode) {
    case "name":
      return arr.sort((a, b) =>
        nameOf(a).localeCompare(nameOf(b), undefined, { sensitivity: "base" })
        || threadTs(b) - threadTs(a));
    case "unread":
      return arr.sort((a, b) =>
        (b.unread_count > 0 ? 1 : 0) - (a.unread_count > 0 ? 1 : 0) || threadTs(b) - threadTs(a));
    default: // recent — newest last_message_at first (current default behavior)
      return arr.sort((a, b) => threadTs(b) - threadTs(a));
  }
}

/** Deterministic 1–2 char initials from a display name (never a fabricated photo, §13). */
export function initialsFromName(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
/** Deterministic non-gold tint from the name hash — token-only, AA both themes (§11/§23). */
export const AVATAR_TINTS: string[] = [
  "border-[hsl(var(--primary)/0.35)] bg-[hsl(var(--primary)/0.12)] text-[hsl(var(--primary))]",
  "border-[hsl(var(--info)/0.35)] bg-[hsl(var(--info)/0.12)] text-[hsl(var(--info))]",
  "border-[hsl(var(--primary-light)/0.4)] bg-[hsl(var(--primary-light)/0.14)] text-[hsl(var(--primary-light))]",
];
export function avatarTint(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return AVATAR_TINTS[h % AVATAR_TINTS.length];
}

// ── email template (canned full-email inserts). Ported into the ONE comms home (§18/§31)
//    from the retired admin ContactCommsPanel. A template is DISTINCT from a snippet (an
//    inline #trigger fragment with NO subject) and a signature (a sign-off) — it is a full
//    subject+body starting point a coach picks and edits, so snippets do not supersede it. ─
export interface EmailTemplate {
  template_key: string;
  subject: string;
  body_markdown: string;
  body_html: string | null;
  category: string;
}
/** Resolve {{token}} merge vars; an unknown token drops to "" so a raw token never ships (§13/§15). */
export const resolveMergeVars = (text: string, ctx: Record<string, string>): string =>
  text.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, k: string) => ctx[k] ?? "");

// ── snooze presets. "Until they reply" = far-future sentinel; the shipped inbound
//    trigger (trg_messages_upsert_thread) clears snoozed_until on the next inbound,
//    which IS "until they reply" — no fabricated flag column (§13/§31). ───────────────
export const SNOOZE_SENTINEL_UNTIL_REPLY = "9999-12-31T00:00:00.000Z";
export const isUntilReply = (iso: string | null) => iso === SNOOZE_SENTINEL_UNTIL_REPLY;

// ── composer attachments (§18 ONE home — the reply composer AND the compose-new modal
//    upload through this exact hook, so there is a single upload/remove implementation:
//    same private bucket, same tenant-scoped object-path convention, same 10MB cap, same
//    validation + toast error handling). Attachments are stored as OBJECT PATHS (never a
//    public URL) and passed to send-message as the `attachments` array. ──────────────────
export const COMMS_ATTACH_BUCKET = "comms-attachments";
export const MAX_ATTACH_BYTES = 10 * 1024 * 1024; // 10MB/file — matches the bucket ceiling
export const isImageMime = (m?: string) => !!m && m.startsWith("image/");

export interface CommsAttachmentsApi {
  attachments: Attachment[];
  uploading: boolean;
  /** Upload each file to the private bucket (skipping >10MB) and stage the object paths. */
  uploadFiles: (files: FileList | File[]) => Promise<void>;
  /** Drop a staged attachment and best-effort delete its object from the bucket. */
  removeAttachment: (a: Attachment) => Promise<void>;
  /** Clear all staged attachments (does NOT delete objects — call on composer reset). */
  reset: () => void;
}

/**
 * The ONE comms upload/stage/remove implementation (§18). `getTenantId` is read through a
 * live ref so the returned callbacks stay stable while always seeing the latest tenant —
 * the reply composer resolves it from a ref, the compose-new modal from a prop; both work.
 * Object-path convention: `${tenantId}/${uuid}-${sanitizedName}` (byte-identical to the
 * shipped reply-composer path so a compose-new attachment and a reply attachment are
 * indistinguishable to send-message and the private-bucket RLS).
 */
export function useCommsAttachments(getTenantId: () => string | null): CommsAttachmentsApi {
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const tenantIdFn = useRef(getTenantId);
  tenantIdFn.current = getTenantId;
  // Generation token: reset() bumps it. An upload that started before a reset (e.g. the
  // dialog was cancelled + reopened for a DIFFERENT recipient while a slow upload was in
  // flight) must NOT stage its stale batch onto the fresh composer — that file could then
  // be sent to the wrong recipient (§9/§13). We drop + best-effort delete the orphaned
  // objects instead of appending them.
  const generation = useRef(0);

  const uploadFiles = useCallback(async (files: FileList | File[]) => {
    const tenantId = tenantIdFn.current();
    if (!tenantId) { toast.error("Couldn't resolve your workspace — refresh and retry."); return; }
    const gen = generation.current;
    setUploading(true);
    const next: Attachment[] = [];
    try {
      for (const f of Array.from(files)) {
        if (f.size > MAX_ATTACH_BYTES) { toast.error(`${f.name} is over 10MB.`); continue; }
        const path = `${tenantId}/${crypto.randomUUID()}-${f.name.replace(/[^\w.-]+/g, "_")}`;
        const { error } = await supabase.storage.from(COMMS_ATTACH_BUCKET).upload(path, f, {
          contentType: f.type || "application/octet-stream", upsert: false,
        });
        if (error) { toast.error(`Couldn't attach ${f.name}.`); continue; }
        next.push({ url: path, mime: f.type || "application/octet-stream", name: f.name, size: f.size });
      }
      // Superseded by a reset() while we were uploading → don't stage the stale batch;
      // clean up the now-orphaned objects (best-effort) so they don't linger in the bucket.
      if (gen !== generation.current) {
        if (next.length) void supabase.storage.from(COMMS_ATTACH_BUCKET).remove(next.map((n) => n.url));
        return;
      }
      if (next.length) setAttachments((a) => [...a, ...next]);
    } finally { setUploading(false); }
  }, []);

  const removeAttachment = useCallback(async (a: Attachment) => {
    setAttachments((cur) => cur.filter((x) => x.url !== a.url));
    if (a.url) await supabase.storage.from(COMMS_ATTACH_BUCKET).remove([a.url]);
  }, []);

  const reset = useCallback(() => { generation.current += 1; setAttachments([]); }, []);

  return { attachments, uploading, uploadFiles, removeAttachment, reset };
}

// ── outbound send seam helpers (§18 one home — reused by the reply composer AND
//    the compose-new modal so both read the send-message result identically) ──────────
/** Default undo-send grace window: a fresh send queues this far out so the toast's
 *  Undo can cancel it before delivery (owner-set 30s). */
export const UNDO_WINDOW_MS = 30_000;

export interface SendResult {
  outcome: string;          // sent | queued | queued_scheduled | blocked_* | failed
  reason: string | null;
  messageId: string | null;
  scheduledFor: string | null;
  deduped: boolean;
}

/**
 * The ONE §37-aware parser of the send-message response. The TRUE disposition is
 * `outcome` (never `status`): pre-send blocks/queues and scheduled sends early-return
 * 200 with status:"sent" but outcome:"blocked_*"/"queued_*", so reading `status` alone
 * mis-reports a block/queue as success. When `outcome` is absent (older shape) we derive
 * it from status + the presence of scheduled_for. Lifted verbatim from dispatchSend so the
 * reply path and the compose-new path can never drift.
 */
export function readSendResult(data: unknown): SendResult {
  const res = (data ?? {}) as {
    status?: string; outcome?: string; reason?: string;
    message_id?: string; scheduled_for?: string; deduped?: boolean;
  };
  const outcome = res.outcome ?? (
    res.status === "sent"    ? "sent" :
    res.status === "queued"  ? (res.scheduled_for ? "queued_scheduled" : "queued") :
    res.status === "blocked" ? "blocked_unknown" :
    "failed"
  );
  return {
    outcome,
    reason: res.reason ?? null,
    messageId: res.message_id ?? null,
    scheduledFor: res.scheduled_for ?? null,
    deduped: res.deduped ?? false,
  };
}

/**
 * The canonical thread aggregation key — the ONE home for the convention so a
 * compose-new outbound and a later inbound reply land in the SAME thread (no
 * fragmentation). This MUST byte-match what the inbound handlers derive:
 *   handle-inbound-email/index.ts L325 → `email:${tenantId}:${fromEmail}`, and its
 *   adapter normalizes the sender address via normEmail = trim().toLowerCase()
 *   (L53/L61/L66) — so email counterparty = address.trim().toLowerCase().
 * SMS inbound does not yet write unified threads, so the sms key is forward-consistency:
 * a light E.164-ish normalize (strip everything but digits and a leading +) that a future
 * inbound-sms thread writer can match. Keep both identical to their inbound twin.
 * (send-message's own fallback `${channel}:${to}` is NON-canonical and would fragment —
 * that is exactly why compose-new passes this explicit key.)
 */
export function canonicalThreadKey(
  channel: ChannelType,
  tenantId: string,
  counterparty: string,
  contactId?: string | null,
): string {
  // §49 one-thread-per-contact: when the contact is known, the canonical key is per-CONTACT so a
  // send and any later inbound reply on ANY channel coalesce into the ONE thread. The channel+
  // counterparty form is the fallback only when no contact id is available.
  if (contactId) return `contact:${tenantId}:${contactId}`;
  const cp = channel === "email"
    ? counterparty.trim().toLowerCase()
    : counterparty.replace(/[^\d+]/g, "");
  return `${channel}:${tenantId}:${cp}`;
}

export function snoozePresets(now = new Date()): { key: string; label: string; until: Date }[] {
  const laterToday = new Date(now.getTime() + 3 * 3600_000);
  const at9 = (d: Date) => { d.setHours(9, 0, 0, 0); return d; };
  const addDaysTo = (target: number) => {
    const d = new Date(now);
    const delta = (target - d.getDay() + 7) % 7 || 7;
    d.setDate(d.getDate() + delta);
    return at9(d);
  };
  return [
    { key: "later", label: "Later today", until: laterToday },
    { key: "tomorrow", label: "Tomorrow, 9am", until: addDaysTo((now.getDay() + 1) % 7) },
    { key: "weekend", label: "This weekend", until: addDaysTo(6) }, // Sat
    { key: "nextweek", label: "Next week", until: addDaysTo(1) },   // Mon
  ];
}
