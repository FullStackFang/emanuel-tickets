## ADDED Requirements

### Requirement: Attendees can sign in with their email using a one-time code
An attendee SHALL be able to sign in by entering their email address and the one-time code the system emails to them. No password SHALL be stored or requested. The code SHALL be entered on the same page that requested it, so sign-in does not depend on the email being opened in the same browser. The email SHALL also contain a link that completes sign-in without depending on browser state from the requesting page. A first-time email SHALL create the account on successful verification.

#### Scenario: Sign in by typing the code
- **WHEN** an attendee enters their email on the sign-in page and then enters the code from the email on that same page
- **THEN** an authenticated member session is established
- **AND** the attendee is returned to the page they came from (or the home page if none)

#### Scenario: Sign in by opening the link in a different browser
- **WHEN** an attendee requests a code in one browser and opens the emailed link in a different browser (for example a mail app's in-app browser)
- **THEN** an authenticated member session is established in the browser that opened the link

#### Scenario: Wrong or expired code
- **WHEN** an attendee enters a code that is incorrect or expired
- **THEN** no session is established
- **AND** the sign-in page shows a plain-language error and lets them request a new code

#### Scenario: Return destination is restricted to this site
- **WHEN** the sign-in page is opened with a return destination that is not a relative path on this site
- **THEN** the attendee is returned to the home page after sign-in instead

### Requirement: Session role is derived from the authentication method
Every session SHALL carry a role of `host` or `member` in its verified access token. The role SHALL be `host` only when the session was established through Microsoft (Azure Entra ID) OAuth by a user holding a Microsoft identity; every other session SHALL be `member`. The role SHALL be derived at token issuance from the session's authentication method, SHALL persist across token refresh, and SHALL NOT be read from user-editable metadata.

#### Scenario: Microsoft sign-in yields a host session
- **WHEN** a user completes Microsoft OAuth sign-in
- **THEN** the issued access token carries the `host` role
- **AND** the role is still `host` after the token is refreshed

#### Scenario: Email-code sign-in yields a member session
- **WHEN** a user completes email one-time-code sign-in
- **THEN** the issued access token carries the `member` role

#### Scenario: Existing host sessions gain the role on refresh
- **WHEN** the role mechanism is enabled while a host has an active Microsoft-established session
- **THEN** the host's next refreshed access token carries the `host` role without signing in again

### Requirement: Staff accounts get sessions only through Microsoft
An account that holds a Microsoft identity SHALL be refused a session established by any method other than Microsoft OAuth, including email one-time code, email link, password recovery, or password. The refusal SHALL occur at token issuance, not only in the user interface, and SHALL tell the person to sign in with Microsoft. An existing non-Microsoft session for such an account SHALL be refused at its next token refresh.

#### Scenario: Staff email requests a code
- **WHEN** a one-time code or link is verified for an email whose account holds a Microsoft identity
- **THEN** no session is established
- **AND** the person sees "Staff sign in with Microsoft" with a link to the host sign-in page

#### Scenario: Member account later gains a Microsoft identity
- **WHEN** an account with an active email-code session gains a Microsoft identity and that session's token is next refreshed
- **THEN** the refresh is refused
- **AND** the browser is treated as signed out rather than retrying

### Requirement: Members and guests see a member-appropriate account control
A signed-in member SHALL see an account control showing their email, a "Member" badge when their membership is active, and a sign-out action. A signed-in member SHALL NOT see host navigation (such as "Your events" or the host dashboard link). Signing out SHALL return a member to the public home page.

#### Scenario: Member header
- **WHEN** a signed-in member with active membership views any public page
- **THEN** the header shows their account control with the "Member" badge
- **AND** no host navigation is shown

#### Scenario: Member signs out
- **WHEN** a signed-in member chooses sign out
- **THEN** the session ends
- **AND** they are returned to the public home page
