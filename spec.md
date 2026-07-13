# Shared Grocery List PWA — Product & Engineering Specification

## 1. Overview

Build a polished, mobile-first Progressive Web App for a small group of authenticated users managing one shared grocery list. There are no households, multiple lists, custom application server, or public registration. The product must optimize for minimal interaction cost, immediate feedback, realtime collaboration, accessibility, subtle motion, and production-quality automated coverage.

The application should feel like a purpose-built consumer product rather than generic CRUD software.

## 2. Product philosophy

### 2.1 Intent-first interaction

The main search input immediately filters products already on the shared list. A filtered product remains its normal list row: tapping it opens its edit drawer, its quantity controls remain available, and its pick/restore gestures remain unchanged. The plus action attached to the input is the only way to create a product.

Quantity controls remain directly accessible. Swiping an unpicked product toward inline-end picks it; the same gesture on a picked product restores it. Destructive actions require confirmation, while routine actions do not.

### 2.2 Mobile first

Design for one-handed mobile use first, then adapt to desktop. Touch targets, edge gestures, drawer placement, and fixed controls must account for browser gestures and safe-area insets.

### 2.3 One primary screen

After authentication, normal use happens on one screen containing:

1. The search/filter input and attached creation action.
2. Unpicked products.
3. A subtle divider.
4. Picked products.

The picked section is always visible and is not an accordion. Administration and product drawers are the only secondary surfaces needed for the specified flows.

## 3. Technology stack

### 3.1 Frontend

Use React, TypeScript, Vite, TanStack Router, TanStack Query, Tailwind CSS v4, the current shadcn CLI/component architecture, appropriate Base UI primitives, Motion for React from motion.dev, i18next, Day.js, and Phosphor Icons. Do not use Lucide Icons. TanStack Table is not required.

Before implementation, verify current shadcn CLI defaults and its current relationship with Base UI; do not assume older shadcn/Radix patterns.

### 3.2 Backend

Use Supabase exclusively for PostgreSQL, Auth, Realtime, Row Level Security, migrations, and trusted server-side execution. There is no Express, Fastify, NestJS, custom WebSocket/SSE service, or other custom application server. A Supabase Edge Function is appropriate for privileged Auth administration.

### 3.3 Supabase development workflow

Create reproducible migrations, indexes, constraints, RLS policies, seed data, and Edge Functions with the Supabase CLI. Do not make undocumented production schema changes in the dashboard.

Credentials belong in the execution environment's secret-management mechanism and never in source control. Never commit personal access tokens, database passwords, service-role keys, or production credentials. Scope temporary credentials narrowly and rotate or revoke them after use.

### 3.4 PWA and offline boundary

The app must be installable, provide a manifest and icons, support standalone display and safe areas, and handle deployed-version updates correctly. The service worker may cache only the static application shell. It must never cache product data for offline reading and must not queue or replay offline mutations.

When connectivity is absent, request failure is shown rather than serving application product data from a cache. Failed and timed-out operations provide visible, actionable feedback. Reconnection triggers an authoritative database refetch.

## 4. Domain and data model

The current list domain has one entity: a **product**. The former distinction between `Product` and `Shopping Item` is removed.

### 4.1 `products`

One editable `products` table is the shared list. Each row owns:

- `id`;
- `name` and its database-enforced duplicate signature;
- exact decimal `quantity`;
- optional `notes`;
- `is_picked` and the timestamp/actor metadata needed for ordering and concurrency;
- an optimistic concurrency version;
- `created_at`; and
- `updated_at`.

`quantity` uses an exact PostgreSQL decimal/numeric representation, never binary floating point. It is inclusive from `1` through `999` and has at most two fractional digits.

Every editable application table has `created_at` and `updated_at`. A database trigger maintains `updated_at` on every accepted update. Supabase does not add or maintain these columns automatically.

There is no separate catalog, suggestion collection, join entity, add-existing operation, hidden product state, or soft deletion. Product deletion is permanent.

### 4.2 `product_pick_history`

`product_pick_history` is an append-only event table used only for per-product history. Each row has an ID, `product_id`, `picked_at`, nullable `picked_by`, a non-null `picked_by_email` snapshot, and `created_at`. A transition from unpicked to picked appends exactly one event. Restoring a product does not remove prior events. Deleting a user nulls the profile reference while preserving the email snapshot; deleting a product cascades to its history.

General aggregate shopping analytics are not part of this product.

## 5. Authentication

Users sign in directly with email and an admin-selected password through Supabase Auth. Public registration is disabled. Normal Supabase session and refresh-token persistence should make sign-in ordinarily a one-time action; no forced first-login password change is required.

Session restoration must not flash the login screen to an authenticated user or protected content to an unauthenticated user. Authentication failures always receive visible feedback.

## 6. Administration

One server-authorized admin can view users, create a user with email and an admin-selected password, and permanently delete an Auth user. Deletion is available only after explicit confirmation; soft disable or deactivation is not the specified removal behavior.

Privileged Auth operations run in trusted Supabase execution, such as an Edge Function. A service-role key or equivalent privileged credential must never reach the browser. Admin authorization is enforced server-side and is not based only on hidden UI.

## 7. Main list and ordering

Unpicked products appear first and sort newest first using the ordering timestamp and stable ID tie-breaker. Picked products follow, appear visually muted, and sort by their most recent pick event, newest first, with stable ID tie-breaking. Restoring a product updates its unpicked ordering timestamp so it moves to the top of the unpicked section.

Local and remote changes use the same restrained transition language when rows move between sections. Neither section is collapsible, and picking is not represented by a checkbox.

## 8. Search, filtering, and creation

### 8.1 Search normalization and scoring

The main input filters current product rows in place; there is no separate result or suggestion list. Search is Unicode-aware and must work for Hebrew and English.

For search only, normalize query and candidate strings by applying Unicode `NFKC`, Unicode-aware lowercase conversion, replacing each run of non-letter/non-number characters with one space, trimming, and collapsing internal whitespace. Count Unicode code points rather than UTF-16 code units.

For a normalized one-code-point query, include a product when any normalized candidate token starts with or contains that code point. Order prefix matches before containment-only matches, then by normalized name in ascending Unicode code-point order, then by product ID.

For a query of two or more code points, use normalized Damerau–Levenshtein similarity:

`similarity(a, b) = 1 - distance(a, b) / max(codePointLength(a), codePointLength(b))`

where adjacent transposition costs `1`, as do insertion, deletion, and substitution. Score a product as the maximum similarity between the full normalized query and (a) the full normalized product name and (b) each contiguous sequence of product-name tokens. Include only scores greater than or equal to `0.72`. Sort by descending score, then normalized name in ascending Unicode code-point order, then product ID. These normalization, scoring, threshold, and tie-break rules are fixed and shared by implementation and fixtures; “high confidence” is not left to subjective tuning.

A filtered row remains a normal product row. Tapping it opens that product's edit drawer and never adds another entity.

### 8.2 Duplicate identity

Duplicate identity is separate from fuzzy search. Build a duplicate signature by:

1. applying Unicode `NFKC` and Unicode-aware case-insensitive comparison;
2. extracting runs of Unicode letters or numbers, with punctuation and whitespace as token boundaries;
3. preserving every token occurrence;
4. sorting tokens in ascending Unicode code-point order; and
5. serializing the resulting exact multiset unambiguously.

Token order is ignored, but repeated-token counts are retained. No stemming, semantics, translation, transliteration, or fuzzy score contributes to duplicate identity.

Normative examples:

| Existing    | Candidate                   | Outcome                                         |
| ----------- | --------------------------- | ----------------------------------------------- |
| `soy milk`  | `Milk Soy`                  | duplicate                                       |
| `soy milk`  | `soy-milk`                  | duplicate                                       |
| `milk`      | `MILK`                      | duplicate                                       |
| `milk milk` | `milk`                      | distinct                                        |
| `milk`      | a merely fuzzy-similar name | distinct unless its token multiset is identical |

Create and rename use this same signature in application validation and an immutable database function backed by a unique constraint/index. The database is authoritative under concurrent requests, so two racing creates cannot produce duplicates.

### 8.3 Plus behavior and quick creation

The trailing plus is the sole creation path. It is inactive for empty normalized input and duplicate input. A duplicate plus uses `aria-disabled="true"`, not native `disabled`, so it remains event-capable for feedback. Activating it creates nothing, places the matching product first in the filtered order, and briefly shakes that row. The effect is subtle and has a reduced-motion alternative.

For valid distinct input, activation creates exactly one product with default quantity `1` and empty notes. Clear and refocus the input only after server success. On failure or timeout, preserve the input and show a retryable message. Creation does not open an intermediate drawer and does not add an existing product.

## 9. Product row

Each row displays name, quantity, minus and plus controls, and picked styling. Tapping the row body opens the edit drawer. Interactive child controls do not accidentally open it.

The visually primary pick/restore action remains a directional swipe. Equivalent keyboard and assistive-technology row actions expose Pick or Restore without requiring a gesture.

## 10. Quantity

Quantity is an exact decimal from `1` to `999` inclusive with no more than two fractional digits. Direct input validates the same bounds and precision.

Row plus and minus operations change quantity by exactly `1` through atomic database mutations. Minus is unavailable whenever subtracting `1` would produce a value below `1`; plus is unavailable whenever adding `1` would exceed `999`. A rejected operation restores authoritative state and shows visible feedback.

## 11. Product edit drawer

The drawer edits name, direct quantity, and notes. Names are 1–80 Unicode code points after `NFKC`, trimming outer whitespace, and collapsing internal whitespace. Notes are optional plain text up to 500 Unicode code points; preserve intentional internal line breaks while trimming empty outer whitespace and blank outer lines.

History sits at block-start/inline-start and Delete at block-start/inline-end. Use logical properties so placement mirrors naturally between Hebrew and English. A currently picked product also displays its latest pick event at the drawer top.

Save is explicit, full width at the drawer bottom, and positioned above the safe-area inset. It is enabled only when changes are dirty and all fields are valid. Closing a dirty drawer requires confirmation before discarding changes.

A duplicate rename is blocked. The drawer remains open, the attempted name is preserved, and an inline, announced error explains the collision. Save performs an optimistic version check as described in §16.

The drawer includes an accessible Pick or Restore action equivalent to the row gesture.

## 12. Product deletion

Delete exists only in the product drawer. It opens an explicit destructive confirmation naming the product. Confirmation permanently deletes the product and cascade-deletes its pick history. Cancellation changes nothing. Successful deletion closes the drawer; failure leaves recoverable context and shows actionable feedback.

## 13. Pick and restore gestures

Swiping an unpicked product toward inline-end progressively reveals Pick feedback and commits only after the threshold. Swiping a picked product in the same logical direction reveals Restore feedback. Below-threshold gestures settle back without mutation.

Picking conditionally changes the current version/state and appends one history event. Restoring conditionally changes state, retains history, and moves the row to the top of unpicked products. Vertical scrolling must win over ambiguous diagonal gestures. Directional motion uses logical sides and mirrors in RTL/LTR.

## 14. Progressive swipe feedback

Feedback grows continuously with drag distance and must not feel binary or abrupt. Use restrained translation, color, icon, and label changes. Haptics, if supported, are optional enhancement only. Reduced-motion mode replaces large translations with low-motion opacity/state feedback while retaining clear completion cues.

## 15. Pick history

The history icon in the edit drawer opens a product-specific history drawer. It lists every pick event newest first with stable event-ID tie-breaking. Each entry shows a circular avatar containing the first character of the recorded email and the full email beside it. The immutable email snapshot keeps attribution visible after account deletion. `picked_at` is formatted with Day.js and the active locale: localized relative wording for today and yesterday, and a localized calendar-date fallback for older events.

When a product is currently picked, its latest event is also visible at the top of the edit drawer. Restoring never erases events.

## 16. Realtime, concurrency, and reconciliation

Use field-appropriate concurrency:

- Quantity buttons invoke atomic database operations.
- Pick/restore mutations are conditional on the expected state/version, preventing duplicate history events and stale state reversal.
- Drawer saves include the version read when editing began and update only that version.

A stale drawer save must never silently overwrite a newer accepted update. On conflict, fetch authoritative state, preserve the user's unsaved field input, explain which save conflicted, and allow retry against the new version.

Optimistic mutations and Supabase Realtime events reconcile idempotently by row identity, mutation/version metadata, and event identity. A local optimistic action followed by its Realtime echo must not create a duplicate row, apply quantity twice, or duplicate history/state. After disconnect/reconnect, invalidate local query state and perform an authoritative refetch.

Realtime subscriptions are authenticated and respect RLS. Clean them up correctly when session or component state changes.

## 17. Motion and interaction design

Use Motion for React for drawer transitions, row reordering, pick/restore gestures, duplicate shake feedback, and meaningful loading transitions. Motion should be calm, fast, interruptible, and tied to state. Avoid decorative movement, exaggerated bounce, broad stagger effects, and long narrative loops. Respect `prefers-reduced-motion` everywhere.

## 18. Visual design

Use the approved warm market-paper direction:

- soft cream background;
- deep herb-green text and actions;
- muted sage surfaces;
- sparing produce-orange accents;
- a very faint custom grocery line pattern;
- restrained rounding; and
- low layered shadows instead of prominent card borders.

Maintain strong contrast, clear hierarchy, comfortable density, and crisp typography. Picked rows are muted without becoming illegible. Focus, validation, loading, success, error, and destructive states must remain distinguishable without relying on color alone.

## 19. Background pattern

Create an original lightweight line pattern of leaves, bottles, bread, and produce. Keep contrast extremely low so content remains dominant. Prefer a code-native SVG/CSS asset, make it scale cleanly, and verify that it does not introduce visual noise in either direction.

## 20. Iconography

Use Phosphor Icons for interface controls. Keep weight and sizing consistent and provide accessible labels where an icon has semantic meaning. Custom visual assets such as the background pattern and Leaf Loop are not substitutes from another icon library.

## 21. Selected loader

The selected loader is **Leaf Loop**, the reviewed compact continuous leaf-handoff loop. Concept review and owner selection are complete; loader selection is not an implementation gate.

Implement it as a small custom vector mark with a seamless, subtle, repeatable cadence. It must read immediately as ongoing work rather than a narrative illustration. Reduced-motion mode uses a static leaf mark with a restrained opacity pulse or equivalent non-spatial progress indication.

## 22. Internationalization and bidirectionality

Use i18next for all user-facing strings. Hebrew and English are required. Select an initial locale from supported browser preferences and persist explicit user choice.

Set document language and direction correctly. Use logical CSS sides and logical motion directions throughout; do not encode left/right assumptions for layout, drawers, swipe feedback, or control placement. History is at block-start/inline-start and Delete at block-start/inline-end in both languages through natural mirroring. Dates and relative history text use the active Day.js locale.

## 23. User feedback

Every async action has visible pending, success where useful, error, and timeout behavior. Disable repeated unsafe submission while a request is pending. Preserve recoverable input after failure. Messages explain what happened and what the user can do next.

Connection loss does not expose cached product data or imply that changes were queued. Reconnection fetches current server state. Leaf Loop may represent session restoration and meaningful blocking loads without replacing precise inline mutation feedback.

## 24. Accessibility

Meet WCAG 2.2 AA. Support keyboard navigation, visible focus, semantic labels, sufficient contrast, touch targets, screen readers, zoom, and reduced motion. Drawers trap and restore focus correctly; confirmations and errors are announced.

Swipe is never the only route to Pick/Restore: the edit drawer and keyboard/assistive row actions provide equivalents. The duplicate plus uses semantic `aria-disabled`, remains activatable for feedback, announces the existing match, and does not create. Its shake has a non-motion indication in reduced-motion mode.

## 25. Security

Require authentication and RLS for every product and history operation. Validate constraints at both client and database boundaries. Enforce admin authorization in trusted Supabase execution. Do not expose privileged secrets in browser code, logs, fixtures, or committed files.

Use least privilege, validate Edge Function input, avoid leaking whether unrelated Auth identities exist, and keep permanent user deletion auditable through trusted operational logs where supported.

## 26. Performance

Keep initial assets small, lazy-load secondary administration UI, avoid unnecessary rerenders, and maintain responsive filtering and gestures on typical mobile devices. Index database predicates used for ordering, version checks, duplicate signatures, and history access. Realtime updates must not refetch or animate the entire list unnecessarily.

## 27. Testing strategy

Use unit, integration, database, accessibility, and hermetic end-to-end tests. E2E tests run against isolated test data and controlled Supabase configuration, without relying on production state or network timing. Freeze time and locale where needed for deterministic order and Day.js assertions.

### 27.1 Search, duplicate, and creation coverage

Automate:

- one-character prefix/containment filtering;
- two-plus-character `NFKC` normalized Damerau–Levenshtein filtering at threshold `0.72`;
- exclusion below threshold, descending score order, normalized-name/ID tie-breaking, and typo fixtures in Hebrew and English;
- filtered-row edit behavior and confirmation that row taps never add an existing entity;
- plus-only creation of exactly one row;
- empty and duplicate plus states;
- punctuation boundaries, reordered words, case variation, repeated-token distinction, and fuzzy-similar-but-distinct duplicate fixtures;
- duplicate activation ordering, announcement, and shake/reduced-motion feedback; and
- concurrent race-safe creation at the database boundary.

### 27.2 Field, drawer, deletion, and history coverage

Automate:

- exact decimal storage/calculation at `1`, `999`, valid two-place fractions, invalid precision, and out-of-range values;
- exact `+1`/`-1` atomic steps and unavailable boundary controls;
- direct quantity validation, 1–80-code-point names, and 500-code-point notes with newline/outer-whitespace behavior;
- explicit Save dirty/valid states and dirty-close confirmation;
- duplicate rename preserving the attempted value and showing an inline error;
- drawer-only confirmed deletion and history cascade;
- one history insertion per pick, restore retention, newest-first history, latest-pick display, and Day.js today/yesterday/date localization; and
- newest-first unpicked order, recent-pick order, and restore-to-top behavior.

### 27.3 Authentication, database, security, and concurrency coverage

Automate:

- direct email/password login, session restoration, disabled public registration, and absence of a forced password-change flow;
- admin-only user creation and confirmed permanent Auth-user deletion;
- rejection of admin operations by normal users and absence of privileged browser credentials;
- RLS for products and pick history;
- trigger-maintained timestamps and database constraints for quantity and duplicate signatures;
- create/rename uniqueness under concurrency;
- conditional pick/restore with exactly-once history and atomic quantity mutations;
- stale drawer conflicts that fetch authority, preserve unsaved input, explain conflict, and allow retry;
- idempotent optimistic/Realtime reconciliation without duplicated rows, quantity, or history; and
- authoritative reconnect refetch.

### 27.4 PWA, accessibility, and design coverage

Automate where feasible:

- installability, manifest, static-shell cache, and version update behavior;
- absence of product-data caching and offline mutation queues;
- visible, actionable failure and timeout feedback;
- keyboard/screen-reader Pick/Restore alternatives and semantic duplicate-plus behavior;
- logical RTL/LTR placement and motion, including history/delete positions;
- reduced-motion behavior for gestures, shake, row movement, and Leaf Loop;
- Leaf Loop presence for designated loading states; and
- approved palette tokens, background asset, restrained rounding, layered shadows, and contrast.

Manual device checks supplement but do not replace automated acceptance for touch ergonomics, safe areas, installed mode, and subjective motion quality.

### 27.5 Test quality

Tests must assert observable outcomes, avoid arbitrary sleeps, control time and Realtime fixtures, clean up created data, and fail for behavior regressions rather than implementation refactors.

## 28. Continuous integration

CI runs formatting, linting, type checking, unit/integration tests, database migration and policy tests, a production build, and hermetic E2E tests. A failing required check blocks release. CI uses scoped test secrets and never prints them.

## 29. Implementation process

Implement in migration-backed, reviewable increments: foundation and Auth, product schema/security, primary list/search/create, drawers/history, Realtime/concurrency, PWA/accessibility/design, then full verification. Preserve the approved decisions in this specification rather than reopening normalization, quantity, edit/save, deletion, duplicate behavior, loader, or offline semantics during implementation.

Investigate only version-sensitive library integration details. Record material architecture decisions and keep migrations reproducible.

## 30. Owner review

The owner interview has approved the single-product model, fuzzy in-list filtering, multiset duplicate identity, quantity constraints, explicit drawer Save, permanent deletion, pick history, ordering, concurrency/offline behavior, Leaf Loop, logical-side behavior, and warm market-paper direction.

Owner review during delivery evaluates faithful execution: mobile ergonomics, motion feel, visual quality, Hebrew/English experience, and production readiness. It is not a gate for selecting already-settled behaviors again.

## 31. Out of scope

The following are out of scope:

- multiple lists, households, invitations, roles beyond admin/user, and public registration;
- a product catalog or suggestion/add-existing workflow;
- soft deletion, product hiding, or product archival;
- aggregate shopping-history analytics, reports, budgets, prices, recipes, barcode scanning, and inventory management;
- offline product-data viewing or queued offline edits; and
- a custom application server.

The product-specific pick event log and history drawer described in §§4.2 and 15 are explicitly in scope.

## 32. Definition of Done

### 32.1 Functional completeness

- One shared `products` table drives the current list; no second current-item/catalog entity exists.
- Search fuzzy-filters current rows with the specified deterministic Hebrew/English behavior, and plus is the only creation path.
- Application and database enforce the exact unordered token-multiset duplicate signature for create and rename, including races and duplicate feedback.
- Quantity, field limits, explicit Save, dirty-close confirmation, permanent deletion, pick/restore, ordering, and accessible alternatives behave exactly as specified.
- Product pick history inserts, displays, localizes, retains on restore, and cascade-deletes correctly.
- Admin-created email/password users retain normal sessions and can be permanently deleted only by a confirmed, authorized operation.

### 32.2 Collaboration and resilience

- Quantity is atomic; pick/restore and drawer saves are version-aware.
- Conflicts preserve unsaved input and never silently overwrite accepted data.
- Optimistic and Realtime events reconcile once, and reconnect performs an authoritative refetch.
- Failures and timeouts are actionable; only the static shell is cached, with no product-data cache or mutation queue.

### 32.3 UX, accessibility, and design quality

- Mobile, desktop, installed PWA, Hebrew RTL, and English LTR experiences are polished and accessible.
- Logical layout/motion mirrors naturally, including drawer history/delete placement.
- Leaf Loop is used as the selected compact loader with subtle repeatable and reduced-motion treatments.
- The warm market-paper palette, faint custom grocery pattern, restrained rounding, and layered shadows are implemented with accessible contrast.

### 32.4 Engineering and verification quality

- Schema, migrations, triggers, indexes, RLS, Edge Functions, and local setup are reproducible and documented.
- No privileged secret ships to the browser or repository.
- CI passes formatting, lint, types, builds, database/security tests, integration tests, E2E tests, accessibility checks, and the required regression matrix in §27.
- There are no unexplained console errors, duplicate Realtime effects, flaky timing assumptions, or unresolved approved product decisions.

The work is complete only when the full system satisfies this specification as a coherent product, not merely when individual screens render.
