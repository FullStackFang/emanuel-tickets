## Context

`add-member-auth` is live in the database (hook on) but its app code isn't deployed and email sign-in is off. Reviews in `docs/reports/member-bridge/` found what must change before launch. The end-to-end experience across all three changes is in `openspec/changes/add-member-access/design.md`.

## Goals / Non-Goals

**Goals:** switch on email sign-in safely; make members-only events understandable to everyone; make the Salesforce adapter correct before it is enabled.
**Non-Goals:** accounts page, office tools, Find my membership (later changes); passwords; writing to Salesforce.

## Decisions

**D1. Per-person limits.** Create a Supabase secret key (`sb_secret_…`, env `SUPABASE_SECRET_KEY`; the legacy `service_role` key is not accepted for forwarding) and enable IP forwarding under Auth › Rate Limits. A server-only `auth-admin.ts` client uses it and sends `sb-forwarded-for` from Vercel's `x-real-ip`. `signInWithOtp` and `verifyOtp` (sign-in page and `/auth/confirm`) go through it; the returned session is written to the cookie client with `setSession`. No app-side per-email counter: Supabase's 60-second resend window covers it. *Rejected:* a Vercel firewall rule alone (doesn't un-share Supabase's bucket).

**D2. Rename `member` → `attendee`.** New migration replaces the hook. `viewer.ts` already maps every non-host claim to one value, so deploy order doesn't matter. Update tests and the `add-member-auth` spec wording in the same commit.

**D3. Members-only next steps.** One per-viewer prompt: guest → "Members: sign in to reserve"; lapsed → renew link; not found → "Try the email the temple has on file (the one that gets the bulletin)" plus a mailto to the office until `add-member-access` ships its form; unknown (CRM down) → no note. Hosts never see these.

**D4. Salesforce correctness.** Standing = one boolean formula field on the household, named by env, owned by the temple's admin. Email field list is config. Deceased contacts and contacts without a household don't match. External id is always the household id. NPSP and Nonprofit Cloud need different household queries; the adapter supports the model confirmed by the temple and is not enabled until then. Config errors are classified by Salesforce `errorCode`, fail fast, and never log bodies.

**D5. Cache.** Active 24 h, others 1 h. On failure set `retry_after = now() + 5 min`; RSVP/checkout skip the provider until then. Cached "active" survives an outage up to 7 days past `verified_at`. "Check again" ignores `retry_after`, limited by `verified_at` to once per 2 minutes. Rows store `email_sha256`; a different sign-in email forces a re-check. Empty email skips verification.

## Risks / Trade-offs

- [Secret key on the sign-in path] → `import 'server-only'` in `auth-admin.ts`; never in client bundles.
- [IP forwarding misconfigured silently] → preview test with 31 requests from two networks before launch.
- [Temple hasn't defined good standing] → provider stays `fake` with empty lists; everyone pays regular prices; nothing breaks.

## Migration Plan

1. Create secret key + env on Vercel; enable IP forwarding. 2. Deploy app. 3. Push rename migration. 4. Hosted auth: OTP 600 s, resend 60 s, Resend SMTP, templates. 5. Preview tests. 6. Enable email OTP with provider `fake`. 7. Later: Salesforce on after temple setup and a known-active/known-lapsed check.
Rollback: turn email OTP off; provider `fake`.

## Open Questions

- NPSP or Nonprofit Cloud? Who builds the good-standing field and what's in it?
- `OFFICE_CONTACT_EMAIL`, join/renew URL.
