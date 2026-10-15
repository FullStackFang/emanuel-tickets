## MODIFIED Requirements

### Requirement: Verification runs at sign-in and is re-checked when stale at checkout
The system SHALL verify membership immediately after a successful attendee sign-in and SHALL store the result with the time it was verified and the time by which it must be re-checked: 24 hours for an active result and 1 hour for a lapsed or not-found result. When a signed-in attendee starts an RSVP or checkout and the stored result is missing, past its re-check time, or was verified for a different email, the system SHALL re-verify before applying member benefits. An attendee SHALL be able to ask for an immediate re-check ("Check again") at most once every 2 minutes; "Check again" SHALL ignore any outage back-off. The system SHALL NOT run scheduled background re-verification.

#### Scenario: Fresh result is reused
- **WHEN** a signed-in member starts checkout within 24 hours of their last active verification
- **THEN** no provider call is made
- **AND** the stored status is used

#### Scenario: Non-member is re-checked sooner
- **WHEN** a signed-in attendee with a not-found result starts checkout more than 1 hour after it was stored
- **THEN** the provider is consulted again

#### Scenario: Check again after the office fixes a record
- **WHEN** an attendee taps "Check again" and their last check was more than 2 minutes ago
- **THEN** the provider is consulted immediately, even during an outage back-off, and the result replaces the stored one

### Requirement: Provider failure never blocks RSVP or checkout
If the provider cannot be reached or errors, the system SHALL use the most recent stored result if it is no more than 7 days past its verification time, and otherwise SHALL treat the attendee as a non-member for that request. After a failure the system SHALL NOT call the provider again for that attendee during RSVP or checkout for 5 minutes. A non-member result caused by a failure SHALL be shown as unknown, not as "we couldn't match you". The RSVP or checkout SHALL proceed. The provider call, including any retry, SHALL be bounded by a single total time budget of a few seconds. Configuration errors SHALL fail immediately without retry and be logged distinctly, without logging the email or the provider's response body.

#### Scenario: CRM outage with a recent cached active result
- **WHEN** the provider fails for an attendee whose last stored status is `active` and was verified within 7 days
- **THEN** the attendee is treated as an active member for that request

#### Scenario: Repeated attempts during an outage
- **WHEN** an attendee makes two purchase attempts one minute apart during an outage
- **THEN** the provider is called at most once

#### Scenario: CRM outage with no cached result
- **WHEN** the provider fails for an attendee with no stored result
- **THEN** they pay regular prices and see no mismatch note

### Requirement: Salesforce provider matches by email across all contact email fields and evaluates standing per household
The Salesforce provider SHALL authenticate server-to-server with a dedicated integration user through an External Client App and SHALL cache its access token across lookups. It SHALL normalize the email (trim, lowercase), SHALL match it against the configured list of contact email fields, SHALL escape the email before building the query, and SHALL ignore deceased contacts and contacts without a household. Good standing SHALL be read from a single temple-owned field on the household. It SHALL report `active` if any matched household is in good standing, `lapsed` if matched but none is, and `not_found` otherwise, and SHALL record the household id as the external id. The adapter SHALL support the temple's org model (NPSP or Nonprofit Cloud) as confirmed before it is enabled.

#### Scenario: Spouse's email on a dues-paying household
- **WHEN** the signed-in email appears on a contact whose household's good-standing field is true
- **THEN** the provider reports `active` with that household's id

#### Scenario: Deceased contact
- **WHEN** the only matching contact is marked deceased
- **THEN** the provider reports `not_found`

#### Scenario: Contact without a household
- **WHEN** the only matching contact has no household
- **THEN** the provider reports `not_found`

#### Scenario: Hostile email string
- **WHEN** the lookup input contains quote or backslash characters
- **THEN** the query is escaped so the characters are treated as literal text
