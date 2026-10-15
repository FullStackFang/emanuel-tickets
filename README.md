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
- **Members** (congregants) sign in with their email at `/signin`: we email a 6-digit code (and a backup link through `/auth/confirm`). No passwords.
- **Guests** don't sign in at all; RSVP and checkout work by name and email.

The role is stamped into the access token by the Supabase custom access token hook (`public.custom_access_token_hook`, migration `20261014120000_member_auth`), and every host RLS policy requires it. The hook must be enabled on the hosted project (Authentication → Hooks → Customize Access Token). Accounts with a Microsoft identity are refused any non-Microsoft session. Rollback SQL is in `supabase/rollback/`.

Both sign-in email templates (Confirm signup and Magic Link) use `supabase/templates/member-code.html`; paste the same body into the hosted project's templates. Send auth email through custom SMTP (Resend) so a congregation-wide announcement isn't throttled.

## Membership

Membership comes from the temple CRM through `src/lib/membership/` (same seam shape as `src/lib/payments/`). It's checked at sign-in, cached per user for 24 hours in `public.memberships` (server-only), and re-checked at checkout when stale. A CRM outage never blocks RSVP or checkout.

| Variable | Purpose |
| --- | --- |
| `MEMBERSHIP_PROVIDER` | `fake` or `salesforce`. Defaults to `fake` outside production; required in production. |
| `MEMBERSHIP_FAKE_ACTIVE`, `MEMBERSHIP_FAKE_LAPSED` | Comma-separated emails for the fake provider; any other email is not found. |
| `OFFICE_CONTACT_EMAIL` | Shown to signed-in people whose email didn't match a membership. |
| `SF_LOGIN_URL` | `https://login.salesforce.com` (or `https://test.salesforce.com` for a sandbox). |
| `SF_CLIENT_ID` | Connected App consumer key. |
| `SF_USERNAME` | The dedicated integration user. |
| `SF_PRIVATE_KEY` | Base64 of the PEM private key matching the Connected App certificate (`base64 -w0 server.key`). |
| `SF_MEMBERSHIP_FIELD_MAP` | JSON naming what "in good standing" means, e.g. `{"object":"Account","accountField":"Id","statusField":"Membership_Status__c","activeValues":["Active"],"endDateField":"npo02__MembershipEndDate__c","nullEndDateIsCurrent":true}`. |

Salesforce setup (temple side): create a Connected App with "Use digital signatures" and upload the certificate; enable OAuth with the `api` and `refresh_token` scopes; set "Admin approved users are pre-authorized" and grant the integration user access through a permission set. Then add the env vars above to the Vercel project. Never commit the key. Verify with one known-active and one known-lapsed member before setting `MEMBERSHIP_PROVIDER=salesforce` in production.
