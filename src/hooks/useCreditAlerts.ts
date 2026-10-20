/* eslint-disable @typescript-eslint/no-explicit-any -- pre-existing legacy `any` debt in this file (untyped
   `credit_alerts` reads/writes, the table is not in the generated types). E09 F2 only added the `enabled` option
   and introduced ZERO new `any`s; retyping is tracked separately (#234). */
import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { getEffectiveUserId } from "@/lib/scopedUser";

export interface CreditAlert {
  id: string;
  client_id: string;
  alert_type: string;
  alert_severity: "critical" | "warning" | "informational";
  alert_title: string;
  alert_description: string;
  previous_value: string | null;
  new_value: string | null;
  bureau: string | null;
  related_account_id: string | null;
  is_read: boolean;
  is_dismissed: boolean;
  created_at: string;
  read_at: string | null;
  dismissed_at: string | null;
  dismissed_by: string | null;
}

interface UseCreditAlertsOptions {
  clientId?: string | null;
  limit?: number;
  onlyUnread?: boolean;
  /**
   * E09 F2: false reads nothing and subscribes to nothing (no alerts, nothing loading). Callers pass whether the
   * viewer's business is finance-entitled; credit alerts exist only there. Defaults to true for owner tools.
   */
  enabled?: boolean;
}

export function useCreditAlerts(options: UseCreditAlertsOptions = {}) {
  const { clientId, limit = 50, onlyUnread = false, enabled = true } = options;
  const [alerts, setAlerts] = useState<CreditAlert[]>([]);
  const [loading, setLoading] = useState(true);
  const [unreadCount, setUnreadCount] = useState(0);
  const [criticalUnread, setCriticalUnread] = useState(0);
  const [warningUnread, setWarningUnread] = useState(0);

  const fetchAlerts = useCallback(async () => {
    if (!enabled) {
      setAlerts([]); setUnreadCount(0); setCriticalUnread(0); setWarningUnread(0); setLoading(false);
      return;
    }
    try {
      const resolvedClientId = clientId || (await getCurrentUserId());
      if (!resolvedClientId) { setLoading(false); return; }

      let query = supabase
        .from("credit_alerts" as any)
        .select("*")
        .eq("client_id", resolvedClientId)
        .eq("is_dismissed", false)
        .order("created_at", { ascending: false })
        .limit(limit);

      if (onlyUnread) query = query.eq("is_read", false);

      const { data, error } = await query;
      if (error) { console.error("Error fetching credit alerts:", error); setLoading(false); return; }

      const typedData = (data || []) as unknown as CreditAlert[];
      setAlerts(typedData);

      const unread = typedData.filter(a => !a.is_read);
      setUnreadCount(unread.length);
      setCriticalUnread(unread.filter(a => a.alert_severity === "critical").length);
      setWarningUnread(unread.filter(a => a.alert_severity === "warning").length);
    } catch (e) {
      console.error("useCreditAlerts error:", e);
    } finally {
      setLoading(false);
    }
  }, [clientId, limit, onlyUnread, enabled]);

  const markAsRead = useCallback(async (alertId: string) => {
    await supabase
      .from("credit_alerts" as any)
      .update({ is_read: true, read_at: new Date().toISOString() } as any)
      .eq("id", alertId);

    setAlerts(prev => prev.map(a => a.id === alertId ? { ...a, is_read: true, read_at: new Date().toISOString() } : a));
    setUnreadCount(prev => Math.max(0, prev - 1));
  }, []);

  const markAllAsRead = useCallback(async () => {
    const resolvedClientId = clientId || (await getCurrentUserId());
    if (!resolvedClientId) return;

    await supabase
      .from("credit_alerts" as any)
      .update({ is_read: true, read_at: new Date().toISOString() } as any)
      .eq("client_id", resolvedClientId)
      .eq("is_read", false);

    setAlerts(prev => prev.map(a => ({ ...a, is_read: true, read_at: new Date().toISOString() })));
    setUnreadCount(0);
    setCriticalUnread(0);
    setWarningUnread(0);
  }, [clientId]);

  const dismissAlert = useCallback(async (alertId: string) => {
    const userId = await getCurrentUserId();
    await supabase
      .from("credit_alerts" as any)
      .update({ is_dismissed: true, dismissed_at: new Date().toISOString(), dismissed_by: userId } as any)
      .eq("id", alertId);

    setAlerts(prev => prev.filter(a => a.id !== alertId));
  }, []);

  const dismissAllInformational = useCallback(async () => {
    const resolvedClientId = clientId || (await getCurrentUserId());
    if (!resolvedClientId) return;
    const userId = await getCurrentUserId();

    await supabase
      .from("credit_alerts" as any)
      .update({ is_dismissed: true, dismissed_at: new Date().toISOString(), dismissed_by: userId } as any)
      .eq("client_id", resolvedClientId)
      .eq("alert_severity", "informational")
      .eq("is_dismissed", false);

    setAlerts(prev => prev.filter(a => a.alert_severity !== "informational"));
  }, [clientId]);

  useEffect(() => {
    fetchAlerts();
  }, [fetchAlerts]);

  // Realtime subscription
  useEffect(() => {
    let channel: any;

    const setup = async () => {
      if (!enabled) return;
      const resolvedClientId = clientId || (await getCurrentUserId());
      if (!resolvedClientId) return;

      const topic = `credit-alerts-${resolvedClientId}-${Math.random().toString(36).slice(2, 10)}`;
      channel = supabase
        .channel(topic)
        .on("postgres_changes", {
          event: "INSERT",
          schema: "public",
          table: "credit_alerts",
          filter: `client_id=eq.${resolvedClientId}`,
        }, (payload: any) => {
          const newAlert = payload.new as CreditAlert;
          setAlerts(prev => [newAlert, ...prev]);
          if (!newAlert.is_read) {
            setUnreadCount(prev => prev + 1);
            if (newAlert.alert_severity === "critical") setCriticalUnread(prev => prev + 1);
            if (newAlert.alert_severity === "warning") setWarningUnread(prev => prev + 1);
          }
        })
        .subscribe();
    };

    setup();
    return () => { if (channel) supabase.removeChannel(channel); };
  }, [clientId, enabled]);

  return {
    alerts,
    loading,
    unreadCount,
    criticalUnread,
    warningUnread,
    markAsRead,
    markAllAsRead,
    dismissAlert,
    dismissAllInformational,
    refetch: fetchAlerts,
    highestSeverity: criticalUnread > 0 ? "critical" as const : warningUnread > 0 ? "warning" as const : "informational" as const,
  };
}

async function getCurrentUserId(): Promise<string | null> {
  return await getEffectiveUserId();
}
