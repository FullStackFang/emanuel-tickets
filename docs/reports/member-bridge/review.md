# Review of the member-bridge synthesis

Date: 2026-10-15. Reviewed: `synthesis.md` (primary), the three source reports, `openspec/changes/add-member-auth/*`, and the implemented code it references. Live facts taken as given: migration + access-token hook are live on hosted; app code not deployed; email OTP not enabled on hosted.

Verdict up front: **not ready to become an OpenSpec change as written.** The core design (CRM as source of standing, server-only cache, enforcement in `reserve_seat`, no self-serve proofing) is sound and the code matches it. But the synthesis carries one verified launch-day outage, one Phase 1 design that can delete a host's events, an unresolved RLS conflict between two source reports, and a Phase 0 that mixes true prerequisites with work that only matters once Salesforce is wired. Fix those, split the phases, and it is ready.

---

## Blockers

### B1. Supabase per-IP auth rate limits are keyed on Vercel's egress IP, not the attendee's. One shared bucket for the whole congregation.

**Evidence.** `src/app/signin/actions.ts:26` and `:45` call `signInWithOtp` / `verifyOtp` from Server Actions through `createClient()` (`src/lib/supabase/server.ts`), i.e. with the **publishable** key, from Vercel's IP. Supabase's rate-limit docs: `/otp` sign-in requests are limited **per IP, 30 per 5 minutes**; `/verify` is **per IP, 30 per 5 minutes**; "Requests from your server can cause all users to share the server's IP and hit the same limit. To avoid this, send the end-user IP in the `Sb-Forwarded-For` header", and "Forwarding works only with a **secret API key**. Publishable keys and legacy anon/service_role keys are not supported. For new projects, you must enable IP address forwarding in Authentication > Rate Limits" (https://supabase.com/docs/guides/auth/rate-limits; shipped in auth v2.185.0, Jan 2026, https://github.com/supabase/auth/pull/2295).

**Failure scenario.** The temple emails the congregation a ticket link. The 31st person to ask for a code within 5 minutes gets "Please wait a minute" (the 429 copy at `actions.ts:32`), and so does everyone after them until the bucket refills. Same on code entry. Separately, anyone can lock every attendee out of sign-in by submitting the form 30 times. The synthesis's Phase 0 item "confirm whether Supabase per-IP limits see client IPs from server actions, else Vercel Firewall rule" has the wrong fallback: a Vercel WAF rule adds a per-client limit but does **not** un-share the Supabase bucket.

**Fix.** Before OTP is enabled on hosted: (1) enable IP forwarding under Authentication > Rate Limits; (2) perform the `signInWithOtp` and `verifyOtp` calls through a client created with the **secret** key that sets `sb-forwarded-for` from Vercel's trusted client-IP header (`x-real-ip` / first hop of `x-forwarded-for` as set by Vercel, not the raw client-supplied value), then hand the resulting session to the cookie client; (3) keep the per-IP defaults (now per attendee) and add a per-email limit. Verify on a preview with two IPs. A Vercel WAF rule is optional on top (note it is a paid-plan feature).

### B2. Phase 1 "Delete my account" would cascade-delete every event a host owns.

**Evidence.** `signup-lifecycle.md` §7.4: "`auth.admin.deleteUser(userId)` from server code. Effects already wired by FKs". The FK it does not list: `events.host_id uuid not null references auth.users (id) on delete cascade` (`supabase/migrations/20260917142944_ticketing_schema.sql`), and `ticket_types`, `orders`, `attendees` cascade from `events`. The synthesis adopts `/account` without a role guard and the viewer model gives hosts a session that can reach `/account`.

**Failure scenario.** A staff member who is also a congregant opens `/account` in their Microsoft session (or a host account that was claimed through the host-session claim path) and taps "Delete my account": every event they created, every order and attendee row under it, and every pg ledger entry disappears, with Stripe records now pointing at nothing.

**Fix.** The spec must say: self-serve deletion is available only to `role = 'attendee'` sessions, and the server action must refuse any user that owns `events` rows (or holds an `azure` identity) regardless of role. Consider soft-delete (anonymize email, revoke sessions) instead of a hard `auth.users` delete.

### B3. The two source reports disagree on whether attendees can read `membership_requests` from the browser, and the synthesis does not resolve it. One of the two options leaks staff notes.

**Evidence.** `member-validation.md` §4 RLS table: member "select own (`user_id = auth.uid()`), to show 'request pending'". The same table definition carries `staff_note` ("internal; never emailed") and `decline_reason`. A row-level `select own` policy exposes every column through PostgREST. `signup-lifecycle.md` §5 and §4 say the opposite: "RLS on + forced, no policies (server-only)". The synthesis Phase 1 bullet names neither.

**Fix.** Pick server-only reads (consistent with `memberships`, `reservations`, and the attendee-access spec "no policy granting ... ordinary authenticated clients direct read"). "Request pending" is rendered by the server component. If a browser policy is ever wanted, put it on a view that excludes `staff_note`/`decline_reason`.

---

## Major

### M1. The "tickets were already emailed" argument for claim-by-email is only true for confirmed orders; the proposed SQL claims all of them.

**Evidence.** Proposed claim: `update orders set user_id = $uid where user_id is null and lower(buyer_email) = lower($verified_email)` (`signup-lifecycle.md` §2). `issueTicketsForOrder` returns early unless `order.status = 'confirmed'` (`src/lib/tickets.ts:35`), so `pending`, `expired`, and `cancelled` orders never emailed anything to `buyer_email`. Delivery is also not recorded anywhere: a send failure is logged and swallowed (`tickets.ts:109`), while the buyer still sees the first ticket URL on the RSVP success panel (`src/app/e/[id]/actions.ts:120`). Refunds set `attendees.status = 'revoked'` but leave `orders.status = 'confirmed'` (`src/lib/checkout.ts:203-212`).

**Failure scenario.** Someone types a stranger's address at checkout and abandons at Stripe. The stranger later signs in and sees the stranger's abandoned order (event, qty, name typed, amount) on "Your tickets". Low-value disclosure, but the stated safety invariant is false. Second: a refunded order shows as "confirmed" on `/account` unless the page reads attendee status, and "Email my tickets again" must skip revoked seats (the signup report does say `status = 'valid'`; the account listing does not).

**Fix.** Claim only `status = 'confirmed' and needs_refund = false`; write the invariant into the spec as "confirmed orders, whose tickets were addressed to `buyer_email`". Derive the `/account` state from `attendees.status`, not `orders.status`. Keep "never overwrite a non-null `user_id`". Keep the rejection of household-level claiming.

### M2. 6-digit OTP, 1-hour expiry, no documented failed-attempt lockout.

**Evidence.** `supabase/config.toml` `otp_expiry = 3600`, `otp_length = 6`. Supabase documents only per-IP limits on `/verify` (30 per 5 minutes) and a per-user 60-second resend window; no per-user attempt cap for email OTP (https://supabase.com/docs/guides/auth/rate-limits; the MFA hook docs describe lockouts for MFA factors only). Hitting Supabase's `/verify` directly from N IPs with the publishable key gives N x 360 guesses/hour against a 1,000,000 space.

**Failure scenario.** Targeted attack on one member's address during the hour after they request a code: ~3.6% per 100 IPs per hour at 3600 s expiry; the payoff after Phase 1 is their order list and the ability to re-mint their tickets, not just a discount. Same class of risk as every Supabase OTP app, but the synthesis's 900 s is a modest reduction.

**Fix.** `otp_expiry = 600` (validation report's number), keep 6 digits (older users), and plan Turnstile as the escalation path. Make sure B1's per-attendee limits are in place first; they are the main brute-force control.

### M3. 1-hour negative TTL plus "failure leaves the row untouched" means a Salesforce outage adds up to 5 s to every RSVP/checkout attempt by every signed-in non-member, on every attempt.

**Evidence.** `src/lib/membership/verify.ts:59-84`: on failure nothing is written, so the next `ensureFreshMembership` call (`:95-100`) finds the same stale row and calls the provider again under the full `BUDGET_MS = 5000`. The synthesis shortens the negative TTL to 1 h, which makes this the common state for exactly the population that signed in and was not matched. "Never block" holds (it returns), but a 5-second stall on a phone before "Reserve" responds is a block to an older user.

**Fix.** On provider failure, bump `expires_at` by a short back-off (e.g. 5 minutes) without changing `status`, or record `last_error_at` and skip the provider when it is recent. Add a unit test: two purchase attempts during an outage make one provider call. Keep the 7-day stale-on-error cap.

### M4. Attendee sessions never expire, and the only sign-out is local.

**Evidence.** Supabase sessions persist until signed out unless session time-boxing/inactivity timeouts are configured (a paid-plan feature). `src/app/actions/auth.ts` exposes `signOutEverywhere` only through host menus; the attendee header has local `signOut` only (`src/components/SiteHeader.tsx`). PRODUCT.md: "mostly on phones, non-technical ... some older users".

**Failure scenario.** A shared family tablet stays signed in as grandma indefinitely; after Phase 1, anyone using it sees her tickets and can re-mint them (invalidating the copies she forwarded). Not an escalation, but a real support case for this audience.

**Fix.** Configure an inactivity timeout (e.g. 30 days) on hosted if the plan allows; otherwise document it. Give attendees "Sign out everywhere" on `/account`. Require a fresh code (re-auth within N minutes) for "Email my tickets again" and "Delete my account".

### M5. "Email my tickets again" (option B) is the wrong MVP for this audience; HMAC tokens (option C) are smaller than the report makes them sound.

**Evidence.** `signup-lifecycle.md` §4: B re-mints tokens "old emailed/forwarded QRs stop working", plus a rate limit, plus warning copy. `src/lib/ticket-token.ts` stores `sha256(token)`; `getTicketByToken` (`src/lib/tickets.ts:138`) looks up by hash. Option C is: `token = HMAC(secret, attendee_id)` minted deterministically, still stored and looked up by hash, so `/account` can re-render the QR with no re-mint and no revocation side effect. Old random tokens keep working. That is one secret, one function, no new table, no rate limit, no copy about "the ones we sent before will stop working".

**Failure scenario with B.** A member forwards ticket 2 of 3 to a relative, later taps "Email my tickets again" to find ticket 1 and silently kills the relative's QR; the door scanner rejects it at the event.

**Fix.** Make C the Phase 1 mechanism (own small spec delta under ticketing) and drop B. If B is kept, require explicit confirmation and show which seats are affected.

### M6. Phase 0 is not "one small change" and most of it is not a prerequisite to enabling OTP.

**Evidence.** Synthesis "Phase 0" bundles: hook rename migration; five provider fixes; four cache changes; auth config; UI; README. Of these, the provider and cache items only take effect with `MEMBERSHIP_PROVIDER=salesforce`, which is gated on the temple's Phase 0 (sandbox, integration user, ECA, formula field: `salesforce-bridge.md` §7.2, weeks of calendar time). Meanwhile the real OTP prerequisites from `tasks.md` are still open: 4.1 templates, 4.2 custom SMTP, 1.4 Entra verified-email check, 4.7/7.4 E2E, 9.1/9.2.

**Fix.** Split: Phase 0a "enable sign-in safely" (B1, SMTP, templates, `otp_expiry`/`max_frequency`, rename, hide mismatch for hosts/CRM failure, task 1.4, E2E) and Phase 0b "Salesforce readiness" (provider fixes, cache TTLs, fail-fast, README ECA) which can land any time before `MEMBERSHIP_PROVIDER=salesforce` is set. See the checklist at the end.

### M7. Phase 1 scope is two changes, not one, and includes items that can be cut.

**Evidence.** Synthesis Phase 1 lists: claim, `/account`, reissue, help form, `office_staff` + `is_office()`, office dashboard with four actions and diagnostics, append-only audit, daily bridge health check with cert-expiry parsing and Resend alerts, weekly unconfirmed-user sweep.

**Recommendation.** Change A (`add-attendee-accounts`): claim (M1 scope), `/account` list + HMAC QR (M5), help form writing `membership_requests` and emailing `OFFICE_CONTACT_EMAIL`, "Check again". Change B (`add-office-verification`): `office_staff`, `is_office()`, queue, re-check, resolve/decline, audit. Cut from both for MVP: the daily health check (replace with a Vercel log alert on `membership: lookup attempt ... failed` plus a calendar entry for the cert; `verify.ts` already logs every failure) and the weekly `auth.users` sweep (orphan rows are harmless per design D-risk; add only if the table grows).

---

## Minor

### m1. Role rename: safe, but order the deploy or fix the header check.

`src/components/SiteHeader.tsx:27,48` compares `viewer?.role === 'member'`. If the rename migration is pushed before the app build that changes `ViewerRole`, attendees get the signed-out header. No attendee tokens exist yet (OTP disabled), so there are no "live `member` tokens" to protect; the synthesis's reasoning is right but the risk is the opposite ordering. Change the header to `viewer && viewer.role !== 'host'` first, then push the migration, then the rename in types/tests/spec. Update `supabase/tests/roles.test.mjs:117` and the spec scenarios that say `member` session.

### m2. Email-change invalidation: prefer the app-side check over a trigger on `auth.users`.

The synthesis picks a delete-only trigger on `auth.users.email` update. Triggers on the auth schema are supported but a failing one blocks the auth flow and Supabase can change the schema. The validation report's `email_sha256` column compared in `ensureFreshMembership` achieves the same with no auth-schema coupling and no PII. Either way, note that email change is a **staleness** issue, not an escalation: `double_confirm_changes = true` requires control of both inboxes, and someone who controls a member's inbox can already sign in as them.

### m3. Fail-fast on 400 must not include the email-driven path.

Synthesis: "Fail fast on config errors (missing env, bad field map, 400 INVALID_FIELD)". Salesforce also answers 400 `MALFORMED_QUERY` for inputs; the email is regex-validated and escaped (`salesforce.ts:24,50,157`), so this is unlikely, but classify by `errorCode`, not status, and never log the body (it echoes the query, which contains the email; `salesforce-bridge.md` §4.5 already says so).

### m4. The adapter is NPSP-only in two places, and the synthesis only fixes one.

The formula-field decision removes the `statusField/activeValues` guesswork, but `EMAIL_FIELDS` (`salesforce.ts:26`) is still hard-coded to `npe01__*`, which throws on a Nonprofit Cloud org. The bridge report says to make it config; the synthesis Phase 0 does not. Add `emailFields` to the contract. Also relevant to decision 1: since December 2025 the Power of Us program issues **Agentforce Nonprofit** (Nonprofit Cloud) licenses rather than NPSP (https://www.salesforceben.com/the-state-of-salesforce-nonprofit-offerings-in-2026/, https://cloud4good.com/blog/evolving-power-of-us-npsp-to-agentforce-nonprofit/); an existing temple org is probably NPSP, a recently provisioned one is not. On NPC, `Contact.AccountId` of a Person Account is the person account itself, not the household, so "formula on the Account" needs the Party Relationship Group model; confirm before promising the formula approach hides the difference.

### m5. Salesforce claims: mostly accurate; cite primary sources.

- Connected App creation restricted in Spring '26, ECAs recommended: confirmed by Salesforce's own developer docs ("connected apps creation is restricted as of Spring '26 ... external client apps are the recommended option", https://developer.salesforce.com/docs/atlas.en-us.noversion.mobile_sdk.meta/mobile_sdk/connected_apps.htm). Winter '26-for-new-orgs and the Support-exception sunset are from third parties (https://salesforcedictionary.com/blogs/salesforce-external-client-apps-migration-2026, https://striim.com/docs/en/salesforce-connected-apps-and-external-client-apps.html).
- ECAs support JWT bearer: confirmed only via vendor docs (https://grafana.com/docs/plugins/grafana-salesforce-datasource/latest/configure/, https://docs.n8n.io/integrations/builtin/credentials/salesforce.md). Username-password is not available on ECAs. Fine for this design.
- API limits: the 1,000-per-license figure is in Salesforce's cheatsheet for full Salesforce licenses only (https://developer.salesforce.com/docs/platform/salesforce-app-limits-cheatsheet/guide/salesforce-app-limits-platform-api.html); the 100,000 EE base is widely cited by third parties (https://coefficient.io/salesforce-api/salesforce-api-rate-limits). Conclusion (limits do not justify a sync) stands.
- Integration user license, 5 free in EE/UE/PE since March 2023: secondary sources only (https://gearset.com/blog/what-are-salesforce-integration-user-licenses/, https://www.apexhours.com/salesforce-integration-user-license/). Confirm in Setup > Company Information.
- NPC renamed Agentforce Nonprofit at Dreamforce 2025: confirmed (sources above).
- JWT `aud`: Boomi says leave `aud` as the login host unless My Domain is enforced for token requests, then use the My Domain URL (https://help.boomi.com/docs/Atomsphere/Data_Integration/Sources/Applications/Salesforce/jwt-bearer-salesforce). The current code (`aud = SF_LOGIN_URL`, same host as the token POST) is consistent with that in both cases; the `SF_AUDIENCE` override is a cheap hedge. Verify in the sandbox. I could not fetch the primary Salesforce JWT page (JS-rendered).

### m6. Office capability bootstrap is a bus-factor risk.

`scripts/grant-office.mjs` run by "the developer against the database (service role)". If the developer is a contractor, the temple cannot add or remove office staff. Give the first office user a one-screen "manage office staff" action in Change B, or document the SQL for the temple's IT contact.

### m7. Stripe receipt and tickets can go to different addresses.

`src/lib/checkout.ts:107`: Stripe `customer_email` is the session email, `orders.buyer_email` is the typed (editable) field, tickets go to `buyer_email`. Not a security issue (member can already gift tickets), but confusing in support. Either lock the field for signed-in buyers or send both to `buyer_email`.

### m8. Cost and ownership items nobody priced.

Vercel WAF rate limiting and Supabase session timeouts are paid-plan features; custom SMTP via Resend needs a verified sending domain and a raised Supabase email limit (task 4.2); somebody at the temple owns the Salesforce certificate rotation (bridge report §4.3) and the `office_staff` list. Add a one-line "who pays / who owns" to the decisions list.

---

## Nits

- `src/app/auth/confirm/route.ts:21` passes `data.user.email ?? ''`; an empty string fails the provider regex and caches `not_found` for 24 h. Skip verification when the email is empty.
- Synthesis Phase 1 "Daily bridge health check (pg_cron or Vercel Cron)": pg_cron cannot reach Salesforce; it is Vercel Cron or nothing.
- Synthesis cache row: "Active: 24h re-check" with "Check again (rate-limited)" needs a place to keep the rate-limit state; `memberships.verified_at` works, say so.
- The spec scenarios still call the non-host role `member`; the rename touches five spec files, not just `member-auth`.
- `README.md:48` still says Connected App + `refresh_token` scope (bridge §7.1 #1); fine to fix with Phase 0b.

---

## Minimum safe launch (email OTP enabled on hosted, fake or Salesforce provider)

1. B1: IP forwarding enabled; OTP request/verify through a secret-key client sending `sb-forwarded-for`; verified from two IPs on a preview. Per-email limit in place.
2. Hosted auth settings: `otp_expiry` 600, resend interval 60 s, custom SMTP via Resend with raised email limit (task 4.2), both templates (task 4.1).
3. Task 1.4 (Entra verified email) run and recorded; decision on host-session claiming deferred until then.
4. Header check `role !== 'host'`, then rename migration (`member` -> `attendee`) as a new migration, then type/test/spec rename.
5. Hide `MismatchNote` for hosts and when the status came from a CRM failure.
6. `supabase/tests/roles.test.mjs`, `test:unit`, build green; E2E 4.7 and 7.4 at least run manually on a phone mail app (task 9.2).
7. Salesforce provider stays off (`MEMBERSHIP_PROVIDER=fake` with empty lists) until Phase 0b lands and task 8.5 (one known-active, one known-lapsed) passes.

Then Phase 0b (provider fixes, TTLs with the M3 back-off, fail-fast, `emailFields` config, README ECA) whenever the temple's sandbox exists, followed by Change A and Change B as separate OpenSpec changes.

## Verdict

Not ready as-is. Resolve B1-B3 and M1 in the synthesis, split Phase 0 and Phase 1 as above, swap reissue for HMAC tokens, and it is ready for `/opsx:propose`. The architecture itself does not need to change.
