import { createClient } from 'npm:@supabase/supabase-js@2';

const maxBodyBytes = 16 * 1024;

function json(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

function equalSecret(expected: string, received: string): boolean {
  const left = new TextEncoder().encode(expected);
  const right = new TextEncoder().encode(received);
  if (left.length !== right.length) return false;
  let mismatch = 0;
  for (let i = 0; i < left.length; i++) mismatch |= left[i] ^ right[i];
  return mismatch === 0;
}

async function digest(value: string): Promise<string> {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function readLimitedBody(request: Request): Promise<string | null> {
  if (!request.body) return null;
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBodyBytes) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(body);
}

async function sendMessage(token: string, chatId: number, text: string): Promise<void> {
  const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    redirect: 'error',
    signal: AbortSignal.timeout(10_000),
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text: text.slice(0, 3500), disable_web_page_preview: true }),
  });
  if (!response.ok) throw new Error('telegram_send_failed');
}

Deno.serve(async (request) => {
  if (request.method !== 'POST') return json(405, { error: 'method_not_allowed' });
  const botToken = Deno.env.get('TELEGRAM_BOT_TOKEN') || '';
  const webhookSecret = Deno.env.get('TELEGRAM_WEBHOOK_SECRET') || '';
  const siteUrl = Deno.env.get('APP_URL') || '';
  const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
  if (!/^\d{5,15}:[A-Za-z0-9_-]{20,100}$/.test(botToken) || webhookSecret.length < 32 || !supabaseUrl || !serviceRoleKey) return json(503, { error: 'service_unavailable' });
  if (!equalSecret(webhookSecret, request.headers.get('x-telegram-bot-api-secret-token') || '')) {
    return json(403, { error: 'forbidden' });
  }

  let payload: unknown;
  try {
    if (Number(request.headers.get('content-length') || 0) > maxBodyBytes) return json(413, { error: 'request_too_large' });
    const raw = await readLimitedBody(request);
    if (raw === null) return json(413, { error: 'request_too_large' });
    payload = JSON.parse(raw);
  } catch {
    return json(400, { error: 'invalid_request' });
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return json(400, { error: 'invalid_request' });
  const update = payload as Record<string, unknown>;
  const message = update.message && typeof update.message === 'object' ? update.message as Record<string, unknown> : null;
  const from = message?.from && typeof message.from === 'object' ? message.from as Record<string, unknown> : null;
  const chat = message?.chat && typeof message.chat === 'object' ? message.chat as Record<string, unknown> : null;
  if (!Number.isSafeInteger(update.update_id) || (update.update_id as number) < 0 || !message || !from || !chat
    || !Number.isSafeInteger(from.id) || (from.id as number) <= 0 || from.id !== chat.id || chat.type !== 'private'
    || typeof message.text !== 'string' || message.text.length > 512) {
    return json(200, { ok: true });
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: claimed, error: claimError } = await admin.rpc('claim_telegram_update', { p_update_id: update.update_id as number });
  if (claimError) return json(503, { error: 'update_unavailable' });
  if (!claimed) return json(200, { ok: true, duplicate: true });

  const text = (message.text as string).trim();
  const command = text.split(/\s+/, 1)[0].toLowerCase().split('@')[0];
  let reply = 'Команда не распознана. Отправьте /help.';
  if (command === '/start') {
    const tokenMatch = text.match(/^\/start\s+([a-fA-F0-9]{64})$/);
    if (tokenMatch) {
      const { data: linkedUser, error } = await admin.rpc('consume_telegram_link', {
        p_token_hash: await digest(tokenMatch[1].toLowerCase()),
        p_telegram_user_id: from.id,
      });
      reply = error ? 'Не удалось связать аккаунт. Создайте новую ссылку на сайте.'
        : linkedUser ? 'Telegram подключён к аккаунту SmartUstaz. Отправьте /help для списка команд.'
          : 'Ссылка недействительна, истекла или уже использована. Создайте новую на сайте.';
    } else {
      reply = 'Здравствуйте! Чтобы подключить Telegram, войдите в SmartUstaz и создайте ссылку в настройках.';
    }
  } else if (command === '/help') {
    reply = 'Команды: /status — последняя задача; /open — открыть сайт; /new — перейти к созданию на сайте.';
  } else if (command === '/open') {
    try {
      const url = new URL(siteUrl);
      if (url.protocol !== 'https:') throw new Error('invalid_url');
      reply = `Откройте SmartUstaz: ${url.toString()}`;
    } catch { reply = 'Сайт временно недоступен. Попробуйте позже.'; }
  } else if (command === '/status') {
    const { data: link, error: linkError } = await admin.from('telegram_links').select('user_id')
      .eq('telegram_user_id', from.id).maybeSingle();
    if (linkError) reply = 'Не удалось получить статус. Попробуйте позже.';
    else if (!link) reply = 'Сначала подключите аккаунт на сайте.';
    else {
      const { data: job, error: jobError } = await admin.from('generation_jobs').select('status, error_code, created_at')
        .eq('user_id', link.user_id).order('created_at', { ascending: false }).limit(1).maybeSingle();
      reply = jobError ? 'Не удалось получить статус. Попробуйте позже.'
        : job ? `Последняя задача: ${job.status}${job.error_code ? ` (${job.error_code})` : ''}.`
        : 'Задач пока нет.';
    }
  } else if (command === '/new') {
    reply = 'Создание материалов пока доступно на сайте SmartUstaz. Откройте /open; генерация из Telegram появится после подключения общего backend-сценария.';
  }

  try {
    await sendMessage(botToken, chat.id as number, reply);
  } catch {
    return json(503, { error: 'telegram_delivery_failed' });
  }
  return json(200, { ok: true });
});
