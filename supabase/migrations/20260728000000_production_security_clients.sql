-- Production security, lifecycle consistency, and client foundation.
-- Browser access is limited to scoped reads. All mutations remain server/service-role only.

alter table public.clients
  add column if not exists status text not null default 'active' check (status in ('active','inactive','archived')),
  add column if not exists description text,
  add column if not exists updated_at timestamptz not null default now();

create or replace function public.app_touch_updated_at() returns trigger
language plpgsql security invoker set search_path = public as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists clients_touch_updated_at on public.clients;
create trigger clients_touch_updated_at before update on public.clients
for each row execute procedure public.app_touch_updated_at();

-- Explicitly enable RLS on every application table; no table relies on defaults.
alter table public.roles enable row level security;
alter table public.permissions enable row level security;
alter table public.role_permissions enable row level security;
alter table public.profiles enable row level security;
alter table public.user_permissions enable row level security;
alter table public.agents enable row level security;
alter table public.user_agent_access enable row level security;
alter table public.clients enable row level security;
alter table public.client_members enable row level security;
alter table public.client_agent_access enable row level security;
alter table public.agent_runs enable row level security;
alter table public.agent_steps enable row level security;
alter table public.agent_events enable row level security;
alter table public.activity_logs enable row level security;

-- Revoke implicit API access. The only grants restored below are scoped SELECT reads.
revoke all on table public.roles, public.permissions, public.role_permissions, public.profiles,
  public.user_permissions, public.agents, public.user_agent_access, public.clients,
  public.client_members, public.client_agent_access, public.agent_runs, public.agent_steps,
  public.agent_events, public.activity_logs from anon, authenticated;
grant select on table public.profiles, public.agents, public.user_agent_access, public.clients,
  public.client_members, public.client_agent_access, public.agent_runs, public.agent_steps,
  public.agent_events, public.activity_logs to authenticated;

create or replace function public.app_is_active() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and status = 'active');
$$;

create or replace function public.app_has_permission(required_key text) returns boolean
language sql stable security definer set search_path = public as $$
  select public.app_is_active() and (
    exists (
      select 1
      from public.profiles p
      join public.roles r on r.id = p.role_id
      join public.role_permissions rp on rp.role_id = r.id
      join public.permissions perm on perm.id = rp.permission_id
      where p.id = auth.uid() and perm.key = required_key
    )
    or exists (
      select 1 from public.user_permissions up
      join public.permissions perm on perm.id = up.permission_id
      where up.user_id = auth.uid() and perm.key = required_key
    )
  );
$$;

create or replace function public.app_can_access_agent(required_agent_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.app_is_active() and (
    public.app_has_permission('agents.manage')
    or (
      public.app_has_permission('agents.read')
      and exists (select 1 from public.user_agent_access where user_id = auth.uid() and agent_id = required_agent_id)
    )
  );
$$;

create or replace function public.app_can_access_client(required_client_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.app_is_active() and (
    public.app_has_permission('clients.manage')
    or (
      public.app_has_permission('clients.read')
      and exists (select 1 from public.client_members where user_id = auth.uid() and client_id = required_client_id)
    )
  );
$$;

create or replace function public.app_can_read_activity(log_actor_id uuid, log_metadata jsonb) returns boolean
language sql stable security definer set search_path = public as $$
  select public.app_is_active() and public.app_has_permission('activity.read') and (
    public.app_has_permission('platform.manage')
    or log_actor_id = auth.uid()
    or (
      coalesce(log_metadata ->> 'client_id', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      and public.app_can_access_client((log_metadata ->> 'client_id')::uuid)
    )
    or (
      coalesce(log_metadata ->> 'agent_id', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      and public.app_can_access_agent((log_metadata ->> 'agent_id')::uuid)
    )
  );
$$;

-- Current context uses UUIDs for authorization; slugs are presentation/routing only.
drop function if exists public.app_current_context();
create function public.app_current_context()
returns table(full_name text, job_title text, role_key text, status public.member_status,
  permissions text[], agent_slugs text[], agent_ids uuid[], client_ids uuid[])
language sql security definer set search_path = public as $$
  select p.full_name, p.job_title, r.key, p.status,
    coalesce(array(select distinct permission_key from (
      select perm.key as permission_key from public.role_permissions rp join public.permissions perm on perm.id = rp.permission_id where rp.role_id = r.id
      union
      select perm.key from public.user_permissions up join public.permissions perm on perm.id = up.permission_id where up.user_id = p.id
    ) granted order by permission_key), array[]::text[]),
    coalesce(array_agg(distinct a.slug) filter(where a.slug is not null), array[]::text[]),
    coalesce(array_agg(distinct a.id) filter(where a.id is not null), array[]::uuid[]),
    coalesce(array_agg(distinct c.id) filter(where c.id is not null), array[]::uuid[])
  from public.profiles p
  join public.roles r on r.id = p.role_id
  left join public.user_agent_access uaa on uaa.user_id = p.id
  left join public.agents a on a.id = uaa.agent_id and a.enabled
  left join public.client_members cm on cm.user_id = p.id
  left join public.clients c on c.id = cm.client_id and c.status = 'active' and c.archived_at is null
  where p.id = auth.uid()
  group by p.id, r.id, r.key;
$$;

-- Scoped read policies. There are deliberately no browser write policies.
drop policy if exists "profile self read" on public.profiles;
create policy "profile self read" on public.profiles for select to authenticated using (id = auth.uid() and public.app_is_active());
drop policy if exists "assigned agents read" on public.agents;
create policy "assigned agents read" on public.agents for select to authenticated using (public.app_can_access_agent(id));
drop policy if exists "client members read" on public.clients;
create policy "scoped clients read" on public.clients for select to authenticated using (public.app_can_access_client(id));
create policy "scoped agent grants read" on public.user_agent_access for select to authenticated using (user_id = auth.uid() and public.app_is_active());
create policy "scoped client memberships read" on public.client_members for select to authenticated using (user_id = auth.uid() or public.app_can_access_client(client_id));
create policy "scoped client agent grants read" on public.client_agent_access for select to authenticated using (public.app_can_access_client(client_id) and public.app_can_access_agent(agent_id));
create policy "scoped runs read" on public.agent_runs for select to authenticated using (
  public.app_can_access_agent(agent_id) and (client_id is null or public.app_can_access_client(client_id))
);
create policy "scoped steps read" on public.agent_steps for select to authenticated using (
  exists (select 1 from public.agent_runs r where r.id = run_id and public.app_can_access_agent(r.agent_id) and (r.client_id is null or public.app_can_access_client(r.client_id)))
);
create policy "scoped events read" on public.agent_events for select to authenticated using (
  public.app_can_access_agent(agent_id) and (run_id is null or exists (select 1 from public.agent_runs r where r.id = run_id and (r.client_id is null or public.app_can_access_client(r.client_id))))
);
create policy "scoped activity read" on public.activity_logs for select to authenticated using (public.app_can_read_activity(actor_id, metadata));

-- Atomic database portion of invitation provisioning. The caller is the server service role.
create or replace function public.app_provision_invited_user(
  target_user_id uuid, target_full_name text, target_job_title text, target_role_key text,
  target_agent_ids uuid[], target_client_ids uuid[], actor_user_id uuid
) returns void language plpgsql security definer set search_path = public as $$
declare target_role_id uuid;
begin
  select id into target_role_id from public.roles where key = target_role_key;
  if target_role_id is null then raise exception 'Unknown role'; end if;
  insert into public.profiles(id, full_name, job_title, role_id, status)
  values(target_user_id, target_full_name, nullif(target_job_title, ''), target_role_id, 'invited')
  on conflict (id) do update set full_name = excluded.full_name, job_title = excluded.job_title, role_id = excluded.role_id, status = 'invited', updated_at = now();
  insert into public.user_agent_access(user_id, agent_id)
  select target_user_id, id from public.agents where id = any(coalesce(target_agent_ids, array[]::uuid[]))
  on conflict do nothing;
  insert into public.client_members(user_id, client_id)
  select target_user_id, id from public.clients where id = any(coalesce(target_client_ids, array[]::uuid[])) and status = 'active' and archived_at is null
  on conflict do nothing;
  insert into public.activity_logs(actor_id, action, entity_type, entity_id, metadata)
  values(actor_user_id, 'OWNER_INVITED_USER', 'profile', target_user_id::text,
    jsonb_build_object('role', target_role_key, 'agent_count', cardinality(coalesce(target_agent_ids, array[]::uuid[])), 'client_count', cardinality(coalesce(target_client_ids, array[]::uuid[]))));
end;
$$;

create or replace function public.app_replace_user_access(
  target_user_id uuid, target_role_key text, target_agent_ids uuid[], target_client_ids uuid[], actor_user_id uuid
) returns void language plpgsql security definer set search_path = public as $$
declare target_role_id uuid; previous_role text;
begin
  select r.key into previous_role from public.profiles p join public.roles r on r.id = p.role_id where p.id = target_user_id for update;
  if previous_role is null then raise exception 'User not found'; end if;
  select id into target_role_id from public.roles where key = target_role_key;
  if target_role_id is null then raise exception 'Unknown role'; end if;
  update public.profiles set role_id = target_role_id, updated_at = now() where id = target_user_id;
  delete from public.user_agent_access where user_id = target_user_id;
  delete from public.client_members where user_id = target_user_id;
  insert into public.user_agent_access(user_id, agent_id) select target_user_id, id from public.agents where id = any(coalesce(target_agent_ids, array[]::uuid[])) on conflict do nothing;
  insert into public.client_members(user_id, client_id) select target_user_id, id from public.clients where id = any(coalesce(target_client_ids, array[]::uuid[])) and status = 'active' and archived_at is null on conflict do nothing;
  insert into public.activity_logs(actor_id, action, entity_type, entity_id, metadata)
  values(actor_user_id, 'USER_ACCESS_UPDATED', 'profile', target_user_id::text, jsonb_build_object('previous_role', previous_role, 'role', target_role_key));
end;
$$;

-- Deactivation always destroys database-backed sessions. Reactivation never restores them.
create or replace function public.app_revoke_sessions_on_disable() returns trigger
language plpgsql security definer set search_path = public, auth as $$
begin
  if new.status = 'disabled' and old.status is distinct from 'disabled' then
    delete from auth.sessions where user_id = new.id;
  end if;
  return new;
end;
$$;
drop trigger if exists move_first_revoke_sessions_on_disable on public.profiles;
create trigger move_first_revoke_sessions_on_disable after update of status on public.profiles
for each row execute procedure public.app_revoke_sessions_on_disable();

create or replace function public.app_set_user_status(target_user_id uuid, target_status public.member_status, actor_user_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare target_role text;
begin
  select r.key into target_role from public.profiles p join public.roles r on r.id = p.role_id where p.id = target_user_id for update;
  if target_role is null then raise exception 'User not found'; end if;
  if target_role = 'OWNER' then raise exception 'Owner accounts cannot be changed here'; end if;
  if target_status not in ('active', 'disabled') then raise exception 'Invalid account status'; end if;
  update public.profiles set status = target_status, updated_at = now() where id = target_user_id;
  insert into public.activity_logs(actor_id, action, entity_type, entity_id)
  values(actor_user_id, case when target_status = 'disabled' then 'USER_DEACTIVATED' else 'USER_ACTIVATED' end, 'profile', target_user_id::text);
end;
$$;

create or replace function public.app_create_client(
  target_slug text, target_name text, target_website text, target_industry text, target_description text,
  target_user_ids uuid[], target_agent_ids uuid[], actor_user_id uuid
) returns uuid language plpgsql security definer set search_path = public as $$
declare new_client_id uuid;
begin
  insert into public.clients(slug, name, website, industry, description)
  values(target_slug, target_name, nullif(target_website, ''), nullif(target_industry, ''), nullif(target_description, '')) returning id into new_client_id;
  insert into public.client_members(client_id, user_id) select new_client_id, id from public.profiles where id = any(coalesce(target_user_ids, array[]::uuid[])) and status = 'active' on conflict do nothing;
  insert into public.client_agent_access(client_id, agent_id) select new_client_id, id from public.agents where id = any(coalesce(target_agent_ids, array[]::uuid[])) and enabled on conflict do nothing;
  insert into public.activity_logs(actor_id, action, entity_type, entity_id, metadata) values(actor_user_id, 'CLIENT_CREATED', 'client', new_client_id::text, jsonb_build_object('client_id', new_client_id));
  return new_client_id;
end;
$$;

create or replace function public.app_update_client(
  target_client_id uuid, target_slug text, target_name text, target_website text, target_industry text, target_description text,
  target_status text, target_user_ids uuid[], target_agent_ids uuid[], actor_user_id uuid
) returns void language plpgsql security definer set search_path = public as $$
begin
  if not exists(select 1 from public.clients where id = target_client_id for update) then raise exception 'Client not found'; end if;
  if target_status not in ('active','inactive','archived') then raise exception 'Invalid client status'; end if;
  update public.clients set slug = target_slug, name = target_name, website = nullif(target_website, ''), industry = nullif(target_industry, ''), description = nullif(target_description, ''), status = target_status, archived_at = case when target_status = 'archived' then coalesce(archived_at, now()) else null end where id = target_client_id;
  delete from public.client_members where client_id = target_client_id;
  delete from public.client_agent_access where client_id = target_client_id;
  if target_status = 'active' then
    insert into public.client_members(client_id, user_id) select target_client_id, id from public.profiles where id = any(coalesce(target_user_ids, array[]::uuid[])) and status = 'active' on conflict do nothing;
    insert into public.client_agent_access(client_id, agent_id) select target_client_id, id from public.agents where id = any(coalesce(target_agent_ids, array[]::uuid[])) and enabled on conflict do nothing;
  end if;
  insert into public.activity_logs(actor_id, action, entity_type, entity_id, metadata) values(actor_user_id, case when target_status = 'archived' then 'CLIENT_ARCHIVED' else 'CLIENT_UPDATED' end, 'client', target_client_id::text, jsonb_build_object('client_id', target_client_id));
end;
$$;

revoke all on function public.app_is_active(), public.app_has_permission(text), public.app_can_access_agent(uuid), public.app_can_access_client(uuid), public.app_can_read_activity(uuid, jsonb), public.app_current_context(), public.app_provision_invited_user(uuid, text, text, text, uuid[], uuid[], uuid), public.app_replace_user_access(uuid, text, uuid[], uuid[], uuid), public.app_set_user_status(uuid, public.member_status, uuid), public.app_create_client(text, text, text, text, text, uuid[], uuid[], uuid), public.app_update_client(uuid, text, text, text, text, text, text, uuid[], uuid[], uuid) from public, anon, authenticated;
grant execute on function public.app_is_active(), public.app_has_permission(text), public.app_can_access_agent(uuid), public.app_can_access_client(uuid), public.app_can_read_activity(uuid, jsonb), public.app_current_context() to authenticated;
grant execute on function public.app_provision_invited_user(uuid, text, text, text, uuid[], uuid[], uuid), public.app_replace_user_access(uuid, text, uuid[], uuid[], uuid), public.app_set_user_status(uuid, public.member_status, uuid), public.app_create_client(text, text, text, text, text, uuid[], uuid[], uuid), public.app_update_client(uuid, text, text, text, text, text, text, uuid[], uuid[], uuid) to service_role;
