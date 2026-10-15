## MODIFIED Requirements

### Requirement: Attendee and order data is protected by database RLS
Reservations, orders, order items, attendee records, and membership records SHALL be protected by Row-Level Security such that the database is the primary authorization boundary. There SHALL be no policy granting anonymous or ordinary authenticated clients direct read or write access to reservations, orders, order items, attendee records, or membership records. Host read access to orders and attendees SHALL require both the `host` session role and ownership of the event. A bug in application code SHALL NOT be sufficient to expose this data.

#### Scenario: Anonymous client cannot read attendee data directly
- **WHEN** an anonymous database client queries the attendees or orders tables directly
- **THEN** no rows are returned

#### Scenario: A host cannot read another host's attendees
- **WHEN** an authenticated host queries attendees for an event they do not own
- **THEN** no rows are returned

#### Scenario: A member cannot read attendee or order data
- **WHEN** a client with a `member` session queries the attendees or orders tables directly, including for an event whose `host_id` equals their own user id
- **THEN** no rows are returned

#### Scenario: A member cannot read membership records directly
- **WHEN** a client with a `member` session queries the memberships table
- **THEN** no rows are returned, including their own

## ADDED Requirements

### Requirement: Host-owned event and ticket-type policies require the host session role
Every database policy that lets a host read unpublished events, or create, update, or delete events and ticket types, SHALL require the session's `host` role in addition to ownership. An authenticated session without the `host` role SHALL be limited to reading published events and their ticket types.

#### Scenario: Member cannot create an event via the database API
- **WHEN** a client with a `member` session inserts an event row with `host_id` set to its own user id
- **THEN** the insert is denied by the database

#### Scenario: Member cannot read draft events
- **WHEN** a client with a `member` session selects events
- **THEN** only published events are returned, even if a draft row's `host_id` equals their user id

#### Scenario: Host policies still work for hosts
- **WHEN** a client with a `host` session creates, edits, and reads its own events and ticket types
- **THEN** the operations succeed as before

### Requirement: Member identity on the purchase path is supplied by trusted server code
When a signed-in attendee reserves or buys seats, the server SHALL take the attendee's user identifier from the verified session and the membership assertion from the membership verification result, SHALL pass the assertion to the privileged reservation path and record the user identifier on the order, and SHALL NOT accept a user identifier or membership claim from the request body. Guest purchases SHALL continue to pass no assertion and record no user identifier.

#### Scenario: Server supplies identity for a member purchase
- **WHEN** a signed-in attendee submits an RSVP or checkout
- **THEN** the reservation is requested with the membership assertion derived server-side and the order records the user id from the verified session, regardless of any id or claim in the form data

#### Scenario: Guest purchase carries no identity
- **WHEN** a guest submits an RSVP or checkout
- **THEN** the reservation is requested with no membership assertion and the order records no user id
