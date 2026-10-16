## MODIFIED Requirements

### Requirement: Event management requires an authenticated host session
Creating, editing, publishing, or deleting an event and its ticket types SHALL require a session whose verified access token carries the `host` role, which is issued only for sessions established through Microsoft (Azure Entra ID) OAuth. Unauthenticated requests SHALL be denied. Authenticated requests whose session carries the `attendee` role SHALL be denied at both the application layer and the database layer, and SHALL NOT reach the host dashboard.

#### Scenario: Unauthenticated event management is denied
- **WHEN** a request without a valid session attempts to create or edit an event
- **THEN** the request is denied
- **AND** no event data is changed

#### Scenario: Member session cannot manage events
- **WHEN** a request with a valid `attendee` session attempts to create or edit an event, including directly against the database API
- **THEN** the request is denied
- **AND** no event data is changed

#### Scenario: Member session cannot open the host dashboard
- **WHEN** a signed-in member navigates to the host dashboard
- **THEN** they are redirected away from the dashboard
- **AND** no host navigation is shown to them

#### Scenario: Authenticated host reaches their dashboard
- **WHEN** a host with a valid `host` session opens the host dashboard
- **THEN** they can create and manage events
