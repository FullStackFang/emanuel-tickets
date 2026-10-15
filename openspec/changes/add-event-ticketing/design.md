## Context

Emanuel Tickets is a greenfield Next.js 16 / React 19 app (see `AGENTS.md` — this is a modified Next.js; read `node_modules/next/dist/docs/` before writing framework code). There is no database yet. This change introduces the first persistent backend (Supabase: Postgres + Auth + RLS) and the first money-handling path.

The hard constraints are correctness under concurrency and at-least-once delivery, not features:
- Two buyers racing for the last seat must not both succeed.
- A payment provider that retries its webhook must not confirm an order twice or commit seats twice.
- One host must never be able to read another host's attendee list, even if application code has a bug.

Everything below is shaped by those three constraints.

## Goals / Non-Goals

**Goals:**
- Oversell is *impossible*, enforced at the database, not merely unlikely.
- Payment confirmation is exactly-once and idempotent under provider retries and duplicate deliveries.
- Authorization is enforced by Postgres RLS as the primary boundary; application code is a convenience layer, not the security layer.
- Passwordless host sign-in; guest (no-login) purchase for attendees.
- Keep the payment provider behind a thin interface so the requirements do not name a vendor.

**Non-Goals (explicitly out of scope for this change):**
- Refunds, partial refunds, and the refund-on-failed-commit *mechanics* (the failure state is modeled; issuing money back is deferred).
- Assigned/reserved seating or seat maps (inventory is a count per ticket type, not seats).
- Waitlists, discount/promo codes, ticket transfers, multi-currency.
- Attendee accounts/login and an attendee-facing dashboard.
- Email/SMS delivery of tickets (an order can be *confirmed*; wiring the delivery channel is a follow-up).
- Provisioning secrets and the Supabase project itself (separate infra step).

## Decisions

### D1 — Inventory as guarded counters, not derived counts
Each `ticket_types` row carries `capacity`, `sold` (confirmed), and `held` (live reservations). A database `CHECK (sold >= 0 AND held >= 0 AND sold + held <= capacity)` makes oversell a schema invariant: no code path, buggy or not, can violate it — the transaction simply fails.

*Alternative considered:* deriving availability by `COUNT`ing reservation rows. Rejected: correct counting still requires locking to avoid the same race, and gives up the CHECK-constraint safety net. Counters + CHECK are simpler to reason about and fail safe.

### D2 — `reserve_seat` is one atomic guarded UPDATE
Reservation is a `SECURITY DEFINER` Postgres function. Its core is a single statement:

```sql
UPDATE ticket_types
   SET held = held + p_qty
 WHERE id = p_ticket_type_id
   AND capacity - sold - held >= p_qty
RETURNING id;
```

Zero rows returned ⇒ insufficient inventory ⇒ function raises / returns a typed failure. The `UPDATE` takes a row lock, so concurrent callers serialize on that row; the `WHERE` re-checks availability under the lock. No explicit `SELECT ... FOR UPDATE` needed. On success the function also inserts a `reservations` row (`status='held'`, `expires_at = now() + hold_interval`) and returns its id.

*Alternative considered:* `SELECT ... FOR UPDATE` then `UPDATE`. Equivalent correctness, two statements and a wider window; the single guarded UPDATE is tighter. Advisory locks rejected — they don't survive as a data invariant.

### D3 — Reservation expiry: authoritative sweep + lazy reclaim
Holds expire (default hold window ~10 min, tunable). Expiry is enforced two ways: (a) a scheduled sweep (pg_cron on Supabase, or a Vercel Cron hitting a route) flips `held`→expired reservations and decrements `ticket_types.held`; (b) `reserve_seat` is defined so already-expired holds don't block new reservations (they've been swept, or are excluded from the availability math). The sweep is authoritative so inventory returns even if no one is buying.

### D4 — Exactly-once webhook via a processed-events table
A `processed_webhook_events` table has the provider's event id as PRIMARY KEY. The webhook handler, in one transaction:
1. Verifies the provider signature (reject → 400, no state change).
2. `INSERT INTO processed_webhook_events (provider_event_id) ... ON CONFLICT DO NOTHING`. If it inserted 0 rows, the event was already handled → return 200 immediately, no side effects.
3. Otherwise, load the order by the provider session/reference, confirm it (see D5), commit.

Duplicate deliveries collapse at step 2. The insert and the order mutation share one transaction, so a crash between them rolls back the marker and the provider's retry reprocesses cleanly.

### D5 — Order lifecycle and the late-payment edge
`orders`: `pending` → `confirmed` | `expired` | `cancelled`. A `pending` order is created *before* redirecting the buyer to the provider, linked to its held reservation; this guarantees the row exists when the webhook arrives. Confirmation moves the reservation `held`→`sold`: `UPDATE ticket_types SET held = held - q, sold = sold + q ...` (guarded by the same CHECK).

*The nasty edge:* payment succeeds but the hold already expired and its seats were resold. On confirm, the `held - q` would underflow / CHECK would fail. Decision: keep the hold alive for the full life of the checkout session (set `expires_at` to at least the provider session expiry, not a short timer), so a completed payment always has a live hold. If confirmation still cannot commit inventory, the order is marked `confirmed` with a `needs_refund` flag rather than silently overselling — surfacing the money-back case instead of breaking the invariant. Actual refund issuance is a non-goal here.

### D6 — Guest writes go through the server, not the browser→DB
Attendees have no `auth.uid()`. So attendee-side mutations (`reserve_seat`, create checkout, confirm) run in **server-side route handlers** using the Supabase **service role** (or are `SECURITY DEFINER` RPCs), never a browser client relying on RLS. RLS's job is to protect *host* data and gate public reads. This cleanly separates: public/guest paths = trusted server code; host paths = authenticated + RLS.

### D7 — Host auth = Azure / Microsoft Entra ID OAuth via `@supabase/ssr`
Hosts sign in with their **Microsoft (Azure Entra ID)** accounts — Temple Emanuel runs on Microsoft 365, so staff already have identities there. Supabase's `azure` OAuth provider handles the flow: `supabase.auth.signInWithOAuth({ provider: 'azure', options: { scopes: 'email', redirectTo } })` → Microsoft consent → Supabase callback (`https://<ref>.supabase.co/auth/v1/callback`) → our app's callback route exchanges the code for a cookie session (`@supabase/ssr`, Next.js App Router). `auth.uid()` then drives host RLS; `events.host_id = auth.uid()` is the ownership key.

**Tenant scope (decided below):** register the Entra app as **single-tenant** ("My organization only") so only Temple Emanuel org accounts can host, and set Supabase's *Azure Tenant URL* to `https://login.microsoftonline.com/<tenant-id>`. Supabase Auth requires Azure to return a valid email, so the `email` scope is mandatory. This replaces the earlier magic-link plan; the rest of the auth design (cookie session, RLS ownership) is unchanged.

### D8 — RLS policy shape
- `events`: host can `SELECT/INSERT/UPDATE/DELETE` where `host_id = auth.uid()`; anon can `SELECT` where `status = 'published'`.
- `ticket_types`: anon `SELECT` for published events (availability is public); host manages own.
- `reservations`, `orders`, `order_items`, `attendees`: **no** anon/authenticated policies for direct access — reached only via service-role server routes and definer functions. Hosts get `SELECT` on `attendees`/`orders` scoped to their own events (`event_id` ∈ their events) to power the directory.
- `processed_webhook_events`: service-role only.

### D9 — Payment provider: Stripe, behind a thin adapter, hosted Checkout first
A small interface — `createCheckoutSession(order)`, `verifyAndParseWebhook(req)` → `{ providerEventId, orderRef, status }` — isolates the vendor. **Decided: Stripe**, provisioned via the Vercel Marketplace `payments` integration (marketplace discovery confirmed Stripe as the preferred/sole `payments` provider). Rationale: our inventory/orders live in Supabase, so there is no external product catalog — this is `payments` (charge for a ticket), not `commerce`.

"Easiest first, work up": start with **Stripe-hosted Checkout Sessions** (`checkout.session.completed` is the confirming webhook event) — lowest integration effort, PCI handled by Stripe, and it maps directly onto D5's "create session → redirect → webhook confirms" flow. The adapter keeps a later move to embedded/custom Elements reversible without touching the domain logic.

## Risks / Trade-offs

- **Counter drift (under-sell):** a code path that increments `held` but fails to decrement leaks capacity. The CHECK constraint prevents *over*sell but not *under*sell. → Mitigation: the authoritative expiry sweep (D3) plus a periodic reconciliation query comparing counters to live reservation rows.
- **Webhook before order commit:** provider webhook races the redirect. → Mitigation: order row is committed *before* redirect (D5); if the handler still can't find the order, return 5xx so the provider retries.
- **Late payment after resale:** covered by D5 (long-lived hold + `needs_refund` flag rather than oversell).
- **Service-role blast radius:** server routes hold a key that bypasses RLS. → Mitigation: confine service-role use to a small set of server-only modules; never ship it to the client; keep guest write paths minimal and validated.
- **Clock skew on expiry:** all expiry math uses `now()` in Postgres (single clock), not app servers.
- **First-DB operational load:** migrations, RLS tests, and cron all new to this repo. → Mitigation: ship RLS policy tests and a `reserve_seat` concurrency test as part of the specs' acceptance.

## Migration Plan

Greenfield — no data migration. Deploy order: (1) create schema + RLS + `reserve_seat` + expiry sweep via Supabase migrations; (2) ship server routes (auth callback, reserve, checkout, webhook) with env secrets; (3) ship host dashboard + public event/checkout pages. Rollback = drop the feature routes and, if needed, the migrations (no dependents exist).

## Open Questions

- ~~**Payment provider:**~~ **Resolved (D9): Stripe** via Vercel Marketplace `payments`, hosted Checkout first.
- **Hold window** duration and whether it should equal the provider session lifetime exactly.
- **Ticket delivery:** which channel confirms to the buyer (email now, or deferred)? Confirmation state is modeled regardless.
- **Tenancy:** single-org (Temple Emanuel is the only host) or genuinely multi-host? RLS is written multi-host-safe either way; affects onboarding UX only.
- **Attendee visibility:** does an attendee ever see a "who else is going" view, or is the directory host-only? (Spec currently: host-only.)
