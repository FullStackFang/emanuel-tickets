## 1. In-repo rename

- [x] 1.1 Wordmark in `SiteHeader` and login title: "Emanuel Tickets"
- [x] 1.2 Page metadata title suffixes: `· Emanuel Tickets`
- [x] 1.3 Settings page copy: "Gather" becomes "Emanuel Tickets"
- [x] 1.4 `package.json` and `package-lock.json` name, Supabase `config.toml` `project_id`: `emanuel-tickets`
- [x] 1.5 `tokens.css` banner, `PRODUCT.md`, `DESIGN.md`, `add-event-ticketing` proposal and design
- [x] 1.6 Replace create-next-app boilerplate `README.md` with a project README
- [x] 1.7 Verify: case-insensitive grep for "gather" returns only the tagline, "gathering" nouns, the preview seed, and external identifiers; lint and typecheck pass

## 2. External renames

- [x] 2.1 GitHub: repo renamed to `FullStackFang/emanuel-tickets` (via interim `emanuel-events`); local `origin` updated
- [x] 2.2 Vercel: project renamed to `emanuel-tickets`; `.vercel/project.json` updated
- [x] 2.3 Vercel domain: `emanuel-tickets.vercel.app` attached and serving
- [x] 2.4 `NEXT_PUBLIC_SITE_URL` in `.env.local` set to `https://emanuel-tickets.vercel.app`
- [ ] 2.5 Vercel env: set Production `NEXT_PUBLIC_SITE_URL` to `https://emanuel-tickets.vercel.app` (dashboard; MCP token lacks production env permission)
- [ ] 2.6 Supabase Auth URL Configuration: Site URL to `https://emanuel-tickets.vercel.app`; add `https://emanuel-tickets.vercel.app/auth/callback` to Redirect URLs; keep older entries until cutover is verified
- [x] 2.7 Commit the rename alone and push to `main` (11bb767); production build succeeded and serves "Emanuel Tickets"
- [ ] 2.8 Verify Microsoft sign-in round-trip and a ticket email link on the new domain
- [ ] 2.9 After verification: redirect `v0-emanuel-gather.vercel.app` and `emanuel-events-hub.vercel.app` to the canonical domain (308) and drop them from Supabase Redirect URLs
- [ ] 2.10 Developer renames local folder `emanuel-gather/` to `emanuel-tickets/` (outside a running session)
