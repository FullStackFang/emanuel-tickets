## Context

Three changes deliver member access: `launch-member-signin` (safe sign-in, members-only screens, Salesforce readiness), `add-attendee-accounts` (Your tickets), and this one (Find my membership + office). Reviews: `docs/reports/member-bridge/review.md`, `review-add-member-access.md`. The reviewer recommended cutting Find my membership; the user chose to keep it, so it is built here with the reviewer's hardening and behind a temple switch.

## The experience, start to finish

Plain English, as the congregant sees it. Screen text in quotes. (Change that delivers it in brackets.)

**1. Member, email on file, members-only event.** [launch] The page is open to all. Ticket card: "For members · Members: sign in to reserve." Email → "We sent a 6-digit code to you@gmail.com" → type it on the same page (or tap the email link on any phone). Back on the event with a "Member" badge and member price. Two taps to reserve; ticket emailed. Phone stays signed in.

**2. Member, different email.** [this change] After the code: "We couldn't find a membership for this email. Find my membership." Form: last name, then ZIP + house number or phone. One match: "We sent a code to the email the temple has on file (j•••@•••.net). Enter it here." Correct code: "You're all set — member prices now apply." Anything else: "We'll ask the office to confirm. You'll get an email, usually within two business days." Meanwhile they can buy at the regular price. (Before this change ships, or if the temple keeps it off: "Try the email the temple has on file — the one that gets the bulletin — or email the office.")

**3. Lapsed.** [launch] "We found your membership, but it isn't current." + Renew link. Members-only: "For members — renew to reserve."

**4. Not a member.** [launch] Members-only: "For members" + "Become a member."

**5. Guest.** [launch, accounts] Unchanged RSVP/buy. After buying: "Sign in with this email to keep these tickets in one place."

**6. Your tickets.** [accounts] Header → "Your tickets": events with QR codes; past guest purchases with the same email appear. Older tickets: "Search your email for 'Your ticket for …', or ask the office to re-send." Sign out everywhere; Delete my account (small link, confirm).

**7. Office.** [this change] Dashboard → Office (named staff only). Each request: who, what they typed, why no match ("2 households named Cohen at 10021"). Re-check · Link to household · Need info · Decline. The person is emailed. Preferred fix: update Salesforce, then Re-check.

**8. Staff.** [launch] Microsoft sign-in; never see member prompts. On a personal email they're like any congregant.

## Goals / Non-Goals

**Goals:** self-service for members who can reach their household's on-file inbox; a real office tool; nothing in the app that reveals who is a member.
**Non-Goals:** identity questions as proof; roster copies; SMS; writing to Salesforce.

## Decisions

**D1. Answers locate, the on-file inbox proves.** Search is live: NPSP — SOQL on `LastName` + `MailingPostalCode` + `MailingStreet LIKE '<house number> %'`, or SOSL `IN PHONE FIELDS` with digits only; Nonprofit Cloud — the equivalent on Person Accounts and the household group. Exactly one household with an on-file email → app-generated 6-digit code (hashed, 10 min, 5 tries) to that email, with copy: "Someone signed in as x@gmail.com and asked to use it for your Temple Emanu-El membership. If that's you, your code is 123456. If not, ignore this — nothing changes." Correct code → `household_links(source='self', expires_at=+12 months)`. Any other outcome → office request. *Rejected:* identity questions alone (guessable; NIST no longer accepts them); a cached roster (PII).

**D2. Minimal hint.** Only first letter + top-level domain ("j•••@•••.net"), shown only after a single match, never names or addresses.

**D3. Limits that work against throwaway accounts.** Per day: 3 searches per account, 10 per IP; 2 codes per household; 3 office requests per IP. Counts come from the rows in `match_challenges` and `membership_requests` (IP stored as a salted hash).

**D4. Switch.** `FIND_MEMBERSHIP_ENABLED` stays off until the temple confirms the org model, search permission, and whether adult children/dependents count — because a link gives the household's standing to whoever can read its inbox.

**D5. Resolution order (in `verify.ts`).** Email match first; else an unexpired link, whose household standing is read via `lookupHousehold(accountId)`. The provider never reads app tables.

**D6. Office.** `office_staff` + `is_office()` (host session required). Seeded from `OFFICE_SEED_EMAIL` at deploy (script, documented in README); list can't be emptied. Actions: Re-check, Link (12 months, same as self links; prompt to add the email in Salesforce), Need info, Decline — each emails the person and writes `office_audit` (trigger blocks update/delete). Diagnosis cached on the request row for 5 minutes. All tables server-only.

**D7. Testable without Salesforce.** Fake provider reads households from env JSON (name, ZIP, house number, phone, emails, standing) so scenarios 2 and 7 run end to end.

## Risks / Trade-offs

- [Whoever reads a household inbox can link any email (adult child, ex-spouse)] → temple policy decides the switch; 12-month expiry; links visible and revocable in the office queue.
- [Hint confirms a household exists for a name + address] → minimal hint, single match only, IP and account limits.
- [Unwanted code emails to a household] → 2 per household per day; copy says ignoring is safe.
- [Free-text addresses miss] → falls to the office; phone path as alternative.
- [Two codes in two inboxes is hard on a phone] → code entry stays on the same page; office route is always one tap away.

## Migration Plan

Deploy tables + office first (seed staff, `OFFICE_SEED_EMAIL`), switch on "Ask the office". Enable `FIND_MEMBERSHIP_ENABLED` after temple decisions and a test with a real household. Rollback: switch off; links expire or are revoked by the office.

## Open Questions

- Do adult children/dependents count? (Decides the switch.)
- NPSP or Nonprofit Cloud; may the integration user search by name, address, phone?
- Office staff, turnaround, retention for requests and audit.
