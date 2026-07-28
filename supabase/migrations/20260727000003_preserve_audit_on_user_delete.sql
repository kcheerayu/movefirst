-- Retain audit records while allowing an Auth identity/profile to be deleted.
alter table public.activity_logs drop constraint if exists activity_logs_actor_id_fkey;
alter table public.activity_logs add constraint activity_logs_actor_id_fkey foreign key (actor_id) references public.profiles(id) on delete set null;
