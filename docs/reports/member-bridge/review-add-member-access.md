# Review: `add-member-access`

Date: 2026-10-15. Reviewed `openspec/changes/add-member-access/*` against `docs/reports/member-bridge/review.md` (prior review), `synthesis.md`, `openspec/changes/add-member-auth/*`, and the implemented code. Live facts taken as given: `add-member-auth` migration + hook live on hosted, app code not deployed, email OTP off. Library facts checked in `node_modules`: `@supabase/supabase-js` 2.116.0, `@supabase/ssr` 0.12.7, `@supabase/auth-js` 2.116.0, Next 16.3.5.

## Verdict

**Not ready as written, but close for the launch half.** Groups 2–5 (safe sign-in, Your tickets, members-only copy, Salesforce readiness) resolve every prior blocker and most majors, with two correctable gaps (new secret key, per-email limit storage). Groups 6–7 ("Find my membership" + office tools) are a different story: D3 re-introduces the self-serve proofing all three reports and the synthesis rejected, adds five tables and a live name/address/phone CRM search, and its only real payoff — a person who can read the household's on-file inbox but wants to use a different address — is already served by one sentence of copy ("Sign in with the email the temple has on file"). Cut D3, keep the office queue small, and split the change in two as the prior review asked.

### Scorecard against the prior review

| Item | Status | Where |
|---|---|---|
| B1 shared rate-limit bucket | **Partially fixed** — right mechanism, but no new `sb_secret_` key is provisioned (legacy `service_role` is rejected for forwarding) and the per-email limit has no storage | design D1, tasks 2.1–2.2; see Blocker 2 |
| B2 host self-delete cascade | **Fixed** | design D11, `attendee-accounts` spec "Host cannot self-delete" |
| B3 staff notes via RLS | **Fixed** | design D7, `office-verification` "Office data is server-only" |
| M1 claim only confirmed orders | **Fixed** | D9; `attendee-accounts` claim requirement |
| M2 OTP expiry 600 s | **Fixed** | tasks 2.6 |
| M3 outage back-off | **Fixed** (but contradicts "Check again"; Minor 4) | D6; tasks 5.3 |
| M4 sessions / sign out everywhere / re-auth | **Fixed** | D11 |
| M5 HMAC tokens instead of re-send | **Fixed** (rotation unaddressed; Major 3) | D10 |
| M6 split Phase 0 | **Fixed** | tasks groups 2 vs 5 |
| M7 two changes, cut health check + sweep | **Half missed** — health check and sweep are cut; but one change now carries Phase 0a + 0b + accounts + office + a new feature (D3) | tasks has 8 groups, 5 new tables |
| m1 rename ordering | Over-solved; see Minor 1 | D2 |
| m4 `emailFields` config / NPC | **Fixed** in words (D5), not in the NPC data model (Major 2) | D5 |
| m6 office bootstrap | **Partially** — staff can manage staff, but nothing seeds the first one | D7; tasks 7.2 |

---

## Blockers

### 1. D3 "Find my membership" should be cut: it serves almost nobody the office route doesn't, reverses the agreed position, and is the bulk of the change.

**Evidence.** `design.md:46` D3: answers only locate; the code goes to "an email on file different from the sign-in email." `synthesis.md:168` "Agreed by all three: No self-serve identity proofing (ZIP, member ID). Mismatches go to the office." `signup-lifecycle.md:168` "never ask for member IDs or ZIP." `proposal.md:19`, tasks group 6, two of five new tables, `searchHouseholds` across two CRM data models (`tasks.md:47`).

**Who it helps.** Trace the branches of D3 step 3–4:
- Person can read the on-file inbox → they could have signed in with that address in the first place and been recognized with no new code (scenario 1). The feature saves them "use a different email."
- Person cannot read the on-file inbox (spouse's, ex-spouse's, parent's, dead ISP address, phone-only household) → office request, exactly what exists today.
- Ambiguous or no match → office request.
So the only net-new outcome is "link my gmail to the household whose verizon.net inbox I can also open." That is a convenience, not an access fix, and the design's "Alternatives rejected" never considers the copy-only alternative.

**What it costs.** Live SOQL/SOSL by name + street/ZIP or phone (feasibility issues in Major 2), `household_links` + `match_challenges`, a second 6-digit code sent to a *different* inbox minutes after the first one (scenario 2 as an older phone user: two "Your Emanuel Tickets code" emails, two inboxes, one form that must stay open while they switch apps), a 12-month link that outlives the office's 120-day one (D8), and a new abuse surface:
- *Affiliation enumeration.* Name + address (public) → "We found a membership that may be yours … ending in •••@verizon.net." That confirms a household belongs to a synagogue and leaks the ISP. The 3/day limit is per *account* (`membership-matching` spec, "rate-limited"), and accounts are free (`shouldCreateUser: true`, `src/app/signin/actions.ts:29`), so it is 3 per throwaway email, not 3 per person.
- *Unsolicited codes.* Every single-match search emails a code to a congregant who asked for nothing. 3/day × unlimited accounts = a way to spam a household's inbox with "someone is linking x@y to your membership."
- *Queue spam.* Every non-match "creates an office request with what they entered" (spec scenario "Search finds nothing"); nothing limits that per IP.
- *Household-owner minting.* Whoever controls the on-file inbox (adult child with the parents' AOL password, ex-spouse on a stale record) can link any sign-in email to the household for 12 months. Pricing-only impact, but adult-child eligibility is still an open temple question (`synthesis.md` decision 3), so the app would be answering it by default.

**Fix.** Delete `membership-matching`, D3, D8's self-link half, tasks 6.x, and the `household_links`/`match_challenges` tables. Replace scenario 2 with: "We couldn't find a membership for this email. **Try the email the temple has on file** (the one that gets the bulletin), or ask the office." The "ask the office" button is a one-field form (optional note) that writes a `membership_requests` row and emails `OFFICE_CONTACT_EMAIL`, rate-limited per IP. Keep office "Link to household" (D7/D8, 120 days, audited) as the only link path — the office already has name/address/phone in Salesforce and a human judges it. If the temple later insists on self-service, do it as its own change after the office queue has shown what the real failure modes are.

### 2. D1 as specified cannot work with the keys the project has, and the per-email limit has nowhere to live.

**Evidence.** Supabase: IP forwarding "works only with a secret API key (`sb_secret_…`). Publishable API keys and legacy `anon`/`service_role` API keys are not supported," and must be enabled under Authentication > Rate Limits (https://supabase.com/docs/guides/auth/rate-limits). The repo's only server key is the legacy `SUPABASE_SERVICE_ROLE_KEY` (`src/lib/supabase/admin.ts:11`); no task creates an `sb_secret_` key or adds an env var for it. Tasks 2.1/2.2 add a 3-per-10-minute per-email limit; the proposal's migration list (`proposal.md:30`) has no table for it, and Vercel functions share no memory.

**Failure scenario.** 2.1 is implemented with the service-role key: the header is silently ignored, every attendee still shares Vercel's IP bucket, and task 2.8's "two IPs get separate limits" is the only thing that would catch it — if it is actually run with 31 requests.

**Fix.** Add to tasks 2.1: "create a secret key in Dashboard > API keys, store as `SUPABASE_SECRET_KEY`, use it only in `auth-admin.ts`." For the per-email limit, pick one: (a) drop the 3/10-minute rule and rely on Supabase's built-in per-user resend window (`max_frequency = 60s`) plus the now-per-person IP limits — simplest, and what I recommend; or (b) a tiny `signin_attempts(email_sha256, window_start, count)` table written by the secret-key client. Update the `member-auth` spec accordingly.

The rest of D1 is feasible as installed: `createServerClient`/`createClient` accept `global.headers` (the Supabase doc example uses exactly that); `verifyOtp` through a secret-key client returns `data.session` with access and refresh tokens; the cookie client's `setSession` (`node_modules/@supabase/auth-js/dist/module/GoTrueClient.js:3028-3063`) validates a non-expired access token with one `/user` call and writes the cookies via `setAll`. The access-token hook still runs at issuance, so the staff 403 is still surfaced. Use `x-real-ip` as the design says (Vercel sets it; `x-forwarded-for` is what the doc example uses, but either is trusted on Vercel). `/auth/confirm` must switch too (it is a Route Handler; `setSession` can set cookies there).

---

## Major

### 1. The change is still three changes. Split it.

Prior M7 asked for `add-attendee-accounts` and `add-office-verification`; this bundles both plus launch prerequisites plus Salesforce readiness plus D3. Groups 2 and 5 are gated on nothing but engineering; group 7 is gated on the temple naming office staff (1.3); group 6 on 1.1. One `tasks.md` with "blocks 5 and 6" annotations is a schedule, not a change. Suggested split: **A** `launch-member-signin` (groups 2, 4, 5 — everything before OTP is enabled and before `MEMBERSHIP_PROVIDER=salesforce`), **B** `add-attendee-accounts` (group 3), **C** `add-office-verification` (group 7 plus the one-field office request form from Blocker 1). Each archives independently.

### 2. Salesforce search by name/address/phone is harder than "field lists are config" (only matters if Blocker 1 is overruled).

- **Address.** SOSL has no address field group (its groups are ALL/NAME/EMAIL/PHONE/SIDEBAR FIELDS; the Salesforce SOSL IN-clause page returned 403 to my fetch, so this is from the `sample search call` docs and the bridge report's own §SOSL note), so address search is SOQL on `MailingStreet`/`MailingPostalCode` — free text ("123 Main St" vs "123 Main Street, Apt 4"), not indexed by default (Salesforce lists Id/Name/OwnerId/FKs/audit dates/External Id/Unique as the default indexes, https://developer.salesforce.com/docs/atlas.en-us.apexcode.meta/apexcode/langCon_apex_SOQL_VLSQ.htm). At congregation scale a scan is fine; the matching rule is not: you need `LastName = ? AND MailingPostalCode = ? AND MailingStreet LIKE '<house number>%'` and still expect misses.
- **Phone.** SOQL equality on `Phone`/`HomePhone`/`MobilePhone`/`OtherPhone`/`npe01__WorkPhone__c` fails on formatting ("(212) 555-0100" vs "2125550100"); SOSL `FIND {2125550100} IN PHONE FIELDS` normalizes (https://developer.salesforce.com/docs/atlas.en-us.api.meta/api/sample_search_call.htm) but the search index lags writes by up to ~15 minutes (`salesforce-bridge.md:140`, LDV search architecture doc), which undermines "office fixed it, try again."
- **Nonprofit Cloud.** Households are business Accounts linked to a `PartyRelationshipGroup`; people are Person Accounts related via `AccountContactRelation` (Nonprofit Cloud Developer Guide, https://developer.salesforce.com/docs/atlas.en-us.nonprofit_cloud.meta/nonprofit_cloud/group_membership_and_households_standard_objects.htm; Trailhead "Manage households"). Address lives on the Person Account (`PersonMailing*`), and `Contact.AccountId` is the person account, not the household. "Email and phone field lists are config" (D5) does not bridge that: the household lookup is a different query shape. Say so in D5 and gate the Salesforce adapter on 1.1.
- **API cost.** 1–3 calls per search is noise against the daily limit; not a concern.

### 3. D10 HMAC tokens: say how rotation and old/new detection work.

**Evidence.** `design.md:60`: `token = HMAC(TICKET_TOKEN_SECRET, attendee_id)`; "Old random tokens keep working; those seats say 'Your ticket is in your email.'" `src/lib/ticket-token.ts:29` requires exactly 43 base64url chars; `src/lib/tickets.ts:145` looks up by `sha256(token)`.

**Gaps.** (a) Rotating `TICKET_TOKEN_SECRET` makes "Your tickets" recompute a token whose hash matches nothing: the page shows a QR the door rejects, while the emailed copy still works. Nothing says this. (b) Nothing says how the page tells an HMAC seat from a random-token seat. (c) HMAC-SHA256 raw output is 32 bytes → 43 base64url chars, so `isWellFormedToken` passes unchanged — worth stating so nobody "fixes" the regex. (d) Compromise: secret + DB (attendee ids) forges every ticket; today a DB leak forges none. Acceptable for door tickets, but the sentence "only the hash is stored, as today" should not imply the same guarantee.

**Fix.** Spec: "HMAC-SHA256 over the attendee id, base64url (43 chars). Old vs new is decided by recomputing and comparing to `token_hash`; a mismatch means a legacy ticket (or a rotated secret) and the page shows the email fallback — never a QR that cannot admit." Rotation: either document "rotation re-mints nothing; legacy seats fall back to email" or include `issued_at` in the HMAC input so a seat can be individually re-issued. Add a unit test: recompute → hash equals stored for a new seat; not for an old one.

### 4. The spec puts household links inside the Salesforce provider; the design puts them in `verify.ts`. Pick one.

`membership-verification` spec, Salesforce requirement: "When no email match exists, an unexpired household link for the attendee SHALL be evaluated the same way" + scenario "Linked household." D4 and task 6.5: resolution order lives in `verify.ts`. The provider contract is `lookup({ email })` (`src/lib/membership/provider.ts:16`); a provider cannot see `household_links`. If links survive Blocker 1 (office-only), the spec sentence belongs under the "Verification runs at sign-in" requirement and the provider gains `lookupHousehold(accountId)`.

### 5. "Check again" contradicts the 5-minute back-off, and the two scenarios cannot both pass.

`membership-verification`: "After a failure the system SHALL NOT call the provider again for that attendee for 5 minutes" vs scenario "Check again … the provider is consulted immediately." State the precedence: Check again ignores `retry_after` but obeys the 2-minute `verified_at` limit; or Check again during back-off shows "We'll try again in a few minutes." Also `memberships` needs `retry_after` and `email_sha256` columns — a new migration the proposal's Impact list omits.

### 6. Office bootstrap and lockout are unspecified.

D7: "The first office user can add or remove others." Nothing creates the first one (prior m6; `scripts/` holds only `free-port.mjs`). And nothing stops the last office user removing themselves. Add: a seed SQL snippet in README for the temple's IT contact (or a one-line `office_staff` insert in the migration keyed on an env email), and "the list SHALL never become empty by removal."

---

## Minor

1. **D2 rename ordering is over-solved.** `src/lib/supabase/viewer.ts:34` already maps any non-`host` claim to the app role; `SiteHeader.tsx:27,48` compare against that app value, not the claim. Pushing the rename migration before or after the app deploy changes nothing at runtime. Keep the rename (clarity), drop the "deploy 2.3 before 2.4" choreography and the down-script sentence; update `supabase/tests/roles.test.mjs` and the `add-member-auth` specs in the same commit.
2. **D11 "within 10 minutes of signing in" needs a clock.** The access token's `amr[].timestamp` is the sign-in time and survives refresh (hook comment, migration lines 13–15); say that is the source. Also `/account` is outside the proxy's `/dashboard` guard (`session.ts:40`); the page must redirect signed-out visitors to `/signin?next=/account` itself.
3. **"Your ticket is in your email" is a dead end for the exact person who lost the email.** Make it a sentence with a search hint: "Search your email for *Your ticket for ⟨event⟩*, or ask the office to re-send." Legacy tickets are a shrinking set; do not build re-send for them.
4. **Masked hint shows the domain** (`•••@verizon.net`, design scenario 2). If any of D3 survives, mask to first letter + domain TLD only, or show nothing ("the email we have on file").
5. **Self 12-month vs office 120-day link** (D3/D8) inverts trust: the human-judged link expires sooner than the automated one. If links exist at all, one length, and the office email should say "we also added this address to your record" so the link is a bridge, not a habit.
6. **Per-account rate limits are not per-person.** Every "per attendee" limit in `membership-matching` and the office-request path needs an IP component, because accounts cost one email.
7. **`claim_orders_for_user` is correct; note the one residual.** A confirmed free RSVP typed in a stranger's email already emailed that stranger; after claim it also appears in their "Your tickets." Accepted; write it in the risks list so nobody re-litigates.
8. **Host-congregants never see "Your tickets."** The header spec scopes the link to attendees; a staff member who buys tickets on their Microsoft session has orders with `user_id` set but no page. Say "hosts use the email" or show the link for both roles.
9. **`member-pricing` scenario "Attendee chooses among ticket types"** is unchanged from `add-member-auth` and should not be repeated inside a MODIFIED block unless it changed.

## Nits

- `proposal.md:7` "codes expire in 10 minutes" while `supabase/config.toml` still has `otp_expiry = 3600`; task 2.6 covers it, fine, but the hosted dashboard value is a separate switch — list both.
- `design.md:75` "E2E on a phone" and task 8.2 "Phone walkthrough of scenarios 1–8" — scenarios 2 and 7 cannot run on the fake provider as written; task 6.2's "fake provider equivalents" needs env-driven households (name, ZIP, phone, emails) spelled out or the walkthrough is theatre.
- `office-verification` "Diagnosing a request … live diagnosis without leaving the page" — a live Salesforce call per queue open; cache it per request row for a few minutes or the office page is slow and burns calls.
- Experience copy: "Sign in with your email to reserve" → "Members: sign in to reserve" reads faster on a phone; "Done. Member prices are on." → "You're all set — member prices now apply."; "We'll ask the office to confirm. You'll get an email, usually within two business days." is good — keep.
- Accessibility for "Your tickets": QR `alt="Ticket 1 of 2 for ⟨event⟩"`, a visible "Open ticket" link under each QR (door staff can scan a bright page; screen readers cannot read a QR), and "Delete my account" behind a secondary link + confirm step, not a button in the same visual rank as "Sign out everywhere."

## Minimum to proceed

1. Cut D3 (Blocker 1); keep the one-field office request + office Link to household.
2. Fix D1's key and limit storage (Blocker 2); verify with a real 31-request test on a preview.
3. Split into three changes (Major 1); groups 2+4+5 can be proposed and implemented now.
4. Resolve Majors 3–6 in the surviving specs.
