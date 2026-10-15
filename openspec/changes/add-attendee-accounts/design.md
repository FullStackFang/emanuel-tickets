## Context

Tickets are emailed with a random token; only its hash is stored (`src/lib/ticket-token.ts`), so the app can't show a QR again. Guest orders have no owner. Experience overview: `openspec/changes/add-member-access/design.md` scenario 6.

## Goals / Non-Goals

**Goals:** one place to find tickets; no new way to leak data; no broken forwarded tickets.
**Non-Goals:** re-sending legacy tickets; profiles; per-seat names.

## Decisions

**D1. Claim on sign-in.** A service-role-only SQL function sets `user_id` on orders with matching verified email, `status = 'confirmed'`, `needs_refund = false`, `user_id is null`. Called after every successful sign-in; never throws. Safe because those tickets were already emailed to that inbox. Known residual: a free RSVP typed with a stranger's email also appears in the stranger's list — they already received it. Accepted.

**D2. Re-displayable tokens.** `token = base64url(HMAC-SHA256(TICKET_TOKEN_SECRET, attendee_id))` (43 chars, so `isWellFormedToken` is unchanged). Stored and looked up by hash exactly as today. The page recomputes and compares to `token_hash`; equal → show QR; not equal → legacy or rotated → email-search message. Rotating the secret never breaks emailed tickets; it only stops re-display. Trade-off: secret + database together can forge tickets (today the database alone can't); acceptable for door tickets; secret lives only in Vercel env.

**D3. Ticket state** comes from `attendees.status`, so refunds show as cancelled.

**D4. Account controls.** "Sign out everywhere" = global sign-out. Deletion: attendee role, no `azure` identity, no `events` rows, signed in within 10 minutes (from `amr` timestamp in the token); then admin delete; orders keep their data with `user_id` null.

**D5. `/account` guards itself** (outside the proxy's `/dashboard` rule): signed out → `/signin?next=/account`.

## Risks / Trade-offs

- [Secret leak + DB leak forges tickets] → secret only in Vercel env; rotate on suspicion (re-display stops, door unaffected).
- [Shared family tablet] → Sign out everywhere; re-auth before deletion.

## Migration Plan

Add `TICKET_TOKEN_SECRET`; deploy; migration for the claim function. Rollback: remove the page; claimed `user_id`s are harmless.

## Open Questions

- None blocking.
