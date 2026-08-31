# Premium Theme Design

## Goal

Give KiteMail a premium, editorial visual system based on the supplied Maison-inspired palette. The redesign applies to every public route while retaining the existing information architecture and interactions.

## Visual Direction

Light mode uses parchment `#F6F3E4` as the page canvas, ink `#1E100F` for primary text, oxblood `#30050E` for primary actions, and wine `#4D0C12` for emphasis. Dark mode uses deep brown `#1E100F` as the canvas, oxblood `#30050E` as raised surfaces, parchment `#F6F3E4` as primary text, and a muted rose-gold accent.

Headings use the existing editorial display serif. Body, forms, and navigation use a clean sans-serif with stronger weight and spacing than the current presentation.

## Shared Theme System

`main.css` will define semantic variables for canvas, surface, text, muted text, border, accent, glass fill, and shadow. The document root will carry `data-theme="light"` or `data-theme="dark"`; CSS variables supply the selected appearance to all pages.

Theme selection defaults to `prefers-color-scheme` when no saved choice exists. The theme toggle persists a user choice in `localStorage`, exposes its state to assistive technology, and updates its label and icon after selection.

## Surfaces And Depth

The page canvas remains clean and still. Existing stars, ambient blobs, decorative floating elements, page-load motion, and hover lifts are removed.

Navigation, cards, dialogs, and focused form groups use a restrained liquid-glass treatment: a translucent tinted fill, a one-pixel low-contrast border, backdrop blur, and two soft tinted shadow layers. The effect is not used behind dense reading copy or on every element, preserving contrast and hierarchy.

## Route Integration

The shared stylesheet controls base elements, navigation, forms, cards, buttons, alerts, footer, and responsive menu. Route-level styles retain their layouts but replace hard-coded pale blue, orange, and black values with the semantic tokens. The homepage hero will receive the same calm surface treatment without a moving or gradient background.

All pages receive a compact navigation theme control. The mobile menu keeps its current behavior while adopting the selected glass surface and accessible close control.

## Accessibility And Motion

Text and interactive states must maintain WCAG AA contrast in both themes. Focus rings use the accent color with enough separation from the glass surface. The palette transition is brief, and all transition/animation behavior is disabled for `prefers-reduced-motion: reduce`.

## Verification

Verify that every public HTML page loads the shared theme toggle and stylesheet, run JavaScript syntax checks, scan for deprecated ambient/animation markup, and run `git diff --check`. Manually inspect both themes at desktop and mobile widths, including nav, forms, alerts, ticket status, and the homepage hero.
