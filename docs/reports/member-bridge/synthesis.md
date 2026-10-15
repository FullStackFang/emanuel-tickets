# Member bridge: reconciled recommendation

Date: 2026-10-15. Inputs: `salesforce-bridge.md`, `signup-lifecycle.md`, `member-validation.md` (same folder). This file records where the three agree, how conflicts were resolved, and the proposed sequencing. Detail lives in the source reports.

## Facts that override the reports

- The `add-member-auth` migration **is live on the hosted project**, and the custom access token hook **is enabled** (2026-10-15). Live tokens already carry `app_role = 'member'`. Any hook change ships as a **new** migration (`create or replace function public.custom_access_token_hook`), never an edit of `20261014120000_member_auth.sql`.
- App code from `add-member-auth` (viewer, `/signin`, pricing, membership module) is **not deployed**; email OTP is **not enabled** on the hosted project. No attendee has signed in by code yet.

## Agreed by all three

1. **Topology: keep the live per-user lookup** at sign-in and at stale checkout. No nightly roster copy (PII), no CDC worker, no Zapier/MuleSoft. Optional later: a Salesforce Flow that pings an app route to invalidate one user's cache.
2. **Salesforce is the only source of membership *standing*.** The app never decides standing on its own.
3. **No self-serve identity proofing** (ZIP, member ID). Mismatches go to the office.
4. **Write-back is not MVP** and needs temple approval. If approved: attendance for matched contacts only, via an append-only outbox drained with retries; never revenue, never auto-created contacts for unopted guests.

## Conflicts and resolutions

| Topic | Positions | Resolution |
|---|---|---|
| Definition of "good standing" | bridge: temple-owned formula field on the household; current code: `SF_MEMBERSHIP_FIELD_MAP` JSON | **Formula field** (`Emanuel_Events_Member__c`, boolean, on Account) owned by the temple's SF admin. The field map shrinks to naming that one field. Grace periods, dues relief, clergy, fiscal year live in the formula, not in app code. |
| Token role name | signup: rename `member`→`attendee` | **Rename**, via a new migration. `viewer.ts` already maps every non-host to the same value, so live `member` tokens keep working until refresh. |
| Office tooling timing | signup: Phase 3; validation + bridge: early | **Phase 1** (after the Phase 0 fixes). Without it, `OFFICE_CONTACT_EMAIL` is a dead end and the office has no "why not matched" view. |
| Who is "office" | validation: DB allow-list within hosts; signup: Entra group claim later | **DB allow-list** (`office_staff(user_id)`), managed by SQL/one admin, checked server-side and in RLS via `is_office()`. Revocable instantly. Entra app-role can replace it later. |
| Overrides | signup: avoid; bridge: time-limited + audited; validation: household-link only, ≤120 days | **Household links only** (office vouches "this sign-in email belongs to household X"; standing still comes from Salesforce for X), max 120 days, audited. Requires a by-household lookup in the provider and a spec change to "membership is granted only by a provider result". Phase 2. Preferred office action stays "fix the Salesforce record". |
| Cache behavior | validation: non-members 1h, cap stale-on-error | **Active: 24h re-check; lapsed/not_found: 1h; stale-on-error capped at 7 days** past `expires_at`, then non-member. Add "Check again" (rate-limited). Invalidate on sign-in email change. |
| Contact with no household | code returns `lapsed`; validation: `not_found` | **`not_found`**. |
| `external_id` | bridge: inconsistent (contact vs household) | **Always the household (Account) id**; contact id never stored. |
| Config errors | bridge: retried like outages | **Fail fast** on config errors (missing env, bad field map, 400 INVALID_FIELD): no retry, logged distinctly, surfaced by the health check. |

## Sequencing

**Phase 0: fixes before any attendee signs in (one small change).**
- New migration: hook role `member`→`attendee`.
- Provider fixes: no-household → `not_found`; exclude deceased (`npsp__Deceased__c`); `external_id` = household id; fail-fast on config errors; formula-field mode.
- Cache: 1h for non-members; stale-on-error cap; invalidate `memberships` on `auth.users.email` change (delete-only trigger); distinguish "unknown" (CRM failure) from `not_found` for display.
- Auth hardening: `max_frequency` 60s, `otp_expiry` 900s; confirm whether Supabase per-IP limits see client IPs from server actions, else Vercel Firewall rule on `POST /signin`.
- UI: hide mismatch note for hosts and on CRM failure; "Check again".
- README: "External Client App" (Connected Apps can no longer be created since Spring '26).

**Phase 1: attendee accounts + office MVP (one openspec change).**
- `claim_orders_for_user()` on verify (persisted backfill by verified email; never overwrites a non-null `user_id`).
- `/account` "Your tickets" + "Email my tickets again" (re-mints; old QRs stop working; copy says so).
- `/account/membership-help` request form → `membership_requests` + office email.
- `office_staff` allow-list, `is_office()`, `/dashboard/office`: request queue, lookup diagnostics ("why not matched": contacts found, household ids, formula value, last check), Re-check, Resolve/Decline/Need-info with member email, append-only `office_audit`.
- Daily bridge health check (pg_cron or Vercel Cron): auth, API usage, field present, cert expiry → email alert.
- Weekly sweep of unconfirmed `auth.users`.

**Phase 2.** Household links (overrides) + by-household lookup; HMAC ticket tokens so `/account` can show QRs; optional opt-in + outbox write-back if approved; Salesforce Flow ping for instant invalidation; Turnstile if abuse appears.

## Decisions needed from the temple (merged, deduplicated)

1. **Org type and edition:** NPSP or Nonprofit Cloud? API access included? (Code is NPSP-only.) Is dues status actually tracked in Salesforce, and roughly what share of members have an email on file?
2. **Good standing:** grace period after lapse, dues relief/waivers, clergy and staff, fiscal-year boundary. Who builds and owns the formula field?
3. **Household eligibility:** adult children, dependents/minors, shared household email, deceased contacts.
4. **Office:** who verifies members, can they edit Salesforce directly, expected turnaround, who may grant household links and for how long.
5. **Pricing limits:** cap on member-priced tickets per order? Do member-priced tickets stay valid if membership lapses before the event? High Holy Day seating in scope ever?
6. **Write-back:** attendance to Salesforce at all? Who owns that data?
7. **Join/renew URL**, `OFFICE_CONTACT_EMAIL`, retention period for requests/audit/order PII.
8. **Ticket re-send** that invalidates earlier QRs: acceptable for MVP?
9. Result of task 1.4 (Entra verified email / identity linking).
