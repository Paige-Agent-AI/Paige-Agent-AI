import { useEffect, useState } from "react";
import { Link, Navigate, useSearchParams } from "react-router-dom";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { supabase } from "@/integrations/supabase/client";
import { Mail, MessageSquare, TrendingUp, AlertTriangle, ShieldCheck, SlidersHorizontal } from "lucide-react";
import {
  PageShell,
  PageHeader,
  StatRow,
  StatTile,
  SectionCard,
  DataTableShell,
  EmptyState,
  StatePill,
} from "@/components/ui/page";
import { Button } from "@/components/ui/button";
import { TableCell, TableRow } from "@/components/ui/table";

interface LogRow {
  id: string;
  // NULL on a row keyed to a business contact rather than a portal login (Experience 03 history rows).
  user_id: string | null;
  channel: string;
  message_type: string;
  status: string;
  subject: string | null;
  preview: string | null;
  error_message: string | null;
  created_at: string;
}

const isFailedStatus = (status: string) => status === "failed" || status === "bounced";

// The messaging-CONFIG panels moved to Conversations > Settings (§45 tier decompose, §18 one home).
// Old deep-links land here as ?tab=<key>; redirect them to their new home so nothing dead-ends (§37).
const SETTINGS_HOME = "/choose-account";
const MOVED_CONFIG_TABS = new Set(["numbers", "a2p", "consent", "signatures", "notifications"]);

const CommunicationsAdmin = () => {
  const [searchParams] = useSearchParams();
  const [loading, setLoading] = useState(true);
  const [logs, setLogs] = useState<LogRow[]>([]);
  const [stats, setStats] = useState({
    emailsThisMonth: 0,
    smsThisMonth: 0,
    emailSuccessRate: 0,
    smsSuccessRate: 0,
    emailEnabledPct: 0,
    smsEnabledPct: 0,
    unsubscribedCount: 0,
    failuresThisMonth: 0,
  });

  // Redirect stale config deep-links to the new Settings home (belt-and-suspenders — no producer
  // emits these today, but §31 keeps the move complete). Snippets kept its own Conversations sub-tab.
  const requestedTab = searchParams.get("tab");
  const redirectTo = requestedTab
    ? MOVED_CONFIG_TABS.has(requestedTab)
      ? `${SETTINGS_HOME}?panel=${requestedTab}`
      : requestedTab === "snippets"
        ? "/choose-account"
        : null
    : null;

  useEffect(() => {
    if (redirectTo) return;
    void loadData();
  }, [redirectTo]);

  const loadData = async () => {
    setLoading(true);
    try {
      const monthStart = new Date();
      monthStart.setDate(1);
      monthStart.setHours(0, 0, 0, 0);
      const monthStartISO = monthStart.toISOString();

      const [logRes, allLogsRes, prefsRes, totalProfilesRes] = await Promise.all([
        supabase
          .from("communication_log")
          .select("*")
          .order("created_at", { ascending: false })
          .limit(100),
        supabase
          .from("communication_log")
          .select("channel, status")
          .gte("created_at", monthStartISO),
        supabase
          .from("communication_preferences")
          .select("email_enabled, sms_enabled, sms_phone_verified, unsubscribed_all"),
        supabase
          .from("profiles")
          .select("id", { count: "exact", head: true }),
      ]);

      if (logRes.data) setLogs(logRes.data as LogRow[]);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const allLogs = (allLogsRes.data as any[]) ?? [];
      const emails = allLogs.filter((l) => l.channel === "email");
      const sms = allLogs.filter((l) => l.channel === "sms");
      const emailSuccess = emails.filter((l) =>
        ["queued", "sent", "delivered"].includes(l.status),
      ).length;
      const smsSuccess = sms.filter((l) => ["sent", "delivered", "queued"].includes(l.status)).length;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const prefs = (prefsRes.data as any[]) ?? [];
      const emailOptIn = prefs.filter((p) => p.email_enabled && !p.unsubscribed_all).length;
      const smsOptIn = prefs.filter(
        (p) => p.sms_enabled && p.sms_phone_verified && !p.unsubscribed_all,
      ).length;
      const unsubCount = prefs.filter((p) => p.unsubscribed_all).length;
      const totalUsers = totalProfilesRes.count || prefs.length || 1;

      const failures = allLogs.filter((l) => l.status === "failed" || l.status === "bounced").length;

      setStats({
        emailsThisMonth: emails.length,
        smsThisMonth: sms.length,
        emailSuccessRate: emails.length ? Math.round((emailSuccess / emails.length) * 100) : 0,
        smsSuccessRate: sms.length ? Math.round((smsSuccess / sms.length) * 100) : 0,
        emailEnabledPct: Math.round((emailOptIn / totalUsers) * 100),
        smsEnabledPct: Math.round((smsOptIn / totalUsers) * 100),
        unsubscribedCount: unsubCount,
        failuresThisMonth: failures,
      });
    } catch (err) {
      console.error("Failed to load communications data", err);
    } finally {
      setLoading(false);
    }
  };

  if (redirectTo) return <Navigate replace to={redirectTo} />;

  const failures = logs.filter((l) => isFailedStatus(l.status));

  return (
    <PageShell width="wide">
      <PageHeader
        variant="plain"
        icon={MessageSquare}
        title="Message Activity"
        description="Every email and text Paige sends, with its delivery status — plus this month's dispatch totals."
        actions={
          <Button asChild variant="outline" size="sm">
            <Link to={SETTINGS_HOME}>
              <SlidersHorizontal className="mr-1.5 h-4 w-4" />
              Manage messaging settings
            </Link>
          </Button>
        }
      />

      <StatRow cols={4}>
        <StatTile
          label="Emails (MTD)"
          value={stats.emailsThisMonth}
          icon={Mail}
          hint={`${stats.emailSuccessRate}% delivered`}
          loading={loading}
        />
        <StatTile
          label="SMS (MTD)"
          value={stats.smsThisMonth}
          icon={MessageSquare}
          hint={`${stats.smsSuccessRate}% delivered`}
          loading={loading}
        />
        <StatTile
          label="Opt-in (Email / SMS)"
          value={`${stats.emailEnabledPct}% / ${stats.smsEnabledPct}%`}
          icon={TrendingUp}
          hint="of all users opted in"
          loading={loading}
        />
        <StatTile
          label="Issues"
          value={stats.failuresThisMonth}
          icon={AlertTriangle}
          intent="negative"
          hint={`${stats.unsubscribedCount} unsubscribed`}
          loading={loading}
        />
      </StatRow>

      <Tabs defaultValue="recent">
        <TabsList>
          <TabsTrigger value="recent">Recent Activity</TabsTrigger>
          <TabsTrigger value="failures">Failures ({failures.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="recent">
          <DataTableShell
            columns={[
              { key: "when", header: "When" },
              { key: "channel", header: "Channel" },
              { key: "type", header: "Type" },
              { key: "user", header: "User" },
              { key: "status", header: "Status" },
              { key: "preview", header: "Preview" },
            ]}
            loading={loading}
            isEmpty={logs.length === 0}
            empty={
              <EmptyState
                icon={Mail}
                title="Nothing has gone out yet"
                description="The moment Paige sends an email or text, every dispatch lands here with its delivery status."
              />
            }
          >
            {logs.map((row) => (
              <TableRow key={row.id}>
                <TableCell className="whitespace-nowrap text-muted-foreground">
                  {new Date(row.created_at).toLocaleString()}
                </TableCell>
                <TableCell className="capitalize">{row.channel}</TableCell>
                <TableCell>{row.message_type}</TableCell>
                <TableCell className="font-mono text-xs">{row.user_id ? `${row.user_id.slice(0, 8)}…` : "—"}</TableCell>
                <TableCell>
                  <StatePill state={isFailedStatus(row.status) ? "error" : "success"}>
                    {row.status}
                  </StatePill>
                </TableCell>
                <TableCell className="max-w-xs truncate text-muted-foreground">
                  {row.preview ?? row.subject ?? "—"}
                </TableCell>
              </TableRow>
            ))}
          </DataTableShell>
        </TabsContent>

        <TabsContent value="failures">
          {failures.length === 0 ? (
            <SectionCard>
              <EmptyState
                icon={ShieldCheck}
                title="Every message landed"
                description="No bounces, no failures this month. When one slips, it shows up here with the reason so you can fix it fast."
              />
            </SectionCard>
          ) : (
            <div className="space-y-3">
              {failures.map((row) => (
                <SectionCard key={row.id}>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                      <span>{new Date(row.created_at).toLocaleString()}</span>
                      <StatePill state="error">{row.status}</StatePill>
                    </div>
                    <div className="text-sm">
                      <span className="font-semibold capitalize">{row.channel}</span> · {row.message_type}
                      {row.user_id && (
                        <>
                          {" "}· user <span className="font-mono text-xs">{row.user_id.slice(0, 8)}…</span>
                        </>
                      )}
                    </div>
                    {row.error_message && (
                      <div className="rounded-md bg-destructive/10 p-2 text-xs text-destructive">
                        {row.error_message}
                      </div>
                    )}
                  </div>
                </SectionCard>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </PageShell>
  );
};

export default CommunicationsAdmin;
