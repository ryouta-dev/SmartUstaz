# SmartUstaz cloud data model

The first Supabase migration is based on the current browser-storage shapes inventoried in `baseline-audit.md`.

- `profiles`: account-owned display name and interface locale; the browser may read and update only its own row.
- `documents`: structured lesson results, including partial drafts and generation source data. `content` is a JSON object capped at 1 MiB. `version` increments automatically and can support optimistic concurrency in the client.
- `templates`: one normalized template profile per row, with the current `plan`, `notes`, `slides`, and `other` types.
- `generation_jobs`: server-managed operation status and idempotency metadata. Authenticated clients can read their own jobs but cannot create or update them directly.

The migration does not create `telegram_links`; that table belongs to the later Telegram stage. It also does not migrate browser data or create Auth users. Account creation, profile initialization, and local import remain separate application work.

RLS policies scope profiles, documents, templates, and jobs by `auth.uid()`. Grants are restricted separately from policies; `service_role` receives server-side table access and bypasses RLS, so it must remain outside the browser.

Database tests live in `supabase/tests/database/initial_schema_rls.test.sql` and require the Supabase local stack plus pgTAP. They have not yet been run because the Supabase CLI/local stack is not available in this workspace.
