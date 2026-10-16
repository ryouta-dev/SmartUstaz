(function (root) {
  'use strict';
  var client = null;
  var config = root.SMARTUSTAZ_SUPABASE_CONFIG || {};

  function hasConfig() {
    return !!(
      typeof config.url === 'string' &&
      /^https:\/\//i.test(config.url) &&
      typeof config.publishableKey === 'string' &&
      config.publishableKey.length > 0
    );
  }

  function isConfigured() {
    return !!(
      root.supabase &&
      typeof root.supabase.createClient === 'function' &&
      hasConfig()
    );
  }

  function getClient() {
    if (!isConfigured()) throw new Error('auth_not_configured');
    if (!client) {
      client = root.supabase.createClient(config.url, config.publishableKey, {
        auth: {
          autoRefreshToken: true,
          persistSession: true,
          detectSessionInUrl: true
        }
      });
    }
    return client;
  }

  root.SmartAuth = {
    hasConfig: hasConfig,
    isConfigured: isConfigured,
    onAuthStateChange: function (callback) {
      return getClient().auth.onAuthStateChange(function (_event, session) {
        callback(session && session.user || null);
      });
    },
    getSession: async function () {
      var result = await getClient().auth.getSession();
      if (result.error) throw result.error;
      return result.data.session && result.data.session.user || null;
    },
    getGatewayConfig: async function () {
      var result = await getClient().auth.getSession();
      if (result.error) throw result.error;
      var session = result.data.session;
      if (!session) throw new Error('auth_required');
      return {
        url: config.url.replace(/\/+$/, '') + '/functions/v1/ai-generate',
        publishableKey: config.publishableKey,
        accessToken: session.access_token
      };
    },
    signIn: async function (email, password) {
      var result = await getClient().auth.signInWithPassword({ email: email, password: password });
      if (result.error) throw result.error;
      return result.data;
    },
    signUp: async function (email, password) {
      var result = await getClient().auth.signUp({ email: email, password: password });
      if (result.error) throw result.error;
      return result.data;
    },
    signOut: async function () {
      var result = await getClient().auth.signOut();
      if (result.error) throw result.error;
    }
  };
})(window);
