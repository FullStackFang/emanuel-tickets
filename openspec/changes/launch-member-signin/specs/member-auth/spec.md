## MODIFIED Requirements

### Requirement: Session role is derived from the authentication method
Every session SHALL carry a role of `host` or `attendee` in its verified access token. The role SHALL be `host` only when the session was established through Microsoft (Azure Entra ID) OAuth by a user holding a Microsoft identity; every other session SHALL be `attendee`. The role SHALL be derived at token issuance from the session's authentication method, SHALL persist across token refresh, and SHALL NOT be read from user-editable metadata. The `attendee` role SHALL NOT imply membership; membership comes only from membership verification.

#### Scenario: Microsoft sign-in yields a host session
- **WHEN** a user completes Microsoft OAuth sign-in
- **THEN** the issued access token carries the `host` role
- **AND** the role is still `host` after the token is refreshed

#### Scenario: Email-code sign-in yields an attendee session
- **WHEN** a user completes email one-time-code sign-in
- **THEN** the issued access token carries the `attendee` role

#### Scenario: Existing host sessions gain the role on refresh
- **WHEN** the role mechanism is enabled while a host has an active Microsoft-established session
- **THEN** the host's next refreshed access token carries the `host` role without signing in again

### Requirement: Members and guests see a member-appropriate account control
A signed-in attendee SHALL see an account control showing their email, a "Member" badge when their membership is active, and a sign-out action. A signed-in attendee SHALL NOT see host navigation. Signing out SHALL return an attendee to the public home page. Hosts SHALL NOT be shown membership mismatch prompts.

#### Scenario: Member header
- **WHEN** a signed-in attendee with active membership views any public page
- **THEN** the header shows their account control with the "Member" badge
- **AND** no host navigation is shown

#### Scenario: Attendee signs out
- **WHEN** a signed-in attendee chooses sign out
- **THEN** the session ends
- **AND** they are returned to the public home page

#### Scenario: Host views an event with member pricing
- **WHEN** a host views an event page
- **THEN** no "we couldn't match this email" note is shown

## ADDED Requirements

### Requirement: Sign-in limits apply per person, not per server
Rate limits on requesting and entering sign-in codes SHALL be counted per end-user IP address, never per application server. A new code for the same email SHALL NOT be sent within 60 seconds of the previous one.

#### Scenario: Busy announcement
- **WHEN** many congregants request codes within five minutes from different networks
- **THEN** each is limited only by their own requests

#### Scenario: Asking again too soon
- **WHEN** a second code is requested for the same email within 60 seconds
- **THEN** it is refused with "Please wait a minute before asking for another code"

### Requirement: Sign-in codes are short-lived
Email sign-in codes SHALL expire 10 minutes after they are sent.

#### Scenario: Old code
- **WHEN** an attendee enters a code more than 10 minutes after it was sent
- **THEN** no session is established and they are offered a new code
