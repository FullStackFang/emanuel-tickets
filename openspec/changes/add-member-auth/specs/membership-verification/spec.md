## ADDED Requirements

### Requirement: Membership is determined by a pluggable provider, with the CRM as the source of truth
The system SHALL determine whether a signed-in attendee is a member by asking a configured membership provider with the attendee's verified sign-in email. A provider SHALL return exactly one of `active`, `lapsed`, or `not_found`, plus an opaque external identifier when matched. The application SHALL NOT grant member status by any means other than a provider result. The active provider SHALL be selected by configuration, and a fake provider SHALL exist so development and tests can produce every status without a CRM.

#### Scenario: Active member recognized
- **WHEN** a signed-in attendee's email matches a record the provider reports as in good standing
- **THEN** the attendee is treated as an active member

#### Scenario: Lapsed member recognized but not granted
- **WHEN** a signed-in attendee's email matches a record the provider reports as not in good standing
- **THEN** the attendee is treated as a non-member
- **AND** the attendee is told their email matched but membership could not be confirmed, with office contact details

#### Scenario: No match
- **WHEN** a signed-in attendee's email matches no record at the provider
- **THEN** the attendee is treated as a non-member
- **AND** the attendee is told the email could not be matched, with office contact details

#### Scenario: Fake provider drives tests
- **WHEN** the fake provider is configured with lists of active and lapsed emails
- **THEN** sign-in with an email on each list yields the corresponding status, and any other email yields `not_found`

### Requirement: Verification runs at sign-in and is re-checked when stale at checkout
The system SHALL verify membership immediately after a successful attendee sign-in and SHALL store the result with the time it was verified and the time by which it must be re-checked (24 hours later). When a signed-in attendee starts an RSVP or checkout and the stored result is missing or past its re-check time, the system SHALL re-verify before applying member benefits. The system SHALL NOT run scheduled background re-verification.

#### Scenario: Fresh result is reused
- **WHEN** a signed-in member starts checkout within 24 hours of their last verification
- **THEN** no provider call is made
- **AND** the stored status is used

#### Scenario: Stale result is refreshed at checkout
- **WHEN** a signed-in attendee starts checkout more than 24 hours after their last verification
- **THEN** the provider is consulted again before the price is chosen
- **AND** the stored result is replaced with the new one

### Requirement: Provider failure never blocks RSVP or checkout
If the provider cannot be reached or errors, the system SHALL use the most recent stored result if one exists, and otherwise SHALL treat the attendee as a non-member for that request. The RSVP or checkout SHALL proceed. The provider call, including any retry, SHALL be bounded by a single total time budget of a few seconds.

#### Scenario: CRM outage with a cached active result
- **WHEN** the provider fails during a stale re-check for an attendee whose last stored status is `active`
- **THEN** the attendee is treated as an active member for that request
- **AND** the stored result is left unchanged

#### Scenario: CRM outage with no cached result
- **WHEN** the provider fails during first verification for an attendee with no stored result
- **THEN** the attendee is treated as a non-member for that request
- **AND** they can still complete RSVP or checkout at guest pricing

### Requirement: Membership records are server-only
Stored membership results SHALL be readable and writable only by trusted server code; anonymous and authenticated browser clients SHALL have no direct read or write access. The system SHALL store only the status, the provider identifier, the opaque external identifier, and timestamps; it SHALL NOT persist raw provider payloads, and SHALL NOT write attendee email addresses to logs.

#### Scenario: Attendee cannot read membership records directly
- **WHEN** a signed-in attendee queries the membership records table directly
- **THEN** no rows are returned, including their own

#### Scenario: Attendee cannot write membership records
- **WHEN** a signed-in attendee attempts to insert or update a membership record directly
- **THEN** the write is denied

### Requirement: Salesforce provider matches by email across all contact email fields and evaluates standing per household
The Salesforce provider SHALL authenticate server-to-server with a dedicated integration user and SHALL cache its access token across lookups. It SHALL normalize the email (trim, lowercase), SHALL match it against every NPSP contact email field, SHALL escape the email before building the query, and SHALL evaluate good standing at the household level using a configured field map. It SHALL report `active` if any matched household is in good standing, `lapsed` if matched but none is, and `not_found` if no contact matches.

#### Scenario: Spouse's email on a dues-paying household
- **WHEN** the signed-in email appears on a contact whose household is in good standing, even though a different contact in that household pays the dues
- **THEN** the provider reports `active`

#### Scenario: Email in an alternate field
- **WHEN** the signed-in email appears only in a contact's alternate or work email field
- **THEN** the provider still matches it

#### Scenario: Hostile email string
- **WHEN** the lookup input contains quote or backslash characters
- **THEN** the query is escaped so the characters are treated as literal text
- **AND** no query error or unintended match occurs
