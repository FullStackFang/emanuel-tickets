-- Member auth (openspec change add-member-auth). One migration, applied before any
-- member sign-in is enabled:
--   * custom access token hook: stamps app_metadata.app_role (host | member) from the
--     session's authentication method, and refuses non-Microsoft sessions for staff (D1)
--   * is_host(): required by every host-owned RLS policy (D2)
--   * memberships: server-only cache of CRM verification results (D5)
--   * member pricing columns + reserve_seat with a members-only assertion (D6)
-- Rollback: supabase/rollback/20261014120000_member_auth_down.sql

-- ---------------------------------------------------------------------------
-- custom_access_token_hook (D1)
--
-- `amr` is an array of objects ([{"method":"oauth","timestamp":...}]), so the test is a
-- jsonpath over .method, not a `?` containment on the string 'oauth'. amr is per
-- session and survives token_refresh, so the role is stable for a session's life.
-- ---------------------------------------------------------------------------
create or replace function public.custom_access_token_hook(event jsonb)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_claims    jsonb := event -> 'claims';
  v_has_oauth boolean;
  v_has_azure boolean;
begin
  v_has_oauth := coalesce(
    jsonb_path_exists(v_claims -> 'amr', '$[*] ? (@.method == "oauth")'),
    false
  );
  v_has_azure := exists (
    select 1 from auth.identities
     where user_id = (event ->> 'user_id')::uuid
       and provider = 'azure'
  );

  -- An account holding a Microsoft identity gets a session only through Microsoft.
  if v_has_azure and not v_has_oauth then
    return jsonb_build_object(
      'error', jsonb_build_object('http_code', 403, 'message', 'Staff sign in with Microsoft')
    );
  end if;

  v_claims := jsonb_set(
    v_claims,
    '{app_metadata}',
    coalesce(v_claims -> 'app_metadata', '{}'::jsonb)
      || jsonb_build_object(
           'app_role',
           case when v_has_oauth and v_has_azure then 'host' else 'member' end
         )
  );

  return jsonb_set(event, '{claims}', v_claims);
end;
$$;

grant usage on schema public to supabase_auth_admin;
grant execute on function public.custom_access_token_hook(jsonb) to supabase_auth_admin;
revoke execute on function public.custom_access_token_hook(jsonb) from anon, authenticated, public;

-- ---------------------------------------------------------------------------
-- is_host() (D2): reads the role stamped by the hook. Never user_metadata.
-- ---------------------------------------------------------------------------
create or replace function public.is_host()
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select coalesce((select auth.jwt() -> 'app_metadata' ->> 'app_role'), '') = 'host'
$$;

grant execute on function public.is_host() to anon, authenticated;

-- ---------------------------------------------------------------------------
-- memberships (D5): server-only, like reservations. RLS on + forced, no policies.
-- ---------------------------------------------------------------------------
create table public.memberships (
  user_id     uuid primary key references auth.users (id) on delete cascade,
  provider    text not null,
  external_id text,
  status      text not null check (status in ('active', 'lapsed', 'not_found')),
  verified_at timestamptz not null,
  expires_at  timestamptz not null
);

alter table public.memberships enable row level security;
alter table public.memberships force row level security;

-- ---------------------------------------------------------------------------
-- Host policies now require the host role in addition to ownership (D2).
-- The two *_select_published policies are unchanged.
-- ---------------------------------------------------------------------------
alter policy events_select_own on public.events
  using ((select public.is_host()) and (select auth.uid()) = host_id);

alter policy events_insert_own on public.events
  with check ((select public.is_host()) and (select auth.uid()) = host_id);

alter policy events_update_own on public.events
  using ((select public.is_host()) and (select auth.uid()) = host_id)
  with check ((select public.is_host()) and (select auth.uid()) = host_id);

alter policy events_delete_own on public.events
  using ((select public.is_host()) and (select auth.uid()) = host_id);

alter policy ticket_types_manage_own on public.ticket_types
  using (
    (select public.is_host())
    and exists (
      select 1 from public.events e
      where e.id = ticket_types.event_id
        and e.host_id = (select auth.uid())
    )
  )
  with check (
    (select public.is_host())
    and exists (
      select 1 from public.events e
      where e.id = ticket_types.event_id
        and e.host_id = (select auth.uid())
    )
  );

alter policy orders_select_own_event on public.orders
  using (
    (select public.is_host())
    and exists (
      select 1 from public.events e
      where e.id = orders.event_id
        and e.host_id = (select auth.uid())
    )
  );

alter policy attendees_select_own_event on public.attendees
  using (
    (select public.is_host())
    and exists (
      select 1 from public.events e
      where e.id = attendees.event_id
        and e.host_id = (select auth.uid())
    )
  );

-- ---------------------------------------------------------------------------
-- Member pricing columns (D6)
-- ---------------------------------------------------------------------------
alter table public.ticket_types
  add column member_price_cents integer check (member_price_cents >= 0),
  add column members_only boolean not null default false;

-- member_pricing means "the effective price came from member_price_cents".
alter table public.orders
  add column user_id uuid references auth.users (id) on delete set null,
  add column member_pricing boolean not null default false;

create index orders_user_id_idx on public.orders (user_id);

-- ---------------------------------------------------------------------------
-- reserve_seat with a members-only assertion (D6). Dropped and recreated: a
-- create-or-replace with a new parameter list would add an ambiguous overload.
-- p_is_member defaults to false so any caller that forgets to assert fails closed.
-- ---------------------------------------------------------------------------
drop function public.reserve_seat(uuid, integer, integer);

create function public.reserve_seat(
  p_ticket_type_id uuid,
  p_qty            integer,
  p_hold_minutes   integer default 15,
  p_is_member      boolean default false
)
returns public.reservations
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_members_only boolean;
  v_updated      integer;
  v_reservation  public.reservations;
begin
  if p_qty is null or p_qty <= 0 then
    raise exception 'qty must be positive' using errcode = '22023';
  end if;

  -- Lock the row first so a concurrent members_only toggle serializes with us.
  select members_only into v_members_only
    from public.ticket_types
   where id = p_ticket_type_id
   for update;

  -- Distinct errcode so callers never report this as "sold out" (P0001).
  if v_members_only and not coalesce(p_is_member, false) then
    raise exception 'members_only' using errcode = '42501';
  end if;

  update public.ticket_types
     set held = held + p_qty
   where id = p_ticket_type_id
     and capacity - sold - held >= p_qty;
  get diagnostics v_updated = row_count;

  if v_updated = 0 then
    -- Either the ticket type does not exist or there is not enough inventory.
    raise exception 'insufficient_inventory' using errcode = 'P0001';
  end if;

  insert into public.reservations (ticket_type_id, qty, status, expires_at)
  values (p_ticket_type_id, p_qty, 'held', now() + make_interval(mins => p_hold_minutes))
  returning * into v_reservation;

  return v_reservation;
end;
$$;

revoke execute on function public.reserve_seat(uuid, integer, integer, boolean) from public, anon, authenticated;
grant execute on function public.reserve_seat(uuid, integer, integer, boolean) to service_role;
