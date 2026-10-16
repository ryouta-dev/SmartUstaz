# Supabase Auth prototype

The Settings tab now contains email/password sign-up, sign-in, session status, and sign-out. The client uses the Supabase JavaScript SDK pinned to `2.117.3` and stores/refreshes its own Auth session in browser storage. This session is not an AI-provider secret.

## Local project configuration

Edit `supabase-config.js` with the Supabase project's HTTPS URL and its publishable key. The publishable key is intended for browser use; never put a `service_role` or secret API key there. The checked-in config is blank by design. Configure the project's Auth email confirmation and allowed redirect/site URLs before testing registration.

No Supabase project credentials are currently configured in this workspace. The Auth UI remains disabled until configuration is present. With configuration present, generation uses the authenticated `ai-generate` gateway and never falls back to a browser-supplied provider key. With blank configuration, legacy direct-to-provider mode remains for baseline compatibility. Profiles/documents are not synced, and local data is not moved or deleted. Do not treat this as a completed cloud migration.

The browser SDK follows Supabase's documented `createClient` configuration and email/password Auth methods: [initializing the JavaScript client](https://supabase.com/docs/reference/javascript/initializing), [installing the JavaScript SDK](https://supabase.com/docs/reference/javascript/installing), and [signing up](https://supabase.com/docs/reference/javascript/auth-signup).
