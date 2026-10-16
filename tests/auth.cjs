const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const authSource = fs.readFileSync(path.join(root, 'supabase-auth.js'), 'utf8');

function loadAuth(config, sdk) {
  const window = { SMARTUSTAZ_SUPABASE_CONFIG: config, supabase: sdk };
  vm.runInNewContext(authSource, { window });
  return window.SmartAuth;
}

async function main() {
  const unconfigured = loadAuth({ url: '', publishableKey: '' }, null);
  assert.equal(unconfigured.isConfigured(), false);
  assert.equal(unconfigured.hasConfig(), false);

  const missingSdk = loadAuth({ url: 'https://example.supabase.co', publishableKey: 'sb_publishable_public' }, null);
  assert.equal(missingSdk.hasConfig(), true);
  assert.equal(missingSdk.isConfigured(), false);

  const calls = [];
  let authListener;
  const user = { id: 'user-1', email: 'teacher@example.com' };
  const client = {
    auth: {
      onAuthStateChange(callback) { authListener = callback; return { data: { subscription: { unsubscribe() {} } } }; },
      async getSession() { return { data: { session: { user } }, error: null }; },
      async signInWithPassword(credentials) { calls.push(['signIn', credentials]); return { data: { user }, error: null }; },
      async signUp(credentials) { calls.push(['signUp', credentials]); return { data: { user, session: null }, error: null }; },
      async signOut() { calls.push(['signOut']); return { error: null }; },
    },
  };
  const sdk = { createClient(...args) { calls.push(['createClient', ...args]); return client; } };
  const auth = loadAuth({ url: 'https://example.supabase.co', publishableKey: 'sb_publishable_test' }, sdk);

  assert.equal(auth.isConfigured(), true);
  assert.equal(await auth.getSession(), user);
  assert.equal((await auth.signIn('teacher@example.com', 'secret')).user, user);
  assert.equal((await auth.signUp('teacher@example.com', 'secret')).session, null);
  await auth.signOut();

  let observedUser;
  auth.onAuthStateChange((nextUser) => { observedUser = nextUser; });
  authListener('SIGNED_IN', { user });
  assert.equal(observedUser, user);
  authListener('SIGNED_OUT', null);
  assert.equal(observedUser, null);
  assert.deepEqual(calls[0][1], 'https://example.supabase.co');
  assert.equal(calls[0][3].auth.persistSession, true);
  assert.deepEqual(calls.slice(1).map((call) => call[0]), ['signIn', 'signUp', 'signOut']);

  console.log('Auth client tests passed.');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
