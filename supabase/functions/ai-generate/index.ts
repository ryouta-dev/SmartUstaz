import { createClient } from 'npm:@supabase/supabase-js@2';

function configuredOrigin(): string {
  const value = Deno.env.get('APP_ALLOWED_ORIGIN') || '';
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.origin === value ? value : '';
  } catch {
    return '';
  }
}

const allowedOrigin = configuredOrigin();
const corsHeaders = {
  'Access-Control-Allow-Origin': allowedOrigin || 'null',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Expose-Headers': 'X-Generation-Job-Id',
  'Cache-Control': 'no-store',
  'Vary': 'Origin',
};

const maxRequestBytes = 64 * 1024;
const maxPromptChars = 40_000;
const maxResponseBytes = 1_000_000;
const maxOutputTokens = 8_192;

function json(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json; charset=utf-8' },
  });
}

function safeError(status: number, code: string): Response {
  return json(status, { error: { code } });
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
    if (total > maxRequestBytes) {
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

Deno.serve(async (request) => {
  if (!allowedOrigin || request.headers.get('origin') !== allowedOrigin) {
    return safeError(403, 'origin_not_allowed');
  }
  if (request.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (request.method !== 'POST') return safeError(405, 'method_not_allowed');
  if (Number(request.headers.get('content-length') || 0) > maxRequestBytes) {
    return safeError(413, 'request_too_large');
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const providerBase = Deno.env.get('AI_API_BASE');
  const providerKey = Deno.env.get('AI_API_KEY');
  const providerModel = Deno.env.get('AI_MODEL');

  if (Deno.env.get('AI_GENERATION_ENABLED') !== 'true'
    || !supabaseUrl || !anonKey || !serviceRoleKey || !providerBase || !providerKey || !providerModel) {
    return safeError(503, 'service_unavailable');
  }

  let providerUrl: URL;
  try {
    providerUrl = new URL(providerBase);
  } catch {
    return safeError(503, 'service_unavailable');
  }
  if (providerUrl.protocol !== 'https:' || providerUrl.username || providerUrl.password) {
    return safeError(503, 'service_unavailable');
  }

  const authorization = request.headers.get('authorization') || '';
  const tokenMatch = authorization.match(/^Bearer\s+([^\s]+)$/i);
  if (!tokenMatch) return safeError(401, 'unauthorized');

  const authClient = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: authData, error: authError } = await authClient.auth.getUser(tokenMatch[1]);
  if (authError || !authData.user) return safeError(401, 'unauthorized');

  let payload: unknown;
  try {
    const raw = await readLimitedBody(request);
    if (raw === null) return safeError(413, 'request_too_large');
    payload = JSON.parse(raw);
  } catch {
    return safeError(400, 'invalid_request');
  }

  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return safeError(400, 'invalid_request');
  }
  const input = payload as Record<string, unknown>;
  if (
    typeof input.prompt !== 'string' ||
    input.prompt.trim().length === 0 ||
    input.prompt.length > maxPromptChars ||
    !['generation', 'expansion', 'template_analysis'].includes(String(input.operationType)) ||
    typeof input.idempotencyKey !== 'string' ||
    !/^[a-zA-Z0-9_-]{16,128}$/.test(input.idempotencyKey) ||
    (input.maxOutputTokens !== undefined &&
      (!Number.isInteger(input.maxOutputTokens) || input.maxOutputTokens < 1 || input.maxOutputTokens > maxOutputTokens))
  ) {
    return safeError(400, 'invalid_request');
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: reservation, error: reserveError } = await admin.rpc('reserve_generation_job', {
    p_user_id: authData.user.id,
    p_operation_type: input.operationType,
    p_idempotency_key: input.idempotencyKey,
  }).maybeSingle();

  if (reserveError) {
    const code = reserveError.message.includes('active_job_limit')
      ? 'active_job_limit'
      : reserveError.message.includes('daily_job_quota')
        ? 'daily_job_quota'
        : 'job_unavailable';
    const status = code === 'active_job_limit' || code === 'daily_job_quota' ? 429 : 503;
    return safeError(status, code);
  }
  if (!reservation?.job_id || reservation.already_reserved) return safeError(409, 'duplicate_request');

  const jobId = reservation.job_id as string;
  const updateJob = async (values: Record<string, unknown>) => {
    const { error } = await admin.from('generation_jobs').update(values).eq('id', jobId).eq('user_id', authData.user.id);
    return error;
  };

  const startError = await updateJob({ status: 'running', started_at: new Date().toISOString() });
  if (startError) {
    await updateJob({ status: 'failed', error_code: 'job_unavailable', finished_at: new Date().toISOString() });
    return safeError(503, 'job_unavailable');
  }

  let upstream: Response;
  try {
    const endpoint = new URL('chat/completions', providerUrl.toString().replace(/\/$/, '') + '/');
    upstream = await fetch(endpoint, {
      method: 'POST',
      redirect: 'error',
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(140_000)]),
      headers: {
        Authorization: `Bearer ${providerKey}`,
        'Content-Type': 'application/json',
        Accept: 'text/event-stream, application/json',
      },
      body: JSON.stringify({
        model: providerModel,
        stream: true,
        max_tokens: input.maxOutputTokens || maxOutputTokens,
        messages: [{ role: 'user', content: input.prompt }],
      }),
    });
  } catch {
    await updateJob({ status: 'failed', error_code: 'upstream_unavailable', finished_at: new Date().toISOString() });
    return safeError(502, 'upstream_unavailable');
  }

  if (!upstream.ok || !upstream.body) {
    const status = upstream.status === 429 ? 429 : upstream.status === 413 ? 413 : 502;
    const errorCode = status === 429 ? 'upstream_rate_limited' : status === 413 ? 'prompt_too_large' : 'upstream_error';
    await updateJob({ status: 'failed', error_code: errorCode, finished_at: new Date().toISOString() });
    try { await upstream.body?.cancel(); } catch {}
    return safeError(status, errorCode);
  }

  const contentType = (upstream.headers.get('content-type') || '').toLowerCase();
  if (!contentType.includes('text/event-stream') && !contentType.includes('application/json')) {
    await updateJob({ status: 'failed', error_code: 'upstream_invalid_response', finished_at: new Date().toISOString() });
    await upstream.body.cancel();
    return safeError(502, 'upstream_invalid_response');
  }

  let responseBytes = 0;
  const upstreamReader = upstream.body.getReader();
  let finalized = false;
  const finishJob = async (status: string, errorCode?: string) => {
    if (finalized) return;
    finalized = true;
    await updateJob({
      status,
      error_code: errorCode || null,
      finished_at: new Date().toISOString(),
    });
  };
  const limitedStream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { done, value } = await upstreamReader.read();
        if (done) {
          await finishJob('succeeded');
          controller.close();
          return;
        }
        responseBytes += value.byteLength;
        if (responseBytes > maxResponseBytes) {
          await finishJob('failed', 'response_too_large');
          await upstreamReader.cancel();
          controller.error(new Error('response_too_large'));
          return;
        }
        controller.enqueue(value);
      } catch {
        await finishJob('failed', 'upstream_stream_error');
        controller.error(new Error('upstream_stream_error'));
      }
    },
    async cancel() {
      await upstreamReader.cancel();
      await finishJob('cancelled', 'client_cancelled');
    },
  });

  return new Response(limitedStream, {
    status: 200,
    headers: {
      ...corsHeaders,
      'Content-Type': contentType.includes('text/event-stream')
        ? 'text/event-stream; charset=utf-8'
        : 'application/json; charset=utf-8',
      'X-Generation-Job-Id': jobId,
      'X-Accel-Buffering': 'no',
    },
  });
});
