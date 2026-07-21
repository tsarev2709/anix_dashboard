import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const url = new URL(req.url);
    const code = url.searchParams.get('code');
    const referer = url.searchParams.get('referer') || url.searchParams.get('account');
    if (!code || !referer) throw new Error('amoCRM did not return code or account domain');

    const domain = referer.replace(/^https?:\/\//, '').replace(/\/$/, '');
    const clientId = Deno.env.get('AMOCRM_CLIENT_ID');
    const clientSecret = Deno.env.get('AMOCRM_CLIENT_SECRET');
    const redirectUri = Deno.env.get('AMOCRM_REDIRECT_URI');
    if (!clientId || !clientSecret || !redirectUri) throw new Error('amoCRM secrets are not configured');

    const tokenResponse = await fetch(`https://${domain}/oauth2/access_token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
      }),
    });
    const token = await tokenResponse.json();
    if (!tokenResponse.ok) throw new Error(`amoCRM token exchange failed: ${JSON.stringify(token)}`);

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );
    const expiresAt = new Date(Date.now() + Number(token.expires_in || 86400) * 1000).toISOString();
    const { error } = await supabase.from('integration_credentials').upsert({
      source_slug: 'amocrm',
      account_domain: domain,
      access_token: token.access_token,
      refresh_token: token.refresh_token,
      token_expires_at: expiresAt,
      metadata: { installed_at: new Date().toISOString() },
      updated_at: new Date().toISOString(),
    });
    if (error) throw error;

    await supabase
      .from('data_sources')
      .update({
        status: 'warning',
        last_error: null,
        metadata: { account_domain: domain, oauth_connected: true },
      })
      .eq('slug', 'amocrm');

    const html = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>amoCRM connected</title></head>
<body style="font-family:system-ui;padding:40px">
  <h1>amoCRM connected</h1>
  <p>Tokens were stored securely in Supabase. You can close this window and run synchronization.</p>
</body>
</html>`;

    return new Response(html, {
      headers: { ...cors, 'Content-Type': 'text/html; charset=utf-8' },
    });
  } catch (error) {
    return new Response(JSON.stringify({ ok: false, error: String(error) }), {
      status: 500,
      headers: { ...cors, 'Content-Type': 'application/json; charset=utf-8' },
    });
  }
});
