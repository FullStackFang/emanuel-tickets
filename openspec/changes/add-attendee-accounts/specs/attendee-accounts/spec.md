## ADDED Requirements

### Requirement: Signed-in people see their tickets in one place
Any signed-in person (attendee or host) SHALL have a "Your tickets" page listing upcoming and past events they hold tickets for, with each ticket's state (valid, used, cancelled) taken from the ticket record. Signed-out visitors SHALL be sent to sign in and returned to the page. Each QR SHALL have a text alternative naming the event and seat and an "Open ticket" link.

#### Scenario: Viewing tickets
- **WHEN** a signed-in person opens "Your tickets"
- **THEN** they see each event, ticket count, state, and a QR for each ticket that can be re-displayed

#### Scenario: Refunded order
- **WHEN** an order's tickets were revoked by a refund
- **THEN** they are shown as cancelled, not valid

#### Scenario: Signed-out visitor
- **WHEN** a signed-out visitor opens "Your tickets"
- **THEN** they are sent to sign in and returned to "Your tickets" afterwards

### Requirement: Past confirmed orders are claimed by verified email
After each successful sign-in, the system SHALL attach to the account every order whose buyer email equals the verified sign-in email (case-insensitive), whose status is confirmed, which is not flagged for refund, and which has no owner. It SHALL NEVER change an order that already has an owner, and SHALL NOT claim pending, expired, or cancelled orders.

#### Scenario: Guest order appears after sign-in
- **WHEN** someone bought as a guest with an email and later signs in with that email
- **THEN** that confirmed order appears on "Your tickets"

#### Scenario: Abandoned order is not claimed
- **WHEN** an order with that email is pending, expired, or cancelled
- **THEN** it is not attached

### Requirement: Ticket QR codes can be shown again without voiding earlier copies
New tickets SHALL use a token computed as HMAC-SHA256 of the ticket id with a server secret, encoded as 43 base64url characters; only its hash SHALL be stored and looked up, as today. The page SHALL show a QR only when the recomputed token's hash equals the stored hash; otherwise (older tickets, or after the secret is rotated) it SHALL say "Search your email for 'Your ticket for <event>', or ask the office to re-send." Showing a QR SHALL NOT invalidate any emailed or forwarded copy.

#### Scenario: Forwarded ticket still works
- **WHEN** an attendee views a ticket's QR after forwarding the emailed copy
- **THEN** both copies admit at the door

#### Scenario: Older ticket
- **WHEN** a ticket was issued before this change
- **THEN** no QR is shown and the email-search message appears, and the emailed ticket still admits

### Requirement: Attendees control their sessions and account
A signed-in attendee SHALL be able to sign out on all devices. An attendee SHALL be able to delete their account only if they signed in within the last 10 minutes (from the sign-in time in their session), the account holds no Microsoft identity, and it owns no events; their orders SHALL remain on file without a link to the account. Deletion SHALL be a secondary link with a confirmation step.

#### Scenario: Host cannot self-delete
- **WHEN** an account that owns events or holds a Microsoft identity requests deletion
- **THEN** the request is refused and nothing is deleted

#### Scenario: Stale session asks to confirm
- **WHEN** an attendee who signed in more than 10 minutes ago chooses Delete my account
- **THEN** they are asked to sign in again first
