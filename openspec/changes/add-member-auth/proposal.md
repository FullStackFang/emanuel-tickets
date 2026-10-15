## Why

Temple members pay dues, and the temple wants that to mean something on the events side: member pricing and members-only seats. Today attendees have no identity at all (guest RSVP/checkout by email), so there is no way to know a buyer is a member, and the CRM that knows who is a member (Salesforce) is not connected to the app. Enabling any attendee sign-in is also a security change in disguise: the current database policies grant event-management rights to *every* authenticated user, so "members can sign in" must not silently become "members are hosts".

## What Changes

- **Member sign-in (passwordless)**: an attendee can sign in with their email via a one-time code (magic link as a secondary path). No passwords. Guests can still RSVP and buy without signing in; the guest path is untouched.
- **Membership verification module**: a pluggable `MembershipProvider` (same seam shape as the existing payment provider) that asks the temple's CRM whether the signed-in email belongs to a member in good standing. First adapter is a fake (dev/test); the Salesforce adapter follows. Results are cached per user with an expiry; verification runs at sign-in and is re-checked when stale at checkout. The CRM is the source of truth; the app never decides membership on its own.
- **Member pricing and members-only tickets**: a host can set an optional member price and a members-only flag on a ticket type. Member price is applied server-side from the database, never from the form; the attendee picks a ticket type and the chosen type's effective price decides free RSVP versus paid checkout; members-only inventory is enforced inside the seat-reservation function from a server-supplied membership assertion; the price is snapshotted on the order so a membership lapsing mid-checkout does not change what was charged.
- **Host/member privilege separation (BREAKING for the auth model)**: host rights are derived from *how the session was created* (Microsoft/Entra OAuth), stamped into the access token, and required by every host-side RLS policy and server action. Accounts holding a Microsoft identity get sessions only through Microsoft; email-code and every other non-OAuth sign-in is refused for them. Without this, the first member sign-in would be a host sign-in.
- **Member-aware attendee experience**: a "Member" badge after verification, member price shown inline on the event page with an inline "sign in with your email" prompt (never a gate on viewing the event), members-only availability hidden from non-members. The order records whether member pricing applied so a future host attendee directory (not yet built) can show it.

Assumptions (surfaced for confirmation; see `design.md` for the decisions that flow from them):
- The CRM is **Salesforce with NPSP** (nonprofit contact/household model). The field or report that means "member in good standing" is a temple decision and is configurable, not hard-coded.
- **Email match is sufficient proof** of membership: the one-time code proves control of the inbox, and the CRM has that email on file. There is no self-serve "verify another way" (last name + ZIP, member ID) in this change, because every such fallback can be answered from public information and lets anyone claim any household. Mismatches are routed to the office.
- Membership unlocks **pricing and members-only tickets** in this change. Nothing else (member directory, member-only content) is in scope.
- Guests do **not** get a "my tickets" account view in this change; tickets continue to be delivered by email/QR.

## Capabilities

### New Capabilities
- `member-auth`: Passwordless one-time-code sign-in for attendees, the session role model that separates members from hosts, and refusal of any non-Microsoft session for staff accounts.
- `membership-verification`: The `MembershipProvider` contract, the cached membership record per user, when verification runs and how staleness and CRM outages are handled, and the Salesforce adapter's matching rules.
- `member-pricing`: Member price and members-only flags on ticket types, server-side price selection, members-only enforcement at the reservation function from a server-supplied assertion, order price snapshot, and member-aware availability display.

### Modified Capabilities
`openspec/specs/` is empty; these capabilities are defined in the not-yet-archived `add-event-ticketing` change and their requirements change here. Delta specs are provided.
- `host-auth`: "Event management requires an authenticated host session" tightens to "requires a session whose identity was established by Microsoft/Entra OAuth"; an authenticated non-host session is denied. (The staff-session refusal itself is specified under `member-auth`.)
- `attendee-access`: Host RLS policies (events, ticket types, orders, attendees) additionally require the host role claim, so an authenticated member cannot create events or read any attendee data. New `memberships` table is server-only (no browser-role policies at all).

## Impact

- **Database**: one new migration — custom access token hook function (+ grants to `supabase_auth_admin`), `is_host()` SQL helper (+ grants), `memberships` table (RLS on, forced, no policies), every existing host policy amended to require `is_host()`, `ticket_types.member_price_cents` and `ticket_types.members_only`, `orders.user_id` and `orders.member_pricing`, and `reserve_seat` dropped and recreated with a membership-assertion parameter and a members-only check using a distinct error code. Regression tests in `supabase/tests/` for the privilege boundary and the hook.
- **Supabase Auth config**: enable the custom access token hook (role claim), enable email OTP, both email templates (confirm signup, magic link) carrying the code and a `token_hash` link, custom SMTP via Resend (hosted default email rate limit is too low for a congregation-wide announcement), and a `token_hash` confirm route for links opened in a mail app's in-app browser.
- **App code**: `src/lib/membership/` (provider seam, fake + Salesforce adapters, cache logic); `src/app/signin/` (attendee sign-in); `src/app/auth/confirm/` route; `getViewer()` and role checks in `proxy`/`session.ts`, dashboard actions, `SiteHeader`, and sign-out; an `effectivePriceCents` helper, a `viewOf` options signature, and per-ticket-type routing used by `rsvpToEvent`, `startPaidCheckout`, and `EventActionBar`; event form fields for member price / members-only.
- **New environment**: Salesforce Connected App credentials (`SF_LOGIN_URL`, `SF_CLIENT_ID`, `SF_USERNAME`, `SF_PRIVATE_KEY` base64), `SF_MEMBERSHIP_FIELD_MAP`, `MEMBERSHIP_PROVIDER` (`fake` | `salesforce`), `MEMBERSHIP_FAKE_ACTIVE` / `MEMBERSHIP_FAKE_LAPSED` for dev, `OFFICE_CONTACT_EMAIL`. Provisioning the Connected App is a temple-side task.
- **Breaking**: any policy or action that previously worked for "any authenticated user" now requires the host claim. The hook is enabled on the hosted project before the migration is pushed, and hosts sign out and in once so their token carries the claim. No data migrates.
- **Not in scope**: standalone verification service (the provider contract is written so it can be extracted later), ShulCloud or other CRM adapters, member directory, host attendee directory, nightly roster sync.
