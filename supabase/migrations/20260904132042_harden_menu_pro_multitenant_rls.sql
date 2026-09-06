-- LC Menu Pro — Phase 1 hardening
-- Keep the shared private schema closed to customer sessions while exposing
-- only the membership predicate required by RLS.

create or replace function public.menu_pro_is_member(
  p_business_id uuid,
  p_roles text[] default null
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.menu_pro_members m
    where m.business_id = p_business_id
      and m.user_id = (select auth.uid())
      and m.status = 'active'
      and (p_roles is null or m.role = any(p_roles))
  );
$$;

revoke all on function public.menu_pro_is_member(uuid, text[]) from public, anon;
grant execute on function public.menu_pro_is_member(uuid, text[]) to authenticated, service_role;

drop policy if exists menu_pro_businesses_select_member
  on public.menu_pro_businesses;
create policy menu_pro_businesses_select_member
on public.menu_pro_businesses
for select
to authenticated
using (public.menu_pro_is_member(id, null));

drop policy if exists menu_pro_businesses_update_manager
  on public.menu_pro_businesses;
create policy menu_pro_businesses_update_manager
on public.menu_pro_businesses
for update
to authenticated
using (public.menu_pro_is_member(id, array['owner','manager']::text[]))
with check (public.menu_pro_is_member(id, array['owner','manager']::text[]));

drop policy if exists menu_pro_members_select_member
  on public.menu_pro_members;
create policy menu_pro_members_select_member
on public.menu_pro_members
for select
to authenticated
using (
  user_id = (select auth.uid())
  or public.menu_pro_is_member(business_id, array['owner','manager']::text[])
);

revoke usage on schema private from authenticated;
grant usage on schema private to service_role;

grant execute on function private.attach_menu_pro_owner(uuid, uuid) to service_role;
grant execute on function private.provision_menu_pro_business(uuid) to service_role;

drop function if exists private.is_menu_pro_member(uuid, text[]);
