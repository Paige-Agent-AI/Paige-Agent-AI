// useConversations — the real data hook behind the Conversations surface.
// Queries messages + contacts, groups into threads by contact, maps to the
// thread shape the Inbox UI expects. Replaces the fixture data (inbox2's IB).
//
// §9: tenant-scoped by construction (the client carries the caller's JWT and RLS
// gates every read). Realtime subscription keeps threads live.
import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useTenantContext } from "@/hooks/useTenantContext";
import { CLIENT_CONTACT_METHODS_EMBED, primaryAddressesOf, type WithClientContactMethods } from "@/lib/contact-methods";

// Widened to string: the generated types do not know the contact-methods embed yet.
const THREAD_CONTACT_SELECT: string = `id, first_name, last_name, account_number, ${CLIENT_CONTACT_METHODS_EMBED}`;

export interface ConversationThread {
  id: string;
  contact_id: string | null;
  n: string;             // display name
  role: string;          // subtitle (company / role)
  ch: "email" | "sms" | "wa" | "ig";  // channel
  t: string;             // relative time of last message
  unread: number;
  state: string;         // lifecycle hint (from contact metadata or risk signal)
  email: string | null;
  msgs: ConversationMsg[];
  /** Labels applied to any message in this thread (from the triage pass or Paige). */
  labels: Array<{ name: string; slug: string; color: string }>;
}

export interface ConversationMsg {
  me?: boolean;          // outbound (owner/coach sent)
  paige?: boolean;       // Paige drafted/suggested
  body: string;
  subj?: string;
  t: string;             // time label
  st?: "sent" | "delivered" | "read";
  ch?: string;
}

interface RawMessage {
  id: string;
  direction: "inbound" | "outbound";
  channel_type: string;
  subject: string | null;
  body_text: string | null;
  body_html: string | null;
  status: string;
  recipients: Array<{ address: string; name?: string }> | null;
  sender: string | null;
  contact_id: string | null;
  created_at: string;
  metadata: Record<string, unknown> | null;
}

interface RawContact {
  id: string;
  first_name: string | null;
  last_name: string | null;
  account_number: string | null;
  email: string | null;
  company_name: string | null;
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1) return "now";
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h`;
  const d = Math.floor(hr / 24);
  return `${d}d`;
}

function timeLabel(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }).toLowerCase();
}

function mapChannel(ch: string): ConversationThread["ch"] {
  if (ch === "sms" || ch === "voice") return "sms";
  if (ch === "whatsapp") return "wa";
  if (ch === "instagram") return "ig";
  return "email";
}

/* eslint-disable @typescript-eslint/no-explicit-any -- The messages table's
 * generated types are too deeply recursive for the compiler's instantiation
 * limit; this one-function boundary isolates the query so the rest of the
 * file stays fully typed. */
async function fetchRecentMessages(client: any): Promise<{ data: unknown; error: { message: string } | null }> {
  return await client.from("messages")
    .select("id, direction, channel_type, subject, body_text, body_html, status, recipients, sender, contact_id, created_at, metadata")
    .order("created_at", { ascending: false })
    .limit(200);
}

/* eslint-disable @typescript-eslint/no-explicit-any -- boundary pattern */
async function fetchMessageLabels(client: any, msgIds: string[]): Promise<{ data: unknown }> {
  return await client.from("paige_message_labels")
    .select("message_id, label_id, paige_conversation_labels(name, slug, color)")
    .in("message_id", msgIds);
}

export function useConversations() {
  const { activeTenantId } = useTenantContext();
  const [threads, setThreads] = useState<ConversationThread[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const requestEpoch = useRef(0);

  const load = useCallback(async () => {
    if (!activeTenantId) return;
    const epoch = ++requestEpoch.current;
    setLoading(true);
    setError(null);
    try {
      // Fetch recent messages + their contacts in one round trip.
      // The generated Supabase types for messages are deeply recursive; the
      // builder chain trips TS2589/TS2769 on the generated Row type. The query
      // is correct; the escape is structural — one async call, one boundary.
      const msgsRes = await fetchRecentMessages(supabase);
      const msgs = (msgsRes.data ?? null) as RawMessage[] | null;
      const msgErr = msgsRes.error;

      if (epoch !== requestEpoch.current) return;
      if (msgErr) throw msgErr;

      // Fetch contacts for name resolution.
      const contactIds = [...new Set((msgs ?? []).map((m) => m?.contact_id).filter((v): v is string => !!v))];
      let contacts: RawContact[] = [];
      if (contactIds.length) {
        const csRes = await supabase
          .from("clients")
          .select(THREAD_CONTACT_SELECT)
          .in("id", contactIds);
        // `email` is each contact's PRIMARY address, from its contact methods.
        contacts = (((csRes.data ?? null) as unknown as Array<Omit<RawContact, "email"> & WithClientContactMethods> | null) ?? [])
          .map((row) => ({ ...row, email: primaryAddressesOf(row.client_contact_methods).email }));
      }
      const contactMap = new Map(contacts.map((c) => [c.id, c]));

      // Fetch labels for these messages (the triage pass's output).
      // Same boundary pattern as fetchRecentMessages (deep type workaround).
      const msgIds = (msgs ?? []).map((m) => m.id);
      const labelsRes = await fetchMessageLabels(supabase, msgIds);
      const rawLabels = (labelsRes.data ?? []) as Array<{
        message_id: string;
        paige_conversation_labels?: { name: string; slug: string; color: string } | null;
      }>;
      const labelsByMsg = new Map<string, Array<{ name: string; slug: string; color: string }>>();
      for (const rl of rawLabels) {
        if (!rl.paige_conversation_labels) continue;
        const list = labelsByMsg.get(rl.message_id) ?? [];
        list.push(rl.paige_conversation_labels);
        labelsByMsg.set(rl.message_id, list);
      }

      // Group into threads by contact_id (or sender email for unlinked).
      const byThread = new Map<string, ConversationThread>();
      for (const m of msgs ?? []) {
        const key = m.contact_id ?? m.sender ?? "unknown";
        const contact = m.contact_id ? contactMap.get(m.contact_id) : null;
        const name = contact
          ? `${contact.first_name ?? ""} ${contact.last_name ?? ""}`.trim() || contact.account_number || "Unknown"
          : m.direction === "inbound"
            ? (m.sender ?? "Unknown sender").split("@")[0]
            : (m.recipients?.[0]?.name ?? m.recipients?.[0]?.address?.split("@")[0] ?? "Unknown");

        if (!byThread.has(key)) {
          byThread.set(key, {
            id: key,
            contact_id: m.contact_id,
            n: name,
            role: contact?.account_number ?? "",
            ch: mapChannel(m.channel_type),
            t: timeAgo(m.created_at),
            unread: 0,
            state: "Active",
            email: contact?.email ?? (m.direction === "inbound" ? m.sender : m.recipients?.[0]?.address) ?? null,
            msgs: [],
            labels: [],
          });
        }
        const th = byThread.get(key)!;
        // Carry this message's labels up to the thread level (deduped).
        for (const lbl of labelsByMsg.get(m.id) ?? []) {
          if (!th.labels.some((l) => l.slug === lbl.slug)) th.labels.push(lbl);
        }

        const body = (m.body_text ?? m.body_html ?? "").replace(/<[^>]+>/g, "").trim();
        const msg: ConversationMsg = {
          me: m.direction === "outbound",
          body: body.slice(0, 500) || "(no text content)",
          subj: m.subject ?? undefined,
          t: timeLabel(m.created_at),
          st: m.direction === "outbound" && m.status === "sent" ? "sent" : undefined,
          ch: m.channel_type,
        };
        th.msgs.unshift(msg); // messages are desc; unbuild to chronological
        if (m.direction === "inbound" && m.status === "received") th.unread++;
        if (timeAgo(m.created_at) < timeAgo(th.msgs[th.msgs.length - 1]?.t ?? m.created_at)) {
          th.t = timeAgo(m.created_at);
        }
      }

      // Sort threads by most recent message, newest first.
      const list = [...byThread.values()].sort((a, b) => a.t.localeCompare(b.t));
      setThreads(list);
    } catch (e) {
      if (epoch !== requestEpoch.current) return;
      setError(e instanceof Error ? e.message : "Couldn't load conversations.");
    } finally {
      if (epoch === requestEpoch.current) setLoading(false);
    }
  }, [activeTenantId]);

  useEffect(() => {
    void load();
    const channel = supabase
      .channel(`conversations_${activeTenantId ?? "all"}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "messages" }, () => void load())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [load, activeTenantId]);

  return { threads, loading, error, refresh: load };
}
