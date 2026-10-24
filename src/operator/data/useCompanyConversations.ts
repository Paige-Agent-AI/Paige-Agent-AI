import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export interface WelcomeDelivery {
  user_id: string;
  state: string;
  attempts: number;
  last_error: string | null;
  provider_message_id: string | null;
  first_attempt_at: string | null;
  sent_at: string | null;
}

export interface SendLogEntry {
  message_id: string;
  template: string;
  recipient: string;
  status: string;
  created_at: string;
}

export interface ConversationsSummary {
  total_sends: number;
  sent: number;
  delivered_events: number;
  welcome_sent: number;
  welcome_pending: number;
  welcome_attention: number;
}

export interface ConversationsData {
  summary: ConversationsSummary;
  welcome_deliveries: WelcomeDelivery[];
  send_log: SendLogEntry[];
}

export function useCompanyConversations() {
  const [data, setData] = useState<ConversationsData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data: r, error: e } = await supabase.rpc("operator_company_conversations");
      if (cancelled) return;
      if (e) { setError(e.message); setLoading(false); return; }
      setData(r as unknown as ConversationsData);
      setError(null); setLoading(false);
    })();
    return () => { cancelled = true; };
  }, []);
  return { data, error, loading };
}
