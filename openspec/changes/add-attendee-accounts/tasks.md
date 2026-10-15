## 1. Data

- [ ] 1.1 Migration: `claim_orders_for_user(user_id, email)` (service-role only; confirmed, not needs_refund, unowned; case-insensitive) + `lower(buyer_email)` index
- [ ] 1.2 Call it after every successful sign-in (code and link paths); never throws
- [ ] 1.3 DB tests: idempotent; never takes an owned, pending, expired, cancelled, or refund-flagged order

## 2. Re-displayable tickets

- [ ] 2.1 `TICKET_TOKEN_SECRET`; mint new tokens as HMAC-SHA256(attendee_id), base64url; door lookup unchanged
- [ ] 2.2 `canRedisplay(attendee)`: recompute and compare hash
- [ ] 2.3 Unit tests: new seat recomputes to stored hash; legacy seat doesn't; rotated secret falls back

## 3. Your tickets page

- [ ] 3.1 `/account`: redirect when signed out; upcoming/past from `attendees.status`; QR with alt text + "Open ticket"; email-search message otherwise
- [ ] 3.2 Header link "Your tickets" for attendees and hosts
- [ ] 3.3 Sign out everywhere; Delete my account (secondary link, confirm, guards)
- [ ] 3.4 Guest post-purchase prompt on RSVP success and the checkout return page
- [ ] 3.5 Tests: host cannot delete; stale session asked to re-sign-in; E2E guest buys → signs in → sees order with QR

## 4. Wrap-up

- [ ] 4.1 Lint, unit, DB tests, build green; phone check of the page
