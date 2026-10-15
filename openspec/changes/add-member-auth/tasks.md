## 1. Prerequisites and decisions

- [ ] 1.1 Ensure `openspec/specs/host-auth` and `openspec/specs/attendee-access` exist (archive `add-event-ticketing` or sync its specs) before this change is archived; implementation may start before that
- [ ] 1.2 Confirm with the temple: `OFFICE_CONTACT_EMAIL` value, whether member prices are shown to signed-out visitors, and whether members-only belongs on ticket types only (design Open Questions)
- [ ] 1.3 Temple-side Salesforce prerequisites (blocks group 8 only): Connected App with certificate, dedicated integration user pre-authorized by permission set, and the field map naming object / status field / active values / end-date field
- [ ] 1.4 Confirm the Entra app returns a verified email (`xms_edov`) by signing in with a throwaway account that already exists as an email-code user on a local/preview project and checking that one `auth.users` row ends up with both identities; record the result in the design if linking does not occur

## 2. Migration: role claim, policy hardening, memberships, pricing columns, reserve_seat

- [x] 2.1 `public.custom_access_token_hook(event jsonb)`: `has_oauth` via `jsonb_path_exists(event->'claims'->'amr', '$[*] ? (@.method == "oauth")')`; `has_azure` via `auth.identities` lookup; return a 403 error object ("Staff sign in with Microsoft") when `has_azure and not has_oauth`; else set `claims.app_metadata.app_role` to `host` when `has_oauth and has_azure`, otherwise `member`
- [x] 2.2 Hook grants: `grant usage on schema public to supabase_auth_admin`; `grant execute on function public.custom_access_token_hook(jsonb) to supabase_auth_admin`; `revoke execute … from anon, authenticated, public`
- [x] 2.3 `public.is_host()` (stable, security invoker, `search_path = ''`) reading `auth.jwt() -> 'app_metadata' ->> 'app_role'`; `grant execute on function public.is_host() to anon, authenticated`
- [x] 2.4 `public.memberships` table per design D5; RLS enabled + forced; no policies (server-only, same as `reservations`)
- [x] 2.5 Amend `events_select_own`, `events_insert_own`, `events_update_own`, `events_delete_own`, `ticket_types_manage_own`, `orders_select_own_event`, `attendees_select_own_event` to `(select public.is_host()) and <existing predicate>`; leave the two `_select_published` policies unchanged
- [x] 2.6 Columns: `ticket_types.member_price_cents integer null check (>= 0)`, `ticket_types.members_only boolean not null default false`, `orders.user_id uuid null references auth.users on delete set null`, `orders.member_pricing boolean not null default false`
- [x] 2.7 `drop function public.reserve_seat(uuid, integer, integer)`; create `public.reserve_seat(p_ticket_type_id uuid, p_qty integer, p_hold_minutes integer default 15, p_is_member boolean default false)`: `select members_only … for update` on the ticket type before the guarded update; `raise exception 'members_only' using errcode = '42501'` when `members_only and not p_is_member`; oversell guard unchanged; re-issue `revoke … from public, anon, authenticated` and `grant … to service_role` for the 4-argument signature
- [ ] 2.8 Enable `[auth.hook.custom_access_token]` in `supabase/config.toml` pointing at the hook; `supabase db reset` locally and confirm an OAuth-style session token carries `app_role = host` and an OTP session carries `member`
- [x] 2.9 DB test `supabase/tests/roles.test.mjs`: with `request.jwt.claims` set to a member token, `insert into public.events` is denied, draft events are invisible, `attendees`/`orders` return zero rows for an event whose `host_id` is that user, and `memberships` returns zero rows and rejects writes; with a host token the same operations succeed
- [x] 2.10 DB test for the hook using the real `amr` shape (`[{"method":"oauth","timestamp":0}]`): oauth + azure identity → host; otp without azure identity → member; otp / recovery / password with azure identity → error object; token_refresh whose `amr` contains oauth → host
- [x] 2.11 Extend `supabase/tests/reserve_seat.test.mjs`: existing 2- and 3-argument calls still work; members-only refused with SQLSTATE `42501` for `p_is_member` false/default and allowed for true; inventory unchanged after a refusal; existing concurrency/oversell tests still pass

## 3. Viewer helper and host-side role checks

- [x] 3.1 `src/lib/supabase/viewer.ts`: `getViewer()` using `supabase.auth.getClaims()` returning `{ userId, email, role } | null`; a refresh/claims error (including the hook's 403) is treated as signed out and clears the auth cookies; never reads `user_metadata` for role
- [x] 3.2 `src/lib/supabase/session.ts`: redirect `/dashboard/*` unless viewer role is `host` (members → `/`, signed-out → `/login`)
- [x] 3.3 Dashboard pages and actions (`src/app/dashboard/**` including create/edit/settings actions): replace "user exists" checks with "viewer role is host"
- [x] 3.4 `src/components/SiteHeader.tsx`: render `AccountMenu` only for hosts; render a minimal member menu (email, Member badge placeholder, Sign out) for members; nothing new for guests
- [x] 3.5 `src/app/actions/auth.ts`: `signOut` and `signOutEverywhere` redirect hosts to `/login` and members to `/`
- [ ] 3.6 Hosted rollout of group 2: enable the hook on the hosted project, `supabase db push` the single migration, hosts sign out and in; confirm an existing host can still create and edit an event; keep email OTP disabled on the hosted project until 4.6

## 4. Member sign-in

- [ ] 4.1 Email templates (local `[auth.email.template.confirmation]` and `[auth.email.template.magic_link]`, and the matching hosted templates): identical body copy, the 6-digit code (`{{ .Token }}`) as the headline, secondary link to `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email&next=…`; copy reviewed against PRODUCT.md tone
- [ ] 4.2 Configure custom SMTP via Resend on the hosted project and raise the hourly email limit to a congregation-scale value
- [x] 4.3 `src/app/signin/page.tsx` + `actions.ts`: email step → code step on the same page; `signInWithOtp({ email, options: { shouldCreateUser: true } })` then `verifyOtp({ email, token, type: 'email' })`; `next` restricted to same-origin relative paths, default `/`; errors stay on `/signin`; hook 403 rendered as "Staff sign in with Microsoft" with a link to `/login`
- [x] 4.4 `src/app/auth/confirm/route.ts`: accept only `type=email`; `verifyOtp({ token_hash, type: 'email' })`; same `next` rules; error → `/signin?error=code`
- [x] 4.5 After successful verification on both paths, call `verifyMembership` (5.3) before redirecting
- [ ] 4.6 Enable email OTP on the hosted project together with the deploy of groups 3–5
- [ ] 4.7 E2E (Playwright, fake provider): request code → read it from the local inbox → enter on the same page → lands on `next` with a member session; open the link in a fresh browser context → session established; staff email → refused with the Microsoft prompt; member navigating to `/dashboard` → redirected to `/`

## 5. Membership provider seam and verification

- [x] 5.1 `src/lib/membership/provider.ts`: `MembershipStatus`, `MembershipResult`, `MembershipProvider` exactly as in design D4
- [x] 5.2 `src/lib/membership/index.ts` registry (`fake`, `salesforce`) + `activeMembershipProviderId()` with the payments-style fallback rules; `src/lib/membership/fake.ts` driven by `MEMBERSHIP_FAKE_ACTIVE` / `MEMBERSHIP_FAKE_LAPSED`
- [x] 5.3 `src/lib/membership/verify.ts`: `verifyMembership(userId, email)` under a total 5 s budget (retry only if time remains), upsert with `expires_at = now() + 24h`, cached-fallback on failure, `not_found` when no cache, never throws, logs `user_id` only; `getMembership(userId)`; `ensureFreshMembership(viewer)` returning `{ isMember }` (uses cache while `expires_at > now()`)
- [x] 5.4 Unit tests `src/lib/membership/membership.test.ts` (add the file to `test:unit` in `package.json`): fake provider statuses; cache window; failure-with-cache keeps status and row; failure-without-cache yields non-member and does not throw; total budget respected
- [x] 5.5 Member badge in the member header menu driven by `getMembership`; mismatch note copy using `OFFICE_CONTACT_EMAIL`

## 6. Pricing logic and purchase path

- [x] 6.1 `effectivePriceCents(ticket, isMember)` in `src/lib/event-format.ts` with unit tests (member price set / unset / zero; guest vs member); add the test file to `test:unit`
- [x] 6.2 `viewOf(event, { isMember = false, now = new Date() } = {})`: update the positional-`now` callers in `src/app/page.tsx` and `src/app/g/[slug]/page.tsx`; `minPriceCents` and `isFree` from effective prices; members-only types excluded from `availableSeats`/`capacity` for non-members; new `purchasableTypes` (`id`, `name`, `effectivePriceCents`, `membersOnly`, `remaining`) for the viewer; host surfaces (`src/app/dashboard/page.tsx` → `EventRow`, edit page) pass `{ isMember: true }` so hosts see full inventory
- [x] 6.3 Extend the `EventRecord` ticket-type shape and the `SELECT` strings in `src/lib/checkout.ts`, `src/app/e/[id]/actions.ts`, and the event page to include `member_price_cents` and `members_only`
- [x] 6.4 `EventActionBar`: one form listing `purchasableTypes` at effective prices; the selected option's effective price decides whether the form submits to `rsvpToEvent` (0) or `startCheckout` (> 0); single-type events keep today's look
- [x] 6.5 `rsvpToEvent`: resolve viewer → `ensureFreshMembership` → optional `ticketTypeId` (default: first type with effective price 0 for this viewer) → require effective price 0 → `reserve_seat` with `p_is_member` → order with `user_id`, `member_pricing`, `amount_cents = 0`; map SQLSTATE `42501` to the members-only message before the inventory branch; when the fresh check changes the effective price so the request lands on the wrong path, return "Your membership status changed; the page has been refreshed" and `revalidatePath` the event so 7.2 re-renders with the fresh status (same in 6.6)
- [x] 6.6 `startPaidCheckout`: same resolution → require effective price > 0 → `reserve_seat` with `p_is_member` → order with effective `amount_cents`, `user_id`, `member_pricing`; Stripe `customer_email` prefilled from the session when present; same `42501` mapping; ignore any user id or membership claim in form data
- [x] 6.7 Unit test (new checkout test file added to `test:unit`): "members free, guests $25" type routes a member to immediate confirm and a guest to the provider; the provider is never called with amount 0; members-only refusal yields the members-only message, not "not enough spots"
- [x] 6.8 Confirm `confirm_order`, `issueTicketsForOrder`, and `applyPaymentEvent` need no change; add a DB test asserting a later `memberships` status change does not alter a pending order's `amount_cents`

## 7. Host and attendee UI

- [x] 7.1 `EventForm` ticket-type rows: optional member price input and members-only toggle; create/edit actions validate (`>= 0`, integer cents) and persist them
- [x] 7.2 Event page (`src/app/e/[id]/page.tsx`): pass the viewer's membership into `viewOf`; show "Members: $X" + inline "Sign in with your email" link to `/signin?next=/e/<id>` for guests; apply member prices and show the Member badge for active members; show the mismatch note for signed-in non-members; hide members-only types from non-members
- [x] 7.3 Checkout and RSVP forms prefill `email` from the session (editable)
- [ ] 7.4 E2E (fake provider): guest sees both prices and sold-out when only members-only seats remain; member sees member price and the members-only type and completes a $0 member RSVP that issues a ticket; member on a paid type reaches the fake provider at the member price

## 8. Salesforce adapter

- [x] 8.1 `src/lib/membership/salesforce.ts`: JWT bearer token flow (`SF_LOGIN_URL`, `SF_CLIENT_ID`, `SF_USERNAME`, `SF_PRIVATE_KEY` base64 PEM), module-scope token cache with a single refresh on 401
- [x] 8.2 Lookup: normalize email, validate with the app email regex, escape `'` and `\`, SOQL across `Email`, `npe01__HomeEmail__c`, `npe01__WorkEmail__c`, `npe01__AlternateEmail__c`; household-level standing from `SF_MEMBERSHIP_FIELD_MAP`; `active` if any household active, `lapsed` if matched but none, `not_found` if no contact
- [x] 8.3 Unit tests with recorded response fixtures: spouse-on-household case, alternate-field match, hostile email escaping, 0 rows, transport failure throws
- [ ] 8.4 Document env + Connected App setup in README (secrets never committed); add env to the Vercel project
- [ ] 8.5 Verify on the hosted project with one known-active and one known-lapsed member before setting `MEMBERSHIP_PROVIDER=salesforce` in production

## 9. Verification and docs

- [ ] 9.1 `npm run lint`, `npm run test:unit`, `npm run test:db` green; `npm run build` clean
- [ ] 9.2 Manual pass on the hosted preview: host sign-in and event edit unaffected; member sign-in by code from a phone mail app; guest RSVP and guest paid checkout unchanged
- [x] 9.3 Update README (roles, sign-in paths, membership provider config) and PRODUCT.md users section (members as a third audience)
