# Salesforce ↔ Emanuel Tickets membership bridge: architecture report

Date: 2026-10-15. Status: recommendation and proposal. Nothing here is implemented yet.
Scope: how the app learns who is a member from the temple's Salesforce org, and how staff run that link day to day. Builds on `openspec/changes/add-member-auth/` (design D4, D5, D7) and its code in `src/lib/membership/`.

---

## 0. Summary

**Recommendation: keep the live per-user lookup as the data path, and add the parts it is missing: a management plane, and a data contract that the temple owns inside Salesforce.** Do not build a roster sync, a separate service, or middleware now. Push-based invalidation (a Salesforce Flow calling a Vercel route) is an optional Phase 3. Write-back to Salesforce is a separate, later project that needs temple sign-off.

The current implementation gets the data path right: a pull lookup at sign-in and when the cache is stale at checkout, almost no PII stored, and a fallback to the cached result when Salesforce is down. What the user is noticing is real. Everything around that path is missing:

1. **Nobody owns the meaning of "member".** `SF_MEMBERSHIP_FIELD_MAP` is a JSON env var that the app maintainer has to fill in from guesses about the temple's org. The definition should live in Salesforce as a single "contract" field that the temple's Salesforce admin owns.
2. **The office cannot answer "why isn't this person a member?"** It also cannot fix a record and have the app notice, cannot grant a temporary exception, and cannot see when the bridge is broken.
3. **Setup instructions are out of date.** The README tells the temple to create a *Connected App*. Salesforce has restricted creation of new Connected Apps in every org since Spring '26. The supported replacement is an *External Client App*.
4. **There are small correctness gaps in `salesforce.ts`** (see §7.1). The two that matter most: `externalId` sometimes holds a Contact Id and sometimes an Account Id, and when the office fixes a record in Salesforce, a "lapsed" result can still stay cached for 24 hours.

---

## 1. What exists today (grounded in code)

| Piece | Where | Behavior |
|---|---|---|
| Provider seam | `src/lib/membership/provider.ts` | `lookup({email}) → {status: active\|lapsed\|not_found, externalId, checkedAt}`; throws on transport failure |
| Registry | `src/lib/membership/index.ts` | `MEMBERSHIP_PROVIDER` = `fake` \| `salesforce`; fake outside prod |
| Salesforce adapter | `src/lib/membership/salesforce.ts` | JWT bearer (`SF_LOGIN_URL` used as both token host **and** `aud`), token cached per instance, refreshed once on 401. SOQL `SELECT Id, AccountId FROM Contact WHERE Email = x OR npe01__HomeEmail__c = x OR npe01__WorkEmail__c = x OR npe01__AlternateEmail__c = x`, then `SELECT <map fields> FROM <map.object> WHERE <accountField> IN (...)`. Active if any household record matches `activeValues` (+ optional end date). API `v60.0`. |
| Cache + policy | `src/lib/membership/verify.ts` | 5 s total budget, 1 retry, upsert to `public.memberships`, cached fallback, `RECHECK_MS = 24h` for **all** statuses; logs `user_id` only |
| Callers | `src/app/signin/actions.ts:58`, `src/app/auth/confirm/route.ts:21` (always re-verify at sign-in); `src/app/e/[id]/actions.ts:57,141` (`ensureFreshMembership`); `src/app/e/[id]/page.tsx:123`, `src/components/SiteHeader.tsx:27` (cached read) | |
| Storage | `supabase/migrations/20261014120000_member_auth.sql` | `memberships(user_id, provider, external_id, status, verified_at, expires_at)`, RLS forced, no policies |
| Roles | `src/lib/supabase/viewer.ts` | `host` (Microsoft OAuth + azure identity) \| `member`. **There is no "office/admin" role.** |
| Scheduling | `supabase/migrations/20261014090000_schedule_hold_sweep.sql` | pg_cron already in use; `vercel.json` has no crons |

---

## 2. Bridge topology

### 2.1 Options weighed

| Option | Freshness | PII in app | SF API cost | Failure mode | Ops burden for a small IT team | Cost | Verdict |
|---|---|---|---|---|---|---|---|
| **(a) Live per-user pull** (today) | At sign-in; ≤24 h at checkout | Minimal: status + an opaque Id per signed-in user | ~2 calls per lookup | SF down → cached status, or guest pricing | Low: one integration user, one cert | $0 | **Keep; it is the core** |
| **(b) Scheduled roster sync** into Postgres | Up to the sync interval (e.g. nightly) | **Whole roster** (emails of every member, including people who never use the app) | Low per run (Bulk API) but runs every day | Sync silently stops, so the whole roster goes stale; drift when deletions are missed | Medium: job, deletes, reconciliation, PII retention policy | $0 to low | **Reject for now**: stores PII the app has no use for (design D4 already rejected this). Revisit only if a feature needs the roster (a member directory or attendee-tagging for people who never sign in) |
| **(c1) Flow-triggered HTTP callout** to a Vercel route | Seconds after an SF change | None (payload is SF Ids only) | Uses SF-side async callouts, not inbound API calls | Callout fails → fallback is the TTL; bulk edits fan out one callout per record | Medium: Named Credential, External Credential, a Flow to maintain inside SF | $0 | **Optional Phase 3**, for cache invalidation only (not a data feed) |
| (c2) Change Data Capture / Platform Events over Pub/Sub API | Seconds | Change payloads can carry PII | 25k delivered events/day on EE (older docs) | Needs a **long-lived gRPC/CometD subscriber**. Vercel functions are not long-lived, so this means another always-on worker | High | Worker hosting | **Reject** |
| (c3) Outbound Messages (SOAP) | Seconds | Configurable | n/a | SOAP endpoint + ack semantics; legacy | Medium | $0 | Reject (c1 does the same job and is simpler) |
| (d) Standalone verification service | Same as (a) | Same | Same | Another deployable to keep healthy | Higher: separate hosting, auth between services | $ | **Reject now**. The provider seam already lets it be extracted later (design D4) |
| (e) MuleSoft / Zapier / Make | Varies | Membership data passes through a third party | Same or more | Another vendor in the trust boundary | Low to start, high to debug | MuleSoft is enterprise-priced; Zapier tiers per task | **Reject**: cost, a PII processor the temple must vet, and it hides failures from the app |

Sources: CDC allocations, [developer.salesforce.com: CDC Allocations](https://developer.salesforce.com/docs/atlas.en-us.change_data_capture.meta/change_data_capture/cdc_allocations.htm). Flow async callout rules (immediate path not allowed; credentials via Named/External Credential; one interview per record), [Trailblazer Community thread](https://trailhead.salesforce.com/trailblazer-community/feed/0D5KX00000pQEAu0AO) (community source; confirm in Salesforce Help).

### 2.2 API budget check for (a)

- Enterprise Edition: **100,000 API requests per 24 h, plus about 1,000 per Salesforce user license**. It is a soft limit, and past a protection threshold calls fail with `REQUEST_LIMIT_EXCEEDED` ([Salesforce limits cheatsheet](https://developer.salesforce.com/docs/platform/salesforce-app-limits-cheatsheet/guide/salesforce-app-limits-platform-api.html), [Salesforce dev blog, Nov 2024](https://developer.salesforce.com/blogs/2024/11/api-limits-and-monitoring-your-api-usage)).
- Nonprofits on Power of Us get **10 donated Enterprise Edition licenses** (Nonprofit Cloud or Sales/Service Cloud bundle), so API access is included ([Salesforce Nonprofit pricing guide PDF](https://www.salesforce.com/en-us/wp-content/uploads/sites/4/documents/industries/nonprofit/S-ORG(DG)-Salesforce-for-NonProfit-Cloud-Pricing-Guide-Final.pdf), [Magicfuse 2026 guide](https://magicfuse.co/blog/salesforce-power-of-us-program)). **If the temple is on Professional or Essentials, API access may not be included at all. Confirm the edition (Setup → Company Information).**
- Worst realistic case: 2,000 sign-ins plus checkouts in a High Holy Days ticket rush, at about 2 calls each (plus token requests), is about 4–5k calls. That is under 5% of the base allocation. The other integrations in the org (email marketing, payment processors, data loaders) share the same pool, so §4.4 adds a daily check of `/limits`.
- Conclusion: **API limits do not justify a sync.** The lookup design is already frugal.

### 2.3 Platform: NPSP vs Nonprofit Cloud ("Agentforce Nonprofit")

The code assumes **NPSP**: household Accounts, Contacts with `npe01__*Email__c` fields, membership as Opportunities with NPSP rollups. Nonprofit Cloud (NPC, renamed Agentforce Nonprofit in Oct 2025) uses **Person Accounts plus Party Relationship Groups** for households and Gift Commitment/Gift Transaction objects. The two cannot coexist in one org, and NPSP is feature-frozen but still supported ([Magicfuse comparison](https://magicfuse.co/blog/salesforce-nonprofit-cloud-vs-npsp), [Soapbox Engage: contacts vs person accounts](https://www.soapboxengage.com/blog/2478-salesforce-new-nonprofit-cloud-tips-contacts-vs-person-accounts), [SalesforceBen: NPSP → NPC migration](https://www.salesforceben.com/salesforce-nonprofit-success-pack-to-nonprofit-cloud-migration/)).

What NPC would mean for this adapter: Person Accounts still have a backing Contact (`PersonContactId`), and `Contact.Email` mirrors `PersonEmail`. So the Contact query still matches, but the `npe01__` fields do not exist and will cause a query error. Household standing would live on a PRG or a Business Account, reached through `AccountContactRelation`, not `Contact.AccountId`. **The contract-field approach in §3 hides this difference.** Either way, the temple exposes one field that answers "in good standing?" on the record the person's Contact points to.

**A migration from NPSP to NPC later would break the bridge.** Section 4.4's daily schema check (describe the contract fields) catches that on day one, not at the next ticket sale.

### 2.4 Recommendation

```
                 ┌──────────── Salesforce (temple-owned) ─────────────┐
                 │ Contact (emails) ─AccountId→ Household Account      │
                 │                    Emanuel_Tickets_Member__c (formula, │
                 │                    owned by temple SF admin)         │
                 │ External Client App + API-only integration user      │
                 │ (read-only perm set)                                 │
                 │ [Phase 3] Flow → HTTP callout (Ids only) ────────┐   │
                 └───────────────▲──────────────────────────────────┼───┘
              JWT bearer + SOQL  │ pull, ≤2 calls                   │ push: "re-check these households"
                 ┌───────────────┴───── Vercel (Next.js) ──────────▼───┐
                 │ membership/salesforce.ts  lookup() / diagnose()      │
                 │ membership/verify.ts      TTL, overrides, log        │
                 │ /dashboard/members        office tool (lookup why,   │
                 │                           re-check, overrides)       │
                 │ /api/cron/membership-health  daily self-test + alert │
                 └───────────────┬──────────────────────────────────────┘
                 ┌───────────────▼── Supabase ─────────────────────────┐
                 │ memberships (+reason, +source)  membership_overrides │
                 │ membership_events (no PII, 30-day retention)  staff_roles │
                 └──────────────────────────────────────────────────────┘
```

---

## 3. Data contract

### 3.1 Recommended contract: one formula field the temple owns

Ask the temple's Salesforce admin to create **one checkbox formula field on the household Account**, e.g. `Emanuel_Tickets_Member__c`, whose formula encodes the temple's own definition of "member in good standing". Add an optional text formula `Emanuel_Tickets_Member_Reason__c`, for example `"Dues current"`, `"Grace period"`, `"Dues relief"`, `"Expired 2026-06-30"`.

The app's field map then becomes a constant:
`{"object":"Account","accountField":"Id","statusField":"Emanuel_Tickets_Member__c","activeValues":["true"]}`.

Why:
- **Ownership sits with the people who own the data.** The rules (grace periods, dues relief, clergy and staff households, honorary members, multi-year pledges) are temple policy and already live in Salesforce. When the rules change, the SF admin edits a formula and the app needs no deploy.
- **It isolates the app from the data model.** NPSP vs NPC, a custom dues object, or a third-party synagogue package: the app reads one field.
- **It can be tested in Salesforce.** The admin can build a list view or report on the formula and see exactly who the app will treat as a member.
- **Limitation:** formula fields cannot aggregate child records. If "good standing" depends on Opportunities, the formula must read the NPSP household rollups (below), a Customizable Rollup, or a Flow-maintained field.

### 3.2 NPSP building blocks the formula can use (verify by describe in the temple's org)

NPSP tracks memberships as Opportunities, typically of the **Membership** record type, with level, start/end date, and origin fields. NPSP rolls these up to Contact and household Account. A "Membership Status"-style value on the Account is driven by the **grace period** setting (NPSP Settings → Donations → Membership): it reads "Grace Period" for N days after the end date and then "Expired" ([SFDO community Membership best-practices wiki](https://github.com/SFDO-Community-Sprints/Membership-Essentials-App/wiki/Membership-Best-Practices)). Field API names commonly seen in NPSP orgs, **all to be confirmed by `describe`**:

- Opportunity: `npe01__Member_Level__c`, `npe01__Membership_Start_Date__c`, `npe01__Membership_End_Date__c`, `npe01__Membership_Origin__c`
- Account / Contact rollups: `npo02__MembershipEndDate__c`, `npo02__MembershipJoinDate__c`, `npo02__LastMembershipLevel__c`, `npo02__LastMembershipDate__c`
- Contact flags: `npsp__Deceased__c`, `npsp__Do_Not_Contact__c`, `HasOptedOutOfEmail`; `npe01__Preferred_Email__c` (NPSP copies the preferred address into `Email`)

Known pitfalls from the community:
- Contact-level membership rollups follow the Opportunity's **primary contact role** only, so a spouse can show no membership at the Contact level. This is why the app evaluates the household, which is correct.
- Reports filtered only on "Active" drop members in the grace period. **The `activeValues` in the current README example would do the same.**

### 3.3 Discovering the temple's real configuration (before anyone writes a formula)

Add a **read-only discovery script** (`scripts/sf-discover.mjs`) that runs as the integration user (or that the temple's admin runs with their own credentials in a sandbox). It prints **only metadata and aggregate counts, never names or emails**:

1. Whether the org has NPSP or NPC: are the `npe01__` / `npo02__` / `npsp__` namespaces present? Is `Account.IsPersonAccount` present? Do `PartyRelationshipGroup` or `GiftTransaction` exist?
2. Account/Contact/Opportunity fields whose label or name matches `/member|dues|standing|pledge|household/i`.
3. Opportunity record types, with `COUNT()` per record type for the last 3 fiscal years.
4. `GROUP BY` counts of candidate status/level fields (for example, how many households have each `npo02__LastMembershipLevel__c`).
5. **Email coverage**: the count of household Accounts that "look active" with ≥1 living Contact that has any email, versus those with none. This number predicts how many members will hit "we couldn't match you", and it is the biggest UX risk.
6. Count of Contacts sharing the same email across different households (shared family addresses).

Then hold one working session with the SF admin and the executive director or membership office to agree the formula, and run (5) again against the formula.

**Possibility to rule out early:** the temple may bill dues outside Salesforce (in an accounting or synagogue-management system) and sync only partially. If so, Salesforce is not actually the source of truth, and the contract must say where truth lives.

### 3.4 Matching and household semantics

| Case | Current behavior | Recommendation |
|---|---|---|
| Email in any of 4 NPSP email fields | Matches (SOQL `OR`) | Keep. `Contact.Email` is a standard indexed field; the `npe01__` fields are not, so the OR runs as a scan. That is fine at congregation scale (tens of thousands of Contacts). SOSL `IN EMAIL FIELDS` is indexed but lags writes by ~15 min ([SF LDV search architecture](https://developer.salesforce.com/docs/platform/salesforce-large-data-volumes-bp/guide/ldv-deployments-concepts-search-architecture.html)), which would undermine "office fixed it, try again". **Stay on SOQL.** Make the email field list part of the config so NPC orgs can drop the `npe01__` fields. |
| Spouse/partner on a dues-paying household | Active (household evaluation) | Keep |
| Same email on Contacts in **different** households | Active if any household is active | Keep, but record `reason = shared_email_multi_household` so the office tool can show it. Temple decision: is that acceptable? |
| Contact with no AccountId | `lapsed` with a **Contact** Id as `externalId` | Return `not_found` with reason `no_household`, or keep `lapsed`, but **always use household Account Id or null for `externalId`** (consistency is needed for push invalidation in §2.1 (c1)) |
| Deceased contact | Not filtered | Filter `npsp__Deceased__c = false` (configurable). Otherwise a surviving relative could keep using the deceased person's address on that record, and NPSP moves deceased contacts out of named households inconsistently ([NPSP guide: When Someone Dies](https://nonprofits101.screenstepslive.com/s/npsp3/m/111936/l/1781130-when-someone-dies)). **Temple decision.** |
| Do Not Contact / email opt-out | Ignored | Correct for verification: the person is asking to be recognized, not being contacted. These flags **do** matter for any future write-back or marketing (§5). |
| Minors with their own email on a member household | Active | Probably intended (household benefit). **Temple decision**, especially if members-only events involve alcohol or adult content. The app knows no ages and should not start collecting them. |
| Staff who are also members | Staff accounts are refused email-code sessions (design D1), so a staff member cannot be a "member" viewer | Known limitation; staff use a personal email for member pricing. Document it for the office. |
| Grace period | Depends on `activeValues` | Encoded in the temple's formula (§3.1) |

---

## 4. Management and operations

### 4.1 Who owns what

| Concern | Owner | Mechanism |
|---|---|---|
| Definition of "member in good standing" | Temple membership office (policy) + SF admin (formula) | Salesforce formula field (§3.1); change control inside SF |
| App-side field map (object, field names, email fields) | App maintainer | **Checked-in config** `src/lib/membership/salesforce-contract.ts` with fixture tests. It is not secret, and versioning plus PR review beats an env var. `SF_MEMBERSHIP_FIELD_MAP` stays only as an emergency override. |
| Integration user, External Client App, certificate | Temple IT / SF admin | Salesforce Setup; runbook in README |
| Secrets in Vercel | App maintainer | Vercel env vars marked **Sensitive**, Production only (§6.2) |
| Alerts | One named temple IT contact + app maintainer | `BRIDGE_ALERT_EMAIL` (§4.4) |
| Overrides | Named office staff with the `membership_admin` capability | `/dashboard/members` (§4.6) |

**Why not a DB-backed admin setting for the field map:** it changes once a year at most. A typo would make every member a guest or every guest a member, and "safe" editing would need validation, preview, rollback, and audit, i.e. a feature. With the contract field, the risky part of the config moves into Salesforce, where the admin can preview it with a report. What remains on the app side is stable plumbing.

### 4.2 Safe configuration changes

1. Any contract change is made in an **SF sandbox** first. Point a Vercel Preview deployment at the sandbox (`SF_LOGIN_URL=https://test.salesforce.com`, a sandbox External Client App, Preview-scoped env vars).
2. `/dashboard/members` → "Look up" with one known-active, one grace-period, and one lapsed test email (the existing README step, made into a repeatable tool).
3. Production: change the formula in SF. If app-side config also changed, deploy. Then the health check (§4.4) runs on demand from the office page.
4. Rollback: revert the formula, or `MEMBERSHIP_PROVIDER=fake` with empty lists so everyone gets guest pricing and no outage.

### 4.3 Credential lifecycle

- **Use an External Client App (ECA), not a Connected App.** Salesforce restricts creating new Connected Apps in all orgs as of Spring '26 (newly provisioned orgs since Winter '26). Existing ones keep working, and a Support exception is temporary. ECAs support the JWT bearer flow ([Striim: Connected Apps and ECAs](https://striim.com/docs/en/salesforce-connected-apps-and-external-client-apps.html), [Salesforce CLI: create a connected app](https://developer.salesforce.com/docs/platform/sfdx-dev/guide/sfdx-dev-auth-connected-app.html), [Salesforce Dictionary 2026 ECA migration](https://salesforcedictionary.com/blogs/salesforce-external-client-apps-migration-2026)). **The README Salesforce setup paragraph must change.** Also drop the `refresh_token` scope, which JWT bearer does not use; `api` is enough.
- **Certificate:** self-signed, with a deliberate validity (recommend 2 years). Record its `notAfter` in a non-secret env var `SF_CERT_NOT_AFTER`, or store the public cert as `SF_CERT_PEM` and parse it, so the health check can warn 45/14/3 days before expiry.
- **Rotation runbook:** generate a new key pair → upload the new cert to the ECA → update `SF_PRIVATE_KEY` in Vercel → redeploy → health check. If the ECA holds a single cert, there is a short window where tokens fail. The cached fallback in `verify.ts` covers it (members keep cached status, nobody is blocked). Schedule rotation for a quiet weekday morning, not before a ticket launch.
- **Integration user:** use a free **Salesforce Integration** license (API-only, no UI login; 5 free licenses in Enterprise/Unlimited/Performance since 2023) with the **Salesforce API Integration** permission set license ([Apex Hours](https://www.apexhours.com/salesforce-integration-user-license/), [Salesforce Time](https://salesforcetime.com/2023/03/11/salesforce-integration-user-license/)). Do not spend one of the 10 donated licenses on it.
- **If the integration user is deactivated or frozen, or the ECA is blocked,** token requests fail. The health check catches this within a day, and the office page shows it immediately.

### 4.4 Monitoring and alerting

New route `src/app/api/cron/membership-health/route.ts`, scheduled with a **Vercel Cron** entry in `vercel.json` (daily, which works on every plan; protect it with `CRON_SECRET`). It checks:

1. A token exchange succeeds and reports the time taken.
2. `GET /services/data/vXX/limits`: alert if `DailyApiRequests.Remaining < 25%`.
3. `describe` of Contact and of the contract object: alert if any configured field is missing. This catches a renamed field, removed field-level security, or an NPSP→NPC migration.
4. Certificate expiry from `SF_CERT_NOT_AFTER`.
5. From the last 24 h of `membership_events`: lookup count, error rate, p95 latency, and count of fallbacks to cache. Alert if error rate > 10% with ≥ 10 lookups.
6. **Salesforce API version retirement:** alert when `API_VERSION` is within 1 year of Salesforce's announced retirement. Practically, a yearly reminder to bump `v60.0`.

Alerts go by email through Resend (already a dependency) to `BRIDGE_ALERT_EMAIL`. Salesforce also offers native **API usage notifications** in Setup; ask the SF admin to set one at 70%.

Live-path signal: `verify.ts` writes one row per lookup to `membership_events(at, user_id, outcome, reason, latency_ms, error_class)`. It contains **no email**. `error_class` is from a closed set: `token`, `http_4xx`, `http_5xx`, `timeout`, `config`, `query`. Rows are pruned after 30 days by pg_cron, alongside the existing hold sweep.

### 4.5 Logging without PII

- Keep the current rule: logs carry `user_id`, never email. Additionally:
  - Never log the SOQL string or the request URL: the email is inside `?q=`. The current code logs only `err`, whose messages carry status codes only. Keep it that way, and add a unit test that error messages from `query()` contain no `@`.
  - Never log Salesforce error bodies verbatim (they can echo the query). Map them to `error_class`.
- The office diagnostics page (§4.5.1) shows **Salesforce record Ids and contract-field values, not names or addresses**, plus a deep link `https://<instance>/lightning/r/Account/<Id>/view`, so staff read PII in Salesforce under their own login and sharing rules.

#### 4.5.1 Office view: "why isn't this person a member?"

Add `diagnose(email)` to the Salesforce provider, sharing the code path with `lookup` and returning a trace:

```
matched contacts: 2  (fields matched: npe01__HomeEmail__c, Email; 1 deceased → ignored)
households: 001… (Emanuel_Tickets_Member__c = false, reason "Expired 2026-06-30")
            001… (Emanuel_Tickets_Member__c = true,  reason "Dues current")
decision: active (household 001…)   override: none   app cache: lapsed, verified 3h ago
```

Page `src/app/dashboard/members/page.tsx` is gated by a new `membership_admin` capability, not by "any host". Every diagnose call is written to the audit log (who looked up which email hash, when).

### 4.6 Manual overrides by office staff

Use overrides for the cases Salesforce cannot fix fast enough: a new member whose dues posted today, or a member using an email the office has not entered yet. Rules:

- **Grant-only** (an override can make someone a member, not take membership away). Keyed by **normalized email**, so it works before the person has ever signed in.
- **Mandatory expiry, maximum 90 days**, and a mandatory reason. The UI nudges: "Please also fix this in Salesforce."
- **Precedence** in `verify.ts`: provider `active` → active (`source = provider`). Otherwise an unexpired, unrevoked override → active (`source = override`). Otherwise the provider status. Overrides also apply when Salesforce is down.
- **Audit:** append-only `membership_audit(at, actor_user_id, action, target_email_hash, detail)` for `override.create`, `override.revoke`, `diagnose`, and `recheck`. The weekly health email lists active overrides that expire within 7 days.

### 4.7 Cache invalidation when the office fixes a record

In order of value and cost:

1. **Asymmetric TTL (code change in `verify.ts`):** `active` is re-checked after 24 h (unchanged). `lapsed` and `not_found` are re-checked if older than **10 minutes** at any purchase attempt. That fixes the "office fixed it and nothing happens" case, at the cost of a lookup per checkout for signed-in non-members, which is cheap. Today a lapsed result stays cached for 24 h at checkout (`ensureFreshMembership`). Signing in again does re-verify (`signin/actions.ts:58`), but the person has no reason to know that.
2. **"Check again" button** on the member's mismatch note (`src/components/MemberBits.tsx`): a server action calling `verifyMembership`, limited to once per minute per user.
3. **Office "Re-check now"** on `/dashboard/members`: looks up the `auth.users` row by email and calls `verifyMembership`.
4. **Phase 3, push invalidation:** a record-triggered Flow on the contract field (async path, HTTP Callout through a Named Credential with a shared-secret header) posts `{accountIds:[…]}` to `/api/membership/salesforce-hook`. The route sets `expires_at = now()` for matching `memberships.external_id`. It needs consistent household Ids (§3.4). Build it only if 1–3 prove insufficient.

---

## 5. Write-back to Salesforce

**Recommendation: no write-back in this phase.** Then, in order and only with explicit temple approval:

| Candidate | Value to temple | Risk | Recommendation |
|---|---|---|---|
| **Attendance → Campaign Members** (event = Campaign, matched attendee = CampaignMember with status "Registered"/"Attended") | High: engagement history on the member record, without manual entry | Matching guests (no sign-in) by email is fuzzy; volume per event is small | **First and probably only.** Write only for attendees that already match an existing Contact. Nightly batch, idempotent on an external-Id field (`Emanuel_Tickets_Order_Id__c`) |
| **Create Contacts for new guests** | Prospect pipeline | Duplicates (NPSP duplicate rules, households created on Contact insert), consent/privacy, and households polluted with one-off buyers | **Don't auto-create.** Produce a weekly "unmatched attendees" CSV for the office to import with their own duplicate rules |
| **Ticket revenue → Opportunities** | Revenue in one place | **Double counting** against finance's system of record (Stripe → accounting). NPSP Opportunity rollups change household giving totals, and possibly membership rollups if the record type is wrong | **No**, unless finance asks. If it ever happens, use a dedicated record type excluded from donor and membership rollups, built in a sandbox with the finance lead |

Requirements before any write-back:
- A **separate** integration user or permission set with write access, so the read path stays least-privilege.
- Respect `npsp__Do_Not_Contact__c` and `HasOptedOutOfEmail` for anything that feeds communications.
- Approval from the data owner (executive director or membership office) and a privacy note in the ticketing terms ("Your attendance may be recorded in the temple's records").
- Bulk/Composite API with idempotency, and a dead-letter table for failures.

---

## 6. Security

### 6.1 Integration user: least privilege

- Salesforce Integration license and an API-only profile (Minimum Access – API Only Integrations). A permission set on the **Salesforce API Integration** permission set license grants:
  - **Read** on Contact: `Id`, `AccountId`, `Email`, `npe01__HomeEmail__c`, `npe01__WorkEmail__c`, `npe01__AlternateEmail__c`, `npsp__Deceased__c`.
  - **Read** on Account: `Id`, `Emanuel_Tickets_Member__c`, `Emanuel_Tickets_Member_Reason__c`.
  - No Opportunity access needed if the contract formula holds the logic (formula fields evaluate regardless of the reader's access to their inputs; confirm in the org).
  - No Create/Edit/Delete; no View All Data / Modify All Data; no other objects.
- **Record visibility:** if the org-wide default for Contact/Account is Private, the integration user needs a sharing rule or object-level "View All" on Contact and Account only. Otherwise lookups return `not_found` for records it cannot see, which looks like data problems. The discovery script (§3.3) should compare its counts with what the admin sees.
- **ECA policies:** "Admin approved users are pre-authorized", with only the integration user's permission set assigned. Scope `api` only. IP restrictions are impractical (Vercel egress IPs are dynamic unless the project buys Secure Compute), so the certificate is the control. Keep the private key out of every other system.
- Salesforce's 2025 connected-app usage restrictions block *uninstalled* apps for most users. An app created in the org is installed, so this does not affect a temple-owned ECA. Do not grant "Use Any API Client" to the integration user ([Salesforce Admins blog](https://admin.salesforce.com/blog/2025/get-ready-for-changes-to-connected-app-usage-restrictions)).

### 6.2 Secrets on Vercel

- `SF_PRIVATE_KEY`, `SF_CLIENT_ID`, `SF_USERNAME` as **Sensitive** env vars (write-only after creation), **Production** scope only. Preview uses a sandbox ECA with separate values, or `fake`. Development never holds the production key.
- Limit who can edit env vars on the Vercel team. Every env change triggers a deploy, which leaves an audit trail.
- `CRON_SECRET` and the Phase 3 hook secret are Sensitive too. The hook verifies the header with constant-time comparison.

### 6.3 SOQL injection

- Current code: the email is validated by regex, then `soqlString` escapes `\` then `'`. That is correct for SOQL string literals. Field names from the map pass an identifier regex (`IDENT_RE`). Keep both. Move the field names into the checked-in contract so they are no longer runtime input. Keep the unit test with a hostile email (`salesforce.test.ts`).
- Account Ids come from Salesforce responses and are also escaped. Additionally validate them against `/^[a-zA-Z0-9]{15,18}$/`.
- If SOSL is ever adopted, it needs a different escape set (`? & | ! { } [ ] ( ) ^ ~ * : \ " ' + -`).

### 6.4 Data residency and PII footprint

- Salesforce (temple's org region), Supabase project `vospmxzdcvbzucemxnnz` (**region unknown, check the dashboard**), Vercel functions (default `iad1`, US East). If all are in the US, there is no cross-border transfer. Ask the temple whether its donor-data policy restricts where member status may be cached.
- What the app holds: `auth.users.email` for people who signed in, `memberships(status, household Id, reason code)`, overrides keyed by email for at most 90 days, and audit rows that hold email **hashes**. No names, addresses, giving history, or roster.

---

## 7. Deliverable plan

### 7.1 Issues in the current implementation (to fix in Phase 1)

| # | File | Issue | Fix |
|---|---|---|---|
| 1 | `README.md` (Salesforce setup) | Says "Connected App"; new ones cannot be created as of Spring '26; asks for `refresh_token` scope | Rewrite for External Client App + JWT bearer + `api` scope; link to runbook |
| 2 | `salesforce.ts` `jwtAssertion` | `aud` = `SF_LOGIN_URL`. Salesforce documents `aud` as `https://login.salesforce.com` / `https://test.salesforce.com`, while the token *endpoint* may be the My Domain host. If the temple sets a My Domain URL, tokens may fail. Sources disagree when My Domain is enforced ([Boomi JWT guide](https://help.boomi.com/docs/Atomsphere/Data_Integration/Sources/Applications/Salesforce/jwt-bearer-salesforce), [golang/oauth2#369](https://github.com/golang/oauth2/issues/369)) | Optional `SF_AUDIENCE` defaulting to `SF_LOGIN_URL`; verify in a sandbox |
| 3 | `salesforce.ts` `lookup` | `externalId` is a Contact Id in one branch and an Account Id in others | Always the household Account Id, or null |
| 4 | `salesforce.ts` `lookup` | No deceased filter; no reason codes | Add `npsp__Deceased__c = false` (configurable); return `reason` |
| 5 | `salesforce.ts` | Email fields hard-coded to NPSP; would throw on an NPC org | Move into the contract config |
| 6 | `verify.ts` | One 24 h TTL for all statuses, so office fixes are invisible at checkout | Asymmetric TTL (§4.7) |
| 7 | `verify.ts` | Retries on config errors (a missing env var or invalid field map), wasting the 5 s budget and hiding misconfiguration as "SF flaky" | Typed `ConfigError` → no retry, `error_class = config`, alert |
| 8 | `verify.ts` | No outcome log, so nothing can be monitored | Write `membership_events` |
| 9 | `README.md` example map | `activeValues: ["Active"]` would drop grace-period members | Replace with the contract-field map |

### 7.2 Phases

**Phase 0: temple prerequisites (no app code). These block production use of `salesforce`.**
1. Confirm the edition and NPSP vs NPC; name the SF admin and the data owner.
2. Create a sandbox (if none exists), the integration user (Integration license), the read-only permission set, and the External Client App with a certificate → verify: discovery script runs in the sandbox.
3. Run the discovery script (§3.3) → working session → decide policy (§3.4 decisions) → SF admin builds `Emanuel_Tickets_Member__c` (+ reason) → verify: an SF report on the formula matches the office's list for ~20 known households.
4. Name the alert recipient and the office staff who get `membership_admin`.

**Phase 1: harden the bridge (app).**
- `src/lib/membership/provider.ts`: add `reason?: string` to `MembershipResult`; optional `diagnose?(email): Promise<Trace>`.
- `src/lib/membership/salesforce-contract.ts` (new): object, contract field, email fields, deceased field; `SF_MEMBERSHIP_FIELD_MAP` stays as override.
- `src/lib/membership/salesforce.ts`: fixes #2–#5, `diagnose()`, `ConfigError`, Id validation, `health()` (token, `/limits`, `describe`).
- `src/lib/membership/verify.ts`: asymmetric TTL, override precedence, `source`/`reason` persisted, event logging, no retry on `ConfigError`.
- Migration `supabase/migrations/<ts>_membership_bridge_ops.sql`:
  - `alter table memberships add reason text, add source text not null default 'provider' check (source in ('provider','override'))`
  - `membership_overrides(id, email_normalized, reason, created_by, created_at, expires_at check (expires_at <= created_at + interval '90 days'), revoked_at, revoked_by)`
  - `membership_audit(id, at, actor_user_id, action, target_email_hash, detail jsonb)`, append-only (revoke update/delete)
  - `membership_events(at, user_id, outcome, reason, latency_ms, error_class)` plus a pg_cron 30-day prune
  - `staff_roles(user_id, role check (role in ('membership_admin')))`
  - All tables RLS-forced, no policies (same pattern as `memberships`)
- `src/lib/supabase/viewer.ts`: `requireMembershipAdmin()` (host session plus a `staff_roles` row).
- `src/app/dashboard/members/` (new): lookup/diagnose, re-check, overrides list/create/revoke.
- `src/components/MemberBits.tsx`: "Check again" action on the mismatch note.
- Tests: contract parsing; deceased filter; consistent `externalId`; override precedence and expiry; asymmetric TTL; hostile email (existing); "no `@` in error messages".
- `README.md`: ECA setup, runbook (rotation, rollback to `fake`).
- `scripts/sf-discover.mjs` (new, read-only, aggregate output only).

**Phase 2: monitoring.**
- `src/app/api/cron/membership-health/route.ts` + `vercel.json` `crons` + `CRON_SECRET`; Resend alert to `BRIDGE_ALERT_EMAIL`; weekly digest (lookup volume, error rate, overrides expiring).
- SF-side API usage notification at 70% (temple admin).

**Phase 3: optional push invalidation.** Record-triggered Flow → Named/External Credential → `src/app/api/membership/salesforce-hook/route.ts`. Only if the TTL plus re-check buttons prove insufficient in practice.

**Phase 4: optional write-back (needs temple approval).** Attendance → CampaignMember via nightly batch with a separate write permission set; unmatched-attendee CSV for the office. A separate OpenSpec change.

Suggested process: Phase 1–2 as one OpenSpec change (`add-membership-bridge-ops`), matching the repo's workflow; Phase 3 and Phase 4 as their own changes.

---

## 8. Open questions for the temple

1. **NPSP or Nonprofit Cloud? Which edition?** Is API access included? Is there a sandbox?
2. **What does "member in good standing" mean?** Grace period length; dues-relief or reduced-dues households; clergy, staff, honorary members; multi-year pledges; fiscal-year boundary (July 1?). Is the SF admin willing to own a contract formula field?
3. **Is Salesforce actually the source of truth for dues,** or are dues billed elsewhere and synced?
4. **Eligibility:** adult children in the household? Minors? Shared family emails across households? Deceased contacts' emails?
5. **Overrides:** who can grant them, maximum duration, and who reviews the audit log?
6. **Alerts:** who receives them, and who rotates the certificate (calendar the expiry)?
7. **Write-back:** do they want attendance in Salesforce at all? Who is the data owner? Is a privacy note in the ticketing terms acceptable?
8. **Data residency:** any policy on where member status may be cached (Supabase region to confirm)?
9. **Email coverage:** what share of member households have a usable email on file? (Measured by the discovery script.)

## 9. Riskiest unknowns

1. **The real membership model and data quality.** Good standing might not be reliably represented in Salesforce, or email coverage might be low. Either way "we couldn't match you" becomes the common experience and the office is flooded. Measure this before launch (§3.3 step 5).
2. **NPSP vs NPC, or a planned migration.** The current adapter only works on NPSP. The contract field plus the daily describe check reduce the risk, but an NPC household model needs adapter work.
3. **Getting an External Client App and integration user approved and set up** by a small temple IT team, with Connected App creation restricted. This is the likely schedule bottleneck.
4. **Record-visibility gaps** for the integration user (Private sharing defaults) silently producing `not_found`.
5. **The JWT `aud` value with My Domain enforcement.** Verify in a sandbox before production.

---

### Sources

- Salesforce API limits: https://developer.salesforce.com/docs/platform/salesforce-app-limits-cheatsheet/guide/salesforce-app-limits-platform-api.html ; https://developer.salesforce.com/blogs/2024/11/api-limits-and-monitoring-your-api-usage ; https://coefficient.io/salesforce-api/salesforce-api-rate-limits
- Connected App creation restriction / External Client Apps: https://striim.com/docs/en/salesforce-connected-apps-and-external-client-apps.html ; https://developer.salesforce.com/docs/platform/sfdx-dev/guide/sfdx-dev-auth-connected-app.html ; https://salesforcedictionary.com/blogs/salesforce-external-client-apps-migration-2026
- Connected app usage restrictions (2025): https://admin.salesforce.com/blog/2025/get-ready-for-changes-to-connected-app-usage-restrictions ; https://www.soliantconsulting.com/blog/salesforce-connected-app-security-changes-sept2025/
- Integration user license: https://www.apexhours.com/salesforce-integration-user-license/ ; https://salesforcetime.com/2023/03/11/salesforce-integration-user-license/ ; https://www.rapidionline.com/product-updates/how-to-set-up-the-salesforce-integration-user
- Power of Us / nonprofit licensing: https://www.salesforce.com/en-us/wp-content/uploads/sites/4/documents/industries/nonprofit/S-ORG(DG)-Salesforce-for-NonProfit-Cloud-Pricing-Guide-Final.pdf ; https://magicfuse.co/blog/salesforce-power-of-us-program ; https://redresscompliance.com/salesforce-nonprofit-npsp-licensing.html
- NPSP vs Nonprofit Cloud data model: https://magicfuse.co/blog/salesforce-nonprofit-cloud-vs-npsp ; https://www.soapboxengage.com/blog/2478-salesforce-new-nonprofit-cloud-tips-contacts-vs-person-accounts ; https://www.salesforceben.com/salesforce-nonprofit-success-pack-to-nonprofit-cloud-migration/
- NPSP memberships, grace period: https://github.com/SFDO-Community-Sprints/Membership-Essentials-App/wiki/Membership-Best-Practices ; https://trailhead.salesforce.com/trailblazer-community/feed/0D54V00007Usek2SAB
- NPSP deceased handling: https://nonprofits101.screenstepslive.com/s/npsp3/m/111936/l/1781130-when-someone-dies ; https://trailhead.salesforce.com/trailblazer-community/feed/0D54V00007igJt1SAE
- Search index latency (SOSL): https://developer.salesforce.com/docs/platform/salesforce-large-data-volumes-bp/guide/ldv-deployments-concepts-search-architecture.html ; https://developer.salesforce.com/docs/atlas.en-us.soql_sosl.meta/soql_sosl/sforce_api_calls_sosl_in.htm
- CDC allocations: https://developer.salesforce.com/docs/atlas.en-us.change_data_capture.meta/change_data_capture/cdc_allocations.htm
- Flow HTTP callout (community): https://trailhead.salesforce.com/trailblazer-community/feed/0D5KX00000pQEAu0AO
- JWT `aud`: https://help.boomi.com/docs/Atomsphere/Data_Integration/Sources/Applications/Salesforce/jwt-bearer-salesforce ; https://github.com/golang/oauth2/issues/369 ; https://developer.salesforce.com/docs/platform/named-credentials/references/named-credentials-reference/jwt-claims.html

Caveat: several Salesforce specifics above come from secondary sources (consultancies, community threads). Items marked "verify" or "confirm" must be checked in the temple's org or sandbox before implementation.
