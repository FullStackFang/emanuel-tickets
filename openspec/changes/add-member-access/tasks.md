## 1. Temple decisions

- [ ] 1.1 Office staff and turnaround; first office user email (`OFFICE_SEED_EMAIL`); retention for requests and audit
- [ ] 1.2 Org model (NPSP / Nonprofit Cloud); integration user may search by name, address, phone
- [ ] 1.3 Do adult children and dependents count as members? (gates `FIND_MEMBERSHIP_ENABLED`)

## 2. Data

- [ ] 2.1 Migration: `office_staff`, `is_office()`, `membership_requests`, `office_audit` (append-only trigger), `household_links`, `match_challenges`; all RLS forced, no policies
- [ ] 2.2 Seed script for the first office user; README instructions; guard against emptying the list
- [ ] 2.3 DB tests: attendees and non-office hosts read nothing; audit rows can't change; last office user can't be removed

## 3. Ask the office + office queue

- [ ] 3.1 "Ask the office" form (optional note) from every not-found message; request row + email to office; 3/IP/day
- [ ] 3.2 `/dashboard/office`: queue, cached diagnosis, Re-check, Link to household (12 months), Need info, Decline; manage staff
- [ ] 3.3 Plain-English emails for each outcome; audit entry for each action
- [ ] 3.4 E2E with fake households: request → office links → person sees member price

## 4. Find my membership

- [ ] 4.1 Provider: `searchHouseholds({ lastName, zip, houseNumber, phone })`, `lookupHousehold(accountId)` for Salesforce (model from 1.2) and fake (env households)
- [ ] 4.2 `verify.ts`: email match, else unexpired link via `lookupHousehold`
- [ ] 4.3 `/account/find-membership`: form → single match → code to on-file email with minimal hint → code entry on the same page → link → re-check
- [ ] 4.4 Limits: 3 searches/account/day, 10/IP/day, 2 codes/household/day; every other outcome → office request
- [ ] 4.5 Tests: answers alone never link; 5 wrong codes lock; no CRM details rendered; lapsed household stays non-member; expired link ignored
- [ ] 4.6 Switch on after 1.2, 1.3 and a test with one real household

## 5. Wrap-up

- [ ] 5.1 Lint, unit, DB tests, build green
- [ ] 5.2 Phone walkthrough of scenarios 1–8 in this design across all three changes
- [ ] 5.3 README and PRODUCT.md: attendee vs member wording, office process, Find my membership
