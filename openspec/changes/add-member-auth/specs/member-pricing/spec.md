## ADDED Requirements

### Requirement: A ticket type may carry a member price and a members-only flag
A host SHALL be able to set, per ticket type, an optional member price (which may be zero) and a members-only flag. A ticket type without a member price SHALL cost the same for everyone. These settings SHALL be editable in the host's event form and SHALL be stored with the ticket type.

#### Scenario: Host sets a member price
- **WHEN** a host sets a member price on a ticket type and saves the event
- **THEN** the ticket type stores both the regular price and the member price

#### Scenario: Host marks a ticket type members-only
- **WHEN** a host enables members-only on a ticket type and saves the event
- **THEN** the ticket type is stored as members-only

### Requirement: The charged price is chosen server-side from the viewer's verified membership
The price applied to an RSVP or checkout SHALL be the ticket type's member price when the request comes from a signed-in attendee with active membership and the ticket type has a member price; otherwise it SHALL be the regular price. The price SHALL be read from the database, never from the request. The order SHALL record whether the member price was the one applied, and the signed-in user (if any) who placed it.

#### Scenario: Active member pays the member price
- **WHEN** a signed-in active member checks out a ticket type with a member price
- **THEN** the order amount equals the member price times the quantity
- **AND** the order records that member pricing was applied and which user placed it

#### Scenario: Guest pays the regular price
- **WHEN** a guest (not signed in) checks out a ticket type with a member price
- **THEN** the order amount equals the regular price times the quantity

#### Scenario: Signed-in non-member pays the regular price
- **WHEN** a signed-in attendee whose membership is lapsed or not found checks out a ticket type with a member price
- **THEN** the order amount equals the regular price times the quantity

### Requirement: A member price of zero follows the free path, not the payment provider
When the effective price for the viewer and chosen ticket type is zero, the system SHALL reserve and confirm the seats immediately as a free RSVP and SHALL NOT create a payment-provider session. When the effective price is greater than zero, the system SHALL use paid checkout. Routing SHALL be decided per ticket type and viewer, not per event.

#### Scenario: Members free, guests paid
- **WHEN** a ticket type has a regular price above zero and a member price of zero, and a signed-in active member claims seats
- **THEN** the seats are confirmed immediately without a payment-provider session
- **AND** tickets are issued as for any free RSVP

#### Scenario: Same ticket type, guest
- **WHEN** a guest claims seats on that same ticket type
- **THEN** paid checkout is started at the regular price

### Requirement: Members-only ticket types are enforced at the reservation function
The seat-reservation function SHALL accept a membership assertion that defaults to "not a member" and SHALL refuse to reserve a members-only ticket type unless the assertion is "member". Only trusted server code SHALL call the function, and it SHALL derive the assertion from the verified session and the membership verification result, never from the request body. The refusal SHALL use a distinct error code from the insufficient-inventory error so the application shows the right message. The existing oversell guarantees SHALL be unchanged.

#### Scenario: Member reserves a members-only type
- **WHEN** the server requests a reservation for a members-only ticket type with the membership assertion set, because the signed-in viewer's verification result is active
- **THEN** the reservation is created subject to the normal capacity check

#### Scenario: Guest cannot reserve a members-only type
- **WHEN** the server requests a reservation for a members-only ticket type for a guest (no assertion)
- **THEN** the reservation is refused with a members-only error
- **AND** inventory is unchanged

#### Scenario: Non-member cannot reserve a members-only type
- **WHEN** the server requests a reservation for a members-only ticket type for a signed-in viewer whose verification result is lapsed or not found
- **THEN** the reservation is refused with a members-only error
- **AND** inventory is unchanged

#### Scenario: Members-only refusal is not reported as sold out
- **WHEN** a members-only refusal occurs
- **THEN** the attendee sees a message that the ticket is for members and can sign in, not a message that seats are unavailable

### Requirement: The charged price is fixed at reservation time
Once an order is created, its amount SHALL NOT change because the attendee's membership status later changes. Payment confirmation SHALL act on the stored order amount and SHALL NOT re-verify membership.

#### Scenario: Membership lapses between checkout and payment confirmation
- **WHEN** an active member starts paid checkout at the member price and their membership becomes lapsed before the payment webhook arrives
- **THEN** the order is confirmed at the member price originally recorded

### Requirement: Public event pages show member pricing without gating the page
A public event page SHALL remain fully viewable without signing in. When a ticket type has a member price, the page SHALL show the regular price and the member price, with an inline prompt to sign in that returns to the same event. Members-only ticket types and their seats SHALL be hidden from availability for viewers who are not active members. Signed-in active members SHALL see member prices applied and a "Member" badge.

#### Scenario: Guest sees both prices and a sign-in prompt
- **WHEN** a guest views an event whose ticket type has a member price
- **THEN** the page shows the regular price, "Members: $X", and a sign-in prompt that returns to this event after sign-in

#### Scenario: Members-only seats hidden from guests
- **WHEN** a guest views an event with a sold-out regular ticket type and a members-only ticket type with remaining seats
- **THEN** the page shows the event as sold out for them
- **AND** the members-only ticket type is not offered

#### Scenario: Member sees member pricing applied
- **WHEN** a signed-in active member views that same event
- **THEN** the members-only ticket type is offered
- **AND** prices shown are the member prices

#### Scenario: Attendee chooses among ticket types at their effective price
- **WHEN** a viewer opens the RSVP or ticket form on an event with more than one purchasable ticket type
- **THEN** each type is listed at the viewer's effective price
- **AND** choosing a type whose effective price is zero submits a free RSVP while choosing one above zero starts paid checkout
