alter table public.documents
  add column local_id text check (local_id is null or char_length(local_id) between 1 and 160);

alter table public.templates
  add column local_id text check (local_id is null or char_length(local_id) between 1 and 160);

create unique index documents_user_local_id_idx
  on public.documents (user_id, local_id) where local_id is not null;

create unique index templates_user_local_id_idx
  on public.templates (user_id, local_id) where local_id is not null;

grant insert (user_id, title, topic, document_type, content, status, local_id)
  on public.documents to authenticated;
grant update (title, topic, document_type, content, status, local_id)
  on public.documents to authenticated;

grant insert (user_id, name, template_type, content, local_id)
  on public.templates to authenticated;
grant update (name, template_type, content, local_id)
  on public.templates to authenticated;
