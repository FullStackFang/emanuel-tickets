# Account and signup lifecycle for guests and members

Status: design recommendation (no code changed). Date: 2026-10-15.
Scope: who has an account, how one comes to exist, what it holds, how membership is validated from the attendee's side, and what the office does when the CRM disagrees. Builds on `openspec/changes/add-member-auth/` (implemented locally, **not yet rolled out to the hosted project**: tasks 3.6, 4.1, 4.2, 4.6 are open).

---

## 0. Where things stand (grounded in code)

| Fact | Where |
|---|---|
| Any email can get a session; first verification creates the `auth.users` row (`shouldCreateUser: true`). There is no separate "sign up". | `src/app/signin/actions.ts` (`requestCode`) |
| Every non-host session gets token role `member`, whether or not they pay dues. | hook in `supabase/migrations/20261014120000_member_auth.sql` (`case when v_has_oauth and v_has_azure then 'host' else 'member' end`); `src/lib/supabase/viewer.ts` (`ViewerRole = 'host' \| 'member'`) |
| Dues status is separate, a server-only cache in `public.memberships` (RLS forced, no policies), 24h re-check. | same migration; `src/lib/membership/verify.ts` |
| Guest orders carry `buyer_email` (typed, unverified) and, when signed in, `orders.user_id`. Older guest orders have `user_id = null` forever. | `supabase/migrations/20260917142944_ticketing_schema.sql`; `src/lib/checkout.ts:92`, `src/app/e/[id]/actions.ts:97` |
| Each seat is an `attendees` row copying buyer name/email (no per-seat names). | `confirm_order` in `20260917143014_ticketing_functions.sql` |
| Ticket QR tokens are random and **only the hash is stored**; the raw token exists only in the email and the one-time RSVP success response. | `src/lib/ticket-token.ts`, `src/lib/tickets.ts`, `20260917154529_attendee_tickets.sql` |
| Mismatch UX is a one-line note with a mailto to `OFFICE_CONTACT_EMAIL`, shown only on events that have a member offer. | `src/components/MemberBits.tsx`, `src/app/e/[id]/page.tsx:203-211` |
| Signed-in non-host header shows email + badge + Sign out. No account page. | `src/components/SiteHeader.tsx` |
| Local auth rate limits: `email_sent = 2`/h, `max_frequency = "1s"`, `otp_expiry = 3600`, per-IP `sign_in_sign_ups = 30`/5 min. No captcha. | `supabase/config.toml` lines 197-234 |

The gap the user flagged is real: the system has *sign-in* but no *account lifecycle* (claiming history, profile, consent, deletion, office handling), and its vocabulary calls every signed-in person a "member".

---

## 1. Identity model

### Four personas, two orthogonal axes

| Persona | Session? | Token `app_role` | Membership (from `memberships`) |
|---|---|---|---|
| Guest | none | - | n/a |
| Signed-in attendee | email code | `attendee` | `not_found` / `lapsed` / none yet |
| Verified member | email code | `attendee` | `active` |
| Host (staff) | Microsoft OAuth | `host` | may also be `active` (see 7.5) |

Axis 1 is **how you authenticated** (decides host rights; lives in the token, per D1).
Axis 2 is **what the CRM says about your email** (decides price and members-only access; lives in `memberships`, never in the token).

### Recommendation: rename the token role `member` to `attendee` now

- **Why now:** the hook has not been enabled on the hosted project (tasks 2.8/3.6 open), so no live token carries `member`. The rename is free today and expensive after launch. Leaving it creates a permanent trap: any future code that writes `viewer.role === 'member'` to mean "dues-paying" will grant member pricing to everyone who has signed in.
- **Keep membership out of the token.** D5 already argues against a SQL-side membership source of truth; a JWT claim would add a third, staler copy (tokens live up to `jwt_expiry` = 1h and are refreshed without a CRM call). The server consults `ensureFreshMembership()`; that is correct.
- **RLS impact: none.** `public.is_host()` only tests `= 'host'`; no policy references `member`.

File-level change list for the rename:

| File | Change |
|---|---|
| `supabase/migrations/20261014120000_member_auth.sql` | `else 'member'` becomes `else 'attendee'`. Edit in place **only if** it has not been pushed to any shared/hosted DB; otherwise a new migration with `create or replace function public.custom_access_token_hook`. Update the header comment. |
| `supabase/tests/roles.test.mjs` (lines 77, 117) | fixtures/assertions `'member'` to `'attendee'` |
| `src/lib/supabase/viewer.ts` | `ViewerRole = 'host' \| 'attendee'`; comment. Mapping already defaults everything non-host, so no transition shim is needed. |
| `src/components/SiteHeader.tsx` (lines 27, 48) | `viewer?.role === 'attendee'` (or simply `viewer && viewer.role !== 'host'`) |
| `src/lib/membership/membership.test.ts:23` | fixture role |
| `openspec/changes/add-member-auth/specs/member-auth/spec.md`, `design.md` D1, README, PRODUCT.md "Members" bullet | vocabulary: "attendee session", "verified member" |

`src/lib/supabase/session.ts` and `src/app/actions/auth.ts` only test `=== 'host'` / `!== 'host'` and need no change.

Optionally add a typed helper in `viewer.ts`: `getMemberStatus(viewer)` returning `'active' | 'lapsed' | 'not_found' | 'unknown'` from `getMembership`, so pages stop each reading the row ad hoc (`page.tsx`, `SiteHeader.tsx`). Small, not required.

---

## 2. Guest signup

### Recommendation: accountless by default; one passwordless account offered *after* the fact; past orders auto-claimed by verified email

1. **The guest path stays exactly as it is.** No account prompt before RSVP/purchase. (PRODUCT.md: "guests keep the no-account path".)
2. **No separate "Sign up" concept or page.** "Sign in with your email" is both; first verification creates the account. Copy on `/signin`: "First time? Same thing. We'll set you up." Keep `shouldCreateUser: true`: it is also what prevents account enumeration (7.1).
3. **Post-purchase offer, not a gate.** On the RSVP success panel (`EventActionBar` success state) and `src/app/checkout/[orderId]/page.tsx` confirmed state, for signed-out buyers only: "Want to find these tickets later? Sign in with *{buyer_email}* and we'll keep them in one place." Link to `/signin?next=/account` with the email pre-filled (pass via a short-lived cookie or form POST rather than a query string, to keep addresses out of logs/referrers).
4. **Claim on verify.** Immediately after a successful `verifyOtp` (both `src/app/signin/actions.ts` and `src/app/auth/confirm/route.ts`, next to the existing `verifyMembership` call), run one idempotent update:

```sql
update public.orders
   set user_id = $uid
 where user_id is null
   and lower(buyer_email) = lower($verified_email);
```

Wrap it in a `SECURITY DEFINER` function `public.claim_orders_for_user(p_user_id uuid, p_email text)` granted to `service_role` only, called from server code with `data.user.id` / `data.user.email` from the verify response (never form input). Add `create index orders_buyer_email_lower_idx on public.orders (lower(buyer_email)) where user_id is null;`.

Do this as a **persisted backfill**, not a read-time `user_id = me or buyer_email = my email` query: the link survives a later email change, and "my tickets" is a simple indexed `user_id` query.

### Security of claiming by email

- **What the OTP proves:** control of that inbox now. **What `buyer_email` proves:** nothing; it was typed. So the question is "does claiming reveal anything the inbox owner didn't already get?" No: `issueTicketsForOrder` already emailed every ticket for that order to `buyer_email` (`src/lib/tickets.ts:96`). The inbox owner *already holds* the tickets. Claiming only organizes what they have. That is the argument that makes email-based claiming safe here, and it holds only as long as tickets are always emailed to `buyer_email`. Keep that invariant; write it into the spec.
- **Typos:** if a buyer typed `jane@gmial.com`, the tickets went to that address too. The real buyer never gets them in "My tickets" (correct: they can't prove the email) and the typo owner already got the emails. No new exposure. The fix for the real buyer is office-assisted (re-send to the correct address), same as today.
- **Shared family inbox:** one inbox, one account, all orders sent to it. This matches how the household already experiences email tickets. Acceptable; do not build per-person splitting.
- **Do not claim by name, phone, or CRM household.** Household-level claiming (spouse sees spouse's tickets because Salesforce says same household) would leak purchases across people who may not share them (adult children, separated spouses). Rejected.
- **Host sessions:** claim also for host sessions (Entra emails are verified once `xms_edov` is confirmed, task 1.4). If 1.4 shows the email is not marked verified, skip claiming for `host` role.

---

## 3. Profile data

### Recommendation: no profile table in MVP; a thin `attendee_profiles` later; Salesforce is the system of record for people

**MVP:** prefill name from the viewer's most recent order (`select buyer_name from orders where user_id = $1 order by created_at desc limit 1`), email from the session (already done, task 7.3). That is all the RSVP/checkout forms need. No new PII store.

**Phase 2** (only when there is a second field worth keeping):

```sql
create table public.attendee_profiles (
  user_id            uuid primary key references auth.users (id) on delete cascade,
  display_name       text check (char_length(display_name) <= 120),
  phone              text,                         -- only if SMS reminders or door contact is wanted
  event_news_opt_in  boolean not null default false,
  event_news_opt_in_at timestamptz,
  event_news_source  text,                         -- 'checkout' | 'account'
  updated_at         timestamptz not null default now()
);
alter table public.attendee_profiles enable row level security;
alter table public.attendee_profiles force row level security;
-- Same posture as memberships: server-only, no browser policies.
```

Server-only (no `auth.uid()` policies) keeps one consistent pattern with `memberships` and `reservations`, and avoids exposing a writable table through PostgREST.

**Household members / dependents:** not as profile data. Buying for family is already `qty` on one order. Add **per-seat names** only if hosts need names at the door (kids' programs, security lists): an optional "Names on tickets" field list at checkout writing `attendees.name` per row (`confirm_order` already says "forward-compatible with per-seat names"). Do not store a dependents list on the account; Salesforce already models the household.

**Communication consent:**
- Transactional mail (sign-in codes, tickets, receipts, event changes/cancellations) needs no opt-in and must not carry marketing.
- The app should **not send marketing**. The temple already runs its own lists. If the temple wants to capture interest, add one unchecked checkbox at checkout/account ("Send me news about upcoming events at Temple Emanu-El"), store it with timestamp and source, and **hand it to the CRM** (section 6) as the consent record. The CRM or the temple's mail tool owns unsubscribe. Unchecked-by-default also covers non-US guests (GDPR-style consent), not just CAN-SPAM's opt-out model.
- PII minimum in Supabase: email (in `auth.users` and on orders), name on orders/attendees, membership status + opaque `external_id`, optional consent flag. No address, no birthdate, no dues amounts, no CRM payloads (already a D5 rule).

---

## 4. "My tickets" / account page

### Scope

One page, `/account` (title "Your tickets"), reachable from the attendee header menu. Not linked from the event page's primary flow. The event page remains the front door; the account page is a back pocket.

Contents:
1. **Upcoming**: per order: event title, date/time, venue, ticket type, quantity, status (confirmed / waiting for payment), "Emailed to {buyer_email} on {date}".
2. **Past**: collapsed list.
3. **Membership** line: "Member" badge, or the mismatch help (section 5).
4. **Email preferences** (Phase 2, if the opt-in exists).
5. **Sign out** and **Delete my account** (section 7.4).

Data access: server component using the service-role client filtered by `orders.user_id = viewer.userId`, or add RLS read policies `orders_select_own_buyer using ((select auth.uid()) = user_id)` and `attendees_select_own_buyer` via join. Recommendation: **server-only reads**, matching every other attendee path (add-event-ticketing D6); no new browser-facing policies.

### The QR problem (important)

`/account` **cannot show the ticket QR** with today's token design: only `sha256(token)` is stored, by design (`ticket-token.ts`). The most common support case for older users is "I can't find the email." Options:

| Option | Effect | Verdict |
|---|---|---|
| A. List only, "check your email" | No QR in app | MVP fallback; low value alone |
| B. "Email my tickets again" re-mints tokens for that order's not-yet-checked-in seats | Old emailed/forwarded QRs stop working | **MVP**, with explicit copy: "This sends fresh tickets to {email}. The ones we sent before will stop working." |
| C. Derive tokens as `HMAC(TICKET_TOKEN_SECRET, attendee_id)`; still store only the hash | Account page can re-render the QR; a DB leak alone still cannot forge (needs the secret) | **Phase 2**, as its own openspec change; changes the ticket security model and adds a secret to rotate. Old random tokens keep working; only new tickets are re-displayable. |
| D. Store raw tokens encrypted | Same as C with more moving parts | Rejected |

Re-mint (B) belongs in `src/lib/tickets.ts` as `reissueTicketsForOrder(orderId, userId)`: verifies `orders.user_id = userId`, rotates `token_hash` where `checked_in_at is null and status = 'valid'`, re-sends via the existing `TicketEmail`. Rate-limit to a few per order per day.

---

## 5. Member validation UX (attendee's point of view)

At sign-in, `verifyMembership` already runs (both verify paths). What the person should see next:

| CRM result | Where they land | What they see |
|---|---|---|
| `active` | `next` (event page) | Member price applied, "Member" badge. On first ever verification, a one-time line: "Welcome back. Member prices are on." |
| `lapsed` | `next` | Guest prices. Note: "We found your membership, but it isn't current. **Renew your membership** (link to temple dues page) or email the office." |
| `not_found` | `next` | Guest prices. Note: "We couldn't match this email to a membership. **Is your membership under a different email?** Let us know" (opens the request form). |
| CRM down, no cache | `next` | Guest prices, no mismatch note (a timeout is not a "no"). Requires `verifyMembership` to surface "unknown" rather than collapsing to `not_found` for display; today `cachedStatus()` returns `not_found` on failure (`verify.ts`). Keep `not_found` for the *purchase* decision, but do not render the mismatch note for it. |

Rules: never block, never ask for member IDs or ZIP (proposal: self-serve proofing is spoofable). Only show any of this on events that have a member offer (current behavior), plus on `/account`.

### Office-assisted path

**MVP (no admin UI):**
1. "Is your membership under a different email?" opens `/account/membership-help` (signed-in only, so the requester's email is verified). Fields: full name, the email or name the membership might be under, optional note.
2. Server action inserts a row and emails `OFFICE_CONTACT_EMAIL` via Resend (`src/lib/email/send`) with the details and the verified sign-in email.
3. The office fixes the **Salesforce record** (add the sign-in email as `npe01__AlternateEmail__c`, or correct the household's status). The CRM stays the source of truth (proposal assumption).
4. The office replies by email. The attendee taps **"Check again"** on `/account` (calls `verifyMembership`, limited to once per 2 minutes per user) or simply signs in again; the 24h cache also expires on its own.

```sql
create table public.membership_requests (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid references auth.users (id) on delete set null,
  signin_email  text not null,           -- verified, copied at submit time
  full_name     text not null,
  claimed_email text,                    -- "my membership might be under..."
  note          text check (char_length(note) <= 1000),
  status        text not null default 'open' check (status in ('open','resolved','declined')),
  resolved_by   uuid references auth.users (id) on delete set null,
  resolved_at   timestamptz,
  created_at    timestamptz not null default now()
);
-- RLS on + forced, no policies (server-only). One open request per user:
create unique index membership_requests_one_open on public.membership_requests (user_id) where status = 'open';
```

**Phase 3, only if the office asks:**
- A host-side `/dashboard/membership-requests` list with "Resolve" (sends "We've updated your record" email and calls `verifyMembership` for that user). Needs a decision on *which* hosts see it (today every host sees only their own events; there is no admin concept). Adding `is_admin` would be a separate Entra group/app-role claim in the hook.
- **Manual overrides** (`membership_overrides(user_id, granted_by, reason, expires_at)`) consulted by `ensureFreshMembership` before the provider. Avoid unless there is a real case the CRM cannot express (e.g. new member whose dues are processing). Every override is a second source of truth.

### Joining, renewing, becoming a member later

- Joining/renewing is **a link out** (`MEMBERSHIP_JOIN_URL` env) to the temple's existing dues/membership page. The app never takes dues.
- A non-member who later joins: the CRM changes; the app picks it up at the next sign-in, the next purchase after the 24h `expires_at`, or "Check again". No migration of past orders (prices were snapshotted; refunding the difference is an office decision).

---

## 6. New signups into Salesforce (requirement for the Salesforce-bridge design)

**Requirement:** the app does not create CRM records synchronously, and does not push mere sign-ins.

- **What to send:** people with real activity: a **confirmed order** (name, email, event, date, ticket type, member-pricing flag) and any **consent opt-in**. Not unverified sign-ins (typos, curiosity).
- **How:** an append-only `crm_outbox` table written in the same transaction/flow as the confirming event (server-only, RLS forced, no policies), drained by the bridge with retries. Idempotent by `(kind, source_id)`. Keeps Salesforce outages and API limits (nonprofit editions are low, see D7) off the checkout path.
- **Matching is the bridge's job**, using NPSP duplicate rules on email: match an existing Contact and log an engagement/attendance record against it; create a new Contact + Household only per the temple's policy.
- **Trade-offs to decide with the temple:** pushing every guest creates a visitor pipeline the office may want (outreach to prospective members) but pollutes NPSP with one-off and misspelled contacts and raises privacy questions for guests who never asked to be in a synagogue's CRM. Middle path: push attendance only for **matched** contacts automatically, and push **unmatched** guests only when they opted in (section 3). NPSP generally does not use Leads for individuals; prefer Contacts or a custom "Event Attendance" object.

---

## 7. Abuse and edge cases

### 7.1 Account enumeration
`signInWithOtp` with `shouldCreateUser: true` returns the same success for known and unknown emails, so `/signin` does not reveal who has an account. Keep it that way: never switch to `shouldCreateUser: false` (it errors for unknown emails). The staff refusal surfaces only at code verification, i.e. only to someone who already controls that inbox. Membership status is shown only after verification. Good as is.

### 7.2 OTP spam and brute force
- The form lets anyone make the temple send a code email to any address (email bombing, sender-reputation damage on the Resend domain).
- **Finding to verify:** `signInWithOtp` and `verifyOtp` are called from **server actions**, so Supabase sees **Vercel's function IP**, not the user's. Supabase's per-IP limits (`sign_in_sign_ups`, `token_verifications`) may become one shared bucket for the whole congregation (a busy announcement locks everyone out) *and* give no per-attacker protection. Confirm on a preview whether `X-Forwarded-For` is honored for server-side calls; if not:
  - add an app-level limit keyed by the real client IP (`x-forwarded-for` at the Vercel edge) and by email: e.g. 3 code requests per email per 10 min, 10 per IP per 10 min. Vercel Firewall rate-limit rules on `POST /signin` are the least-code option.
  - add a per-email failed-verify counter: after 5 wrong codes, require a new code.
- Raise `max_frequency` from `"1s"` to `"60s"` (per-email resend interval) in `supabase/config.toml` and hosted settings.
- Lower `otp_expiry` from 3600 to 900 s (15 min is generous for older users; an hour widens the brute-force window for a 6-digit code).
- **Captcha** (Cloudflare Turnstile, supported natively by Supabase Auth): Phase 2 or switch on when abuse appears. Use managed/invisible mode; a visible puzzle is wrong for this audience.

### 7.3 `auth.users` rows from typos
Every code request creates an unconfirmed user. The design accepts this (risk table). Add a weekly `pg_cron` job (the project already uses pg_cron in `20261014090000_schedule_hold_sweep.sql`) deleting users with `email_confirmed_at is null and created_at < now() - interval '7 days'` and no orders/memberships rows. Verify the deletion path against Supabase docs (direct delete from `auth.users` vs admin API) before scheduling.

### 7.4 Account deletion / data requests
- "Delete my account" on `/account`: confirm, then `auth.admin.deleteUser(userId)` from server code. Effects already wired by FKs: `memberships` cascades; `orders.user_id` sets null; `attendees.checked_in_by` sets null.
- **Orders and attendee rows are retained** (financial and attendance records; refunds need `buyer_email`). Say so on the page: "Your past orders stay on file with the temple for its records."
- Full erasure requests go to the office. A documented SQL runbook can anonymize `buyer_email`/`buyer_name`/`attendees.email/name` for orders older than the retention period. Do not build self-serve erasure.
- **Email change:** do not offer it. "Use a different email? Sign out and sign in with it." Supabase still allows `updateUser({ email })` from the browser with the publishable key (double-confirm is on). Harden by deleting the user's `memberships` row when the email changes (trigger `after update of email on auth.users`, delete-only, so a failure cannot block sign-ups), so a membership verified for the old address is not carried for up to 24h.

### 7.5 Staff who are also congregants
- The hook refuses email-code sessions for any account holding an `azure` identity. So a staff member cannot use their **work** email by code.
- If their personal email differs (the usual case): they sign in by code with the personal email, which is a separate `auth.users` row with role `attendee`, membership checked against that email. Two accounts, two roles. This is clean and should be the documented answer.
- If they buy while signed in with Microsoft: `ensureFreshMembership(viewer)` still runs (it does not check role), so they get member pricing only if the CRM has their work email. Fine.
- Cosmetic fix: on event pages, do not render `MismatchNote` for `role === 'host'` (`src/app/e/[id]/page.tsx:205`). Staff browsing their own event see "We couldn't match this email" today.
- If task 1.4 shows linking does occur (one row with both identities), a congregant who joins staff loses code sign-in on that address. That is the intended D1 side effect; their order history stays on the same `user_id`.

---

## 8. Phased plan

### Phase 0: before hosted rollout (do now; tiny)
1. Rename token role `member` to `attendee` (file list in section 1) → verify: `npm run test:db` (`roles.test.mjs` hook cases) and `npm run test:unit` green.
2. `supabase/config.toml` + hosted: `max_frequency = "60s"`, `otp_expiry = 900` → verify: second code request within a minute shows the existing 429 copy.
3. Verify on a preview whether Supabase per-IP limits see the client IP from server actions; if not, add a Vercel Firewall rate-limit rule on `POST /signin` → verify: 11th request from one IP in 10 min is blocked; a different IP is not.
4. Hide `MismatchNote` for hosts; don't show it when the status came from a CRM failure.

### Phase 1: MVP account lifecycle (one openspec change, e.g. `add-attendee-accounts`)
- **Schema (one migration):** `claim_orders_for_user()` (security definer, service_role only) + `orders_buyer_email_lower_idx`; `membership_requests` (server-only); weekly unconfirmed-user sweep (pg_cron); memberships invalidation trigger on email change.
- **Code:**
  - `src/app/signin/actions.ts`, `src/app/auth/confirm/route.ts`: call `claimOrders(user.id, user.email)` after verify (never throws, like `verifyMembership`).
  - New `src/app/account/page.tsx` (Your tickets + membership line + Check again + Delete account), `src/app/account/actions.ts`.
  - New `src/app/account/membership-help/` (request form → row + office email).
  - `src/lib/tickets.ts`: `reissueTicketsForOrder()` (option B) with rate limit.
  - `src/components/SiteHeader.tsx`: attendee menu gets "Your tickets".
  - `src/components/MemberBits.tsx`: lapsed copy gains a renew link (`MEMBERSHIP_JOIN_URL`); not_found copy links to membership-help instead of a bare mailto.
  - Post-purchase "Sign in to keep these tickets" offer on RSVP success and `src/app/checkout/[orderId]/page.tsx`.
  - `/signin` copy: "First time? Same thing."
- **Tests:** DB test that claim is idempotent, case-insensitive, and never overwrites a non-null `user_id`; unit test that claim and reissue refuse another user's order; E2E: guest buys → signs in with same email → order appears in `/account`.

### Phase 2
- Deterministic HMAC ticket tokens so `/account` can show the QR (own openspec change; touches the ticket security model).
- `attendee_profiles` if a second field is needed (name override, opt-in, phone).
- Event-news opt-in at checkout, flowing to `crm_outbox`.
- Turnstile on `/signin` if abuse is observed.
- Per-seat names on tickets, if hosts ask.

### Phase 3 (on demand)
- Office queue UI in the dashboard + an admin claim for which staff see it.
- Membership overrides.
- Retention/anonymization runbook automation.

---

## Decisions needed from the user / temple

1. **Rename `member` to `attendee` before hosted rollout?** (Recommended: yes, now.)
2. **"Email my tickets again" that invalidates earlier QRs** acceptable for MVP, or wait for HMAC tokens?
3. **Office path:** who receives membership help requests (`OFFICE_CONTACT_EMAIL`), expected turnaround, and is fixing the Salesforce record (vs an app-side override) the office's process?
4. **Join/renew URL** for lapsed and non-members.
5. **CRM push policy:** attendance for matched contacts only, or also new guests (with/without opt-in)? Contacts vs a custom attendance object. (Coordinate with the Salesforce-bridge design.)
6. **Event-news opt-in at checkout:** wanted at all? If yes, which system sends those emails?
7. **Retention period** for order PII after account deletion.
8. Outcome of task 1.4 (Entra verified email / identity linking) before enabling claim for host sessions.
