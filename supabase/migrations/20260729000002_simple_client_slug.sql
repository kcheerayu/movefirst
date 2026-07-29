create function public.app_create_client_simple(
  target_slug text, target_name text, target_contact_name text, target_industry text, actor_user_id uuid
) returns table(id uuid, slug text) language plpgsql security definer set search_path = public as $$
declare base_slug text; candidate_slug text; suffix integer := 1; new_client_id uuid;
begin
  if nullif(trim(target_name), '') is null then raise exception 'Company name is required'; end if;
  if nullif(trim(target_contact_name), '') is null then raise exception 'Contact name is required'; end if;
  if nullif(trim(target_industry), '') is null then raise exception 'Industry is required'; end if;
  base_slug := trim(both '-' from lower(trim(target_slug)));
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
revoke all on function public.app_create_client_simple(text, text, text, text, uuid) from public, anon, authenticated;
grant execute on function public.app_create_client_simple(text, text, text, text, uuid) to service_role;
