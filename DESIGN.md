# DESIGN.md — Emanuel Tickets

The visual language is already implemented as tokens in `src/app/tokens.css` (single source of truth) and bound into Tailwind v4 via `@theme inline` in `src/app/globals.css`. This doc summarizes intent; the tokens are authoritative.

## Color

Light theme. Strategy: **Restrained** — a warm-stone canvas, Deep Sapphire for primary actions and links, Warm Gold as sparing seasoning for heritage/celebration moments (never a fill for large surfaces). Never `#000`/`#fff`; neutrals are warm stone (`--color-neutral-*`).

- **Primary — Deep Sapphire** `--color-primary-*` (600/700 for text + primary buttons, 50 for subtle brand backgrounds).
- **Accent — Warm Gold** `--color-accent-*` (celebration, "get tickets", highlights). ≤10% of a surface.
- **Neutrals — Warm Stone** `--color-neutral-*` (0 = white canvas, 50/100 = secondary surfaces, 600/500 = secondary/tertiary text, 900 = ink).
- **Semantic** success/warning/error/info ramps for states (sold out, error, confirmed).
- **Rose Window hues** `--rose-*` — the temple mark's own stained-glass colors. Brand/loading signature only; do NOT use for general UI color.

## Typography

- **DM Sans** — display + body (`--font-display` / `--font-body`), via next/font.
- **JetBrains Mono** — `--font-mono`, for metadata/labels/counts where a mono tick reads well (dates, seat counts, small caps labels).
- Modular scale, ratio 1.25 (`--text-2xs` … `--text-5xl`). Weights 300–700. Hierarchy through scale + weight, per shared laws.
- Prose capped 65–75ch.

## Spacing, radius, elevation, motion

- Spacing scale `--space-*` (0.25rem base). Vary for rhythm; avoid uniform padding.
- Radius: cards `--radius-xl`, pills/badges `--radius-full`, modals `--radius-2xl`.
- Shadows `--shadow-xs…2xl` (soft, low-alpha) + `--shadow-primary` / `--shadow-accent` for brand-tinted lifts on primary/accent buttons.
- Motion: durations 100–300ms, `--ease-out` for enters/transforms. State-conveying only; no page-load choreography. (`--ease-bounce` exists but avoid per shared laws — no bounce/elastic.)

## Components (established vocabulary)

- **Buttons**: primary = sapphire-500 → 600 hover, white text, `--shadow-primary`; accent = gold-500 → 600, dark gold text (`--color-accent-900`), `--shadow-accent`; ghost = white with strong border. Heights 32/40/48. Include hover/focus/active/disabled/loading (`.btn-spinner`).
- **Cards**: `--card-*` — xl radius, subtle border (`--border-subtle`), sm shadow → md on hover. No nested cards, no side-stripe borders.
- **Badges/pills**: full radius, xs text, tinted (e.g. `bg-primary-50 text-brand` for "Free · RSVP").
- **Inputs**: 40px default, subtle border, `.focus-ring` (sapphire focus outline).
- **Rose Window mark** (`RoseSpinner`): brand signature + loading; sizes 24/40/64.

## Accessibility

Congregants of all ages: generous type, high contrast on stone (not pale-gray-on-white), obvious tap targets (≥44px), visible focus (`.focus-ring`), semantic states never color-only.
