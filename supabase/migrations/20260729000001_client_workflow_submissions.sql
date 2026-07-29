create table public.task_submissions (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null unique references public.tasks(id) on delete cascade,
  submitted_by uuid not null references public.profiles(id) on delete restrict,
  submitted_at timestamptz not null default now(),
  external_url text,
  note text,
  created_at timestamptz not null default now(),
  check (external_url is not null or note is not null)
);
create index task_submissions_task_idx on public.task_submissions(task_id);
alter table public.task_submissions enable row level security;
revoke all on table public.task_submissions from anon, authenticated;
grant select on table public.task_submissions to authenticated;
create policy "scoped task submission read" on public.task_submissions for select to authenticated using (
  exists (select 1 from public.tasks t where t.id = task_id and public.app_can_access_client(t.client_id))
);

create or replace function public.app_create_client_simple(
  target_name text, target_contact_name text, target_industry text, actor_user_id uuid
) returns table(id uuid, slug text) language plpgsql security definer set search_path = public as $$
declare base_slug text; candidate_slug text; suffix integer := 1; new_client_id uuid;
begin
  if nullif(trim(target_name), '') is null then raise exception 'Company name is required'; end if;
  if nullif(trim(target_contact_name), '') is null then raise exception 'Contact name is required'; end if;
  if nullif(trim(target_industry), '') is null then raise exception 'Industry is required'; end if;
  base_slug := trim(both '-' from regexp_replace(lower(trim(target_name)), '[^a-z0-9]+', '-', 'g'));
  if base_slug = '' then base_slug := 'client'; end if;
  candidate_slug := left(base_slug, 110);
  while exists (select 1 from public.clients where clients.slug = candidate_slug) loop
    suffix := suffix + 1;
    candidate_slug := left(base_slug, 110) || '-' || suffix::text;
  end loop;
  insert into public.clients(slug, name, primary_contact, industry, status)
  values(candidate_slug, trim(target_name), trim(target_contact_name), trim(target_industry), 'active')
  returning clients.id, clients.slug into id, slug;
  insert into public.activity_logs(actor_id, action, entity_type, entity_id, metadata)
  values(actor_user_id, 'CLIENT_CREATED', 'client', id::text, jsonb_build_object('client_id', id));
  return next;
end;
$$;

create or replace function public.app_submit_task_deliverable(
  target_task_id uuid, target_external_url text, target_note text, actor_user_id uuid
) returns void language plpgsql security definer set search_path = public as $$
declare task_assignee uuid; task_client uuid;
begin
  select assignee_id, client_id into task_assignee, task_client from public.tasks where id = target_task_id for update;
  if task_client is null then raise exception 'Task not found'; end if;
  if task_assignee is distinct from actor_user_id then raise exception 'Only the assigned member can submit this task'; end if;
  if nullif(trim(target_external_url), '') is null and nullif(trim(target_note), '') is null then raise exception 'Add a link or written submission'; end if;
  insert into public.task_submissions(task_id, submitted_by, external_url, note)
  values(target_task_id, actor_user_id, nullif(trim(target_external_url), ''), nullif(trim(target_note), ''))
  on conflict (task_id) do update set submitted_by = excluded.submitted_by, submitted_at = now(), external_url = excluded.external_url, note = excluded.note;
  update public.tasks set status = 'SUBMITTED', completed_at = null, updated_at = now() where id = target_task_id;
  insert into public.activity_logs(actor_id, action, entity_type, entity_id, metadata)
  values(actor_user_id, 'TASK_SUBMITTED', 'task', target_task_id::text, jsonb_build_object('client_id', task_client, 'task_id', target_task_id));
end;
$$;

revoke all on function public.app_create_client_simple(text, text, text, uuid), public.app_submit_task_deliverable(uuid, text, text, uuid) from public, anon, authenticated;
grant execute on function public.app_create_client_simple(text, text, text, uuid), public.app_submit_task_deliverable(uuid, text, text, uuid) to service_role;
