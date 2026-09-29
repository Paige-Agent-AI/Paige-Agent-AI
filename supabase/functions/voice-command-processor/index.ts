import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.75.0";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface CommandRequest {
  userId?: string;
  functionName: string;
  parameters: Record<string, any>;
  requiresConfirmation?: boolean;
  sessionId?: string;
}

interface VapiRequest {
  message: {
    type: string;
    functionCall?: {
      name: string;
      parameters: Record<string, any>;
    };
  };
  call?: {
    customer?: {
      number?: string;
    };
  };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const body = await req.json();
    
    // Handle both direct calls and Vapi webhook calls
    let userId: string;
    let functionName: string;
    let parameters: Record<string, any>;
    let sessionId: string | undefined;

    if ('message' in body && body.message?.type === 'function-call') {
      // Vapi webhook format
      const vapiReq = body as VapiRequest;
      const funcCall = vapiReq.message.functionCall;
      
      if (!funcCall) {
        throw new Error('Missing function call in Vapi request');
      }

      functionName = funcCall.name;
      parameters = funcCall.parameters;
      sessionId = body.call?.id;

      // Extract userId from session context
      const { data: session } = await supabase
        .from('conversation_context')
        .select('user_id')
        .eq('session_id', sessionId)
        .single();

      if (!session?.user_id) {
        throw new Error('Session not found');
      }

      userId = session.user_id;
    } else {
      // Direct call format
      const cmdReq = body as CommandRequest;
      userId = cmdReq.userId!;
      functionName = cmdReq.functionName;
      parameters = cmdReq.parameters;
      sessionId = cmdReq.sessionId;

      if (!userId || !functionName) {
        throw new Error('Missing userId or functionName');
      }
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

    console.log(`Processing command: ${functionName} for user ${userId}`);
    console.log('Parameters:', parameters);

    // Log the command
    const commandLogId = crypto.randomUUID();
    await supabase.from('voice_command_logs').insert({
      id: commandLogId,
      user_id: userId,
      session_id: sessionId || null,
      command_type: functionName,
      parameters: parameters,
      status: 'processing',
    });

    let result: any;
    let success = true;
    let errorMessage = null;

    try {
      // Route to appropriate function based on functionName
      switch (functionName) {
        case 'create_dispute':
          result = await handleCreateDispute(supabase, userId, parameters);
          break;

        case 'send_sms_reminder':
          result = await handleSendSMS(supabaseUrl, supabaseServiceKey, userId, parameters);
          break;

        case 'send_funding_report':
          result = await handleSendFundingReport(supabaseUrl, userId, parameters);
          break;

        case 'enroll_in_course':
          result = await handleEnrollCourse(supabaseUrl, userId, parameters);
          break;

        case 'mark_lesson_complete':
          result = await handleLessonProgress(supabaseUrl, userId, parameters);
          break;

        case 'create_task':
          result = await handleCreateTask(supabase, userId, parameters);
          break;

        case 'schedule_reminder':
          result = await handleScheduleReminder(supabaseUrl, userId, parameters);
          break;

        case 'get_credit_score':
          result = await handleGetCreditScore(supabase, userId);
          break;

        case 'get_build_score':
          result = await handleGetBuildScore(supabase, userId);
          break;

        case 'list_businesses':
          result = await handleListBusinesses(supabase, userId);
          break;

        case 'add_business':
          result = await handleAddBusiness(supabase, userId, parameters);
          break;

        default:
          throw new Error(`Unknown command: ${functionName}`);
      }

      console.log('Command executed successfully:', result);

    } catch (error: any) {
      success = false;
      errorMessage = error.message;
      console.error('Command execution failed:', error);
    }

    // Update command log
    await supabase.from('voice_command_logs').update({
      status: success ? 'completed' : 'failed',
      result: success ? result : null,
      error_message: errorMessage,
      executed_at: new Date().toISOString(),
    }).eq('id', commandLogId);

    return new Response(
      JSON.stringify({
        success,
        result: success ? result : null,
        error: errorMessage,
        commandId: commandLogId,
      }),
      {
        status: success ? 200 : 500,
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      }
    );

  } catch (error: any) {
    console.error('Error in voice-command-processor:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      }
    );
  }
});

// Handler functions
// [§194] handleCreateDispute stubbed — Paige is monitoring-only.
async function handleCreateDispute(_supabase: any, _userId: string, _params: any) {
  throw new Error("Dispute creation removed under §194. Paige provides credit monitoring only.");
}

async function handleSendSMS(supabaseUrl: string, serviceKey: string, userId: string, params: any) {
  const response = await fetch(`${supabaseUrl}/functions/v1/send-sms-reminder`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${serviceKey}` },
    body: JSON.stringify({
      to: params.phoneNumber,
      message: params.message,
      userId,
    }),
  });

  if (!response.ok) throw new Error('Failed to send SMS');
  return await response.json();
}

async function handleSendFundingReport(supabaseUrl: string, userId: string, params: any) {
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

  if (!response.ok) throw new Error('Failed to send funding report');
  return await response.json();
}

async function handleEnrollCourse(supabaseUrl: string, userId: string, params: any) {
  const response = await fetch(`${supabaseUrl}/functions/v1/enroll-user-in-course`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      userId,
      courseId: params.courseId,
    }),
  });

  if (!response.ok) throw new Error('Failed to enroll in course');
  return await response.json();
}

async function handleLessonProgress(supabaseUrl: string, userId: string, params: any) {
  const response = await fetch(`${supabaseUrl}/functions/v1/track-lesson-progress`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      userId,
      lessonId: params.lessonId,
      completed: params.completed ?? true,
    }),
  });

  if (!response.ok) throw new Error('Failed to update lesson progress');
  return await response.json();
}

async function handleCreateTask(supabase: any, userId: string, params: any) {
  const currentTime = new Date().toISOString();
  const { data, error } = await supabase.from('tasks').insert({
    user_id: userId,
    title: params.title,
    description: params.description,
    priority: params.priority || 'medium',
    category: params.category,
    due_date: params.dueDate,
    status: 'pending',
  }).select().single();

  if (error) throw error;
  return { 
    taskId: data.id, 
    message: `Task "${params.title}" created successfully at ${new Date(currentTime).toLocaleString('en-US', { 
      weekday: 'short', 
      year: 'numeric', 
      month: 'short', 
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    })}`,
    timestamp: currentTime
  };
}

async function handleScheduleReminder(supabaseUrl: string, userId: string, params: any) {
  const response = await fetch(`${supabaseUrl}/functions/v1/schedule-automated-tasks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      userId,
      taskType: 'reminder',
      frequency: params.frequency,
      parameters: params,
    }),
  });

  if (!response.ok) throw new Error('Failed to schedule reminder');
  return await response.json();
}

async function handleGetCreditScore(supabase: any, userId: string) {
  const { data, error } = await supabase
    .from('credit_accounts')
    .select('*')
    .eq('user_id', userId);

  if (error) throw error;

  const totalAccounts = data.length;
  const avgUtilization = data.reduce((sum: number, acc: any) => sum + (acc.utilization || 0), 0) / totalAccounts || 0;

  return {
    totalAccounts,
    averageUtilization: avgUtilization.toFixed(1),
    message: `You have ${totalAccounts} credit accounts with an average utilization of ${avgUtilization.toFixed(1)}%`,
  };
}

async function handleGetBuildScore(supabase: any, userId: string) {
  const { data, error } = await supabase
    .from('build_scores')
    .select('*')
    .eq('user_id', userId)
    .single();

  if (error) throw error;

  return {
    buildScore: data.build_score,
    currentTier: data.current_tier,
    complianceScore: data.compliance_score,
    fundingReadiness: data.funding_readiness_score,
    message: `Your BUILD Score is ${data.build_score} (Tier ${data.current_tier})`,
  };
}

async function handleListBusinesses(supabase: any, userId: string) {
  const { data, error } = await supabase
    .from('businesses')
    .select('*')
    .eq('owner_user_id', userId)
    .order('created_at', { ascending: false });

  if (error) throw error;

  return {
    businesses: data.map((b: any) => ({
      id: b.id,
      name: b.legal_name,
      type: b.entity_type,
      ein: b.ein,
    })),
    count: data.length,
    message: `You have ${data.length} business${data.length !== 1 ? 'es' : ''}`,
  };
}

async function handleAddBusiness(supabase: any, userId: string, params: any) {
  const currentTime = new Date().toISOString();
  const { data, error } = await supabase.from('businesses').insert({
    owner_user_id: userId,
    legal_name: params.legalName,
    entity_type: params.entityType,
    state_of_formation: params.state,
    business_type: 'standalone',
  }).select().single();

  if (error) throw error;
  return { 
    businessId: data.id, 
    message: `Business "${params.legalName}" added successfully at ${new Date(currentTime).toLocaleString('en-US', { 
      weekday: 'short', 
      month: 'short', 
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    })}`,
    timestamp: currentTime
  };
}
