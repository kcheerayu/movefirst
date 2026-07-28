-- Invited users must set an initial password before the platform activates their profile.
create or replace function public.activate_profile_after_confirmation() returns trigger language plpgsql security definer set search_path=public as $$
begin
  if new.email_confirmed_at is not null and old.email_confirmed_at is null
    and coalesce((new.raw_app_meta_data ->> 'move_first_initial_password_required')::boolean, false) = false then
    update public.profiles set status='active', updated_at=now() where id=new.id and status='invited';
    if found then
      insert into public.activity_logs(actor_id,action,entity_type,entity_id) values(new.id,'USER_ACTIVATED','profile',new.id::text);
    end if;
  end if;
  return new;
end; $$;

create or replace function public.app_activate_invited_user(target_user_id uuid) returns void
language plpgsql security definer set search_path=public,auth as $$
begin
  if not exists (select 1 from auth.users where id=target_user_id and email_confirmed_at is not null and coalesce((raw_app_meta_data ->> 'move_first_initial_password_required')::boolean, false)=false) then
    raise exception 'Invitation setup is not complete';
  end if;
  update public.profiles set status='active', updated_at=now() where id=target_user_id and status='invited';
  if not found then raise exception 'Invited profile not found'; end if;
  insert into public.activity_logs(actor_id,action,entity_type,entity_id) values(target_user_id,'USER_ACTIVATED','profile',target_user_id::text);
end; $$;

revoke all on function public.app_activate_invited_user(uuid) from public, anon, authenticated;
grant execute on function public.app_activate_invited_user(uuid) to service_role;
