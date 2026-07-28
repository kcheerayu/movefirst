-- Additive operational data model. Existing client, identity, and invitation data is preserved.
alter table public.clients
  add column if not exists primary_contact text,
  add column if not exists contact_email text,
  add column if not exists contact_phone text;

alter table public.client_members
  add column if not exists assignment_role text not null default 'contributor'
    check (assignment_role in ('lead', 'contributor', 'viewer')),
  add column if not exists created_at timestamptz not null default now();

create type public.project_status as enum ('planned', 'active', 'on_hold', 'complete', 'archived');
create type public.task_status as enum ('TODO', 'IN_PROGRESS', 'BLOCKED', 'DONE');
create type public.task_priority as enum ('LOW', 'MEDIUM', 'HIGH', 'URGENT');

create table public.projects (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete restrict,
  name text not null check (char_length(name) between 2 and 160),
  description text,
  status public.project_status not null default 'planned',
  start_date date,
  due_date date,
  owner_id uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (due_date is null or start_date is null or due_date >= start_date)
);
create index projects_client_status_idx on public.projects(client_id, status);
create index projects_due_date_idx on public.projects(due_date) where due_date is not null;

create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(title) between 2 and 240),
  description text,
  client_id uuid not null references public.clients(id) on delete restrict,
  project_id uuid references public.projects(id) on delete set null,
  assignee_id uuid references public.profiles(id) on delete set null,
  creator_id uuid not null references public.profiles(id) on delete restrict,
  priority public.task_priority not null default 'MEDIUM',
  status public.task_status not null default 'TODO',
  due_date date,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index tasks_client_status_idx on public.tasks(client_id, status);
create index tasks_assignee_status_idx on public.tasks(assignee_id, status);
create index tasks_due_date_idx on public.tasks(due_date) where due_date is not null;
create index tasks_project_idx on public.tasks(project_id);

create table public.client_notes (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete restrict,
  body text not null check (char_length(body) between 1 and 8000),
  author_id uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index client_notes_client_created_idx on public.client_notes(client_id, created_at desc);

drop trigger if exists projects_touch_updated_at on public.projects;
create trigger projects_touch_updated_at before update on public.projects for each row execute procedure public.app_touch_updated_at();
drop trigger if exists tasks_touch_updated_at on public.tasks;
create trigger tasks_touch_updated_at before update on public.tasks for each row execute procedure public.app_touch_updated_at();
drop trigger if exists client_notes_touch_updated_at on public.client_notes;
create trigger client_notes_touch_updated_at before update on public.client_notes for each row execute procedure public.app_touch_updated_at();

alter table public.projects enable row level security;
alter table public.tasks enable row level security;
alter table public.client_notes enable row level security;
revoke all on table public.projects, public.tasks, public.client_notes from anon, authenticated;
grant select on table public.projects, public.tasks, public.client_notes to authenticated;
create policy "scoped project read" on public.projects for select to authenticated using (public.app_can_access_client(client_id));
create policy "scoped task read" on public.tasks for select to authenticated using (public.app_can_access_client(client_id));
create policy "scoped client note read" on public.client_notes for select to authenticated using (public.app_can_access_client(client_id));

create or replace function public.app_create_project(
  target_client_id uuid, target_name text, target_description text, target_status public.project_status,
  target_start_date date, target_due_date date, target_owner_id uuid, actor_user_id uuid
) returns uuid language plpgsql security definer set search_path = public as $$
declare new_project_id uuid;
begin
  if not exists (select 1 from public.clients where id = target_client_id and status = 'active' and archived_at is null) then raise exception 'Active client not found'; end if;
  if target_owner_id is not null and not exists (select 1 from public.profiles where id = target_owner_id and status = 'active') then raise exception 'Project owner is not active'; end if;
  insert into public.projects(client_id, name, description, status, start_date, due_date, owner_id)
  values(target_client_id, target_name, nullif(target_description, ''), target_status, target_start_date, target_due_date, target_owner_id)
  returning id into new_project_id;
  insert into public.activity_logs(actor_id, action, entity_type, entity_id, metadata)
  values(actor_user_id, 'PROJECT_CREATED', 'project', new_project_id::text, jsonb_build_object('client_id', target_client_id, 'project_id', new_project_id));
  return new_project_id;
end;
$$;

create or replace function public.app_update_project(
  target_project_id uuid, target_name text, target_description text, target_status public.project_status,
  target_start_date date, target_due_date date, target_owner_id uuid, actor_user_id uuid
) returns void language plpgsql security definer set search_path = public as $$
declare project_client_id uuid; old_status public.project_status;
begin
  select client_id, status into project_client_id, old_status from public.projects where id = target_project_id for update;
  if project_client_id is null then raise exception 'Project not found'; end if;
  if target_owner_id is not null and not exists (select 1 from public.profiles where id = target_owner_id and status = 'active') then raise exception 'Project owner is not active'; end if;
  update public.projects set name = target_name, description = nullif(target_description, ''), status = target_status, start_date = target_start_date, due_date = target_due_date, owner_id = target_owner_id where id = target_project_id;
  insert into public.activity_logs(actor_id, action, entity_type, entity_id, metadata)
  values(actor_user_id, case when old_status is distinct from target_status then 'PROJECT_STATUS_CHANGED' else 'PROJECT_UPDATED' end, 'project', target_project_id::text, jsonb_build_object('client_id', project_client_id, 'project_id', target_project_id, 'status', target_status));
end;
$$;

create or replace function public.app_create_task(
  target_title text, target_description text, target_client_id uuid, target_project_id uuid, target_assignee_id uuid,
  target_priority public.task_priority, target_status public.task_status, target_due_date date, actor_user_id uuid
) returns uuid language plpgsql security definer set search_path = public as $$
declare new_task_id uuid;
begin
  if not exists (select 1 from public.clients where id = target_client_id and status = 'active' and archived_at is null) then raise exception 'Active client not found'; end if;
  if target_project_id is not null and not exists (select 1 from public.projects where id = target_project_id and client_id = target_client_id) then raise exception 'Project does not belong to this client'; end if;
  if target_assignee_id is not null and not exists (select 1 from public.profiles where id = target_assignee_id and status = 'active') then raise exception 'Assignee is not active'; end if;
  insert into public.tasks(title, description, client_id, project_id, assignee_id, creator_id, priority, status, due_date, completed_at)
  values(target_title, nullif(target_description, ''), target_client_id, target_project_id, target_assignee_id, actor_user_id, target_priority, target_status, target_due_date, case when target_status = 'DONE' then now() else null end)
  returning id into new_task_id;
  insert into public.activity_logs(actor_id, action, entity_type, entity_id, metadata)
  values(actor_user_id, 'TASK_CREATED', 'task', new_task_id::text, jsonb_build_object('client_id', target_client_id, 'task_id', new_task_id, 'project_id', target_project_id));
  return new_task_id;
end;
$$;

create or replace function public.app_update_task(
  target_task_id uuid, target_title text, target_description text, target_client_id uuid, target_project_id uuid, target_assignee_id uuid,
  target_priority public.task_priority, target_status public.task_status, target_due_date date, actor_user_id uuid
) returns void language plpgsql security definer set search_path = public as $$
declare old_assignee_id uuid; old_status public.task_status;
begin
  select assignee_id, status into old_assignee_id, old_status from public.tasks where id = target_task_id for update;
  if not found then raise exception 'Task not found'; end if;
  if not exists (select 1 from public.clients where id = target_client_id and status = 'active' and archived_at is null) then raise exception 'Active client not found'; end if;
  if target_project_id is not null and not exists (select 1 from public.projects where id = target_project_id and client_id = target_client_id) then raise exception 'Project does not belong to this client'; end if;
  if target_assignee_id is not null and not exists (select 1 from public.profiles where id = target_assignee_id and status = 'active') then raise exception 'Assignee is not active'; end if;
  update public.tasks set title = target_title, description = nullif(target_description, ''), client_id = target_client_id, project_id = target_project_id, assignee_id = target_assignee_id, priority = target_priority, status = target_status, due_date = target_due_date, completed_at = case when target_status = 'DONE' then coalesce(completed_at, now()) else null end where id = target_task_id;
  insert into public.activity_logs(actor_id, action, entity_type, entity_id, metadata)
  values(actor_user_id,
    case when old_assignee_id is distinct from target_assignee_id then 'TASK_REASSIGNED' when old_status is distinct from target_status and target_status = 'DONE' then 'TASK_COMPLETED' when old_status is distinct from target_status then 'TASK_STATUS_CHANGED' else 'TASK_UPDATED' end,
    'task', target_task_id::text, jsonb_build_object('client_id', target_client_id, 'task_id', target_task_id, 'project_id', target_project_id, 'status', target_status));
end;
$$;

create or replace function public.app_create_client_note(target_client_id uuid, target_body text, actor_user_id uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare new_note_id uuid;
begin
  if not exists (select 1 from public.clients where id = target_client_id) then raise exception 'Client not found'; end if;
  insert into public.client_notes(client_id, body, author_id) values(target_client_id, target_body, actor_user_id) returning id into new_note_id;
  insert into public.activity_logs(actor_id, action, entity_type, entity_id, metadata) values(actor_user_id, 'CLIENT_NOTE_ADDED', 'client_note', new_note_id::text, jsonb_build_object('client_id', target_client_id));
  return new_note_id;
end;
$$;

-- Replace only the two client RPC signatures to include the additive contact fields.
drop function public.app_create_client(text, text, text, text, text, uuid[], uuid[], uuid);
create function public.app_create_client(
  target_slug text, target_name text, target_website text, target_industry text, target_description text,
  target_primary_contact text, target_contact_email text, target_contact_phone text,
  target_user_ids uuid[], target_agent_ids uuid[], actor_user_id uuid
) returns uuid language plpgsql security definer set search_path = public as $$
declare new_client_id uuid;
begin
  insert into public.clients(slug, name, website, industry, description, primary_contact, contact_email, contact_phone)
  values(target_slug, target_name, nullif(target_website, ''), nullif(target_industry, ''), nullif(target_description, ''), nullif(target_primary_contact, ''), nullif(target_contact_email, ''), nullif(target_contact_phone, '')) returning id into new_client_id;
  insert into public.client_members(client_id, user_id) select new_client_id, id from public.profiles where id = any(coalesce(target_user_ids, array[]::uuid[])) and status = 'active' on conflict do nothing;
  insert into public.client_agent_access(client_id, agent_id) select new_client_id, id from public.agents where id = any(coalesce(target_agent_ids, array[]::uuid[])) and enabled on conflict do nothing;
  insert into public.activity_logs(actor_id, action, entity_type, entity_id, metadata) values(actor_user_id, 'CLIENT_CREATED', 'client', new_client_id::text, jsonb_build_object('client_id', new_client_id));
  return new_client_id;
end;
$$;

drop function public.app_update_client(uuid, text, text, text, text, text, text, uuid[], uuid[], uuid);
create function public.app_update_client(
  target_client_id uuid, target_slug text, target_name text, target_website text, target_industry text, target_description text,
  target_primary_contact text, target_contact_email text, target_contact_phone text, target_status text,
  target_user_ids uuid[], target_agent_ids uuid[], actor_user_id uuid
) returns void language plpgsql security definer set search_path = public as $$
begin
  if not exists(select 1 from public.clients where id = target_client_id for update) then raise exception 'Client not found'; end if;
  if target_status not in ('active','inactive','archived') then raise exception 'Invalid client status'; end if;
  update public.clients set slug = target_slug, name = target_name, website = nullif(target_website, ''), industry = nullif(target_industry, ''), description = nullif(target_description, ''), primary_contact = nullif(target_primary_contact, ''), contact_email = nullif(target_contact_email, ''), contact_phone = nullif(target_contact_phone, ''), status = target_status, archived_at = case when target_status = 'archived' then coalesce(archived_at, now()) else null end where id = target_client_id;
  delete from public.client_members where client_id = target_client_id;
  delete from public.client_agent_access where client_id = target_client_id;
  if target_status = 'active' then
    insert into public.client_members(client_id, user_id) select target_client_id, id from public.profiles where id = any(coalesce(target_user_ids, array[]::uuid[])) and status = 'active' on conflict do nothing;
    insert into public.client_agent_access(client_id, agent_id) select target_client_id, id from public.agents where id = any(coalesce(target_agent_ids, array[]::uuid[])) and enabled on conflict do nothing;
  end if;
  insert into public.activity_logs(actor_id, action, entity_type, entity_id, metadata) values(actor_user_id, case when target_status = 'archived' then 'CLIENT_ARCHIVED' else 'CLIENT_UPDATED' end, 'client', target_client_id::text, jsonb_build_object('client_id', target_client_id));
end;
$$;

revoke all on function public.app_create_project(uuid, text, text, public.project_status, date, date, uuid, uuid), public.app_update_project(uuid, text, text, public.project_status, date, date, uuid, uuid), public.app_create_task(text, text, uuid, uuid, uuid, public.task_priority, public.task_status, date, uuid), public.app_update_task(uuid, text, text, uuid, uuid, uuid, public.task_priority, public.task_status, date, uuid), public.app_create_client_note(uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.app_create_project(uuid, text, text, public.project_status, date, date, uuid, uuid), public.app_update_project(uuid, text, text, public.project_status, date, date, uuid, uuid), public.app_create_task(text, text, uuid, uuid, uuid, public.task_priority, public.task_status, date, uuid), public.app_update_task(uuid, text, text, uuid, uuid, uuid, public.task_priority, public.task_status, date, uuid), public.app_create_client_note(uuid, text, uuid) to service_role;
revoke all on function public.app_create_client(text, text, text, text, text, text, text, text, uuid[], uuid[], uuid), public.app_update_client(uuid, text, text, text, text, text, text, text, text, text, uuid[], uuid[], uuid) from public, anon, authenticated;
grant execute on function public.app_create_client(text, text, text, text, text, text, text, text, uuid[], uuid[], uuid), public.app_update_client(uuid, text, text, text, text, text, text, text, text, text, uuid[], uuid[], uuid) to service_role;
