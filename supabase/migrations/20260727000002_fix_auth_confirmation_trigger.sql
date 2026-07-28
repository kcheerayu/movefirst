-- Auth users may be confirmed before an application profile is provisioned.
-- Never let an audit entry block identity creation.
create or replace function public.activate_profile_after_confirmation() returns trigger language plpgsql security definer set search_path=public as $$
begin
  if new.email_confirmed_at is not null and old.email_confirmed_at is null then
    update public.profiles set status='active', updated_at=now() where id=new.id and status='invited';
    if found then
      insert into public.activity_logs(actor_id,action,entity_type,entity_id) values(new.id,'USER_ACTIVATED','profile',new.id::text);
    end if;
  end if;
  return new;
end; $$;
