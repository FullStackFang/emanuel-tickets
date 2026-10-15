## Context

Emanuel Events runs on Next.js 16 (App Router, `proxy.ts`), Supabase Auth + Postgres with RLS as the primary authorization boundary, Stripe for paid checkout, and Resend for email. Two audiences exist today:

- **Hosts** (temple staff) sign in with Microsoft via Supabase's `azure` provider (single-tenant Entra app). `events.host_id = auth.uid()` is the ownership key. Every host RLS policy is written `to authenticated` with an ownership predicate only (`supabase/migrations/20260917143042_ticketing_rls.sql`). The route guard (`src/lib/supabase/session.ts`), dashboard actions, and `SiteHeader` all test "is there a user", not "is this user a host".
- **Attendees** have no identity. RSVP and checkout are guest flows by name + email (`src/app/e/[id]/actions.ts`, `src/lib/checkout.ts`) that run server-side with the service-role client and the `SECURITY DEFINER` inventory functions (`reserve_seat`, `confirm_order`). The RSVP form posts no ticket type; the action picks any `price_cents = 0` type. The paid form lists types with `price_cents > 0`.

The temple's membership records live in Salesforce (NPSP). Nothing in the app knows who is a member. There is no host attendee directory yet (the `add-event-ticketing` tasks for it are open), so nothing in this change may depend on one.

Two facts shape everything below:

1. **Enabling any attendee sign-in with the current policies makes every attendee a host at the database layer.** A member's session is `authenticated`; with the publishable key in the browser they could insert events, add ticket types, and read orders/attendees of those events via PostgREST. This must be closed in the same migration that enables anything member-related.
2. **Hosts and members share one `auth.users` pool.** Supabase links identities by verified email. A staff mailbox must not become a password-free back door into a host account via email code, and a congregant who later joins staff must not be stuck as a "member".

## Goals / Non-Goals

**Goals:**
- Members can sign in with their email alone (one-time code; magic link secondary) and be recognized as members when the CRM says they are in good standing.
- Membership unlocks member pricing and members-only ticket types, enforced server-side and at the reservation function, with the charged price snapshotted on the order.
- Host privileges are derived from how the session was created (Microsoft OAuth) and required by every host policy and host action. A member session can never create events or read attendee data.
- The CRM integration is a replaceable module with a fake adapter for development and tests, and a contract that could later be served by a standalone service.
- The guest path (no account) is unchanged in behavior and friction.

**Non-Goals:**
- A standalone verification service or admin console (the contract is written so one can be extracted later; nothing is built).
- A member directory, member-only content, household management, a "my tickets" account view, or a host attendee directory (the order records what a future directory needs).
- Any CRM other than Salesforce NPSP (the seam allows more; none are built).
- Nightly roster sync into the app. The app caches per-user verification results, not the roster.
- Self-serve identity proofing beyond email (last name + ZIP, member ID). Mismatches go to the office.

## Decisions

### D1 — Role is a per-session claim derived from the authentication method, not a per-user flag

**Decision.** Enable Supabase's custom access token hook (`auth.hook.custom_access_token`, currently a commented stub in `supabase/config.toml`). The hook, `public.custom_access_token_hook(event jsonb)`, does three things:

1. Computes `has_oauth := jsonb_path_exists(event->'claims'->'amr', '$[*] ? (@.method == "oauth")')`. The `amr` claim is an array of objects (`[{"method":"oauth","timestamp":…}]`), not strings; a `?` containment test on the string `'oauth'` is always false and would silently demote every host.
2. Computes `has_azure := exists (select 1 from auth.identities where user_id = (event->>'user_id')::uuid and provider = 'azure')`.
3. If `has_azure and not has_oauth`: returns `{"error": {"http_code": 403, "message": "Staff sign in with Microsoft"}}`. This covers `otp`, `magiclink`, `recovery`, `password`, and `email/signup` grants alike: an account that holds a Microsoft identity gets a session only through Microsoft. Otherwise it sets `claims.app_metadata.app_role` to `'host'` when `has_oauth and has_azure`, else `'member'`, and returns the event.

Grants: `grant usage on schema public to supabase_auth_admin; grant execute on function public.custom_access_token_hook(jsonb) to supabase_auth_admin; revoke execute on function public.custom_access_token_hook(jsonb) from anon, authenticated, public;`.

**Why.** `amr` is stored per session and survives token refresh (`authentication_method = token_refresh` still carries the original `oauth` entry), so the claim is stable for the life of a host session and absent from every email-code session, even for the same `auth.users` row. A stored flag (profiles table, `app_metadata` on the user, or a trigger on `auth.users`) would be per-user and therefore wrong in both directions: it would let a staff mailbox sign in by code and inherit host rights, and it would freeze a congregant-turned-staff as a member. Refusing non-OAuth sessions for staff accounts in the hook enforces the host-auth spec ("hosts SHALL authenticate via Azure") at token issuance rather than in UI copy. A side effect is intended: if a member's account later gains a Microsoft identity, their existing member session is refused at its next refresh.

**Alternatives considered.** (a) `profiles.role` set by an `auth.users` insert trigger using `raw_app_meta_data.provider` — rejected: provider records only the *first* identity, a failing trigger blocks all sign-ups, and the project already chose "no profiles table" (`src/lib/host.ts`). (b) Separate Supabase projects for hosts and members — rejected: doubles infrastructure for a two-role app and breaks the single `events.host_id` FK.

**Server-side reading.** A new `getViewer()` helper (`src/lib/supabase/viewer.ts`) reads the verified JWT via `supabase.auth.getClaims()` (present in the installed auth-js) and returns `{ userId, email, role: 'host' | 'member' } | null`. A refresh error (including the hook's 403) is treated as signed out and the auth cookies are cleared so the browser does not loop. `user_metadata` is never consulted for role. The proxy, dashboard actions, event form actions, `SiteHeader`, `signOut`, and `signOutEverywhere` switch to it. Note: on a project still using the HS256 shared secret, `getClaims()` falls back to a `getUser()` round-trip; enabling asymmetric signing keys on the hosted project removes that cost but is not required for correctness.

**Identity linking prerequisite.** The "congregant-turned-staff" case relies on Supabase linking the `azure` identity onto an existing email-code user, which requires Entra to return the email as verified (the `xms_edov` optional claim). This is confirmed with a throwaway account before email sign-in is enabled on the hosted project (tasks 1.4).

### D2 — `is_host()` is required by every host RLS policy

**Decision.** Add `public.is_host()` (`stable`, `security invoker`, `set search_path = ''`): returns `coalesce((select auth.jwt() -> 'app_metadata' ->> 'app_role'), '') = 'host'`. Grant execute to `anon, authenticated` (new functions in `public` are not auto-exposed; the function runs inside policies evaluated for every authenticated reader, so a missing grant would break member reads too). Amend every existing host policy (`events_select_own`, `events_insert_own`, `events_update_own`, `events_delete_own`, `ticket_types_manage_own`, `orders_select_own_event`, `attendees_select_own_event`) to `(select public.is_host()) and <existing ownership predicate>`, matching the `(select auth.uid())` idiom. `events_select_published` and `ticket_types_select_published` are unchanged (members must still read published events).

**Why.** The attendee-access spec names the database as the primary authorization boundary. A UI/route check alone would leave PostgREST open. Amending the named policies (rather than adding `AS RESTRICTIVE` overlays) keeps one policy per intent and is grep-able.

**Verification.** A `supabase/tests/roles.test.mjs` DB test sets `request.jwt.claims` to a member token (`app_metadata.app_role = 'member'`) and asserts `insert into public.events` is denied, draft events are invisible, and `select from public.attendees` / `orders` returns zero rows for an event whose `host_id` equals that user; the same with a host token succeeds. Hook unit cases use the real `amr` shape (`[{"method":"oauth","timestamp":0}]`): oauth + azure identity → host; otp without azure identity → member; any non-oauth method with azure identity → error object; `token_refresh` whose `amr` contains oauth → host. Nothing membership-related ships before these pass.

### D3 — One-time code is the primary member sign-in; magic link uses a `token_hash` confirm route

**Decision.** `src/app/signin/` is the attendee sign-in page (distinct from `/login`, which stays host-only). It calls `signInWithOtp({ email, options: { shouldCreateUser: true } })`, then shows a 6-digit code field on the same page and verifies with `verifyOtp({ email, token, type: 'email' })`. Two Supabase email templates are involved (first-time emails use the *Confirm signup* template, returning users the *Magic Link* template); both put the code (`{{ .Token }}`) as the headline and a secondary link to a new route `src/app/auth/confirm/route.ts?token_hash={{ .TokenHash }}&type=email&next=…`, which calls `verifyOtp({ token_hash, type: 'email' })` and accepts only `type=email` so recovery or email-change links cannot establish sessions through it. The page accepts a `next` query parameter restricted to same-origin relative paths and defaults to `/`. Errors redirect to `/signin`, never `/login`. The hook's 403 is rendered as "Staff sign in with Microsoft" with a link to `/login`.

**Why.** The existing `/auth/callback` route only handles `?code=` via `exchangeCodeForSession`, which needs the PKCE verifier cookie set by the browser that *requested* the link. The target audience (older users on phones) opens links in a mail app's in-app browser, which has a different cookie jar, so PKCE magic links fail for exactly the people this is for. A typed code has no cross-browser dependency. The `token_hash` route makes the link path work without PKCE as well.

**Email delivery.** Configure Supabase custom SMTP via Resend (already a dependency) before launch. The hosted default sender's hourly email limit is far below what a congregation-wide announcement produces.

### D4 — `MembershipProvider` is a provider seam shaped like the payments seam

**Decision.** `src/lib/membership/` mirrors `src/lib/payments/`:

```ts
// provider.ts
export type MembershipStatus = 'active' | 'lapsed' | 'not_found'
export type MembershipResult = {
  status: MembershipStatus
  externalId: string | null   // CRM contact or household id; opaque to the app
  checkedAt: Date
}
export interface MembershipProvider {
  readonly id: string
  lookup(input: { email: string }): Promise<MembershipResult>   // throws on transport failure
}
```

`index.ts` has a registry (`fake`, `salesforce`) selected by `MEMBERSHIP_PROVIDER`, with the same fallback rules as `activeProviderId()` (fake outside production, loud error in production if unset). `fake.ts` reads `MEMBERSHIP_FAKE_ACTIVE` / `MEMBERSHIP_FAKE_LAPSED` (comma-separated emails) so dev and E2E can exercise every status without a CRM.

**Why.** The repo already has this pattern and it has held up through a Stripe/fake split. The normalized result type is deliberately small: it is the contract a future standalone verifier would return, so extraction later is a transport change, not a redesign. Lookup is by email only (see D7).

**Alternatives considered.** A nightly export of all active members into Postgres — rejected for v1: it stores the whole roster (PII the app has no other use for), needs a sync job regardless, and is up to a day stale. The cache in D5 keeps the benefits (no CRM on the hot path) without the roster.

### D5 — Verification results are cached per user, server-only; re-checked at sign-in and when stale at checkout

**Decision.** One new table:

```sql
create table public.memberships (
  user_id     uuid primary key references auth.users (id) on delete cascade,
  provider    text not null,
  external_id text,
  status      text not null check (status in ('active', 'lapsed', 'not_found')),
  verified_at timestamptz not null,
  expires_at  timestamptz not null
);
```

RLS enabled and forced with **no policies**, exactly like `reservations`: browser roles are fully denied, and all reads and writes go through the service-role client in server code. Nothing in the UI reads this table from the browser. `expires_at = verified_at + 24h` and means "re-check by", nothing more.

`src/lib/membership/verify.ts` exposes:
- `verifyMembership(userId, email)`: calls the provider under a **total** 5-second budget (one retry only if time remains), upserts the row on success, and on transport failure leaves the row untouched. Returns the status to use for this request: the fresh result, else the cached row's status, else `not_found`. Never throws to the caller. Logs `user_id`, never email.
- `getMembership(userId)`: reads the cached row (for the badge and the mismatch note).
- `ensureFreshMembership(viewer)`: returns `{ isMember: boolean }` for a purchase: uses the cached row if `expires_at > now()`, otherwise calls `verifyMembership`. This is the one function the purchase path consults.

It runs: (1) immediately after a successful code/link verification; (2) inside `rsvpToEvent` / `startPaidCheckout` when the viewer is signed in. CRM failure never blocks RSVP or checkout; with a cached `active` row the member keeps member benefits for the request, and with no row they are a guest for the request.

**Why.** Sign-in and checkout are the only moments membership matters, so those are the only moments to spend a CRM call. A scheduled re-verification job would add a cron, a batch of CRM calls, and a failure mode, for no user-visible benefit. There is deliberately **no** SQL-side `is_active_member()` lookup: the server is the only trusted caller of the reservation path, a second source of truth in SQL would disagree with the cached-fallback rule above during an outage (an expired-but-cached row would be "active" to the app and "inactive" to SQL), and it buys no security because the server already supplies the user id.

**PII.** Only `external_id` and `status` are stored. Raw CRM payloads are never persisted. Logs carry `user_id`, never email.

### D6 — Member pricing is a server-side price selection plus a members-only assertion inside `reserve_seat`

**Decision.**
- `ticket_types` gains `member_price_cents integer check (member_price_cents >= 0)` (nullable: null means no member price) and `members_only boolean not null default false`.
- `orders` gains `user_id uuid references auth.users (id) on delete set null` (set whenever the buyer is signed in) and `member_pricing boolean not null default false`, which means "the effective price came from `member_price_cents`", not "the buyer was a member".
- `reserve_seat` is **dropped and recreated** (a `create or replace` with a new parameter list would create a second overload, make `reserve_seat(uuid, integer)` ambiguous for every existing caller, and leave the new signature without its `service_role` grant): `drop function public.reserve_seat(uuid, integer, integer); create function public.reserve_seat(p_ticket_type_id uuid, p_qty integer, p_hold_minutes integer default 15, p_is_member boolean default false) …` followed by the same `revoke … from public, anon, authenticated` and `grant … to service_role` for the 4-argument signature. Inside, before the guarded `update`, it reads `members_only` with `select … for update` on the ticket type row, and if `members_only and not p_is_member` raises `'members_only'` **with `errcode = '42501'`** so it cannot be mistaken for the `P0001` inventory failure. The existing oversell guard and CHECK constraint are untouched. Existing 3-argument call sites keep working through the default.
- The TypeScript call sites check `code === '42501'` (members-only) **before** the existing `P0001` / `insufficient_inventory` branch and map it to "This ticket is for members. Sign in with your member email to reserve it." `p_is_member` is passed from `ensureFreshMembership(viewer)`, never from form data.
- A single pure helper `effectivePriceCents(ticket, isMember)` in `src/lib/event-format.ts` returns `member_price_cents` when `isMember` and it is set, else `price_cents`. `viewOf` changes to `viewOf(event, { isMember = false, now = new Date() } = {})` (two callers pass `now` positionally today and are updated). It uses the helper for `minPriceCents` and `isFree`, excludes members-only types from `availableSeats` and `capacity` for non-members, and exposes `purchasableTypes: Array<{ id, name, effectivePriceCents, membersOnly, remaining }>` for the viewer. Host surfaces (the dashboard list via `EventRow`, the edit page) call `viewOf(event, { isMember: true })` so a host always sees full inventory for their own event; only public surfaces use the default.
- **Routing is per selected ticket type.** `EventActionBar` renders one form listing `purchasableTypes` at their effective prices; the chosen option's effective price decides which action the form submits to (0 → `rsvpToEvent`, > 0 → `startCheckout`). `rsvpToEvent` gains an optional `ticketTypeId`; when absent it picks the first type whose effective price for this viewer is 0 (preserving today's behavior for all-free events). Both actions re-derive the effective price server-side from the database and the verified viewer, refuse if it lands on the wrong path (`rsvpToEvent` requires 0, `startPaidCheckout` requires > 0), call `reserve_seat` with `p_is_member`, and insert the order with `amount_cents` from the effective price, `user_id`, and `member_pricing`.
- `confirm_order`, `issueTicketsForOrder`, and `applyPaymentEvent` are unchanged: they operate on the order's stored `amount_cents`, so a membership lapsing between checkout and webhook changes nothing. This is the price snapshot. A `$0` member order follows exactly the free-RSVP path (immediate `confirm_order`, ticket issuance, email).

**Why.** Today `isFree` is event-wide, the RSVP form carries no ticket type, and `startPaidCheckout` rejects `price_cents = 0`; a "members free, guests $25" type would either be unreachable or send `unit_amount: 0` to Stripe, which Stripe rejects. Routing on the effective price of the selected type is the smallest change that makes that case work. Doing the members-only check inside `reserve_seat` keeps enforcement next to the inventory lock and fails closed for any future caller that forgets to assert membership (the default is `false`). A host toggling `members_only` concurrently with a reservation is benign: the `for update` read serializes on the same row the guarded update locks.

### D7 — Salesforce adapter: server-to-server JWT bearer flow, email-only match, household-level standing

**Decision.** `src/lib/membership/salesforce.ts`:
- **Auth.** OAuth 2.0 JWT bearer flow against a Connected App with a dedicated integration user. Env: `SF_LOGIN_URL`, `SF_CLIENT_ID`, `SF_USERNAME`, `SF_PRIVATE_KEY` (base64-encoded PEM, decoded at startup). The access token is cached in module scope until Salesforce returns 401, then refreshed once. One token per cold start, not per lookup.
- **Match.** Normalize the email (trim, lowercase). Query NPSP contacts where any of `Email`, `npe01__HomeEmail__c`, `npe01__WorkEmail__c`, `npe01__AlternateEmail__c` equals it. SOQL has no bind parameters over REST: the email is validated against the app's email regex first and escaped (`'` and `\`) before interpolation.
- **Standing.** Evaluate at the household (`AccountId`) level so a spouse whose email is on the Contact but whose partner pays the dues is still a member. The field and value that mean "in good standing" come from `SF_MEMBERSHIP_FIELD_MAP` (JSON: object, status field, active values, optional end-date field) because this is a temple configuration decision, not a code decision. Multiple matching contacts: active if any household is active.
- **Failure.** Network/5xx/timeout → throw (caller applies D5's cached-fallback rule). 0 rows → `not_found`. Matched but not active → `lapsed`.

**Why.** JWT bearer is the Salesforce-sanctioned headless flow and needs no interactive consent after one-time setup. Email mismatch is the common case in NPSP data, so matching across all email fields and evaluating per household avoids the most frequent false "not a member". Nonprofit Salesforce editions have low daily API limits, which is why the token is cached and lookups are limited to sign-in and stale checkout.

**Temple-side prerequisites.** Create the Connected App, upload the certificate, pre-authorize the integration user via permission set, and decide the field map. These are listed as blocking tasks, not assumed.

### D8 — Member-aware UI, with no gate on viewing

**Decision.**
- The event page shows guest price and, when a ticket type has a member price, "Members: $X" with an inline "Sign in with your email" link that returns to the same event (`/signin?next=/e/<id>`). Signed-in active members see the member price applied and a "Member" badge. Signed-in non-members (status `lapsed`/`not_found`) see guest pricing and a one-line note: "We couldn't match this email to a membership. Email the office at <OFFICE_CONTACT_EMAIL> and we'll update your record." The address comes from the `OFFICE_CONTACT_EMAIL` env var.
- Members-only ticket types are hidden from non-members, and their seats are excluded from "N spots left".
- `SiteHeader` renders the host `AccountMenu` only for `role === 'host'`; members get a minimal menu (email, Member badge when active, Sign out). `signOut` and `signOutEverywhere` redirect hosts to `/login` and members to `/`.
- Host event form: per ticket type, optional member price and a members-only toggle.
- Checkout prefills `buyer_email` (and Stripe `customer_email`) from the session when signed in; the field stays editable.
- No attendee directory work: `orders.member_pricing` is recorded so the future directory can show a tag.

**Why.** PRODUCT.md: the event page is a front door, not a form; the guest path must stay frictionless; copy is warm and plainspoken. Membership is an upgrade offered in place, not a wall.

## Risks / Trade-offs

- [Hosts' existing tokens predate the hook and lack the claim] → The hook is enabled on the hosted project before the migration is pushed; tokens refresh within `jwt_expiry` (3600 s) and the handful of hosts are asked to sign out and in. Rollback is "disable hook, reapply the previous policy definitions".
- [Hook bug (for example the `amr` shape) demotes every host] → The hook has DB unit cases with the real `amr` shape and is exercised locally (`supabase db reset`) before enabling on the hosted project. Supabase surfaces hook errors as sign-in failures, not silent misissuance.
- [Entra does not mark emails verified, so staff identity linking fails] → Confirmed with a throwaway account before email sign-in is enabled (tasks 1.4). The outcome when linking does not occur (a second account, or a refused Microsoft sign-in) is determined by that test, not assumed here; if it is not the linked case, decide then whether to manually link or delete the email-code account for that staff member.
- [CRM down at sign-in or checkout] → Cached status wins for the request; with no cache, the viewer is a guest for that request and sees guest pricing. Never blocks RSVP/checkout. Bounded by a total 5-second budget. Logged with `user_id`.
- [Email on file differs from the email the member uses] → Match across all NPSP email fields; otherwise the office updates the record. This is a known cost of refusing self-serve proofing (D4/D7), accepted to prevent household spoofing.
- [Member price of $0 on a paid event] → Routed through the immediate-confirm path by effective price of the selected type (D6); covered by a unit test so it cannot regress to a $0 Stripe session.
- [Membership lapses mid-checkout] → Price snapshotted on the order at reservation time; `confirm_order` does not re-verify. A lapsed member who reserved at member price keeps that price for that order.
- [Members-only refusal shown as "not enough spots"] → Distinct errcode `42501` checked before the inventory branch; covered by a DB test and an action-level unit test.
- [Email sending throttled during a mass sign-in] → Custom SMTP via Resend with a raised hourly limit is a launch prerequisite task, not an afterthought.
- [Two email templates (confirm signup, magic link) drift] → Both are set in the same task with identical body copy; the code is the headline, the link is the secondary line ("or tap here"). Copy reviewed against PRODUCT.md tone.
- [SOQL injection via the email string] → Regex-validated and escaped before interpolation; covered by a unit test with a hostile email.
- [`auth.users` row created for every email that requests a code, even typos] → Accepted: it is how Supabase OTP works with `shouldCreateUser`. Rows carry no membership data until verification succeeds; orphan rows are harmless.
- [`getClaims()` costs an extra round-trip on HS256 projects] → Accepted for v1; enabling asymmetric signing keys on the hosted project removes it later with no code change.

## Migration Plan

1. **Prerequisite.** Ensure `openspec/specs/host-auth` and `openspec/specs/attendee-access` exist (archive `add-event-ticketing` or sync its specs) before this change is archived; implementation can proceed before that.
2. **One migration file** (`supabase/migrations/<ts>_member_auth.sql`): hook function + grants; `is_host()` + grants; `memberships` (RLS on, forced, no policies); amended host policies; `ticket_types` / `orders` columns; drop-and-recreate `reserve_seat` with grants. Verified locally with `supabase db reset` plus `supabase/tests/roles.test.mjs` and the existing `reserve_seat` tests before it is pushed anywhere.
3. **Hosted rollout.** Enable the custom access token hook on the hosted project (dashboard/config), then `supabase db push`, then ask hosts to sign out and in. Confirm an existing host can still create and edit an event. Email OTP stays disabled on the hosted project until step 4.
4. **App deploy 1.** `getViewer()`, role checks in proxy/actions/header, `/signin`, `/auth/confirm`, both email templates, custom SMTP, fake adapter, `verifyMembership`, Member badge. Enable email OTP on the hosted project with this deploy.
5. **App deploy 2.** `effectivePriceCents`, `viewOf` options, purchasable-type routing in the action bar and actions, event form fields, availability filtering.
6. **App deploy 3.** Salesforce adapter behind `MEMBERSHIP_PROVIDER=salesforce` once the Connected App and field map exist. Verify with one known-active and one known-lapsed member before announcing.

**Rollback.** Disable the hook and apply a hand-written down-migration that restores the seven prior policy definitions and the 3-argument `reserve_seat` (steps 2–3; write the down-migration alongside the up-migration so it exists before push); set `MEMBERSHIP_PROVIDER=fake` with empty lists (6); the `/signin` route and OTP toggle can be removed without touching host auth.

## Open Questions

- **Which Salesforce field or report means "member in good standing"?** The code reads a field map; the temple must name the object, field, and active values (and whether a null end date means current). Blocking for step 6 only.
- **Should members-only exist at the event level too?** This design puts it on ticket types only (an event with only members-only types is effectively members-only). Promote to the event if hosts find per-type toggles confusing.
- **Office contact for mismatches.** `OFFICE_CONTACT_EMAIL` needs a real value before deploy 1.
- **Should the member price be visible to signed-out visitors?** This design says yes ("Members: $X") because it is the nudge to sign in and hides nothing sensitive. Confirm with the temple.
