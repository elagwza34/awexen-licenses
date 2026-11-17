# Customer systems, subscriptions, and annual pricing

> Execution: implement inline using executing-plans, test-driven-development, and ui-ux-pro-max. The owner explicitly requested the portal structure and approved the annual pricing rule.

**Goal:** Separate the software catalogue from owned subscriptions and enable annual purchase with a 15% discount.

**Architecture:** Add an administrator-managed software-system registry, initially containing only PMS. Existing plans belong to PMS by default. The customer catalogue lists active systems, then their plans with a monthly/yearly selector. My Subscriptions lists owned subscriptions, linked keys, and owner-authorized downloads. Existing subscription upgrade, quote approval, signing, and expiry rules remain authoritative.

**Pricing:** For a monthly price M in minor units, annual service is round(M × 12 × 85 / 100), rounded once to the nearest minor unit, half up. Setup fees are separate and charged once for a customer's first paid purchase of the system; renewals and upgrades do not repeat them. Preserve historical paid prices and prepaid credit. Legacy annual-only plans retain their configured annual price when no monthly price exists. No production pricing mutation or deployment occurs in this implementation phase.

**Design:** Reuse existing RTL Tailwind tokens, cards, buttons, and forms. Show one PMS tile without placeholder systems. Month/year tabs precede plan cards. Annual cards identify the 15% service discount and show setup fees separately. My Subscriptions shows system, plan, interval, dates, status, masked/revealable key, renewal/upgrade link, and authorized download. Invalid, empty, loading, pending-payment, and expired states remain visible and actionable.

- [x] Add regression tests for annual arithmetic, setup fee exclusion on renewal, and system boundaries; verify they fail before implementation.
- [x] Implement pricing, additive software-system migration, administrative management, and portal projections with owner scoping.
- [x] Implement system tiles, scoped plan selection, My Subscriptions, administrative association, and automatic annual price display.
- [x] Run backend tests, isolated PostgreSQL acceptance, frontend production build, and browser scenarios including RTL mobile and deep links.
- [x] Document exact plan calculations and verification. Leave source local for review; do not publish or push without a new request.

The UI/UX search returned a marketplace layout with unrelated search/carousel guidance. Only the matching accessible-card and keyboard guidance is relevant; retain the existing design system and omit search/carousel changes.
