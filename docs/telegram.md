# Telegram setup and current limits

Telegram integration is server-only. Never put the bot token or webhook secret in `supabase-config.js`, browser storage, Git, or client logs.

## Required Supabase secrets

Set these on the Supabase project using its dashboard secret settings or the Supabase CLI:

- `TELEGRAM_BOT_TOKEN`: token from BotFather.
- `TELEGRAM_BOT_USERNAME`: public bot username without `@`.
- `TELEGRAM_WEBHOOK_SECRET`: random secret of at least 32 characters.
- `APP_URL`: HTTPS URL of the hosted SmartUstaz site.
- `APP_ALLOWED_ORIGIN`: exact browser origin, e.g. `https://ryouta-dev.github.io` (no path).
- `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY`: Supabase function runtime values; the service-role key stays server-side.

Deploy the migration, then deploy `telegram-link` and `telegram-webhook`. The link function requires a valid Supabase JWT. The webhook disables platform JWT verification and instead validates `x-telegram-bot-api-secret-token` in constant time. Configure Telegram's HTTPS webhook with the same secret value in its `secret_token` option. Never print or commit the actual Bot API URL containing the bot token.

## Implemented commands

- `/start <token>` consumes a SHA-256-hashed, 10-minute, one-time link token and binds the numeric Telegram user ID.
- `/help` lists available commands.
- `/open` returns the configured HTTPS site URL.
- `/status` reports only the latest job for the linked account.
- `/new` explicitly redirects to the website; it does not generate materials yet.

Webhook payloads are limited to 16 KiB and private chats. Telegram `update_id` is claimed in the database before processing to make repeated deliveries idempotent. The update-dedup table needs a retention/cleanup policy before a long-running production launch. A failed Telegram message delivery after an update is claimed will not automatically be retried by this handler; monitor delivery failures and resolve that before the pilot.

## Not yet validated

No bot, Supabase project, secrets, webhook, or real Telegram test are configured in this workspace. The migration and Edge Functions have not run against hosted Supabase. `/new` needs a shared server-side generation service; do not advertise it as an active generation command.
