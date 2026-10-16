create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text check (display_name is null or char_length(display_name) <= 100),
  locale text not null default 'ru' check (locale in ('ru', 'kk')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.documents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  title text not null check (char_length(title) between 1 and 200),
  topic text check (topic is null or char_length(topic) <= 1000),
  document_type text not null check (document_type in ('plan', 'notes', 'slides', 'bundle')),
  content jsonb not null check (jsonb_typeof(content) = 'object' and octet_length(content::text) <= 1048576),
  status text not null default 'draft' check (status in ('draft', 'ready', 'partial')),
  version integer not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id)
);

create table public.templates (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  template_type text not null check (template_type in ('plan', 'notes', 'slides', 'other')),
  content jsonb not null check (jsonb_typeof(content) = 'object' and octet_length(content::text) <= 1048576),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.generation_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  document_id uuid references public.documents (id) on delete set null,
  operation_type text not null check (operation_type in ('generation', 'expansion', 'template_analysis')),
  status text not null default 'pending' check (status in ('pending', 'running', 'succeeded', 'partial', 'failed', 'cancelled')),
  idempotency_key text not null check (char_length(idempotency_key) between 1 and 128),
  error_code text check (error_code is null or char_length(error_code) <= 100),
  input_tokens integer check (input_tokens is null or input_tokens >= 0),
  output_tokens integer check (output_tokens is null or output_tokens >= 0),
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  unique (user_id, idempotency_key)
);

create index documents_user_updated_idx on public.documents (user_id, updated_at desc);
create index templates_user_updated_idx on public.templates (user_id, updated_at desc);
create index generation_jobs_user_created_idx on public.generation_jobs (user_id, created_at desc);
create index generation_jobs_status_created_idx on public.generation_jobs (status, created_at);

create function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := pg_catalog.statement_timestamp();
  if tg_table_name = 'documents' then
    new.version := old.version + 1;
  end if;
  return new;
end;
$$;

revoke all on function public.set_updated_at() from public, anon, authenticated;

create trigger profiles_set_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

create trigger documents_set_updated_at
before update on public.documents
for each row execute function public.set_updated_at();

create trigger templates_set_updated_at
before update on public.templates
for each row execute function public.set_updated_at();

alter table public.profiles enable row level security;
alter table public.documents enable row level security;
alter table public.templates enable row level security;
alter table public.generation_jobs enable row level security;

revoke all on table public.profiles, public.documents, public.templates, public.generation_jobs from public, anon, authenticated;
grant all on table public.profiles, public.documents, public.templates, public.generation_jobs to service_role;

grant select on table public.profiles to authenticated;
grant insert (id, display_name, locale) on public.profiles to authenticated;
grant update (display_name, locale) on public.profiles to authenticated;

grant select, delete on table public.documents to authenticated;
grant insert (user_id, title, topic, document_type, content, status) on public.documents to authenticated;
grant update (title, topic, document_type, content, status) on public.documents to authenticated;

grant select, delete on table public.templates to authenticated;
grant insert (user_id, name, template_type, content) on public.templates to authenticated;
grant update (name, template_type, content) on public.templates to authenticated;

grant select on table public.generation_jobs to authenticated;

create policy profiles_select_own on public.profiles
for select to authenticated
using ((select auth.uid()) = id);

create policy profiles_insert_own on public.profiles
for insert to authenticated
with check ((select auth.uid()) = id);

create policy profiles_update_own on public.profiles
for update to authenticated
using ((select auth.uid()) = id)
with check ((select auth.uid()) = id);

create policy documents_select_own on public.documents
for select to authenticated
using ((select auth.uid()) = user_id);

create policy documents_insert_own on public.documents
for insert to authenticated
with check ((select auth.uid()) = user_id);

create policy documents_update_own on public.documents
for update to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create policy documents_delete_own on public.documents
for delete to authenticated
using ((select auth.uid()) = user_id);

create policy templates_select_own on public.templates
for select to authenticated
using ((select auth.uid()) = user_id);

create policy templates_insert_own on public.templates
for insert to authenticated
with check ((select auth.uid()) = user_id);

create policy templates_update_own on public.templates
for update to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create policy templates_delete_own on public.templates
for delete to authenticated
using ((select auth.uid()) = user_id);

create policy generation_jobs_select_own on public.generation_jobs
for select to authenticated
using ((select auth.uid()) = user_id);

create function public.reserve_generation_job(
  p_user_id uuid,
  p_operation_type text,
  p_idempotency_key text
)
returns table (job_id uuid, already_reserved boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  existing_job_id uuid;
begin
  if p_user_id is null
    or p_operation_type not in ('generation', 'expansion', 'template_analysis')
    or p_idempotency_key is null
    or char_length(p_idempotency_key) not between 1 and 128 then
    raise exception using errcode = '22023', message = 'invalid_job_request';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_user_id::text, 0)
  );

  select job.id into existing_job_id
  from public.generation_jobs as job
  where job.user_id = p_user_id and job.idempotency_key = p_idempotency_key;

  if existing_job_id is not null then
    return query select existing_job_id, true;
    return;
  end if;

  if (
    select count(*) from public.generation_jobs as job
    where job.user_id = p_user_id
      and job.status in ('pending', 'running')
  ) >= 2 then
    raise exception using errcode = 'P0001', message = 'active_job_limit';
  end if;

  if (
    select count(*) from public.generation_jobs as job
    where job.user_id = p_user_id
      and job.created_at >= pg_catalog.statement_timestamp() - interval '24 hours'
  ) >= 20 then
    raise exception using errcode = 'P0001', message = 'daily_job_quota';
  end if;

  insert into public.generation_jobs (user_id, operation_type, idempotency_key)
  values (p_user_id, p_operation_type, p_idempotency_key)
  returning id into existing_job_id;

  return query select existing_job_id, false;
end;
$$;

revoke all on function public.reserve_generation_job(uuid, text, text) from public, anon, authenticated;
grant execute on function public.reserve_generation_job(uuid, text, text) to service_role;
