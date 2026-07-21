import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

    if (!supabaseUrl || !serviceRoleKey) {
      throw new Error('Supabase environment variables are unavailable');
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false },
    });

    const { data, error } = await supabase
      .from('data_sources')
      .select('slug,name,category,connection_mode,status,last_success_at,last_attempt_at,last_error,freshness_minutes')
      .order('name');

    if (error) throw error;

    const now = Date.now();
    const sources = (data ?? []).map((source) => {
      const ageMinutes = source.last_success_at
        ? Math.floor((now - new Date(source.last_success_at).getTime()) / 60000)
        : null;

      const stale = ageMinutes !== null && ageMinutes > source.freshness_minutes;

      return {
        ...source,
        age_minutes: ageMinutes,
        effective_status: stale && source.status === 'healthy' ? 'warning' : source.status,
      };
    });

    return new Response(JSON.stringify({ ok: true, generated_at: new Date().toISOString(), sources }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    return new Response(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
