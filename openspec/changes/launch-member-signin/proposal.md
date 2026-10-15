## Why

Member sign-in from `add-member-auth` can't be switched on safely yet: sign-in limits are shared by the whole congregation, codes last an hour, staff see member prompts, and members-only tickets silently disappear for non-members. This change makes sign-in safe to launch and gets the Salesforce link ready. It is the first of three (`add-attendee-accounts`, `add-member-access` follow).

## What Changes

- Sign-in limits count each person, not our server (new Supabase secret key + IP forwarding). Codes expire in 10 minutes; one code per email per minute.
- **BREAKING (internal):** email sign-in role renamed `member` → `attendee`. "Member" now only means Salesforce says dues are current.
- Branded code emails through Resend; email sign-in enabled on hosted at the end.
- Members-only tickets stay visible with a clear next step: sign in, renew, try your on-file email, or become a member.
- Staff never see member prompts; a Salesforce outage isn't shown as "not a member."
- Salesforce readiness: one temple-owned good-standing field, deceased and household-less contacts don't match, faster re-check for non-members, outage back-off, "Check again."

## Capabilities

### New Capabilities
None.

### Modified Capabilities
- `member-auth`: role `attendee`; per-person limits; 10-minute codes; no member prompts for hosts.
- `membership-verification`: re-check timing, "Check again", outage back-off and 7-day cap, good-standing field, deceased/no-household rules.
- `member-pricing`: members-only tickets visible with next steps.

## Impact

- **DB:** migration — hook returns `attendee`; `memberships` gains `retry_after`, `email_sha256`.
- **Code:** `src/lib/supabase/auth-admin.ts` (new), `src/app/signin/actions.ts`, `src/app/auth/confirm/route.ts`, `src/lib/supabase/viewer.ts`, `src/lib/membership/{salesforce,verify}.ts`, `src/components/{SiteHeader,MemberBits,EventActionBar}.tsx`, `src/app/e/[id]/page.tsx`, `src/lib/event-format.ts`.
- **Hosted config:** new `sb_secret_` key (`SUPABASE_SECRET_KEY`), IP forwarding on, OTP expiry 600 s, resend 60 s, Resend SMTP, both templates, email OTP on last.
- **Temple:** `OFFICE_CONTACT_EMAIL`, join/renew URL; NPSP vs Nonprofit Cloud and the good-standing field before Salesforce is switched on.
