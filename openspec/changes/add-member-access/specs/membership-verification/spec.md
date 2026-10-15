## ADDED Requirements

### Requirement: A household link counts as a match, but standing still comes from the CRM
When a signed-in attendee's email matches no contact, the system SHALL check for an unexpired household link for that attendee and, if one exists, SHALL read that household's standing live from the CRM. A link SHALL NOT grant membership when the household is not in good standing. Links SHALL expire after 12 months.

#### Scenario: Linked household in good standing
- **WHEN** the signed-in email matches no contact but the attendee has an unexpired link to a household in good standing
- **THEN** the attendee is treated as an active member

#### Scenario: Linked to a lapsed household
- **WHEN** the attendee is linked to a household the CRM reports as not in good standing
- **THEN** they see the lapsed message and regular prices

#### Scenario: Expired link
- **WHEN** a link is more than 12 months old
- **THEN** it is ignored and the attendee is offered Find my membership again
