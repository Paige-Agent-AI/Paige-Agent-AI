import { Bell, Check, X, Shield, AlertTriangle, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useNotifications } from "@/hooks/useNotifications";
import { useCreditAlerts } from "@/hooks/useCreditAlerts";
import { useFinancePortal } from "@/hooks/useFinanceEntitlement";
import { formatDistanceToNow } from "date-fns";
import { useNavigate } from "react-router-dom";

import { safeRedirectOr } from "@/lib/auth/safeRedirect";
export const NotificationBell = () => {
  const navigate = useNavigate();
  const {
    notifications,
    unreadCount: notifUnread,
    markAsRead: markNotifRead,
    markAllAsRead: markAllNotifsRead,
    deleteNotification,
  } = useNotifications();

  // E09 F2: credit alerts, and the bell's way into /app/credit, exist only for a finance-entitled business (staff
  // keep theirs until their business has a deliberate install, Q5). Nothing is read or subscribed otherwise.
  const { open: financePortal } = useFinancePortal();
  const {
    alerts: creditAlerts,
    unreadCount: alertUnread,
    highestSeverity,
    markAsRead: markAlertRead,
    markAllAsRead: markAllAlertsRead,
  } = useCreditAlerts({ onlyUnread: false, limit: 5, enabled: financePortal });

  const totalUnread = notifUnread + alertUnread;

  // Badge color based on severity
  const badgeClass = highestSeverity === "critical"
    ? "bg-destructive"
    : highestSeverity === "warning"
      ? "bg-amber-500"
      : "bg-blue-500";

  const getNotificationIcon = (type: string) => {
    switch (type) {
      case "dispute_update": return "⚖️";
      case "payment_success": return "💰";
      case "subscription_change": return "📋";
      case "task_reminder": return "⏰";
      case "credit_report_ready": return "📊";
      case "welcome": return "👋";
      default: return "📢";
    }
  };

  const getSeverityIcon = (severity: string) => {
    if (severity === "critical") return <Shield className="w-4 h-4 text-destructive" />;
    if (severity === "warning") return <AlertTriangle className="w-4 h-4 text-amber-500" />;
    return <Info className="w-4 h-4 text-blue-500" />;
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- pre-existing type debt; hotfix changes only the retired route destination
  const handleNotificationClick = (notification: any) => {
    markNotifRead(notification.id);
    if (notification.action_url) navigate(safeRedirectOr(notification.action_url, "/choose-account"));
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- pre-existing type debt; hotfix changes only the retired route destination
  const handleAlertClick = (alert: any) => {
    markAlertRead(alert.id);
    if (financePortal) navigate("/app/credit");
  };

  const handleMarkAllRead = () => {
    markAllNotifsRead();
    markAllAlertsRead();
  };

  // Merge and sort: credit alerts first, then notifications
  const unreadAlerts = creditAlerts.filter(a => !a.is_read).slice(0, 3);
  const recentNotifs = notifications.slice(0, 5 - unreadAlerts.length);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        {/* An icon-only control needs a name a screen reader can say (E09 F2, Impeccable harden). */}
        <Button variant="ghost" size="icon" className="relative" aria-label={totalUnread > 0 ? `Notifications, ${totalUnread} unread` : "Notifications"}>
          <Bell className="h-5 w-5" aria-hidden="true" />
          {totalUnread > 0 && (
            <Badge
              className={`absolute -top-1 -right-1 h-5 w-5 flex items-center justify-center p-0 text-xs text-white border-0 ${badgeClass}`}
            >
              {totalUnread > 9 ? "9+" : totalUnread}
            </Badge>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" collisionPadding={16} className="w-[min(400px,calc(100vw-2rem))]">
        <div className="flex items-center justify-between px-4 py-3">
          <h3 className="font-semibold">Notifications</h3>
          {totalUnread > 0 && (
            <Button variant="ghost" size="sm" onClick={handleMarkAllRead} className="text-xs h-7">
              <Check className="h-3 w-3 mr-1" /> Mark all read
            </Button>
          )}
        </div>
        <DropdownMenuSeparator />

        <ScrollArea className="max-h-[400px]">
          {/* Credit Alerts Section */}
          {unreadAlerts.length > 0 && (
            <>
              <div className="px-4 py-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                Credit Alerts
              </div>
              {unreadAlerts.map(alert => (
                <div key={alert.id}>
                  <DropdownMenuItem
                    className="px-4 py-3 cursor-pointer bg-accent/5"
                    onSelect={(e) => { e.preventDefault(); handleAlertClick(alert); }}
                  >
                    <div className="flex gap-3 w-full">
                      <div className="flex-shrink-0 mt-0.5">{getSeverityIcon(alert.alert_severity)}</div>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-sm leading-tight">{alert.alert_title}</p>
                        <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{alert.alert_description}</p>
                        <div className="flex items-center gap-2 mt-1">
                          {alert.bureau && (
                            <span className="text-xs text-muted-foreground capitalize">{alert.bureau}</span>
                          )}
                          <span className="text-xs text-muted-foreground">
                            {formatDistanceToNow(new Date(alert.created_at), { addSuffix: true })}
                          </span>
                        </div>
                      </div>
                      <div className="h-2 w-2 rounded-full bg-primary flex-shrink-0 mt-1" />
                    </div>
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                </div>
              ))}
            </>
          )}

          {/* Regular Notifications */}
          {recentNotifs.length > 0 && (
            <>
              {unreadAlerts.length > 0 && (
                <div className="px-4 py-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                  Other Notifications
                </div>
              )}
              {recentNotifs.map(notification => (
                <div key={notification.id}>
                  <DropdownMenuItem
                    className={`px-4 py-3 cursor-pointer ${!notification.is_read ? "bg-accent/50" : ""}`}
                    onSelect={(e) => { e.preventDefault(); handleNotificationClick(notification); }}
                  >
                    <div className="flex gap-3 w-full">
                      <div className="text-2xl flex-shrink-0">{getNotificationIcon(notification.type)}</div>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-sm leading-tight">{notification.title}</p>
                        <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{notification.message}</p>
                        <p className="text-xs text-muted-foreground mt-1">
                          {formatDistanceToNow(new Date(notification.created_at), { addSuffix: true })}
                        </p>
                      </div>
                      {!notification.is_read && (
                        <div className="h-2 w-2 rounded-full bg-primary flex-shrink-0 mt-1" />
                      )}
                    </div>
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                </div>
              ))}
            </>
          )}

          {unreadAlerts.length === 0 && recentNotifs.length === 0 && (
            <div className="px-4 py-8 text-center text-muted-foreground">
              <Bell className="h-8 w-8 mx-auto mb-2 opacity-50" />
              <p className="text-sm">No notifications yet</p>
            </div>
          )}
        </ScrollArea>

        {financePortal && (alertUnread > 3 || notifications.length > 5) && (
          <>
            <DropdownMenuSeparator />
            <div className="p-2">
              <Button
                variant="ghost"
                size="sm"
                className="w-full text-xs"
                onClick={() => navigate("/app/credit")}
              >
                View All Alerts
              </Button>
            </div>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};
