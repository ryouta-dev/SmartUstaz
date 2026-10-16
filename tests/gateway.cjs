const assert = require('node:assert/strict');
const SmartApi = require('../api-client.js');

async function main() {
  let captured;
  const text = await SmartApi.request({
    gateway: {
      url: 'https://project.supabase.co/functions/v1/ai-generate',
      publishableKey: 'sb_publishable_public',
      accessToken: 'user-access-token',
    },
  }, 'A test prompt', {
    operationType: 'expansion',
    idempotencyKey: 'unique-request-id-1234',
    maxTokens: 6500,
    fetch: async (url, options) => {
      captured = { url, options, body: JSON.parse(options.body) };
      return new Response(JSON.stringify({
        choices: [{ message: { content: 'Gateway response' }, finish_reason: 'stop' }],
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    },
  });

  assert.equal(text, 'Gateway response');
  assert.equal(captured.url, 'https://project.supabase.co/functions/v1/ai-generate');
  assert.equal(captured.options.headers.Authorization, 'Bearer user-access-token');
  assert.equal(captured.options.headers.apikey, 'sb_publishable_public');
  assert.deepEqual(captured.body, {
    operationType: 'expansion',
    idempotencyKey: 'unique-request-id-1234',
    prompt: 'A test prompt',
    maxOutputTokens: 6500,
  });
  assert.equal('model' in captured.body, false);
  assert.equal('key' in captured.body, false);
  assert.equal('base' in captured.body, false);

  await assert.rejects(
    SmartApi.request({ gateway: { url: 'https://project.supabase.co/functions/v1/ai-generate' } }, 'Prompt', {
      fetch: async () => { throw new Error('fetch must not run without credentials'); },
    }),
    (error) => error.code === 'not_granted',
  );

  console.log('Gateway transport tests passed.');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
