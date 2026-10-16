# Deployment and acceptance checklist

Do not deploy the prototype as a public AI service until spending limits and a small test cohort are agreed. Never put Supabase `service_role`, provider API keys, Telegram bot token, or webhook secret in Git or browser configuration.

## Local checks

1. Run `npm test` for Auth, gateway transport, and cloud repository unit tests.
2. Install the declared Playwright dependency and Chromium, start the static server on port `8765`, and run `npm run test:smoke`.
3. Install the Supabase CLI, start the local stack, apply migrations with `supabase db reset`, and run `npm run test:db`.
4. Type-check/deploy Edge Functions with the current Supabase CLI; it was not available during implementation, so current Edge Function source has not been typechecked here.

## Supabase project

1. Create a dedicated test project. Set Auth site URL and redirect allow-list to the HTTPS GitHub Pages URL, including the `/SmartUstaz/` path as required by the dashboard.
2. Apply all migrations in order and run the database tests. Verify user A cannot select or alter user B's rows using two real accounts.
3. Configure the browser with the project URL and publishable key in `supabase-config.js`. The publishable key is public; use no other key there.
4. Configure server-side function secrets: `AI_GENERATION_ENABLED` (`true` only after a budget is approved), `AI_API_BASE`, `AI_API_KEY`, `AI_MODEL`, `APP_URL`, `APP_ALLOWED_ORIGIN`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_BOT_USERNAME`, and `TELEGRAM_WEBHOOK_SECRET`. The Supabase runtime supplies its own URL and keys. Copy `supabase/.env.example` to `supabase/.env`, fill it, and apply it with `supabase secrets set --env-file supabase/.env` (never commit `supabase/.env`). For River AI use `AI_API_BASE=https://api.river.ai/v1`.
5. Deploy `ai-generate`, `telegram-link`, and `telegram-webhook`. Confirm the webhook function has platform JWT verification disabled and the handler's Telegram secret check enabled.
6. Set the Telegram HTTPS webhook using Bot API `setWebhook` and its `secret_token` option. Keep the bot-token-containing request URL out of shell history, screenshots, and logs.

## Manual acceptance

Use two separate test accounts and devices/browsers. Start with disposable content and save a local JSON backup.

- Sign-up, email confirmation, sign-in, sign-out, and session restoration.
- Run a small AI request, verify no provider key appears in browser requests/storage, check quota rejection, and record latency/cost. Test cancellation and upstream errors.
- Import local templates and current/previous results only after confirmation. Repeat the action; the second pass should skip existing records. Turn off the network mid-import and retry.
- On device two, use «Загрузить из облака»: templates should appear in the library, and cloud results should download as a JSON backup. The current local result must remain unchanged.
- Connect Telegram with a fresh one-time link. Check expired/reused links, duplicate webhook update, an unlinked sender, `/help`, `/open`, and `/status`. `/new` currently redirects to the website and does not generate materials.
- On iPhone Safari and Android Chrome, check sign-in, generation, offline/reload behavior, file downloads, Word/PPTX export, Russian/Kazakh UI, and light/dark theme.

## Rollback / emergency stop

- To stop hosted AI generation immediately, set `AI_GENERATION_ENABLED` to anything other than `true` or remove the server-side `AI_API_KEY` (the Edge Function returns service unavailable when disabled). Do not restore the secret to the browser.
- To disable Telegram delivery, remove `TELEGRAM_BOT_TOKEN` or remove the Telegram webhook in BotFather/API. Keep the database rows; do not delete user data as a rollback shortcut.
- Before schema changes, export/backup the test project. No destructive down-migration is provided; local browser copies are intentionally retained.
- For a bad frontend release, revert the GitHub Pages commit and wait for the static deployment to finish.

## Current external blockers

No Supabase project, AI provider credentials/model choice, Telegram bot, spending cap, or pilot teachers are configured. Therefore hosted migrations, real provider behavior, two-device access, mobile-browser QA, Telegram delivery, cost measurement, and pilot criteria remain unverified and must not be represented as passed.
