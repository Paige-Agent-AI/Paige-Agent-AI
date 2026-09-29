// Compose a NEW outbound conversation (§43 — Conversations is a tool, not just a viewer).
// The reply composer only appears once a thread is selected; this modal lets a coach START
// a thread with any contact. It reuses every existing seam (§18): CustomerSelector for
// search-select, the channel_connectors the reply composer already reads,
// subagent-email-composer for "Draft with Paige", and the ONE send-message seam via the
// shared readSendResult (§37) + canonicalThreadKey (the fragmentation fix). Gold is spent
// ONLY on Send (§11).
//
// §49 — inline contact create is routed through the ONE atomic RPC `create_and_attach_conversation`
// (resolve-or-create the contact + find any existing conversation), NOT a raw insert. That RPC
// is the sole contact-create path on this surface, so a DUPLICATE contact is impossible from the
// UI (backed by the tenant-scoped UNIQUE indexes on clients). Smart-route: if the RPC reports the
// contact already existed AND already has a conversation on this channel, we open that thread
// silently — no dupe, no error (§36 proactive surfacing). Otherwise the resolved contact drops
// into the composer and Send coalesces into the SAME (tenant, thread_key) thread via the existing
// message trigger, so no empty thread is ever left behind.
import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Loader2, Send, Clock, Sparkles, ChevronDown, X, AlertTriangle, UserRound, Paperclip, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { CustomerSelector } from "@/components/paige/CustomerSelector";
import type { FocusedClient } from "@/components/paige/commandCenterTypes";
import {
  type ChannelType, type EmailTemplate, CHANNEL_ICON, CHANNEL_LABEL,
  canonicalThreadKey, readSendResult, resolveMergeVars, UNDO_WINDOW_MS,
  useCommsAttachments,
} from "./inbox-shared";
import { AttachmentChip } from "./AttachmentChip";
import { selectComposeConnector } from "./connectorRouting";
import { CLIENT_CONTACT_METHODS_EMBED, withPrimaryAddresses, type WithClientContactMethods } from "@/lib/contact-methods";

// Structural subset of the page's Connector — only what the channel picker needs.
export interface ComposeConnector {
  id: string;
  channel_type: ChannelType;
  display_name: string | null;
  provider?: string | null;
  from_address?: string | null;
}

interface PickedClient {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  // Carried for {{merge}} resolution in the ported email-template picker (§31).
  first_name?: string | null;
  last_name?: string | null;
  entity_name?: string | null;
}

type DraftTone = "professional" | "friendly" | "warm" | "direct";

export function ComposeThreadDialog({
  open,
  onOpenChange,
  activeConnectors,
  tenantId,
  initialContact,
  emailTemplates = [],
  onSent,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  activeConnectors: ComposeConnector[];
  tenantId: string | null;
  /** Pre-address the composer to this contact when opened from a Client-360 "Message {name}"
   *  deep-link (§18/§31). Resolved via the same hydrateClient the search-select path uses. */
  initialContact?: { id: string; name?: string };
  /** Saved email templates the coach can insert (ported from the retired ContactCommsPanel, §31). */
  emailTemplates?: EmailTemplate[];
  /** Fired after a successful send with the canonical thread_key so the page can refresh
   *  and open the new/merged thread (§36 proactive surfacing). */
  onSent: (threadKey: string) => void;
}) {
  // send-message's contract is email|sms today — never offer a channel it can't send.
  const sendable = activeConnectors.filter(
    (c) => c.channel_type === "email" || c.channel_type === "sms",
  );

  const [client, setClient] = useState<PickedClient | null>(null);
  const [channel, setChannel] = useState<ChannelType | "">("");
  const [connectorId, setConnectorId] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [scheduledFor, setScheduledFor] = useState<string | null>(null);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const [drafting, setDrafting] = useState(false);
  const [draftFlags, setDraftFlags] = useState<string[]>([]);
  const [draftGuideOpen, setDraftGuideOpen] = useState(false);
  const [draftGuide, setDraftGuide] = useState("");
  const [draftTone, setDraftTone] = useState<DraftTone>("professional");
  // §49 inline create-mode — replaces the old stacked NewContactDialog. Routed through the
  // resolve-or-create RPC so the compose surface can never mint a duplicate contact.
  const [createMode, setCreateMode] = useState(false);
  const [creating, setCreating] = useState(false);
  const [cFirst, setCFirst] = useState("");
  const [cLast, setCLast] = useState("");
  const [cEmail, setCEmail] = useState("");
  const [cPhone, setCPhone] = useState("");
  // Operator's display name for a template's {{coach_name}} sign-off (§37): the retired
  // ContactCommsPanel resolved it from the current user's profile, and this compose surface —
  // unlike the reply composer — has no signature to carry the sign-off, so resolve it here (§13).
  const [coachName, setCoachName] = useState("");

  // Attachments — the SAME shared upload seam the reply composer uses (§18 one home): same
  // private bucket, same tenant-scoped object-path, same 10MB cap. EMAIL-ONLY here (see the
  // §13 honest note at the attach UI): send-message persists attachments on the row but does
  // NOT deliver them as Twilio MMS media, so we never offer them on the SMS path.
  const {
    attachments, uploading, uploadFiles, removeAttachment,
    reset: resetAttachments,
  } = useCommsAttachments(() => tenantId);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Reset everything on open (mirror the reply composer's reset-on-open).
  useEffect(() => {
    if (!open) return;
    setClient(null);
    setChannel(sendable[0]?.channel_type ?? "");
    setConnectorId(sendable[0]?.id ?? "");
    setSubject("");
    setBody("");
    setScheduledFor(null);
    setSending(false);
    setDrafting(false);
    setDraftFlags([]);
    setDraftGuide("");
    setDraftGuideOpen(false);
    setCreateMode(false);
    setCreating(false);
    setCFirst(""); setCLast(""); setCEmail(""); setCPhone("");
    resetAttachments();
    // Resolve the operator's name once per open so {{coach_name}} in a saved template renders
    // (mirrors the retired panel; §37 the picker must not silently blank a supported merge var).
    void (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setCoachName(""); return; }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: prof } = await (supabase as any)
        .from("profiles").select("full_name").eq("user_id", user.id).maybeSingle();
      setCoachName(((prof?.full_name as string | null) ?? "").trim());
    })();
    // Pre-address when opened from a Client-360 "Message {name}" deep-link (§18/§31): resolve
    // the contact's email/phone/name through the same one-row read the search-select uses.
    if (initialContact?.id) void hydrateClient(initialContact.id, initialContact.name ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Address resolver — send-message hard-requires an explicit `to` and never derives it
  // from contact_id. One RLS-scoped read serves both the search-select and create paths.
  const hydrateClient = useCallback(async (id: string, fallbackName: string) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data } = await (supabase as any)
      .from("clients")
      .select(`first_name, last_name, entity_name, ${CLIENT_CONTACT_METHODS_EMBED}`)
      .eq("id", id)
      .single();
    // The address a message goes to is the contact's PRIMARY email / phone.
    const row = withPrimaryAddresses((data ?? {}) as {
      first_name?: string | null; last_name?: string | null; entity_name?: string | null;
    } & WithClientContactMethods);
    const name =
      row.entity_name?.trim() ||
      [row.first_name, row.last_name].filter(Boolean).join(" ").trim() ||
      fallbackName ||
      "Contact";
    setClient({
      id, name, email: row.email ?? null, phone: row.phone ?? null,
      first_name: row.first_name ?? null, last_name: row.last_name ?? null,
      entity_name: row.entity_name ?? null,
    });
  }, []);

  const onPick = (f: FocusedClient) => {
    // Seed name immediately for responsiveness; resolve email/phone (esp. phone, which
    // FocusedClient doesn't carry) via the 1-row read.
    setClient({ id: f.id, name: f.name, email: f.email ?? null, phone: null });
    void hydrateClient(f.id, f.name);
  };

  // Open the inline create form, pre-filling from whatever the coach already typed in the
  // search box (§36 — an "@" reads as an email, a mostly-digits string as a phone, anything
  // else as a name). Never make them retype what they just searched.
  const startCreate = (seed?: string) => {
    const s = (seed ?? "").trim();
    setCFirst(""); setCLast(""); setCEmail(""); setCPhone("");
    if (s.includes("@")) {
      setCEmail(s);
    } else if (/^[\d\s()+\-.]+$/.test(s) && s.replace(/\D/g, "").length >= 7) {
      setCPhone(s);
    } else if (s) {
      const parts = s.split(/\s+/);
      setCFirst(parts[0] ?? "");
      setCLast(parts.slice(1).join(" "));
    }
    setCreateMode(true);
  };

  // §49 resolve-or-create + smart-route. The ONE atomic seam — never a raw client insert —
  // so this surface cannot create a duplicate contact. If the contact already existed AND has
  // a live conversation on the chosen channel, open it silently; otherwise drop the resolved
  // contact into the composer and let Send create the thread (the trigger coalesces on the
  // same canonical thread_key, so no empty thread is left behind).
  const submitCreate = useCallback(async () => {
    const cf = cFirst.trim(), cl = cLast.trim(), ce = cEmail.trim(), cp = cPhone.trim();
    if (!cf && !cl && !ce && !cp) {
      toast.error("Add a name, email, or phone first.");
      return;
    }
    setCreating(true);
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase as any).rpc("create_and_attach_conversation", {
        p_first_name: cf || null,
        p_last_name: cl || null,
        p_email: ce || null,
        p_phone: cp || null,
        p_channel: channel || "email",
        p_tenant_id: tenantId ?? null,
      });
      if (error) throw new Error(error.message);
      const row = (Array.isArray(data) ? data[0] : data) as {
        contact_id?: string; thread_id?: string | null; thread_key?: string | null;
        was_existing?: boolean;
      } | null;
      if (!row?.contact_id) throw new Error("Paige couldn't add that contact — try again.");

      const displayName = [cf, cl].filter(Boolean).join(" ").trim() || ce || cp || "Contact";

      // Smart-route: they're already in the system with a live conversation on this channel —
      // open it instead of starting a duplicate (§36, no dupe / no error).
      if (row.was_existing && row.thread_id && row.thread_key) {
        toast.message(`You're already talking to ${displayName}`, {
          description: "Opening that conversation.",
        });
        setCreateMode(false);
        onOpenChange(false);
        onSent(row.thread_key);
        return;
      }

      // Contact resolved (existing without a thread on this channel, or brand-new) — bring
      // them into the composer so the coach writes and sends from here.
      if (row.was_existing) {
        toast.message(`${displayName} is already in your contacts`, {
          description: "Paige linked them — write your message below.",
        });
      }
      setCreateMode(false);
      await hydrateClient(row.contact_id, displayName);
    } catch (e) {
      // §32: keep the real cause LOUD in the console so a broken seam (e.g. the RPC missing) is not
      // silently indistinguishable from ordinary user/validation error — the tenant still sees a plain
      // sentence (§3/§45), never a raw vendor/Postgres string.
      console.error("[compose] create_and_attach_conversation failed:", e);
      const raw = e instanceof Error ? e.message : "";
      const friendly =
        raw.startsWith("CONVO_NO_IDENTITY") ? "Add a name, email, or phone first." :
        raw.startsWith("CONVO_FORBIDDEN") ? "You don't have permission to add a contact here." :
        raw.startsWith("CONVO_") || !raw ? "Paige couldn't add that contact — try again." :
        raw;
      toast.error(friendly);
    } finally {
      setCreating(false);
    }
  }, [cFirst, cLast, cEmail, cPhone, channel, tenantId, hydrateClient, onOpenChange, onSent]);

  const toAddress = client
    ? (channel === "email" ? client.email : client.phone) ?? ""
    : "";

  const addressHint =
    client && channel && !toAddress
      ? channel === "email"
        ? "This contact has no email on file — add one or choose SMS."
        : "This contact has no phone number on file — add one or choose Email."
      : null;

  // "Draft with Paige" — email-only, COLD outreach (no thread / no last-inbound). Same
  // subagent-email-composer seam the reply composer uses; honest error unwrap (§13).
  const draftWithPaige = useCallback(async () => {
    if (!client) return;
    if (body.trim()) {
      toast.error("You've already started a message — clear it first to draft with Paige.");
      return;
    }
    setDrafting(true);
    setDraftFlags([]);
    try {
      const { data, error } = await supabase.functions.invoke("subagent-email-composer", {
        body: {
          input: {
            intent: draftGuide.trim() || "Write a warm opening outreach email to this client.",
            tone: draftTone,
            length: "medium",
            contact_id: client.id,
            recipient_name: client.name || undefined,
            recipient_email: client.email || undefined,
            format: "html",
          },
          context: { contact_id: client.id },
        },
      });
      if (error) {
        let msg = "Paige couldn't draft that — try again.";
        try {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const b = await (error as any).context?.json?.();
          if (b?.summary || b?.error) msg = b.summary ?? b.error;
        } catch { /* keep the friendly default */ }
        throw new Error(msg);
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const draft = (data as any)?.draft ?? data;
      const text = draft?.body_text || (draft?.body_html ? String(draft.body_html).replace(/<[^>]+>/g, "") : "");
      if (!text.trim()) throw new Error("Paige returned an empty draft.");
      if (draft?.subject && !subject.trim()) setSubject(draft.subject);
      setBody(text);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      setDraftFlags(((data as any)?.compliance_flags ?? []) as string[]);
      setDraftGuideOpen(false);
      toast.success("Paige drafted it — review before you send.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Paige couldn't draft that — try again.");
    } finally {
      setDrafting(false);
    }
  }, [client, body, draftGuide, draftTone, subject]);

  // Insert a saved email template (ported from the retired ContactCommsPanel, §31) — resolves
  // {{merge}} vars against the picked contact and lands subject+body for review/edit.
  const applyTemplate = useCallback((key: string) => {
    const t = emailTemplates.find((x) => x.template_key === key);
    if (!t || !client) return;
    const ctx: Record<string, string> = {
      first_name: client.first_name ?? "",
      last_name: client.last_name ?? "",
      // {{full_name}} is the CONTACT's personal name — derive it from first+last (matching the
      // reply composer's mergeContext), never client.name, which is the company for an entity
      // contact (hydrateClient prefers entity_name). Fall back to client.name only if unnamed.
      full_name: [client.first_name, client.last_name].filter(Boolean).join(" ").trim() || client.name || "",
      client_name: client.name ?? "",
      entity_name: client.entity_name ?? "",
      coach_name: coachName,
    };
    setSubject(resolveMergeVars(t.subject ?? "", ctx));
    setBody(resolveMergeVars(t.body_markdown || (t.body_html ? t.body_html.replace(/<[^>]+>/g, "") : ""), ctx));
  }, [emailTemplates, client, coachName]);

  const canSend =
    !!client && !!channel && !!connectorId && !!toAddress && !!body.trim() &&
    (channel !== "email" || !!subject.trim()) && !sending && !drafting && !uploading;

  const send = async () => {
    if (!client || !channel) { toast.error("Pick a recipient and channel first."); return; }
    if (!toAddress) { toast.error("This contact has no address for that channel."); return; }
    if (!body.trim()) { toast.error("Write a message first."); return; }
    if (channel === "email" && !subject.trim()) { toast.error("Add a subject for the email."); return; }

    const connector = selectComposeConnector(sendable, connectorId, channel);
    if (!connector) { toast.error("Choose an active sending address."); return; }
    // §49 per-contact key so a later inbound reply on ANY channel MERGES into this one thread (not a
    // fragment). client is non-null here (guarded above), so the key is contact:tenant:contact_id.
    const threadKey = tenantId
      ? canonicalThreadKey(channel, tenantId, toAddress, client.id)
      : `${channel}:${toAddress}`; // fallback only if tenant unresolved (should not happen)

    setSending(true);
    try {
      // Default = undo-send: queue 30s out so the toast's Undo can cancel before delivery
      // (matches the reply composer, §6 continuity). An explicit schedule overrides it.
      const iso = scheduledFor ?? new Date(Date.now() + UNDO_WINDOW_MS).toISOString();
      const { data, error } = await supabase.functions.invoke("send-message", {
        body: {
          channel,
          to: toAddress,
          subject: channel === "email" ? subject.trim() : undefined,
          body: body.trim(),
          contact_id: client.id,
          connector_id: connector.id,
          thread_key: threadKey,
          scheduled_for: iso,
          // Attachment parity with the reply composer — the EXACT `attachments` shape
          // send-message already accepts from the reply path (object paths in the private
          // comms-attachments bucket). Email-only (§13): the attach UI is gated to email and
          // the SMS path never carries them, so this only ships on an email send.
          attachments: channel === "email" && attachments.length ? attachments : undefined,
          // NO message_id → forces the insert-fresh-outbound path; the trigger creates the
          // thread row with tenant_id server-derived (§9).
        },
      });
      if (error) throw new Error(error.message);
      const r = readSendResult(data);

      if (r.outcome === "queued_scheduled") {
        if (scheduledFor) {
          toast.success(`Scheduled for ${new Date(scheduledFor).toLocaleString()}.`);
        } else if (r.messageId) {
          const id = r.messageId;
          toast("Sending…", {
            action: {
              label: "Undo",
              onClick: () => {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                void (supabase as any).rpc("cancel_scheduled_message", { _id: id }).then(
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  ({ data: ok, error: e }: any) => {
                    if (e || ok === false) toast.error("Too late — Paige already sent it.");
                    else toast.success("Undone.");
                  },
                );
              },
            },
            duration: UNDO_WINDOW_MS,
          });
        } else {
          toast.success("Sending…");
        }
        onOpenChange(false);
        onSent(threadKey);
      } else if (r.outcome === "sent") {
        toast.success("Message sent.");
        onOpenChange(false);
        onSent(threadKey);
      } else if (r.outcome.startsWith("blocked_")) {
        // §13 honest: default-deny TCPA (SMS no-consent), suppression, or client DND — a real
        // state, not a failure. Keep the modal open so the coach can adjust.
        toast.error(
          r.outcome === "blocked_no_consent"
            ? "This contact hasn't opted in to SMS — Paige won't text them yet."
            : r.reason ?? "Blocked — Paige can't message this contact on that channel.",
        );
      } else if (r.outcome.startsWith("queued_")) {
        toast(`Held: ${r.reason ?? "Paige will send when it's allowed."}`);
        onOpenChange(false);
        onSent(threadKey);
      } else {
        throw new Error(r.reason ?? "send_failed");
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't send.");
    } finally {
      setSending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>New conversation</DialogTitle>
            <DialogDescription>
              Start an outbound thread — pick who it's for, choose the channel, and Paige can draft it.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 py-1">
            {/* Recipient */}
            <div className="space-y-1.5">
              <Label>To</Label>
              {client ? (
                <div className="flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2">
                  <UserRound className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-foreground">{client.name}</p>
                    <p className="truncate text-[11px] text-muted-foreground">
                      {(channel === "email" ? client.email : client.phone) ||
                        client.email || client.phone || "No address on file"}
                    </p>
                  </div>
                  <Button
                    variant="ghost" size="icon"
                    className="h-7 w-7 text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]"
                    onClick={() => setClient(null)} aria-label="Clear recipient"
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              ) : createMode ? (
                // §49 inline create — routed through the resolve-or-create RPC (never a raw
                // insert). Same field patterns as the standalone New Contact form; non-gold
                // (gold is reserved for Send, §11).
                <div className="space-y-2.5 rounded-lg border border-border bg-card p-3">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-medium text-foreground">New contact</p>
                    <Button
                      variant="ghost" size="sm"
                      className="h-6 px-2 text-[11px] text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]"
                      onClick={() => setCreateMode(false)} disabled={creating}
                    >
                      Back to search
                    </Button>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1">
                      <Label className="text-[11px]">First name</Label>
                      <Input
                        value={cFirst} onChange={(e) => setCFirst(e.target.value)}
                        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void submitCreate(); } }}
                        className="h-9" autoFocus
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-[11px]">Last name</Label>
                      <Input
                        value={cLast} onChange={(e) => setCLast(e.target.value)}
                        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void submitCreate(); } }}
                        className="h-9"
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1">
                      <Label className="text-[11px]">Email</Label>
                      <Input
                        type="email" value={cEmail} onChange={(e) => setCEmail(e.target.value)}
                        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void submitCreate(); } }}
                        className="h-9"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-[11px]">Phone</Label>
                      <Input
                        value={cPhone} onChange={(e) => setCPhone(e.target.value)}
                        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void submitCreate(); } }}
                        className="h-9"
                      />
                    </div>
                  </div>
                  <div className="flex justify-end">
                    <Button
                      variant="default" size="sm" className="h-8"
                      onClick={() => void submitCreate()}
                      disabled={creating || (!cFirst.trim() && !cLast.trim() && !cEmail.trim() && !cPhone.trim())}
                      aria-busy={creating}
                    >
                      {creating
                        ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                        : <UserPlus className="mr-1.5 h-3.5 w-3.5" />}
                      {creating ? "Adding…" : "Add contact"}
                    </Button>
                  </div>
                </div>
              ) : (
                <CustomerSelector onSelect={onPick} onRequestCreate={startCreate} />
              )}
              {addressHint && (
                <p className="flex items-center gap-1 text-[11px] text-[hsl(var(--warning))]">
                  <AlertTriangle className="h-3 w-3" /> {addressHint}
                </p>
              )}
            </div>

            {/* Channel */}
            <div className="space-y-1.5">
              <Label>Channel</Label>
              <Select
                value={connectorId}
                onValueChange={(id) => {
                  const connector = sendable.find((c) => c.id === id);
                  setConnectorId(id);
                  setChannel(connector?.channel_type ?? "");
                }}
              >
                <SelectTrigger className="h-9">
                  <SelectValue placeholder="Choose a channel" />
                </SelectTrigger>
                <SelectContent>
                  {sendable.map((c) => {
                    const Icon = CHANNEL_ICON[c.channel_type];
                    return (
                      <SelectItem key={c.id} value={c.id}>
                        <span className="flex items-center gap-2">
                          <Icon className="h-3.5 w-3.5" />
                          <span>
                            {c.display_name?.trim() || CHANNEL_LABEL[c.channel_type]}
                            {c.from_address ? (
                              <span className="ml-1.5 text-xs text-muted-foreground">· {c.from_address}</span>
                            ) : null}
                          </span>
                        </span>
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>
            </div>

            {/* Subject (email only) */}
            {channel === "email" && (
              <div className="space-y-1.5">
                <Label>Subject</Label>
                <Input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Subject" className="h-9" />
              </div>
            )}

            {/* Body */}
            <div className="space-y-1.5">
              <Label>Message</Label>
              <Textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                rows={5}
                placeholder={client ? `Write your message to ${client.name}…` : "Write your message…"}
                className="resize-none"
              />
            </div>

            {/* Attachments — EMAIL-ONLY parity with the reply composer, through the ONE shared
                upload seam (§18). §13 honest note: send-message persists `attachments` on the
                messages row (inbox render) but does NOT deliver Twilio MMS media, so the SMS
                path never offers them — email only, matching Draft-with-Paige's email scope. */}
            {channel === "email" && (
              <div className="space-y-1.5">
                <input
                  ref={fileInputRef} type="file" multiple hidden
                  onChange={(e) => { if (e.target.files?.length) void uploadFiles(e.target.files); e.target.value = ""; }}
                />
                {attachments.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {attachments.map((a) => (
                      <AttachmentChip key={a.url} a={a} onRemove={() => void removeAttachment(a)} />
                    ))}
                  </div>
                )}
                <Button
                  variant="outline" size="sm" className="h-8"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploading || sending || !client}
                  title={!client ? "Pick a recipient first" : undefined}
                >
                  {uploading
                    ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                    : <Paperclip className="mr-1.5 h-3.5 w-3.5" />}
                  {uploading ? "Attaching…" : "Attach"}
                </Button>
              </div>
            )}

            {/* Draft with Paige — email only, non-gold indigo assist (gold is Send, §11). */}
            {channel === "email" && (
              <div className="inline-flex items-center">
                <Button
                  variant="outline" size="sm"
                  className="h-8 min-w-[8.5rem] justify-center rounded-r-none border-r-0 border-[hsl(var(--primary)/0.4)]"
                  onClick={() => void draftWithPaige()}
                  disabled={drafting || sending || !client}
                  aria-busy={drafting}
                  title={!client ? "Pick a recipient first" : undefined}
                >
                  {drafting
                    ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                    : <Sparkles className="mr-1.5 h-3.5 w-3.5 text-[hsl(var(--gold-dark))]" />}
                  {drafting ? "Paige is drafting…" : "Draft with Paige"}
                </Button>
                <Popover open={draftGuideOpen} onOpenChange={setDraftGuideOpen}>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline" size="sm"
                      className="h-8 rounded-l-none border-[hsl(var(--primary)/0.4)] px-2"
                      aria-label="Guide Paige's draft" disabled={drafting || !client}
                    >
                      <ChevronDown className="h-3.5 w-3.5" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent align="start" className="w-72 space-y-2 p-3">
                    <label htmlFor="compose-draft-guide" className="block text-[11px] font-medium text-muted-foreground">
                      Optional — tell Paige the angle &amp; tone
                    </label>
                    <Textarea
                      id="compose-draft-guide" rows={2} value={draftGuide}
                      onChange={(e) => setDraftGuide(e.target.value)}
                      placeholder="e.g. Introduce our onboarding and ask for a good time to talk this week"
                      className="resize-none text-sm"
                    />
                    <Select value={draftTone} onValueChange={(v) => setDraftTone(v as DraftTone)}>
                      <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="professional">Professional</SelectItem>
                        <SelectItem value="friendly">Friendly</SelectItem>
                        <SelectItem value="warm">Warm</SelectItem>
                        <SelectItem value="direct">Direct</SelectItem>
                      </SelectContent>
                    </Select>
                    <Button variant="outline" size="sm" className="h-8 w-full"
                      onClick={() => void draftWithPaige()} disabled={drafting}>
                      <Sparkles className="mr-1.5 h-3.5 w-3.5 text-[hsl(var(--gold-dark))]" /> Draft it
                    </Button>
                  </PopoverContent>
                </Popover>
              </div>
            )}

            {/* Saved email templates (ported §31) — email-only, needs a picked recipient to
                resolve {{merge}} vars. Non-gold utility (§11). */}
            {channel === "email" && client && emailTemplates.length > 0 && (
              <Select onValueChange={applyTemplate}>
                <SelectTrigger className="h-9">
                  <SelectValue placeholder="Insert a saved template…" />
                </SelectTrigger>
                <SelectContent>
                  {emailTemplates.map((t) => (
                    <SelectItem key={t.template_key} value={t.template_key}>
                      <span className="mr-1.5 text-xs text-muted-foreground">[{t.category}]</span>{t.subject}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}

            {/* Compliance flags from Paige's draft — tokened (§11). */}
            {draftFlags.length > 0 && (
              <div className="flex items-start gap-1.5 rounded-md border border-[hsl(var(--warning)/0.4)] bg-[hsl(var(--warning)/0.08)] px-2.5 py-1.5 text-[11px] text-[hsl(var(--warning))]">
                <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                <span><span className="font-medium">Check before sending:</span> {draftFlags.join(" · ")}</span>
              </div>
            )}

            {/* Scheduled-time pill */}
            {scheduledFor && (
              <span className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-2 py-1 text-[11px] text-foreground">
                <Clock className="h-3 w-3 text-muted-foreground" />
                {new Date(scheduledFor).toLocaleString()}
                <button type="button" onClick={() => setScheduledFor(null)}
                  className="rounded p-0.5 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]"
                  aria-label="Clear schedule">
                  <X className="h-3 w-3" />
                </button>
              </span>
            )}
          </div>

          <DialogFooter className="flex-row items-center justify-between gap-2 sm:justify-between">
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)} disabled={sending}>
                Cancel
              </Button>
              <Popover open={scheduleOpen} onOpenChange={setScheduleOpen}>
                <PopoverTrigger asChild>
                  <Button variant="outline" size="sm" className="h-9">
                    <Clock className="mr-1.5 h-3.5 w-3.5" />
                    {scheduledFor ? "Scheduled" : "Schedule"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent align="start" className="w-64 space-y-1 p-2">
                  <button type="button"
                    className="w-full rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted"
                    onClick={() => { setScheduledFor(new Date(Date.now() + 3600_000).toISOString()); setScheduleOpen(false); }}>
                    In 1 hour
                  </button>
                  <button type="button"
                    className="w-full rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted"
                    onClick={() => {
                      const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(9, 0, 0, 0);
                      setScheduledFor(d.toISOString()); setScheduleOpen(false);
                    }}>
                    Tomorrow, 9:00 AM
                  </button>
                  <div className="px-2 pt-1">
                    <label className="text-[11px] text-muted-foreground">Custom</label>
                    <Input
                      type="datetime-local"
                      className="mt-1 h-9"
                      min={new Date(Date.now() + 60_000).toISOString().slice(0, 16)}
                      onChange={(e) => {
                        if (!e.target.value) return;
                        const d = new Date(e.target.value);
                        if (d.getTime() > Date.now()) { setScheduledFor(d.toISOString()); setScheduleOpen(false); }
                      }}
                    />
                  </div>
                </PopoverContent>
              </Popover>
            </div>
            <Button variant="gold" size="sm" onClick={send} disabled={!canSend} className="h-9">
              {sending
                ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                : scheduledFor
                  ? <Clock className="mr-1.5 h-4 w-4" />
                  : <Send className="mr-1.5 h-4 w-4" />}
              {scheduledFor ? "Schedule" : "Send"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
  );
}
