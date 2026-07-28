-- Move First foundation. Apply with `supabase db push`; run only in a Supabase project.
create extension if not exists pgcrypto;
create type public.member_status as enum ('invited','active','disabled');
create type public.agent_state as enum ('ready','running','waiting','scheduled','complete','warning','failed','paused','disabled');
create table public.roles (id uuid primary key default gen_random_uuid(), key text unique not null, name text not null, created_at timestamptz not null default now());
create table public.permissions (id uuid primary key default gen_random_uuid(), key text unique not null, description text not null);
create table public.role_permissions (role_id uuid references public.roles(id) on delete cascade, permission_id uuid references public.permissions(id) on delete cascade, primary key(role_id,permission_id));
create table public.profiles (id uuid primary key references auth.users(id) on delete cascade, full_name text not null, job_title text, role_id uuid not null references public.roles(id), status public.member_status not null default 'invited', last_active_at timestamptz, created_at timestamptz not null default now(), updated_at timestamptz not null default now());
create table public.user_permissions (user_id uuid references public.profiles(id) on delete cascade, permission_id uuid references public.permissions(id) on delete cascade, primary key(user_id,permission_id));
create table public.agents (id uuid primary key default gen_random_uuid(), slug text unique not null, name text not null, description text not null, icon_key text not null, category text not null, version text, enabled boolean not null default true, created_at timestamptz not null default now());
create table public.user_agent_access (user_id uuid references public.profiles(id) on delete cascade, agent_id uuid references public.agents(id) on delete cascade, primary key(user_id,agent_id));
create table public.clients (id uuid primary key default gen_random_uuid(), slug text unique not null, name text not null, website text, industry text, notes text, created_at timestamptz not null default now(), archived_at timestamptz);
create table public.client_members (client_id uuid references public.clients(id) on delete cascade, user_id uuid references public.profiles(id) on delete cascade, primary key(client_id,user_id));
create table public.client_agent_access (client_id uuid references public.clients(id) on delete cascade, agent_id uuid references public.agents(id) on delete cascade, enabled boolean not null default true, primary key(client_id,agent_id));
create table public.agent_runs (id uuid primary key default gen_random_uuid(), agent_id uuid not null references public.agents(id), client_id uuid references public.clients(id), state public.agent_state not null default 'ready', operation text, started_at timestamptz, completed_at timestamptz, runtime_ms integer, metadata jsonb not null default '{}'::jsonb, created_at timestamptz not null default now());
create table public.agent_steps (id uuid primary key default gen_random_uuid(), run_id uuid not null references public.agent_runs(id) on delete cascade, key text not null, state public.agent_state not null, started_at timestamptz, completed_at timestamptz, metadata jsonb not null default '{}'::jsonb);
create table public.agent_events (id uuid primary key default gen_random_uuid(), agent_id uuid not null references public.agents(id), run_id uuid references public.agent_runs(id) on delete cascade, state public.agent_state not null, message text, metadata jsonb not null default '{}'::jsonb, created_at timestamptz not null default now());
create table public.activity_logs (id bigint generated always as identity primary key, actor_id uuid references public.profiles(id), action text not null, entity_type text not null, entity_id text, metadata jsonb not null default '{}'::jsonb, created_at timestamptz not null default now());
create index activity_logs_created_at_idx on public.activity_logs(created_at desc);

-- Security-definer context resolver: frontend never supplies its role or access scope.
create or replace function public.app_current_context() returns table(full_name text,job_title text,role_key text,status public.member_status,permissions text[],agent_slugs text[],client_ids text[]) language sql security definer set search_path=public as $$
 select p.full_name,p.job_title,r.key,p.status,
 coalesce(array(select distinct permission_key from (select perm.key as permission_key from role_permissions rp join permissions perm on perm.id=rp.permission_id where rp.role_id=r.id union select perm.key from user_permissions up join permissions perm on perm.id=up.permission_id where up.user_id=p.id) granted order by permission_key),array[]::text[]),
 coalesce(array_agg(distinct a.slug) filter(where a.slug is not null),array[]::text[]),
 coalesce(array_agg(distinct c.slug) filter(where c.slug is not null),array[]::text[])
 from profiles p join roles r on r.id=p.role_id
 left join user_agent_access uaa on uaa.user_id=p.id left join agents a on a.id=uaa.agent_id and a.enabled
 left join client_members cm on cm.user_id=p.id left join clients c on c.id=cm.client_id and c.archived_at is null
 where p.id=auth.uid() group by p.id,r.id,r.key; $$;
revoke all on function public.app_current_context() from public; grant execute on function public.app_current_context() to authenticated;
create or replace function public.app_has_permission(required_key text) returns boolean language sql stable security definer set search_path=public as $$
 select exists(select 1 from profiles p join roles r on r.id=p.role_id join role_permissions rp on rp.role_id=r.id join permissions perm on perm.id=rp.permission_id where p.id=auth.uid() and p.status='active' and perm.key=required_key)
 or exists(select 1 from user_permissions up join permissions perm on perm.id=up.permission_id where up.user_id=auth.uid() and perm.key=required_key); $$;
revoke all on function public.app_has_permission(text) from public; grant execute on function public.app_has_permission(text) to authenticated;

alter table public.profiles enable row level security; alter table public.agents enable row level security; alter table public.clients enable row level security; alter table public.client_members enable row level security; alter table public.agent_runs enable row level security; alter table public.activity_logs enable row level security;
create policy "profile self read" on public.profiles for select to authenticated using(id=auth.uid());
create policy "assigned agents read" on public.agents for select to authenticated using(public.app_has_permission('agents.manage') or exists(select 1 from user_agent_access x where x.user_id=auth.uid() and x.agent_id=id));
create policy "client members read" on public.clients for select to authenticated using(public.app_has_permission('clients.manage') or exists(select 1 from client_members x where x.user_id=auth.uid() and x.client_id=id));
-- Mutations occur through audited server-side RPCs/service layer; no broad browser write policies.

insert into public.roles(key,name) values ('OWNER','Owner'),('ADMIN','Admin'),('MEMBER','Member');
insert into public.permissions(key,description) values ('platform.manage','Manage platform settings'),('members.read','View members'),('members.manage','Invite and manage members'),('agents.read','View assigned agents'),('agents.manage','Manage agents'),('clients.read','View assigned clients'),('clients.manage','Manage clients'),('activity.read','View audit activity'),('operations.read','View control room');
insert into public.role_permissions select r.id,p.id from public.roles r cross join public.permissions p where r.key='OWNER';
insert into public.role_permissions select r.id,p.id from public.roles r join public.permissions p on p.key in ('agents.read','clients.read','clients.manage','activity.read','operations.read') where r.key='ADMIN';
insert into public.role_permissions select r.id,p.id from public.roles r join public.permissions p on p.key in ('agents.read','clients.read') where r.key='MEMBER';
insert into public.agents(slug,name,description,icon_key,category,version) values ('outreach','Outreach Agent','External outreach integration','send','Revenue operations','integration-pending'),('marketing-strategy','Marketing Strategy','Strategy foundation','compass','Strategy','0.1');
