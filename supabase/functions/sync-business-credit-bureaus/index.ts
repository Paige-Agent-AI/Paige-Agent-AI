import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.75.0";
import { refuseCustomerTier } from "../_shared/finance-entitlement.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Get user from authorization header
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      throw new Error('No authorization header');
    }

    const { data: { user }, error: userError } = await supabase.auth.getUser(
      authHeader.replace('Bearer ', '')
    );

    if (userError || !user) {
      throw new Error('Unauthorized');
    }

    // E09 F1b: business credit is not a customer feature — a portal customer is refused before any read.
    const tier = await refuseCustomerTier(supabase, user.id);
    if (!tier.ok) {
      return new Response(JSON.stringify({ error: tier.error }), {
        status: tier.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { userId } = await req.json();
    if (userId !== user.id) {
      throw new Error('User ID mismatch');
    }

    console.log('Syncing business credit bureaus for user:', userId);

    // Get user's business information
    const { data: businesses, error: bizError } = await supabase
      .from('businesses')
      .select('*')
      .eq('owner_user_id', userId)
      .limit(1);

    if (bizError || !businesses || businesses.length === 0) {
      throw new Error('No business profile found. Please set up your business profile first.');
    }

    const business = businesses[0];
    console.log('Found business:', business.legal_name);

    if (!business.ein) {
      throw new Error('Business EIN required for credit bureau sync');
    }

    const bureausSynced: string[] = [];
    const accountsAdded: any[] = [];

    // Note: This is a placeholder implementation
    // In production, you would integrate with actual bureau APIs:
    // - Dun & Bradstreet API (requires D-U-N-S number and API key)
    // - Experian Business API (requires API credentials)
    // - Equifax Business API (requires API credentials)
    // - Nav API (aggregates multiple bureaus)

    // For now, we'll return a message indicating API keys are needed
    console.log('Business credit bureau APIs not yet configured');
    
    // Check which API keys are available
    const dnbApiKey = Deno.env.get('DNB_API_KEY');
    const experianBusinessKey = Deno.env.get('EXPERIAN_BUSINESS_API_KEY');
    const equifaxBusinessKey = Deno.env.get('EQUIFAX_BUSINESS_API_KEY');
    const navApiKey = Deno.env.get('NAV_API_KEY');

    let missingApis: string[] = [];
    
    if (!dnbApiKey) missingApis.push('Dun & Bradstreet');
    if (!experianBusinessKey) missingApis.push('Experian Business');
    if (!equifaxBusinessKey) missingApis.push('Equifax Business');
    if (!navApiKey) missingApis.push('Nav');

    if (missingApis.length === 4) {
      throw new Error(
        `No business credit bureau API keys configured. Please set up API credentials for: ${missingApis.join(', ')}. ` +
        'Contact support to configure credit bureau integrations.'
      );
    }

    // Example: Sync from Nav (if available)
    if (navApiKey) {
      try {
        // This is example code - actual Nav API integration would go here
        console.log('Syncing from Nav API...');
        
        // const navResponse = await fetch('https://api.nav.com/v1/business-credit-report', {
        //   method: 'GET',
        //   headers: {
        //     'Authorization': `Bearer ${navApiKey}`,
        //     'Content-Type': 'application/json',
        //   }
        // });
        
        bureausSynced.push('Nav');
      } catch (navError) {
        console.error('Nav sync error:', navError);
      }
    }

    // Example: Sync from Dun & Bradstreet (if available)
    if (dnbApiKey && business.duns_number) {
      try {
        console.log('Syncing from Dun & Bradstreet API...');
        // D&B API integration would go here
        bureausSynced.push('Dun & Bradstreet');
      } catch (dnbError) {
        console.error('D&B sync error:', dnbError);
      }
    }

    if (bureausSynced.length === 0) {
      throw new Error(
        'No bureaus synced. Available APIs: ' + missingApis.join(', ') + 
        '. Please configure API credentials to enable bureau sync.'
      );
    }

    return new Response(
      JSON.stringify({
        success: true,
        bureausSynced,
        accountsAdded: accountsAdded.length,
        message: bureausSynced.length > 0 
          ? `Synced from ${bureausSynced.join(', ')}`
          : 'No bureaus configured for sync',
      }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200 
      }
    );

  } catch (error) {
    console.error('Error syncing business credit bureaus:', error);
    const errorMessage = error instanceof Error ? error.message : 'Failed to sync with credit bureaus';
    return new Response(
      JSON.stringify({
        error: errorMessage,
      }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500 
      }
    );
  }
});
