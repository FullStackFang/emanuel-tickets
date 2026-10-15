## ADDED Requirements

### Requirement: Only named office staff can verify members
Office tools SHALL be available only to a host session whose user is on the office staff list. The first office staff member SHALL be set during deployment from configuration. Existing office staff SHALL be able to add and remove others from the dashboard; removal SHALL take effect on the next request; the list SHALL NEVER become empty by removal. Other hosts and all attendees SHALL be denied at both the application and the database.

#### Scenario: Host not on the list
- **WHEN** a host who is not office staff opens the office page or calls an office action
- **THEN** access is denied

#### Scenario: Last office staff member
- **WHEN** the only office staff member tries to remove themselves
- **THEN** the removal is refused

### Requirement: Unrecognized attendees can ask the office
A signed-in attendee SHALL be able to send the office a request with an optional note. The request SHALL carry their verified sign-in email and anything they entered in Find my membership, and a copy SHALL be emailed to the office contact address.

#### Scenario: Asking the office
- **WHEN** an attendee taps "Ask the office"
- **THEN** a request is created, the office is emailed, and the attendee sees "You'll get an email, usually within two business days"

### Requirement: The office queue explains each request
Each request SHALL show the requester's verified sign-in email, what they entered, the time, and a diagnosis of why no automatic match occurred (for example, contacts and households found and the household standing value). The diagnosis SHALL be reused for a few minutes rather than queried on every view.

#### Scenario: Diagnosing a request
- **WHEN** office staff open a request
- **THEN** they see the diagnosis without leaving the page

### Requirement: Office actions notify the person and are audited
Office staff SHALL be able to Re-check, Link to household, ask for more information, or Decline. Each action SHALL email the requester in plain language and SHALL be written to an append-only audit log with the staff member, time, and reason. An office link SHALL last 12 months, and the office SHALL be prompted to add the email to the CRM record as well. Staff notes SHALL never be shown or emailed to the requester.

#### Scenario: Office links a household
- **WHEN** office staff link a request to a household with a reason
- **THEN** the requester is linked, emailed, and the action is in the audit log

#### Scenario: Audit cannot be edited
- **WHEN** anyone attempts to update or delete an audit entry
- **THEN** the database refuses it

### Requirement: Office and matching data is server-only
Membership requests, household links, match codes, office staff, and the audit log SHALL have row-level security enabled and forced with no browser policies. Attendees SHALL see their own request status only as rendered by server code.

#### Scenario: Attendee queries requests directly
- **WHEN** an attendee session queries the membership requests table through the database API
- **THEN** no rows are returned, including their own
