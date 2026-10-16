# Emanuel Tickets

Events and ticketing for Temple Emanuel, replacing TicketLeap and Eventbrite. Congregants RSVP or buy tickets as guests. Staff sign in with Microsoft to create events, manage capacity, and see who's coming.

See `PRODUCT.md` for purpose and voice, `DESIGN.md` for the visual system, and `openspec/` for specs and in-flight changes.

## Stack

Next.js 16 (App Router), React 19, Tailwind CSS 4, Supabase (Postgres, Auth, RLS), deployed on Vercel. This Next.js version has breaking changes, so read `AGENTS.md` before writing framework code.

## Development

```bash
npm install
npm run dev        # http://localhost:6175
npm run lint
npm run test:unit
npm run test:db
```

Copy environment values into `.env.local` (Supabase URL and keys, payment provider settings, `NEXT_PUBLIC_SITE_URL`).

## Roles and sign-in

- **Hosts** (staff) sign in with Microsoft at `/login`. Only a Microsoft-established session gets the `host` role.
- **Attendees** (congregants) sign in with their email at `/signin`: we email a 6-digit code (and a backup link through `/auth/confirm`). No passwords. Their role is `attendee`; being a *member* is decided only by the CRM (see Membership).
- **Guests** don't sign in at all; RSVP and checkout work by name and email.

The role is stamped into the access token by the Supabase custom access token hook (`public.custom_access_token_hook`, migrations `20261014120000_member_auth` and `20261015120000_attendee_role`), and every host RLS policy requires it. The hook must be enabled on the hosted project (Authentication → Hooks → Customize Access Token). Accounts with a Microsoft identity are refused any non-Microsoft session. Rollback SQL is in `supabase/rollback/`.

Sign-in codes expire after 10 minutes and one code per email is sent per minute (`otp_expiry = 600`, `max_frequency = "60s"`; set the same under Authentication → Providers → Email on the hosted project). Code requests and checks go through `src/lib/supabase/auth-admin.ts`, which uses the Supabase **secret key** (`SUPABASE_SECRET_KEY`, an `sb_secret_…` key — the legacy `service_role` key won't work) and forwards the visitor's IP in `sb-forwarded-for`, so Supabase rate-limits each person rather than our server. Turn on IP forwarding under Authentication → Rate Limits.

Both sign-in email templates (Confirm signup and Magic Link) use `supabase/templates/member-code.html`; paste the same body into the hosted project's templates. Send auth email through custom SMTP (Resend) with a raised email rate limit so a congregation-wide announcement isn't throttled.

## Membership

Membership comes from the temple CRM through `src/lib/membership/` (same seam shape as `src/lib/payments/`). It's checked at sign-in and cached per user in `public.memberships` (server-only): an active result for 24 hours, lapsed or not found for 1 hour, and re-checked at checkout when stale or when the person signed in with a different email. Signed-in attendees can tap "Check again" (at most once every 2 minutes). A CRM outage never blocks RSVP or checkout: after a failure the CRM isn't asked again for that person for 5 minutes, and a cached active result still counts for up to 7 days.

| Variable | Purpose |
| --- | --- |
| `MEMBERSHIP_PROVIDER` | `fake` or `salesforce`. Defaults to `fake` outside production; required in production. |
| `MEMBERSHIP_FAKE_ACTIVE`, `MEMBERSHIP_FAKE_LAPSED` | Comma-separated emails for the fake provider; any other email is not found. |
| `OFFICE_CONTACT_EMAIL` | Shown to signed-in people whose email didn't match a membership. |
| `MEMBERSHIP_JOIN_URL` | The temple's join/renew page, linked from members-only prompts. |
| `SF_LOGIN_URL` | `https://login.salesforce.com` (or `https://test.salesforce.com` for a sandbox). |
| `SF_CLIENT_ID` | External Client App consumer key. |
| `SF_USERNAME` | The dedicated integration user. |
| `SF_PRIVATE_KEY` | Base64 of the PEM private key matching the app's certificate (`base64 -w0 server.key`). |
| `SF_GOOD_STANDING_FIELD` | API name of the temple-owned checkbox/formula field on the household Account that is true when dues are current, e.g. `Member_In_Good_Standing__c`. |
| `SF_EMAIL_FIELDS` | Optional. Contact email fields to match, comma-separated. Default: `Email,npe01__HomeEmail__c,npe01__WorkEmail__c,npe01__AlternateEmail__c`. |
| `SF_DECEASED_FIELD` | Optional. Contact checkbox for deceased contacts (never matched). Default: `npsp__Deceased__c`. |

The adapter supports NPSP households (Contact → household Account). Nonprofit Cloud models households differently and needs its own query before the adapter can be enabled there. Contacts without a household never match.

### Salesforce setup (temple side)

1. Generate a key pair and self-signed certificate: `openssl req -x509 -newkey rsa:2048 -nodes -keyout server.key -out server.crt -days 730 -subj "/CN=emanuel-tickets"`.
2. Create a dedicated integration user (Salesforce Integration license) with a permission set granting read on Contact, Account, the email fields, `SF_DECEASED_FIELD`, and `SF_GOOD_STANDING_FIELD`.
3. Setup → External Client App Manager → New External Client App. Enable OAuth with the `api` scope, enable **JWT Bearer Flow**, and upload `server.crt`.
4. In the app's policies set "Permitted Users: Admin approved users are pre-authorized" and add the integration user's permission set.
5. Create the good-standing field on Account (a formula over whatever the temple uses for dues).
6. Add the env vars above to the Vercel project. Never commit `server.key`.
7. Verify with one known-active and one known-lapsed member before setting `MEMBERSHIP_PROVIDER=salesforce` in production.

**Certificate rotation:** the certificate expires after the `-days` above. Owner: Stephen Fang (stephen.fang@emanuelnyc.org) for now. Before expiry, upload a new certificate to the app, update `SF_PRIVATE_KEY` in Vercel, redeploy, then remove the old certificate. An expired or wrong certificate shows up in logs as `MembershipConfigError … invalid_grant`, and everyone pays regular prices until it's fixed.
