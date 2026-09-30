import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { CheckCircle2, MessageSquare, ShieldAlert, AlertTriangle, Send, Lock } from "lucide-react";
import { toast } from "sonner";
import {
  TICKET_STATUS_LABEL, TICKET_STATUS_STYLES, PRIORITY_STYLES, ticketCategoryLabel, timeAgo,
  type TicketStatus, type TicketPriority,
} from "./supportTypes";

interface Ticket {
  id: string;
  ticket_number: string;
  subject: string;
  description: string;
  category: string;
  status: TicketStatus;
  priority: TicketPriority;
  user_id: string;
  assigned_to: string | null;
  resolution_notes: string | null;
  created_at: string;
  updated_at: string;
}

// The shape these profile reads are written against. The selects below name `email`, which the
// generated types do not list on `profiles`; the cast keeps the reads exactly as they were.
type ProfileNameRow = { user_id: string; full_name: string | null; email: string | null };

interface AssignableUser {
  user_id: string;
  full_name: string | null;
  email: string | null;
  role: string;
}

interface Message {
  id: string;
  user_id: string | null;
  sender_type: "client" | "support" | "system";
  message: string;
  created_at: string;
  is_internal: boolean;
}

interface Props {
  ticketId: string | null;
  adminUserId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onTicketUpdated: () => void;
}

export function AdminTicketPanel({ ticketId, adminUserId, open, onOpenChange, onTicketUpdated }: Props) {
  const [ticket, setTicket] = useState<Ticket | null>(null);
  const [clientEmail, setClientEmail] = useState<string | null>(null);
  const [clientName, setClientName] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [reply, setReply] = useState("");
  const [internalNote, setInternalNote] = useState("");
  const [resolutionNotes, setResolutionNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [assignableUsers, setAssignableUsers] = useState<AssignableUser[]>([]);

  useEffect(() => {
    if (!open || !ticketId) return;
    void load();
    void loadAssignableUsers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, ticketId]);

  const loadAssignableUsers = async () => {
    // Pull all admin role rows, then their profiles
    const { data: roles } = await supabase
      .from("user_roles")
      .select("user_id,role")
      .eq("role", "admin");
    const userIds = Array.from(new Set((roles ?? []).map((r) => r.user_id)));
    if (userIds.length === 0) {
      setAssignableUsers([]);
      return;
    }
    const { data: profs } = await supabase
      .from("profiles")
      .select("user_id,full_name,email")
      .in("user_id", userIds);
    const profMap = new Map<string, { full_name: string | null; email: string | null }>();
    ((profs ?? []) as unknown as ProfileNameRow[]).forEach((p) => profMap.set(p.user_id, { full_name: p.full_name, email: p.email }));
    const merged: AssignableUser[] = userIds.map((uid) => ({
      user_id: uid,
      full_name: profMap.get(uid)?.full_name ?? null,
      email: profMap.get(uid)?.email ?? null,
      role: (roles ?? []).find((r) => r.user_id === uid)?.role ?? "admin",
    }));
    // Sort by display name
    merged.sort((a, b) => (a.full_name || a.email || "").localeCompare(b.full_name || b.email || ""));
    setAssignableUsers(merged);
  };

  const load = async () => {
    if (!ticketId) return;
    setLoading(true);
    try {
      const [{ data: t }, { data: msgs }] = await Promise.all([
        supabase.from("support_tickets").select("*").eq("id", ticketId).maybeSingle(),
        supabase.from("support_ticket_messages")
          .select("id,user_id,sender_type,message,created_at,is_internal")
          .eq("ticket_id", ticketId)
          .order("created_at", { ascending: true }),
      ]);
      const tk = t as Ticket | null;
      setTicket(tk);
      setMessages((msgs ?? []) as Message[]);
      setResolutionNotes(tk?.resolution_notes ?? "");
      if (tk?.user_id) {
        const { data: prof } = await supabase
          .from("profiles")
          .select("full_name,email")
          .eq("user_id", tk.user_id)
          .maybeSingle();
        setClientName((prof as unknown as ProfileNameRow | null)?.full_name ?? null);
        setClientEmail((prof as unknown as ProfileNameRow | null)?.email ?? null);
      }
    } finally {
      setLoading(false);
    }
  };

  const updateTicketField = async (patch: Partial<Ticket>) => {
    if (!ticketId) return;
    setBusy(true);
    try {
      const { error } = await supabase.from("support_tickets").update(patch).eq("id", ticketId);
      if (error) throw error;
      await load();
      onTicketUpdated();
    } catch (err) {
      toast.error((err instanceof Error ? err.message : null) || "Could not update ticket");
    } finally {
      setBusy(false);
    }
  };

  const assignTicket = async (assigneeName: string | null) => {
    if (!ticketId) return;
    setBusy(true);
    try {
      const { error } = await supabase
        .from("support_tickets")
        .update({ assigned_to: assigneeName })
        .eq("id", ticketId);
      if (error) throw error;

      // System message inside the thread
      const sysMessage = assigneeName
        ? `Ticket assigned to ${assigneeName}`
        : "Ticket unassigned";
      await supabase.from("support_ticket_messages").insert({
        ticket_id: ticketId,
        user_id: adminUserId,
        sender_type: "system",
        message: sysMessage,
        is_internal: true,
      });

      toast.success(assigneeName ? `Assigned to ${assigneeName}` : "Unassigned");
      await load();
      onTicketUpdated();
    } catch (err) {
      toast.error((err instanceof Error ? err.message : null) || "Could not assign ticket");
    } finally {
      setBusy(false);
    }
  };

  const sendInternalNote = async () => {
    if (!ticketId || !internalNote.trim()) return;
    setBusy(true);
    try {
      const { error } = await supabase.from("support_ticket_messages").insert({
        ticket_id: ticketId,
        user_id: adminUserId,
        sender_type: "support",
        message: internalNote.trim(),
        is_internal: true,
      });
      if (error) throw error;
      setInternalNote("");
      toast.success("Internal note added");
      await load();
    } catch (err) {
      toast.error((err instanceof Error ? err.message : null) || "Could not add note");
    } finally {
      setBusy(false);
    }
  };

  const sendReplyToClient = async () => {
    if (!ticketId || !reply.trim()) return;
    setBusy(true);
    try {
      const { error } = await supabase.from("support_ticket_messages").insert({
        ticket_id: ticketId,
        user_id: adminUserId,
        sender_type: "support",
        message: reply.trim(),
        is_internal: false,
      });
      if (error) throw error;

      // Auto-move to waiting_on_client when support replies on an open ticket
      if (ticket && (ticket.status === "open" || ticket.status === "in_progress")) {
        await supabase.from("support_tickets").update({ status: "waiting_on_client" }).eq("id", ticketId);
      }

      // Email notification
      if (clientEmail && ticket) {
        void supabase.functions.invoke("send-transactional-email", {
          body: {
            templateName: "support-ticket-reply",
            recipientEmail: clientEmail,
            recipientUserId: ticket.user_id,
            idempotencyKey: `support-reply-${ticketId}-${Date.now()}`,
            templateData: {
              ticketNumber: ticket.ticket_number,
              subject: ticket.subject,
              replyPreview: reply.trim(),
            },
          },
        });
      }

      setReply("");
      toast.success("Reply sent to client");
      await load();
      onTicketUpdated();
    } catch (err) {
      toast.error((err instanceof Error ? err.message : null) || "Could not send reply");
    } finally {
      setBusy(false);
    }
  };

  const resolveTicket = async () => {
    if (!ticketId || !ticket) return;
    setBusy(true);
    try {
      const { error } = await supabase
        .from("support_tickets")
        .update({ status: "resolved", resolution_notes: resolutionNotes.trim() || null })
        .eq("id", ticketId);
      if (error) throw error;

      if (clientEmail) {
        void supabase.functions.invoke("send-transactional-email", {
          body: {
            templateName: "support-ticket-resolved",
            recipientEmail: clientEmail,
            recipientUserId: ticket.user_id,
            idempotencyKey: `support-resolved-${ticketId}`,
            templateData: {
              ticketNumber: ticket.ticket_number,
              subject: ticket.subject,
              resolutionNotes: resolutionNotes.trim() || null,
            },
          },
        });
      }

      toast.success("Ticket resolved");
      await load();
      onTicketUpdated();
    } catch (err) {
      toast.error((err instanceof Error ? err.message : null) || "Could not resolve ticket");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-3xl flex flex-col overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2 flex-wrap">
            <span className="font-mono text-sm text-muted-foreground">{ticket?.ticket_number ?? "—"}</span>
            <span>{ticket?.subject ?? "Loading..."}</span>
          </SheetTitle>
          <SheetDescription asChild>
            <div className="flex items-center gap-2 flex-wrap mt-1">
              {ticket && (
                <>
                  <Badge variant="outline" className={TICKET_STATUS_STYLES[ticket.status]}>
                    {TICKET_STATUS_LABEL[ticket.status]}
                  </Badge>
                  <Badge variant="outline">{ticketCategoryLabel(ticket.category)}</Badge>
                  {ticket.priority === "urgent" && (
                    <Badge variant="outline" className={PRIORITY_STYLES.urgent}>
                      <AlertTriangle className="w-3 h-3 mr-1" /> Urgent
                    </Badge>
                  )}
                  <span className="text-xs text-muted-foreground">
                    {clientName || "Client"} · {clientEmail || "—"}
                  </span>
                </>
              )}
            </div>
          </SheetDescription>
        </SheetHeader>

        {loading && <div className="text-sm text-muted-foreground py-6">Loading conversation...</div>}

        {!loading && ticket && (
          <>
            {/* Status, priority, and assignment controls */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 py-3 border-b border-border">
              <div className="space-y-1">
                <Label className="text-xs">Status</Label>
                <Select
                  value={ticket.status}
                  onValueChange={(v) => updateTicketField({ status: v as TicketStatus })}
                  disabled={busy}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {(Object.keys(TICKET_STATUS_LABEL) as TicketStatus[]).map((s) => (
                      <SelectItem key={s} value={s}>{TICKET_STATUS_LABEL[s]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Priority</Label>
                <Select
                  value={ticket.priority}
                  onValueChange={(v) => updateTicketField({ priority: v as TicketPriority })}
                  disabled={busy}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="low">Low</SelectItem>
                    <SelectItem value="normal">Normal</SelectItem>
                    <SelectItem value="high">High</SelectItem>
                    <SelectItem value="urgent">Urgent</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Assigned To</Label>
                <Select
                  value={ticket.assigned_to ?? "__unassigned"}
                  onValueChange={(v) => assignTicket(v === "__unassigned" ? null : v)}
                  disabled={busy}
                >
                  <SelectTrigger><SelectValue placeholder="Unassigned" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__unassigned">Unassigned</SelectItem>
                    {assignableUsers.map((u) => {
                      const name = u.full_name || u.email || "Team member";
                      return (
                        <SelectItem key={u.user_id} value={name}>
                          {name} <span className="text-[10px] text-muted-foreground ml-1">({u.role})</span>
                        </SelectItem>
                      );
                    })}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Message thread */}
            <div className="flex-1 overflow-y-auto py-4 space-y-3">
              {messages.length === 0 && (
                <div className="text-sm text-muted-foreground">No messages yet.</div>
              )}
              {messages.map((m) => {
                if (m.is_internal) {
                  return (
                    <div key={m.id} className="rounded-md border border-amber-500/30 bg-amber-500/5 p-3">
                      <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-amber-600 mb-1">
                        <Lock className="w-3 h-3" /> Internal Note · {timeAgo(m.created_at)}
                      </div>
                      <p className="text-sm whitespace-pre-wrap">{m.message}</p>
                    </div>
                  );
                }
                if (m.sender_type === "system") {
                  return (
                    <div key={m.id} className="flex justify-center">
                      <div className="text-xs text-muted-foreground bg-muted/50 px-3 py-1.5 rounded-full">
                        {m.message}
                      </div>
                    </div>
                  );
                }
                const isClient = m.sender_type === "client";
                return (
                  <div key={m.id} className={`flex ${isClient ? "justify-start" : "justify-end"}`}>
                    <div className={`max-w-[80%] rounded-lg px-4 py-2.5 ${
                      isClient ? "bg-muted text-foreground" : "bg-primary text-primary-foreground"
                    }`}>
                      <div className="text-xs opacity-70 mb-1 flex items-center gap-2">
                        {isClient ? (
                          <span>{clientName || "Client"}</span>
                        ) : (
                          <span className="flex items-center gap-1"><MessageSquare className="w-3 h-3" /> You (Support)</span>
                        )}
                        <span>•</span>
                        <span>{timeAgo(m.created_at)}</span>
                      </div>
                      <div className="text-sm whitespace-pre-wrap leading-relaxed">{m.message}</div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Internal note */}
            <div className="border-t border-border pt-3 space-y-2">
              <Label className="text-xs flex items-center gap-1 text-amber-600">
                <ShieldAlert className="w-3.5 h-3.5" /> Internal Note (not visible to client)
              </Label>
              <div className="flex gap-2">
                <Textarea
                  value={internalNote}
                  onChange={(e) => setInternalNote(e.target.value)}
                  placeholder="Add an internal note for the team..."
                  rows={2}
                  className="resize-none"
                />
                <Button variant="outline" onClick={sendInternalNote} disabled={busy || !internalNote.trim()}>
                  Add Note
                </Button>
              </div>
            </div>

            {/* Reply to client */}
            <div className="space-y-2 pt-2">
              <Label className="text-xs">Reply to Client</Label>
              <Textarea
                value={reply}
                onChange={(e) => setReply(e.target.value)}
                placeholder="Write a reply that the client will see..."
                rows={3}
                className="resize-none"
              />
              <Button onClick={sendReplyToClient} disabled={busy || !reply.trim()} className="gap-2">
                <Send className="w-4 h-4" /> Send Reply
              </Button>
            </div>

            {/* Resolution */}
            <div className="border-t border-border pt-3 space-y-2 mt-3">
              <Label className="text-xs">Resolution Notes</Label>
              <Textarea
                value={resolutionNotes}
                onChange={(e) => setResolutionNotes(e.target.value)}
                placeholder="Summarize how this issue was resolved (sent to client)..."
                rows={3}
                className="resize-none"
              />
              <Button
                variant="default"
                className="gap-2 bg-emerald-600 hover:bg-emerald-700"
                onClick={resolveTicket}
                disabled={busy || ticket.status === "resolved" || ticket.status === "closed"}
              >
                <CheckCircle2 className="w-4 h-4" /> Resolve Ticket & Notify Client
              </Button>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
