# SmartUstaz cloud data model

The first Supabase migration is based on the current browser-storage shapes inventoried in `baseline-audit.md`.

- `profiles`: account-owned display name and interface locale; the browser may read and update only its own row.
- `documents`: structured lesson results, including partial drafts and generation source data. `content` is a JSON object capped at 1 MiB. `version` increments automatically and supports optimistic concurrency. `local_id` is an optional per-user stable import key with a partial unique index.
- `templates`: one normalized template profile per row, with the current `plan`, `notes`, `slides`, and `other` types. `local_id` enables safe repeat imports without updating an existing cloud row.
- `generation_jobs`: server-managed operation status and idempotency metadata. Authenticated clients can read their own jobs but cannot create or update them directly.

The Telegram migration adds private `telegram_links`, hashed short-lived `telegram_link_tokens`, and `telegram_updates` for webhook deduplication. RLS is enabled with no client policies; only server-side `service_role` functions can access these tables. Cloud CRUD is exposed through `cloud-repository.js` and remains subject to RLS. The library provides explicit confirmed import/export flows: templates can be added to another device, and cloud documents can be downloaded as a JSON backup. Browser storage is not removed; matching `local_id` rows are skipped, changed draft revisions get distinct SHA-256 IDs, and no cloud import silently replaces the current result. Hosted two-device validation remains outstanding.

RLS policies scope profiles, documents, templates, and jobs by `auth.uid()`. Grants are restricted separately from policies; `service_role` receives server-side table access and bypasses RLS, so it must remain outside the browser.

Database tests live in `supabase/tests/database/initial_schema_rls.test.sql` and require the Supabase local stack plus pgTAP. They have not yet been run because the Supabase CLI/local stack is not available in this workspace.
