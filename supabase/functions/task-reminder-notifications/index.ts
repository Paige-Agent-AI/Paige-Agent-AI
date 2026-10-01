// Hourly task deadline reminder job
// Finds tasks due in next 24 hours that haven't been reminded yet,
// sends a push notification per task, and marks reminder_sent = true.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.75.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);

    const now = new Date();
    const in24h = new Date(now.getTime() + 24 * 60 * 60 * 1000);

    // Find tasks due in next 24h, not yet reminded, not completed/cancelled
    const { data: tasks, error: queryError } = await supabase
      .from("tasks")
      .select("id, user_id, tenant_id, title, due_date, status")
      .eq("reminder_sent", false)
      .not("status", "in", "(completed,cancelled)")
      .gte("due_date", now.toISOString())
      .lte("due_date", in24h.toISOString())
      .limit(500);

    if (queryError) throw queryError;

    const sent: string[] = [];
    const failed: { id: string; error: string }[] = [];

    for (const task of tasks || []) {
      try {
        const dueDate = new Date(task.due_date as string);
        const hoursUntil = Math.max(1, Math.round((dueDate.getTime() - now.getTime()) / (1000 * 60 * 60)));
        const timePhrase = hoursUntil <= 1 ? "in less than an hour" : `in less than ${hoursUntil} hours`;

        // A reminder belongs to the task's business. With none, there is no business to send it for;
        // leave the task unreminded rather than mark it done.
        if (!task.tenant_id) {
          failed.push({ id: task.id, error: "task has no business to send the reminder for" });
          continue;
        }
        const { error: pushError } = await supabase.functions.invoke("send-push-notification", {
          body: {
            tenant_id: task.tenant_id,
            user_id: task.user_id,
            category: "task_reminders",
            title: "Task Due Soon",
            body: `${task.title} is due ${timePhrase}.`,
            url: "/app/tasks",
            tag: `task-${task.id}`,
            data: { task_id: task.id, due_date: task.due_date },
          },
        });
        // Only a reminder that was accepted for sending marks the task reminded.
        if (pushError) throw pushError;

        // Mark as reminded
        const { error: updateError } = await supabase
          .from("tasks")
          .update({ reminder_sent: true })
          .eq("id", task.id);

        if (updateError) throw updateError;
        sent.push(task.id);
      } catch (e: any) {
        console.error(`[task-reminder] Failed for task ${task.id}:`, e);
        failed.push({ id: task.id, error: String(e?.message || e) });
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        scanned: tasks?.length || 0,
        sent: sent.length,
        failed: failed.length,
        failures: failed,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e: any) {
    console.error("[task-reminder-notifications] fatal", e);
    return new Response(
      JSON.stringify({ success: false, error: String(e?.message || e) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
