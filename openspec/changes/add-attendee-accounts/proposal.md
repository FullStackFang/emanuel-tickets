## Why

People lose ticket emails, and guests who later sign in can't see what they already bought. This gives every signed-in person one "Your tickets" page. Second of three changes; needs `launch-member-signin`.

## What Changes

- "Your tickets" page (header link for attendees and hosts) with QR codes for new tickets.
- Past confirmed orders made with your email appear automatically after sign-in.
- New tickets use re-displayable tokens; showing a QR never voids a forwarded copy.
- "Sign out everywhere"; "Delete my account" for attendees only, with safeguards.
- After a guest purchase: "Sign in with this email to keep these tickets in one place."

## Capabilities

### New Capabilities
- `attendee-accounts`: Your tickets page, order claim, re-displayable tickets, session and account controls.

### Modified Capabilities
None.

## Impact

- **DB:** `claim_orders_for_user()` (service-role only) + index on `lower(buyer_email)`.
- **Code:** `src/lib/ticket-token.ts`, `src/lib/tickets.ts` (HMAC minting), `src/app/account/*` (new), sign-in paths call the claim, `SiteHeader`, RSVP success panel, `src/app/checkout/[orderId]/page.tsx`.
- **Env:** `TICKET_TOKEN_SECRET`.
