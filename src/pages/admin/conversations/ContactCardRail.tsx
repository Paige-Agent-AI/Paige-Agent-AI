// The Conversations contact rail — a GHL-grade, always-present contact-management panel
// (Slice 1B, §43). It is NOT a second ContactDetail (§18): ContactDetail stays the deep
// surface; this is the inline quick-action panel. Every write reuses an existing seam:
//   Tags   → updateContact (src/lib/contacts.ts)
//   Owner  → assign_contact RPC (the same Paige tool, §10)
//   DND    → set_contact_channel_suppression RPC (adds the suppression + consent audit row)
//   Deals  → ContactDealsSection (the Pipeline's own create path)
//   Invite → create_tenant_invite_token + send-portal-invite (ContactPortalPanel's flow)
//   Remind → QuickAddDialog (plan_set_reminder / plan_assign_task)
// Gold is spent ONLY on the outward-commit act (Send portal invite). Toggles/pickers are
// neutral/indigo (§11). Controls with no real backing (Calls/Inbound DND, true Followers)
// are honestly disabled or omitted, never faked (§13).
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { formatDistanceToNow, format } from "date-fns";
import { Link, useLocation } from "react-router-dom";
import { tenantRoutePrefixForPath } from "@/components/tenant-shell/tenantShellRoutes";
import { SectionCard, EmptyState, StatePill, GlyphPlate } from "@/components/ui/page";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Accordion, AccordionItem, AccordionTrigger, AccordionContent,
} from "@/components/ui/accordion";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { updateContact } from "@/lib/contacts";
import {
  listCustomFieldDefinitions, listClientCustomFieldValues, type CustomFieldDefinition,
} from "@/lib/customFields";
import {
  User, UserPlus, Mail, Phone, Clock, Copy, ShieldAlert, BellOff, PanelRightClose,
  Send, Loader2, ExternalLink, UserRound, Sparkles, Bell, ClipboardList,
  FileSignature, CreditCard, Zap,
} from "lucide-react";
import { CallButton } from "@/components/admin/voice/CallButton";
import { ContactPortalPanel } from "@/components/admin/contacts/ContactPortalPanel";
import { ContactBillingPanel } from "@/components/admin/contacts/ContactBillingPanel";
import { ContactAutomationHistory } from "@/components/admin/contacts/ContactAutomationHistory";
import { ClientOnboardingStatusPanel } from "@/components/admin/contacts/ClientOnboardingStatusPanel";
import { useTierFeatures } from "@/hooks/useTierFeatures";
import {
  type ClientContact, type MessageRow, type Label, type ChannelType, type Suppression,
  CHANNEL_ICON, CHANNEL_LABEL, CREATED_VIA_LABEL, LABEL_COLOR, bodyPreview, contactNameFromClient,
} from "./inbox-shared";
import { AgentsLog } from "./AgentsLog";
import { TagPicker } from "@/components/admin/contacts/TagPicker";
import { ContactDealsSection } from "@/components/admin/contacts/ContactDealsSection";
import { QuickAddDialog } from "@/components/planning/QuickAddDialog";

interface Coach { user_id: string; name: string; roles: string[] }

// Roles that can OWN a contact (mirror ClientManagementDashboard's team split).
const ASSIGNABLE_ROLES = new Set(["admin", "super_admin", "moderator"]);

// #6 Custom-field surfacing — the tenant's client custom-field definitions + this contact's values,
// read through the ONE canonical seam (@/lib/customFields, §18/§12 — same fetch Paige and the
// settings authoring UI use), which coerces `options` to a real array and scopes by tenant + RLS.
interface ResolvedCustomField { def: CustomFieldDefinition; display: string }

/** Look up an option's human label (falls back to the raw stored value). */
function optionLabel(options: CustomFieldDefinition["options"], raw: unknown): string {
  const v = String(raw);
  const opts = Array.isArray(options) ? options : [];
  for (const o of opts) {
    if (o.value === v) return o.label ?? o.value;
  }
  return v;
}

/** Parse a stored date value as a LOCAL calendar day. A date-only "YYYY-MM-DD" (what the
 *  type="date" editor saves) is otherwise read as UTC midnight and renders a day early west of
 *  UTC (§37 — match the editor's calendar semantics; §13 no off-by-one). */
function toCalendarDate(value: unknown): Date | null {
  if (typeof value === "string") {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
    if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  }
  const d = new Date(value as string);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Render a custom-field value by its declared type. `value` is jsonb (supabase-js already parsed
 * it to JS). Returns null when the value is absent/malformed so the row is skipped (§15).
 */
function renderValue(def: CustomFieldDefinition, value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  switch (def.fieldType) {
    case "boolean":
      // Match the full editor's normalization (ContactCustomFieldsPanel: value===true||"true"),
      // so a stored string "false" reads as No on both surfaces (§37) — not truthy-"Yes".
      return value === true || value === "true" ? "Yes" : "No";
    case "date": {
      const d = toCalendarDate(value);
      return d ? format(d, "PP") : null;
    }
    case "select":
      return optionLabel(def.options, value);
    case "multiselect": {
      const arr = Array.isArray(value) ? value : [value];
      const labels = arr.map((v) => optionLabel(def.options, v)).filter(Boolean);
      return labels.length ? labels.join(", ") : null;
    }
    case "number":
    case "text":
    default: {
      const s = String(value);
      return s.length ? s : null;
    }
  }
}

function CopyRow({ icon: Icon, value, label, action }: { icon: typeof Mail; value: string; label: string; action?: ReactNode }) {
  // When an action (e.g. click-to-call) is present, the copy affordance is a nested
  // button-like span rather than an outer <button> — nested interactive controls are
  // invalid HTML. The whole row still copies on click.
  return (
    <div className="group flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs hover:bg-muted">
      <button
        type="button"
        onClick={() => { navigator.clipboard?.writeText(value); toast.success("Copied."); }}
        className="flex min-w-0 flex-1 items-center gap-2 text-left
          focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))] rounded-sm"
        title={`Copy ${label}`}
      >
        <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate text-foreground">{value}</span>
        <Copy className="h-3 w-3 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
      </button>
      {action}
    </div>
  );
}

/** One per-channel DND row. Email/SMS are live; Calls/Inbound are honestly disabled. */
function DndRow({
  channel, label, checked, disabled, busy, onToggle, note,
}: {
  channel: ChannelType | "calls" | "inbound";
  label: string;
  checked: boolean;
  disabled?: boolean;
  busy?: boolean;
  onToggle?: (v: boolean) => void;
  note?: string;
}) {
  const Icon = channel === "calls" ? Phone : channel === "inbound" ? BellOff : CHANNEL_ICON[channel];
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-card px-3 py-2">
      <div className="flex min-w-0 items-center gap-2">
        <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0">
          <p className="text-sm text-foreground">{label}</p>
          {note && <p className="text-[10px] text-muted-foreground">{note}</p>}
        </div>
      </div>
      <div className="flex items-center gap-2">
        {busy && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
        <Switch
          checked={checked}
          disabled={disabled || busy}
          onCheckedChange={onToggle}
          aria-label={`Do not contact on ${label}`}
        />
      </div>
    </div>
  );
}

export function ContactCardRail({
  contact, channel, toAddress, recentMessages, labels, suppressions,
  userId, tenantId, onClose, onChanged,
}: {
  contact: ClientContact | null;
  channel: ChannelType;
  toAddress: string;
  recentMessages: MessageRow[];
  labels: Label[];
  suppressions: Suppression[];
  userId: string | null;
  tenantId: string | null;
  onClose: () => void;
  onChanged: () => void;
}) {
  const location = useLocation();
  const tenantRoot = tenantRoutePrefixForPath(location.pathname);
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);

  // ── team roster for the Owner picker, loaded once ─────────────────────────────
  // get_tenant_assignable_members() is a SECURITY DEFINER RPC that server-derives the tenant
  // (never a param, no IDOR) via tenant_members and is gated to admin/super_admin/coach — the
  // SAME caller set as the assign_contact write it feeds (§37 read=write parity). The old direct
  // `user_roles.eq('role','coach')` query was RLS-collapsed (user_roles SELECT is
  // `is_platform_owner() OR auth.uid()=user_id`), so every non-owner tenant got only the caller's
  // own row — empty picker AND assigned contacts falsely reading "Unassigned". This picker RPC
  // returns the real tenant roster for any staff member who can assign (not just admins), so a
  // coach sees teammates and can self-assign; a set owner resolves to a real name (falling back to
  // "Current owner" only if truly unresolvable), never a false "Unassigned". `roles` rides along
  // so we offer only the assignable ones. Distinct from get_tenant_people (the admin-only rich
  // directory) — this is the least-privilege picker (§9/§18).
  const [members, setMembers] = useState<Coach[]>([]);
  useEffect(() => {
    let alive = true;
    (async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data } = await (supabase as any).rpc("get_tenant_assignable_members");
      const rows = (data as { user_id: string; full_name: string | null; roles: string[] | null }[] | null) ?? [];
      if (alive) {
        setMembers(rows.map((r) => ({
          user_id: r.user_id, name: r.full_name || "Teammate", roles: r.roles ?? [],
        })));
      }
    })();
    return () => { alive = false; };
  }, []);

  // Only teammates who can own a contact appear as picker options.
  const assignable = useMemo(
    () => members.filter((m) => m.roles.some((r) => ASSIGNABLE_ROLES.has(r))),
    [members],
  );

  // ── #6 custom fields for THIS contact — the tenant's active client field definitions joined
  // with this contact's stored values. RLS on both tables pins the read to the caller's tenant
  // (§9 — no tenant_id from the client). Only fields that actually HAVE a value are surfaced
  // (§15 no placeholders); an empty result renders nothing. Keyed on contact.id so a switch refetches.
  const [customFields, setCustomFields] = useState<ResolvedCustomField[]>([]);
  useEffect(() => {
    let alive = true;
    const cid = contact?.id;
    // Reset FIRST so a contact switch never renders the previous contact's fields under the new
    // identity while the fetch is in flight (the #270-class stale-render guard).
    setCustomFields([]);
    if (!cid || !tenantId) return;
    (async () => {
      try {
        const [defs, valuesByDef] = await Promise.all([
          listCustomFieldDefinitions(tenantId),
          listClientCustomFieldValues(cid),
        ]);
        if (!alive) return;
        const resolved: ResolvedCustomField[] = [];
        for (const def of defs) {
          const display = renderValue(def, valuesByDef[def.id]);
          if (display !== null) resolved.push({ def, display });
        }
        setCustomFields(resolved);
      } catch (e) {
        // Degrade LOUDLY, not silently (§13/§32): a query error or malformed row leaves the
        // section empty but logs the cause — never an unhandled rejection with no signal.
        if (alive) { console.error("[ContactCardRail] custom-field load failed", e); setCustomFields([]); }
      }
    })();
    return () => { alive = false; };
  }, [contact?.id, tenantId]);

  // ── local state seeded from props (optimistic writes reconcile via onChanged) ──
  const [localTags, setLocalTags] = useState<string[]>([]);
  const [tagBusy, setTagBusy] = useState(false);
  const [ownerId, setOwnerId] = useState<string | null>(null);
  const [ownerBusy, setOwnerBusy] = useState(false);
  const [inviteBusy, setInviteBusy] = useState(false);
  // §60 tier lock (owner-ruled 2026-08-11): the consumer/client portal invite is a
  // solo + sub_account capability ONLY — an Agency manages sub-accounts, not a
  // direct consumer client book. Gates both the inline "Send portal invite" act
  // and the "Portal & Agreements" fold below.
  const { has: hasTierFeature } = useTierFeatures();
  const canInvitePortal = hasTierFeature("customer_portal_invite");
  const [dndBusy, setDndBusy] = useState<"email" | "sms" | null>(null);
  const [emailDnd, setEmailDnd] = useState(false);
  const [smsDnd, setSmsDnd] = useState(false);

  useEffect(() => {
    setLocalTags(contact?.tags ?? []);
    setOwnerId(contact?.assigned_coach_user_id ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contact?.id]);

  useEffect(() => {
    setEmailDnd(suppressions.some((s) => s.channel === "email"));
    setSmsDnd(suppressions.some((s) => s.channel === "sms"));
  }, [suppressions]);

  const optedOut = suppressions.length > 0;
  const dnd = !!contact?.dnd_active;

  // ── writes (all §9 RLS/RPC-guarded) ──────────────────────────────────────────
  const saveTags = useCallback(async (next: string[]) => {
    if (!contact) return;
    const prev = localTags;
    setLocalTags(next);
    setTagBusy(true);
    try {
      await updateContact(contact.id, { tags: next });
      onChanged();
    } catch {
      setLocalTags(prev);
      toast.error("Couldn't save tags.");
    } finally {
      setTagBusy(false);
    }
  }, [contact, localTags, onChanged]);

  const assignOwner = useCallback(async (uid: string | null) => {
    if (!contact) return;
    const prev = ownerId;
    setOwnerId(uid);
    setOwnerBusy(true);
    try {
      if (uid === null) {
        await updateContact(contact.id, { assigned_coach_user_id: null });
      } else {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data, error } = await (supabase as any).rpc("assign_contact", {
          p_contact_id: contact.id, p_user_id: uid, p_role: "coach",
        });
        if (error || (data && data.ok === false)) throw new Error(error?.message ?? "assign_failed");
      }
      toast.success("Owner updated.");
      onChanged();
    } catch (e) {
      setOwnerId(prev);
      toast.error(e instanceof Error ? e.message : "Couldn't update the owner.");
    } finally {
      setOwnerBusy(false);
    }
  }, [contact, ownerId, onChanged]);

  const toggleDnd = useCallback(async (ch: "email" | "sms", value: boolean) => {
    if (!contact) return;
    const set = ch === "email" ? setEmailDnd : setSmsDnd;
    set(value);
    setDndBusy(ch);
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (supabase as any).rpc("set_contact_channel_suppression", {
        _contact_id: contact.id, _channel: ch, _suppressed: value, _reason: "manual",
      });
      if (error) throw new Error(error.message);
      toast.success(value ? `${CHANNEL_LABEL[ch]} paused for this contact.` : `${CHANNEL_LABEL[ch]} re-enabled.`);
      onChanged();
    } catch (e) {
      set(!value); // revert
      toast.error(e instanceof Error ? e.message : "Couldn't update do-not-contact.");
    } finally {
      setDndBusy(null);
    }
  }, [contact, onChanged]);

  const sendPortalInvite = useCallback(async () => {
    if (!contact) return;
    if (!canInvitePortal) return; // §60 hard-guard: solo + sub_account only
    if (!contact.email) { toast.error("Add an email to this contact first."); return; }
    if (!tenantId) { toast.error("No active workspace to invite into."); return; }
    setInviteBusy(true);
    try {
      const { data: tokRes, error: mintErr } = await supabase.rpc("create_tenant_invite_token", {
        _tenant_id: tenantId,
        _kind: "consumer",
        _default_role: "member",
        _expires_in_days: 30,
        _max_uses: null,
        _contact_id: contact.id,
        _email: contact.email,
      });
      if (mintErr) throw mintErr;
      const row = Array.isArray(tokRes) ? tokRes[0] : tokRes;
      const token = (row as { token?: string } | null)?.token;
      if (!token) throw new Error("Couldn't create the invite.");
      const { data: sent } = await supabase.functions.invoke("send-portal-invite", {
        body: { token, email: contact.email },
      });
      const emailed = (sent as { emailed?: boolean } | null)?.emailed;
      toast.success(emailed ? `Portal invite emailed to ${contact.email}.` : "Invite created — link ready to share.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't send the portal invite.");
    } finally {
      setInviteBusy(false);
    }
  }, [contact, tenantId, canInvitePortal]);

  // Resolve from the FULL roster (not just assignable) so a set owner always shows a real
  // name for an admin; a non-admin (empty roster) falls back to "Current owner" — honest,
  // and still never the false "Unassigned" (§13).
  const ownerName = ownerId
    ? (members.find((m) => m.user_id === ownerId)?.name ?? "Current owner")
    : null;

  // #10 (staff half) — resolve created_by against the already-loaded roster (§18/§37, no second
  // RPC). A system/import creator matches no member → null → the row hides (§13, never a raw uuid).
  const createdByName = contact?.created_by
    ? (members.find((m) => m.user_id === contact.created_by)?.name ?? null)
    : null;
  // #10 (channel half) — the bounded channel-of-origin, humanized. Composed as "[channel] ([staff])"
  // e.g. "Instagram (Jordan Lee)". NULL-graceful (§13, never "null (…)"): channel-only when the staff
  // creator doesn't resolve (a system/import origin), staff-only when the channel is NULL (pre-#10
  // rows), and the row hides entirely when both are absent.
  const createdViaChannel = contact?.created_by_channel_type
    ? (CREATED_VIA_LABEL[contact.created_by_channel_type] ?? null)
    : null;
  const createdByDisplay =
    createdViaChannel && createdByName ? `${createdViaChannel} (${createdByName})`
    : createdViaChannel ? createdViaChannel
    : createdByName;

  return (
    <SectionCard padded={false} bodyClassName="flex min-h-0 flex-1 flex-col" className="flex min-h-0 flex-col overflow-hidden">
      <div className="flex items-center justify-between border-b border-border/60 px-4 py-3">
        <span className="text-sm font-semibold text-foreground">Contact</span>
        <Button
          variant="ghost" size="icon"
          className="h-7 w-7 text-muted-foreground hover:text-foreground
            focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]"
          onClick={onClose} aria-label="Hide contact panel"
        >
          <PanelRightClose className="h-4 w-4" />
        </Button>
      </div>

      {!contact ? (
        <div className="grid flex-1 place-items-center">
          <EmptyState
            icon={UserPlus}
            tone="muted"
            title="No client record yet."
            description="This thread isn't linked to a client. Add them and their details show up here."
            className="py-8"
          />
        </div>
      ) : (
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
          {/* Identity */}
          <div className="flex items-start gap-3">
            <GlyphPlate icon={User} size="md" ring="indigo" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-foreground">
                {contactNameFromClient(contact) || toAddress || "Unknown contact"}
              </p>
              {(contact.title || contact.entity_name) && (
                <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                  {[contact.title, contact.entity_name].filter(Boolean).join(" · ")}
                </p>
              )}
              <div className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[11px] text-muted-foreground">
                <StatePill state={contact.status === "active" ? "success" : "pending"}>
                  {contact.status === "active" ? "Active" : (contact.status || "Lead")}
                </StatePill>
                {contact.lifecycle_stage && (
                  <span className="capitalize">{contact.lifecycle_stage.replace(/[-_]/g, " ")}</span>
                )}
                {contact.created_at && (
                  <span>· Client for {formatDistanceToNow(new Date(contact.created_at))}</span>
                )}
              </div>
            </div>
          </div>

          {/* Opt-out / DND passive signal (the active control lives in the DND tab) */}
          {(optedOut || dnd) && (
            <div className="space-y-1.5 rounded-lg border border-[hsl(var(--warning)/0.4)] bg-[hsl(var(--warning)/0.08)] p-2.5">
              {optedOut && (
                <div className="flex items-start gap-2">
                  <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[hsl(var(--warning))]" />
                  <div className="text-[11px] text-foreground">
                    Opted out of{" "}
                    {[...new Set(suppressions.map((s) => CHANNEL_LABEL[s.channel as ChannelType] ?? s.channel))].join(" & ")}
                    <span className="text-muted-foreground"> — Paige won't send on {suppressions.length > 1 ? "these" : "this"}.</span>
                  </div>
                </div>
              )}
              {dnd && (
                <div className="flex items-start gap-2">
                  <BellOff className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[hsl(var(--warning))]" />
                  <div className="text-[11px] text-foreground">
                    Do-not-disturb on
                    {contact.dnd_reason ? <span className="text-muted-foreground"> — {contact.dnd_reason}</span> : null}
                    {contact.dnd_until ? (
                      <span className="text-muted-foreground"> (until {new Date(contact.dnd_until).toLocaleDateString()})</span>
                    ) : null}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Owner + Team (real: assigned_coach_user_id via assign_contact). */}
          <div className="space-y-1.5">
            <p className="px-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Owner</p>
            <Select
              value={ownerId ?? "unassigned"}
              onValueChange={(v) => void assignOwner(v === "unassigned" ? null : v)}
              disabled={ownerBusy}
            >
              <SelectTrigger className="h-9">
                <span className="flex items-center gap-2">
                  <UserRound className="h-3.5 w-3.5 text-muted-foreground" />
                  <SelectValue placeholder="Unassigned" />
                </span>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="unassigned">Unassigned</SelectItem>
                {assignable.map((c) => (
                  <SelectItem key={c.user_id} value={c.user_id}>{c.name}</SelectItem>
                ))}
                {/* A set owner not in the assignable list (non-admin viewer with an empty
                    roster, or an owner whose role isn't assignable) still shows its real/known
                    name so the trigger never falsely reads "Unassigned" (§13). */}
                {ownerId && !assignable.some((c) => c.user_id === ownerId) && (
                  <SelectItem value={ownerId}>{ownerName ?? "Current owner"}</SelectItem>
                )}
              </SelectContent>
            </Select>
            {ownerName && (
              <p className="px-1 text-[10px] text-muted-foreground">Managed by {ownerName}</p>
            )}
          </div>

          {/* Tags — inline add/remove (real: clients.tags via updateContact) */}
          <div className="space-y-1.5">
            <div className="flex items-center gap-2 px-1">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Tags</p>
              {tagBusy && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
            </div>
            <TagPicker value={localTags} onChange={(next) => void saveTags(next)} />
          </div>

          {/* Handles */}
          <div className="space-y-0.5">
            <p className="px-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Reach them</p>
            {contact.email && <CopyRow icon={Mail} value={contact.email} label="email" />}
            {contact.phone && (
              <CopyRow icon={Phone} value={contact.phone} label="phone" action={<CallButton number={contact.phone} />} />
            )}
            {toAddress && toAddress !== contact.email && toAddress !== contact.phone && (
              <CopyRow icon={CHANNEL_ICON[channel]} value={toAddress} label={CHANNEL_LABEL[channel]} />
            )}
          </div>

          {/* Local time */}
          {contact.timezone && (
            <div className="flex items-center gap-2 px-2 text-xs text-muted-foreground">
              <Clock className="h-3.5 w-3.5" />
              <span>
                {new Intl.DateTimeFormat(undefined, {
                  timeZone: contact.timezone, hour: "numeric", minute: "2-digit",
                }).format(now)}{" "}
                their time
              </span>
            </div>
          )}

          {/* Labels (read-only mirror; edit via the row/header popover) */}
          {labels.length > 0 && (
            <div className="space-y-1">
              <p className="px-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Labels</p>
              <div className="flex flex-wrap gap-1.5 px-2">
                {labels.map((l) => (
                  <span key={l.id} className={cn("rounded-full border px-2 py-0.5 text-[10px] font-medium", LABEL_COLOR[l.color])}>
                    {l.name}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* ── Section tabs: All fields / DND / Actions ─────────────────────── */}
          {/* key by contact.id: the rail stays mounted across thread switches, so an
              uncontrolled Tabs would keep its last-clicked value (DND/Actions) and the
              next contact's Details would NOT lead at 0 clicks (#144). Re-keying remounts
              just this subtree, resetting to Details on every thread selection. */}
          <Tabs key={contact.id} defaultValue="fields" className="pt-1">
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="fields">Details</TabsTrigger>
              <TabsTrigger value="dnd">DND</TabsTrigger>
              <TabsTrigger value="actions">Actions</TabsTrigger>
            </TabsList>

            {/* Details — the high-value fields + a deep link to the full profile (§18). */}
            <TabsContent value="fields" className="mt-3 space-y-2">
              <FieldRow label="Email" value={contact.email} />
              <FieldRow label="Phone" value={contact.phone} action={<CallButton number={contact.phone} />} />
              <FieldRow label="Business" value={contact.entity_name} />
              <FieldRow label="Title" value={contact.title} />
              <FieldRow label="Source" value={contact.source} />
              <FieldRow
                label="Stage"
                value={contact.lifecycle_stage ? contact.lifecycle_stage.replace(/[-_]/g, " ") : null}
                capitalize
              />
              {contact.last_contacted_at && (
                <FieldRow
                  label="Last contacted"
                  value={formatDistanceToNow(new Date(contact.last_contacted_at), { addSuffix: true })}
                />
              )}
              {/* #11 created-on (absolute date) + #10 created-by (staff half; hidden when the
                  creator resolves to no member — §13 never a raw uuid). */}
              <FieldRow
                label="Created"
                value={contact.created_at ? format(new Date(contact.created_at), "PP") : null}
              />
              <FieldRow label="Created by" value={createdByDisplay} />

              {/* #6 custom fields — only fields WITH a value; nothing renders when there are none. */}
              {customFields.length > 0 && (
                <div className="space-y-2 border-t border-border/60 pt-2">
                  <p className="px-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Custom fields
                  </p>
                  {customFields.map(({ def, display }) => (
                    <FieldRow key={def.id} label={def.label} value={display} />
                  ))}
                </div>
              )}

              <Button variant="outline" size="sm" className="mt-1 w-full" asChild>
                <Link to={tenantRoot ? `${tenantRoot}/clients/people?contact=${encodeURIComponent(contact.id)}` : "/choose-account"}>
                  <ExternalLink className="mr-1.5 h-3.5 w-3.5" /> Open full profile
                </Link>
              </Button>
            </TabsContent>

            {/* DND — per-channel opt-out. Email/SMS live; Calls/Inbound honestly disabled. */}
            <TabsContent value="dnd" className="mt-3 space-y-2">
              <DndRow
                channel="email" label="Email" checked={emailDnd}
                busy={dndBusy === "email"} onToggle={(v) => void toggleDnd("email", v)}
              />
              <DndRow
                channel="sms" label="SMS" checked={smsDnd}
                busy={dndBusy === "sms"} onToggle={(v) => void toggleDnd("sms", v)}
              />
              <DndRow channel="calls" label="Calls" checked={false} disabled note="Coming soon" />
              <DndRow channel="inbound" label="Inbound" checked={false} disabled note="Coming soon" />
              <p className="px-1 pt-1 text-[10px] text-muted-foreground">
                Turning a channel on stops Paige from sending the client anything there.
              </p>
            </TabsContent>

            {/* Actions — every one wired to a real seam (§13, no dead buttons). */}
            <TabsContent value="actions" className="mt-3 space-y-3">
              {/* Send portal invite — the one gold act (outward commit).
                  §60: solo + sub_account only; hidden on Agency/Enterprise/God. */}
              {canInvitePortal && (
                <Button
                  variant="gold" size="sm" className="w-full"
                  onClick={() => void sendPortalInvite()}
                  disabled={inviteBusy || !contact.email}
                  title={!contact.email ? "Add an email to invite this contact" : undefined}
                >
                  {inviteBusy ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Send className="mr-1.5 h-4 w-4" />}
                  Send portal invite
                </Button>
              )}

              {/* Reminder + task — real plan_* RPCs via QuickAddDialog. */}
              {userId && (
                <div className="grid grid-cols-2 gap-2">
                  <QuickAddDialog
                    userId={userId} contactId={contact.id} contactName={contactNameFromClient(contact) || "this contact"}
                    defaultKind="reminder" onCreated={() => toast.success("Reminder set.")}
                    trigger={
                      <Button variant="outline" size="sm" className="w-full">
                        <Bell className="mr-1.5 h-3.5 w-3.5" /> Reminder
                      </Button>
                    }
                  />
                  <QuickAddDialog
                    userId={userId} contactId={contact.id} contactName={contactNameFromClient(contact) || "this contact"}
                    defaultKind="task" onCreated={() => toast.success("Task assigned.")}
                    trigger={
                      <Button variant="outline" size="sm" className="w-full">
                        <ClipboardList className="mr-1.5 h-3.5 w-3.5" /> Task
                      </Button>
                    }
                  />
                </div>
              )}

              {/* Opportunities / deals — the Pipeline's own create path. */}
              <div className="space-y-1.5 rounded-lg border border-border bg-card/60 p-3">
                <div className="flex items-center gap-1.5">
                  <Sparkles className="h-3.5 w-3.5 text-muted-foreground" />
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Opportunities</p>
                </div>
                <ContactDealsSection contactId={contact.id} />
              </div>
            </TabsContent>
          </Tabs>

          {/* What Paige did — REAL per-contact action-bus log (§13, RLS tenant-scoped §9). */}
          <div className="space-y-1">
            <p className="px-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">What Paige did</p>
            <div className="px-2">
              <AgentsLog contactId={contact.id} />
            </div>
          </div>

          {/* Recent activity — from loaded messages, no query */}
          <div className="space-y-1">
            <p className="px-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Recent activity</p>
            {recentMessages.length === 0 ? (
              <p className="px-2 text-xs text-muted-foreground">Nothing yet.</p>
            ) : (
              <ul className="space-y-1">
                {recentMessages.slice(-5).reverse().map((m) => (
                  <li key={m.id} className="flex items-start gap-2 rounded-md px-2 py-1 text-[11px]">
                    <span className={cn("mt-1 h-1.5 w-1.5 shrink-0 rounded-full",
                      m.direction === "inbound" ? "bg-[hsl(var(--primary))]" : "bg-muted-foreground")} />
                    <span className="min-w-0 flex-1 truncate text-muted-foreground">
                      <span className="text-foreground/80">{m.direction === "inbound" ? "" : "You: "}</span>
                      {bodyPreview(m) || m.subject || "—"}
                    </span>
                    <span className="shrink-0 tabular-nums text-muted-foreground/70">
                      {formatDistanceToNow(new Date(m.sent_at ?? m.created_at), { addSuffix: false })}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* ── Details & history — deep fold-out, COLLAPSED by default (§18 reuse, §67 no
              scroll-wall). Each section COMPOSES the exact panel ContactDetail mounts — same
              tenant-scoped seam, no duplicate fetch. Radix unmounts closed content, so a panel
              queries only when its own section is open. The Accordion is keyed by contact.id and
              uncontrolled with an empty default, so a contact switch fully remounts it collapsed:
              zero of the three heavy fetches fire on switch, and no section stays open (or renders
              a panel for the new contact) across the change. Headers are neutral/indigo — gold
              stays on the panels' own outward acts. */}
          <div className="space-y-1.5 pt-1">
            <p className="px-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              Details &amp; history
            </p>
            <Accordion
              key={contact.id}
              type="multiple"
              defaultValue={[]}
              className="overflow-hidden rounded-lg border border-border/70"
            >
              {/* §60: consumer Portal & Agreements — solo + sub_account only. */}
              {canInvitePortal && (
                <FoldSection value="portal" icon={FileSignature} label="Portal & Agreements">
                  <ClientOnboardingStatusPanel contactId={contact.id} />
                  <ContactPortalPanel
                    contactId={contact.id}
                    email={contact.email}
                    linkedUserId={contact.linked_user_id ?? null}
                  />
                </FoldSection>
              )}
              <FoldSection value="billing" icon={CreditCard} label="Billing">
                {/* dense — the reused panel's default responsive form keys off the VIEWPORT
                    (md:), which over-widens inside this ~300px rail on desktop; dense forces
                    the single-column fit (#121, Codex P2). */}
                <ContactBillingPanel contactId={contact.id} dense />
              </FoldSection>
              <FoldSection value="automation" icon={Zap} label="Automation" last>
                <ContactAutomationHistory contactId={contact.id} />
              </FoldSection>
            </Accordion>
          </div>
        </div>
      )}
    </SectionCard>
  );
}

/**
 * One deep fold-out row (#121). The trigger is a neutral section header (icon + label, indigo
 * on open); the ChevronDown is appended by the AccordionTrigger primitive. Content is the real
 * ContactDetail panel(s) — mounted only while expanded (Radix default), so each fetch is
 * lazy and one-at-a-time. Gold is never spent here (§11) — the panels own their own acts.
 */
function FoldSection({
  value, icon: Icon, label, last, children,
}: {
  value: string;
  icon: typeof FileSignature;
  label: string;
  last?: boolean;
  children: ReactNode;
}) {
  return (
    <AccordionItem value={value} className={cn("px-3", last ? "border-b-0" : "border-border/60")}>
      <AccordionTrigger
        className="rounded-md px-2 py-3 text-xs font-medium text-foreground transition-colors
          hover:bg-muted/40 hover:no-underline
          data-[state=open]:font-semibold data-[state=open]:text-[hsl(var(--primary))]
          focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]"
      >
        <span className="flex items-center gap-2">
          <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
          {label}
        </span>
      </AccordionTrigger>
      <AccordionContent className="space-y-3 pb-3 pt-0">{children}</AccordionContent>
    </AccordionItem>
  );
}

/** A read row in the Details tab. Only renders when the value is present (§15 no placeholders). */
function FieldRow({ label, value, capitalize, action }: { label: string; value: string | null | undefined; capitalize?: boolean; action?: ReactNode }) {
  if (!value) return null;
  return (
    <div className="flex items-center justify-between gap-3 px-1 text-xs">
      <span className="shrink-0 text-muted-foreground">{label}</span>
      <span className="flex min-w-0 items-center justify-end gap-1.5">
        <span className={cn("min-w-0 truncate text-right text-foreground/90", capitalize && "capitalize")}>{value}</span>
        {action}
      </span>
    </div>
  );
}
