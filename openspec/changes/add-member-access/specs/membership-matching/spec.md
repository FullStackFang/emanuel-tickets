## ADDED Requirements

### Requirement: Unrecognized attendees can look up their membership
When enabled by the temple, a signed-in attendee whose email does not match a membership SHALL be able to enter their last name and either their ZIP plus house number, or a phone number, to search for their household in the CRM. The search SHALL run against the CRM live; the app SHALL NOT keep a copy of the member roster. The page SHALL NEVER display names, addresses, or household details from the CRM.

#### Scenario: Search finds nothing
- **WHEN** an attendee submits details that match no household
- **THEN** they see "We'll ask the office to confirm" and an office request is created with what they entered

#### Scenario: Feature off
- **WHEN** the temple has not enabled Find my membership
- **THEN** unrecognized attendees see "Try the email the temple has on file, or ask the office" instead

### Requirement: A match is confirmed only through a contact already on file
When a search matches exactly one household with an email on file, the system SHALL send a 6-digit code to that on-file email and SHALL show only a minimal hint of it (first letter and top-level domain, e.g. "j•••@•••.net"). The household SHALL be linked only after the attendee enters that code on the same page. Search answers alone SHALL NEVER link a household or grant membership. Codes SHALL be stored only as a hash, expire after 10 minutes, and allow 5 attempts. The email SHALL tell the recipient who asked and that ignoring it changes nothing.

#### Scenario: Correct on-file code links the household
- **WHEN** the attendee enters the code sent to the household's on-file email
- **THEN** their account is linked to that household and membership is re-checked immediately

#### Scenario: Wrong or expired code
- **WHEN** the attendee enters a wrong code 5 times or after 10 minutes
- **THEN** no link is created and they are offered the office route

#### Scenario: Ambiguous or unreachable match
- **WHEN** the search matches more than one household, the household has no email on file, or the attendee says they can't reach that inbox
- **THEN** no code is sent and an office request is created

#### Scenario: Recipient didn't ask
- **WHEN** the on-file recipient ignores the code email
- **THEN** no link is created and nothing about the membership changes

### Requirement: Lookups are limited per person, per network, and per household
Searches SHALL be limited to 3 per account and 10 per IP address per day. Confirmation codes SHALL be limited to 2 per household per day. Office requests SHALL be limited to 3 per IP address per day.

#### Scenario: Throwaway accounts from one network
- **WHEN** an eleventh search arrives from the same IP address within 24 hours, from any account
- **THEN** it is refused with a message pointing to the office

#### Scenario: Household code flood
- **WHEN** a third code would be sent to the same household within 24 hours
- **THEN** no code is sent and an office request is created instead
