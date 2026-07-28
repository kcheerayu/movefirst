-- Production auth and audit support. Safe to apply after the foundation migration.
create or replace function public.app_record_login() returns void language plpgsql security definer set search_path=public as $$
begin
  if not exists (select 1 from profiles where id=auth.uid() and status='active') then raise exception 'Account is not active'; end if;
  update profiles set last_active_at=now(), updated_at=now() where id=auth.uid();
  insert into activity_logs(actor_id,action,entity_type,entity_id) values(auth.uid(),'LOGIN','profile',auth.uid()::text);
end; $$;
revoke all on function public.app_record_login() from public; grant execute on function public.app_record_login() to authenticated;

create or replace function public.activate_profile_after_confirmation() returns trigger language plpgsql security definer set search_path=public as $$
begin
  if new.email_confirmed_at is not null and old.email_confirmed_at is null then
    update public.profiles set status='active', updated_at=now() where id=new.id and status='invited';
    insert into public.activity_logs(actor_id,action,entity_type,entity_id) values(new.id,'USER_ACTIVATED','profile',new.id::text);
  end if;
  return new;
end; $$;
drop trigger if exists move_first_activate_profile on auth.users;
create trigger move_first_activate_profile after update of email_confirmed_at on auth.users for each row execute procedure public.activate_profile_after_confirmation();

-- Prevent direct profile reactivation/role changes by browser clients. Server actions use the service role
-- only after checking the authenticated caller is an OWNER and record the action in activity_logs.
