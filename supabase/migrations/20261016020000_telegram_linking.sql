create table public.telegram_links (
  user_id uuid primary key references auth.users (id) on delete cascade,
  telegram_user_id bigint not null unique check (telegram_user_id > 0),
  linked_at timestamptz not null default now()
);

create table public.telegram_link_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  token_hash text not null unique check (token_hash ~ '^[a-f0-9]{64}$'),
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.telegram_updates (
  update_id bigint primary key check (update_id >= 0),
  received_at timestamptz not null default now()
);

create index telegram_link_tokens_user_expiry_idx
  on public.telegram_link_tokens (user_id, expires_at desc);
create unique index telegram_link_tokens_one_pending_per_user_idx
  on public.telegram_link_tokens (user_id) where used_at is null;

alter table public.telegram_links enable row level security;
alter table public.telegram_link_tokens enable row level security;
alter table public.telegram_updates enable row level security;

revoke all on table public.telegram_links, public.telegram_link_tokens, public.telegram_updates
  from public, anon, authenticated;
grant all on table public.telegram_links, public.telegram_link_tokens, public.telegram_updates
  to service_role;

create function public.claim_telegram_update(p_update_id bigint)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  inserted_count integer;
begin
  if p_update_id is null or p_update_id < 0 then
    raise exception using errcode = '22023', message = 'invalid_update_id';
  end if;
  insert into public.telegram_updates (update_id)
  values (p_update_id)
  on conflict (update_id) do nothing;
  get diagnostics inserted_count = row_count;
  return inserted_count = 1;
end;
$$;

revoke all on function public.claim_telegram_update(bigint) from public, anon, authenticated;
grant execute on function public.claim_telegram_update(bigint) to service_role;

create function public.consume_telegram_link(p_token_hash text, p_telegram_user_id bigint)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  token_row public.telegram_link_tokens%rowtype;
  inserted_count integer;
begin
  if p_token_hash is null or p_token_hash !~ '^[a-f0-9]{64}$'
    or p_telegram_user_id is null or p_telegram_user_id <= 0 then
    raise exception using errcode = '22023', message = 'invalid_link_request';
  end if;

  select token.* into token_row
  from public.telegram_link_tokens as token
  where token.token_hash = p_token_hash
    and token.used_at is null
    and token.expires_at > pg_catalog.statement_timestamp()
  for update;

  if token_row.id is null or exists (
    select 1 from public.telegram_links as link where link.user_id = token_row.user_id
  ) then
    return null;
  end if;

  insert into public.telegram_links (user_id, telegram_user_id)
  values (token_row.user_id, p_telegram_user_id)
  on conflict do nothing;
  get diagnostics inserted_count = row_count;
  if inserted_count <> 1 then
    return null;
  end if;

  update public.telegram_link_tokens
  set used_at = pg_catalog.statement_timestamp()
  where id = token_row.id;
  return token_row.user_id;
end;
$$;

revoke all on function public.consume_telegram_link(text, bigint) from public, anon, authenticated;
grant execute on function public.consume_telegram_link(text, bigint) to service_role;
