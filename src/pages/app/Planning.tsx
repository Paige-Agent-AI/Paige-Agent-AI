import { useDashboardMode } from "@/contexts/DashboardModeContext";
import { PlanningHub } from "@/components/planning/PlanningHub";

/**
 * /app/planning — the Task Manager. The landing target for a fired reminder's
 * notification (action_url = /app/planning), and the home for everything Paige
 * plans: reminders, tasks, milestones, plans. Staff get the team scope; a
 * non-staff seat sees only their own items (plan_list enforces this server-side).
 */
export default function Planning() {
  const { isAdmin } = useDashboardMode();
  return <PlanningHub staff={isAdmin} />;
}
