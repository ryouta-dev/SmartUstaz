begin;

select plan(34);

insert into auth.users (id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
values
  ('10000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'smartustaz-a@example.test', '', now(), now(), now()),
  ('10000000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'smartustaz-b@example.test', '', now(), now(), now());

insert into public.profiles (id, display_name, locale)
values
  ('10000000-0000-0000-0000-000000000001', 'Teacher A', 'ru'),
  ('10000000-0000-0000-0000-000000000002', 'Teacher B', 'kk');

insert into public.documents (id, user_id, title, document_type, content)
values
  ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'Document A', 'bundle', '{"plan":{}}'),
  ('20000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000002', 'Document B', 'bundle', '{"plan":{}}');

insert into public.templates (id, user_id, name, template_type, content)
values
  ('30000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'Template A', 'plan', '{"profile":{}}'),
  ('30000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000002', 'Template B', 'plan', '{"profile":{}}');

insert into public.generation_jobs (id, user_id, operation_type, idempotency_key)
values
  ('40000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'generation', 'job-a'),
  ('40000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000002', 'generation', 'job-b');

set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', true);
select set_config('request.jwt.claims', '{"sub":"10000000-0000-0000-0000-000000000001","role":"authenticated"}', true);

select has_table('public', 'profiles');
select has_table('public', 'documents');
select has_table('public', 'templates');
select has_table('public', 'generation_jobs');
select has_table('public', 'telegram_links');
select has_table('public', 'telegram_link_tokens');
select has_table('public', 'telegram_updates');
select is((select count(*) from public.profiles), 1::bigint, 'user A sees only own profile');
select is((select count(*) from public.profiles where id = '10000000-0000-0000-0000-000000000002'), 0::bigint, 'user A cannot see user B profile');
select is((select count(*) from public.documents), 1::bigint, 'user A sees only own document');
select is((select count(*) from public.documents where id = '20000000-0000-0000-0000-000000000002'), 0::bigint, 'user A cannot see user B document');
select is((select count(*) from public.templates), 1::bigint, 'user A sees only own template');
select is((select count(*) from public.templates where id = '30000000-0000-0000-0000-000000000002'), 0::bigint, 'user A cannot see user B template');
select is((select count(*) from public.generation_jobs), 1::bigint, 'user A sees only own generation job');
select is((select count(*) from public.generation_jobs where id = '40000000-0000-0000-0000-000000000002'), 0::bigint, 'user A cannot see user B generation job');

insert into public.documents (user_id, title, document_type, content)
values ('10000000-0000-0000-0000-000000000001', 'Created by A', 'plan', '{"topic":"own"}');
select is((select count(*) from public.documents where title = 'Created by A'), 1::bigint, 'user A can create own document');
select throws_ok(
  $$insert into public.documents (user_id, title, document_type, content) values ('10000000-0000-0000-0000-000000000002', 'Cross-owner', 'plan', '{}')$$,
  '42501', null, 'user A cannot create a document for user B'
);
select is((with changed as (update public.documents set title = 'Changed by A' where id = '20000000-0000-0000-0000-000000000002' returning id) select count(*) from changed), 0::bigint, 'user A cannot update user B document');
select is((with removed as (delete from public.documents where id = '20000000-0000-0000-0000-000000000002' returning id) select count(*) from removed), 0::bigint, 'user A cannot delete user B document');
select is((with changed as (update public.documents set title = 'Updated by A' where id = '20000000-0000-0000-0000-000000000001' returning id) select count(*) from changed), 1::bigint, 'user A can update own document');
select is((select version from public.documents where id = '20000000-0000-0000-0000-000000000001'), 2, 'document version increments on update');

insert into public.templates (user_id, name, template_type, content)
values ('10000000-0000-0000-0000-000000000001', 'Created by A', 'notes', '{"profile":{}}');
select is((select count(*) from public.templates where name = 'Created by A'), 1::bigint, 'user A can create own template');
insert into public.templates (user_id, name, template_type, content, local_id)
values ('10000000-0000-0000-0000-000000000001', 'Imported once', 'plan', '{"profile":{}}', 'template:source-1');
select throws_ok(
  $$insert into public.templates (user_id, name, template_type, content, local_id) values ('10000000-0000-0000-0000-000000000001', 'Imported twice', 'plan', '{"profile":{}}', 'template:source-1')$$,
  '23505', null, 'repeat local import is rejected by per-user stable ID'
);
select throws_ok(
  $$insert into public.templates (user_id, name, template_type, content) values ('10000000-0000-0000-0000-000000000002', 'Cross-owner', 'plan', '{}')$$,
  '42501', null, 'user A cannot create a template for user B'
);
select is((with changed as (update public.templates set name = 'Changed by A' where id = '30000000-0000-0000-0000-000000000002' returning id) select count(*) from changed), 0::bigint, 'user A cannot update user B template');
select is((with removed as (delete from public.templates where id = '30000000-0000-0000-0000-000000000002' returning id) select count(*) from removed), 0::bigint, 'user A cannot delete user B template');
select is((with changed as (update public.profiles set display_name = 'Updated A' where id = '10000000-0000-0000-0000-000000000001' returning id) select count(*) from changed), 1::bigint, 'user A can update own profile');
select is((with changed as (update public.profiles set display_name = 'Hijacked' where id = '10000000-0000-0000-0000-000000000002' returning id) select count(*) from changed), 0::bigint, 'user A cannot update user B profile');
select throws_ok(
  $$insert into public.generation_jobs (user_id, operation_type, idempotency_key) values ('10000000-0000-0000-0000-000000000001', 'generation', 'client-job')$$,
  '42501', null, 'authenticated users cannot create generation jobs directly'
);
select ok(not has_table_privilege('anon', 'public.documents', 'select'), 'anonymous role has no document access');
select ok(not has_table_privilege('authenticated', 'public.generation_jobs', 'insert'), 'authenticated role cannot insert generation jobs');
select ok(not has_table_privilege('authenticated', 'public.telegram_links', 'select'), 'authenticated role cannot read Telegram link table directly');
select ok(not has_table_privilege('authenticated', 'public.telegram_link_tokens', 'select'), 'authenticated role cannot read Telegram token table');
select ok(not has_table_privilege('authenticated', 'public.telegram_updates', 'select'), 'authenticated role cannot read Telegram update table');

select * from finish();
rollback;
