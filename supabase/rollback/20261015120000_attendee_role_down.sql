-- Rollback for 20261015120000_attendee_role: the hook stamps `member` again.
-- Safe in either order with the app: viewer.ts treats any non-host role alike.

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
