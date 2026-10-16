import { createClient } from 'npm:@supabase/supabase-js@2';

const encoder = new TextEncoder();

function json(status: number, body: Record<string, unknown>, origin?: string): Response {
  const headers = new Headers({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  if (origin) {
    headers.set('Access-Control-Allow-Origin', origin);
    headers.set('Vary', 'Origin');
    headers.set('Access-Control-Allow-Headers', 'authorization, apikey, content-type, x-client-info');
    headers.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  }
  return new Response(JSON.stringify(body), { status, headers });
}

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function sha256(value: string): Promise<string> {
  return hex(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value))));
}

Deno.serve(async (request) => {
  const allowedOrigin = Deno.env.get('APP_ALLOWED_ORIGIN') || '';
  let originIsHttps = false;
  try { const parsedOrigin = new URL(allowedOrigin); originIsHttps = parsedOrigin.protocol === 'https:' && parsedOrigin.origin === allowedOrigin; } catch { }
  const origin = request.headers.get('origin') || '';
  if (!originIsHttps || origin !== allowedOrigin) return json(403, { error: 'origin_not_allowed' });
  if (request.method === 'OPTIONS') return new Response(null, { headers: {
    'Access-Control-Allow-Origin': allowedOrigin,
    'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
  } });
  if (request.method !== 'POST') return json(405, { error: 'method_not_allowed' }, allowedOrigin);

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const botUsername = Deno.env.get('TELEGRAM_BOT_USERNAME') || '';
  if (!supabaseUrl || !anonKey || !serviceRoleKey || !/^[A-Za-z0-9_]{5,32}$/.test(botUsername)) {
    return json(503, { error: 'service_unavailable' }, allowedOrigin);
  }

  const match = (request.headers.get('authorization') || '').match(/^Bearer\s+([^\s]+)$/i);
  if (!match) return json(401, { error: 'unauthorized' }, allowedOrigin);
  const auth = createClient(supabaseUrl, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await auth.auth.getUser(match[1]);
  if (error || !data.user) return json(401, { error: 'unauthorized' }, allowedOrigin);

  const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: existingLink, error: lookupError } = await admin.from('telegram_links')
    .select('user_id').eq('user_id', data.user.id).maybeSingle();
  if (lookupError) return json(503, { error: 'link_unavailable' }, allowedOrigin);
  if (existingLink) return json(409, { error: 'already_linked' }, allowedOrigin);
  const { error: deleteError } = await admin.from('telegram_link_tokens')
    .delete().eq('user_id', data.user.id);
  if (deleteError) return json(503, { error: 'link_unavailable' }, allowedOrigin);

  const random = new Uint8Array(32);
  crypto.getRandomValues(random);
  const token = hex(random);
  const { error: insertError } = await admin.from('telegram_link_tokens').insert({
    user_id: data.user.id,
    token_hash: await sha256(token),
    expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
  });
  if (insertError) return json(503, { error: 'link_unavailable' }, allowedOrigin);
  return json(200, { deepLink: `https://t.me/${botUsername}?start=${token}`, expiresInSeconds: 600 }, allowedOrigin);
});
