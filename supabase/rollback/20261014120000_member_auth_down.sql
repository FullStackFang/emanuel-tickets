-- Hand-written down-migration for 20261014120000_member_auth.sql (design: Rollback).
-- Not in supabase/migrations on purpose: run manually (psql / SQL editor) AFTER
-- disabling the custom access token hook on the project.

-- reserve_seat back to the 3-argument signature.
drop function public.reserve_seat(uuid, integer, integer, boolean);

create function public.reserve_seat(
  p_ticket_type_id uuid,
  p_qty            integer,
  p_hold_minutes   integer default 15
)
returns public.reservations
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_updated     integer;
  v_reservation public.reservations;
begin
  if p_qty is null or p_qty <= 0 then
    raise exception 'qty must be positive' using errcode = '22023';
  end if;

  update public.ticket_types
     set held = held + p_qty
   where id = p_ticket_type_id
     and capacity - sold - held >= p_qty;
  get diagnostics v_updated = row_count;

  if v_updated = 0 then
    raise exception 'insufficient_inventory' using errcode = 'P0001';
  end if;

  insert into public.reservations (ticket_type_id, qty, status, expires_at)
  values (p_ticket_type_id, p_qty, 'held', now() + make_interval(mins => p_hold_minutes))
  returning * into v_reservation;

  return v_reservation;
end;
$$;

revoke execute on function public.reserve_seat(uuid, integer, integer) from public, anon, authenticated;
grant execute on function public.reserve_seat(uuid, integer, integer) to service_role;

-- Prior policy definitions (20260917143042_ticketing_rls.sql).
alter policy events_select_own on public.events
  using ((select auth.uid()) = host_id);
alter policy events_insert_own on public.events
  with check ((select auth.uid()) = host_id);
alter policy events_update_own on public.events
  using ((select auth.uid()) = host_id)
  with check ((select auth.uid()) = host_id);
alter policy events_delete_own on public.events
  using ((select auth.uid()) = host_id);
alter policy ticket_types_manage_own on public.ticket_types
  using (exists (select 1 from public.events e
                  where e.id = ticket_types.event_id and e.host_id = (select auth.uid())))
  with check (exists (select 1 from public.events e
                       where e.id = ticket_types.event_id and e.host_id = (select auth.uid())));
alter policy orders_select_own_event on public.orders
  using (exists (select 1 from public.events e
                  where e.id = orders.event_id and e.host_id = (select auth.uid())));
alter policy attendees_select_own_event on public.attendees
  using (exists (select 1 from public.events e
                  where e.id = attendees.event_id and e.host_id = (select auth.uid())));

alter table public.orders drop column member_pricing, drop column user_id;
alter table public.ticket_types drop column members_only, drop column member_price_cents;

drop table public.memberships;
drop function public.is_host();
drop function public.custom_access_token_hook(jsonb);
