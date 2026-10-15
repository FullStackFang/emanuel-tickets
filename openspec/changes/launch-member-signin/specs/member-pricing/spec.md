## MODIFIED Requirements

### Requirement: Public event pages show member pricing without gating the page
A public event page SHALL remain fully viewable without signing in. When a ticket type has a member price, the page SHALL show the regular price and the member price, with an inline prompt to sign in that returns to the same event. Members-only ticket types SHALL be listed for everyone but SHALL be reservable only by active members; their seats SHALL NOT count toward the availability shown to others. Non-members SHALL see why they cannot reserve them and what to do: sign in (guests), renew (lapsed), try the email the temple has on file or ask the office (not found), or become a member. Signed-in active members SHALL see member prices applied and a "Member" badge.

#### Scenario: Guest sees both prices and a sign-in prompt
- **WHEN** a guest views an event whose ticket type has a member price
- **THEN** the page shows the regular price, "Members: $X", and a sign-in prompt that returns to this event after sign-in

#### Scenario: Members-only ticket for a guest
- **WHEN** a guest views an event with a members-only ticket type
- **THEN** the type is shown as "For members" with "Members: sign in to reserve" and cannot be reserved
- **AND** its seats are not included in the spots-left count

#### Scenario: Members-only ticket for a lapsed member
- **WHEN** a signed-in lapsed member views that event
- **THEN** the type shows "For members — renew to reserve" with the renew link

#### Scenario: Member sees member pricing applied
- **WHEN** a signed-in active member views that same event
- **THEN** the members-only ticket type can be reserved
- **AND** prices shown are the member prices
