# Member validation and office operations

Status: design report (no code changed). Date: 2026-10-15.
Scope: how the app decides "this signed-in person is a member", what happens when it gets that wrong, and the office tooling that fixes it.
Sibling reports, written in parallel: **Salesforce bridge topology** and **guest/member signup lifecycle**. This report covers validation policy and office operations. §9 lists what it needs from the other two.

---

## 0. Where things stand (grounded in code)

| Concern | Current behavior | Where |
|---|---|---|
| Proof of identity | The person proves they control an inbox with a 6-digit OTP or a `token_hash` link | `src/app/signin/actions.ts` (`verifyOtp`), `src/app/auth/confirm/route.ts` |
| Membership claim | Lowercased, trimmed email equals one of 4 NPSP Contact email fields. Standing is read from the household Account through `SF_MEMBERSHIP_FIELD_MAP`. Active if **any** matched household is active | `src/lib/membership/salesforce.ts:218-250` |
| Contact with no AccountId | Reported as `lapsed`, with the Contact Id as `externalId` | `salesforce.ts:231-232` |
| Lapsed with several households | `externalId = accountIds[0]`, an arbitrary choice | `salesforce.ts:249` |
| Deceased / inactive contacts | Not filtered | `salesforce.ts:225-228` |
| Cache | `public.memberships`, keyed by `user_id` only. One TTL of 24h (`RECHECK_MS`) for every status | `src/lib/membership/verify.ts:269`, migration `20261014120000_member_auth.sql:81-91` |
| Outage behavior | If the provider fails, the cached status is used **with no age limit**. An expired `active` row stays active for as long as Salesforce is unreachable | `verify.ts:336-337`, `352-353` |
| Re-check triggers | Sign-in (always), and RSVP/checkout when the cache is stale. Nothing else | `signin/actions.ts:58`, `auth/confirm/route.ts:21`, `e/[id]/actions.ts:57,141` |
| Display | The event page and header read the cached row and ignore expiry. Purchase re-checks | `e/[id]/page.tsx:121-125`, `SiteHeader.tsx:27` |
| Mismatch handling | `MismatchNote` shows a `mailto:OFFICE_CONTACT_EMAIL`. There is no queue, override, audit, or "check again" | `src/components/MemberBits.tsx:16-37` |
| Who is staff | Any account with an `azure` identity in an OAuth session is a host. There is no finer staff capability | hook in `20261014120000_member_auth.sql:17-57`, `is_host()` at `:66-74` |
| Party size at member price | Up to 20 per order (`MAX_PARTY`, `MAX_QTY`) | `src/app/e/[id]/actions.ts:19`, `src/lib/checkout.ts:21` |
| Spec invariant | "The application SHALL NOT grant member status by any means other than a provider result." | `openspec/changes/add-member-auth/specs/membership-verification/spec.md` |

The core design holds up: inbox control plus a CRM email on file, server-only cache, enforcement inside `reserve_seat`, price snapshot on the order, and no self-serve proofing. The gaps are all on the edges: there is no feedback loop when the match fails, staleness rules are coarse, there is no ceiling on stale-on-error, there is no audit trail, and every staff member has the same power.

---

## 1. Threat model

### What a successful false claim gets someone

| Asset | Value | Notes |
|---|---|---|
| Member price | Typically $5–$100 per ticket, times up to 20 per order | Bounded and recoverable. The order is snapshotted (`orders.member_pricing`), so abuse can be found afterward |
| Members-only seats | Scarce inventory. **High value if the temple ever sells High Holy Day seats here** | This is the one case that could justify more assurance. Decision D-1 |
| Information disclosure | Small. A member session can see nothing other members can't. There is no "my tickets" view or directory, and the `memberships` table is not readable by the browser | The main leak would be future office notifications revealing who is in a household (avoided in §3) |
| Staff power (office role) | Can grant member status to arbitrary accounts | The highest-value target in this design. It gets the strongest controls |

### Realistic attacks and proportionate responses

| # | Attack | Likelihood | Impact | Response |
|---|---|---|---|---|
| A1 | **Member shares their OTP code or session** with a friend | Medium | Low. The member could already buy 20 member-priced tickets for that friend | Accept. Optionally cap member-priced quantity per order (D-6). Don't add device binding |
| A2 | **Spouse or partner uses their own email** | High, and legitimate | None | Household-level standing already covers this (D7). Works only if the spouse's email is on their Contact. Otherwise it goes to the office queue |
| A3 | **Email on file belongs to someone else**: a typo that is someone's real address, a recycled ISP address, an ex-spouse after divorce, an adult child who moved out | Low–medium | Low (pricing) | CRM hygiene, plus office review of ambiguous matches (§2). App can't detect this. Divorce/household split is a CRM process (D-9) |
| A4 | **Ex-member** keeps benefits | Medium | Low | Lapse flows from SF within the active TTL (24h). §5 adds a hard ceiling on stale-on-error |
| A5 | **Stale CRM**: dues paid but status not updated, or email changed | High | False negative, so member friction | Member "Check again" button, a short negative TTL, and an office queue with re-check (§3, §5) |
| A6 | **Compromised inbox** | Low | Low. The attacker gets pricing and can buy tickets. No PII exposed by the app | Same as any email-OTP app. Shorten `otp_expiry` (currently 3600s in `supabase/config.toml`) to about 600s. Add Turnstile captcha on the code request (the `[auth.captcha]` stub exists) to limit code brute force and email bombing |
| A7 | **Social engineering the office** ("I'm Mrs. Cohen, add my new email") | **Medium, and the most realistic real attack** | Low–medium | The office confirms through a **contact channel already on file in Salesforce**, never through information the requester supplies (§3.3) |
| A8 | **Insider**: an office staffer grants friends member status | Low | Low–medium | Separate office capability, append-only audit, expiring links, and a periodic review report (§3.6) |
| A9 | **Queue spam**: many accounts filing requests | Low | Annoyance | Requires a signed-in (OTP-verified) account, one open request per user, and a per-user rate limit |
| A10 | **Membership enumeration** | Very low | Low | You only learn an email's status by controlling the inbox. `lapsed` vs `not_found` copy is shown only to the inbox owner. That's acceptable |
| A11 | **Integration outage used as an amplifier**: a broken certificate means a lapsed member keeps an `active` cache forever | Medium over a multi-year horizon. Connected App certificates expire | Low per user, wide in aggregate | Bound stale-on-error, alert on consecutive provider failures, and track certificate expiry (§5.4) |

### Proportionate assurance

Today's level is roughly NIST IAL1/AAL1. The person controls an address the temple has associated with a household in good standing. For discounted community-event tickets that is the right level, and it matches the existing decision to avoid guessable self-serve proofing (`proposal.md`, design D4/D7). **Recommendation:** keep it. Raise assurance only at one point: **office-assisted** verification, where a human confirms out of band through the record on file. Don't collect ID documents, dates of birth, or member numbers. If members-only High Holy Day seating moves into the app (D-1), revisit. The likely answer then is office pre-assignment, not stronger online proofing.

---

## 2. Matching policy

| Case | Recommendation | Change vs today |
|---|---|---|
| **Case and whitespace** | Trim and lowercase (already done). SOQL `=` on email fields is case-insensitive anyway | None |
| **Gmail dots and `+tag`** | **Do not normalize in MVP.** Dots and plus are equivalent only at `gmail.com`/`googlemail.com`. At Google Workspace and other domains, `a.b@x.org` and `a+t@x.org` can be different mailboxes. Normalizing generically would grant a stranger's household. Gmail-only canonicalization is safe in principle, but SOQL can't canonicalize the CRM side, so it would need a mirror or a formula field. If mismatch data shows it matters, revisit with the bridge report | None |
| **One email on several contacts in one household** (shared family inbox) | One result for the household. Both spouses share one app account. Fine | None |
| **One email across several households** | Keep "active if any is active". The claim being tested is "controls an inbox on file for an active household", and that is true. Record an `ambiguous` flag and surface it in the office review report so staff can clean the CRM | Add `match_count`/`reason` to the result (§4) |
| **Contact with no household Account** | Return `not_found` with reason `no_household`, not `lapsed`. Today it is `lapsed` and the user is told "we found your email but couldn't confirm a current membership", which sends them toward renewal when the real problem is data | `salesforce.ts:232` |
| **Lapsed across several households** | Store the most recently ended household, or null. Not `accountIds[0]` | `salesforce.ts:249` |
| **Deceased contacts** | **Exclude from matching by default** (`npsp__Deceased__c = true`). A surviving spouse should match on their own Contact. Matching a deceased person's inbox should send them to the office, a human conversation, not grant silently | Add a configurable `contactExcludeFlags: ["npsp__Deceased__c"]` to `SF_MEMBERSHIP_FIELD_MAP`. Values are identifiers validated by the existing `IDENT_RE` |
| **Inactive or do-not-contact contacts** | NPSP has no standard "inactive" flag. If the temple uses one, add it to `contactExcludeFlags` | Same mechanism |
| **Organization accounts** (work email with an Org affiliation) | Standing is read from the Account. Org accounts won't carry member status, so they correctly read as not active. Optional later: restrict to the Household record type | None (note only) |
| **Minors and dependents** with their own email on a household contact | Allow by default. Membership is household-level. The app has no age data and should not gain any | Decision D-5 |
| **Staff who are also members** | Host sessions verify by the staff email (`ensureFreshMembership(viewer)` runs for any viewer). A staffer who is a member through a personal email signs in by OTP with that email, and it works | None. Document it |

Result type: extend `MembershipResult` with an optional `reason` (`matched` \| `no_contact` \| `no_household` \| `household_inactive` \| `excluded_contact`) and `matchCount`. These are codes, not PII. They let the UI tailor copy and give the office queue a head start.

---

## 3. Office-assisted verification

### 3.1 Principle

**Salesforce stays the source of truth for standing. The office can vouch only for identity: which household this sign-in belongs to.** The app never stores "this user is active". It can store, for a limited time, "office staff confirmed this account belongs to household 001xx…", and standing for that household still comes from Salesforce on every check. So a linked person still lapses automatically when the household lapses, and an override can never make a lapsed household active.

Preferred outcome: **fix the Salesforce record** (add the email to the Contact's Alternate Email field), then re-check. The app-side link is a bridge for when the person who can edit Salesforce isn't available quickly. It expires, so the CRM still gets fixed.

### 3.2 Member-side request flow

1. A signed-in member sees the mismatch note on the event page (`MismatchNote`) or in the header menu.
2. The note offers two actions:
   - **"Check again"**: re-verifies now, bypassing the cache, rate-limited to once per 2 minutes per user. This covers "I just renewed" and "the office already fixed it".
   - **"Ask the office to check"**: opens a short form at `/membership/request`.
3. Form fields (all optional except the first; plain copy, no "prove it" fields):
   - Name as the temple would have it on file (≤120 chars).
   - Another email the temple might have for you (≤254 chars, validated).
   - A short note (≤1000 chars).
   - The sign-in email is shown read-only. It is what gets linked.
4. On submit: "Thanks. Someone from the office will look at this, usually within a few business days. We'll email you at x@y." One open request per user. Resubmitting edits the open one.
5. The submitted data is a **hint for staff**. It is never matched automatically. This keeps the D4 rule that guessable data can't grant membership.
6. The `mailto:` link stays as a fallback. Some congregants will phone or email regardless, and the office handles those through the same queue (§3.4, "Look up by sign-in email").

For `lapsed` (matched, but household not in good standing), the copy and request type differ: "Our records show the membership isn't current. If you've recently paid, ask the office to check." The office resolves it in Salesforce (record the payment or status). **The app never links around a lapsed household.**

### 3.3 What office staff do (runbook, to be printed and laminated)

1. Open the request in `/dashboard/office`.
2. In **Salesforce** (not the app), find the household using the name or hint email. The app deliberately does not pull household rosters (PII minimization; see §4).
3. **Confirm through a channel already on file**, never through the requester's own details:
   - Call the phone number on the household record, **or**
   - Email an address already on the household record: "Someone asked to add x@y to your membership for event tickets. Was that you?"
   - A known in-person relationship ("I know the Cohens, that's Rachel's new email") is acceptable when the staffer records it in the note.
4. Choose an outcome:

| Outcome | When | Effect |
|---|---|---|
| **Fixed in Salesforce → Re-check** (preferred) | Staff can edit SF | The app calls the provider with a cache bypass. If now active, the request auto-resolves as `recognized` and the member gets an email |
| **Link to household** (Phase 2) | Identity confirmed but SF edit not possible now | Staff paste the household Account Id. The app reads the household's standing from SF and shows only "Active" or "Not active" plus the household name. Staff confirm, choose an expiry (default 60 days, max 120), and must enter a note. A follow-up task to fix SF is implied by the expiry |
| **Lapsed: refer to membership** | Household found, not in good standing | Declined with reason `lapsed`. The email points to the membership/dues contact |
| **Not a member / can't verify** | No household, or confirmation failed or got no response | Declined. The email is warm and says nothing about any household |
| **Need more info** | Can't find them | Sends a templated email. Status `needs_info` |

5. Every action writes an audit row in the same database transaction (§4).

**Never disclose household details to the requester.** Outcome emails say "you're all set" or "we couldn't confirm a membership for this email". They never say "we found the Cohen household but…".

### 3.4 Office UI (MVP scope)

Route `/dashboard/office`, inside the existing host area, gated by `requireOffice()`:

- **Queue**: open and `needs_info` requests, oldest first. Shows submitted-at, sign-in email, name given, hint email, current cached status, reason code, last checked, and note. Badge count in the host `AccountMenu`.
- **Request detail**: the actions above, internal note, and the history (audit rows for this request).
- **Look up by sign-in email**: for phone and email requests that never used the form. If an auth user exists: show cached status and reason, plus **Re-check now**. If not: "This person hasn't signed in yet. Fix Salesforce and ask them to sign in." Don't pre-link emails that have no account.
- **Links** (Phase 2): active links, expiry, created-by, revoke.
- **Review report** (Phase 2): links created per staffer per month, links expiring within 14 days, ambiguous matches, requests older than 7 days.

Desktop-first, consistent with PRODUCT.md ("desktop-comfortable for hosts"). Plain tables, no dashboard chrome.

### 3.5 Notifying the attendee

Use the existing `sendEmail` in `src/lib/email/send.ts`. Templates: `request_received` (optional; the on-page confirmation may suffice), `recognized`, `needs_info`, `declined_lapsed`, `declined_unverified`, and Phase 2 `link_expiring` (sent to the office, not the member). Copy follows PRODUCT.md tone. An email failure never rolls back the resolution. Log `user_id`, never the email (the existing rule in `verify.ts`).

### 3.6 Who can do this: an "office" capability within hosts

Today every Microsoft account with an `azure` identity is a host. Office verification grants a pricing benefit and exposes which email maps to which household, so it should be a **narrower capability**.

| Option | Pros | Cons | Verdict |
|---|---|---|---|
| **DB allow-list** `public.office_staff(user_id)`, plus `is_office()` = `is_host()` and an active row | Immediate revocation (checked per query, not a 1h JWT claim). Testable with the existing `roles.test.mjs` pattern. Auditable | Needs a bootstrap path (a script) and, later, a small admin screen | **MVP** |
| Entra app role or group claim (e.g. `Tickets.Office`), read by the hook | Managed in IT's existing tool. Offboarding is automatic | Unverified whether Supabase's `azure` provider persists custom `roles` or `groups` claims into `auth.identities.identity_data`. Claims refresh only at sign-in. Needs testing like task 1.4 | **Later**, after a spike. The hook could then sync the allow-list |
| Claim in the JWT only | No table lookup | Revocation lags up to `jwt_expiry` (3600s) | No |

`is_office()` requires `is_host()` too, so the office capability is only usable in a Microsoft OAuth session. That keeps it behind the tenant's MFA and Conditional Access, which IT should require for this app. Bootstrap: `scripts/grant-office.mjs <email>` run by the developer against the database (service role), writing an audit row. Revocation uses the same script with `--revoke`.

### 3.7 Cache invalidation so fixes take effect immediately

- **Re-check now** (office) and **Check again** (member) call a new `verifyMembership(userId, email, { force: true })`, which already overwrites the row on success. Then `revalidatePath('/e/[id]', 'page')` is not required: the event page reads the row per request, so the next navigation reflects it.
- Creating or revoking a link expires that user's `memberships` row (`expires_at = now()`) **in the same RPC**, then the server action re-verifies.
- Phase 2: a Salesforce change event (from the bridge report) expires every row whose `external_id` matches the changed Account.

---

## 4. Data model

All new tables: RLS enabled **and forced**, matching `memberships` and `reservations`. Writes go only through `SECURITY DEFINER` RPCs that check the caller (`auth.uid()`, `is_office()`) and write the audit row in the same transaction. Server actions call these RPCs with the **user-scoped** client (`src/lib/supabase/server.ts`), so `auth.uid()` is the real staffer and the database stays the authorization boundary, as the attendee-access spec intends. The precedent is that `reserve_seat` already writes to forced-RLS `reservations` as definer.

```sql
-- Staff capability (MVP)
create table public.office_staff (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  granted_by uuid references auth.users (id) on delete set null,
  granted_at timestamptz not null default now(),
  revoked_at timestamptz
);

create function public.is_office() returns boolean
language sql stable security definer set search_path = '' as $$
  select (select public.is_host())
     and exists (select 1 from public.office_staff
                  where user_id = (select auth.uid()) and revoked_at is null)
$$;
grant execute on function public.is_office() to authenticated;

-- Member requests (MVP)
create table public.membership_requests (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users (id) on delete cascade,
  kind            text not null check (kind in ('not_recognized', 'lapsed_dispute')),
  status          text not null default 'open'
                  check (status in ('open','needs_info','recognized','linked','declined','withdrawn','expired')),
  name_on_record  text check (length(name_on_record) <= 120),       -- PII, purged after resolution
  hint_email      text check (length(hint_email) <= 254),           -- PII, purged after resolution
  message         text check (length(message) <= 1000),             -- PII, purged after resolution
  decline_reason  text check (decline_reason in ('lapsed','unverified','not_member')),
  staff_note      text check (length(staff_note) <= 2000),          -- internal; never emailed
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  resolved_at     timestamptz,
  resolved_by     uuid references auth.users (id) on delete set null,
  pii_purged_at   timestamptz
);
create unique index membership_requests_one_open
  on public.membership_requests (user_id) where status in ('open', 'needs_info');

-- Office-vouched identity link (Phase 2). Identity only: standing is still read from the CRM.
create table public.membership_links (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  provider    text not null,
  external_id text not null,                 -- household Account Id
  request_id  uuid references public.membership_requests (id) on delete set null,
  note        text not null check (length(note) between 5 and 1000),
  created_by  uuid not null references auth.users (id),
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null,
  revoked_at  timestamptz,
  revoked_by  uuid references auth.users (id),
  check (expires_at > created_at and expires_at <= created_at + interval '120 days')
);
create unique index membership_links_one_active
  on public.membership_links (user_id) where revoked_at is null;

-- Append-only audit (MVP)
create table public.membership_audit (
  id              bigint generated always as identity primary key,
  at              timestamptz not null default now(),
  actor_id        uuid references auth.users (id) on delete set null,
  actor_kind      text not null check (actor_kind in ('office','member','system')),
  action          text not null,   -- request.created|request.resolved|recheck|link.created|link.revoked|office.granted|office.revoked|cache.invalidated
  subject_user_id uuid,            -- not an FK: audit outlives account deletion
  request_id      uuid,
  external_id     text,
  details         jsonb not null default '{}'  -- codes and statuses only; no email, no free text
);
```

`memberships` additions (MVP): `reason text`, `source text check (source in ('email','link')) default 'email'`, and `email_sha256 bytea` (hash of the email that was verified). `ensureFreshMembership` treats the row as stale when the hash differs from the hash of `viewer.email`. That closes the gap where a user changes their auth email (`updateUser`; `double_confirm_changes = true` in `config.toml`) and keeps a 24h `active` row earned by the old address.

### RLS and grants

| Table | Browser `anon` | Member (`authenticated`, not office) | Office | Writes |
|---|---|---|---|---|
| `office_staff` | none | none | select (`using (select public.is_office())`) | script / service role only |
| `membership_requests` | none | select own (`user_id = auth.uid()`), to show "request pending" | select all | RPCs: `submit_membership_request` (member, own), `office_resolve_request`, `office_mark_needs_info` |
| `membership_links` | none | none | select all | RPCs: `office_link_household`, `office_revoke_link` |
| `membership_audit` | none | none | select | insert **only** inside the RPCs above. `revoke update, delete, truncate` from all roles, including `service_role` (definer functions insert as owner) |
| `memberships` (existing) | none | none | none (the office sees status through a definer `office_member_status(user_id)` RPC) | unchanged: service role in `verify.ts`, plus expiry from the link RPCs |

Every office RPC starts with `if not public.is_office() then raise exception 'forbidden' using errcode = '42501'; end if;`, the same error code the members-only check uses.

### Retention and PII minimization

- The app never stores household rosters, member names from SF, addresses, or phone numbers. The office looks those up **in Salesforce**. The household-link screen shows only "Active / Not active" and the household display name, fetched live and not persisted.
- `membership_requests` free-text fields (`name_on_record`, `hint_email`, `message`) are nulled 90 days after resolution (set `pii_purged_at`). The skeleton row stays for audit.
- `membership_audit`: keep 3 years (D-10), then delete via pg_cron. The precedent is `20261014090000_schedule_hold_sweep.sql`.
- `membership_links`: revoked or expired rows are deleted after 1 year. Their audit rows remain.
- `memberships`: delete rows for users with no sign-in in 13 months. Ask the signup-lifecycle report whether it also prunes orphan `auth.users` from typo'd OTP requests (design accepts these as harmless).
- Logs: `user_id` only. This is already the rule in `verify.ts`. Extend it to the office actions.

---

## 5. Lifecycle

### 5.1 Status changes and how fast they take effect

| Event | Today | Recommended |
|---|---|---|
| Lapses in SF | Benefits stop at the next stale re-check: ≤24h after the last verification, at checkout | Same 24h for `active` (D-7). Phase 2: SF change event expires the row within minutes |
| Renews in SF | User keeps guest pricing up to 24h unless they sign in again | **Negative TTL 1h** for `lapsed`/`not_found`, plus the member **Check again** button. Signed-in non-members are rare, so the extra SF calls are negligible |
| Office fixes the record | No way to apply it | Office **Re-check now** applies it instantly (§3.7) |
| Link expires | n/a | Next check falls back to email-only matching. The office gets a `link_expiring` digest 14 days before |
| Household lapses while linked | n/a | Link check reads household standing, so it becomes `lapsed` automatically |
| Purchases already made | Snapshotted (`orders.amount_cents`, `member_pricing`). `confirm_order` doesn't re-verify (design D6) | Keep. Already-issued tickets and members-only seats stay valid after a lapse (D-8) |

### 5.2 Grace periods

Let Salesforce own the policy. If the temple's status field already reflects its grace practice (common in NPSP setups), the app adds nothing. If the temple relies on an end date (`npo02__MembershipEndDate__c`), add `graceDays` to `SF_MEMBERSHIP_FIELD_MAP` and compare `end + graceDays >= today` in `salesforce.ts:244-245`. Default 0. Decision D-4. This matters around the fiscal-year rollover, when many dues arrive late.

### 5.3 Re-verification triggers (complete list)

1. Sign-in (existing).
2. RSVP or checkout when stale (existing). Stale now also means "email hash differs".
3. Member **Check again** (new, rate-limited).
4. Office **Re-check now**, link create, or link revoke (new).
5. Salesforce change event → expire rows by `external_id` (Phase 2, needs the bridge).
6. No scheduled sweep (keeps the existing spec's "no scheduled background re-verification").

### 5.4 Bound stale-on-error (ops fix, MVP)

`verify.ts` currently lets an expired cached `active` row stand indefinitely while the provider fails. Add `MAX_STALE_MS` (recommend 7 days past `expires_at`). Beyond that, treat as `not_found` for the request, still never blocking checkout. Emit a structured log on every provider failure, and **alert** (Vercel log drain, or a simple counter row) after N consecutive failures. Put the Connected App **certificate expiry date** in the ops calendar. That certificate is the most likely cause of a silent multi-week outage.

---

## 6. Decisions the temple must make (with recommended defaults)

| # | Decision | Recommended default |
|---|---|---|
| D-1 | Will members-only **High Holy Day** seating ever run through this app? | Not online-self-serve. If yes, office pre-assigns, and this report's assurance level is revisited |
| D-2 | Who in the office can verify members (the `office_staff` list), and who reviews their activity? | 2–3 named staff. The executive director (or delegate) reviews the monthly report |
| D-3 | Can those staff **edit Salesforce** directly, and how fast? | Yes. Fix SF same day. If not, enable household links (Phase 2) as the bridge |
| D-4 | Grace period after the membership end date | 0 days in the app. SF status is authoritative. If end-date driven, 60 days |
| D-5 | Do dependents and adult children on a household contact get member pricing? | Yes. Membership is household-level |
| D-6 | Cap on member-priced tickets per order or per household per event | Member price for up to 10 per order. Remainder at guest price (`MAX_QTY` stays 20) |
| D-7 | How long can an ex-member keep benefits after lapsing in SF? | ≤24h (current TTL). Minutes once change events exist |
| D-8 | Do tickets bought at member price stay valid after a lapse? | Yes. No clawback |
| D-9 | Divorce or separation: who owns the household email association? | CRM process. The office splits contacts in SF. The app follows SF |
| D-10 | Retention of requests and audit | Free text purged 90 days after resolution. Audit kept 3 years |
| D-11 | Deceased contacts' emails | Excluded from matching. Survivors are routed to the office |
| D-12 | Response-time promise shown to members | "Within a few business days" |
| D-13 | Can the app **write** the confirmed email back to SF (Alternate Email)? | No for MVP. The integration user stays read-only (least privilege). Revisit if office volume is high |
| D-14 | Should signed-out visitors see member prices? (open in design) | Yes, as designed |

---

## 7. Testing strategy

**Fake provider** (`src/lib/membership/fake.ts`). Extend it with `MEMBERSHIP_FAKE_HOUSEHOLDS` (JSON `{ "hh-1": "active", "hh-2": "lapsed" }`) and `lookupHousehold`. Add reason codes (`MEMBERSHIP_FAKE_NO_HOUSEHOLD`, `MEMBERSHIP_FAKE_EXCLUDED`). Scenarios: active, lapsed, not_found, no_household, excluded (deceased), ambiguous, provider throws, provider hangs (budget), and flips mid-session (env changed between calls, already supported by reading env on each lookup).

**Unit** (`membership.test.ts`, `salesforce.test.ts`, run by the existing `test:unit`):
- Negative TTL is 1h; active TTL is 24h.
- `force: true` bypasses a fresh cache.
- Email-hash mismatch is treated as stale.
- Stale-on-error ceiling (`MAX_STALE_MS`).
- Link present, email not found: household standing is used. Link to a lapsed household reads lapsed. Expired or revoked link is ignored.
- Salesforce: deceased excluded; no-AccountId reads `not_found/no_household`; multi-household ambiguous sets `matchCount`; `lookupHousehold` escaping with a hostile Id; `graceDays`; `contactExcludeFlags` rejected unless they match `IDENT_RE`.

**DB** (`supabase/tests/office.test.mjs`, same `inTx` and `as(c, id, role)` pattern as `roles.test.mjs`):
- A member sees only their own request and cannot read others, links, audit, or `office_staff`.
- A member cannot submit a second open request (unique index).
- A host **without** an `office_staff` row gets `42501` from every office RPC. A host **with** one succeeds.
- Revoking `office_staff` denies immediately, with no token refresh.
- A non-OAuth session with an `office_staff` row is denied (`is_host()` false).
- Every office RPC writes exactly one audit row. `update`/`delete` on audit fail for every role.
- Link `expires_at` over 120 days is rejected. A second active link is rejected.
- A link RPC expires the user's `memberships` row.

**E2E** (Playwright; no suite exists yet, so add `e2e/` with `@playwright/test`):
- Member flow: not_found member sees the note, submits a request, sees "request pending".
- Office flow: the queue shows the request. Flip the fake provider to active, then **Re-check now**: the request is `recognized`, the member page shows member pricing on the next load, and the email preview (`sendEmail` returns `previewPath`) contains the right template.
- Check again: flip env, click, member price appears. Rate limit message on the second click.
- Phase 2 link flow: link to `hh-1` gives member pricing. Flip `hh-1` to lapsed and recheck: guest pricing.
- Host sessions in E2E: Microsoft OAuth can't run headless. Add a **local-only** helper that mints an access token with the local JWT secret (`app_metadata.app_role = 'host'`, an `amr` oauth entry) for a seeded user with an `azure` identity and an `office_staff` row, and sets the `@supabase/ssr` cookie. Guard it hard: refuse unless `SUPABASE_URL` is `127.0.0.1`.

---

## 8. Phased plan (file-level)

### Phase 0: close the loop without office UI (small; MVP)
- `src/lib/membership/provider.ts`: add optional `reason`, `matchCount` to `MembershipResult`.
- `src/lib/membership/salesforce.ts`: no-household returns `not_found`/`no_household`; `contactExcludeFlags` (default `["npsp__Deceased__c"]` in docs); `graceDays`; deterministic lapsed `externalId`.
- `src/lib/membership/verify.ts`: per-status TTL (active 24h, other 1h); `force` option; `email_sha256` staleness; `MAX_STALE_MS`; structured failure log.
- New migration `supabase/migrations/<ts>_membership_cache_v2.sql`: `memberships.reason`, `source`, `email_sha256`.
- `src/app/membership/actions.ts` (new): `checkAgain()` server action, with a per-user rate limit read from `memberships.verified_at`.
- `src/components/MemberBits.tsx`: reason-specific copy, the **Check again** button, and the sign-in email shown, so the member knows what to tell the office.
- `supabase/config.toml` and hosted settings: `otp_expiry = 600`; enable Turnstile captcha (`[auth.captcha]`).
- Office runbook (a page in `README.md` or `docs/`): fix SF, then tell the member to tap Check again.
- Spec delta in `openspec/changes/add-member-auth/specs/membership-verification/spec.md`: per-status TTL, member-initiated re-check, stale-on-error ceiling.

### Phase 1: MVP office tooling
- Migration `<ts>_office_verification.sql`: `office_staff`, `is_office()`, `membership_requests`, `membership_audit`, RPCs (`submit_membership_request`, `office_resolve_request`, `office_mark_needs_info`, `office_member_status`), RLS, grants, pg_cron purge job. Down migration in `supabase/rollback/`.
- `src/lib/supabase/viewer.ts`: `requireOffice()`, which calls `requireHost()` then RPC `is_office()` (the database is authoritative; no JWT claim needed).
- `src/lib/supabase/session.ts`: unchanged. `/dashboard/office` is already behind the host gate, and the page enforces office.
- `src/app/membership/request/page.tsx` and `actions.ts` (new): member request form.
- `src/app/dashboard/office/page.tsx`, `[requestId]/page.tsx`, `actions.ts` (new): queue, detail, Re-check now, Decline, Need info, look up by email.
- `src/components/SiteHeader.tsx`: office link and badge count for office users.
- `src/lib/email/` templates: recognized, needs_info, declined_lapsed, declined_unverified.
- `scripts/grant-office.mjs` (new): grant and revoke, with an audit row.
- `supabase/tests/office.test.mjs`; `e2e/` scaffold plus the office flow.
- New OpenSpec change (`add-office-verification`), proposed through `/opsx:propose` per the project's workflow.

### Phase 2: household links, events, review
- Migration: `membership_links`, `office_link_household`, `office_revoke_link`, expiry digest job.
- `provider.ts`: `lookupHousehold(externalId)`. Implement in `salesforce.ts` and `fake.ts`.
- `verify.ts`: when email lookup is not active and an active link exists, use household standing (`source = 'link'`).
- **Spec change required:** amend "SHALL NOT grant member status by any means other than a provider result" to "…other than a provider result for the user's email **or** for a household an office user has linked to that account, within the link's validity". Standing remains provider-only.
- SF change-event endpoint `src/app/api/membership/salesforce-events/route.ts`, shape per the bridge report. It expires `memberships` by `external_id`.
- Office **Links** tab and monthly review report.

### Phase 3: later
- Entra app role or group for office, synced into `office_staff` by the hook, after a claim-propagation spike.
- Gmail-only canonical matching, if mismatch data justifies it and the bridge provides a mirror or formula field.
- Optional SF write-back of confirmed alternate emails (D-13).
- Member-price-per-household caps across orders (D-6), if abuse shows up.

---

## 9. Interfaces needed from the sibling reports

**From the Salesforce bridge topology report**
1. `lookup({ email })` returning `status`, `externalId` (household Account Id), and the new `reason` and `matchCount`, whether it runs as a live query or against a mirror.
2. `lookupHousehold(externalId)` returning status and a display name (not persisted) for office links.
3. Contact exclusion support (`npsp__Deceased__c` and any temple flags) and `graceDays` in the field map.
4. **Change notifications** (CDC, Platform Event, or Flow HTTP callout) carrying the **AccountId** when household status, end date, or a contact's email or deceased flag changes, plus how the endpoint authenticates.
5. API-limit headroom for per-status TTLs, Check again, and office rechecks. Expect low hundreds of calls per day.
6. Confirmation that the integration user stays **read-only**. Office edits happen in the Salesforce UI.
7. Certificate and credential rotation procedure and expiry monitoring (feeds §5.4).

**From the guest/member signup lifecycle report**
1. Where the "not recognized" state surfaces after sign-in (landing page, header menu), so the request entry point lives in one place.
2. Email-change policy (`updateUser`). This report assumes the email hash marks the cache stale.
3. Account deletion: cascades remove `memberships`, requests, and links. Audit keeps `subject_user_id` without an FK.
4. Pruning of orphan `auth.users` from never-verified OTP requests, and alignment with the 13-month `memberships` prune.
5. Shared email templates and sender identity for membership notifications.
6. How a guest who later becomes a recognized member relates to their earlier guest orders (`orders.buyer_email`). This report does not link them.
