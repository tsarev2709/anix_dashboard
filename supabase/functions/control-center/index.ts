import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  });
}

function cleanText(value: unknown, max = 20000) {
  return String(value ?? '').trim().slice(0, max);
}

async function countSince(supabase: any, table: string, column: string, since: string, filters: Record<string, string> = {}) {
  let query = supabase.from(table).select('*', { count: 'exact', head: true }).gte(column, since);
  Object.entries(filters).forEach(([key, value]) => { query = query.eq(key, value); });
  const result = await query;
  return result.error ? { available: false, value: null } : { available: true, value: result.count ?? 0 };
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: cors });

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!supabaseUrl || !serviceRoleKey) throw new Error('Supabase environment variables are unavailable');

    const authorization = request.headers.get('Authorization') || '';
    const token = authorization.replace(/^Bearer\s+/i, '');
    if (!token) return json({ ok: false, error: 'authentication_required' }, 401);

    const supabase = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });
    const { data: userData, error: userError } = await supabase.auth.getUser(token);
    if (userError || !userData.user) return json({ ok: false, error: 'invalid_session' }, 401);

    const user = userData.user;
    const email = String(user.email || '').toLowerCase();
    const { data: profile } = await supabase
      .from('admin_profiles')
      .select('role')
      .eq('user_id', user.id)
      .maybeSingle();

    const role = profile?.role || (email === 'studio@anix-ai.pro' ? 'owner' : null);
    if (!role) return json({ ok: false, error: 'access_denied' }, 403);

    if (request.method === 'GET') {
      const since = new Date(Date.now() - 30 * 86400000).toISOString();
      const [contentResult, sourcesResult, flagsResult, leads, chats, qualified, fallbacks] = await Promise.all([
        supabase.from('content_entries').select('id,slug,content_type,title,body,status,source_repo,source_path,metadata,published_at,updated_at').order('updated_at', { ascending: false }).limit(100),
        supabase.from('data_sources').select('slug,name,category,connection_mode,status,enabled,last_success_at,last_attempt_at,last_error,freshness_minutes').order('name'),
        supabase.from('feature_flags').select('key,enabled,config,description,updated_at').order('key'),
        countSince(supabase, 'website_leads', 'created_at', since),
        countSince(supabase, 'ai_chat_sessions', 'created_at', since),
        countSince(supabase, 'ai_chat_sessions', 'created_at', since, { crm_sync_status: 'completed' }),
        countSince(supabase, 'ai_chat_messages', 'created_at', since, { delivery_status: 'fallback' }),
      ]);

      return json({
        ok: true,
        generated_at: new Date().toISOString(),
        viewer: { email, role },
        content: contentResult.data || [],
        content_error: contentResult.error?.message || null,
        sources: sourcesResult.data || [],
        sources_error: sourcesResult.error?.message || null,
        feature_flags: flagsResult.data || [],
        feature_flags_error: flagsResult.error?.message || null,
        website_metrics: { period_days: 30, leads, chats, qualified, fallbacks },
      });
    }

    if (request.method !== 'POST') return json({ ok: false, error: 'method_not_allowed' }, 405);
    const body = await request.json();
    const action = cleanText(body.action, 80);

    if (action === 'save_content') {
      if (!['owner', 'admin', 'editor'].includes(role)) return json({ ok: false, error: 'write_access_required' }, 403);
      const entry = body.entry || {};
      const slug = cleanText(entry.slug, 160).toLowerCase();
      const title = cleanText(entry.title, 300);
      const contentType = cleanText(entry.content_type, 40) || 'page';
      const status = cleanText(entry.status, 40) || 'draft';
      if (!/^[a-z0-9][a-z0-9/_-]*$/.test(slug)) return json({ ok: false, error: 'invalid_slug' }, 400);
      if (!title) return json({ ok: false, error: 'title_required' }, 400);
      if (!['page', 'case', 'article', 'faq', 'cta', 'seo', 'wiki'].includes(contentType)) return json({ ok: false, error: 'invalid_content_type' }, 400);
      if (!['draft', 'review', 'published', 'archived'].includes(status)) return json({ ok: false, error: 'invalid_status' }, 400);

      const { data: before } = await supabase.from('content_entries').select('*').eq('slug', slug).maybeSingle();
      const record = {
        slug,
        title,
        content_type: contentType,
        body: cleanText(entry.body, 100000),
        status,
        source_repo: cleanText(entry.source_repo, 160) || null,
        source_path: cleanText(entry.source_path, 500) || null,
        metadata: entry.metadata && typeof entry.metadata === 'object' ? entry.metadata : {},
        published_at: status === 'published' ? (before?.published_at || new Date().toISOString()) : before?.published_at || null,
        created_by: before?.created_by || user.id,
        updated_by: user.id,
        updated_at: new Date().toISOString(),
      };

      const { data: saved, error } = await supabase
        .from('content_entries')
        .upsert(record, { onConflict: 'slug' })
        .select('*')
        .single();
      if (error) throw error;

      const { count } = await supabase.from('content_versions').select('*', { count: 'exact', head: true }).eq('content_id', saved.id);
      await supabase.from('content_versions').insert({
        content_id: saved.id,
        version_number: Number(count || 0) + 1,
        snapshot: saved,
        created_by: user.id,
      });
      await supabase.from('admin_audit_log').insert({
        actor_id: user.id,
        actor_email: email,
        action: before ? 'content.update' : 'content.create',
        entity_type: 'content_entry',
        entity_id: saved.id,
        before_state: before || null,
        after_state: saved,
      });

      return json({ ok: true, entry: saved });
    }

    if (action === 'set_source_enabled') {
      if (!['owner', 'admin'].includes(role)) return json({ ok: false, error: 'admin_access_required' }, 403);
      const slug = cleanText(body.slug, 100);
      const enabled = Boolean(body.enabled);
      const { data: before } = await supabase.from('data_sources').select('*').eq('slug', slug).single();
      const { data: saved, error } = await supabase
        .from('data_sources')
        .update({
          enabled,
          status: enabled ? 'not_configured' : 'paused',
          disconnected_at: enabled ? null : new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('slug', slug)
        .select('*')
        .single();
      if (error) throw error;
      await supabase.from('admin_audit_log').insert({
        actor_id: user.id,
        actor_email: email,
        action: enabled ? 'integration.resume' : 'integration.pause',
        entity_type: 'data_source',
        entity_id: slug,
        before_state: before || null,
        after_state: saved,
      });
      return json({ ok: true, source: saved });
    }

    if (action === 'set_feature_flag') {
      if (!['owner', 'admin'].includes(role)) return json({ ok: false, error: 'admin_access_required' }, 403);
      const key = cleanText(body.key, 100);
      const enabled = Boolean(body.enabled);
      const { data: before } = await supabase.from('feature_flags').select('*').eq('key', key).maybeSingle();
      const { data: saved, error } = await supabase
        .from('feature_flags')
        .update({ enabled, updated_by: user.id, updated_at: new Date().toISOString() })
        .eq('key', key)
        .select('*')
        .single();
      if (error) throw error;
      await supabase.from('admin_audit_log').insert({
        actor_id: user.id,
        actor_email: email,
        action: 'feature_flag.update',
        entity_type: 'feature_flag',
        entity_id: key,
        before_state: before || null,
        after_state: saved,
      });
      return json({ ok: true, feature_flag: saved });
    }

    return json({ ok: false, error: 'unknown_action' }, 400);
  } catch (error) {
    return json({ ok: false, error: error instanceof Error ? error.message : String(error) }, 500);
  }
});
