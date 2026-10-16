## 1. Prerequisites

- [x] 1.1 Create Supabase secret key; add `SUPABASE_SECRET_KEY` to Vercel and `.env.local`; enable IP forwarding (Auth › Rate Limits)
- [ ] 1.2 Run `add-member-auth` task 1.4 (Entra verified email / identity linking) and record the result
- [x] 1.3 Temple: `OFFICE_CONTACT_EMAIL`, join/renew URL (placeholder: stephen.fang@emanuelnyc.org; swap for production)

## 2. Safe sign-in

- [x] 2.1 `src/lib/supabase/auth-admin.ts` (server-only): secret-key client sending `sb-forwarded-for` from `x-real-ip`
- [x] 2.2 Sign-in actions and `/auth/confirm` call OTP through it, then `setSession` on the cookie client; staff 403 still shown
- [x] 2.3 Migration: hook returns `attendee`; rename in `viewer.ts`, tests, `add-member-auth` spec wording
- [x] 2.4 `otp_expiry = 600`, `max_frequency = "60s"` in config.toml and hosted; 60-second copy on the sign-in page
- [x] 2.5 Hosted: Resend SMTP with raised email limit; paste `member-code.html` into Confirm signup and Magic Link

## 3. Members-only experience

- [x] 3.1 Members-only types listed for all, reservable only by active members; seats excluded from spots-left for others
- [x] 3.2 Per-viewer prompt (sign in / renew / try on-file email + office mailto / become a member); none for hosts or unknown status
- [x] 3.3 E2E with fake provider: guest, lapsed, not found, active member on a members-only event

## 4. Salesforce readiness (before `MEMBERSHIP_PROVIDER=salesforce`)

- [x] 4.1 Migration: `memberships.retry_after`, `memberships.email_sha256`
- [x] 4.2 `verify.ts`: 24 h / 1 h TTLs, 5-minute back-off, 7-day stale cap, email-hash check, unknown state, `checkAgain()` (2-minute limit, ignores back-off), skip empty email
- [x] 4.3 Adapter: good-standing field, configurable email fields, deceased and no-household → `not_found`, household id as external id, fail-fast by `errorCode`
- [ ] 4.4 Org model confirmed (NPSP or Nonprofit Cloud) and household query matches it
- [x] 4.5 README: External Client App + JWT bearer setup; cert rotation owner
- [x] 4.6 Unit tests for every rule above, including "two attempts in an outage → one provider call"

## 5. Launch

- [ ] 5.1 Lint, unit, DB tests, build green
- [ ] 5.2 Preview: 31 code requests from one network are limited, a second network is not; code by typing and by link from a phone mail app; staff email refused
- [ ] 5.3 Enable email OTP on hosted with `MEMBERSHIP_PROVIDER=fake`
- [ ] 5.4 Later: switch to Salesforce after one known-active and one known-lapsed member check
