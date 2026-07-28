-- Keep the currently deployed client UI working until the operations release is deployed.
-- These service-role-only overloads delegate to the contact-aware RPCs added in 20260728000002.
create function public.app_create_client(
  target_slug text, target_name text, target_website text, target_industry text, target_description text,
  target_user_ids uuid[], target_agent_ids uuid[], actor_user_id uuid
) returns uuid language sql security definer set search_path = public as $$
  select public.app_create_client(target_slug, target_name, target_website, target_industry, target_description, '', '', '', target_user_ids, target_agent_ids, actor_user_id);
$$;

create function public.app_update_client(
  target_client_id uuid, target_slug text, target_name text, target_website text, target_industry text, target_description text,
  target_status text, target_user_ids uuid[], target_agent_ids uuid[], actor_user_id uuid
) returns void language plpgsql security definer set search_path = public as $$
declare existing_contact record;
begin
  select primary_contact, contact_email, contact_phone into existing_contact from public.clients where id = target_client_id;
  perform public.app_update_client(target_client_id, target_slug, target_name, target_website, target_industry, target_description,
    coalesce(existing_contact.primary_contact, ''), coalesce(existing_contact.contact_email, ''), coalesce(existing_contact.contact_phone, ''),
    target_status, target_user_ids, target_agent_ids, actor_user_id);
end;
$$;

revoke all on function public.app_create_client(text, text, text, text, text, uuid[], uuid[], uuid), public.app_update_client(uuid, text, text, text, text, text, text, uuid[], uuid[], uuid) from public, anon, authenticated;
grant execute on function public.app_create_client(text, text, text, text, text, uuid[], uuid[], uuid), public.app_update_client(uuid, text, text, text, text, text, text, uuid[], uuid[], uuid) to service_role;
