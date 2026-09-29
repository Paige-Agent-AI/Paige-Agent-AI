import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.75.0";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface ScheduleRequest {
  userId: string;
  taskType: 'sms_reminder' | 'funding_report' | 'credit_monitoring' | 'reminder';
  frequency: 'daily' | 'weekly' | 'monthly' | 'one_time';
  parameters: Record<string, any>;
  scheduleTime?: string; // ISO timestamp for when to execute
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { userId, taskType, frequency, parameters, scheduleTime }: ScheduleRequest = await req.json();

    if (!userId || !taskType) {
      throw new Error('Missing userId or taskType');
    }

    const authHeader = req.headers.get('Authorization') ?? '';
    const bearer = authHeader.replace(/^Bearer\s+/i, '').trim();
    if (!bearer) throw new Error('Unauthorized');
    if (bearer !== supabaseServiceKey) {
      const authed = createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY')!, {
        global: { headers: { Authorization: authHeader } },
      });
      const { data: { user }, error } = await authed.auth.getUser();
      if (error || !user) throw new Error('Unauthorized');
      if (user.id !== userId) throw new Error('Forbidden');
    }

    console.log(`Scheduling ${taskType} for user ${userId} with frequency ${frequency}`);

    // Get user's notification preferences
    const { data: preferences } = await supabase
      .from('notification_preferences')
      .select('*')
      .eq('user_id', userId)
      .eq('alert_type', taskType)
      .maybeSingle();

    // If user has disabled this notification type, don't schedule
    if (preferences && !preferences.enabled) {
      return new Response(
        JSON.stringify({
          success: false,
          message: 'User has disabled this notification type',
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        }
      );
    }

    // Execute the task based on type
    let result;
    switch (taskType) {
      case 'sms_reminder':
        result = await executeSMSReminder(supabaseUrl, supabaseServiceKey, userId, parameters);
        break;

      case 'funding_report':
        result = await executeFundingReport(supabaseUrl, userId, parameters);
        break;

      case 'credit_monitoring':
        result = await executeCreditMonitoring(supabaseUrl, userId);
        break;

      case 'reminder':
        result = await executeGenericReminder(supabase, userId, parameters);
        break;

      default:
        throw new Error(`Unknown task type: ${taskType}`);
    }

    // Log the scheduled execution
    await supabase.from('plaid_notifications').insert({
      user_id: userId,
      channel: getChannelForTaskType(taskType),
      template: taskType,
      metadata: {
        frequency,
        scheduled_at: scheduleTime || new Date().toISOString(),
        parameters,
        result,
      },
    });

    console.log(`Task ${taskType} executed successfully for user ${userId}`);

    return new Response(
      JSON.stringify({
        success: true,
        taskType,
        frequency,
        result,
        message: `${taskType} scheduled successfully`,
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      }
    );

  } catch (error: any) {
    console.error('Error in schedule-automated-tasks:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      }
    );
  }
});

async function executeSMSReminder(supabaseUrl: string, serviceKey: string, userId: string, params: any) {
  const response = await fetch(`${supabaseUrl}/functions/v1/send-sms-reminder`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${serviceKey}` },
    body: JSON.stringify({
      to: params.phoneNumber,
      message: params.message || 'This is your scheduled reminder from Paige AI.',
      userId,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`SMS send failed: ${error}`);
  }

  return await response.json();
}

async function executeFundingReport(supabaseUrl: string, userId: string, params: any) {
  const response = await fetch(`${supabaseUrl}/functions/v1/send-funding-report`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      userId,
      includeBusinessCredit: params.includeBusinessCredit ?? true,
      includePersonalCredit: params.includePersonalCredit ?? true,
      includeFundingOffers: params.includeFundingOffers ?? true,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Funding report failed: ${error}`);
  }

  return await response.json();
}

async function executeCreditMonitoring(supabaseUrl: string, userId: string) {
  // Call the business credit sync function
  const response = await fetch(`${supabaseUrl}/functions/v1/sync-business-credit-bureaus`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Credit monitoring failed: ${error}`);
  }

  return await response.json();
}

async function executeGenericReminder(supabase: any, userId: string, params: any) {
  // Create a notification for the user
  const { data, error } = await supabase.from('notifications').insert({
    user_id: userId,
    type: 'reminder',
    title: params.title || 'Reminder',
    message: params.message || 'This is your scheduled reminder.',
    metadata: {
      scheduled: true,
      parameters: params,
    },
  }).select().single();

  if (error) throw error;

  return {
    notificationId: data.id,
    message: 'Reminder notification created',
  };
}

function getChannelForTaskType(taskType: string): string {
  switch (taskType) {
    case 'sms_reminder':
      return 'sms';
    case 'funding_report':
      return 'email';
    case 'credit_monitoring':
      return 'system';
    case 'reminder':
      return 'app';
    default:
      return 'system';
  }
}
