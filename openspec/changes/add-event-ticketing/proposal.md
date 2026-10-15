## Why

Emanuel Tickets needs to turn events into something people can actually sign up for. Today the app can display an event but cannot sell or reserve a finite number of seats, take payment reliably, let a host manage their own event, or show who is coming. Ticketing is the last piece before the product is usable end-to-end, and the risky parts (never overselling, never double-charging, never leaking one host's attendee list to another) are exactly the parts that must be specified before code is written.

## What Changes

- **Events with finite inventory**: a host's event has one or more ticket types, each with a fixed capacity. The system tracks how many seats are sold vs. available per ticket type.
- **Oversell-safe reservation**: reserving a seat is an atomic operation that decrements available inventory under a lock, so concurrent buyers can never push a ticket type below zero. Unpaid reservations expire and return their seats to inventory.
- **Checkout + idempotent payment confirmation**: a buyer starts checkout against a held reservation; the payment provider's webhook confirms the order. The webhook is idempotent — the same provider event delivered twice (retries, at-least-once delivery) confirms the order exactly once and never double-commits seats.
- **Azure / Microsoft Entra host auth**: hosts sign in with their Microsoft 365 (Azure Entra ID) accounts via OAuth. Only an authenticated host may create or manage their events and view their attendee list. No attendee login is required to buy a ticket (guest checkout by email).
- **"Who's going" directory**: a host sees the confirmed attendee list for their event. Visibility of attendee data to other parties is governed by explicit access-control rules, not left implicit.
- **Row-Level Security (RLS)** enforced at the database as the primary authorization boundary, so a bug in application code cannot expose another host's data.

Assumptions (surfaced for confirmation; see `design.md` for the decisions that flow from them):
- Backend is **Supabase** (Postgres + Auth); this change introduces the first Supabase dependency in the repo.
- Payment is handled by an **external payment provider** kept abstract in the spec (concrete choice — e.g. Stripe vs. a Vercel Marketplace provider — is a design decision, not a requirement).
- Attendees purchase as **guests** (email only); hosts authenticate. Paid ticketing (not free RSVP) is the primary flow; a zero-price ticket type is the free-RSVP special case.

## Capabilities

### New Capabilities
- `event-ticketing`: Core domain — events, ticket types, finite per-type inventory, the atomic oversell-safe seat reservation, reservation expiry, and the order lifecycle (pending → confirmed → expired/cancelled).
- `ticket-checkout`: Starting a checkout against a held reservation and the idempotent payment-provider webhook that confirms the order and commits reserved seats exactly once.
- `host-auth`: Passwordless magic-link authentication for hosts and the gate that ties event management to the authenticated host.
- `attendee-access`: The database-enforced access-control rules (RLS) governing who may read/write events, orders, and attendee data, and the host-facing "who's going" directory those rules expose.

### Modified Capabilities
<!-- None. openspec/specs/ is empty; this is the first set of capabilities. -->

## Impact

- **New dependency**: Supabase (Postgres, Auth, RLS). First database in the repo.
- **New dependency**: a payment provider SDK/webhook (provider chosen in design).
- **New surface area**: database schema + migrations (events, ticket_types, reservations, orders, order_items, attendees, processed_webhook_events); a `reserve_seat` database function; auth callback route; payment checkout route; payment webhook route; host dashboard + public event/checkout pages.
- **Environment**: new secrets (Supabase URL/keys, payment provider keys, webhook signing secret) — provisioned as a separate follow-up, not in this change.
- **No breaking changes**: greenfield feature; nothing to migrate.
