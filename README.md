# Emanuel Tickets

Events and ticketing for Temple Emanuel, replacing TicketLeap and Eventbrite. Congregants RSVP or buy tickets as guests. Staff sign in with Microsoft to create events, manage capacity, and see who's coming.

See `PRODUCT.md` for purpose and voice, `DESIGN.md` for the visual system, and `openspec/` for specs and in-flight changes.

## Stack

Next.js 16 (App Router), React 19, Tailwind CSS 4, Supabase (Postgres, Auth, RLS), deployed on Vercel. This Next.js version has breaking changes, so read `AGENTS.md` before writing framework code.

## Development

```bash
npm install
npm run dev        # http://localhost:6175
npm run lint
npm run test:unit
npm run test:db
```

Copy environment values into `.env.local` (Supabase URL and keys, payment provider settings, `NEXT_PUBLIC_SITE_URL`).
