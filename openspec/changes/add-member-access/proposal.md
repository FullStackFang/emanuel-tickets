## Why

After launch, a member whose sign-in email isn't in Salesforce has nowhere to go but an email to the office, and the office has no tools. This change lets them find their membership themselves, proven through a contact the temple already has, and gives the office a queue for everything else. Third of three changes (after `launch-member-signin`, `add-attendee-accounts`). Its design also holds the start-to-finish experience for all three.

## What Changes

- **Find my membership** (temple switches it on): last name + ZIP/house number or phone finds a household; a code goes to that household's on-file email; entering it links the sign-in email for 12 months. Answers alone never grant anything.
- **Ask the office:** one tap from any dead end; request + email to the office.
- **Office queue** for named office staff: why it didn't match, Re-check, Link to household, Need info, Decline; the person is emailed; every action audited.
- Household links count as a match, but Salesforce still decides standing.

## Capabilities

### New Capabilities
- `membership-matching`: Find my membership, on-file code confirmation, and limits.
- `office-verification`: office staff list, requests, queue, actions, audit.

### Modified Capabilities
- `membership-verification`: household links as a second way to match.

## Impact

- **DB:** `household_links`, `match_challenges`, `membership_requests`, `office_staff`, `office_audit` (server-only), `is_office()`.
- **Code:** provider gains `searchHouseholds` and `lookupHousehold` (Salesforce + fake); `verify.ts` link resolution; `/account/find-membership`; `/dashboard/office`; office emails.
- **Env:** `FIND_MEMBERSHIP_ENABLED`, `OFFICE_SEED_EMAIL`, fake-provider households for tests.
- **Temple:** org model and search permission; whether adult children/dependents count (decides whether Find my membership is switched on); office staff and turnaround.
