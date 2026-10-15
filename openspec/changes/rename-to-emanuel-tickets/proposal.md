## Why

The product is Temple Emanuel's replacement for TicketLeap and Eventbrite: one place to publish events, sell or RSVP tickets, and check people in. "Emanuel Gather" reads like a social or community-meetup app and undersells that. "Emanuel Tickets" names the job the product replaces, in the same terms congregants and staff already use for TicketLeap and Eventbrite.

An interim rename to "Emanuel Events" was applied and then superseded by this one. See Impact for the leftovers.

## What Changes

- **Product name**: "Emanuel Gather" becomes **"Emanuel Tickets"** everywhere a person sees it: header wordmark, login title, browser tab titles, settings copy, and docs.
- **Package and tooling identifiers**: `package.json` name and Supabase local `project_id` become `emanuel-tickets`.
- **Repository and hosting**: GitHub repo and Vercel project become `emanuel-tickets`, dropping v0.dev's `v0-` prefix. The canonical domain becomes `emanuel-tickets.vercel.app`.
- **Local folder**: the working directory becomes `emanuel-tickets/`.
- **Unchanged on purpose**:
  - The tagline **"Come, let us gather."** stays. It is the brand's invitational voice, not the product name.
  - Noun uses such as "gathering" stay.
  - The event-form preview gradient seed `emanuel-gather-preview` stays, so preview colors do not shift.
  - The hosted Supabase project and the Microsoft Entra app registration keep their identifiers. Neither name is user-visible.

## Capabilities

### New Capabilities
<!-- None. -->

### Modified Capabilities
<!-- None. This is a naming change with no behavior change, so there are no spec deltas. -->

## Impact

- **Code**: page metadata titles, `SiteHeader`, login page, settings page copy, `tokens.css` banner comment.
- **Docs**: `PRODUCT.md`, `DESIGN.md`, `README.md`, and the `add-event-ticketing` proposal and design.
- **Deployment URL**: the canonical hostname moves to `emanuel-tickets.vercel.app`. `NEXT_PUBLIC_SITE_URL` is inlined at build time, so ticket links change only after a fresh production build. The Supabase Auth redirect allow-list must include the new hostname, because login builds its callback from the current page's origin.
- **Legacy hostnames**: `v0-emanuel-gather.vercel.app` and the interim `emanuel-events-hub.vercel.app` stay attached until the cutover is verified, then redirect to the canonical domain.
- **Git remotes**: GitHub redirects the old repo URLs, but local clones should update `origin`.
